#!/bin/bash
# Downloads the audio of the diarization set (bench/diarization/diarization-set.json) into
# bench/audio/datasets/diarization. The references are in the repository.
#
#   ami/<meeting>.<mic>.wav  AMI test split, 16 meetings, the far-field table array (Array1-01)
#                            and the mixed close-talk headsets (Mix-Headset), 16 kHz mono
#   synthetic/<name>.wav     22 VoxPopuli conversations from the diarization-set-v1 release asset,
#                            built by make-diarization-synthetic.py
#
# Run from the repository root. Files that are already there are kept; checksums are checked by
# `npm run bench -- diarization` before it runs.
set -euo pipefail

ROOT="bench/audio/datasets/diarization"
AMI_BASE="https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus"
SET_URL="https://github.com/TypeWhisper/typewhisper-benchmark/releases/download/diarization-set-v1/diarization-synthetic-v1.zip"
MEETINGS="IS1009a IS1009b IS1009c IS1009d ES2004a ES2004b ES2004c ES2004d TS3003a TS3003b TS3003c TS3003d EN2002a EN2002b EN2002c EN2002d"

mkdir -p "$ROOT/ami" "$ROOT/synthetic"
# The AMI mirror serves about 200 KB/s per connection, so the 32 files load six at a time. It
# refuses range requests, so an interrupted file starts over.
for meeting in $MEETINGS; do
  for mic in Array1-01 Mix-Headset; do
    [ -s "$ROOT/ami/$meeting.$mic.wav" ] || echo "$meeting.$mic"
  done
done | xargs -P 6 -I{} sh -c '
  name="{}"; meeting="${name%%.*}"; file="$0/ami/$name.wav"
  curl -fsSL --retry 5 --retry-all-errors -o "$file.part" "$1/$meeting/audio/$name.wav" && mv "$file.part" "$file" && echo "AMI $name"
' "$ROOT" "$AMI_BASE"

missing=0
for meeting in $MEETINGS; do
  for mic in Array1-01 Mix-Headset; do
    [ -s "$ROOT/ami/$meeting.$mic.wav" ] || { echo "Missing: $meeting.$mic.wav" >&2; missing=1; }
  done
done
[ "$missing" = 0 ] || { echo "Some AMI downloads failed; run the script again to resume them." >&2; exit 1; }

if [ "${1:-}" = "--build-synthetic" ]; then
  # Rebuilds the conversations from VoxPopuli instead of downloading them. Decoders differ
  # slightly between ffmpeg builds, so the checksums may not match the published files.
  bench/scripts/make-diarization-synthetic.py "$ROOT/synthetic"
elif [ ! -s "$ROOT/synthetic/de-6sp-480s.wav" ]; then
  echo "Synthetic conversations"
  curl -fsSL --retry 5 -o "$ROOT/synthetic.zip" "$SET_URL"
  unzip -oq "$ROOT/synthetic.zip" -d "$ROOT/synthetic"
  rm "$ROOT/synthetic.zip"
fi
echo "Done: $ROOT"
