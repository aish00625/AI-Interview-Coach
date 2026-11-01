"""
Unit tests for app/services/evaluator.py and the rubric bank. Run with the
standard library only (no pytest needed):

    cd ai-service && python -m unittest discover -s tests -v

They exercise the pure evaluator logic. They do NOT start FastAPI, so the
HTTP layer is covered separately by the end-to-end test in the Windows guide.
"""
import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services import evaluator as ev  # noqa: E402

QUESTION_SERVICE = ROOT.parent / "backend" / "services" / "interviewQuestionService.js"
CONTRACT_KEYS = {
    "technicalScore", "relevanceScore", "clarityScore", "completenessScore",
    "strengths", "weaknesses", "suggestedImprovement", "modelAnswer",
}


def js_questions():
    """Question texts parsed from the Node question bank (single source of truth)."""
    src = QUESTION_SERVICE.read_text(encoding="utf-8")
    found = re.findall(r"text:\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\")", src)
    return [(a or b).replace("\\'", "'") for a, b in found]


class RubricBankTests(unittest.TestCase):
    def test_bank_structure(self):
        ids = [e["id"] for e in ev.REFERENCE_BANK]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(len(ids), 43)  # 25 hiring-pool + 18 practice-only
        for e in ev.REFERENCE_BANK:
            self.assertIn(e["kind"], ("concept", "star", "criteria"))
            self.assertGreaterEqual(len(e["criteria"]), 4, e["id"])
            for c in e["criteria"]:
                self.assertTrue(c["name"] and c["terms"], (e["id"], c))
                self.assertEqual(len(c["terms"]), len(set(c["terms"])), (e["id"], c["name"]))
            self.assertTrue(e["model_answer"].strip())

    @unittest.skipUnless(QUESTION_SERVICE.exists(), "backend question bank not found next to ai-service")
    def test_all_node_questions_have_a_rubric(self):
        questions = js_questions()
        self.assertEqual(len(questions), 43, questions)
        for q in questions:
            entry = ev.find_reference(q)
            self.assertIsNotNone(entry, f"no rubric for: {q}")
            self.assertIn(q, entry["questions"], f"matched by keyword, not exact text: {q}")
        # every rubric is used by exactly one question
        used = {ev.find_reference(q)["id"] for q in questions}
        self.assertEqual(len(used), 43)

    @unittest.skipUnless(QUESTION_SERVICE.exists(), "backend question bank not found next to ai-service")
    def test_kinds_match_interview_types(self):
        kinds = [ev.find_reference(q)["kind"] for q in js_questions()]
        self.assertEqual(kinds.count("concept"), 33)
        self.assertEqual(kinds.count("star"), 5)
        self.assertEqual(kinds.count("criteria"), 5)

    def test_star_rubrics_have_situation_task_action_result(self):
        for e in ev.REFERENCE_BANK:
            if e["kind"] != "star":
                continue
            names = " ".join(c["name"] for c in e["criteria"])
            for part in ("Situation", "Task", "Action", "Result"):
                self.assertIn(part, names, e["id"])

    def test_model_answers_satisfy_their_own_technical_rubric(self):
        # Sanity check of the rubric terms: the written model answer for a
        # technical question must itself be recognised as a good answer.
        for e in ev.REFERENCE_BANK:
            if e["kind"] != "concept":
                continue
            r = ev.evaluate_answer(e["questions"][0], e["model_answer"])
            self.assertGreaterEqual(r["technicalScore"], 60, (e["id"], r["missingCriteria"]))
            self.assertIn(r["confidence"], ("high", "medium"), e["id"])

    def test_bank_loader_rejects_bad_files(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.json"
            p.write_text(json.dumps({"entries": [{"id": "x", "kind": "weird"}]}))
            with self.assertRaises(ValueError):
                ev._load_bank(p)
            p.write_text(json.dumps({"entries": [
                {"id": "x", "kind": "concept", "questions": ["q"], "criteria": [{"name": "a", "terms": ["a"]}], "model_answer": "m"},
                {"id": "x", "kind": "concept", "questions": ["q"], "criteria": [{"name": "a", "terms": ["a"]}], "model_answer": "m"},
            ]}))
            with self.assertRaises(ValueError):
                ev._load_bank(p)


class MatchingTests(unittest.TestCase):
    def test_exact_and_case_insensitive_match(self):
        q = "what is the DIFFERENCE between a process and a thread?"
        self.assertEqual(ev.find_reference(q)["id"], "process_vs_thread")

    def test_keyword_fallback_needs_two_hits(self):
        self.assertEqual(ev.find_reference("Explain object oriented programming principles")["id"], "oop_principles")
        self.assertIsNone(ev.find_reference("Tell me about process"))  # one weak keyword is not enough

    def test_unknown_or_empty_question(self):
        self.assertIsNone(ev.find_reference("What is your favourite colour?"))
        self.assertIsNone(ev.find_reference(""))
        self.assertIsNone(ev.find_reference(None))

    def test_ambiguous_keyword_tie_returns_none(self):
        # "process" + "thread" hit process_vs_thread (2); craft a tie with another entry
        saved = list(ev.REFERENCE_BANK)
        try:
            a = dict(saved[0], id="a", questions=["qa"], match_keywords=["alpha", "beta"])
            b = dict(saved[1], id="b", questions=["qb"], match_keywords=["alpha", "beta"])
            ev.REFERENCE_BANK[:] = [a, b]
            self.assertIsNone(ev.find_reference("alpha beta question"))
        finally:
            ev.REFERENCE_BANK[:] = saved


class ScoringTests(unittest.TestCase):
    Q_PT = "What is the difference between a process and a thread?"

    def test_contract_shape_and_ranges(self):
        r = ev.evaluate_answer(self.Q_PT, "A process has its own memory but threads share memory inside one process.")
        self.assertTrue(CONTRACT_KEYS <= set(r))
        for k in ("technicalScore", "relevanceScore", "clarityScore", "completenessScore"):
            self.assertIsInstance(r[k], int)
            self.assertTrue(0 <= r[k] <= 100)
        self.assertIsInstance(r["strengths"], list)
        self.assertIsInstance(r["weaknesses"], list)
        self.assertTrue(r["strengths"] and r["weaknesses"])
        self.assertIn(r["confidence"], ("high", "medium", "low"))

    def test_deterministic(self):
        a = ev.evaluate_answer(self.Q_PT, "Threads share memory; a process is isolated with its own address space.")
        b = ev.evaluate_answer(self.Q_PT, "Threads share memory; a process is isolated with its own address space.")
        self.assertEqual(a, b)

    def test_good_answer_beats_bad_answer(self):
        good = ev.evaluate_answer(
            self.Q_PT,
            "A process is an independent program with its own address space. A thread is a lightweight unit "
            "inside a process and threads share memory, so a context switch between threads is cheaper, but "
            "you need synchronization such as a mutex to avoid a race condition.")
        bad = ev.evaluate_answer(self.Q_PT, "I really like watching cricket matches on weekends with my friends and family.")
        self.assertGreater(good["technicalScore"], bad["technicalScore"] + 40)
        self.assertEqual(bad["technicalScore"], 0)

    def test_empty_answer(self):
        r = ev.evaluate_answer(self.Q_PT, "   ")
        self.assertEqual((r["technicalScore"], r["completenessScore"]), (0, 0))
        self.assertEqual(r["confidence"], "low")
        # Not evaluable: there is nothing to critique, so no "missing criteria" are listed (they used to be, which implied the
        # candidate had attempted the question). The explanation is in weaknesses/answerQuality instead.
        self.assertEqual(r["missingCriteria"], [])
        self.assertEqual(r["answerQuality"]["status"], "not_evaluable")

    def test_missing_criteria_drive_feedback(self):
        r = ev.evaluate_answer(self.Q_PT, "A thread shares memory with other threads in the same process and is lightweight.")
        self.assertIn("thread: lightweight unit inside a process", r["matchedCriteria"])
        self.assertTrue(any("context switching" in m for m in r["missingCriteria"]))

    def test_word_boundaries_prevent_false_hits(self):
        # 'lock' must not match inside 'block' / 'clock'
        r = ev.evaluate_answer(self.Q_PT, "I watched the clock tick near the block of flats while the walk continued.")
        self.assertNotIn("synchronization / communication", r["matchedCriteria"])

    def test_inflections_match_longer_terms(self):
        r = ev.evaluate_answer(
            "What is the difference between a primary key and a foreign key?",
            "A primary key uniquely identifies every row, and a foreign key references another table.")
        self.assertIn("primary key uniquely identifies a row", r["matchedCriteria"])
        self.assertIn("foreign key references another table's key", r["matchedCriteria"])


class ConfidenceTests(unittest.TestCase):
    def test_unknown_question_is_low_confidence_and_says_so(self):
        r = ev.evaluate_answer("What is your favourite colour?", "My favourite colour is blue because it is calm and I like the sea.")
        self.assertEqual(r["confidence"], "low")
        self.assertEqual(r["modelAnswer"], ev.NO_REFERENCE_MODEL_ANSWER)
        self.assertIsNone(r["rubricId"])
        self.assertTrue(any("confidence is LOW" in w for w in r["weaknesses"]))

    def test_very_short_answer_is_low_confidence(self):
        r = ev.evaluate_answer("What is a deadlock, and name one way to prevent it?", "Circular wait.")
        self.assertEqual(r["confidence"], "low")
        self.assertIn("too little", r["confidenceNote"])

    def test_paraphrase_with_no_keywords_is_flagged_not_silently_failed(self):
        ans = ("It is when programs get stuck because every one of them keeps something the next one needs "
               "and then nobody can move forward at all, so you must be careful about the order you ask for things")
        r = ev.evaluate_answer("What is a deadlock, and name one way to prevent it?", ans)
        # the answer is substantively right; the evaluator must not claim certainty
        self.assertIn(r["confidence"], ("low", "medium"))
        if r["technicalScore"] == 0:
            self.assertEqual(r["confidence"], "low")
            self.assertIn("worded differently", r["confidenceNote"])

    def test_strong_technical_answer_gets_high_confidence(self):
        e = next(x for x in ev.REFERENCE_BANK if x["id"] == "binary_search")
        r = ev.evaluate_answer(e["questions"][0], e["model_answer"])
        self.assertEqual(r["confidence"], "high")

    def test_behavioural_and_hr_are_capped_at_medium(self):
        for e in ev.REFERENCE_BANK:
            if e["kind"] == "concept":
                continue
            long_text = " ".join(t for c in e["criteria"] for t in c["terms"][:3]) + " " + "word " * 80
            r = ev.evaluate_answer(e["questions"][0], long_text)
            self.assertNotEqual(r["confidence"], "high", e["id"])


class BehaviouralTests(unittest.TestCase):
    Q = "Tell me about a time you disagreed with a teammate. How did you handle it?"

    def test_full_star_answer_scores_well(self):
        ans = ("During our college project, a teammate and I disagreed about which database to use. My role was "
               "to design the data layer and we had to finish before the deadline. I listened to their reasons, "
               "then I proposed a small benchmark so we could compare both using data. As a result we agreed "
               "on PostgreSQL, delivered on time, and I learned to settle disagreements with evidence.")
        r = ev.evaluate_answer(self.Q, ans)
        self.assertEqual(r["rubricKind"], "star")
        self.assertGreaterEqual(r["technicalScore"], 80)
        self.assertEqual(r["missingCriteria"], [])
        self.assertEqual(r["confidence"], "medium")

    def test_missing_result_is_called_out(self):
        ans = ("During our college project a teammate disagreed with my approach and I had to decide what to do. "
               "I talked to them, I listened and I proposed trying both ideas for a day.")
        r = ev.evaluate_answer(self.Q, ans)
        self.assertTrue(any(m.startswith("Result") for m in r["missingCriteria"]))

    def test_vague_answer_is_low_scored_and_short_flagged(self):
        r = ev.evaluate_answer(self.Q, "I just talk to people and it works out.")
        self.assertEqual(r["confidence"], "low")
        self.assertLess(r["technicalScore"], 50)


class HrTests(unittest.TestCase):
    def test_negative_framing_is_flagged(self):
        r = ev.evaluate_answer(
            "Why are you looking to leave your current position?",
            "Honestly my boss was terrible and the company is toxic, so I am looking for something new and better to do.")
        self.assertTrue(any("moving toward" in w for w in r["weaknesses"]))

    def test_positive_framing_not_flagged(self):
        r = ev.evaluate_answer(
            "Why are you looking to leave your current position?",
            "I am grateful for what I learned, and now I am looking for new challenges and growth, which is why this "
            "role in your team is exciting. I want to work with larger systems.")
        self.assertFalse(any("moving toward" in w for w in r["weaknesses"]))
        self.assertGreaterEqual(r["technicalScore"], 75)

    def test_salary_answer_with_research_and_flexibility(self):
        r = ev.evaluate_answer(
            "What are your salary expectations for this position?",
            "Based on my research of the market range for this role I expect something in line with it, and I am "
            "flexible and open to discussing the full package including learning opportunities and my experience.")
        self.assertGreaterEqual(r["technicalScore"], 75)


class SchemaCompatibilityTests(unittest.TestCase):
    def test_response_model_accepts_evaluator_output(self):
        try:
            from app.schemas import EvaluateResponse
        except ImportError:  # pydantic not installed in this environment
            self.skipTest("pydantic not available")
        r = ev.evaluate_answer("What is a deadlock, and name one way to prevent it?", "Deadlock is circular wait; fix it with lock ordering.")
        EvaluateResponse(**r)
        legacy = {k: r[k] for k in CONTRACT_KEYS}
        EvaluateResponse(**legacy)  # old-shape payload still valid


if __name__ == "__main__":
    unittest.main()
