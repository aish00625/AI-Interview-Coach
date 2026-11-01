"""
One-time (idempotent) preparation of the language images this service runs submissions in.

    python -m app.prepare_images                 # inside the executor container
    docker compose --profile executor exec code-executor python -m app.prepare_images

Pulls only what is missing; exits 0 when all four are present, 1 otherwise. Needs outbound access to Docker Hub.
"""
import logging
import sys

from app.services.docker_runner import DockerRunner
from app.services import image_manager


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    results = image_manager.ensure_all(DockerRunner(), wait=True)
    for image, state in results.items():
        print(f"{image}: {state}")
    return 0 if all(s == "ready" for s in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
