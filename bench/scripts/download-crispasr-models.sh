#!/usr/bin/env bash
# Prepares the crispasr provider: the CrispASR runtime, Silero VAD and the Cohere Transcribe GGUF
# files. Versions, revisions and checksums are the ones TypeWhisper's Cohere Transcribe (Local)
# plugin pins (CohereGGUFAssets.swift and CohereLocalPlugin.swift in typewhisper-mac).
# Pass model names to download only some, e.g. `download-crispasr-models.sh q5_0`.
# The CrispASR 0.8.24 runtime needs Apple silicon and macOS 26 or later.
set -euo pipefail

# Relative paths resolve from the repository root, as the provider does.
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# The benchmark reads .env, so read the same setting here unless it is exported.
env_setting() { [ -f "$REPO_ROOT/.env" ] && sed -n "s/^$1=//p" "$REPO_ROOT/.env" | tail -n 1 | tr -d "\"'" || true; }
MODELS_DIR="${CRISPASR_MODELS_PATH:-$(env_setting CRISPASR_MODELS_PATH)}"
MODELS_DIR="${MODELS_DIR:-models/crispasr}"
case "$MODELS_DIR" in
  /*) ;;
  *) MODELS_DIR="$REPO_ROOT/$MODELS_DIR" ;;
esac
CRISPASR_VERSION="0.8.24"
RUNTIME_SHA256="78397afd5aef2dbd6fa73f8d60800dd4d5725589fb4b04800efd2fb3ff88930c"
VAD_URL="https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin"
VAD_SHA256="2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987"
GGUF_BASE="https://huggingface.co/cstr/cohere-transcribe-03-2026-GGUF/resolve/2242638d5dfecc6f1dbe6c3a8713b97deb2e150f"
gguf_sha256() {
  case "$1" in
    q5_0) echo "a09696c5cc2ed5052bf290c4f2beb35abc69c0d6986842042d92bebb22c9184e" ;;
    q8_0) echo "c8620cb182a7c04e311e6c24e478b94f7ecd7f1b5230bf39fffa8daf94644f51" ;;
    *) echo "unknown quantization $1" >&2; exit 1 ;;
  esac
}

# Downloads into a temporary name and keeps the file only when its checksum matches.
fetch() {
  local url="$1" target="$2" sha="$3"
  if [ -f "$target" ] && echo "$sha  $target" | shasum -a 256 -c --status; then
    echo "=> Skipping $(basename "$target") (verified)"
    return
  fi
  echo "=> Downloading $(basename "$target") ..."
  curl -fL --retry 3 -C - -o "$target.part" "$url"
  echo "$sha  $target.part" | shasum -a 256 -c --status || { echo "checksum mismatch: $target" >&2; rm -f "$target.part"; exit 1; }
  mv "$target.part" "$target"
}

mkdir -p "$MODELS_DIR"
if [ ! -x "$MODELS_DIR/runtime/crispasr-macos/crispasr" ]; then
  fetch "https://github.com/CrispStrobe/CrispASR/releases/download/v$CRISPASR_VERSION/crispasr-macos.tar.gz" \
    "$MODELS_DIR/crispasr-macos.tar.gz" "$RUNTIME_SHA256"
  rm -rf "$MODELS_DIR/runtime.staging"
  mkdir -p "$MODELS_DIR/runtime.staging"
  tar -xzf "$MODELS_DIR/crispasr-macos.tar.gz" -C "$MODELS_DIR/runtime.staging"
  rm -rf "$MODELS_DIR/runtime"
  mv "$MODELS_DIR/runtime.staging" "$MODELS_DIR/runtime"
  rm "$MODELS_DIR/crispasr-macos.tar.gz"
fi
fetch "$VAD_URL" "$MODELS_DIR/ggml-silero-v6.2.0.bin" "$VAD_SHA256"

[ $# -eq 0 ] && set -- q5_0 q8_0
for quant in "$@"; do
  sha="$(gguf_sha256 "$quant")"
  fetch "$GGUF_BASE/cohere-transcribe-$quant.gguf" "$MODELS_DIR/cohere-transcribe-$quant.gguf" "$sha"
done

echo ""
echo "CrispASR models ready in $MODELS_DIR"
