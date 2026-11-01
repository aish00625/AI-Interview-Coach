"""
Face behaviour analysis (per frame). Detectors and recognisers are FAKES with deterministic outputs, so these tests check
the logic around the models (quality gating, face-state decisions, head-pose maths, gaze reliability, identity states,
reference storage, error mapping). They are NOT validation of the real MediaPipe / OpenCV models - that needs a webcam.
"""
import asyncio
import math
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _stubs  # noqa: E402

_stubs.install_fastapi_stub()

from fastapi import HTTPException, UploadFile  # noqa: E402
from app import config  # noqa: E402
from app.routes import face_monitor as route  # noqa: E402
from app.services import face_behavior as fb  # noqa: E402
from app.services.vision_processor import VisionUnavailable  # noqa: E402

W, H = 640, 480
KEY = "test-key"
REF = "a" * 24


def lit(brightness=120, noise=40, seed=1):
    rng = np.random.default_rng(seed)
    base = np.full((H, W, 3), brightness, dtype=np.float32)
    return np.clip(base + rng.normal(0, noise, base.shape), 0, 255).astype(np.uint8)


def box(h_ratio=0.4, cx=0.5, cy=0.5):
    h = h_ratio * H
    w = h * 0.8
    return (cx * W - w / 2, cy * H - h / 2, w, h)


def landmarks(iris_offset=0.0, eye_span=0.06):
    """478 fake landmarks: the two eyes' corners/irises are set explicitly (the rest are unused)."""
    pts = [SimpleNamespace(x=0.5, y=0.5) for _ in range(478)]
    # existing indices: (33,133) and (362,263) corners; iris 468 / 473
    def eye(c0, c1, iris, x0):
        pts[c0] = SimpleNamespace(x=x0, y=0.45)
        pts[c1] = SimpleNamespace(x=x0 + eye_span, y=0.45)
        pts[iris] = SimpleNamespace(x=x0 + eye_span / 2 + iris_offset * eye_span / 2, y=0.45)
    eye(33, 133, 468, 0.40)
    eye(362, 263, 473, 0.54)
    pts[1] = SimpleNamespace(x=0.5, y=0.55)
    pts[61] = SimpleNamespace(x=0.45, y=0.65)
    pts[291] = SimpleNamespace(x=0.55, y=0.65)
    return pts


class FakeDetector:
    def __init__(self, faces=None, has_landmarks=True, name="fake_landmarker"):
        self.faces, self.has_landmarks, self.name = faces or [], has_landmarks, name

    def detect(self, bgr):
        return fb.Detection(self.name, list(self.faces))


class FakeRecognizer:
    name = "fake_sface"

    def __init__(self, emb):
        self.emb, self.calls = emb, 0

    def embed(self, bgr, face):
        self.calls += 1
        return self.emb


def good_face(**kw):
    return fb.Face(box=box(), landmarks=landmarks(), pose={"yaw": 3.0, "pitch": -2.0, "roll": 1.0}, **kw)


class FrameBytesTests(unittest.TestCase):
    def test_rejects_empty_oversized_and_non_images(self):
        for data, reason in ((b"", "empty_frame"), (b"x" * (config.FACE_FRAME_MAX_BYTES + 1), "frame_too_large"), (b"not an image at all", "not_an_image")):
            with self.assertRaises(fb.FrameRejected) as cm:
                fb.check_frame_bytes(data)
            self.assertEqual(cm.exception.reason, reason)

    def test_accepts_jpeg_png_webp_signatures(self):
        self.assertEqual(fb.check_frame_bytes(b"\xff\xd8\xff\xe0" + b"0" * 10), "jpeg")
        self.assertEqual(fb.check_frame_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 10), "png")
        self.assertEqual(fb.check_frame_bytes(b"RIFF\x00\x00\x00\x00WEBPVP8 "), "webp")

    def test_corrupt_image_with_valid_signature_is_rejected_not_crashed(self):
        orig = fb.cv2
        fb.cv2 = SimpleNamespace(imdecode=lambda *a, **k: None, IMREAD_COLOR=1)
        try:
            with self.assertRaises(fb.FrameRejected) as cm:
                fb.decode_frame(b"\xff\xd8\xff" + b"garbage")
            self.assertEqual(cm.exception.reason, "corrupt_frame")
        finally:
            fb.cv2 = orig

    def test_missing_opencv_is_unavailable_not_a_behaviour(self):
        orig = fb.cv2
        fb.cv2 = None
        try:
            with self.assertRaises(VisionUnavailable):
                fb.decode_frame(b"\xff\xd8\xff" + b"0" * 20)
        finally:
            fb.cv2 = orig


