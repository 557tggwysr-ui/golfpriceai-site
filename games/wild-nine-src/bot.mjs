import './engine.js';
const E = globalThis.WildNine;
const bag = E.DEFAULT_BAG, kit = { ball: 'soft', tech: 'rangefinder' };
function clear(h, a, b) {
  const n = 30;
  for (let i = 1; i < n; i++) {
    const p = { x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n };
    if (h.trees.some(t => E.dist(t, p) < t.r + 2)) return false;
  }
  const t = E.terrainAt(h, b);
  return t !== 'water' && t !== 'ob';
}
function plan(h, ball) {
  const lie = E.terrainAt(h, ball);
  if (lie === 'green' || E.dist(ball, h.cup) < 14) return { club: 'putter', target: h.cup };
  const clubs = E.BAG_ORDER.filter(c => bag.includes(c) && !(c === 'driver' && lie !== 'tee'));
  const maxReach = E.carryFor(clubs[0], lie, 0.88, {}, kit);
  // candidate targets: cup, then points along the fairway centreline
  const cands = [h.cup];
  for (let i = h.fair.length - 1; i > 0; i--) {
    const a = h.fair[i - 1], b = h.fair[i];
    for (let t = 1; t >= 0; t -= 0.1) cands.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  for (const c of cands) {
    const d = E.dist(ball, c);
    if (d > maxReach * 1.05) continue;
    if (E.dist(c, h.cup) >= E.dist(ball, h.cup) - 5) continue;
    if (c !== h.cup && !clear(h, ball, c)) continue;
    if (c === h.cup && !clear(h, ball, c) && d > 60) continue;
    return { target: c, d };
  }
  return { target: h.cup, d: E.dist(ball, h.cup) };
}
let total = 0, holes = 0, fails = 0; const per = {}, perPar = {};
for (let seed = 20261101; seed < 20261101 + 120; seed++) {
  const c = E.makeCourse(seed);
  for (const h of c.holes) {
    if (E.terrainAt(h, h.tee) !== 'tee') console.log('bad tee', seed, h.num);
    if (E.terrainAt(h, h.cup) !== 'green') console.log('cup off green', seed, h.num);
    let ball = { ...h.tee }, s = 0;
    const rnd = E.mulberry32(seed * 7 + h.num);
    while (s < 12) {
      const p = plan(h, ball);
      const lie = E.terrainAt(h, ball);
      const ang = Math.atan2(p.target.y - ball.y, p.target.x - ball.x);
      const d = E.dist(ball, p.target);
      let club = p.club, pw;
      if (club === 'putter') pw = Math.min(1, (d + 2) / (90 * (lie === 'green' ? 1 : 0.6)) * (h.mod === 'fast' ? 0.72 : 1) * (lie === 'green' ? 1 : 1.4));
      else {
        const clubs = E.BAG_ORDER.filter(c => bag.includes(c) && !(c === 'driver' && lie !== 'tee'));
        const ok = clubs.filter(c => E.carryFor(c, lie, 0.88, {}, kit) >= d * 0.95);
        club = ok.length ? ok[ok.length - 1] : clubs[0];
        pw = Math.min(0.88, d * 0.93 / E.carryFor(club, lie, 1, {}, kit));
      }
      const sh = E.planShot(h, ball, club, ang, Math.max(0.05, pw), {}, rnd, kit);
      s++;
      if (sh.result === 'holed') break;
      if (sh.result === 'water' || sh.result === 'ob') s++;
      ball = sh.end;
      if (!ball || !isFinite(ball.x)) { console.log('bad end', seed, h.num); break; }
    }
    holes++; total += s - h.par;
    (per[h.mod] = per[h.mod] || []).push(s - h.par);
    (perPar[h.par] = perPar[h.par] || []).push(s - h.par);
    if (s >= 12) fails++;
  }
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
console.log('holes', holes, 'avg over par', (total / holes).toFixed(2), 'gave up (12+)', fails);
console.log('by par', Object.fromEntries(Object.entries(perPar).map(([k, v]) => [k, avg(v)])));
console.log('by twist', Object.fromEntries(Object.entries(per).map(([k, v]) => [k, avg(v)])));
