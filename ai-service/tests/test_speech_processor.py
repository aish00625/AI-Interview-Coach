"""
Speech pipeline tests using a FAKE Whisper model, so they need neither faster-whisper nor a model download. They verify
OUR logic (audio checks, error codes, model-state handling, metric arithmetic, honesty flags). They say nothing about
how accurately real Whisper transcribes: that can only be checked on a machine with the model (python -m app.diagnostics).
"""
import sys
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import config  # noqa: E402
from app.services import speech_processor as sp  # noqa: E402
from app.services import audio_quality as aq  # noqa: E402
from tests.test_audio_quality import speech_like, SR  # noqa: E402


def word(text, start, end, prob=0.95):
    return SimpleNamespace(word=" " + text, start=start, end=end, probability=prob)


def segment(text, start, end, words=None, **kw):
    return SimpleNamespace(text=" " + text, start=start, end=end, words=words or [], avg_logprob=kw.get("avg_logprob", -0.2),
                           no_speech_prob=kw.get("no_speech_prob", 0.01), compression_ratio=kw.get("compression_ratio", 1.2))


class FakeModel:
    def __init__(self, segments, fail_with_vad=False, always_fail=False):
        self.segments, self.fail_with_vad, self.always_fail = segments, fail_with_vad, always_fail
        self.calls = []

    def transcribe(self, audio, **params):
        self.calls.append(params)
        if self.always_fail or (self.fail_with_vad and params.get("vad_filter")):
            raise RuntimeError("boom")
        return iter(self.segments), SimpleNamespace(language="en")


def engine_with(model):
    e = sp.SpeechEngine(model_factory=lambda: model)
    e.start_preload()
    e._loaded_event.wait(2)
    return e


def sentence_words(text, start=0.5, per_word=0.4):
    out, t = [], start
    for w in text.split():
        out.append(word(w, t, t + per_word * 0.8))
        t += per_word
    return out


