# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "mlx==0.32.2",
#   "mlx-audio==0.5.3",
#   "constriction==0.5.0",
#   "numpy==2.4.6",
#   "soundfile==0.14.0",
#   "soxr==1.1.0",
# ]
# ///
"""Persistent Underdog Bark 3.0 worker on MLX for the benchmark (Apple Silicon only).

Runs model.bark, the 163 MB download the model card's numbers refer to, through the MLX runner its
model repo ships (bark_mlx.py at the revision pinned in download-bark-models.sh), with the package
versions the model card lists. The first load unpacks the weights into an fp16 mlx-audio folder
next to the model (about 6 GB of RAM once) and reuses that folder afterwards. The runner adds
0.25 s of leading silence itself.

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


def runner_for(model):
    if model not in cache:
        folder = os.path.join(models_dir, "mlx", model)
        script = os.path.join(folder, "bark_mlx.py")
        if not os.path.isfile(script):
            raise FileNotFoundError(f"model folder not found: {folder}")
        # bark_mlx.py imports its sibling bark_loader.py. Appending (not prepending) the folder
        # keeps its own mlx/ config folder from shadowing the installed mlx package.
        if folder not in sys.path:
            sys.path.append(folder)
        spec = importlib.util.spec_from_file_location(f"bark_mlx_{model}", script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        loaded = module.load_model(
            os.path.join(folder, "model.bark"), 16, os.path.join(folder, "bark_mlx_fp16")
        )
        # The first calls compile the graph for short and long inputs.
        module.transcribe(loaded, np.zeros(16000 * 4, np.float32))
        module.transcribe(loaded, np.zeros(16000 * 12, np.float32))
        cache[model] = (module, loaded)
    return cache[model]


def handle(req):
    module, loaded = runner_for(req["model"])
    if req.get("load"):
        return {"loaded": True}
    wave, sr = sf.read(req["file"], dtype="float32", always_2d=True)
    wave = wave.mean(axis=1)
    start = time.perf_counter()
    text = module.transcribe(loaded, wave, sr)
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
