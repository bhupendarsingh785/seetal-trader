#!/usr/bin/env python3
"""
OpenYug ka self-improve — khud sochta hai "main behtar kaise ho sakta hun",
aur sujhav `agent/suggestions.md` me likh deta hai.

** BAHUT ZAROORI (jaan-boojh kar rakhi limit) **
Ye script OpenYug ka apna code KHUD NAHI BADALTI aur KHUD MERGE NAHI KARTI.
Sirf sujhav likhti hai. Us sujhav ko ek PR me bhejne ka kaam workflow karta hai
(openyug-propose.yml), aur Swag ek click me 'merge' kare — tabhi badlaav aata hai.

Wajah: jo agent bina haan ke apna code chalu kar de, woh system chup-chaap tod
sakta hai. Isliye "advance hona" to hai — par Swag ke review-gate se.

CLI:  python3 agent/self_improve.py        # sujhav banao
      python3 agent/self_improve.py --print  # sirf dikhao, likho mat
"""
import json, os, re, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(ROOT, "agent")
SUG = os.path.join(A, "suggestions.md")
REPORTS = os.path.join(A, "reports")


def jload(p, default):
    try:
        return json.load(open(os.path.join(A, p), encoding="utf-8"))
    except Exception:
        return default


def read(p, default=""):
    try:
        return open(os.path.join(A, p), encoding="utf-8").read()
    except Exception:
        return default


def scan():
    """State + reports padh kar thoda-sa 'khud ki samajh' banao. Wapas: list[str] sujhav."""
    st = jload("state.json", {})
    ideas = []

    # 1) Jo order baar-baar 'taiyar handler nahi' me atakta hai -> naya handler ka sujhav
    stuck = {}
    if os.path.isdir(REPORTS):
        for f in sorted(os.listdir(REPORTS))[-20:]:
            if not f.endswith(".md"):
                continue
            txt = open(os.path.join(REPORTS, f), encoding="utf-8").read()
            for m in re.finditer(r"^## (.+)\n.*taiyar handler nahi", txt, re.M):
                k = m.group(1).strip()
                stuck[k] = stuck.get(k, 0) + 1
    for k, n in stuck.items():
        if n >= 2:
            ideas.append(f"NAYA HANDLER: '{k}' {n} baar bina handler atka — "
                         f"run.py ke HANDLERS me iske liye ek kaam jodna chahiye.")

    # 2) Site/mirror baar-baar band -> dhyaan dilao
    down = {}
    if os.path.isdir(REPORTS):
        for f in sorted(os.listdir(REPORTS))[-10:]:
            if not f.endswith(".md"):
                continue
            txt = open(os.path.join(REPORTS, f), encoding="utf-8").read()
            for m in re.finditer(r"❌ ([A-Za-z ]+?) \(band\)", txt):
                k = m.group(1).strip()
                down[k] = down.get(k, 0) + 1
    for k, n in down.items():
        if n >= 3:
            ideas.append(f"DHYAAN: '{k}' pichhle {n} check me band mila — "
                         f"URL/host check karna chahiye.")

    # 3) Score ruk gaya ho -> kuch naya seekhne ka sujhav
    brain = st.get("brain", [])
    if len(brain) >= 6:
        scores_same = st.get("score", 0)
        # agar bahut run ho gaye par learn_count kam -> learning badhao
        if st.get("learn_count", 0) < max(3, len(brain) // 4):
            ideas.append("SEEKHNA BADHAO: run ke hisaab se learning kam hai — "
                         "learn.py ko din me ek baar aur chalaane ka soch.")

    # 4) Skills khali -> skill banane ki aadat daalo
    sk_dir = os.path.join(A, "skills")
    sk = [f for f in os.listdir(sk_dir)
          if f.endswith(".md") and f != "README.md"] if os.path.isdir(sk_dir) else []
    if not sk and len(brain) >= 4:
        ideas.append("SKILL BANAO: abhi tak koi skill nahi bani — jo kaam baar-baar "
                     "hota hai uski ek skill agent/skills/ me banani chahiye.")

    return ideas


def write_suggestions(ideas):
    if not ideas:
        return False
    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    old = read("suggestions.md")
    # dedup — jo idea pehle se file me hai use dubara mat likho
    fresh = [i for i in ideas if i[:40] not in old]
    if not fresh:
        return False
    block = [f"\n## {today} — OpenYug ke sujhav (review-gate: Swag merge kare)", ""]
    block += [f"- [ ] {i}" for i in fresh]
    block += [""]
    header = "" if old else ("# OpenYug ke sujhav\n\n"
                             "_Ye OpenYug khud likhta hai. Code tabhi badlega jab "
                             "Swag PR 'merge' karega. Auto-merge kabhi nahi._\n")
    with open(SUG, "a", encoding="utf-8") as f:
        if header:
            f.write(header)
        f.write("\n".join(block))
    return True


if __name__ == "__main__":
    ideas = scan()
    if "--print" in sys.argv:
        print("Sujhav:")
        for i in ideas:
            print("  -", i)
    else:
        changed = write_suggestions(ideas)
        print(f"{'✅ suggestions.md me ' + str(len(ideas)) + ' sujhav' if changed else 'Naya sujhav nahi'}")
