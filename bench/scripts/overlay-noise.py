# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy"]
# ///
"""Mix background noise into clean speech for the English and German noisy-environment suites.

Each clip mixes one clean TTS sample with office, cafe, keyboard or traffic noise from
bench/audio/noise-samples. The noise is looped to the clip's length and scaled so that
20 * log10(rms(speech) / rms(noise)) equals the target SNR (5, 10 or 15 dB), the same measured
mixing curate-russian.py uses for the Russian suite. Clip names, sources, noise types and SNRs
match bench/tests/noisy-environment-{en,de}.json.

Usage (from the repository root): uv run bench/scripts/overlay-noise.py [--force]
Existing clips are kept unless --force is given.
"""
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

BENCH_ROOT = Path(__file__).resolve().parent.parent
AUDIO = BENCH_ROOT / "audio"

# Per language: the clean source of each clip, in clip order (en-noisy-01 ... en-noisy-20).
SOURCES = {
    "en": ("samples-en", ["clean-01", "clean-02", "clean-03", "clean-04", "clean-05",
                          "en-clean-06", "en-clean-07", "en-clean-08", "en-clean-09", "en-clean-10"]),
    "de": ("samples-de", ["clean-01", "clean-02", "clean-03", "clean-04", "clean-05",
                          "de-clean-06", "de-clean-07", "de-clean-08", "de-clean-09", "de-clean-10"]),
}
# (noise, SNR in dB) for clips 1-10 and 11-20; both halves reuse the ten sources in order.
MIXES = [
    ("office", 15), ("cafe", 10), ("keyboard", 15), ("traffic", 5), ("office", 10),
    ("cafe", 5), ("keyboard", 10), ("traffic", 10), ("office", 5), ("cafe", 15),
    ("office", 10), ("cafe", 15), ("traffic", 15), ("keyboard", 5), ("office", 5),
    ("cafe", 10), ("traffic", 10), ("keyboard", 15), ("office", 15), ("cafe", 5),
]


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


def main():
    force = "--force" in sys.argv[1:]
    noises = {n: read_pcm(AUDIO / "noise-samples" / f"{n}.wav") for n in {n for n, _ in MIXES}}
    for lang, (source_dir, sources) in SOURCES.items():
        out_dir = AUDIO / f"samples-noisy-{lang}"
        out_dir.mkdir(parents=True, exist_ok=True)
        for i, (noise_type, snr) in enumerate(MIXES):
            out = out_dir / f"{lang}-noisy-{i + 1:02d}.wav"
            if out.exists() and not force:
                continue
            speech = read_pcm(AUDIO / source_dir / f"{sources[i % len(sources)]}.wav")
            noise = np.resize(noises[noise_type], speech.shape)
            noise *= rms(speech) / (rms(noise) * 10 ** (snr / 20))
            write_pcm(out, speech + noise)
            print(f"{out.relative_to(AUDIO)}: {noise_type} at {snr} dB")


if __name__ == "__main__":
    main()
