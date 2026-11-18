# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mlx-audio[stt]==0.6.3",  # the release mlx-audio-worker.py runs
#   "huggingface_hub",
# ]
# ///
"""Build the MLX models of Reson8/Rumble-2-Flash that the mlx-audio provider runs, under models/rumble/.

Rumble-2-Flash is Qwen3-ASR 0.6B with a 14-layer decoder and a 99,630-token vocabulary. Its weights use the
transformers 5 layout (model.audio_tower, model.multi_modal_projector, model.language_model), while
mlx-audio's Qwen3-ASR loads the original layout (audio_tower with proj1/proj2, model). This script renames
the weights, moves the convolution kernels to MLX's channel-last order and quantizes the decoder like
mlx-community's Qwen3-ASR builds (group size 64; the audio encoder stays in BF16). The tokenizer, chat
template and configs are copied unchanged; mlx-audio reads the end-of-turn tokens from the tokenizer.

  rumble-2-flash-bf16   the weights as published
  rumble-2-flash-8bit   8-bit decoder
  rumble-2-flash-4bit   4-bit decoder

Usage: uv run --script bench/scripts/convert-rumble-2-flash.py [output directory, default models/rumble]
"""
import json
import shutil
import sys
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
from huggingface_hub import snapshot_download
from mlx.utils import tree_flatten
from mlx_audio.stt.utils import load

REPO = "Reson8/Rumble-2-Flash"
# Keep in sync with RUMBLE_REVISION in src/providers/mlx-audio.ts.
REVISION = "a0c34287229103b706c670d70791683e34379732"
OUT = Path(__file__).resolve().parents[2] / "models" / "rumble"


def rename(key: str, value: mx.array) -> tuple[str, mx.array]:
    if key.startswith("model.audio_tower."):
        key = "audio_tower." + key[len("model.audio_tower.") :]
        if "conv2d" in key and key.endswith("weight") and value.ndim == 4:
            value = value.transpose(0, 2, 3, 1)  # PyTorch (out, in, h, w) -> MLX (out, h, w, in)
        return key, value
    if key.startswith("model.multi_modal_projector.linear_1."):
        return "audio_tower.proj1." + key.rsplit(".", 1)[1], value
    if key.startswith("model.multi_modal_projector.linear_2."):
        return "audio_tower.proj2." + key.rsplit(".", 1)[1], value
    if key.startswith("model.language_model."):
        return "model." + key[len("model.language_model.") :], value
    raise ValueError(f"unexpected weight {key}")


def copy_side_files(src: Path, out: Path) -> None:
    for f in src.iterdir():
        # ctc_head.py and ctc/ belong to the optional CTC head, which mlx-audio does not run.
        if f.is_file() and f.name != "model.safetensors" and f.suffix != ".py":
            shutil.copy(f, out / f.name)


def convert_bf16(src: Path, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    weights = dict(rename(k, v) for k, v in mx.load(str(src / "model.safetensors")).items())
    mx.save_safetensors(str(out / "model.safetensors"), weights, metadata={"format": "mlx"})
    copy_side_files(src, out)
    config = json.loads((out / "config.json").read_text())
    # transformers 5 keeps rope_theta in rope_parameters; mlx-audio reads the old key.
    config["text_config"]["rope_theta"] = config["text_config"]["rope_parameters"]["rope_theta"]
    (out / "config.json").write_text(json.dumps(config, indent=2))


def quantize(src: Path, out: Path, bits: int) -> None:
    model = load(str(src))

    def predicate(path: str, module: nn.Module) -> bool:
        return (
            hasattr(module, "to_quantized")
            and not path.startswith("audio_tower")
            and module.weight.shape[-1] % 64 == 0
        )

    nn.quantize(model, group_size=64, bits=bits, class_predicate=predicate)
    out.mkdir(parents=True, exist_ok=True)
    weights = dict(tree_flatten(model.parameters()))
    mx.save_safetensors(str(out / "model.safetensors"), weights, metadata={"format": "mlx"})
    for f in src.iterdir():
        if f.is_file() and f.name != "model.safetensors":
            shutil.copy(f, out / f.name)
    config = json.loads((out / "config.json").read_text())
    config["quantization"] = {"group_size": 64, "bits": bits}
    (out / "config.json").write_text(json.dumps(config, indent=2))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else OUT
    src = Path(snapshot_download(REPO, revision=REVISION))
    bf16 = out / "rumble-2-flash-bf16"
    convert_bf16(src, bf16)
    print(f"Wrote {bf16}")
    for bits in (8, 4):
        quantized = out / f"rumble-2-flash-{bits}bit"
        quantize(bf16, quantized, bits)
        print(f"Wrote {quantized}")


if __name__ == "__main__":
    main()
