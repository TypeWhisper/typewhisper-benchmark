# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "cactus-needle==3.2.8",
#   "huggingface_hub",
# ]
# ///
"""Persistent worker for Cactus Compute's Whistle speech model on the Needle CPU engine.

Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "load": "1", "repo": "Cactus-Compute/whistle", "revision": "<sha>"}
  -> {"id": 2, "repo": "...", "revision": "<sha>", "file": "/abs/clip.wav", "language": "de"}
  <- {"id": 2, "text": "...", "durationMs": 12.3}
The weights download at the pinned revision on first use. Needle's anonymous usage counts are
switched off, so nothing leaves the machine after the download.
"""
import json
import os
import sys
import time

os.environ["NEEDLE_TELEMETRY"] = "0"

import needle  # noqa: E402
from huggingface_hub import hf_hub_download  # noqa: E402

models = {}


def model_for(repo, revision):
    key = (repo, revision)
    if key not in models:
        weights = hf_hub_download(repo_id=repo, filename="whistle.cact", revision=revision)
        models[key] = needle.Whistle(weights=weights)
    return models[key]


def handle(req):
    model = model_for(req["repo"], req["revision"])
    if req.get("load"):
        return {"loaded": True}
    start = time.perf_counter()
    out = model.transcribe(req["file"], language=req.get("language") or None)
    return {"text": out.get("text", ""), "durationMs": (time.perf_counter() - start) * 1000}


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
