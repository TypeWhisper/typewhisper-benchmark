# /// script
# requires-python = ">=3.10,<3.13"
# dependencies = [
#   "moshi_mlx==0.3.0",
# ]
# ///
"""Persistent Kyutai STT worker for the benchmark (Apple Silicon only).

Runs Kyutai's streaming speech-to-text models the way moshi_mlx.run_inference does: 24 kHz
input, the model's silence prefix and audio delay as padding (plus 1 s, so the last words
come out), one Mimi frame (80 ms) per step, greedy text sampling. Reads one JSON request per
line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "repo": "kyutai/stt-1b-en_fr-mlx", "revision": "<sha>", "file": "/abs/path.wav"}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
A request with "load" set only downloads, loads and warms up the model.
"""
import json
import sys
import time

import mlx.core as mx
import mlx.nn as nn
import numpy as np
import rustymimi
import sentencepiece
import sphn
from huggingface_hub import hf_hub_download
from moshi_mlx import models, utils

FRAME = 1920  # 80 ms at 24 kHz
cache = {}


class Loaded:
    def __init__(self, repo, revision):
        get = lambda name: hf_hub_download(repo, name, revision=revision)
        with open(get("config.json")) as f:
            raw = json.load(f)
        self.stt_config = raw.get("stt_config") or {}
        self.mimi_path = get(raw["mimi_name"])
        weights = get(raw.get("moshi_name", "model.safetensors"))
        self.tokenizer = sentencepiece.SentencePieceProcessor(get(raw["tokenizer_name"]))
        config = models.LmConfig.from_config_dict(raw)
        self.model = models.Lm(config)
        self.model.set_dtype(mx.bfloat16)
        if weights.endswith(".q4.safetensors"):
            nn.quantize(self.model, bits=4, group_size=32)
        elif weights.endswith(".q8.safetensors"):
            nn.quantize(self.model, bits=8, group_size=64)
        self.model.load_weights(weights, strict=True)
        self.other_codebooks = config.other_codebooks
        self.mimi_codebooks = max(config.generated_codebooks, config.other_codebooks)
        self.model.warmup(None)

    def transcribe(self, pcm):
        pad_left = int(self.stt_config.get("audio_silence_prefix_seconds", 0.0) * 24000)
        pad_right = int((self.stt_config.get("audio_delay_seconds", 0.0) + 1.0) * 24000)
        pcm = np.pad(pcm, [(0, 0), (pad_left, pad_right)], mode="constant")
        mimi = rustymimi.Tokenizer(self.mimi_path, num_codebooks=self.mimi_codebooks)
        steps = pcm.shape[-1] // FRAME
        gen = models.LmGen(
            model=self.model,
            max_steps=steps,
            text_sampler=utils.Sampler(temp=0.0),
            audio_sampler=utils.Sampler(temp=0.0),
            check=False,
        )
        pieces = []
        try:
            for idx in range(steps):
                chunk = pcm[:, idx * FRAME:(idx + 1) * FRAME]
                tokens = mimi.encode_step(chunk[None, 0:1])
                tokens = mx.array(tokens).transpose(0, 2, 1)[:, :, : self.other_codebooks]
                token = gen.step(tokens[0], None)[0].item()
                if token not in (0, 3):  # padding tokens
                    pieces.append(self.tokenizer.id_to_piece(token).replace("▁", " "))
        finally:
            # The next clip starts from an empty context, also after a failed clip.
            for c in self.model.transformer_cache:
                c.reset()
        return "".join(pieces).strip()


def handle(req):
    key = (req["repo"], req.get("revision"))
    if key not in cache:
        cache[key] = Loaded(*key)
    loaded = cache[key]
    if req.get("load"):
        return {"loaded": True}
    pcm, _ = sphn.read(req["file"], sample_rate=24000)
    start = time.perf_counter()
    text = loaded.transcribe(pcm)
    return {"text": text, "durationMs": (time.perf_counter() - start) * 1000}


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    if not line.strip():
        continue
    req = {}
    try:
        req = json.loads(line)
        res = handle(req)
    except Exception as e:  # report per-request failures without killing the worker
        res = {"error": f"{type(e).__name__}: {e}"}
    res["id"] = req.get("id") if isinstance(req, dict) else None
    print(json.dumps(res), flush=True)
