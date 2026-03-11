#!/bin/bash
set -e

AUDIO_DIR="bench/audio/librispeech"
mkdir -p "$AUDIO_DIR"

echo "Downloading LibriSpeech test-clean subset..."
echo "Source: https://www.openslr.org/12"

# Download the test-clean subset (346MB compressed)
TARBALL="test-clean.tar.gz"
URL="https://www.openslr.org/resources/12/$TARBALL"

if [ ! -f "$AUDIO_DIR/$TARBALL" ]; then
  curl -L -o "$AUDIO_DIR/$TARBALL" "$URL"
fi

echo "Extracting..."
tar -xzf "$AUDIO_DIR/$TARBALL" -C "$AUDIO_DIR" --strip-components=1

echo "Converting FLAC to WAV (16kHz mono)..."
find "$AUDIO_DIR" -name "*.flac" | head -50 | while read f; do
  wav="${f%.flac}.wav"
  if [ ! -f "$wav" ]; then
    ffmpeg -i "$f" -ar 16000 -ac 1 "$wav" -y -loglevel error
  fi
done

echo "Done! Audio files in $AUDIO_DIR"
