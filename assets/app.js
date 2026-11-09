/* Seetal Trader — front end (live layer + bolne wala layer).

   Data do tarah se aata hai:
     1) data/live.json — GitHub Action ka snapshot (bharosemand, thoda purana)
     2) browser live    — Yahoo chart API seedha browser se, CORS proxy ke raste,
                          har kuch second. Yeh snapshot ko override karta hai.
   Voice: SpeechRecognition (sunna) + speechSynthesis (bolna). Koi API key nahi.
*/

const SNAP_URL = "data/live.json";
const LS_WATCH = "seetal.watchlist.v1";
const LS_TRADES = "seetal.trades.v1";
const LS_CFG = "seetal.cfg.v1";

const PROXIES = [
  (u) => u,
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?" + encodeURIComponent(u),
  (u) => "https://thingproxy.freeboard.io/fetch/" + u,
];

const state = {
  rows: [],
  providers: {},
  probe: {},
  generatedAt: null,
  lastTick: null,
  liveOn: true,
  interval: 8,
  liveSrc: null,
  capital: 100000,
  maxLoss: 1000,
  seenEntry: new Set(),
};

/* ---------------- chhote helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const nf = (n, d = 2) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n) => (n > 0 ? "+" : "") + nf(n, 2) + "%";
const cls = (n) => (n > 0.0001 ? "up" : n < -0.0001 ? "down" : "flat");
const arrow = (n) => (n > 0.0001 ? "▲" : n < -0.0001 ? "▼" : "•");

function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}
const loadJSON = (k, f) => {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : f;
  } catch {
    return f;
  }
};
const saveJSON = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

/* ---------------- market analysis (python ka JS port) ---------------- */
function analyseChart(symbol, data, src) {
  const res = data && data.chart && data.chart.result;
  if (!res || !res.length) throw new Error("no result");
  const r = res[0];
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const q = ((r.indicators || {}).quote || [{}])[0];
  const O = q.open || [],
    H = q.high || [],
    L = q.low || [],
    C = q.close || [];

  const bars = [];
  for (let i = 0; i < Math.min(ts.length, C.length); i++) {
    if (C[i] === null || C[i] === undefined) continue;
    bars.push({ t: ts[i], o: O[i], h: H[i], l: L[i], c: C[i] });
  }
  if (!bars.length) throw new Error("no bars");

  const last = meta.regularMarketPrice || bars[bars.length - 1].c;
  const prev = meta.chartPreviousClose || meta.previousClose || bars[0].o || bars[0].c;

  const orBars = bars.slice(0, 3);
  const orHigh = Math.max(...orBars.map((b) => b.h || b.c));
  const orLow = Math.min(...orBars.map((b) => b.l || b.c));
  const orMid = (orHigh + orLow) / 2;

  let st = "WAIT",
    entry = null,
    entryTime = null;
  for (let i = 3; i < bars.length; i++) {
    if (bars[i].c > orHigh) {
      st = "ENTRY";
      entry = bars[i].c;
      entryTime = bars[i].t;
      break;
    }
  }
  let stop = Math.round(orMid * 100) / 100;
  let target = null,
    rr = null;
  if (entry) {
    let risk = entry - stop;
    if (risk <= 0) {
      stop = Math.round(orLow * 100) / 100;
      risk = entry - stop;
    }
    if (risk > 0) {
      target = Math.round((entry + 2 * risk) * 100) / 100;
      rr = 2;
    }
  }
  const tail = bars.slice(-6).map((b) => b.c);
  const mom = tail.length > 1 && tail[0] ? ((tail[tail.length - 1] - tail[0]) / tail[0]) * 100 : 0;
  const r2 = (x) => Math.round(x * 100) / 100;

  return {
    symbol,
    name: meta.shortName || symbol,
    currency: meta.currency || "",
    exchange: meta.fullExchangeName || meta.exchangeName || "",
    is_index: /^\^/.test(symbol),
    last: r2(last),
    prev_close: r2(prev),
    change: r2(last - prev),
    change_pct: prev ? r2(((last - prev) / prev) * 100) : 0,
    or_high: r2(orHigh),
    or_low: r2(orLow),
    or_mid: r2(orMid),
    state: st,
    entry: entry ? r2(entry) : null,
    entry_time: entryTime,
    stop,
    target,
    rr,
    distance_points: r2(orHigh - last),
    distance_pct: last ? r2(((orHigh - last) / last) * 100) : 0,
    momentum_pct: Math.round(mom * 1000) / 1000,
    spark: bars.slice(-40).map((b) => r2(b.c)),
    bars: bars.length,
    last_bar_age_sec: Math.floor(Date.now() / 1000) - bars[bars.length - 1].t,
    src,
    has_bars: true,
    stale: false,
    at: Date.now(),
  };
}

