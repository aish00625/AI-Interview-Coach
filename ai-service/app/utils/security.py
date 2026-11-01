"""Shared-secret request authentication, used by every route in this service."""
from fastapi import Header, HTTPException

from app.config import API_KEY


def verify_api_key(x_ai_service_key: str = Header(default="")):
    """
    Simple shared-secret check between Node and this service (not a full
    auth system — there's no per-user identity here, just "is this call
    coming from our own backend"). Node already verified the end user's
    JWT before ever reaching this service.
    """
    if not API_KEY or x_ai_service_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing AI service key.")
