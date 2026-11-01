# Interview scoring (practice interviews)

The final score of a **practice** interview combines answer content with measured delivery signals using a visible weighted formula. Hiring assessments (interviews tied to a job application) stay **content-only** and have no breakdown, so employers never see behaviour data. Coding results are separate: pass/fail comes only from Docker test results and nothing here can change it.

## Formula
```
applied weight_i = configured weight_i * 100 / sum(configured weight of categories that could be measured)
points_i         = category score_i * applied weight_i / 100
final score      = sum(points_i)         (0-100, 2 decimals)
```
A category that could not be measured is reported as **unavailable with a reason**, is never scored as 0, and its weight moves to the measured categories. If nothing but content is available, the final score equals the old content-only score.

| Category | Default weight | Type | Components (share inside the category) |
|---|---|---|---|
| Answer content | 70 | automated evaluation (rule-based NLP, not a language model) | technical, relevance, clarity, completeness (25% each) |
| Speaking delivery | 12 | measured | pace 40% (articulation rate, pauses excluded), filler words 35%, long pauses 25% |
| Typing behaviour | 10 | measured | typing speed 30% (active typing time only), corrections 25%, continuity 20%, typed-vs-pasted 25% |
| Camera behaviour | 8 | measured, **experimental** | face visibility 50%, facing the camera 50% (needs the optional face-landmark model) |

Within a category, only the components actually measured count, and shares are renormalised. Each answer is scored first, then averaged over the answers that have that category.

## Avoiding double counting
Pace uses articulation rate (pauses excluded) while pauses are a separate, smaller share; typing speed uses active typing time while continuity is a smaller share. Each category contributes once at its own weight.

## Camera safeguards
Camera signals are noisy (lighting, angle, glasses) and are not evidence of ability, confidence, honesty, personality or emotion. A clip where a face was found in under 25% of frames is **not scored** (it is treated as unavailable, not penalised). Camera weight is capped at 15% and content has a 50% floor. No camera permission, no face model, or no transcript never breaks completion; the category is simply unavailable.

## Configuration
`SCORE_WEIGHT_CONTENT`, `SCORE_WEIGHT_SPEECH`, `SCORE_WEIGHT_TYPING`, `SCORE_WEIGHT_CAMERA` in `backend/.env` (optional). Values are scaled to 100%. Invalid values, content below 50%, or camera above 15% are ignored with a warning and the defaults are used. The weights actually used are stored with each session so history stays stable.

## What is and is not in the score
Measured: counts, timings and ratios. Automated evaluation: the rule-based content evaluator. AI-written text (follow-up questions, STAR coaching, AI report, coding coach) is **never** part of the score.

## Storage and history
Migration `016_score_breakdown` adds `interview_sessions.score_breakdown` (JSONB, additive). Existing sessions keep their original `final_score` and `NULL` breakdown, shown as "scored on content only". Nothing is recalculated. The dashboard, readiness, practice analytics and history average `final_score`, so new practice sessions use the composite and old ones stay content-only; trends across the switch mix the two. If composite scoring fails for any reason, completion falls back to the content-only score.

## Readiness (separate)
The preparation readiness figure is a separate calculation over `final_score` values and coding practice; it is not changed by this document and uses no extra camera data.