async function fetchLive(symbol) {
  const s = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=1d&interval=5m&includePrePost=false`;
  let lastErr = null;
  for (const wrap of PROXIES) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 9000);
      const res = await fetch(wrap(url), { signal: ctl.signal, cache: "no-store" });
      clearTimeout(to);
      if (!res.ok) throw new Error("http " + res.status);
      const j = await res.json();
      return analyseChart(symbol, j, "live");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("live fetch fail");
}

let liveBusy = false;
async function liveRefresh() {
  if (!state.liveOn || liveBusy || document.hidden) return;
  liveBusy = true;
  const targets = state.rows
    .filter((r) => !r.stale)
    .slice(0, 24)
    .map((r) => r.symbol);
  let ok = 0;
  for (const sym of targets) {
    try {
      const row = await fetchLive(sym);
      const i = state.rows.findIndex((r) => r.symbol === sym);
      if (i >= 0) state.rows[i] = row;
      ok++;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  liveBusy = false;
  if (ok) {
    state.lastTick = Date.now();
    state.liveSrc = "live";
    render();
  }
  const dot = $("#srcDot");
  if (dot) dot.className = "dot " + (ok ? "live" : "stale");
}

/* ---------------- snapshot ---------------- */
async function loadSnapshot() {
  const res = await fetch(SNAP_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("snapshot " + res.status);
  const data = await res.json();
  const incoming = data.rows || [];
  const bySym = new Map(incoming.map((r) => [r.symbol, r]));
  // live row ko snapshot purana na kare
  state.rows = state.rows.map((r) => {
    const s = bySym.get(r.symbol);
    if (!s) return r;
    if (r.src === "live" && r.at && s.generated_at === undefined) {
      // live row newer hai — sirf tab badlo jab live purana ho
      if (Date.now() - r.at < 120000) return r;
    }
    return s;
  });
  const have = new Set(state.rows.map((r) => r.symbol));
  incoming.forEach((s) => {
    if (!have.has(s.symbol)) state.rows.push(s);
  });
  state.providers = data.providers || {};
  state.probe = data.probe || {};
  state.generatedAt = data.generated_epoch ? data.generated_epoch * 1000 : Date.now();
  applyWatchlist();
  render();
}

function applyWatchlist() {
  const watch = loadJSON(LS_WATCH, null);
  if (!Array.isArray(watch) || !watch.length) return;
  const have = new Set(state.rows.map((r) => r.symbol));
  watch.forEach((s) => {
    if (!have.has(s)) {
      state.rows.push({
        symbol: s, name: s, last: null, change: 0, change_pct: 0, state: "NODATA",
        or_high: null, or_low: null, momentum_pct: 0, distance_points: null,
        distance_pct: null, spark: [], is_index: false, src: null,
      });
    }
  });
}

function ageText() {
  const t = state.lastTick || state.generatedAt;
  if (!t) return "pata nahi";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return s + " second pehle";
  const m = Math.round(s / 60);
  if (m < 60) return m + " minute pehle";
  return Math.round(m / 60) + " ghante pehle";
}

/* ---------------- render ---------------- */
function render() {
  const live = state.rows.filter((r) => r.last !== null && r.last !== undefined);
  renderStrip(live);
  renderSignalBar(live);
  renderCards(live);
  renderScan(live);
  const dot = $("#srcDot");
  const mins = state.generatedAt ? (Date.now() - state.generatedAt) / 60000 : 999;
  if (dot) dot.className = "dot " + (state.lastTick ? "live" : mins < 12 ? "live" : mins < 60 ? "stale" : "dead");
  const src = $("#srcText");
  if (src) src.textContent = (state.lastTick ? "live · " : "snapshot · ") + ageText();
}

function healthText() {
  const names = {
    "yahoo-q1": "Yahoo", "yahoo-q2": "Yahoo-2", twelvedata: "TwelveData",
    finnhub: "Finnhub", moneycontrol: "Moneycontrol", nse: "NSE",
    stooq: "Stooq", nasdaq: "Nasdaq",
  };
  const bits = Object.entries(state.providers || {}).map(
    ([k, v]) => `${v.ok > 0 ? "✅" : "⚠️"} ${names[k] || k} ${v.ok || 0}`
  );
  if (state.lastTick) bits.unshift("✅ Browser live");
  const bk = Object.entries(state.probe || {})
    .filter(([k]) => !["yahoo-q1", "yahoo-q2"].includes(k))
    .map(([k, v]) => `${v.skipped ? "➖" : v.ok ? "✅" : "❌"} ${names[k] || k}`);
  const line1 = bits.length ? "Sources: " + bits.join(" · ") : "";
  const line2 = bk.length ? "Backup: " + bk.join(" · ") : "";
  return [line1, line2].filter(Boolean).join(" — ");
}

function renderStrip(rows) {
  const idx = rows.filter((r) => r.is_index);
  const wrap = $("#indexStrip");
  if (!wrap) return;
  wrap.innerHTML = idx
    .map(
      (r) => `<div class="idx">
        <div class="n">${r.symbol.replace("^", "")}</div>
        <div class="p ${cls(r.change_pct)}">${nf(r.last)}</div>
        <div class="c ${cls(r.change_pct)}">${arrow(r.change_pct)} ${nf(Math.abs(r.change))} (${pct(r.change_pct)})</div>
      </div>`
    )
    .join("");
}

function renderSignalBar(rows) {
  const bar = $("#signalBar");
  if (!bar) return;
  const ready = rows.filter((r) => r.state === "ENTRY" && !r.is_index);
  const close = rows
    .filter((r) => r.state === "WAIT" && !r.is_index && r.distance_pct !== null)
    .sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
  const up = rows.filter((r) => r.change_pct > 0).length;
  let line;
  if (ready.length) {
    const r = ready[0];
    line = `⚡ <strong>${r.symbol}</strong> range high ke upar close ho gaya — entry ${nf(r.entry)} pe. Stop ${nf(r.stop)}, target ${nf(r.target)}.`;
  } else if (close) {
    line = `⏳ Koi pakki entry nahi. Sabse kareeb <strong>${close.symbol}</strong> — range high ${nf(close.or_high)} se ${nf(Math.abs(close.distance_points))} point (${nf(Math.abs(close.distance_pct))}%) door.`;
  } else {
    line = "⏳ Koi pakki entry nahi. WAIT karo — bar close hone do.";
  }
  const mood = up > rows.length / 2 ? "Market uth raha hai" : up < rows.length / 2 ? "Market gir raha hai" : "Market flat hai";
  bar.innerHTML = `${line}<br><span class="small">${mood} · ${up}/${rows.length} up · ${ageText()}</span><br><span class="small">${healthText()}</span>`;
}

function sparkSVG(vals, up) {
  if (!vals || vals.length < 2) return "";
  const w = 300, h = 34, min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? "#22c55e" : "#ef4444"}" stroke-width="1.6" points="${pts}" /></svg>`;
}

