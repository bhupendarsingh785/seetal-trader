#!/usr/bin/env python3
"""
OpenYug ka ghadi-system (clock).
Har baar chalta hai aur yaad rakhta hai:
  - Swag kab aakhri baar dikhe (chat/message)
  - kitna time gap hua
  - kul kitna time system chala
  - har kaam me kitna time laga
"""
import json, os, datetime, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOCK = os.path.join(ROOT, "agent", "clock.json")

def now():
    return datetime.datetime.now(datetime.timezone.utc)

def iso(dt):
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

def parse(s):
    if not s: return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None

def load():
    try:
        return json.load(open(CLOCK, encoding="utf-8"))
    except Exception:
        return {
            "first_seen": None,
            "last_run": None,
            "last_seen_swag": None,
            "runs": 0,
            "total_runtime_sec": 0,
            "gaps": [],
            "tasks": [],
        }

def save(st):
    json.dump(st, open(CLOCK, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def human(sec):
    sec = int(max(0, sec))
    d, sec = divmod(sec, 86400)
    h, sec = divmod(sec, 3600)
    m, s = divmod(sec, 60)
    parts = []
    if d: parts.append(f"{d} din")
    if h: parts.append(f"{h} ghante")
    if m: parts.append(f"{m} minute")
    if not parts: parts.append(f"{s} second")
    return " ".join(parts)

def tick(task=None, note=None):
    """Ek run darj karo. Gap aur runtime nikaalo."""
    st = load()
    t = now()
    gap_txt = None
    if st.get("last_run"):
        last = parse(st["last_run"])
        if last:
            gap = (t - last).total_seconds()
            st.setdefault("gaps", []).append({"from": st["last_run"], "sec": int(gap)})
            st["gaps"] = st["gaps"][-200:]
            gap_txt = human(gap)
    if not st.get("first_seen"):
        st["first_seen"] = iso(t)
    st["last_run"] = iso(t)
    st["runs"] = st.get("runs", 0) + 1
    if task:
        st.setdefault("tasks", []).append({"at": iso(t), "task": task, "note": note})
        st["tasks"] = st["tasks"][-100:]
    save(st)
    return gap_txt

def saw_swag():
    """Jab Swag message kare — yaad rakho aur gap batao."""
    st = load()
    t = now()
    out = None
    if st.get("last_seen_swag"):
        last = parse(st["last_seen_swag"])
        if last:
            out = human((t - last).total_seconds())
    st["last_seen_swag"] = iso(t)
    save(st)
    return out

def status():
    st = load()
    t = now()
    last_run = parse(st.get("last_run"))
    last_seen = parse(st.get("last_seen_swag"))
    first = parse(st.get("first_seen"))
    return {
        "abhi": iso(t),
        "aakhri_run": st.get("last_run"),
        "run_ke_baad": human((t - last_run).total_seconds()) if last_run else "pehli baar",
        "swag_last_seen": st.get("last_seen_swag"),
        "swag_gap": human((t - last_seen).total_seconds()) if last_seen else "pata nahi",
        "kul_chala": human((t - first).total_seconds()) if first else "0",
        "runs": st.get("runs", 0),
    }

def line():
    s = status()
    return (f"⏱️ Swag {s['swag_gap']} baad aaye · system {s['kul_chala']} se chalu · "
            f"{s['runs']} run · aakhri run {s['run_ke_baad']} pehle")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "tick":
        g = tick("manual")
        print("gap:", g or "pehli baar")
    elif cmd == "saw":
        print("Swag", saw_swag() or "pehli baar", "baad aaye")
    else:
        print(line())
        print(json.dumps(status(), ensure_ascii=False, indent=2))
