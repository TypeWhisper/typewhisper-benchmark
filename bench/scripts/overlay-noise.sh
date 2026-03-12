#!/usr/bin/env bash
# Overlay noise onto clean speech samples to create noisy-environment test data.
# Usage: bash bench/scripts/overlay-noise.sh
#
# Requires:
# - Clean speech WAV files in bench/audio/samples-en/ and samples-de/
# - Noise samples in bench/audio/noise-samples/ (office.wav, cafe.wav, keyboard.wav, traffic.wav)
# - ffmpeg
#
# Generates noisy WAV files at various SNR levels in bench/audio/samples-noisy-en/ and samples-noisy-de/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
AUDIO_DIR="$BENCH_DIR/audio"
NOISE_DIR="$AUDIO_DIR/noise-samples"

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: 'ffmpeg' not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -d "$NOISE_DIR" ]; then
  echo "Error: Noise samples directory not found at $NOISE_DIR"
  echo "Please add noise WAV files (office.wav, cafe.wav, keyboard.wav, traffic.wav)"
  echo "Sources: ESC-50 dataset or freesound.org (Creative Commons)"
  exit 1
fi

python3 -c "
import subprocess, os, sys, json, math

audio_dir = '$AUDIO_DIR'
noise_dir = '$NOISE_DIR'

# Configuration: (source_dir, out_dir, samples_to_use)
configs = [
    ('samples-en', 'samples-noisy-en', ['clean-01', 'clean-02', 'clean-03', 'clean-04', 'clean-05',
                                          'en-clean-06', 'en-clean-07', 'en-clean-08', 'en-clean-09', 'en-clean-10']),
    ('samples-de', 'samples-noisy-de', ['clean-01', 'clean-02', 'clean-03', 'clean-04', 'clean-05',
                                          'de-clean-06', 'de-clean-07', 'de-clean-08', 'de-clean-09', 'de-clean-10']),
]

# Noise types and SNR levels to use
noise_files = ['office.wav', 'cafe.wav', 'keyboard.wav', 'traffic.wav']
# We'll assign different noise types and SNR levels to create ~20 samples per language
# snr_db: 5 = hard, 10 = medium, 15 = easy
assignments = [
    # (noise_file, snr_db)
    ('office.wav', 15),
    ('cafe.wav', 10),
    ('keyboard.wav', 15),
    ('traffic.wav', 5),
    ('office.wav', 10),
    ('cafe.wav', 5),
    ('keyboard.wav', 10),
    ('traffic.wav', 10),
    ('office.wav', 5),
    ('cafe.wav', 15),
]

def get_rms(wav_path):
    \"\"\"Get RMS level of a WAV file using ffmpeg.\"\"\"
    result = subprocess.run(
        ['ffmpeg', '-i', wav_path, '-af', 'astats=metadata=1:reset=0', '-f', 'null', '-'],
        capture_output=True, text=True
    )
    # Parse RMS level from stderr
    for line in result.stderr.split('\\n'):
        if 'RMS level dB' in line:
            parts = line.strip().split()
            for i, p in enumerate(parts):
                if p == 'dB':
                    try:
                        return float(parts[i-1])
                    except (ValueError, IndexError):
                        pass
            # Try to find the number after 'RMS level dB:'
            if ':' in line:
                val = line.split(':')[-1].strip().split()[0]
                try:
                    return float(val)
                except ValueError:
                    pass
    return -20.0  # Fallback

