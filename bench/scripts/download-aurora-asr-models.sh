#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="${AURORA_ASR_MODELS_PATH:-models/aurora-asr}"
HF_BASE="https://huggingface.co"
REPO="AuroraAI-Research/AuroraASR-1M"
# Pinned so the reviewed custom modeling code cannot change underneath us.
REVISION="cd307b54b4d666d6ad7dc982a7a58a96d6e7f942"

FILES=(
  config.json
  preprocessor_config.json
  configuration_auroraasr.py
  feature_extraction_auroraasr.py
  modeling_auroraasr.py
  bpe256.model
  model.safetensors
)

if command -v curl &>/dev/null; then
  fetch() { curl -fSL --progress-bar -o "$1" "$2"; }
elif command -v wget &>/dev/null; then
  fetch() { wget -q --show-progress -O "$1" "$2"; }
else
  echo "ERROR: curl or wget required" && exit 1
fi

download_variant() {
  local variant="$1" subfolder="$2"
  local target="$MODELS_DIR/$variant"

  if [ -d "$target" ]; then
    echo "=> Skipping $variant (already exists)"
    return
  fi

  mkdir -p "$target"
  echo "=> Downloading AuroraASR-1M $variant ..."

  for file in "${FILES[@]}"; do
    echo "   $file"
    fetch "$target/$file" "$HF_BASE/$REPO/resolve/$REVISION/$subfolder$file"
  done

  echo "=> Done: $variant"
}

mkdir -p "$MODELS_DIR"

# FP32 reference weights (~3.8 MB)
download_variant "fp32" ""

# INT8 weight-only (~1.1 MB)
download_variant "int8" "int8/"

echo ""
echo "All models downloaded to $MODELS_DIR"
