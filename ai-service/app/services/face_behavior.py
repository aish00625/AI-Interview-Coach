"""
Per-frame face behaviour analysis for the optional Face Monitoring feature (practice interviews).

WHAT THIS MODULE DOES (all of it is a measurement of one image; nothing here knows about time or sessions):
  - decodes one webcam frame (bounded size, bounded dimensions, magic-byte checked),
  - measures image quality (brightness, contrast, sharpness, face size/position) with plain numpy,
  - detects faces and counts them (MediaPipe FaceLandmarker when its model file is present, else OpenCV's frontal Haar
    cascade),
  - estimates head pose (yaw / pitch / roll) from the FaceLandmarker's transformation matrix,
  - estimates HORIZONTAL iris offset ("gaze deviation") from iris and eye-corner landmarks, only when reliable,
  - optionally compares the face with a session-scoped reference using OpenCV's SFace recogniser (when its ONNX model
    file is configured).

WHAT IT DOES NOT DO: it does not read emotions, attention, honesty, confidence or intent; it does not identify strangers
or search any database; it does not store frames. Nothing is invented: when a measurement cannot be made, the field says
`unavailable` or `low_confidence` and why, and numbers are `None`, never 0.

HONEST LIMITS
  - Gaze here is a rough, horizontal-only iris offset from a normal webcam. It is not an eye tracker and cannot tell
    where on the screen someone looks. Head pose is separate and is never labelled gaze.
  - The Haar detector only finds frontal faces; a turned head can read as "no face". The landmark model is better.
  - Neither detector reports a calibrated probability, so `faceConfidence` is None (the raw Haar score is exposed as
    `score` for transparency, and is not a probability).
  - The identity check compares a live face with a reference captured earlier in the same session ("same face as at the
    start"). It is not proof of legal identity and it is less reliable in poor light.
"""
import math
import os
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

try:
    import cv2
except ImportError:  # optional extra (requirements-vision.txt); the rest of the service must still start
    cv2 = None
if cv2 is not None and not hasattr(cv2, "CascadeClassifier"):
    cv2 = None

from app import config
from app.services.vision_processor import (
    VisionUnavailable, _LEFT_EYE_CORNERS, _LEFT_IRIS_CENTER, _RIGHT_EYE_CORNERS, _RIGHT_IRIS_CENTER,
    _rotation_matrix_to_euler_degrees,
)

SCHEMA_VERSION = 1
KEY_PATTERN = re.compile(r"^[a-f0-9]{16,64}$")
_IMAGE_MAGIC = (
    (b"\xff\xd8\xff", "jpeg"),
    (b"\x89PNG\r\n\x1a\n", "png"),
)


