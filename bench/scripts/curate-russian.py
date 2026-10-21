# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow", "numpy"]
# ///
"""Curate Russian suites from FLEURS, Russian LibriSpeech (RuLS) and Common Voice 17.

Also derives a noisy suite by mixing the bench/audio/noise-samples into FLEURS clips at a
measured signal-to-noise ratio.

Picks a deterministic sample, converts it to 16 kHz mono WAV under bench/audio/samples-<name>/
and writes bench/tests/<suite>.json. References with digits or Latin letters are skipped:
digits would need Russian number normalization (with case inflection), and Latin words test
transliteration rather than Russian recognition.

Prerequisites (all land in the gitignored bench/audio/datasets/):
  FLEURS:  curl -L -o bench/audio/datasets/fleurs-ru/test.parquet \
    https://huggingface.co/datasets/google/fleurs/resolve/main/parquet-data/ru_ru/test-00000-of-00001.parquet
  RuLS:    curl -L -o bench/audio/datasets/rulibrispeech/test.parquet \
    https://huggingface.co/datasets/bond005/rulibrispeech/resolve/main/data/test-00000-of-00001-0e9859b3235b0392.parquet
  Common Voice 17 (CC0 mirror), into bench/audio/datasets/common-voice-ru/:
    https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/main/transcript/ru/test.tsv
    https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/main/transcript/ru/clip_durations.tsv
    https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/main/audio/ru/test/ru_test_0.tar
    (all ru_test_*.tar shards; the Russian test split currently fits in one)

Usage: uv run --script bench/scripts/curate-russian.py [--target 100]
"""
import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
import tarfile
import wave
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow.parquet as pq

BENCH_ROOT = Path(__file__).resolve().parent.parent
DATASETS = BENCH_ROOT / "audio" / "datasets"
MIN_SECONDS, MAX_SECONDS = 4.0, 20.0
UNSUPPORTED = re.compile(r"[0-9A-Za-z]")


def usable(text):
    return bool(text and text.strip()) and not UNSUPPORTED.search(text)


def stable_key(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def select_balanced(entries, target):
    """Round-robin over groups (sorted), hash order within each group."""
    groups = defaultdict(list)
    for e in entries:
        groups[e["group"]].append(e)
    queues = [sorted(groups[g], key=lambda e: stable_key(e["id"])) for g in sorted(groups)]
    selected = []
    while len(selected) < target and any(queues):
        for q in queues:
            if q and len(selected) < target:
                selected.append(q.pop(0))
    return sorted(selected, key=lambda e: e["id"])


def ffmpeg_to_wav(out_path, src_path=None, data=None):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", src_path or "pipe:0",
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out_path)]
    subprocess.run(cmd, input=data, check=True)


def wav_seconds(data):
    with wave.open(io.BytesIO(data)) as w:
        return w.getnframes() / w.getframerate()


def test_entry(prefix, sample_dir, file_id, text, source, speaker=None):
    entry = {
        "id": f"{prefix}-{file_id}",
        "audioFile": f"{sample_dir}/{file_id}.wav",
        "groundTruth": re.sub(r"\s+", " ", text).strip(),
        "tags": ["clean", "read-speech", "real-speech"],
        "source": source,
    }
    if speaker:
        entry["metadata"] = {"speaker": speaker}
    return entry


