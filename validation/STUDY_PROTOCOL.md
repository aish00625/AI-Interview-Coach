# Study protocol

## Question
How well do the evaluator's four scores (technical, relevance, clarity, completeness; each 0–100) agree with careful human grading of the same answers, and does its
own `confidence` flag identify the answers it grades worst?

## What this study can and cannot show
- It can estimate **rank agreement** and **typical error** between the evaluator and trained human graders for *these* questions and *these* kinds of answers.
- It cannot show the evaluator is "accurate" in general, fair across groups, or suitable for hiring decisions. It is **never** a basis for automated decisions;
  the app already forbids that. With ~60 answers, confidence intervals will be wide — report them.
- Humans disagree with each other. The inter-grader agreement is the realistic ceiling and is always reported next to the evaluator-vs-human numbers.

## Sample
- Target **60 answers** (minimum accepted by the analysis script: 30). Stratify: at least 15 from each rubric kind present in the question bank
  (concept / star / criteria — see `ai-service/app/data/reference_bank.json`), spread across quality: ask contributors to answer some questions well and some
  from partial knowledge, so the sample is not all-good or all-bad. One contributor should not supply more than ~8 answers.
- Contributors are volunteers (classmates, friends). They answer in writing, in their own words, without searching. No names in the answer text.
- Each contributor has a `participant_code` (P01, P02...). The mapping to real people is kept **outside** this folder.

## Consent and ethics
- Written/recorded consent from every contributor using `CONSENT_TEMPLATE.md`, logged in `consent_log.csv` (one row per participant).
- Withdrawal: a participant can withdraw at any time before the report is written; set `withdrawn_on` and re-run — their answers are then excluded.
- `prepare_study.py` refuses to run if any participant in the answers file has no consent row or has withdrawn, and warns about e-mail addresses / phone numbers in answer text.
- Answers and ratings are deleted when the project is assessed, unless contributors agreed to longer storage.

## Blinding and grading
- ≥ **2 graders**, each grading **all** items independently (suggested: the student plus a peer/senior with relevant knowledge). They get `rater_sheet_blank.csv`:
  items in a seeded random order, no automated scores, no rubric-kind label that would reveal the evaluator's logic.
- Grade with `RUBRIC.md` (1–5 per dimension + overall). Use `flag_unratable` (1) for answers that cannot be graded (empty, off-topic gibberish); those are excluded and counted.
- Do a 5-item calibration round first (grade together, discuss, then grade the real set independently). The calibration items are not part of the 60.

## Analysis plan (fixed before seeing any results)
Human 1–5 is mapped to 0–100 by `(r − 1) × 25`. Human consensus per item = mean over graders.
For each dimension: Spearman ρ (primary, with 95 % bootstrap CI, 2000 resamples, fixed seed), Pearson r, mean absolute error, mean signed bias, and agreement on three bands
(low < 40, mid 40–70, high > 70). Inter-grader: pairwise Spearman and quadratic-weighted κ. Subgroups: by rubric kind, and by evaluator `confidence` (low vs. medium/high).
Conventional reading of ρ (from the literature, **not** a pass mark): < 0.4 weak, 0.4–0.7 moderate, > 0.7 strong. No result is cherry-picked; every dimension is reported.

## What may be claimed afterwards
Only the numbers in the generated `report.md`, with n, CIs and the stated limitations. Example of acceptable wording: *"On 60 consented answers graded by two humans
(κ = …), the evaluator's technical score had Spearman ρ = … (95 % CI …) with the human consensus."* Not acceptable: "the evaluator is 90 % accurate" unless that exact figure is
defined and computed in the report.