class QualityTests(unittest.TestCase):
    def test_well_lit_textured_frame_is_usable(self):
        q = fb.measure_quality(lit())
        self.assertTrue(q["usable"])
        self.assertEqual(q["issues"], [])

    def test_dark_frame(self):
        q = fb.measure_quality(lit(brightness=10, noise=2))
        self.assertFalse(q["usable"])
        self.assertIn("too_dark", q["issues"])

    def test_bright_frame(self):
        self.assertIn("too_bright", fb.measure_quality(lit(brightness=250, noise=3))["issues"])

    def test_flat_blurry_frame(self):
        q = fb.measure_quality(np.full((H, W, 3), 120, dtype=np.uint8))
        self.assertIn("blurry", q["issues"])
        self.assertFalse(q["usable"])


class FaceStateTests(unittest.TestCase):
    def analyze(self, faces, img=None, **kw):
        return fb.FaceAnalyzer(FakeDetector(faces, **kw)).analyze(img if img is not None else lit())

    def test_face_detected(self):
        r = self.analyze([good_face()])
        self.assertEqual((r["faceState"], r["faceCount"]), ("face_present", 1))
        self.assertIsNone(r["faceConfidence"])
        self.assertEqual(r["headPose"]["status"], "ok")

    def test_no_face_on_usable_frame_is_no_face(self):
        r = self.analyze([])
        self.assertEqual((r["faceState"], r["faceCount"]), ("no_face", 0))
        self.assertEqual(r["gaze"]["status"], "unavailable")
        self.assertEqual(r["headPose"]["yaw"], None)

    def test_dark_frame_without_face_is_unusable_not_absence(self):
        r = self.analyze([], img=lit(brightness=8, noise=1))
        self.assertEqual(r["faceState"], "unusable_frame")
        self.assertIsNone(r["faceCount"])
        self.assertIn("improve_lighting", r["quality"]["hints"])

    def test_multiple_faces_are_counted_largest_first_and_tiny_ones_ignored(self):
        faces = [fb.Face(box=box(0.2, 0.2, 0.3)), fb.Face(box=box(0.45)), fb.Face(box=box(0.03, 0.9, 0.9))]
        r = self.analyze(faces)
        self.assertEqual(r["faceCount"], 2)
        self.assertGreater(r["faces"][0]["sizeRatio"], r["faces"][1]["sizeRatio"])
        self.assertTrue(any("ignored" in n for n in r["notes"]))

    def test_framing_hints(self):
        small = self.analyze([fb.Face(box=box(0.12))])
        self.assertIn("move_closer", small["quality"]["hints"])
        edge = self.analyze([fb.Face(box=(0, 100, 200, 250))])
        self.assertIn("centre_face", edge["quality"]["hints"])

    def test_haar_style_detector_has_no_pose_or_gaze_and_says_why(self):
        r = self.analyze([fb.Face(box=box(), score=4.2)], has_landmarks=False, name="opencv_haar")
        self.assertEqual(r["headPose"]["status"], "unavailable")
        self.assertEqual(r["headPose"]["reason"], "needs_landmark_model")
        self.assertEqual(r["gaze"]["reason"], "needs_landmark_model")
        self.assertEqual(r["faces"][0]["score"], 4.2)