class FrameRejected(Exception):
    """The frame cannot be analysed (not an image, corrupt, wrong size). Mapped to HTTP 422; a technical issue, not a behaviour."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason, self.message = reason, message


# --------------------------------------------------------------------------------------------------------------------
# Data shapes
# --------------------------------------------------------------------------------------------------------------------
@dataclass
class Face:
    box: Tuple[float, float, float, float]          # x, y, w, h in pixels of the analysed image
    score: Optional[float] = None                   # raw detector score when the detector has one (not a probability)
    landmarks: Optional[Sequence[Any]] = None       # objects with .x .y (normalised 0-1), MediaPipe layout
    pose: Optional[Dict[str, float]] = None         # yaw / pitch / roll in degrees, when the model provides it


@dataclass
class Detection:
    detector: str
    faces: List[Face] = field(default_factory=list)


# --------------------------------------------------------------------------------------------------------------------
# Decoding (cv2 is needed only here and in the detectors; quality / gaze / pose maths are numpy-only and unit-tested)
# --------------------------------------------------------------------------------------------------------------------
def check_frame_bytes(data: bytes) -> str:
    """Cheap validation BEFORE any decoder sees the bytes. Returns the sniffed kind or raises FrameRejected."""
    if not data:
        raise FrameRejected("empty_frame", "The frame was empty.")
    if len(data) > config.FACE_FRAME_MAX_BYTES:
        raise FrameRejected("frame_too_large", "The frame is larger than the allowed size.")
    for magic, kind in _IMAGE_MAGIC:
        if data.startswith(magic):
            return kind
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise FrameRejected("not_an_image", "The upload is not a JPEG, PNG or WebP image.")


def decode_frame(data: bytes) -> np.ndarray:
    check_frame_bytes(data)
    if cv2 is None:
        raise VisionUnavailable()
    try:
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    except Exception:
        img = None
    if img is None or img.ndim != 3 or img.shape[2] != 3:
        raise FrameRejected("corrupt_frame", "The frame could not be decoded as an image.")
    h, w = img.shape[:2]
    if min(h, w) < 48:
        raise FrameRejected("frame_too_small", "The frame is too small to analyse.")
    if max(h, w) > config.FACE_FRAME_MAX_SOURCE_DIMENSION:
        raise FrameRejected("frame_too_large", "The frame resolution is larger than allowed.")
    longest = max(h, w)
    if longest > config.FACE_FRAME_ANALYSIS_DIMENSION:
        scale = config.FACE_FRAME_ANALYSIS_DIMENSION / longest
        img = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))))
    return img


# --------------------------------------------------------------------------------------------------------------------
# Image quality (numpy only)
# --------------------------------------------------------------------------------------------------------------------
def _gray(bgr: np.ndarray) -> np.ndarray:
    b, g, r = bgr[..., 0].astype(np.float32), bgr[..., 1].astype(np.float32), bgr[..., 2].astype(np.float32)
    return 0.114 * b + 0.587 * g + 0.299 * r


def measure_quality(bgr: np.ndarray) -> Dict[str, Any]:
    """Brightness (0-255), contrast (std dev) and sharpness (variance of the Laplacian) of the whole frame."""
    g = _gray(bgr)
    brightness = float(g.mean())
    contrast = float(g.std())
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    sharpness = float(lap.var()) if lap.size else 0.0
    issues: List[str] = []
    if brightness < config.FACE_BRIGHTNESS_LOW:
        issues.append("too_dark")
    elif brightness > config.FACE_BRIGHTNESS_HIGH:
        issues.append("too_bright")
    elif contrast < config.FACE_CONTRAST_LOW:
        issues.append("low_contrast")   # e.g. strong backlight / washed-out image
    if sharpness < config.FACE_SHARPNESS_LOW:
        issues.append("blurry")
    usable = not any(i in issues for i in ("too_dark", "too_bright", "blurry"))
    return {
        "usable": usable, "brightness": round(brightness, 1), "contrast": round(contrast, 1), "sharpness": round(sharpness, 1),
        "issues": issues,
    }


HINTS = {
    "too_dark": "improve_lighting", "too_bright": "reduce_brightness", "low_contrast": "improve_lighting",
    "blurry": "hold_still_or_clean_lens", "face_too_small": "move_closer", "face_too_close": "move_back",
    "face_partly_out_of_frame": "centre_face",
}


def _normalise_box(face: Face, w: int, h: int) -> List[float]:
    x, y, bw, bh = face.box
    return [round(max(0.0, x / w), 4), round(max(0.0, y / h), 4), round(min(1.0, bw / w), 4), round(min(1.0, bh / h), 4)]


# --------------------------------------------------------------------------------------------------------------------
# Head pose and gaze (pure functions on landmarks / matrices)
# --------------------------------------------------------------------------------------------------------------------
def _wrap180(angle: float) -> float:
    """A real head never exceeds +-90 degrees on any axis, so equivalent angles 180 degrees apart are folded into (-90, 90]."""
    return ((angle + 90.0) % 180.0) - 90.0


def head_pose_from_matrix(matrix: Any) -> Optional[Dict[str, float]]:
    try:
        m = np.asarray(matrix, dtype=np.float64)[:3, :3]
        if m.shape != (3, 3) or not np.isfinite(m).all():
            return None
        p = _rotation_matrix_to_euler_degrees(m)
        return {k: round(_wrap180(v), 1) for k, v in p.items()}
    except Exception:
        return None


def gaze_from_landmarks(landmarks: Sequence[Any], frame_w: int) -> Optional[Dict[str, float]]:
    """
    Horizontal iris offset per eye: ratio = (iris_x - outer_x) / (inner_x - outer_x); deviation = |ratio - 0.5| * 2
    (0 centred, 1 at an eye corner), averaged over both eyes. `eyeSpanPx` is the mean eye width in pixels, used to refuse
    to report gaze on tiny eyes. `side` is image-space: "left" / "right" / "centre".
    """
    try:
        devs, signed, spans = [], [], []
        for corners, iris in ((_LEFT_EYE_CORNERS, _LEFT_IRIS_CENTER), (_RIGHT_EYE_CORNERS, _RIGHT_IRIS_CENTER)):
            a, b, c = landmarks[corners[0]], landmarks[corners[1]], landmarks[iris]
            lo, hi = (a, b) if a.x <= b.x else (b, a)      # image-left corner, image-right corner
            span = hi.x - lo.x
            if span < 1e-6:
                continue
            ratio = (c.x - lo.x) / span
            devs.append(abs(ratio - 0.5) * 2)
            signed.append((ratio - 0.5) * 2)
            spans.append(span * frame_w)
        if not devs:
            return None
        mean_signed = sum(signed) / len(signed)
        return {
            "deviation": round(sum(devs) / len(devs), 3),
            "side": "centre" if abs(mean_signed) < 0.1 else ("right" if mean_signed > 0 else "left"),
            "eyeSpanPx": round(sum(spans) / len(spans), 1),
        }
    except (IndexError, AttributeError, TypeError):
        return None


def gaze_assessment(landmarks: Optional[Sequence[Any]], pose: Optional[Dict[str, float]], quality: Dict[str, Any], frame_w: int,
                    landmark_model: bool) -> Dict[str, Any]:
    """Returns {status: ok|low_confidence|unavailable, deviation?, side?, reason?}. Never a number without a status."""
    if not landmark_model or landmarks is None:
        return {"status": "unavailable", "reason": "needs_landmark_model", "deviation": None}
    raw = gaze_from_landmarks(landmarks, frame_w)
    if raw is None:
        return {"status": "unavailable", "reason": "eye_landmarks_missing", "deviation": None}
    if not quality.get("usable", True):
        return {"status": "low_confidence", "reason": "poor_image_quality", "deviation": None}
    if pose is not None and abs(pose.get("yaw", 0.0)) > config.FACE_GAZE_MAX_YAW_DEGREES:
        return {"status": "low_confidence", "reason": "head_turned_too_far", "deviation": None}
    if raw["eyeSpanPx"] < config.FACE_GAZE_MIN_EYE_PX:
        return {"status": "low_confidence", "reason": "eyes_too_small_in_frame", "deviation": None}
    return {"status": "ok", "deviation": raw["deviation"], "side": raw["side"], "reason": None,
            "note": "Horizontal iris offset only; not an eye tracker."}


# --------------------------------------------------------------------------------------------------------------------
# Detectors
# --------------------------------------------------------------------------------------------------------------------
class HaarDetector:
    name = "opencv_haar"
    has_landmarks = False

    def __init__(self):
        self._cascade = None
        self._lock = threading.Lock()

    def detect(self, bgr: np.ndarray) -> Detection:
        if self._cascade is None:
            self._cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        with self._lock:
            out = self._cascade.detectMultiScale3(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40), outputRejectLevels=True)
        boxes, _levels, weights = out
        faces = []
        for i, b in enumerate(list(boxes)):
            score = float(weights[i]) if i < len(weights) else None
            faces.append(Face(box=tuple(float(v) for v in b), score=score))
        return Detection(self.name, faces[: config.FACE_MAX_FACES])


class MediaPipeDetector:
    name = "mediapipe_landmarker"
    has_landmarks = True

    def __init__(self, model_path: str):
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision
        self._mp = mp
        options = mp_vision.FaceLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=model_path),
            num_faces=config.FACE_MAX_FACES,
            output_facial_transformation_matrixes=True,
            running_mode=mp_vision.RunningMode.IMAGE,
        )
        self._landmarker = mp_vision.FaceLandmarker.create_from_options(options)
        self._lock = threading.Lock()   # the task object is not documented as thread-safe

    def detect(self, bgr: np.ndarray) -> Detection:
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=rgb)
        with self._lock:
            result = self._landmarker.detect(image)
        faces: List[Face] = []
        matrices = result.facial_transformation_matrixes or []
        for i, lms in enumerate(result.face_landmarks or []):
            xs, ys = [p.x for p in lms], [p.y for p in lms]
            x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
            pose = head_pose_from_matrix(matrices[i]) if i < len(matrices) else None
            faces.append(Face(box=(x0 * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h), score=None, landmarks=lms, pose=pose))
        return Detection(self.name, faces)


class SFaceRecognizer:
    """OpenCV's SFace face-embedding model (ONNX). Used only when its model file is configured; embeddings stay in memory."""
    name = "opencv_sface"

    def __init__(self, model_path: str):
        self._rec = cv2.FaceRecognizerSF.create(model_path, "")

    @staticmethod
    def face_row(face: Face, w: int, h: int) -> Optional[np.ndarray]:
        """The 15-value row SFace.alignCrop expects: box, right eye, left eye, nose, right mouth corner, left mouth corner, score."""
        lms = face.landmarks
        if lms is None or len(lms) < 478:
            return None
        pt = lambda i: (lms[i].x * w, lms[i].y * h)  # noqa: E731
        eyes = sorted([pt(_LEFT_IRIS_CENTER), pt(_RIGHT_IRIS_CENTER)])        # smaller x first = the subject's right eye
        mouth = sorted([pt(61), pt(291)])
        nose = pt(1)
        x, y, bw, bh = face.box
        return np.array([x, y, bw, bh, *eyes[0], *eyes[1], *nose, *mouth[0], *mouth[1], 1.0], dtype=np.float32)

    def embed(self, bgr: np.ndarray, face: Face) -> Optional[np.ndarray]:
        h, w = bgr.shape[:2]
        row = self.face_row(face, w, h)
        if row is None:
            return None
        aligned = self._rec.alignCrop(bgr, row)
        feat = np.asarray(self._rec.feature(aligned), dtype=np.float32).ravel()
        return feat.copy() if feat.size else None


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# --------------------------------------------------------------------------------------------------------------------
# Session-scoped references (memory only, expiring, never written to disk or returned to any caller)
# --------------------------------------------------------------------------------------------------------------------
class ReferenceStore:
    def __init__(self, ttl_seconds: float, max_items: int, clock=time.monotonic):
        self._ttl, self._max, self._clock = ttl_seconds, max_items, clock
        self._items: Dict[str, Tuple[float, np.ndarray]] = {}
        self._lock = threading.Lock()

    def _purge(self):
        now = self._clock()
        for k in [k for k, (t, _) in self._items.items() if now - t > self._ttl]:
            del self._items[k]

    def put(self, key: str, embedding: np.ndarray) -> None:
        with self._lock:
            self._purge()
            if key not in self._items and len(self._items) >= self._max:
                oldest = min(self._items, key=lambda k: self._items[k][0])
                del self._items[oldest]
            self._items[key] = (self._clock(), embedding)

    def get(self, key: str) -> Optional[np.ndarray]:
        with self._lock:
            self._purge()
            item = self._items.get(key)
            return item[1] if item else None

    def delete(self, key: str) -> bool:
        with self._lock:
            return self._items.pop(key, None) is not None

    def __len__(self):
        with self._lock:
            self._purge()
            return len(self._items)


