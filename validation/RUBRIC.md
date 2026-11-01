# Human grading rubric (1–5)

Grade the **answer to the question as written**, as a knowledgeable interviewer would. Do not guess what the candidate "meant". Do not reward length for its own sake.
Grade each dimension separately, then give an overall grade. Whole numbers only. Do not look at any automated score.

| Grade | Meaning (applies to every dimension) |
|---|---|
| 1 | Absent, wrong or unusable for this dimension |
| 2 | Weak: major gaps or errors |
| 3 | Acceptable: the main idea is there, noticeable gaps |
| 4 | Good: minor gaps only |
| 5 | Excellent: nothing important missing |

## Dimensions
**Technical (accuracy and substance).**
- Technical/concept questions: are the facts correct and are the key ideas an expert would expect present (definitions, mechanism, trade-offs)?
- Behavioural (STAR) questions: is there a real *Situation/Task*, specific *Actions the candidate took*, and a *Result* (ideally with what was learned)? Vague generalities = 1–2.
- HR questions: does the answer show the qualities a good answer needs (honesty, motivation, realism, ownership), without red flags?
> Note: for behavioural and HR questions the app labels this score "structure and content", not technical knowledge. Grade accordingly.

**Relevance.** Does the answer address what was actually asked, rather than a neighbouring topic? (1 = off-topic; 5 = directly and fully on point.)

**Clarity.** Is it understandable, logically ordered and concise enough to follow? Spelling/grammar matter only when they hinder understanding. (1 = incomprehensible; 5 = easy to follow.)

**Completeness.** Does it cover everything the question asks for, at a depth appropriate to a short interview answer? (1 = barely started; 5 = nothing important left out.)

**Overall.** Your single holistic judgement of how good the answer is in an interview. It need not be the average of the four.

## Practical rules
- If an answer is empty, off-topic gibberish, or not in English/the agreed language, set `flag_unratable = 1` and leave the grades empty.
- Use `notes` freely (what you looked for, why you graded as you did); notes are never shown to the evaluator or used in the statistics.
- Grade in one sitting per ~20 items to limit fatigue drift. Do not discuss individual items with the other grader until both have finished.
- Two consecutive identical answers from different people may legitimately get the same grades. Do not try to "spread" grades.
