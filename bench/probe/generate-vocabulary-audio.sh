#!/usr/bin/env bash
# Renders the clips of probe/vocabulary-en.json with macOS `say` as 16 kHz mono WAV.
set -euo pipefail
PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIO_DIR="$(dirname "$PROBE_DIR")/audio"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
python3 -c '
import json, sys
for t in json.load(open(sys.argv[1]))["tests"]:
    print(t["voice"], t["audioFile"], t["groundTruth"], sep="\t")
' "$PROBE_DIR/vocabulary-en.json" | while IFS=$'\t' read -r voice file text; do
  out="$AUDIO_DIR/$file"
  [ -f "$out" ] && continue
  mkdir -p "$(dirname "$out")"
  say -v "$voice" -o "$TMP/clip.aiff" "$text"
  ffmpeg -loglevel error -y -i "$TMP/clip.aiff" -ar 16000 -ac 1 -c:a pcm_s16le "$out"
done
echo "Clips in $AUDIO_DIR/samples-vocab-en"
