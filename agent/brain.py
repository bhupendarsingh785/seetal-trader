#!/usr/bin/env python3
"""
OpenYug ka dimaag — khud tay karta hai aaj kya karna hai.
Koi API key nahi chahiye. Rule + knowledge + state se faisla.
"""
import json, os, datetime, random

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

def pending_orders():
    out = []
    for line in read("orders.md").splitlines():
        s = line.strip()
        if s.startswith("- [ ]"):
            out.append(s[5:].strip())
    return out

def decide():
    """Aaj ke kaam chuno. Wapas: (tasks, wajah)"""
    st = jload("state.json", {})
    know = read("knowledge.md")
    goals = read("goals.md")
    orders = pending_orders()

    tasks, why = [], []

    if orders:
        tasks += orders
        why.append(f"Swag ke {len(orders)} aadesh bache hain")

    # khud ke kaam — agar orders kam hain
    if len(tasks) < 3:
        # 1) knowledge kamzor hissa
        if "market" not in know.lower() and "bharat" not in know.lower():
            tasks.append("seekho: India ke tech/AI niyam aur market ke naye tools")
            why.append("knowledge me Bharat wala hissa kam hai")
        # 2) score badhao
        if st.get("learn_count", 0) < 3:
            tasks.append("seekho: AI tools jo aaj kaam ke hain")
            why.append("abhi sirf " + str(st.get("learn_count", 0)) + " baar seekha hai")
        # 3) hafte me ek baar seedhi baat
        hist = st.get("history", [])
        last = hist[-1]["at"][:10] if hist else ""
        today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
        if last != today:
            tasks.append("likho: Swag ke liye 3 line ki seedhi baat (kya sudharna chahiye)")
            why.append("aaj ke din ki pehli baat likhni hai")

    tasks = list(dict.fromkeys(tasks))[:6]
    if not why:
        why.append("sab kaam ho chuke — khud naye kaam dhoondhe")
    return tasks, why

def record(tasks, why, did):
    st = jload("state.json", {})
    st.setdefault("brain", []).append({
        "at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z"),
        "chuna": tasks,
        "wajah": why,
        "hua": did,
    })
    st["brain"] = st["brain"][-60:]
    st["score"] = st.get("score", 0) + 1
    json.dump(st, open(os.path.join(A, "state.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

if __name__ == "__main__":
    t, w = decide()
    print("Aaj ke kaam:")
    for i, x in enumerate(t, 1):
        print(f"  {i}. {x}")
    print("Wajah:", "; ".join(w))
