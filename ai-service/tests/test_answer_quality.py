"""
Answer-quality validation + the scoring rules built on it. These tests assert PROPERTIES and score ranges, never one exact
sentence, so they keep passing when feedback wording is improved.
"""
import unittest

from app.services import answer_quality as aq
from app.services import evaluator as ev

Q_PKFK = "What is the difference between a primary key and a foreign key?"
Q_STAR = "Tell me about a time you disagreed with a teammate. How did you handle it?"
Q_OOP = "What are the four main principles of Object-Oriented Programming?"
Q_CUSTOM_STAR = "Describe a time when you had to convince a sceptical stakeholder."  # no authored rubric -> general STAR checklist

GOOD_STAR = (
    "During my college project my teammate wanted a different approach to the database design, and we disagreed about it. "
    "My role was to deliver the backend by the deadline. I listened to her reasons, built a small prototype of both options and we "
    "compared them together. As a result we picked the faster option, finished on time and I learned to settle disagreements with evidence."
)
GOOD_PKFK = (
    "A primary key uniquely identifies each row in a table and cannot be null, while a foreign key is a column that references the "
    "primary key of another table to enforce referential integrity between the two tables."
)
SCORES = ("technicalScore", "relevanceScore", "clarityScore", "completenessScore")


def avg(r):
    return sum(r[k] for k in SCORES) / 4


class NotEvaluableTests(unittest.TestCase):
    def check_not_evaluable(self, answer, question=Q_PKFK):
        r = ev.evaluate_answer(question, answer)
        self.assertEqual([r[k] for k in SCORES], [0, 0, 0, 0], answer)
        self.assertEqual(r["answerQuality"]["status"], "not_evaluable")
        self.assertFalse(r["answerQuality"]["evaluable"])
        self.assertEqual(r["confidence"], "low")
        self.assertEqual(r["strengths"], [], "nothing may be praised when nothing was evaluated")
        self.assertEqual((r["matchedCriteria"], r["missingCriteria"], r["followUps"]), ([], [], []))
        self.assertTrue(r["weaknesses"] and r["answerQuality"]["reasons"])
        return r

    def test_1_empty_answer(self):
        self.check_not_evaluable("")

    def test_2_whitespace_only(self):
        self.check_not_evaluable("  \n\t  ")

    def test_3_random_text_does_not_get_55_clarity(self):
        r = self.check_not_evaluable("dshdgubc")
        self.assertNotEqual(r["clarityScore"], 55)
        self.assertRegex(r["weaknesses"][0], r"understandable|real words")
        self.assertNotIn("You submitted an answer", " ".join(r["strengths"]))

    def test_4_repeated_characters(self):
        self.check_not_evaluable("aaaaaaaaaa")
        self.check_not_evaluable("hhhhhhhhh jjjjjjjj")

    def test_5_repeated_meaningless_words(self):
        self.check_not_evaluable("blah blah blah blah blah blah")
        self.check_not_evaluable("test test test test")
        self.check_not_evaluable("asdf asdf asdf asdf")

    def test_keyboard_mashing_and_symbols_and_numbers(self):
        for text in ("qwertyuiop", "asdfghjkl zxcvbnm", "hjkhjkhjk", "sdkjfhgl wkjehrt", "12345 67890", "?!?!?! ...", "a s d f g h"):
            self.check_not_evaluable(text)

    def test_non_english_text_is_reported_as_unsupported_not_scored_as_gibberish(self):
        r = self.check_not_evaluable("यह एक उत्तर है जो हिंदी में लिखा गया है")
        self.assertIn("English", r["weaknesses"][0])

    def test_one_gibberish_word_among_real_ones_is_not_rejected(self):
        r = ev.evaluate_answer(Q_PKFK, GOOD_PKFK + " The ORM maps it, e.g. xkcdqq.")
        self.assertNotEqual(r["answerQuality"]["status"], "not_evaluable")

    def test_code_and_acronym_heavy_answers_are_not_rejected(self):
        for text in ("SELECT * FROM users WHERE id = 1; this returns one row from the table.", "for i in range(n): total += x[i] # O(n) time and O(1) space"):
            self.assertNotEqual(ev.evaluate_answer(Q_PKFK, text)["answerQuality"]["status"], "not_evaluable", text)


