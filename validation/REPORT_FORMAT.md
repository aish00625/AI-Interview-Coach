# Report format (what `analyze_validation.py` writes to `report.md`)

1. **Status line** — `COMPLETE` or `NOT ENOUGH DATA` (with the reasons). With the latter no statistics are printed.
2. **Data** — items collected, items excluded (unratable, missing grades) and why, number of graders, items graded by ≥ 2 graders, distribution of rubric kinds.
3. **Inter-grader agreement** — pairwise Spearman ρ and quadratic-weighted κ per dimension. This is the ceiling for any automated agreement.
4. **Evaluator vs human consensus** — per dimension: n, Spearman ρ with 95 % bootstrap CI, Pearson r, MAE (0–100 points), mean signed bias (evaluator − human), band agreement.
5. **By rubric kind** and **by evaluator confidence** (low vs medium/high): MAE and ρ where n ≥ 8, otherwise "n too small".
6. **Limitations** — fixed boilerplate (sample size, volunteer answers, graders' disagreement, one language, deterministic keyword evaluator, not a fairness study).
7. **Reproducibility** — input file hashes (SHA-256), seed, script version.

Wording rules for the project report/viva: quote the generated numbers with n and CIs; say "agreement", not "accuracy"; never present the evaluator as validated beyond this sample;
if the study has not been run, say "not yet measured".
