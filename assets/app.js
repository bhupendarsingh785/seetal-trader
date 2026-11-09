/* Seetal Trader — front end.
   Data: data/live.json (GitHub Action snapshot) + optional live browser fetch.
   Voice: browser SpeechRecognition (sunna) + speechSynthesis (bolna). No API key. */

const SNAP_URL = "data/live.json";
const LS_WATCH = "seetal.watchlist.v1";
const LS_TRADES = "seetal.trades.v1";
const LS_CFG = "seetal.cfg.v1";

const state = {
  rows: [],
  providers: {},
  generatedAt: null,
  source: "snapshot",
  capital: 100000,
  maxLoss: 1000,
  speaking: true,
  seenEntry: new Set(),
};

/* ---------------- helpers ---------------- */
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

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch {}
}

/* ---------------- data ---------------- */
async function loadSnapshot() {
  const res = await fetch(SNAP_URL + "?t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("snapshot " + res.status);
  const data = await res.json();
  state.rows = data.rows || [];
  state.providers = data.providers || {};
  state.generatedAt = data.generated_epoch ? data.generated_epoch * 1000 : Date.now();
  state.source = "snapshot";
  applyWatchlistFilter();
  render();
}

function applyWatchlistFilter() {
  const watch = loadJSON(LS_WATCH, null);
  if (!Array.isArray(watch) || !watch.length) return;
  const have = new Set(state.rows.map((r) => r.symbol));
  watch.forEach((s) => {
    if (!have.has(s)) {
      state.rows.push({
        symbol: s,
        name: s,
        last: null,
        change_pct: 0,
        change: 0,
        state: "NODATA",
        or_high: null,
        or_low: null,
        or_mid: null,
        momentum_pct: 0,
        distance_points: null,
        distance_pct: null,
        spark: [],
        is_index: false,
      });
    }
  });
  const order = new Map(watch.map((s, i) => [s, i]));
  state.rows.sort((a, b) => {
    const ai = order.has(a.symbol) ? order.get(a.symbol) : 999 + (a.is_index ? -1 : 0);
    const bi = order.has(b.symbol) ? order.get(b.symbol) : 999 + (b.is_index ? -1 : 0);
    return ai - bi;
  });
}

function ageText() {
  if (!state.generatedAt) return "pata nahi";
  const s = Math.max(0, Math.round((Date.now() - state.generatedAt) / 1000));
  if (s < 60) return s + " second pehle";
  const m = Math.round(s / 60);
  if (m < 60) return m + " minute pehle";
  const h = Math.round(m / 60);
  if (h < 24) return h + " ghante pehle";
  return Math.round(h / 24) + " din pehle";
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
  dot.className = "dot " + (mins < 12 ? "live" : mins < 60 ? "stale" : "dead");
  $("#srcText").textContent = "aakhri update: " + ageText() + (state.source === "live" ? " · browser live" : "");
}

function renderStrip(rows) {
  const idx = rows.filter((r) => r.is_index);
  const wrap = $("#indexStrip");
  if (!idx.length) {
    wrap.innerHTML = "";
    return;
  }
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

function healthText() {
  const names = { "yahoo-q1": "Yahoo", "yahoo-q2": "Yahoo-2", moneycontrol: "Moneycontrol", stooq: "Stooq" };
  const bits = Object.entries(state.providers || {}).map(([k, v]) => {
    const ok = v.ok > 0;
    return `${ok ? "✅" : "⚠️"} ${names[k] || k} ${ok ? v.ok : 0}`;
  });
  return bits.length ? "Sources: " + bits.join(" · ") : "";
}

function renderSignalBar(rows) {
  const ready = rows.filter((r) => r.state === "ENTRY" && !r.is_index);
  const close = rows
    .filter((r) => r.state === "WAIT" && !r.is_index && r.distance_pct !== null)
    .sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
  const up = rows.filter((r) => r.change_pct > 0).length;
  const bar = $("#signalBar");

  let line = "";
  if (ready.length) {
    const r = ready[0];
    line = `⚡ <strong>${r.symbol}</strong> range high ke upar close ho gaya — entry ${nf(r.entry)} pe hai. Stop ${nf(r.stop)}, target ${nf(r.target)}.`;
  } else if (close) {
    line = `⏳ Abhi koi pakki entry nahi. Sabse kareeb <strong>${close.symbol}</strong> hai — range high ${nf(close.or_high)} se ${nf(Math.abs(close.distance_points))} point (${nf(Math.abs(close.distance_pct))}%) door.`;
  } else {
    line = "⏳ Abhi koi pakki entry nahi. WAIT karo — bar close hone do.";
  }
  const mood = up > rows.length / 2 ? "Market uth raha hai" : up < rows.length / 2 ? "Market gir raha hai" : "Market flat hai";
  bar.innerHTML = `${line}<br><span class="small">${mood} · ${up}/${rows.length} up · ${ageText()}</span><br><span class="small">${healthText()}</span>`;
}

function sparkSVG(vals, up) {
  if (!vals || vals.length < 2) return "";
  const w = 300,
    h = 34,
    min = Math.min(...vals),
    max = Math.max(...vals),
    span = max - min || 1;
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`)
    .join(" ");
  const col = up ? "#22c55e" : "#ef4444";
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline fill="none" stroke="${col}" stroke-width="1.6" points="${pts}" />
  </svg>`;
}

function qtyFor(r) {
  if (r.state !== "ENTRY" || !r.entry || !r.stop) return null;
  const risk = r.entry - r.stop;
  if (risk <= 0) return null;
  return Math.floor(state.maxLoss / risk);
}

function renderCards(rows) {
  const wrap = $("#cards");
  const list = rows.filter((r) => !r.is_index);
  wrap.innerHTML = list
    .map((r) => {
      const qty = qtyFor(r);
      const mom = r.momentum_pct || 0;
      const momW = Math.min(100, Math.abs(mom) * 25);
      const momCol = mom >= 0 ? "#22c55e" : "#ef4444";
      const badge =
        r.state === "ENTRY"
          ? `<span class="badge entry">ENTRY NOW</span>`
          : r.state === "PRICE_ONLY"
          ? `<span class="badge priceonly">PRICE ONLY</span>`
          : `<span class="badge wait">WAIT</span>`;
      return `<article class="card ${r.state === "ENTRY" ? "entry" : ""}">
        <div class="hd">
          <div>
            <div class="sym">${r.symbol}</div>
            <div class="nm">${r.name || ""}</div>
          </div>
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
          <div><span>Qty (₹${nf(state.maxLoss, 0)} risk)</span><b>${qty === null ? "—" : qty}</b></div>
          <div><span>Momentum</span><b class="${cls(mom)}">${pct(mom)}</b></div>
        </div>
        <div class="mom"><i style="width:${momW}%;background:${momCol}"></i></div>
        <div class="foot">
          <span class="small">${r.state === "ENTRY" ? "Bar close confirm hua" : r.state === "PRICE_ONLY" ? "Sirf price mila, bars nahi" : "Bar close ka wait"}${r.src ? " · " + r.src : ""}${r.stale ? " · purana" : ""}</span>
          <button class="speak" data-speak="${r.symbol}" type="button">🔊 Suno</button>
        </div>
      </article>`;
    })
    .join("");
  $$("[data-speak]", wrap).forEach((b) =>
    b.addEventListener("click", () => speakCard(b.getAttribute("data-speak")))
  );
}

function renderScan(rows) {
  const scored = rows
    .filter((r) => !r.is_index && r.or_high !== null)
    .map((r) => {
      const near = r.distance_pct === null ? 0 : Math.max(-6, 6 - Math.abs(r.distance_pct));
      const score = (r.state === "ENTRY" ? 50 : 0) + near + Math.max(-5, Math.min(5, (r.momentum_pct || 0) * 2));
      return { r, score };
    })
    .sort((a, b) => b.score - a.score);
  const tb = $("#scanTable tbody");
  tb.innerHTML = scored
    .map(
      (s, i) => `<tr>
      <td>${i + 1}</td>
      <td class="sym">${s.r.symbol}</td>
      <td>${nf(s.r.last)}</td>
      <td class="${cls(s.r.change_pct)}">${pct(s.r.change_pct)}</td>
      <td>${nf(s.r.or_high)}</td>
      <td class="${cls(-(s.r.distance_points || 0))}">${s.r.distance_points === null ? "—" : nf(s.r.distance_points)}</td>
      <td class="${cls(s.r.momentum_pct)}">${pct(s.r.momentum_pct || 0)}</td>
      <td>${s.r.state === "ENTRY" ? '<span class="badge entry">ENTRY</span>' : '<span class="badge wait">WAIT</span>'}</td>
      <td>${nf(s.score, 1)}</td>
    </tr>`
    )
    .join("");
}

/* ---------------- voice ---------------- */
let recognition = null;
let listening = false;

function speak(text) {
  if (!state.speaking || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "hi-IN";
    u.rate = 1.0;
    u.pitch = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const hi = voices.find((v) => /hi[-_]IN/i.test(v.lang)) || voices.find((v) => /en[-_]IN/i.test(v.lang));
    if (hi) u.voice = hi;
    window.speechSynthesis.speak(u);
  } catch {}
}

function cardText(sym) {
  const r = state.rows.find((x) => x.symbol === sym);
  if (!r) return "Yeh symbol nahi mila.";
  const dir = r.change_pct > 0 ? "upar" : r.change_pct < 0 ? "neeche" : "flat";
  if (r.state === "ENTRY") {
    return `${r.symbol}. ${nf(r.last)} pe chal raha hai, ${nf(Math.abs(r.change_pct))} percent ${dir}. Entry ho gayi ${nf(r.entry)} pe. Stop ${nf(r.stop)}, target ${nf(r.target)}. ${state.maxLoss} rupaye risk pe ${qtyFor(r)} quantity.`;
  }
  if (r.state === "PRICE_ONLY" || r.distance_points === null) {
    return `${r.symbol}. ${nf(r.last)} pe chal raha hai, ${nf(Math.abs(r.change_pct))} percent ${dir}. Is source se sirf price mila, bars nahi, isliye entry ka signal abhi nahi hai.`;
  }
  const d = `Range high se ${nf(Math.abs(r.distance_points))} point door hai.`;
  return `${r.symbol}. ${nf(r.last)} pe chal raha hai, ${nf(Math.abs(r.change_pct))} percent ${dir}. Entry abhi nahi hui. ${d} Bar close ka wait karo.`;
}

function speakCard(sym) {
  speak(cardText(sym));
}

function speakMarket() {
  const rows = state.rows.filter((r) => r.is_index);
  if (!rows.length) return speak("Index data abhi nahi mila.");
  const bits = rows.map(
    (r) => `${r.symbol.replace("^", "")} ${nf(r.last)} pe, ${r.change_pct > 0 ? "upar" : "neeche"} ${nf(Math.abs(r.change_pct))} percent`
  );
  const ready = state.rows.filter((r) => r.state === "ENTRY" && !r.is_index);
  const tail = ready.length
    ? `Entry signal ${ready.map((r) => r.symbol).join(", ")} mein hai.`
    : "Abhi koi pakki entry nahi hai, wait karo.";
  speak(bits.join(". ") + ". " + tail);
}

function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = document.createElement("button");
  mic.className = "mic";
  mic.type = "button";
  mic.title = "Bol kar poocho";
  mic.textContent = "🎤";
  document.body.appendChild(mic);

  mic.addEventListener("click", () => {
    if (!SR) {
      toast("Is browser mein voice input nahi hai — Chrome try karo.");
      return;
    }
    if (listening) {
      recognition.stop();
      return;
    }
    recognition = new SR();
    recognition.lang = "hi-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      listening = true;
      mic.classList.add("on");
      toast("Bol rahi hoon… sun rahi hoon");
    };
    recognition.onerror = () => {
      listening = false;
      mic.classList.remove("on");
      toast("Sun nahi payi, dobara bolo.");
    };
    recognition.onend = () => {
      listening = false;
      mic.classList.remove("on");
    };
    recognition.onresult = (ev) => {
      const said = (ev.results[0][0].transcript || "").toLowerCase().trim();
      handleCommand(said);
    };
    recognition.start();
  });

  if ("speechSynthesis" in window) {
    window.speechSynthesis.onvoiceschanged = () => {};
  }
}

