"""
Computer-vision frame analysis: face presence (OpenCV, fully offline) and,
where the optional MediaPipe landmark model is available, head pose and
gaze-deviation estimation.

HONESTY NOTE: this module reports MEASURABLE VISUAL SIGNALS ONLY — face
presence, head rotation angles, and a normalized iris-position deviation.
It does NOT attempt emotion detection, personality inference, attention
"scoring", confidence judgments, or any other speculative psychological
claim. Every returned metric traces back to a specific, documented
calculation below; nothing is an opaque "AI judgment."

Two independent capabilities, with two different availability stories:

1. Face presence — cv2's bundled Haar Cascade classifier
   (haarcascade_frontalface_default.xml, shipped inside the opencv-python
   package itself, no external download). Always available wherever
   opencv-python is installed.

2. Head pose + gaze deviation — MediaPipe's FaceLandmarker Task. This
   requires a separately-downloaded `.task` model asset (NOT bundled with
   the `mediapipe` pip package) at config.FACE_LANDMARKER_MODEL_PATH. If
   that file isn't present, every field that depends on it is `None` —
   never fabricated — while face-presence detection still works
   normally, since it doesn't depend on this model at all.
"""
import math
import base64
import os
from typing import Optional, List, Dict, Any

import numpy as np

try:
    import cv2
except ImportError:  # OpenCV is an optional extra (requirements-vision.txt). The rest of the service must still start.
    cv2 = None
if cv2 is not None and not hasattr(cv2, "CascadeClassifier"):
    # An OpenCV build without the classic object-detection module (e.g. a 5.x preview) cannot detect faces here.
    cv2 = None

from app import config
from app.services import camera_signals
from app.config import (
    MAX_FRAMES_ANALYZED, MAX_FRAME_DIMENSION, MAX_SOURCE_DIMENSION, MAX_VIDEO_DURATION_SECONDS,
    FACE_LANDMARKER_MODEL_PATH, GAZE_DEVIATION_THRESHOLD, HEAD_YAW_THRESHOLD_DEGREES,
)


class VisionUnavailable(Exception):
    """Visual analysis cannot run in this deployment (OpenCV is not installed). Mapped to HTTP 503 `vision_unavailable`."""

    message = "Visual analysis is not installed on the AI service (OpenCV is missing). It is optional; the interview works without it."
    code = "vision_unavailable"


def vision_status() -> Dict[str, Any]:
    """
    What this deployment can do, without loading any model:
      available          - OpenCV is importable (face presence works)
      landmarkModelFound - the optional MediaPipe .task file exists (head-pose/gaze work)
    """
    found = bool(FACE_LANDMARKER_MODEL_PATH) and os.path.exists(FACE_LANDMARKER_MODEL_PATH)
    if cv2 is None:
        state, msg = "unavailable", VisionUnavailable.message
    elif found:
        state, msg = "complete", "Face presence, head direction and gaze direction can be measured."
    else:
        state, msg = "face_presence_only", "Face presence can be measured. Head direction and gaze need the optional MediaPipe model file."
    return {"available": cv2 is not None, "landmarkModelFound": found, "state": state, "message": msg}


class VideoRejected(Exception):
    """
    The upload can't be analyzed, for a reason the client can act on.
    `reason` is a stable machine-readable code:
        "invalid_media"     — not a readable video / no decodable frames
        "resolution_limit"  — longest side exceeds MAX_SOURCE_DIMENSION
        "duration_limit"    — known duration exceeds MAX_VIDEO_DURATION_SECONDS
    `message` is written to be shown to a client: it never contains a
    filesystem path, an exception repr, or any OpenCV/ffmpeg internals.
    The route maps this to HTTP 422 (well-formed request, unacceptable content).
    """

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


_face_cascade = None  # lazy — avoid the disk read until first real use
_face_landmarker = None
_face_landmarker_load_attempted = False

