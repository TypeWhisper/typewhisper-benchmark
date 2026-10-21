# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mlx-audio==0.6.1",
# ]
# ///
"""Persistent mlx-audio worker for the benchmark (Apple Silicon only).

Runs the MLX models that TypeWhisper's Qwen3 and Voxtral plugins use. Reads one JSON request
per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "repo": "mlx-community/...", "revision": "<sha>", "file": "/abs/path.wav", "language": "Russian"}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
Models download from Hugging Face on first use and stay loaded for the process lifetime.
"""
import json
import sys
import time

from mlx_audio.stt.utils import load

cache = {}


def model_for(repo, revision):
    key = (repo, revision)
    if key not in cache:
        cache[key] = load(repo, revision=revision)
    return cache[key]


def handle(req):
    model = model_for(req["repo"], req.get("revision"))
    kwargs = {"temperature": 0.0}
    if req.get("language"):
        kwargs["language"] = req["language"]
    start = time.perf_counter()
    out = model.generate(req["file"], **kwargs)
    return {"text": out.text, "durationMs": (time.perf_counter() - start) * 1000}


print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    try:
        res = handle(req)
    except Exception as e:  # report per-request failures without killing the worker
        res = {"error": f"{type(e).__name__}: {e}"}
    res["id"] = req.get("id")
    print(json.dumps(res), flush=True)
