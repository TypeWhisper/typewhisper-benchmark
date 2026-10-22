# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Curate an English Common Voice 17 suite: real voices on everyday microphones, at dictation length.

The references keep Common Voice's casing and punctuation, so the suite also scores punctuation
and capitalization on real speech; the other English formatting suites use macOS TTS voices.

Picks a deterministic sample with one clip per speaker, converts it to 16 kHz mono WAV under
bench/audio/samples-commonvoice-en/ and writes bench/tests/clean-speech-commonvoice-en.json.
Clips start at 2 s (the Russian suite starts at 4 s) because dictation is mostly short.

Prerequisites: Common Voice 17 (CC0 mirror at a pinned revision), into the gitignored
bench/audio/datasets/common-voice-17-en/ (common-voice-en/ holds the Spontaneous Speech corpus):
  R=https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/8262c16bf297c87a9cd88c51997c4758ed7a8ba2
  $R/transcript/en/test.tsv
  $R/transcript/en/clip_durations.tsv
  $R/audio/en/test/en_test_0.tar   (about 710 MB; all en_test_*.tar shards, currently one)

Usage: uv run --script bench/scripts/curate-commonvoice-en.py [--target 100]
"""
import argparse
import csv
import hashlib
import json
import re
import subprocess
import tarfile
from collections import defaultdict
from pathlib import Path

BENCH_ROOT = Path(__file__).resolve().parent.parent
DATASET = BENCH_ROOT / "audio" / "datasets" / "common-voice-17-en"
SAMPLE_DIR = "samples-commonvoice-en"
SUITE_ID = "clean-speech-commonvoice-en"
MIN_SECONDS, MAX_SECONDS = 2.0, 20.0
MIN_WORDS = 3


def stable_key(value):
    return hashlib.sha256(str(value).encode()).hexdigest()


def select_balanced(entries, target):
    """Round-robin over speakers (sorted), hash order within each speaker."""
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


def ffmpeg_to_wav(out_path, data):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", "pipe:0",
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out_path)]
    subprocess.run(cmd, input=data, check=True)


def main(target):
    tsv, durations = DATASET / "test.tsv", DATASET / "clip_durations.tsv"
    tar_paths = sorted(DATASET.glob("en_test_*.tar"))
    if not (tsv.exists() and durations.exists() and tar_paths):
        raise SystemExit(f"Common Voice English test files not found under {DATASET}")
    with durations.open() as f:
        seconds = {r["clip"]: int(r["duration[ms]"]) / 1000 for r in csv.DictReader(f, delimiter="\t")}
    with tsv.open() as f:
        rows = list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))
    candidates = [
        {"id": r["path"].removesuffix(".mp3"), "group": r["client_id"], "text": r["sentence"].strip(), "path": r["path"]}
        for r in rows
        if MIN_SECONDS <= seconds.get(r["path"], 0) <= MAX_SECONDS
        and int(r["down_votes"] or 0) == 0
        and len(r["sentence"].split()) >= MIN_WORDS
    ]
    selected = select_balanced(candidates, target)

    out_dir = BENCH_ROOT / "audio" / SAMPLE_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {e["path"]: e for e in selected}
    for tar_path in tar_paths:
        with tarfile.open(tar_path) as tar:
            for member in tar:
                name = Path(member.name).name
                if name in wanted and member.isfile():
                    wav = out_dir / f"{wanted[name]['id']}.wav"
                    if not wav.exists():
                        ffmpeg_to_wav(wav, tar.extractfile(member).read())
    missing = [e["path"] for e in selected if not (out_dir / f"{e['id']}.wav").exists()]
    if missing:
        raise SystemExit(f"Common Voice audio missing from {[p.name for p in tar_paths]}: {missing[:5]}")

    speakers = {}
    tests = []
    for e in selected:
        text = re.sub(r"\s+", " ", e["text"]).strip()
        # Anonymous, stable speaker label instead of the long Common Voice client hash.
        speaker = speakers.setdefault(e["group"], f"cv-{stable_key(e['group'])[:8]}")
        tests.append({
            "id": f"cv-en-{e['id']}",
            "audioFile": f"{SAMPLE_DIR}/{e['id']}.wav",
            "groundTruth": text,
            # Common Voice sentences carry casing and punctuation, so they double as the formatted reference.
            "formattedGroundTruth": text,
            "tags": ["clean", "read-speech", "real-speech"],
            "source": "common-voice",
            "metadata": {"speaker": speaker},
        })
    suite = {
        "id": SUITE_ID,
        "name": "Crowd Speech: Common Voice 17 (English)",
        "description": "Crowd-sourced read speech on everyday microphones from the Common Voice 17 English test split (CC0), one clip per speaker, scored for punctuation and capitalization too",
        "language": "en",
        "category": "clean-speech",
        "benchmarkTier": "core",
        "tests": tests,
    }
    out = BENCH_ROOT / "tests" / f"{SUITE_ID}.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    print(f"Common Voice English: written {len(tests)} tests ({len(speakers)} speakers) to {out}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=100)
    main(parser.parse_args().target)