def curate_fleurs(target):
    parquet = DATASETS / "fleurs-ru" / "test.parquet"
    if not parquet.exists():
        print("FLEURS Russian test split not found:", parquet)
        return
    meta = pq.read_table(parquet, columns=["id", "num_samples", "raw_transcription"]).to_pylist()
    # FLEURS has several recordings per sentence; group by sentence so each one appears once.
    candidates = [
        {"id": f"{r['id']}_{i}", "group": r["id"], "text": r["raw_transcription"], "row": i}
        for i, r in enumerate(meta)
        if MIN_SECONDS <= r["num_samples"] / 16000 <= MAX_SECONDS and usable(r["raw_transcription"])
    ]
    by_sentence = {}
    for e in sorted(candidates, key=lambda e: stable_key(e["id"])):
        by_sentence.setdefault(e["group"], e)
    selected = sorted(by_sentence.values(), key=lambda e: stable_key(e["group"]))[:target]
    selected.sort(key=lambda e: e["id"])
    audio = pq.read_table(parquet, columns=["audio"]).column("audio")
    out_dir = BENCH_ROOT / "audio" / "samples-fleurs-ru"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, data=audio[e["row"]].as_py()["bytes"])
        tests.append(test_entry("fleurs-ru", "samples-fleurs-ru", e["id"], e["text"], "fleurs"))
    write_suite("clean-speech-fleurs-ru", "Read Speech: FLEURS (Russian)",
                "Read Wikipedia sentences from the FLEURS Russian test split (CC BY 4.0), one recording per sentence",
                tests, "FLEURS")


def curate_ruls(target):
    parquet = DATASETS / "rulibrispeech" / "test.parquet"
    if not parquet.exists():
        print("Russian LibriSpeech test split not found:", parquet)
        return
    texts = pq.read_table(parquet, columns=["transcription"]).column("transcription").to_pylist()
    audio = pq.read_table(parquet, columns=["audio"]).column("audio")
    candidates = []
    for i, text in enumerate(texts):
        if not usable(text):
            continue
        clip = audio[i].as_py()
        if MIN_SECONDS <= wav_seconds(clip["bytes"]) <= MAX_SECONDS:
            # No speaker IDs; balance over books instead (file names are <book>_<index>.wav).
            stem = Path(clip["path"]).stem
            candidates.append({"id": stem, "group": stem.rsplit("_", 1)[0], "text": text, "row": i})
    selected = select_balanced(candidates, target)
    out_dir = BENCH_ROOT / "audio" / "samples-ruls-ru"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, data=audio[e["row"]].as_py()["bytes"])
        tests.append(test_entry("ruls", "samples-ruls-ru", e["id"], e["text"], "librispeech"))
    write_suite("clean-speech-ruls-ru", "Read Speech: Russian LibriSpeech",
                "Audiobook speech from the Russian LibriSpeech (RuLS) test split (public domain), balanced across books",
                tests, "RuLS")


def curate_common_voice(target):
    root = DATASETS / "common-voice-ru"
    tsv, durations = root / "test.tsv", root / "clip_durations.tsv"
    tar_paths = sorted(root.glob("ru_test_*.tar"))
    if not (tsv.exists() and durations.exists() and tar_paths):
        print("Common Voice Russian test files not found under", root)
        return
    with durations.open() as f:
        seconds = {r["clip"]: int(r["duration[ms]"]) / 1000 for r in csv.DictReader(f, delimiter="\t")}
    with tsv.open() as f:
        rows = list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    candidates = [
        {"id": r["path"].removesuffix(".mp3"), "group": r["client_id"], "text": r["sentence"], "path": r["path"]}
        for r in rows
        if MIN_SECONDS <= seconds.get(r["path"], 0) <= MAX_SECONDS
        and int(r["down_votes"] or 0) == 0
        and usable(r["sentence"])
    ]
    selected = select_balanced(candidates, target)
    out_dir = BENCH_ROOT / "audio" / "samples-commonvoice-ru"
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {e["path"]: e for e in selected}
    for tar_path in tar_paths:
        with tarfile.open(tar_path) as tar:
            for member in tar:
                name = Path(member.name).name
                if name in wanted:
                    wav = out_dir / f"{wanted[name]['id']}.wav"
                    if not wav.exists():
                        ffmpeg_to_wav(wav, data=tar.extractfile(member).read())
    missing = [e["path"] for e in selected if not (out_dir / f"{e['id']}.wav").exists()]
    if missing:
        raise SystemExit(f"Common Voice audio missing from {[p.name for p in tar_paths]}: {missing[:5]}")
    speakers = {}
    tests = []
    for e in selected:
        # Anonymous, stable speaker label instead of the long Common Voice client hash.
        speaker = speakers.setdefault(e["group"], f"cv-{stable_key(e['group'])[:8]}")
        tests.append(test_entry("cv-ru", "samples-commonvoice-ru", e["id"], e["text"], "common-voice", speaker))
    write_suite("clean-speech-commonvoice-ru", "Crowd Speech: Common Voice 17 (Russian)",
                "Crowd-sourced read speech on everyday microphones from the Common Voice 17 Russian test split (CC0), speaker-balanced",
                tests, "Common Voice")

