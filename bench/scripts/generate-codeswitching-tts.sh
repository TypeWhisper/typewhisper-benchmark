#!/usr/bin/env bash
# Generate code-switching audio samples using macOS 'say' with multiple voices.
# Reads segment-based entries from tts-manifest.json and stitches segments together.
# Usage: bash bench/scripts/generate-codeswitching-tts.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
MANIFEST="$SCRIPT_DIR/tts-manifest.json"
AUDIO_DIR="$BENCH_DIR/audio/samples-codeswitching"

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

mkdir -p "$AUDIO_DIR"

python3 -c "
import json, subprocess, os, tempfile, glob

manifest_path = '$MANIFEST'
audio_dir = '$AUDIO_DIR'

with open(manifest_path) as f:
    data = json.load(f)

entries = data.get('code-switching', [])
if not entries:
    print('No code-switching entries found in manifest.')
    exit(0)

generated = 0
skipped = 0

for item in entries:
    sample_id = item['id']
    segments = item['segments']
    wav_file = os.path.join(audio_dir, f'{sample_id}.wav')

    if os.path.exists(wav_file):
        skipped += 1
        continue

    print(f'Generating: samples-codeswitching/{sample_id}.wav ({len(segments)} segments)')

    with tempfile.TemporaryDirectory() as tmpdir:
        segment_files = []

        for i, seg in enumerate(segments):
            text = seg['text']
            voice = seg['voice']
            aiff_file = os.path.join(tmpdir, f'seg_{i:03d}.aiff')
            seg_wav = os.path.join(tmpdir, f'seg_{i:03d}.wav')

            # Generate segment with macOS say
            subprocess.run(
                ['say', '-v', voice, '-r', '180', '-o', aiff_file, text],
                check=True
            )

            # Convert to 16kHz mono WAV
            subprocess.run(
                ['ffmpeg', '-y', '-i', aiff_file, '-ar', '16000', '-ac', '1', seg_wav, '-loglevel', 'error'],
                check=True
            )

            segment_files.append(seg_wav)

        if len(segment_files) == 1:
            # Single segment - just copy
            subprocess.run(['cp', segment_files[0], wav_file], check=True)
        else:
            # Concatenate segments with short crossfade
            # Build ffmpeg filter for concatenation with small gaps
            list_file = os.path.join(tmpdir, 'segments.txt')
            with open(list_file, 'w') as lf:
                for sf in segment_files:
                    lf.write(f\"file '{sf}'\n\")

            subprocess.run(
                ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', list_file,
                 '-ar', '16000', '-ac', '1', wav_file, '-loglevel', 'error'],
                check=True
            )

        generated += 1

print()
print(f'Code-switching TTS generation complete: {generated} generated, {skipped} skipped (already exist)')
"
