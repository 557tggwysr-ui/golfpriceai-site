import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`file://${process.cwd()}/index.html`); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('wildnine-tut', '1'); }); await p.reload(); await new Promise(r => setTimeout(r, 400));
const state = () => p.evaluate(() => { const w = JSON.parse(localStorage.getItem('wildnine-wallet') || 'null'); const s = JSON.parse(localStorage.getItem('wildnine-season') || '{}'); return { bal: w && w.bal, earned: w && w.earned, season: s }; });
async function round(label) {
  const before = await state();
  await p.evaluate(() => { const t = document.querySelector('.mode.hero') || document.querySelector('.mode[data-m="solo"]'); t.click(); });
  await new Promise(r => setTimeout(r, 300));
  const res = await p.evaluate(async () => {
    const W = window.__wn, sl = ms => new Promise(r => setTimeout(r, ms)); const official = W.S && W.S.cfg.official;
    for (let g = 0; g < 3000; g++) {
      if (document.querySelector('#ov.show')) {
        if (document.querySelector('#ovBox .award, #ovBox .earn') || /Birdies/.test(document.querySelector('#ovBox').textContent) && document.querySelector('#copy, #shRound')) break;
        const btn = document.querySelector('#ovBox #next:not([disabled]), #ovBox #ready, #ovBox #go, #ovBox .choose, #ovBox #skip, #ovBox .pick');
        if (btn) { btn.click(); await sl(60); continue; } await sl(100); continue;
      }
      const S = W.S; if (!S.cur || S.busy) { await sl(60); continue; }
      if (S.bonus) { W.takeShot(-Math.PI / 2, 0.5); await sl(60); continue; }
      const h = S.course.holes[S.h], E = W.E, sd = S.sides[S.cur.side], P = S.players[S.cur.player];
      const d = E.dist(sd.ball, h.cup), ang = Math.atan2(h.cup.y - sd.ball.y, h.cup.x - sd.ball.x), lie = E.terrainAt(h, sd.ball);
      let pw; if (S.club === 'putter') pw = Math.min(1, (d + 2) / 90 * (h.mod === 'fast' ? 0.72 : 1) * (lie === 'green' ? 1 : 1.6)); else pw = Math.min(0.9, d * 0.93 / E.carryFor(S.club, lie, 1, {}, P.kit));
      W.takeShot(ang, Math.max(0.05, pw)); await sl(40);
    }
    await sl(800);
    const S = W.S, txt = document.querySelector('#ovBox').textContent;
    const m = txt.match(/\+\s?\d+ Birdies[^.]*|\d+ Birdies?[^.]{0,80}/g);
    return { official, toPar: S.sides[0].scores.reduce((a, s, i) => a + s - S.course.holes[i].par, 0), award: S.award, bonus: S.bonusNote || null, shown: m && m.slice(0, 3) };
  });
  const after = await state();
  console.log(label, JSON.stringify(res), '| wallet', before.bal, '->', after.bal, '| earned', before.earned, '->', after.earned, '| season', JSON.stringify(after.season));
  await p.evaluate(() => { const x = document.querySelector('#ovBox #home, #ovBox .home, #ovBox [data-act="home"]'); }); await p.reload(); await new Promise(r => setTimeout(r, 500));
}
await round('1 official');
for (let i = 2; i <= 5; i++) await round(i + ' practice');
console.log('errors', errs);
await b.close();
