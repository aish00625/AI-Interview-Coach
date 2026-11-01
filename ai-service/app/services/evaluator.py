"""
Local NLP-based semantic and concept matching evaluator.

HONESTY NOTE (per project requirements): this is NOT a large language
model and does not "understand" answers the way an LLM would. It combines
a few classical, explainable NLP techniques:
  - keyword/concept matching against a small local reference bank
  - TF-IDF + cosine similarity for a rough semantic-overlap signal
  - sentence-length-based clarity heuristics
  - answer-length-based completeness heuristics
Every score is deterministic: the same input always produces the same
output. There is no randomness and no external API call.

Design for extension: add an entry to app/data/reference_bank.json
(questions, match_keywords, criteria with synonym terms, model_answer) to
support another question without touching the scoring code below.

CONFIDENCE (added in Phase H, backward-compatible): the response carries
optional `confidence` ("high" | "medium" | "low") and `confidenceNote`
fields. The evaluator reports LOW confidence rather than pretending when
it cannot judge reliably: no matching rubric, a too-short answer, or a
long answer that matches none of the expected key terms (which may simply
be a paraphrase that keyword matching cannot recognise). Behavioural and
HR rubrics are cue-based and are capped at "medium" - they can see whether
a STAR structure is present, not whether the story is true or good.

ANSWER-QUALITY GATE (added with the "gibberish scored 55 for clarity" fix): before any score is calculated, answer_quality.inspect()
decides whether the text is language at all. Empty, symbol-only, non-English, repeated-word and random-character answers are NOT
EVALUABLE: all four scores are 0, no strengths are invented and the response says why. Evaluable answers are then labelled
too_short / off_topic / insufficient / partial / good / strong in `answerQuality`, which the dashboard shows as-is.
"""
import json
import re
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.services import answer_quality as aq
from app.utils.text_processing import STOPWORDS, tokenize, meaningful_tokens, split_sentences, word_count

# ---------------------------------------------------------------------------
# Reference / rubric bank — loaded from app/data/reference_bank.json, which
# covers every question in backend/services/interviewQuestionService.js
# (15 technical, 5 behavioural STAR, 5 HR). A question is matched first by
# its exact (normalised) text, then by keyword overlap as a fallback so
# small wording changes don't break the match. Ambiguous or weak matches
# return None rather than guessing — the evaluator then says so honestly
# (see confidence below).
# ---------------------------------------------------------------------------
_BANK_PATH = Path(__file__).resolve().parent.parent / "data" / "reference_bank.json"


