"""
Tracks and prepares the per-language execution images (the tags in app/utils/language_config.py).

Why this exists: the Docker SDK's `containers.create()` does NOT pull a missing image (only `containers.run()` does),
so on a machine that has never pulled e.g. `python:3.12.3-slim` every submission failed with ImageNotFound, which the
orchestrator reported as the generic "Execution environment error.". Images are large (gcc is ~1.3 GB), so pulling
inside a request would blow past the Node client's 45 s timeout; they are pulled in a background thread instead, and
requests made meanwhile get a clear "still being prepared" answer.
"""
import logging
import threading
import time
from typing import Dict, Optional

from app.utils.language_config import LANGUAGES

log = logging.getLogger("code_executor.images")

RETRY_AFTER_FAILURE_S = 30

_lock = threading.Lock()
_state: Dict[str, dict] = {}  # image -> {"state": "pulling"|"failed"|"ready", "error": str|None, "at": float}


def _set(image: str, state: str, error: Optional[str] = None):
    _state[image] = {"state": state, "error": error, "at": time.time()}


def state_of(image: str) -> str:
    with _lock:
        return _state.get(image, {}).get("state", "unknown")


def _pull(runner, image: str):
    try:
        log.info("pulling execution image %s", image)
        runner.pull_image(image)
        with _lock:
            _set(image, "ready")
        log.info("execution image %s is ready", image)
    except Exception as exc:  # never let a pull problem crash the worker thread silently
        log.error("pulling execution image %s failed: %s: %s", image, type(exc).__name__, str(exc)[:300])
        with _lock:
            _set(image, "failed", f"{type(exc).__name__}: {str(exc)[:200]}")


def request_pull(runner, image: str) -> str:
    """Starts a background pull unless one is running (or failed within the last RETRY_AFTER_FAILURE_S). Returns the state."""
    with _lock:
        cur = _state.get(image)
        if cur and cur["state"] == "pulling":
            return "pulling"
        if cur and cur["state"] == "failed" and time.time() - cur["at"] < RETRY_AFTER_FAILURE_S:
            return "failed"
        _set(image, "pulling")
    threading.Thread(target=_pull, args=(runner, image), daemon=True, name=f"pull-{image}").start()
    return "pulling"


def ensure_all(runner, wait: bool = False):
    """Pulls every missing configured image. With wait=True, blocks and returns {image: state}."""
    results = {}
    for cfg in LANGUAGES.values():
        image = cfg.image
        if image in results:
            continue
        try:
            if runner.image_exists(image):
                with _lock:
                    _set(image, "ready")
                results[image] = "ready"
                continue
        except Exception as exc:
            log.error("cannot check image %s: %s: %s", image, type(exc).__name__, str(exc)[:300])
            results[image] = "docker_unreachable"
            continue
        if wait:
            with _lock:
                _set(image, "pulling")
            _pull(runner, image)
            results[image] = state_of(image)
        else:
            results[image] = request_pull(runner, image)
    return results


def snapshot(runner) -> dict:
    """Diagnostic view for GET /runtimes: docker reachability plus per-language image presence/state. No secrets."""
    out = {"docker": "unknown", "languages": {}}
    try:
        out["docker"] = "reachable" if runner.ping() else "unreachable"
    except Exception as exc:
        out["docker"] = f"unreachable ({type(exc).__name__})"
        return out
    for name, cfg in LANGUAGES.items():
        try:
            present = runner.image_exists(cfg.image)
        except Exception:
            present = False
        st = "ready" if present else state_of(cfg.image)
        out["languages"][name] = {"image": cfg.image, "state": "ready" if present else ("missing" if st == "unknown" else st)}
    return out
