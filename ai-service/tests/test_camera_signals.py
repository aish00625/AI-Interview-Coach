"""Camera signals derived from per-frame numbers (no camera, no model)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from tests import _stubs  # noqa: E402,F401
from app.services import camera_signals as cs  # noqa: E402


def rec(t=0.0, face=True, yaw=0.0, pitch=0.0, roll=0.0, gaze=0.05, blend=None, box=(0.35, 0.65, 0.25, 0.6)):
    return {"t": t, "face": face, "yaw": yaw, "pitch": pitch, "roll": roll, "gaze": gaze, "blend": blend, "box": box}


def blend(brow=0.0, smile=0.0):
    b = {name: 0.0 for name in cs.EXPRESSION_CHANNELS}
    b["browInnerUp"] = brow
    b["mouthSmileLeft"] = smile
    b["mouthSmileRight"] = smile
    b["jawOpen"] = 0.9  # talking: must be ignored
    b["eyeBlinkLeft"] = 0.9  # blinking: must be ignored
    return b


class FacingTests(unittest.TestCase):
    def test_facing_when_head_and_eyes_forward(self):
        self.assertIs(cs.facing_flag(rec()), True)

    def test_not_facing_when_head_turned_looking_down_or_eyes_aside(self):
        self.assertIs(cs.facing_flag(rec(yaw=40)), False)
        self.assertIs(cs.facing_flag(rec(pitch=-40)), False)
        self.assertIs(cs.facing_flag(rec(gaze=0.9)), False)

    def test_no_face_is_not_facing_and_no_landmarks_is_unknown(self):
        self.assertIs(cs.facing_flag(rec(face=False)), False)
        self.assertIsNone(cs.facing_flag({"face": True, "yaw": None, "gaze": None}))

    def test_ratio_skips_unknown_frames(self):
        out = cs.summarize([rec(), rec(yaw=40), {"t": 0.5, "face": True}])
        self.assertEqual(out["facingCameraRatio"], 0.5)
        self.assertIsNone(cs.summarize([{"t": 0, "face": True}])["facingCameraRatio"])


class HeadMovementTests(unittest.TestCase):
    def test_steady_head_is_low(self):
        out = cs.head_movement([rec(yaw=1 + (i % 2) * 0.5) for i in range(8)])
        self.assertEqual(out["level"], "low")

    def test_moving_head_is_high(self):
        out = cs.head_movement([rec(yaw=(-1) ** i * 25, pitch=(-1) ** i * 15) for i in range(8)])
        self.assertEqual(out["level"], "high")
        self.assertGreater(out["meanChangeDeg"], 10)

    def test_too_few_frames_is_none_not_zero(self):
        self.assertIsNone(cs.head_movement([rec() for _ in range(3)]))

    def test_upright_head_that_flips_to_180_is_not_movement(self):
        out = cs.head_movement([rec(pitch=179 if i % 2 else -179) for i in range(8)])
        self.assertEqual(out["level"], "low")


class ExpressionTests(unittest.TestCase):
    def test_constant_face_is_low_and_changing_face_is_higher(self):
        flat = cs.expression_variation([rec(blend=blend()) for _ in range(8)])
        lively = cs.expression_variation([rec(blend=blend(brow=0.8 if i % 2 else 0.0, smile=0.6 if i % 3 == 0 else 0.0)) for i in range(8)])
        self.assertEqual(flat["level"], "low")
        self.assertGreater(lively["spread"], flat["spread"])
        self.assertIn(lively["level"], ("moderate", "high"))

    def test_talking_and_blinking_do_not_count_as_expression(self):
        frames = []
        for i in range(10):
            b = blend()
            b["jawOpen"] = 0.1 if i % 2 else 0.9
            b["eyeBlinkLeft"] = 1.0 if i % 2 else 0.0
            frames.append(rec(blend=b))
        self.assertEqual(cs.expression_variation(frames)["level"], "low")

    def test_without_blendshapes_it_is_none(self):
        self.assertIsNone(cs.expression_variation([rec() for _ in range(8)]))
        self.assertIsNone(cs.expression_variation([rec(blend={"browInnerUp": 0.1}) for _ in range(8)]))

    def test_no_emotion_words_in_output(self):
        out = str(cs.expression_variation([rec(blend=blend(smile=0.5 * (i % 2))) for i in range(8)])).lower()
        for w in ("happy", "sad", "angry", "nervous", "confident", "emotion", "smile"):
            self.assertNotIn(w, out)


class FramingTests(unittest.TestCase):
    def test_well_framed(self):
        out = cs.framing([rec() for _ in range(8)])
        self.assertEqual(out["level"], "good")
        self.assertEqual(out["hints"], [])

    def test_small_off_centre_and_low_faces_get_hints(self):
        out = cs.framing([rec(box=(0.0, 0.15, 0.7, 0.85)) for _ in range(8)])
        self.assertEqual(out["level"], "poor")
        text = " ".join(out["hints"])
        self.assertIn("small", text); self.assertIn("one side", text); self.assertIn("low", text)

    def test_unmeasured_is_none(self):
        self.assertIsNone(cs.framing([{"t": 0, "face": True}] * 8))


class TimelineTests(unittest.TestCase):
    def test_points_keep_order_and_use_none_for_unmeasured(self):
        out = cs.build_timeline([rec(t=0.0), rec(t=0.5, face=False), {"t": 1.0, "face": True}], 12.34)
        pts = out["points"]
        self.assertEqual([p["t"] for p in pts], [0.0, 0.5, 1.0])
        self.assertEqual([p["face"] for p in pts], [1, 0, 1])
        self.assertEqual(pts[1]["facing"], 0)
        self.assertIsNone(pts[2]["facing"])
        self.assertIsNone(pts[0]["expression"])  # no previous frame, no blendshapes
        self.assertEqual(out["durationSeconds"], 12.3)

    def test_expression_and_head_change_are_scaled_to_unit_range(self):
        frames = [rec(t=i / 4, yaw=i * 30, blend=blend(brow=i % 2)) for i in range(5)]
        pts = cs.build_timeline(frames, None)["points"]
        for p in pts[1:]:
            self.assertTrue(0 <= p["expression"] <= 1 and 0 <= p["head"] <= 1)
        self.assertEqual(pts[0]["head"], None)

    def test_length_is_bounded_and_unknown_duration_is_none(self):
        out = cs.build_timeline([rec(t=i / 500) for i in range(500)], None)
        self.assertEqual(len(out["points"]), cs.MAX_TIMELINE_POINTS)
        self.assertIsNone(out["durationSeconds"])

    def test_summary_with_nothing_measured(self):
        out = cs.summarize([], None)
        self.assertIsNone(out["timeline"]); self.assertIsNone(out["headMovement"]); self.assertIsNone(out["facingCameraRatio"])


if __name__ == "__main__":
    unittest.main()


class PickSnapshotsTests(unittest.TestCase):
    def rec(self, t, yaw=0.0, pitch=0.0, gaze=0.05, brow=0.0, face=True, box=(0.35, 0.65, 0.25, 0.6)):
        b = {name: 0.0 for name in cs.EXPRESSION_CHANNELS}
        b["browInnerUp"] = brow
        return {"t": t, "face": face, "yaw": yaw, "pitch": pitch, "roll": 0.0, "gaze": gaze, "blend": b, "box": box}

    def kinds(self, picks):
        return {k: p["index"] for p in picks for k in p["kinds"]}

    def test_each_snapshot_is_a_frame_that_really_had_the_measured_property(self):
        recs = [self.rec(i / 11, yaw=1.0) for i in range(12)]
        recs[3] = self.rec(3 / 11, yaw=45.0)             # looking away
        recs[5] = self.rec(5 / 11, face=False, box=None)  # nobody in the picture
        recs[7] = self.rec(7 / 11, brow=0.9)             # most expressive
        recs[9] = self.rec(9 / 11, yaw=0.0, gaze=0.0)    # most frontal
        picks = cs.pick_snapshots(recs)
        k = self.kinds(picks)
        self.assertEqual(k["away"], 3)
        self.assertEqual(k["noface"], 5)
        self.assertEqual(k["expressive"], 7)
        self.assertEqual(k["facing"], 9)
        self.assertEqual(k["turn"], 3)
        self.assertNotEqual(k["calm"], k["expressive"])
        self.assertEqual([p["index"] for p in picks], sorted(p["index"] for p in picks))

    def test_a_frame_that_illustrates_several_signals_is_returned_once(self):
        recs = [self.rec(i / 11, yaw=1.0) for i in range(12)]
        recs[3] = self.rec(3 / 11, yaw=45.0)
        picks = cs.pick_snapshots(recs)
        three = [p for p in picks if p["index"] == 3]
        self.assertEqual(len(three), 1)
        self.assertIn("away", three[0]["kinds"]); self.assertIn("turn", three[0]["kinds"])

    def test_no_made_up_pictures_when_nothing_happened(self):
        recs = [self.rec(i / 11) for i in range(12)]
        k = self.kinds(cs.pick_snapshots(recs))
        for kind in ("away", "noface", "turn", "expressive", "calm"):
            self.assertNotIn(kind, k, kind)
        self.assertIn("framed", k); self.assertIn("facing", k)

    def test_empty_and_unmeasured_input(self):
        self.assertEqual(cs.pick_snapshots([]), [])
        self.assertEqual(cs.pick_snapshots([{"t": 0.0, "face": True}] * 8), [])


class AnalyzeVideoIntegrationTests(unittest.TestCase):
    """analyze_video end to end with fake frames and a fake landmark model (no OpenCV decode, no MediaPipe)."""

    def run_with(self, features, landmarker=True, fps=10.0, frames_in_clip=40):
        from app.services import vision_processor as vp
        saved = {k: getattr(vp, k) for k in ("cv2", "_sample_indexed", "_detect_face_boxes", "_get_face_landmarker", "_landmark_features", "probe_video", "_encode_snapshot")}
        n = len(features)
        try:
            vp.cv2 = object()
            vp.probe_video = lambda path: {"width": 640, "height": 480, "fps": fps, "frame_count": frames_in_clip, "duration_seconds": frames_in_clip / fps}
            vp._sample_indexed = lambda path, *a, **k: ([(i * (frames_in_clip // n), object()) for i in range(n)], frames_in_clip, False)
            it = iter(features)
            cur = {}
            def detect(frame):
                cur["f"] = next(it)
                return [(0, 0, 10, 10)] if cur["f"] is not None else []
            vp._detect_face_boxes = detect
            vp._get_face_landmarker = lambda: object() if landmarker else None
            vp._landmark_features = lambda frame, lm: cur["f"]
            vp._encode_snapshot = lambda frame: "data:image/jpeg;base64,AAAA"
            return vp.analyze_video("clip.webm")
        finally:
            for k, v in saved.items():
                setattr(vp, k, v)

    @staticmethod
    def feat(yaw=0.0, pitch=0.0, gaze=0.05, brow=0.0):
        b = {name: 0.0 for name in cs.EXPRESSION_CHANNELS}
        b["browInnerUp"] = brow
        return {"gaze": gaze, "pose": {"yaw": yaw, "pitch": pitch, "roll": 0.0}, "blend": b, "box": (0.35, 0.65, 0.25, 0.6)}

    def test_full_result_with_signals_validates_against_the_response_schema(self):
        from app.schemas import VisionEvaluateResponse
        frames = [self.feat(yaw=40 if i % 4 == 0 else 2, brow=(i % 2) * 0.6) for i in range(20)]
        result = self.run_with(frames)
        VisionEvaluateResponse(**result)
        self.assertEqual(result["analysisStatus"], "complete")
        self.assertAlmostEqual(result["facingCameraRatio"], 0.75, places=2)
        self.assertAlmostEqual(result["eyeContactRatio"], 0.75, places=2)
        self.assertEqual(result["lookingAwayRatio"], 0.25)
        self.assertIn(result["headMovement"]["level"], ("moderate", "high"))
        self.assertIn(result["expressionVariation"]["level"], ("moderate", "high"))
        self.assertEqual(result["framing"]["level"], "good")
        tl = result["timeline"]
        self.assertEqual(len(tl["points"]), 20)
        self.assertEqual(tl["durationSeconds"], 4.0)
        self.assertLessEqual(tl["points"][-1]["t"], 1.0)

    def test_snapshots_are_returned_with_the_measurements_and_validate(self):
        from app.schemas import VisionEvaluateResponse
        frames = [self.feat(yaw=40 if i == 4 else 1, brow=0.8 if i == 6 else 0.0) for i in range(12)]
        result = self.run_with(frames)
        VisionEvaluateResponse(**result)
        snaps = result["snapshots"]
        self.assertTrue(snaps)
        self.assertTrue(all(s["image"].startswith("data:image/jpeg;base64,") and 0 <= s["t"] <= 1 for s in snaps))
        self.assertIn("away", [k for s in snaps for k in s["kinds"]])

    def test_snapshots_can_be_switched_off_and_are_absent_without_the_landmark_model(self):
        from app import config
        frames = [self.feat() for _ in range(10)]
        self.assertIsNone(self.run_with(frames, landmarker=False)["snapshots"])
        saved = config.ANSWER_SNAPSHOTS
        try:
            config.ANSWER_SNAPSHOTS = False
            self.assertIsNone(self.run_with(frames)["snapshots"])
        finally:
            config.ANSWER_SNAPSHOTS = saved

    def test_no_landmark_model_gives_unavailable_signals_but_a_face_timeline(self):
        from app.schemas import VisionEvaluateResponse
        result = self.run_with([object() and {"gaze": None, "pose": None, "blend": None, "box": None} for _ in range(10)], landmarker=False)
        VisionEvaluateResponse(**result)
        self.assertEqual(result["analysisStatus"], "model_unavailable")
        for key in ("facingCameraRatio", "eyeContactRatio", "headMovement", "expressionVariation", "framing"):
            self.assertIsNone(result[key], key)
        self.assertEqual(len(result["timeline"]["points"]), 10)
        self.assertTrue(all(p["facing"] is None and p["expression"] is None for p in result["timeline"]["points"]))

    def test_frames_without_a_face_count_as_not_facing_and_are_not_zero_filled_elsewhere(self):
        frames = [self.feat() if i % 2 == 0 else None for i in range(10)]
        result = self.run_with(frames)
        self.assertEqual(result["facePresenceRatio"], 0.5)
        self.assertEqual(result["facingCameraRatio"], 0.5)  # a frame with no face is not "facing the camera"
        offs = [p for p in result["timeline"]["points"] if p["face"] == 0]
        self.assertTrue(all(p["facing"] == 0 for p in offs))
