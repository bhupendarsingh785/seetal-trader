/* ============================================================
   Seetal Core — ek hi yaaddasht, saare hisson ke liye.
   Sab pages ek hi origin par hain (bhupendarsingh785.github.io),
   isliye localStorage share hota hai. Ang alag, yaaddasht ek.
   ============================================================ */
(function () {
  const KEY = "seetal.core.v1";

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function save(o) {
    try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {}
  }

  const Core = {
    version: "v1",

    /* poora ghar */
    all() { return load(); },

    /* ek cheez padho */
    get(k, dflt) {
      const o = load();
      return (k in o) ? o[k] : dflt;
    },

    /* ek cheez likho */
    set(k, v) {
      const o = load(); o[k] = v; o.updated = Date.now(); save(o); return v;
    },

    /* yaaddasht me jodo (chat, notes) */
    push(list, item, max) {
      const o = load();
      const arr = Array.isArray(o[list]) ? o[list] : [];
      arr.push({ ...item, at: Date.now() });
      o[list] = arr.slice(-(max || 60));
      o.updated = Date.now();
      save(o);
      return o[list];
    },
    list(list) {
      const o = load();
      return Array.isArray(o[list]) ? o[list] : [];
    },
    clear(list) {
      const o = load();
      if (list) delete o[list]; else Object.keys(o).forEach(k => delete o[k]);
      save(o);
    },

    /* ek hi pehchaan — sab jagah */
    identity() {
      const o = load();
      return o.identity || { name: "Swag", assistant: "Seetal", since: "2026-11-09" };
    },
    setName(n) {
      const o = load();
      o.identity = { ...(o.identity || { name: "Swag", assistant: "Seetal" }), name: n };
      save(o);
    },

    /* kaun si app kab khuli */
    visit(app) {
      const o = load();
      o.visits = o.visits || {};
      o.visits[app] = { at: Date.now(), count: ((o.visits[app] || {}).count || 0) + 1 };
      save(o);
    },
    visits() { return load().visits || {}; },
  };

  window.SeetalCore = Core;
})();
