import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(`file://${process.cwd()}/index.html`); await p.evaluate(() => { localStorage.clear(); localStorage.setItem('wildnine-tut', '1'); }); await p.reload();
await new Promise(r => setTimeout(r, 400));
await p.click('.mode[data-m="solo"]'); await new Promise(r => setTimeout(r, 300));
const out = await p.evaluate(async () => {
  const W = window.__wn, E = W.E, sleep = ms => new Promise(r => setTimeout(r, ms));
  const R = {};
  async function ready() { for (let i = 0; i < 400; i++) { const ov = document.querySelector('#ov.show'); if (ov) { const btn = document.querySelector('#ovBox #go, #ovBox #ready, #ovBox #next:not([disabled]), #ovBox .choose'); if (btn) { btn.click(); await sleep(80); continue; } } const S = W.S; if (S.cur && !S.busy && !document.querySelector('#ov.show')) return; await sleep(50); } throw 'never ready'; }
  async function settle() { for (let i = 0; i < 400; i++) { if (!W.S.busy) return; await sleep(30); } }
  await ready();
  const S = () => W.S, sd = () => S().sides[S().cur.side], h = () => S().course.holes[S().h];
  let lastFlags = null; const orig = E.planShot; E.planShot = function (hh, ball, club, ang, pw, flags, rnd, kit) { if (rnd === Math.random) lastFlags = { ...flags }; return orig.apply(this, arguments); };
  function btn(name) { return [...document.querySelectorAll('#cards .card')].find(b => b.querySelector('b').textContent === name); }
  function give(id) { sd().hand = [id]; W.nextTurn ? 0 : 0; document.querySelector('#hStrokes') && (window.__wn.S.busy = false); }
  // render via a harmless toggle: club click re-renders the HUD
  function rerender() { const c = document.querySelector('.club:not([disabled])'); c && c.click(); }
  function shoot(target, pw) { const b = sd().ball, t = target || h().cup; W.takeShot(Math.atan2(t.y - b.y, t.x - b.x), pw); }
  async function tryCard(id, setup, check) {
    try {
      W.jump(0); await ready();
      if (setup) await setup();
      sd().hand = [id]; rerender();
      const el = btn(E.CARDS[id].name);
      const r = { shown: !!el, disabled: el ? el.disabled : null };
      if (el && !el.disabled) el.click();
      const sx = S().sides[0]; r.armed = !!sx.armed[id]; r.flags = Object.keys(sx.holeFlags);
      Object.assign(r, await check(r));
      R[id] = r;
    } catch (e) { R[id] = { error: String(e) }; }
  }
  // 1 mulligan: hit, then undo
  await tryCard('mulligan', async () => { S().club = 'driver'; shoot(null, 0.8); await settle(); }, async () => ({ strokesAfter: sd().strokes, backOnTee: E.dist(sd().ball, h().tee) < 1, handLeft: sd().hand.length }));
  // 2 tailwind
  await tryCard('tailwind', null, async () => { S().club = 'driver'; shoot(null, 0.8); const f = lastFlags; await settle(); return { flagSent: !!f.tailwind, wind: E.windVec(h(), f, S().sides[0].history.at(-1).ball).mph, handLeft: sd().hand.length }; });
  // 3 big stick: compare carry
  await tryCard('bigstick', null, async () => { S().club = 'driver'; const c0 = E.carryFor('driver', 'tee', 1, {}, S().players[0].kit), c1 = E.carryFor('driver', 'tee', 1, { bigstick: true }, S().players[0].kit); shoot(null, 0.8); const f = lastFlags; await settle(); return { flagSent: !!f.bigstick, carryRatio: +(c1 / c0).toFixed(2), handLeft: sd().hand.length }; });
  // 4 laser: does the shot finish where the preview said?
  const miss = [];
  for (let k = 0; k < 12; k++) {
    await tryCard('laser', null, async () => { S().club = k % 2 ? 'driver' : '7i'; if (!S().players[0].bag.includes(S().club) && S().club !== 'driver') S().club = S().players[0].bag[3];
      const b0 = { ...sd().ball }, t = h().cup, ang = Math.atan2(t.y - b0.y, t.x - b0.x), pw = 0.8, P = S().players[0];
      const pl = E.planShot(h(), b0, S().club, ang, pw, { ...sd().holeFlags, laser: true, steady: true }, () => 0.5, P.kit);
      W.takeShot(ang, pw); await settle(); const end = sd().ball; miss.push(+E.dist(end, pl.end || pl.path.at(-1)).toFixed(1)); return { handLeft: sd().hand.length }; });
  }
  R.laser.missYards = miss;
  // 5 steady
  await tryCard('steady', null, async () => { S().club = 'driver'; shoot(null, 1); const f = lastFlags; await settle(); return { flagSent: !!f.steady, handLeft: sd().hand.length }; });
  // 6 still air
  await tryCard('stillair', null, async () => ({ windNow: E.windVec(h(), sd().holeFlags, sd().ball).mph, windText: document.querySelector('#windTxt').textContent, handLeft: sd().hand.length }));
  // 7 sand wizard: put the ball in a bunker first
  let sandHole = -1;
  for (let i = 0; i < 9 && sandHole < 0; i++) if (S().course.holes[i].bunkers.length) sandHole = i;
  await tryCard('sandwizard', async () => { W.jump(sandHole); await ready(); const bk = h().bunkers[0]; sd().ball = { x: bk.x, y: bk.y }; }, async () => ({ lie: E.terrainAt(h(), sd().ball), carryVsFairway: +(E.carryFor(S().players[0].bag[3], 'sand', 1, sd().holeFlags, S().players[0].kit) / E.carryFor(S().players[0].bag[3], 'fairway', 1, {}, S().players[0].kit)).toFixed(2), handLeft: sd().hand.length }));
  // 8 gimme from 8 yards
  await tryCard('gimme', async () => { const c = h().cup; sd().ball = { x: c.x + 8, y: c.y }; }, async () => { const me = S().sides[0]; const hb = S().h; await settle(); await sleep(300); return { holed: me.holed || S().h !== hb, scoreThisHole: me.scores[hb], strokes: me.strokes, handLeft: me.hand.length }; });
  // 9 bounce back: hit into water
  let wi = -1; for (let i = 0; i < 9 && wi < 0; i++) if (S().course.holes[i].water.length) wi = i;
  await tryCard('bounceback', async () => { W.jump(wi); await ready(); }, async () => {
    const H = h(); let tgt = null; const b0 = sd().ball;
    for (let y = 0; y < 640 && !tgt; y += 4) for (let x = 0; x < 400 && !tgt; x += 4) if (E.terrainAt(H, { x, y }) === 'water' && E.dist(b0, { x, y }) < 150) tgt = { x, y };
    if (!tgt) return { note: 'no water in reach' };
    S().club = 'putter'; const P = S().players[0]; let best = null;
    for (const c of P.bag) { const cc = E.carryFor(c, 'tee', 1, {}, P.kit); if (cc >= E.dist(b0, tgt)) best = c; }
    S().club = best || P.bag[0]; const pw = Math.min(1, E.dist(b0, tgt) / E.carryFor(S().club, 'tee', 1, {}, P.kit));
    const sa = { ...sd().armed }; sd().armed.steady = true; shoot(tgt, pw); const f = lastFlags; await settle();
    const lt=E.terrainAt(h(), tgt); return { flagSent: !!f.bounceback, aimedAt: lt, toast: document.querySelector('#toast') ? document.querySelector('#toast').textContent : '', strokes: sd().strokes, handLeft: sd().hand.length };
  });
  return R;
});
console.log(JSON.stringify(out, null, 1)); console.log('errors', errs);
await b.close();
