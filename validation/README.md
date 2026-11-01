# Evaluator validation study — kit (STATUS: PENDING)

This folder contains everything needed to measure how closely the app's automated answer evaluator agrees with human
graders. **No human annotations exist yet, so there are no results, correlations or accuracy figures anywhere in this
project, and none may be quoted until `tools/analyze_validation.py` has produced `report.md` from real graded data.**
Until then the honest statement is: *"the evaluator is a deterministic keyword/similarity checker whose agreement with
human graders has not been measured."* The app already says this to users (AdvisoryNote).

## What is here
| File | Purpose |
|---|---|
| `STUDY_PROTOCOL.md` | Design: who contributes answers, how many, consent, blinding, graders, what may be claimed |
| `RUBRIC.md` | The 1–5 anchored rubric human graders use (4 dimensions + overall) |
| `CONSENT_TEMPLATE.md` | Consent text for people who contribute answers |
| `templates/answers_raw.template.csv` | Columns for the answers you collect |
| `templates/consent_log.template.csv` | Who consented, when, to what; withdrawals |
| `templates/rater_sheet.template.csv` | What each grader fills in |
| `tools/prepare_study.py` | Checks consent, runs the automated evaluator, writes blinded grader sheets |
| `tools/analyze_validation.py` | Computes agreement and writes `report.md` (refuses when data is insufficient) |
| `REPORT_FORMAT.md` | What the final report contains and the wording rules |
| `tests/test_tools.py` | Tests of the statistics and the guards (synthetic data inside the tests only) |

## How to complete the study (about a weekend of effort for two people)
1. Read `STUDY_PROTOCOL.md`. Recruit ~10–15 volunteers; each answers 4–6 of the app's 43 questions in writing. Collect written consent
   (`CONSENT_TEMPLATE.md`). **Do not export answers from the app's database** — the app has no research-consent mechanism, so real users' practice
   answers must not be used.
2. Put the answers in `work/answers_raw.csv` and the consent records in `work/consent_log.csv` (templates in `templates/`).
3. `python tools/prepare_study.py --answers work/answers_raw.csv --consent work/consent_log.csv --out work` → writes `work/items.csv`,
   `work/automated_scores.csv` (keep this file away from graders) and `work/rater_sheet_blank.csv`.
4. Give each of ≥ 2 graders a copy of `rater_sheet_blank.csv` named `work/ratings_<graderId>.csv`. They grade independently with `RUBRIC.md`, without seeing automated scores.
5. `python tools/analyze_validation.py --work work` → `work/report.md` and `work/results.json`.
6. Report exactly what the script printed, with its limitations section. If it says NOT ENOUGH DATA, collect more.

Python 3.9+ standard library only. Nothing here talks to the network or to the app's database.
