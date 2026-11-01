"""
Audio pre-checks and light preprocessing (NumPy only, deterministic).

Why this exists: Whisper-style models are known to invent text ("Thank you.", "Thanks for watching") when they are
given silence or a very quiet recording, and a recording whose microphone level is too low is transcribed badly.
Rather than score such a recording as if it were an answer, we detect it first and tell the candidate to re-record.

Everything here works on a mono float32 waveform in [-1, 1] sampled at 16 kHz (what faster-whisper's decoder
produces), so it can be unit-tested with synthetic arrays and needs no audio library.

The thresholds are engineering defaults, not validated cut-offs; they only decide "can this be transcribed at all?",
never anything about the speaker's ability.
"""
from typing import Any, Dict

import numpy as np

SAMPLE_RATE = 16000
_FRAME_SECONDS = 0.03
_EPS = 1e-10

# Verdicts, from "fine" to "cannot use".
OK = "ok"
TOO_SHORT = "too_short"
SILENT = "silent"           # essentially no signal at all
NO_SPEECH = "no_speech"     # signal present but no part of it rises clearly above the background noise
TOO_QUIET = "too_quiet"     # speech-like energy exists but the overall level is very low


def _to_db(x: float) -> float:
    return 20.0 * float(np.log10(max(x, _EPS)))


def frame_rms(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    """RMS per 30 ms frame (non-overlapping). Empty array for input shorter than one frame."""
    n = int(sample_rate * _FRAME_SECONDS)
    if samples.size < n:
        return np.zeros(0, dtype=np.float32)
    usable = (samples.size // n) * n
    frames = samples[:usable].reshape(-1, n).astype(np.float64)
    return np.sqrt(np.mean(frames * frames, axis=1))


def analyze_waveform(samples: np.ndarray, sample_rate: int = SAMPLE_RATE, min_seconds: float = 1.0) -> Dict[str, Any]:
    """
    Returns plain JSON-able facts about the recording plus a verdict:
        durationSeconds, rmsDbfs, peak, clippedFraction, activeFraction (share of 30 ms frames clearly above the
        estimated noise floor), noiseFloorDbfs, verdict, issues[]
    `issues` lists non-fatal observations (e.g. "clipping") that the UI may show as hints.
    """
    samples = np.asarray(samples, dtype=np.float32).reshape(-1)
    duration = samples.size / float(sample_rate) if sample_rate else 0.0
    issues = []

    if samples.size == 0:
        return {"durationSeconds": 0.0, "rmsDbfs": None, "peak": 0.0, "clippedFraction": 0.0, "activeFraction": 0.0,
                "noiseFloorDbfs": None, "verdict": TOO_SHORT, "issues": ["The recording is empty."]}

    peak = float(np.max(np.abs(samples)))
    rms = float(np.sqrt(np.mean(samples.astype(np.float64) ** 2)))
    clipped = float(np.mean(np.abs(samples) >= 0.999))

    frames = frame_rms(samples, sample_rate)
    if frames.size:
        db = 20.0 * np.log10(np.maximum(frames, _EPS))
        noise_floor = float(np.percentile(db, 10))
        # A frame is "active" when it is clearly above the noise floor AND above an absolute level that rules out
        # numerical dust. 10 dB above the floor is a conventional, deliberately generous margin.
        threshold = max(noise_floor + 10.0, -55.0)
        active = float(np.mean(db > threshold))
    else:
        noise_floor, active = None, 0.0

    if clipped > 0.01:
        issues.append("The recording is distorted (the microphone level is too high).")

    if duration < min_seconds:
        verdict = TOO_SHORT
        issues.append("The recording is too short.")
    elif peak < 1e-3 or rms < 1e-4:
        verdict = SILENT
        issues.append("No sound was picked up. Check that the right microphone is selected and not muted.")
    elif active < 0.05:
        verdict = NO_SPEECH
        issues.append("No speech could be distinguished from background noise.")
    elif _to_db(rms) < -50.0:
        verdict = TOO_QUIET
        issues.append("The recording is very quiet. Move closer to the microphone or raise its input level.")
    else:
        verdict = OK

    return {
        "durationSeconds": round(duration, 3),
        "rmsDbfs": round(_to_db(rms), 1),
        "peak": round(peak, 4),
        "clippedFraction": round(clipped, 4),
        "activeFraction": round(active, 3),
        "noiseFloorDbfs": round(noise_floor, 1) if noise_floor is not None else None,
        "verdict": verdict,
        "issues": issues,
    }


def boost_quiet_audio(samples: np.ndarray, target_peak: float = 0.9, max_gain_db: float = 20.0) -> np.ndarray:
    """
    Peak-normalises a QUIET recording towards `target_peak`, never boosting by more than `max_gain_db` and never
    attenuating. Loud recordings are returned unchanged. This helps the recogniser with low microphone levels; it
    does not change what was said.
    """
    samples = np.asarray(samples, dtype=np.float32)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-6 or peak >= target_peak:
        return samples
    gain = min(target_peak / peak, 10.0 ** (max_gain_db / 20.0))
    boosted = samples * np.float32(gain)
    return np.clip(boosted, -1.0, 1.0).astype(np.float32)
