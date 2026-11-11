/**
 * Asli DOM test — jsdom se.
 * Page ka JS chalta hai, buttons dabte hain, aur hum dekhte hain ki DOM sach me badla ya nahi.
 * (Chromium is sandbox me nahi chalta, isliye jsdom.)
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const FILE = process.argv[2] || '/scratch/work/seetal-trader/youme.html';
const html = fs.readFileSync(FILE, 'utf8');

const results = [];
const ok = (name, pass, extra = '') => {
  results.push({ name, pass });
  console.log((pass ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''));
};

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));
vc.on('error', (m) => errors.push(String(m)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://example.test/',
  virtualConsole: vc,
});

const { window } = dom;
const { document } = window;

function click(el) {
  if (!el) return false;
  el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const visible = (id) => {
  const el = document.getElementById(id);
  if (!el) return false;
  return el.classList.contains('on') || window.getComputedStyle(el).display !== 'none';
};

setTimeout(() => {
  try {
    ok('page load', true, FILE.split('/').pop());

    // 1. nav tabs
    for (const t of ['home', 'reels', 'create', 'alerts', 'profile']) {
      const btn = $(`nav button[data-s="${t}"]`);
      if (!click(btn)) { ok(`tab ${t}`, false, 'button nahi mila'); continue; }
      ok(`tab "${t}" khulta hai`, visible(t + 'Screen'));
    }

    // 2. reels filter
    click($('nav button[data-s="reels"]'));
    const big = $('.reel .big');
    const before = big ? big.style.filter : '';
    const cyberBtn = $('[data-f="cyber"]');
    if (cyberBtn) click(cyberBtn);
    const after = $('.reel .big') ? $('.reel .big').style.filter : '';
    ok('reels filter badla', before !== after, `${before || 'none'} → ${after || 'none'}`);

    // 3. DM
    click($('nav button[data-s="home"]'));
    ok('DM button dabta hai', click($('#openDm')) && visible('dmScreen'));

    const chatRow = $('#dmList [data-c="seetal"]');
    ok('chat khulti hai', click(chatRow) && visible('chatScreen'));

    const beforeCount = $$('#chatBody > div').length;
    const inp = $('#chatIn');
    if (inp) inp.value = 'kya haal hai';
    click($('#chatSend'));
    ok('message turant juda', $$('#chatBody > div').length === beforeCount + 1, `${beforeCount} → ${$$('#chatBody > div').length}`);

    // 4. create post
    click($('nav button[data-s="create"]'));
    const ta = $('#postText');
    if (ta) ta.value = 'jsdom test post';
    click($('#doPost'));
    const feed = $('#feed') ? $('#feed').textContent : '';
    ok('post feed me aaya', feed.includes('jsdom test post'));

    // 5. like
    click($('nav button[data-s="home"]'));
    const likeBtn = $('#feed [data-like]');
    const lb = likeBtn ? likeBtn.textContent.trim() : '';
    click(likeBtn);
    const la = $('#feed [data-like]') ? $('#feed [data-like]').textContent.trim() : '';
    ok('like badla', lb !== la, `${lb} → ${la}`);

    // 6. story viewer
    const story = $('.story:not(.add)');
    ok('story viewer khula', click(story) && visible('storyScreen'));
    click($('#storyClose'));

    // 7. wallet
    click($('nav button[data-s="profile"]'));
    const cb = $('#coins').textContent;
    click($('#tipBtn'));
    const ca = $('#coins').textContent;
    ok('wallet coins badhe', cb !== ca, `${cb} → ${ca}`);

    // 8. JS errors
    ok('koi JS error nahi', errors.length === 0, errors.slice(0, 2).join(' | '));

  } catch (e) {
    ok('test crash', false, e.message);
  }

  const pass = results.filter(r => r.pass).length;
  console.log(`\n=== Nateeja: ${pass}/${results.length} pass ===`);
  process.exit(pass === results.length ? 0 : 1);
}, 600);
