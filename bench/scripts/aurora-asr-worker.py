# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.4",
#   "transformers>=4.46",
#   "sentencepiece",
#   "soundfile",
#   "scipy",
#   "numpy",
# ]
# ///
"""Persistent AuroraASR-1M worker for the benchmark.

Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "model": "fp32", "file": "/abs/path.wav"}
  <- {"id": 1, "text": "...", "durationMs": 12.3}
Models are loaded lazily from <models_dir>/<model> and cached for the process lifetime.
"""
import json
import os
import sys
import time
from math import gcd

import numpy as np
import soundfile as sf
import torch
from scipy.signal import resample_poly
from transformers import AutoModelForCTC

TARGET_SR = 16000

models_dir = sys.argv[1]
threads = int(os.environ.get("AURORA_ASR_THREADS") or max(1, (os.cpu_count() or 2) // 2))
torch.set_num_threads(threads)

cache = {}


def load(model):
    if model not in cache:
        path = os.path.join(models_dir, model)
        if not os.path.isdir(path):
            raise FileNotFoundError(f"model directory not found: {path}")
        cache[model] = AutoModelForCTC.from_pretrained(path, trust_remote_code=True).eval()
    return cache[model]


def read_audio(path):
    wav, sr = sf.read(path, dtype="float32", always_2d=True)
    wav = wav.mean(axis=1)
    if sr != TARGET_SR:
        g = gcd(sr, TARGET_SR)
        wav = resample_poly(wav, TARGET_SR // g, sr // g).astype(np.float32)
    return wav


def handle(req):
    model = load(req["model"])
    start = time.perf_counter()
    text = model.transcribe(read_audio(req["file"]))[0]
    return {"text": text, "durationMs": (time.perf_counter() - start) * 1000}


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