function handleCommand(said) {
  toast('Suna: "' + said + '"');
  const rows = state.rows;
  const hit = rows.find((r) => {
    const base = r.symbol.replace(".NS", "").replace(".BO", "").replace("^", "").toLowerCase();
    return base && said.replace(/\s/g, "").includes(base);
  });

  if (/market|nifty|sensex|bazaar|bajar|halchal/.test(said)) return speakMarket();
  if (/entry|kab|signal|lage|lagau|lagana/.test(said)) {
    const ready = rows.filter((r) => r.state === "ENTRY" && !r.is_index);
    if (ready.length) {
      return speak(
        `Abhi ${ready.length} entry signal hai. ` + ready.slice(0, 3).map((r) => cardText(r.symbol)).join(" ")
      );
    }
    const near = rows
      .filter((r) => r.state === "WAIT" && !r.is_index && r.distance_pct !== null)
      .sort((a, b) => Math.abs(a.distance_pct) - Math.abs(b.distance_pct))[0];
    return speak(near ? `Koi pakki entry nahi. Sabse kareeb ${cardText(near.symbol)}` : "Abhi koi pakki entry nahi hai. Wait karo.");
  }
  if (hit) return speak(cardText(hit.symbol));
  if (/stop|target|hatana|nikalna/.test(said)) {
    const ready = rows.filter((r) => r.state === "ENTRY" && !r.is_index)[0];
    return speak(ready ? cardText(ready.symbol) : "Abhi koi trade khuli nahi hai, isliye stop aur target nahi hai.");
  }
  speak("Samajh nahi aayi. Aise poocho: market kaisa hai, ya Reliance kaisa hai.");
}

