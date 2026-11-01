"""
POST /vision-evaluate — video in, measurable visual signals out.

Architecture: vision_processor.py does all frame decoding/analysis. This
route only handles the HTTP contract (auth, upload validation, temp file
lifecycle) — same shape as routes/speech.py.
"""
import asyncio
import logging
import os
import tempfile
import uuid

from fastapi import APIRouter, Header, UploadFile, File, HTTPException

from app.config import MAX_VIDEO_BYTES
from app.schemas import VisionEvaluateResponse
from app.services.vision_processor import analyze_video, VideoRejected, VisionUnavailable
from app.utils.security import verify_api_key

router = APIRouter()
logger = logging.getLogger(__name__)

# Common browser-recorded video containers. Matched against the part's
# declared content type with any ";codecs=..." suffix stripped first.
ALLOWED_VIDEO_CONTENT_TYPES = {
    "video/webm",
    "video/mp4",
    "video/quicktime",  # Safari sometimes uses this for recorded clips
    "video/ogg",
}


@router.post("/vision-evaluate", response_model=VisionEvaluateResponse)
async def vision_evaluate(
    video: UploadFile = File(...),
    x_ai_service_key: str = Header(default=""),
):
    verify_api_key(x_ai_service_key)

    content_type = (video.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_VIDEO_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported video format: {video.content_type}")

    # Read with a hard cap rather than trusting a Content-Length header —
    # reads one chunk over the limit at most, then aborts.
    chunks = []
    total = 0
    chunk_size = 1024 * 1024
    while True:
        chunk = await video.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_VIDEO_BYTES:
            raise HTTPException(status_code=413, detail="Video file is too large.")
        chunks.append(chunk)
    video_bytes = b"".join(chunks)
    if not video_bytes:
        raise HTTPException(status_code=400, detail="Video file is empty.")

    # Safe, isolated temp file — a random uuid name, never derived from
    # the client-supplied filename, in a fresh temp directory removed
    # afterward. The raw video is discarded once analysis finishes; it is
    # never persisted anywhere (not by this service, not by Node/Postgres
    # — only the resulting structured metrics are).
    tmp_dir = tempfile.mkdtemp(prefix="vision_")
    suffix = os.path.splitext(video.filename or "")[1][:8] or ".webm"
    tmp_path = os.path.join(tmp_dir, f"{uuid.uuid4().hex}{suffix}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(video_bytes)

        try:
            # Frame analysis is CPU-bound and blocking: run it in a worker thread so the event loop stays free.
            result = await asyncio.to_thread(analyze_video, tmp_path)
        except VisionUnavailable as exc:
            raise HTTPException(status_code=503, detail={"reason": exc.code, "message": exc.message}) from exc
        except VideoRejected as exc:
            # 422: the request was well-formed (right type, within the byte
            # limit) but the video itself can't/shouldn't be analyzed. The
            # message is client-safe by construction (see VideoRejected).
            raise HTTPException(status_code=422, detail={"reason": exc.reason, "message": exc.message}) from exc
        except Exception:
            # Anything unexpected: log server-side (no video content is
            # logged), return a generic body — never a traceback or a path.
            logger.exception("Unexpected failure during vision analysis")
            raise HTTPException(
                status_code=500, detail={"reason": "processing_failed", "message": "Video analysis failed."},
            )

        return VisionEvaluateResponse(**result)
    finally:
        # Always clean up — success, decode failure, or any other
        # exception all take this path.
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            os.rmdir(tmp_dir)
        except OSError:
            pass
