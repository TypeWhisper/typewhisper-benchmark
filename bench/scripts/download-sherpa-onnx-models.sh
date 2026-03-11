#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${SHERPA_ONNX_MODELS_PATH:-models/sherpa-onnx}"
HF_BASE="https://huggingface.co"

# Detect download tool
if command -v curl &>/dev/null; then
  fetch() { curl -fSL --progress-bar -o "$1" "$2"; }
elif command -v wget &>/dev/null; then
  fetch() { wget -q --show-progress -O "$1" "$2"; }
else
  echo "ERROR: curl or wget required" && exit 1
fi

download_model() {
  local repo="$1" dir_name="$2"
  shift 2
  local files=("$@")
  local target="$MODELS_DIR/$dir_name"

  if [ -d "$target" ]; then
    echo "=> Skipping $dir_name (already exists)"
    return
  fi

  mkdir -p "$target"
  echo "=> Downloading $dir_name ..."

  for file in "${files[@]}"; do
    echo "   $file"
    fetch "$target/$file" "$HF_BASE/$repo/resolve/main/$file"
  done

  echo "=> Done: $dir_name"
}

mkdir -p "$MODELS_DIR"

# Parakeet TDT 0.6B (~640 MB)
download_model \
  "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
  "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
  encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt

# Canary 180M Flash (~207 MB)
download_model \
  "csukuangfj/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8" \
  "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8" \
  encoder.int8.onnx decoder.int8.onnx tokens.txt

echo ""
echo "All models downloaded to $MODELS_DIR"
