/* ============================================================
   Seetal Brain — ek dimaag jo kai free AI ko jodta hai.
   Khud decide karta hai kaunsa AI kis kaam ke liye theek hai,
   jo fail ho use hata deta hai, aur hamesha jawab laata hai.

   Use karna:
     const r = await Brain.ask("kuch likho", { task: "code" });
     if (r.ok) console.log(r.text, r.model, r.ms);

   task: "code" | "chat" | "advice" | "any"  (default "any")
   ============================================================ */
(function () {
  const LS = "seetal.brain.v1";

  /* free, bina key wale raste. model= param se alag-alag AI chunte hain. */
  const MODELS = [
    { id: "openai",        good: ["chat", "advice"],           w: 3 },
    { id: "openai-fast",   good: ["chat"],                     w: 2 },
    { id: "mistral",       good: ["chat", "code"],             w: 3 },
    { id: "qwen-coder",    good: ["code"],                     w: 3 },
    { id: "llama",         good: ["chat", "advice"],           w: 2 },
    { id: "deepseek",      good: ["code", "advice"],           w: 2 },
    { id: "gemini",        good: ["chat", "code", "advice"],   w: 3 },
  ];

  const PROXIES = [
    { id: "seedha",   wrap: (u) => u },
    { id: "allorigins", wrap: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
    { id: "corsproxy",  wrap: (u) => "https://corsproxy.io/?" + encodeURIComponent(u) },
  ];

  function load() {
    try {
      const raw = localStorage.getItem(LS);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function save(h) {
    try { localStorage.setItem(LS, JSON.stringify(h)); } catch (e) {}
  }
  const key = (m, p) => m + "|" + p;

  function score(h, m, p) {
    const r = h[key(m, p)];
    if (!r) return 5;                       // naya hai — try karke dekho
    if (r.fail >= 2 && r.ok === 0) return 0; // do baar fail, kabhi chala nahi
    const rate = r.ok / Math.max(1, r.ok + r.fail);
    const speed = r.ms ? Math.max(0, 1 - r.ms / 30000) : 0.5;
    return rate * 6 + speed * 4;
  }

  function order(task, h) {
    return MODELS
      .filter((m) => task === "any" || m.good.includes(task) || m.good.length === 3)
      .map((m) => ({ m, s: score(h, m.id, "seedha") + m.w * 0.3 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.m);
  }

  function urlFor(model, prompt) {
    return "https://text.pollinations.ai/" + encodeURIComponent(prompt) +
      "?model=" + encodeURIComponent(model) + "&seed=" + Math.floor(Math.random() * 1e6);
  }

  async function one(model, proxy, prompt, timeout) {
    const u = proxy.wrap(urlFor(model, prompt));
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), timeout);
    const t0 = performance.now();
    try {
      const res = await fetch(u, { cache: "no-store", signal: ctl.signal });
      const txt = (await res.text() || "").trim();
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error("http " + res.status);
      if (txt.length < 8) throw new Error("khaali jawab");
      if (/^\s*<(!doctype|html)/i.test(txt) && !/text\/html/i.test(res.headers.get("content-type") || "")) {
        // proxy ka error page
        if (txt.length < 400) throw new Error("proxy error page");
      }
      return { ok: true, text: txt, ms, model: model.id, via: proxy.id };
    } finally {
      clearTimeout(to);
    }
  }

  const Brain = {
    version: "v1",
    models: MODELS.map((m) => m.id),

    health() { return load(); },
    reset() { save({}); },

    /* sabse achha rasta chun kar jawab laata hai */
    async ask(prompt, opts) {
      opts = opts || {};
      const task = opts.task || "any";
      const timeout = opts.timeout || 30000;
      const h = load();
      const tried = [];
      const models = order(task, h);
      const proxies = PROXIES;

      for (const m of models) {
        for (const p of proxies) {
          try {
            const r = await one(m, p, prompt, timeout);
            const k = key(m.id, p.id);
            const rec = h[k] || { ok: 0, fail: 0, ms: 0 };
            rec.ok++; rec.ms = Math.round((rec.ms + r.ms) / 2);
            h[k] = rec; save(h);
            return { ...r, tried };
          } catch (e) {
            const k = key(m.id, p.id);
            const rec = h[k] || { ok: 0, fail: 0, ms: 0 };
            rec.fail++; h[k] = rec; save(h);
            tried.push(m.id + "/" + p.id + ": " + String(e.message || e).slice(0, 40));
            if (String(e.message || e).includes("abort")) break; // timeout — agla model
          }
        }
      }
      return { ok: false, tried, text: "" };
    },

    /* code wala kaam: adhoora HTML aaye to dobara maangta hai */
    async code(prompt, opts) {
      opts = opts || {};
      const strict = prompt + "\n\nSirf poora HTML do — <!DOCTYPE html> se shuru, </html> par khatam. Koi explanation nahi, koi ``` nahi.";
      let r = await this.ask(strict, { task: "code", timeout: opts.timeout || 45000 });
      if (!r.ok) return r;
      let html = clean(r.text);
      if (!/<\/html>/i.test(html)) {
        const r2 = await this.ask(strict + "\n\nPichhli baar adhoora aaya. Is baar POORA likho.", { task: "code", timeout: opts.timeout || 45000 });
        if (r2.ok) {
          const h2 = clean(r2.text);
          if (/<\/html>/i.test(h2)) return { ...r2, text: h2 };
        }
      }
      return { ...r, text: html };
    },
  };

  function clean(t) {
    let x = String(t || "").trim().replace(/^```(?:html)?/i, "").replace(/```$/, "").trim();
    const i = x.search(/<!DOCTYPE html>|<html[\s>]/i);
    if (i > 0) x = x.slice(i);
    const j = x.toLowerCase().lastIndexOf("</html>");
    if (j > 0) x = x.slice(0, j + 7);
    return x;
  }

  window.Brain = Brain;
})();
