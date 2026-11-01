"""GET /capabilities - what this AI service deployment can currently do, so callers can offer or hide optional features."""
from fastapi import APIRouter, Header

from app.services import llm, speech_processor
from app.services.face_behavior import face_monitor_status
from app.services.vision_processor import vision_status
from app.utils.security import verify_api_key

router = APIRouter()


@router.get("/capabilities")
def capabilities(x_ai_service_key: str = Header(default="")):
    """
    Cheap and side-effect free (it never loads a model). The only network call is a 1-second check of the LOCAL Ollama
    server, cached for 5 seconds.
      speech.state : not_loaded | loading | ready | error   (+ errorCode/message when error)
      vision.state : complete | face_presence_only | unavailable
      llm.state    : ready | model_missing | unreachable | disabled | error
    """
    verify_api_key(x_ai_service_key)
    return {"evaluate": {"available": True}, "speech": speech_processor.default_engine.status(), "vision": vision_status(), "faceMonitor": face_monitor_status(), "llm": llm.status(timeout=1.0)}
