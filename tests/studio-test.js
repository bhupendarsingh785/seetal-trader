/**
 * Studio ke button sach me kaam karte hain ya nahi — jsdom se asli test.
 * Chalane ka tareeka: node tests/studio-test.js
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = process.argv[2] || 'studio-v10.html';
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (m) => errors.push(String(m)));

const dom = new JSDOM(fs.readFileSync(FILE, 'utf8'), {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.test/', virtualConsole: vc,
});
const { window } = dom;
const $ = (s) => window.document.querySelector(s);
const click = (el) => { if (!el) return false; el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return true; };
const res = [];
const ok = (n, p, e = '') => { res.push(p); console.log((p ? '✅' : '❌') + ' ' + n + (e ? ' — ' + e : '')); };

setTimeout(() => {
  ok('page load', true);
  ok('＋ button', click($('#bPlus')) && window.document.getElementById('plusSheet').style.display === 'flex');
  click($('#plusClose'));
  ok('＋ panel band', window.document.getElementById('plusSheet').style.display === 'none');
  ok('💬 button', click($('#bAsk')) && window.document.getElementById('askSheet').style.display === 'flex');
  click($('#askClose'));
  ok('📦 button', !!$('#bSeetal'));
  ok('🔌 API button', click($('#brain')) && window.document.getElementById('apiSheet').classList.contains('open'));
  ok('editor', !!$('#code'));
  ok('koi JS error nahi', errors.length === 0, errors.slice(0, 2).join(' | '));

  const pass = res.filter(Boolean).length;
  console.log(`\n=== Nateeja: ${pass}/${res.length} pass ===`);
  process.exit(pass === res.length ? 0 : 1);
}, 700);
