"""
Pydantic request/response models.

Field names are deliberately camelCase on the response (technicalScore,
not technical_score) even though that's not idiomatic Python — this is
the stable cross-service contract the Node backend and the
interview_answers columns are built around (see
backend/services/aiServiceClient.js), and matching it exactly here avoids
needing an alias/translation layer on either side.
"""
from typing import Any, List, Optional, Dict
from pydantic import BaseModel, Field


class EvaluateRequest(BaseModel):
    question: str
    answer: str = ""
    target_role: Optional[str] = None
    difficulty: Optional[str] = None
    interview_type: Optional[str] = None


class EvaluateResponse(BaseModel):
    technicalScore: int = Field(ge=0, le=100)
    relevanceScore: int = Field(ge=0, le=100)
    clarityScore: int = Field(ge=0, le=100)
    completenessScore: int = Field(ge=0, le=100)
    strengths: List[str]
    weaknesses: List[str]
    suggestedImprovement: str
    modelAnswer: str
    # Added in Phase H, all optional with defaults so existing consumers
    # (which ignore unknown fields) keep working unchanged.
    confidence: str = "medium"            # "high" | "medium" | "low"
    confidenceNote: Optional[str] = None
    rubricId: Optional[str] = None
    rubricKind: Optional[str] = None      # "concept" | "star" | "criteria"
    matchedCriteria: List[str] = []
    missingCriteria: List[str] = []
    followUps: List[str] = []              # authored prompts for criteria that were not detected
    # Outcome of the answer-quality check: {status, label, evaluable, reasons, wordCount, meaningfulWordCount, wordLikeRatio, scoreBasis}.
    # status: not_evaluable | too_short | off_topic | insufficient | partial | good | strong. Optional so older consumers keep working.
    answerQuality: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    status: str
    service: str


# ---------------------------------------------------------------------------
# Speech processing (Phase 10). There is no request model for POST
# /speech-evaluate — it's multipart/form-data (an audio file plus form
# fields), which FastAPI reads via File(...)/Form(...) parameters directly
# on the route function rather than a single Pydantic body model.
# ---------------------------------------------------------------------------

class SpeechMetrics(BaseModel):
    """
    Factual, transcript/audio-derived measurements only - never an opaque "communication score". Anything that
    could not be measured reliably is None (never a fake 0). The first block is the original (schema v1) contract and
    is unchanged in meaning except speakingRateWpm, which may now be None and is measured between the first and last
    spoken word. Everything after it is optional and was added in schema v2.
    """
    durationSeconds: float = Field(ge=0)
    wordCount: int = Field(ge=0)
    speakingRateWpm: Optional[float] = Field(default=None, ge=0)
    fillerWordCount: int = Field(ge=0)
    fillerWords: Dict[str, int]
    pauseCount: Optional[int] = None
    averagePauseSeconds: Optional[float] = None

    schemaVersion: int = 2
    articulationRateWpm: Optional[float] = None
    speechSpanSeconds: Optional[float] = None
    timeToFirstWordSeconds: Optional[float] = None
    disfluencyCount: Optional[int] = None
    disfluencyRatePer100Words: Optional[float] = None
    longestPauseSeconds: Optional[float] = None
    longPauseCount: Optional[int] = None
    pauseBasis: Optional[str] = None
    transcriptConfidence: Optional[Dict[str, Any]] = None
    audioQuality: Optional[Dict[str, Any]] = None
    reliable: bool = True
    unreliableReasons: List[str] = []
    notes: List[str] = []


class SpeechEvaluateResponse(EvaluateResponse):
    """
    Same four content scores + feedback fields as EvaluateResponse (the
    transcript is evaluated by the exact same evaluator.py used for text
    answers — this is not a second, different scoring system) plus the
    transcript itself and speech-specific metrics.
    """
    transcript: str
    speechMetrics: SpeechMetrics

class HeadPose(BaseModel):
    """Degrees. yaw: left/right turn (negative = turned left), pitch: up/down tilt (negative = looking down), roll: head tilt sideways. See vision_processor.py for the exact rotation-matrix convention this is derived from."""
    yaw: float
    pitch: float
    roll: float


class VisionEvaluateResponse(BaseModel):
    """
    Every field here is a measurable signal, not a judgment. Fields that
    could not be computed (because no analyzed frame had a usable face, or
    the optional MediaPipe landmark model isn't available in this
    deployment) are None — never coerced to 0 or a fabricated value. See
    vision_processor.py's module docstring for exact per-field definitions.
    """
    # Explicit availability state, so a consumer never has to infer "why is
    # this null?" from nulls alone. A 200 response always means an analysis
    # actually ran, and carries exactly one of:
    #   "complete"          — face presence AND landmark-based metrics were
    #                         computed (the MediaPipe model was available). A
    #                         null landmark metric here means no analyzed frame
    #                         yielded a usable measurement — not that the model
    #                         is missing.
    #   "model_unavailable" — face presence was computed (OpenCV, no external
    #                         asset needed) but the MediaPipe FaceLandmarker
    #                         model file isn't present/loadable, so every
    #                         landmark-dependent metric is null.
    # Rejected/invalid videos and processing failures are NOT statuses here —
    # they are HTTP errors (422 / 500) from the route, so a fake "successful"
    # payload can never be mistaken for a real result.
    analysisStatus: str
    framesAnalyzed: int = Field(ge=0)
    framesWithFace: int = Field(ge=0)
    facePresent: Optional[bool] = None
    facePresenceRatio: Optional[float] = None
    framesInClip: Optional[int] = None      # frames read from the clip; the analysed frames are spread evenly across them
    clipTruncated: Optional[bool] = None    # True when the clip was longer than the service analyses

    # Everything below requires the optional MediaPipe FaceLandmarker model
    # (see config.FACE_LANDMARKER_MODEL_PATH) — all None if it's unavailable,
    # never fabricated from the Haar Cascade face-presence data alone.
    framesWithGaze: Optional[int] = None
    framesWithHeadPose: Optional[int] = None
    lookingAwayRatio: Optional[float] = None
    averageGazeDeviation: Optional[float] = None
    headPose: Optional[HeadPose] = None

    # Derived camera signals for display (never part of a score). Each is None when it could not be measured:
    #   eyeContactRatio / facingCameraRatio  share of measurable frames where eyes / head+eyes pointed at the camera
    #   headMovement        {level low|moderate|high, yawSpread, pitchSpread, rollSpread, meanChangeDeg, framesMeasured}
    #   expressionVariation {level, spread, framesMeasured}: HOW MUCH brow/eye/smile/cheek/nose movement changed, never an emotion
    #   framing             {level good|fair|poor, wellFramedRatio, meanFaceHeight, meanCentreX, meanCentreY, hints, framesMeasured}: head position only
    #   timeline            {points: [{t 0..1, face, facing, expression, head}], durationSeconds}
    eyeContactRatio: Optional[float] = None
    facingCameraRatio: Optional[float] = None
    headMovement: Optional[Dict[str, Any]] = None
    expressionVariation: Optional[Dict[str, Any]] = None
    framing: Optional[Dict[str, Any]] = None
    timeline: Optional[Dict[str, Any]] = None
    #   snapshots           [{t 0..1, kinds: [framed|facing|away|noface|turn|expressive|calm], image: data:image/jpeg;base64,...}]: real frames of the answer
    snapshots: Optional[List[Dict[str, Any]]] = None
