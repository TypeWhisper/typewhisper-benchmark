# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "coremltools==9.0",
#   "numpy==2.4.6",
#   "soundfile==0.14.0",
#   "soxr==1.1.0",
# ]
# ///
"""Persistent Underdog Bark 3.0 / 3.0 Plus worker for the benchmark (Apple Silicon only).

Uses the Core ML runner the model repos ship (coreml/ane/bark_coreml.py at the revision pinned in
download-bark-models.sh): a Core ML encoder on the Neural Engine plus a numpy TDT decoder, with
0.25 s of leading silence added by the runner itself.

Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "model": "3.0", "file": "/abs/path.wav"}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
A request with "load" set only loads and warms up the model.
"""
import importlib.util
import json
import os
import sys
import time

import numpy as np
import soundfile as sf

models_dir = sys.argv[1]
cache = {}


def transcriber_for(model):
    if model not in cache:
        folder = os.path.join(models_dir, model, "coreml", "ane")
        runner = os.path.join(folder, "bark_coreml.py")
        if not os.path.isfile(runner):
            raise FileNotFoundError(f"model folder not found: {folder}")
        spec = importlib.util.spec_from_file_location(f"bark_coreml_{model}", runner)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        transcriber = module.Transcriber(folder, "ane")
        # First predictions specialize both encoder windows (8 s and 15 s).
        transcriber.transcribe(np.zeros(16000 * 4, np.float32))
        transcriber.transcribe(np.zeros(16000 * 12, np.float32))
        cache[model] = transcriber
    return cache[model]


def handle(req):
    transcriber = transcriber_for(req["model"])
    if req.get("load"):
        return {"loaded": True}
    wave, sr = sf.read(req["file"], dtype="float32", always_2d=True)
    wave = wave.mean(axis=1)
    start = time.perf_counter()
    text = transcriber.transcribe(wave, sr)
    return {"text": text, "durationMs": (time.perf_counter() - start) * 1000}


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
