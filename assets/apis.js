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


  /* ---------- apni koi bhi API (custom) ---------- */
  const LS_CUSTOM = "seetal.customapis.v1";

  function listCustom() {
    try { return JSON.parse(localStorage.getItem(LS_CUSTOM) || "[]"); } catch (e) { return []; }
  }
  function saveCustom(list) {
    try { localStorage.setItem(LS_CUSTOM, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }
  /**
   * koi bhi API jodo.
   * item = { name, url, key, authHeader, model, body, kind }
   * url me {prompt} likho — wahan prompt jayega. Ya {key} likho — wahan key.
   * kind: "text" (seedha jawab) ya "openai" (OpenAI jaisa JSON) ya "gemini"
   */
  function addCustom(item) {
    if (!item || !item.url) return { ok: false, error: "url chahiye" };
    const list = listCustom().filter(x => x.name !== item.name);
    list.unshift({
      name: item.name || ("api-" + (list.length + 1)),
      url: item.url,
      key: item.key || "",
      authHeader: item.authHeader || "Authorization",
      authPrefix: item.authPrefix === undefined ? "Bearer " : item.authPrefix,
      model: item.model || "",
      body: item.body || "",
      kind: item.kind || "text",
    });
    saveCustom(list);
    return { ok: true, count: list.length };
  }
  function removeCustom(name) {
    saveCustom(listCustom().filter(x => x.name !== name));
    return { ok: true };
  }

  function fill(tpl, prompt, key, model) {
    return String(tpl)
      .replace(/\{prompt\}/g, encodeURIComponent(prompt))
      .replace(/\{promptRaw\}/g, prompt)
      .replace(/\{key\}/g, encodeURIComponent(key || ""))
      .replace(/\{model\}/g, encodeURIComponent(model || ""));
  }

  async function callCustom(api, prompt, ms) {
    const url = fill(api.url, prompt, api.key, api.model);
    const headers = { "Content-Type": "application/json" };
    if (api.key) headers[api.authHeader] = (api.authPrefix || "") + api.key;
    let init = { method: "GET", headers, cache: "no-store" };

    if (api.kind === "openai" || api.body) {
      init.method = "POST";
      const bodyTpl = api.body || JSON.stringify({
        model: api.model || "gpt-4o-mini",
        messages: [{ role: "user", content: "{promptRaw}" }],
      });
      init.body = bodyTpl
        .replace(/\{promptRaw\}/g, prompt.replace(/"/g, '\\"'))
        .replace(/\{model\}/g, api.model || "");
    }

    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms || 15000);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const j = await r.json();
        const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content)
          || (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0].text)
          || (j.content && j.content[0] && j.content[0].text)
          || j.output || j.text || j.response || "";
        return t ? String(t).trim() : null;
      }
      const t = (await r.text() || "").trim();
      return t || null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(to);
    }
  }

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

  let lastLimitAt = 0;
  function limitedRecently(){ return (Date.now() - lastLimitAt) < 45000; }

  async function fetchText(url, ms) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), ms || 12000);
    try {
      const r = await fetch(url, { cache: "no-store", signal: ctl.signal });
      if (r.status === 402 || r.status === 429){ lastLimitAt = Date.now(); return null; }
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

    // 1) tumhari apni APIs pehle
    for (const api of listCustom()) {
      const t = await callCustom(api, prompt, opts.timeout || 15000);
      if (t && t.length > 1) { mark("custom:" + api.name, true); return { ok: true, text: t, model: "custom:" + api.name, via: "own" }; }
      mark("custom:" + api.name, false);
    }

    // 2) wahi sawal pehle poochha tha? — turant wahi jawab
    try{
      const cache = JSON.parse(localStorage.getItem("seetal.aicache.v1") || "{}");
      const key = prompt.slice(0, 120);
      if (cache[key] && (Date.now() - cache[key].t) < 6 * 60 * 60 * 1000){
        return { ok: true, text: cache[key].v, model: "cache", via: "cached" };
      }
    }catch(e){}

    // 3) free models
    const list = AI_FREE.slice().sort((a, b) => score(b.id) - score(a.id));
    for (const model of list) {
      const base = model.url(prompt);
      const proxies = PROXIES.slice().sort((a, b) => score(a.id) - score(b.id));
      for (const px of proxies) {
        const t = await fetchText(px.wrap(base), opts.timeout || 12000);
        if (t && t.length > 2) {
          mark(model.id, true); mark(px.id, true);
          try{
            const cache = JSON.parse(localStorage.getItem("seetal.aicache.v1") || "{}");
            cache[prompt.slice(0, 120)] = { v: t, t: Date.now() };
            const keys = Object.keys(cache).slice(-60);
            const small = {}; keys.forEach(k => small[k] = cache[k]);
            localStorage.setItem("seetal.aicache.v1", JSON.stringify(small));
          }catch(e){}
          return { ok: true, text: t, model: model.id, via: px.id };
        }
        mark(px.id, false);
      }
      mark(model.id, false);
    }
    return {
      ok: false,
      text: null,
      tried: AI_FREE.length * PROXIES.length,
      reason: limitedRecently() ? "free-limit" : "no-answer",
      hint: limitedRecently()
        ? "Free AI 45 second me sirf ek jawab deta hai. Key daalo (Sarvam/Gemini/GPT) to tez chalega."
        : "Koi rasta jawab nahi de paya — net ya key check karo.",
    };
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

  window.SeetalAPIs = { ask, data, health, mark, score, AI_FREE, PROXIES, DATA, addCustom, listCustom, removeCustom, callCustom };
})();
