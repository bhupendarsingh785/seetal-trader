#!/usr/bin/env python3
"""
OpenYug — orders padhta hai, kar sakne wale kaam karta hai, report likhta hai.
Bina API key bhi chalta hai (jo kaam local hain woh karta hai).
"""
import json, os, re, subprocess, sys, time, datetime, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORDERS = os.path.join(ROOT, "agent", "orders.md")
REPORTS = os.path.join(ROOT, "agent", "reports")
NOW = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

def sh(cmd, timeout=240):
    try:
        r = subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "") + (r.stderr or "")
    except Exception as e:
        return 1, str(e)

def http_ok(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "openyug-agent"})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status < 400, int((time.time() - t0) * 1000)
    except Exception:
        return False, 0

def load_state():
    try:
        return json.load(open(os.path.join(ROOT, "agent", "state.json"), encoding="utf-8"))
    except Exception:
        return {"paused": False}

def save_state(st):
    try:
        json.dump(st, open(os.path.join(ROOT, "agent", "state.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    except Exception:
        pass

def read_orders():
    if not os.path.exists(ORDERS):
        return []
    out = []
    for line in open(ORDERS, encoding="utf-8"):
        m = re.match(r"\s*-\s*\[\s\]\s*(.+)", line)
        if m:
            out.append(m.group(1).strip())
    return out

def mark_done(text):
    try:
        s = open(ORDERS, encoding="utf-8").read()
        s = s.replace(f"- [ ] {text}", f"- [x] {text}")
        open(ORDERS, "w", encoding="utf-8").write(s)
    except Exception:
        pass

def job_tests():
    code, out = sh("bash tests/check-all.sh")
    tail = "\n".join(out.strip().splitlines()[-12:])
    return code == 0, tail

def job_data_age():
    p = os.path.join(ROOT, "data", "live.json")
    if not os.path.exists(p):
        return False, "data/live.json nahi mila"
    d = json.load(open(p, encoding="utf-8"))
    gen = d.get("generated_at")
    rows = len(d.get("rows", []))
    if not gen:
        return False, "generated_at nahi hai"
    t = datetime.datetime.fromisoformat(gen.replace("Z", "+00:00"))
    age = int((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() // 60)
    ok = age <= 45 and rows >= 3
    return ok, f"data {age} min purana, {rows} symbols — {'theek' if ok else 'purana/ kam'}"

def job_sites():
    sites = [
        ("Pages", "https://bhupendarsingh785.github.io/seetal-trader/"),
        ("Netlify", "https://seetal-trader.netlify.app/"),
        ("Vercel", "https://bhupendarsingh785.vercel.app/"),
        ("Cloudflare API", "https://seetal-api.bhupendarsingh785.windows.dev/status"),
        ("Suno", "https://bhupendarsingh785.github.io/suno-assistant/"),
        ("YouMe", "https://bhupendarsingh785.github.io/seetal-trader/youme.html"),
    ]
    # Cloudflare URL theek karo (typo se bachne ke liye)
    sites[3] = ("Cloudflare API", "https://seetal-api.bhupendarsingh785.workers.dev/status")
    lines, okc = [], 0
    for name, url in sites:
        ok, ms = http_ok(url)
        okc += 1 if ok else 0
        lines.append(f"{'✅' if ok else '❌'} {name} {ms}ms" if ok else f"❌ {name} (band)")
    return okc >= len(sites) - 1, "\n".join(lines)

def job_cleanup():
    if not os.path.isdir(REPORTS):
        return True, "reports folder nahi hai"
    cut = time.time() - 7 * 86400
    n = 0
    for f in os.listdir(REPORTS):
        p = os.path.join(REPORTS, f)
        if os.path.isfile(p) and os.path.getmtime(p) < cut:
            os.remove(p); n += 1
    return True, f"{n} purani report saaf ki"

HANDLERS = [
    (r"test|check-all|jaanch", job_tests),
    (r"data|purana|umar", job_data_age),
    (r"site|health|platform|check karo", job_sites),
    (r"saaf|cleanup|purani report", job_cleanup),
]

def main():
    os.makedirs(REPORTS, exist_ok=True)
    st = load_state()

    # pause / resume aadesh
    raw = open(ORDERS, encoding="utf-8").read() if os.path.exists(ORDERS) else ""
    if re.search(r"^- \[ \]\s*pause", raw, re.M | re.I):
        st["paused"] = True; save_state(st)
        print("⏸️ OpenYug paused — Swag ke 'resume' tak kaam band.")
        return
    if re.search(r"^- \[ \]\s*resume", raw, re.M | re.I):
        st["paused"] = False; save_state(st)
        raw = raw.replace("- [ ] resume", "- [x] resume")
        open(ORDERS, "w", encoding="utf-8").write(raw)
        print("▶️ OpenYug resume ho gaya.")
    if st.get("paused"):
        print("⏸️ OpenYug paused hai.")
        return

    orders = read_orders()
    lines = [f"# OpenYug report — {NOW}", "", f"Orders mile: {len(orders)}", ""]
    if not orders:
        lines.append("Koi naya aadesh nahi. Bas routine check:")
        ok, out = job_sites()
        lines += ["", "## Sites", out]

    for o in orders:
        done = False
        for pat, fn in HANDLERS:
            if re.search(pat, o, re.I):
                ok, out = fn()
                lines += [f"## {o}", ("✅" if ok else "❌") + " " + out.replace("\n", "\n  "), ""]
                if ok:
                    mark_done(o)
                done = True
                break
        if not done:
            lines += [f"## {o}", "⏸️ Ye kaam mere paas taiyar handler nahi hai — Swag ke aadesh ka intezaar.", ""]

    lines += ["---", "_Seetal Agent — bina key, sirf local kaam._"]
    name = os.path.join(REPORTS, f"{NOW.replace(':','').replace('-','')}.md")
    open(name, "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines))
    print(f"\nReport: {name}")

if __name__ == "__main__":
    main()
