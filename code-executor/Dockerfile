# The executor SERVICE's own image — distinct from the per-language
# execution images in app/utils/language_config.py, which are pulled and
# run as isolated, locked-down containers for each submission.
FROM python:3.12.3-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 9000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9000"]

# ---------------------------------------------------------------------------
# IMPORTANT — this service needs to talk to a Docker daemon to create the
# per-submission execution containers. That means this container needs
# either:
#   (a) the host's Docker socket mounted in  (development-only —
#       -v /var/run/docker.sock:/var/run/docker.sock), or
#   (b) a sibling "Docker-in-Docker" daemon it can reach over TCP/TLS
#       (production-appropriate, but requires its own hardening).
#
# Mounting the Docker socket gives this container effective root access to
# the host. That is a deliberate, documented trade-off for local
# development ONLY — see README.md's "Production hardening" section for
# what a real deployment needs instead (a dedicated Docker-in-Docker host,
# gVisor/Kata/Firecracker-style stronger isolation, no socket mount).
# This Dockerfile does NOT mount the socket itself; that is done by
# whoever runs this container (e.g. docker-compose.yml in a later phase),
# and must never be done for anything reachable from the browser.
# ---------------------------------------------------------------------------