class TranscribeTests(unittest.TestCase):
    def setUp(self):
        self.audio = speech_like(4.0)

    def test_happy_path_and_decoder_parameters(self):
        words = sentence_words("a deadlock happens when processes wait forever")
        model = FakeModel([segment("a deadlock happens when processes wait forever", 0.5, 3.4, words)])
        r = sp.transcribe_waveform(self.audio, engine_with(model))
        self.assertEqual(r["transcript"], "a deadlock happens when processes wait forever")
        self.assertEqual(len(r["words"]), 7)
        self.assertEqual(r["language"], "en")
        p = model.calls[0]
        self.assertEqual(p["beam_size"], config.SPEECH_BEAM_SIZE)
        self.assertEqual(p["language"], config.SPEECH_LANGUAGE)
        self.assertTrue(p["word_timestamps"])
        self.assertFalse(p["condition_on_previous_text"])
        self.assertTrue(p["vad_filter"])

    def test_vad_failure_falls_back_to_no_vad(self):
        model = FakeModel([segment("hello there", 0.5, 1.5, sentence_words("hello there"))], fail_with_vad=True)
        r = sp.transcribe_waveform(self.audio, engine_with(model))
        self.assertFalse(r["vad_used"])
        self.assertEqual(len(model.calls), 2)
        self.assertNotIn("vad_filter", model.calls[1])

    def test_model_failure_is_a_retryable_503_not_a_fake_transcript(self):
        with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
            sp.transcribe_waveform(self.audio, engine_with(FakeModel([], always_fail=True)))
        self.assertEqual(cm.exception.code, "speech_transcription_failed")
        self.assertTrue(cm.exception.retryable)
        self.assertNotIn("boom", cm.exception.message)

    def test_silence_is_rejected_before_the_model_runs(self):
        model = FakeModel([segment("Thank you.", 0, 1)])
        with self.assertRaises(sp.AudioRejected) as cm:
            sp.transcribe_waveform(np.zeros(3 * SR, dtype=np.float32), engine_with(model))
        self.assertEqual(cm.exception.reason, "no_speech_detected")
        self.assertEqual(model.calls, [])

    def test_too_short_and_too_long(self):
        model = FakeModel([])
        with self.assertRaises(sp.AudioRejected) as cm:
            sp.transcribe_waveform(speech_like(0.3), engine_with(model))
        self.assertEqual(cm.exception.reason, "audio_too_short")
        old = config.MAX_AUDIO_SECONDS
        config.MAX_AUDIO_SECONDS = 2.0
        try:
            with self.assertRaises(sp.AudioRejected) as cm:
                sp.transcribe_waveform(speech_like(4.0), engine_with(model))
            self.assertEqual(cm.exception.reason, "audio_too_long")
        finally:
            config.MAX_AUDIO_SECONDS = old

    def test_known_hallucination_on_mostly_quiet_audio_is_rejected(self):
        sparse = (0.002 * np.random.default_rng(3).standard_normal(5 * SR)).astype(np.float32)
        sparse[SR:SR + int(0.3 * SR)] += 0.3 * np.sin(2 * np.pi * 200 * np.arange(int(0.3 * SR)) / SR).astype(np.float32)
        self.assertEqual(aq.analyze_waveform(sparse)["verdict"], aq.OK)
        self.assertLess(aq.analyze_waveform(sparse)["activeFraction"], 0.2)
        with self.assertRaises(sp.AudioRejected):
            sp.transcribe_waveform(sparse, engine_with(FakeModel([segment("Thank you.", 1.0, 1.5)])))

    def test_segments_whisper_marks_as_non_speech_are_dropped(self):
        good = segment("real words here", 0.5, 2.0, sentence_words("real words here"))
        noise = segment("subscribe now", 2.5, 3.5, no_speech_prob=0.9, avg_logprob=-1.6)
        loop = segment("la la la la la", 3.5, 4.0, compression_ratio=3.1)
        r = sp.transcribe_waveform(self.audio, engine_with(FakeModel([good, noise, loop])))
        self.assertEqual(r["transcript"], "real words here")
        self.assertEqual(r["dropped_segments"], 2)

    def test_only_dropped_segments_means_no_speech(self):
        with self.assertRaises(sp.AudioRejected):
            sp.transcribe_waveform(self.audio, engine_with(FakeModel([segment("x", 0, 1, no_speech_prob=0.95, avg_logprob=-2)])))

    def test_transcribe_audio_uses_injected_decoder(self):
        model = FakeModel([segment("hello world", 0.5, 1.5, sentence_words("hello world"))])
        r = sp.transcribe_audio("ignored.webm", engine=engine_with(model), decoder=lambda path: self.audio)
        self.assertEqual(r["transcript"], "hello world")

    def test_unreadable_audio_is_a_422_style_rejection(self):
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
                sp.decode_waveform("nothing.webm")
            self.assertEqual(cm.exception.code, "speech_package_missing")
        else:
            with self.assertRaises(sp.AudioRejected):
                sp.decode_waveform(__file__)  # a Python file is not audio