# --------------------------------------------------------------------------------------------------------------------
# The analyser
# --------------------------------------------------------------------------------------------------------------------
class FaceAnalyzer:
    def __init__(self, detector, recognizer=None, references: Optional[ReferenceStore] = None):
        self.detector = detector
        self.recognizer = recognizer
        self.references = references or ReferenceStore(config.FACE_REFERENCE_TTL_SECONDS, config.FACE_MAX_REFERENCES)

    # ---- availability --------------------------------------------------------------------------------------------
    def features(self) -> Dict[str, Any]:
        has_lm = bool(getattr(self.detector, "has_landmarks", False))
        identity_ok = self.recognizer is not None and has_lm
        return {
            "detector": self.detector.name,
            "faceDetection": {"state": "available", "note": "frontal faces only" if not has_lm else None},
            "multipleFaces": {"state": "available", "note": "frontal faces only" if not has_lm else None},
            "headPose": {"state": "available" if has_lm else "unavailable", "reason": None if has_lm else "needs_landmark_model"},
            "gaze": {"state": "available" if has_lm else "unavailable", "reason": None if has_lm else "needs_landmark_model",
                     "note": "rough horizontal iris offset; not an eye tracker" if has_lm else None},
            "identity": {"state": "available" if identity_ok else "not_configured",
                         "reason": None if identity_ok else ("needs_landmark_model" if self.recognizer is not None else "needs_recognition_model")},
            "imageQuality": {"state": "available"},
        }

    # ---- one frame -----------------------------------------------------------------------------------------------
    def analyze(self, bgr: np.ndarray, reference_key: Optional[str] = None) -> Dict[str, Any]:
        h, w = bgr.shape[:2]
        quality = measure_quality(bgr)
        detection = self.detector.detect(bgr)
        min_h = config.FACE_MIN_FACE_RATIO * h
        faces = [f for f in detection.faces if f.box[3] >= min_h]
        ignored_small = len(detection.faces) - len(faces)
        faces.sort(key=lambda f: f.box[2] * f.box[3], reverse=True)

        notes: List[str] = []
        if ignored_small:
            notes.append(f"{ignored_small} very small face-like region(s) were ignored (smaller than {int(config.FACE_MIN_FACE_RATIO * 100)}% of the frame height).")

        primary = faces[0] if faces else None
        issues = list(quality["issues"])
        if primary is not None:
            size = primary.box[3] / h
            if size < 0.18:
                issues.append("face_too_small")
            elif size > 0.85:
                issues.append("face_too_close")
            x, y, bw, bh = primary.box
            m = 0.01
            if x <= m * w or y <= m * h or x + bw >= (1 - m) * w or y + bh >= (1 - m) * h:
                issues.append("face_partly_out_of_frame")
        quality = {**quality, "issues": issues, "hints": sorted({HINTS[i] for i in issues if i in HINTS})}

        if faces:
            face_state, count = "face_present", len(faces)
        elif not quality["usable"]:
            face_state, count = "unusable_frame", None      # cannot conclude anyone is absent from a dark/blurred frame
            notes.append("The frame was too dark, bright or blurry to tell whether a face is present.")
        else:
            face_state, count = "no_face", 0

        has_lm = bool(getattr(self.detector, "has_landmarks", False))
        pose_block: Dict[str, Any]
        if primary is None:
            pose_block = {"status": "unavailable", "reason": "no_face", "yaw": None, "pitch": None, "roll": None}
            gaze = {"status": "unavailable", "reason": "no_face", "deviation": None}
        else:
            if not has_lm:
                pose_block = {"status": "unavailable", "reason": "needs_landmark_model", "yaw": None, "pitch": None, "roll": None}
            elif primary.pose is None:
                pose_block = {"status": "unavailable", "reason": "pose_not_returned", "yaw": None, "pitch": None, "roll": None}
            else:
                low = not quality["usable"]
                pose_block = {"status": "low_confidence" if low else "ok", "reason": "poor_image_quality" if low else None, **primary.pose}
            gaze = gaze_assessment(primary.landmarks, primary.pose, quality, w, has_lm)
            if len(faces) > 1:
                notes.append("Head pose and gaze describe the largest face only.")

        return {
            "schemaVersion": SCHEMA_VERSION,
            "detector": detection.detector,
            "frame": {"width": w, "height": h},
            "quality": quality,
            "faceState": face_state,
            "faceCount": count,
            "faces": [{"box": _normalise_box(f, w, h), "score": None if f.score is None else round(f.score, 3), "sizeRatio": round(f.box[3] / h, 3)} for f in faces],
            "faceConfidence": None,
            "faceConfidenceNote": "The detectors do not report a calibrated probability, so no confidence percentage is given.",
            "headPose": pose_block,
            "gaze": gaze,
            "identity": self._identity(bgr, primary, quality, reference_key),
            "notes": notes,
        }

    # ---- identity --------------------------------------------------------------------------------------------------
    def _identity(self, bgr, primary: Optional[Face], quality, reference_key) -> Dict[str, Any]:
        base = {"similarity": None, "threshold": config.FACE_IDENTITY_SIMILARITY_THRESHOLD}
        has_lm = bool(getattr(self.detector, "has_landmarks", False))
        if self.recognizer is None or not has_lm:
            return {"status": "not_configured", "reason": "needs_recognition_model" if self.recognizer is None else "needs_landmark_model", **base}
        if not reference_key:
            return {"status": "not_configured", "reason": "no_reference_requested", **base}
        ref = self.references.get(reference_key)
        if ref is None:
            return {"status": "unavailable", "reason": "reference_missing_or_expired", **base}
        if primary is None:
            return {"status": "unavailable", "reason": "no_face", **base}
        if not quality["usable"]:
            return {"status": "unavailable", "reason": "poor_image_quality", **base}
        try:
            emb = self.recognizer.embed(bgr, primary)
        except Exception:
            return {"status": "unavailable", "reason": "recognition_failed", **base}
        if emb is None:
            return {"status": "unavailable", "reason": "landmarks_incomplete", **base}
        sim = round(cosine_similarity(ref, emb), 3)
        ok = sim >= config.FACE_IDENTITY_SIMILARITY_THRESHOLD
        return {"status": "verified" if ok else "verification_failed", "reason": None, "similarity": sim, "threshold": base["threshold"]}

    def store_reference(self, bgr: np.ndarray, key: str) -> Dict[str, Any]:
        """Captures the reference embedding (memory only). Requires one clear, roughly frontal face."""
        if self.recognizer is None or not getattr(self.detector, "has_landmarks", False):
            return {"status": "not_configured", "reason": "needs_recognition_model" if self.recognizer is None else "needs_landmark_model"}
        res = self.analyze(bgr)
        if res["faceCount"] != 1:
            return {"status": "rejected", "reason": "need_exactly_one_face" if res["faceCount"] else "no_face"}
        if not res["quality"]["usable"]:
            return {"status": "rejected", "reason": "poor_image_quality"}
        yaw = res["headPose"].get("yaw")
        if yaw is not None and abs(yaw) > 20:
            return {"status": "rejected", "reason": "face_not_frontal"}
        face = self.detector.detect(bgr).faces
        face = sorted([f for f in face if f.box[3] >= config.FACE_MIN_FACE_RATIO * bgr.shape[0]], key=lambda f: f.box[2] * f.box[3], reverse=True)
        if not face:
            return {"status": "rejected", "reason": "no_face"}
        emb = self.recognizer.embed(bgr, face[0])
        if emb is None:
            return {"status": "rejected", "reason": "landmarks_incomplete"}
        self.references.put(key, emb)
        return {"status": "stored", "reason": None}


