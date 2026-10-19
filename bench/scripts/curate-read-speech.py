# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow"]
# ///
"""Curate real read-speech suites from LibriSpeech test-clean (EN) and MLS German test (DE).

Picks a deterministic, speaker-balanced sample, converts it to 16 kHz mono WAV under
bench/audio/samples-<name>/ and writes bench/tests/clean-speech-<name>.json.

Prerequisites (both land in the gitignored bench/audio/datasets/):
  LibriSpeech: curl -L https://www.openslr.org/resources/12/test-clean.tar.gz | tar -xz -C bench/audio/datasets/librispeech
  MLS German:  curl -L -o bench/audio/datasets/mls-german/test.parquet \
    https://huggingface.co/datasets/facebook/multilingual_librispeech/resolve/main/german/test-00000-of-00001.parquet

Usage: uv run --script bench/scripts/curate-read-speech.py [--target 50]
"""
import argparse
import json
import subprocess
from collections import defaultdict
from pathlib import Path

import pyarrow.parquet as pq

BENCH_ROOT = Path(__file__).resolve().parent.parent
DATASETS = BENCH_ROOT / "audio" / "datasets"
MIN_SECONDS, MAX_SECONDS = 4.0, 20.0


def select_balanced(entries, target):
    """Round-robin over speakers (sorted), shortest-id-first within each speaker."""
    by_speaker = defaultdict(list)
    for e in entries:
        by_speaker[e["speaker"]].append(e)
    queues = [sorted(by_speaker[s], key=lambda e: e["id"]) for s in sorted(by_speaker)]
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


def librispeech_entries():
    root = DATASETS / "librispeech"
    entries = []
    for trans in sorted(root.rglob("*.trans.txt")):
        for line in trans.read_text().splitlines():
            utt, _, text = line.strip().partition(" ")
            flac = trans.parent / f"{utt}.flac"
            if not text or not flac.exists():
                continue
            entries.append({"id": utt, "speaker": utt.split("-")[0], "text": text, "flac": flac})
    # Durations need a probe; keep it cheap by using ffprobe only for candidates.
    return entries


def probe_seconds(path):
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def curate_librispeech(target):
    entries = librispeech_entries()
    if not entries:
        print("LibriSpeech test-clean not found under", DATASETS / "librispeech")
        return
    candidates = [e for e in entries if MIN_SECONDS <= probe_seconds(e["flac"]) <= MAX_SECONDS]
    selected = select_balanced(candidates, target)
    out_dir = BENCH_ROOT / "audio" / "samples-librispeech-en"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, src_path=str(e["flac"]))
        tests.append({
            "id": f"librispeech-{e['id']}",
            "audioFile": f"samples-librispeech-en/{wav.name}",
            "groundTruth": e["text"].lower(),
            "tags": ["clean", "read-speech", "real-speech"],
            "source": "librispeech",
            "metadata": {"speaker": e["speaker"]},
        })
    write_suite("clean-speech-librispeech-en", "Read Speech: LibriSpeech (English)",
                "Real read speech from LibriSpeech test-clean (CC BY 4.0), speaker-balanced sample",
                "en", tests)


def curate_mls_german(target):
    parquet = DATASETS / "mls-german" / "test.parquet"
    if not parquet.exists():
        print("MLS German test split not found:", parquet)
        return
    meta = pq.read_table(parquet, columns=["id", "speaker_id", "transcript", "audio_duration"]).to_pylist()
    candidates = [
        {"id": r["id"], "speaker": r["speaker_id"], "text": r["transcript"], "row": i}
        for i, r in enumerate(meta)
        if MIN_SECONDS <= r["audio_duration"] <= MAX_SECONDS
    ]
    selected = select_balanced(candidates, target)
    audio = pq.read_table(parquet, columns=["audio"]).column("audio")
    out_dir = BENCH_ROOT / "audio" / "samples-mls-de"
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, data=audio[e["row"]].as_py()["bytes"])
        tests.append({
            "id": f"mls-de-{e['id']}",
            "audioFile": f"samples-mls-de/{wav.name}",
            "groundTruth": e["text"],
            "tags": ["clean", "read-speech", "real-speech"],
            "source": "mls",
            "metadata": {"speaker": e["speaker"]},
        })
    write_suite("clean-speech-mls-de", "Read Speech: Multilingual LibriSpeech (German)",
                "Real read speech from the Multilingual LibriSpeech German test split (CC BY 4.0), speaker-balanced sample",
                "de", tests)


def write_suite(suite_id, name, description, language, tests):
    suite = {
        "id": suite_id,
        "name": name,
        "description": description,
        "language": language,
        "category": "clean-speech",
        "benchmarkTier": "core",
        "tests": tests,
    }
    out = BENCH_ROOT / "tests" / f"{suite_id}.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    speakers = len({t["metadata"]["speaker"] for t in tests})
    print(f"Written {len(tests)} tests ({speakers} speakers) to {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=50)
    args = parser.parse_args()
    curate_librispeech(args.target)
    curate_mls_german(args.target)
