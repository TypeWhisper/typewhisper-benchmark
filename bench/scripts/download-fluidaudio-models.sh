#!/usr/bin/env bash
# Prepares the community Core ML models the fluidaudio provider loads from local folders.
# The official Parakeet v2, v3 and Ultra models need no script: FluidAudio downloads them into
# the same folder on first use. Requires uv (for the Hugging Face CLI) and Xcode's coremlcompiler.
#
# Each model is assembled in a staging folder and moved into place only when every step
# succeeded, so an interrupted run never leaves a folder that looks installed.
set -euo pipefail

MODELS_DIR="${FLUIDAUDIO_MODELS_PATH:-models/fluidaudio}"
STAGING_DIR="$MODELS_DIR/.staging"
HF="uvx --quiet --from huggingface_hub==2.2.0 hf"

# Pinned so the weights cannot change underneath the published results.
FLUID_MINI_REPO="FluidVoice-Labs/fluid-speech-mini-coreml"
FLUID_MINI_REVISION="d81c3160dfe5a5e1f8f7267164a07d30617a3a1a"
FLUID_PRO_REPO="FluidVoice-Labs/fluid-speech-pro-coreml"
FLUID_PRO_REVISION="3b9d38a93d606f84011e5a0a669b7ea146375a22"
BARK_PRO_REPO="ConwayResearch/Underdog-Bark-3.0-Pro"
BARK_PRO_REVISION="4b5c51e04aa8d16dda9ecdff71bc29f7360149e4"
# Same repo, revision and variant as TypeWhisper's NemotronStreaming (ParakeetPlugin.swift).
NEMOTRON_REPO="FluidInference/Nemotron-3.5-ASR-Streaming-Multilingual-0.6b-CoreML"
NEMOTRON_REVISION="1a41b75758b0337ff67db7d5408280aaaf23074e"
NEMOTRON_VARIANT="multilingual/1120ms"
# primeline's German fine-tune of Parakeet v3, exported with FluidInference's mobius tooling and
# checked against NeMo inference on the unconverted checkpoint (see the repo's model card).
PRIMELINE_REPO="ValentinWeyer/parakeet-primeline-de-coreml"
PRIMELINE_REVISION="d912a28d658a93c7eba99760d52a462f1bd3810a"
# Mediform's German medical fine-tune of Parakeet v3 (Mediform/parakeet-medical-de, Apache 2.0),
# exported with mobius for FluidAudio as one zip.
MEDICAL_DE_REPO="hohmannc1/parakeet-medical-de-coreml"
MEDICAL_DE_REVISION="1fd6b396b51a46a1315249ab545c965cac15c11f"
MEDICAL_DE_ZIP="parakeet-medical-de-coreml-fp16.zip"
MEDICAL_DE_SHA256="131e79dcd57e40b9b149e0e6621c1c9fadb815f1df1d10ad1f24c675f2008210"

mkdir -p "$STAGING_DIR"

target="$MODELS_DIR/fluid-speech-mini"
if [ -d "$target" ]; then
  echo "=> Skipping Fluid Speech Mini (already exists)"
