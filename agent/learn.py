#!/usr/bin/env python3
"""
OpenYug — seekhne wala hissa.
1) web se naya kuch laata hai  2) free AI se short sabak banata hai
3) knowledge me jodta hai  4) capability naapta hai
Bina API key chalta hai (free AI par, limit ke sath).
"""
import json, os, re, urllib.request, urllib.parse, datetime, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KNOW = os.path.join(ROOT, "agent", "knowledge.md")
STATE = os.path.join(ROOT, "agent", "state.json")
NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

SOURCES = [
    "https://hnrss.org/newest?points=120",
    "https://github.blog/changelog/feed/",
]

def fetch(url, timeout=20):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "openyug-agent"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "ignore")
    except Exception as e:
        return ""

def titles(xml, n=12):
    out = []
    for m in re.finditer(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", xml, re.S):
        t = re.sub(r"\s+", " ", m.group(1)).strip()
        if t and len(t) > 12 and "Hacker News" not in t and "GitHub" != t:
            out.append(t)
    return out[:n]

def free_ai(prompt, timeout=30):
    url = "https://text.pollinations.ai/" + urllib.parse.quote(prompt) + "?model=openai"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "openyug"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "ignore").strip()
    except Exception:
        return ""

def load_state():
    try:
        return json.load(open(STATE, encoding="utf-8"))
    except Exception:
        return {"paused": False, "learn_count": 0, "last_learn": None, "score": 0, "history": []}

def save_state(st):
    json.dump(st, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def main():
    st = load_state()
    if st.get("paused"):
        print("⏸️ OpenYug paused hai — Swag ke resume karne ka intezaar.")
        return

    got = []
    for s in SOURCES:
        got += titles(fetch(s), 8)
    got = list(dict.fromkeys(got))[:14]

    if not got:
        print("Aaj kuch naya nahi mila (net issue).")
        return

    # free AI se chhota sabak (limit ho to chhod do)
    prompt = ("In headlines ko padho aur Hinglish me 3 line ka sabak do — "
              "kya naya hai aur developer ke liye kya kaam ka hai:\n- " + "\n- ".join(got[:8]))
    sabak = free_ai(prompt)
    if not sabak:
        sabak = "(free AI se sabak nahi bana — sirf headlines)"

    block = [f"\n## {NOW[:10]} — seekha ({len(got)} cheezein)", ""]
    block += [f"- {g}" for g in got]
    block += ["", "**Sabak:** " + sabak.replace("\n", " ")[:600], ""]

    with open(KNOW, "a", encoding="utf-8") as f:
        f.write("\n".join(block))

    st["learn_count"] = st.get("learn_count", 0) + 1
    st["last_learn"] = NOW
    st["score"] = min(100, st.get("score", 0) + 2)
    st.setdefault("history", []).append({"at": NOW, "headlines": len(got), "sabak": bool(sabak)})
    st["history"] = st["history"][-50:]
    save_state(st)

    print(f"✅ {len(got)} headlines, sabak: {'haan' if sabak else 'nahi'}")
    print(f"Score: {st['score']}/100 · seekhne ki baar: {st['learn_count']}")

if __name__ == "__main__":
    main()
