# /// script
# requires-python = ">=3.10"
# dependencies = ["pyarrow", "numpy"]
# ///
"""Curate French, Spanish, Italian and Portuguese suites from FLEURS, Multilingual LibriSpeech
(MLS) and Common Voice 17, plus a noisy suite per language, built like the Russian ones
(curate-russian.py).

Picks a deterministic sample of 4-20 s clips, converts it to 16 kHz mono WAV under
bench/audio/samples-<name>-<lang>/ and writes bench/tests/<suite>-<lang>.json. References with
digits are skipped: the normalizer has no number speller for these languages, so "1990" against
"mil novecientos noventa" would count as recognition errors.

The WAVs are not committed: this script rebuilds the same clips from the pinned dataset
revisions below. Prerequisites (all land in the gitignored bench/audio/datasets/), for <lang> in
fr, es, it, pt:
  FLEURS (fr_fr, es_419, it_it, pt_br), into fleurs-<lang>/test.parquet:
    https://huggingface.co/datasets/google/fleurs/resolve/70bb2e84b976b7e960aa89f1c648e09c59f894dd/parquet-data/<fleurs>/test-00000-of-00001.parquet
  MLS (french, spanish, italian, portuguese), into mls-<name>/test.parquet:
    https://huggingface.co/datasets/facebook/multilingual_librispeech/resolve/2e83e61823b4c47dcbcb1980bb88601274127609/<name>/test-00000-of-00001.parquet
  Common Voice 17 (CC0 mirror), into common-voice-<lang>/, from
  https://huggingface.co/datasets/fsicoli/common_voice_17_0/resolve/8262c16bf297c87a9cd88c51997c4758ed7a8ba2/:
    transcript/<lang>/test.tsv
    transcript/<lang>/clip_durations.tsv
    audio/<lang>/test/<lang>_test_0.tar

Usage: uv run --script bench/scripts/curate-romance.py [--target 100] [--language fr ...]
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
DIGITS = re.compile(r"[0-9]")

LANGUAGES = {
    "fr": {"name": "French", "fleurs": "fr_fr", "mls": "french", "fleurs_note": ""},
    "es": {"name": "Spanish", "fleurs": "es_419", "mls": "spanish", "fleurs_note": " (Latin American Spanish)"},
    "it": {"name": "Italian", "fleurs": "it_it", "mls": "italian", "fleurs_note": "",
           # Several of the test split's audiobooks are Dante's Divine Comedy, in 14th-century Italian.
           "mls_note": "; includes verse from Dante's Divine Comedy, which every model finds hard"},
    "pt": {"name": "Portuguese", "fleurs": "pt_br", "mls": "portuguese", "fleurs_note": " (Brazilian Portuguese)"},
}

NOISES = ["office", "cafe", "keyboard", "traffic"]
SNRS_DB = [15, 10, 5]


def usable(text):
    return bool(text and text.strip()) and not DIGITS.search(text)


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


def ffmpeg_to_wav(out_path, data):
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", "pipe:0",
           "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(out_path)]
    subprocess.run(cmd, input=data, check=True)


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


def write_suite(lang, suite_id, name, description, category, tests, label):
    suite = {
        "id": suite_id,
        "name": name,
        "description": description,
        "language": lang,
        "category": category,
        "benchmarkTier": "core",
        "tests": tests,
    }
    out = BENCH_ROOT / "tests" / f"{suite_id}.json"
    out.write_text(json.dumps(suite, indent=2, ensure_ascii=False) + "\n")
    print(f"{label}: written {len(tests)} tests to {out}")


def curate_fleurs(lang, target):
    spec = LANGUAGES[lang]
    parquet = DATASETS / f"fleurs-{lang}" / "test.parquet"
    if not parquet.exists():
        print(f"FLEURS {spec['name']} test split not found:", parquet)
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
    sample_dir = f"samples-fleurs-{lang}"
    out_dir = BENCH_ROOT / "audio" / sample_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, audio[e["row"]].as_py()["bytes"])
        tests.append(test_entry(f"fleurs-{lang}", sample_dir, e["id"], e["text"], "fleurs"))
    write_suite(lang, f"clean-speech-fleurs-{lang}", f"Read Speech: FLEURS ({spec['name']})",
                f"Read Wikipedia sentences from the FLEURS {spec['name']} test split{spec['fleurs_note']} "
                "(CC BY 4.0), one recording per sentence",
                "clean-speech", tests, f"FLEURS {lang}")


def curate_mls(lang, target):
    spec = LANGUAGES[lang]
    parquet = DATASETS / f"mls-{spec['mls']}" / "test.parquet"
    if not parquet.exists():
        print(f"MLS {spec['name']} test split not found:", parquet)
        return
    meta = pq.read_table(parquet, columns=["id", "speaker_id", "transcript", "audio_duration"]).to_pylist()
    candidates = [
        {"id": r["id"], "group": r["speaker_id"], "text": r["transcript"], "row": i}
        for i, r in enumerate(meta)
        if MIN_SECONDS <= r["audio_duration"] <= MAX_SECONDS and usable(r["transcript"])
    ]
    selected = select_balanced(candidates, target)
    audio = pq.read_table(parquet, columns=["audio"]).column("audio")
    sample_dir = f"samples-mls-{lang}"
    out_dir = BENCH_ROOT / "audio" / sample_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    tests = []
    for e in selected:
        wav = out_dir / f"{e['id']}.wav"
        if not wav.exists():
            ffmpeg_to_wav(wav, audio[e["row"]].as_py()["bytes"])
        tests.append(test_entry(f"mls-{lang}", sample_dir, e["id"], e["text"], "mls", str(e["group"])))
    speakers = len({e["group"] for e in selected})
    write_suite(lang, f"clean-speech-mls-{lang}", f"Read Speech: Multilingual LibriSpeech ({spec['name']})",
                f"Audiobook speech from the Multilingual LibriSpeech {spec['name']} test split (CC BY 4.0), "
                f"balanced across {speakers} speakers; lowercase references without punctuation"
                f"{spec.get('mls_note', '')}",
                "clean-speech", tests, f"MLS {lang}")


def curate_common_voice(lang, target):
    spec = LANGUAGES[lang]
    root = DATASETS / f"common-voice-{lang}"
    tsv, durations = root / "test.tsv", root / "clip_durations.tsv"
    tar_paths = sorted(root.glob(f"{lang}_test_*.tar"))
    if not (tsv.exists() and durations.exists() and tar_paths):
        print(f"Common Voice {spec['name']} test files not found under", root)
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
    sample_dir = f"samples-commonvoice-{lang}"
    out_dir = BENCH_ROOT / "audio" / sample_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    wanted = {e["path"]: e for e in selected}
    for tar_path in tar_paths:
        with tarfile.open(tar_path) as tar:
            for member in tar:
                name = Path(member.name).name
                if name in wanted:
                    wav = out_dir / f"{wanted[name]['id']}.wav"
                    if not wav.exists():
                        ffmpeg_to_wav(wav, tar.extractfile(member).read())
    missing = [e["path"] for e in selected if not (out_dir / f"{e['id']}.wav").exists()]
    if missing:
        raise SystemExit(f"Common Voice audio missing from {[p.name for p in tar_paths]}: {missing[:5]}")
    speakers = {}
    tests = []
    for e in selected:
        # Anonymous, stable speaker label instead of the long Common Voice client hash.
        speaker = speakers.setdefault(e["group"], f"cv-{stable_key(e['group'])[:8]}")
        tests.append(test_entry(f"cv-{lang}", sample_dir, e["id"], e["text"], "common-voice", speaker))
    write_suite(lang, f"clean-speech-commonvoice-{lang}", f"Crowd Speech: Common Voice 17 ({spec['name']})",
                f"Crowd-sourced read speech on everyday microphones from the Common Voice 17 {spec['name']} "
                "test split (CC0), speaker-balanced",
                "clean-speech", tests, f"Common Voice {lang}")


def read_pcm(path):
    """Decode any audio to 16 kHz mono float32 via ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"],
        capture_output=True, check=True)
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


