#!/usr/bin/env python3
"""Agreement between the automated evaluator and human graders. Standard library only.
Refuses to print statistics when data are insufficient. Never fabricates anything."""
import argparse, csv, glob, hashlib, json, math, os, random, sys

DIMS = ["technical", "relevance", "clarity", "completeness"]
MIN_ITEMS, MIN_RATERS, SEED, BOOT = 30, 2, 20261019, 2000
VERSION = "1.0"

# ---------- statistics ----------
def _rank(v):
    idx = sorted(range(len(v)), key=lambda i: v[i]); r = [0.0] * len(v); i = 0
    while i < len(v):
        j = i
        while j + 1 < len(v) and v[idx[j + 1]] == v[idx[i]]: j += 1
        for k in range(i, j + 1): r[idx[k]] = (i + j) / 2 + 1
        i = j + 1
    return r

def pearson(x, y):
    n = len(x)
    if n < 3: return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    if sxx == 0 or syy == 0: return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / math.sqrt(sxx * syy)

def spearman(x, y): return pearson(_rank(x), _rank(y)) if len(x) >= 3 else None

def bootstrap_ci(x, y, fn=spearman, reps=BOOT, seed=SEED):
    rng, n, vals = random.Random(seed), len(x), []
    for _ in range(reps):
        idx = [rng.randrange(n) for _ in range(n)]
        v = fn([x[i] for i in idx], [y[i] for i in idx])
        if v is not None: vals.append(v)
    if len(vals) < reps * 0.5: return None
    vals.sort(); return vals[int(0.025 * len(vals))], vals[min(len(vals) - 1, int(0.975 * len(vals)))]

def qw_kappa(a, b, lo=1, hi=5):
    """Quadratic weighted kappa for integer grades lo..hi."""
    k, n = hi - lo + 1, len(a)
    if n < 2: return None
    O = [[0.0] * k for _ in range(k)]
    for x, y in zip(a, b): O[int(x) - lo][int(y) - lo] += 1
    ha = [sum(r) for r in O]; hb = [sum(O[i][j] for i in range(k)) for j in range(k)]
    num = den = 0.0
    for i in range(k):
        for j in range(k):
            w = (i - j) ** 2 / (k - 1) ** 2
            num += w * O[i][j]; den += w * ha[i] * hb[j] / n
    return None if den == 0 else 1 - num / den

def mae(x, y): return sum(abs(a - b) for a, b in zip(x, y)) / len(x)
def bias(x, y): return sum(a - b for a, b in zip(x, y)) / len(x)
def band(v): return 0 if v < 40 else (1 if v <= 70 else 2)
def band_agreement(x, y): return sum(band(a) == band(b) for a, b in zip(x, y)) / len(x)
def to100(r): return (r - 1) * 25

# ---------- io ----------
def read_csv(p):
    with open(p, newline="", encoding="utf-8-sig") as f: return list(csv.DictReader(f))
def sha(p):
    with open(p, "rb") as f: return hashlib.sha256(f.read()).hexdigest()

def _grade(v):
    v = (v or "").strip()
    if not v: return None
    try: g = int(float(v))
    except ValueError: return None
    return g if 1 <= g <= 5 else None

def load_ratings(work):
    """Return {rater: {item_id: {dim: grade or None, 'unratable': bool}}}."""
    out = {}
    for p in sorted(glob.glob(os.path.join(work, "ratings_*.csv"))):
        rater = os.path.basename(p)[len("ratings_"):-4]
        d = {}
        for r in read_csv(p):
            d[r["item_id"]] = {k: _grade(r.get(k)) for k in DIMS + ["overall"]}
            d[r["item_id"]]["unratable"] = (r.get("flag_unratable") or "").strip() in ("1", "true", "yes")
        out[rater] = d
    return out

def build(work):
    auto = {r["item_id"]: r for r in read_csv(os.path.join(work, "automated_scores.csv"))}
    ratings = load_ratings(work)
    return auto, ratings

