"""
Self-check for the optional AI-service features. Run it once after installing, from the ai-service folder:

    python -m app.diagnostics                       # report what works, load the speech model, test the decoder
    python -m app.diagnostics --download            # same, and allow downloading the speech model (needs internet once)
    python -m app.diagnostics --download-vision-model   # fetch MediaPipe's small face model for head/gaze analysis
    python -m app.diagnostics --audio my_answer.wav # also transcribe a real recording and print the result

Exit code 0 = voice answers are ready; 1 = something needs attention (the output says exactly what).
It never prints the contents of your .env file or any key.
"""
import argparse
import os
import struct
import sys
import tempfile
import time
import wave
from typing import Callable, List, Optional, TextIO

import numpy as np


def _line(out: TextIO, label: str, value: str, ok: Optional[bool] = None):
    mark = "" if ok is None else ("[ok]   " if ok else "[FAIL] ")
    print(f"{mark}{label}: {value}", file=out)


def write_test_wav(path: str, seconds: float = 2.0, sample_rate: int = 16000) -> None:
    """A synthetic 16 kHz mono tone with a little noise. Not speech: it only tests that audio can be decoded."""
    t = np.arange(int(seconds * sample_rate)) / sample_rate
    rng = np.random.default_rng(0)
    data = 0.3 * np.sin(2 * np.pi * 220 * t) + 0.02 * rng.standard_normal(t.size)
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(struct.pack("<%dh" % pcm.size, *pcm.tolist()))


def check_packages(out: TextIO) -> bool:
    from app.services.speech_processor import _package_versions
    versions = _package_versions()
    _line(out, "python", sys.version.split()[0])
    for name, ver in versions.items():
        required = name in ("faster-whisper", "numpy")
        _line(out, name, ver or "not installed", ok=(ver is not None) if required else None)
    return versions.get("faster-whisper") is not None


def check_vision(out: TextIO) -> None:
    from app.services.vision_processor import vision_status
    st = vision_status()
    _line(out, "webcam analysis", f"{st['state']} - {st['message']}", ok=st["available"])
    if st["available"] and not st["landmarkModelFound"]:
        print("       To enable head-direction/gaze: python -m app.diagnostics --download-vision-model", file=out)
    check_face_monitor(out)


def check_face_monitor(out: TextIO) -> None:
    """Optional face-monitoring module: says plainly which parts can run. Never loads or downloads a model."""
    from app.services.face_behavior import face_monitor_status
    st = face_monitor_status()
    _line(out, "face monitoring", f"{st['state']} - {st['message']}", ok=st["available"])
    if st["available"]:
        f = st["features"]
        _line(out, "  head pose / gaze", "available" if f["headPose"] else "unavailable (needs the landmark model)", ok=f["headPose"])
        _line(out, "  same-person check", "available" if f["identity"] else "not configured (needs the SFace ONNX model at FACE_RECOGNITION_MODEL_PATH, plus the landmark model)", ok=f["identity"])


def check_speech_model(out: TextIO, engine=None, wait_seconds: float = 3600) -> bool:
    from app import config
    from app.services import speech_processor
    from app.services.speech_processor import SpeechServiceUnavailable
    engine = engine or speech_processor.default_engine
    _line(out, "speech model", f"{config.SPEECH_MODEL_SIZE} ({config.SPEECH_DEVICE}, {config.SPEECH_COMPUTE_TYPE}), language={config.SPEECH_LANGUAGE or 'auto'}")
    start = time.time()
    try:
        engine.get_model(wait_seconds=wait_seconds)
    except SpeechServiceUnavailable as exc:
        _line(out, "speech model load", f"{exc.code}: {exc.message}", ok=False)
        return False
    _line(out, "speech model load", f"ready in {time.time() - start:.1f}s", ok=True)
    return True


