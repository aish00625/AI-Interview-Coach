"""
Centralized configuration, read once from environment variables.

Kept deliberately simple (no pydantic-settings dependency) — a handful of
os.getenv() calls with sane local-dev defaults is enough for a service
this size, and it's easy for a student to read top to bottom.
"""
import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the ai-service folder

load_dotenv()  # no-op in production if there's no .env file; reads one locally if present

API_KEY = os.getenv("AI_SERVICE_API_KEY", "")

# CORS is defense-in-depth / for hitting the interactive docs (/docs) from
# a browser during development. Normal traffic to this service is
# server-to-server (Node → Python), which browsers' CORS rules don't
# apply to at all — so this setting has no effect on the real request path.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

PORT = int(os.getenv("PORT", "8000"))

# ---------------------------------------------------------------------------
# Speech processing (Phase 10) — see app/services/speech_processor.py
# ---------------------------------------------------------------------------
# faster-whisper model size: tiny/base/small/medium/large-v3. "small" is the default because the smaller
# models make noticeably more transcription mistakes on accented or technical speech; if your machine is slow
# (or the ~460 MB first download is a problem) set SPEECH_MODEL_SIZE=base or tiny. Not measured by this project.
SPEECH_MODEL_SIZE = os.getenv("SPEECH_MODEL_SIZE", "small")
SPEECH_DEVICE = os.getenv("SPEECH_DEVICE", "cpu")
# int8 is the fastest CPU compute type faster-whisper supports; trades a
# little accuracy for speed, appropriate for short spoken answers.
SPEECH_COMPUTE_TYPE = os.getenv("SPEECH_COMPUTE_TYPE", "int8")
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))  # 10 MB
# A gap between two transcribed speech segments longer than this counts as
# a "pause" — see speech_processor.py's documented limitations on why this
# is a coarse, segment-level approximation, not word-level timing.
PAUSE_THRESHOLD_SECONDS = float(os.getenv("PAUSE_THRESHOLD_SECONDS", "0.6"))

# ---------------------------------------------------------------------------
# Computer vision (Phase 11) — see app/services/vision_processor.py
# ---------------------------------------------------------------------------
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(25 * 1024 * 1024)))  # 25 MB
# The clip is recorded while the candidate answers, so it is as long as the answer. Frames are sampled evenly across the
# whole clip (MAX_FRAMES_ANALYZED), so the analysis cost does not grow with the length.
MAX_VIDEO_DURATION_SECONDS = float(os.getenv("MAX_VIDEO_DURATION_SECONDS", "180"))
MAX_FRAMES_ANALYZED = int(os.getenv("MAX_FRAMES_ANALYZED", "45"))  # sampled evenly across the clip, bounds CPU/RAM regardless of clip length
MAX_FRAME_DIMENSION = int(os.getenv("MAX_FRAME_DIMENSION", "480"))  # analysis frames are downscaled to at most this on the longest side
# Reject sources whose longest side exceeds this BEFORE decoding frames —
# MAX_FRAME_DIMENSION only bounds the downscaled analysis frames, not the
# decoder's own work on a huge source. Webcam recordings are typically <= 1280x720.
MAX_SOURCE_DIMENSION = int(os.getenv("MAX_SOURCE_DIMENSION", "1920"))
# Path to MediaPipe's FaceLandmarker .task model asset. NOT bundled with the
# mediapipe pip package — must be downloaded separately (see README.md's
# Phase 11 section). If this file isn't present, head-pose/gaze metrics are
# omitted (null) but face-presence detection (OpenCV Haar Cascade, fully
# offline, no external asset needed) still works.
FACE_LANDMARKER_MODEL_PATH = os.getenv("FACE_LANDMARKER_MODEL_PATH", "").strip() or os.path.join(BASE_DIR, "models", "face_landmarker.task")
# `python -m app.diagnostics --download-vision-model` downloads the file from this URL (MediaPipe's published model).
FACE_LANDMARKER_MODEL_URL = os.getenv(
    "FACE_LANDMARKER_MODEL_URL",
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
)
# Degrees / normalized-deviation thresholds for classifying a frame as
# "looking away" — see vision_processor.py for the exact formulas these apply to.
GAZE_DEVIATION_THRESHOLD = float(os.getenv("GAZE_DEVIATION_THRESHOLD", "0.35"))
HEAD_YAW_THRESHOLD_DEGREES = float(os.getenv("HEAD_YAW_THRESHOLD_DEGREES", "20"))

