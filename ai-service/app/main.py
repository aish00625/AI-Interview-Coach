"""
FastAPI entry point.

Run locally with:
    uvicorn app.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import ALLOWED_ORIGINS, SPEECH_PRELOAD
from app.routes import capabilities, evaluation, face_monitor, llm as llm_routes, speech, vision
from app.schemas import HealthResponse
from app.services import speech_processor


@asynccontextmanager
async def lifespan(_app):
    # Load the speech model in a background thread so the first candidate does not wait for it. The service starts
    # serving immediately; /capabilities reports "loading" until it is ready (or why it failed).
    if SPEECH_PRELOAD:
        speech_processor.default_engine.start_preload()
    yield

app = FastAPI(
    title="AI Interview Coach — AI Service",
    description=(
        "Local NLP-based semantic and concept matching evaluator for interview answers, "
        "local speech-to-text and speech-metric extraction for voice answers, and "
        "OpenCV/MediaPipe-based visual signal extraction for optional webcam analysis. "
        "This is NOT a large language model, and vision analysis reports measurable "
        "signals only — never emotion, personality, or other psychological inference. "
        "See app/services/evaluator.py, speech_processor.py, and vision_processor.py "
        "for each pipeline's explainable, deterministic methodology."
    ),
    version="0.4.0",
    lifespan=lifespan,
)

# See app/config.py — this has no effect on real Node→Python traffic,
# which isn't subject to browser CORS rules; it only matters for hitting
# /docs from a browser during local development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

app.include_router(evaluation.router)
app.include_router(speech.router)
app.include_router(vision.router)
app.include_router(face_monitor.router)
app.include_router(llm_routes.router)
app.include_router(capabilities.router)


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", service="ai-service")
