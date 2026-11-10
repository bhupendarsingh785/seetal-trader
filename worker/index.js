/**
 * Seetal API — Cloudflare Worker
 * Kaam: live data ko ek saaf API ki tarah dena (CORS ke saath),
 * aur system ki sehat batana. Data GitHub se aata hai.
 */
const DATA_URL = "https://raw.githubusercontent.com/bhupendarsingh785/seetal-trader/main/data/live.json";
const CACHE_SECONDS = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 1), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

async function getLive() {
  const r = await fetch(DATA_URL, { cf: { cacheTtl: CACHE_SECONDS } });
  if (!r.ok) throw new Error("live.json " + r.status);
  return r.json();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    try {
      if (url.pathname === "/" || url.pathname === "/health") {
        return json({
          ok: true,
          name: "seetal-api",
          time: new Date().toISOString(),
          routes: ["/health", "/live", "/status", "/symbol/RELIANCE"],
        });
      }

      if (url.pathname === "/live") {
        const d = await getLive();
        return json({ ok: true, data: d });
      }

      if (url.pathname === "/status") {
        const d = await getLive();
        const gen = d.generated_at || d.ts || null;
        let ageMin = null;
        if (gen) ageMin = Math.round((Date.now() - new Date(gen).getTime()) / 60000);
        const rows = d.symbols || d.data || d.rows || [];
        const n = Array.isArray(rows) ? rows.length : Object.keys(rows || {}).length;
        return json({
          ok: ageMin !== null && ageMin < 45 && n >= 3,
          generated_at: gen,
          age_minutes: ageMin,
          symbols: n,
          checked_at: new Date().toISOString(),
        });
      }

      if (url.pathname.startsWith("/symbol/")) {
        const sym = decodeURIComponent(url.pathname.split("/")[2] || "").toUpperCase();
        const d = await getLive();
        const rows = d.symbols || d.data || d.rows || {};
        const found = Array.isArray(rows)
          ? rows.find((x) => String(x.symbol || x.s || "").toUpperCase() === sym)
          : rows[sym];
        if (!found) return json({ ok: false, error: "symbol nahi mila", symbol: sym }, 404);
        return json({ ok: true, symbol: sym, data: found });
      }

      return json({ ok: false, error: "route nahi mila" }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
