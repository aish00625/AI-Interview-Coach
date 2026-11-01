"""
Speech-to-text transcription and factual speech-metric calculation.

HONESTY NOTE: this module uses faster-whisper (a local/offline Whisper implementation: no audio leaves this
service and no paid API is involved). If faster-whisper is missing or its model cannot be loaded, the functions here
raise SpeechServiceUnavailable carrying a stable `code`; they NEVER fabricate a transcript. Recordings that cannot be
transcribed because of the *recording* (empty, silent, unreadable) raise AudioRejected, which the route reports as a
422 so the candidate can simply record again.

What changed in the Phase M review (why the old behaviour was unreliable):
  * The model was loaded lazily inside the first request, so the first speaker waited for a model download and
    usually hit the caller's timeout (reported to the user as a generic 503). It can now be preloaded in a background
    thread at start-up, and a request that arrives while it loads gets a clear, retryable "still starting" error.
  * Audio was handed to the decoder untouched. It is now decoded to a 16 kHz waveform, checked (empty / silent /
    too quiet / unreadable) and, if quiet, gently boosted. Silence no longer becomes an invented transcript.
  * Decoding used greedy search, no voice-activity detection, no language hint and no word timestamps. It now uses
    beam search, VAD, a configurable language hint (default "en", so accented English is not mis-detected as another
    language), a short vocabulary prompt, and word-level timestamps; segments that Whisper itself marks as likely
    non-speech or repetitive are dropped.
  * Speaking rate was words / total recording length (so a long silence before or after speaking lowered it). It is
    now words / the time between the first and last spoken word.
  * Metrics carry an explicit `reliable` flag with reasons instead of always looking authoritative.

No accuracy figure is claimed anywhere: transcript "confidence" below is derived from the recogniser's own word
probabilities and is a heuristic, not a measured word-error rate.
"""
import logging
import math
import os
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional

# Hugging Face prints a long symlink warning on Windows when the model is first downloaded; it is harmless.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np  # noqa: E402

from app import config  # noqa: E402
from app.services import audio_quality  # noqa: E402

logger = logging.getLogger(__name__)