function qtyFor(r) {
  if (r.state !== "ENTRY" || !r.entry || !r.stop) return null;
  const risk = r.entry - r.stop;
  return risk > 0 ? Math.floor(state.maxLoss / risk) : null;
}

function renderCards(rows) {
  const wrap = $("#cards");
  if (!wrap) return;
  wrap.innerHTML = rows
    .filter((r) => !r.is_index)
    .map((r) => {
      const qty = qtyFor(r);
      const mom = r.momentum_pct || 0;
      const badge =
        r.state === "ENTRY"
          ? `<span class="badge entry">ENTRY NOW</span>`
          : r.state === "PRICE_ONLY"
          ? `<span class="badge priceonly">PRICE ONLY</span>`
          : r.state === "NODATA"
          ? `<span class="badge priceonly">DATA NAHI</span>`
          : `<span class="badge wait">WAIT</span>`;
      return `<article class="card ${r.state === "ENTRY" ? "entry" : ""}">
        <div class="hd">
          <div><div class="sym">${r.symbol}</div><div class="nm">${r.name || ""}</div></div>
          ${badge}
        </div>
        <div class="px ${cls(r.change_pct)}">${nf(r.last)}</div>
        <div class="ch ${cls(r.change_pct)}">${arrow(r.change_pct)} ${nf(Math.abs(r.change || 0))} (${pct(r.change_pct)})</div>
        ${sparkSVG(r.spark, r.change_pct >= 0)}
        <div class="kv">
          <div><span>OR high</span><b>${nf(r.or_high)}</b></div>
          <div><span>OR low</span><b>${nf(r.or_low)}</b></div>
          <div><span>Doori</span><b>${r.distance_points === null ? "—" : nf(r.distance_points)}</b></div>
          <div><span>Entry</span><b>${r.entry ? nf(r.entry) : "—"}</b></div>
          <div><span>Stop</span><b>${nf(r.stop)}</b></div>
          <div><span>Target 2R</span><b>${r.target ? nf(r.target) : "—"}</b></div>
          <div><span>Qty (₹${nf(state.maxLoss, 0)})</span><b>${qty === null ? "—" : qty}</b></div>
          <div><span>Momentum</span><b class="${cls(mom)}">${pct(mom)}</b></div>
        </div>
        <div class="mom"><i style="width:${Math.min(100, Math.abs(mom) * 25)}%;background:${mom >= 0 ? "#22c55e" : "#ef4444"}"></i></div>
        <div class="foot">
          <span class="small">${r.state === "ENTRY" ? "Bar close confirm" : r.state === "PRICE_ONLY" ? "Sirf price, bars nahi" : "Bar close ka wait"}${r.src ? " · " + r.src : ""}${r.stale ? " · purana" : ""}</span>
          <button class="speak" data-speak="${r.symbol}" type="button">🔊 Suno</button>
        </div>
      </article>`;
    })
    .join("");
  $$("[data-speak]", wrap).forEach((b) => b.addEventListener("click", () => speakCard(b.getAttribute("data-speak"))));
}