else
  echo "=> Downloading Fluid Speech Mini ..."
  download="$STAGING_DIR/fluid-speech-mini.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/fluid-speech-mini"
  $HF download "$FLUID_MINI_REPO" --revision "$FLUID_MINI_REVISION" --local-dir "$download" \
    --include "*.mlmodelc/*" --include "*.mlmodelc/**" --include "*.json" --include "LICENSE" --include "NOTICE"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -R "$download"/*.mlmodelc "$download"/*.json "$download/LICENSE" "$download/NOTICE" "$staging/"
  # FluidAudio 0.17.5 loads v3-family joints under this name. This joint has no top-K
  # outputs, which FluidAudio only reads when a language hint is passed (the worker passes none).
  cp -R "$staging/JointDecision.mlmodelc" "$staging/JointDecisionv3.mlmodelc"
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: Fluid Speech Mini"
fi

target="$MODELS_DIR/fluid-speech-pro"
if [ -d "$target" ]; then
  echo "=> Skipping Fluid Speech Pro (already exists)"
else
  echo "=> Downloading Fluid Speech Pro (~650 MB) ..."
  download="$STAGING_DIR/fluid-speech-pro.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/fluid-speech-pro"
  $HF download "$FLUID_PRO_REPO" --revision "$FLUID_PRO_REVISION" --local-dir "$download" \
    --include "*.mlmodelc/*" --include "*.mlmodelc/**" --include "*.json" --include "LICENSE" --include "NOTICE"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -R "$download"/*.mlmodelc "$download"/*.json "$download/LICENSE" "$download/NOTICE" "$staging/"
  # Same Core ML contract as Fluid Speech Mini (FluidVoice's FluidAudio fork treats both alike).
  cp -R "$staging/JointDecision.mlmodelc" "$staging/JointDecisionv3.mlmodelc"
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: Fluid Speech Pro"
fi

target="$MODELS_DIR/bark-3.0-pro"
if [ -d "$target" ]; then
  echo "=> Skipping Bark 3.0 Pro (already exists)"
else
  echo "=> Downloading Bark 3.0 Pro (~1.2 GB) ..."
  download="$STAGING_DIR/bark-3.0-pro.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/bark-3.0-pro"
  $HF download "$BARK_PRO_REPO" --revision "$BARK_PRO_REVISION" --local-dir "$download" \
    --include "coreml/*" --include "coreml/**" --include "NOTICE"
  rm -rf "$staging"
  mkdir -p "$staging"
  for name in Preprocessor Encoder Decoder JointDecisionv3; do
    echo "   compiling $name"
    xcrun coremlcompiler compile "$download/coreml/$name.mlpackage" "$staging" >/dev/null
  done
  cp "$download/coreml/parakeet_v3_vocab.json" "$staging/parakeet_v3_vocab.json"
  cp "$download/coreml/parakeet_v3_vocab.json" "$staging/parakeet_vocab.json"
  cp "$download/coreml/LICENSE" "$download/coreml/NOTICE" "$staging/"
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: Bark 3.0 Pro"
fi

target="$MODELS_DIR/nemotron-3.5-asr-streaming-1120ms"
if [ -d "$target" ]; then
  echo "=> Skipping Nemotron 3.5 ASR Streaming (already exists)"
else
  echo "=> Downloading Nemotron 3.5 ASR Streaming, 1120 ms (~630 MB) ..."
  download="$STAGING_DIR/nemotron.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/nemotron-3.5-asr-streaming-1120ms"
  $HF download "$NEMOTRON_REPO" --revision "$NEMOTRON_REVISION" --local-dir "$download" \
    --include "$NEMOTRON_VARIANT/*" --include "$NEMOTRON_VARIANT/**" --include "README.md"
  rm -rf "$staging"
  mkdir -p "$staging"
  # The models TypeWhisper loads; FluidAudio's mel front end replaced the preprocessor model.
  for name in encoder.mlmodelc decoder.mlmodelc joint.mlmodelc decoder_joint.mlmodelc metadata.json tokenizer.json; do
    cp -R "$download/$NEMOTRON_VARIANT/$name" "$staging/"
  done
  cp "$download/README.md" "$staging/"   # carries the OpenMDW-1.1 license header
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: Nemotron 3.5 ASR Streaming"
fi

target="$MODELS_DIR/parakeet-primeline"
if [ -d "$target" ]; then
  echo "=> Skipping primeline Parakeet (already exists)"
else
  echo "=> Downloading primeline Parakeet, Core ML (~1.2 GB) ..."
  download="$STAGING_DIR/parakeet-primeline.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/parakeet-primeline"
  $HF download "$PRIMELINE_REPO" --revision "$PRIMELINE_REVISION" --local-dir "$download" \
    --include "*.mlmodelc/*" --include "*.mlmodelc/**" --include "*.json" --include "README.md"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp -R "$download"/*.mlmodelc "$download"/*.json "$download/README.md" "$staging/"
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: primeline Parakeet"
fi

target="$MODELS_DIR/parakeet-medical-de"
if [ -d "$target" ]; then
  echo "=> Skipping Parakeet Medical DE (already exists)"
else
  echo "=> Downloading Parakeet Medical DE, Core ML (~1.1 GB) ..."
  download="$STAGING_DIR/parakeet-medical-de.download"   # kept between runs so downloads resume
  staging="$STAGING_DIR/parakeet-medical-de"
  $HF download "$MEDICAL_DE_REPO" --revision "$MEDICAL_DE_REVISION" --local-dir "$download" \
    --include "$MEDICAL_DE_ZIP" --include "README.md"
  echo "$MEDICAL_DE_SHA256  $download/$MEDICAL_DE_ZIP" | shasum -a 256 -c --status \
    || { echo "checksum mismatch: $MEDICAL_DE_ZIP" >&2; exit 1; }
  rm -rf "$staging"
  mkdir -p "$staging"
  ditto -x -k "$download/$MEDICAL_DE_ZIP" "$staging"
  # The zip may wrap its files in one folder; FluidAudio expects them at the top level.
  if [ ! -d "$staging/Encoder.mlmodelc" ]; then
    inner=$(dirname "$(find "$staging" -maxdepth 3 -type d -name Encoder.mlmodelc | head -n 1)")
    [ -n "$inner" ] && [ "$inner" != "." ] || { echo "no Encoder.mlmodelc in $MEDICAL_DE_ZIP" >&2; exit 1; }
    mv "$inner" "$STAGING_DIR/parakeet-medical-de.inner"
    rm -rf "$staging"
    mv "$STAGING_DIR/parakeet-medical-de.inner" "$staging"
  fi
  rm -rf "$staging/__MACOSX"
  cp "$download/README.md" "$staging/"
  mv "$staging" "$target"
  rm -rf "$download"
  echo "=> Done: Parakeet Medical DE"
fi

rmdir "$STAGING_DIR" 2>/dev/null || true
echo ""
echo "Community models ready in $MODELS_DIR"