def check_decoder(out: TextIO) -> bool:
    """Decode a generated WAV through the same code path real recordings use."""
    from app.services import audio_quality, speech_processor
    from app.services.speech_processor import AudioRejected, SpeechServiceUnavailable
    tmp = os.path.join(tempfile.mkdtemp(prefix="diag_"), "tone.wav")
    try:
        write_test_wav(tmp)
        wave_form = speech_processor.decode_waveform(tmp)
    except (SpeechServiceUnavailable, AudioRejected) as exc:
        _line(out, "audio decoder", getattr(exc, "message", str(exc)), ok=False)
        return False
    finally:
        try:
            os.remove(tmp)
            os.rmdir(os.path.dirname(tmp))
        except OSError:
            pass
    verdict = audio_quality.analyze_waveform(wave_form)["verdict"]
    _line(out, "audio decoder", f"decoded {wave_form.size / audio_quality.SAMPLE_RATE:.1f}s of audio (quality check says: {verdict})", ok=True)
    return True


def transcribe_file(out: TextIO, path: str, engine=None) -> bool:
    from app.services import speech_processor
    from app.services.speech_processor import AudioRejected, SpeechServiceUnavailable
    try:
        result = speech_processor.transcribe_audio(path, engine=engine)
    except AudioRejected as exc:
        _line(out, "transcription", f"{exc.reason}: {exc.message}", ok=False)
        return False
    except SpeechServiceUnavailable as exc:
        _line(out, "transcription", f"{exc.code}: {exc.message}", ok=False)
        return False
    metrics = speech_processor.compute_speech_metrics(
        result["transcript"], result["duration_seconds"], result["segments"], words=result["words"],
        confidence=result["confidence"], audio_quality_info=result["audio_quality"])
    _line(out, "transcript", result["transcript"], ok=True)
    _line(out, "transcript confidence", f"{result['confidence']['level']} ({result['confidence']['score']})")
    for key in ("durationSeconds", "wordCount", "speakingRateWpm", "disfluencyCount", "pauseCount", "longPauseCount", "reliable"):
        _line(out, key, str(metrics.get(key)))
    return True


def download_vision_model(out: TextIO, fetch: Optional[Callable[[str, str], None]] = None) -> bool:
    from app import config
    import urllib.request
    dest = config.FACE_LANDMARKER_MODEL_PATH
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    fetch = fetch or (lambda url, to: urllib.request.urlretrieve(url, to))
    tmp = dest + ".part"
    try:
        fetch(config.FACE_LANDMARKER_MODEL_URL, tmp)
        if os.path.getsize(tmp) < 100_000:
            raise OSError("downloaded file is too small to be the model")
        os.replace(tmp, dest)
    except Exception as exc:  # noqa: BLE001 - report any network/file problem plainly
        if os.path.exists(tmp):
            os.remove(tmp)
        _line(out, "vision model download", f"failed ({type(exc).__name__}: {exc}). Webcam analysis keeps working with face presence only.", ok=False)
        return False
    _line(out, "vision model download", f"saved to {dest}", ok=True)
    return True


def main(argv: Optional[List[str]] = None, out: TextIO = sys.stdout) -> int:
    ap = argparse.ArgumentParser(description="AI service self-check")
    ap.add_argument("--download", action="store_true", help="allow downloading the speech model (default behaviour unless SPEECH_LOCAL_ONLY=true)")
    ap.add_argument("--download-vision-model", action="store_true", help="download MediaPipe's face landmark model")
    ap.add_argument("--audio", help="transcribe this audio file and print the result")
    args = ap.parse_args(argv)

    if args.download_vision_model:
        ok = download_vision_model(out)
        check_vision(out)
        return 0 if ok else 1

    print("AI service self-check", file=out)
    pkg_ok = check_packages(out)
    check_vision(out)
    if not pkg_ok:
        print("\nVoice answers are NOT ready: install the speech package with\n    pip install -r requirements-speech.txt\nthen run this check again.", file=out)
        return 1
    ready = check_speech_model(out)
    decoder_ok = check_decoder(out)
    if ready and args.audio:
        ready = transcribe_file(out, args.audio) and ready
    verdict = ready and decoder_ok
    print("\n" + ("Voice answers are ready." if verdict else "Voice answers are NOT ready - see the lines marked [FAIL] above."), file=out)
    return 0 if verdict else 1


if __name__ == "__main__":
    sys.exit(main())
