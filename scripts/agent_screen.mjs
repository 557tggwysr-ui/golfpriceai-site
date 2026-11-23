// Screen recorder for the "sitedemo" video style (content engine, added 20 Nov 2026).
// Opens a golfpriceai.com price page on a phone-sized screen and saves 15 frames a second
// while it scrolls: the price and verdict, the comparison table (cheapest row highlighted),
// then the price-history chart. The Python side (agent_cine.style_sitedemo) puts the frames
// in a phone frame with a headline, taps and the end card.
//
//   node scripts/agent_screen.mjs <url> <out-folder>
// Prints JSON: {"frames": n, "taps": [[time, x, y], ...]} with x, y as 0..1 of the screen.
// SHOPPER_SITE (optional) swaps https://golfpriceai.com for a local copy when testing.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const [url0, out] = process.argv.slice(2);
const SITE = process.env.SHOPPER_SITE || '';
const url = SITE ? url0.replace('https://golfpriceai.com', SITE) : url0;
const CHROME = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 845, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 GolfPriceAI-video');
// no cookie banner in the video (as if the visitor had already answered it)
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('golfpriceai_cookie_consent', 'declined'); } catch (e) { /* fine */ } });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
// House rule: never name retailers in marketing. Shop names on the page become "a UK retailer"
// in the recording only (the live site is untouched).
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let names = [];
try {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'price_pages.py'), 'utf8');
  names = [...src.matchAll(/"awin-[a-z0-9-]+":\s*"([^"]+)"/g)].map((m) => m[1]);
} catch (e) { /* fall back to the list below */ }
names = [...new Set(names.concat(['Clickgolf', 'Click Golf', 'Affordable Golf', 'Major Golf Direct', 'Major Golf', 'Scottsdale Golf', 'Clarkes Golf', 'Callaway Golf Preowned', 'PAYNTR Golf']))]
  .sort((a, b) => b.length - a.length);
await page.evaluate((list) => {
  const rx = new RegExp('\\b(at |from )?(' + list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'g');
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walk.nextNode()) nodes.push(walk.currentNode);
  for (const n of nodes) {
    if (rx.test(n.nodeValue)) { rx.lastIndex = 0; n.nodeValue = n.nodeValue.replace(rx, (m, pre) => (pre === 'at ' ? 'at a ' : pre || '') + 'UK retailer'); }
    rx.lastIndex = 0;
  }
}, names);
// a clean recording: no cookie or alert pop-ups, smooth scrolling under our control
await page.addStyleTag({ content: 'html{scroll-behavior:auto!important} .gp-cookie,.gp-toast,[class*="popup"],[class*="modal"]{display:none!important}' });
await new Promise((r) => setTimeout(r, 800));

const FPS = 15;
let n = 0;
const taps = [];
const snap = async () => { await page.screenshot({ path: path.join(out, `f${String(n).padStart(4, '0')}.png`) }); n += 1; };
const hold = async (sec) => { for (let i = 0; i < sec * FPS; i++) await snap(); };
const y = (sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().top + window.scrollY - 90 : null; }, sel);
const scrollTo = async (target, sec) => {
  const start = await page.evaluate(() => window.scrollY);
  const frames = Math.round(sec * FPS);
  for (let i = 1; i <= frames; i++) {
    const k = i / frames, e = 1 - Math.pow(1 - k, 3);
    await page.evaluate((v) => window.scrollTo(0, v), start + (target - start) * e);
    await snap();
  }
};
const tapAt = async (sel) => {
  const box = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  if (box && box[1] > 80 && box[1] < 780) taps.push([+(n / FPS + 0.6).toFixed(2), +(box[0] / 390).toFixed(3), +(box[1] / 845).toFixed(3)]);
};

await hold(1.4);                                   // the price and verdict
await tapAt('.pp-verdict, .pp-summary');
await hold(0.8);
const table = await y('.pp-table');
if (table !== null) {
  await scrollTo(table, 1.6);                      // the comparison table
  await page.evaluate(() => {                      // highlight the cheapest row
    const r = document.querySelector('.pp-table tbody tr, .pp-table tr:nth-child(2)');
    if (r) { r.style.outline = '4px solid #96ff5a'; r.style.outlineOffset = '-4px'; r.style.transition = 'none'; }
  });
  await tapAt('.pp-table tbody tr, .pp-table tr:nth-child(2)');
  await hold(1.6);
}
const chart = await y('.pp-chart');
if (chart !== null) {
  await scrollTo(chart, 1.6);                      // the price history
  await hold(1.8);
}
await scrollTo(0, 1.0);
await hold(0.6);
await browser.close();
console.log(JSON.stringify({ frames: n, taps }));
