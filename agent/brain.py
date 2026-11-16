#!/usr/bin/env python3
"""
OpenYug ka dimaag (v2) — khud tay karta hai aaj kya karna hai.
Koi API key nahi. Rule + knowledge + state + memory se faisla.

Naya is version me:
  - PRIORITY: har kaam ko ek number milta hai, bade number pehle.
  - MEMORY: pichhle run me jo chuna tha use yaad rakhta hai (dohraata nahi).
  - GOAL-AWARE: goals.md ke har lakshya ko baari-baari chhoota hai.
  - Interface wahi: decide() -> (tasks, why), record(tasks, why, did).
"""
import json, os, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "agent")


def read(p, default=""):
    try:
        return open(os.path.join(A, p), encoding="utf-8").read()
    except Exception:
        return default


def jload(p, default):
    try:
        return json.load(open(os.path.join(A, p), encoding="utf-8"))
    except Exception:
        return default


def today():
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def pending_orders():
    out = []
    for line in read("orders.md").splitlines():
        s = line.strip()
        if s.startswith("- [ ]"):
            out.append(s[5:].strip())
    return out


def recent_tasks(st, days=1):
    """Pichhle kuch din me jo kaam chune the — taaki dohraaye nahi."""
    seen = set()
    cut = (datetime.datetime.now(datetime.timezone.utc)
           - datetime.timedelta(days=days))
    for b in st.get("brain", []):
        try:
            at = datetime.datetime.fromisoformat(b["at"].replace("Z", "+00:00"))
        except Exception:
            continue
        if at >= cut:
            for t in b.get("chuna", []):
                seen.add(t.strip().lower())
    return seen


def goal_areas():
    """goals.md ke '## ' heading padho — har ek ek lakshya-area."""
    areas = []
    for line in read("goals.md").splitlines():
        s = line.strip()
        if s.startswith("## "):
            areas.append(s[3:].strip())
    return areas


def decide():
    """Aaj ke kaam chuno. Wapas: (tasks, wajah). Dono list[str]."""
    st = jload("state.json", {})
    know = read("knowledge.md").lower()
    orders = pending_orders()
    recent = recent_tasks(st, days=1)

    # (priority, task, wajah) — bada priority pehle
    cands = []

    # 1) Swag ke aadesh — sabse upar. "har baar" wale hamesha chalte hain.
    for o in orders:
        always = o.lower().startswith("har baar") or "har baar" in o.lower()
        cands.append((100 if always else 90, o, "Swag ka aadesh"))

    # 2) Knowledge me Bharat/market ka hissa kam hai
    if "market" not in know and "bharat" not in know and "india" not in know:
        t = "seekho: India ke tech/AI niyam aur market ke naye tools"
        cands.append((70, t, "knowledge me Bharat/market wala hissa kam hai"))

    # 3) Seekhne ki aadat — kam seekha ho ya aaj na seekha ho
    lc = st.get("learn_count", 0)
    last_learn = (st.get("last_learn") or "")[:10]
    if lc < 3:
        cands.append((65, "seekho: AI tools jo aaj kaam ke hain",
                      f"abhi sirf {lc} baar seekha hai"))
    elif last_learn != today():
        cands.append((55, "seekho: aaj ka naya (tech/AI/market)",
                      "aaj abhi tak seekha nahi"))

    # 4) Jo kaam baar-baar aata hai uski skill banao (2+ baar dikhe to)
    freq = {}
    for b in st.get("brain", []):
        for t in b.get("chuna", []):
            k = t.strip().lower()
            freq[k] = freq.get(k, 0) + 1
    for k, n in freq.items():
        if n >= 3 and "skill" not in k:
            cands.append((50, f"skill banao: '{k[:40]}' (ye {n} baar aa chuka)",
                          "baar-baar aane wale kaam ka shortcut"))
            break

    # 5) Hafte ki seedhi baat — din me ek baar
    hist = st.get("brain", [])
    last_brain_day = hist[-1]["at"][:10] if hist else ""
    if last_brain_day != today():
        cands.append((40, "likho: Swag ke liye 3 line ki seedhi baat (kya sudharna chahiye)",
                      "aaj ki pehli baat likhni hai"))

    # 6) Goal-area ghumao — jo area sabse der se nahi chhua
    touched = st.get("goal_touched", {})
    areas = goal_areas()
    if areas:
        coldest = min(areas, key=lambda a: touched.get(a, ""))
        if touched.get(coldest, "") != today():
            cands.append((35, f"dekho lakshya: {coldest}",
                          "ye lakshya sabse der se nahi chhua"))

    # Memory: jo aaj/kal pehle hi chun chuke the (aur recurring nahi) hata do
    filtered = []
    for pr, t, w in cands:
        if pr < 90 and t.strip().lower() in recent:
            continue
        filtered.append((pr, t, w))

    # Priority se sort, dedup, top 6
    filtered.sort(key=lambda x: -x[0])
    seen, tasks, why = set(), [], []
    for pr, t, w in filtered:
        k = t.strip().lower()
        if k in seen:
            continue
        seen.add(k)
        tasks.append(t)
        why.append(w)
        if len(tasks) >= 6:
            break

    if not tasks:
        tasks = ["routine check: sab theek hai na dekho"]
        why = ["sab kaam ho chuke — bas nazar rakhni hai"]
    # why ko chhota, unique rakho
    why = list(dict.fromkeys(why))
    return tasks, why


def record(tasks, why, did):
    st = jload("state.json", {})
    now = (datetime.datetime.now(datetime.timezone.utc)
           .replace(microsecond=0).isoformat().replace("+00:00", "Z"))
    st.setdefault("brain", []).append({
        "at": now,
        "chuna": tasks,
        "wajah": why,
        "hua": did,
    })
    st["brain"] = st["brain"][-60:]
    st["score"] = st.get("score", 0) + 1

    # goal-area chhoo liya to yaad rakho
    st.setdefault("goal_touched", {})
    for t in tasks:
        if t.lower().startswith("dekho lakshya:"):
            area = t.split(":", 1)[1].strip()
            st["goal_touched"][area] = today()
    json.dump(st, open(os.path.join(A, "state.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)


if __name__ == "__main__":
    t, w = decide()
    print("Aaj ke kaam (priority ke hisaab se):")
    for i, x in enumerate(t, 1):
        print(f"  {i}. {x}")
    print("Wajah:", "; ".join(w))
