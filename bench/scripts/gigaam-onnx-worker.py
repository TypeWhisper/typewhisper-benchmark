# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "numpy",
#   "onnx-asr==0.12.0",  # only for its GigaAM v3 feature extractor graph
#   "onnxruntime==1.24.2",  # the version TypeWhisper's GigaAM plugin links
#   "soundfile",
#   "soxr",
# ]
# ///
"""Persistent worker that runs GigaAM RNN-T models the way TypeWhisper's GigaAM plugin does.

Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "model": "/abs/models/gigaam/v4", "kind": "advance", "file": "/abs/clip.wav", "slot": 2}
  <- {"id": 1, "text": "...", "durationMs": 12.3}

The pipeline matches the plugin: onnx-asr's GigaAM v3 feature extractor (16 kHz, 64 log-mel),
clips padded to 1 s, recordings over 20 s cut at the quietest 200 ms near even cut points, and
the chunk transcripts joined with a space. "e2e" runs GigaAM v3 with separate decoder and joint
graphs and a greedy loop of at most three symbols per frame, like the plugin today. "advance"
runs the v4 and Multilingual v2 exports (bench/scripts/export-gigaam-onnx.py), whose greedy loop
is part of the advance graph; head 0 is the punctuated, cased transcript. `slot` is the
language_vector index (0 detects the language) for encoders that take one. Timing covers feature
extraction, encoding and decoding, and excludes reading and resampling the WAV file.
"""
import json
import re
import sys
import time
from importlib import resources
from pathlib import Path

import numpy as np
import onnxruntime as rt
import soundfile
import soxr

SAMPLE_RATE = 16_000
MAX_CHUNK = 20 * SAMPLE_RATE
FRAME = SAMPLE_RATE // 50
QUIET_STRETCH = 10
PRED_HIDDEN = 320
MAX_TOKENS_PER_STEP = 3
LANGUAGE_SLOTS = 32

sessions = {}


def session(path):
    path = str(path)
    if path not in sessions:
        sessions[path] = rt.InferenceSession(path, providers=["CPUExecutionProvider"])
    return sessions[path]


def preprocessor():
    data = resources.files("onnx_asr.preprocessors") / "data" / "gigaam_v3.onnx"
    with resources.as_file(data) as path:
        return session(path)


def model_file(directory, suffix):
    matches = sorted(Path(directory).glob(f"*{suffix}"))
    if len(matches) != 1:
        raise RuntimeError(f"expected one *{suffix} in {directory}, found {len(matches)}")
    return matches[0]


def vocabulary(directory):
    key = ("vocab", str(directory))
    if key not in sessions:
        pieces = {}
        for line in model_file(directory, "_vocab.txt").read_text("utf-8").splitlines():
            if not line:
                continue
            piece, _, index = line.rpartition(" ")
            pieces[int(index)] = piece
        blank = next(i for i, p in pieces.items() if p == "<blk>")
        sessions[key] = (pieces, blank)
    return sessions[key]


def text_for(tokens, pieces):
    joined = "".join(pieces.get(t, "") for t in tokens).replace("▁", " ")
    joined = re.sub(r"\s+", " ", joined)
    joined = re.sub(r" +([.,!?:;…»)\]])", r"\1", joined)
    joined = re.sub(r"([«(\[]) +", r"\1", joined)
    return joined.strip()


def quietest_point(samples, start, end):
    frames = (end - start) // FRAME
    if frames <= 0:
        return start + (end - start) // 2
    energies = np.square(samples[start : start + frames * FRAME].astype(np.float64)).reshape(frames, FRAME).sum(1)
    stretch = min(QUIET_STRETCH, frames)
    sums = np.convolve(energies, np.ones(stretch), mode="valid")
    best = int(np.argmin(sums))
    return start + best * FRAME + stretch * FRAME // 2


def chunk_ranges(samples):
    count = len(samples)
    if count <= MAX_CHUNK:
        return [(0, count)]
    radius = MAX_CHUNK // 20
    ranges, start = [], 0
    while count - start > MAX_CHUNK:
        remaining = count - start
        chunks = (remaining + MAX_CHUNK - 1) // MAX_CHUNK
        even = start + remaining // chunks
        earliest = count - (chunks - 1) * MAX_CHUNK
        low, high = max(even - radius, earliest), min(even + radius, start + MAX_CHUNK)
        cut = even if low >= high else quietest_point(samples, low, high)
        ranges.append((start, cut))
        start = cut
    ranges.append((start, count))
    return ranges


