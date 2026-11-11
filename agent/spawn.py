#!/usr/bin/env python3
"""
OpenYug — apne chhote agents (sub-tasks) banata hai.

Kaam: ek bada kaam aaye to use 3-5 chhote steps me tod kar `agent/jobs/<id>.json` me
likh deta hai. Runner unhe ek-ek karke poora karta hai.

Ye "agent jo agent banata hai" hai — par har step chhota, dikhne wala aur safe hota hai.
"""
import json, os, sys, time, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS = os.path.join(ROOT, "agent", "jobs")
os.makedirs(JOBS, exist_ok=True)

# jo kaam runner khud kar sakta hai (safe list)
KNOWN = {
    "tests":   "bash tests/check-all.sh",
    "data":    "python3 -c \"import json;d=json.load(open('data/live.json'));print(d.get('generated_at'), len(d.get('rows',[])))\"",
    "sites":   "python3 agent/run.py",
    "report":  "python3 agent/run.py",
    "learn":   "python3 agent/learn.py",
}

def plan(goal):
    """Goal ko chhote steps me todo (bina AI ke, simple rules se)."""
    g = goal.lower()
    steps = []
    if "test" in g or "jaanch" in g: steps.append("tests")
    if "data" in g or "market" in g: steps.append("data")
    if "site" in g or "health" in g or "platform" in g: steps.append("sites")
    if "seekh" in g or "learn" in g or "naya" in g: steps.append("learn")
    if not steps: steps = ["tests", "data", "sites"]
    steps.append("report")
    return list(dict.fromkeys(steps))

def spawn(goal):
    jid = time.strftime("%Y%m%d-%H%M%S")
    steps = plan(goal)
    job = {
        "id": jid,
        "goal": goal,
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "steps": [{"name": s, "cmd": KNOWN.get(s, ""), "done": False} for s in steps],
    }
    p = os.path.join(JOBS, jid + ".json")
    json.dump(job, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"🧩 Job bana: {jid} — {len(steps)} steps: {', '.join(steps)}")
    return p

if __name__ == "__main__":
    goal = " ".join(sys.argv[1:]).strip()
    if not goal:
        print("Kaam bolo: python3 agent/spawn.py 'tests aur data check karo'")
        sys.exit(1)
    spawn(goal)
