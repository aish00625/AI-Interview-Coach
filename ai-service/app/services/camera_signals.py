"""
Camera signals for one interview answer, derived from the per-frame measurements of the sampled video frames.

What this module is: arithmetic on numbers that were already measured (face present, head angles, iris offset, face-landmark
"blendshape" coefficients, face position). Pure numpy/Python, so it is unit-tested without a camera or a model.

What it is NOT, on purpose:
  * It does not name emotions, mood, confidence, attention, honesty or personality. "Expression variation" is only HOW MUCH the
    brow / eye-squint / smile / cheek / nose movement changed from frame to frame, never what it means. Mouth and jaw movement is
    excluded because speaking causes it.
  * "Position in frame" is about where the HEAD sits in the picture. It says nothing about body posture.
  * Nothing here feeds a score. A value that could not be measured is None, never 0.
  * The level cut-offs are rough, configurable and not validated against any study.
"""
import math
from typing import Any, Dict, List, Optional, Sequence

from app import config

# Facial-action channels whose frame-to-frame change counts as "expression variation". Jaw, mouth open/close/pucker/funnel,
# tongue and cheek-puff are left out because talking moves them; blinks and eye-look channels are left out because they are
# not expression (gaze is measured separately).
EXPRESSION_CHANNELS = (
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
    "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
    "cheekSquintLeft", "cheekSquintRight", "noseSneerLeft", "noseSneerRight",
)

MAX_TIMELINE_POINTS = 60


def _finite(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _std(values: Sequence[float]) -> float:
    n = len(values)
    if n < 2:
        return 0.0
    m = sum(values) / n
    return math.sqrt(sum((v - m) ** 2 for v in values) / n)


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, v))


def wrap180(angle: float) -> float:
    """Folds an angle into [-180, 180) so a head that is simply upright never reads as "180 degrees"."""
    return (angle + 180.0) % 360.0 - 180.0


def facing_flag(rec: Dict[str, Any]) -> Optional[bool]:
    """True when a face is present and the head and eyes point roughly at the camera; False when no face is in the picture. None
    when a face is there but there are no landmarks to judge direction from, so the frame is simply not counted."""
    if not rec.get("face"):
        return False  # no face in the picture, so not facing the camera
    yaw, pitch, gaze = _finite(rec.get("yaw")), _finite(rec.get("pitch")), _finite(rec.get("gaze"))
    if yaw is None and gaze is None:
        return None
    if yaw is not None and abs(yaw) > config.HEAD_YAW_THRESHOLD_DEGREES:
        return False
    if pitch is not None and abs(pitch) > config.HEAD_PITCH_THRESHOLD_DEGREES:
        return False
    if gaze is not None and gaze > config.GAZE_DEVIATION_THRESHOLD:
        return False
    return True


def _expression_vector(blend: Optional[Dict[str, float]]) -> Optional[List[float]]:
    if not blend:
        return None
    vec = []
    for name in EXPRESSION_CHANNELS:
        v = _finite(blend.get(name))
        if v is None:
            return None
        vec.append(v)
    return vec


