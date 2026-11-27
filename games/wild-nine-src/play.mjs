import puppeteer from 'puppeteer-core';
const mode = process.argv[2] || 'solo';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', e => errs.push(e.stack)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`file://${process.cwd()}/index.html`); await p.evaluate(() => localStorage.setItem('wildnine-tut', '1')); await p.reload();
await new Promise(r => setTimeout(r, 300));
if (mode === 'solo') await p.screenshot({ path: `v2-title.png` });
await p.click(`.mode[data-m="${mode}"]`); await new Promise(r => setTimeout(r, 200));
// open real bag and choose a driver + putter model for player 1
await p.evaluate(() => { const d = document.querySelector('details.real'); if (d) d.open = true; });
await p.select('select.model[data-cat="driver"]', await p.$eval('select.model[data-cat="driver"] option:nth-child(3)', o => o.value));
await p.evaluate(() => { const d = document.querySelector('details.real'); if (d) d.open = true; });
if (mode === 'solo') await p.screenshot({ path: `v2-bag.png` });
const shots = {};
const res = await p.evaluate(async (mode) => {
  const W = window.__wn; const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log = []; let snaps = 0;
  for (let guard = 0; guard < 2500; guard++) {
    const ov = document.querySelector('.overlay.show');
    if (ov) {
      const btn = document.querySelector('#next:not([disabled])') || document.querySelector('#ready') || document.querySelector('#go') || document.querySelector('.choose') || document.querySelector('.pick');
      if (document.querySelector('#copy')) break;
      if (btn) { btn.click(); await sleep(60); continue; }
      await sleep(100); continue;
    }
    const S = W.S; if (!S.cur || S.busy) { await sleep(80); continue; }
    const h = S.course.holes[S.h], E = W.E, sd = S.sides[S.cur.side], P = S.players[S.cur.player];
    const d = E.dist(sd.ball, h.cup), ang = Math.atan2(h.cup.y - sd.ball.y, h.cup.x - sd.ball.x), lie = E.terrainAt(h, sd.ball);
    let pw;
    if (S.club === 'putter') pw = Math.min(1, (d + 2) / 90 * (h.mod === 'fast' ? 0.72 : 1) * (lie === 'green' ? 1 : 1.6));
    else pw = Math.min(0.9, d * 0.93 / E.carryFor(S.club, lie, 1, {}, P.kit));
    log.push([S.h, S.cur.player, S.club, Math.round(d), lie, sd.strokes]); W.takeShot(ang + (Math.random() - 0.5) * 0.05, Math.max(0.05, pw * (0.9 + Math.random() * 0.2))); await sleep(40);
  }
  return { log: log.filter(l => l[0] >= 4 && l[0] <= 6), holes: W.S.course.holes.length, scores: W.S.sides.map(s => s.scores), match: W.S.match };
}, mode);
await new Promise(r => setTimeout(r, 300));
await p.screenshot({ path: `v2-end-${mode}.png`, fullPage: false });
console.log(mode, JSON.stringify(res), 'errors', errs);
await b.close();
