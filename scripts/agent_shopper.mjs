// Mystery shopper: every night a real browser walks the site the way a shopper
// does, on a phone-sized screen, and writes down anything broken.
//
// .github/workflows/agent-shopper.yml runs it with the runner's Chrome.
// It visits the homepage, the main pages, a spread of price pages and the
// games, and checks each for:
//   * script errors and failed requests to our own site
//   * images that don't load
//   * layout that spills off a phone screen (sideways scrolling)
//   * a missing title, description, canonical link or main heading
//   * slow pages (over 6 seconds to settle)
// Then it checks a sample of internal links and sitemap entries for 404s.
//
// Output (public, no traffic numbers): data/agents/shopper-report.json.
// The weekly review turns each finding into a fix.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const SITE = process.env.SHOPPER_SITE || 'https://golfpriceai.com';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const OUT = 'data/agents/shopper-report.json';
const MAIN = ['/', '/shop.html', '/clubs.html', '/apparel.html', '/accessories.html', '/prices/', '/prices/drivers/', '/prices/start-golf/',
  '/price-check.html', '/search.html', '/trending.html', '/deal-tools.html', '/build-your-bag.html', '/complete-the-look.html',
  '/play/par-price/', '/play/draft/', '/play/leagues/', '/play/scorecard/', '/play/aces/', '/play/wild-nine/', '/societies/', '/improve/',
  '/fourball/', '/faq.html', '/about.html'];

async function text(url) {
  try { const r = await fetch(url, { redirect: 'follow' }); return r.ok ? await r.text() : ''; } catch { return ''; }
}
async function status(url) {
  try { const r = await fetch(url, { method: 'HEAD', redirect: 'follow' }); return r.status; } catch { return 0; }
}
const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim());
const shuffle = (a, seed) => { let s = seed; return a.map(v => [((s = (s * 9301 + 49297) % 233280) / 233280), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]); };

const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, '')) % 233280;
let sitemap = [];
const index = await text(SITE + '/sitemap.xml');
for (const u of locs(index)) sitemap.push(...(u.endsWith('.xml') ? locs(await text(u)) : [u]));
const prices = sitemap.filter(u => /\/prices\/[^/]+\/$/.test(u));
// Ideas board "mobile-audit" (John, 20 Nov 2026): the 10 most-visited price pages (order only, from the
// performance analyst) get a first-screen check on a phone: the price and a buy button visible without
// scrolling, nothing fixed covering them, and buttons big enough to tap.
let top = [];
try { top = (JSON.parse(fs.readFileSync('data/agents/performance.json', 'utf8')).topPages || []).slice(0, 10); } catch { /* not yet */ }
if (!top.length) top = shuffle(prices, seed).slice(0, 5).map(u => u.replace(SITE, ''));
const topUrls = top.map(p => SITE + p);
const pages = [...new Set([...topUrls, ...MAIN.map(p => SITE + p), ...shuffle(prices, seed).slice(0, 20), ...shuffle(sitemap.filter(u => !prices.includes(u)), seed).slice(0, 15)])];

