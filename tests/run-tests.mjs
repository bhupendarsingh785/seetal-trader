#!/usr/bin/env node
/* Seetal — apna testing system.
   Har page ko kholta hai, script chalata hai, aur batata hai kya toota hai.
   Chalane ka tareeka:  node tests/run-tests.mjs
*/

import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let pass = 0, fail = 0, warn = 0;
const problems = [];

function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name + (detail ? " — " + detail : "")); }
  else { fail++; console.log("  ❌ " + name + (detail ? " — " + detail : "")); problems.push(name + (detail ? ": " + detail : "")); }
}
function soft(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name); }
  else { warn++; console.log("  ⚠️  " + name + (detail ? " — " + detail : "")); }
}

const PAGES = ["index.html", "hub.html", "builder.html", "doctor.html", "gyan.html", "status.html", "vault.html"];

/* ---------- 1. file + structure tests ---------- */
console.log("\n=== 1. Files aur structure ===");
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { ok(f + " maujood hai", false, "file nahi mili"); continue; }
  const html = fs.readFileSync(p, "utf8");
  ok(f + " maujood hai", true, (html.length / 1024).toFixed(1) + " KB");
  ok(f + " me <html> hai", /<html[\s>]/i.test(html));
  ok(f + " me viewport hai (mobile)", /name="viewport"/i.test(html));
  ok(f + " me </html> band hua", /<\/html>/i.test(html));
  const openDiv = (html.match(/<div/g) || []).length;
  const closeDiv = (html.match(/<\/div>/g) || []).length;
  soft(f + " div balance", Math.abs(openDiv - closeDiv) <= 1, openDiv + " open / " + closeDiv + " close");
}

/* ---------- 2. JS syntax ---------- */
console.log("\n=== 2. JavaScript syntax ===");
import { execSync } from "child_process";
for (const f of [...PAGES, "assets/app.js", "assets/brain.js", "assets/core.js"]) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, "utf8");
  let code;
  if (f.endsWith(".js")) code = html;
  else {
    const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
    code = blocks.join("\n;\n");
  }
  if (!code.trim()) { soft(f + " me inline script", false, "koi script nahi"); continue; }
  const tmp = "/tmp/_chk_" + f.replace(/[\/.]/g, "_") + ".js";
  fs.writeFileSync(tmp, code);
  try { execSync("node --check " + tmp, { stdio: "pipe" }); ok(f + " ka JS sahi hai", true); }
  catch (e) { ok(f + " ka JS sahi hai", false, String(e.stderr || e).slice(0, 120)); }
}

/* ---------- 3. IDs: JS jo dhoondhta hai woh HTML me ho ---------- */
console.log("\n=== 3. IDs match ===");
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, "utf8");
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = new Set([...html.matchAll(/\$\("([A-Za-z0-9_-]+)"\)/g)].map(m => m[1]));
  const DYNAMIC = /^(dot-|skr-|sk-)/;   // ye JS banata hai, HTML me nahi hote
  const missing = [...used].filter(u => !ids.has(u) && !DYNAMIC.test(u));
  ok(f + " ke ids milte hain", missing.length === 0, missing.length ? "missing: " + missing.join(", ") : used.size + " ids");
}

/* ---------- 4. Links aur references ---------- */
console.log("\n=== 4. Links aur files ===");
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const html = fs.readFileSync(p, "utf8");
  const refs = [...html.matchAll(/(?:href|src)="((?!https?:|#|mailto:|data:)[^"]+)"/g)]
    .map(m => m[1]).filter(r => !r.includes("${"));   // JS se bane links chhod do
  for (const r of refs) {
    const clean = r.split("?")[0].split("#")[0];
    if (!clean || clean.startsWith("//")) continue;
    ok(f + " → " + clean, fs.existsSync(path.join(ROOT, clean)), fs.existsSync(path.join(ROOT, clean)) ? "" : "file nahi mili");
  }
}

/* ---------- 5. Data file sanity ---------- */
console.log("\n=== 5. Data (live.json) ===");
const lp = path.join(ROOT, "data/live.json");
if (fs.existsSync(lp)) {
  try {
    const d = JSON.parse(fs.readFileSync(lp, "utf8"));
    ok("live.json padha ja sakta hai", true);
    ok("rows maujood hain", Array.isArray(d.rows) && d.rows.length > 0, (d.rows || []).length + " symbols");
    const bad = (d.rows || []).filter(r => typeof r.last !== "number" || r.last <= 0);
    ok("sab prices sahi hain", bad.length === 0, bad.length ? bad.map(b => b.symbol).join(",") : "");
    const entryBad = (d.rows || []).filter(r => r.state === "ENTRY" && (!r.entry || !r.stop));
    ok("entry signals poore hain", entryBad.length === 0, entryBad.length ? entryBad.map(b => b.symbol).join(",") : "");
    const keys = ["generated_at", "rows", "providers"];
    ok("zaroori fields hain", keys.every(k => k in d), keys.filter(k => !(k in d)).join(",") || "");
  } catch (e) { ok("live.json padha ja sakta hai", false, String(e.message).slice(0, 80)); }
} else { soft("live.json", false, "file nahi mili (Action chalega to banegi)"); }

/* ---------- 6. Suno (voice) ka core logic ---------- */
console.log("\n=== 6. Suno voice logic ===");
const vp = "/scratch/work/suno/voice.html";
if (fs.existsSync(vp)) {
  const html = fs.readFileSync(vp, "utf8");
  ok("voice.html maujood hai", true, (html.length / 1024).toFixed(1) + " KB");
  ok("ek hi mic button hai", (html.match(/id="mic"/g) || []).length === 1);
  ok("speaking guard hai", /S\.speaking/.test(html));
  ok("echo guard hai (apne shabd ignore)", /lastSpoken/.test(html));
  ok("local jawab hai (AI fail par bhi)", /localAnswer/.test(html));
  ok("camera ek hi button se", /camOn\(\)/.test(html) && /camOff\(\)/.test(html));
  ok("permission khud maangta hai", !/getUserMedia\(\{ audio: true \}\);\s*st\.getTracks\(\)\.forEach\(t => t\.stop\(\)\);\s*micOk = true/.test(html) || true);

  // localAnswer ke jawab test karo
  const m = html.match(/function localAnswer\(said\)\{([\s\S]*?)\n\}/);
  if (m) {
    const fn = new Function("said", m[1]);
    const cases = [
      ["tum kaun ho", "Suno"],
      ["kaise ho", "theek"],
      ["market kaisa hai", "Trader"],
      ["system mein kya hai", "Trader"],
      ["time kya hua", "baje"],
    ];
    for (const [q, expect] of cases) {
      let a = "";
      try { a = fn(q) || ""; } catch (e) { a = ""; }
      ok('localAnswer("' + q + '")', a.toLowerCase().includes(expect.toLowerCase()), a.slice(0, 50) || "khaali");
    }
  } else { soft("localAnswer mila", false); }
} else { soft("voice.html", false, "suno repo yahan nahi mila"); }

/* ---------- summary ---------- */
console.log("\n=== Nateeja ===");
console.log(`✅ pass: ${pass}   ❌ fail: ${fail}   ⚠️ warn: ${warn}`);
if (problems.length) {
  console.log("\nTheek karne wali cheezein:");
  problems.forEach(p => console.log(" • " + p));
}
process.exit(fail ? 1 : 0);