# --- Face monitoring (per-frame analysis; see app/services/face_behavior.py) ----------------------------------------
# One small webcam frame per request (the browser sends a downscaled JPEG every couple of seconds). Frames are processed in
# memory and discarded; nothing is written to disk.
FACE_FRAME_MAX_BYTES = int(os.getenv("FACE_FRAME_MAX_BYTES", str(300 * 1024)))
FACE_FRAME_MAX_SOURCE_DIMENSION = int(os.getenv("FACE_FRAME_MAX_SOURCE_DIMENSION", "1920"))
FACE_FRAME_ANALYSIS_DIMENSION = int(os.getenv("FACE_FRAME_ANALYSIS_DIMENSION", "640"))
FACE_MAX_FACES = int(os.getenv("FACE_MAX_FACES", "4"))
# Faces whose height is below this fraction of the frame are ignored (posters, photos far away, noise).
FACE_MIN_FACE_RATIO = float(os.getenv("FACE_MIN_FACE_RATIO", "0.08"))
# Image-quality thresholds (0-255 brightness; variance of Laplacian for sharpness). Starting points, tune per camera.
FACE_BRIGHTNESS_LOW = float(os.getenv("FACE_BRIGHTNESS_LOW", "45"))
FACE_BRIGHTNESS_HIGH = float(os.getenv("FACE_BRIGHTNESS_HIGH", "215"))
FACE_CONTRAST_LOW = float(os.getenv("FACE_CONTRAST_LOW", "14"))
FACE_SHARPNESS_LOW = float(os.getenv("FACE_SHARPNESS_LOW", "20"))
# Gaze is reported only when the head is roughly facing the camera and the eyes are big enough in the frame.
FACE_GAZE_MAX_YAW_DEGREES = float(os.getenv("FACE_GAZE_MAX_YAW_DEGREES", "25"))
FACE_GAZE_MIN_EYE_PX = float(os.getenv("FACE_GAZE_MIN_EYE_PX", "12"))
# Optional same-person check: OpenCV's SFace ONNX model (not downloaded automatically). Cosine similarity >= threshold = same.
FACE_RECOGNITION_MODEL_PATH = os.getenv("FACE_RECOGNITION_MODEL_PATH", "").strip()
FACE_IDENTITY_SIMILARITY_THRESHOLD = float(os.getenv("FACE_IDENTITY_SIMILARITY_THRESHOLD", "0.363"))
FACE_REFERENCE_TTL_SECONDS = float(os.getenv("FACE_REFERENCE_TTL_SECONDS", "7200"))
FACE_MAX_REFERENCES = int(os.getenv("FACE_MAX_REFERENCES", "200"))

# --- Speech-to-text behaviour (see app/services/speech_processor.py) ----------------------------------------------
# Language hint. "en" stops Whisper mis-detecting the language of accented English (which produces garbled or
# translated text). Set to an empty value to let Whisper auto-detect.
SPEECH_LANGUAGE = os.getenv("SPEECH_LANGUAGE", "en").strip() or None
# beam_size 5 is faster-whisper's own default; 1 (greedy) is faster but less accurate.
SPEECH_BEAM_SIZE = int(os.getenv("SPEECH_BEAM_SIZE", "5"))
# Voice-activity detection removes silence before decoding; without it Whisper is known to "hallucinate" text
# (e.g. "Thank you.") from silence or noise. Needs the onnxruntime package that faster-whisper installs.
SPEECH_VAD_FILTER = os.getenv("SPEECH_VAD_FILTER", "true").strip().lower() not in ("0", "false", "no")
# Load the model in a background thread when the service starts, so the first user is not the one who waits for
# (or times out on) the model download/load. The service starts immediately either way.
SPEECH_PRELOAD = os.getenv("SPEECH_PRELOAD", "true").strip().lower() not in ("0", "false", "no")
# Directory for downloaded model files (default: the Hugging Face cache) and an offline switch for after the model
# has been downloaded once.
SPEECH_MODEL_DIR = os.getenv("SPEECH_MODEL_DIR", "").strip() or None
SPEECH_LOCAL_ONLY = os.getenv("SPEECH_LOCAL_ONLY", "false").strip().lower() in ("1", "true", "yes")
# Short text that nudges the decoder towards interview/technical vocabulary and towards writing filler words
# (Whisper otherwise tends to silently drop "um"/"uh"). Empty value disables it.
SPEECH_INITIAL_PROMPT = os.getenv(
    "SPEECH_INITIAL_PROMPT",
    "Umm, let me think. So, uh, we use an API with REST, SQL, PostgreSQL, React, Node.js, Python and Docker.",
).strip() or None
# Reject recordings shorter than this (seconds of audio) or with no detectable speech.
MIN_AUDIO_SECONDS = float(os.getenv("MIN_AUDIO_SECONDS", "1.0"))
MAX_AUDIO_SECONDS = float(os.getenv("MAX_AUDIO_SECONDS", "300"))
# Pauses: a gap between two words longer than PAUSE_THRESHOLD_SECONDS is a "pause"; longer than LONG_PAUSE is "long".
LONG_PAUSE_SECONDS = float(os.getenv("LONG_PAUSE_SECONDS", "2.0"))

