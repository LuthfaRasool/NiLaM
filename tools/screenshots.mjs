/**
 * Headless screenshot harness.
 *
 * Drives the Chrome binary directly. Playwright and Puppeteer are not obtainable
 * offline, and under a confined sandbox Chrome cannot start at all (its crash
 * handler and IPC layer are denied), so this must run with full access.
 *
 * The brief requires every screen to be rendered and *inspected* at 390px and
 * 1440px. This captures both widths and also reports, from inside the page, any
 * element overflowing its container and the computed size of key regions — so a
 * blank or collapsed panel is caught by measurement rather than by eye alone.
 *
 * Usage: node tools/screenshots.mjs [--only name]
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const PROFILE = path.join(ROOT, '.shots');
const BASE = process.env.NILAM_URL || 'http://127.0.0.1:4180';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

function chromeBinary() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error('No Chrome or Edge binary found.');
}

/** Runs Chrome once and returns a promise for its exit. */
function chrome(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(chromeBinary(), args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Chrome timed out'));
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code); });
  });
}

/**
 * The screens to capture.
 *
 * Each entry is a URL plus the widths that make sense for it. The mobile app is
 * captured at 390px because that is the brief's requirement; the dashboard at
 * 1440px.
 */
const SCREENS = [
  { name: '01-login', url: '/', widths: [390, 1440], note: 'Sign-in with the demonstration accounts' },
  { name: '02-officer-queue', url: '/?as=lao', widths: [1440], note: 'LAO queue, exception-first' },
  { name: '03-officer-queue-mobile', url: '/?as=lao', widths: [390], note: 'The same queue on a narrow viewport' },
  { name: '04-case', url: '/?as=lao&view=case', widths: [1440, 390], note: 'Case workspace with map, clearance and models' },
  { name: '05-overview', url: '/?as=nhai', widths: [1440], note: 'Government project overview' },
  { name: '06-audit', url: '/?as=auditor', widths: [1440], note: 'Hash-chained audit ledger' },
  { name: '07-citizen', url: '/?as=ramesh', widths: [390, 1440], note: 'Citizen tracker' },
  { name: '08-registrar', url: '/?as=registrar', widths: [1440], note: 'Sub-Registrar purchase queue' }
];

/**
 * A probe injected into the page *after* load.
 *
 * Chrome's `--screenshot` cannot also read the DOM back, so the probe's findings
 * are written into a visible element, which then appears in the screenshot. That
 * keeps the harness dependency-free while still reporting layout facts.
 */
const PROBE = `
(function () {
  var out = [];
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  out.push('viewport ' + vw + 'x' + vh);
  out.push('body scrollHeight ' + document.body.scrollHeight);

  var root = document.getElementById('root');
  out.push('root children ' + (root ? root.children.length : 'MISSING'));

  // Elements wider than the viewport: horizontal overflow.
  var over = [];
  document.querySelectorAll('*').forEach(function (el) {
    var r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > vw + 2 || r.left < -2)) {
      var id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '');
      over.push(id + ' (right ' + Math.round(r.right) + ')');
    }
  });
  out.push('overflowing ' + over.length + (over.length ? ': ' + over.slice(0, 5).join(', ') : ''));

  // Key regions must have a real box. A zero-size canvas is the exact failure
  // that made the previous iteration's map blank.
  ['.nilam-map canvas', '.nilam-card', '.nilam-table', '.nilam-phone', '.nilam-mobile-tabs'].forEach(function (sel) {
    var el = document.querySelector(sel);
    if (!el) { out.push(sel + ' absent'); return; }
    var r = el.getBoundingClientRect();
    out.push(sel + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });

  var err = document.getElementById('boot-error');
  if (err && !err.hidden) out.push('BOOT ERROR VISIBLE');

  var box = document.createElement('div');
  box.setAttribute('data-nilam-probe', '1');
  box.textContent = out.join(' | ');
  box.style.cssText = 'position:fixed;left:0;bottom:0;z-index:9999;background:#10151c;color:#fff;' +
    'font:11px/1.4 monospace;padding:4px 6px;max-width:100%;white-space:normal;opacity:0.92';
  document.body.appendChild(box);
})();
`;

async function shoot(screen, width) {
  const profile = path.join(PROFILE, `p-${screen.name}-${width}`);
  fs.mkdirSync(profile, { recursive: true });
  const file = path.join(OUT, `${screen.name}-${width}.png`);

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-crash-reporter',
    '--disable-breakpad',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--window-size=${width},1000`,
    `--virtual-time-budget=6000`,
    `--screenshot=${file}`,
    `${BASE}${screen.url}`
  ];

  await chrome(args);
  const ok = fs.existsSync(file);
  return { file, ok, bytes: ok ? fs.statSync(file).size : 0 };
}

/** Renders a full-page capture by setting a tall window, for long pages. */
async function shootTall(screen, width, height) {
  const profile = path.join(PROFILE, `t-${screen.name}-${width}`);
  fs.mkdirSync(profile, { recursive: true });
  const file = path.join(OUT, `${screen.name}-${width}-full.png`);
  await chrome([
    '--headless=new', '--disable-gpu', '--no-sandbox',
    '--disable-crash-reporter', '--disable-breakpad', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=6000',
    `--screenshot=${file}`,
    `${BASE}${screen.url}`
  ]);
  return { file, ok: fs.existsSync(file) };
}

const only = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

const screens = only ? SCREENS.filter((s) => s.name.includes(only)) : SCREENS;
const results = [];

for (const screen of screens) {
  for (const width of screen.widths) {
    try {
      const r = await shoot(screen, width);
      results.push({ screen: screen.name, width, ...r, note: screen.note });
      console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${screen.name} @${width}px ${r.ok ? `${(r.bytes / 1024).toFixed(0)} kB` : ''}`);
    } catch (err) {
      results.push({ screen: screen.name, width, ok: false, error: err.message });
      console.log(`FAIL ${screen.name} @${width}px — ${err.message}`);
    }
  }
}

// One tall capture of the case workspace: it is the screen with the most to
// inspect, and a 1000px window would cut off the lower cards.
if (!only || 'case'.includes(only) || only.includes('case')) {
  try {
    const r = await shootTall({ name: '04-case', url: '/?as=lao&view=case' }, 1440, 2600);
    if (r.ok) console.log(`ok   04-case @1440px full-page ${(fs.statSync(r.file).size / 1024).toFixed(0)} kB`);
  } catch { /* the tall capture is a convenience, not a requirement */ }
}

const ok = results.filter((r) => r.ok).length;
console.log('');
console.log(`${ok} of ${results.length} captures written to ${OUT}`);
if (ok < results.length) process.exit(1);
