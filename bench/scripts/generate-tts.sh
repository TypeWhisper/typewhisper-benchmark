#!/usr/bin/env bash
# Generate audio samples from TTS manifest using macOS 'say' command.
# Usage: bash bench/scripts/generate-tts.sh
#
# Reads bench/scripts/tts-manifest.json and generates WAV files (16kHz mono)
# for each entry. Requires macOS 'say' and 'ffmpeg'.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$SCRIPT_DIR/tts-manifest.json"
AUDIO_DIR="$BENCH_DIR/audio"

if ! command -v say &>/dev/null; then
  echo "Error: 'say' command not found. This script requires macOS."
  exit 1
fi

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: 'ffmpeg' not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -f "$MANIFEST" ]; then
  echo "Error: Manifest not found at $MANIFEST"
  exit 1
fi

# Map manifest keys to output directories
declare -A DIR_MAP=(
  ["code-dictation-en"]="samples-code-en"
  ["code-dictation-de"]="samples-code-de"
  ["clean-speech-en-extra"]="samples-en"
  ["clean-speech-de-extra"]="samples-de"
  ["hard-en-extra"]="samples-hard-en"
  ["hard-de-extra"]="samples-hard-de"
)

# Extract category keys from manifest
CATEGORIES=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
for key in data:
    print(key)
")

generated=0
skipped=0

for category in $CATEGORIES; do
  out_dir="${DIR_MAP[$category]:-}"
  if [ -z "$out_dir" ]; then
    echo "Warning: No output directory mapping for category '$category', skipping."
    continue
  fi

  target_dir="$AUDIO_DIR/$out_dir"
  mkdir -p "$target_dir"

  # Extract entries for this category
  entries=$(python3 -c "
import json, sys
with open('$MANIFEST') as f:
    data = json.load(f)
items = data.get('$category', [])
for item in items:
    # id|text|voice|rate (rate is optional, default 180)
    voice = item.get('voice', 'Samantha')
    rate = item.get('rate', 180)
    print(f\"{item['id']}|{item['text']}|{voice}|{rate}\")
")

  while IFS='|' read -r id text voice rate; do
    [ -z "$id" ] && continue

    # Derive filename from id (strip language prefix pattern like en-code- or de-clean-)
    filename="${id}.wav"
    aiff_file="$target_dir/${id}.aiff"
    wav_file="$target_dir/$filename"

    if [ -f "$wav_file" ]; then
      skipped=$((skipped + 1))
      continue
    fi

    echo "Generating: $out_dir/$filename (voice=$voice, rate=$rate)"

    # Generate AIFF with macOS say
    say -v "$voice" -r "$rate" -o "$aiff_file" "$text"

    # Convert to 16kHz mono WAV
    ffmpeg -y -i "$aiff_file" -ar 16000 -ac 1 "$wav_file" -loglevel error

    # Remove intermediate AIFF
    rm -f "$aiff_file"

    generated=$((generated + 1))
  done <<< "$entries"
done

echo ""
echo "TTS generation complete: $generated generated, $skipped skipped (already exist)"
