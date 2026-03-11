#!/bin/bash
set -e

AUDIO_DIR="bench/audio/common-voice"
mkdir -p "$AUDIO_DIR"

echo "=== Mozilla Common Voice (German) ==="
echo ""
echo "Common Voice requires manual download due to licensing."
echo ""
echo "Steps:"
echo "1. Visit https://commonvoice.mozilla.org/en/datasets"
echo "2. Select 'German' language"
echo "3. Download the 'validated' clips"
echo "4. Extract to: $AUDIO_DIR"
echo ""
echo "After downloading, run the suite generator:"
echo "  npx --workspace=bench tsx bench/scripts/generate-suites.ts"
echo ""

if [ -d "$AUDIO_DIR/clips" ]; then
  echo "Found clips directory. Converting MP3 to WAV (16kHz mono)..."
  find "$AUDIO_DIR/clips" -name "*.mp3" | head -50 | while read f; do
    wav="${f%.mp3}.wav"
    if [ ! -f "$wav" ]; then
      ffmpeg -i "$f" -ar 16000 -ac 1 "$wav" -y -loglevel error
    fi
  done
  echo "Done!"
else
  echo "No clips found yet. Download first."
fi