class MeaningfulButWeakTests(unittest.TestCase):
    def test_6_meaningful_short_answer_is_not_gibberish_and_gets_low_confidence(self):
        r = ev.evaluate_answer(Q_STAR, "I used Python")
        self.assertEqual(r["answerQuality"]["status"], "too_short")
        self.assertTrue(r["answerQuality"]["evaluable"])
        self.assertEqual(r["confidence"], "low")
        self.assertTrue(any("3 words" in w for w in r["weaknesses"]), "feedback should be grounded in the answer's actual length")
        self.assertTrue(all(0 <= r[k] <= 100 for k in SCORES))
        self.assertLess(avg(r), 40)

    def test_short_but_correct_technical_answer_gets_partial_credit(self):
        r = ev.evaluate_answer(Q_PKFK, "A primary key uniquely identifies rows.")
        self.assertEqual(r["answerQuality"]["status"], "too_short")
        self.assertGreater(r["technicalScore"], 0)
        self.assertEqual(r["confidence"], "low")

    def test_7_relevant_but_incomplete_star_names_only_the_missing_elements(self):
        answer = ("In my college project my teammate and I disagreed about the database design for our team assignment, and the disagreement "
                  "went on for a few days because we both had strong opinions about how the tables should be organised.")
        r = ev.evaluate_answer(Q_STAR, answer)
        self.assertIn(r["answerQuality"]["status"], ("insufficient", "partial", "too_short"))
        self.assertTrue(any(c.startswith("Situation") for c in r["matchedCriteria"]), r["matchedCriteria"])
        self.assertFalse(any(c.startswith("Situation") for c in r["missingCriteria"]), "Situation has evidence, so it must not be listed as missing")
        self.assertTrue(any(c.startswith("Result") for c in r["missingCriteria"]))
        self.assertGreater(r["relevanceScore"], 0)
        self.assertLess(avg(r), 60)

    def test_8_complete_star_answer_scores_well(self):
        r = ev.evaluate_answer(Q_STAR, GOOD_STAR)
        self.assertIn(r["answerQuality"]["status"], ("good", "strong"))
        self.assertGreaterEqual(avg(r), 70)
        self.assertEqual(r["missingCriteria"], [])
        self.assertTrue(r["strengths"])

    def test_9_correct_technical_answer(self):
        r = ev.evaluate_answer(Q_PKFK, GOOD_PKFK)
        self.assertIn(r["answerQuality"]["status"], ("good", "strong"))
        self.assertGreaterEqual(r["technicalScore"], 70)
        self.assertGreaterEqual(avg(r), 70)

    def test_10_incorrect_technical_answer_scores_low_without_being_called_gibberish(self):
        r = ev.evaluate_answer(Q_PKFK, "A primary key is used to encrypt data in the database and a foreign key opens a connection to a remote server over the network.")
        self.assertTrue(r["answerQuality"]["evaluable"])
        self.assertEqual(r["answerQuality"]["status"], "insufficient")
        self.assertLess(r["technicalScore"], 30)
        self.assertGreater(r["clarityScore"], 60, "it is a readable sentence; only the content is wrong")

    def test_11_long_irrelevant_answer_is_off_topic_and_earns_no_content_credit(self):
        answer = ("I really enjoy playing football with my friends on the weekends and we usually go to the park near my house every Sunday "
                  "morning after breakfast, and then we get some lunch together before heading home to relax.")
        for question in (Q_PKFK, Q_OOP, Q_STAR):
            r = ev.evaluate_answer(question, answer)
            self.assertEqual(r["answerQuality"]["status"], "off_topic", question)
            self.assertEqual(r["completenessScore"], 0)
            self.assertLessEqual(r["technicalScore"], 10)
            self.assertLessEqual(r["relevanceScore"], 10)
            self.assertEqual(r["strengths"], [])
            self.assertEqual(r["followUps"], [])

    def test_12_normal_answer_gets_good_clarity(self):
        r = ev.evaluate_answer(Q_PKFK, GOOD_PKFK + " Together they link tables. A table can have only one primary key but several foreign keys.")
        self.assertGreaterEqual(r["clarityScore"], 70)