class HeadPoseTests(unittest.TestCase):
    @staticmethod
    def ry(deg):
        t = math.radians(deg)
        return [[math.cos(t), 0, math.sin(t)], [0, 1, 0], [-math.sin(t), 0, math.cos(t)]]

    def test_yaw_from_rotation_matrix(self):
        self.assertAlmostEqual(fb.head_pose_from_matrix(self.ry(30))["yaw"], 30, delta=0.2)
        self.assertAlmostEqual(fb.head_pose_from_matrix(self.ry(-40))["yaw"], -40, delta=0.2)

    def test_invalid_matrix_gives_none(self):
        self.assertIsNone(fb.head_pose_from_matrix([[float("nan")] * 3] * 3))
        self.assertIsNone(fb.head_pose_from_matrix("nope"))

    def test_angles_are_folded_into_a_sane_range(self):
        self.assertAlmostEqual(fb._wrap180(175.0), -5.0)
        self.assertAlmostEqual(fb._wrap180(-170.0), 10.0)

    def test_low_quality_marks_pose_low_confidence(self):
        r = fb.FaceAnalyzer(FakeDetector([good_face()])).analyze(np.full((H, W, 3), 120, dtype=np.uint8))
        self.assertEqual(r["headPose"]["status"], "low_confidence")


class GazeTests(unittest.TestCase):
    def gaze(self, lm, pose=None, quality=None):
        return fb.gaze_assessment(lm, pose or {"yaw": 0.0}, quality or {"usable": True}, W, True)

    def test_centred_iris(self):
        g = self.gaze(landmarks(0.0))
        self.assertEqual(g["status"], "ok")
        self.assertLess(g["deviation"], 0.05)
        self.assertEqual(g["side"], "centre")

    def test_iris_off_to_one_side(self):
        g = self.gaze(landmarks(0.8))
        self.assertEqual(g["status"], "ok")
        self.assertGreater(g["deviation"], 0.6)
        self.assertEqual(g["side"], "right")

    def test_turned_head_makes_gaze_low_confidence_without_a_number(self):
        g = self.gaze(landmarks(0.8), pose={"yaw": 40.0})
        self.assertEqual((g["status"], g["reason"], g["deviation"]), ("low_confidence", "head_turned_too_far", None))

    def test_poor_quality_and_tiny_eyes_are_low_confidence(self):
        self.assertEqual(self.gaze(landmarks(0.0), quality={"usable": False})["reason"], "poor_image_quality")
        self.assertEqual(self.gaze(landmarks(0.0, eye_span=0.01))["reason"], "eyes_too_small_in_frame")

    def test_no_landmark_model_or_missing_landmarks_is_unavailable(self):
        self.assertEqual(fb.gaze_assessment(None, None, {"usable": True}, W, False)["status"], "unavailable")
        self.assertEqual(fb.gaze_assessment([], None, {"usable": True}, W, True)["reason"], "eye_landmarks_missing")


class ReferenceStoreTests(unittest.TestCase):
    def test_expiry_capacity_and_delete(self):
        now = [0.0]
        s = fb.ReferenceStore(ttl_seconds=10, max_items=2, clock=lambda: now[0])
        s.put("a" * 16, np.ones(4)); now[0] = 1; s.put("b" * 16, np.ones(4)); now[0] = 2; s.put("c" * 16, np.ones(4))
        self.assertIsNone(s.get("a" * 16), "oldest evicted at capacity")
        self.assertIsNotNone(s.get("c" * 16))
        now[0] = 100
        self.assertIsNone(s.get("c" * 16), "expired")
        s.put("d" * 16, np.ones(4))
        self.assertTrue(s.delete("d" * 16)); self.assertFalse(s.delete("d" * 16))


