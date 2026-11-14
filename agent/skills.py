#!/usr/bin/env python3
"""
OpenYug ka skills-system — ek skill = ek kaam ka pakka tareeka.

OpenYug jo kaam baar-baar karta hai, uski ek chhoti skill file bana leta hai
`agent/skills/<naam>.md` me. Agli baar wahi kaam aaye to pehle skill dekhta hai.

Skill sirf "tareeka" (steps) batati hai — khud code chalaakar system nahi badalti.
Isliye ye safe hai: guide karti hai, zabardasti kuch nahi karti.

CLI:
  python3 agent/skills.py list
  python3 agent/skills.py match "data check karo"
  python3 agent/skills.py new "data-check" --trigger "data,market" \
        --when "jab data ki umar dekhni ho" --steps "live.json padho;umar nikaalo" \
        --verify "umar <= 45 min"
"""
import os, sys, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = os.path.join(ROOT, "agent", "skills")
os.makedirs(SKILLS, exist_ok=True)


def _slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "skill"


def list_skills():
    out = []
    for f in sorted(os.listdir(SKILLS)):
        if f.endswith(".md") and f != "README.md":
            out.append(f[:-3])
    return out


def _read_skill(name):
    p = os.path.join(SKILLS, name + ".md")
    if not os.path.exists(p):
        return None
    return open(p, encoding="utf-8").read()


def triggers_of(name):
    txt = _read_skill(name) or ""
    # sirf usi line tak (newline paar na kare)
    m = re.search(r"^trigger:[ \t]*(.*)$", txt, re.M | re.I)
    val = m.group(1).strip() if m else ""
    return [w.strip().lower() for w in val.split(",") if w.strip()]


def match(task):
    """Task ke liye sabse theek skill ka naam (ya None)."""
    t = task.lower()
    best, best_hits = None, 0
    for name in list_skills():
        hits = sum(1 for w in triggers_of(name) if w and w in t)
        if hits > best_hits:
            best, best_hits = name, hits
    return best


def steps_of(name):
    txt = _read_skill(name) or ""
    out, grab = [], False
    for line in txt.splitlines():
        if re.match(r"^steps:", line, re.I):
            grab = True
            continue
        if grab:
            if re.match(r"^\w+:", line):   # agla section aa gaya
                break
            s = line.strip()
            s = re.sub(r"^(\d+[.)]|[-*])\s*", "", s).strip()  # sirf list-marker hatao
            if s:
                out.append(s)
    return out


def create_skill(name, trigger="", when="", steps=None, verify=""):
    """Nayi skill file banao. steps = list[str] ya ';' se juda string."""
    if isinstance(steps, str):
        steps = [s.strip() for s in steps.split(";") if s.strip()]
    steps = steps or []
    slug = _slug(name)
    p = os.path.join(SKILLS, slug + ".md")
    if os.path.exists(p):
        return p, False  # pehle se hai, dubara nahi banayi
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    lines = [
        f"# Skill: {name}",
        f"banaya: {today}",
        f"trigger: {trigger}",
        f"kab use karein: {when}",
        "steps:",
    ]
    for i, s in enumerate(steps, 1):
        lines.append(f"{i}. {s}")
    lines += [f"verify: {verify}", ""]
    open(p, "w", encoding="utf-8").write("\n".join(lines))
    return p, True


def _cli():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "list":
        sk = list_skills()
        print("Skills:", ", ".join(sk) if sk else "(abhi koi nahi)")
    elif cmd == "match":
        task = " ".join(sys.argv[2:])
        m = match(task)
        if m:
            print(f"Skill mili: {m}")
            for i, s in enumerate(steps_of(m), 1):
                print(f"  {i}. {s}")
        else:
            print("Koi skill match nahi hui.")
    elif cmd == "new":
        name = sys.argv[2]
        rest = sys.argv[3:]
        opts = {"--trigger": "", "--when": "", "--steps": "", "--verify": ""}
        i = 0
        while i < len(rest):
            if rest[i] in opts and i + 1 < len(rest):
                opts[rest[i]] = rest[i + 1]; i += 2
            else:
                i += 1
        p, made = create_skill(name, trigger=opts["--trigger"], when=opts["--when"],
                               steps=opts["--steps"], verify=opts["--verify"])
        print(("✅ bani: " if made else "pehle se thi: ") + p)
    else:
        print(__doc__)


if __name__ == "__main__":
    _cli()
