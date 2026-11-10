/**
 * Seetal APIs — ek hi jagah saare free raste.
 * Ye file poore system ke liye hai: Builder, Trader, Hub, Suno — sab isi ko use karein.
 *
 * Kuch bhi jhooth nahi: jo rasta chal raha hai wahi health me dikhega.
 */
(function () {
  const LS_HEALTH = "seetal.apihealth.v1";

  /* ---------- free AI ke raste (bina key) ---------- */
  const AI_FREE = [
    { id: "pollinations-openai", url: (p) => "https://text.pollinations.ai/" + encodeURIComponent(p) + "?model=openai" },
    { id: "pollinations-mistral", url: (p) => "https://text.pollinations.ai/" + encodeURIComponent(p) + "?model=mistral" },
    { id: "pollinations-qwen", url: (p) => "https://text.pollinations.ai/" + encodeURIComponent(p) + "?model=qwen-coder" },
    { id: "pollinations-llama", url: (p) => "https://text.pollinations.ai/" + encodeURIComponent(p) + "?model=llama" },
    { id: "pollinations-deepseek", url: (p) => "https://text.pollinations.ai/" + encodeURIComponent(p) + "?model=deepseek" },
  ];

  /* proxy raste — jab seedha CORS rok de */
  const PROXIES = [
    { id: "direct", wrap: (u) => u },
    { id: "allorigins", wrap: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
    { id: "corsproxy", wrap: (u) => "https://corsproxy.io/?" + encodeURIComponent(u) },
  ];

  /* ---------- data ke raste (trader + suno + sab) ---------- */
  const DATA = [
    { id: "site", url: "data/live.json" },
    { id: "github-raw", url: "https://raw.githubusercontent.com/bhupendarsingh785/seetal-trader/main/data/live.json" },
    { id: "jsdelivr", url: "https://cdn.jsdelivr.net/gh/bhupendarsingh785/seetal-trader@main/data/live.json" },
    { id: "cloudflare", url: "https://seetal-api.bhupendarsingh785.workers.dev/live" },
    { id: "gitlab", url: "https://gitlab.com/Bhuprndar785/bhupendarsingh785/-/raw/main/data/live.json" },
  ];

  /* ---------- health yaaddasht ---------- */
  function loadHealth() {
    try { return JSON.parse(localStorage.getItem(LS_HEALTH) || "{}"); } catch (e) { return {}; }
  }
  function saveHealth(h) {
    try { localStorage.setItem(LS_HEALTH, JSON.stringify(h)); } catch (e) {}
  }
  function mark(id, ok) {
    const h = loadHealth();
    const cur = h[id] || { ok: 0, fail: 0, last: 0 };
    if (ok) { cur.ok++; cur.fail = 0; } else { cur.fail++; }
    cur.last = Date.now();
    h[id] = cur;
    saveHealth(h);
  }
  function score(id) {
    const h = loadHealth()[id];
    if (!h) return 0;
    return h.ok - h.fail * 2;
  }

  async function fetchText(url, ms) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms || 12000);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctl.signal });
      if (!r.ok) return null;
      const t = (await r.text() || "").trim();
      if (!t || /^<!doctype|^<html/i.test(t)) return null;
      return t;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(to);
    }
  }

  /* sabse achha rasta chuno (health ke hisaab se) */
  async function ask(prompt, opts) {
    opts = opts || {};
    const list = AI_FREE.slice().sort((a, b) => score(b.id) - score(a.id));
    for (const model of list) {
      const base = model.url(prompt);
      const proxies = PROXIES.slice().sort((a, b) => score(a.id) - score(b.id));
      for (const px of proxies) {
        const t = await fetchText(px.wrap(base), opts.timeout || 12000);
        if (t && t.length > 2) {
          mark(model.id, true); mark(px.id, true);
          return { ok: true, text: t, model: model.id, via: px.id };
        }
        mark(px.id, false);
      }
      mark(model.id, false);
    }
    return { ok: false, text: null, tried: AI_FREE.length * PROXIES.length };
  }

  /* data laao — jo pehla chale wahi */
  async function data() {
    const list = DATA.slice().sort((a, b) => score(b.id) - score(a.id));
    for (const src of list) {
      try {
        const r = await fetch(src.url, { cache: "no-store" });
        if (!r.ok) { mark(src.id, false); continue; }
        const j = await r.json();
        const d = j && j.data ? j.data : j;
        if (d) { mark(src.id, true); return { ok: true, data: d, source: src.id }; }
      } catch (e) { mark(src.id, false); }
    }
    return { ok: false, data: null };
  }

  /* sabka poora check — report ke liye */
  async function health() {
    const out = { ai: [], data: [] };
    const r = await ask("Sirf ek shabd likho: theek", { timeout: 8000 });
    out.ai.push({ id: r.model || "-", ok: r.ok, via: r.via || "-" });
    const d = await data();
    out.data.push({ id: d.source || "-", ok: d.ok });
    return out;
  }

  window.SeetalAPIs = { ask, data, health, mark, score, AI_FREE, PROXIES, DATA };
})();