class EngineTests(unittest.TestCase):
    def test_states_and_status(self):
        gate = threading.Event()
        model = object()
        e = sp.SpeechEngine(model_factory=lambda: (gate.wait(2), model)[1])
        self.assertEqual(e.status()["state"], "not_loaded")
        e.start_preload()
        self.assertEqual(e.status()["state"], "loading")
        self.assertIn("message", e.status())
        with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
            e.get_model(wait_seconds=0.05)
        self.assertEqual(cm.exception.code, "speech_model_loading")
        self.assertTrue(cm.exception.retryable)
        gate.set()
        self.assertIs(e.get_model(wait_seconds=2), model)
        self.assertEqual(e.status()["state"], "ready")

    def test_start_preload_is_idempotent(self):
        calls = []
        e = sp.SpeechEngine(model_factory=lambda: calls.append(1) or object())
        e.start_preload(); e.start_preload(); e._loaded_event.wait(2); e.start_preload()
        self.assertEqual(len(calls), 1)

    def test_load_failure_is_reported_with_code_and_cached_during_cooldown(self):
        calls = []

        def factory():
            calls.append(1)
            raise sp.SpeechServiceUnavailable("no model", code="speech_model_unavailable")
        e = sp.SpeechEngine(model_factory=factory)
        for _ in range(3):
            with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
                e.get_model(wait_seconds=1)
            self.assertEqual(cm.exception.code, "speech_model_unavailable")
        self.assertEqual(len(calls), 1)          # not retried on every request
        st = e.status()
        self.assertEqual((st["state"], st["errorCode"]), ("error", "speech_model_unavailable"))

    def test_failed_load_is_retried_after_the_cooldown(self):
        attempts = []

        def factory():
            attempts.append(1)
            if len(attempts) == 1:
                raise sp.SpeechServiceUnavailable("offline", code="speech_model_unavailable")
            return object()
        e = sp.SpeechEngine(model_factory=factory)
        with self.assertRaises(sp.SpeechServiceUnavailable):
            e.get_model(wait_seconds=1)
        e._error_at -= sp.MODEL_RETRY_COOLDOWN_SECONDS + 1
        self.assertIsNotNone(e.get_model(wait_seconds=2))
        self.assertEqual(len(attempts), 2)

    def test_missing_package_is_never_retried(self):
        calls = []

        def factory():
            calls.append(1)
            raise sp.SpeechServiceUnavailable("missing", code="speech_package_missing")
        e = sp.SpeechEngine(model_factory=factory)
        with self.assertRaises(sp.SpeechServiceUnavailable):
            e.get_model(wait_seconds=1)
        e._error_at -= 10_000
        with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
            e.get_model(wait_seconds=1)
        self.assertEqual(cm.exception.code, "speech_package_missing")
        self.assertEqual(len(calls), 1)

    def test_unexpected_loader_exception_does_not_leak_details(self):
        e = sp.SpeechEngine(model_factory=lambda: (_ for _ in ()).throw(ValueError("C:\\secret\\path")))
        with self.assertRaises(sp.SpeechServiceUnavailable) as cm:
            e.get_model(wait_seconds=1)
        self.assertNotIn("secret", cm.exception.message)
        self.assertNotIn("secret", str(e.status()))


