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

# Map manifest keys to output directories (compatible with Bash 3)
get_out_dir() {
  case "$1" in
    code-dictation-en) echo "samples-code-en" ;;
    code-dictation-de) echo "samples-code-de" ;;
    clean-speech-en-extra) echo "samples-en" ;;
    clean-speech-de-extra) echo "samples-de" ;;
    hard-en-extra) echo "samples-hard-en" ;;
    hard-de-extra) echo "samples-hard-de" ;;
    *) echo "" ;;
  esac
}

# Use python3 to drive the whole generation to avoid bash compatibility issues
python3 -c "
import json, subprocess, os, sys

manifest_path = '$MANIFEST'
audio_dir = '$AUDIO_DIR'

with open(manifest_path) as f:
    data = json.load(f)

dir_map = {
    'code-dictation-en': 'samples-code-en',
    'code-dictation-de': 'samples-code-de',
    'clean-speech-en-extra': 'samples-en',
    'clean-speech-de-extra': 'samples-de',
    'hard-en-extra': 'samples-hard-en',
    'hard-de-extra': 'samples-hard-de',
    'punctuation-formatting-de': 'samples-punct-de',
    'punctuation-formatting-en': 'samples-punct-en',
    'number-formatting-de': 'samples-numfmt-de',
    'number-formatting-en': 'samples-numfmt-en',
}

generated = 0
skipped = 0

for category, entries in data.items():
    out_dir = dir_map.get(category)
    if not out_dir:
        print(f'Warning: No output directory mapping for {category}, skipping.')
        continue

    target_dir = os.path.join(audio_dir, out_dir)
    os.makedirs(target_dir, exist_ok=True)

    for item in entries:
        sample_id = item['id']
        text = item['text']
        voice = item.get('voice', 'Samantha')
        rate = item.get('rate', 180)

        wav_file = os.path.join(target_dir, f'{sample_id}.wav')
        aiff_file = os.path.join(target_dir, f'{sample_id}.aiff')

        if os.path.exists(wav_file):
            skipped += 1
            continue

        print(f'Generating: {out_dir}/{sample_id}.wav (voice={voice}, rate={rate})')

        # Generate AIFF with macOS say
        subprocess.run(
            ['say', '-v', voice, '-r', str(rate), '-o', aiff_file, text],
            check=True
        )

        # Convert to 16kHz mono WAV
        subprocess.run(
            ['ffmpeg', '-y', '-i', aiff_file, '-ar', '16000', '-ac', '1', wav_file, '-loglevel', 'error'],
            check=True
        )

        # Remove intermediate AIFF
        os.remove(aiff_file)
        generated += 1

print()
print(f'TTS generation complete: {generated} generated, {skipped} skipped (already exist)')
"
