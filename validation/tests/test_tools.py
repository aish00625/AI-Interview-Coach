"""Tests of the study tools. All data below is SYNTHETIC, created inside temp dirs for testing the code only.
Nothing here is a result about the real evaluator."""
import csv, os, sys, tempfile, unittest, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import analyze_validation as av, prepare_study as ps

def wcsv(path, fields, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows(rows)

class Stats(unittest.TestCase):
    def test_spearman_known(self):
        self.assertAlmostEqual(av.spearman([1,2,3,4,5],[2,4,6,8,10]), 1.0)
        self.assertAlmostEqual(av.spearman([1,2,3,4,5],[10,8,6,4,2]), -1.0)
    def test_spearman_ties_and_constant(self):
        self.assertIsNone(av.spearman([1,1,1,1],[1,2,3,4]))
        self.assertAlmostEqual(av.spearman([1,2,2,3],[1,2,2,3]), 1.0)
    def test_pearson_known(self):
        self.assertAlmostEqual(av.pearson([1,2,3],[1,2,3.5]), 0.99340, places=4)
    def test_kappa_perfect_and_opposite(self):
        a=[1,2,3,4,5,1,2,3,4,5]
        self.assertAlmostEqual(av.qw_kappa(a,a),1.0)
        self.assertLess(av.qw_kappa(a,[6-x for x in a]),0)
    def test_kappa_hand_computed(self):
        # 2 raters, grades 1..5, one disagreement by 1 step
        a=[1,2,3,4,5,3]; b=[1,2,3,4,5,4]
        k=av.qw_kappa(a,b); self.assertTrue(0.9<k<1.0)
    def test_mae_bias_band(self):
        self.assertEqual(av.mae([10,20],[20,10]),10); self.assertEqual(av.bias([30,30],[10,20]),15)
        self.assertEqual(av.band_agreement([10,50,90],[30,60,50]),2/3)
    def test_to100(self): self.assertEqual([av.to100(i) for i in (1,3,5)],[0,50,100])
    def test_bootstrap_deterministic(self):
        x=list(range(40)); y=[v+(v%3) for v in x]
        self.assertEqual(av.bootstrap_ci(x,y,reps=200),av.bootstrap_ci(x,y,reps=200))

class Prepare(unittest.TestCase):
    class Stub:
        @staticmethod
        def evaluate_answer(q,a): return dict(technicalScore=len(a)%100,relevanceScore=50,clarityScore=60,completenessScore=40,confidence="low",rubricKind="concept",rubricId="x")
    def run_prep(self, answers, consent):
        d=tempfile.mkdtemp(); A=os.path.join(d,"a.csv"); C=os.path.join(d,"c.csv")
        wcsv(A,["item_id","participant_code","question","answer"],answers)
        wcsv(C,["participant_code","consent_date","scope","withdrawn_on"],consent)
        rc=ps.main(["--answers",A,"--consent",C,"--out",os.path.join(d,"o")],evaluator=self.Stub); return rc,d
    def test_refuses_without_consent(self):
        rc,_=self.run_prep([dict(item_id="1",participant_code="P1",question="q",answer="a")],[]); self.assertEqual(rc,3)
    def test_refuses_empty_consent_date(self):
        rc,_=self.run_prep([dict(item_id="1",participant_code="P1",question="q",answer="a")],[dict(participant_code="P1",consent_date="",scope="",withdrawn_on="")]); self.assertEqual(rc,3)
    def test_withdrawn_excluded(self):
        ans=[dict(item_id="1",participant_code="P1",question="q",answer="aa"),dict(item_id="2",participant_code="P2",question="q",answer="bb")]
        con=[dict(participant_code="P1",consent_date="2026-10-01",scope="",withdrawn_on="2026-10-05"),dict(participant_code="P2",consent_date="2026-10-01",scope="",withdrawn_on="")]
        rc,d=self.run_prep(ans,con); self.assertEqual(rc,0)
        rows=list(csv.DictReader(open(os.path.join(d,"o","items.csv")))); self.assertEqual([r["item_id"] for r in rows],["2"])
    def test_rater_sheet_is_blinded(self):
        ans=[dict(item_id=str(i),participant_code="P1",question="q",answer="x"*i) for i in range(1,6)]
        rc,d=self.run_prep(ans,[dict(participant_code="P1",consent_date="2026-10-01",scope="",withdrawn_on="")])
        head=open(os.path.join(d,"o","rater_sheet_blank.csv")).readline().strip().split(",")
        for forbidden in ("confidence","rubric_kind","participant_code","auto"):
            self.assertFalse(any(forbidden in h for h in head))
    def test_empty_answers_stays_pending(self):
        rc,_=self.run_prep([],[]); self.assertEqual(rc,2)
    def test_duplicate_ids_refused(self):
        a=[dict(item_id="1",participant_code="P1",question="q",answer="a")]*2
        rc,_=self.run_prep(a,[dict(participant_code="P1",consent_date="2026-10-01",scope="",withdrawn_on="")]); self.assertEqual(rc,3)
    def test_pii_detector(self):
        self.assertEqual(ps.pii_warnings([{"item_id":"9","answer":"mail me a.b@x.com"},{"item_id":"8","answer":"fine"}]),["9"])

class Analyze(unittest.TestCase):
    def make(self, n, raters, noise=False):
        d=tempfile.mkdtemp(); rng=random.Random(1)
        auto=[]; truth={}
        for i in range(n):
            g=rng.randint(1,5); truth[str(i)]=g
            auto.append(dict(item_id=str(i),technical=av.to100(g),relevance=av.to100(g),clarity=av.to100(g),completeness=av.to100(g),confidence="medium",rubric_kind="concept" if i%2 else "star",rubric_id="r"))
        wcsv(os.path.join(d,"automated_scores.csv"),list(auto[0]),auto)
        for r in range(raters):
            rows=[]
            for i in range(n):
                g=truth[str(i)]; g=min(5,max(1,g+(rng.choice([-1,0,1]) if noise else 0)))
                rows.append(dict(item_id=str(i),question="",answer="",technical=g,relevance=g,clarity=g,completeness=g,overall=g,flag_unratable="",notes=""))
            wcsv(os.path.join(d,f"ratings_g{r}.csv"),list(rows[0]),rows)
        return d
    def test_refuses_too_few_items(self):
        r=av.analyze(self.make(10,2)); self.assertEqual(r["status"],"NOT ENOUGH DATA")
    def test_refuses_one_rater(self):
        r=av.analyze(self.make(60,1)); self.assertEqual(r["status"],"NOT ENOUGH DATA")
    def test_pending_report_has_no_numbers(self):
        txt=av.render(av.analyze(self.make(10,1)),{}); self.assertIn("has not been measured",txt); self.assertNotIn("Spearman |",txt)
    def test_no_ratings_files(self):
        d=self.make(40,2)
        for f in os.listdir(d):
            if f.startswith("ratings_"): os.remove(os.path.join(d,f))
        self.assertEqual(av.analyze(d)["status"],"NOT ENOUGH DATA")
    def test_perfect_synthetic_agreement(self):
        r=av.analyze(self.make(60,2)); self.assertEqual(r["status"],"COMPLETE")
        self.assertAlmostEqual(r["evaluator_vs_human"]["technical"]["spearman"],1.0); self.assertEqual(r["evaluator_vs_human"]["technical"]["mae"],0)
    def test_unratable_excluded(self):
        d=self.make(40,2); p=os.path.join(d,"ratings_g0.csv"); rows=list(csv.DictReader(open(p))); rows[0]["flag_unratable"]="1"
        wcsv(p,list(rows[0]),rows); r=av.analyze(d); self.assertEqual(r["n_unratable_excluded"],1)
    def test_noisy_report_renders(self):
        d=self.make(60,2,noise=True); self.assertEqual(av.main(["--work",d]),0)
        t=open(os.path.join(d,"report.md")).read(); self.assertIn("Limitations",t); self.assertIn("sha256",t)
    def test_missing_scores_exit_code(self): self.assertEqual(av.main(["--work",tempfile.mkdtemp()]),2)

if __name__=="__main__": unittest.main()
