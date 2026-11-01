#!/usr/bin/env python3
"""Prepare the evaluator-validation study. Standard library only (plus the repo's offline evaluator).

Reads consented answers, runs the deterministic automated evaluator, and writes:
  items.csv              item_id, participant_code, question, answer, rubric_kind (internal)
  automated_scores.csv   evaluator output  -- KEEP AWAY FROM GRADERS
  rater_sheet_blank.csv  blinded, shuffled sheet for graders (no automated scores, no rubric kind)
Refuses to run if any participant lacks consent or has withdrawn. Never invents data.
"""
import argparse, csv, os, random, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
SEED = 20261019

def read_csv(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))

def check_consent(answers, consent):
    """Return (ok_rows, problems). A participant is OK only with a consent_date and no withdrawn_on."""
    status = {}
    for r in consent:
        code = (r.get("participant_code") or "").strip()
        if code:
            status[code] = r
    problems, ok = [], []
    for a in answers:
        code = (a.get("participant_code") or "").strip()
        c = status.get(code)
        if not code:
            problems.append(f"item {a.get('item_id')}: missing participant_code")
        elif c is None:
            problems.append(f"{code}: no consent row")
        elif not (c.get("consent_date") or "").strip():
            problems.append(f"{code}: consent_date empty")
        elif (c.get("withdrawn_on") or "").strip():
            continue  # withdrawn: silently excluded, counted by caller
        else:
            ok.append(a)
    return ok, sorted(set(problems))

PII = [re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), re.compile(r"(?<!\d)(?:\+?\d[\d\s-]{8,}\d)(?!\d)")]
def pii_warnings(rows):
    return [r["item_id"] for r in rows if any(p.search(r.get("answer", "")) for p in PII)]

def load_evaluator():
    sys.path.insert(0, os.path.join(REPO, "ai-service"))
    from app.services import evaluator as ev  # noqa
    return ev

def write_csv(path, fields, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader(); w.writerows(rows)

def main(argv=None, evaluator=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--answers", required=True); ap.add_argument("--consent", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--seed", type=int, default=SEED)
    a = ap.parse_args(argv)
    answers, consent = read_csv(a.answers), read_csv(a.consent)
    if not answers:
        print("No answers found. The study stays PENDING until real, consented answers are collected."); return 2
    ok, problems = check_consent(answers, consent)
    if problems:
        print("REFUSING to continue - consent problems:"); [print("  -", p) for p in problems]; return 3
    excluded = len(answers) - len(ok)
    ids = [r["item_id"] for r in ok]
    if len(set(ids)) != len(ids):
        print("REFUSING: duplicate item_id values"); return 3
    for w in pii_warnings(ok): print(f"WARNING: item {w} may contain an e-mail/phone number - remove it before grading")
    ev = evaluator or load_evaluator()
    os.makedirs(a.out, exist_ok=True)
    items, scores = [], []
    for r in ok:
        res = ev.evaluate_answer(r["question"], r["answer"])
        items.append({**{k: r[k] for k in ("item_id", "participant_code", "question", "answer")}, "rubric_kind": res.get("rubricKind") or ""})
        scores.append({"item_id": r["item_id"], "technical": res["technicalScore"], "relevance": res["relevanceScore"],
                       "clarity": res["clarityScore"], "completeness": res["completenessScore"],
                       "confidence": res.get("confidence", ""), "rubric_kind": res.get("rubricKind") or "", "rubric_id": res.get("rubricId") or ""})
    write_csv(os.path.join(a.out, "items.csv"), ["item_id", "participant_code", "question", "answer", "rubric_kind"], items)
    write_csv(os.path.join(a.out, "automated_scores.csv"), list(scores[0]), scores)
    order = list(items); random.Random(a.seed).shuffle(order)
    write_csv(os.path.join(a.out, "rater_sheet_blank.csv"),
              ["item_id", "question", "answer", "technical", "relevance", "clarity", "completeness", "overall", "flag_unratable", "notes"], order)
    print(f"Prepared {len(items)} items ({excluded} excluded: withdrawn). Give graders ONLY rater_sheet_blank.csv.")
    if len(items) < 30: print("NOTE: fewer than 30 items - the analysis script will report NOT ENOUGH DATA.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
