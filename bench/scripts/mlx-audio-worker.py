# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "mlx-audio[stt]==0.6.3",  # 0.6.3: Phonon-2.5, Nemotron 3.5 Transcribe; [stt] unpacks Phonon archives
#   "jinja2==3.1.6",  # chat templates of the ibm-granite repos
# ]
# ///
"""Persistent mlx-audio worker for the benchmark (Apple Silicon only).

Runs the MLX models that TypeWhisper's Qwen3, Voxtral, Granite and Canary plugins use, and
candidates. Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "repo": "mlx-community/...", "revision": "<sha>", "file": "/abs/path.wav", "options": {"language": "Russian"}}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
A request with "load" set only downloads and loads the model; one with "unload" drops it again.
Models download from Hugging Face on first use and stay loaded for the process lifetime.
"""
import gc
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


def unload(repo, revision):
    cache.pop((repo, revision), None)
    gc.collect()
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:  # older MLX: the memory is reused by the next model anyway
        pass


def handle(req):
    if req.get("unload"):
        unload(req["repo"], req.get("revision"))
        return {"unloaded": True}
    model = model_for(req["repo"], req.get("revision"))
    if req.get("load"):
        return {"loaded": True}
    kwargs = {"temperature": 0.0, **(req.get("options") or {})}
    start = time.perf_counter()
    out = model.generate(req["file"], **kwargs)
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
