#!/usr/bin/env bash
# Downloads Underdog Bark 3.0 and 3.0 Plus (Core ML, Neural Engine build) for the bark provider.
# The worker imports coreml/ane/bark_coreml.py from these folders, so the revisions are pinned to
# the reviewed runner code as well as the weights. Requires uv.
#
# Each model downloads into a staging folder (which resumes after an interruption) and moves
# into place only when the download finished, so a partial download never looks installed.
set -euo pipefail

MODELS_DIR="${BARK_MODELS_PATH:-models/bark}"
STAGING_DIR="$MODELS_DIR/.staging"
HF="uvx --quiet --from huggingface_hub==2.2.0 hf"

download_variant() {
  local name="$1" repo="$2" revision="$3"
  local target="$MODELS_DIR/$name" staging="$STAGING_DIR/$name"
  if [ -d "$target" ]; then
    echo "=> Skipping Bark $name (already exists)"
    return
  fi
  echo "=> Downloading Bark $name ..."
  $HF download "$repo" --revision "$revision" --local-dir "$staging" \
    --include "coreml/ane/*" --include "coreml/ane/**" --include "coreml/LICENSE" --include "coreml/NOTICE" --include "NOTICE"
  mv "$staging" "$target"
  echo "=> Done: Bark $name"
}

mkdir -p "$STAGING_DIR"
download_variant "3.0" "ConwayResearch/Underdog-Bark-3.0" "85db2ad18ab41e534a222ee253c29191d77ed919"
download_variant "3.0-plus" "ConwayResearch/Underdog-Bark-3.0-Plus" "d4fab2f8b95681e5ad3cfb4e8c5f4e0c009b3deb"
rmdir "$STAGING_DIR" 2>/dev/null || true

echo ""
echo "All Bark models downloaded to $MODELS_DIR"