class IdentityTests(unittest.TestCase):
    def analyzer(self, emb_live, faces=None, recognizer=True, has_landmarks=True):
        a = fb.FaceAnalyzer(FakeDetector(faces if faces is not None else [good_face()], has_landmarks=has_landmarks),
                            FakeRecognizer(np.array(emb_live, dtype=np.float32)) if recognizer else None)
        return a

    def test_not_configured_without_a_recognition_model(self):
        r = self.analyzer([1, 0], recognizer=False).analyze(lit(), REF)
        self.assertEqual((r["identity"]["status"], r["identity"]["reason"]), ("not_configured", "needs_recognition_model"))

    def test_not_configured_without_landmarks(self):
        r = self.analyzer([1, 0], has_landmarks=False).analyze(lit(), REF)
        self.assertEqual(r["identity"]["status"], "not_configured")

    def test_no_reference_requested(self):
        self.assertEqual(self.analyzer([1, 0]).analyze(lit())["identity"]["reason"], "no_reference_requested")

    def test_reference_missing(self):
        r = self.analyzer([1, 0]).analyze(lit(), REF)
        self.assertEqual((r["identity"]["status"], r["identity"]["reason"]), ("unavailable", "reference_missing_or_expired"))

    def test_verified_and_failed(self):
        a = self.analyzer([1, 0.05])
        a.references.put(REF, np.array([1, 0], dtype=np.float32))
        v = a.analyze(lit(), REF)["identity"]
        self.assertEqual(v["status"], "verified"); self.assertGreater(v["similarity"], 0.9)
        b = self.analyzer([0, 1])
        b.references.put(REF, np.array([1, 0], dtype=np.float32))
        f = b.analyze(lit(), REF)["identity"]
        self.assertEqual(f["status"], "verification_failed"); self.assertLess(f["similarity"], config.FACE_IDENTITY_SIMILARITY_THRESHOLD)

    def test_no_face_or_bad_frame_is_unavailable_not_failed(self):
        a = self.analyzer([1, 0], faces=[])
        a.references.put(REF, np.array([1, 0], dtype=np.float32))
        self.assertEqual(a.analyze(lit(), REF)["identity"]["reason"], "no_face")
        c = self.analyzer([0, 1])
        c.references.put(REF, np.array([1, 0], dtype=np.float32))
        self.assertEqual(c.analyze(np.full((H, W, 3), 120, dtype=np.uint8), REF)["identity"]["status"], "unavailable")

    def test_reference_capture_rules(self):
        ok = self.analyzer([1, 0]).store_reference(lit(), REF)
        self.assertEqual(ok["status"], "stored")
        two = self.analyzer([1, 0], faces=[good_face(), fb.Face(box=box(0.3, 0.2, 0.2), landmarks=landmarks())]).store_reference(lit(), REF)
        self.assertEqual((two["status"], two["reason"]), ("rejected", "need_exactly_one_face"))
        turned = fb.Face(box=box(), landmarks=landmarks(), pose={"yaw": 45.0, "pitch": 0.0, "roll": 0.0})
        self.assertEqual(self.analyzer([1, 0], faces=[turned]).store_reference(lit(), REF)["reason"], "face_not_frontal")
        self.assertEqual(self.analyzer([1, 0], faces=[]).store_reference(lit(), REF)["reason"], "no_face")
        self.assertEqual(self.analyzer([1, 0], recognizer=False).store_reference(lit(), REF)["status"], "not_configured")

    def test_response_never_contains_an_embedding(self):
        a = self.analyzer([1, 0.05])
        a.references.put(REF, np.array([1, 0], dtype=np.float32))
        text = repr(a.analyze(lit(), REF))
        self.assertNotIn("embedding", text.lower())


def run_route(fn, **kw):
    route.verify_api_key = lambda k: None if k == KEY else (_ for _ in ()).throw(HTTPException(401, "bad key"))
    return asyncio.run(fn(**kw)) if asyncio.iscoroutinefunction(fn) else fn(**kw)


def status_of(fn, **kw):
    try:
        run_route(fn, **kw)
    except HTTPException as exc:
        return exc.status_code, exc.detail
    raise AssertionError("expected HTTPException")