def curate_noisy_fleurs(lang, target):
    spec = LANGUAGES[lang]
    clean_suite = BENCH_ROOT / "tests" / f"clean-speech-fleurs-{lang}.json"
    noise_dir = BENCH_ROOT / "audio" / "noise-samples"
    if not clean_suite.exists():
        print("Clean FLEURS suite missing:", clean_suite)
        return
    noises = {n: read_pcm(noise_dir / f"{n}.wav") for n in NOISES}
    clean_tests = json.loads(clean_suite.read_text())["tests"][:target]
    sample_dir = f"samples-noisy-{lang}"
    out_dir = BENCH_ROOT / "audio" / sample_dir
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
            "id": f"noisy-{lang}-{file_id}",
            "audioFile": f"{sample_dir}/{file_id}.wav",
            "groundTruth": t["groundTruth"],
            "tags": ["noisy-environment", noise_type, f"snr-{snr}", "real-speech"],
            # Mixed audio is generated, so the suite counts as synthetic even though the speech is real.
            "source": "custom",
            "metadata": {"noiseType": noise_type, "snrDb": snr},
        })
    write_suite(lang, f"noisy-environment-{lang}", f"Noisy Environment ({spec['name']})",
                f"FLEURS {spec['name']} read speech mixed with office, cafe, keyboard and traffic noise "
                "at a measured 5, 10 or 15 dB SNR",
                "noisy-environment", tests, f"Noisy FLEURS {lang}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument("--language", nargs="+", choices=sorted(LANGUAGES), default=sorted(LANGUAGES))
    args = parser.parse_args()
    for lang in args.language:
        curate_fleurs(lang, args.target)
        curate_mls(lang, args.target)
        curate_common_voice(lang, args.target)
        curate_noisy_fleurs(lang, args.target // 2)