def mix_audio(clean_path, noise_path, output_path, target_snr_db):
    \"\"\"Mix clean audio with noise at target SNR using ffmpeg.\"\"\"
    # Simple approach: use loudnorm or volume filter
    # SNR = 20 * log10(signal_rms / noise_rms)
    # noise_gain_db = signal_rms_db - noise_rms_db - target_snr_db

    # Get durations
    result = subprocess.run(
        ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', clean_path],
        capture_output=True, text=True
    )
    clean_duration = float(result.stdout.strip())

    # Mix with ffmpeg: loop noise to match clean duration, apply volume for target SNR
    # We use amix with noise attenuated based on desired SNR
    # A rough approximation: attenuate noise by (SNR - estimated_current_SNR) dB
    # For simplicity, we directly set the noise volume relative to signal
    # At 0dB SNR, noise = signal level. At 10dB, noise is 10dB quieter.
    noise_volume_db = -target_snr_db

    subprocess.run([
        'ffmpeg', '-y',
        '-i', clean_path,
        '-stream_loop', '-1', '-i', noise_path,
        '-filter_complex',
        f'[1:a]atrim=0:{clean_duration},volume={noise_volume_db}dB[n];[0:a][n]amix=inputs=2:duration=first:normalize=0',
        '-ar', '16000', '-ac', '1',
        output_path,
        '-loglevel', 'error'
    ], check=True)

generated = 0
skipped = 0

# Check which noise files exist
available_noise = [f for f in noise_files if os.path.exists(os.path.join(noise_dir, f))]
if not available_noise:
    print('Error: No noise files found in', noise_dir)
    print('Expected files:', noise_files)
    sys.exit(1)

print(f'Available noise files: {available_noise}')

for source_dir, out_dir, samples in configs:
    target_dir = os.path.join(audio_dir, out_dir)
    os.makedirs(target_dir, exist_ok=True)

    lang = 'en' if 'en' in out_dir else 'de'
    sample_idx = 0

    for i, sample_name in enumerate(samples):
        if i >= len(assignments):
            break

        noise_file, snr_db = assignments[i]
        noise_path = os.path.join(noise_dir, noise_file)

        # If the assigned noise file doesn't exist, use the first available one
        if not os.path.exists(noise_path):
            noise_path = os.path.join(noise_dir, available_noise[i % len(available_noise)])
            noise_file = available_noise[i % len(available_noise)]

        clean_path = os.path.join(audio_dir, source_dir, f'{sample_name}.wav')
        if not os.path.exists(clean_path):
            print(f'  Warning: {clean_path} not found, skipping')
            continue

        sample_idx += 1
        noise_label = noise_file.replace('.wav', '')
        out_filename = f'{lang}-noisy-{sample_idx:02d}.wav'
        out_path = os.path.join(target_dir, out_filename)

        if os.path.exists(out_path):
            skipped += 1
            continue

        print(f'Generating: {out_dir}/{out_filename} (noise={noise_label}, SNR={snr_db}dB)')
        mix_audio(clean_path, noise_path, out_path, snr_db)
        generated += 1

    # Generate additional samples with different combinations to reach ~20
    extra_combinations = [
        ('office.wav', 10), ('cafe.wav', 15), ('traffic.wav', 15),
        ('keyboard.wav', 5), ('office.wav', 5), ('cafe.wav', 10),
        ('traffic.wav', 10), ('keyboard.wav', 15), ('office.wav', 15),
        ('cafe.wav', 5),
    ]

    extra_source_samples = samples[:len(extra_combinations)]
    for i, sample_name in enumerate(extra_source_samples):
        noise_file, snr_db = extra_combinations[i]
        noise_path = os.path.join(noise_dir, noise_file)

        if not os.path.exists(noise_path):
            noise_path = os.path.join(noise_dir, available_noise[i % len(available_noise)])
            noise_file = available_noise[i % len(available_noise)]

        clean_path = os.path.join(audio_dir, source_dir, f'{sample_name}.wav')
        if not os.path.exists(clean_path):
            continue

        sample_idx += 1
        noise_label = noise_file.replace('.wav', '')
        out_filename = f'{lang}-noisy-{sample_idx:02d}.wav'
        out_path = os.path.join(target_dir, out_filename)

        if os.path.exists(out_path):
            skipped += 1
            continue

        print(f'Generating: {out_dir}/{out_filename} (noise={noise_label}, SNR={snr_db}dB)')
        mix_audio(clean_path, noise_path, out_path, snr_db)
        generated += 1

print()
print(f'Noise overlay complete: {generated} generated, {skipped} skipped (already exist)')
"
