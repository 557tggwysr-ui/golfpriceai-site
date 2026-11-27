// Wild Nine engine v2: course generation, clubs, balls, tech and shot physics (no DOM).
(function (G) {
  'use strict';
  const W = 400, H = 640;
  // the out-of-bounds line sits XM yards beyond each side of the design area, so a phone screen is all course
  const XM = 44;

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const rr = (r, a, b) => a + (b - a) * r();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function shuffle(r, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  const inEllipse = (p, e) => {
    const c = Math.cos(-e.rot || 0), s = Math.sin(-e.rot || 0);
    const dx = p.x - e.x, dy = p.y - e.y;
    const x = dx * c - dy * s, y = dx * s + dy * c;
    return (x * x) / (e.rx * e.rx) + (y * y) / (e.ry * e.ry) <= 1;
  };

  // Every club of a type plays the same: the game never favours a brand.
  // lie: distance multiplier from tee/fairway, rough, sand.
  const CLUBS = {
    driver: { id: 'driver', name: 'Driver', short: 'Dr', carry: 250, roll: 0.14, loft: 0.12, wind: 1.0, rough: 0.72, sand: 0.4, cat: 'driver' },
    w3: { id: 'w3', name: '3 Wood', short: '3W', carry: 225, roll: 0.12, loft: 0.14, wind: 0.95, rough: 0.8, sand: 0.5, cat: 'wood' },
    w5: { id: 'w5', name: '5 Wood', short: '5W', carry: 205, roll: 0.11, loft: 0.16, wind: 0.9, rough: 0.86, sand: 0.55, cat: 'wood' },
    hy: { id: 'hy', name: 'Hybrid', short: 'Hy', carry: 190, roll: 0.10, loft: 0.17, wind: 0.85, rough: 0.93, sand: 0.72, cat: 'hybrid' },
    i4: { id: 'i4', name: '4 Iron', short: '4i', carry: 180, roll: 0.09, loft: 0.17, wind: 0.8, rough: 0.78, sand: 0.6, cat: 'irons' },
    i6: { id: 'i6', name: '6 Iron', short: '6i', carry: 160, roll: 0.08, loft: 0.2, wind: 0.8, rough: 0.82, sand: 0.65, cat: 'irons' },
    i8: { id: 'i8', name: '8 Iron', short: '8i', carry: 140, roll: 0.07, loft: 0.24, wind: 0.85, rough: 0.85, sand: 0.7, cat: 'irons' },
    pw: { id: 'pw', name: 'Pitching Wedge', short: 'PW', carry: 115, roll: 0.05, loft: 0.3, wind: 1.0, rough: 0.86, sand: 0.76, cat: 'wedge' },
    sw: { id: 'sw', name: 'Sand Wedge', short: 'SW', carry: 85, roll: 0.03, loft: 0.36, wind: 1.1, rough: 0.88, sand: 0.97, cat: 'wedge' },
    putter: { id: 'putter', name: 'Putter', short: 'Pt', putt: 90, cat: 'putter' }
  };
  const BAG_ORDER = ['driver', 'w3', 'w5', 'hy', 'i4', 'i6', 'i8', 'pw', 'sw'];
  const BAG_SIZE = 6; // plus the putter
  const DEFAULT_BAG = ['driver', 'w5', 'hy', 'i6', 'pw', 'sw'];

  const BALLS = {
    distance: { name: 'Distance ball', desc: 'Carries 5% further and runs out more. Harder to stop on the green.', carry: 1.05, roll: 1.15, greenRoll: 1.25, wind: 1.05, cap: 0 },
    tour: { name: 'Tour ball', desc: 'Spins: stops quickly on the green and holds its line in the wind. 3% shorter.', carry: 0.97, roll: 0.9, greenRoll: 0.45, wind: 0.85, cap: 0 },
    soft: { name: 'Soft feel ball', desc: 'Forgiving on the greens: putts drop in at higher speed.', carry: 0.99, roll: 1, greenRoll: 0.9, wind: 1, cap: 14 }
  };
  const TECH = {
    rangefinder: { name: 'Rangefinder', desc: 'Your aim ring allows for the wind.', cat: 'rangefinder' },
    gps: { name: 'GPS watch', desc: 'Sees through fog, and shows yards to the front and back of the green.', cat: 'gps-watch' },
    launch: { name: 'Launch monitor', desc: 'Grooved swing: spray only starts above 95% power.', cat: 'launch-monitor' }
  };

  const MU = { tee: 140, fairway: 140, rough: 420, sand: 1100, green: 70 };
  const ROLLF = { tee: 1, fairway: 1, rough: 0.35, sand: 0.05, green: 0.7 };

  const MODS = {
    classic: { name: 'Classic', desc: 'A straightforward opener. Find your rhythm.' },
    gale: { name: 'Gale Force', desc: 'Wind is doubled on this hole.' },
    fast: { name: 'Glass Greens', desc: 'Putts roll much further. Go gently.' },
    fog: { name: 'Sea Fret', desc: 'Fog hides everything beyond 150 yards from your ball.' },
    island: { name: 'Island Green', desc: 'Water all the way round the green.' },
    tiny: { name: 'Thimble Cup', desc: 'The hole is half its normal size.' },
    bucket: { name: 'Bucket Cup', desc: 'The hole is twice its normal size. Go for it.' },
    frost: { name: 'Frosty Fairways', desc: 'Hard ground: the ball runs 60% further on the fairway.' },
    narrow: { name: 'Tightrope', desc: 'A narrow fairway lined with trees.' }
  };

  const CARDS = {
    mulligan: { name: 'Mulligan', desc: 'Undo your last shot. No stroke counted.', instant: true },
    tailwind: { name: 'Tailwind', desc: 'Next shot: a 15 mph wind blows straight at the flag.' },
    bigstick: { name: 'Big Stick', desc: 'Next shot carries 25% further.' },
    laser: { name: 'Laser Line', desc: 'Next shot: see exactly where it will finish.' },
    sandwizard: { name: 'Sand Wizard', desc: 'Bunkers play like fairway for the rest of this hole.', instant: true },
    gimme: { name: 'Gimme', desc: 'Within 10 yards of the cup? Tap it in for one stroke.', instant: true },
    bounceback: { name: 'Bounce Back', desc: 'Next shot: water or out of bounds costs no penalty.' },
    stillair: { name: 'Still Air', desc: 'No wind for the rest of this hole.', instant: true },
    steady: { name: 'Steady Hands', desc: 'Next shot: full power with no spray.' }
  };
  const CARD_IDS = Object.keys(CARDS);

  // ---------- course ----------
  function genHole(r, par, mod, num) {
    const L = par === 3 ? rr(r, 140, 205) : par === 4 ? rr(r, 340, 430) : rr(r, 480, 550);
    const tee = { x: rr(r, 150, 250), y: 600 };
    let pts;
    if (par === 3) {
      const green = { x: clamp(tee.x + rr(r, -80, 80), 70, 330), y: tee.y - L };
      pts = [tee, green];
    } else if (par === 4) {
      // a real dogleg most of the time
      const f = rr(r, 0.5, 0.6);
      const off = r() < 0.75 ? (r() < 0.5 ? -1 : 1) * rr(r, 70, 150) : rr(r, -30, 30);
      const bend = { x: clamp(tee.x + off, 60, 340), y: tee.y - L * f };
      const rem = L * (1 - f);
      const back = r() < 0.6 ? -Math.sign(off || 1) * rr(r, 40, 120) : rr(r, -40, 40);
      const gx = clamp(bend.x + back, 60, 340);
      const dy = Math.sqrt(Math.max(rem * rem - (gx - bend.x) ** 2, (rem * 0.55) ** 2));
      pts = [tee, bend, { x: gx, y: Math.max(48, bend.y - dy) }];
    } else {
      // par 5: double dogleg (an S) most of the time
      const s1 = (r() < 0.5 ? -1 : 1);
      const b1 = { x: clamp(tee.x + s1 * rr(r, 50, 130), 60, 340), y: tee.y - L * rr(r, 0.4, 0.46) };
      const b2 = { x: clamp(b1.x - s1 * rr(r, 60, 150), 60, 340), y: b1.y - L * rr(r, 0.27, 0.33) };
      const g = { x: clamp(b2.x + rr(r, -60, 60), 60, 340), y: Math.max(48, b2.y - L * rr(r, 0.22, 0.28)) };
      pts = [tee, b1, b2, g];
    }
    const green = pts[pts.length - 1];
    const GR = 22;
    const hw = mod === 'narrow' ? 14 : par === 3 ? 18 : 24;
    let fair;
    if (par === 3) {
      fair = [{ x: tee.x + (green.x - tee.x) * 0.55, y: tee.y + (green.y - tee.y) * 0.55 }, green];
    } else {
      fair = [{ x: tee.x + (pts[1].x - tee.x) * 0.3, y: tee.y + (pts[1].y - tee.y) * 0.3 }].concat(pts.slice(1));
    }
    const ca = rr(r, 0, Math.PI * 2), cd = rr(r, 0, 10);
    const cup = { x: green.x + Math.cos(ca) * cd, y: green.y + Math.sin(ca) * cd };
    const sa = rr(r, 0, Math.PI * 2), sm = rr(r, 13, 28);
    const slope = { x: Math.cos(sa) * sm, y: Math.sin(sa) * sm };
    // greens have shape: a bowl that gathers putts (c > 0) or a crown that throws them off (c < 0)
    const bowl = { c: r() < 0.2 ? 0 : (r() < 0.62 ? -1 : 1) * rr(r, 0.25, 0.65), x: green.x + rr(r, -14, 14), y: green.y + rr(r, -14, 14) };
    const wa = rr(r, 0, Math.PI * 2);
    const wind = { mph: Math.round(rr(r, 0, 15)) * (mod === 'gale' ? 2 : 1), ang: wa };
    let length = 0; for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1], pts[i]);

    const h = { num, par, length: Math.round(length), tee, pts, bend: pts[1], green, GR, hw, fair, cup, slope, bowl, wind, mod,
      bunkers: [], water: [], trees: [] };

    const okSpot = (p, pad) => p.x > 12 && p.x < W - 12 && p.y > 12 && p.y < H - 12 && dist(p, tee) > 30 + (pad || 0);

    // greenside bunkers, never dead in front
    const prev = pts[pts.length - 2];
    const inc = Math.atan2(prev.y - green.y, prev.x - green.x);
    const nb = 2 + Math.floor(r() * 2.2);
    for (let i = 0; i < nb; i++) {
      let a;
      for (let k = 0; k < 20; k++) { a = rr(r, 0, Math.PI * 2); const d = Math.abs(Math.atan2(Math.sin(a - inc), Math.cos(a - inc))); if (d > 0.45 && !h.bunkers.some(b => Math.abs(Math.atan2(Math.sin(b.a - a), Math.cos(b.a - a))) < 0.7)) break; }
      h.bunkers.push({ a, x: green.x + Math.cos(a) * (GR + 10), y: green.y + Math.sin(a) * (GR + 10), rx: rr(r, 9, 14), ry: rr(r, 6, 8), rot: a + Math.PI / 2 });
    }
    // fairway bunkers: in the driving zone and at each bend
    if (par > 3) {
      const a = tee, b = pts[1], l = dist(a, b);
      const dir = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      const nf = 1 + Math.floor(r() * 2.5);
      for (let i = 0; i < nf; i++) {
        const d = Math.min(l - 10, rr(r, 205, 255));
        const side = r() < 0.5 ? -1 : 1, off = rr(r, -hw * 0.4, hw + 8) * side;
        h.bunkers.push({ x: a.x + dir.x * d - dir.y * off, y: a.y + dir.y * d + dir.x * off, rx: rr(r, 10, 15), ry: rr(r, 6, 9), rot: Math.atan2(dir.y, dir.x) });
      }
      for (let i = 1; i < pts.length - 1; i++) {
        if (r() < 0.6) {
          const p = pts[i], q = pts[i + 1], l2 = dist(p, q);
          const t = rr(r, 0.15, 0.4), side = r() < 0.5 ? -1 : 1, off = (hw + rr(r, 0, 8)) * side;
          const nx = -(q.y - p.y) / l2, ny = (q.x - p.x) / l2;
          h.bunkers.push({ x: p.x + (q.x - p.x) * t + nx * off, y: p.y + (q.y - p.y) * t + ny * off, rx: rr(r, 9, 13), ry: rr(r, 6, 8), rot: Math.atan2(q.y - p.y, q.x - p.x) });
        }
      }
    }
    // water: more of it
    if (mod === 'island') {
      h.water.push({ x: green.x, y: green.y, rx: GR + 30, ry: GR + 30, rot: 0, island: true });
    } else {
      const roll = r();
      if (par === 3) {
        if (roll < 0.7) {
          const t = rr(r, 0.4, 0.62);
          h.water.push({ x: tee.x + (green.x - tee.x) * t, y: tee.y + (green.y - tee.y) * t, rx: rr(r, 50, 75), ry: rr(r, 14, 22), rot: rr(r, -0.25, 0.25) });
        }
      } else {
        if (roll < 0.45) { // creek across the fairway: lay up or carry it
          const si = pts.length === 4 ? 2 : 1;
          const a = pts[si], b = pts[si + 1];
          const t = rr(r, 0.35, 0.6);
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          h.water.push({ x: p.x, y: p.y, rx: hw + rr(r, 30, 55), ry: rr(r, 6, 9), rot: Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2, creek: true });
        }
        if (roll > 0.25) { // pond beside a landing zone or the green
          const si = Math.floor(r() * (pts.length - 1));
          const a = pts[si], b = pts[si + 1];
          const t = si === 0 ? rr(r, 0.65, 0.95) : rr(r, 0.4, 0.85);
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          const l = dist(a, b) || 1, side = r() < 0.5 ? -1 : 1;
          const nx = -(b.y - a.y) / l, ny = (b.x - a.x) / l;
          const rx = rr(r, 22, 36), ry = rr(r, 15, 24), off = hw + rx * rr(r, 0.4, 0.8);
          h.water.push({ x: clamp(p.x + nx * off * side, 10, W - 10), y: p.y + ny * off * side, rx, ry, rot: Math.atan2(b.y - a.y, b.x - a.x) });
        }
      }
    }
    // clear any water off the tee, cup and green, and any sand off the green
    h.water = h.water.filter(w => w.island || (!inEllipse(tee, { ...w, rx: w.rx + 20, ry: w.ry + 20 }) && !inEllipse(green, { ...w, rx: w.rx + GR + 4, ry: w.ry + GR + 4 })));
    h.bunkers = h.bunkers.filter(b => dist(b, green) > GR + 3 && dist(b, tee) > 25 && !h.water.some(w => inEllipse(b, w)));

    // trees: guard the inside of each dogleg so the corner can't be cut for free
    const addTree = (p, rad) => {
      const tr = { x: p.x, y: p.y, r: rad };
      if (!okSpot(p, 5)) return false;
      if (fairDist(h, p) < hw + 4 + rad * 0.5) return false;
      if (dist(p, green) < GR + 24) return false;
      if (h.water.some(w => inEllipse(p, { ...w, rx: w.rx + 10, ry: w.ry + 10 })) || h.bunkers.some(b => dist(p, b) < 18)) return false;
      if (h.trees.some(t2 => dist(t2, p) < t2.r + rad)) return false;
      h.trees.push(tr); return true;
    };
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const v1 = { x: (a.x - b.x) / dist(a, b), y: (a.y - b.y) / dist(a, b) }, v2 = { x: (c.x - b.x) / dist(b, c), y: (c.y - b.y) / dist(b, c) };
      let bx = v1.x + v2.x, by = v1.y + v2.y; const bl = Math.hypot(bx, by);
      if (bl < 0.3) continue; bx /= bl; by /= bl; // bisector points into the inside corner
      for (let k = 0; k < 14; k++) addTree({ x: b.x + bx * rr(r, hw + 12, hw + 70) + rr(r, -14, 14), y: b.y + by * rr(r, hw + 12, hw + 70) + rr(r, -14, 14) }, rr(r, 8, 12));
    }
    const want = h.trees.length + (mod === 'narrow' ? 26 : Math.floor(rr(r, 10, 16)));
    let tries = 0;
    while (h.trees.length < want && tries++ < 700) {
      let p;
      if ((mod === 'narrow' && r() < 0.8) || r() < 0.3) {
        const si = Math.floor(r() * (h.fair.length - 1));
        const a = h.fair[si], b = h.fair[si + 1], t = r(), l = dist(a, b) || 1;
        const side = r() < 0.5 ? -1 : 1, off = hw + rr(r, 9, 18);
        p = { x: a.x + (b.x - a.x) * t - (b.y - a.y) / l * off * side, y: a.y + (b.y - a.y) * t + (b.x - a.x) / l * off * side };
      } else {
        p = { x: rr(r, 15, W - 15), y: rr(r, Math.min(green.y, tee.y) - 30, tee.y + 20) };
      }
      addTree(p, rr(r, 7, 11));
    }
    // the wider strip each side gets its own woodland (its own random stream, so the holes themselves are unchanged)
    const r2 = mulberry32(Math.floor(tee.x * 977 + green.y * 131 + num * 7919));
    for (let i = 0, tries = 0; i < 12 && tries < 80; tries++) {
      const left = r2() < 0.5, p = { x: left ? rr(r2, -XM + 10, -2) : rr(r2, W + 2, W + XM - 10), y: rr(r2, 20, H - 20) };
      if (h.water.some(w => inEllipse(p, { ...w, rx: w.rx + 12, ry: w.ry + 12 }))) continue;
      const rad = rr(r2, 7, 12);
      if (h.trees.some(t2 => dist(t2, p) < t2.r + rad) || fairDist(h, p) < hw + 10 + rad) continue;
      h.trees.push({ x: p.x, y: p.y, r: rad }); i++;
    }
    return h;
  }

  // downhill pull on the green at a point, and the height used to draw it
  function slopeAt(h, p) {
    const b = h.bowl || { c: 0, x: 0, y: 0 };
    let ax = h.slope.x - b.c * (p.x - b.x), ay = h.slope.y - b.c * (p.y - b.y);
    const m = Math.hypot(ax, ay); if (m > 32) { ax *= 32 / m; ay *= 32 / m; }
    return { x: ax, y: ay };
  }
  function heightAt(h, p) {
    const b = h.bowl || { c: 0, x: 0, y: 0 };
    return -(h.slope.x * (p.x - h.green.x) + h.slope.y * (p.y - h.green.y)) + b.c / 2 * ((p.x - b.x) ** 2 + (p.y - b.y) ** 2);
  }

  function fairDist(h, p) {
    let d = Infinity;
    for (let i = 0; i < h.fair.length - 1; i++) d = Math.min(d, segDist(p, h.fair[i], h.fair[i + 1]));
    return d;
  }

  function terrainAt(h, p) {
    if (p.x < 4 - XM || p.x > W + XM - 4 || p.y < 4 || p.y > H - 4) return 'ob';
    if (dist(p, h.green) <= h.GR) return 'green';
    for (const w of h.water) if (inEllipse(p, w)) return 'water';
    for (const b of h.bunkers) if (inEllipse(p, b)) return 'sand';
    if (Math.abs(p.x - h.tee.x) < 12 && Math.abs(p.y - h.tee.y) < 8) return 'tee';
    if (fairDist(h, p) <= h.hw) return 'fairway';
    return 'rough';
  }

  function makeCourse(seed) {
    const r = mulberry32(seed);
    const pars = shuffle(r, [4, 3, 5, 4, 4, 3, 4, 5, 4]);
    const mods = ['classic'].concat(shuffle(r, ['gale', 'fast', 'fog', 'island', 'tiny', 'bucket', 'frost', 'narrow']));
    const iIdx = mods.indexOf('island');
    if (pars[iIdx] !== 3) { const j = pars.findIndex((p, k) => p === 3 && k > 0); if (j > 0) [mods[iIdx], mods[j]] = [mods[j], mods[iIdx]]; }
    const holes = pars.map((p, i) => genHole(r, p, mods[i], i + 1));
    const offers = holes.map(() => shuffle(r, CARD_IDS).slice(0, 3));
    const startCard = CARD_IDS[Math.floor(r() * CARD_IDS.length)];
    holes.forEach(h => { h.name = holeName(seed, h); });
    // Sunday Majors: tighter fairways, more wind, quicker breaks
    const yy = Math.floor(seed / 10000), mo = Math.floor(seed / 100) % 100, dd = seed % 100;
    const major = yy > 2000 && yy < 2200 && mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31 && new Date(Date.UTC(yy, mo - 1, dd)).getUTCDay() === 0;
    if (major) holes.forEach(h => { h.hw *= 0.8; h.wind.mph += 5; h.slope = { x: h.slope.x * 1.15, y: h.slope.y * 1.15 }; if (h.bowl) h.bowl.c *= 1.15; });
    // Game master tuning (approved through the site's Fix pack): only ever set
    // for future days, so everyone playing a given day gets the same course.
    const TU = (G.WN_TUNING && G.WN_TUNING.days && G.WN_TUNING.days[String(seed)]) || null;
    if (TU) {
      const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
      holes.forEach(h => {
        const m = (TU.mods && TU.mods[h.mod]) || {};
        const hw = cl((TU.hw || 1) * (m.hw || 1), 0.8, 1.25), sl = cl((TU.slope || 1) * (m.slope || 1), 0.8, 1.25), gr = cl((TU.GR || 1) * (m.GR || 1), 0.85, 1.2);
        h.hw *= hw; h.GR *= gr; h.slope = { x: h.slope.x * sl, y: h.slope.y * sl };
        h.wind.mph = Math.max(0, Math.round(h.wind.mph + cl((TU.wind || 0) + (m.wind || 0), -6, 6)));
      });
    }
    return { seed, major, name: courseName(seed), holes, offers, startCard, par: pars.reduce((a, b) => a + b, 0) };
  }

  // ---------- shots ----------
  function windVec(h, flags, ball) {
    if (h.mod === 'blind') { const g = flags.gust || { x: 0, y: 0 }; return { x: g.x, y: g.y, mph: Math.round(Math.hypot(g.x, g.y)) }; }
    if (flags.stillair) return { x: 0, y: 0, mph: 0 };
    if (flags.tailwind) {
      const d = dist(ball, h.cup) || 1;
      return { x: (h.cup.x - ball.x) / d * 15, y: (h.cup.y - ball.y) / d * 15, mph: 15 };
    }
    return { x: Math.cos(h.wind.ang) * h.wind.mph, y: Math.sin(h.wind.ang) * h.wind.mph, mph: h.wind.mph };
  }
  function capR(h) { if (h.cupR) return h.cupR; return h.mod === 'tiny' ? 0.38 : h.mod === 'bucket' ? 1.4 : 0.62; }

  function lieFactor(clubId, lie, flags) {
    const c = CLUBS[clubId];
    if (lie === 'sand') return flags.sandwizard ? 1 : c.sand;
    if (lie === 'rough') return c.rough;
    return 1;
  }
  function carryFor(clubId, lie, power, flags, kit) {
    const c = CLUBS[clubId];
    const ball = BALLS[(kit && kit.ball) || 'soft'];
    return c.carry * power * lieFactor(clubId, lie, flags) * (flags.bigstick ? 1.25 : 1) * ball.carry;
  }
  function sprayStart(flags, kit) { return kit && kit.tech === 'launch' ? 0.95 : 0.9; }

  // Plan a whole shot. rnd() is used only for spray. Returns the full path for animation.
  function planShot(h, ball, clubId, ang, power, flags, rnd, kit) {
    kit = kit || { ball: 'soft', tech: 'rangefinder' };
    const club = CLUBS[clubId];
    const B = BALLS[kit.ball] || BALLS.soft;
    const lie = terrainAt(h, ball);
    const out = { path: [], start: { x: ball.x, y: ball.y }, end: null, result: 'ok', msg: '', carryEnd: null, events: [], club: clubId, power };
    let pos = { x: ball.x, y: ball.y }, vel;
    if (clubId === 'putter') {
      const muG = muFor(h, 'green', flags);
      const d = power * club.putt * (lie === 'green' ? 1 : 0.6) * (1 + (rnd() * 2 - 1) * (flags.steady ? 0.01 : 0.06));
      const pa = ang + (rnd() * 2 - 1) * (flags.steady ? 0.004 : 0.035);
      const sp = Math.sqrt(2 * muG * d);
      vel = { x: Math.cos(pa) * sp, y: Math.sin(pa) * sp };
      out.path.push({ x: pos.x, y: pos.y, z: 0 });
      out.putt = true;
    } else {
      const carry = carryFor(clubId, lie, power, flags, kit);
      out.carry = carry;
      let err = 0;
      const ss = sprayStart(flags, kit);
      if (power > ss && !flags.steady) { err += (rnd() * 2 - 1) * (power - ss) * 0.9 / (1 - ss) * 0.1; out.events.push('overswing'); }
      if (lie === 'rough' && !flags.steady) err += (rnd() * 2 - 1) * 0.04;
      if (!flags.steady) err += (rnd() * 2 - 1) * 0.028;
      const cErr = 1 + (rnd() * 2 - 1) * (flags.steady ? 0.015 : 0.05);
      if (Math.abs(err) > 0.07) out.events.push('spray');
      const a = ang + err;
      const w = windVec(h, flags, ball);
      const k = 0.9 * club.wind * B.wind * (carry / club.carry);
      // shaping: a draw curves left, a fade curves right; push it and it can become a hook or a slice
      let C = 0;
      if (flags.shape === 'draw' || flags.shape === 'fade') {
        C = (flags.shape === 'draw' ? 1 : -1) * 0.09 * carry;
        if (!flags.steady && !flags.previewShape) {
          const risk = 0.12 + Math.max(0, power - 0.85) * 1.6 + (lie === 'rough' ? 0.1 : 0) + (lie === 'sand' ? 0.15 : 0);
          if (rnd() < risk) { C *= 2.5; out.events.push(flags.shape === 'draw' ? 'hook' : 'slice'); }
          else out.events.push('shaped');
        }
      }
      out.curve = C;
      const dx = Math.cos(a), dy = Math.sin(a), lx = dy, ly = -dx; // left of the aim line, on screen
      const ex = carry * cErr, wx = w.x * k, wy = w.y * k;
      const at = t => ({ x: pos.x + dx * ex * t + lx * C * t * t + wx * t, y: pos.y + dy * ex * t + ly * C * t * t + wy * t });
      const land = at(1);
      const n = Math.max(14, Math.round(carry / 5));
      const hmax = carry * club.loft;
      for (let i = 0; i <= n; i++) {
        const t = i / n, q = at(t);
        out.path.push({ x: q.x, y: q.y, z: 4 * hmax * t * (1 - t) });
      }
      out.rollDir = { x: dx * ex + lx * 2 * C + wx, y: dy * ex + ly * 2 * C + wy };
      out.carryEnd = land;
      pos = land;
      const t = terrainAt(h, land);
      out.landed = t;
      if (!h.kick && !h.plug && dist(land, h.cup) < capR(h) * 0.9 && carry > 20) { out.result = 'holed'; out.events.push('dunk'); out.end = { x: h.cup.x, y: h.cup.y }; return out; }
      if (t === 'ob') { out.result = 'ob'; out.end = { x: ball.x, y: ball.y }; return out; }
      if (t === 'water') { out.result = 'water'; out.end = { x: ball.x, y: ball.y }; return out; }
      if (h.plug) { // soft, hidden green: the ball plugs where it lands, so it's in the air or nothing
        out.dunkR = Math.max(0.05, 0.9 * club.wind * B.wind * (carry / club.carry) * h.gustMax / 100);
        out.path.push({ x: land.x, y: land.y, z: 0 });
        if (dist(land, h.cup) < out.dunkR) { out.result = 'holed'; out.events.push('ace'); out.end = { x: h.cup.x, y: h.cup.y }; return out; }
        out.end = { x: land.x, y: land.y }; out.finish = t; return out;
      }
      const tree = h.trees.find(tr => dist(tr, land) < tr.r);
      if (tree) {
        const d = dist(tree, land) || 1;
        const e = { x: tree.x + (land.x - tree.x) / d * (tree.r + 2), y: tree.y + (land.y - tree.y) / d * (tree.r + 2) };
        out.path.push({ x: e.x, y: e.y, z: 0 });
        out.events.push('tree');
        out.end = e; out.finish = terrainAt(h, e); return out;
      }
      let rollD = carry * club.roll * (ROLLF[t] || 1) * B.roll * (h.mod === 'frost' && (t === 'fairway' || t === 'tee') ? 1.6 : 1) * (flags.shape === 'draw' ? 1.25 : flags.shape === 'fade' ? 0.8 : 1);
      if (t === 'green') rollD *= B.greenRoll;
      if (t === 'sand' && flags.sandwizard) rollD = carry * club.roll;
      const mu0 = muFor(h, t, flags);
      const sp = Math.sqrt(2 * mu0 * rollD);
      const rdl = Math.hypot(out.rollDir.x, out.rollDir.y) || 1;
      vel = { x: out.rollDir.x / rdl * sp, y: out.rollDir.y / rdl * sp };
      if (h.kick) { // hidden mounds: the first bounce goes where it likes
        const ka = (rnd() * 2 - 1) * h.kick, km = 0.6 + rnd() * 0.8, c = Math.cos(ka), s2 = Math.sin(ka);
        vel = { x: (vel.x * c - vel.y * s2) * km, y: (vel.x * s2 + vel.y * c) * km };
        out.events.push('kick');
      }
    }
    roll(h, pos, vel, flags, out, ball, B);
    out.finish = out.end ? terrainAt(h, out.end) : null;
    return out;
  }

  function muFor(h, t, flags) {
    if (t === 'sand' && flags.sandwizard) return MU.fairway;
    if (t === 'green' && h.mod === 'fast') return MU.green * 0.5;
    return MU[t] || MU.rough;
  }

  function roll(h, pos, vel, flags, out, origin, B) {
    const dt = 1 / 60;
    let lastDry = { x: pos.x, y: pos.y };
    const cr = capR(h), vCap = h.vCap || (40 + (B ? B.cap * 0.6 : 0));
    for (let step = 0; step < 3000; step++) {
      const t = terrainAt(h, pos);
      if (t === 'water') { out.result = 'water'; out.end = nearestDry(h, lastDry, pos); return; }
      if (t === 'ob') { out.result = 'ob'; out.end = { x: origin.x, y: origin.y }; return; }
      lastDry = { x: pos.x, y: pos.y };
      const sp = Math.hypot(vel.x, vel.y);
      const dc = dist(pos, h.cup);
      if (dc < cr) {
        if (sp < vCap) { out.path.push({ x: h.cup.x, y: h.cup.y, z: 0 }); out.result = 'holed'; out.end = { x: h.cup.x, y: h.cup.y }; return; }
        if (dc < cr * 0.7 && !out.lipped) {
          out.lipped = true; out.events.push('lip'); const c = Math.cos(0.6), s = Math.sin(0.6);
          vel = { x: (vel.x * c - vel.y * s) * 0.55, y: (vel.x * s + vel.y * c) * 0.55 };
        }
      }
      const mu = muFor(h, t, flags);
      const slopeA = t === 'green' ? slopeAt(h, pos) : { x: 0, y: 0 };
      if (sp < mu * dt * 1.2 && Math.hypot(slopeA.x, slopeA.y) < mu) break;
      const fx = sp > 0 ? -vel.x / sp * mu : 0, fy = sp > 0 ? -vel.y / sp * mu : 0;
      vel.x += (fx + slopeA.x) * dt; vel.y += (fy + slopeA.y) * dt;
      pos = { x: pos.x + vel.x * dt, y: pos.y + vel.y * dt };
      for (const tr of h.trees) {
        const d = dist(tr, pos);
        if (d < tr.r) {
          const nx = (pos.x - tr.x) / (d || 1), ny = (pos.y - tr.y) / (d || 1);
          const dot = vel.x * nx + vel.y * ny;
          vel = { x: (vel.x - 2 * dot * nx) * 0.4, y: (vel.y - 2 * dot * ny) * 0.4 };
          pos = { x: tr.x + nx * (tr.r + 0.5), y: tr.y + ny * (tr.r + 0.5) };
          if (!out.events.includes('tree')) out.events.push('tree');
        }
      }
      if (step % 2 === 0) out.path.push({ x: pos.x, y: pos.y, z: 0 });
    }
    out.path.push({ x: pos.x, y: pos.y, z: 0 });
    out.end = { x: pos.x, y: pos.y };
  }

  function nearestDry(h, p, wetP) {
    let q = { x: p.x, y: p.y };
    const d = dist(p, wetP) || 1;
    const ux = (p.x - wetP.x) / d, uy = (p.y - wetP.y) / d;
    for (let i = 0; i < 40 && terrainAt(h, q) === 'water'; i++) q = { x: q.x + ux * 2, y: q.y + uy * 2 };
    q = { x: q.x + ux * 3, y: q.y + uy * 3 };
    if (terrainAt(h, q) === 'water' || terrainAt(h, q) === 'ob') return { x: h.tee.x, y: h.tee.y };
    return q;
  }

  // Pick the shortest club in the bag that comfortably gets there; else the longest.
  function suggestClub(h, ball, bag, kit) {
    const t = terrainAt(h, ball);
    if (t === 'green') return 'putter';
    const d = dist(ball, h.cup);
    if (d < 14 && dist(ball, h.green) < h.GR + 12) return 'putter';
    const clubs = BAG_ORDER.filter(c => bag.includes(c) && !(c === 'driver' && t !== 'tee'));
    const reach = c => carryFor(c, t, 0.88, {}, kit);
    const ok = clubs.filter(c => reach(c) >= d * 0.95);
    if (ok.length) return ok[ok.length - 1];
    return clubs[0] || bag[0];
  }

  function scoreName(strokes, par) {
    const d = strokes - par;
    if (strokes === 1) return 'Hole in one!';
    return d <= -3 ? 'Albatross!' : d === -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : 'Triple bogey or worse';
  }
  function scoreEmoji(strokes, par) {
    const d = strokes - par;
    return d <= -2 ? '\u{1F985}' : d === -1 ? '\u{1F426}' : d === 0 ? '\u{1F7E9}' : d === 1 ? '\u{1F7E8}' : '\u{1F7E5}';
  }

  const NAME_A = ['Royal', 'Old', 'Great', 'Little', 'Upper', 'Lower', 'North', 'West'];
  const NAME_B = ['Bogeyford', 'Slicester', 'Duffington', 'Shankwell', 'Pitchmarsh', 'Fescue Vale', 'Gorseby', 'Mulligan Moor', 'Puddleby', 'Divotdown', 'Topplewick', 'Fairway Parva', 'Sandtrap Magna', 'Wedgeworth', 'Yipsley', 'Birdie Bottom'];
  const NAME_C = ['Golf Club', 'Links', 'Park', 'Downs', 'Golf & Country Club', 'Heath'];
  function courseName(seed) {
    const r = mulberry32(seed * 31 + 7);
    const a = r() < 0.55 ? NAME_A[Math.floor(r() * NAME_A.length)] + ' ' : '';
    return a + NAME_B[Math.floor(r() * NAME_B.length)] + ' ' + NAME_C[Math.floor(r() * NAME_C.length)];
  }
  const HOLE_NAMES = { classic: ['The Welcome', 'First Impressions', 'Gentle Start'], gale: ['The Hurricane', 'Blowy Bill'], fast: ['The Ice Rink', 'Glassworks'],
    fog: ['Pea Souper', 'The Haar'], island: ['Davy Jones', 'Treasure Island'], tiny: ['The Thimble', 'Eye of the Needle'], bucket: ['Bucket List', 'The Big Easy'],
    frost: ['Jack Frost', 'Hard Pan'], narrow: ['The Corridor', 'Tightrope'], blind: ['Blind Faith'] };
  function holeName(seed, h) { const l = HOLE_NAMES[h.mod] || ['The Hole']; return l[Math.floor(mulberry32(seed + h.num * 99)() * l.length)]; }

  // Hole 10: blind, soft green, a hidden gust of up to 30 mph drawn at the strike.
  // A perfect strike holes out 1 time in 10,000 exactly; any other strike less often.
  function makeTenth(seed) {
    const r = mulberry32(seed ^ 0x51ced);
    const tee = { x: 200, y: 600 };
    const green = { x: 200 + rr(r, -30, 30), y: 600 - rr(r, 150, 185) };
    const GR = 18;
    const h = { num: 10, par: 3, mod: 'blind', tee, green, GR, hw: 14, pts: [tee, green],
      fair: [{ x: tee.x + (green.x - tee.x) * 0.6, y: tee.y + (green.y - tee.y) * 0.6 }, green],
      cup: { x: green.x + rr(r, -6, 6), y: green.y + rr(r, -6, 6) }, slope: { x: 0, y: 0 }, wind: { mph: 0, ang: 0 },
      bunkers: [], water: [], trees: [], plug: true, gustMax: 30,
      ridge: { x: green.x, y: green.y + GR + 26, rx: 150, ry: 24 } };
    for (const a of [0.6, 2.5, 3.9, 5.4]) h.bunkers.push({ x: green.x + Math.cos(a) * (GR + 9), y: green.y + Math.sin(a) * (GR + 9), rx: 10, ry: 6, rot: a + Math.PI / 2 });
    h.length = Math.round(dist(tee, green));
    return h;
  }

  G.WildNine = { slopeAt, heightAt, courseName, holeName, makeTenth, W, H, XM, mulberry32, makeCourse, genHole, terrainAt, planShot, suggestClub, scoreName, scoreEmoji, carryFor, lieFactor, sprayStart,
    CLUBS, BAG_ORDER, BAG_SIZE, DEFAULT_BAG, BALLS, TECH, CARDS, CARD_IDS, MODS, dist, capR, windVec, fairDist };
})(typeof window !== 'undefined' ? window : globalThis);
