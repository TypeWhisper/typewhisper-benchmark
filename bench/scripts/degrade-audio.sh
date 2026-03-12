#!/usr/bin/env bash
# Degrade clean speech samples to simulate low-quality audio conditions.
# Usage: bash bench/scripts/degrade-audio.sh
#
# Creates degraded versions of clean speech in bench/audio/samples-lowquality-{en,de}/
# Degradation types: low-bitrate, telephone, bluetooth
# Requires: ffmpeg

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
AUDIO_DIR="$BENCH_DIR/audio"

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: 'ffmpeg' not found. Install with: brew install ffmpeg"
  exit 1
fi

python3 -c "
import subprocess, os, sys

audio_dir = '$AUDIO_DIR'

# Source samples for degradation
sources = {
    'en': [
        ('samples-en', 'clean-01'),
        ('samples-en', 'clean-02'),
        ('samples-en', 'clean-03'),
        ('samples-en', 'clean-04'),
        ('samples-en', 'clean-05'),
        ('samples-en', 'en-clean-06'),
        ('samples-en', 'en-clean-07'),
        ('samples-en', 'en-clean-08'),
        ('samples-en', 'en-clean-09'),
        ('samples-en', 'en-clean-10'),
        ('samples-en', 'en-clean-11'),
        ('samples-en', 'en-clean-12'),
        ('samples-en', 'en-clean-13'),
        ('samples-en', 'en-clean-14'),
        ('samples-en', 'en-clean-15'),
        ('samples-hard-en', 'fast-01'),
        ('samples-hard-en', 'tech-01'),
        ('samples-hard-en', 'names-01'),
        ('samples-hard-en', 'numbers-01'),
        ('samples-hard-en', 'en-hard-tech-02'),
    ],
    'de': [
        ('samples-de', 'clean-01'),
        ('samples-de', 'clean-02'),
        ('samples-de', 'clean-03'),
        ('samples-de', 'clean-04'),
        ('samples-de', 'clean-05'),
        ('samples-de', 'de-clean-06'),
        ('samples-de', 'de-clean-07'),
        ('samples-de', 'de-clean-08'),
        ('samples-de', 'de-clean-09'),
        ('samples-de', 'de-clean-10'),
        ('samples-de', 'de-clean-11'),
        ('samples-de', 'de-clean-12'),
        ('samples-de', 'de-clean-13'),
        ('samples-de', 'de-clean-14'),
        ('samples-de', 'de-clean-15'),
        ('samples-hard-de', 'fast-01'),
        ('samples-hard-de', 'tech-01'),
        ('samples-hard-de', 'names-01'),
        ('samples-hard-de', 'numbers-01'),
        ('samples-hard-de', 'de-hard-tech-02'),
    ],
}

# Degradation types with their ffmpeg configs
degradations = [
    {
        'name': 'low-bitrate',
        'label': 'lowbr',
        'cmd': lambda inp, out: [
            'ffmpeg', '-y', '-i', inp,
            '-b:a', '16k', '-ar', '8000', '-ac', '1',
            out, '-loglevel', 'error'
        ],
    },
    {
        'name': 'telephone',
        'label': 'phone',
        'cmd': lambda inp, out: [
            'ffmpeg', '-y', '-i', inp,
            '-af', 'highpass=f=300,lowpass=f=3400',
            '-ar', '8000', '-ac', '1',
            out, '-loglevel', 'error'
        ],
    },
    {
        'name': 'bluetooth',
        'label': 'bt',
        'cmd': lambda inp, out, tmp=None: None,  # handled separately
    },
]

def degrade_bluetooth(inp, out):
    \"\"\"Simulate Bluetooth quality: encode as low-bitrate MP3 then back to WAV.\"\"\"
    tmp_mp3 = out.replace('.wav', '.tmp.mp3')
    subprocess.run([
        'ffmpeg', '-y', '-i', inp,
        '-b:a', '32k', '-ar', '16000', '-ac', '1',
        tmp_mp3, '-loglevel', 'error'
    ], check=True)
    subprocess.run([
        'ffmpeg', '-y', '-i', tmp_mp3,
        '-ar', '16000', '-ac', '1',
        out, '-loglevel', 'error'
    ], check=True)
    os.remove(tmp_mp3)

generated = 0
skipped = 0

for lang, source_list in sources.items():
    out_dir = os.path.join(audio_dir, f'samples-lowquality-{lang}')
    os.makedirs(out_dir, exist_ok=True)

    sample_idx = 0

    # Cycle through degradation types for each source
    # We want ~20 samples per language
    # With 20 sources and 3 degradation types, we pick a rotation
    deg_cycle = ['low-bitrate', 'telephone', 'bluetooth'] * 7  # enough for 20

    for i, (src_dir, src_name) in enumerate(source_list):
        if sample_idx >= 20:
            break

        clean_path = os.path.join(audio_dir, src_dir, f'{src_name}.wav')
        if not os.path.exists(clean_path):
            print(f'  Warning: {clean_path} not found, skipping')
            continue

        sample_idx += 1
        deg_type = deg_cycle[i]

        # Label for filename
        deg_labels = {'low-bitrate': 'lowbr', 'telephone': 'phone', 'bluetooth': 'bt'}
        deg_label = deg_labels[deg_type]

        out_filename = f'{lang}-lowq-{sample_idx:02d}-{deg_label}.wav'
        out_path = os.path.join(out_dir, out_filename)

        if os.path.exists(out_path):
            skipped += 1
            continue

        print(f'Generating: samples-lowquality-{lang}/{out_filename}')

        if deg_type == 'bluetooth':
            degrade_bluetooth(clean_path, out_path)
        elif deg_type == 'low-bitrate':
            subprocess.run([
                'ffmpeg', '-y', '-i', clean_path,
                '-b:a', '16k', '-ar', '8000', '-ac', '1',
                out_path, '-loglevel', 'error'
            ], check=True)
        elif deg_type == 'telephone':
            subprocess.run([
                'ffmpeg', '-y', '-i', clean_path,
                '-af', 'highpass=f=300,lowpass=f=3400',
                '-ar', '8000', '-ac', '1',
                out_path, '-loglevel', 'error'
            ], check=True)

        generated += 1

print()
print(f'Audio degradation complete: {generated} generated, {skipped} skipped (already exist)')
"