# MediaPipe FaceLandmarker (with iris refinement, which it applies by
# default) numbers landmarks 0-477; these specific indices are the
# well-documented eye-corner and iris-center points used by the official
# MediaPipe iris examples.
_LEFT_EYE_CORNERS = (33, 133)     # (outer, inner) - "left" is the subject's own left, which appears camera-right (frontal, unmirrored)
_LEFT_IRIS_CENTER = 468
_RIGHT_EYE_CORNERS = (362, 263)
_RIGHT_IRIS_CENTER = 473


def _get_face_cascade():
    global _face_cascade
    if _face_cascade is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        _face_cascade = cv2.CascadeClassifier(path)
    return _face_cascade


def _get_face_landmarker():
    """
    Returns a MediaPipe FaceLandmarker instance, or None if the model
    asset isn't present. Only attempts to load once per process — a
    missing model doesn't retry on every request (that would mean a
    filesystem stat on every single video), but it also never crashes
    the request; callers treat None as "landmark-based metrics
    unavailable for this request" and proceed with face-presence-only
    results.
    """
    global _face_landmarker, _face_landmarker_load_attempted
    if _face_landmarker is not None or _face_landmarker_load_attempted:
        return _face_landmarker
    _face_landmarker_load_attempted = True

    if not os.path.exists(FACE_LANDMARKER_MODEL_PATH):
        return None

    try:
        import mediapipe as mp
        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision as mp_vision

        base_options = mp_python.BaseOptions(model_asset_path=FACE_LANDMARKER_MODEL_PATH)
        kwargs = dict(
            base_options=base_options,
            num_faces=1,
            output_facial_transformation_matrixes=True,
            running_mode=mp_vision.RunningMode.IMAGE,
        )
        try:
            # Blendshapes (52 facial-action coefficients) feed the "expression variation" signal.
            _face_landmarker = mp_vision.FaceLandmarker.create_from_options(mp_vision.FaceLandmarkerOptions(output_face_blendshapes=True, **kwargs))
        except TypeError:
            # An older MediaPipe without that option: everything else still works, expression variation is just unavailable.
            _face_landmarker = mp_vision.FaceLandmarker.create_from_options(mp_vision.FaceLandmarkerOptions(**kwargs))
    except Exception:
        # Any failure (missing system deps, corrupt model file, etc.) —
        # landmark-based metrics simply stay unavailable for this process.
        _face_landmarker = None
    return _face_landmarker


