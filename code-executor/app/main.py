"""
FastAPI entry point.

Run locally with:
    uvicorn app.main:app --reload --port 9000

Requires a working Docker daemon reachable the way `docker.from_env()`
expects (DOCKER_HOST env var, or the default local socket) — see README.md.
"""
import logging
import os
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS
from app.routes import execution
from app.schemas import HealthResponse

if not logging.getLogger().handlers:  # uvicorn only configures its own loggers; make ours visible in `docker logs`
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="AI Interview Coach — Code Executor",
    description=(
        "Executes submitted source code inside ephemeral, locked-down Docker containers. "
        "Never executes code directly on this host — see app/services/docker_runner.py."
    ),
    version="0.1.0",
)

# Defense-in-depth / local /docs access only — real traffic is Node → this
# service, server-to-server, which isn't subject to browser CORS rules.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.include_router(execution.router)


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", service="code-executor")


@app.on_event("startup")
def _prepare_images_in_background():
    """Pull any missing language images without delaying startup. Non-fatal: set EXECUTOR_PREPULL=false to skip."""
    if os.getenv("EXECUTOR_PREPULL", "true").strip().lower() in ("0", "false", "no", "off"):
        return
    from app.services import execution_service, image_manager

    def _run():
        try:
            image_manager.ensure_all(execution_service._runner, wait=True)
        except Exception as exc:
            logging.getLogger("code_executor").error("image preparation failed: %s: %s", type(exc).__name__, str(exc)[:300])

    threading.Thread(target=_run, daemon=True, name="prepull").start()