class RouteTests(unittest.TestCase):
    def setUp(self):
        self._decode = fb.decode_frame
        fb.decode_frame = lambda data: lit()
        fb.set_analyzer_for_tests(fb.FaceAnalyzer(FakeDetector([good_face()])))

    def tearDown(self):
        fb.decode_frame = self._decode
        fb.set_analyzer_for_tests(None)

    def up(self, data=b"\xff\xd8\xff" + b"0" * 50, ctype="image/jpeg"):
        return UploadFile(data, filename="f.jpg", content_type=ctype)

    def test_success_returns_analysis(self):
        out = run_route(route.face_frame, frame=self.up(), reference_key="", x_ai_service_key=KEY)
        self.assertEqual(out["faceState"], "face_present")

    def test_wrong_key_is_401(self):
        self.assertEqual(status_of(route.face_frame, frame=self.up(), reference_key="", x_ai_service_key="no")[0], 401)

    def test_wrong_type_is_415_and_oversize_is_413(self):
        self.assertEqual(status_of(route.face_frame, frame=self.up(ctype="video/webm"), reference_key="", x_ai_service_key=KEY)[0], 415)
        big = self.up(data=b"\xff\xd8\xff" + b"0" * (config.FACE_FRAME_MAX_BYTES + 10))
        self.assertEqual(status_of(route.face_frame, frame=big, reference_key="", x_ai_service_key=KEY)[0], 413)

    def test_bad_reference_key_is_400(self):
        self.assertEqual(status_of(route.face_frame, frame=self.up(), reference_key="../etc", x_ai_service_key=KEY)[0], 400)

    def test_rejected_frame_is_422_with_reason(self):
        def boom(_):
            raise fb.FrameRejected("corrupt_frame", "bad")
        fb.decode_frame = boom
        code, detail = status_of(route.face_frame, frame=self.up(), reference_key="", x_ai_service_key=KEY)
        self.assertEqual((code, detail["reason"]), (422, "corrupt_frame"))

    def test_unavailable_dependency_is_503_not_a_behaviour(self):
        def boom(_):
            raise VisionUnavailable()
        fb.decode_frame = boom
        code, detail = status_of(route.face_frame, frame=self.up(), reference_key="", x_ai_service_key=KEY)
        self.assertEqual((code, detail["reason"]), (503, "vision_unavailable"))

    def test_unexpected_failure_is_500_without_internals(self):
        class Bad:
            def analyze(self, *a): raise RuntimeError("secret path /tmp/x")
        fb.set_analyzer_for_tests(Bad())
        code, detail = status_of(route.face_frame, frame=self.up(), reference_key="", x_ai_service_key=KEY)
        self.assertEqual(code, 500)
        self.assertNotIn("secret", repr(detail))

    def test_reference_roundtrip_and_delete(self):
        fb.set_analyzer_for_tests(fb.FaceAnalyzer(FakeDetector([good_face()]), FakeRecognizer(np.array([1, 0], dtype=np.float32))))
        out = run_route(route.face_reference, frame=self.up(), reference_key=REF, x_ai_service_key=KEY)
        self.assertEqual(out["status"], "stored")
        live = run_route(route.face_frame, frame=self.up(), reference_key=REF, x_ai_service_key=KEY)
        self.assertEqual(live["identity"]["status"], "verified")
        self.assertEqual(run_route(route.delete_reference, reference_key=REF, x_ai_service_key=KEY), {"deleted": True})
        self.assertEqual(run_route(route.delete_reference, reference_key=REF, x_ai_service_key=KEY), {"deleted": False})
        again = run_route(route.face_frame, frame=self.up(), reference_key=REF, x_ai_service_key=KEY)
        self.assertEqual(again["identity"]["reason"], "reference_missing_or_expired")


class StatusTests(unittest.TestCase):
    def test_status_without_opencv(self):
        orig = fb.cv2
        fb.cv2 = None
        try:
            st = fb.face_monitor_status()
            self.assertFalse(st["available"])
            self.assertEqual(st["state"], "unavailable")
        finally:
            fb.cv2 = orig

    def test_features_report_matches_detector(self):
        f = fb.FaceAnalyzer(FakeDetector([], has_landmarks=False, name="opencv_haar")).features()
        self.assertEqual(f["headPose"]["state"], "unavailable")
        self.assertEqual(f["identity"]["state"], "not_configured")
        g = fb.FaceAnalyzer(FakeDetector([]), FakeRecognizer(np.ones(2))).features()
        self.assertEqual((g["headPose"]["state"], g["gaze"]["state"], g["identity"]["state"]), ("available",) * 3)


if __name__ == "__main__":
    unittest.main()