def _load_bank(path: Path = _BANK_PATH) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    entries = data["entries"]
    ids = [e["id"] for e in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("reference_bank.json has duplicate entry ids")
    for e in entries:
        if e.get("kind") not in ("concept", "star", "criteria"):
            raise ValueError(f"reference_bank entry {e.get('id')} has an invalid kind")
        if not e.get("criteria") or not e.get("model_answer") or not e.get("questions"):
            raise ValueError(f"reference_bank entry {e.get('id')} is incomplete")
    return entries


REFERENCE_BANK: List[Dict[str, Any]] = _load_bank()

NO_REFERENCE_MODEL_ANSWER = (
    "No reference model answer is available for this question yet. This evaluation used general "
    "answer-quality signals (length, structure) rather than concept matching against a known answer."
)

# Length (in words) at which an answer is considered "fully developed" for
# the length component of completeness, per rubric kind.
_FULL_LENGTH_WORDS = {"concept": 40, "star": 90, "criteria": 45}
# Below this many words an answer is too short to evaluate reliably.
_MIN_RELIABLE_WORDS = {"concept": 10, "star": 30, "criteria": 15}


def _normalise(text: str) -> str:
    text = (text or "").lower().replace("\u2019", "'").replace("\u2018", "'")
    return re.sub(r"\s+", " ", text).strip()


_TERM_CACHE: Dict[str, "re.Pattern[str]"] = {}


def _term_pattern(term: str) -> "re.Pattern[str]":
    """Leading word boundary always; trailing boundary only for short terms, so longer terms also match plurals/inflections (e.g. 'uniquely identif' -> 'identifies')."""
    pat = _TERM_CACHE.get(term)
    if pat is None:
        t = re.escape(_normalise(term))
        trailing = r"(?![a-z0-9])" if len(term) <= 4 else ""
        pat = re.compile(r"(?<![a-z0-9])" + t + trailing)
        _TERM_CACHE[term] = pat
    return pat


def _clamp(value: float, low: float = 0, high: float = 100) -> int:
    return int(round(max(low, min(high, value))))


def find_reference(question: str) -> Optional[Dict[str, Any]]:
    """Exact (normalised) question match first; otherwise the entry with the most keyword hits, requiring at least 2 hits (or all of them if an entry has fewer than 2 keywords). A tie between different entries returns None instead of guessing."""
    q = _normalise(question)
    if not q:
        return None
    for entry in REFERENCE_BANK:
        if q in (_normalise(x) for x in entry["questions"]):
            return entry

    scored = []
    for entry in REFERENCE_BANK:
        keywords = entry.get("match_keywords", [])
        hits = sum(1 for kw in keywords if _normalise(kw) in q)
        needed = min(2, len(keywords))
        if hits >= max(needed, 1):
            scored.append((hits, entry))
    if not scored:
        return None
    scored.sort(key=lambda t: -t[0])
    if len(scored) > 1 and scored[0][0] == scored[1][0]:
        return None
    return scored[0][1]


def _criteria_coverage(answer_norm: str, criteria: List[Dict[str, Any]]) -> Tuple[float, List[str], List[str]]:
    """Returns (coverage_ratio, matched_criterion_names, missing_criterion_names). A criterion is matched if any of its terms occurs."""
    matched, missing = [], []
    for c in criteria:
        rx = c.get("regex")
        if any(_term_pattern(t).search(answer_norm) for t in c["terms"]) or (rx and re.search(rx, answer_norm)):
            matched.append(c["name"])
        else:
            missing.append(c["name"])
    coverage = len(matched) / len(criteria) if criteria else 0.0
    return coverage, matched, missing


def _tfidf_similarity(a: str, b: str) -> float:
    """Cosine similarity between two short texts via TF-IDF. Returns 0.0 on any degenerate input (e.g. empty answer) rather than raising."""
    a, b = (a or "").strip(), (b or "").strip()
    if not a or not b:
        return 0.0
    try:
        vectorizer = TfidfVectorizer()
        matrix = vectorizer.fit_transform([a, b])
        sim = cosine_similarity(matrix[0], matrix[1])[0][0]
        return float(sim)
    except ValueError:
        # e.g. both texts are entirely stopwords/punctuation and the
        # vectorizer ends up with an empty vocabulary.
        return 0.0


def _clarity_score(answer: str, wc: int) -> float:
    """Sentence-length-based heuristic: a moderate words-per-sentence count reads as clear; very short fragments or very long run-ons score lower. Doesn't penalize a short-but-complete answer heavily on its own — length is scored separately as completeness."""
    if wc == 0:
        return 0
    sentences = split_sentences(answer)
    if not sentences:
        avg_len = wc
    else:
        avg_len = wc / len(sentences)

    if 6 <= avg_len <= 25:
        base = 90
    elif avg_len < 6:
        base = 60 + (avg_len / 6) * 20  # short fragments: 60-80
    else:
        # long run-on sentences: decay gradually past 25 words/sentence
        overflow = avg_len - 25
        base = max(40, 90 - overflow * 1.5)

    # Tiny answers are hard to call "clear" no matter the sentence shape.
    if wc < 5:
        base = min(base, 55)

    return base


# ---------------------------------------------------------------------------
# Behavioural questions without a hand-written rubric (for example generated or custom questions) are still checked for STAR
# structure with this general checklist, so they are not judged on technical vocabulary they have no reason to use.
# ---------------------------------------------------------------------------
_BEHAVIOURAL_QUESTION = re.compile(
    r"\b(tell me about a time|describe a time|give (?:me )?an example of a time|a time (?:when|that) you|a situation (?:when|where|in which)|"
    r"walk me through a time|share an experience|think of a time|tell me about a situation|describe a situation|describe an experience)\b", re.I)

GENERIC_STAR: Dict[str, Any] = {
    "id": "generic_star", "kind": "star", "generic": True, "questions": [], "match_keywords": [], "avoid": [],
    "model_answer": (
        "No reference model answer is available for this question. This evaluation checked your answer for the four STAR elements "
        "(Situation, Task, Action, Result) with a general checklist."
    ),
    "criteria": [
        {"name": "Situation: the context and what was happening",
         "terms": ["situation", "project", "team", "teammate", "colleague", "classmate", "manager", "client", "customer", "internship", "college",
                   "university", "school", "at work", "at my", "in my last", "last year", "one time", "when i was", "during", "we were", "we had", "there was"],
         "followup": "Can you set the scene: where were you and what was happening?"},
        {"name": "Task: your role or what needed to be achieved",
         "terms": ["my role", "i was responsible", "my task", "responsible for", "goal", "needed to", "had to", "was asked", "assigned", "deadline", "objective", "my job", "my responsibility"],
         "followup": "What exactly were you responsible for, or what had to be achieved?"},
        {"name": "Action: what you personally did",
         "terms": [], "regex": r"\bi (?:[a-z]+ed|led|built|wrote|made|ran|took|chose|decided|spoke|met|taught|began|set up|came up|put together|got)\b",
         "followup": "What did you personally do? Walk me through your steps."},
        {"name": "Result: what happened as a consequence",
         "terms": ["result", "outcome", "as a result", "resulted", "achieved", "improved", "reduced", "increased", "delivered", "completed", "successfully", "learned",
                   "we finished", "it worked", "saved", "in the end", "ended up", "%"],
         "followup": "What was the outcome, and what did you learn from it?"},
    ],
}

_TECHNICAL_BASIS = {"concept": "expected-concept coverage", "star": "STAR element coverage", "criteria": "answer-quality coverage"}


def _stem(word: str) -> str:
    return word[:5]


def _topic_overlap(answer_tokens: List[str], question: str, reference: Optional[Dict[str, Any]]) -> Tuple[int, int]:
    """(distinct answer words that match the QUESTION's words, distinct answer words that match the question OR the rubric vocabulary).
    Matching is on a 5-letter stem so "identify/identifies" count as the same word."""
    answer_stems = {_stem(t) for t in answer_tokens if t not in STOPWORDS and len(t) >= 3}
    q_stems = {_stem(t) for t in meaningful_tokens(question) if len(t) >= 3}
    rubric_stems = set()
    if reference and not reference.get("generic"):
        for c in reference["criteria"]:
            for text in [c["name"], *c["terms"]]:
                rubric_stems |= {_stem(t) for t in meaningful_tokens(text) if len(t) >= 3}
    return len(answer_stems & q_stems), len(answer_stems & (q_stems | rubric_stems))



def assess_confidence(reference: Optional[Dict[str, Any]], wc: int, coverage: float) -> Tuple[str, str]:
    """
    Honest reliability statement for one evaluation: (level, note).

    low    - the scores should not be relied on (no rubric, answer too
             short, or nothing recognisable matched in a long answer)
    medium - a rubric exists and matched something, but the method is
             keyword/cue based; or any behavioural/HR rubric
    high   - technical rubric with majority of expected key terms present
    """
    if reference is None:
        return "low", (
            "No evaluation rubric matched this question, so the scores come from generic overlap and "
            "length only. Treat them as unreliable."
        )
    kind = reference["kind"]
    if wc < _MIN_RELIABLE_WORDS[kind]:
        return "low", (
            f"The answer is very short ({wc} words), which is too little to evaluate reliably. "
            "Add detail and the feedback will be more meaningful."
        )
    if kind == "concept":
        if coverage == 0 and wc >= 25:
            return "low", (
                "None of the expected key terms were detected. The answer may still be correct but worded "
                "differently - this keyword-based evaluator cannot recognise paraphrases - so the scores may "
                "understate it. Compare it with the model answer yourself."
            )
        if coverage >= 0.5:
            return "high", "Based on how many of the expected key terms your answer used. Automated and advisory."
        return "medium", (
            "Only some expected key terms were detected. Scores reflect keyword coverage, not a full "
            "understanding of your explanation."
        )
    return "medium", (
        "This is a cue-based check of structure and content (for example STAR elements). It cannot judge "
        "whether your example is true, specific or convincing, so treat it as a structure checklist."
    )


MAX_FOLLOW_UPS = 2


def follow_up_questions(reference: Optional[Dict[str, Any]], missing: List[str], confidence: str, wc: int) -> List[str]:
    """
    Targeted follow-up prompts for the criteria that were not detected, authored per criterion in the rubric (no text
    is generated). Skipped when the miss itself is unreliable: a long answer that matched nothing is more likely a
    paraphrase the keyword method cannot see than a genuinely absent concept, so asking about "missing" concepts there
    would be misleading.
    """
    if reference is None or not missing:
        return []
    if confidence == "low" and wc >= _MIN_RELIABLE_WORDS[reference["kind"]]:
        return []
    missing_set = set(missing)
    prompts = [c["followup"] for c in reference["criteria"] if c["name"] in missing_set and c.get("followup")]
    return prompts[:MAX_FOLLOW_UPS]


def _strength_and_weakness_lines(reference: Dict[str, Any], matched: List[str], missing: List[str], coverage: float):
    kind = reference["kind"]
    strengths: List[str] = []
    weaknesses: List[str] = []
    label = {"concept": "key points", "star": "STAR/answer elements", "criteria": "qualities interviewers look for"}[kind]
    if matched and coverage >= 0.6:
        strengths.append(f"Your answer covered most of the expected {label}: {'; '.join(matched[:4])}.")
    elif matched:
        strengths.append(f"Your answer included: {'; '.join(matched[:3])}.")
    if missing and coverage < 0.6:
        weaknesses.append(f"Not clearly covered: {'; '.join(missing[:4])}.")
    return strengths, weaknesses


def _not_evaluable(inspection: Dict[str, Any], reference: Optional[Dict[str, Any]], model_answer: str, base_meta: Dict[str, Any]) -> Dict[str, Any]:
    """Nothing to score: every score is 0, nothing is praised, and the response says why. Never a reference-based critique."""
    reason = inspection["reason"]
    kind = reference["kind"] if reference else None
    return {
        "technicalScore": 0, "relevanceScore": 0, "clarityScore": 0, "completenessScore": 0,
        "strengths": [],
        "weaknesses": [reason],
        "suggestedImprovement": (
            "Write a few complete sentences in your own words that answer the question, starting with the main point. "
            "Then add an example or a reason to support it."
        ),
        "modelAnswer": model_answer,
        "confidence": "low",
        "confidenceNote": "The answer could not be evaluated, so these zeros mean 'not scored', not 'scored and found wrong'. " + reason,
        "matchedCriteria": [], "missingCriteria": [], "followUps": [],
        "answerQuality": aq.build_summary("not_evaluable", [reason], inspection, _TECHNICAL_BASIS.get(kind, "none (not scored)")),
        **base_meta,
    }


def evaluate_answer(question: str, answer: str, target_role: Optional[str] = None,
                     difficulty: Optional[str] = None, interview_type: Optional[str] = None) -> Dict[str, Any]:
    """
    Deterministic evaluation - same inputs always produce the same scores. Order of work:

      1. answer_quality.inspect(): is this language at all? If not, the answer is NOT EVALUABLE (all scores 0, explained).
      2. Pick the rubric: the authored one for this question, or the general STAR checklist for an unmatched behavioural question.
      3. Score the four categories. Text that does not touch the question earns no completeness/relevance/technical credit
         just for being long ("off topic"); a clarity score never exceeds what the word-likeness of the text supports.
      4. Label the outcome (`answerQuality.status`) and state how far it can be trusted (`confidence`).

    For behavioural (star) and HR (criteria) rubrics, `technicalScore` is the share of expected STAR elements / answer
    qualities detected: a structure-and-content score that does not require technical vocabulary. `answerQuality.scoreBasis`
    says which basis was used. target_role/difficulty/interview_type are accepted for future use and do not change scoring.
    """
    answer = (answer or "").strip()
    reference = find_reference(question)
    if reference is None and _BEHAVIOURAL_QUESTION.search(question or ""):
        reference = GENERIC_STAR
    model_answer = reference["model_answer"] if reference else NO_REFERENCE_MODEL_ANSWER
    base_meta = {
        "rubricId": reference["id"] if reference else None,
        "rubricKind": reference["kind"] if reference else None,
    }

    inspection = aq.inspect(answer, question)
    if inspection["gate"] != "ok":
        return _not_evaluable(inspection, reference, model_answer, base_meta)

    tokens = inspection["tokens"]
    wc = inspection["wordCount"]
    answer_norm = _normalise(answer)
    overlap_q, overlap_all = _topic_overlap(tokens, question, reference)

    if reference:
        kind = reference["kind"]
        coverage, matched, missing = _criteria_coverage(answer_norm, reference["criteria"])
        reference_text = question + " " + " ".join(c["name"] for c in reference["criteria"])
        similarity = _tfidf_similarity(answer, reference_text)
        short = wc < _MIN_RELIABLE_WORDS[kind]
        if kind == "star":
            off_topic = wc >= 20 and overlap_q == 0 and coverage <= 0.25
        else:
            off_topic = wc >= 12 and coverage == 0 and overlap_all <= 1
        basis = _TECHNICAL_BASIS[kind]
    else:
        q_tokens = set(meaningful_tokens(question))
        a_tokens = set(meaningful_tokens(answer))
        overlap = len(q_tokens & a_tokens) / len(q_tokens) if q_tokens else 0.0
        similarity = _tfidf_similarity(answer, question)
        coverage, matched, missing = 0.0, [], []
        kind = None
        short = wc < 10
        off_topic = wc >= 12 and overlap_q == 0 and similarity < 0.05
        basis = "overlap with the question's own words (no rubric matched)"

    if reference:
        technical_score = _clamp(coverage * 100)
        # Blended rather than pure TF-IDF: cosine similarity on short texts is noisy on its own, so criteria coverage
        # anchors it while similarity still adds a genuine semantic-overlap signal beyond keyword presence.
        relevance_score = _clamp((similarity * 0.5 + coverage * 0.5) * 100)
        length_score = min(1.0, wc / _FULL_LENGTH_WORDS[kind])
        # Length only earns credit when the answer touches the question; a long answer that matches nothing is not "complete".
        length_credit = length_score * 0.3 * (1.0 if coverage > 0 else 0.5)
        completeness_score = _clamp((coverage * 0.7 + length_credit) * 100)
    else:
        technical_score = _clamp(overlap * 70)  # capped lower - no verified criteria list to reward full marks against
        relevance_score = _clamp((similarity * 0.5 + overlap * 0.5) * 100)
        completeness_score = _clamp(min(1.0, wc / 40) * (1.0 if overlap_q > 0 else 0.5) * 100)

    if off_topic:
        technical_score, relevance_score, completeness_score = min(technical_score, 10), min(relevance_score, 10), 0

    # Clarity: sentence shape, scaled by how much of the text is real words (so mostly-odd text cannot score as "clear").
    wordlike = inspection["wordLikeRatio"] or 0.0
    clarity_score = _clamp(_clarity_score(answer, wc) * min(1.0, wordlike / 0.9))

    # Keyword stuffing: a run of terms with no sentence structure. Vocabulary alone is not an explanation, so content credit is
    # halved, clarity and completeness are capped low, and the result is flagged low-confidence (see assess below).
    unstructured = bool(inspection.get("unstructured")) and not off_topic
    if unstructured:
        technical_score = _clamp(technical_score * 0.5)
        relevance_score = _clamp(relevance_score * 0.5)
        completeness_score = min(completeness_score, 30)
        clarity_score = min(clarity_score, 30)

    strengths: List[str] = []
    weaknesses: List[str] = []
    if reference and not off_topic:
        strengths, weaknesses = _strength_and_weakness_lines(reference, matched, missing, coverage)
        avoid = [w for w in reference.get("avoid", []) if _term_pattern(w).search(answer_norm)]
        if avoid:
            weaknesses.append(reference.get("avoid_note", "Consider rewording the negative phrasing."))

    if unstructured:
        weaknesses.insert(0, "Your answer is a list of keywords, not sentences. Explain each idea in your own words; keywords alone do not show understanding.")
    if short:
        weaknesses.insert(0, f"Your answer is only {wc} word{'s' if wc != 1 else ''} long, which is too little to judge reliably. Add detail and an example.")
    elif off_topic:
        weaknesses.insert(0, "Your answer did not address what the question asked: almost none of its words relate to the question's topic.")
    elif wc < 15:
        weaknesses.append("Add a little more explanation or an example.")
    if not short and not off_topic and clarity_score >= 70 and wc >= 15:
        strengths.append("Your response was concise and easy to follow.")
    if clarity_score < 40 and not short:
        weaknesses.append("Try breaking your answer into shorter, clearer sentences.")

    confidence, confidence_note = assess_confidence(reference, wc, coverage)
    if off_topic:
        confidence = "medium"
        confidence_note = (
            "Almost none of the words in your answer relate to the question, so it was marked as not addressing it. "
            "If you used very different wording, compare your answer with the model answer yourself."
        )
    if unstructured:
        confidence = "low"
        confidence_note = aq.UNSTRUCTURED_REASON
    if reference and reference.get("generic"):
        confidence_note += " No question-specific rubric exists, so only the four general STAR elements were checked."
    if confidence == "low":
        weaknesses.append("Automated confidence is LOW for this answer: " + confidence_note)

    scores = {"completenessScore": completeness_score, "clarityScore": clarity_score, "relevanceScore": relevance_score, "technicalScore": technical_score}
    average = (technical_score + relevance_score + clarity_score + completeness_score) / 4
    status = aq.classify(average=average, coverage=coverage if reference else None, short=short, off_topic=off_topic,
                         has_rubric=bool(reference), low_confidence=(confidence == "low"), unstructured=unstructured)

    # Targeted, not generic: point at the weakest of the four scores, using only criteria that were actually not detected.
    weakest = min(scores, key=scores.get)
    missing_hint = "; ".join(missing[:3])
    if off_topic:
        suggested_improvement = "Re-read the question and answer it directly. Start with the main point, then support it with a reason or an example."
    elif unstructured and not short:
        suggested_improvement = "Turn your list of terms into sentences: say what each idea means and how it connects to the question, with a reason or an example."
    elif short:
        suggested_improvement = (
            f"Expand this into several sentences. Cover: {missing_hint}." if reference and missing
            else "Expand this into several sentences and add a specific example."
        )
    else:
        suggestion_by_weakest = {
            "completenessScore": (f"Try to cover more of what the question expects, such as: {missing_hint}." if reference and missing
                                  else "Try to cover more ground in your answer - add another point or a specific example."),
            "clarityScore": "Break your answer into shorter, clearer sentences so it's easier to follow.",
            "relevanceScore": "Focus more directly on what the question is actually asking.",
            "technicalScore": (f"Make sure your answer addresses: {missing_hint}." if reference and missing
                               else "Double-check the core concept the question is testing and make sure your answer addresses it directly."),
        }
        suggested_improvement = suggestion_by_weakest[weakest]

    reasons = []
    if short:
        reasons.append(f"The answer is {wc} word{'s' if wc != 1 else ''} long; at least {_MIN_RELIABLE_WORDS[kind] if reference else 10} are needed to judge it reliably.")
    if off_topic:
        reasons.append("Almost none of the answer's words relate to the question, so it was not given credit for the content it did not cover.")
    if status == "insufficient" and not short and not off_topic:
        reasons.append("Few of the expected points were found in the answer.")
    if unstructured:
        reasons.append(aq.UNSTRUCTURED_REASON)
    elif confidence == "low" and not short:
        reasons.append(confidence_note)

    return {
        "technicalScore": technical_score,
        "relevanceScore": relevance_score,
        "clarityScore": clarity_score,
        "completenessScore": completeness_score,
        "strengths": strengths,
        "weaknesses": weaknesses or (["Consider adding a concrete example to strengthen your answer further."] if status in ("good", "strong") else []),
        "suggestedImprovement": suggested_improvement,
        "modelAnswer": model_answer,
        "confidence": confidence,
        "confidenceNote": confidence_note,
        "matchedCriteria": matched,
        "missingCriteria": missing,
        "followUps": follow_up_questions(reference, missing, confidence, wc) if not off_topic else [],
        "answerQuality": aq.build_summary(status, reasons, inspection, basis),
        **base_meta,
    }
