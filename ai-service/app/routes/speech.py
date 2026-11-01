"""
POST /speech-evaluate - audio in, transcript + the same content evaluation used for typed answers + speech metrics out.

Architecture: speech_processor.py transcribes and measures the audio; evaluator.py scores the resulting transcript's
content. One evaluator used two ways, not two competing scoring systems.

Error contract (every error body is {"detail": {"reason": <code>, "message": <safe text>, ...}}):
  401  bad/missing service key            400  empty upload (audio_empty)
  413  audio_too_large                    415  unsupported_media
  422  the RECORDING cannot be used - audio_unreadable | audio_too_short | audio_too_long | no_speech_detected.
       The candidate can fix these by recording again; nothing is scored or stored.
  503  the SERVICE cannot transcribe right now - speech_package_missing | speech_model_loading (retryable) |
       speech_model_unavailable | speech_transcription_failed (retryable)
  500  processing_failed (unexpected; details are logged server-side only)

Transcription is CPU-heavy and blocking, so it runs in a worker thread: the event loop (and therefore /health and
/capabilities) stays responsive while a recording is being processed.
"""
import asyncio
import logging
import os
import tempfile
import uuid

from fastapi import APIRouter, Header, UploadFile, File, Form, HTTPException

from app.config import MAX_AUDIO_BYTES
from app.schemas import SpeechEvaluateResponse
from app.services import speech_processor
from app.services.evaluator import evaluate_answer
from app.services.speech_processor import AudioRejected, SpeechServiceUnavailable
from app.utils.security import verify_api_key

router = APIRouter()
logger = logging.getLogger(__name__)

# Browsers' MediaRecorder commonly produces "audio/webm" (Chrome/Firefox) or "audio/mp4" (Safari); accept the other
# common container types too. Matched against the declared content type with any ";codecs=..." suffix stripped.
# "application/octet-stream" is accepted because the Node backend has already validated the type and decoding is
# decided by the bytes, not by the label.
ALLOWED_AUDIO_CONTENT_TYPES = {
    "audio/webm", "video/webm",
    "audio/wav", "audio/x-wav", "audio/wave",
    "audio/mpeg", "audio/mp3",
    "audio/mp4", "audio/m4a", "audio/x-m4a",
    "audio/ogg",
    "application/octet-stream",
}


def _error(status: int, reason: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"reason": reason, "message": message, **extra})


def process_audio_bytes(audio_bytes: bytes, suffix: str, question: str, target_role=None, difficulty=None,
                        interview_type=None, engine=None, decoder=None) -> dict:
    """
    The whole synchronous pipeline for one recording (kept separate from the async route so it can be tested
    without a web framework). Raises AudioRejected / SpeechServiceUnavailable; always removes its temp file.
    """
    tmp_dir = tempfile.mkdtemp(prefix="speech_")
    # Random name, never derived from the client-supplied filename.
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{suffix}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(audio_bytes)

        transcription = speech_processor.transcribe_audio(tmp_path, engine=engine, decoder=decoder)
        metrics = speech_processor.compute_speech_metrics(
            transcription["transcript"], transcription["duration_seconds"], transcription["segments"],
            words=transcription["words"], confidence=transcription["confidence"],
            audio_quality_info=transcription["audio_quality"],
        )
        evaluation = evaluate_answer(
            question=question, answer=transcription["transcript"],
            target_role=target_role, difficulty=difficulty, interview_type=interview_type,
        )
        evaluation = speech_processor.apply_transcript_confidence(evaluation, transcription["confidence"])
        return {"transcript": transcription["transcript"], "speechMetrics": metrics, **evaluation}
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            os.rmdir(tmp_dir)
        except OSError:
            pass


@router.post("/speech-evaluate", response_model=SpeechEvaluateResponse)
async def speech_evaluate(
    audio: UploadFile = File(...),
    question: str = Form(...),
    target_role: str = Form(None),
    difficulty: str = Form(None),
    interview_type: str = Form(None),
    x_ai_service_key: str = Header(default=""),
):
    verify_api_key(x_ai_service_key)

    content_type = (audio.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_AUDIO_CONTENT_TYPES:
        raise _error(415, "unsupported_media", f"Unsupported audio format: {audio.content_type}")

    # Read with a hard cap rather than trusting a Content-Length header.
    chunks, total = [], 0
    while True:
        chunk = await audio.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_AUDIO_BYTES:
            raise _error(413, "audio_too_large", "Audio file is too large.")
        chunks.append(chunk)
    audio_bytes = b"".join(chunks)
    if not audio_bytes:
        raise _error(400, "audio_empty", "Audio file is empty.")

    suffix = os.path.splitext(audio.filename or "")[1][:8] or ".webm"
    try:
        payload = await asyncio.to_thread(
            process_audio_bytes, audio_bytes, suffix, question, target_role, difficulty, interview_type,
        )
    except AudioRejected as exc:
        raise _error(422, exc.reason, exc.message) from exc
    except SpeechServiceUnavailable as exc:
        raise _error(503, exc.code, exc.message, retryable=exc.retryable) from exc
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        logger.exception("Unexpected failure during speech processing")
        raise _error(500, "processing_failed", "Speech processing failed.")

    return SpeechEvaluateResponse(**payload)
