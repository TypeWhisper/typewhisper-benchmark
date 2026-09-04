#!/usr/bin/env python3
"""Dependency-free TypeWhisper benchmark executor for macOS and Windows."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def discovery_candidates() -> list[Path]:
    configured = os.environ.get("TYPEWHISPER_API_DISCOVERY")
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    if sys.platform == "darwin":
        support = Path.home() / "Library" / "Application Support"
        candidates.extend(
            [
                support / "TypeWhisper" / "api-discovery.json",
                support / "TypeWhisper-Dev" / "api-discovery.json",
            ]
        )
    elif os.name == "nt":
        local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        candidates.extend(
            [
                local / "TypeWhisper-DevUserData" / "api-discovery.json",
                local / "TypeWhisper" / "api-discovery.json",
            ]
        )
    return candidates


def discover_api() -> tuple[str, str | None]:
    configured_url = os.environ.get("TYPEWHISPER_API_URL")
    if configured_url:
        return configured_url.rstrip("/"), os.environ.get("TYPEWHISPER_API_TOKEN")

    for path in discovery_candidates():
        if not path.is_file():
            continue
        discovery = read_json(path)
        port = discovery.get("port")
        if isinstance(port, int) and 1 <= port <= 65535:
            token = discovery.get("token")
            return f"http://127.0.0.1:{port}", token if isinstance(token, str) else None
    return "http://127.0.0.1:8978", os.environ.get("TYPEWHISPER_API_TOKEN")


def request_json(
    base_url: str,
    path: str,
    token: str | None,
    payload: dict[str, Any] | None = None,
    timeout: int = 360,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(base_url + path, data=data)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token.strip()}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            decoded = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TypeWhisper HTTP {error.code}: {body[:500]}") from error
    if not isinstance(decoded, dict):
        raise RuntimeError("TypeWhisper returned a non-object JSON response")
    return decoded


def find_model(models: dict[str, Any], engine: str, model: str) -> dict[str, Any]:
    entries = models.get("models")
    if not isinstance(entries, list):
        raise RuntimeError("TypeWhisper model response has no models array")
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        if entry.get("engine") == engine and (
            entry.get("id") == model or entry.get("full_id") == model
        ):
            return entry
    raise RuntimeError(f"TypeWhisper model is unavailable: {engine}/{model}")


def command_output(command: list[str]) -> str | None:
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


def hardware() -> tuple[str | None, str | None]:
    cpu = platform.processor().strip() or None
    accelerator = None
    if sys.platform == "darwin":
        chip = command_output(["sysctl", "-n", "machdep.cpu.brand_string"])
        cpu = chip or cpu
        accelerator = f"{chip} / Core ML" if chip else "Apple Core ML"
    elif os.name == "nt":
        gpu = command_output(
            [
                "nvidia-smi",
                "--query-gpu=name,driver_version,memory.total",
                "--format=csv,noheader",
            ]
        )
        accelerator = gpu.splitlines()[0] if gpu else None
    return cpu, accelerator


def compact_id(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9._-]+", "-", value.lower()).strip("-")
    return cleaned[:128]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kit", default="run-kit.json")
    parser.add_argument("--output", default="run.bundle.json")
    parser.add_argument("--environment-id", required=True)
    args = parser.parse_args()

    kit_path = Path(args.kit).resolve()
    root = kit_path.parent
    kit = read_json(kit_path)
    if kit.get("schemaVersion") != 1 or kit.get("runnerProtocol") != "typewhisper-http-v1":
        raise RuntimeError("Unsupported run-kit schema or runner protocol")
    kit_content = {key: value for key, value in kit.items() if key != "kitDigest"}
    actual_kit_digest = hashlib.sha256(
        json.dumps(
            kit_content,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    if actual_kit_digest != kit.get("kitDigest"):
        raise RuntimeError("Run-kit content digest mismatch")

    base_url, token = discover_api()
    status_before = request_json(base_url, "/v1/status", token)
    model_entry = find_model(
        request_json(base_url, "/v1/models", token),
        str(kit["execution"]["engine"]),
        str(kit["execution"]["model"]),
    )
    if model_entry.get("status") not in ("ready", "downloaded") and not kit["execution"].get("awaitDownload"):
        raise RuntimeError(f"Target model is not ready: {model_entry.get('status')}")

    timestamp = datetime.now(timezone.utc)
    run_id = compact_id(
        f"{args.environment_id}-{kit['targetId']}-{timestamp.strftime('%Y%m%dT%H%M%SZ')}-{kit['planId'][:8]}"
    )
    results: list[dict[str, Any]] = []
    status_after = status_before

    for task in kit["tasks"]:
        audio = (root / task["audio"]["path"]).resolve()
        if root not in audio.parents or not audio.is_file():
            raise RuntimeError(f"Run-kit audio is missing or outside the kit: {audio}")
        actual_digest = sha256(audio)
        if actual_digest != task["audio"]["sha256"]:
            raise RuntimeError(f"Run-kit audio digest mismatch: {task['caseId']}")

        event: dict[str, Any] = {
            "schemaVersion": 1,
            "runId": run_id,
            "planId": kit["planId"],
            "targetId": kit["targetId"],
            "caseId": task["caseId"],
            "trial": task["trial"],
        }
        payload = {
            "path": str(audio),
            "language": str(task["language"]).split("-")[0].lower(),
            "task": "transcribe",
            "response_format": "verbose_json",
            "apply_corrections": False,
            "normalize_numbers": False,
        }
        if not kit["execution"].get("useSelectedModel"):
            payload["engine"] = kit["execution"]["engine"]
            payload["model"] = kit["execution"]["model"]
        endpoint = "/v1/transcribe/local-file"
        if kit["execution"].get("awaitDownload"):
            endpoint += "?await_download=1"
        started = time.perf_counter()
        try:
            response = request_json(base_url, endpoint, token, payload)
            duration_ms = (time.perf_counter() - started) * 1000
            text = response.get("text")
            if not isinstance(text, str):
                raise RuntimeError("TypeWhisper response contains no text")
            if response.get("engine") != kit["execution"]["engine"]:
                raise RuntimeError(
                    f"TypeWhisper used unexpected engine: {response.get('engine')}"
                )
            response_model = response.get("model")
            if response_model not in (
                kit["execution"]["model"],
                f"plugin:{kit['execution']['engine']}:{kit['execution']['model']}",
                f"plugin:com.typewhisper.{kit['execution']['engine']}:{kit['execution']['model']}",
            ):
                raise RuntimeError(f"TypeWhisper used unexpected model: {response_model}")
            status_after = request_json(base_url, "/v1/status", token)
            acceleration = status_after.get("acceleration")
            event_backend = (
                acceleration.get("active_backend")
                if isinstance(acceleration, dict)
                else None
            )
            required_backend = kit["execution"].get("requiredActiveBackend")
            if required_backend and event_backend != required_backend:
                raise RuntimeError(
                    f"Required backend {required_backend}, active backend is {event_backend or 'not reported'}"
                )
            provider_metadata: dict[str, Any] = {
                "audioSha256": actual_digest,
                "apiVersion": status_before.get("api_version", "unknown"),
                "engine": response.get("engine"),
                "model": response_model,
                "activeBackend": event_backend or "not-reported",
            }
            for source, destination in (
                ("duration", "audioDurationSeconds"),
                ("processing_time", "processingTimeSeconds"),
                ("language", "detectedLanguage"),
            ):
                value = response.get(source)
                if isinstance(value, (str, int, float, bool)):
                    provider_metadata[destination] = value
            event.update(
                {
                    "status": "ok",
                    "transcript": text,
                    "durationMs": round(duration_ms, 3),
                    "providerMetadata": provider_metadata,
                }
            )
        except Exception as error:  # Keep the complete plan append-only.
            event.update(
                {
                    "status": "error",
                    "durationMs": round((time.perf_counter() - started) * 1000, 3),
                    "error": str(error)[:2000],
                }
            )
        results.append(event)
        print(f"{task['caseId']} trial {task['trial']}: {event['status']}", flush=True)

    cpu, physical_accelerator = hardware()
    acceleration = status_after.get("acceleration")
    active_backend = acceleration.get("active_backend") if isinstance(acceleration, dict) else None
    accelerator = physical_accelerator
    if active_backend:
        accelerator = f"{physical_accelerator or 'local'}; active backend={active_backend}"

    environment: dict[str, Any] = {
        "environmentId": compact_id(args.environment_id),
        "os": platform.platform(),
        "architecture": platform.machine() or "unknown",
        "runtimeVersions": {
            "python": platform.python_version(),
            "runnerProtocol": str(kit["runnerProtocol"]),
            "typewhisperApi": str(status_before.get("api_version", "unknown")),
            "typewhisperEngine": str(kit["execution"]["engine"]),
            "typewhisperModel": str(kit["execution"]["model"]),
            "activeBackend": str(active_backend or "not-reported"),
        },
    }
    if cpu:
        environment["cpu"] = cpu
    if accelerator:
        environment["accelerator"] = accelerator

    bundle = {
        "schemaVersion": 1,
        "manifest": {
            "schemaVersion": 1,
            "runId": run_id,
            "planId": kit["planId"],
            "runKitDigest": kit["kitDigest"],
            "createdAt": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "gitCommit": kit["gitCommit"],
            "targetIds": [kit["targetId"]],
            "environment": environment,
        },
        "results": results,
    }
    output = Path(args.output).resolve()
    output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"bundle={output}")
    return 0 if all(result["status"] == "ok" for result in results) else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1)