def features(samples):
    if len(samples) < SAMPLE_RATE:
        samples = np.concatenate([samples, np.zeros(SAMPLE_RATE - len(samples), dtype=np.float32)])
    feats, lens = preprocessor().run(
        ["features", "features_lens"],
        {"waveforms": samples[None, :].astype(np.float32), "waveforms_lens": np.array([len(samples)], dtype=np.int64)},
    )
    return feats, lens


def transcribe_e2e(directory, samples):
    """GigaAM v3 end-to-end RNN-T as the plugin runs it (istupakov/gigaam-v3-onnx int8)."""
    pieces, blank = vocabulary(directory)
    encoder = session(model_file(directory, "_encoder.int8.onnx"))
    decoder = session(model_file(directory, "_decoder.int8.onnx"))
    joint = session(model_file(directory, "_joint.int8.onnx"))
    feats, lens = features(samples)
    encoded, encoded_len = encoder.run(["encoded", "encoded_len"], {"audio_signal": feats, "length": lens})
    frames = min(encoded.shape[2], int(encoded_len[0]))
    hidden = np.zeros((1, 1, PRED_HIDDEN), dtype=np.float32)
    cell = hidden.copy()
    last, prediction, tokens, frame, emitted = blank, None, [], 0, 0
    while frame < frames:
        if prediction is None:
            dec, new_hidden, new_cell = decoder.run(
                ["dec", "h", "c"], {"x": np.array([[last]], dtype=np.int64), "h.1": hidden, "c.1": cell}
            )
            prediction = (dec.reshape(1, PRED_HIDDEN, 1), new_hidden, new_cell)
        logits, = joint.run(["joint"], {"enc": encoded[:, :, frame : frame + 1], "dec": prediction[0]})
        token = int(np.argmax(logits.reshape(-1)))
        if token != blank:
            tokens.append(token)
            last, hidden, cell = token, prediction[1], prediction[2]
            prediction = None
            emitted += 1
        if token == blank or emitted == MAX_TOKENS_PER_STEP:
            frame += 1
            emitted = 0
    return text_for(tokens, pieces)


def transcribe_advance(directory, samples, slot):
    """GigaAM v4 and Multilingual v2: encoder plus the advance graph with the greedy loop inside."""
    pieces, _ = vocabulary(directory)
    encoder = session(model_file(directory, "_encoder.int8.onnx"))
    advance = session(model_file(directory, "_advance.onnx"))
    feats, lens = features(samples)
    inputs = {"audio_signal": feats, "length": lens}
    if any(i.name == "language_vector" for i in encoder.get_inputs()):
        vector = np.zeros((1, LANGUAGE_SLOTS), dtype=np.float32)
        vector[0, slot] = 1
        inputs["language_vector"] = vector
    projected, encoded_len = encoder.run(["head_outputs", "encoded_len"], inputs)
    tokens, = advance.run(["tokens"], {"projected": projected, "lengths": encoded_len.astype(np.int64)})
    head = tokens[:, 0, 0]
    return text_for([int(t) for t in head if t >= 0], pieces)


def transcribe(request):
    samples, rate = soundfile.read(request["file"], dtype="float32", always_2d=True)
    samples = samples.mean(axis=1)
    if rate != SAMPLE_RATE:
        samples = soxr.resample(samples, rate, SAMPLE_RATE).astype(np.float32)
    started = time.perf_counter()
    texts = []
    for start, end in chunk_ranges(samples):
        chunk = samples[start:end]
        if request["kind"] == "e2e":
            texts.append(transcribe_e2e(request["model"], chunk))
        else:
            texts.append(transcribe_advance(request["model"], chunk, int(request.get("slot", 0))))
    elapsed = (time.perf_counter() - started) * 1000
    return {"text": " ".join(t for t in texts if t), "durationMs": elapsed}


def main():
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            if request.get("load"):
                # Load the sessions without a timed request, so the first clip does not pay for it.
                vocabulary(request["model"])
                for suffix in ("_encoder.int8.onnx", "_advance.onnx", "_decoder.int8.onnx", "_joint.int8.onnx"):
                    if list(Path(request["model"]).glob(f"*{suffix}")):
                        session(model_file(request["model"], suffix))
                preprocessor()
                response = {}
            else:
                response = transcribe(request)
        except Exception as error:  # noqa: BLE001 (reported to the runner per clip)
            response = {"error": f"{type(error).__name__}: {error}"}
        print(json.dumps({"id": request.get("id"), **response}), flush=True)


if __name__ == "__main__":
    main()