def consensus(auto, ratings):
    """Per item and dim: mean human grade (0-100) over raters; items flagged unratable by anyone are excluded."""
    rows, unrat = [], 0
    for iid, a in auto.items():
        per = [r[iid] for r in ratings.values() if iid in r]
        if any(p["unratable"] for p in per): unrat += 1; continue
        row = {"item_id": iid, "confidence": a["confidence"], "kind": a["rubric_kind"], "n_raters": 0}
        for d in DIMS + ["overall"]:
            g = [p[d] for p in per if p[d] is not None]
            row[d] = sum(to100(x) for x in g) / len(g) if g else None
            row["n_" + d] = len(g)
        row["n_raters"] = max(row["n_" + d] for d in DIMS)
        for d in DIMS: row["auto_" + d] = float(a[d])
        rows.append(row)
    return rows, unrat

# ---------- analysis ----------
def sufficiency(auto, ratings):
    reasons = []
    if len(ratings) < MIN_RATERS: reasons.append(f"{len(ratings)} grader file(s) found; at least {MIN_RATERS} independent graders are required")
    graded = [i for i in auto if sum(1 for r in ratings.values() if i in r and r[i]["technical"] is not None) >= MIN_RATERS]
    if len(graded) < MIN_ITEMS: reasons.append(f"{len(graded)} items graded by >= {MIN_RATERS} graders; at least {MIN_ITEMS} are required (target 60)")
    return reasons

def analyze(work):
    auto, ratings = build(work)
    reasons = sufficiency(auto, ratings) if auto else ["automated_scores.csv is empty"]
    if reasons: return {"status": "NOT ENOUGH DATA", "reasons": reasons}
    rows, unrat = consensus(auto, ratings)
    res = {"status": "COMPLETE", "n_items_total": len(auto), "n_unratable_excluded": unrat, "n_graders": len(ratings),
           "kinds": {}, "inter_grader": {}, "evaluator_vs_human": {}, "by_kind": {}, "by_confidence": {}}
    for r in rows: res["kinds"][r["kind"]] = res["kinds"].get(r["kind"], 0) + 1
    names = sorted(ratings)
    for d in DIMS:
        pairs = []
        for i, a in enumerate(names):
            for b in names[i + 1:]:
                common = [k for k in auto if k in ratings[a] and k in ratings[b] and ratings[a][k][d] and ratings[b][k][d]
                          and not ratings[a][k]["unratable"] and not ratings[b][k]["unratable"]]
                x = [ratings[a][k][d] for k in common]; y = [ratings[b][k][d] for k in common]
                pairs.append({"pair": f"{a}~{b}", "n": len(common), "spearman": spearman(x, y), "qwk": qw_kappa(x, y)})
        res["inter_grader"][d] = pairs
    def block(sub, d):
        sub = [r for r in sub if r[d] is not None]
        if len(sub) < 3: return {"n": len(sub), "note": "n too small"}
        x = [r["auto_" + d] for r in sub]; y = [r[d] for r in sub]
        return {"n": len(sub), "spearman": spearman(x, y), "pearson": pearson(x, y), "mae": mae(x, y), "bias": bias(x, y), "band_agreement": band_agreement(x, y)}
    for d in DIMS:
        b = block(rows, d)
        if b.get("spearman") is not None:
            b["spearman_ci95"] = bootstrap_ci([r["auto_" + d] for r in rows if r[d] is not None], [r[d] for r in rows if r[d] is not None])
        res["evaluator_vs_human"][d] = b
        res["by_kind"][d] = {k: (block([r for r in rows if r["kind"] == k], d) if sum(r["kind"] == k for r in rows) >= 8 else {"note": "n too small"}) for k in sorted(res["kinds"])}
        low = [r for r in rows if r["confidence"] == "low"]; hi = [r for r in rows if r["confidence"] != "low"]
        res["by_confidence"][d] = {"low": block(low, d) if len(low) >= 8 else {"n": len(low), "note": "n too small"},
                                   "medium_or_high": block(hi, d) if len(hi) >= 8 else {"n": len(hi), "note": "n too small"}}
    return res

