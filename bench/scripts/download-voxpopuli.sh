#!/usr/bin/env bash
# Download curated VoxPopuli candidate clips for DE/EN and prepare manifests
# for bench/scripts/curate-voxpopuli.ts.
#
# Requirements:
# - python3
# - ffmpeg
# - Python packages: datasets, soundfile, numpy
#
# Usage:
#   bash bench/scripts/download-voxpopuli.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
DATASETS_DIR="$BENCH_DIR/audio/datasets"
export DATASETS_DIR

if ! command -v python3 &>/dev/null; then
  echo "Error: python3 not found."
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

python3 - <<'PY'
import importlib.util
import json
import os
import sys
from pathlib import Path

required = ["datasets", "soundfile", "numpy"]
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
    print("Error: missing Python packages:", ", ".join(missing))
    print("Install with: python3 -m pip install datasets soundfile numpy")
    sys.exit(1)

from datasets import Audio, load_dataset
import soundfile as sf

root = Path(os.environ["DATASETS_DIR"])
langs = ["de", "en"]
target_candidates = 80

for lang in langs:
    out_dir = root / f"voxpopuli-{lang}"
    raw_dir = out_dir / "raw"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.ndjson"

    print(f"Preparing VoxPopuli candidates for {lang} ...")

    candidates = []
    seen_ids = set()

    for split in ["train", "validation", "test"]:
      dataset = load_dataset("facebook/voxpopuli", lang, split=split, streaming=True)
      dataset = dataset.cast_column("audio", Audio(sampling_rate=16000))

      for example in dataset:
          sample_id = str(example.get("id") or f"{split}-{len(candidates):05d}")
          if sample_id in seen_ids:
              continue

          text = (example.get("normalized_text") or example.get("raw_text") or "").strip()
          if not text:
              continue

          duration = float(example.get("duration", 0) or 0)
          if duration < 30 or duration > 90:
              continue

          words = len(text.split())
          if words < 20 or words > 140:
              continue

          speaker_id = str(example.get("speaker_id") or "")
          if not speaker_id:
              continue

          audio = example.get("audio")
          if not audio or "array" not in audio:
              continue

          raw_path = raw_dir / f"{sample_id}.wav"
          if not raw_path.exists():
              sf.write(raw_path, audio["array"], audio["sampling_rate"])

          seen_ids.add(sample_id)
          candidates.append(
              {
                  "id": sample_id,
                  "sourcePath": str(raw_path.relative_to(root.parent.parent)),
                  "groundTruth": text,
                  "speakerId": speaker_id,
                  "durationSeconds": duration,
                  "split": split,
              }
          )

          if len(candidates) >= target_candidates:
              break

      if len(candidates) >= target_candidates:
          break

    with manifest_path.open("w", encoding="utf-8") as handle:
        for candidate in candidates:
            handle.write(json.dumps(candidate, ensure_ascii=True) + "\n")

    print(f"  wrote {len(candidates)} candidates to {manifest_path}")

print()
print("Run next:")
print("  npx --workspace=bench tsx bench/scripts/curate-voxpopuli.ts")
print("  npx --workspace=bench tsx bench/scripts/generate-suites.ts")
PY