# --------------------------------------------------------------------------------------------------------------------
# Process-wide analyser (lazy; a missing model never stops the service)
# --------------------------------------------------------------------------------------------------------------------
_analyzer: Optional[FaceAnalyzer] = None
_build_lock = threading.Lock()
_build_error: Optional[str] = None


def build_default_analyzer() -> FaceAnalyzer:
    if cv2 is None:
        raise VisionUnavailable()
    detector = None
    if config.FACE_LANDMARKER_MODEL_PATH and os.path.exists(config.FACE_LANDMARKER_MODEL_PATH):
        try:
            detector = MediaPipeDetector(config.FACE_LANDMARKER_MODEL_PATH)
        except Exception:
            detector = None
    if detector is None:
        detector = HaarDetector()
    recognizer = None
    path = config.FACE_RECOGNITION_MODEL_PATH
    if path and os.path.exists(path) and hasattr(cv2, "FaceRecognizerSF"):
        try:
            recognizer = SFaceRecognizer(path)
        except Exception:
            recognizer = None
    return FaceAnalyzer(detector, recognizer)


def get_analyzer() -> FaceAnalyzer:
    global _analyzer
    if _analyzer is None:
        with _build_lock:
            if _analyzer is None:
                _analyzer = build_default_analyzer()
    return _analyzer


def set_analyzer_for_tests(analyzer: Optional[FaceAnalyzer]) -> None:
    global _analyzer
    _analyzer = analyzer


def face_monitor_status() -> Dict[str, Any]:
    """Cheap and side-effect free: what could run, without loading a model."""
    if cv2 is None:
        return {"available": False, "state": "unavailable", "message": VisionUnavailable.message, "features": None}
    lm = bool(config.FACE_LANDMARKER_MODEL_PATH) and os.path.exists(config.FACE_LANDMARKER_MODEL_PATH)
    rec = bool(config.FACE_RECOGNITION_MODEL_PATH) and os.path.exists(config.FACE_RECOGNITION_MODEL_PATH) and hasattr(cv2, "FaceRecognizerSF")
    return {
        "available": True,
        "state": "complete" if lm else "face_presence_only",
        "message": "Face presence, count, image quality" + (", head pose and rough gaze" if lm else "") + (" and a same-person check are available." if (lm and rec) else " are available."),
        "features": {
            "faceDetection": True, "multipleFaces": True, "imageQuality": True,
            "headPose": lm, "gaze": lm, "identity": bool(lm and rec),
        },
        "landmarkModelFound": lm, "recognitionModelFound": rec,
    }
