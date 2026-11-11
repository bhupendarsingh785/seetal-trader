/**
 * Seetal Sync — ek code, sab device par same data.
 *
 * Kaam: browser ke localStorage ki zaroori cheezein Supabase par rakh deta hai,
 * aur doosre device par wahi code daalne se wapas le aata hai.
 *
 * Sach: code hi "chaabi" hai — jo code jaanta hai woh data padh sakta hai.
 * Isliye lamba code rakho aur kisi ko mat batao.
 */
(function () {
  const URL_BASE = "https://urvhrcyuqepzpbklonrz.supabase.co/rest/v1/seetal_sync";
  const KEY = "sb_publishable_R1qExbRPEz5d-8YEpDUc_Q_dSel34jw";
  const LS_CODE = "seetal.synccode";
  const LS_LAST = "seetal.synclast";

  /* kaunsi cheezein sync hongi (localStorage keys) */
  const FIELDS = [
    "notes", "contacts", "mirrors",
    "aiKey", "aiProvider", "aiModel",
    "suno_skills_v1", "suno_memory_v1", "suno_mistakes_v1",
    "seetal.watchlist.v1", "seetal.trades.v1", "seetal.cfg.v1",
    "seetal.boli", "seetal.voiceURI", "seetal.customapis.v1",
    "seetal.apikey.v1",
  ];

  function code() { return (localStorage.getItem(LS_CODE) || "").trim(); }
  function setCode(c) { localStorage.setItem(LS_CODE, String(c || "").trim()); }

  function headers(extra) {
    return Object.assign({
      apikey: KEY,
      Authorization: "Bearer " + KEY,
      "Content-Type": "application/json",
    }, extra || {});
  }

  function collect() {
    const out = {};
    FIELDS.forEach(k => {
      const v = localStorage.getItem(k);
      if (v !== null && v !== "") out[k] = v;
    });
    out.__saved_at = new Date().toISOString();
    return out;
  }

  function apply(data) {
    let n = 0;
    Object.keys(data || {}).forEach(k => {
      if (k === "__saved_at") return;
      if (FIELDS.indexOf(k) === -1) return;
      try { localStorage.setItem(k, data[k]); n++; } catch (e) {}
    });
    return n;
  }

  async function push() {
    const c = code();
    if (!c) return { ok: false, error: "pehle code daalo" };
    const body = { code: c, data: collect(), updated_at: new Date().toISOString() };
    const r = await fetch(URL_BASE + "?on_conflict=code", {
      method: "POST",
      headers: headers({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(body),
    });
    if (!r.ok) return { ok: false, error: "push fail " + r.status + " " + (await r.text()).slice(0, 120) };
    localStorage.setItem(LS_LAST, new Date().toISOString());
    return { ok: true, keys: Object.keys(body.data).length };
  }

  async function pull() {
    const c = code();
    if (!c) return { ok: false, error: "pehle code daalo" };
    const r = await fetch(URL_BASE + "?code=eq." + encodeURIComponent(c) + "&select=data,updated_at", { headers: headers() });
    if (!r.ok) return { ok: false, error: "pull fail " + r.status };
    const rows = await r.json();
    if (!rows || !rows.length) return { ok: false, error: "is code par kuch save nahi hai" };
    const n = apply(rows[0].data);
    return { ok: true, keys: n, updated_at: rows[0].updated_at };
  }

  /* auto: pull on load, phir har 40 second par push (agar code hai) */
  let timer = null;
  async function autoStart() {
    if (!code()) return;
    try { await pull(); } catch (e) {}
    clearInterval(timer);
    timer = setInterval(() => { push().catch(() => {}); }, 40000);
  }

  window.SeetalSync = { code, setCode, push, pull, collect, apply, autoStart, FIELDS };
  if (document.readyState !== "loading") setTimeout(autoStart, 800);
  else document.addEventListener("DOMContentLoaded", () => setTimeout(autoStart, 800));
})();
