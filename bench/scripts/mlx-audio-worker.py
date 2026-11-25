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
from pathlib import Path

from mlx_audio.stt.utils import load

cache = {}


def resolve_model_source(repo, revision, subdir=None):
    if not subdir:
        return repo, revision
    from huggingface_hub import snapshot_download

    # Fetch repo-root config.json alongside the subfolder so Hugging Face attributes downloads canonically.
    root = Path(
        snapshot_download(
            repo,
            revision=revision,
            allow_patterns=["config.json", f"{subdir}/*"],
        )
    )
    return str(root / subdir), None


def model_for(repo, revision, subdir=None):
    key = (repo, revision, subdir)
    if key not in cache:
        source, load_revision = resolve_model_source(repo, revision, subdir)
        cache[key] = load(source, revision=load_revision) if load_revision else load(source)
    return cache[key]


def unload(repo, revision, subdir=None):
    cache.pop((repo, revision, subdir), None)
    gc.collect()
    try:
        import mlx.core as mx

        mx.clear_cache()
    except Exception:  # older MLX: the memory is reused by the next model anyway
        pass


def handle(req):
    subdir = req.get("subdir")
    if req.get("unload"):
        unload(req["repo"], req.get("revision"), subdir)
        return {"unloaded": True}
    model = model_for(req["repo"], req.get("revision"), subdir)
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
