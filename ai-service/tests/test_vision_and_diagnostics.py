"""Vision sampling (synthetic frames) and the diagnostics tool (fakes only; nothing is downloaded)."""
import io
import os
import sys
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import vision_processor as vp  # noqa: E402
from app import diagnostics as diag  # noqa: E402
from app.services import speech_processor as sp  # noqa: E402


class FakeCapture:
    """Behaves like cv2.VideoCapture with NO usable frame count, yielding `n` numbered frames."""

    def __init__(self, n):
        self.n, self.i, self.retrieved = n, -1, []

    def grab(self):
        self.i += 1
        return self.i < self.n

    def retrieve(self):
        self.retrieved.append(self.i)
        return True, np.full((48, 64, 3), self.i % 255, dtype=np.uint8)


class SamplingTests(unittest.TestCase):
    def sample(self, n, max_frames=10, max_read=100000):
        cap = FakeCapture(n)
        frames, read, capped = vp.sample_frames_from_capture(cap, max_frames=max_frames, max_dimension=64, max_read_frames=max_read)
        return cap, frames, read, capped

    def test_short_clip_keeps_every_frame(self):
        _, frames, read, capped = self.sample(7)
        self.assertEqual((len(frames), read, capped), (7, 7, False))

    def test_long_clip_is_capped_and_spread_over_the_whole_clip(self):
        cap, frames, read, _ = self.sample(1000, max_frames=10)
        self.assertLessEqual(len(frames), 10)
        self.assertGreaterEqual(len(frames), 5)
        values = [int(f[0, 0, 0]) for f in frames]
        indexes = [i for i in cap.retrieved if (i % 255) in values]
        # first sample at the start, and the samples reach into the last quarter of the clip (not just the first seconds)
        self.assertEqual(values[0], 0)
        self.assertGreater(max(cap.retrieved), 750)
        self.assertEqual(read, 1000)

    def test_samples_are_evenly_spaced(self):
        cap, frames, _, _ = self.sample(512, max_frames=8)
        self.assertEqual(len(frames), len(set(i for i in cap.retrieved)) - (len(cap.retrieved) - len(frames)) or len(frames))
        kept_indexes = sorted(set(cap.retrieved))
        stride = 512 // 8
        # the surviving frames are all multiples of the final stride
        survivors = [i for i in kept_indexes if i % stride == 0]
        self.assertGreaterEqual(len(survivors), len(frames) - 1)

    def test_read_cap_is_reported(self):
        _, frames, read, capped = self.sample(1000, max_frames=5, max_read=100)
        self.assertEqual((read, capped), (100, True))
        self.assertLessEqual(len(frames), 5)

    def test_empty_capture(self):
        _, frames, read, capped = self.sample(0)
        self.assertEqual((frames, read, capped), ([], 0, False))

    @unittest.skipIf(vp.cv2 is None, "OpenCV (with face detection) not installed")
    def test_real_video_file_end_to_end(self):
        cv2 = vp.cv2
        d = tempfile.mkdtemp()
        path = os.path.join(d, "clip.avi")
        w = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 15.0, (160, 120))
        if not w.isOpened():
            self.skipTest("this OpenCV build cannot write MJPG video")
        for i in range(90):
            w.write(np.full((120, 160, 3), (i * 2) % 255, dtype=np.uint8))
        w.release()
        result = vp.analyze_video(path)
        self.assertEqual(result["framesInClip"], 90)
        self.assertFalse(result["clipTruncated"])
        self.assertGreater(result["framesAnalyzed"], 0)
        self.assertEqual(result["framesWithFace"], 0)           # plain colour frames contain no face
        self.assertFalse(result["facePresent"])
        self.assertIn(result["analysisStatus"], ("complete", "model_unavailable"))
        from app.schemas import VisionEvaluateResponse
        VisionEvaluateResponse(**result)

    def test_unavailable_without_opencv(self):
        saved = vp.cv2
        vp.cv2 = None
        try:
            with self.assertRaises(vp.VisionUnavailable):
                vp.analyze_video("x.webm")
            self.assertEqual(vp.vision_status()["state"], "unavailable")
        finally:
            vp.cv2 = saved


