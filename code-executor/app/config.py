"""
Centralized configuration and safety-limit defaults for the code
executor. Every limit here is a documented, configurable development
default — NOT claimed to be production-perfect. Tune via environment
variables for your own deployment.
"""
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("CODE_EXECUTOR_API_KEY", "")

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

PORT = int(os.getenv("PORT", "9000"))

# ---------------------------------------------------------------------------
# Safety defaults — all overridable via env vars. These are conservative
# development values, chosen to make an infinite loop or a fork-bomb-style
# program fail safely and quickly, not to be tuned for production throughput.
# ---------------------------------------------------------------------------
DEFAULT_TIMEOUT_MS = int(os.getenv("EXECUTION_TIMEOUT_MS", "2000"))          # per test case
MEMORY_LIMIT_MB = int(os.getenv("MEMORY_LIMIT_MB", "256"))                    # per container
CPU_LIMIT_CORES = float(os.getenv("CPU_LIMIT_CORES", "0.5"))                  # fraction of one core
PIDS_LIMIT = int(os.getenv("PIDS_LIMIT", "64"))                              # blocks fork-bombs
MAX_OUTPUT_BYTES = int(os.getenv("MAX_OUTPUT_BYTES", str(64 * 1024)))        # 64 KB per stream
MAX_SOURCE_CODE_BYTES = int(os.getenv("MAX_SOURCE_CODE_BYTES", str(50 * 1024)))  # 50 KB
MAX_TEST_CASES = int(os.getenv("MAX_TEST_CASES", "20"))
WORKSPACE_TMPFS_SIZE = os.getenv("WORKSPACE_TMPFS_SIZE", "64m")               # in-memory /workspace, no host mount
CONTAINER_STARTUP_TIMEOUT_S = int(os.getenv("CONTAINER_STARTUP_TIMEOUT_S", "10"))
