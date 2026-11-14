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
  # REVISION pins a commit for models whose repos may change; unset means main.
  local revision="${REVISION:-main}"
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
    fetch "$target/$file" "$HF_BASE/$repo/resolve/$revision/$file"
  done

  echo "=> Done: $dir_name"
}

# Models that k2-fsa only publishes as release tarballs
download_release() {
  local dir_name="$1"
  if [ -d "$MODELS_DIR/$dir_name" ]; then
    echo "=> Skipping $dir_name (already exists)"
    return
  fi
  echo "=> Downloading $dir_name ..."
  # Download and extract into a temporary directory first, so an interrupted run does not
  # leave a partial model directory that later runs would skip.
  local tmp
  tmp="$(mktemp -d "$MODELS_DIR/.download.XXXXXX")"
  if fetch "$tmp/model.tar.bz2" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$dir_name.tar.bz2" \
    && tar -xjf "$tmp/model.tar.bz2" -C "$tmp" \
    && [ -d "$tmp/$dir_name" ]; then
    mv "$tmp/$dir_name" "$MODELS_DIR/$dir_name"
    rm -rf "$tmp"
    echo "=> Done: $dir_name"
  else
    rm -rf "$tmp"
    echo "ERROR: failed to download $dir_name" >&2
    return 1
  fi
}

mkdir -p "$MODELS_DIR"

# Parakeet TDT 0.6B (~640 MB)
download_model \
  "csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
  "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
  encoder.int8.onnx decoder.int8.onnx joiner.int8.onnx tokens.txt

# Fluid Speech Pro, FluidVoice's fine-tune of Parakeet TDT 0.6B v3 (int8, ~810 MB)
REVISION="fa588e9f87f1b9ad0ca2e2d8f7eaf84dc3803581" download_model \
  "FluidVoice-Labs/fluid-speech-pro-onnx" \
  "fluid-speech-pro-onnx-int8" \
  encoder-model.int8.onnx encoder-model.int8.onnx.data decoder.int8.onnx decoder.int8.onnx.data \
  joiner.int8.onnx joiner.int8.onnx.data vocab.txt LICENSE NOTICE
# sherpa-onnx loads graphs from memory, so it cannot find external weight files; fold them into
# each graph (all stay under protobuf's 2 GB limit).
fluid_dir="$MODELS_DIR/fluid-speech-pro-onnx-int8"
for graph in encoder-model decoder joiner; do
  if [ -f "$fluid_dir/$graph.int8.onnx.data" ]; then
    echo "   inlining $graph weights"
    uv run --quiet --no-project --python 3.12 --with onnx==1.18.0 python -I -c '
import sys, onnx
path = sys.argv[1]
onnx.save(onnx.load(path), path + ".tmp", save_as_external_data=False)
' "$fluid_dir/$graph.int8.onnx"
    mv "$fluid_dir/$graph.int8.onnx.tmp" "$fluid_dir/$graph.int8.onnx"
    rm "$fluid_dir/$graph.int8.onnx.data"
  fi
done

# Canary 180M Flash (~207 MB)
download_model \
  "csukuangfj/sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8" \
  "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8" \
  encoder.int8.onnx decoder.int8.onnx tokens.txt

# GigaAM v3, Russian (~165 MB each): CTC and RNN-T, each with and without punctuation
for variant in nemo-ctc nemo-ctc-punct nemo-transducer nemo-transducer-punct; do
  download_release "sherpa-onnx-$variant-giga-am-v3-russian-2025-12-16"
done

echo ""
echo "All models downloaded to $MODELS_DIR"
