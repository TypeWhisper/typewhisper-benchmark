# /// script
# requires-python = ">=3.10"
# dependencies = [
#   # LFM3-Audio support was merged on 2026-10-27 (Blaizzy/mlx-vlm#2609) and is not released yet.
#   "mlx-vlm @ git+https://github.com/Blaizzy/mlx-vlm@230fc308efb577d87446306bfb8a3e9f1a129558",
# ]
# ///
"""Persistent mlx-vlm worker for the benchmark (Apple Silicon only).

Runs audio language models that mlx-vlm supports, such as Liquid's LFM3-Audio, as speech
recognizers. Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "repo": "LiquidAI/...", "revision": "<sha>", "file": "/abs/path.wav",
      "system": "Perform ASR in English.", "options": {"max_tokens": 1024}}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
A request with "load" set only downloads and loads the model.
Models download from Hugging Face on first use and stay loaded for the process lifetime.
"""
import json
import sys
import time

from mlx_vlm import generate, load
from mlx_vlm.prompt_utils import apply_chat_template

cache = {}


def model_for(repo, revision):
    key = (repo, revision)
    if key not in cache:
        cache[key] = load(repo, revision=revision)
    return cache[key]


def handle(req):
    model, processor = model_for(req["repo"], req.get("revision"))
    if req.get("load"):
        return {"loaded": True}
    conversation = [
        {"role": "system", "content": req["system"]},
        {"role": "user", "content": ""},
    ]
    kwargs = {"temperature": 0.0, **(req.get("options") or {})}
    start = time.perf_counter()
    prompt = apply_chat_template(processor, model.config, conversation, num_audios=1)
    out = generate(model, processor, prompt, audio=[req["file"]], verbose=False, **kwargs)
    return {"text": out.text, "durationMs": (time.perf_counter() - start) * 1000}


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    if not line.strip():
        continue
    req = {}
    try:
        req = json.loads(line)
        res = handle(req)
    except Exception as e:  # report per-request failures without killing the worker
        res = {"error": f"{type(e).__name__}: {e}"}
    res["id"] = req.get("id") if isinstance(req, dict) else None
    print(json.dumps(res), flush=True)