def fmt(v, p=2): return "n/a" if v is None else (f"{v:.{p}f}" if isinstance(v, float) else str(v))

def render(res, hashes):
    L = ["# Evaluator validation report", "", f"**Status: {res['status']}**", ""]
    if res["status"] != "COMPLETE":
        L += ["No statistics are reported because the data are insufficient:", ""] + [f"- {r}" for r in res["reasons"]]
        L += ["", "Until this changes, the only supportable statement is: *the evaluator's agreement with human graders has not been measured.*"]
        return "\n".join(L) + "\n"
    L += ["## Data", f"- Items scored: {res['n_items_total']}; excluded as unratable: {res['n_unratable_excluded']}; graders: {res['n_graders']}",
          "- Rubric kinds: " + ", ".join(f"{k or 'none'}={v}" for k, v in sorted(res["kinds"].items())), "",
          "## Inter-grader agreement (the realistic ceiling)", "| Dimension | Pair | n | Spearman | QW kappa |", "|---|---|---|---|---|"]
    for d, ps in res["inter_grader"].items():
        for p in ps: L.append(f"| {d} | {p['pair']} | {p['n']} | {fmt(p['spearman'])} | {fmt(p['qwk'])} |")
    L += ["", "## Evaluator vs human consensus (human 1-5 mapped to 0-100)", "| Dimension | n | Spearman (95% CI) | Pearson | MAE | Bias (eval - human) | Band agreement |", "|---|---|---|---|---|---|---|"]
    for d, b in res["evaluator_vs_human"].items():
        ci = b.get("spearman_ci95"); cis = f" ({ci[0]:.2f} to {ci[1]:.2f})" if ci else ""
        if "note" in b: L.append(f"| {d} | {b['n']} | {b['note']} | | | | |")
        else: L.append(f"| {d} | {b['n']} | {fmt(b['spearman'])}{cis} | {fmt(b['pearson'])} | {fmt(b['mae'],1)} | {fmt(b['bias'],1)} | {fmt(b['band_agreement'])} |")
    for title, key in (("By rubric kind", "by_kind"), ("By evaluator confidence", "by_confidence")):
        L += ["", f"## {title}", "| Dimension | Group | n | Spearman | MAE |", "|---|---|---|---|---|"]
        for d, g in res[key].items():
            for name, b in g.items():
                L.append(f"| {d} | {name or 'none'} | {b.get('n','')} | {b.get('note') or fmt(b.get('spearman'))} | {'' if 'note' in b else fmt(b.get('mae'),1)} |")
    L += ["", "## Limitations", "- Small volunteer sample; wide confidence intervals; results do not generalise beyond these questions and answer styles.",
          "- Human graders disagree with each other; see the inter-grader table.", "- The evaluator is a deterministic keyword/similarity checker, not a language-understanding model.",
          "- This is not a fairness study and gives no basis for automated hiring decisions.", "- For behavioural/HR questions the technical score measures structure and content, not technical knowledge.",
          "", "## Reproducibility", f"- script version {VERSION}; bootstrap seed {SEED}, {BOOT} resamples"] + [f"- sha256 {n}: `{h}`" for n, h in hashes.items()]
    return "\n".join(L) + "\n"

def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--work", required=True); a = ap.parse_args(argv)
    ap_path = os.path.join(a.work, "automated_scores.csv")
    if not os.path.exists(ap_path):
        print("automated_scores.csv not found. Run prepare_study.py first. Study is PENDING."); return 2
    res = analyze(a.work)
    hashes = {os.path.basename(p): sha(p) for p in [ap_path] + sorted(glob.glob(os.path.join(a.work, "ratings_*.csv")))}
    text = render(res, hashes)
    with open(os.path.join(a.work, "report.md"), "w", encoding="utf-8") as f: f.write(text)
    with open(os.path.join(a.work, "results.json"), "w") as f: json.dump(res, f, indent=2)
    print(text); return 0 if res["status"] == "COMPLETE" else 1

if __name__ == "__main__":
    sys.exit(main())
