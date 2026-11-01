"""Audio pre-checks (NumPy only). Inputs are synthetic waveforms generated in the tests."""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.services import audio_quality as aq  # noqa: E402

SR = aq.SAMPLE_RATE
rng = np.random.default_rng(1)


def tone(seconds, amp=0.3):
    t = np.arange(int(seconds * SR)) / SR
    return (amp * np.sin(2 * np.pi * 180 * t)).astype(np.float32)


def speech_like(seconds=3.0, amp=0.3, noise=0.003):
    """Bursts of tone (syllables) separated by quiet gaps, over low background noise."""
    out = noise * rng.standard_normal(int(seconds * SR)).astype(np.float32)
    burst, gap = int(0.25 * SR), int(0.1 * SR)
    pos = 0
    while pos + burst < out.size:
        out[pos:pos + burst] += tone(burst / SR, amp)
        pos += burst + gap
    return out


class AudioQualityTests(unittest.TestCase):
    def test_empty_is_too_short(self):
        self.assertEqual(aq.analyze_waveform(np.zeros(0))["verdict"], aq.TOO_SHORT)

    def test_short_clip_is_too_short(self):
        self.assertEqual(aq.analyze_waveform(speech_like(0.4))["verdict"], aq.TOO_SHORT)

    def test_digital_silence(self):
        r = aq.analyze_waveform(np.zeros(3 * SR, dtype=np.float32))
        self.assertEqual(r["verdict"], aq.SILENT)
        self.assertTrue(r["issues"])

    def test_constant_noise_has_no_speech(self):
        r = aq.analyze_waveform((0.01 * rng.standard_normal(3 * SR)).astype(np.float32))
        self.assertEqual(r["verdict"], aq.NO_SPEECH)

    def test_normal_speech_like_signal_is_ok(self):
        r = aq.analyze_waveform(speech_like(3.0))
        self.assertEqual(r["verdict"], aq.OK, r)
        self.assertGreater(r["activeFraction"], 0.3)

    def test_very_quiet_speech_is_flagged(self):
        r = aq.analyze_waveform(speech_like(3.0, amp=0.004, noise=0.00005))
        self.assertIn(r["verdict"], (aq.TOO_QUIET, aq.NO_SPEECH))

    def test_clipping_is_reported_but_not_fatal(self):
        clipped = np.clip(speech_like(3.0, amp=3.0), -1, 1)
        r = aq.analyze_waveform(clipped)
        self.assertGreater(r["clippedFraction"], 0.01)
        self.assertTrue(any("distorted" in i for i in r["issues"]))

    def test_result_is_json_serialisable(self):
        import json
        json.dumps(aq.analyze_waveform(speech_like(2.0)))

    def test_boost_raises_quiet_audio_but_not_loud(self):
        quiet = speech_like(2.0, amp=0.05)
        boosted = aq.boost_quiet_audio(quiet)
        self.assertGreater(float(np.max(np.abs(boosted))), float(np.max(np.abs(quiet))) * 3)
        self.assertLessEqual(float(np.max(np.abs(boosted))), 1.0)
        loud = speech_like(2.0, amp=0.95)
        self.assertTrue(np.array_equal(aq.boost_quiet_audio(loud), loud))

    def test_boost_gain_is_capped(self):
        tiny = speech_like(1.0, amp=0.0005)
        gain = float(np.max(np.abs(aq.boost_quiet_audio(tiny)))) / float(np.max(np.abs(tiny)))
        self.assertLessEqual(gain, 10.0 + 1e-3)  # 20 dB

    def test_boost_of_silence_is_unchanged(self):
        z = np.zeros(1000, dtype=np.float32)
        self.assertTrue(np.array_equal(aq.boost_quiet_audio(z), z))


if __name__ == "__main__":
    unittest.main()
