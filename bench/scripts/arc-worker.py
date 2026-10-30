# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "arc-transcriber @ git+https://github.com/WhissleAI/arc_transcriber@23f032b17a679830e55aa98c03bfaf5233873fef",
#   "scipy",  # resamples 8 and 48 kHz clips to 16 kHz
# ]
# ///
"""Persistent worker for Whissle's Arc models (Arc Mini, Arc Transcriber) through the arc_audio package.

Reads one JSON request per line from stdin and answers with one JSON line on stdout:
  -> {"id": 1, "load": "1", "backbone": "mini", "revision": "v1.2.0", "device": "cpu"}
  -> {"id": 2, "backbone": "mini", "revision": "v1.2.0", "device": "cpu", "file": "/abs/clip.wav"}
  <- {"id": 2, "text": "...", "durationMs": 12.3}
The model repository is gated: the Hugging Face token must have accepted its licence (HF_TOKEN or the cached login).
Each clip runs through Arc.predict() with the package defaults (domain "unknown", no name list), as `arc-transcribe file.wav`
does; the text is the utterances' plain transcript without the inline tags. Timing excludes loading and decoding the WAV file.
"""
import json
import sys
import time

from arc_audio import Arc, load_audio

models = {}


def model_for(req):
    key = (req["backbone"], req["revision"], req["device"])
    if key not in models:
        models[key] = Arc.from_pretrained(
            "WhissleAI/arc-v1.1",
            backbone=req["backbone"],
            revision=req["revision"],
            device=req["device"],
            threads=req.get("threads"),
        )
    return models[key]


def handle(req):
    arc = model_for(req)
    if req.get("load"):
        return {"loaded": True}
    wav = load_audio(req["file"])
    start = time.perf_counter()
    out = arc.predict(wav)
    elapsed = (time.perf_counter() - start) * 1000
    text = " ".join(u.get("text", "").strip() for u in out.get("transcript") or [])
    return {"text": " ".join(text.split()), "durationMs": elapsed}


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
