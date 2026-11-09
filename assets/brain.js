/* Seetal Brain v2 — configurable AI router
   Replace the old assets/brain.js with this file.
   Supports Gemini, Anthropic, OpenAI and OpenAI-compatible endpoints
   (DeepSeek, Grok/xAI, Sarvam and other compatible APIs).
   NOTE: Browser-side API keys are not secret. Use a private backend for public deployment.
*/
(function () {
  "use strict";

  const LS = "seetal.brain.v2";
  const KEY_LS = "seetal.apikey.v2";
  const LEGACY_KEY_LS = "seetal.apikey.v1";

  const PROVIDERS = {
    openai: {
      type: "openai",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini"
    },
    deepseek: {
      type: "openai",
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat"
    },
    grok: {
      type: "openai",
      endpoint: "https://api.x.ai/v1/chat/completions",
      model: "grok-3-mini"
    },
    sarvam: {
      type: "openai",
      endpoint: "https://api.sarvam.ai/v1/chat/completions",
      model: "sarvam-m"
    },
    openai_compatible: {
      type: "openai",
      endpoint: "",
      model: ""
    },
    gemini: {
      type: "gemini",
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/",
      model: "gemini-2.0-flash"
    },
    anthropic: {
      type: "anthropic",
      endpoint: "https://api.anthropic.com/v1/messages",
      model: "claude-3-5-haiku-latest"
    }
  };

  const FREE_MODELS = [
    { id: "openai", tasks: ["chat", "advice"], weight: 3 },
    { id: "mistral", tasks: ["chat", "code"], weight: 3 },
    { id: "qwen-coder", tasks: ["code"], weight: 4 },
    { id: "deepseek", tasks: ["code", "advice"], weight: 3 },
    { id: "gemini", tasks: ["chat", "code", "advice"], weight: 3 },
    { id: "llama", tasks: ["chat", "advice"], weight: 2 }
  ];

  const PROXIES = [
    { id: "direct", wrap: u => u },
    { id: "allorigins", wrap: u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
    { id: "corsproxy", wrap: u => "https://corsproxy.io/?" + encodeURIComponent(u) }
  ];

  function readJSON(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
    catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  function cleanText(value) {
    return String(value || "").trim().replace(/^```(?:html|javascript|js|css|json)?\s*/i, "")
      .replace(/\s*```$/, "").trim();
  }
  function timeoutSignal(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { controller, clear: () => clearTimeout(timer) };
  }
  function getLegacyConfig() {
    const old = readJSON(LEGACY_KEY_LS, null);
    if (!old || !old.key || !old.provider) return null;
    const mapped = old.provider === "openai" ? "openai" : old.provider;
    return { provider: mapped, key: old.key, model: old.model || "" };
  }

  const Brain = {
    version: "v2.0",
    models: FREE_MODELS.map(x => x.id),
    providers: Object.keys(PROVIDERS),

    health() { return readJSON(LS, {}); },
    resetHealth() { writeJSON(LS, {}); },

    getKey() {
      return readJSON(KEY_LS, null) || getLegacyConfig();
    },

    setKey(provider, key, model, endpoint) {
      const cfg = {
        provider: String(provider || "none"),
        key: String(key || "").trim(),
        model: String(model || "").trim(),
        endpoint: String(endpoint || "").trim()
      };
      if (cfg.provider === "none" || !cfg.key) {
        try { localStorage.removeItem(KEY_LS); } catch (_) {}
        return true;
      }
      return writeJSON(KEY_LS, cfg);
    },

    clearKey() {
      try {
        localStorage.removeItem(KEY_LS);
        localStorage.removeItem(LEGACY_KEY_LS);
      } catch (_) {}
    },

    async ask(prompt, opts) {
      opts = opts || {};
      const task = opts.task || "any";
      const timeout = Math.max(5000, Number(opts.timeout) || 30000);
      const cfg = this.getKey();

      if (cfg && cfg.key && cfg.provider && cfg.provider !== "none") {
        try {
          const text = await callConfigured(cfg, String(prompt || ""), timeout);
          if (text && text.length > 2) {
            return { ok: true, text, ms: 0, model: cfg.model || cfg.provider, via: "configured API", tried: [] };
          }
        } catch (e) {
          if (opts.noFallback) {
            return { ok: false, text: "", tried: [cfg.provider + ": " + shortError(e)] };
          }
        }
      }

      const history = this.health();
      const models = FREE_MODELS
        .filter(m => task === "any" || m.tasks.includes(task))
        .sort((a, b) => score(history, b.id) + b.weight * .2 - score(history, a.id) - a.weight * .2);
      const tried = [];

      for (const model of models) {
        for (const proxy of PROXIES) {
          try {
            const result = await callFree(model.id, proxy, String(prompt || ""), timeout);
            const old = history[model.id] || { ok: 0, fail: 0, avgMs: 0 };
            old.ok++;
            old.avgMs = old.avgMs ? Math.round((old.avgMs + result.ms) / 2) : result.ms;
            history[model.id] = old;
            writeJSON(LS, history);
            return { ...result, tried };
          } catch (e) {
            const old = history[model.id] || { ok: 0, fail: 0, avgMs: 0 };
            old.fail++;
            history[model.id] = old;
            writeJSON(LS, history);
            tried.push(model.id + "/" + proxy.id + ": " + shortError(e));
            if (e && e.name === "AbortError") break;
          }
        }
      }
      return { ok: false, text: "", tried };
    },

    async code(prompt, opts) {
      opts = opts || {};
      const p = String(prompt || "") +
        "\n\nOutput only complete HTML source code. Start with <!DOCTYPE html> and end with </html>. No markdown fences.";
      let r = await this.ask(p, { ...opts, task: "code", timeout: opts.timeout || 45000 });
      if (!r.ok) return r;
      let html = cleanHTML(r.text);
      if (!/<\/html>/i.test(html)) {
        const retry = await this.ask(p + "\nYour previous answer was incomplete. Finish the entire HTML document.", {
          ...opts, task: "code", timeout: opts.timeout || 45000
        });
        if (retry.ok && /<\/html>/i.test(cleanHTML(retry.text))) {
          r = retry;
          html = cleanHTML(retry.text);
        }
      }
      return { ...r, text: html };
    },

    async testKey() {
      const cfg = this.getKey();
      if (!cfg || !cfg.key) return { ok: false, error: "API key set nahi hai." };
      try {
        const text = await callConfigured(cfg, "Reply with exactly: OK", 15000);
        return { ok: !!text, text: text || "", provider: cfg.provider };
      } catch (e) {
        return { ok: false, error: shortError(e), provider: cfg.provider };
      }
    },

    async ownKeyWorking() {
      const r = await this.testKey();
      return !!r.ok;
    }
  };

  function score(history, id) {
    const r = history[id];
    if (!r) return 5;
    if (r.fail >= 3 && r.ok === 0) return 0;
    return (r.ok / Math.max(1, r.ok + r.fail)) * 7 +
      (r.avgMs ? Math.max(0, 3 - r.avgMs / 10000) : 1);
  }

  function shortError(e) {
    return String((e && e.message) || e || "unknown error").slice(0, 100);
  }

  async function fetchText(url, options, timeout) {
    const t = timeoutSignal(timeout);
    try {
      const response = await fetch(url, { ...options, signal: t.controller.signal, cache: "no-store" });
      const raw = await response.text();
      let data = null;
      try { data = JSON.parse(raw); } catch (_) {}
      if (!response.ok) {
        const message = data && data.error && (data.error.message || data.error) || raw.slice(0, 180);
        throw new Error("HTTP " + response.status + ": " + message);
      }
      return { raw, data, headers: response.headers };
    } finally { t.clear(); }
  }

  async function callConfigured(cfg, prompt, timeout) {
    const preset = PROVIDERS[cfg.provider];
    if (!preset) throw new Error("Unknown provider: " + cfg.provider);
    if (preset.type === "gemini") {
      const model = cfg.model || preset.model;
      const url = preset.endpoint + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(cfg.key);
      const { data } = await fetchText(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }, timeout);
      const text = data && data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts.map(p => p.text || "").join("");
      if (!text) throw new Error(data && data.error && data.error.message || "Gemini empty response");
      return text.trim();
    }

    if (preset.type === "anthropic") {
      const { data } = await fetchText(cfg.endpoint || preset.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
          model: cfg.model || preset.model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt }]
        })
      }, timeout);
      const text = data && data.content && data.content.map(x => x.text || "").join("");
      if (!text) throw new Error(data && data.error && data.error.message || "Anthropic empty response");
      return text.trim();
    }

    const endpoint = cfg.endpoint || preset.endpoint;
    const model = cfg.model || preset.model;
    if (!endpoint) throw new Error("API endpoint bharna zaroori hai.");
    if (!model) throw new Error("Model name bharna zaroori hai.");
    const { data } = await fetchText(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }]
      })
    }, timeout);
    const text = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error(data && data.error && data.error.message || "API empty response");
    return typeof text === "string" ? text.trim() : JSON.stringify(text);
  }

  async function callFree(model, proxy, prompt, timeout) {
    const url = "https://text.pollinations.ai/" + encodeURIComponent(prompt) +
      "?model=" + encodeURIComponent(model) + "&seed=" + Math.floor(Math.random() * 1000000);
    const t0 = performance.now();
    const { raw } = await fetchText(proxy.wrap(url), {}, timeout);
    const text = raw.trim();
    if (text.length < 8) throw new Error("Empty AI response");
    if (/^\s*<(?:!doctype|html)/i.test(text) && text.length < 500) throw new Error("Proxy returned HTML error page");
    return { ok: true, text, ms: Math.round(performance.now() - t0), model, via: proxy.id };
  }

  function cleanHTML(value) {
    let text = cleanText(value);
    const start = text.search(/<!doctype html>|<html[\s>]/i);
    if (start >= 0) text = text.slice(start);
    const end = text.toLowerCase().lastIndexOf("</html>");
    if (end >= 0) text = text.slice(0, end + 7);
    return text;
  }

  window.Brain = Brain;
})();