function renderScan(rows) {
  const tb = $("#scanTable tbody");
  if (!tb) return;
  const scored = rows
    .filter((r) => !r.is_index && r.or_high !== null)
    .map((r) => {
      const near = r.distance_pct === null ? 0 : Math.max(-6, 6 - Math.abs(r.distance_pct));
      const score = (r.state === "ENTRY" ? 50 : 0) + near + Math.max(-5, Math.min(5, (r.momentum_pct || 0) * 2));
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  tb.innerHTML = scored
    .map(
      (s, i) => `<tr>
      <td>${i + 1}</td><td class="sym">${s.r.symbol}</td><td>${nf(s.r.last)}</td>
      <td class="${cls(s.r.change_pct)}">${pct(s.r.change_pct)}</td>
      <td>${nf(s.r.or_high)}</td>
      <td class="${cls(-(s.r.distance_points || 0))}">${s.r.distance_points === null ? "—" : nf(s.r.distance_points)}</td>
      <td class="${cls(s.r.momentum_pct)}">${pct(s.r.momentum_pct || 0)}</td>
      <td>${s.r.state === "ENTRY" ? '<span class="badge entry">ENTRY</span>' : '<span class="badge wait">WAIT</span>'}</td>
      <td>${nf(s.score, 1)}</td></tr>`
    )
    .join("");
}

/* ---------------- bolna / sunna ---------------- */
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hi-IN";
    u.rate = 1.0;
    const v = window.speechSynthesis.getVoices().find((x) => /hi[-_]IN/i.test(x.lang));
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  } catch {}
}

