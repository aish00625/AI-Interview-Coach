"""
Route-level tests for POST /speech-evaluate, calling the route function directly (FastAPI itself is stubbed when it is
not installed - see _stubs.py). They verify the error contract the Node backend relies on: which HTTP status and which
`reason` each failure produces, and that nothing is scored when the recording cannot be transcribed.
"""
import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _stubs  # noqa: E402

_stubs.install_fastapi_stub()

from fastapi import HTTPException, UploadFile  # noqa: E402
from app import config  # noqa: E402
from app.routes import speech as route  # noqa: E402
from app.services import speech_processor as sp  # noqa: E402
from test_speech_processor import FakeModel, engine_with, segment, sentence_words  # noqa: E402
from test_audio_quality import speech_like  # noqa: E402

KEY = "test-key"


def call(upload, **over):
    route.verify_api_key = lambda k: None if k == KEY else (_ for _ in ()).throw(HTTPException(401, "bad key"))
    args = dict(audio=upload, question="What is a deadlock?", target_role=None, difficulty=None, interview_type=None, x_ai_service_key=KEY)
    args.update(over)
    return asyncio.run(route.speech_evaluate(**args))


def fail_status(upload, **over):
    try:
        call(upload, **over)
    except HTTPException as exc:
        return exc.status_code, exc.detail
    raise AssertionError("expected an HTTPException")


class RouteTests(unittest.TestCase):
    def setUp(self):
        self._orig = route.process_audio_bytes

    def tearDown(self):
        route.process_audio_bytes = self._orig

    def test_wrong_key_is_401(self):
        self.assertEqual(fail_status(UploadFile(b"x"), x_ai_service_key="nope")[0], 401)

    def test_unsupported_type_415_with_reason(self):
        status, detail = fail_status(UploadFile(b"x", content_type="text/plain"))
        self.assertEqual((status, detail["reason"]), (415, "unsupported_media"))

    def test_empty_upload_400(self):
        status, detail = fail_status(UploadFile(b"", content_type="audio/webm"))
        self.assertEqual((status, detail["reason"]), (400, "audio_empty"))

    def test_oversize_413(self):
        old = config.MAX_AUDIO_BYTES
        route.MAX_AUDIO_BYTES = 10
        try:
            status, detail = fail_status(UploadFile(b"x" * 100))
        finally:
            route.MAX_AUDIO_BYTES = old
        self.assertEqual((status, detail["reason"]), (413, "audio_too_large"))

    def test_codec_suffix_in_content_type_is_accepted(self):
        route.process_audio_bytes = lambda *a, **k: self._ok_payload()
        resp = call(UploadFile(b"abc", content_type="audio/webm;codecs=opus"))
        self.assertEqual(resp.transcript, "hello")

    def test_audio_rejected_is_422_with_reason(self):
        def boom(*a, **k):
            raise sp.AudioRejected("no_speech_detected", "No speech.")
        route.process_audio_bytes = boom
        status, detail = fail_status(UploadFile(b"abc"))
        self.assertEqual((status, detail["reason"]), (422, "no_speech_detected"))

    def test_service_unavailable_is_503_with_code_and_retryable_flag(self):
        def boom(*a, **k):
            raise sp.SpeechServiceUnavailable("loading", code="speech_model_loading", retryable=True)
        route.process_audio_bytes = boom
        status, detail = fail_status(UploadFile(b"abc"))
        self.assertEqual((status, detail["reason"], detail["retryable"]), (503, "speech_model_loading", True))

    def test_unexpected_error_is_500_without_details(self):
        def boom(*a, **k):
            raise ValueError("C:\\private\\path")
        route.process_audio_bytes = boom
        status, detail = fail_status(UploadFile(b"abc"))
        self.assertEqual((status, detail["reason"]), (500, "processing_failed"))
        self.assertNotIn("private", str(detail))

    @staticmethod
    def _ok_payload():
        metrics = sp.compute_speech_metrics("hello", 2.0, [], words=[])
        return dict(transcript="hello", speechMetrics=metrics, technicalScore=50, relevanceScore=50, clarityScore=50, completenessScore=50,
                    strengths=[], weaknesses=[], suggestedImprovement="x", modelAnswer="y")

    def test_full_pipeline_returns_transcript_scores_and_v2_metrics(self):
        words = sentence_words("a deadlock happens when processes wait for each other forever and none can proceed")
        model = FakeModel([segment("a deadlock happens when processes wait for each other forever and none can proceed", 0.5, 4.5, words)])
        payload = route.process_audio_bytes(b"ignored", ".webm", "What is a deadlock?", engine=engine_with(model),
                                            decoder=lambda path: speech_like(5.0))
        self.assertIn("deadlock", payload["transcript"])
        for k in ("technicalScore", "relevanceScore", "clarityScore", "completenessScore", "confidence"):
            self.assertIn(k, payload)
        self.assertEqual(payload["speechMetrics"]["schemaVersion"], 2)
        # the response model accepts it unchanged
        from app.schemas import SpeechEvaluateResponse
        SpeechEvaluateResponse(**payload)

    def test_temp_files_are_removed_even_on_failure(self):
        import tempfile, os
        before = set(os.listdir(tempfile.gettempdir()))
        with self.assertRaises(sp.AudioRejected):
            route.process_audio_bytes(b"x", ".webm", "q", engine=engine_with(FakeModel([])), decoder=lambda p: speech_like(0.2))
        leftover = [d for d in set(os.listdir(tempfile.gettempdir())) - before if d.startswith("speech_")]
        self.assertEqual(leftover, [])


class SchemaCompatibilityTests(unittest.TestCase):
    def test_short_answer_metrics_validate_with_null_rate(self):
        from app.schemas import SpeechMetrics
        m = sp.compute_speech_metrics("short answer", 3.0, [], words=[])
        self.assertIsNone(SpeechMetrics(**m).speakingRateWpm)


if __name__ == "__main__":
    unittest.main()
