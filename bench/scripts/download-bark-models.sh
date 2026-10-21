#!/usr/bin/env bash
# Downloads Underdog Bark 3.0 and 3.0 Plus for the bark providers. Requires uv.
# - Core ML (Neural Engine build) for `bark`: the worker imports coreml/ane/bark_coreml.py.
# - MLX for `bark-mlx`: Bark 3.0's 163 MB model.bark plus bark_mlx.py and bark_loader.py.
# The revisions are pinned to the reviewed runner code as well as the weights.
#
# Each model downloads into a staging folder (which resumes after an interruption) and moves
# into place only when the download finished, so a partial download never looks installed.
set -euo pipefail

MODELS_DIR="${BARK_MODELS_PATH:-models/bark}"
STAGING_DIR="$MODELS_DIR/.staging"
HF="uvx --quiet --from huggingface_hub==2.2.0 hf"

BARK_REPO="ConwayResearch/Underdog-Bark-3.0"
BARK_REVISION="85db2ad18ab41e534a222ee253c29191d77ed919"
BARK_PLUS_REPO="ConwayResearch/Underdog-Bark-3.0-Plus"
BARK_PLUS_REVISION="d4fab2f8b95681e5ad3cfb4e8c5f4e0c009b3deb"

COREML_FILES=(--include "coreml/ane/*" --include "coreml/ane/**" --include "coreml/LICENSE" --include "coreml/NOTICE" --include "NOTICE")
MLX_FILES=(--include "model.bark" --include "bark_loader.py" --include "bark_mlx.py" --include "mlx/*" --include "NOTICE")

# download_variant <folder below MODELS_DIR> <label> <repo> <revision> <hf include args...>
download_variant() {
  local name="$1" label="$2" repo="$3" revision="$4"
  shift 4
  local target="$MODELS_DIR/$name" staging="$STAGING_DIR/${name//\//-}"
  if [ -d "$target" ]; then
    echo "=> Skipping $label (already exists)"
    return
  fi
  echo "=> Downloading $label ..."
  $HF download "$repo" --revision "$revision" --local-dir "$staging" "$@"
  mkdir -p "$(dirname "$target")"
  mv "$staging" "$target"
  echo "=> Done: $label"
}

mkdir -p "$STAGING_DIR"
download_variant "3.0" "Bark 3.0 (Core ML)" "$BARK_REPO" "$BARK_REVISION" "${COREML_FILES[@]}"
download_variant "3.0-plus" "Bark 3.0 Plus (Core ML)" "$BARK_PLUS_REPO" "$BARK_PLUS_REVISION" "${COREML_FILES[@]}"
download_variant "mlx/3.0" "Bark 3.0 (MLX, 163 MB)" "$BARK_REPO" "$BARK_REVISION" "${MLX_FILES[@]}"
rmdir "$STAGING_DIR" 2>/dev/null || true

echo ""
echo "All Bark models downloaded to $MODELS_DIR"
