# Answer-quality validation

## What was wrong

The evaluator scored the *shape* of an answer (sentence length, word count) and never asked whether the text was language. A single
unpunctuated token such as `dshdgubc` counted as one short "fragment": `_clarity_score` gave it 60 + 3.3 and the tiny-answer cap then
clamped it to exactly **55**. A hard-coded fallback strength ("You submitted an answer.") was added whenever nothing else applied, and
long text earned completeness credit through a length bonus even when it matched nothing in the question.

## What happens now

`ai-service/app/services/answer_quality.py` runs first, then `evaluator.py` scores. Everything is deterministic (no model, no network,
no randomness).

### 1. Gate: can this be evaluated at all?

| Gate | Trigger | Result |
|---|---|---|
| `empty` | nothing or only whitespace | not evaluable |
| `no_words` | only digits or symbols | not evaluable |
| `unsupported_language` | letters present but not English (the evaluator only reads English) | not evaluable |
| `repeated` | 3+ words with at most 34% unique, or one word making up 60%+ of 4+ words | not evaluable |
| `gibberish` | fewer than half of the tokens are word-like | not evaluable |

A token is **word-like** when it is a known word (the question, the project's rubric vocabulary, English function words, common technical
acronyms) or passes these checks: no run of 3+ identical letters, no keyboard-row run (`qwer`, `asdf`), no repeating block (`hjkhjkhjk`),
at least one vowel, no 5+ consonants in a row, an acceptable vowel share, and only consonant pairs that occur in English words.
Single letters are fine as variable names but not when they make up 75%+ of an answer.

Because an answer is rejected only when **fewer than half** its tokens look like words, a real answer containing a few identifiers or
acronyms is never rejected. Code snippets and acronym-heavy answers pass.

**Limits.** Pronounceable nonsense ("bakelumop") is not detected as gibberish; it falls through to the relevance checks and earns almost
nothing there. The evaluator also cannot tell a true statement from a false one that uses the same keywords; it measures coverage of the
expected concepts, so a wrong answer that misses them scores low, but a wrong answer that uses the right words can still score well.

### 2. Not evaluable answers

All four scores are `0`, `strengths` is empty, `matchedCriteria`/`missingCriteria`/`followUps` are empty, and the response explains why in
plain words. Confidence is `low`, and the note says the zeros mean *not scored*, not *scored and found wrong*. The dashboard shows
"Not scored" instead of numbers. Note: the 0 still counts toward the session's average, because the question was asked and not answered
meaningfully.

### 3. Evaluable answers

Scored as before (technical = expected-concept coverage; relevance = blend of TF-IDF similarity and coverage; clarity = sentence shape
scaled by how word-like the text is; completeness = coverage plus a length bonus), with these changes:

* **Off topic.** If a long answer shares almost no words with the question or the rubric (technical/concept: coverage 0 and at most one
  matching word; STAR: no word from the question and at most one STAR element found), technical and relevance are capped at 10 and
  completeness is 0. Text does not earn points just for being long.
* **Length bonus needs content.** With zero coverage the length bonus is halved.
* **Behavioural questions** use STAR coverage as the "technical" score (`scoreBasis` says so, and the dashboard shows "Based on STAR
  element coverage"), so they are not penalised for lacking technical vocabulary. A behavioural question with no authored rubric uses a
  general STAR checklist (`rubricId: generic_star`).
* **No filler feedback.** "You submitted an answer." is gone. Strengths only list criteria actually detected.

### 4. Status and confidence

`answerQuality.status` is one of:

| Status | Label | Meaning |
|---|---|---|
| `not_evaluable` | Not evaluable | gate failed |
| `too_short` | Too short to evaluate reliably | understandable, but under the minimum words for this kind of question (10 concept, 30 STAR, 15 HR) |
| `off_topic` | Doesn't address the question | see above |
| `insufficient` | Meaningful but insufficient | average under 35, or under 25% of expected points |
| `partial` | Partially complete | average under 70, or under 60% of expected points (also the most an unmatched question can be) |
| `good` | Good answer | average 70+ and 60%+ of expected points |
| `strong` | Strong answer | average 85+, 80%+ of expected points and not low confidence |

"Average" is the plain average of the four displayed scores: the same figure as the answer-score ring and the session formula, so there
is no separate weighting. **Confidence** is separate from the score: it states how far the automated check can be trusted (no rubric,
too short, nothing matched in a long answer, low speech-recognition confidence) and the dashboard shows the reason in its own box.

## Where it lives

* AI service: `app/services/answer_quality.py` (new), `app/services/evaluator.py`, `app/schemas.py` (`answerQuality` optional field).
* Backend: `services/aiServiceClient.js` whitelists `answerQuality` into `evaluation_meta` (existing JSONB column: **no migration**). The
  label is chosen from the status on the backend, never taken from the AI service.
* Frontend: `utils/resultsView.js` (`qualityView`, `verdict`, `answerScores`) and `components/ResultsQuestionView.jsx`. The frontend
  displays what the backend decided and never recomputes a score or status. Answers saved before this change have no status and render
  exactly as before.

## What hiring teams see

On the application review page each assessment answer now shows its status label ("Not evaluable", "Partially complete", ...) and a
"Low confidence" note when it applies. An answer that was not evaluable shows "Not scored" instead of four zeros. The compare view has an
"Answers to treat with caution" row (how many answers were not evaluable or low confidence, out of the total), and notes that unreadable
answers count as 0 in the averages.

Privacy: the hirer queries read exactly two fields out of the stored evaluation (`answerQuality.status` and `confidence`). Reasons,
criteria lists, follow-up prompts and coaching text are never selected. The guard test in `tests/phaseH/evaluation_meta.test.js` fails if any
other part of `evaluation_meta` is read, and `tests/phaseE/hirer_review_realdb.test.js` checks that private strings do not appear in the review.

## Tuning

Thresholds are constants at the top of `answer_quality.py` and in `evaluator.py` (`_MIN_RELIABLE_WORDS`, the off-topic rules).