class ScoringRuleTests(unittest.TestCase):
    def test_scores_stay_within_0_100_for_a_range_of_inputs(self):
        for a in ("", "x", "I used Python", "dshdgubc", GOOD_STAR, GOOD_PKFK, "word " * 600, "A primary key. " * 80):
            for q in (Q_PKFK, Q_STAR, Q_CUSTOM_STAR, "Something unrelated entirely?"):
                r = ev.evaluate_answer(q, a)
                for k in SCORES:
                    self.assertIsInstance(r[k], int)
                    self.assertTrue(0 <= r[k] <= 100, (q, a[:20], k, r[k]))

    def test_every_response_carries_a_consistent_answer_quality_block(self):
        for a in ("", "dshdgubc", "I used Python", GOOD_STAR, GOOD_PKFK):
            r = ev.evaluate_answer(Q_PKFK, a)
            q = r["answerQuality"]
            self.assertIn(q["status"], aq.STATUSES)
            self.assertEqual(q["label"], aq.STATUS_LABELS[q["status"]])
            self.assertEqual(q["evaluable"], q["status"] != "not_evaluable")
            if q["status"] in ("not_evaluable", "too_short"):
                self.assertEqual(r["confidence"], "low", "low-confidence results must be labelled")

    def test_status_is_consistent_with_the_four_displayed_scores(self):
        """The dashboard's answer score is the plain average of the four scores; the status must agree with that figure."""
        for q, a in ((Q_PKFK, GOOD_PKFK), (Q_STAR, GOOD_STAR), (Q_PKFK, "A primary key is used to encrypt data and a foreign key opens a remote connection."),
                     (Q_STAR, "In my college project my teammate and I disagreed about the database design for our team assignment and it lasted days.")):
            r = ev.evaluate_answer(q, a)
            status, average = r["answerQuality"]["status"], avg(r)
            if status == "strong":
                self.assertGreaterEqual(average, 85)
            elif status == "good":
                self.assertGreaterEqual(average, 70)
            elif status == "insufficient":
                self.assertTrue(average < 35 or r["answerQuality"]["scoreBasis"])
            elif status == "partial":
                self.assertTrue(average < 85)

    def test_behavioural_questions_are_not_penalised_for_missing_technical_vocabulary(self):
        r = ev.evaluate_answer(Q_STAR, GOOD_STAR)
        self.assertGreaterEqual(r["technicalScore"], 70)
        self.assertEqual(r["answerQuality"]["scoreBasis"], "STAR element coverage")

    def test_unmatched_behavioural_question_uses_the_general_star_checklist(self):
        full = ("At my internship last year I had to convince a sceptical stakeholder to approve a new release process. My task was to "
                "present the risks and benefits. I collected data from past releases, built a short demo and asked a senior engineer to review "
                "my slides. As a result the stakeholder approved the process and we shipped two weeks earlier.")
        r = ev.evaluate_answer(Q_CUSTOM_STAR, full)
        self.assertEqual(r["rubricKind"], "star")
        self.assertEqual(r["rubricId"], "generic_star")
        self.assertEqual(r["answerQuality"]["scoreBasis"], "STAR element coverage")
        self.assertEqual(r["missingCriteria"], [])
        self.assertTrue(r["modelAnswer"].lower().startswith("no reference model answer"))
        partial = ev.evaluate_answer(Q_CUSTOM_STAR, "Last year at my internship we had a tight deadline for a release and a lot of work to do before the end of the week.")
        self.assertTrue(any(c.startswith("Result") for c in partial["missingCriteria"]))

    def test_technical_questions_are_scored_on_expected_concepts(self):
        r = ev.evaluate_answer(Q_OOP, "The four principles are encapsulation, inheritance, polymorphism and abstraction, which together organise code into reusable objects.")
        self.assertEqual(r["answerQuality"]["scoreBasis"], "expected-concept coverage")
        self.assertGreaterEqual(r["technicalScore"], 90)

    def test_feedback_is_grounded_not_generic(self):
        for a in ("", "dshdgubc", "I used Python", GOOD_PKFK):
            r = ev.evaluate_answer(Q_PKFK, a)
            joined = " ".join(r["strengths"] + r["weaknesses"])
            self.assertNotIn("You submitted an answer", joined)
        # strengths only ever name things that were actually detected
        r = ev.evaluate_answer(Q_PKFK, GOOD_PKFK)
        for c in r["matchedCriteria"]:
            self.assertIn(c, " ".join(r["strengths"]) + " ".join(r["matchedCriteria"]))
        self.assertTrue(all(c not in r["matchedCriteria"] for c in r["missingCriteria"]))

    def test_no_reference_critique_for_unevaluable_answers(self):
        r = ev.evaluate_answer(Q_PKFK, "dshdgubc")
        self.assertEqual((r["matchedCriteria"], r["missingCriteria"], r["followUps"]), ([], [], []))
        self.assertNotIn("primary key", " ".join(r["weaknesses"] + [r["suggestedImprovement"]]).lower())

    def test_deterministic(self):
        a = ev.evaluate_answer(Q_STAR, GOOD_STAR)
        b = ev.evaluate_answer(Q_STAR, GOOD_STAR)
        self.assertEqual(a, b)


class ResponseContractTests(unittest.TestCase):
    def test_every_outcome_validates_against_the_response_schema(self):
        from app.schemas import EvaluateResponse
        for a in ("", "dshdgubc", "I used Python", GOOD_STAR, GOOD_PKFK, "football football football"):
            EvaluateResponse(**ev.evaluate_answer(Q_PKFK, a))

    def test_speech_pipeline_keeps_the_quality_block(self):
        from app.services import speech_processor
        r = ev.evaluate_answer(Q_PKFK, "dshdgubc")
        out = speech_processor.apply_transcript_confidence(r, {"level": "low"})
        self.assertEqual(out["answerQuality"]["status"], "not_evaluable")
        self.assertEqual(out["confidence"], "low")


class TokenTests(unittest.TestCase):
    def test_real_words_pass_and_nonsense_fails(self):
        for w in ("python", "database", "scripts", "strings", "scroll", "property", "encapsulation", "I", "a", "to", "kubernetes", "postgresql", "http", "sql"):
            self.assertTrue(aq.token_is_wordlike(w), w)
        for w in ("dshdgubc", "aaaa", "qwerty", "asdf", "zxcvb", "hjkhjk", "xkcd", "bcdfg", "sdkjfhgl", "zz"):
            self.assertFalse(aq.token_is_wordlike(w), w)


if __name__ == "__main__":
    unittest.main()