def _finite(value: Any, default: float = 0.0) -> float:
    """float(value) if it is a finite number, else `default` — guards against None, NaN and +/-Infinity from container metadata."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


def probe_video(video_path: str) -> Optional[Dict[str, Any]]:
    """
    Reads container metadata via OpenCV without decoding frames. Returns
    None if the file can't be opened as a video at all. Otherwise:
        { width, height, fps, frame_count, duration_seconds }
    where fps / frame_count / duration_seconds are None when the container
    doesn't report a trustworthy value. Browser-recorded WebM (what
    MediaRecorder typically produces) very commonly lacks duration
    metadata and can report a bogus frame rate, so "unknown" is a normal,
    expected outcome here — not an error. The VideoCapture is always
    released, including when the file fails to open.
    """
    cap = None
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return None
        width = int(_finite(cap.get(cv2.CAP_PROP_FRAME_WIDTH)))
        height = int(_finite(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)))
        fps_raw = _finite(cap.get(cv2.CAP_PROP_FPS))
        count_raw = int(_finite(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
    except cv2.error:
        return None
    finally:
        if cap is not None:
            cap.release()

    # Implausible values are "unknown", never used in arithmetic: non-positive,
    # or a frame rate above 240 (WebM sometimes reports 1000 as a placeholder),
    # or a frame count that's non-positive / absurdly large.
    fps = fps_raw if 0 < fps_raw <= 240 else None
    frame_count = count_raw if 0 < count_raw < 10_000_000 else None
    duration = round(frame_count / fps, 3) if (fps and frame_count) else None  # fps > 0 here, so no division by zero

    return {
        "width": width, "height": height,
        "fps": round(fps, 3) if fps else None,
        "frame_count": frame_count,
        "duration_seconds": duration,
    }


def sample_frames_from_capture(cap, max_frames: int = MAX_FRAMES_ANALYZED, max_dimension: int = MAX_FRAME_DIMENSION,
                               max_read_frames: Optional[int] = None):
    """Frames only (see sample_frames_indexed_from_capture for the version that also returns each frame's position)."""
    kept, index, capped = sample_frames_indexed_from_capture(cap, max_frames, max_dimension, max_read_frames)
    return [f for _, f in kept], index, capped


def sample_frames_indexed_from_capture(cap, max_frames: int = MAX_FRAMES_ANALYZED, max_dimension: int = MAX_FRAME_DIMENSION,
                                       max_read_frames: Optional[int] = None):
    """
    Reads an opened capture ONCE, front to back, and keeps at most `max_frames` frames spaced evenly across the
    WHOLE clip, without needing to know the clip length in advance.

    Why: browser-recorded WebM (what MediaRecorder produces) usually reports no usable frame count, and the previous
    "read the first N frames" fallback therefore analysed only the first second or two of an answer. Here every frame is
    decoded with grab() (cheap) but only every `stride`-th one is retrieved; whenever more than `max_frames` are held,
    every other kept frame is dropped and the stride doubles, so the kept frames always stay evenly spaced.

    Returns (kept, frames_read, hit_read_cap) where `kept` is a list of (frame index, frame). `hit_read_cap` is True when reading stopped at `max_read_frames`
    (the clip was longer than the service analyses), so callers can say so instead of silently truncating.
    """
    if max_read_frames is None:
        max_read_frames = int(MAX_VIDEO_DURATION_SECONDS * 60)
    kept: List[Any] = []   # (frame index, downscaled frame)
    stride = 1
    index = 0
    while index < max_read_frames:
        if not cap.grab():
            break
        if index % stride == 0:
            ok, frame = cap.retrieve()
            if ok and frame is not None:
                kept.append((index, _downscale(frame, max_dimension)))
                if len(kept) > max_frames:
                    kept = kept[::2]
                    stride *= 2
        index += 1
    return kept, index, index >= max_read_frames


def sample_frames(video_path: str, max_frames: int = MAX_FRAMES_ANALYZED,
                   max_dimension: int = MAX_FRAME_DIMENSION) -> List[Any]:
    """Compatibility wrapper: just the frames. Returns [] if the file can't be decoded at all."""
    return _sample(video_path, max_frames, max_dimension)[0]


def _sample_indexed(video_path: str, max_frames: int = MAX_FRAMES_ANALYZED, max_dimension: int = MAX_FRAME_DIMENSION):
    """(list of (frame index, frame), frames read, hit read cap). Empty when the file cannot be decoded."""
    cap = None
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return [], 0, False
        return sample_frames_indexed_from_capture(cap, max_frames, max_dimension)
    except cv2.error:
        return [], 0, False
    finally:
        if cap is not None:
            cap.release()


def _sample(video_path: str, max_frames: int = MAX_FRAMES_ANALYZED, max_dimension: int = MAX_FRAME_DIMENSION):
    kept, read, capped = _sample_indexed(video_path, max_frames, max_dimension)
    return [f for _, f in kept], read, capped


def _downscale(frame, max_dimension: int):
    h, w = frame.shape[:2]
    longest = max(h, w)
    if longest <= max_dimension:
        return frame
    scale = max_dimension / longest
    return cv2.resize(frame, (int(w * scale), int(h * scale)))


def _detect_face_boxes(frame) -> list:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    cascade = _get_face_cascade()
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
    return list(faces)


def _rotation_matrix_to_euler_degrees(m: np.ndarray) -> Dict[str, float]:
    """
    Standard extraction of yaw/pitch/roll (in degrees) from a 3x3 rotation
    matrix, using the conventional camera-space axes: X = right, Y = down,
    Z = forward (out of the camera). yaw = rotation about Y, pitch =
    rotation about X, roll = rotation about Z. This is the same
    matrix-to-Euler-angle formula used throughout classical computer
    vision (e.g. OpenCV's own documentation for solvePnP results).
    """
    sy = math.sqrt(m[0, 0] ** 2 + m[1, 0] ** 2)
    singular = sy < 1e-6
    if not singular:
        pitch = math.atan2(m[2, 1], m[2, 2])
        yaw = math.atan2(-m[2, 0], sy)
        roll = math.atan2(m[1, 0], m[0, 0])
    else:
        pitch = math.atan2(-m[1, 2], m[1, 1])
        yaw = math.atan2(-m[2, 0], sy)
        roll = 0.0
    return {
        "yaw": round(math.degrees(yaw), 1),
        "pitch": round(math.degrees(pitch), 1),
        "roll": round(math.degrees(roll), 1),
    }


def _gaze_deviation_from_landmarks(landmarks) -> Optional[float]:
    """
    Normalized iris-position deviation from center, averaged over both
    eyes. For each eye: horizontal_ratio = (iris_x - outer_corner_x) /
    (inner_corner_x - outer_corner_x), which is 0 at the outer corner, 1
    at the inner corner, ~0.5 when centered. deviation = abs(ratio - 0.5) * 2,
    so 0 = perfectly centered, 1 = iris at an eye corner. Returns None if
    the expected landmark indices aren't present in this result.
    """
    try:
        def eye_deviation(outer_idx, inner_idx, iris_idx):
            outer, inner, iris = landmarks[outer_idx], landmarks[inner_idx], landmarks[iris_idx]
            span = inner.x - outer.x
            if abs(span) < 1e-6:
                return None
            ratio = (iris.x - outer.x) / span
            return abs(ratio - 0.5) * 2

        left = eye_deviation(*_LEFT_EYE_CORNERS, _LEFT_IRIS_CENTER)
        right = eye_deviation(*_RIGHT_EYE_CORNERS, _RIGHT_IRIS_CENTER)
        values = [v for v in (left, right) if v is not None]
        return round(sum(values) / len(values), 3) if values else None
    except (IndexError, AttributeError):
        return None


def _average_head_pose(head_poses: List[Dict[str, float]]) -> Optional[Dict[str, float]]:
    """Arithmetic mean per axis across frames with a pose; None if there were none (never a fabricated 0,0,0)."""
    if not head_poses:
        return None
    n = len(head_poses)
    return {
        "yaw": round(sum(p["yaw"] for p in head_poses) / n, 1),
        "pitch": round(sum(p["pitch"] for p in head_poses) / n, 1),
        "roll": round(sum(p["roll"] for p in head_poses) / n, 1),
    }


def analyze_video(video_path: str) -> Dict[str, Any]:
    """
    Full pipeline: probe → enforce limits → sample frames → Haar Cascade
    face presence per frame → (if the landmark model is available)
    MediaPipe head pose + gaze deviation per frame → aggregate to
    answer-level metrics. Deterministic given the same video and the same
    model availability — no randomness anywhere in this pipeline.

    Raises VideoRejected (reason "invalid_media" / "resolution_limit" /
    "duration_limit") if the video can't or shouldn't be analyzed — those
    are conveyed as HTTP errors by the route, never as a 200 carrying a
    fake status. A returned dict therefore always means an analysis really
    ran, with analysisStatus "complete" (landmark model available) or
    "model_unavailable" (face presence only; landmark metrics null).

    Metric definitions:
      facePresenceRatio  = framesWithFace / framesAnalyzed, where "face" means
                           OpenCV's frontal-face Haar Cascade fired on that
                           frame. NOTE: that detector is frontal-only, so a
                           strongly turned head can read as "no face" —
                           this ratio can understate presence during turns.
      landmark metrics   = computed by MediaPipe on EVERY sampled frame
                           (independent of the Haar result — gating them on
                           Haar would silently drop exactly the turned-away
                           frames lookingAwayRatio is meant to capture).
      lookingAwayRatio   = frames flagged looking-away / frames where gaze or
                           head pose was actually measurable (frames with no
                           landmark result are excluded from BOTH numerator
                           and denominator, not counted as "not looking away").
    """
    if cv2 is None:
        raise VisionUnavailable()
    info = probe_video(video_path)
    if info is None or info["width"] <= 0 or info["height"] <= 0:
        raise VideoRejected("invalid_media", "The uploaded file could not be read as a video.")

    if max(info["width"], info["height"]) > MAX_SOURCE_DIMENSION:
        raise VideoRejected(
            "resolution_limit",
            f"Video resolution {info['width']}x{info['height']} exceeds the maximum allowed "
            f"({MAX_SOURCE_DIMENSION}px on the longest side).",
        )
    if info["duration_seconds"] is not None and info["duration_seconds"] > MAX_VIDEO_DURATION_SECONDS:
        raise VideoRejected(
            "duration_limit",
            f"Video duration {info['duration_seconds']}s exceeds the maximum allowed ({MAX_VIDEO_DURATION_SECONDS}s).",
        )
    # If duration is unknown (common for browser-recorded WebM), the
    # sequential-read fallback in sample_frames() still hard-caps how many
    # frames are ever decoded, so cost stays bounded regardless.

    indexed, frames_in_clip, clip_truncated = _sample_indexed(video_path)
    frames = [f for _, f in indexed]
    frames_analyzed = len(frames)
    if frames_analyzed == 0:
        raise VideoRejected("invalid_media", "No frames could be decoded from the uploaded video.")

    landmarker = _get_face_landmarker()

    frames_with_face = 0
    gaze_values, head_poses, looking_away_flags = [], [], []
    records: List[Dict[str, Any]] = []
    span = max(frames_in_clip - 1, 1)

    for index, frame in indexed:
        face_here = len(_detect_face_boxes(frame)) > 0
        if face_here:
            frames_with_face += 1
        record: Dict[str, Any] = {"t": min(1.0, index / span), "face": face_here}
        if landmarker is not None:
            feats = _landmark_features(frame, landmarker)
            if feats is not None:
                gaze, pose = feats["gaze"], feats["pose"]
                if pose is not None:
                    head_poses.append(pose)
                if gaze is not None:
                    gaze_values.append(gaze)
                away = (gaze is not None and gaze > GAZE_DEVIATION_THRESHOLD) or (pose is not None and abs(pose["yaw"]) > HEAD_YAW_THRESHOLD_DEGREES)
                if gaze is not None or pose is not None:
                    looking_away_flags.append(away)
                record.update({
                    "gaze": gaze, "blend": feats["blend"], "box": feats["box"],
                    **({"yaw": pose["yaw"], "pitch": pose["pitch"], "roll": pose["roll"]} if pose else {}),
                })
                record["face"] = True  # the landmark model found a face even if the Haar cascade missed it
        records.append(record)

    face_presence_ratio = round(frames_with_face / frames_analyzed, 3)
    result: Dict[str, Any] = {
        "analysisStatus": "complete" if landmarker is not None else "model_unavailable",
        "framesAnalyzed": frames_analyzed,
        "framesWithFace": frames_with_face,
        "facePresenceRatio": face_presence_ratio,
        "facePresent": face_presence_ratio > 0.5,
        # How much of the clip the sample covers: frames_in_clip is how many frames were read; the analysed frames are
        # spread evenly over all of them. clipTruncated means the clip was longer than the service analyses.
        "framesInClip": frames_in_clip,
        "clipTruncated": bool(clip_truncated),
    }

    if landmarker is None:
        result.update({
            "framesWithGaze": None, "framesWithHeadPose": None,
            "lookingAwayRatio": None, "averageGazeDeviation": None, "headPose": None,
        })
    else:
        result["framesWithGaze"] = len(gaze_values)
        result["framesWithHeadPose"] = len(head_poses)
        result["averageGazeDeviation"] = round(sum(gaze_values) / len(gaze_values), 3) if gaze_values else None
        result["lookingAwayRatio"] = (
            round(sum(looking_away_flags) / len(looking_away_flags), 3) if looking_away_flags else None
        )
        result["headPose"] = _average_head_pose(head_poses)

    # Derived camera signals (display only; never part of a score). All None when the landmark model is unavailable.
    fps = None
    info = probe_video(video_path)
    if info and info.get("fps"):
        fps = info["fps"]
    duration = (frames_in_clip / fps) if (fps and frames_in_clip) else (info.get("duration_seconds") if info else None)
    if landmarker is None:
        result.update({"eyeContactRatio": None, "facingCameraRatio": None, "headMovement": None, "expressionVariation": None, "framing": None,
                       "timeline": camera_signals.build_timeline(records, duration)})
    else:
        sig = camera_signals.summarize(records, duration)
        sig["eyeContactRatio"] = round(1 - result["lookingAwayRatio"], 3) if result.get("lookingAwayRatio") is not None else None
        result.update(sig)
    result["snapshots"] = _snapshots(frames, records) if (landmarker is not None and config.ANSWER_SNAPSHOTS) else None
    return result


def _encode_snapshot(frame) -> Optional[str]:
    """A small JPEG data URI of one frame, or None if it cannot be encoded."""
    try:
        h, w = frame.shape[:2]
        if w > config.SNAPSHOT_WIDTH:
            frame = cv2.resize(frame, (config.SNAPSHOT_WIDTH, max(1, int(h * config.SNAPSHOT_WIDTH / w))), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), config.SNAPSHOT_JPEG_QUALITY])
        if not ok:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        return None