def head_movement(records: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    poses = [(r["yaw"], r["pitch"], r["roll"]) for r in records if all(_finite(r.get(k)) is not None for k in ("yaw", "pitch", "roll"))]
    if len(poses) < config.SIGNALS_MIN_FRAMES:
        return None
    # Angles are compared circularly (relative to the first frame), so +179 and -179 degrees are 2 degrees apart, not 358.
    yaw, pitch, roll = ([wrap180(p[i] - poses[0][i]) for p in poses] for i in range(3))
    ys, ps, rs = _std(yaw), _std(pitch), _std(roll)
    steps = [(abs(wrap180(poses[i][0] - poses[i - 1][0])) + abs(wrap180(poses[i][1] - poses[i - 1][1]))) / 2 for i in range(1, len(poses))]
    spread = (ys + ps) / 2
    level = "low" if spread < config.HEAD_MOVEMENT_LOW_DEG else "high" if spread >= config.HEAD_MOVEMENT_HIGH_DEG else "moderate"
    return {"level": level, "yawSpread": round(ys, 1), "pitchSpread": round(ps, 1), "rollSpread": round(rs, 1),
            "meanChangeDeg": round(sum(steps) / len(steps), 1), "framesMeasured": len(poses)}


def expression_variation(records: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    vecs = [v for v in (_expression_vector(r.get("blend")) for r in records) if v is not None]
    if len(vecs) < config.SIGNALS_MIN_FRAMES:
        return None
    channels = len(EXPRESSION_CHANNELS)
    # Root-mean-square of each channel's spread: a big move in a few channels counts, instead of being averaged away by the rest.
    spread = math.sqrt(sum(_std([v[c] for v in vecs]) ** 2 for c in range(channels)) / channels)
    level = "low" if spread < config.EXPRESSION_VARIATION_LOW else "high" if spread >= config.EXPRESSION_VARIATION_HIGH else "moderate"
    return {"level": level, "spread": round(spread, 4), "framesMeasured": len(vecs)}


def framing(records: Sequence[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    boxes = [r["box"] for r in records if r.get("box") and all(_finite(x) is not None for x in r["box"])]
    if len(boxes) < config.SIGNALS_MIN_FRAMES:
        return None
    good = 0
    heights, cxs, cys = [], [], []
    for x0, x1, y0, y1 in boxes:
        h, cx, cy = y1 - y0, (x0 + x1) / 2, (y0 + y1) / 2
        heights.append(h); cxs.append(cx); cys.append(cy)
        if 0.2 <= h <= 0.7 and 0.3 <= cx <= 0.7 and 0.2 <= cy <= 0.7:
            good += 1
    ratio = good / len(boxes)
    mh, mx, my = sum(heights) / len(heights), sum(cxs) / len(cxs), sum(cys) / len(cys)
    hints = []
    if mh < 0.2:
        hints.append("Your face looked small in the picture. Sit a little closer to the camera.")
    elif mh > 0.7:
        hints.append("Your face filled most of the picture. Sit a little further back.")
    if mx < 0.3 or mx > 0.7:
        hints.append("Your face was off to one side. Centre it in the picture.")
    if my > 0.7:
        hints.append("Your face sat low in the picture. Raise the camera or sit a little higher.")
    elif my < 0.2:
        hints.append("Your face sat high in the picture. Lower the camera a little.")
    level = "good" if ratio >= 0.8 else "fair" if ratio >= 0.5 else "poor"
    return {"level": level, "wellFramedRatio": round(ratio, 3), "meanFaceHeight": round(mh, 3), "meanCentreX": round(mx, 3),
            "meanCentreY": round(my, 3), "hints": hints, "framesMeasured": len(boxes)}


def build_timeline(records: Sequence[Dict[str, Any]], duration_seconds: Optional[float]) -> Dict[str, Any]:
    """One point per sampled frame. `face` and `facing` are 1/0 (None = not measurable); `expression` and `head` are the size of the
    change since the previous measured frame, scaled to 0..1 (None when not measurable)."""
    points = []
    prev_expr: Optional[List[float]] = None
    prev_pose: Optional[tuple] = None
    for r in records[:MAX_TIMELINE_POINTS]:
        facing = facing_flag(r)
        vec = _expression_vector(r.get("blend"))
        expr = None
        if vec is not None and prev_expr is not None:
            diff = math.sqrt(sum((a - b) ** 2 for a, b in zip(vec, prev_expr)) / len(vec))
            expr = round(_clamp01(diff / 0.15), 3)
        if vec is not None:
            prev_expr = vec
        pose = tuple(r[k] for k in ("yaw", "pitch")) if all(_finite(r.get(k)) is not None for k in ("yaw", "pitch")) else None
        head = None
        if pose is not None and prev_pose is not None:
            head = round(_clamp01(((abs(wrap180(pose[0] - prev_pose[0])) + abs(wrap180(pose[1] - prev_pose[1]))) / 2) / 20.0), 3)
        if pose is not None:
            prev_pose = pose
        points.append({
            "t": round(_clamp01(float(r.get("t", 0.0))), 4),
            "face": 1 if r.get("face") else 0,
            "facing": None if facing is None else (1 if facing else 0),
            "expression": expr, "head": head,
        })
    return {"points": points, "durationSeconds": round(duration_seconds, 1) if duration_seconds else None}


def summarize(records: Sequence[Dict[str, Any]], duration_seconds: Optional[float] = None) -> Dict[str, Any]:
    """All derived signals for one answer. Every part is None when it could not be measured."""
    flags = [f for f in (facing_flag(r) for r in records) if f is not None]
    facing_ratio = round(sum(1 for f in flags if f) / len(flags), 3) if flags else None
    return {
        "facingCameraRatio": facing_ratio,
        "headMovement": head_movement(records),
        "expressionVariation": expression_variation(records),
        "framing": framing(records),
        "timeline": build_timeline(records, duration_seconds) if records else None,
    }


# ----------------------------------------------------------------------------------------------------------------------------
# Snapshots: which sampled frames best illustrate each signal. Chosen purely from the measurements above (no randomness), so the
# picture next to "Facing the camera" really is a frame that was measured as facing, and the one next to "looking away" really was
# flagged as looking away. A frame can illustrate several signals; it is returned once with all its kinds.
# ----------------------------------------------------------------------------------------------------------------------------
SNAPSHOT_KINDS = ("framed", "facing", "away", "noface", "turn", "expressive", "calm")


def _framing_error(rec: Dict[str, Any]) -> Optional[float]:
    box = rec.get("box")
    if not box or any(_finite(x) is None for x in box):
        return None
    x0, x1, y0, y1 = box
    return abs((x0 + x1) / 2 - 0.5) + abs((y0 + y1) / 2 - 0.45) + abs((y1 - y0) - 0.4)


def _deviation(rec: Dict[str, Any]) -> Optional[float]:
    """How far from "looking at the camera" a frame is, in units of its own thresholds (1.0 = exactly at the limit)."""
    parts = []
    yaw, pitch, gaze = _finite(rec.get("yaw")), _finite(rec.get("pitch")), _finite(rec.get("gaze"))
    if yaw is not None:
        parts.append(abs(yaw) / config.HEAD_YAW_THRESHOLD_DEGREES)
    if pitch is not None:
        parts.append(abs(pitch) / config.HEAD_PITCH_THRESHOLD_DEGREES)
    if gaze is not None:
        parts.append(gaze / config.GAZE_DEVIATION_THRESHOLD)
    return max(parts) if parts else None


def pick_snapshots(records: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Returns [{"index": position in records, "t": 0..1, "kinds": [...]}] for the frames worth showing, in time order."""
    chosen: Dict[int, List[str]] = {}

    def add(kind: str, index: Optional[int]) -> None:
        if index is not None:
            chosen.setdefault(index, []).append(kind)

    def best(candidates, key, largest=False):
        pool = [(key(i), i) for i in candidates if key(i) is not None]
        if not pool:
            return None
        return (max(pool) if largest else min(pool))[1]

    idx = range(len(records))
    with_face = [i for i in idx if records[i].get("face")]
    add("framed", best([i for i in with_face if _framing_error(records[i]) is not None], lambda i: _framing_error(records[i])))
    facing = [i for i in with_face if facing_flag(records[i]) is True]
    add("facing", best(facing, lambda i: _deviation(records[i])))
    away = [i for i in with_face if facing_flag(records[i]) is False]
    add("away", best(away, lambda i: _deviation(records[i]), largest=True))
    gone = [i for i in idx if not records[i].get("face")]
    add("noface", gone[len(gone) // 2] if gone else None)

    # Largest head turn away from the answer's typical pose.
    posed = [i for i in idx if all(_finite(records[i].get(k)) is not None for k in ("yaw", "pitch"))]
    if len(posed) >= config.SIGNALS_MIN_FRAMES:
        ys, ps = sorted(records[i]["yaw"] for i in posed), sorted(records[i]["pitch"] for i in posed)
        my, mp_ = ys[len(ys) // 2], ps[len(ps) // 2]
        dist = lambda i: (abs(wrap180(records[i]["yaw"] - my)) + abs(wrap180(records[i]["pitch"] - mp_))) / 2
        turn = best(posed, dist, largest=True)
        if turn is not None and dist(turn) >= config.HEAD_MOVEMENT_LOW_DEG:
            add("turn", turn)

    # Most and least expressive frames, measured against the answer's own average face.
    vecs = {i: _expression_vector(records[i].get("blend")) for i in idx}
    vecs = {i: v for i, v in vecs.items() if v is not None}
    if len(vecs) >= config.SIGNALS_MIN_FRAMES:
        n = len(next(iter(vecs.values())))
        mean = [sum(v[k] for v in vecs.values()) / len(vecs) for k in range(n)]
        away_from_mean = {i: math.sqrt(sum((v[k] - mean[k]) ** 2 for k in range(n)) / n) for i, v in vecs.items()}
        hi, lo = max(away_from_mean, key=away_from_mean.get), min(away_from_mean, key=away_from_mean.get)
        if away_from_mean[hi] - away_from_mean[lo] >= config.EXPRESSION_VARIATION_LOW / 2:
            add("expressive", hi)
            add("calm", lo)

    return [{"index": i, "t": round(_clamp01(float(records[i].get("t", 0.0))), 4), "kinds": kinds} for i, kinds in sorted(chosen.items())]