/* ---------------- hisab ---------------- */
function trades() {
  return loadJSON(LS_TRADES, []);
}
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
      return `<tr>
        <td>${x.date}</td><td class="sym">${x.symbol}</td><td>${nf(x.entry)}</td><td>${nf(x.exit)}</td>
        <td>${x.qty}</td><td class="${cls(p)}">${(p >= 0 ? "+" : "") + nf(p, 0)}</td>
        <td><button class="speak" data-del="${idx}" type="button">✕</button></td>
      </tr>`;
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
    toast(v + " watchlist mein add ho gaya — agle update par data aayega.");
    if (!state.rows.some((r) => r.symbol === v)) {
      state.rows.push({
        symbol: v, name: v, last: null, change: 0, change_pct: 0, state: "NODATA",
        or_high: null, or_low: null, momentum_pct: 0, distance_points: null, distance_pct: null, spark: [], is_index: false,
      });
      render();
    }
  });

  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      $$(".tabpane").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $("#tab-" + t.dataset.tab).classList.add("active");
    })
  );

  $("#refreshBtn").addEventListener("click", () => {
    loadSnapshot()
      .then(() => toast("Refresh ho gaya"))
      .catch(() => toast("Data nahi aaya — net check karo"));
  });

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
  loadSnapshot().catch((err) => {
    $("#srcText").textContent = "data nahi mila — " + err.message;
    $("#srcDot").className = "dot dead";
  });

  setInterval(() => {
    loadSnapshot().catch(() => {});
  }, 60000);
  setInterval(render, 15000);

  // bol kar batao: jab naya ENTRY signal aaye
  setInterval(() => {
    const ready = state.rows.filter((r) => r.state === "ENTRY" && !r.is_index);
    ready.forEach((r) => {
      if (!state.seenEntry.has(r.symbol)) {
        state.seenEntry.add(r.symbol);
        speak(`Dhyan do. ${r.symbol} mein entry signal aaya hai, ${nf(r.entry)} pe. Stop ${nf(r.stop)}, target ${nf(r.target)}.`);
        toast("🔔 " + r.symbol + " — ENTRY signal");
      }
    });
  }, 20000);
}

document.addEventListener("DOMContentLoaded", init);