function cardText(sym) {
  const r = state.rows.find((x) => x.symbol === sym);
  if (!r) return "Yeh symbol list mein nahi hai.";
  if (r.state === "NODATA") return `${r.symbol} ka data abhi nahi mila.`;
  const dir = r.change_pct > 0 ? "upar" : r.change_pct < 0 ? "neeche" : "flat";
  const base = `${r.symbol}, ${nf(r.last)} pe, ${nf(Math.abs(r.change_pct))} percent ${dir}.`;
  if (r.state === "ENTRY") {
    return `${base} Entry ho gayi ${nf(r.entry)} pe. Stop ${nf(r.stop)}, target ${nf(r.target)}, ${qtyFor(r)} quantity.`;
  }
  if (r.distance_points === null) return base + " Is source se sirf price mila, bars nahi, isliye entry signal nahi.";
  return `${base} Entry abhi nahi hui. Range high ${nf(r.or_high)} se ${nf(Math.abs(r.distance_points))} point door hai. Bar close ka wait karo.`;
}

function speakCard(sym) {
  speak(cardText(sym));
}

function marketSummary() {
  const rows = state.rows.filter((r) => r.last !== null);
  const idx = rows.filter((r) => r.is_index);
  const up = rows.filter((r) => r.change_pct > 0).length;
  const mood = up > rows.length / 2 ? "Market uth raha hai" : up < rows.length / 2 ? "Market gir raha hai" : "Market flat hai";
  const parts = idx.map(
    (r) => `${r.symbol.replace("^", "")} ${nf(r.last)}, ${r.change_pct > 0 ? "upar" : "neeche"} ${nf(Math.abs(r.change_pct))} percent`
  );
  const ready = rows.filter((r) => r.state === "ENTRY" && !r.is_index);
  const tail = ready.length
    ? `Entry signal ${ready.map((r) => r.symbol).join(", ")} mein hai.`
    : "Abhi koi pakki entry nahi, wait karo.";
  return `${mood}. ${parts.join(". ")}. ${tail}`;
}

const SYM_WORDS = {
  "^NSEI": ["nifty", "nifty50", "nifty 50", "निफ्टी", "nifty fifty"],
  "^NSEBANK": ["bank nifty", "banknifty", "बैंक निफ्टी", "banknifty50"],
  "^BSESN": ["sensex", "सेंसेक्स", "bse"],
  "^GSPC": ["s&p", "sp500", "s and p", "एस एंड पी"],
  "^IXIC": ["nasdaq", "नैस्डैक"],
  "RELIANCE.NS": ["reliance", "रिलायंस", "ril"],
  "HDFCBANK.NS": ["hdfc", "एचडीएफसी"],
  "TCS.NS": ["tcs", "टीसीएस"],
  "SBIN.NS": ["sbi", "एसबीआई", "state bank"],
  "INFY.NS": ["infosys", "इन्फोसिस", "infy"],
  "ICICIBANK.NS": ["icici", "आईसीआईसीआई"],
  "BAJFINANCE.NS": ["bajaj", "बजाज"],
  "ADANIENT.NS": ["adani", "अदानी"],
  "ITC.NS": ["itc", "आईटीसी"],
  AAPL: ["apple", "एप्पल", "aapl"],
  TSLA: ["tesla", "टेस्ला"],
  NVDA: ["nvidia", "एनवीडिया"],
  SPY: ["spy", "s p y"],
};

function findSymbol(text) {
  const t = " " + text.toLowerCase().replace(/[.,!?]/g, " ") + " ";
  // sabse lamba match jeeta — "bank nifty" ko "nifty" se pehle pakadna hai
  let best = null;
  let bestLen = 0;
  for (const [sym, words] of Object.entries(SYM_WORDS)) {
    for (const w of words) {
      if (w.length > bestLen && t.includes(w)) {
        best = sym;
        bestLen = w.length;
      }
    }
  }
  if (best) return best;
  const direct = state.rows.find((r) => {
    const base = r.symbol.replace(".NS", "").replace(".BO", "").replace("^", "").toLowerCase();
    return base.length > 2 && t.replace(/\s/g, "").includes(base);
  });
  return direct ? direct.symbol : null;
}