const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const findings = [];
const internal = new Set();
for (const url of pages) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 GolfPriceAI-shopper');
  const errs = [], failed = [];
  page.on('pageerror', e => errs.push(String(e.message).slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|analytics|gtag|consent|Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  page.on('response', r => { if (r.url().startsWith(SITE) && r.status() >= 400) failed.push(`${r.status()} ${r.url().replace(SITE, '')}`); });
  const t0 = Date.now();
  let status0 = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    status0 = resp ? resp.status() : 0;
  } catch (e) { errs.push('did not finish loading: ' + e.message.slice(0, 80)); }
  const ms = Date.now() - t0;
  const info = await page.evaluate(() => {
    const brokenImgs = [...document.images].filter(i => i.complete && i.naturalWidth === 0 && i.src && !i.src.startsWith('data:')).map(i => i.src).slice(0, 5);
    const over = document.documentElement.scrollWidth > window.innerWidth + 2;
    const links = [...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith(location.origin)).map(h => h.split('#')[0]);
    return {
      title: document.title.trim(), desc: (document.querySelector('meta[name="description"]') || {}).content || '',
      canonical: !!document.querySelector('link[rel="canonical"]'), h1: document.querySelectorAll('h1').length,
      brokenImgs, over, links: [...new Set(links)],
    };
  }).catch(() => ({ title: '', desc: '', canonical: false, h1: 0, brokenImgs: [], over: false, links: [] }));
  info.links.forEach(l => internal.add(l));
  let fold = null;
  if (topUrls.includes(url)) {
    fold = await page.evaluate(() => {
      const H = window.innerHeight, out = [];
      const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' ? r : null; };
      const buy = [...document.querySelectorAll('.pp-ctas .pp-btn, a[href*="awin1.com"]')].map(el => [el, vis(el)]).filter(x => x[1]);
      const first = buy.find(x => x[1].top >= 0 && x[1].bottom <= H);
      if (!buy.length) out.push('no buy button found');
      else if (!first) out.push(`buy button not visible without scrolling (first one starts ${Math.round(buy[0][1].top)}px down; the screen is ${H}px)`);
      if (first) {
        const r = first[1];
        if (r.height < 40) out.push(`buy button only ${Math.round(r.height)}px tall (44px is comfortable to tap)`);
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2, hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== first[0] && !first[0].contains(hit)) out.push(`something covers the buy button (${(hit.className || hit.tagName).toString().slice(0, 40)})`);
      }
      const price = [...document.querySelectorAll('body *')].find(el => el.children.length === 0 && /£\s?\d/.test(el.textContent) && vis(el) && vis(el).top < H);
      if (!price) out.push('no price visible on the first screen');
      return out;
    }).catch(() => []);
  }
  const problems = [];
  if (status0 >= 400) problems.push(`page returns ${status0}`);
  if (errs.length) problems.push(`script errors: ${[...new Set(errs)].slice(0, 3).join(' | ')}`);
  if (failed.length) problems.push(`failed requests: ${[...new Set(failed)].slice(0, 4).join(', ')}`);
  if (info.brokenImgs.length) problems.push(`${info.brokenImgs.length} image(s) not loading`);
  if (info.over) problems.push('spills sideways on a phone');
  if (!info.title) problems.push('no title');
  if (!info.desc) problems.push('no meta description');
  if (!info.canonical) problems.push('no canonical link');
  if (info.h1 !== 1) problems.push(`${info.h1} main headings (should be 1)`);
  if (ms > 6000) problems.push(`slow: ${(ms / 1000).toFixed(1)}s`);
  if (fold && fold.length) problems.push(...fold.map(x => 'first screen (top page): ' + x));
  if (topUrls.includes(url) && ms > 3500) problems.push(`top page slower than 3.5s on a phone: ${(ms / 1000).toFixed(1)}s`);
  if (problems.length) findings.push({ page: url.replace(SITE, '') || '/', problems });
  await page.close();
}
await browser.close();

const linkSample = shuffle([...internal].filter(u => !pages.includes(u)), seed).slice(0, 150);
const deadLinks = [];
for (const u of linkSample) { const s = await status(u); if (s >= 400 || s === 0) deadLinks.push(`${s} ${u.replace(SITE, '')}`); }
const mapSample = shuffle(sitemap, seed + 1).slice(0, 100);
const deadInSitemap = [];
for (const u of mapSample) { const s = await status(u); if (s >= 400 || s === 0) deadInSitemap.push(`${s} ${u.replace(SITE, '')}`); }

const report = {
  generated: new Date().toISOString().slice(0, 16) + 'Z',
  about: 'Mystery shopper: a phone-sized browser walks the site each night and notes anything broken.',
  pagesChecked: pages.length, pagesWithProblems: findings.length, findings, topPagesChecked: topUrls.length,
  internalLinksChecked: linkSample.length, deadLinks,
  sitemapUrls: sitemap.length, sitemapChecked: mapSample.length, deadInSitemap,
  status: findings.length || deadLinks.length || deadInSitemap.length ? 'attention' : 'ok',
};
fs.mkdirSync('data/agents', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ pages: pages.length, problems: findings.length, deadLinks: deadLinks.length, deadInSitemap: deadInSitemap.length }));
