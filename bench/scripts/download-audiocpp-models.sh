#!/usr/bin/env bash
# Downloads the audio.cpp runtime and the Confucius4-R2T2 GGUF that TypeWhisper's Confucius4-R2T2
# plugin pins (R2T2ManagedServer.swift: audio.cpp v0.9.0, Q8_0 from davidxifeng/Confucius4-R2T2-gguf),
# and checks their SHA-256. Run from the repository root: bash bench/scripts/download-audiocpp-models.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# The benchmark reads .env, so read the same setting here unless it is exported.
env_setting() { [ -f "$REPO_ROOT/.env" ] && sed -n "s/^$1=//p" "$REPO_ROOT/.env" | tail -n 1 | tr -d "\"'" || true; }
MODELS_DIR="${AUDIOCPP_MODELS_PATH:-$(env_setting AUDIOCPP_MODELS_PATH)}"
MODELS_DIR="${MODELS_DIR:-models/audiocpp}"
case "$MODELS_DIR" in
  /*) ;;
  *) MODELS_DIR="$REPO_ROOT/$MODELS_DIR" ;;
esac
RUNTIME_ARCHIVE="audio-v0.9.0-bin-macos-arm64-metal.tar.gz"
RUNTIME_SHA256="7cea9219d5f06475011c5d225d71d988cecef633ff7d098ee8a4c7b08583b1b4"
GGUF_URL="https://huggingface.co/davidxifeng/Confucius4-R2T2-gguf/resolve/a8e6b385d7df7eae9519363e07034a209004797a/r2t2-q8_0.gguf"
GGUF_SHA256="19f5ccd624484bcb5d44301437de41560b0ecc40c430e8850dfeefefbe82ccf5"

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
# Install the runtime from the verified archive every time, through a staging folder, so a
# modified or half-extracted runtime is never kept.
fetch "https://github.com/0xShug0/audio.cpp/releases/download/v0.9.0/$RUNTIME_ARCHIVE" "$MODELS_DIR/$RUNTIME_ARCHIVE" "$RUNTIME_SHA256"
rm -rf "$MODELS_DIR/runtime.staging"
mkdir -p "$MODELS_DIR/runtime.staging"
tar -xzf "$MODELS_DIR/$RUNTIME_ARCHIVE" -C "$MODELS_DIR/runtime.staging"
# The release archive ships the server without the executable bit.
chmod +x "$MODELS_DIR/runtime.staging/audiocpp_server"
rm -rf "$MODELS_DIR/runtime"
mv "$MODELS_DIR/runtime.staging" "$MODELS_DIR/runtime"
fetch "$GGUF_URL" "$MODELS_DIR/r2t2-q8_0.gguf" "$GGUF_SHA256"
echo "=> Done: $MODELS_DIR"
