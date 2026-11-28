#!/usr/bin/env bash
# Downloads the GigaAM v3 files TypeWhisper's GigaAM plugin uses today (istupakov/gigaam-v3-onnx,
# int8, end-to-end RNN-T) into models/gigaam/v3. GigaAM v4 and Multilingual v2 are exported from
# Sber's checkpoints with bench/scripts/export-gigaam-onnx.py into models/gigaam/v4 and
# models/gigaam/multilingual-v2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/models/gigaam/v3"
REPO="istupakov/gigaam-v3-onnx"
REVISION="322c3b29492673eb7d0b434bfa9dfb8653e34d02"
mkdir -p "$DEST"
for file in v3_e2e_rnnt_encoder.int8.onnx v3_e2e_rnnt_decoder.int8.onnx v3_e2e_rnnt_joint.int8.onnx v3_e2e_rnnt_vocab.txt; do
  if [[ ! -s "$DEST/$file" ]]; then
    echo "Downloading $file"
    curl -fL --retry 3 -o "$DEST/$file.part" "https://huggingface.co/$REPO/resolve/$REVISION/$file"
    mv "$DEST/$file.part" "$DEST/$file"
  fi
done
echo "GigaAM v3 ready in $DEST"