NOISES = ["office", "cafe", "keyboard", "traffic"]
SNRS_DB = [15, 10, 5]


def read_pcm(data_or_path):
    """Decode any audio to 16 kHz mono float32 via ffmpeg."""
    src = str(data_or_path) if isinstance(data_or_path, Path) else "pipe:0"
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", src, "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
        input=None if isinstance(data_or_path, Path) else data_or_path, capture_output=True, check=True)
    return np.frombuffer(out.stdout, dtype=np.int16).astype(np.float32) / 32768


def write_pcm(path, samples):
    pcm = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(pcm.tobytes())


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) or 1e-9


def curate_noisy_fleurs(target):
    clean_suite = BENCH_ROOT / "tests" / "clean-speech-fleurs-ru.json"
    noise_dir = BENCH_ROOT / "audio" / "noise-samples"
    if not clean_suite.exists():
        print("Clean FLEURS suite missing:", clean_suite)
        return
    noises = {n: read_pcm(noise_dir / f"{n}.wav") for n in NOISES}
    clean_tests = json.loads(clean_suite.read_text())["tests"][:target]
    out_dir = BENCH_ROOT / "audio" / "samples-noisy-ru"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for i, t in enumerate(clean_tests):
        noise_type, snr = NOISES[i % len(NOISES)], SNRS_DB[i % len(SNRS_DB)]
        file_id = t["audioFile"].split("/")[-1].removesuffix(".wav")
        wav = out_dir / f"{file_id}.wav"
        if not wav.exists():
            speech = read_pcm(BENCH_ROOT / "audio" / t["audioFile"])
            noise = np.resize(noises[noise_type], speech.shape)
            # Scale the noise so that 20*log10(rms(speech) / rms(noise)) equals the target SNR.
            noise *= rms(speech) / (rms(noise) * 10 ** (snr / 20))
            write_pcm(wav, speech + noise)
        tests.append({
            "id": f"noisy-ru-{file_id}",
            "audioFile": f"samples-noisy-ru/{file_id}.wav",
            "groundTruth": t["groundTruth"],
            "tags": ["noisy-environment", noise_type, f"snr-{snr}", "real-speech"],
            "source": "fleurs",
            "metadata": {"noiseType": noise_type, "snrDb": snr},
        })
    suite = {
        "id": "noisy-environment-ru",
        "name": "Noisy Environment (Russian)",
        "description": "FLEURS Russian read speech mixed with office, cafe, keyboard and traffic noise at a measured 5, 10 or 15 dB SNR",
        "language": "ru",
        "category": "noisy-environment",
        "benchmarkTier": "core",
        "tests": tests,
    }
    out = BENCH_ROOT / "tests" / "noisy-environment-ru.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    print(f"Noisy FLEURS: written {len(tests)} tests to {out}")


def write_suite(suite_id, name, description, tests, label):
    suite = {
        "id": suite_id,
        "name": name,
        "description": description,
        "language": "ru",
        "category": "clean-speech",
        "benchmarkTier": "core",
        "tests": tests,
    }
    out = BENCH_ROOT / "tests" / f"{suite_id}.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    print(f"{label}: written {len(tests)} tests to {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=100)
    args = parser.parse_args()
    curate_fleurs(args.target)
    curate_ruls(args.target)
    curate_common_voice(args.target)
    curate_noisy_fleurs(args.target // 2)
