// Wild Nine: how much do caddie cards lower a score? Plays whole rounds with a sensible bot.
import './engine.js';
const E = globalThis.WildNine;
const bag = E.DEFAULT_BAG, kit = { ball: 'soft', tech: 'rangefinder' };
const RULES = JSON.parse(process.argv[2] || '{}');  // {drafts:[holes after which you draft], hand:max, start:true, locker:true, laserExact:true}
const drafts = RULES.drafts || [0,1,2,3,4,5,6,7], HAND = RULES.hand || 4;
function clear(h, a, b) { for (let i = 1; i < 30; i++) { const p = { x: a.x + (b.x - a.x) * i / 30, y: a.y + (b.y - a.y) * i / 30 }; if (h.trees.some(t => E.dist(t, p) < t.r + 2)) return false; } const t = E.terrainAt(h, b); return t !== 'water' && t !== 'ob'; }
function plan(h, ball, flags) {
  const lie = E.terrainAt(h, ball);
  if (lie === 'green' || E.dist(ball, h.cup) < 14) return { club: 'putter', target: h.cup };
  const clubs = E.BAG_ORDER.filter(c => bag.includes(c) && !(c === 'driver' && lie !== 'tee'));
  const maxReach = E.carryFor(clubs[0], lie, 0.88, flags, kit);
  const cands = [h.cup];
  for (let i = h.fair.length - 1; i > 0; i--) { const a = h.fair[i - 1], b = h.fair[i]; for (let t = 1; t >= 0; t -= 0.1) cands.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
  for (const c of cands) { const d = E.dist(ball, c); if (d > maxReach * 1.05) continue; if (E.dist(c, h.cup) >= E.dist(ball, h.cup) - 5) continue; if (c !== h.cup && !clear(h, ball, c)) continue; if (c === h.cup && !clear(h, ball, c) && d > 60) continue; return { target: c }; }
  return { target: h.cup };
}
function shot(h, ball, flags, rnd) {
  const p = plan(h, ball, flags), lie = E.terrainAt(h, ball), ang = Math.atan2(p.target.y - ball.y, p.target.x - ball.x), d = E.dist(ball, p.target);
  let club = p.club, pw;
  if (club === 'putter') pw = Math.min(1, (d + 2) / (90 * (lie === 'green' ? 1 : 0.6)) * (h.mod === 'fast' ? 0.72 : 1) * (lie === 'green' ? 1 : 1.4));
  else { const clubs = E.BAG_ORDER.filter(c => bag.includes(c) && !(c === 'driver' && lie !== 'tee')); const ok = clubs.filter(c => E.carryFor(c, lie, 0.88, flags, kit) >= d * 0.95); club = ok.length ? ok[ok.length - 1] : clubs[0]; pw = Math.min(0.88, d * 0.93 / E.carryFor(club, lie, 1, flags, kit)); }
  return E.planShot(h, ball, club, ang, Math.max(0.05, pw), flags, rnd, kit);
}
const PRI = ['laser', 'mulligan', 'gimme', 'steady', 'bounceback', 'stillair', 'sandwizard', 'bigstick', 'tailwind'];
function playRound(seed, useCards) {
  const c = E.makeCourse(seed), rnd = E.mulberry32(seed * 31 + 7);
  let hand = useCards && RULES.start !== false ? [c.startCard] : [];
  if (useCards && RULES.locker) hand.push('laser');
  let total = 0, used = 0;
  c.holes.forEach((h, hi) => {
    let ball = { ...h.tee }, s = 0; const hf = {};
    const take = id => { const i = hand.indexOf(id); if (i >= 0 && useCards) { hand.splice(i, 1); used++; return true; } return false; };
    if (h.wind.mph >= 10 && take('stillair')) hf.stillair = true;
    while (s < 12) {
      const lie = E.terrainAt(h, ball), d = E.dist(ball, h.cup);
      if (d <= 10 && lie !== 'green' || (d <= 10 && d > 3)) { if (take('gimme')) { s++; break; } }
      if (lie === 'sand' && !hf.sandwizard && take('sandwizard')) hf.sandwizard = true;
      const flags = { ...hf }; let r = rnd;
      const approach = plan(h, ball, flags).target === h.cup && lie !== 'green' && d > 14;
      if (approach && take('laser')) { if (RULES.laserExact !== false) r = () => 0.5; else flags.steady = true; }
      else if (approach && take('steady')) flags.steady = true;
      if (lie === 'tee' && h.water.length && take('bounceback')) flags.bounceback = true;
      if (lie === 'tee' && h.par === 5 && take('bigstick')) flags.bigstick = true;
      if (lie === 'tee' && h.par >= 4 && take('tailwind')) flags.tailwind = true;
      const sh = shot(h, ball, flags, r);
      const bad = (sh.result === 'water' || sh.result === 'ob') && !flags.bounceback || (lie !== 'green' && ['rough', 'sand'].includes(sh.finish) && sh.result !== 'holed');
      if (bad && take('mulligan')) continue;  // undo, no stroke
      s++;
      if (sh.result === 'holed') break;
      if ((sh.result === 'water' || sh.result === 'ob') && !flags.bounceback) s++;
      ball = sh.end;
    }
    total += s - h.par;
    if (useCards && drafts.includes(hi)) { const offer = c.offers[hi]; const pick = PRI.find(id => offer.includes(id)); if (pick) { if (hand.length >= HAND) hand.shift(); hand.push(pick); } }
  });
  return { total, used };
}
const N = +(process.env.N || 400), base = [], withc = []; let usedSum = 0;
for (let seed = 20261101; seed < 20261101 + N; seed++) { base.push(playRound(seed, false).total); const w = playRound(seed, true); withc.push(w.total); usedSum += w.used; }
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(q * (s.length - 1))]; };
console.log(JSON.stringify(RULES), `no cards: avg ${avg(base).toFixed(2)} (best 10% ${pct(base, 0.1)}) | with cards: avg ${avg(withc).toFixed(2)} (best 10% ${pct(withc, 0.1)}, best ${Math.min(...withc)}) | cards used/round ${(usedSum / N).toFixed(1)}`);