class MetricsTests(unittest.TestCase):
    LONG = ("so a deadlock happens when two or more processes each hold a resource and wait for one held by another "
            "which means none of them can ever proceed unless we break one of the four conditions for example circular wait")

    def metrics(self, text=None, words=None, segments=None, duration=20.0, **kw):
        text = text or self.LONG
        words = words if words is not None else [dict(start=w.start, end=w.end, word=w.word.strip(), probability=w.probability)
                                                 for w in sentence_words(text, per_word=0.35)]
        segments = segments if segments is not None else [dict(start=0.5, end=duration - 0.5, text=text)]
        return sp.compute_speech_metrics(text, duration, segments, words=words, **kw)

    def test_contract_keys_are_all_present(self):
        m = self.metrics()
        for k in ("durationSeconds", "wordCount", "speakingRateWpm", "fillerWordCount", "fillerWords", "pauseCount", "averagePauseSeconds"):
            self.assertIn(k, m)
        self.assertEqual(m["schemaVersion"], 2)

    def test_rate_is_measured_over_the_speaking_span_not_the_recording(self):
        m = self.metrics(duration=60.0)  # a long silent tail must not lower the pace
        n = m["wordCount"]
        span = m["speechSpanSeconds"]
        self.assertAlmostEqual(m["speakingRateWpm"], round(n / (span / 60), 1), places=1)
        self.assertGreater(m["speakingRateWpm"], 100)

    def test_short_answers_have_no_rate_and_are_marked_unreliable(self):
        m = self.metrics(text="it is a lock", duration=3.0)
        self.assertIsNone(m["speakingRateWpm"])
        self.assertFalse(m["reliable"])
        self.assertTrue(m["unreliableReasons"])

    def test_disfluencies_and_markers_are_counted_separately(self):
        m = self.metrics(text="um so uh like we use um an index you know")
        self.assertEqual(m["disfluencyCount"], 3)
        self.assertEqual(m["fillerWords"].get("um"), 2)
        self.assertEqual(m["fillerWords"].get("like"), 1)
        self.assertEqual(m["fillerWordCount"], 3 + 2)  # disfluencies + markers (like, you know)

    def test_pauses_come_from_word_gaps(self):
        words = [dict(start=0, end=0.5, word="a"), dict(start=1.5, end=2.0, word="b"), dict(start=2.1, end=2.5, word="c"),
                 dict(start=5.0, end=5.5, word="d")]
        m = sp.compute_speech_metrics("a b c d", 6.0, [], words=words)
        self.assertEqual(m["pauseCount"], 2)             # gaps of 1.0 s and 2.5 s (the 0.1 s gap is below the threshold)
        self.assertEqual(m["longPauseCount"], 1)         # only 2.5 s > 2.0 s
        self.assertEqual(m["longestPauseSeconds"], 2.5)
        self.assertEqual(m["pauseBasis"], "word_timestamps")

    def test_no_pause_data_is_none_not_zero(self):
        m = sp.compute_speech_metrics("hello", 2.0, [], words=[])
        self.assertIsNone(m["pauseCount"])
        self.assertIsNone(m["averagePauseSeconds"])
        self.assertEqual(m["pauseBasis"], "unavailable")

    def test_zero_pauses_is_a_real_zero(self):
        words = [dict(start=0, end=0.4, word="a"), dict(start=0.5, end=0.9, word="b")]
        m = sp.compute_speech_metrics("a b", 2.0, [], words=words)
        self.assertEqual(m["pauseCount"], 0)
        self.assertEqual(m["averagePauseSeconds"], 0.0)

    def test_segment_gap_fallback(self):
        segs = [dict(start=0, end=2, text="a b"), dict(start=3.5, end=5, text="c d")]
        m = sp.compute_speech_metrics("a b c d", 6.0, segs, words=[])
        self.assertEqual(m["pauseBasis"], "segment_gaps")
        self.assertEqual(m["pauseCount"], 1)

    def test_low_transcript_confidence_marks_metrics_unreliable(self):
        m = self.metrics(confidence={"level": "low"})
        self.assertFalse(m["reliable"])
        self.assertTrue(any("confidence" in r for r in m["unreliableReasons"]))

    def test_quiet_and_distorted_recordings_are_noted(self):
        m = self.metrics(audio_quality_info={"verdict": aq.TOO_QUIET, "clippedFraction": 0.05, "rmsDbfs": -60, "activeFraction": 0.4, "issues": []})
        self.assertFalse(m["reliable"])
        self.assertEqual(len(m["unreliableReasons"]), 2)

    def test_empty_input_does_not_crash(self):
        m = sp.compute_speech_metrics("", 0.0, [], words=[])
        self.assertEqual(m["wordCount"], 0)
        self.assertIsNone(m["speakingRateWpm"])
        self.assertIsNone(m["disfluencyRatePer100Words"])

    def test_deterministic(self):
        self.assertEqual(self.metrics(), self.metrics())


class ConfidenceTests(unittest.TestCase):
    def conf(self, probs):
        words = [dict(probability=p) for p in probs]
        return sp.transcript_confidence(words, [])

    def test_levels(self):
        self.assertEqual(self.conf([0.97] * 20)["level"], "high")
        self.assertEqual(self.conf([0.8] * 20)["level"], "medium")
        self.assertEqual(self.conf([0.4] * 20)["level"], "low")
        self.assertEqual(self.conf([0.99] * 14 + [0.3] * 6)["level"], "medium")  # many shaky words cap it below high

    def test_falls_back_to_segment_logprobs_then_unknown(self):
        c = sp.transcript_confidence([], [dict(avgLogprob=-0.1)])
        self.assertEqual(c["basis"], "segment_log_probabilities")
        self.assertEqual(sp.transcript_confidence([], [])["level"], "unknown")

    def test_note_says_it_is_not_an_accuracy(self):
        self.assertIn("not a measured accuracy", self.conf([0.9])["note"])

    def test_low_confidence_lowers_evaluation_confidence_but_not_scores(self):
        ev = {"technicalScore": 80, "confidence": "high", "confidenceNote": "x"}
        out = sp.apply_transcript_confidence(ev, {"level": "low"})
        self.assertEqual(out["confidence"], "low")
        self.assertEqual(out["technicalScore"], 80)
        self.assertIn("speech recognition confidence", out["confidenceNote"])
        self.assertEqual(ev["confidence"], "high")  # input not mutated
        self.assertEqual(sp.apply_transcript_confidence(ev, {"level": "high"}), ev)


if __name__ == "__main__":
    unittest.main()
