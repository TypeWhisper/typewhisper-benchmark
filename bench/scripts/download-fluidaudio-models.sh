#!/usr/bin/env bash
# Prepares the community Core ML models the fluidaudio provider loads from local folders.
# The official Parakeet v2, v3 and Ultra models need no script: FluidAudio downloads them into
# the same folder on first use. Requires uv (for the Hugging Face CLI) and Xcode's coremlcompiler.
set -euo pipefail

MODELS_DIR="${FLUIDAUDIO_MODELS_PATH:-models/fluidaudio}"
HF="uvx --quiet --from huggingface_hub==2.2.0 hf"

# Pinned so the weights cannot change underneath the published results.
FLUID_MINI_REPO="FluidVoice-Labs/fluid-speech-mini-coreml"
FLUID_MINI_REVISION="d81c3160dfe5a5e1f8f7267164a07d30617a3a1a"
BARK_PRO_REPO="ConwayResearch/Underdog-Bark-3.0-Pro"
BARK_PRO_REVISION="4b5c51e04aa8d16dda9ecdff71bc29f7360149e4"

mkdir -p "$MODELS_DIR"

target="$MODELS_DIR/fluid-speech-mini"
if [ -d "$target/Encoder.mlmodelc" ]; then
  echo "=> Skipping Fluid Speech Mini (already exists)"
else
  echo "=> Downloading Fluid Speech Mini ..."
  $HF download "$FLUID_MINI_REPO" --revision "$FLUID_MINI_REVISION" --local-dir "$target" \
    --include "*.mlmodelc/*" --include "*.mlmodelc/**" --include "*.json" --include "LICENSE" --include "NOTICE"
  # FluidAudio 0.17.5 loads v3-family joints under this name. This joint has no top-K
  # outputs, which FluidAudio only reads when a language hint is passed (the worker passes none).
  cp -R "$target/JointDecision.mlmodelc" "$target/JointDecisionv3.mlmodelc"
  echo "=> Done: Fluid Speech Mini"
fi

target="$MODELS_DIR/bark-3.0-pro"
if [ -d "$target/Encoder.mlmodelc" ]; then
  echo "=> Skipping Bark 3.0 Pro (already exists)"
else
  echo "=> Downloading Bark 3.0 Pro (~1.2 GB) ..."
  download="$MODELS_DIR/.download/bark-3.0-pro"
  $HF download "$BARK_PRO_REPO" --revision "$BARK_PRO_REVISION" --local-dir "$download" \
    --include "coreml/*" --include "coreml/**" --include "NOTICE"
  mkdir -p "$target"
  for name in Preprocessor Encoder Decoder JointDecisionv3; do
    echo "   compiling $name"
    xcrun coremlcompiler compile "$download/coreml/$name.mlpackage" "$target" >/dev/null
  done
  cp "$download/coreml/parakeet_v3_vocab.json" "$target/parakeet_v3_vocab.json"
  cp "$download/coreml/parakeet_v3_vocab.json" "$target/parakeet_vocab.json"
  cp "$download/coreml/LICENSE" "$download/coreml/NOTICE" "$target/" 2>/dev/null || true
  rm -rf "$download"
  rmdir "$MODELS_DIR/.download" 2>/dev/null || true
  echo "=> Done: Bark 3.0 Pro"
fi

echo ""
echo "Community models ready in $MODELS_DIR"
