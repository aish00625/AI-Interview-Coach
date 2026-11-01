r"""
Live check of the local-AI integration against the REAL Ollama on this computer. Nothing is stored or sent anywhere
except to the Ollama URL in ai-service/.env (default http://127.0.0.1:11434). Safe to run any time; it only reads.

    cd ai-service
    venv\Scripts\python scripts\check_local_ai.py            (Windows)
    python scripts/check_local_ai.py                         (macOS / Linux)

Each task is run through the same prompt + validation code the app uses, so a PASS means the model produced output
the app would accept. Quality of the wording is for you to judge: the printed text is exactly what a user would see.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config  # noqa: E402
from app.services import llm, llm_tasks  # noqa: E402
from app.services.llm import LlmError  # noqa: E402

ANSWER = ("Last year our team missed a release date because the login module was behind. I was responsible for that module, "
          "so I split it into three tasks, wrote a test script and paired with a teammate. We shipped two days late and "
          "cut login bugs by about 30% the next month.")
CODE = "def two_sum(nums, target):\n    for i in range(len(nums)):\n        for j in range(len(nums)):\n            if nums[i] + nums[j] == target:\n                return [i, j]\n    return []\n"
results = []


def run(name, fn):
    t = time.time()
    try:
        out = fn()
        print(f"\n[PASS] {name} ({time.time() - t:.1f}s)")
        for k, v in out.items():
            print(f"   {k}: {v}")
        results.append((name, True))
    except LlmError as e:
        print(f"\n[FAIL] {name} ({time.time() - t:.1f}s): {e.code} - {e.message}")
        results.append((name, False))


print(f"Ollama URL : {config.OLLAMA_BASE_URL}")
print(f"Model      : {config.LLM_MODEL}   (LLM_ENABLED={config.LLM_ENABLED}, timeout {config.LLM_TIMEOUT_SECONDS}s)")
st = llm.status(force=True)
print(f"Status     : {st['state']}" + (f" - {st.get('message')}" if st.get("message") else ""))
print(f"Installed  : {', '.join(st.get('installedModels', [])) or '(none listed)'}")
if st["state"] != "ready":
    print("\nThe model is not ready, so the live tasks are skipped. The app still works with rule-based feedback.")
    sys.exit(1)

print("\nThe first request can take a minute while the model loads into memory.")
run("Follow-up question", lambda: llm_tasks.follow_up(
    "Tell me about a time you handled a missed deadline.", ANSWER, "behavioral", "medium", "Backend developer", ["what you would do differently"], []))
run("STAR coaching", lambda: {k: (v if k != "elements" else {n: (e["status"], e["evidence"]) for n, e in v.items()})
                              for k, v in llm_tasks.star_coach("Tell me about a time you handled a missed deadline.", ANSWER).items() if k in ("elements", "overall", "evidenceDropped")})
run("Coding coach", lambda: llm_tasks.code_coach(
    "Two Sum", "Return indices of two numbers that add up to target.", "python", CODE, "completed",
    [{"index": 1, "passed": False, "input": "[3,3]\n6", "expected": "[0, 1]", "actual": "[0, 0]", "note": "Output differs"}], ""))
run("Interview report", lambda: llm_tasks.interview_report(
    "behavioral", "Backend developer", "medium",
    [{"topic": "Teamwork", "question": "Tell me about a missed deadline.", "answer": ANSWER, "technical": 62, "relevance": 70, "clarity": 80, "completeness": 55,
      "matched": ["ownership"], "missing": ["lessons learned"]}], 66))

failed = [n for n, ok in results if not ok]
print("\n" + ("ALL LIVE CHECKS PASSED" if not failed else "FAILED: " + ", ".join(failed)))
sys.exit(1 if failed else 0)