def _snapshots(frames, records) -> Optional[List[Dict[str, Any]]]:
    out = []
    for pick in camera_signals.pick_snapshots(records):
        image = _encode_snapshot(frames[pick["index"]])
        if image:
            out.append({"t": pick["t"], "kinds": pick["kinds"], "image": image})
    return out or None


def _landmark_features(frame, landmarker) -> Optional[Dict[str, Any]]:
    """Everything the landmark model says about ONE frame: gaze offset, head angles (folded to +-180), blendshape coefficients
    and the face's bounding box as fractions of the picture. None when the model found no face or failed on this frame."""
    import mediapipe as mp

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    try:
        detection = landmarker.detect(mp_image)
    except Exception:
        return None
    if not detection.face_landmarks:
        return None
    landmarks = detection.face_landmarks[0]
    feats: Dict[str, Any] = {"gaze": _gaze_deviation_from_landmarks(landmarks), "pose": None, "blend": None, "box": None}
    if detection.facial_transformation_matrixes:
        matrix = np.array(detection.facial_transformation_matrixes[0])[:3, :3]
        pose = _rotation_matrix_to_euler_degrees(matrix)
        feats["pose"] = {k: ((v + 180.0) % 360.0) - 180.0 for k, v in pose.items()}
    blends = getattr(detection, "face_blendshapes", None)
    if blends:
        try:
            feats["blend"] = {c.category_name: float(c.score) for c in blends[0] if c.category_name}
        except (AttributeError, TypeError, ValueError):
            feats["blend"] = None
    try:
        xs = [l.x for l in landmarks]
        ys = [l.y for l in landmarks]
        feats["box"] = (min(xs), max(xs), min(ys), max(ys))
    except (AttributeError, TypeError, ValueError):
        feats["box"] = None
    return feats