# ---------------------------------------------------------------------------
# Local language model (Ollama) - see app/services/llm.py. Optional: every feature built on it has a rule-based fallback
# in the Node backend, so the app keeps working when Ollama is stopped or the model is not installed.
# ---------------------------------------------------------------------------
def _flag(name, default):
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")

LLM_ENABLED = _flag("LLM_ENABLED", "true")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").strip().rstrip("/")
# qwen3:4b needs roughly 3-4 GB of free RAM on CPU. Use a smaller model (for example qwen3:1.7b or llama3.2:3b) on a
# weaker machine; the model name is never hardcoded anywhere else.
LLM_MODEL = os.getenv("LLM_MODEL", "qwen3:4b").strip()
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "120"))      # per generation; CPU-only machines can be slow
LLM_STATUS_TIMEOUT_SECONDS = float(os.getenv("LLM_STATUS_TIMEOUT_SECONDS", "3"))
LLM_MAX_OUTPUT_TOKENS = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "700"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.3"))
LLM_CONTEXT_TOKENS = int(os.getenv("LLM_CONTEXT_TOKENS", "4096"))
# Candidate answers and code are sent to the model. Unless this is explicitly enabled the base URL must be this
# machine, so interview data cannot leave it by a typo in .env.
LLM_ALLOW_REMOTE = _flag("LLM_ALLOW_REMOTE", "false")
LLM_MAX_CONCURRENT = max(1, int(os.getenv("LLM_MAX_CONCURRENT", "1")))
LLM_QUEUE_WAIT_SECONDS = float(os.getenv("LLM_QUEUE_WAIT_SECONDS", "5"))

# --- Interview camera signals (derived from the sampled frames of an answer; display only, never part of any score) -----
HEAD_PITCH_THRESHOLD_DEGREES = float(os.getenv("HEAD_PITCH_THRESHOLD_DEGREES", "25"))
SIGNALS_MIN_FRAMES = int(os.getenv("SIGNALS_MIN_FRAMES", "5"))                 # fewer measured frames than this => the summary says "not enough data"
HEAD_MOVEMENT_LOW_DEG = float(os.getenv("HEAD_MOVEMENT_LOW_DEG", "4"))          # mean spread of yaw/pitch below this => steady
HEAD_MOVEMENT_HIGH_DEG = float(os.getenv("HEAD_MOVEMENT_HIGH_DEG", "10"))       # ... above this => lots of movement
EXPRESSION_VARIATION_LOW = float(os.getenv("EXPRESSION_VARIATION_LOW", "0.02")) # rough, unvalidated cut-offs on blendshape spread
EXPRESSION_VARIATION_HIGH = float(os.getenv("EXPRESSION_VARIATION_HIGH", "0.06"))

# Snapshots of the answer video shown next to each camera signal. They are small JPEGs returned in the response and never written to
# disk or sent anywhere by this service. Set ANSWER_SNAPSHOTS=off to return none.
ANSWER_SNAPSHOTS = os.getenv("ANSWER_SNAPSHOTS", "on").strip().lower() not in ("off", "false", "0", "no")
SNAPSHOT_WIDTH = int(os.getenv("SNAPSHOT_WIDTH", "320"))
SNAPSHOT_JPEG_QUALITY = int(os.getenv("SNAPSHOT_JPEG_QUALITY", "60"))
