"""
Face monitoring endpoints (per-frame analysis only). Node owns sessions, timing, events and storage; this service looks at
ONE frame at a time, in memory, and returns measurements. It never stores frames and never returns a reference embedding.

  POST   /face-frame               multipart: frame (jpeg/png/webp), optional reference_key  -> analysis JSON
  POST   /face-reference           multipart: frame, reference_key                           -> {status}
  DELETE /face-reference/{key}                                                              -> {deleted}
"""
import asyncio
import logging
import threading

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from app import config
from app.services import face_behavior as fb
from app.services.vision_processor import VisionUnavailable
from app.utils.security import verify_api_key

router = APIRouter()
logger = logging.getLogger(__name__)
_slots = threading.BoundedSemaphore(int(getattr(config, "FACE_MAX_CONCURRENT", 2)))
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


async def _read_frame(frame: UploadFile) -> bytes:
    ctype = (frame.content_type or "").split(";")[0].strip().lower()
    if ctype not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail={"reason": "unsupported_media", "message": "Frames must be JPEG, PNG or WebP images."})
    data = b""
    while True:
        chunk = await frame.read(64 * 1024)
        if not chunk:
            break
        data += chunk
        if len(data) > config.FACE_FRAME_MAX_BYTES:
            raise HTTPException(status_code=413, detail={"reason": "frame_too_large", "message": "The frame is larger than the allowed size."})
    return data


def _run(fn, *args):
    if not _slots.acquire(blocking=False):
        raise HTTPException(status_code=503, detail={"reason": "face_service_busy", "message": "The face analysis service is busy. Try again shortly.", "retryable": True})
    try:
        return fn(*args)
    finally:
        _slots.release()


def _to_http(exc: Exception):
    if isinstance(exc, fb.FrameRejected):
        return HTTPException(status_code=422, detail={"reason": exc.reason, "message": exc.message})
    if isinstance(exc, VisionUnavailable):
        return HTTPException(status_code=503, detail={"reason": exc.code, "message": exc.message})
    logger.error("Unexpected failure during face-frame analysis: %s", type(exc).__name__)   # no frame data, no traceback body to the client
    return HTTPException(status_code=500, detail={"reason": "processing_failed", "message": "Frame analysis failed."})


def _analyze(data: bytes, reference_key):
    analyzer = fb.get_analyzer()
    return analyzer.analyze(fb.decode_frame(data), reference_key)


def _store(data: bytes, key: str):
    analyzer = fb.get_analyzer()
    return analyzer.store_reference(fb.decode_frame(data), key)


def _check_key(key):
    if key is not None and key != "" and not fb.KEY_PATTERN.match(key):
        raise HTTPException(status_code=400, detail={"reason": "bad_reference_key", "message": "Invalid reference key."})


@router.post("/face-frame")
async def face_frame(frame: UploadFile = File(...), reference_key: str = Form(default=""), x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    _check_key(reference_key)
    data = await _read_frame(frame)
    try:
        return await asyncio.to_thread(_run, _analyze, data, reference_key or None)
    except HTTPException:
        raise
    except Exception as exc:
        raise _to_http(exc) from exc


@router.post("/face-reference")
async def face_reference(frame: UploadFile = File(...), reference_key: str = Form(...), x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    if not fb.KEY_PATTERN.match(reference_key or ""):
        raise HTTPException(status_code=400, detail={"reason": "bad_reference_key", "message": "Invalid reference key."})
    data = await _read_frame(frame)
    try:
        return await asyncio.to_thread(_run, _store, data, reference_key)
    except HTTPException:
        raise
    except Exception as exc:
        raise _to_http(exc) from exc


@router.delete("/face-reference/{reference_key}")
def delete_reference(reference_key: str, x_ai_service_key: str = Header(default="")):
    verify_api_key(x_ai_service_key)
    if not fb.KEY_PATTERN.match(reference_key or ""):
        raise HTTPException(status_code=400, detail={"reason": "bad_reference_key", "message": "Invalid reference key."})
    analyzer = fb._analyzer   # nothing to delete if no analyser was ever built
    deleted = bool(analyzer and analyzer.references.delete(reference_key))
    return {"deleted": deleted}