MIN_WORDS_FOR_RATE = 25          # fewer words than this => pace is not a stable measurement
MIN_SPAN_SECONDS_FOR_RATE = 10   # a shorter speaking span than this => same
MODEL_RETRY_COOLDOWN_SECONDS = 60
MODEL_WAIT_SECONDS = 20          # how long a request waits for a model that is still loading before giving up


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class SpeechServiceUnavailable(Exception):
    """
    Speech-to-text cannot run right now. `code` is a stable machine-readable reason:
        speech_package_missing  - faster-whisper is not installed in this Python environment
        speech_model_loading    - the model is still being downloaded/loaded (retryable)
        speech_model_unavailable- the model could not be downloaded or loaded
        speech_transcription_failed - the model raised while transcribing
    `message` is safe to show to a user (no paths, no exception text).
    """

    def __init__(self, message: str, code: str = "speech_model_unavailable", retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.code = code
        self.retryable = retryable


class AudioRejected(Exception):
    """The recording itself cannot be transcribed. The candidate can fix this by recording again (HTTP 422)."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


# ---------------------------------------------------------------------------
# Model management
# ---------------------------------------------------------------------------

def _package_versions() -> Dict[str, Optional[str]]:
    """Installed versions of the packages speech depends on (None = not installed). Never imports heavy modules."""
    from importlib import metadata

    out: Dict[str, Optional[str]] = {}
    for name in ("faster-whisper", "ctranslate2", "av", "onnxruntime", "numpy"):
        try:
            out[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            out[name] = None
    return out


def _default_model_factory():
    """Creates the faster-whisper model. Raises SpeechServiceUnavailable with a precise code on failure."""
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise SpeechServiceUnavailable(
            "Speech-to-text is not installed on the AI service (the 'faster-whisper' package is missing). "
            "Install ai-service/requirements-speech.txt, or use typed answers.",
            code="speech_package_missing",
        ) from exc

    kwargs: Dict[str, Any] = {"device": config.SPEECH_DEVICE}
    if config.SPEECH_MODEL_DIR:
        kwargs["download_root"] = config.SPEECH_MODEL_DIR
    if config.SPEECH_LOCAL_ONLY:
        kwargs["local_files_only"] = True

    last_exc: Optional[Exception] = None
    tried = []
    for compute_type in (config.SPEECH_COMPUTE_TYPE, "int8", "default"):
        if compute_type in tried:
            continue
        tried.append(compute_type)
        try:
            return WhisperModel(config.SPEECH_MODEL_SIZE, compute_type=compute_type, **kwargs)
        except Exception as exc:  # noqa: BLE001 - download failures, unsupported compute type, corrupt cache ...
            last_exc = exc
            logger.warning("Whisper model load failed with compute_type=%s: %s", compute_type, type(exc).__name__)
            # An unsupported compute type is worth retrying with a different one; a download problem is not.
            if "compute type" not in str(exc).lower() and "compute_type" not in str(exc).lower():
                break
    logger.error("Speech model '%s' could not be loaded: %s", config.SPEECH_MODEL_SIZE, last_exc)
    if config.SPEECH_LOCAL_ONLY:
        hint = "SPEECH_LOCAL_ONLY is on, so the model must already be downloaded (run: python -m app.diagnostics --download)."
    else:
        hint = ("The model is downloaded on first use and needs internet access once "
                "(run: python -m app.diagnostics --download), or use typed answers.")
    raise SpeechServiceUnavailable(
        f"Speech recognition model '{config.SPEECH_MODEL_SIZE}' could not be loaded. {hint}",
        code="speech_model_unavailable",
    ) from last_exc


class SpeechEngine:
    """Owns the Whisper model: background preload, load-state reporting, and serialised inference."""

    def __init__(self, model_factory: Optional[Callable[[], Any]] = None):
        self._factory = model_factory or _default_model_factory
        self._state_lock = threading.Lock()
        self.infer_lock = threading.Lock()  # one transcription at a time: it is CPU-bound anyway
        self._state = "not_loaded"          # not_loaded | loading | ready | error
        self._model = None
        self._error: Optional[SpeechServiceUnavailable] = None
        self._error_at = 0.0
        self._thread: Optional[threading.Thread] = None
        self._loaded_event = threading.Event()

    # -- state -------------------------------------------------------------
    def status(self) -> Dict[str, Any]:
        with self._state_lock:
            state, err = self._state, self._error
        out: Dict[str, Any] = {
            "state": state,
            "model": config.SPEECH_MODEL_SIZE,
            "language": config.SPEECH_LANGUAGE or "auto",
            "vad": config.SPEECH_VAD_FILTER,
        }
        if err is not None:
            out["errorCode"] = err.code
            out["message"] = err.message
        elif state == "loading":
            out["message"] = "The speech recognition model is loading (the first start downloads it). Try again shortly."
        return out

    @property
    def state(self) -> str:
        with self._state_lock:
            return self._state

    # -- loading -----------------------------------------------------------
    def _load(self):
        try:
            model = self._factory()
        except SpeechServiceUnavailable as exc:
            with self._state_lock:
                self._state, self._error, self._error_at, self._model = "error", exc, time.monotonic(), None
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected failure while loading the speech model")
            err = SpeechServiceUnavailable("Speech recognition could not be started.", code="speech_model_unavailable")
            err.__cause__ = exc
            with self._state_lock:
                self._state, self._error, self._error_at, self._model = "error", err, time.monotonic(), None
        else:
            with self._state_lock:
                self._state, self._error, self._model = "ready", None, model
        finally:
            self._loaded_event.set()

    def start_preload(self) -> None:
        """Begin loading in a background thread. Safe to call repeatedly."""
        with self._state_lock:
            if self._state in ("loading", "ready"):
                return
            self._state, self._error = "loading", None
            self._loaded_event.clear()
            self._thread = threading.Thread(target=self._load, name="speech-model-loader", daemon=True)
            thread = self._thread
        thread.start()

    def get_model(self, wait_seconds: float = MODEL_WAIT_SECONDS):
        """Returns the loaded model, loading it first if needed. Raises SpeechServiceUnavailable otherwise."""
        with self._state_lock:
            state, err, since = self._state, self._error, self._error_at

        if state == "ready":
            return self._model
        if state == "error":
            # A failed load may be fixable meanwhile (network came back); retry, but not on every single request.
            if time.monotonic() - since < MODEL_RETRY_COOLDOWN_SECONDS or err.code == "speech_package_missing":
                raise err
            self.start_preload()
        elif state == "not_loaded":
            self.start_preload()

        self._loaded_event.wait(timeout=wait_seconds)
        with self._state_lock:
            state, err = self._state, self._error
        if state == "ready":
            return self._model
        if state == "error" and err is not None:
            raise err
        raise SpeechServiceUnavailable(
            "Speech recognition is still starting up (the first start downloads the model). "
            "Please try again in a minute, or use typed answers.",
            code="speech_model_loading", retryable=True,
        )


default_engine = SpeechEngine()


# ---------------------------------------------------------------------------
# Decoding and transcription
# ---------------------------------------------------------------------------

def decode_waveform(file_path: str) -> np.ndarray:
    """Decodes any container faster-whisper's bundled decoder (PyAV) understands to mono 16 kHz float32."""
    try:
        from faster_whisper.audio import decode_audio
    except ImportError as exc:
        raise SpeechServiceUnavailable(
            "Speech-to-text is not installed on the AI service (the 'faster-whisper' package is missing).",
            code="speech_package_missing",
        ) from exc
    try:
        return decode_audio(file_path, sampling_rate=audio_quality.SAMPLE_RATE)
    except Exception as exc:  # noqa: BLE001 - PyAV raises several error types for bad media
        logger.info("Audio decode failed: %s", type(exc).__name__)
        raise AudioRejected(
            "audio_unreadable",
            "The recording could not be read as audio. Please record again, or use typed answers.",
        ) from exc


_SILENCE_HALLUCINATIONS = {
    "thank you", "thank you.", "thanks for watching", "thanks for watching.", "thank you for watching",
    "thank you for watching.", "you", "bye", "bye.", "okay", "okay.", "so", "subtitles by the amara.org community",
}


def _seg_value(seg: Any, name: str, default: Any = None) -> Any:
    return getattr(seg, name, default) if not isinstance(seg, dict) else seg.get(name, default)


def _is_probably_not_speech(seg: Any) -> bool:
    """Whisper's own reliability signals: high no-speech probability with low confidence, or a repetition loop."""
    no_speech = _seg_value(seg, "no_speech_prob", 0.0) or 0.0
    logprob = _seg_value(seg, "avg_logprob", 0.0) or 0.0
    compression = _seg_value(seg, "compression_ratio", 0.0) or 0.0
    return (no_speech > 0.6 and logprob < -1.0) or compression > 2.4


def _run_model(model, audio: np.ndarray, use_vad: bool):
    params: Dict[str, Any] = dict(
        beam_size=config.SPEECH_BEAM_SIZE,
        language=config.SPEECH_LANGUAGE,
        condition_on_previous_text=False,   # avoids runaway repetition across segments
        word_timestamps=True,
        initial_prompt=config.SPEECH_INITIAL_PROMPT,
    )
    if use_vad:
        params["vad_filter"] = True
        params["vad_parameters"] = {"min_silence_duration_ms": 500}
    segments_iter, info = model.transcribe(audio, **params)
    return list(segments_iter), info  # the generator must be consumed here, inside the caller's error handling


def transcribe_waveform(waveform: np.ndarray, engine: Optional[SpeechEngine] = None) -> Dict[str, Any]:
    """
    Quality-checks and transcribes a decoded waveform. Returns:
        transcript, duration_seconds, segments[{start,end,text}], words[{start,end,word,probability}],
        confidence{level,score,lowProbabilityWordShare,basis,note}, audio_quality{...}, language, vad_used,
        dropped_segments
    Raises AudioRejected (recording problem) or SpeechServiceUnavailable (service problem).
    """
    engine = engine or default_engine
    quality = audio_quality.analyze_waveform(waveform, min_seconds=config.MIN_AUDIO_SECONDS)
    verdict = quality["verdict"]

    if quality["durationSeconds"] > config.MAX_AUDIO_SECONDS:
        raise AudioRejected("audio_too_long", f"The recording is longer than the {int(config.MAX_AUDIO_SECONDS)} second limit.")
    if verdict == audio_quality.TOO_SHORT:
        raise AudioRejected("audio_too_short", "The recording is too short. Please record your answer again.")
    if verdict in (audio_quality.SILENT, audio_quality.NO_SPEECH):
        raise AudioRejected("no_speech_detected", (quality["issues"] or ["No speech was detected."])[0] + " Please record again.")

    audio = audio_quality.boost_quiet_audio(waveform)
    model = engine.get_model()

    vad_used = config.SPEECH_VAD_FILTER
    try:
        with engine.infer_lock:
            try:
                raw_segments, info = _run_model(model, audio, use_vad=vad_used)
            except Exception:
                if not vad_used:
                    raise
                # Most often: the optional onnxruntime package used by the VAD is missing. Transcribe without it
                # (silence handling then relies on the checks above) rather than failing the whole answer.
                logger.warning("Transcription with VAD failed; retrying without VAD", exc_info=True)
                vad_used = False
                raw_segments, info = _run_model(model, audio, use_vad=False)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Transcription failed")
        raise SpeechServiceUnavailable(
            "Transcription failed. Please try again, or use typed answers.",
            code="speech_transcription_failed", retryable=True,
        ) from exc

    kept = [s for s in raw_segments if not _is_probably_not_speech(s) and (_seg_value(s, "text", "") or "").strip()]
    dropped = len(raw_segments) - len(kept)

    segments, words = [], []
    for s in kept:
        segments.append({
            "start": float(_seg_value(s, "start", 0.0) or 0.0),
            "end": float(_seg_value(s, "end", 0.0) or 0.0),
            "text": (_seg_value(s, "text", "") or "").strip(),
            "avgLogprob": _seg_value(s, "avg_logprob", None),
        })
        for w in (_seg_value(s, "words", None) or []):
            text = (_seg_value(w, "word", "") or "").strip()
            if text:
                words.append({
                    "start": float(_seg_value(w, "start", 0.0) or 0.0),
                    "end": float(_seg_value(w, "end", 0.0) or 0.0),
                    "word": text,
                    "probability": _seg_value(w, "probability", None),
                })

    transcript = " ".join(s["text"] for s in segments).strip()
    if not transcript or (transcript.lower() in _SILENCE_HALLUCINATIONS and quality["activeFraction"] < 0.2):
        raise AudioRejected("no_speech_detected", "No speech was detected in the recording. Please record again.")

    return {
        "transcript": transcript,
        "duration_seconds": quality["durationSeconds"],
        "segments": [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segments],
        "words": words,
        "confidence": transcript_confidence(words, segments),
        "audio_quality": quality,
        "language": getattr(info, "language", None),
        "vad_used": vad_used,
        "dropped_segments": dropped,
    }


def transcribe_audio(file_path: str, engine: Optional[SpeechEngine] = None,
                     decoder: Optional[Callable[[str], np.ndarray]] = None) -> Dict[str, Any]:
    """File-based entry point used by the route: decode, then transcribe_waveform."""
    waveform = (decoder or decode_waveform)(file_path)
    return transcribe_waveform(waveform, engine)


# ---------------------------------------------------------------------------
# Transcript confidence (heuristic, not a measured accuracy)
# ---------------------------------------------------------------------------

CONFIDENCE_NOTE = (
    "Derived from the recogniser's own word probabilities. It is a heuristic signal that the transcript may contain "
    "mistakes, not a measured accuracy, and it can be lower for accents, background noise or unusual vocabulary."
)


def transcript_confidence(words: List[Dict[str, Any]], segments: List[Dict[str, Any]]) -> Dict[str, Any]:
    probs = [w["probability"] for w in words if isinstance(w.get("probability"), (int, float))]
    if probs:
        score = sum(probs) / len(probs)
        low_share = sum(1 for p in probs if p < 0.5) / len(probs)
        basis = "word_probabilities"
    else:
        logps = [s["avgLogprob"] for s in segments if isinstance(s.get("avgLogprob"), (int, float))]
        if not logps:
            return {"level": "unknown", "score": None, "lowProbabilityWordShare": None, "basis": "unavailable", "note": CONFIDENCE_NOTE}
        score = sum(math.exp(min(0.0, lp)) for lp in logps) / len(logps)
        low_share = None
        basis = "segment_log_probabilities"

    if score >= 0.85 and (low_share is None or low_share <= 0.10):
        level = "high"
    elif score >= 0.70:
        level = "medium"
    else:
        level = "low"
    return {
        "level": level,
        "score": round(score, 3),
        "lowProbabilityWordShare": round(low_share, 3) if low_share is not None else None,
        "basis": basis,
        "note": CONFIDENCE_NOTE,
    }


def apply_transcript_confidence(evaluation: Dict[str, Any], confidence: Dict[str, Any]) -> Dict[str, Any]:
    """
    A content score computed from a doubtful transcript must not look as trustworthy as one computed from text the
    candidate typed. When transcript confidence is low, the evaluation confidence is lowered to "low" and the note
    says why. Scores themselves are never altered. Returns a new dict.
    """
    out = dict(evaluation)
    if confidence.get("level") == "low":
        out["confidence"] = "low"
        note = ("The speech recognition confidence for this recording was low, so the transcript may not match what "
                "you said. The scores describe the transcript, not necessarily your answer.")
        existing = out.get("confidenceNote")
        out["confidenceNote"] = f"{note} {existing}" if existing else note
    return out


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

# Disfluencies: sounds that are not words in themselves.
_DISFLUENCY_PATTERNS = {
    "um": re.compile(r"\b(?:um+|umm+|erm+)\b", re.IGNORECASE),
    "uh": re.compile(r"\b(?:uh+|uhh+)\b", re.IGNORECASE),
    "er": re.compile(r"\b(?:er|ahh?)\b", re.IGNORECASE),
    "hmm": re.compile(r"\bhm+\b", re.IGNORECASE),
}
# Discourse markers: ordinary words that are sometimes used as fillers. Counted for information only (a lexical
# count cannot tell the filler "like" from the verb "like").
_MARKER_PATTERNS = {
    "like": re.compile(r"\blike\b", re.IGNORECASE),
    "you know": re.compile(r"\byou know\b", re.IGNORECASE),
    "sort of": re.compile(r"\bsort of\b", re.IGNORECASE),
    "kind of": re.compile(r"\bkind of\b", re.IGNORECASE),
}


def _count(patterns: Dict[str, "re.Pattern[str]"], transcript: str) -> Dict[str, int]:
    out = {}
    for label, pattern in patterns.items():
        n = len(pattern.findall(transcript))
        if n:
            out[label] = n
    return out


def _count_filler_words(transcript: str) -> Dict[str, int]:
    """Back-compatible combined count (disfluencies + discourse markers)."""
    return {**_count(_DISFLUENCY_PATTERNS, transcript), **_count(_MARKER_PATTERNS, transcript)}


def _pauses_from_words(words: List[Dict[str, Any]]) -> Optional[List[float]]:
    if len(words) < 2:
        return None
    gaps = []
    for prev, nxt in zip(words, words[1:]):
        gap = nxt["start"] - prev["end"]
        if gap > config.PAUSE_THRESHOLD_SECONDS:
            gaps.append(gap)
    return gaps


def _pauses_from_segments(segments: List[Dict[str, Any]]) -> Optional[List[float]]:
    """Coarse fallback when the recogniser gave no word timing: gaps between segments."""
    if len(segments) < 2:
        return None
    return [g for g in (b["start"] - a["end"] for a, b in zip(segments, segments[1:])) if g > config.PAUSE_THRESHOLD_SECONDS]


def _compute_pause_metrics(segments: List[Dict[str, Any]]):
    """Back-compatible helper: (count, average) from segment gaps, or (None, None) when it cannot be measured."""
    gaps = _pauses_from_segments(segments)
    if gaps is None:
        return None, None
    if not gaps:
        return 0, 0.0
    return len(gaps), sum(gaps) / len(gaps)


def compute_speech_metrics(transcript: str, duration_seconds: float, segments: List[Dict[str, Any]],
                           words: Optional[List[Dict[str, Any]]] = None,
                           confidence: Optional[Dict[str, Any]] = None,
                           audio_quality_info: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Pure and deterministic: the same inputs always produce the same metrics. Every value is a measurement of the
    recording, never a judgement. Values that cannot be measured reliably are None, never 0.
    """
    words = words or []
    tokens = transcript.split()
    word_count = len(tokens)
    notes: List[str] = []

    # Speaking span: from the first to the last recognised word (falls back to segment bounds, then to nothing).
    first_start = last_end = None
    if words:
        first_start, last_end = words[0]["start"], words[-1]["end"]
    elif segments:
        first_start, last_end = segments[0]["start"], segments[-1]["end"]
    span = (last_end - first_start) if (first_start is not None and last_end is not None and last_end > first_start) else None

    # Pauses
    gaps = _pauses_from_words(words) if words else None
    pause_basis = "word_timestamps"
    if gaps is None:
        gaps = _pauses_from_segments(segments)
        pause_basis = "segment_gaps" if gaps is not None else "unavailable"
    pause_total = sum(gaps) if gaps else 0.0

    speaking_rate = None
    articulation_rate = None
    if span and span >= MIN_SPAN_SECONDS_FOR_RATE and word_count >= MIN_WORDS_FOR_RATE:
        speaking_rate = word_count / (span / 60.0)
        active = span - pause_total
        if gaps is not None and active > 1:
            articulation_rate = word_count / (active / 60.0)

    disfluencies = _count(_DISFLUENCY_PATTERNS, transcript)
    markers = _count(_MARKER_PATTERNS, transcript)
    disfluency_count = sum(disfluencies.values())
    combined = {**disfluencies, **markers}

    reasons: List[str] = []
    if word_count < MIN_WORDS_FOR_RATE or not span or span < MIN_SPAN_SECONDS_FOR_RATE:
        reasons.append("The answer is too short to measure pace and pauses reliably.")
    if confidence and confidence.get("level") == "low":
        reasons.append("Speech recognition confidence was low, so word-based measures may be inaccurate.")
    if audio_quality_info and audio_quality_info.get("verdict") == audio_quality.TOO_QUIET:
        reasons.append("The recording level was very low.")
    if audio_quality_info and (audio_quality_info.get("clippedFraction") or 0) > 0.01:
        reasons.append("The recording was distorted.")

    notes.append("Pace is words per minute between your first and last recognised word, so silence before or after speaking is not counted.")
    notes.append("Filler counts come from the transcript text. Speech recognition often leaves fillers out, so counts are likely to be too low, and the marker words (like, you know...) are ordinary words.")

    return {
        "schemaVersion": 2,
        "durationSeconds": round(float(duration_seconds or 0.0), 2),
        "wordCount": word_count,
        "speakingRateWpm": round(speaking_rate, 1) if speaking_rate is not None else None,
        "articulationRateWpm": round(articulation_rate, 1) if articulation_rate is not None else None,
        "speechSpanSeconds": round(span, 2) if span else None,
        "timeToFirstWordSeconds": round(first_start, 2) if first_start is not None else None,
        "fillerWordCount": sum(combined.values()),
        "fillerWords": combined,
        "disfluencyCount": disfluency_count,
        "disfluencyRatePer100Words": round(disfluency_count * 100.0 / word_count, 1) if word_count else None,
        "pauseCount": len(gaps) if gaps is not None else None,
        "averagePauseSeconds": round(pause_total / len(gaps), 2) if gaps else (0.0 if gaps == [] else None),
        "longestPauseSeconds": round(max(gaps), 2) if gaps else (0.0 if gaps == [] else None),
        "longPauseCount": sum(1 for g in gaps if g > config.LONG_PAUSE_SECONDS) if gaps is not None else None,
        "pauseBasis": pause_basis,
        "transcriptConfidence": confidence,
        "audioQuality": ({k: audio_quality_info.get(k) for k in ("rmsDbfs", "clippedFraction", "activeFraction", "verdict", "issues")}
                         if audio_quality_info else None),
        "reliable": not reasons,
        "unreliableReasons": reasons,
        "notes": notes,
    }
