#!/usr/bin/env bash
# Downloads the CrispASR runtime and GGUF files for the candidate models of the `crispasr`
# provider (models no TypeWhisper plugin runs yet), at pinned versions, and checks their SHA-256.
# Run from the repository root: bash bench/scripts/download-crispasr-candidates.sh [model ...]
# Without arguments it fetches every candidate (about 42 GB).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODELS_DIR="${CRISPASR_MODELS_PATH:-models/crispasr}"
case "$MODELS_DIR" in
  /*) ;;
  *) MODELS_DIR="$REPO_ROOT/$MODELS_DIR" ;;
esac
CRISPASR_VERSION="0.8.47"
RUNTIME_SHA256="ee6e30a0cc8ece90b457bca35afba469b388736e85e20d7fd86daf82c7dffbc7"

# model id | Hugging Face repo | revision | file | SHA-256
CANDIDATES="
hojo-asr-multi-v1-f16|cstr/Hojo-ASR-Multi-V1-GGUF|16b7248d5b287613f91b111f028206789031108d|hojo-asr-multi-v1-f16.gguf|93ef528d3d58c6f2a5caba785e9277bf930b522bce3548db7728a3f328b1150f
fun-asr-mlt-nano-f16|cstr/funasr-mlt-nano-GGUF|5ba2e21029b7d88eceb6e4214530eca8e00b9fc6|funasr-mlt-nano-2512-f16.gguf|f390216223b254e54d7f9ea8d412993969ee02920064ea40d117daec7a0c4cd1
canary-qwen-2.5b-q8_0|cstr/canary-qwen-2.5b-GGUF|633d32e7415bb281ea159c60e20dd3ec61fb8ddf|canary-qwen-2.5b-q8_0.gguf|d117d843716b01789561686e44cd1749892a6aedbef7ca5e29368d7d6f50be2d
gemma4-e4b-it-q8_0|cstr/gemma4-e4b-it-GGUF|725806cec4b76f46729311d590ba32a9c4debcab|gemma4-e4b-it-q8_0.gguf|17063a97999058710c6fa0316080e6001e02675e4b92a3338ec410940290b34c
mega-asr-1.7b-f16|cstr/mega-asr-GGUF|1daa8765a251719ae4966f05173e0e9822b40ff8|mega-asr-1.7b-f16.gguf|a5194885801904bf5cc5d41cf53d38666b2e88c5667f10124ae82be5198b8620
granite-speech-4.1-2b-plus-f16|cstr/granite-speech-4.1-2b-plus-GGUF|141758f7f75c11305776f0bf281b4d2da1555f16|granite-speech-4.1-2b-plus-f16.gguf|353246535fde1635729453ea12a5c5c874ba1a727f025cf2dc88094964ababcd
parakeet-tdt_ctc-1.1b|cstr/parakeet-tdt_ctc-1.1b-GGUF|2659aef84d36922cc425e4d56ba1001a5836a143|parakeet-tdt_ctc-1.1b.gguf|5518c35a1260c3e3a15fdd526d76cdd3034f1ed0ae160723941dd42f021c8570
voxtral-mini-3b-2507-q8_0|cstr/voxtral-mini-3b-2507-GGUF|cfe490428a44f70fcf6832a4828987ca29427305|voxtral-mini-3b-2507-q8_0.gguf|730c563d2b718c4612eefb7978a59799f454e4c1a3233298c3fc6c78aea6cda0
parakeet-redux-f16|cstr/parakeet-redux-GGUF|3f288b7fb33caff80f1424bd5ea1cecaf9808209|parakeet-redux-f16.gguf|0b4fe28c72447fd4012ed6072c60887e69b36f6c54bc4c35069cb316acc1c113
"

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

mkdir -p "$MODELS_DIR/candidates"
if [ ! -x "$MODELS_DIR/runtime-$CRISPASR_VERSION/crispasr-macos/crispasr" ]; then
  fetch "https://github.com/CrispStrobe/CrispASR/releases/download/v$CRISPASR_VERSION/crispasr-macos.tar.gz" \
    "$MODELS_DIR/crispasr-macos-$CRISPASR_VERSION.tar.gz" "$RUNTIME_SHA256"
  rm -rf "$MODELS_DIR/runtime-$CRISPASR_VERSION"
  mkdir -p "$MODELS_DIR/runtime-$CRISPASR_VERSION"
  tar -xzf "$MODELS_DIR/crispasr-macos-$CRISPASR_VERSION.tar.gz" -C "$MODELS_DIR/runtime-$CRISPASR_VERSION"
fi

echo "$CANDIDATES" | while IFS='|' read -r id repo revision file sha; do
  [ -n "$id" ] || continue
  if [ "$#" -gt 0 ] && [[ " $* " != *" $id "* ]]; then continue; fi
  fetch "https://huggingface.co/$repo/resolve/$revision/$file" "$MODELS_DIR/candidates/$file" "$sha"
done
echo "=> Done: $MODELS_DIR"
