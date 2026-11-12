#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyarrow", "fsspec", "aiohttp", "requests"]
# ///
"""Build synthetic multi-speaker conversations for the diarization benchmark.

Concatenates European Parliament speech from VoxPopuli (CC0) into
conversations with a known number of speakers, per language, and writes for
each conversation:

  <name>.wav   16 kHz mono PCM
  <name>.rttm  exact reference turns for DER scoring
  <name>.mp3   optional copy for manual tests in the apps (--mp3-dir)

The speech is close-talk parliament audio without overlap, so the files test
speaker counts, turn changes, and languages, not table acoustics. Taken from
typewhisper-ios (scripts/make-diarization-test-set.py), where the set was
first used. The published files (diarization-set-v1 release asset) come from
the default seed:

  bench/scripts/make-diarization-synthetic.py bench/audio/datasets/diarization/synthetic
"""

import argparse
import pathlib
import random
import subprocess
from collections import defaultdict

import fsspec
import pyarrow.parquet as pq

PARQUET_URL = (
    "https://huggingface.co/datasets/facebook/voxpopuli/resolve/"
    "refs%2Fconvert%2Fparquet/{language}/validation/0000.parquet"
)
SAMPLE_RATE = 16_000
BYTES_PER_SECOND = SAMPLE_RATE * 2

# (speakers, target seconds) per language.
DEFAULT_SPECS = [(2, 45), (3, 60), (3, 240), (4, 300)]
EXTRA_SPECS = {"de": [(6, 480)]}
MIXED = ("de-en", ["de", "de", "en", "en"], 240)


def decode(audio_bytes: bytes) -> bytes:
    """Any audio container to 16 kHz mono s16le PCM."""
    return subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-f", "s16le", "pipe:1"],
        input=audio_bytes, capture_output=True, check=True,
    ).stdout


def load_speakers(language: str) -> dict[str, list[bytes]]:
    """Decoded utterances of 2–20 s per speaker from the first row group."""
    handle = fsspec.filesystem("https").open(PARQUET_URL.format(language=language), block_size=2**22)
    table = pq.ParquetFile(handle).read_row_group(0, columns=["speaker_id", "audio"])
    speakers: dict[str, list[bytes]] = defaultdict(list)
    for speaker, audio in zip(table.column("speaker_id").to_pylist(), table.column("audio").to_pylist()):
        pcm = decode(audio["bytes"])
        if 2 * BYTES_PER_SECOND <= len(pcm) <= 20 * BYTES_PER_SECOND:
            speakers[f"{language}-{speaker}"].append(pcm)
    print(f"{language}: {len(speakers)} speakers")
    return speakers


def silence(seconds: float) -> bytes:
    return bytes(int(seconds * SAMPLE_RATE) * 2)


def compose(pools: list[dict[str, list[bytes]]], speaker_count: int, target_seconds: float,
            rng: random.Random) -> tuple[bytes, list[tuple[str, float, float]]]:
    """Alternating turns of 1–2 utterances between the chosen speakers."""
    chosen: list[str] = []
    for index in range(speaker_count):
        pool = pools[index % len(pools)]
        candidates = sorted(
            (s for s in pool if s not in chosen),
            key=lambda s: sum(map(len, pool[s])), reverse=True,
        )[: speaker_count * 3]
        chosen.append(rng.choice(candidates))
    queues = {
        speaker: rng.sample(pool[speaker], len(pool[speaker]))
        for speaker in chosen for pool in pools if speaker in pool
    }

    audio = bytearray(silence(0.5))
    turns: list[tuple[str, float, float]] = []
    previous = None
    order = chosen[:] + chosen[:]  # every speaker talks at least twice
    rng.shuffle(order)
    while len(audio) < target_seconds * BYTES_PER_SECOND or order:
        options = [s for s in (order or chosen) if s != previous and queues[s]]
        if not options:
            break
        speaker = options[0] if order else rng.choice(options)
        if order:
            order.remove(speaker)
        for _ in range(rng.choice([1, 1, 2])):
            if not queues[speaker]:
                break
            start = len(audio) / BYTES_PER_SECOND
            audio += queues[speaker].pop()
            turns.append((speaker, start, len(audio) / BYTES_PER_SECOND - start))
            audio += silence(0.1)
        audio += silence(rng.uniform(0.25, 0.7))
        previous = speaker
    return bytes(audio), turns


def write(out: pathlib.Path, name: str, pcm: bytes, turns, mp3_dir: pathlib.Path | None) -> None:
    wav = out / f"{name}.wav"
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1",
         "-i", "pipe:0", str(wav)],
        input=pcm, check=True,
    )
    (out / f"{name}.rttm").write_text("".join(
        f"SPEAKER {name} 1 {start:.3f} {duration:.3f} <NA> <NA> {speaker} <NA> <NA>\n"
        for speaker, start, duration in turns
    ))
    if mp3_dir:
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), "-c:a", "libmp3lame", "-b:a", "64k",
             str(mp3_dir / f"{name}.mp3")],
            check=True,
        )
    speakers = len({speaker for speaker, _, _ in turns})
    print(f"{name}: {len(pcm) / BYTES_PER_SECOND:.0f} s, {speakers} speakers, {len(turns)} utterances")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("output", type=pathlib.Path)
    parser.add_argument("--languages", nargs="*", default=["de", "en", "fr", "es", "it"])
    parser.add_argument("--mp3-dir", type=pathlib.Path)
    parser.add_argument("--seed", type=int, default=26)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    if args.mp3_dir:
        args.mp3_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(args.seed)
    pools = {language: load_speakers(language) for language in args.languages}

    for language, pool in pools.items():
        for speakers, seconds in DEFAULT_SPECS + EXTRA_SPECS.get(language, []):
            pcm, turns = compose([pool], speakers, seconds, rng)
            write(args.output, f"{language}-{speakers}sp-{seconds}s", pcm, turns, args.mp3_dir)

    name, languages, seconds = MIXED
    if all(language in pools for language in languages):
        pcm, turns = compose([pools[language] for language in languages], len(languages), seconds, rng)
        write(args.output, f"{name}-{len(languages)}sp-{seconds}s", pcm, turns, args.mp3_dir)


if __name__ == "__main__":
    main()