function handleCommand(said) {
  const t = said.toLowerCase();
  toast('Suna: "' + said + '"');
  const sym = findSymbol(t);
  const wantsEntry = /entry|kab.*(lage|lagau|lagana|lena|buy|kharid)|signal|breakout|uth|tez/.test(t);
  const wantsExit = /exit|kab.*(bech|hatana|nikalna|sell)|stop|target|profit|loss/.test(t);
  const wantsMarket = /market|bazaar|bajar|halchal|kaisa|kya chal|scene|mood|sab|poora|overview/.test(t);

  if (sym) {
    const row = state.rows.find((r) => r.symbol === sym);
    if (wantsEntry || wantsExit) return speak(cardText(sym));
    return speak(cardText(sym));
  }
  if (wantsEntry) {
    const ready = state.rows.filter((r) => r.state === "ENTRY" && !r.is_index);
    if (ready.length)
      return speak(`Abhi ${ready.length} entry signal hai. ` + ready.slice(0, 3).map((r) => cardText(r.symbol)).join(" "));
    const near = state.rows
      .filter((r) => r.state === "WAIT" && !r.is_index && r.distance_pct !== null)
      .sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
    return speak(near ? "Koi pakki entry nahi. Sabse kareeb " + cardText(near.symbol) : "Koi pakki entry nahi hai. Wait karo.");
  }
  if (wantsExit) {
    const ready = state.rows.filter((r) => r.state === "ENTRY" && !r.is_index)[0];
    return speak(ready ? cardText(ready.symbol) : "Abhi koi entry nahi hai, isliye stop aur target bhi nahi. Pehle entry ka wait karo.");
  }
  if (wantsMarket || t.trim().split(/\s+/).length > 0) return speak(marketSummary());
  speak(marketSummary());
}

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.createElement("button");
  mic.className = "mic";
  mic.type = "button";
  mic.title = "Bol kar poocho";
  mic.textContent = "🎤";
  document.body.appendChild(mic);

  let listening = false;
  let recognition = null;

  mic.addEventListener("click", () => {
    if (!SR) return toast("Is browser mein voice input nahi — Chrome try karo.");
    if (listening) {
      recognition.stop();
      return;
    }
    recognition = new SR();
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    recognition.onstart = () => {
      listening = true;
      mic.classList.add("on");
      toast("Sun rahi hoon… bolo");
    };
    recognition.onerror = () => {
      listening = false;
      mic.classList.remove("on");
      toast("Sun nahi payi — dobara bolo, ya thoda dheere.");
    };
    recognition.onend = () => {
      listening = false;
      mic.classList.remove("on");
    };
    recognition.onresult = (ev) => {
      const alts = Array.from(ev.results[0]).map((a) => a.transcript || "");
      const best = alts.find((a) => findSymbol(a)) || alts[0] || "";
      handleCommand(best);
    };
    recognition.start();
  });
}

/* ---------------- hisab ---------------- */
const trades = () => loadJSON(LS_TRADES, []);
function saveTrades(t) {
  saveJSON(LS_TRADES, t);
  renderHisab();
}
function renderHisab() {
  const t = trades();
  const pnl = t.reduce((a, x) => a + (x.exit - x.entry) * x.qty, 0);
  const wins = t.filter((x) => x.exit > x.entry).length;
  $("#hTrades").textContent = t.length;
  $("#hWins").textContent = wins;
  $("#hRate").textContent = t.length ? Math.round((wins / t.length) * 100) + "%" : "—";
  const el = $("#hPnl");
  el.textContent = (pnl >= 0 ? "+₹" : "-₹") + nf(Math.abs(pnl), 0);
  el.className = pnl > 0 ? "up" : pnl < 0 ? "down" : "";
  $("#tradeTable tbody").innerHTML = t
    .slice()
    .reverse()
    .map((x, i) => {
      const p = (x.exit - x.entry) * x.qty;
      const idx = t.length - 1 - i;
      return `<tr><td>${x.date}</td><td class="sym">${x.symbol}</td><td>${nf(x.entry)}</td><td>${nf(x.exit)}</td>
        <td>${x.qty}</td><td class="${cls(p)}">${(p >= 0 ? "+" : "") + nf(p, 0)}</td>
        <td><button class="speak" data-del="${idx}" type="button">✕</button></td></tr>`;
    })
    .join("");
  $$("[data-del]").forEach((b) =>
    b.addEventListener("click", () => {
      const t2 = trades();
      t2.splice(Number(b.getAttribute("data-del")), 1);
      saveTrades(t2);
    })
  );
}

