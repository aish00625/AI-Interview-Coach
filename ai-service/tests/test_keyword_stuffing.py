"""Keyword stuffing and pronounceable-nonsense handling (audit findings P0-1 and P0-2). Deterministic, no model, no network."""
import unittest

from app.services import answer_quality as aq
from app.services.evaluator import evaluate_answer

Q = "What is a database index and when can it slow a query?"
KEYWORDS = "index database query slow write storage btree lookup column insert update delete"
NONSENSE = "bakelumop furnitagle splorkent wobble zindar plomket furnotic blapsure quendle tirvash"
GOOD = ("A database index is a structure like a B-tree that makes lookups on a column faster. But every insert, update or delete "
        "must also maintain the index, so heavy write workloads get slower and the index uses extra storage.")
PARTIAL = "An index makes reads faster because the database does not scan the whole table, but it uses more storage."


class KeywordStuffingTests(unittest.TestCase):
    def test_keyword_list_is_flagged_unstructured(self):
        r = aq.inspect(KEYWORDS, Q)
        self.assertEqual(r["gate"], "ok")
        self.assertTrue(r["unstructured"])
        self.assertLess(r["functionWordShare"], aq.MIN_FUNCTION_WORD_SHARE)

    def test_keyword_list_is_not_rewarded(self):
        r = evaluate_answer(Q, KEYWORDS)
        self.assertLessEqual(r["clarityScore"], 30)      # previously 90
        self.assertLessEqual(r["completenessScore"], 30)
        self.assertEqual(r["confidence"], "low")           # previously "high"
        self.assertEqual(r["answerQuality"]["status"], "insufficient")
        self.assertEqual(r["answerQuality"]["sentenceStructure"], "keyword_list")
        self.assertTrue(any("keyword" in x.lower() for x in r["answerQuality"]["reasons"]))

    def test_keyword_list_scores_below_same_ideas_in_sentences(self):
        listed, sentences = evaluate_answer(Q, KEYWORDS), evaluate_answer(Q, GOOD)
        for k in ("technicalScore", "relevanceScore", "clarityScore", "completenessScore"):
            self.assertLess(listed[k], sentences[k], k)

    def test_pronounceable_nonsense_without_structure_is_not_evaluable(self):
        r = evaluate_answer(Q, NONSENSE)
        self.assertEqual(r["answerQuality"]["status"], "not_evaluable")
        self.assertEqual(r["technicalScore"] + r["relevanceScore"] + r["clarityScore"] + r["completenessScore"], 0)
        self.assertIn("sentence structure", r["answerQuality"]["reasons"][0])

    def test_known_limit_nonsense_inside_sentence_structure_is_not_detected(self):
        # Documented limitation: spelling and function-word checks cannot recognise nonsense that is dressed as a sentence.
        r = aq.inspect("The bakelumop is a furnitagle of the splorkent and it is the wobble of the zindar", Q)
        self.assertEqual(r["gate"], "ok")
        self.assertFalse(r["unstructured"])

    def test_valid_and_partial_answers_unaffected(self):
        good, partial = evaluate_answer(Q, GOOD), evaluate_answer(Q, PARTIAL)
        self.assertEqual(good["answerQuality"]["status"], "good")
        self.assertEqual(good["answerQuality"]["sentenceStructure"], "sentences")
        self.assertEqual(good["confidence"], "high")
        self.assertEqual(partial["answerQuality"]["status"], "partial")
        self.assertGreaterEqual(partial["clarityScore"], 70)

    def test_terse_but_grammatical_answer_is_not_penalised(self):
        r = evaluate_answer(Q, "Indexes use B-tree structures. They speed up reads but slow writes, and cost storage.")
        self.assertEqual(r["answerQuality"]["sentenceStructure"], "sentences")
        self.assertGreaterEqual(r["clarityScore"], 70)

    def test_existing_gates_still_fire(self):
        for text, gate in (("", "empty"), ("dshdgubc", "gibberish"), ("index index index index index", "repeated")):
            self.assertEqual(aq.inspect(text, Q)["gate"], gate, text)

    def test_deterministic(self):
        self.assertEqual(evaluate_answer(Q, KEYWORDS), evaluate_answer(Q, KEYWORDS))


if __name__ == "__main__":
    unittest.main()