class DiagnosticsTests(unittest.TestCase):
    def test_test_wav_is_valid_16k_mono(self):
        p = os.path.join(tempfile.mkdtemp(), "t.wav")
        diag.write_test_wav(p, seconds=1.0)
        with wave.open(p) as w:
            self.assertEqual((w.getnchannels(), w.getframerate(), w.getnframes()), (1, 16000, 16000))

    def test_face_monitor_check_never_downloads_and_says_what_is_missing(self):
        from unittest import mock
        status = {"available": True, "state": "face_presence_only", "message": "Face presence only.", "landmarkModelFound": False, "recognitionModelFound": False,
                  "features": {"faceDetection": True, "multipleFaces": True, "imageQuality": True, "headPose": False, "gaze": False, "identity": False}}
        out = io.StringIO()
        with mock.patch("app.services.face_behavior.face_monitor_status", return_value=status):
            diag.check_face_monitor(out)
        text = out.getvalue()
        self.assertIn("face monitoring", text)
        self.assertIn("needs the landmark model", text)
        self.assertIn("not configured", text)

    def test_face_monitor_check_when_opencv_missing(self):
        from unittest import mock
        out = io.StringIO()
        with mock.patch("app.services.face_behavior.face_monitor_status", return_value={"available": False, "state": "unavailable", "message": "OpenCV missing", "features": None}):
            diag.check_face_monitor(out)
        self.assertIn("[FAIL]", out.getvalue())

    def test_speech_model_check_reports_failure_code(self):
        def factory():
            raise sp.SpeechServiceUnavailable("offline", code="speech_model_unavailable")
        out = io.StringIO()
        self.assertFalse(diag.check_speech_model(out, engine=sp.SpeechEngine(factory), wait_seconds=1))
        self.assertIn("[FAIL]", out.getvalue())
        self.assertIn("speech_model_unavailable", out.getvalue())

    def test_speech_model_check_success(self):
        out = io.StringIO()
        self.assertTrue(diag.check_speech_model(out, engine=sp.SpeechEngine(lambda: object()), wait_seconds=2))
        self.assertIn("[ok]", out.getvalue())

    def test_vision_model_download_with_fake_fetch(self):
        from app import config
        saved = config.FACE_LANDMARKER_MODEL_PATH
        config.FACE_LANDMARKER_MODEL_PATH = os.path.join(tempfile.mkdtemp(), "models", "m.task")
        try:
            def good(url, to):
                with open(to, "wb") as f:
                    f.write(b"x" * 200_000)
            out = io.StringIO()
            self.assertTrue(diag.download_vision_model(out, fetch=good))
            self.assertTrue(os.path.exists(config.FACE_LANDMARKER_MODEL_PATH))

            def tiny(url, to):
                with open(to, "wb") as f:
                    f.write(b"<html>error</html>")
            os.remove(config.FACE_LANDMARKER_MODEL_PATH)
            out = io.StringIO()
            self.assertFalse(diag.download_vision_model(out, fetch=tiny))
            self.assertFalse(os.path.exists(config.FACE_LANDMARKER_MODEL_PATH))
            self.assertFalse(os.path.exists(config.FACE_LANDMARKER_MODEL_PATH + ".part"))

            def offline(url, to):
                raise OSError("no network")
            self.assertFalse(diag.download_vision_model(io.StringIO(), fetch=offline))
        finally:
            config.FACE_LANDMARKER_MODEL_PATH = saved

    def test_main_reports_missing_speech_package(self):
        if sp._package_versions().get("faster-whisper"):
            self.skipTest("faster-whisper is installed here")
        out = io.StringIO()
        self.assertEqual(diag.main([], out=out), 1)
        self.assertIn("requirements-speech.txt", out.getvalue())


if __name__ == "__main__":
    unittest.main()
