"""Export a GigaAM RNN-T checkpoint (v4_rnnt or multilingual_v2_rnnt) to int8 ONNX.

Adapted from Don Yin's export script (MIT) for TypeWhisper/typewhisper-mac#2052, published with
huggingface.co/DonYin/gigaam-multilingual-v2-onnx. The only change is the model name argument.

  uv venv -p 3.12 /tmp/gigaam-export && VIRTUAL_ENV=/tmp/gigaam-export uv pip install \
      "gigaam[torch] @ git+https://github.com/salute-developers/GigaAM@e9bbf2e773eedd217c6f0d3b89b9728c41332b7d" \
      onnxscript sentencepiece onnxruntime
  /tmp/gigaam-export/bin/python bench/scripts/export-gigaam-onnx.py multilingual_v2_rnnt models/gigaam/multilingual-v2
  /tmp/gigaam-export/bin/python bench/scripts/export-gigaam-onnx.py v4_rnnt models/gigaam/v4

gigaam downloads the official checkpoint from Sber's CDN. The int8 encoder quantizes matrix
multiplications only (the CPU provider has no int8 convolution). The advance graph runs the
greedy RNN-T loop; it keeps its original `tokens` output and adds matching `token_frames`.
"""
import ctypes
import os
import sys
import tempfile
from copy import deepcopy
from pathlib import Path

import gigaam
import numpy as np
import onnx
import onnxruntime as rt
import sentencepiece
from onnxruntime.quantization import QuantType, quantize_dynamic

MODEL = sys.argv[1] if len(sys.argv) > 2 else "multilingual_v2_rnnt"


def add_token_frames(source, destination):
    """Expose the frames at which the four unrolled RNNTAdvance steps actually emitted.

    A step searches an eight-frame window. On emission the frame is position + delta,
    *before* the optional forced advance at the per-frame symbol limit. A step with no
    emission skips eight frames. Neither the token index nor the step index is a clock.
    """
    model = onnx.load(source)
    graph = model.graph
    loop, = (n for n in graph.node if n.op_type == "Loop")
    body, = (a.g for a in loop.attribute if a.name == "body")
    nodes = {out: n for n in body.node for out in n.output}
    scatter = nodes[body.output[1].name]
    stack = nodes[nodes[scatter.input[2]].input[0]]
    assert scatter.op_type == "ScatterElements" and stack.op_type == "Concat" and len(stack.input) == 4
    frames = []
    for i, slot in enumerate(stack.input):
        unsqueeze = nodes[slot]
        token = nodes[unsqueeze.input[0]]
        # Trace the very delta used to gather this symbol back to its position + delta.
        assert unsqueeze.op_type == "Unsqueeze" and token.op_type == "Where"
        gather = nodes[nodes[token.input[1]].input[0]]
        assert gather.op_type == "GatherElements"
        delta = nodes[gather.input[1]].input[0]
        frame, = (n.output[0] for n in body.node if n.op_type == "Add" and n.input[1] == delta)
        emitted = f"emission_frame_{i}"
        body.node.append(onnx.helper.make_node("Where", [token.input[0], frame, token.input[2]], [emitted]))
        frames.append(emitted + "_slot")
        body.node.append(onnx.helper.make_node("Unsqueeze", [emitted, *unsqueeze.input[1:]], [frames[-1]]))

    def renamed(value, name):
        copy = deepcopy(value)
        copy.name = name
        return copy

    # Use the same -1 initialization and scatter indices as tokens, including unused padding.
    loop.input.append(loop.input[2])
    body.input.append(renamed(body.input[2], "frames_in"))
    body.node.append(onnx.helper.make_node("Concat", frames, ["frame_updates"], axis=0))
    frame_scatter = deepcopy(scatter)
    frame_scatter.name = "WriteTokenFrames"
    frame_scatter.input[:] = ["frames_in", scatter.input[1], "frame_updates"]
    frame_scatter.output[:] = ["frames_out"]
    body.node.append(frame_scatter)
    body.output.append(renamed(body.output[1], "frames_out"))
    loop.output.append("token_frames")
    graph.output.append(renamed(graph.output[0], "token_frames"))
    onnx.checker.check_model(model)
    onnx.save(model, destination)

    # Exercise the original plugin contract as well as blank and repeated-frame semantics.
    old, new = (rt.InferenceSession(str(p), providers=["CPUExecutionProvider"]) for p in (source, destination))
    rng = np.random.default_rng(2711)
    for length in (1, 39):
        heads, _, _, width = new.get_inputs()[0].shape
        feed = {"projected": rng.standard_normal((heads, 1, length, width), dtype=np.float32),
                "lengths": np.array([length], dtype=np.int64)}
        tokens, positions = new.run(["tokens", "token_frames"], feed)
        np.testing.assert_array_equal(tokens, old.run(["tokens"], feed)[0])
        assert positions.shape == tokens.shape and np.array_equal(tokens == -1, positions == -1)
        # An independent frame oracle: truncating the ORIGINAL graph's input length must
        # emit exactly the labels assigned to that frame prefix, on both heads.
        for cut in range(1, length + 1):
            feed["lengths"][0] = cut
            prefix, = old.run(["tokens"], feed)
            for head in range(heads):
                before = (positions[:, head, 0] >= 0) & (positions[:, head, 0] < cut)
                row = prefix[:, head, 0]
                np.testing.assert_array_equal(tokens[before, head, 0], row[row >= 0])


def publish(staged, out):
    if not out.exists():
        staged.rename(out)
        return
    # rename(2) cannot replace a populated directory. Darwin's exchange is one atomic rename;
    # the previous complete snapshot now lives at staged and is cleaned up by its owner.
    swap = ctypes.CDLL(None, use_errno=True).renamex_np
    if swap(os.fsencode(staged), os.fsencode(out), 0x00000002) != 0:  # RENAME_SWAP
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), str(out))


def main(out):
    out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out.parent) as tmp:
        work = Path(tmp)
        export, staged = work / "export", work / "complete"
        export.mkdir()
        staged.mkdir()
        gigaam.load_model(MODEL, device="cpu").to_onnx(str(export))
        quantize_dynamic(export / f"{MODEL}_encoder.onnx", staged / f"{MODEL}_encoder.int8.onnx",
                         weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
        add_token_frames(export / f"{MODEL}_advance.onnx", staged / f"{MODEL}_advance.onnx")
        pieces = sentencepiece.SentencePieceProcessor(model_file=str(export / f"{MODEL}_e2e_tokenizer.model"))
        size = pieces.get_piece_size()
        lines = [f"{pieces.id_to_piece(i)} {i}" for i in range(size)] + [f"<blk> {size}"]
        (staged / f"{MODEL}_e2e_vocab.txt").write_text("\n".join(lines) + "\n")
        rt.InferenceSession(str(staged / f"{MODEL}_encoder.int8.onnx"), providers=["CPUExecutionProvider"])
        publish(staged, out)
    print(*sorted(p.name for p in out.iterdir()), sep="\n")


if __name__ == "__main__":
    main(Path(sys.argv[-1]))