/* ---------------- wiring ---------------- */
function init() {
  const cfg = loadJSON(LS_CFG, {});
  if (cfg.capital) $("#capital").value = cfg.capital;
  if (cfg.maxLoss) $("#maxloss").value = cfg.maxLoss;
  state.capital = Number($("#capital").value) || 100000;
  state.maxLoss = Number($("#maxloss").value) || 1000;

  const cfgSave = () => {
    state.capital = Number($("#capital").value) || 0;
    state.maxLoss = Number($("#maxloss").value) || 0;
    saveJSON(LS_CFG, { capital: state.capital, maxLoss: state.maxLoss });
    render();
  };
  $("#capital").addEventListener("change", cfgSave);
  $("#maxloss").addEventListener("change", cfgSave);

  $("#addBtn").addEventListener("click", () => {
    const v = ($("#newSym").value || "").trim().toUpperCase();
    if (!v) return;
    const watch = loadJSON(LS_WATCH, []);
    if (!watch.includes(v)) watch.push(v);
    saveJSON(LS_WATCH, watch);
    $("#newSym").value = "";
    if (!state.rows.some((r) => r.symbol === v)) {
      state.rows.push({
        symbol: v, name: v, last: null, change: 0, change_pct: 0, state: "NODATA",
        or_high: null, or_low: null, momentum_pct: 0, distance_points: null,
        distance_pct: null, spark: [], is_index: false, src: null,
      });
    }
    toast(v + " add ho gaya — live try kar rahi hoon");
    fetchLive(v)
      .then((row) => {
        const i = state.rows.findIndex((r) => r.symbol === v);
        if (i >= 0) state.rows[i] = row;
        state.lastTick = Date.now();
        render();
      })
      .catch(() => toast(v + " ka data nahi aaya abhi"));
  });

  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".tabpane").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("#tab-" + t.dataset.tab).classList.add("active");
    })
  );

  $("#refreshBtn").addEventListener("click", async () => {
    await loadSnapshot().catch(() => {});
    await liveRefresh();
    toast(state.lastTick ? "Live refresh ho gaya" : "Snapshot refresh — live nahi mila");
  });

  const liveToggle = $("#liveToggle");
  if (liveToggle) {
    liveToggle.checked = true;
    liveToggle.addEventListener("change", () => {
      state.liveOn = liveToggle.checked;
      toast(state.liveOn ? "Live on — har kuch second" : "Live off — sirf snapshot");
    });
  }
  const intSel = $("#intervalSel");
  if (intSel) {
    intSel.addEventListener("change", () => {
      state.interval = Number(intSel.value) || 8;
      toast("Refresh: har " + state.interval + " second");
    });
  }

  $("#tradeForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const t = trades();
    t.push({
      date: new Date().toLocaleDateString("en-IN"),
      symbol: $("#tSym").value.trim().toUpperCase(),
      entry: Number($("#tEntry").value),
      exit: Number($("#tExit").value),
      qty: Number($("#tQty").value),
    });
    saveTrades(t);
    e.target.reset();
    toast("Trade likh liya");
  });

  initVoice();
  renderHisab();
  loadSnapshot()
    .then(() => liveRefresh())
    .catch((err) => {
      $("#srcText").textContent = "snapshot nahi mila — " + err.message;
      $("#srcDot").className = "dot dead";
    });

  setInterval(() => loadSnapshot().catch(() => {}), 60000);
  setInterval(() => liveRefresh(), Math.max(5, state.interval) * 1000);
  setInterval(() => {
    const el = $("#tickAge");
    if (el) el.textContent = ageText();
  }, 1000);

  setInterval(() => {
    state.rows
      .filter((r) => r.state === "ENTRY" && !r.is_index)
      .forEach((r) => {
        if (!state.seenEntry.has(r.symbol)) {
          state.seenEntry.add(r.symbol);
          speak(`Dhyan do. ${r.symbol} mein entry signal, ${nf(r.entry)} pe. Stop ${nf(r.stop)}, target ${nf(r.target)}.`);
          toast("🔔 " + r.symbol + " — ENTRY");
        }
      });
  }, 15000);
}

document.addEventListener("DOMContentLoaded", init);
