# /// script
# requires-python = ">=3.10"
# dependencies = [
#   # SOV-Transcribe-1 support landed on mlx-audio main after the 0.6.5 release; pinned to that commit.
#   "mlx-audio[stt] @ git+https://github.com/Blaizzy/mlx-audio@19c519a3ed4581e82217fef8c492deb3e3b9dead",
#   "jinja2==3.1.6",
# ]
# ///
"""The mlx-audio worker on an unreleased mlx-audio commit, for models the pinned release lacks.

Same protocol as mlx-audio-worker.py, which it runs; only the mlx-audio version differs, so the
models on the release keep their environment.
"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).with_name("mlx-audio-worker.py")), run_name="__main__")
