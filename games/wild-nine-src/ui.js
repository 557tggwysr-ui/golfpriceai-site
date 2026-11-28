(function () {
  'use strict';
  const E = window.WildNine, Q = window.WN_QUIPS, KIT = window.WN_KIT || {};
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cv = $('#cv'), ctx = cv.getContext('2d');
  const SITE = 'https://golfpriceai.com';
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const once = fn => { let used = false; return (...a) => { if (used) return; used = true; return fn(...a); }; };
  const money = p => '£' + (p >= 100 || p % 1 === 0 ? Math.round(p) : p.toFixed(2));

  // ---------- day ----------
  const now = new Date();
  const ymd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  const dayNo = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2026, 10, 1)) / 864e5) + 1;

  const MODES = {
    solo: { name: 'Solo', players: 1, desc: "Today's course. Post your card." },
    match: { name: 'Match play', players: 2, desc: 'Head to head, hole by hole. Win the hole, pick your card first.' },
    scramble: { name: 'Scramble', players: 2, desc: 'Team game: you both hit, then play from the better ball.' },
    alt: { name: 'Alternate shot', players: 2, desc: 'Team game: one ball, take turns. No hiding.' }
  };
  const PCOL = ['#ffffff', '#ffd166'];
  const CAT_LABEL = { driver: 'Driver', wood: 'Fairway wood', hybrid: 'Hybrid', irons: 'Irons', wedge: 'Wedge', putter: 'Putter', ball: 'Balls', rangefinder: 'Rangefinder', 'gps-watch': 'GPS watch', 'launch-monitor': 'Launch monitor' };

  let S = null;   // game state
  let SETUP = null;

  // ---------- setup flow ----------
  // player settings: sound, vibration, left-handed, high-contrast greens
  const SET = Object.assign({ sound: true, haptics: true, lefty: false, cb: false }, (() => { try { return JSON.parse(localStorage.getItem('wildnine-settings')) || {}; } catch (e) { return {}; } })());
  const saveSet = () => { try { localStorage.setItem('wildnine-settings', JSON.stringify(SET)); } catch (e) { /* private mode */ } };
  function buzz(p) { if (!SET.haptics) return; try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* no vibration */ } }
  function defaultPlayer(i) {
    const saved = store.get('wildnine-player-' + i);
    return saved && saved.bag ? saved : { name: i ? 'Player 2' : 'Player 1', bag: E.DEFAULT_BAG.slice(), kit: { ball: 'soft', tech: 'rangefinder' }, models: {} };
  }

  function setupPlayer() {
    const i = SETUP.i, n = MODES[SETUP.mode].players;
    const P = defaultPlayer(i);
    const ARS = i === 0 ? arsenalModels() : null;
    if (ARS) for (const [c, s] of Object.entries(ARS)) if (!P.models[c]) P.models[c] = s;
    const draw = () => {
      const chosen = P.bag.length;
      overlay(`<div class="kicker">${n > 1 ? `Player ${i + 1} of ${n}` : 'Build your bag'}</div>
        <h2>${n > 1 ? 'Who\'s playing?' : 'Your bag'}</h2>
        ${n > 1 ? `<input class="name" id="pname" maxlength="14" value="${esc(P.name)}" aria-label="Player name">` : ''}
        <div class="sect">Pick 6 clubs <small>(${chosen}/6, putter included free)</small></div>
        <div class="clubpick">${E.BAG_ORDER.map(c => { const C = E.CLUBS[c]; return `<button class="cp ${P.bag.includes(c) ? 'on' : ''}" data-c="${c}"><b>${C.name}</b><span>${C.carry} yds</span></button>`; }).join('')}</div>
        <div class="sect">Ball</div>
        <div class="opts">${Object.entries(E.BALLS).map(([k, b]) => `<button class="opt ${P.kit.ball === k ? 'on' : ''}" data-ball="${k}"><b>${b.name}</b><span>${b.desc}</span></button>`).join('')}</div>
        <div class="sect">Tech</div>
        <div class="opts">${Object.entries(E.TECH).map(([k, t]) => `<button class="opt ${P.kit.tech === k ? 'on' : ''}" data-tech="${k}"><b>${t.name}</b><span>${t.desc}</span></button>`).join('')}</div>
        ${ARS && Object.keys(ARS).some(c => P.models[c] === ARS[c]) ? `<div class="done">Filled from your <a href="${SITE}/build-your-bag.html" target="_blank" rel="noopener">Assemble Your Arsenal</a> bag.</div>` : ''}
        <details class="real"><summary>Make it your real bag <small>(optional)</small></summary>
          <p class="fine">Pick the actual models you play, with today's lowest UK prices. Just for show: every club of a type plays the same, so no brand gets an advantage.</p>
          ${realBagPickers(P)}
        </details>
        <button class="primary" id="next" ${chosen === 6 ? '' : 'disabled'}>${chosen === 6 ? (i + 1 < n ? 'Next player' : 'Tee off') : 'Pick ' + (6 - chosen) + ' more'}</button>`);
      $$('.cp').forEach(b => b.onclick = () => {
        const c = b.dataset.c, k = P.bag.indexOf(c);
        if (k >= 0) P.bag.splice(k, 1); else if (P.bag.length < 6) P.bag.push(c);
        keepName(); draw();
      });
      $$('[data-ball]').forEach(b => b.onclick = () => { P.kit.ball = b.dataset.ball; keepName(); draw(); });
      $$('[data-tech]').forEach(b => b.onclick = () => { P.kit.tech = b.dataset.tech; keepName(); draw(); });
      $$('select.model').forEach(s => s.onchange = () => { P.models[s.dataset.cat] = s.value || undefined; keepName(); const d = $('details.real'); const open = d && d.open; draw(); if (open) $('details.real').open = true; });
      $('#next').onclick = once(() => {
        keepName();
        P.bag = E.BAG_ORDER.filter(c => P.bag.includes(c));
        store.set('wildnine-player-' + i, P);
        SETUP.players.push(P); SETUP.i++;
        if (SETUP.i < n) setupPlayer(); else { closeOverlay(); newGame(SETUP); }
      });
    };
    const keepName = () => { const el = $('#pname'); if (el) P.name = el.value.trim() || P.name; };
    draw();
  }

  function catsFor(P) {
    const cats = [];
    for (const c of P.bag) { const cat = E.CLUBS[c].cat; if (!cats.includes(cat)) cats.push(cat); }
    cats.push('putter', 'ball', E.TECH[P.kit.tech].cat);
    return cats;
  }
  function priceNote(m) {
    if (!m) return '';
    if (m.c <= -3) return `${money(m.p)} today, ${-m.c}% below its ${m.days || 90}-day high`;
    return `${money(m.p)} today`;
  }
  function realBagPickers(P) {
    return catsFor(P).map(cat => {
      const list = KIT[cat] || [];
      if (!list.length) return '';
      const sel = P.models[cat];
      const cur = list.find(m => m.s === sel);
      return `<label class="mp"><span>${CAT_LABEL[cat]}</span>
        <select class="model" data-cat="${cat}"><option value="">Any ${CAT_LABEL[cat].toLowerCase()}</option>
        ${list.map(m => `<option value="${m.s}" ${m.s === sel ? 'selected' : ''}>${esc(m.n)}: ${money(m.p)}${m.c <= -3 ? ` (${m.c}%)` : ''}</option>`).join('')}</select>
        ${cur ? `<small>${priceNote(cur)}</small>` : ''}</label>`;
    }).join('');
  }

  // ---------- game state ----------
  function newGame(cfg) {
    const course = E.makeCourse(cfg.seed);
    if (cfg.lesson) { const h = course.holes.find(x => x.num === lessonHole().num) || course.holes[0]; course.holes = [h]; course.name = 'The Practice Ground'; course.offers = [[]]; course.startCard = 'mulligan'; }
    const mode = cfg.mode;
    const sides = mode === 'match' ? [[0], [1]] : mode === 'solo' ? [[0]] : [[0, 1]];
    const startCard = mode === 'scramble' && course.startCard === 'mulligan' ? 'steady' : course.startCard;
    const myBall = look(null, 'ball').ball;
    const cols = [myBall, ['#f4e04d', '#ff8a3d'].includes(myBall) ? '#ffffff' : '#ffd166'];
    S = { cfg, mode, course, h: 0, players: cfg.players.map((p, i) => ({ ...p, col: cols[i], lost: 0 })),
      sides: sides.map(pl => ({ players: pl, hand: [startCard], scores: [] })),
      match: { up: 0, holes: [] }, cur: null, last: null, busy: false, aim: null, anim: null, toastT: 0,
      rival: RIVAL && mode === 'solo' && seedFor(RIVAL.day) === cfg.seed ? RIVAL : null };
    RIVAL = null;
    startHole();
  }
  const hole = () => S.bonus ? S.tenth : S.course.holes[S.h];
  const side = () => S.sides[S.cur.side];
  const player = () => S.players[S.cur.player];
  const multi = () => S.players.length > 1;

  function startHole() {
    const h = hole();
    S.sides.forEach(sd => Object.assign(sd, { ball: { x: h.tee.x, y: h.tee.y }, strokes: 0, swings: 0, done: false, holed: false, history: [], armed: {}, holeFlags: {}, scr: null }));
    S.anim = null; S.busy = false; S.last = null; S.cur = null; S.holeEnded = false; S.shape = null;
    if (S.mode === 'solo') trackStart();
    fitCamera(true);
    if (S.cfg.lesson) { closeOverlay(); S.last = null; nextTurn(); return; }
    showHoleIntro();
  }

  // whose turn is it?
  function nextTurn() {
    if (holeOver()) return endHole();
    let sd = 0, pl;
    if (S.mode === 'match') {
      const live = S.sides.map((s, i) => i).filter(i => !S.sides[i].done);
      live.sort((a, b) => E.dist(S.sides[b].ball, hole().cup) - E.dist(S.sides[a].ball, hole().cup));
      sd = live[0];
      if (live.length > 1 && Math.abs(E.dist(S.sides[live[0]].ball, hole().cup) - E.dist(S.sides[live[1]].ball, hole().cup)) < 0.5 && S.last && S.last.side === sd) sd = live[1];
      pl = S.sides[sd].players[0];
    } else if (S.mode === 'alt') {
      pl = (S.h + S.sides[0].swings) % 2;
    } else if (S.mode === 'scramble') {
      const s0 = S.sides[0];
      if (!s0.scr) s0.scr = { from: { ...s0.ball }, res: [], first: S.h % 2 };
      pl = (s0.scr.first + s0.scr.res.length) % 2;
    } else pl = 0;
    const changed = !S.last || S.last.player !== pl;
    S.cur = { side: sd, player: pl };
    const sdObj = side();
    S.club = E.suggestClub(hole(), sdObj.ball, player().bag.concat('putter'), player().kit);
    fitCamera(!S.last);
    renderHud();
    if (multi() && changed) handoff();
  }

  function holeOver() {
    if (S.mode !== 'match') return S.sides[0].done;
    const [a, b] = S.sides;
    if (a.done && b.done) return true;
    if (a.holed && !b.done && b.strokes >= a.strokes) return true;
    if (b.holed && !a.done && a.strokes >= b.strokes) return true;
    return false;
  }

  function handoff() {
    const P = player(), h = hole(), sd = side();
    const lie = ({ tee: 'on the tee', fairway: 'on the fairway', rough: 'in the rough', sand: 'in a bunker', green: 'on the green' })[E.terrainAt(h, sd.ball)] || '';
    let extra = '';
    if (S.mode === 'scramble' && sd.scr && sd.scr.res.length) extra = `<div class="fine">${esc(S.players[sd.scr.res[0].player].name)} has hit. Your turn from the same spot.</div>`;
    overlay(`<div class="kicker">Hole ${h.num} · Par ${h.par}</div>
      <h2>Over to ${esc(P.name)}</h2>
      <div class="big">${Math.round(E.dist(sd.ball, h.cup))} yards out, ${lie}</div>${extra}
      <button class="primary" id="ready">Ready</button>`);
    $('#ready').onclick = once(closeOverlay);
  }

  // ---------- close putts (28 Nov 2026) ----------
  // Within 10 feet the camera zooms in on the ball and the cup, and a full drag only reaches about three
  // times the distance to the hole, so a thumb has room to judge the strength. The physics are unchanged:
  // the same break, the same lip-outs, the same capture speed. Easier to strike, not easier to sink.
  const CLOSE_YD = 10 / 3;
  function closePutt() {
    if (!S || !S.cur || S.bonus) return 0;
    const h = hole(), b = side().ball;
    if (E.terrainAt(h, b) !== 'green') return 0;
    const d = E.dist(b, h.cup);
    return d <= CLOSE_YD ? d : 0;
  }
  const closeScaleYd = d => Math.max(4, d * 3); // what a full drag rolls, on a flat green

  // ---------- camera ----------
  let cam = { cx: 200, cy: 320, s: 1 }, camT = null;
  function liveBalls() {
    const out = [];
    for (const sd of S.sides) if (!sd.done) out.push(sd.ball);
    if (S.mode === 'scramble' && S.sides[0].scr) for (const r of S.sides[0].scr.res) if (r.end) out.push(r.end);
    return out.length ? out : [hole().cup];
  }
  function targetCam() {
    const h = hole();
    const balls = liveBalls();
    const near = balls.every(b => E.dist(b, h.green) < 120);
    let pts;
    const tight = balls.length && balls.every(b => E.terrainAt(h, b) === 'green' && E.dist(b, h.cup) <= CLOSE_YD);
    if (tight) { // close putt: frame the ball and the cup with a little green around them
      const m = 7; // about 15 yards of green: enough to read the slope
      pts = balls.concat([{ x: h.cup.x - m, y: h.cup.y - m }, { x: h.cup.x + m, y: h.cup.y + m }]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const s = Math.min(cv.width / (x1 - x0 + 3), cv.height / (y1 - y0 + 3));
      return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, s };
    }
    if (near) {
      const m = h.GR + 22;
      pts = balls.concat([{ x: h.green.x - m, y: h.green.y - m }, { x: h.green.x + m, y: h.green.y + m }]);
    } else {
      const far = Math.max(...balls.map(b => E.dist(b, h.cup)));
      pts = balls.concat(h.pts.filter(p => E.dist(p, h.cup) <= far + 5), [{ x: h.green.x - 45, y: h.green.y - 45 }, { x: h.green.x + 45, y: h.green.y + 45 }]);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const cx0 = x0, cy0 = y0, cx1 = x1, cy1 = y1; // what must stay on screen: balls, the route in play, the green
    const pad = near ? 18 : 30;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad + (near ? 0 : 10);
    let s = Math.min(cv.width / (x1 - x0), cv.height / (y1 - y0));
    // phones are tall and the course is narrow: rather than show dead space past the out-of-bounds line,
    // zoom in until the course fills the width, as far as the tee-to-green picture still fits (padding is what we give up)
    const inset = 2, fillW = cv.width / (E.W + 2 * E.XM - 2 * inset), fillH = cv.height / (E.H - 2 * inset);
    const fitContent = Math.min(cv.width / (cx1 - cx0 + 16), cv.height / (cy1 - cy0 + 16 + (near ? 0 : 22)));
    s = Math.max(s, Math.min(Math.max(fillW, fillH), fitContent));
    // then slide the view so it stays inside the course where it can
    let cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const hw = cv.width / s / 2, hh = cv.height / s / 2;
    const clampC = (c, half, lo, hi) => half * 2 >= hi - lo ? (lo + hi) / 2 : Math.min(Math.max(c, lo + half), hi - half);
    cx = clampC(cx, hw, inset - E.XM, E.W + E.XM - inset); cy = clampC(cy, hh, inset, E.H - inset);
    // never at the cost of hiding what matters
    cx = Math.min(Math.max(cx, cx1 + 8 - hw), cx0 - 8 + hw); cy = Math.min(Math.max(cy, cy1 + 8 - hh), cy0 - 8 + hh);
    return { cx, cy, s };
  }
  function fitCamera(snap) { const t = targetCam(); if (snap) { cam = t; camT = null; } else camT = { from: { ...cam }, to: t, t0: performance.now() }; }
  const W2S = p => ({ x: (p.x - cam.cx) * cam.s + cv.width / 2, y: (p.y - cam.cy) * cam.s + cv.height / 2 });

  function resize() {
    const wrap = $('#stage');
    const w = wrap.clientWidth, hgt = wrap.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
    cv.style.width = w + 'px'; cv.style.height = hgt + 'px';
    if (S) fitCamera(true);
  }

  // ---------- drawing ----------
  const COL = { rough: '#3f7a3a', rough2: '#3a7236', fair: '#5fa84e', fair2: '#67b155', green: '#7cc867', fringe: '#6dba5a',
    sand: '#e9d7a6', sandEdge: '#cdb57c', water: '#3b8fc4', waterEdge: '#9fd2ef', tree: '#24512a', treeHi: '#33693a' };
  function ell(e, grow) {
    ctx.save(); const c = W2S(e); ctx.translate(c.x, c.y); ctx.rotate(e.rot || 0);
    ctx.beginPath(); ctx.ellipse(0, 0, (e.rx + (grow || 0)) * cam.s, (e.ry + (grow || 0)) * cam.s, 0, 0, Math.PI * 2); ctx.restore();
  }
  function drawBall(p, z, col, ring) {
    const s = cam.s, q = W2S(p), px = cv.width / (cv.clientWidth || cv.width), r = Math.max(4.2, Math.min(1.7 * s, 9 * px)); // capped, so a close-up never shows a beach ball
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(q.x + 1, q.y + 1.5, r, r * 0.7, 0, 0, 7); ctx.fill();
    const lift = z * s * 0.55;
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q.x, q.y - lift, r * (1 + z / 120), 0, 7); ctx.fill();
    ctx.strokeStyle = ring ? '#ff5d8f' : 'rgba(0,0,0,0.3)'; ctx.lineWidth = ring ? 2.5 : 1; ctx.stroke();
  }

  function draw() {
    // slow motion: the camera punches in on the cup so it reads as a replay, not as lag
    const sk = slowLevel(), camBase = cam;
    if (sk > 0.01 && S.anim) { const c = hole().cup, z = 1 + 1.1 * sk * sk * (3 - 2 * sk) / 1; cam = { ...cam, cx: cam.cx + (c.x - cam.cx) * sk * 0.85, cy: cam.cy + (c.y - cam.cy) * sk * 0.85, s: cam.s * z }; }
    try { drawScene(); } finally { cam = camBase; }
    drawSlowScreen();
    if (!S.callout) drawClipCap();
    drawCallout();
    drawParty();
  }
  function drawScene() {
    const h = hole(), s = cam.s;
    const shk = S.shake ? performance.now() - S.shake : 1e9;
    const sd_ = S.shakeBig ? 1100 : 320; ctx.save(); if (shk >= 0 && shk < sd_) { const a = (1 - shk / sd_) * (S.shakeBig ? 10 : 5) * (cv.width / cv.clientWidth); ctx.translate((Math.random() - 0.5) * a, (Math.random() - 0.5) * a); }
    drawTerrain(h, s);
    drawBoards(h);
    drawGhost(h);
    drawRival(h);
    drawRide(h);
    if (S.aim && !S.busy) drawAim();
    // balls: other sides first, then scramble markers, then the active ball
    S.sides.forEach((sd, i) => {
      if (sd.done || (S.cur && i === S.cur.side)) return;
      drawBall(sd.ball, 0, S.players[sd.players[0]].col, false);
    });
    if (S.mode === 'scramble' && S.sides[0].scr) {
      for (const r of S.sides[0].scr.res) if (r.end && !r.holed && !r.pen) drawBall(r.end, 0, S.players[r.player].col, false);
    }
    if (S.anim && S.anim.idx > 1 && S.cur && S.cur.player === 0) drawTrail(S.anim);
    if (S.cur) {
      const sd = side();
      drawSlowWorld();
      drawFx();
      if (S.anim) { if (!(S.anim.holed && S.anim.done)) drawBall(S.anim.cur, S.anim.z || 0, player().col, multi()); }
      else if (!sd.done) drawBall(sd.ball, 0, player().col, multi());
    }
    if (S.cur && !S.anim && !S.busy) {
      const sd = side();
      if (!sd.done) {
        const lbl = S.aim ? null : (S.bonus ? 'Blind shot' : Math.round(E.dist(sd.ball, h.cup)) + ' yds to pin');
        if (lbl) pill(W2S(sd.ball), lbl, -1);
      }
    }
    // fog (the GPS watch sees through it)
    const ref = S.cur ? side().ball : h.tee;
    if (h.mod === 'fog' && E.dist(ref, h.green) > 150 && !(S.cur && player().kit.tech === 'gps')) {
      const p = W2S(ref);
      const grd = ctx.createRadialGradient(p.x, p.y, 120 * s, p.x, p.y, 155 * s);
      grd.addColorStop(0, 'rgba(226,232,232,0)'); grd.addColorStop(1, 'rgba(226,232,232,0.96)');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, cv.width, cv.height);
    }
    vignette();
    brandBug(h);
    ctx.restore();
  }


  // ---------- the course, drawn properly ----------
  const TEX = {};
  function grassTex(base, seed) {
    // a small tile of speckled grass, so the rough reads as turf rather than flat paint
    if (TEX[base]) return TEX[base];
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = base; x.fillRect(0, 0, 64, 64);
    let r = seed || 7; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) { const l = rnd() < 0.5; x.fillStyle = l ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)'; x.fillRect(rnd() * 64, rnd() * 64, 1 + rnd() * 1.5, 1 + rnd() * 2.5); }
    return (TEX[base] = ctx.createPattern(c, 'repeat'));
  }
  function worldPattern(p, scaleK) {
    if (p && p.setTransform && window.DOMMatrix) { const o = W2S({ x: 0, y: 0 }); p.setTransform(new DOMMatrix().translateSelf(o.x, o.y).scaleSelf(scaleK, scaleK)); }
    return p;
  }
  function pathOf(pts) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); }
  function drawTerrain(h, s) {
    const dpr = cv.width / cv.clientWidth;
    // rough: textured turf with broad mowing bands
    ctx.fillStyle = worldPattern(grassTex(COL.rough, 11), Math.max(1, s * 0.45)); ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = 'rgba(0,0,0,0.045)';
    for (let y = -40; y < E.H + 40; y += 24) { const a = W2S({ x: -50 - E.XM, y }), b = W2S({ x: 450 + E.XM, y: y + 12 }); ctx.fillRect(0, a.y, cv.width, b.y - a.y); }
    const tl = W2S({ x: 4 - E.XM, y: 4 }), br = W2S({ x: E.W + E.XM - 4, y: E.H - 4 });
    ctx.fillStyle = 'rgba(20,40,20,0.55)';
    ctx.fillRect(0, 0, cv.width, Math.max(0, tl.y)); ctx.fillRect(0, br.y, cv.width, cv.height - br.y);
    ctx.fillRect(0, 0, Math.max(0, tl.x), cv.height); ctx.fillRect(br.x, 0, cv.width - br.x, cv.height);
    ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y); ctx.setLineDash([]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // buggy path: a pale ribbon down one side of the hole
    const side = (h.num % 2 ? 1 : -1), path = [];
    for (let i = 0; i < h.pts.length; i++) {
      const a = h.pts[Math.max(0, i - 1)], b = h.pts[Math.min(h.pts.length - 1, i + 1)], d = E.dist(a, b) || 1;
      const off = (i === h.pts.length - 1 ? h.GR + 14 : h.hw + 16) * side;
      path.push(W2S({ x: h.pts[i].x - (b.y - a.y) / d * off, y: h.pts[i].y + (b.x - a.x) / d * off }));
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 5.5 * s; pathOf(path); ctx.stroke();
    ctx.strokeStyle = '#cfc6a8'; ctx.lineWidth = 4 * s; pathOf(path); ctx.stroke();
    // first cut, then the fairway with diagonal mowing stripes
    const fp = h.fair.map(W2S);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = (h.hw * 2 + 7) * s; pathOf(fp); ctx.stroke();
    ctx.strokeStyle = '#4f9343'; ctx.lineWidth = (h.hw * 2 + 6) * s; pathOf(fp); ctx.stroke();
    ctx.strokeStyle = COL.fair; ctx.lineWidth = h.hw * 2 * s; pathOf(fp); ctx.stroke();
    const ang = Math.atan2(h.green.y - h.tee.y, h.green.x - h.tee.x) + Math.PI / 2;
    if (!h._mow) {
      const m = document.createElement('canvas'); h._mow = m;
    }
    const m = h._mow; if (m.width !== cv.width || m.height !== cv.height) { m.width = cv.width; m.height = cv.height; }
    const mx = m.getContext('2d'); mx.clearRect(0, 0, m.width, m.height);
    mx.lineCap = 'round'; mx.lineJoin = 'round'; mx.strokeStyle = '#000'; mx.lineWidth = (h.hw * 2 - 1) * s;
    mx.beginPath(); fp.forEach((p, i) => i ? mx.lineTo(p.x, p.y) : mx.moveTo(p.x, p.y)); mx.stroke();
    mx.globalCompositeOperation = 'source-in'; mx.fillStyle = 'rgba(255,255,255,0.13)';
    mx.save(); const o = W2S(h.tee); mx.translate(o.x, o.y); mx.rotate(ang);
    const band = 9 * s; for (let k = -60; k < 60; k += 2) mx.fillRect(k * band, -3000, band, 6000);
    mx.restore(); mx.globalCompositeOperation = 'source-over';
    ctx.drawImage(m, 0, 0);
    // tee box: neat stripes and branded gold markers
    const t = W2S(h.tee);
    ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(ang - Math.PI / 2);
    ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-12 * s + 1.5, -8 * s + 1.5, 24 * s, 16 * s);
    ctx.fillStyle = COL.fair2; ctx.fillRect(-12 * s, -8 * s, 24 * s, 16 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; for (let i = 0; i < 4; i++) if (i % 2) ctx.fillRect(-12 * s + i * 6 * s, -8 * s, 6 * s, 16 * s);
    ctx.fillStyle = '#e3b23c'; ctx.strokeStyle = '#16241c'; ctx.lineWidth = Math.max(1, s * 0.3);
    for (const dx of [-9, 9]) { ctx.beginPath(); ctx.arc(dx * s, -5 * s, 1.5 * s, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    // water: deep-to-shallow gradient, a pale shore and a few glints
    for (const w of h.water) {
      ell(w, 2); ctx.fillStyle = 'rgba(214,236,246,0.9)'; ctx.fill();
      ell(w, 0.6); ctx.fillStyle = '#7cc0e3'; ctx.fill();
      const c = W2S(w), R = Math.max(w.rx, w.ry) * s;
      const g = ctx.createRadialGradient(c.x - R * 0.2, c.y - R * 0.2, R * 0.1, c.x, c.y, R);
      g.addColorStop(0, '#2f7fb8'); g.addColorStop(1, '#3f9bd0');
      ell(w, -1.2); ctx.fillStyle = g; ctx.fill();
      ctx.save(); ell(w, -2); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = Math.max(1, s * 0.5);
      for (let i = -2; i <= 2; i++) { const yy = c.y + i * w.ry * 0.35 * s, xx = c.x + ((i * 37) % 3) * w.rx * 0.15 * s; ctx.beginPath(); ctx.moveTo(xx - 5 * s, yy); ctx.quadraticCurveTo(xx, yy - 1.4 * s, xx + 5 * s, yy); ctx.stroke(); }
      ctx.restore();
    }
    // where the buggy path crosses water, it becomes a little timber bridge
    if (h.water.length) {
      ctx.save(); ctx.beginPath();
      for (const w of h.water) { const c = W2S(w); ctx.moveTo(c.x, c.y); ctx.ellipse(c.x, c.y, (w.rx + 2.5) * s, (w.ry + 2.5) * s, w.rot || 0, 0, Math.PI * 2); }
      ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 6.5 * s; ctx.lineCap = 'butt'; pathOf(path); ctx.stroke();
      ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = 5 * s; pathOf(path); ctx.stroke();
      ctx.strokeStyle = '#a7845a'; ctx.lineWidth = 3.6 * s; ctx.setLineDash([1.2 * s, 0.5 * s]); pathOf(path); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore(); ctx.lineCap = 'round';
    }
    // green: fringe ring, soft shadow, then the putting surface
    const g = W2S(h.green);
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.beginPath(); ctx.arc(g.x + 1.2 * s, g.y + 1.6 * s, (h.GR + 3.4) * s, 0, 7); ctx.fill();
    ctx.fillStyle = COL.fringe; ctx.beginPath(); ctx.arc(g.x, g.y, (h.GR + 3) * s, 0, 7); ctx.fill();
    const gg = ctx.createRadialGradient(g.x - h.GR * 0.35 * s, g.y - h.GR * 0.35 * s, 2, g.x, g.y, h.GR * s);
    gg.addColorStop(0, '#93d97c'); gg.addColorStop(1, COL.green);
    ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(g.x, g.y, h.GR * s, 0, 7); ctx.fill();
    if (!h.ridge || S.revealed) drawGreenRead(h);
    // bunkers: raised lip, inner shadow, rake lines
    for (const b of h.bunkers) {
      ell(b, 1.6); ctx.fillStyle = '#4f9343'; ctx.fill();
      ell(b, 0.6); ctx.fillStyle = COL.sandEdge; ctx.fill();
      const c = W2S(b), R = Math.max(b.rx, b.ry) * s, sg = ctx.createRadialGradient(c.x + R * 0.15, c.y + R * 0.2, R * 0.2, c.x, c.y, R);
      sg.addColorStop(0, '#f3e4b8'); sg.addColorStop(1, '#dcc58c');
      ell(b); ctx.fillStyle = sg; ctx.fill();
      ctx.save(); ell(b, -0.8); ctx.clip(); ctx.translate(c.x, c.y); ctx.rotate((b.rot || 0) + 0.4);
      ctx.strokeStyle = 'rgba(160,130,70,0.18)'; ctx.lineWidth = Math.max(0.8, s * 0.25);
      for (let k = -R; k < R; k += 1.6 * s) { ctx.beginPath(); ctx.moveTo(-R, k); ctx.lineTo(R, k); ctx.stroke(); }
      ctx.restore();
    }
    // cup and flag, with a flag shadow on the turf
    const c = W2S(h.cup), fpx = cv.width / (cv.clientWidth || cv.width), fh = Math.max(22, Math.min(9 * s, 70 * fpx)), fw = Math.max(1.5, Math.min(s * 0.5, 3 * fpx)); // capped in close-ups
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = fw; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + fh * 0.5, c.y - fh * 0.12); ctx.stroke();
    ctx.fillStyle = '#163016'; ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(3, E.capR(h) * 1.1 * s), 0, 7); ctx.fill();
    ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = fw;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y - fh); ctx.stroke();
    ctx.fillStyle = '#e8483b'; ctx.beginPath(); ctx.moveTo(c.x, c.y - fh); ctx.lineTo(c.x + fh * 0.55, c.y - fh * 0.82); ctx.lineTo(c.x, c.y - fh * 0.64); ctx.fill();
    if (h.ridge && !S.revealed) drawRidge(h);
    // trees: a cluster of lobes per tree, lit from the top left
    for (const tr of h.trees) { const p = W2S(tr); ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(p.x + 3.5 * s, p.y + 3 * s, tr.r * 1.05 * s, tr.r * 0.95 * s, 0.4, 0, 7); ctx.fill(); }
    for (const tr of h.trees) {
      const p = W2S(tr), R = tr.r * s, k = ((tr.x * 13 + tr.y * 7) | 0) % 5;
      const lobes = [[0, 0, 1], [-0.45, -0.3, 0.62], [0.45, -0.2, 0.6], [0.1, 0.45, 0.6], [-0.35, 0.35, 0.5]].slice(0, 3 + (k % 3));
      for (const [dx, dy, rr] of lobes) { ctx.fillStyle = COL.tree; ctx.beginPath(); ctx.arc(p.x + dx * R, p.y + dy * R, R * rr, 0, 7); ctx.fill(); }
      for (const [dx, dy, rr] of lobes) { ctx.fillStyle = COL.treeHi; ctx.beginPath(); ctx.arc(p.x + dx * R - R * rr * 0.25, p.y + dy * R - R * rr * 0.28, R * rr * 0.55, 0, 7); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(p.x - R * 0.35, p.y - R * 0.4, R * 0.25, 0, 7); ctx.fill();
    }
    drawTeeSign(h, dpr);
  }
  // a sponsored tee sign on every hole, the way real courses do it
  function drawTeeSign(h, dpr) {
    if (S.bonus) return;
    const t = W2S(h.tee), w = 104 * dpr, hh = 40 * dpr;
    const gap = Math.max(16 * cam.s, 66 * dpr);
    let x = t.x + gap; if (x + w > cv.width - 6 * dpr) x = t.x - gap - w;
    let y = t.y - hh / 2 + 8 * dpr; y = Math.min(Math.max(y, 6 * dpr), cv.height - hh - 36 * dpr);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(x + 2 * dpr, y + 3 * dpr, w, hh, 6 * dpr); ctx.fill();
    ctx.fillStyle = '#143f27'; rr(x, y, w, hh, 6 * dpr); ctx.fill();
    ctx.strokeStyle = '#e3b23c'; ctx.lineWidth = 1.5 * dpr; rr(x + 2 * dpr, y + 2 * dpr, w - 4 * dpr, hh - 4 * dpr, 5 * dpr); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.fillStyle = '#e3b23c'; ctx.font = `800 ${18 * dpr}px system-ui, sans-serif`; ctx.fillText(String(h.num), x + 9 * dpr, y + 15 * dpr);
    ctx.fillStyle = '#f4efe1'; ctx.font = `700 ${8.5 * dpr}px system-ui, sans-serif`;
    ctx.fillText(`PAR ${h.par} · ${h.length} YDS`, x + 30 * dpr, y + 11 * dpr);
    ctx.font = `600 ${8 * dpr}px system-ui, sans-serif`; ctx.globalAlpha = 0.8;
    let nm = h.name || ''; while (ctx.measureText(nm).width > w - 36 * dpr && nm.length > 3) nm = nm.slice(0, -2); if (nm !== (h.name || '')) nm = nm.trim() + '…';
    ctx.fillText(nm, x + 30 * dpr, y + 21 * dpr); ctx.globalAlpha = 1;
    ctx.fillStyle = '#0d2a19'; ctx.fillRect(x + 3 * dpr, y + hh - 13 * dpr, w - 6 * dpr, 10 * dpr);
    brandWord(x + w / 2, y + hh - 8 * dpr, 7.5 * dpr, 'center');
    ctx.restore();
  }
  function rr(x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
  function brandWord(x, y, size, align) {
    ctx.font = `800 ${size}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
    const parts = [['Golf', '#ffffff'], ['Price', '#3fae29'], [' AI', '#ffffff']];
    const tw = parts.reduce((a, [t]) => a + ctx.measureText(t).width, 0);
    let cx = align === 'center' ? x - tw / 2 : x;
    for (const [t, c] of parts) { ctx.fillStyle = c; ctx.textAlign = 'left'; ctx.fillText(t, cx, y); cx += ctx.measureText(t).width; }
    return tw;
  }
  // broadcast-style corner bug, so every screenshot carries the brand
  function brandBug(h) {
    const dpr = cv.width / cv.clientWidth, x = 8 * dpr, y = cv.height - 30 * dpr;
    ctx.save(); ctx.font = `800 ${11 * dpr}px system-ui, sans-serif`;
    const t2 = `  Wild Nine #${(S.cfg && S.cfg.day) || dayNo}`, w1 = ['Golf', 'Price', ' AI'].reduce((a, t) => a + ctx.measureText(t).width, 0);
    ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`; const w2 = ctx.measureText(t2).width;
    const w = w1 + w2 + 18 * dpr, hh = 22 * dpr;
    ctx.fillStyle = 'rgba(10,30,18,0.78)'; rr(x, y, w, hh, hh / 2); ctx.fill();
    ctx.fillStyle = '#3fae29'; ctx.beginPath(); ctx.arc(x + 10 * dpr, y + hh / 2, 3 * dpr, 0, 7); ctx.fill();
    brandWord(x + 16 * dpr, y + hh / 2 + 0.5 * dpr, 11 * dpr);
    ctx.font = `600 ${10 * dpr}px system-ui, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(t2, x + 16 * dpr + w1, y + hh / 2 + 0.5 * dpr);
    ctx.restore();
  }
  function vignette() {
    const R = Math.hypot(cv.width, cv.height) / 2, g = ctx.createRadialGradient(cv.width / 2, cv.height / 2, R * 0.6, cv.width / 2, cv.height / 2, R);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,20,8,0.28)'); ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  }

  // ---------- course advertising: our own boards, never anyone else's ----------
  function boardSpots(h) {
    if (h._boards) return h._boards;
    let bx0 = Infinity, bx1 = -Infinity;
    for (const q of h.pts) { bx0 = Math.min(bx0, q.x); bx1 = Math.max(bx1, q.x); }
    bx0 = Math.min(bx0, h.green.x - 45) - 30; bx1 = Math.max(bx1, h.green.x + 45) + 30;
    // the full-hole view is also widened to the screen's shape, so allow a little extra room
    const view = (p, half) => p.x - half >= Math.max(6, bx0 - 20) && p.x + half <= Math.min(E.W - 6, bx1 + 20);
    const out = [], ok = p => p.x > 50 && p.x < E.W - 50 && p.y > 20 && p.y < E.H - 14 &&
      ['rough', 'tee'].includes(E.terrainAt(h, p)) && E.terrainAt(h, { x: p.x - 42, y: p.y }) === 'rough' && E.terrainAt(h, { x: p.x + 42, y: p.y }) === 'rough' &&
      !h.trees.some(t => Math.abs(t.x - p.x) < 44 + t.r && Math.abs(t.y - p.y) < 10 + t.r);
    const prev = h.pts[h.pts.length - 2] || h.tee, g = h.green, d = E.dist(prev, g) || 1;
    for (const k of [h.GR + 34, h.GR + 48, h.GR + 62]) {
      const p = { x: g.x + (g.x - prev.x) / d * k, y: g.y + (g.y - prev.y) / d * k };
      if (ok(p)) { out.push({ ...p, text: h.num % 2 ? 'Full Swing. Not full price.' : 'Stop overpaying for golf gear.' }); break; }
    }
    const P = window.WN_PROMO;
    if (P) {
      const cands = [];
      for (let si = 0; si < h.pts.length - 1; si++) for (const t of [0.5, 0.7, 0.35, 0.85]) {
        const a = h.pts[si], b = h.pts[si + 1];
        for (const off of [h.hw + 52, -(h.hw + 52), h.hw + 74, -(h.hw + 74)]) cands.push({ x: a.x + (b.x - a.x) * t + off, y: a.y + (b.y - a.y) * t });
      }
      for (const p of cands) {
        if (view(p, 56) && ok(p) && ['rough'].includes(E.terrainAt(h, { x: p.x - 55, y: p.y })) && ['rough'].includes(E.terrainAt(h, { x: p.x + 55, y: p.y })) && !h.trees.some(t => Math.abs(t.x - p.x) < 58 + t.r && Math.abs(t.y - p.y) < 14 + t.r) && !out.some(o => E.dist(o, p) < 40) && !h.bunkers.some(b => E.dist(b, p) < 30) && !h.water.some(w => E.dist(w, p) < w.rx + 30)) {
          out.push({ ...p, kind: 'promo', label: h.num % 2 ? 'THE BAG DRAFT' : 'DEAL OF THE DAY',
            text: h.num % 2 ? P.major : `${shortName(P.deal.name)} \u00A3${Math.round(P.deal.now)}, down ${P.deal.pct}%` });
          break;
        }
      }
    }
    h._boards = out; return out;
  }
  const BR = { ink: '#16241c', green: '#3fae29', dark: '#2f8a1f', gold: '#f5a623' };
  function fitFont(text, maxW, size) { ctx.font = `800 ${size}px system-ui, sans-serif`; const tw = ctx.measureText(text).width; if (tw > maxW) { size *= maxW / tw; ctx.font = `800 ${size}px system-ui, sans-serif`; } return size; }
  function pinMark(x, y, r) { // the GolfPrice AI map pin with a ball, simplified
    ctx.fillStyle = BR.ink; ctx.beginPath(); ctx.arc(x, y - r * 0.2, r, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(x, y + r * 1.25); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 0.66, 0, 7); ctx.fill();
    ctx.strokeStyle = BR.green; ctx.lineWidth = Math.max(1, r * 0.28); ctx.beginPath(); ctx.ellipse(x, y + r * 0.05, r * 1.35, r * 0.42, -0.35, Math.PI * 0.95, Math.PI * 1.95, true); ctx.stroke();
  }
  function drawLogoBoard(p, w, hh, s) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
    ctx.fillStyle = BR.green; ctx.fillRect(p.x - w / 2, p.y + hh / 2 - 1.2 * s, w, 1.2 * s);
    pinMark(p.x - w / 2 + 8 * s, p.y - 0.5 * s, 4 * s);
    const parts = [['Golf', BR.ink], ['Price', BR.green], [' AI', BR.ink]], txt = parts.map(x => x[0]).join('');
    const fs = fitFont(txt, w - 20 * s, 9 * s);
    let x = p.x - w / 2 + 16 * s; ctx.textBaseline = 'middle';
    for (const [t, c] of parts) { ctx.fillStyle = c; ctx.fillText(t, x, p.y); x += ctx.measureText(t).width; }
    ctx.textBaseline = 'alphabetic';
  }
  function shortName(n) { return n.replace(/\b(Driver|Fairway Wood|Hybrid|Irons|Putter|Golf Balls|Launch Monitor|Laser Rangefinder)\b.*$/, '$1').replace(/^(Callaway|TaylorMade|Titleist|Ping|PING|Cobra|Mizuno|Srixon|Cleveland|Odyssey|Wilson|Bushnell|Garmin) /, '$1 ').slice(0, 34); }
  function drawPromoBoard(p, w, hh, s, b) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(p.x - w / 2 + 2 * s, p.y - hh / 2 + 2 * s, w, hh);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
    ctx.fillStyle = b.label === 'THE BAG DRAFT' ? BR.ink : BR.green; ctx.fillRect(p.x - w / 2, p.y - hh / 2, w, hh * 0.38);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    fitFont(b.label, w - 8 * s, hh * 0.24); ctx.fillStyle = b.label === 'THE BAG DRAFT' ? BR.gold : '#ffffff'; ctx.fillText(b.label, p.x, p.y - hh * 0.31);
    fitFont(b.text, w - 8 * s, hh * 0.3); ctx.fillStyle = BR.ink; ctx.fillText(b.text, p.x, p.y + hh * 0.18);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  function drawSloganBoard(p, w, hh, s, text) {
    ctx.fillStyle = BR.ink; ctx.fillRect(p.x - w / 2, p.y - hh / 2, w, hh);
    ctx.fillStyle = BR.green; ctx.fillRect(p.x - w / 2, p.y - hh / 2, 2.2 * s, hh); ctx.fillRect(p.x + w / 2 - 2.2 * s, p.y - hh / 2, 2.2 * s, hh);
    fitFont(text, w - 10 * s, 7.5 * s);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, p.x, p.y + 0.2 * s);
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }
  // ---------- reading the greens ----------
  function greenRange(h) {
    if (h._hr) return h._hr;
    let lo = Infinity, hi = -Infinity;
    for (let x = -h.GR; x <= h.GR; x += 2) for (let y = -h.GR; y <= h.GR; y += 2) {
      if (x * x + y * y > h.GR * h.GR) continue;
      const v = E.heightAt(h, { x: h.green.x + x, y: h.green.y + y }); lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    return (h._hr = { lo, hi: hi > lo ? hi : lo + 1 });
  }
  function drawGreenRead(h) {
    const s = cam.s, g = W2S(h.green), R = h.GR * s, rg = greenRange(h);
    const near = s * (cv.clientWidth / cv.width) > 3.2; // zoomed in around the green
    ctx.save(); ctx.beginPath(); ctx.arc(g.x, g.y, R, 0, 7); ctx.clip();
    // light = high ground, dark = low ground: a smooth shaded map, cached per hole
    if (h._shade && h._shadeCb !== SET.cb) h._shade = null;
    if (!h._shade) {
      h._shadeCb = SET.cb; const AL = SET.cb ? 215 : 120;
      const N = 48, c2 = document.createElement('canvas'); c2.width = N; c2.height = N;
      const g2 = c2.getContext('2d'), img = g2.createImageData(N, N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const wx = h.green.x - h.GR + (i + 0.5) / N * 2 * h.GR, wy = h.green.y - h.GR + (j + 0.5) / N * 2 * h.GR;
        const v = (E.heightAt(h, { x: wx, y: wy }) - rg.lo) / (rg.hi - rg.lo), k = (j * N + i) * 4;
        if (v > 0.5) { img.data[k] = 255; img.data[k + 1] = 255; img.data[k + 2] = 220; img.data[k + 3] = (v - 0.5) * 2 * AL; }
        else { img.data[k] = 8; img.data[k + 1] = 45; img.data[k + 2] = 18; img.data[k + 3] = (0.5 - v) * 2 * AL; }
      }
      g2.putImageData(img, 0, 0); h._shade = c2;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(h._shade, g.x - R, g.y - R, 2 * R, 2 * R);
    // contour lines (marching squares), when zoomed in
    if (near) {
    const M = 26, cs = 2 * h.GR / M, lv = 8;
    const H = (i, j) => (E.heightAt(h, { x: h.green.x - h.GR + i * cs, y: h.green.y - h.GR + j * cs }) - rg.lo) / (rg.hi - rg.lo) * lv;
    if (!h._grid) { h._grid = []; for (let j = 0; j <= M; j++) { h._grid[j] = []; for (let i = 0; i <= M; i++) h._grid[j][i] = H(i, j); } }
    const G2 = h._grid, P = (i, j) => W2S({ x: h.green.x - h.GR + i * cs, y: h.green.y - h.GR + j * cs });
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let L = 1; L < lv; L++) for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const v = [G2[j][i], G2[j][i + 1], G2[j + 1][i + 1], G2[j + 1][i]], cr = [];
      const e = [[0, 1, [i, j], [i + 1, j]], [1, 2, [i + 1, j], [i + 1, j + 1]], [2, 3, [i + 1, j + 1], [i, j + 1]], [3, 0, [i, j + 1], [i, j]]];
      for (const [a, b, pa, pb] of e) if ((v[a] - L) * (v[b] - L) < 0) { const t = (L - v[a]) / (v[b] - v[a]); cr.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]); }
      if (cr.length >= 2) { const p1 = P(cr[0][0], cr[0][1]), p2 = P(cr[1][0], cr[1][1]); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); }
    }
    ctx.stroke();
    }
    // downhill arrows: longer means steeper
    const sp = near ? 5 : 9;
    const aw = Math.max(1, s * (near ? 0.35 : 0.5));
    for (const pass of SET.cb ? [0, 1] : [1])
    for (let x = -h.GR + sp / 2; x < h.GR; x += sp) for (let y = -h.GR + sp / 2; y < h.GR; y += sp) {
      if (x * x + y * y > (h.GR - 2) ** 2) continue;
      const w = { x: h.green.x + x, y: h.green.y + y }, a = E.slopeAt(h, w), m = Math.hypot(a.x, a.y);
      if (m < 2) continue;
      const L = (0.8 + m / 32 * (near ? 2.8 : 3.6)), ux = a.x / m, uy = a.y / m, p = W2S(w);
      ctx.strokeStyle = pass ? (SET.cb ? '#ffffff' : 'rgba(255,255,255,0.7)') : 'rgba(0,0,0,0.75)'; ctx.lineWidth = pass ? aw * (SET.cb ? 1.3 : 1) : aw * 1.3 + 2.5;
      ctx.beginPath(); ctx.moveTo(p.x - ux * L * s, p.y - uy * L * s); ctx.lineTo(p.x + ux * L * s, p.y + uy * L * s);
      ctx.lineTo(p.x + (ux * (L - 0.9) - uy * 0.8) * s, p.y + (uy * (L - 0.9) + ux * 0.8) * s); ctx.stroke();
    }
    // water-on-the-green dots that drift downhill: the joy of reading it
    if (near) {
      const fl = h._flow || (h._flow = Array.from({ length: 22 }, () => ({ x: 0, y: 0, life: 0 })));
      for (const d of fl) {
        if (d.life <= 0) { const r = Math.random() * h.GR * 0.95, t = Math.random() * 6.283; d.x = h.green.x + Math.cos(t) * r; d.y = h.green.y + Math.sin(t) * r; d.life = 60 + Math.random() * 60; }
        const a = E.slopeAt(h, d); d.x += a.x * 0.006; d.y += a.y * 0.006; d.life--;
        if (E.dist(d, h.green) > h.GR) d.life = 0;
        const p = W2S(d); ctx.fillStyle = `rgba(200,235,255,${Math.min(1, d.life / 40) * 0.8})`; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2, s * 0.32), 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawBoards(h) {
    const s = cam.s;
    for (const b of boardSpots(h)) {
      const p = W2S(b), w = 84 * s, hh = 15 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(p.x - w / 2 + 2 * s, p.y - hh / 2 + 2 * s, w, hh);
      if (b.kind === 'logo') drawLogoBoard(p, w, hh, s); else if (b.kind === 'promo') drawPromoBoard(p, w * 1.25, hh * 1.5, s, b); else drawSloganBoard(p, w, hh, s, b.text);
    }
  }

  // the trolley or buggy parks beside your ball and drives up after each shot
  function drawRide(h) {
    if (!S.cur || S.bonus || S.cur.player !== 0) return;
    const rd = look(null, 'ride');
    if (!rd.ride) return;
    const sd = side(), b = sd.ball, d = E.dist(b, h.cup) || 1;
    const ux = (h.cup.x - b.x) / d, uy = (h.cup.y - b.y) / d;
    const off = rd.ride === 'buggy' ? 9 : 4.5;
    const tgt = { x: b.x - uy * off - ux * 3, y: b.y + ux * off - uy * 3, a: Math.atan2(uy, ux) };
    if (E.terrainAt(h, b) === 'green' || E.dist(b, h.green) < (h.GR || 12) + off) {
      // park just off the green, on the side you came from
      const g = h.green, from = h.bend && E.dist(h.bend, h.green) > 60 ? h.bend : h.tee, gx = from.x - g.x, gy = from.y - g.y, gd = Math.hypot(gx, gy) || 1, R0 = (h.GR || 12) + off + 3;
      tgt.x = g.x + gx / gd * R0 - gy / gd * off; tgt.y = g.y + gy / gd * R0 + gx / gd * off; tgt.a = Math.atan2(-gy, -gx);
    }
    if (E.terrainAt(h, tgt) === 'water') return; // island greens: you walk the bridge
    if (!S.ride || S.ride.hole !== S.h) S.ride = { x: tgt.x, y: tgt.y, a: tgt.a, hole: S.h };
    const R = S.ride, k = S.anim ? 0 : 0.06;
    R.x += (tgt.x - R.x) * k; R.y += (tgt.y - R.y) * k;
    let da = tgt.a - R.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; R.a += da * k;
    const p = W2S(R), s = cam.s;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(R.a);
    if (rd.ride === 'buggy') {
      const L = 7 * s, Wd = 4 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-L / 2 + s, -Wd / 2 + s, L, Wd);
      const pt = look(null, 'paint'), wh = look(null, 'wheels');
      ctx.fillStyle = wh.hub === '#9aa0a6' ? '#111' : wh.hub; for (const [x, y] of [[-L * 0.32, -Wd * 0.55], [L * 0.32, -Wd * 0.55], [-L * 0.32, Wd * 0.55], [L * 0.32, Wd * 0.55]]) ctx.fillRect(x - s * 0.8, y - s * 0.4, s * 1.6, s * 0.8);
      ctx.fillStyle = pt.paint || rd.c; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(-L / 2, -Wd / 2, L, Wd, s); else ctx.rect(-L / 2, -Wd / 2, L, Wd); ctx.fill();
      if (pt.stripe) { ctx.fillStyle = pt.stripe; ctx.fillRect(-L / 2, -s * 0.25, L, s * 0.5); }
      ctx.fillStyle = pt.roof || rd.roof; ctx.fillRect(-L * 0.3, -Wd / 2, L * 0.55, Wd);
      if ((wallet().extras || []).includes('x_cool')) { ctx.fillStyle = '#2e7fd1'; ctx.fillRect(-L / 2 - s * 1.6, -Wd * 0.25, s * 1.1, Wd * 0.5); }
      ctx.fillStyle = look(null, 'bag').c; ctx.fillRect(-L / 2 - s * 0.4, -Wd * 0.3, s * 1.2, Wd * 0.6);
    } else {
      const r = 1.6 * s;
      ctx.strokeStyle = rd.c; ctx.lineWidth = Math.max(1, s * 0.35); ctx.beginPath(); ctx.moveTo(-r * 1.2, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke();
      ctx.fillStyle = '#111'; ctx.fillRect(-r * 1.4, -r * 1.1, r * 0.6, r * 0.5); ctx.fillRect(-r * 1.4, r * 0.6, r * 0.6, r * 0.5);
      ctx.fillStyle = look(null, 'bag').c; ctx.beginPath(); ctx.arc(-r * 0.3, 0, r * 0.75, 0, 7); ctx.fill();
      if (rd.ride === 'electric') { ctx.fillStyle = '#3fae29'; ctx.fillRect(-r * 0.6, r * 0.55, r * 0.6, r * 0.3); }
    }
    ctx.restore();
  }

  function hexA(h, a) { const n = parseInt((h || '#e3b23c').slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function drawTrail(A) {
    const kind = look(null, 'trail').trail;
    if (!kind) return;
    const s = cam.s, n = A.idx;
    for (let i = 1; i <= n; i++) {
      const a = A.path[i - 1], b = A.path[i], pa = W2S(a), pb = W2S(b);
      const fade = 0.25 + 0.75 * (i / n);
      ctx.strokeStyle = kind === 'season' ? hexA(look(null, 'trail').c, fade) : kind === 'gold' ? `rgba(227,178,60,${fade})` : kind === 'smoke' ? `rgba(240,240,240,${fade * 0.45})` : `hsla(${(i * 9) % 360},90%,60%,${fade})`;
      ctx.lineWidth = (kind === 'smoke' ? 5 : 2.5) * Math.max(1, s * 0.6);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y - (a.z || 0) * s * 0.55); ctx.lineTo(pb.x, pb.y - (b.z || 0) * s * 0.55); ctx.stroke();
    }
  }

  function pill(p, text, dir) {
    const dpr = cv.width / cv.clientWidth;
    ctx.save(); ctx.font = `700 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
    const w = ctx.measureText(text).width + 14 * dpr, hh = 20 * dpr;
    let x = Math.min(Math.max(p.x - w / 2, 4), cv.width - w - 4), y = p.y + (dir < 0 ? -hh - 12 * dpr : 12 * dpr);
    if (y < 4) y = p.y + 12 * dpr;
    ctx.fillStyle = 'rgba(10,30,18,0.82)'; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, hh, hh / 2); else ctx.rect(x, y, w, hh);
    ctx.fill(); ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 7 * dpr, y + hh / 2); ctx.restore();
  }
  function drawRidge(h) {
    const c = W2S(h.green), s = cam.s;
    const grd = ctx.createRadialGradient(c.x, c.y + 10 * s, 5 * s, c.x, c.y, 75 * s);
    grd.addColorStop(0, '#4f8a43'); grd.addColorStop(0.75, '#3d7536'); grd.addColorStop(1, 'rgba(61,117,54,0)');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(c.x, c.y + 6 * s, 80 * s, 56 * s, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1.5;
    for (const k of [0.35, 0.55, 0.75]) { ctx.beginPath(); ctx.ellipse(c.x, c.y + 6 * s, 80 * s * k, 56 * s * k, 0, 0, 7); ctx.stroke(); }
    // just the top of the flag pokes over the hill
    const q = W2S(h.cup), fh = Math.max(22, 9 * s);
    ctx.strokeStyle = '#f4f4f4'; ctx.lineWidth = Math.max(1.5, s * 0.5);
    ctx.beginPath(); ctx.moveTo(q.x, q.y - fh * 0.45); ctx.lineTo(q.x, q.y - fh); ctx.stroke();
    ctx.fillStyle = '#e8483b'; ctx.beginPath(); ctx.moveTo(q.x, q.y - fh); ctx.lineTo(q.x + fh * 0.55, q.y - fh * 0.82); ctx.lineTo(q.x, q.y - fh * 0.64); ctx.fill();
  }

  function shotFlags() {
    const sd = side();
    return { ...sd.holeFlags, tailwind: sd.armed.tailwind, bigstick: sd.armed.bigstick, steady: sd.armed.steady, bounceback: sd.armed.bounceback, laser: !!sd.armed.laser && S.club !== 'putter', shape: S.club === 'putter' ? null : engShape(S.shape) };
  }
  function engShape(s) { return !SET.lefty || !s ? s : s === 'draw' ? 'fade' : 'draw';
  }

  function drawAim() {
    const h = hole(), a = S.aim, s = cam.s, sd = side(), P = player();
    const b = W2S(sd.ball);
    if (sd.armed.laser && S.club !== 'putter') {
      // Laser Line shows the flight and exactly where it lands; how it runs out after that is still the golfer's read
      const pl = E.planShot(h, sd.ball, S.club, a.ang, a.power, shotFlags(), () => 0.5, P.kit);
      const li = pl.carryEnd ? pl.path.findIndex(p => p.x === pl.carryEnd.x && p.y === pl.carryEnd.y) : -1;
      const fl = li >= 0 ? pl.path.slice(0, li + 1) : pl.path;
      ctx.save(); ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]);
      ctx.beginPath(); fl.forEach((p, i) => { const q = W2S(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke();
      const e = W2S(pl.carryEnd || fl[fl.length - 1]);
      ctx.setLineDash([]); ctx.beginPath(); ctx.arc(e.x, e.y, 6, 0, 7); ctx.stroke(); ctx.restore();
      return;
    }
    let end;
    const lie = E.terrainAt(h, sd.ball);
    if (S.club === 'putter') {
      const r = a.power * 90 * (lie === 'green' ? 1 : 0.6) * 0.55;
      end = { x: sd.ball.x + Math.cos(a.ang) * r, y: sd.ball.y + Math.sin(a.ang) * r };
    } else {
      const carry = E.carryFor(S.club, lie, a.power, shotFlags(), P.kit);
      const es = engShape(S.shape), Cv = es === 'draw' ? 0.09 * carry : es === 'fade' ? -0.09 * carry : 0;
      const dx = Math.cos(a.ang), dy = Math.sin(a.ang);
      end = { x: sd.ball.x + dx * carry + dy * Cv, y: sd.ball.y + dy * carry - dx * Cv };
      let wx = 0, wy = 0;
      if (P.kit.tech === 'rangefinder') { const w = E.windVec(h, shotFlags(), sd.ball), C = E.CLUBS[S.club], B = E.BALLS[P.kit.ball], k = 0.9 * C.wind * B.wind * (carry / C.carry); wx = w.x * k; wy = w.y * k; }
      a.curvePts = Cv ? Array.from({ length: 17 }, (_, i) => { const t = i / 16; return { x: sd.ball.x + dx * carry * t + dy * Cv * t * t + wx * t, y: sd.ball.y + dy * carry * t - dx * Cv * t * t + wy * t }; }) : null;
      end = { x: end.x + wx, y: end.y + wy };
    }
    const e = W2S(end);
    const hot = a.power > E.sprayStart(shotFlags(), P.kit) && !sd.armed.steady;
    const putt = S.club === 'putter';
    // the putt line is gold, so it never blends into the white slope arrows on the green
    if (putt) { ctx.save(); ctx.strokeStyle = 'rgba(10,30,18,0.55)'; ctx.lineWidth = 4.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(e.x, e.y); ctx.stroke(); ctx.restore(); }
    ctx.save(); ctx.strokeStyle = hot ? '#ff7a59' : putt ? (SET.cb ? '#ff9e1b' : '#ffd23f') : 'rgba(255,255,255,0.9)'; ctx.lineWidth = putt ? 2.6 : 2; ctx.setLineDash(putt ? [6, 4] : [5, 5]);
    ctx.beginPath();
    if (a.curvePts && S.club !== 'putter') a.curvePts.forEach((q, i) => { const w2 = W2S(q); i ? ctx.lineTo(w2.x, w2.y) : ctx.moveTo(w2.x, w2.y); });
    else { ctx.moveTo(b.x, b.y); ctx.lineTo(e.x, e.y); }
    ctx.stroke(); ctx.setLineDash([]);
    if (S.club !== 'putter') {
      const sc = Math.max(5, E.dist(sd.ball, end) * (sd.armed.steady ? 0.02 : 0.05) * s);
      ctx.beginPath(); ctx.ellipse(e.x, e.y, sc, sc * 0.75, Math.atan2(end.y - sd.ball.y, end.x - sd.ball.x), 0, 7); ctx.stroke();
      ctx.fillStyle = hot ? 'rgba(255,122,89,0.18)' : 'rgba(255,255,255,0.14)'; ctx.fill();
    }
    if (putt) { ctx.setLineDash([]); ctx.fillStyle = SET.cb ? '#ff9e1b' : '#ffd23f'; ctx.strokeStyle = 'rgba(10,30,18,0.7)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, 7); ctx.fill(); ctx.stroke(); }
    ctx.restore();
    if (S.club !== 'putter') {
      const carry = Math.round(E.dist(sd.ball, end));
      pill(e, S.bonus ? `Carry ${carry}` : `Carry ${carry} · ${Math.round(E.dist(end, h.cup))} to pin`, 1);
    }
  }

  // ---------- loop ----------
  function frame(tnow) {
    if (camT) {
      const k = Math.min(1, (tnow - camT.t0) / 450), q = k * k * (3 - 2 * k);
      cam = { cx: camT.from.cx + (camT.to.cx - camT.from.cx) * q, cy: camT.from.cy + (camT.to.cy - camT.from.cy) * q, s: camT.from.s + (camT.to.s - camT.from.s) * q };
      if (k >= 1) camT = null;
    }
    if (S && S.anim && !S.anim.done) stepAnim(tnow);
    if (S) draw();
    coachTick();
    requestAnimationFrame(frame);
  }
  // ---- the big moments: a callout, the crowd, a burst of colour ----
  function epic(sh, sd) {
    const h = hole(), from = S.anim ? S.anim.from : E.dist(sd.ball, h.cup), left = E.dist(sh.end, h.cup), carry = Math.round(sh.carry || 0);
    let t = null, sub = '', lvl = 1;
    if (sh.result === 'holed') {
      if (sd.strokes === 0) { t = 'HOLE IN ONE'; sub = Math.round(from) + ' yards · ' + (player().name || 'Ace'); lvl = 4; }
      else if (sh.club !== 'putter') { t = from < 45 ? 'CHIPPED IN' : 'HOLED OUT'; sub = Math.round(from) + ' yards'; lvl = 3; }
      else if (from >= 12) { t = 'DRAINED IT'; sub = Math.round(from) + ' yards'; lvl = 2; }
      else if (from >= 6) { t = 'IN THE HOLE'; lvl = 1; }
    } else if (sh.result !== 'water' && sh.result !== 'ob') {
      if (sh.club !== 'putter' && left <= 2.5 && from >= 70) { t = 'STIFFED IT'; sub = Math.max(1, Math.round(left * 3)) + ' feet'; lvl = 2; }
      else if (['driver', 'w3'].includes(sh.club) && carry >= 255 && sh.finish === 'fairway') { t = carry >= 285 ? 'BOMB' : 'CRUSHED'; sub = carry + ' yards'; lvl = carry >= 285 ? 2 : 1; }
      else if (S.anim && S.anim.drama && S.anim.drama.miss) { t = ['OHHH!', 'SO CLOSE', 'LIPPED OUT', 'BURNED THE EDGE'][Math.min(3, Math.floor(Math.random() * 4))]; sub = left < 1 ? Math.max(1, Math.round(left * 36)) + ' inches away' : left < 3 ? Math.round(left * 3) + ' feet away' : 'it shaved the hole'; lvl = 0; setTimeout(() => sfx('groan'), 60); }
    }
    if (!t) return;
    S.callout = { t, sub, lvl, t0: performance.now() };
    if (lvl >= 4) aceParty();
    if (lvl >= 2 && lvl < 4) { S.shake = performance.now(); setTimeout(() => sfx('roar', lvl), 120); buzz(lvl >= 3 ? [40, 60, 40, 60, 140] : [30, 50, 30]); }
    else if (lvl === 1) sfx('clap');
    // particles in world space: sparkle at the cup, dust where a bomb lands
    S.fx = S.fx || [];
    const at = sh.result === 'holed' ? h.cup : sh.end, n = sh.result === 'holed' ? 26 + lvl * 8 : 16;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, v = 4 + Math.random() * (sh.result === 'holed' ? 14 : 7);
      S.fx.push({ x: at.x, y: at.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: performance.now(), life: 700 + Math.random() * 600,
        c: sh.result === 'holed' ? ['#e3b23c', '#ffffff', '#3fae29', '#f6d77a'][i % 4] : 'rgba(214,196,150,0.9)', r: sh.result === 'holed' ? 1.4 : 2.2 });
    }
  }
  function aceParty() {
    const now = performance.now(), W = cv.width, H = cv.height, dpr = W / cv.clientWidth;
    S.flash = now; S.shake = now; S.shakeBig = true; setTimeout(() => { S.shakeBig = false; }, 1200); // a second shake as the crowd goes up
    S.confetti = [];
    const cols = ['#e3b23c', '#f6d77a', '#ffffff', '#3fae29', '#ff5d8f', '#4fa3ff'];
    for (let i = 0; i < 140; i++) S.confetti.push({ x: Math.random() * W, y: -Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60 * dpr, vy: (90 + Math.random() * 160) * dpr, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 9, w: (5 + Math.random() * 5) * dpr, c: cols[i % cols.length], t0: now });
    S.bursts = [0, 420, 900, 1500, 2100].map((d, i) => ({ x: W * (0.2 + 0.6 * Math.random()), y: H * (0.12 + 0.25 * Math.random()), t0: now + d, c: cols[i % 4] }));
    setTimeout(() => sfx('roar', 4), 120); setTimeout(fanfare, 450);
    [400, 900, 1500, 2100].forEach(d => setTimeout(() => sfx('pop'), d));
    buzz([60, 50, 60, 50, 60, 50, 300]);
  }
  function drawParty() {
    const now = performance.now(), W = cv.width, H = cv.height, dpr = W / cv.clientWidth;
    if (S.flash) { const a = (now - S.flash) / 500; if (a < 1) { ctx.fillStyle = `rgba(255,240,190,${0.75 * (1 - a)})`; ctx.fillRect(0, 0, W, H); } else S.flash = 0; }
    if (S.bursts) {
      for (const b of S.bursts) {
        const k = (now - b.t0) / 1100; if (k < 0 || k > 1) continue;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = b.c;
        for (let j = 0; j < 22; j++) { const a = j / 22 * 6.283, r = (20 + 90 * Math.sqrt(k)) * dpr; ctx.beginPath(); ctx.arc(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r + 30 * k * k * dpr, 2.6 * dpr, 0, 7); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      if (S.bursts.every(b => now - b.t0 > 1100)) S.bursts = null;
    }
    if (S.confetti) {
      let alive = 0;
      for (const p of S.confetti) {
        const t = (now - p.t0) / 1000; if (t > 4.2) continue; alive++;
        const x = p.x + p.vx * t + Math.sin(t * 3 + p.rot) * 14 * dpr, y = p.y + p.vy * t;
        ctx.save(); ctx.globalAlpha = t > 3.4 ? (4.2 - t) / 0.8 : 1; ctx.translate(x, y); ctx.rotate(p.rot + p.vr * t);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2 * Math.abs(Math.cos(t * 6 + p.rot))+1); ctx.restore();
      }
      if (!alive) S.confetti = null;
    }
  }
  // slow motion should look deliberate, not like lag: a glowing gold comet tail,
  // a pulsing ring round the cup and cinema bars sliding in
  function slowLevel() {
    const A = S.anim, want = A && !A.done ? A.slowT || 0 : 0;
    S.slowK = (S.slowK || 0) + (want - (S.slowK || 0)) * (want > (S.slowK || 0) ? 0.25 : 0.08);
    return S.slowK;
  }
  function drawSlowWorld() {
    const k = S.slowK || 0, A = S.anim; if (k < 0.03 || !A || !A.trail) return;
    const s = cam.s, cup = W2S(hole().cup), now = performance.now();
    // ring round the cup, breathing
    ctx.save(); ctx.globalAlpha = k * (0.55 + 0.25 * Math.sin(now / 120));
    ctx.strokeStyle = '#ffd86b'; ctx.shadowColor = '#ffd86b'; ctx.shadowBlur = 12 * cv.width / cv.clientWidth; ctx.lineWidth = Math.max(3 * cv.width / cv.clientWidth, 0.35 * s);
    const dpr = cv.width / cv.clientWidth; ctx.beginPath(); ctx.arc(cup.x, cup.y, Math.max(1.6 * s, 18 * dpr) * (1 + 0.12 * Math.sin(now / 160)), 0, 7); ctx.stroke(); ctx.restore();
    // comet tail: afterimages that glow gold
    const T = A.trail, n = T.length;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const p = T[i], f = (i + 1) / n, q = W2S(p), lift = (p.z || 0) * s * 0.55;
      ctx.globalAlpha = k * f * 0.5 * Math.max(0.3, p.k);
      ctx.fillStyle = i > n - 4 ? '#fff6d6' : '#f2c14e';
      ctx.beginPath(); ctx.arc(q.x, q.y - lift, Math.max(3 * cv.width / cv.clientWidth, 0.32 * s) * (0.5 + f * 0.9), 0, 7); ctx.fill();
    }
    const h0 = W2S(T[n - 1]), gr = Math.max(1.4 * s, 16 * cv.width / cv.clientWidth), g = ctx.createRadialGradient(h0.x, h0.y, 0, h0.x, h0.y, gr);
    g.addColorStop(0, `rgba(255,236,170,${0.6 * k})`); g.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(h0.x, h0.y, gr, 0, 7); ctx.fill();
    ctx.restore();
  }
  function drawSlowScreen() {
    const k = S.slowK || 0; if (k < 0.03) return;
    const W = cv.width, H = cv.height, dpr = W / cv.clientWidth, bar = H * 0.075 * k;
    ctx.save();
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, `rgba(5,15,8,${0.45 * k})`);
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(6,14,9,0.92)'; ctx.fillRect(0, 0, W, bar); ctx.fillRect(0, H - bar, W, bar);
    ctx.globalAlpha = Math.min(1, k * 1.4); ctx.fillStyle = '#f2c14e'; ctx.font = `800 ${11 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const blink = Math.floor(performance.now() / 400) % 2;
    if (blink) { ctx.beginPath(); ctx.arc(14 * dpr, H - bar / 2, 4 * dpr, 0, 7); ctx.fill(); }
    ctx.fillText('SLOW-MO', 24 * dpr, H - bar / 2);
    ctx.restore();
  }
  function drawFx() {
    if (!S.fx || !S.fx.length) return;
    const now = performance.now(), s = cam.s;
    S.fx = S.fx.filter(p => now - p.t0 < p.life);
    for (const p of S.fx) {
      const k = (now - p.t0) / p.life, q = W2S({ x: p.x + p.vx * k, y: p.y + p.vy * k });
      ctx.globalAlpha = 1 - k; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(q.x, q.y, Math.max(1.5, p.r * s * (1 - k * 0.4)), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawCallout() {
    const c = S.callout; if (!c) return;
    const age = performance.now() - c.t0, dur = c.lvl >= 4 ? 3600 : c.lvl === 0 ? 1500 : 1900;
    if (age > dur) { S.callout = null; return; }
    const dpr = cv.width / cv.clientWidth, pop = age < 160 ? 0.6 + 0.4 * age / 160 + Math.sin(age / 160 * Math.PI) * 0.15 : 1, fade = age > dur - 350 ? (dur - age) / 350 : 1;
    const fit = Math.min(1, cv.clientWidth / 360), throb = c.lvl >= 4 ? 1 + Math.sin(age / 140) * 0.04 : 1;
    const size = (c.lvl >= 4 ? 54 * fit : c.lvl === 3 ? 40 : c.lvl === 2 ? 34 : 26) * dpr * pop * throb, y = cv.height * (c.lvl >= 4 ? 0.3 : 0.26);
    ctx.save(); ctx.globalAlpha = fade; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.lvl >= 4) { // spinning gold rays behind the words
      ctx.save(); ctx.translate(cv.width / 2, y); ctx.rotate(age / 1800);
      const R = Math.max(cv.width, cv.height) * 0.7, rg = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      rg.addColorStop(0, 'rgba(255,226,140,0.55)'); rg.addColorStop(1, 'rgba(255,226,140,0)'); ctx.fillStyle = rg;
      for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, i / 14 * 6.283, (i + 0.45) / 14 * 6.283); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    ctx.font = `900 italic ${size}px system-ui, sans-serif`;
    ctx.lineWidth = 7 * dpr; ctx.strokeStyle = 'rgba(10,30,18,0.9)'; ctx.strokeText(c.t, cv.width / 2, y);
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2); g.addColorStop(0, '#fff3c4'); g.addColorStop(0.5, '#e3b23c'); g.addColorStop(1, '#b8861d');
    ctx.fillStyle = c.lvl === 0 ? '#ffffff' : g; ctx.fillText(c.t, cv.width / 2, y);
    if (c.sub) { ctx.font = `800 ${14 * dpr}px system-ui, sans-serif`; ctx.lineWidth = 4 * dpr; ctx.strokeText(c.sub.toUpperCase(), cv.width / 2, y + size * 0.72); ctx.fillStyle = '#ffffff'; ctx.fillText(c.sub.toUpperCase(), cv.width / 2, y + size * 0.72); }
    ctx.restore();
  }
  // does this ball threaten the cup? Holed or not, the camera can't tell you which
  function dramaFor(A) {
    const cup = hole().cup, from = A.from || 0, putt = A.shot.club === 'putter';
    if (putt && from < 4) return 0; // tap-ins stay quick
    let best = 1e9, bi = 0;
    A.path.forEach((p, i) => { if ((p.z || 0) < 1) { const d = E.dist(p, cup); if (d < best) { best = d; bi = i; } } });
    const near = putt ? 0.75 : 1.6; // a lip-out, a burned edge, a chip that runs just by
    if (!A.holed && best > near) return 0;
    if (A.holed) bi = A.path.length - 1;
    // start the slow-motion a few yards out (and at least a couple of points back)
    const zone = putt ? 3 : 6;
    let en = bi; while (en > 0 && E.dist(A.path[en - 1], cup) < zone && (A.path[en - 1].z || 0) < 1) en--;
    en = Math.max(0, Math.min(en, bi - 2));
    return { i: bi, enter: en, miss: !A.holed };
  }
  function stepAnim(tnow) {
    const A = S.anim, L = A.path.length;
    if (!L) { A.done = true; finishShot(); return; }
    if (A.last == null) { A.last = A.t0; A.prog = 0; }
    const dt = Math.min(0.25, Math.max(0, (tnow - A.last) / 1000)); A.last = tnow;
    if (A.drama == null) A.drama = dramaFor(A);
    const D = A.drama;
    // the moment of truth runs on the clock, not the frame rate: a fixed, deliberate slow-motion
    if (D && !A.slow && A.prog >= D.enter) { A.slow = { t0: tnow, from: A.prog, dur: D.miss ? 1.05 : 1.35 }; sfx('slow'); }
    if (A.slow && !A.slow.end) {
      const t = Math.min(1, (tnow - A.slow.t0) / 1000 / A.slow.dur), ease = 1 - Math.pow(1 - t, 1.7);
      A.prog = A.slow.from + (D.i - A.slow.from) * ease; A.slowT = 1;
      if (t >= 1) A.slow.end = tnow;
    } else {
      let warp = 1;
      if (A.slow && A.slow.end) { const after = (tnow - A.slow.end) / 1000; warp = after < 0.7 ? 0.35 : 1; A.slowT = Math.max(0, 1 - after / 0.7); }
      A.prog += dt * A.rate * warp;
    }
    const pr = Math.max(0, Math.min(L - 1, A.prog)), idx = Math.floor(pr), f = pr - idx;
    const p = A.path[idx], q = A.path[Math.min(L - 1, idx + 1)];
    A.cur = { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f }; A.z = (p.z || 0) + ((q.z || 0) - (p.z || 0)) * f; A.idx = idx;
    (A.trail = A.trail || []).push({ x: A.cur.x, y: A.cur.y, z: A.z, k: A.slowT || 0 }); if (A.trail.length > 26) A.trail.shift();
    if (pr >= L - 1) { A.done = true; finishShot(); }
  }

  // ---------- input ----------
  let drag = null;
  cv.addEventListener('pointerdown', ev => {
    if (!S || !S.cur || S.busy || $('.overlay.show')) return;
    cv.setPointerCapture(ev.pointerId);
    drag = { x: ev.clientX, y: ev.clientY }; S.aim = null;
  });
  cv.addEventListener('pointermove', ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y, len = Math.hypot(dx, dy);
    const full = Math.min(cv.clientWidth, cv.clientHeight) * 0.42;
    if (len < 6) { S.aim = null; updatePower(0); return; }
    const frac = Math.min(1, len / full), cd = S.club === 'putter' ? closePutt() : 0;
    // close putt: the same drag covers a short range, so small strengths get real thumb room
    const power = cd ? frac * closeScaleYd(cd) / E.CLUBS.putter.putt : frac;
    S.aim = { ang: Math.atan2(-dy, -dx), power, frac, close: !!cd };
    updatePower(power, S.aim);
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    if (S.aim && (S.aim.frac ?? S.aim.power) >= 0.04) takeShot(S.aim.ang, S.aim.power);
    S.aim = null; updatePower(0);
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', () => { drag = null; if (S) S.aim = null; updatePower(0); });

  function updatePower(p, aim) {
    const ss = S && S.cur ? E.sprayStart(shotFlags(), player().kit) : 0.9;
    const close = aim ? aim.close : !!(S && S.cur && S.club === 'putter' && closePutt());
    const hot = !close && p > ss && !(S && S.cur && side().armed.steady);
    $('#pfill').style.width = ((close && aim ? aim.frac : p) * 100).toFixed(0) + '%';
    $('#pfill').classList.toggle('hot', hot);
    $('.power .mark').style.left = (ss * 100) + '%';
    $('.power .mark').style.display = close ? 'none' : '';
    const ft = Math.max(1, Math.round(p * E.CLUBS.putter.putt * 3)); // what it rolls on a flat green
    $('#ptext').textContent = close ? (p ? `Close putt · ${ft} ft of roll` : 'Close putt: fine control. Drag back gently')
      : p ? Math.round(p * 100) + '%' + (hot ? ' · risky' : '') : 'Drag back from anywhere, then release';
  }

  // ---------- shots ----------
  function takeShot(ang, power) {
    const h = hole(), sd = side(), P = player();
    if (S.mode !== 'scramble') sd.history.push({ ball: { ...sd.ball }, strokes: sd.strokes, swings: sd.swings });
    const flags = shotFlags();
    if (S.bonus) { const a = Math.random() * Math.PI * 2, m = Math.sqrt(Math.random()) * h.gustMax; flags.gust = { x: Math.cos(a) * m, y: Math.sin(a) * m }; }
    const sh = E.planShot(h, sd.ball, S.club, ang, power, flags, flags.laser ? () => 0.5 : Math.random, P.kit); // Laser Line: no spray, so it lands where the line showed
    sh.from = { ...sd.ball };
    S.shape = null; // every shot starts straight again
    sh.bounce = flags.bounceback;
    S.busy = true;
    ['tailwind', 'bigstick', 'steady', 'laser', 'bounceback'].filter(k => sd.armed[k] && !(S.club === 'putter' && (k === 'tailwind' || k === 'bigstick' || k === 'laser'))).forEach(k => consume(sd, k));
    sd.armed = {};
    S.anim = { path: sh.path, t0: performance.now(), rate: S.club === 'putter' ? 60 : Math.max(30, sh.path.length / 1.6), cur: { ...sd.ball }, shot: sh, holed: sh.result === 'holed', from: E.dist(sd.ball, hole().cup), start: { ...sd.ball } };
    sfx(S.club === 'putter' ? 'putt' : 'swing', power); buzz(S.club === 'putter' ? 8 : 18);
    if (typeof clipStart === 'function') clipStart(sh);
    renderHud();
  }

  function quipFor(sh) {
    const h = hole();
    const ev = sh.events || [];
    if (sh.result === 'holed') {
      if (ev.includes('dunk')) return pick(Q.dunk);
      if (sh.putt && E.dist(sh.from, h.cup) > 8) return pick(Q.longputt);
      return null;
    }
    if (ev.includes('pin')) return pick(Q.pin);
    if (sh.result === 'water') return pick(Q.water);
    if (sh.result === 'ob') return pick(Q.ob);
    const hk = SET.lefty ? 'slice' : 'hook', sl = SET.lefty ? 'hook' : 'slice';
    if (ev.includes(hk)) return pick(Q.hook);
    if (ev.includes(sl)) return pick(Q.slice);
    if (ev.includes('shaped') && ['fairway', 'green'].includes(sh.finish)) return pick((sh.curve > 0) !== SET.lefty ? Q.draw : Q.fade);
    if (ev.includes('lip')) return pick(Q.lip);
    if (ev.includes('tree')) return pick(Q.tree);
    if (sh.finish === 'sand') return pick(Q.sand);
    if (sh.putt && E.dist(sh.from, h.cup) < 5 && E.dist(sh.end, h.cup) > 1.5) return pick(Q.missshort);
    if (ev.includes('spray') && sh.finish === 'rough') return pick(Q.spray);
    if (sh.finish === 'green' && !sh.putt && E.dist(sh.from, h.cup) > 60) return pick(Q.green);
    if ((sh.club === 'driver' || sh.club === 'w3') && sh.carry > 225 && (sh.finish === 'fairway')) return pick(Q.bomb);
    if (sh.finish === 'rough' && Math.random() < 0.6) return pick(Q.rough);
    if (sh.finish === 'fairway' && Math.random() < 0.35) return pick(Q.fairway);
    return null;
  }

  function finishShot() {
    const sh = S.anim.shot, h = hole(), sd = side(), P = player();
    if (REC) clipStop(sh);
    if (!S.bonus) { const ev = sh.events || []; sfx(sh.result === 'holed' ? 'cup' : sh.result === 'water' ? 'splash' : ev.includes('tree') ? 'tree' : sh.finish === 'sand' ? 'sand' : sh.club === 'putter' ? null : 'land'); if (sh.result === 'holed') buzz([30, 40, 60]); }
    if (!S.bonus) epic(sh, sd);
    if (S.bonus) return tenthResult(sh);
    const pen = (sh.result === 'water' || sh.result === 'ob') && !sh.bounce ? 1 : 0;
    if (sh.club !== 'putter') { const st = (P.stats = P.stats || {})[sh.club] = (P.stats || {})[sh.club] || { n: 0, good: 0 }; st.n++; if (!pen && (sh.result === 'holed' || ['fairway', 'green'].includes(sh.finish))) st.good++; }
    if (sh.result === 'water' || sh.result === 'ob') P.lost++;
    let q = quipFor(sh);
    if (pen) q = (q ? q + ' ' : '') + '+1 penalty.';
    else if (sh.bounce && (sh.result === 'water' || sh.result === 'ob')) q = (q ? q + ' ' : '') + 'Bounce Back: no penalty.';
    if (q) toast(q);
    S.anim = null; S.busy = false;
    S.last = { ...S.cur };

    if (S.mode === 'scramble') {
      const scr = sd.scr;
      scr.res.push({ player: S.cur.player, end: { ...sh.end }, pen, holed: sh.result === 'holed' });
      sd.swings++;
      if (sh.result === 'holed' || scr.res.length === 2) return scrambleChoose();
      sd.ball = { ...scr.from };
      return nextTurn();
    }
    trackShot(sh, sd, pen);
    sd.strokes += 1 + pen; sd.swings++;
    sd.ball = { ...sh.end };
    if (sh.result === 'holed') { sd.holed = true; sd.done = true; S.busy = true; return holeFinishedFor(sd, () => nextTurn()); }
    if (sd.strokes >= 10) { sd.done = true; toast('Picked up at 10. Onwards.'); }
    nextTurn();
  }

  function holeFinishedFor(sd, then) {
    if (S.mode === 'match') {
      const P = S.players[sd.players[0]];
      toast(`${P.name}: ${E.scoreName(sd.strokes, hole().par)}`);
      setTimeout(() => { S.busy = false; then(); }, 1100);
    } else { S.busy = false; then(); }
  }

  function scrambleChoose() {
    const sd = S.sides[0], scr = sd.scr, h = hole();
    const holed = scr.res.find(r => r.holed);
    S.busy = true;
    const apply = once(r => {
      S.busy = false;
      sd.strokes += 1 + r.pen; sd.ball = { ...r.end }; sd.scr = null;
      if (r.holed) { sd.holed = true; sd.done = true; }
      else if (sd.strokes >= 10) { sd.done = true; toast('Picked up at 10. Onwards.'); }
      S.last = null; // both players had a go: always hand over
      closeOverlay(); fitCamera(false); nextTurn();
    });
    if (holed) return setTimeout(() => apply(holed), 900);
    const describe = r => {
      const t = r.pen ? 'Penalty: back where you started' : (({ fairway: 'Fairway', rough: 'Rough', sand: 'Bunker', green: 'Green', tee: 'Tee' })[E.terrainAt(h, r.end)] + ', ' + Math.round(E.dist(r.end, h.cup)) + ' yds');
      return `<button class="opt choose" data-i="${scr.res.indexOf(r)}" style="border-left:6px solid ${S.players[r.player].col}"><b>${esc(S.players[r.player].name)}'s ball</b><span>${t}</span></button>`;
    };
    fitCamera(false);
    setTimeout(() => {
      overlay(`<div class="kicker">Scramble · Hole ${h.num}</div><h2>Pick the better ball</h2><div class="opts">${scr.res.map(describe).join('')}</div>`, true);
      $$('.choose').forEach(b => b.onclick = () => apply(scr.res[+b.dataset.i]));
    }, 600);
  }

  function toast(m) {
    const el = $('#toast'); el.textContent = m; el.classList.add('show');
    clearTimeout(S.toastT); S.toastT = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ---------- cards ----------
  function consume(sd, id) { const i = sd.hand.indexOf(id); if (i >= 0) { sd.hand.splice(i, 1); if (S.rs) S.rs.cards++; } }
  function useCard(id) {
    if (S.busy || !S.cur) return;
    const h = hole(), sd = side(), C = E.CARDS[id];
    if (id === 'mulligan') {
      const last = sd.history.pop();
      if (!last) { toast('Nothing to undo yet.'); return; }
      Object.assign(sd, { ball: last.ball, strokes: last.strokes, swings: last.swings }); consume(sd, id);
      toast('Mulligan! Nobody saw that.'); S.last = null; nextTurn(); return;
    } else if (id === 'gimme') {
      if (E.dist(sd.ball, h.cup) > 10) { toast('Gimme works within 10 yards.'); return; }
      consume(sd, id);
      if (S.mode === 'scramble') sd.scr = null;
      sd.strokes++; sd.swings++; sd.holed = true; sd.done = true; sd.ball = { ...h.cup };
      toast("That's a gimme. Pick it up."); S.last = { ...S.cur };
      S.busy = true; return holeFinishedFor(sd, () => nextTurn());
    } else if (id === 'sandwizard' || id === 'stillair') {
      consume(sd, id); sd.holeFlags[id] = true; toast(C.name + ' is on for this hole.');
    } else sd.armed[id] = !sd.armed[id];
    renderHud();
  }

  // ---------- HUD ----------
  const fmtPar = d => d === 0 ? 'E' : d > 0 ? '+' + d : String(d);
  function toPar(sd) { return sd.scores.reduce((a, s, i) => a + s - S.course.holes[i].par, 0); }
  function matchStatus() {
    const u = S.match.up;
    if (!u) return 'All square';
    return `${S.players[u > 0 ? 0 : 1].name} ${Math.abs(u)} UP`;
  }

  function renderHud() {
    if (!S.cur) return;
    const h = hole(), sd = side(), P = player();
    if (!S.aim) updatePower(0); // shows the close-putt hint as soon as the ball stops within 10 feet
    $('#hHole').textContent = S.bonus ? 'Hole 10 · Bonus' : `${h.num}. ${h.name}`;
    $('#hPar').textContent = `Par ${h.par} · ${h.length} yds`;
    $('#hStrokes').textContent = sd.strokes;
    $('#hTotalLbl').textContent = S.mode === 'match' ? 'Match' : 'Total';
    $('#hTotal').textContent = S.mode === 'match' ? (S.match.up ? Math.abs(S.match.up) + ' UP' : 'AS') : fmtPar(toPar(sd));
    $('#hWho').textContent = multi() ? P.name + (S.mode === 'match' ? '' : ' (team)') : 'Solo';
    $('#hWho').style.display = multi() ? '' : 'none';
    $('#hWho').style.borderColor = P.col;
    let dtxt = Math.round(E.dist(sd.ball, h.cup)) + ' yds';
    if (P.kit.tech === 'gps' && E.terrainAt(h, sd.ball) !== 'green') {
      const d = E.dist(sd.ball, h.green);
      dtxt = `F ${Math.max(0, Math.round(d - h.GR))} · B ${Math.round(d + h.GR)}`;
    }
    $('#hDist').textContent = dtxt;
    $('#hDist').style.display = P.kit.tech === 'gps' && !S.bonus ? '' : 'none';
    $('#hPin').textContent = S.bonus ? '?' : Math.round(E.dist(sd.ball, h.cup));
    $('#cards').style.display = S.bonus ? 'none' : '';
    $('#hLie').textContent = ({ tee: 'Tee', fairway: 'Fairway', rough: 'Rough', sand: 'Bunker', green: 'Green' })[E.terrainAt(h, sd.ball)] || '';
    $('#hMod').textContent = S.bonus ? 'Blind Faith' : E.MODS[h.mod].name;
    const sb = $('#sndBtn'); if (sb) { sb.textContent = SET.sound ? '\u{1F50A}' : '\u{1F507}'; sb.onclick = () => { SET.sound = !SET.sound; saveSet(); unlockAudio(); renderHud(); }; }
    const w = E.windVec(h, sd.holeFlags, sd.ball);
    $('#windArrow').style.transform = `rotate(${Math.atan2(w.y, w.x) * 180 / Math.PI}deg)`;
    $('#windArrow').style.opacity = w.mph ? 1 : 0.2;
    $('#windTxt').textContent = S.bonus ? 'Swirling' : w.mph ? w.mph + ' mph' : 'Calm';
    if (S.bonus) $('#windArrow').style.opacity = 0.2;
    // clubs from this player's bag
    const lie = E.terrainAt(h, sd.ball), onGreen = lie === 'green';
    const clubs = P.bag.concat('putter');
    $('#clubs').innerHTML = clubs.map(c => {
      const C = E.CLUBS[c];
      const yd = c === 'putter' ? '' : Math.round(E.carryFor(c, lie, 1, shotFlags(), P.kit));
      return `<button class="club ${c === S.club ? 'on' : ''}" data-c="${c}" ${S.busy || (onGreen && c !== 'putter') ? 'disabled' : ''}><b>${C.short}</b><span>${yd}</span></button>`;
    }).join('');
    $$('.club').forEach(b => b.onclick = () => { if (!S.busy) { S.club = b.dataset.c; renderHud(); } });
    const shp = $('#shape');
    if (shp) {
      const cap = $$('#shape small'); if (cap.length === 2) { cap[0].textContent = SET.lefty ? 'curves right' : 'curves left'; cap[1].textContent = SET.lefty ? 'curves left' : 'curves right'; }
      shp.style.display = S.club === 'putter' || S.bonus ? 'none' : '';
      $$('#shape button').forEach(b => { b.classList.toggle('on', (b.dataset.s || null) === (S.shape || null)); b.onclick = () => { if (!S.busy) { S.shape = b.dataset.s || null; renderHud(); } }; });
    }
    const box = $('#cards'); box.innerHTML = '';
    if (!sd.hand.length) box.innerHTML = '<div class="nocards">No caddie cards. Your caddie offers one after holes 3 and 6.</div>';
    sd.hand.forEach(id => {
      const C = E.CARDS[id], b = document.createElement('button');
      b.className = 'card' + (sd.armed[id] ? ' armed' : '');
      b.innerHTML = `<b>${C.name}</b><span>${C.desc}</span>`;
      b.disabled = S.busy || (id === 'mulligan' && S.mode === 'scramble') || (onGreen && (id === 'tailwind' || id === 'bigstick' || id === 'laser'));
      b.onclick = () => useCard(id);
      box.appendChild(b);
    });
    const act = Object.keys(sd.holeFlags).map(k => E.CARDS[k].name);
    $('#active').textContent = act.length ? 'Active: ' + act.join(', ') : (S.mode === 'match' ? matchStatus() : '');
  }

  // ---------- overlays ----------
  function overlay(html) { $('#ovBox').innerHTML = html; $('#ov').classList.add('show'); $('#ovBox').scrollTop = 0; }
  function closeOverlay() { $('#ov').classList.remove('show'); }

  function showHoleIntro() {
    const h = hole(), m = E.MODS[h.mod];
    const shape = h.par === 3 ? 'Short hole' : h.pts.length === 4 ? 'Double dogleg' : Math.abs(h.pts[1].x - h.tee.x) > 60 ? `Dogleg ${h.pts[1].x < h.tee.x ? 'left' : 'right'}` : 'Straightaway';
    const hz = [h.water.length ? (h.water.some(w => w.creek) ? 'a creek' : h.water.some(w => w.island) ? 'an island green' : 'water') : null, h.bunkers.length + ' bunkers'].filter(Boolean).join(', ');
    const label = (S.course.major ? 'Sunday Major · ' : '') + (S.cfg.official ? 'Wild Nine #' + dayNo : S.mode === 'solo' ? 'Practice round' : MODES[S.mode].name);
    overlay(`<div class="kicker">${label}${S.mode === 'match' ? ' · ' + esc(matchStatus()) : ''}</div>
      <h2>Hole ${h.num}</h2>
      <div class="big">Par ${h.par} · ${h.length} yards · ${shape}</div>
      <div class="mod"><b>${m.name}</b><span>${m.desc}</span></div>
      <div class="fine">Watch for ${hz}. Wind: ${h.wind.mph ? h.wind.mph + ' mph' : 'calm'}.</div>
      ${S.h === 0 && S.mode === 'solo' && !S.cfg.lesson && !S.lockerUsed && lockerCount() ? `<div class="locker"><b>From your locker: bring one card</b><span>One per round. The rest stay for another day.</span><div class="lk-row">${Object.entries(locker()).filter(([, n]) => n > 0).map(([id, n]) => `<button class="lk" data-lk="${id}"><b>${esc(E.CARDS[id].name)}</b><small>x${n}</small></button>`).join('')}</div></div>` : ''}
      <button class="primary" id="go">Tee off</button>`);
    $$('[data-lk]').forEach(b => b.onclick = once(() => {
      const w2 = wallet(), id = b.dataset.lk; if (!(w2.cards || {})[id]) return;
      w2.cards[id]--; saveWallet(w2); S.lockerUsed = true; S.sides[0].hand.push(id);
      toastTop(`${E.CARDS[id].name} is in your hand for this round.`); showHoleIntro();
    }));
    $('#go').onclick = once(() => { closeOverlay(); S.last = null; nextTurn(); });
  }

  function endHole() {
    if (S.holeEnded) return;
    S.holeEnded = true;
    if (S.mode === 'solo') trackHoleEnd(S.sides[0]);
    const h = hole();
    S.sides.forEach(sd => sd.scores.push(sd.holed ? sd.strokes : Math.max(sd.strokes, 10)));
    S.anim = null; S.cur = null;
    let head, quip, firstPick = 0;
    if (S.mode === 'match') {
      const [a, b] = S.sides;
      const sa = a.holed ? a.strokes : 99, sb = b.holed ? b.strokes : 99;
      const res = sa < sb ? 0 : sb < sa ? 1 : -1;
      S.match.holes.push(res);
      if (res === 0) S.match.up++; else if (res === 1) S.match.up--;
      head = res < 0 ? 'Hole halved' : `${esc(S.players[res].name)} wins the hole`;
      quip = res < 0 ? 'Honours even. The tension builds.' : pick(['Take that.', 'One back in the bag.', 'Banter rights, temporarily.']);
      firstPick = res >= 0 ? res : (S.match.up > 0 ? 1 : 0);
      const left = 8 - S.h;
      if (Math.abs(S.match.up) > left) return endRound();
    } else {
      const sd = S.sides[0], d = sd.scores[S.h] - h.par;
      head = E.scoreName(sd.scores[S.h], h.par);
      if (d <= -2) { setTimeout(() => sfx('eagle'), 350); buzz([40, 50, 40, 50, 120]); } else if (d === -1) { setTimeout(() => sfx('birdie'), 350); buzz([30, 40, 30]); }
      quip = pick(sd.scores[S.h] === 1 ? Q.ace : d <= -2 ? Q.eagle : d === -1 ? Q.birdie : d === 0 ? Q.par : d === 1 ? Q.bogey : d === 2 ? Q.double : Q.worse);
      if (S.rival) quip = `${S.rival.name} took ${S.rival.scores[S.h]} here. You're ${rivalLine()}. ` + quip;
    }
    if (S.cfg.lesson) return setTimeout(lessonDone, 700);
    if (S.h === 8) return endRound();
    draftStep(head, quip, firstPick, 0);
  }

  // the caddie only offers a card after holes 3 and 6 (John, 24 Nov 2026: fewer cards, tougher scoring)
  const DRAFT_AFTER = [2, 5], HAND_MAX = 2;
  function draftStep(head, quip, firstPick, step) {
    const h = hole();
    const draftNow = DRAFT_AFTER.includes(S.h);
    const offers = draftNow ? S.course.offers[S.h].filter(id => !(S.mode === 'scramble' && id === 'mulligan')) : [];
    const taken = S.draftTaken || [];
    const avail = offers.filter(id => !taken.includes(id));
    const sideIdx = S.mode === 'match' ? (step === 0 ? firstPick : 1 - firstPick) : 0;
    const sd = S.sides[sideIdx];
    const who = S.mode === 'match' ? esc(S.players[sd.players[0]].name) : null;
    const full = sd.hand.length >= HAND_MAX;
    const scoreLine = S.mode === 'match' ? esc(matchStatus()) : `${S.sides[0].scores[S.h]} stroke${S.sides[0].scores[S.h] === 1 ? '' : 's'} · ${fmtPar(toPar(S.sides[0]))} overall`;
    overlay(`<div class="kicker">Hole ${h.num} · Par ${h.par}</div>
      <h2>${head}</h2>
      <div class="big">${scoreLine}</div>
      <div class="quip">${esc(quip)}</div>
      <div class="draft-title">${who ? who + (step === 0 ? ', you pick first.' : ', your pick.') + ' ' : ''}${!draftNow ? 'Your caddie offers a card after holes 3 and 6.' : full ? 'Hand full (' + HAND_MAX + '). A new card replaces your oldest.' : 'Your caddie offers a card:'}</div>
      <div class="draft">${avail.map(id => `<button class="card pick" data-id="${id}"><b>${E.CARDS[id].name}</b><span>${E.CARDS[id].desc}</span></button>`).join('')}</div>
      <button class="${draftNow ? 'ghost' : 'primary'}" id="skip">${draftNow ? 'Skip' : 'Next hole'}</button>`);
    const next = once(() => {
      if (S.mode === 'match' && step === 0 && draftNow) return draftStep(head, quip, firstPick, 1);
      S.draftTaken = []; S.h++; closeOverlay(); startHole();
    });
    $$('.pick').forEach(b => b.onclick = () => {
      if (sd.hand.length >= HAND_MAX) sd.hand.shift();
      sd.hand.push(b.dataset.id); S.draftTaken = taken.concat(b.dataset.id); next();
    });
    $('#skip').onclick = next;
  }

  // ---------- days, archive, streak ----------
  const EPOCH = Date.UTC(2026, 10, 1);
  function seedFor(n) { const d = new Date(EPOCH + (n - 1) * 864e5); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); }
  function dateLabel(n) { return new Date(EPOCH + (n - 1) * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); }
  function bumpStreak() {
    const st = store.get('wildnine-streak') || { last: 0, n: 0 };
    if (st.last === dayNo) return st;
    const n = st.last === dayNo - 1 ? st.n + 1 : 1;
    const out = { last: dayNo, n, best: Math.max(n, st.best || 0) };
    store.set('wildnine-streak', out); return out;
  }
  function streakNow() { const st = store.get('wildnine-streak'); return st && st.last >= dayNo - 1 ? st.n : 0; }

  function promoStrip() {
    const P = window.WN_PROMO; if (!P) return '';
    return `<div class="promo"><div class="pr-k">Today on GolfPrice AI</div>
      <a href="${SITE}${P.deal.url}" target="_blank" rel="noopener" class="pr-deal"><b>Deal of the day</b><span>${esc(P.deal.name)}: ${money(P.deal.now)}, down ${P.deal.pct}% from ${money(P.deal.was)}</span></a>
      <a href="${SITE}/play/draft/" target="_blank" rel="noopener" class="pr-draft"><b>The Bag Draft: ${esc(P.major)}</b><span>Draft a dream bag on a \u00A31,500 budget at today's real prices. Next up: ${esc(P.next)}.</span></a></div>`;
  }


  const ic = d => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    match: ic('<circle cx="8" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5"/>'),
    scramble: ic('<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>'),
    alt: ic('<path d="M4 8h13l-3-3M20 16H7l3 3"/>'),
    ch: ic('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>'),
    mates: ic('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
    se: ic('<path d="M7 4h10v4a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6"/>'),
    golfer: ic('<circle cx="12" cy="6" r="3"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/>'),
    stats: ic('<path d="M3 17l5-5 4 3 8-8M15 7h5v5"/>'),
    pp: ic('<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M9 17h6"/>'),
    arch: ic('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    hof: ic('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
    set: ic('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
    how: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>')
  };
  function showTitle() {
    const played = store.get('wildnine-' + ymd);
    const todayName = E.courseName(ymd), st = streakNow();
    overlay(`<div class="kicker">GolfPrice AI presents</div>
      <h1>Wild Nine</h1>
      <div class="strap">Full Swing. Not full price.</div>
      <div class="today"><span>${E.makeCourse(ymd).major ? 'Sunday Major' : "Today's course"} · #${dayNo}</span><b>${esc(todayName)}</b>${st ? `<i>${st}-day streak</i>` : ''}</div>
      <p class="lede">A new nine every day, the same for everyone. Beat par to unlock Hole 10.</p>
      ${played ? `<div class="done">Today's card: <b>${played.tot} (${fmtPar(played.tp)})</b>${played.tenth ? ` · Hole 10: ${esc(played.tenth)}` : ''}. New course tomorrow.</div>${endNav()}` : ''}
      <button class="mode hero" data-m="solo" ${played ? 'data-practice="1"' : ''}><b>${played ? 'Practice round' : "Play today's nine"}</b><span>${played ? 'Your card is in. Have another go for fun.' : "Same course for everyone. Post your card."}</span></button>
      <div class="sect2">Play with a mate <small>2 players, pass the phone</small></div>
      <div class="modes3">${['match', 'scramble', 'alt'].map(k => `<button class="mode mini" data-m="${k}">${ICON[k]}<b>${MODES[k].name.replace('Alternate', 'Alt')}</b><span>${{ match: 'Head to head', scramble: 'Best ball, team', alt: 'One ball, take turns' }[k]}</span></button>`).join('')}</div>
      ${(() => {
        const w = wallet(), g = w.goal && ITEM[w.goal] && !w.owned.includes(w.goal) ? ITEM[w.goal] : null;
        const nNew = ITEMS.filter(i => i.drop === monthKey()).length, nxt = DROPS[monthKey(1)];
        return `<button class="shopcard" data-go="shop"><span class="sc-g">${golferSvg(w, 92)}</span><span class="sc-t">
          <em>The Pro Shop</em><b>${bz(w.bal)} <small>Birdies</small></b>
          ${g ? `<span class="tgoal"><span style="width:${Math.min(100, w.bal / g.cost * 100)}%"></span></span><i>Saving for ${esc(g.name.toLowerCase())}: ${w.bal}/${g.cost}</i>` : `<i>Rides, buggy upgrades, kit and colours</i>`}
          <i class="sc-new">${nNew ? `${nNew} new this month` : nxt ? `New drop on the 1st` : 'Looks only, never paid'}</i></span><span class="sc-arrow">›</span></button>`;
      })()}
      ${(() => { const wd = new Date(EPOCH + (dayNo - 1) * 864e5).getUTCDay(), wk = (wd === 0 || wd === 1) ? weekData() : null; return wk ? `<button class="weekban" data-go="week"><b>Your week in Wild Nine</b><span>${wk.n} of 7 days · ${wk.birdies + wk.eagles} birdies · best ${fmtPar(wk.best.tp)}</span><em>See it</em></button>` : ''; })()}
      <div class="sect2">Today</div>
      <div class="tiles">
        <button class="tile" data-go="ch">${ICON.ch}<b>Challenges</b><i>${(() => { const d = store.get('wildnine-ch-' + ymd); return d ? d.filter(Boolean).length + '/3 done' : '3 to try'; })()}</i></button>
        <button class="tile" data-go="groups">${ICON.mates}<b>Group tables</b><i>${myGroups().length ? myGroups().length + ' group' + (myGroups().length > 1 ? 's' : '') : 'Society and mates'}</i></button>
        <button class="tile" data-go="se">${ICON.se}<b>Season</b><i>${esc(seasonInfo(seasonKey()).name.replace(/^The /, ''))}</i></button>
      </div>
      <div class="sect2">Your game</div>
      <div class="tiles">
        <button class="tile" data-go="golfer">${ICON.golfer}<b>My golfer</b><i>Card and sharing</i></button>
        <button class="tile" data-go="stats">${ICON.stats}<b>My game</b><i>Stats, ghosts</i></button>
        <button class="tile" data-go="pp">${ICON.pp}<b>Passport</b><i>${passport().days.length} stamps · ${rain()} rain</i></button>
        <button class="tile" data-go="arch">${ICON.arch}<b>Past courses</b><i>The archive</i></button>
        <button class="tile" data-go="hof">${ICON.hof}<b>Hall of Fame</b><i>Hole 10 aces</i></button>
        <button class="tile" data-go="how">${ICON.how}<b>How to play</b><i>Lesson and rules</i></button>
      </div>
      <button class="setrow" data-go="set">${ICON.set}<span><b>Settings</b><i>Sound ${SET.sound ? 'on' : 'off'} · ${SET.lefty ? 'Left' : 'Right'}-handed · Daily reminder</i></span><em>›</em></button>
      ${promoStrip()}
      <details class="how"><summary>How to play</summary><ol>
        <li><b>Drag back</b> from anywhere on the course, like a slingshot. Release to swing.</li>
        <li><b>Over 90% power</b> goes further but can spray. Watch the wind arrow.</li>
        <li><b>Rough and bunkers</b> cost distance (hybrids cope best in the rough, sand wedges in the sand). Water and out of bounds cost a stroke.</li>
        <li><b>Caddie cards</b> are one-use. Tap one to play it.</li>
        <li><b>Finish under par</b> to unlock Hole 10: one blind shot at a 1 in 10,000 hole in one.</li>
      </ol></details>`);
    $$('.mode').forEach(b => b.onclick = () => {
      const m = b.dataset.m;
      if (m === 'solo' && !store.get('wildnine-tut') && !(store.get('wildnine-stats') || {}).rounds) {
        overlay(`<div class="kicker">First time here?</div><h2>Learn it in one hole</h2><p class="lede">A 60-second practice hole with a caddie in your ear. Nothing counts.</p>
          <button class="mode hero" id="tutGo"><b>Show me</b><span>One short par 3</span></button><button class="ghost" id="tutSkip">I know golf games: just play</button>`);
        $('#tutGo').onclick = once(() => startLesson(showTitle));
        $('#tutSkip').onclick = once(() => { store.set('wildnine-tut', 1); startOfficial(!!b.dataset.practice); });
        return;
      }
      const official = m === 'solo' && !b.dataset.practice;
      SETUP = { mode: m, official, day: dayNo, seed: official ? ymd : m === 'solo' ? Math.floor(Math.random() * 1e9) : ymd + 7, players: [], i: 0 };
      setupPlayer();
    });
    const go = { shop: () => showShop(showTitle), golfer: () => showGolfer(showTitle), ch: showChallenges, pp: () => showPassport(showTitle), se: () => showSeason(showTitle),
      mates: () => showMates(dayNo, showTitle), stats: () => showStats(showTitle), arch: showArchive, hof: showHof,
      how: () => { const d = $('details.how'); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, set: () => showSettings(showTitle), week: () => showWeek(showTitle), groups: () => showGroups(showTitle) };
    $$('.tile, .shopcard, .setrow, .weekban').forEach(b => b.onclick = () => go[b.dataset.go]());
  }

  // a one-hole lesson for first-timers: play, don't read
  let LESSON_HOLE = null;
  function lessonHole() {
    if (LESSON_HOLE) return LESSON_HOLE;
    for (let sd = 9001; sd < 9400; sd++) {
      const c = E.makeCourse(sd), h = c.holes.find(x => x.par === 3 && x.mod === 'classic' && !x.water.length && x.length < 165 && x.length > 120);
      if (h) { LESSON_HOLE = { seed: sd, num: h.num }; break; }
    }
    return LESSON_HOLE || { seed: 9001, num: 1 };
  }
  function startLesson(back) {
    const L = lessonHole();
    S = null;
    newGame({ mode: 'solo', official: false, lesson: true, back, day: dayNo, seed: L.seed, players: [{ ...defaultPlayer(0), name: wallet().name || 'You' }], i: 0 });
  }
  const COACH = {
    tee: 'Drag back from anywhere on the course, like a slingshot, then let go. Aim at the flag.',
    aim: 'Further back = more power. The dotted line shows where it lands. Past 90% the ball can spray.',
    second: 'Good. The arrow by the wind speed shows the wind. Pick a club below: the game suggests one for the distance.',
    green: 'On the green. The arrows show the slope: the ball drifts the way they point. The gold line is your putt.',
    holed: ''
  };
  function coachTick() {
    const el = $('#coach'); if (!el) return;
    if (!S || !S.cfg || !S.cfg.lesson || !S.cur || S.holeEnded) { el.classList.remove('show'); return; }
    const sd = side(), lie = E.terrainAt(hole(), sd.ball);
    const k = lie === 'green' ? 'green' : S.aim ? 'aim' : sd.strokes === 0 ? 'tee' : 'second';
    if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = `<b>Lesson</b>${esc(COACH[k])}`; }
    el.classList.add('show');
  }
  function lessonDone() {
    const sd = S.sides[0], h = hole();
    store.set('wildnine-tut', 1);
    const back = S.cfg.back;
    overlay(`<div class="kicker">Lesson complete</div><h2>${esc(E.scoreName(sd.scores[0], h.par))}. You're ready.</h2>
      <p class="lede">That's the whole game: drag, aim, read the green. Today's nine has doglegs, water, wild twists and caddie cards to draft after holes 3 and 6.</p>
      <button class="mode hero" id="lsGo"><b>Play today's nine</b><span>${esc(E.courseName(ymd))}</span></button>
      <button class="ghost" id="lsBack">Back to the clubhouse</button>`);
    $('#lsGo').onclick = once(() => { S = null; startOfficial(); });
    $('#lsBack').onclick = once(() => { S = null; (back || showTitle)(); });
  }
  function startOfficial(practice) {
    SETUP = { mode: 'solo', official: !practice, day: dayNo, seed: practice ? Math.floor(Math.random() * 1e9) : ymd, players: [], i: 0 };
    setupPlayer();
  }

  // Shop this look: every real item behind your golfer's outfit, with today's lowest price. Only when you open it.
  function lookPanel(w) {
    const rows = SLOTS.map(s => ITEM[w.eq[s.k]]).filter(it => it && it.link && !it.game);
    if (!rows.length) return '';
    const total = rows.reduce((a, it) => { const p = it.p && SHOP_P[it.p]; return a + (p && p.from ? p.from : 0); }, 0);
    return `<details class="lookp"><summary>Shop this look <small>${rows.length} real item${rows.length > 1 ? 's' : ''}${total ? `, from ${money(total)} in total today` : ''}</small></summary>
      <div class="lookl">${rows.map(it => `<div class="lookr">${swatch(it, w)}<span><b>${esc(it.name)}</b>${priceLine(it)}</span></div>`).join('')}</div>
      <p class="fine">Links go to GolfPrice AI's comparison pages. We may earn a commission if you buy (ad: affiliate links). Prices change; check before you buy.</p></details>`;
  }
  function wireLook() { /* links open in a new tab; nothing else to wire */ }
  // Assemble Your Arsenal: if you've built your real bag on the site, the game can fill in the same models
  function arsenalModels() {
    let st = null; try { st = JSON.parse(localStorage.getItem('golfpriceai-bag-builder') || 'null'); } catch (e) { /* no storage */ }
    if (!st || !Array.isArray(st.clubIds) || !st.clubIds.length) return null;
    const out = {}, generic = new Set(['golf', 'driver', 'drivers', 'fairway', 'woods', 'wood', 'hybrid', 'hybrids', 'irons', 'iron', 'wedge', 'wedges', 'putter', 'steel', 'graphite', 'mens', 'men', 's']);
    for (const id of st.clubIds.concat(st.bagId ? [st.bagId] : [])) {
      const cat = String(id).split('-')[0], toks = new Set(String(id).split('-'));
      const list = KIT[cat] || []; let best = null, bestN = 0;
      for (const m of list) { const mt = m.s.split('-').filter(t => !generic.has(t)); if (mt.length && mt.every(t => toks.has(t)) && mt.length > bestN) { best = m; bestN = mt.length; } }
      if (best && !out[cat]) out[cat] = best.s;
    }
    return Object.keys(out).length ? out : null;
  }

  function showSettings(back) {
    const row = (k, t, d) => `<button class="tog ${SET[k] ? 'on' : ''}" data-k="${k}"><span><b>${t}</b><i>${d}</i></span><em>${SET[k] ? 'On' : 'Off'}</em></button>`;
    const rem = store.get('wildnine-remind');
    overlay(`<div class="kicker">Wild Nine</div><h2>Settings</h2>
      <div class="togs">
        ${row('sound', 'Sound', 'Strikes, splashes and the rattle of the cup.')}
        ${row('haptics', 'Vibration', 'A little buzz on contact and when you hole out.')}
        ${row('lefty', 'Left-handed', 'Draw curves right and fade curves left, like your real swing.')}
        ${row('cb', 'High-contrast greens', 'Stronger slope shading and outlined arrows. Easier for colour-blind players and bright sun.')}
      </div>
      <div class="sect">Daily reminder</div>
      <p class="fine" style="text-align:left">Off unless you set it. Your own calendar reminds you, not us: delete the event and it stops. It never mentions your streak.</p>
      <div class="remind"><input type="time" id="remT" value="${rem || '08:00'}"><button class="primary" id="remGo">Add to my calendar</button></div>
      <p class="fine" id="remMsg"></p>
      <button class="ghost" id="lesson">Replay the one-hole lesson</button>
      <button class="ghost" id="setBack">Back</button>`);
    $$('.tog').forEach(b => b.onclick = () => { SET[b.dataset.k] = !SET[b.dataset.k]; saveSet(); unlockAudio(); if (b.dataset.k === 'sound' && SET.sound) sfx('birdie'); if (b.dataset.k === 'haptics') buzz(30); showSettings(back); });
    $('#remGo').onclick = async () => { const tm = $('#remT').value || '08:00'; store.set('wildnine-remind', tm); const ok = await saveFile('wild-nine-daily.ics', icsFor(tm), 'text/calendar'); $('#remMsg').textContent = ok ? 'Done: open the file and your calendar adds a daily reminder at ' + tm + '.' : 'Calendar files can\'t be saved from this preview. On golfpriceai.com this button adds it straight to your calendar.'; };
    $('#lesson').onclick = () => startLesson(back);
    $('#setBack').onclick = back || showTitle;
  }
  function icsFor(tm) {
    const [hh, mm] = tm.split(':'), d = new Date(), pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`, stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GolfPrice AI//Wild Nine//EN', 'BEGIN:VEVENT', 'UID:wild-nine-daily@golfpriceai.com', 'DTSTAMP:' + stamp,
      `DTSTART:${day}T${pad(hh)}${pad(mm)}00`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY', 'SUMMARY:Wild Nine: today\'s course is up',
      'DESCRIPTION:A new nine every day. golfpriceai.com/play/wild-nine', 'URL:https://golfpriceai.com/play/wild-nine',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Wild Nine: today\'s course is up', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
  // one way to hand the viewer a file: the artifact viewer's save prompt when there is one, a normal download otherwise
  async function saveFile(name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (dl) { try { await dl.save({ filename: name, data: blob }); return true; } catch (e) { return e && e.code === 'declined' ? true : false; } }
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); return true; } catch (e) { return false; }
  }

  function showChallenges() {
    const done = store.get('wildnine-ch-' + ymd);
    const res = challengesFor(ymd).map((c, i) => ({ ...c, done: !!(done && done[i]) }));
    overlay(`<div class="kicker">Today's challenges · #${dayNo}</div><h2>Three to try</h2>
      <p class="fine">The same three for everyone, on today's course. 2 Birdies each, plus 3 more for all three. They count on your first round of the day.</p>
      ${challengeList(res)}
      <button class="primary" id="chPlay">${done ? 'Back' : "Play today's course"}</button>`);
    $('#chPlay').onclick = () => { if (done) return showTitle(); SETUP = { mode: 'solo', official: true, day: dayNo, seed: ymd, players: [], i: 0 }; setupPlayer(); };
  }

  function startArchived(n) {
    const seed = seedFor(n);
    SETUP = { mode: 'solo', official: n === dayNo && !store.get('wildnine-' + ymd), day: n, seed, players: [], i: 0 };
    setupPlayer();
  }

  function showArchive() {
    const favs = store.get('wildnine-favs') || [];
    const rows = [];
    for (let n = dayNo; n >= 1; n--) {
      const seed = seedFor(n), rec = store.get('wildnine-' + seed), c = E.makeCourse(seed);
      rows.push(`<div class="arow"><button class="ago" data-n="${n}"><b>#${n} · ${esc(c.name)}</b><span>${dateLabel(n)} · Par ${c.par}${rec ? ` · You: ${rec.tot} (${fmtPar(rec.tp)})` : ''}</span></button><button class="star ${favs.includes(n) ? 'on' : ''}" data-n="${n}" aria-label="Favourite">★</button></div>`);
    }
    const favRows = favs.length ? `<div class="sect">Your favourites</div>${favs.map(n => `<button class="ago chip2" data-n="${n}">#${n} ${esc(E.courseName(seedFor(n)))}</button>`).join('')}` : '';
    overlay(`<div class="kicker">The archive</div><h2>Past courses</h2>
      <p class="fine">Replay any course from the archive. Only today's course counts for the daily card; past ones are for fun and practice. Tip: share a course with a mate using its link, like golfpriceai.com/play/wild-nine#course-12.</p>
      ${favRows}<div class="sect">Every course</div><div class="alist">${rows.join('')}</div>
      <button class="ghost" id="back">Back</button>`);
    $$('.ago').forEach(b => b.onclick = () => startArchived(+b.dataset.n));
    $$('.star').forEach(b => b.onclick = () => {
      const n = +b.dataset.n, f = store.get('wildnine-favs') || [];
      const i = f.indexOf(n); if (i >= 0) f.splice(i, 1); else f.push(n);
      store.set('wildnine-favs', f.sort((a, b2) => b2 - a)); showArchive();
    });
    $('#back').onclick = showTitle;
  }

  function showHof() {
    const list = store.get('wildnine-hof') || [];
    const near = store.get('wildnine-ntp') || [];
    overlay(`<div class="kicker">Wild Nine</div><h2>Hall of Fame</h2>
      <p class="fine">Hole 10 aces, kept forever. In this prototype the Hall of Fame lives on this phone; on the site it becomes one national wall, with your society's aces on your society page.</p>
      ${list.length ? `<ol class="hof">${list.map(e => `<li><b>${esc(e.name)}</b><span>#${e.day} ${esc(e.course)} · ${esc(e.date)} · Certificate ${esc(e.cert)}</span></li>`).join('')}</ol>` : '<div class="done">No aces yet. The odds are 1 in 10,000 for a perfect strike. Somebody has to be first.</div>'}
      <div class="sect">Your nearest the pin on Hole 10</div>
      ${near.length ? `<ol class="hof">${near.slice(0, 5).map(e => `<li><b>${esc(e.txt)}</b><span>#${e.day} ${esc(e.course)}</span></li>`).join('')}</ol>` : '<p class="fine">Beat par to unlock Hole 10.</p>'}
      <button class="ghost" id="back">Back</button>`);
    $('#back').onclick = showTitle;
  }

  // ---------- scorecard ----------
  function scoreMark(s, par) {
    const d = s - par;
    return d <= -2 ? 'm-eagle' : d === -1 ? 'm-birdie' : d === 0 ? 'm-par' : d === 1 ? 'm-bogey' : 'm-double';
  }
  function scorecardHtml() {
    const c = S.course, holes = c.holes;
    const yards = holes.reduce((a, h) => a + h.length, 0);
    const rows = S.mode === 'match' ? S.players.map((P, i) => ({ name: P.name, scores: S.sides[i].scores })) :
      [{ name: S.mode === 'solo' ? (wallet().name || S.players[0].name) : S.players.map(p => p.name).join(' & '), scores: S.sides[0].scores }];
    const label = S.cfg.official ? `Wild Nine #${S.cfg.day || dayNo}` : S.mode === 'solo' ? `Wild Nine #${S.cfg.day || dayNo} · practice` : `Wild Nine · ${MODES[S.mode].name}`;
    return `<div class="card-sc ${look(null, 'card').theme || ''}">
      <div class="sc-head"><div class="sc-crest">${esc(c.name.split(' ').filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('').slice(0, 3))}</div>
        <div><div class="sc-club">${esc(c.name)}</div><div class="sc-sub">${label} · ${dateLabel(S.cfg.day || dayNo)}</div></div></div>
      <table class="sc2">
        <tr class="h"><th>Hole</th>${holes.map(h => `<td>${h.num}</td>`).join('')}<td class="t">Out</td></tr>
        <tr class="y"><th>Yards</th>${holes.map(h => `<td>${h.length}</td>`).join('')}<td class="t">${yards}</td></tr>
        <tr class="p"><th>Par</th>${holes.map(h => `<td>${h.par}</td>`).join('')}<td class="t">${c.par}</td></tr>
        ${rows.map(r => `<tr class="s"><th>${esc(r.name)}</th>${holes.map((h, i) => r.scores[i] == null ? '<td>–</td>' : `<td><span class="${scoreMark(r.scores[i], h.par)}">${r.scores[i] >= 10 && S.mode === 'match' ? '–' : r.scores[i]}</span></td>`).join('')}<td class="t">${S.mode === 'match' ? '' : r.scores.reduce((a, b) => a + b, 0)}</td></tr>`).join('')}
      </table>
      <div class="sc-names">${holes.map(h => `<span>${h.num}. ${esc(h.name)}</span>`).join('')}</div>
      ${S.tenthTxt ? `<div class="sc-ten">Hole 10, Blind Faith: <b>${esc(S.tenthTxt)}</b></div>` : ''}
      <div class="sc-foot"><span>Marker's signature</span><span>Player's signature</span></div>
      <div class="sc-ad"><b><span class="g1">Golf</span><span class="g2">Price</span><span class="g1"> AI</span></b><span>Full Swing. Not full price.</span></div>
    </div>`;
  }


  // ---------- sharing: every platform, plus the phone's own share sheet ----------
  function shareBar(id, label) {
    return `<div class="shareb" id="${id}"><div class="sb-k">${label || 'Share it'}</div>
      ${navigator.share ? '<button class="sb-main" data-sh="native">Share to Instagram, TikTok and more</button>' : ''}
      <div class="sb-row">
        <a data-sh="wa" class="sb wa" target="_blank" rel="noopener">WhatsApp</a>
        <a data-sh="fb" class="sb fb" target="_blank" rel="noopener">Facebook</a>
        <a data-sh="x" class="sb x" target="_blank" rel="noopener">X</a>
        <a data-sh="th" class="sb th" target="_blank" rel="noopener">Threads</a>
        <a data-sh="mail" class="sb ml">Email</a>
        <button data-sh="img" class="sb im">Save image</button>
        <button data-sh="copy" class="sb cp">Copy</button>
      </div><div class="sb-note" hidden></div></div>`;
  }
  function wireShare(id, o) {
    const root = $('#' + id); if (!root) return;
    const q = k => root.querySelector(`[data-sh="${k}"]`), note = t => { const n = root.querySelector('.sb-note'); n.hidden = false; n.textContent = t; };
    const url = 'https://' + o.url.replace(/^https?:\/\//, ''), text = o.text, both = text + (text.includes(o.url) ? '' : ' ' + url);
    q('wa').href = 'https://wa.me/?text=' + encodeURIComponent(both);
    q('fb').href = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
    q('x').href = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(o.short || text.split('\n')[0]) + '&url=' + encodeURIComponent(url);
    q('th').href = 'https://www.threads.net/intent/post?text=' + encodeURIComponent(both);
    q('mail').href = 'mailto:?subject=' + encodeURIComponent(o.subject || 'Wild Nine') + '&body=' + encodeURIComponent(both);
    let png = null; const getPng = async () => png || (png = o.image ? await o.image() : null);
    if (q('native')) q('native').onclick = async () => {
      try {
        const p = await getPng(); let files;
        if (p) { const blob = await (await fetch(p)).blob(); const f = new File([blob], (o.fname || 'wild-nine') + '.png', { type: 'image/png' }); if (navigator.canShare && navigator.canShare({ files: [f] })) files = [f]; }
        await navigator.share(files ? { files, text: both } : { text, url });
      } catch (e) { if (e && e.name !== 'AbortError') note('Sharing was blocked here. Use Save image, then post it from the app.'); }
    };
    q('img').onclick = async () => {
      const p = await getPng(); if (!p) { note('Could not make the image here: take a screenshot instead.'); return; }
      const blob = await (await fetch(p)).blob(), fname = (o.fname || 'wild-nine') + '.png';
      const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
      if (dl) { try { await dl.save({ filename: fname, data: blob }); } catch (e) { if (e && e.code === 'declined') return; note('Saving is not available here: take a screenshot instead.'); return; } }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); }
      note('Saved. For Instagram or TikTok: open the app, add it to your story or post, and paste the link.');
    };
    if (!o.image) q('img').remove();
    q('copy').onclick = async () => { try { await navigator.clipboard.writeText(both); q('copy').textContent = 'Copied'; } catch (e) { note(both); } };
  }
  // the round as a picture: sized for an Instagram post (4:5), branded top and bottom
  function roundCardSvg() {
    const c = S.course, holes = c.holes, day = S.cfg.day || dayNo, w = wallet();
    const rows = S.mode === 'match' ? S.players.map((P, i) => ({ name: P.name, scores: S.sides[i].scores })) :
      [{ name: S.mode === 'solo' ? (w.name || S.players[0].name) : S.players.map(p => p.name).join(' & '), scores: S.sides[0].scores }];
    const sd = S.sides[0], tot = sd.scores.reduce((a, b) => a + b, 0), tp = toPar(sd);
    let big = `${tot}`, sub = fmtPar(tp);
    if (S.mode === 'match') { const u = S.match.up, left = 9 - S.match.holes.length; big = !u ? 'Halved' : `${Math.abs(u)}${left > 0 ? '&' + left : ' UP'}`; sub = !u ? 'All square' : `${S.players[u > 0 ? 0 : 1].name} wins`; }
    const cell = (s, par, x, y) => {
      if (s == null) return `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" fill="#fff" opacity=".4">–</text>`;
      const d = s - par, t = `<text x="${x}" y="${y + 5}" text-anchor="middle" font-size="15" font-weight="800" fill="#fff">${s}</text>`;
      if (d <= -2) return `<circle cx="${x}" cy="${y}" r="12" fill="none" stroke="#e3b23c" stroke-width="1.6"/><circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#e3b23c" stroke-width="1.6"/>` + t;
      if (d === -1) return `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#e3b23c" stroke-width="2"/>` + t;
      if (d === 1) return `<rect x="${x - 10}" y="${y - 10}" width="20" height="20" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>` + t;
      if (d >= 2) return `<rect x="${x - 11}" y="${y - 11}" width="22" height="22" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/><rect x="${x - 8}" y="${y - 8}" width="16" height="16" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>` + t;
      return t;
    };
    const gx = i => 46 + i * 33.5;
    const grid = rows.map((r, ri) => {
      const y = 300 + ri * 36;
      return `${rows.length > 1 ? `<text x="20" y="${y - 16}" font-size="9" fill="#fff" opacity=".7">${esc(r.name)}</text>` : ''}${holes.map((h, i) => cell(r.scores[i], h.par, gx(i), y)).join('')}`;
    }).join('');
    const g = golferSvg(w, 120).replace('<svg ', '<svg x="222" y="96" ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 450" font-family="system-ui,-apple-system,Segoe UI,sans-serif">
      <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f3b23"/><stop offset="1" stop-color="#226f40"/></linearGradient>
        <pattern id="mw" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="12" height="24" fill="rgba(255,255,255,.035)"/></pattern></defs>
      <rect width="360" height="450" fill="url(#rg)"/><rect width="360" height="450" fill="url(#mw)"/>
      <text x="24" y="44" font-size="11" font-weight="800" letter-spacing="2.2" fill="#e3b23c">WILD NINE #${day}${c.major ? ' · SUNDAY MAJOR' : ''}</text>
      <text x="24" y="74" font-family="Georgia,serif" font-size="${Math.min(25, Math.floor(312 / (c.name.length * 0.6)))}" font-weight="700" fill="#fff"${c.name.length * 0.6 * 14 > 312 ? ' textLength="312" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(c.name)}</text>
      <text x="24" y="94" font-size="11" fill="#fff" opacity=".7">${esc(dateLabel(day))} · ${esc(S.mode === 'solo' ? (S.cfg.official ? 'Solo' : 'Practice') : MODES[S.mode].name)} · Par ${c.par}</text>
      <text x="24" y="${S.mode === 'match' ? 168 : 182}" font-size="${S.mode === 'match' ? 44 : 78}" font-weight="900" fill="#fff">${esc(big)}</text>
      <text x="26" y="214" font-size="20" font-weight="800" fill="#e3b23c">${esc(sub)}</text>
      <text x="26" y="236" font-size="12" fill="#fff" opacity=".75">${esc(rows[0].name || '')}</text>
      ${g}
      <rect x="20" y="256" width="320" height="${36 * rows.length + 34}" rx="12" fill="rgba(0,0,0,.22)"/>
      ${holes.map((h, i) => `<text x="${gx(i)}" y="276" text-anchor="middle" font-size="9" fill="#fff" opacity=".6">${h.num} · P${h.par}</text>`).join('')}
      ${grid}
      ${S.mode !== 'match' ? (() => { const sc = sd.scores, n = f => sc.filter((s, i) => f(s - holes[i].par)).length; const parts = [[n(d => d <= -2), 'eagle'], [n(d => d === -1), 'birdie'], [n(d => d === 0), 'par'], [n(d => d >= 1), 'bogey']].filter(([k]) => k).map(([k, l]) => `${k} ${l}${k > 1 ? 's' : ''}`); return `<text x="180" y="${S.tenthTxt ? 362 : 352}" text-anchor="middle" font-size="12" font-weight="700" fill="#fff" opacity=".85">${parts.join('  ·  ')}</text>`; })() : ''}
      ${S.tenthTxt ? `<text x="180" y="${306 + 36 * rows.length}" text-anchor="middle" font-size="11" fill="#e3b23c" font-weight="700">Hole 10: ${esc(S.tenthTxt)}</text>` : ''}
      <path d="M9 380H351V425A16 16 0 0 1 335 441H25A16 16 0 0 1 9 425Z" fill="#0b2516"/><rect x="9" y="380" width="342" height="2" fill="#e3b23c"/>
      <text x="24" y="408" font-size="19" font-weight="900"><tspan fill="#fff">Golf</tspan><tspan fill="#3fae29">Price</tspan><tspan fill="#fff"> AI</tspan></text>
      <text x="24" y="426" font-family="Georgia,serif" font-style="italic" font-size="11" fill="#fff" opacity=".75">Full Swing. Not full price.</text>
      <text x="336" y="406" text-anchor="end" font-size="12" font-weight="800" fill="#e3b23c">Can you beat it?</text>
      <text x="336" y="424" text-anchor="end" font-size="11" fill="#fff">golfpriceai.com/play/wild-nine</text>
      <rect x="9" y="9" width="342" height="432" rx="16" fill="none" stroke="#e3b23c" stroke-width="2"/><!-- frame drawn last, so the footer sits inside its rounded corners -->
      </svg>`;
  }


  // ---- shot of the day: each swing is filmed, only the best one is kept ----
  let REC = null;
  const CLIP_MIME = (() => { try { if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null; return ['video/mp4;codecs=avc3', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || null; } catch (e) { return null; } })();
  function clipStart(sh) {
    if (!CLIP_MIME || !S || S.mode !== 'solo' || S.cfg.lesson || S.bonus || REC) return;
    try {
      const stream = cv.captureStream(30), mr = new MediaRecorder(stream, { mimeType: CLIP_MIME, videoBitsPerSecond: 2500000 }), parts = [];
      mr.ondataavailable = e => { if (e.data && e.data.size) parts.push(e.data); };
      REC = { mr, parts, sh, from: { ...sh.from }, hole: S.h, strokes: side().strokes };
      mr.start();
    } catch (e) { REC = null; }
  }
  function clipScore(r, sh) {
    const h = S.course.holes[r.hole], d = E.dist(r.from, h.cup);
    if (sh.result === 'holed') return 100 + d * (sh.club === 'putter' ? 2 : 3) + (r.strokes === 0 ? 400 : 0);
    if (sh.result === 'water' || sh.result === 'ob') return 0;
    const left = E.dist(sh.end, h.cup);
    if (sh.club !== 'putter' && left < 4 && d > 60) return 60 + d / 4;
    if ((sh.club === 'driver' || sh.club === 'w3') && sh.finish === 'fairway') return (sh.carry || 0) / 8;
    return 0;
  }
  function clipStop(sh) {
    const r = REC; if (!r || r.sh !== sh || r.stopping) return;
    r.stopping = true;
    const score = clipScore(r, sh), h = S.course.holes[r.hole], d = Math.round(E.dist(r.from, h.cup));
    const label = sh.result === 'holed' ? (r.strokes === 0 ? `Hole in one, hole ${h.num}` : sh.club === 'putter' ? `${d}-yard putt to finish hole ${h.num}` : `Holed out from ${d} yards, hole ${h.num}`)
      : E.dist(sh.end, h.cup) < 4 ? `Stiff from ${d} yards, hole ${h.num}` : `${Math.round(sh.carry || d)}-yard drive, hole ${h.num}`;
    S.clipCap = sh.result === 'holed' ? (r.strokes === 0 ? 'HOLE IN ONE' : 'IN THE HOLE') : null;
    setTimeout(() => {
      try {
        r.mr.onstop = () => {
          REC = null; S && (S.clipCap = null);
          if (!S || score <= 0 || (S.clip && S.clip.score >= score)) return;
          S.clip = { blob: new Blob(r.parts, { type: CLIP_MIME.split(';')[0] }), score, label };
        };
        r.mr.stop();
      } catch (e) { REC = null; }
    }, 1100);
  }
  function drawClipCap() {
    if (!S.clipCap) return;
    const dpr = cv.width / cv.clientWidth;
    ctx.save(); ctx.font = `900 ${26 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6 * dpr; ctx.strokeStyle = 'rgba(10,30,18,0.85)'; ctx.strokeText(S.clipCap, cv.width / 2, cv.height * 0.22);
    ctx.fillStyle = '#e3b23c'; ctx.fillText(S.clipCap, cv.width / 2, cv.height * 0.22); ctx.restore();
  }
  // tomorrow, stated plainly: no countdown
  function tomorrowLine() {
    const n = (S.cfg.day || dayNo) + 1; if (n !== dayNo + 1) return '';
    const c = E.makeCourse(seedFor(n)), twists = [...new Set(c.holes.map(h => h.mod).filter(m => m !== 'classic'))].slice(0, 2).map(m => E.MODS[m].name);
    return `<div class="tmrw"><b>Tomorrow, #${n}: ${esc(c.name)}</b><span>${c.major ? 'A Sunday Major. ' : ''}${twists.length ? 'Look out for ' + twists.join(' and ') + '.' : 'A classic nine.'}</span></div>`;
  }

  // ---------- end of round ----------
  function shareText() {
    const day = S.cfg.day || dayNo;
    const label = S.cfg.official ? `Wild Nine #${day}` : S.mode === 'solo' ? `Wild Nine #${day} (practice)` : `Wild Nine #${day}, ${MODES[S.mode].name}`;
    const link = `golfpriceai.com/play/wild-nine#course-${day}`;
    const ten = S.tenthTxt ? `\nHole 10: ${S.tenthTxt}` : '';
    if (S.mode === 'match') {
      const u = S.match.up, left = 9 - S.match.holes.length;
      const res = !u ? 'Match halved' : `${S.players[u > 0 ? 0 : 1].name} beat ${S.players[u > 0 ? 1 : 0].name} ${Math.abs(u)}${left > 0 ? '&' + left : ' UP'}`;
      const grid = S.match.holes.map(r => r < 0 ? '\u{2B1C}' : r === 0 ? '\u{1F7E6}' : '\u{1F7E7}').join('');
      return `${label} · ${S.course.name}\n${res}\n${grid}\n${link}`;
    }
    const sd = S.sides[0], tot = sd.scores.reduce((a, b) => a + b, 0);
    const grid = sd.scores.map((s, i) => E.scoreEmoji(s, S.course.holes[i].par)).join('');
    const me = wallet().name;
    const team = S.mode === 'solo' ? (me ? me + ': ' : '') : `${S.players.map(p => p.name).join(' & ')}: `;
    const lnk = S.mode === 'solo' && sd.scores.length === 9 ? `golfpriceai.com/play/wild-nine#card-${cardCode()}` : link;
    const vs = S.rival ? `\nvs ${S.rival.name}'s ghost: ${S.rival.tot}` : '';
    return `${label}${S.course.major ? ' · Sunday Major' : ''} · ${S.course.name}\n${team}${tot} (${fmtPar(toPar(sd))})${vs}${ten}\n${grid}\n${lnk}`;
  }

  const CAT_SHOP = { driver: 'driver', wood: 'wood', hybrid: 'hybrid', irons: 'irons', wedge: 'wedge' };
  function clubOfDay(P) {
    const st = P.stats || {};
    const best = Object.entries(st).filter(([, v]) => v.n >= 2).sort((a, b) => b[1].good / b[1].n - a[1].good / a[1].n || b[1].n - a[1].n)[0];
    if (!best || !best[1].good) return '';
    const C = E.CLUBS[best[0]], list = KIT[C.cat] || [];
    const low = list.length ? Math.min(...list.map(m => m.p)) : null;
    const plural = { driver: 'Drivers', wood: 'Fairway woods', hybrid: 'Hybrids', irons: 'Iron sets', wedge: 'Wedges' }[C.cat];
    return `<p class="fine"><b>Club of the day${S.players.length > 1 ? ' for ' + esc(P.name) : ''}: ${C.name}.</b> ${best[1].good} of ${best[1].n} shots found the short grass.${low ? ` ${plural} from ${money(low)} today. <a href="${SITE}/shop.html?category=${CAT_SHOP[C.cat]}" target="_blank" rel="noopener">Compare prices</a>.` : ''}</p>`;
  }

  function bagPanel(P) {
    const rows = catsFor(P).map(cat => {
      const m = (KIT[cat] || []).find(x => x.s === P.models[cat]);
      if (!m) return '';
      return `<li><a href="${SITE}/prices/${m.s}/" target="_blank" rel="noopener"><b>${esc(m.n)}</b><span>${priceNote(m)}</span><i>Watch this price</i></a></li>`;
    }).filter(Boolean);
    let tot = 0, hi = 0;
    catsFor(P).forEach(cat => { const m = (KIT[cat] || []).find(x => x.s === P.models[cat]); if (m) { tot += m.p; hi += m.hi; } });
    const lost = P.lost ? `<p class="fine">${S.players.length > 1 ? esc(P.name) : 'You'} lost ${P.lost} ball${P.lost > 1 ? 's' : ''} today. The cheapest dozen we track is ${money(KIT._cheapBall || 5.98)}. <a href="${SITE}/shop.html?category=ball" target="_blank" rel="noopener">Restock here</a>.</p>` : '';
    const cod = clubOfDay(P);
    if (!rows.length) return cod + lost + `<p class="fine">Tip: set your real bag on the bag screen and we'll show what it costs today. It also saves to your Cheat Sheet, so gift buyers know exactly what you play.</p>`;
    const save = hi - tot >= 5 ? `, ${money(hi - tot)} less than its 90-day high` : '';
    return `<div class="bagbox"><div class="sect">${S.players.length > 1 ? esc(P.name) + "'s" : 'Your'} bag today: ${money(tot)}${save}</div><ul class="bag">${rows.join('')}</ul></div>${cod}${lost}`;
  }

  function endRound() {
    const sd0 = S.sides[0];
    let head, unlocked = false;
    if (S.mode === 'match') {
      const u = S.match.up, left = 9 - S.match.holes.length;
      head = !u ? 'Match halved' : `${esc(S.players[u > 0 ? 0 : 1].name)} wins ${Math.abs(u)}${left > 0 ? '&' + left : ' UP'}`;
    } else {
      const tot = sd0.scores.reduce((a, b) => a + b, 0), tp = toPar(sd0);
      head = `${tot} · ${fmtPar(tp)}`;
      if (S.cfg.official && !S.saved) {
        S.saved = true;
        store.set('wildnine-' + ymd, { scores: sd0.scores, tot, tp });
        bumpStreak();
      } else if (!S.cfg.official && !S.saved && S.mode === 'solo') {
        S.saved = true;
        const k = 'wildnine-' + S.cfg.seed, prev = store.get(k);
        if (S.cfg.day && (!prev || tot < prev.tot)) store.set(k, { scores: sd0.scores, tot, tp });
      }
      unlocked = S.mode === 'solo' && tp < 0 && !S.tenthTxt;
    }
    if (!S.award) S.award = awardRound();
    const aw = S.award;
    if (S.mode === 'solo' && !S.progressDone) {
      S.progressDone = true;
      const tot0 = sd0.scores.reduce((a, b) => a + b, 0), tp0 = toPar(sd0);
      S.ch = payChallenges();
      if (S.cfg.official) S.stampMsg = stampToday();
      addStats(tot0, tp0); saveGhost(tot0);
      if (S.cfg.official) postScoreToGroups(sd0);
    }
    const st = S.cfg.official ? streakNow() : 0;
    overlay(`<div class="kicker">${S.mode === 'match' ? 'Match play' : 'Your card'}${st > 1 ? ` · ${st}-day streak` : ''}</div><h2>${head}</h2>
      ${unlocked ? `<button class="gold" id="tenth"><b>Hole 10 unlocked</b><span>You beat par. One blind shot, a hidden gust, a 1 in 10,000 hole in one. Ace it for a clubhouse certificate.</span></button>` : ''}
      ${S.ch ? `<div class="sect">Today's challenges${S.ch.n ? ` <small>+${S.ch.n} Birdies</small>` : ''}</div>${challengeList(S.ch.res, true)}` : ''}
      ${S.stampMsg ? `<div class="done">${esc(S.stampMsg)}</div>` : S.cfg.official && S.mode === 'solo' ? '<p class="fine">Passport stamped for today.</p>' : ''}
      ${S.seasonGot && S.seasonGot.length ? `<div class="done">Season reward unlocked: <b>${S.seasonGot.map(esc).join(', ')}</b>. Wear it from the Pro Shop.</div>` : ''}
      ${aw && aw.n ? `<button class="birdies" id="toShop"><b>+${bz(aw.n)} Birdies</b><span>${aw.lines.map(esc).join(' · ')}</span><i>${wallet().bal} to spend in the Pro Shop</i></button>` : aw ? `<p class="fine">${esc(aw.lines.join(' '))}</p>` : ''}
      ${scorecardHtml()}
      ${S.rival ? `<div class="vsghost ${rivalLine().includes('ahead') ? 'won' : ''}"><b>${esc(rivalLine().includes('ahead') ? 'You beat ' + S.rival.name + "'s ghost" : rivalLine().includes('level') ? 'Level with ' + S.rival.name + "'s ghost" : S.rival.name + "'s ghost wins this time")}</b><span>You ${S.sides[0].scores.reduce((a, b) => a + b, 0)}, ${esc(S.rival.name)} ${S.rival.tot}</span></div>` : ''}
      ${S.cfg.official && S.mode === 'solo' ? (() => { const idx = wildIndex(), tot = S.sides[0].scores.reduce((a, b) => a + b, 0); return `<div class="lgbox"><b>Today's course league</b><span>${idx == null ? 'Your Wild Nine Index starts after 3 official rounds.' : `Index ${fmtIdx(idx)} · net ${tot - Math.round(idx)}`}</span><div class="lk-row"><button class="lk" id="lgPost">Post my score as ${esc(myNick() || 'me')}</button><button class="lk" id="lgView">See the league</button></div></div>`; })() : ''}
      ${tomorrowLine()}
      <div class="roundimg" id="roundImg"></div>
      ${shareBar('shRound', 'Share your round')}
      ${S.clip ? `<div class="clipbox"><div class="sb-k">Your shot of the day</div><video id="clipV" autoplay loop muted playsinline></video><b>${esc(S.clip.label)}</b>
        <div class="sb-row">${navigator.share ? '<button class="sb im" id="clipShare">Share the clip</button>' : ''}<button class="sb cp" id="clipSave">Save the clip</button></div><div class="sb-note" id="clipNote" hidden></div></div>` : ''}
      ${ghostCode() ? shareBar('shGhost', 'Challenge a mate: send your ghost') : ''}
      <pre id="share">${esc(shareText())}</pre>
      <button class="ghost" id="copy">Copy the text version</button>
      ${S.players.map(bagPanel).join('')}
      ${promoStrip()}
      ${endNav()}
      <button class="ghost" id="again">Back to the Wild Nine menu</button>`);
    $('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(shareText()); $('#copy').textContent = 'Copied. Paste it in the group chat'; }
      catch (e) { const r = document.createRange(); r.selectNodeContents($('#share')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); $('#copy').textContent = 'Selected. Copy it from the box'; }
    };
    { const svg = roundCardSvg(); svgToPng(svg, 1080, 1350).then(p => { if ($('#roundImg')) $('#roundImg').innerHTML = p ? `<img src="${p}" alt="Wild Nine round card">` : svg; });
      const st = shareText(), lnk = (st.match(/golfpriceai\.com\S*/) || ['golfpriceai.com/play/wild-nine'])[0];
      wireShare('shRound', { text: st.replace(lnk, '').trim(), short: st.split('\n').slice(0, 2).join(' · '), url: lnk, subject: 'My Wild Nine round', fname: `wild-nine-${S.cfg.day || dayNo}`, image: () => svgToPng(svg, 1080, 1350) }); }
    if (S.clip && $('#clipV')) {
      const ext = S.clip.blob.type.includes('mp4') ? 'mp4' : 'webm', fname = `wild-nine-shot-of-the-day.${ext}`;
      $('#clipV').src = URL.createObjectURL(S.clip.blob);
      $('#clipSave').onclick = async () => { const ok = await saveFile(fname, S.clip.blob); const n = $('#clipNote'); n.hidden = false; n.textContent = ok ? 'Saved. Post it to Instagram, TikTok or your group chat from your phone.' : 'Saving is not available here.'; };
      if ($('#clipShare')) $('#clipShare').onclick = async () => { try { const f = new File([S.clip.blob], fname, { type: S.clip.blob.type }); if (navigator.canShare && !navigator.canShare({ files: [f] })) throw new Error('no files'); await navigator.share({ files: [f], text: `${S.clip.label} on Wild Nine. golfpriceai.com/play/wild-nine` }); } catch (e) { if (!e || e.name !== 'AbortError') { const n = $('#clipNote'); n.hidden = false; n.textContent = 'Your phone would not share the video directly: use Save the clip, then post it.'; } } };
    }
    { const gc = ghostCode(); if (gc) { const sd0 = S.sides[0], tot = sd0.scores.reduce((a, b) => a + b, 0); wireShare('shGhost', { text: `I shot ${tot} (${fmtPar(toPar(sd0))}) on ${S.course.name}. My ghost is waiting for you: beat it if you can.`, short: `Beat my ghost on Wild Nine: I shot ${tot} at ${S.course.name}`, url: `golfpriceai.com/play/wild-nine#ghost-${gc}`, subject: 'Beat my Wild Nine ghost' }); } }
    if ($('#lgPost')) $('#lgPost').onclick = once(async () => { if (!LIVE) { toastTop('Course leagues go live on golfpriceai.com.'); return; } const r = await postToLeague(S.sides[0]); toastTop(r && r.ok ? (r.first ? 'Posted to today\'s league.' : 'Only your first round today counts, and it\'s already in.') : (r && r.error) || 'Could not post right now.'); });
    if ($('#lgView')) $('#lgView').onclick = () => { const back = () => showTitle(); showLeague(S.cfg.day || dayNo, back); };
    $('#again').onclick = showTitle;
    if ($('#tenth')) $('#tenth').onclick = once(startTenth);
    if ($('#toShop')) $('#toShop').onclick = () => showShop(endRound);
  }

  // ---------- Hole 10 ----------
  function startTenth() {
    S.bonus = true; S.revealed = false;
    S.tenth = E.makeTenth(S.cfg.seed); S.tenth.name = 'Blind Faith';
    const sd = S.sides[0];
    Object.assign(sd, { ball: { ...S.tenth.tee }, strokes: 0, swings: 0, done: false, holed: false, history: [], armed: {}, holeFlags: {} });
    S.cur = { side: 0, player: 0 }; S.last = { ...S.cur }; S.anim = null; S.busy = false;
    fitCamera(true);
    overlay(`<div class="kicker">Bonus hole</div><h2>Hole 10: Blind Faith</h2>
      <div class="big">Par 3 · ${S.tenth.length} yards · one shot</div>
      <div class="mod"><b>Hole in one or nothing</b><span>The green hides behind a hill: you can only see the top of the flag. It's soft, so the ball plugs where it lands. A swirling gust of up to 30 mph is decided at the moment you strike.</span></div>
      <div class="fine">A perfect strike holes out 1 time in 10,000. Everyone else gets their nearest-the-pin distance for the group chat.</div>
      <button class="primary" id="go10">Step up</button>`);
    $('#go10').onclick = once(() => { closeOverlay(); S.club = E.suggestClub(S.tenth, S.sides[0].ball, player().bag, player().kit); renderHud(); });
  }

  function feetText(yds) {
    const ft = yds * 3;
    if (ft < 30) { const f = Math.floor(ft), i = Math.round((ft - f) * 12); return `${f} ft ${i} in`; }
    return `${Math.round(yds)} yds`;
  }

  function tenthResult(sh) {
    S.anim0 = S.anim; S.anim = null; S.busy = true; S.revealed = true;
    const h = S.tenth, ace = sh.result === 'holed';
    Object.assign(S.sides[0], { ball: { ...sh.end }, done: true });
    const yds = ace ? 0 : E.dist(sh.end, h.cup);
    const onGreen = !ace && E.terrainAt(h, sh.end) === 'green';
    S.tenthTxt = ace ? 'HOLE IN ONE' : feetText(yds) + ' from the cup';
    if (S.cfg.official) { const rec = store.get('wildnine-' + ymd) || {}; rec.tenth = S.tenthTxt; store.set('wildnine-' + ymd, rec); }
    if (ace) S.bonusNote = awardBonus(50, 'a Hole 10 ace');
    else if (onGreen) S.bonusNote = awardBonus(1, 'finding the hidden green');
    if (S.bonusNote) toastTop(S.bonusNote);
    if (!ace) {
      const near = store.get('wildnine-ntp') || [];
      near.push({ yds, txt: S.tenthTxt, day: S.cfg.day || dayNo, course: S.course.name });
      near.sort((a, b) => a.yds - b.yds); store.set('wildnine-ntp', near.slice(0, 20));
      fitCamera(false);
      if (S.anim0 && S.anim0.drama && S.anim0.drama.miss) { sfx('groan'); S.callout = { t: 'OHHH!', sub: feetText(yds) + ' away', lvl: 0, t0: performance.now() }; }
      setTimeout(() => {
        const close = yds * 3 < 10;
        overlay(`<div class="kicker">Hole 10 · Blind Faith</div><h2>${close ? 'So close!' : onGreen ? 'On the dance floor' : 'The hill wins'}</h2>
          <div class="big">${esc(S.tenthTxt)}${onGreen ? '' : ', just off the green'}</div>
          <div class="quip">${esc(pick(close ? ['The flag stick is still shaking.', 'You can hear the groans from the clubhouse.', 'Agonising. Absolutely agonising.'] : onGreen ? ['Not bad for a shot you never saw.', 'Nearest the pin? Post it and find out.'] : ['Blind Faith giveth, Blind Faith taketh away.', 'The gust had other ideas.']))}</div>
          <button class="primary" id="tenthDone">Back to my card</button>`);
        $('#tenthDone').onclick = once(() => { S.bonus = false; endRound(); });
      }, 900);
      return;
    }
    // the big one: the crowd goes up on the course first, then the certificate
    S.callout = { t: 'HOLE IN ONE', sub: 'Hole 10 · blind · 1 in 10,000', lvl: 4, t0: performance.now() };
    aceParty();
    setTimeout(celebrate, 3000);
  }

  // ---------- the celebration ----------
  let actx = null;
  function unlockAudio() { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; } }
  cv.addEventListener('pointerdown', unlockAudio);
  document.addEventListener('click', unlockAudio);
  // little synthesised sounds: no files to load, all made on the fly
  let noiseBuf = null;
  function noise(len) { if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate * 1.5, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = actx.createBufferSource(); s.buffer = noiseBuf; return s; }
  function sfx(kind, k) {
    if (!SET.sound || !actx) return;
    try {
      const t = actx.currentTime + 0.01, out = actx.createGain(); out.connect(actx.destination);
      const tone = (f, at, len, type, vol, f2) => { const o = actx.createOscillator(), g = actx.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t + at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + at + len); g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len); o.connect(g); g.connect(out); o.start(t + at); o.stop(t + at + len + 0.05); };
      const hiss = (at, len, vol, freq, q, type) => { const s = noise(), f = actx.createBiquadFilter(), g = actx.createGain(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1; g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + len * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + at + len); s.connect(f); f.connect(g); g.connect(out); s.start(t + at); s.stop(t + at + len + 0.05); };
      if (kind === 'swing') { hiss(0, 0.22, 0.25 * (0.4 + k), 900 + 1400 * k, 0.8); tone(1800, 0.2, 0.05, 'square', 0.12); tone(240, 0.2, 0.09, 'triangle', 0.25, 120); }
      else if (kind === 'putt') tone(700, 0, 0.07, 'triangle', 0.25, 500);
      else if (kind === 'land') hiss(0, 0.12, 0.12, 300, 0.7, 'lowpass');
      else if (kind === 'sand') hiss(0, 0.25, 0.2, 2500, 0.6);
      else if (kind === 'splash') { hiss(0, 0.5, 0.3, 700, 0.5, 'lowpass'); hiss(0.05, 0.35, 0.12, 2500, 1); }
      else if (kind === 'tree') { tone(180, 0, 0.12, 'square', 0.12, 90); hiss(0, 0.25, 0.1, 3000, 0.7); }
      else if (kind === 'cup') { [0, 0.07, 0.13, 0.18].forEach((a, i) => tone(1500 - i * 150, a, 0.06, 'triangle', 0.18 - i * 0.03)); tone(160, 0.22, 0.15, 'sine', 0.25); }
      else if (kind === 'birdie') [784, 988, 1175].forEach((f, i) => tone(f, i * 0.1, 0.25, 'triangle', 0.14));
      else if (kind === 'eagle') [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.14));
      else if (kind === 'click') tone(1200, 0, 0.03, 'sine', 0.08);
      else if (kind === 'roar') { const L = k >= 3 ? 2.4 : 1.6; hiss(0, L, 0.22, 900, 0.4, 'lowpass'); hiss(0.1, L * 0.8, 0.08, 2200, 0.6); for (let i = 0; i < (k >= 3 ? 24 : 14); i++) hiss(0.15 + Math.random() * L * 0.7, 0.05, 0.12, 2400 + Math.random() * 1200, 2); }
      else if (kind === 'pop') { hiss(0, 0.25, 0.25, 500, 0.6, 'lowpass'); for (let i = 0; i < 10; i++) hiss(0.08 + Math.random() * 0.5, 0.03, 0.06, 3000 + Math.random() * 2000, 2); }
      else if (kind === 'slow') { tone(520, 0, 0.7, 'sine', 0.06, 130); hiss(0, 0.6, 0.06, 1200, 0.4, 'lowpass'); tone(65, 0.05, 1.2, 'sine', 0.12); }
      else if (kind === 'groan') { tone(240, 0, 0.9, 'sawtooth', 0.035, 150); hiss(0, 1.0, 0.14, 600, 0.5, 'lowpass'); }
      else if (kind === 'clap') { for (let i = 0; i < 9; i++) hiss(Math.random() * 0.7, 0.04, 0.1, 2600 + Math.random() * 900, 2); }
    } catch (e) { /* sound is optional */ }
  }
  function fanfare() {
    if (!actx) return;
    const notes = [[523, 0, 0.18], [659, 0.18, 0.18], [784, 0.36, 0.18], [1047, 0.54, 0.6], [784, 1.2, 0.16], [1047, 1.36, 0.9]];
    const t0 = actx.currentTime + 0.05;
    for (const [f, at, len] of notes) {
      for (const [type, gain, mult] of [['triangle', 0.18, 1], ['sawtooth', 0.04, 2]]) {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = type; o.frequency.value = f * mult;
        g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(gain, t0 + at + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
        o.connect(g); g.connect(actx.destination); o.start(t0 + at); o.stop(t0 + at + len + 0.05);
      }
    }
    // crowd-ish noise swell
    const len = 2.4, buf = actx.createBuffer(1, actx.sampleRate * len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / d.length);
    const src = actx.createBufferSource(), flt = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = buf; flt.type = 'bandpass'; flt.frequency.value = 1200; g.gain.value = 0.12;
    src.connect(flt); flt.connect(g); g.connect(actx.destination); src.start(t0 + 0.5);
  }

  function celebrate() {
    const party = $('#party'), pc = party.querySelector('canvas'), px = pc.getContext('2d');
    party.classList.add('show');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    pc.width = innerWidth * dpr; pc.height = innerHeight * dpr;
    fanfare();
    try { if (navigator.vibrate) navigator.vibrate([80, 60, 80, 60, 240]); } catch (e) { /* no vibration */ }
    const parts = [], rockets = [];
    const cols = ['#e3b23c', '#ff5d8f', '#7cc867', '#59c3ff', '#ffffff', '#ff7a59', '#c792ff'];
    const t0 = performance.now();
    let nextRocket = 0;
    function burst(x, y, col) {
      const n = 70 + Math.floor(Math.random() * 40), ring = Math.random() < 0.3;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (ring ? 5 : 1.5 + Math.random() * 4.5) * dpr;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, col: Math.random() < 0.8 ? col : '#fff', size: (1.5 + Math.random() * 2) * dpr, kind: 'spark' });
      }
    }
    function confetti() {
      for (let i = 0; i < 160; i++) parts.push({ x: Math.random() * pc.width, y: -Math.random() * pc.height * 0.5, vx: (Math.random() - 0.5) * 2 * dpr, vy: (1 + Math.random() * 2.5) * dpr,
        life: 1, col: cols[i % cols.length], size: (4 + Math.random() * 5) * dpr, kind: 'conf', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3 });
    }
    confetti();
    function tick(now) {
      const el = now - t0;
      if (el < 7000 && now > nextRocket) {
        rockets.push({ x: pc.width * (0.15 + Math.random() * 0.7), y: pc.height, vy: -(9 + Math.random() * 5) * dpr, col: cols[Math.floor(Math.random() * cols.length)], top: pc.height * (0.12 + Math.random() * 0.3) });
        nextRocket = now + 220 + Math.random() * 380;
      }
      if (el > 1500 && el < 1550) confetti();
      px.fillStyle = 'rgba(6,18,11,0.28)'; px.fillRect(0, 0, pc.width, pc.height);
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.y += r.vy; r.vy *= 0.985;
        px.fillStyle = r.col; px.fillRect(r.x - dpr, r.y, 2 * dpr, 8 * dpr);
        if (r.y <= r.top || r.vy > -2) { burst(r.x, r.y, r.col); rockets.splice(i, 1); }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.kind === 'spark') { p.vy += 0.06 * dpr; p.vx *= 0.985; p.vy *= 0.985; p.life -= 0.012; }
        else { p.vy += 0.02 * dpr; p.rot += p.vr; p.life -= 0.003; }
        p.x += p.vx; p.y += p.vy;
        if (p.life <= 0 || p.y > pc.height + 20) { parts.splice(i, 1); continue; }
        px.globalAlpha = Math.max(0, p.life);
        px.fillStyle = p.col;
        if (p.kind === 'spark') { px.beginPath(); px.arc(p.x, p.y, p.size, 0, 7); px.fill(); }
        else { px.save(); px.translate(p.x, p.y); px.rotate(p.rot); px.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); px.restore(); }
        px.globalAlpha = 1;
      }
      if (el < 9000 || parts.length) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    party.querySelector('.ace-text').classList.remove('go'); void party.offsetWidth; party.querySelector('.ace-text').classList.add('go');
    setTimeout(showCertificate, 4200);
  }

  function certNo() { return 'WN-' + String(S.cfg.day || dayNo).padStart(3, '0') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(); }

  function showCertificate() {
    const P = player(), cert = certNo(), course = S.course.name, day = S.cfg.day || dayNo;
    const official = !!S.cfg.official;
    const draw = name => overlay(`<div class="cert">
        <div class="cert-k">GolfPrice AI · Wild Nine</div>
        <div class="cert-t">Certificate of a Hole in One</div>
        <div class="cert-b">This is to certify that</div>
        <input class="cert-name" id="certName" value="${esc(name)}" maxlength="24" aria-label="Your name">
        <div class="cert-b">holed out in one stroke at</div>
        <div class="cert-h">Hole 10 · Blind Faith · ${S.tenth.length} yards</div>
        <div class="cert-b">${esc(course)}, Wild Nine #${day}, ${dateLabel(day)}${official ? '' : ' (practice round)'}</div>
        <div class="cert-odds">Against odds of 1 in 10,000</div>
        <div class="cert-seal"><span>ACE</span></div>
        <div class="cert-f"><span>Certificate ${cert}</span><span>Witnessed by the GolfPrice AI caddie</span></div>
      </div>
      <button class="primary" id="hofAdd">Add me to the Hall of Fame</button>
      ${shareBar('shAce', 'Tell everyone')}
      <button class="ghost" id="brag">Copy the brag</button>
      <p class="fine">On the site you'll be able to download and print this for the clubhouse wall, and your ace goes on the national Hall of Fame.</p>
      <button class="ghost" id="cardBack">Back to my card</button>`);
    draw(P.name && !/^Player \d$/.test(P.name) ? P.name : (wallet().name || ''));
    wireShare('shAce', { text: `HOLE IN ONE on Wild Nine Hole 10 (Blind Faith), ${course}. Odds: 1 in 10,000. Certificate ${cert}.`, url: `golfpriceai.com/play/wild-nine#course-${day}`, subject: 'Hole in one!' });
    const nameNow = () => ($('#certName').value.trim() || 'A golfing legend');
    $('#hofAdd').onclick = once(() => {
      const list = store.get('wildnine-hof') || [];
      list.unshift({ name: nameNow(), day, course, date: dateLabel(day), cert, official });
      store.set('wildnine-hof', list); $('#hofAdd').textContent = 'You are in the Hall of Fame';
    });
    $('#brag').onclick = async () => {
      const t = `HOLE IN ONE on Wild Nine Hole 10 (Blind Faith), ${course}. Odds: 1 in 10,000. Certificate ${cert}.\ngolfpriceai.com/play/wild-nine#course-${day}`;
      try { await navigator.clipboard.writeText(t); $('#brag').textContent = 'Copied. Go and gloat'; } catch (e) { $('#brag').textContent = 'Copy blocked here: screenshot the certificate instead'; }
    };
    $('#cardBack').onclick = once(() => { $('#party').classList.remove('show'); S.bonus = false; endRound(); });
  }

  // demo hook so the celebration can be seen without a 1 in 10,000 strike
  function aceDemo() {
    SETUP = null;
    newGame({ mode: 'solo', official: false, day: dayNo, seed: ymd, players: [defaultPlayer(0)] });
    closeOverlay();
    S.sides[0].scores = S.course.holes.map(h => h.par - 1);
    S.tenth = E.makeTenth(ymd); S.bonus = true; S.revealed = true; S.cur = { side: 0, player: 0 }; S.tenthTxt = 'HOLE IN ONE';
    Object.assign(S.sides[0], { ball: { ...S.tenth.cup }, done: true });
    fitCamera(true);
    celebrate();
  }

  function route() {
    const m = /^#course-(\d+)$/.exec(location.hash || '');
    if (m) { const n = +m[1]; if (n >= 1 && n <= dayNo) return startArchived(n); }
    if (location.hash === '#ace-demo') return aceDemo();
    const g = /^#golfer-(.+)$/.exec(location.hash || ''); if (g) return showSharedGolfer(g[1]);
    const cd = /^#card-(.+)$/.exec(location.hash || ''); if (cd) return openCardLink(cd[1]);
    const gh = /^#ghost-(.+)$/.exec(location.hash || ''); if (gh) return openGhostLink(gh[1]);
    const gr = /^#group-([A-Za-z0-9]{6})$/.exec(location.hash || ''); if (gr && typeof joinFromLink === 'function') return joinFromLink(gr[1].toUpperCase());
    showTitle();
  }

  // ---------- Birdies, the Pro Shop and your golfer ----------
  // the Birdie coin: a gold coin with a little bird, so nobody mistakes Birdies for money or for a birdie on the card
  const COIN = '<svg class="bzc" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="#e3b23c" stroke="#a07816" stroke-width="1.4"/><circle cx="10" cy="10" r="6.6" fill="none" stroke="#f6d77a" stroke-width=".8"/><path d="M4.6 11.2 Q7.4 7.6 10.6 9.2 Q12.6 6.4 15.6 7.6 Q13.6 8.6 13.4 10.2 Q12.4 13.2 8.6 13.2 Q6 13.2 4.6 11.2Z" fill="#7a5a10"/><circle cx="13.6" cy="8.4" r=".7" fill="#f6d77a"/></svg>';
  const bz = (n, big) => `<span class="bz ${big ? 'bzbig' : ''}">${COIN}${n}</span>`;
  // Looks only: nothing here changes how a shot plays. No random packs, no real money, no timers.
  const SHOP_P = window.WN_SHOPP || {};
  const SKINS = ['#f3d2b5', '#e0ac84', '#c68b5e', '#8d5a3b', '#5c3a26'];
  const HAIRS = ['#4a3426', '#1f1a17', '#a8743a', '#d9b26a', '#9a9a9a', '#b5432e'];
  // hair styles, for every golfer; [name, front shape, back shape drawn behind the head]
  const HAIRSTYLES = [
    ['Short back and sides', 'M122 132 Q124 106 150 106 Q176 106 178 132 Q170 118 150 118 Q130 118 122 132 Z', ''],
    ['Buzz cut', 'M121 131 Q123 109 150 109 Q177 109 179 131 Q170 122 150 122 Q130 122 121 131 Z', ''],
    ['Side parting', 'M120 138 Q117 104 150 103 Q183 104 180 138 Q177 117 160 113 L139 123 Q125 125 120 138 Z', ''],
    ['Quiff', 'M122 132 Q121 108 138 101 Q150 90 170 97 Q181 106 178 132 Q170 116 150 116 Q130 118 122 132 Z', ''],
    ['Curly', 'C', ''],
    ['Shoulder length', 'M118 140 Q116 104 150 103 Q184 104 182 140 L182 176 Q177 181 172 174 L172 134 Q160 117 150 117 Q140 117 128 134 L128 174 Q123 181 118 176 Z', ''],
    ['Ponytail', 'M120 140 Q118 104 150 104 Q182 104 180 140 Q174 116 150 116 Q126 116 120 140 Z', 'M176 122 Q200 130 196 166 Q192 182 184 176 Q190 150 172 132 Z'],
    ['Top bun', 'M121 134 Q122 106 150 105 Q178 106 179 134 Q170 118 150 118 Q130 118 121 134 Z', 'BUN'],
    ['Bob', 'M118 140 Q116 104 150 103 Q184 104 182 140 L182 160 Q173 165 170 156 L170 132 Q160 118 150 118 Q140 118 130 132 L130 156 Q127 165 118 160 Z', ''],
    ['Afro', 'M124 124 Q128 110 150 110 Q172 110 176 124 Q164 118 150 118 Q136 118 124 124 Z', 'AFRO'],
    ['Long and straight', 'M119 138 Q117 104 150 103 Q183 104 181 138 Q174 116 150 116 Q126 116 119 138 Z', 'M117 132 L117 206 Q150 214 183 206 L183 132 Z'],
    ['Clean shaven head', '', '']
  ];
  const defaultStyle = w => (w.hs != null ? w.hs : w.body === 'f' ? 6 : 0);
  const SLOTS = [
    { k: 'head', label: 'Headwear' }, { k: 'eyes', label: 'Sunglasses' }, { k: 'top', label: 'Tops' }, { k: 'layer', label: 'Body warmers' }, { k: 'bottom', label: 'Trousers & shorts' }, { k: 'shoes', label: 'Shoes' }, { k: 'glove', label: 'Gloves' }, { k: 'watch', label: 'Watches' },
    { k: 'bag', label: 'Bags' }, { k: 'ride', label: 'Rides' }, { k: 'paint', label: 'Buggy paint', buggy: true }, { k: 'wheels', label: 'Buggy wheels', buggy: true }, { k: 'ball', label: 'Balls' }, { k: 'trail', label: 'Shot trails' }, { k: 'card', label: 'Scorecards' }
  ];
  // link: shop query string for the real thing on GolfPrice AI; p: key into today's lowest prices
  const ITEMS = [
    { id: 'cap_white', slot: 'head', name: 'Club cap, white', cost: 0, look: { hat: 'cap', c: '#f4f4f0' }, link: 'category=apparel&types=cap&colour=White', p: 'cap_white' },
    { id: 'cap_navy', slot: 'head', name: 'Tour cap, navy', cost: 4, look: { hat: 'cap', c: '#1d2b4f' }, link: 'category=apparel&types=cap&colour=Navy', p: 'cap_navy' },
    { id: 'visor', slot: 'head', name: 'Sun visor', cost: 6, look: { hat: 'visor', c: '#ffffff' }, link: 'category=apparel&types=cap&q=visor', p: 'visor' },
    { id: 'bucket', slot: 'head', name: 'Bucket hat', cost: 8, look: { hat: 'bucket', c: '#c8b48a' }, link: 'category=apparel&types=cap&q=bucket', p: 'bucket' },
    { id: 'beanie', slot: 'head', name: 'Bobble hat, winter red', cost: 10, look: { hat: 'beanie', c: '#c0392b' }, link: 'category=apparel&types=cap&q=bobble', p: 'beanie' },
    { id: 'flatcap', slot: 'head', name: 'Tweed flat cap', cost: 14, look: { hat: 'flat', c: '#7a5a3a' }, game: true },
    { id: 'hat_none', slot: 'head', name: 'No hat: show off the hair', cost: 0, look: { hat: null }, game: true },
    { id: 'polo_white', slot: 'top', name: 'Club polo, white', cost: 0, look: { top: 'polo', c: '#f7f7f2' }, link: 'category=apparel&types=polo&colour=White', p: 'polo_white' },
    { id: 'polo_navy', slot: 'top', name: 'Polo, navy', cost: 4, look: { top: 'polo', c: '#1d2b4f' }, link: 'category=apparel&types=polo&colour=Navy', p: 'polo_navy' },
    { id: 'polo_pink', slot: 'top', name: 'Polo, Sunday pink', cost: 6, look: { top: 'polo', c: '#f28cb1' }, link: 'category=apparel&types=polo&colour=Pink', p: 'polo_pink' },
    { id: 'qzip', slot: 'top', name: 'Quarter-zip, grey', cost: 10, look: { top: 'qzip', c: '#8a9199' }, link: 'category=apparel&q=zip&colour=Grey', p: 'qzip' },
    { id: 'argyle', slot: 'top', name: 'Argyle jumper', cost: 16, look: { top: 'argyle', c: '#2f6b45', c2: '#e3b23c' }, link: 'category=apparel&q=argyle', p: 'argyle' },
    { id: 'rain', slot: 'top', name: 'Waterproof jacket', cost: 12, look: { top: 'rain', c: '#1b1d22' }, link: 'category=apparel&types=jacket&q=waterproof', p: 'rain' },
    { id: 'tr_grey', slot: 'bottom', name: 'Trousers, grey', cost: 0, look: { leg: 'trousers', c: '#6d737b' }, link: 'category=apparel&types=trousers&colour=Grey', p: 'tr_grey' },
    { id: 'tr_navy', slot: 'bottom', name: 'Trousers, navy', cost: 4, look: { leg: 'trousers', c: '#1d2b4f' }, link: 'category=apparel&types=trousers&colour=Navy', p: 'tr_navy' },
    { id: 'chino', slot: 'bottom', name: 'Stone chinos', cost: 6, look: { leg: 'trousers', c: '#cbbd9b' }, link: 'category=apparel&types=trousers&q=chino', p: 'chino' },
    { id: 'shorts', slot: 'bottom', name: 'Summer shorts', cost: 5, look: { leg: 'shorts', c: '#b9a77d' }, link: 'category=apparel&types=shorts' },
    { id: 'skort', slot: 'bottom', name: 'Pleated skort', cost: 6, look: { leg: 'skort', c: '#1d2b4f' }, link: 'category=apparel&types=skort' },
    { id: 'check', slot: 'bottom', name: 'Loud checked trousers', cost: 18, look: { leg: 'check', c: '#c0392b', c2: '#f3d27a' }, game: true },
    { id: 'sh_black', slot: 'shoes', name: 'Golf shoes, black', cost: 0, look: { shoe: '#1b1b1b' }, link: 'category=shoes&colour=Black', p: 'sh_black' },
    { id: 'sh_white', slot: 'shoes', name: 'Spikeless, white', cost: 6, look: { shoe: '#f5f5f5' }, link: 'category=shoes&colour=White', p: 'sh_white' },
    { id: 'sh_brown', slot: 'shoes', name: 'Classic brogues, brown', cost: 12, look: { shoe: '#6b3f22' }, link: 'category=shoes&colour=Brown', p: 'sh_brown' },
    { id: 'bag_carry', slot: 'bag', name: 'Carry bag, black', cost: 0, look: { bag: 'carry', c: '#26282c' }, link: 'category=bag&types=carry-bag&colour=Black', p: 'bag_carry' },
    { id: 'bag_cart', slot: 'bag', name: 'Cart bag, navy', cost: 8, look: { bag: 'cart', c: '#1d2b4f' }, link: 'category=bag&types=golf-bag&colour=Navy', p: 'bag_cart' },
    { id: 'bag_tour', slot: 'bag', name: 'Tour staff bag', cost: 20, look: { bag: 'staff', c: '#c0392b', c2: '#ffffff' }, link: 'category=bag&types=golf-bag&q=staff', p: 'bag_tour' },
    { id: 'ey_none', slot: 'eyes', name: 'No sunglasses', cost: 0, look: { shades: null }, game: true },
    { id: 'ey_aviator', slot: 'eyes', name: 'Aviators, gold frame', cost: 8, look: { shades: 'aviator', frame: '#c8a03a', lens: '#2a2d33' }, link: 'category=apparel&types=sunglasses', p: 'sunglasses' },
    { id: 'ey_sport', slot: 'eyes', name: 'Sport wraparounds', cost: 10, look: { shades: 'wrap', frame: '#1b1d22', lens: '#d0452b' }, link: 'category=apparel&types=sunglasses&q=prizm', p: 'sunglasses' },
    { id: 'ey_round', slot: 'eyes', name: 'Round retro', cost: 8, look: { shades: 'round', frame: '#6b4a2a', lens: '#3a3a2a' }, link: 'category=apparel&types=sunglasses', p: 'sunglasses' },
    { id: 'ey_mirror', slot: 'eyes', name: 'Blue mirror sports', cost: 10, look: { shades: 'wrap', frame: '#f4f4f0', lens: '#2e7fd1' }, link: 'category=apparel&types=sunglasses', p: 'sunglasses' },
    { id: 'ey_square', slot: 'eyes', name: 'Square, matte black', cost: 8, look: { shades: 'square', frame: '#16181c', lens: '#2a2d33' }, link: 'category=apparel&types=sunglasses', p: 'sunglasses' },
    { id: 'ey_gold', slot: 'eyes', name: 'Gold mirror, Sunday best', cost: 16, look: { shades: 'wrap', frame: '#16241c', lens: '#e3b23c' }, game: true, star: true },
    { id: 'bd_red', slot: 'head', name: 'Bandana, red paisley', cost: 6, look: { hat: 'bandana', c: '#b3262d', c2: '#f4f4f0' }, game: true },
    { id: 'bd_navy', slot: 'head', name: 'Bandana, navy', cost: 6, look: { hat: 'bandana', c: '#1d2b4f', c2: '#e3b23c' }, game: true },
    { id: 'bd_green', slot: 'head', name: 'Bandana, clubhouse green', cost: 6, look: { hat: 'bandana', c: '#1f6a3a', c2: '#e3b23c' }, game: true },
    { id: 'bd_black', slot: 'head', name: 'Bandana, black', cost: 6, look: { hat: 'bandana', c: '#1b1d22', c2: '#9aa0a6' }, game: true },
    { id: 'gl_classic', slot: 'glove', name: 'Classic white glove', cost: 0, look: { glove: 'one', c: '#f7f7f2', tab: '#d9dde2' }, game: true },
    { id: 'gl_black', slot: 'glove', name: 'Glove, black', cost: 3, look: { glove: 'one', c: '#22252a', tab: '#3fae29' }, link: 'category=accessories&types=glove&colour=Black', p: 'glove_black' },
    { id: 'gl_tour', slot: 'glove', name: 'Tour leather glove', cost: 5, look: { glove: 'one', c: '#fbf8ee', tab: '#1d2b4f', perf: true }, link: 'category=accessories&types=glove&q=cabretta', p: 'glove_leather' },
    { id: 'gl_navy', slot: 'glove', name: 'Glove, navy', cost: 4, look: { glove: 'one', c: '#1d2b4f', tab: '#f4f4f0' }, link: 'category=accessories&types=glove&colour=Navy', p: 'glove_navy' },
    { id: 'gl_pink', slot: 'glove', name: 'Glove, pink', cost: 4, look: { glove: 'one', c: '#f08bb0', tab: '#ffffff' }, link: 'category=accessories&types=glove&colour=Pink', p: 'glove_pink' },
    { id: 'gl_rain', slot: 'glove', name: 'Rain gloves (pair)', cost: 6, look: { glove: 'pair', c: '#2a2d33', tab: '#e3b23c', grip: true }, link: 'category=accessories&types=glove&q=rain', p: 'glove_rain' },
    { id: 'gl_winter', slot: 'glove', name: 'Winter mitts', cost: 8, look: { glove: 'mitt', c: '#7a1f2b', tab: '#f4f4f0' }, link: 'category=accessories&types=glove&q=winter', p: 'glove_winter' },
    { id: 'gl_gold', slot: 'glove', name: 'Gold leaf glove', cost: 14, look: { glove: 'one', c: '#e3b23c', tab: '#16241c', perf: true }, game: true },
    { id: 'wa_none', slot: 'watch', name: 'No watch', cost: 0, look: { watch: null }, game: true },
    { id: 'wa_black', slot: 'watch', name: 'GPS watch, black', cost: 10, look: { watch: 'gps', c: '#1b1d22', face: '#0f3b23' }, link: 'category=accessories&types=gps-watch&colour=Black', p: 'watch_gps' },
    { id: 'wa_white', slot: 'watch', name: 'GPS watch, white', cost: 10, look: { watch: 'gps', c: '#f4f4f0', face: '#0f3b23' }, link: 'category=accessories&types=gps-watch&colour=White', p: 'watch_gps' },
    { id: 'wa_cream', slot: 'watch', name: 'GPS watch, cream and gold', cost: 14, look: { watch: 'gps', c: '#efe4c8', face: '#16241c', bezel: '#c8901d' }, link: 'category=accessories&types=gps-watch&q=gold', p: 'watch_gps' },
    { id: 'wa_steel', slot: 'watch', name: 'Classic steel watch', cost: 12, look: { watch: 'dial', c: '#b9c0c7', face: '#f4f4f0' }, game: true },
    { id: 'wa_green', slot: 'watch', name: 'Clubhouse green dial', cost: 16, look: { watch: 'dial', c: '#c8901d', face: '#1f5a36' }, game: true, star: true },
    { id: 'gi_none', slot: 'layer', name: 'No body warmer', cost: 0, look: { gilet: null }, game: true },
    { id: 'gi_navy', slot: 'layer', name: 'Gilet, navy', cost: 10, look: { gilet: 'plain', c: '#1d2b4f' }, link: 'category=apparel&types=jacket&q=gilet&colour=Navy', p: 'gilet_navy' },
    { id: 'gi_black', slot: 'layer', name: 'Gilet, black', cost: 10, look: { gilet: 'plain', c: '#22252a' }, link: 'category=apparel&types=jacket&q=gilet&colour=Black', p: 'gilet_black' },
    { id: 'gi_grey', slot: 'layer', name: 'Gilet, grey', cost: 10, look: { gilet: 'plain', c: '#7d848c' }, link: 'category=apparel&types=jacket&q=gilet&colour=Grey', p: 'gilet_grey' },
    { id: 'gi_green', slot: 'layer', name: 'Gilet, racing green', cost: 10, look: { gilet: 'plain', c: '#1f5a36' }, link: 'category=apparel&types=jacket&q=gilet&colour=Green', p: 'gilet_green' },
    { id: 'gi_red', slot: 'layer', name: 'Gilet, red', cost: 10, look: { gilet: 'plain', c: '#b3262d' }, link: 'category=apparel&types=jacket&q=gilet&colour=Red', p: 'gilet_red' },
    { id: 'gi_white', slot: 'layer', name: 'Gilet, white', cost: 12, look: { gilet: 'plain', c: '#f2f2ee' }, link: 'category=apparel&types=jacket&q=gilet&colour=White', p: 'gilet_white' },
    { id: 'gi_puffer', slot: 'layer', name: 'Quilted puffer gilet, navy', cost: 14, look: { gilet: 'quilt', c: '#16224a' }, link: 'category=apparel&types=jacket&q=padded+gilet', p: 'gilet_puffer' },
    { id: 'gi_puffblk', slot: 'layer', name: 'Quilted puffer gilet, black', cost: 14, look: { gilet: 'quilt', c: '#1b1d22' }, link: 'category=apparel&types=jacket&q=padded+gilet', p: 'gilet_puffer' },
    { id: 'gi_club', slot: 'layer', name: 'Clubhouse gilet, gold trim', cost: 20, look: { gilet: 'quilt', c: '#0f3b23', trim: '#e3b23c' }, game: true, star: true },
    { id: 'walk', slot: 'ride', name: 'Walking', cost: 0, look: { ride: null }, game: true },
    { id: 'push', slot: 'ride', name: 'Push trolley', cost: 40, look: { ride: 'push', c: '#2a2d33' }, link: 'category=accessories&types=pushcart', p: 'push' },
    { id: 'electric', slot: 'ride', name: 'Electric trolley', cost: 90, look: { ride: 'electric', c: '#1b1d22' }, link: 'category=accessories&q=electric+trolley', p: 'electric' },
    { id: 'buggy', slot: 'ride', name: 'Golf buggy', cost: 300, look: { ride: 'buggy', c: '#f4f4f0', roof: '#0f3b23' }, game: true, star: true },
    { id: 'pt_factory', slot: 'paint', name: 'Factory finish', cost: 0, look: { paint: null }, game: true },
    { id: 'pt_green', slot: 'paint', name: 'Racing green and gold', cost: 30, look: { paint: '#1f5a36', roof: '#e3b23c', stripe: '#e3b23c' }, game: true },
    { id: 'pt_navy', slot: 'paint', name: 'Navy pinstripe', cost: 30, look: { paint: '#16224a', roof: '#f4f4f0', stripe: '#f4f4f0' }, game: true },
    { id: 'pt_sunday', slot: 'paint', name: 'Sunday red', cost: 30, look: { paint: '#b3262d', roof: '#16241c' }, game: true },
    { id: 'pt_black', slot: 'paint', name: 'Matte black', cost: 40, look: { paint: '#22252a', roof: '#22252a', stripe: '#3fae29' }, game: true },
    { id: 'pt_flag', slot: 'paint', name: 'Chequered flag wrap', cost: 60, look: { paint: '#f4f4f0', roof: '#16241c', check: '#16241c' }, game: true, star: true },
    { id: 'wh_std', slot: 'wheels', name: 'Standard wheels', cost: 0, look: { hub: '#9aa0a6', tyre: '#1b1b1b' }, game: true },
    { id: 'wh_chrome', slot: 'wheels', name: 'Chrome alloys', cost: 25, look: { hub: '#e6ebef', tyre: '#1b1b1b', spokes: 5 }, game: true },
    { id: 'wh_white', slot: 'wheels', name: 'Whitewall tyres', cost: 25, look: { hub: '#c9ced3', tyre: '#1b1b1b', wall: '#f4f4f0' }, game: true },
    { id: 'wh_offroad', slot: 'wheels', name: 'Off-road knobblies', cost: 30, look: { hub: '#e3b23c', tyre: '#2a2a2a', knob: true, big: 4 }, game: true },
    { id: 'wh_gold', slot: 'wheels', name: 'Gold spokes', cost: 45, look: { hub: '#e3b23c', tyre: '#1b1b1b', spokes: 8 }, game: true },
    { id: 'ball_white', slot: 'ball', name: 'White ball', cost: 0, look: { ball: '#ffffff' }, link: 'category=ball&colour=White' },
    { id: 'ball_yellow', slot: 'ball', name: 'Yellow ball', cost: 3, look: { ball: '#f4e04d' }, link: 'category=ball&colour=Yellow' },
    { id: 'ball_orange', slot: 'ball', name: 'Orange ball', cost: 5, look: { ball: '#ff8a3d' }, link: 'category=ball&colour=Orange' },
    { id: 'ball_pink', slot: 'ball', name: 'Pink matte ball', cost: 5, look: { ball: '#ff8fc0' }, link: 'category=ball&colour=Pink' },
    { id: 'ball_black', slot: 'ball', name: 'Stealth black ball', cost: 12, look: { ball: '#2a2a2a' }, link: 'category=ball&colour=Black' },
    { id: 'tr_none', slot: 'trail', name: 'No trail', cost: 0, look: { trail: null } },
    { id: 'tr_gold', slot: 'trail', name: 'Gold tracer', cost: 8, look: { trail: 'gold' }, game: true },
    { id: 'tr_smoke', slot: 'trail', name: 'Vapour trail', cost: 10, look: { trail: 'smoke' }, game: true },
    { id: 'tr_rainbow', slot: 'trail', name: 'Rainbow tracer', cost: 15, look: { trail: 'rainbow' }, game: true },
    { id: 'sc_classic', slot: 'card', name: 'Clubhouse green', cost: 0, look: { theme: '' }, game: true },
    { id: 'sc_links', slot: 'card', name: 'Links sand', cost: 10, look: { theme: 'th-links' }, game: true },
    { id: 'sc_royal', slot: 'card', name: 'Royal navy and gold', cost: 18, look: { theme: 'th-royal' }, game: true }
  ];
  const EXTRAS = [
    { id: 'x_cup', name: 'Drinks holder', cost: 10, blurb: 'Holds a brew. Or a pint, on the 19th.' },
    { id: 'x_cool', name: 'Cool box', cost: 20, blurb: 'Sandwiches at the turn, sorted.' },
    { id: 'x_brella', name: 'Umbrella holder', cost: 15, blurb: 'For proper British summers.' },
    { id: 'x_gps', name: 'Dash GPS screen', cost: 25, blurb: 'Looks the part. Tells you nothing new.' },
    { id: 'x_card', name: 'Scorecard clip', cost: 8, blurb: 'Pencil not included. Honesty is.' },
    { id: 'x_flag', name: 'Roof pennant', cost: 12, blurb: 'Fly your colours down the 1st.' },
    { id: 'x_speaker', name: 'Little speaker', cost: 18, blurb: 'Keep it down on the greens.' }
  ];
  const EXTRA = Object.fromEntries(EXTRAS.map(x => [x.id, x]));
  const ITEM = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  // Monthly drops: a new set lands on the 1st of each month and stays in the shop for good.
  const DROPS = {
    '2026-12': [
      { id: 'd12-jumper', slot: 'top', name: 'Festive argyle jumper', cost: 20, look: { top: 'argyle', c: '#b3262d', c2: '#1f6a3a' }, game: true },
      { id: 'd12-snow', slot: 'head', name: 'Snowy bobble hat', cost: 12, look: { hat: 'beanie', c: '#f4f4f0' }, link: 'category=apparel&types=cap&q=bobble', p: 'beanie' },
      { id: 'd12-candy', slot: 'trail', name: 'Candy cane tracer', cost: 16, look: { trail: 'season', c: '#e8483b' }, game: true },
      { id: 'd12-mitts', slot: 'glove', name: 'Christmas mitts, red and white', cost: 8, look: { glove: 'mitt', c: '#b3262d', tab: '#f4f4f0' }, game: true },
      { id: 'd12-paint', slot: 'paint', name: 'Christmas wrap, holly and gold', cost: 45, look: { paint: '#b3262d', roof: '#1f6a3a', stripe: '#e3b23c' }, game: true },
      { id: 'd12-buggy', slot: 'ride', name: 'Golf buggy, holly red', cost: 320, look: { ride: 'buggy', c: '#b3262d', roof: '#f4f4f0' }, game: true, star: true }
    ],
    '2027-01': [
      { id: 'd01-qzip', slot: 'top', name: 'New Year quarter-zip, navy', cost: 12, look: { top: 'qzip', c: '#16224a' }, link: 'category=apparel&q=zip&colour=Navy' },
      { id: 'd01-rain', slot: 'top', name: 'Storm jacket, forest', cost: 14, look: { top: 'rain', c: '#1f4a33' }, link: 'category=apparel&types=jacket&q=waterproof', p: 'rain' },
      { id: 'd01-gilet', slot: 'layer', name: 'Thermal gilet, forest', cost: 14, look: { gilet: 'quilt', c: '#1f4a33' }, link: 'category=apparel&types=jacket&q=padded+gilet', p: 'gilet_puffer' },
      { id: 'd01-ball', slot: 'ball', name: 'Frost blue ball', cost: 6, look: { ball: '#8fd3ff' }, game: true },
      { id: 'd01-trolley', slot: 'ride', name: 'Electric trolley, gunmetal', cost: 100, look: { ride: 'electric', c: '#5a6068' }, link: 'category=accessories&q=electric+trolley', p: 'electric' }
    ],
    '2027-02': [
      { id: 'd02-polo', slot: 'top', name: 'Sweetheart polo', cost: 8, look: { top: 'polo', c: '#e8486b' }, link: 'category=apparel&types=polo&colour=Pink', p: 'polo_pink' },
      { id: 'd02-ball', slot: 'ball', name: 'Valentine red ball', cost: 6, look: { ball: '#d6213f' }, game: true },
      { id: 'd02-trail', slot: 'trail', name: 'Cupid tracer', cost: 14, look: { trail: 'season', c: '#f1a7bf' }, game: true }
    ],
    '2027-03': [
      { id: 'd03-cap', slot: 'head', name: 'Shamrock cap', cost: 8, look: { hat: 'cap', c: '#1f6a3a' }, link: 'category=apparel&types=cap&colour=Green' },
      { id: 'd03-tr', slot: 'bottom', name: 'Spring chinos, sage', cost: 8, look: { leg: 'trousers', c: '#9bb59a' }, link: 'category=apparel&types=trousers&q=chino', p: 'chino' },
      { id: 'd03-wheels', slot: 'wheels', name: 'Emerald alloys', cost: 35, look: { hub: '#3fae29', tyre: '#1b1b1b', spokes: 6 }, game: true },
      { id: 'd03-buggy', slot: 'ride', name: 'Golf buggy, racing green', cost: 320, look: { ride: 'buggy', c: '#1f6a3a', roof: '#e3b23c' }, game: true, star: true },
      { id: 'd04-ball', slot: 'ball', name: 'Easter egg yellow ball', cost: 6, look: { ball: '#f3e27a' }, game: true } // Easter 2027 is 28 March
    ],
    '2027-04': [
      { id: 'd04-jacket', slot: 'top', name: 'Spring major green jacket', cost: 60, look: { top: 'rain', c: '#1f6a3a' }, game: true, star: true },
      { id: 'd04-visor', slot: 'head', name: 'Spring visor, pastel', cost: 8, look: { hat: 'visor', c: '#c9e7f2' }, link: 'category=apparel&types=cap&q=visor', p: 'visor' },
      { id: 'd04-watch', slot: 'watch', name: 'Spring major watch, green and gold', cost: 18, look: { watch: 'dial', c: '#e3b23c', face: '#1f6a3a' }, game: true }
    ],
    '2027-05': [
      { id: 'd05-shorts', slot: 'bottom', name: 'Bank holiday shorts, navy', cost: 6, look: { leg: 'shorts', c: '#1d2b4f' }, link: 'category=apparel&types=shorts' },
      { id: 'd05-bucket', slot: 'head', name: 'Sunny bucket hat', cost: 10, look: { hat: 'bucket', c: '#f5a623' }, link: 'category=apparel&types=cap&q=bucket', p: 'bucket' },
      { id: 'd05-cart', slot: 'ride', name: 'Golf buggy, sky blue', cost: 320, look: { ride: 'buggy', c: '#59c3ff', roof: '#ffffff' }, game: true, star: true }
    ]
  };
  function monthKey(off) { const d = new Date(EPOCH + (dayNo - 1) * 864e5); d.setUTCMonth(d.getUTCMonth() + (off || 0)); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
  function registerDrops() {
    const now = monthKey();
    for (const [mk, list] of Object.entries(DROPS)) if (mk <= now || window.WN_TEST) for (const it of list) if (!ITEM[it.id]) { const x = { ...it, drop: mk }; ITEMS.push(x); ITEM[x.id] = x; }
  }
  registerDrops();

  const DEFAULT_EQ = { head: 'cap_white', eyes: 'ey_none', top: 'polo_white', layer: 'gi_none', bottom: 'tr_grey', shoes: 'sh_black', glove: 'gl_classic', watch: 'wa_none', bag: 'bag_carry', ride: 'walk', paint: 'pt_factory', wheels: 'wh_std', ball: 'ball_white', trail: 'tr_none', card: 'sc_classic' };

  function wallet() {
    let w = store.get('wildnine-wallet');
    if (!w) { w = { bal: 5, earned: 5, owned: ITEMS.filter(i => !i.cost).map(i => i.id), eq: { ...DEFAULT_EQ }, skin: 0, name: '', gift: true }; store.set('wildnine-wallet', w); }
    w.eq = { ...DEFAULT_EQ, ...w.eq };
    if (window.WN_TEST && w.bal < 100000) { w.bal = 999999; w.earned = Math.max(w.earned || 0, 999999); store.set('wildnine-wallet', w); }
    for (const i of ITEMS) if (!i.cost && !i.season && !w.owned.includes(i.id)) w.owned.push(i.id);
    return w;
  }
  // A small snapshot of how your golfer looks (colours and shapes, not item ids), so My Clubhouse and the
  // league tables can draw your golfer without the whole game. Kept next to the wallet and sent with scores.
  const avPick = (o, ks) => { const r = {}; for (const k of ks) if (o && o[k] != null) r[k] = o[k]; return r; };
  function avSnap(w) {
    w = w || wallet(); const L = s => look(w, s);
    return { s: w.skin || 0, h: w.hair || 0, hs: defaultStyle(w), b: w.body === 'f' ? 'f' : 'm',
      hd: avPick(L('head'), ['hat', 'c', 'c2']), tp: avPick(L('top'), ['top', 'c', 'c2']), ly: avPick(L('layer'), ['gilet', 'c', 'trim']),
      ey: avPick(L('eyes'), ['shades', 'lens', 'frame']) };
  }
  const avStr = () => { try { return JSON.stringify(avSnap()); } catch (e) { return null; } };
  const saveWallet = w => { store.set('wildnine-wallet', w); try { store.set('wildnine-av', avSnap(w)); } catch (e) { /* drawing data only */ } };
  const look = (w, slot) => (ITEM[(w || wallet()).eq[slot]] || ITEM[DEFAULT_EQ[slot]]).look;
  try { store.set('wildnine-av', avSnap()); } catch (e) { /* drawing data only */ }

  // Earning: something for turning up, more for playing well. Practice is capped so it can't be farmed.
  function awardRound() {
    if (S.awarded || S.mode === 'match' && false) return null;
    S.awarded = true;
    const w = wallet(), lines = [];
    let n = 0;
    if (S.cfg.official) {
      n += 2; lines.push('2 for playing today\'s course');
      const under = Math.max(0, -toPar(S.sides[0]));
      if (under) { n += under; lines.push(`${under} for ${under === 1 ? 'the shot' : 'the shots'} under par`); }
      const st = streakNow();
      const sb = st >= 7 ? 2 : st >= 3 ? 1 : 0;
      if (sb) { n += sb; lines.push(`${sb} streak bonus (${st} days)`); }
    } else {
      const log = store.get('wildnine-earnlog') || {};
      if (log.day !== dayNo) { log.day = dayNo; log.n = 0; }
      if (log.n < 3) { n += 1; log.n++; lines.push('1 for a practice or friendly round (up to 3 a day)'); }
      else lines.push('Practice Birdies maxed out for today. Today\'s course still pays.');
      store.set('wildnine-earnlog', log);
    }
    w.bal += n; w.earned += n; saveWallet(w);
    if (n) S.seasonGot = (S.seasonGot || []).concat(addSeasonPoints(n));
    return { n, lines };
  }
  function awardBonus(n, why) { const w = wallet(); w.bal += n; w.earned += n; saveWallet(w); const got = addSeasonPoints(n); if (S) S.seasonGot = (S.seasonGot || []).concat(got); return `+${n} Birdies: ${why}`; }

  // ---------- the golfer, drawn from scratch ----------
  function golferSvg(w, size) {
    const L = s => look(w, s), skin = SKINS[w.skin || 0], hairC = HAIRS[w.hair || 0], fem = w.body === 'f';
    const ey = L('eyes');
    const eyes = !ey.shades ? '' : ey.shades === 'round'
      ? `<circle cx="139" cy="140" r="7.5" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="2"/><circle cx="161" cy="140" r="7.5" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="2"/><path d="M146.5 139 Q150 136 153.5 139 M131.5 139 L121 136 M168.5 139 L179 136" stroke="${ey.frame}" stroke-width="2" fill="none"/>`
      : ey.shades === 'wrap'
      ? `<path d="M124 134 Q150 128 176 134 L174 144 Q162 150 151 143 Q150 141 149 143 Q138 150 126 144 Z" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="2.2"/><path d="M130 137 Q136 135 142 137" stroke="rgba(255,255,255,.55)" stroke-width="1.5" fill="none"/>`
      : ey.shades === 'square'
      ? `<rect x="130" y="134" width="17" height="12" rx="2" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="2.2"/><rect x="153" y="134" width="17" height="12" rx="2" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="2.2"/><path d="M147 138 H153 M130 137 L121 135 M170 137 L179 135" stroke="${ey.frame}" stroke-width="2"/>`
      : `<path d="M130 135 H147 Q148 147 139 148 Q130 147 130 135 Z M153 135 H170 Q170 147 161 148 Q152 147 153 135 Z" fill="${ey.lens}" stroke="${ey.frame}" stroke-width="1.8"/><path d="M147 136 Q150 134 153 136 M130 136 L121 134 M170 136 L179 134" stroke="${ey.frame}" stroke-width="1.8" fill="none"/>`;
    const hd = L('head'), tp = L('top'), lg = L('bottom'), sh = L('shoes'), bg = L('bag'), bl = L('ball'), gv = L('glove'), wt = L('watch'), gl = L('layer');
    const dk = c => shade(c, -0.25);
    let legs;
    if (lg.leg === 'skort') legs = `<rect x="126" y="300" width="18" height="42" fill="${skin}"/><rect x="156" y="300" width="18" height="42" fill="${skin}"/>
      <rect x="125" y="330" width="20" height="12" fill="#fff"/><rect x="155" y="330" width="20" height="12" fill="#fff"/>
      <path d="M114 266 L186 266 L194 306 L106 306 Z" fill="${lg.c}" stroke="${dk(lg.c)}"/><path d="M128 268 L122 306 M150 268 V306 M172 268 L178 306" stroke="${dk(lg.c)}" stroke-width="1.5"/>`;
    else if (lg.leg === 'shorts') legs = `<rect x="122" y="268" width="26" height="36" rx="5" fill="${lg.c}"/><rect x="152" y="268" width="26" height="36" rx="5" fill="${lg.c}"/>
      <rect x="126" y="302" width="18" height="40" fill="${skin}"/><rect x="156" y="302" width="18" height="40" fill="${skin}"/>
      <rect x="125" y="330" width="20" height="12" fill="#fff"/><rect x="155" y="330" width="20" height="12" fill="#fff"/>`;
    else legs = `<rect x="122" y="268" width="26" height="76" rx="5" fill="${lg.c}"/><rect x="152" y="268" width="26" height="76" rx="5" fill="${lg.c}"/>
      ${lg.leg === 'check' ? `<g stroke="${lg.c2}" stroke-width="2" opacity=".85"><path d="M122 285h56M122 305h56M122 325h56"/><path d="M131 268v76M141 268v76M161 268v76M171 268v76"/></g>` : ''}
      <path d="M150 272v70" stroke="${dk(lg.c)}" stroke-width="1.5"/>`;
    const shoes = `<ellipse cx="133" cy="347" rx="17" ry="7" fill="${sh.shoe}" stroke="${dk(sh.shoe)}"/><ellipse cx="167" cy="347" rx="17" ry="7" fill="${sh.shoe}" stroke="${dk(sh.shoe)}"/>`;
    const TORSO = fem ? 'M116 186 Q150 174 184 186 L180 226 Q188 250 190 272 L110 272 Q112 250 120 226 Z' : 'M112 186 Q150 172 188 186 L192 272 L108 272 Z';
    let torso = `<path d="${TORSO}" fill="${tp.c}" stroke="${dk(tp.c)}" stroke-width="1.5"/>`;
    if (tp.top === 'polo') torso += `<path d="M138 178 L150 196 L162 178 L158 176 L150 186 L142 176 Z" fill="${shade(tp.c, -0.12)}"/><circle cx="150" cy="200" r="1.8" fill="${dk(tp.c)}"/><circle cx="150" cy="208" r="1.8" fill="${dk(tp.c)}"/>`;
    if (tp.top === 'qzip') torso += `<path d="M138 176 Q150 170 162 176 L160 186 Q150 182 140 186 Z" fill="${dk(tp.c)}"/><path d="M150 182 V214" stroke="#d9dde2" stroke-width="2"/><rect x="147" y="212" width="6" height="5" fill="#d9dde2"/>`;
    if (tp.top === 'argyle') torso += `<clipPath id="ta"><path d="${TORSO}"/></clipPath><g clip-path="url(#ta)">${[0, 1, 2].map(r => [0, 1, 2, 3].map(c => `<path d="M${108 + c * 28} ${200 + r * 28} l14 -14 l14 14 l-14 14 z" fill="${(r + c) % 2 ? tp.c2 : shade(tp.c, 0.15)}" opacity=".9"/>`).join('')).join('')}</g><path d="M140 178 L150 192 L160 178" fill="none" stroke="${dk(tp.c)}" stroke-width="3"/>`;
    if (tp.top === 'rain') torso += `<path d="M150 178 V270" stroke="#555" stroke-width="2"/><path d="M128 178 Q150 160 172 178" fill="none" stroke="${shade(tp.c, 0.2)}" stroke-width="5"/><rect x="118" y="230" width="18" height="10" rx="2" fill="${shade(tp.c, 0.15)}"/><rect x="164" y="230" width="18" height="10" rx="2" fill="${shade(tp.c, 0.15)}"/>`;
    if (gl.gilet) {
      // a body warmer sits over the top: no sleeves, a zip, a collar, quilting on the puffer styles
      const gc = gl.c, GIL = fem ? 'M118 184 Q150 176 182 184 L178 226 Q186 250 188 272 L112 272 Q114 250 122 226 Z' : 'M114 184 Q150 174 186 184 L190 272 L110 272 Z';
      torso += `<clipPath id="gv"><path d="${GIL}"/></clipPath><path d="${GIL}" fill="${gc}" stroke="${dk(gc)}" stroke-width="1.5"/>
        <g clip-path="url(#gv)">${gl.gilet === 'quilt' ? [0, 1, 2, 3, 4].map(i => `<path d="M108 ${196 + i * 16} H192" stroke="${dk(gc)}" stroke-width="2" opacity=".6"/>`).join('') : ''}
        ${gl.trim ? `<path d="M108 270 H192" stroke="${gl.trim}" stroke-width="4"/>` : ''}</g>
        <path d="M136 176 Q150 186 164 176 L166 168 Q150 176 134 168 Z" fill="${shade(gc, -0.1)}" stroke="${dk(gc)}"/>
        <path d="M150 178 V270" stroke="${gl.trim || shade(gc, 0.35)}" stroke-width="2"/><rect x="147" y="186" width="6" height="7" rx="1" fill="${gl.trim || '#d9dde2'}"/>
        <rect x="120" y="236" width="14" height="3" rx="1.5" fill="${dk(gc)}"/><rect x="166" y="236" width="14" height="3" rx="1.5" fill="${dk(gc)}"/>`;
    }
    const sleeve = tp.top === 'polo' ? 'short' : 'long';
    const arms = sleeve === 'short'
      ? `<path d="M112 188 L94 214 L104 222 L118 200 Z" fill="${tp.c}" stroke="${dk(tp.c)}"/><rect x="92" y="216" width="13" height="38" rx="6" fill="${skin}" transform="rotate(-8 98 216)"/>
         <path d="M188 188 L206 214 L196 222 L182 200 Z" fill="${tp.c}" stroke="${dk(tp.c)}"/><rect x="195" y="216" width="13" height="38" rx="6" fill="${skin}" transform="rotate(8 202 216)"/>`
      : `<rect x="92" y="190" width="16" height="66" rx="8" fill="${tp.c}" stroke="${dk(tp.c)}" transform="rotate(-10 100 190)"/><rect x="192" y="190" width="16" height="66" rx="8" fill="${tp.c}" stroke="${dk(tp.c)}" transform="rotate(10 200 190)"/>`;
    const gHand = (cx, cy) => gv.glove === 'mitt'
      ? `<ellipse cx="${cx}" cy="${cy + 1}" rx="11" ry="10" fill="${gv.c}" stroke="${dk(gv.c)}"/><rect x="${cx - 10}" y="${cy - 11}" width="20" height="5" rx="2.5" fill="${gv.tab}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="8" fill="${gv.c}" stroke="${dk(gv.c)}"/><rect x="${cx - 6}" y="${cy - 9}" width="12" height="4" rx="2" fill="${gv.tab}"/>${gv.perf ? `<circle cx="${cx - 3}" cy="${cy + 2}" r=".9" fill="${dk(gv.c)}"/><circle cx="${cx}" cy="${cy + 3}" r=".9" fill="${dk(gv.c)}"/><circle cx="${cx + 3}" cy="${cy + 2}" r=".9" fill="${dk(gv.c)}"/>` : ''}${gv.grip ? `<path d="M${cx - 5} ${cy + 1} h10 M${cx - 5} ${cy + 4} h10" stroke="${gv.tab}" stroke-width="1" opacity=".7"/>` : ''}`;
    const bare = gv.glove === 'pair' || gv.glove === 'mitt' ? gHand(104, 258) : `<circle cx="104" cy="258" r="8" fill="${skin}"/>`;
    const watch = !wt.watch ? '' : `<g transform="rotate(-10 100 246)"><rect x="92" y="242" width="17" height="7" rx="2" fill="${wt.watch === 'dial' ? wt.c : shade(wt.c, -0.05)}" stroke="${dk(wt.c)}"/>
      ${wt.watch === 'gps' ? `<rect x="94" y="238.5" width="13" height="13" rx="4" fill="${wt.bezel || wt.c}" stroke="${dk(wt.c)}"/><rect x="96" y="240.5" width="9" height="9" rx="2.5" fill="${wt.face}"/><path d="M98 245 h5" stroke="#3fae29" stroke-width="1.4"/>`
        : `<circle cx="100.5" cy="245.5" r="7" fill="${wt.c}" stroke="${dk(wt.c)}"/><circle cx="100.5" cy="245.5" r="5.2" fill="${wt.face}"/><path d="M100.5 245.5 V241.8 M100.5 245.5 L103 246.8" stroke="${wt.face === '#f4f4f0' ? '#222' : '#f4f4f0'}" stroke-width="1"/>`}</g>`;
    const hands = `${bare}${watch}${gHand(198, 258)}`;
    const club = `<path d="M198 256 L232 120" stroke="#9aa0a6" stroke-width="3" stroke-linecap="round"/><path d="M226 118 q10 -10 22 -2 q2 8 -8 12 z" fill="#222"/>`;
    const neck = `<rect x="141" y="160" width="18" height="20" fill="${skin}"/>`;
    const head = `<circle cx="150" cy="138" r="30" fill="${skin}"/><circle cx="120" cy="140" r="6" fill="${skin}"/><circle cx="180" cy="140" r="6" fill="${skin}"/>
      <circle cx="139" cy="140" r="3" fill="#2b2b2b"/><circle cx="161" cy="140" r="3" fill="#2b2b2b"/><path d="M140 153 Q150 161 160 153" fill="none" stroke="#7a3b2a" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="133" cy="150" r="4" fill="#e88" opacity=".25"/><circle cx="167" cy="150" r="4" fill="#e88" opacity=".25"/>`;
    const HS = HAIRSTYLES[Math.min(HAIRSTYLES.length - 1, defaultStyle(w))];
    const hairBack = HS[2] === 'AFRO' ? `<circle cx="150" cy="128" r="42" fill="${hairC}"/>` : HS[2] === 'BUN' ? `<circle cx="150" cy="100" r="12" fill="${hairC}"/><circle cx="150" cy="100" r="12" fill="none" stroke="${shade(hairC, -0.25)}" stroke-width="1.5"/>` : HS[2] ? `<path d="${HS[2]}" fill="${hairC}"/>` : '';
    const curls = [[124, 124], [131, 113], [141, 107], [152, 105], [163, 107], [172, 113], [178, 123]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8" fill="${hairC}"/>`).join('');
    const hair = HS[1] === 'C' ? curls : HS[1] ? `<path d="${HS[1]}" fill="${hairC}"/>` + (defaultStyle(w) === 6 ? `<circle cx="178" cy="126" r="5" fill="${shade(hairC, 0.2)}"/>` : '') : '';
    const hairOld = fem
      ? `<path d="M120 140 Q118 104 150 104 Q182 104 180 140 Q174 116 150 116 Q126 116 120 140 Z" fill="${hairC}"/><path d="M176 122 Q200 130 196 166 Q192 182 184 176 Q190 150 172 132 Z" fill="${hairC}"/><circle cx="178" cy="126" r="5" fill="${shade(hairC, 0.25)}"/>`
      : `<path d="M122 132 Q124 106 150 106 Q176 106 178 132 Q170 118 150 118 Q130 118 122 132 Z" fill="${hairC}"/>`;
    const lashes = fem ? `<path d="M134 136 l-3 -3 M137 135 l-1 -4 M166 136 l3 -3 M163 135 l1 -4" stroke="#2b2b2b" stroke-width="1.4"/>` : '';
    let hat = '';
    if (hd.hat === 'cap') hat = `<path d="M118 128 Q120 96 150 96 Q180 96 182 128 Z" fill="${hd.c}" stroke="${dk(hd.c)}"/><path d="M118 127 Q150 118 196 130 Q170 138 118 132 Z" fill="${shade(hd.c, -0.12)}"/><circle cx="150" cy="97" r="3" fill="${dk(hd.c)}"/>`;
    if (hd.hat === 'visor') hat = hair + `<rect x="118" y="116" width="64" height="9" rx="4" fill="${hd.c}" stroke="#ccc"/><path d="M118 124 Q150 116 196 128 Q170 136 118 130 Z" fill="${hd.c}" stroke="#ccc"/>`;
    if (hd.hat === 'bucket') hat = `<path d="M126 124 L132 98 Q150 92 168 98 L174 124 Z" fill="${hd.c}" stroke="${dk(hd.c)}"/><ellipse cx="150" cy="125" rx="40" ry="8" fill="${shade(hd.c, -0.08)}" stroke="${dk(hd.c)}"/>`;
    if (hd.hat === 'beanie') hat = `<path d="M120 126 Q120 94 150 94 Q180 94 180 126 Z" fill="${hd.c}"/><rect x="118" y="118" width="64" height="12" rx="5" fill="${shade(hd.c, -0.15)}"/><circle cx="150" cy="90" r="9" fill="#fff"/>`;
    if (hd.hat === 'flat') hat = `<path d="M118 126 Q122 104 150 104 Q178 104 186 120 Q194 126 186 128 L118 130 Z" fill="${hd.c}" stroke="${dk(hd.c)}"/><path d="M124 112 L180 118" stroke="${shade(hd.c, 0.15)}" stroke-width="2" opacity=".6"/>`;
    if (hd.hat === 'bandana') hat = `<path d="M119 128 Q120 100 150 99 Q180 100 181 128 Q166 118 150 118 Q134 118 119 128 Z" fill="${hd.c}" stroke="${dk(hd.c)}"/>${[0, 1, 2, 3, 4].map(i => `<circle cx="${130 + i * 10}" cy="${110 + (i % 2) * 4}" r="1.6" fill="${hd.c2}"/>`).join('')}<path d="M180 124 L196 120 L192 128 Z M180 126 L194 136 L186 138 Z" fill="${hd.c}" stroke="${dk(hd.c)}"/>`;
    if (hd.hat !== 'visor') hat = hair + hat;
    let bag;
    const bx = 214, by = 196;
    if (bg.bag === 'carry') bag = `<path d="M${bx + 8} ${by + 140} l-12 18 M${bx + 30} ${by + 140} l12 18" stroke="#888" stroke-width="3"/><rect x="${bx}" y="${by}" width="38" height="140" rx="12" fill="${bg.c}"/><rect x="${bx + 4}" y="${by + 70}" width="30" height="30" rx="6" fill="${shade(bg.c, 0.18)}"/>`;
    else if (bg.bag === 'cart') bag = `<rect x="${bx - 2}" y="${by - 6}" width="44" height="150" rx="10" fill="${bg.c}"/><rect x="${bx + 4}" y="${by + 40}" width="32" height="50" rx="6" fill="${shade(bg.c, 0.2)}"/><rect x="${bx - 2}" y="${by + 128}" width="44" height="16" rx="6" fill="${shade(bg.c, -0.2)}"/>`;
    else bag = `<rect x="${bx - 4}" y="${by - 10}" width="48" height="156" rx="14" fill="${bg.c}"/><rect x="${bx - 4}" y="${by + 30}" width="48" height="14" fill="${bg.c2}"/><rect x="${bx - 4}" y="${by + 100}" width="48" height="14" fill="${bg.c2}"/><rect x="${bx + 6}" y="${by + 54}" width="28" height="36" rx="4" fill="${shade(bg.c, 0.18)}"/>`;
    const clubsInBag = `<g stroke="#9aa0a6" stroke-width="2.5">${[6, 16, 26, 34].map((d, i) => `<path d="M${bx + d} ${by + 4} L${bx + d - 4 + i * 2} ${by - 30 - (i % 2) * 8}"/>`).join('')}</g>
      ${[6, 16, 26, 34].map((d, i) => `<rect x="${bx + d - 9 + i * 2}" y="${by - 42 - (i % 2) * 8}" width="12" height="12" rx="4" fill="${['#e3b23c', '#2f6b45', '#1d2b4f', '#c0392b'][i]}"/>`).join('')}`;
    const ball = `<circle cx="96" cy="350" r="7" fill="${bl.ball}" stroke="rgba(0,0,0,.3)"/>`;
    const rd = L('ride');
    const wide = rd.ride === 'buggy';
    let ride = '', hideBag = false;
    if (rd.ride === 'push' || rd.ride === 'electric') {
      const el = rd.ride === 'electric';
      ride = `<path d="M${bx + 19} ${by + 150} L${bx + 2} ${by + 172} M${bx + 19} ${by + 150} L${bx + 40} ${by + 172} M${bx + 30} ${by + 20} L${bx + 70} ${by - 20}" stroke="${rd.c}" stroke-width="5" stroke-linecap="round"/>
        <rect x="${bx + 62}" y="${by - 30}" width="18" height="10" rx="4" fill="${rd.c}"/>
        <circle cx="${bx + 2}" cy="${by + 172}" r="${el ? 13 : 10}" fill="#222" stroke="#666" stroke-width="3"/><circle cx="${bx + 40}" cy="${by + 172}" r="${el ? 13 : 10}" fill="#222" stroke="#666" stroke-width="3"/>
        ${el ? `<rect x="${bx + 8}" y="${by + 140}" width="24" height="14" rx="3" fill="#3fae29"/><circle cx="${bx + 74}" cy="${by - 22}" r="2.5" fill="#3fae29"/>` : ''}`;
    }
    let back = '';
    if (rd.ride === 'buggy') {
      hideBag = true;
      const pt = L('paint'), wh = L('wheels'), xs = new Set(w.extras || []);
      const body = pt.paint || rd.c, roof = pt.roof || rd.roof;
      const wheel = cx => { const r = 20 + (wh.big || 0); return `<circle cx="${cx}" cy="${348 - r}" r="${r}" fill="${wh.tyre}" ${wh.knob ? `stroke="${wh.tyre}" stroke-width="4" stroke-dasharray="3 3"` : ''}/>${wh.wall ? `<circle cx="${cx}" cy="${348 - r}" r="${r - 6}" fill="none" stroke="${wh.wall}" stroke-width="3"/>` : ''}<circle cx="${cx}" cy="${348 - r}" r="9" fill="${wh.hub}"/>${wh.spokes ? Array.from({ length: wh.spokes }, (_, i) => { const a = i / wh.spokes * 6.283; return `<path d="M${cx} ${348 - r} l${(Math.cos(a) * (r - 7)).toFixed(1)} ${(Math.sin(a) * (r - 7)).toFixed(1)}" stroke="${wh.hub}" stroke-width="2"/>`; }).join('') : ''}`; };
      const bodyPath = 'M196 262 Q194 236 222 232 L290 232 Q312 232 312 262 L312 316 Q312 326 302 326 L204 326 Q194 326 194 316 Z';
      const deco = (pt.stripe ? `<path d="M196 292 H312" stroke="${pt.stripe}" stroke-width="5"/>` : '')
        + (pt.check ? `<clipPath id="bk"><path d="${bodyPath}"/></clipPath><g clip-path="url(#bk)">${Array.from({ length: 24 }, (_, i) => (i % 2 === Math.floor(i / 12) % 2) ? `<rect x="${194 + (i % 12) * 10}" y="${296 + Math.floor(i / 12) * 10}" width="10" height="10" fill="${pt.check}"/>` : '').join('')}</g>` : '');
      const extras = (xs.has('x_flag') ? `<path d="M206 132 V96" stroke="#9aa0a6" stroke-width="2"/><path d="M206 96 L232 104 L206 112 Z" fill="${pt.stripe || '#e3b23c'}"/>` : '')
        + (xs.has('x_brella') ? `<path d="M318 168 V118" stroke="#555" stroke-width="3"/><path d="M296 124 Q318 96 340 124 Z" fill="#3fae29"/><path d="M296 124 Q307 116 318 124 Q329 116 340 124" fill="none" stroke="#fff" stroke-width="1.5"/>` : '')
        + (xs.has('x_cup') ? `<rect x="286" y="216" width="13" height="17" rx="2" fill="#f4f4f0" stroke="#555"/><path d="M294 216 L298 205" stroke="#e8483b" stroke-width="2"/><rect x="283" y="230" width="19" height="4" rx="1" fill="#2a2d33"/>` : '')
        + (xs.has('x_cool') ? `<rect x="314" y="290" width="28" height="24" rx="3" fill="#2e7fd1"/><rect x="314" y="290" width="28" height="7" rx="2" fill="#f4f4f0"/><rect x="324" y="286" width="8" height="4" rx="1" fill="#9aa0a6"/>` : '')
        + (xs.has('x_gps') ? `<path d="M300 172 L292 188" stroke="#9aa0a6" stroke-width="3"/><rect x="278" y="186" width="26" height="18" rx="2" fill="#111" stroke="#9aa0a6"/><rect x="281" y="189" width="20" height="12" fill="#3fae29" opacity=".85"/>` : '')
        + (xs.has('x_card') ? `<rect x="262" y="150" width="18" height="24" fill="#fff" stroke="#999"/><path d="M265 156h12M265 161h12M265 166h9" stroke="#aaa"/><rect x="268" y="146" width="6" height="5" fill="#9aa0a6"/>` : '')
        + (xs.has('x_speaker') ? `<rect x="214" y="142" width="22" height="12" rx="3" fill="#222"/><circle cx="220" cy="148" r="3" fill="#555"/><circle cx="230" cy="148" r="3" fill="#555"/>` : '');
      back = `<g transform="translate(34 0)">
        <rect x="200" y="132" width="112" height="10" rx="5" fill="${roof}"/>
        <path d="M206 142 L206 262 M300 142 L300 262" stroke="#9aa0a6" stroke-width="4"/>
        <path d="${bodyPath}" fill="${body}" stroke="${shade(body, -0.3)}" stroke-width="2"/>${deco}
        <rect x="226" y="212" width="50" height="22" rx="6" fill="#2a2d33"/><rect x="220" y="244" width="62" height="18" rx="5" fill="#3a3d44"/>
        <rect x="300" y="168" width="22" height="110" rx="9" fill="${bg.c}"/>${[0, 1, 2].map(i => `<rect x="${302 + i * 6}" y="${150 - i * 6}" width="6" height="18" rx="2" fill="${['#e3b23c', '#2f6b45', '#c0392b'][i]}"/>`).join('')}
        ${wheel(222)}${wheel(292)}${extras}
        <rect x="240" y="276" width="34" height="12" rx="3" fill="#fff"/><text x="257" y="285" text-anchor="middle" font-family="system-ui,sans-serif" font-size="7" font-weight="800" fill="#16241c">GPAI</text></g>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="56 70 ${wide ? 320 : 270} 300" width="${size}" height="${size * 300 / (wide ? 320 : 270)}">
      <ellipse cx="170" cy="352" rx="110" ry="12" fill="rgba(0,0,0,.18)"/>${back}${hideBag ? '' : clubsInBag + bag + ride}${legs}${shoes}${arms}${torso}${neck}${hairBack}${head}${lashes}${eyes}${hat}${hands}${club}${ball}</svg>`;
  }
  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = v => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
    return '#' + [f(r), f(g), f(b)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  function golferTitle(stats) {
    if (stats.aces) return 'Hole-in-One Hero';
    if (stats.best !== null && stats.best <= -8) return 'Birdie Machine';
    if (stats.streak >= 7) return 'Seven-Day Stalwart';
    if (stats.best !== null && stats.best <= -3) return 'Red Number Regular';
    if (stats.streak >= 3) return 'Daily Grinder';
    return 'Weekend Warrior';
  }
  // Wild Nine Index: a for-fun handicap, the average of your best recent official rounds (to par)
  function indexRounds() {
    const out = [];
    for (let d = dayNo; d >= 1 && out.length < 20; d--) { const r = store.get('wildnine-' + seedFor(d)); if (r && typeof r.tp === 'number') out.push({ d, tp: r.tp }); }
    return out;
  }
  function wildIndex() {
    const rs = indexRounds(), n = rs.length;
    if (n < 3) return null;
    const use = n <= 5 ? 1 : n <= 8 ? 2 : n <= 11 ? 3 : n <= 14 ? 4 : n <= 16 ? 5 : n <= 18 ? 6 : n === 19 ? 7 : 8;
    const best = rs.map(r => r.tp).sort((a, b) => a - b).slice(0, use);
    return Math.round(best.reduce((a, b) => a + b, 0) / use * 0.96 * 10) / 10;
  }
  const fmtIdx = i => i == null ? '–' : (i > 0 ? '+' : i < 0 ? '−' : '') + Math.abs(i).toFixed(1);
  function myStats() {
    const best = store.get('wildnine-best'), hof = store.get('wildnine-hof') || [];
    return { best: best ? best.tp : null, streak: streakNow(), earned: wallet().earned, aces: hof.length, index: wildIndex(), rounds: indexRounds().length };
  }

  // a code that rebuilds the golfer from a link: one character per slot, the skin tone, best score and name
  function golferCode(w, stats) {
    const chars = SLOTS.map(s => { const list = ITEMS.filter(i => i.slot === s.k); return Math.max(0, list.findIndex(i => i.id === w.eq[s.k])).toString(36); }).join('');
    const best = stats.best === null ? 'zz' : (stats.best + 100).toString(36).padStart(2, '0');
    const name = (w.name || 'Golfer').replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || 'Golfer';
    const mask = EXTRAS.reduce((m, x, i) => m | ((w.extras || []).includes(x.id) ? 1 << i : 0), 0).toString(36).padStart(2, '0');
    const ix = stats.index == null ? 'zz' : Math.max(0, Math.min(1294, Math.round(stats.index * 10) + 300)).toString(36).padStart(2, '0');
    return `${chars}${(w.skin || 0).toString(36)}${w.body === 'f' ? 'f' : 'm'}${(w.hair || 0).toString(36)}${defaultStyle(w).toString(36)}${ix}${best}${Math.min(35, stats.streak).toString(36)}${mask}-${name}`;
  }
  function parseGolfer(code) {
    const m0 = new RegExp(`^([0-9a-z]{${SLOTS.length}})([0-9a-z])([mf])([0-9a-z])([0-9a-z])([0-9a-z]{2})([0-9a-z]{2})([0-9a-z])([0-9a-z]{2})-([A-Za-z0-9]{1,14})$`).exec(code);
    const m = m0 && [m0[0], m0[1], m0[2], m0[3], m0[4], m0[7], m0[8], m0[9], m0[10]];
    const hsx = m0 ? parseInt(m0[5], 36) : 0, ixx = m0 && m0[6] !== 'zz' ? (parseInt(m0[6], 36) - 300) / 10 : null;
    if (!m) return null;
    const eq = {};
    SLOTS.forEach((s, i) => { const list = ITEMS.filter(x => x.slot === s.k); eq[s.k] = (list[parseInt(m[1][i], 36)] || list[0]).id; });
    return { w: { eq, skin: Math.min(SKINS.length - 1, parseInt(m[2], 36)), body: m[3], hair: Math.min(HAIRS.length - 1, parseInt(m[4], 36)), hs: Math.min(HAIRSTYLES.length - 1, hsx), name: m[8], extras: EXTRAS.filter((x, i) => parseInt(m[7] || '0', 36) & (1 << i)).map(x => x.id) }, stats: { best: m[5] === 'zz' ? null : parseInt(m[5], 36) - 100, streak: parseInt(m[6], 36), aces: 0, index: ixx } };
  }

  function golferCardSvg(w, stats, shared) {
    const title = golferTitle(stats), name = esc(w.name || 'Your golfer');
    const best = stats.best === null ? '–' : fmtPar(stats.best);
    const th = look(w, 'card').theme;
    const bg = th === 'th-royal' ? ['#13204a', '#2a3a73', '#e3b23c'] : th === 'th-links' ? ['#b8925a', '#e7d3a6', '#0f3b23'] : ['#0f3b23', '#1f6a3a', '#e3b23c'];
    const g = golferSvg(w, 200).replace('<svg ', '<svg x="80" y="96" ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 560" width="360" height="560">
      <defs><linearGradient id="bgr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg[0]}"/><stop offset="1" stop-color="${bg[1]}"/></linearGradient></defs>
      <rect width="360" height="560" rx="26" fill="url(#bgr)"/><rect x="10" y="10" width="340" height="540" rx="20" fill="none" stroke="${bg[2]}" stroke-width="3"/>
      <text x="180" y="44" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" letter-spacing="3" fill="${bg[2]}">WILD NINE GOLFER</text>
      <text x="180" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#fff">${name}</text>
      <rect x="95" y="90" width="170" height="24" rx="12" fill="${bg[2]}"/><text x="180" y="107" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="800" fill="${bg[0]}">${esc(title)}</text>
      <circle cx="180" cy="280" r="120" fill="rgba(255,255,255,.08)"/>${g}
      <g font-family="system-ui,sans-serif" text-anchor="middle" fill="#fff">
        <rect x="24" y="438" width="96" height="60" rx="12" fill="rgba(0,0,0,.22)"/><text x="72" y="470" font-size="24" font-weight="800">${best}</text><text x="72" y="489" font-size="10" opacity=".75">BEST ROUND</text>
        <rect x="132" y="438" width="96" height="60" rx="12" fill="rgba(0,0,0,.22)"/><text x="180" y="470" font-size="24" font-weight="800">${stats.streak || 0}</text><text x="180" y="489" font-size="10" opacity=".75">DAY STREAK</text>
        <rect x="240" y="438" width="96" height="60" rx="12" fill="rgba(0,0,0,.22)"/><text x="288" y="470" font-size="24" font-weight="800">${fmtIdx(stats.index)}</text><text x="288" y="489" font-size="10" opacity=".75">W9 INDEX</text>
      </g>
      <text x="180" y="526" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="${bg[2]}">golfpriceai.com/play/wild-nine</text>
      <text x="180" y="543" text-anchor="middle" font-family="Georgia,serif" font-size="11" font-style="italic" fill="#fff" opacity=".75">Full Swing. Not full price.</text></svg>`;
  }
  function svgToPng(svg, W, H) {
    W = W || 720; H = H || 1120;
    return new Promise(res => {
      const img = new Image();
      img.onload = () => { try { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(img, 0, 0, W, H); res(c.toDataURL('image/png')); } catch (e) { res(null); } };
      img.onerror = () => res(null);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ---------- Pro Shop ----------
  function priceLine(it) {
    if (it.game) return '<span class="ps-real">Game exclusive</span>';
    const p = it.p && SHOP_P[it.p];
    const txt = p && p.n >= 15 && p.from >= 3 ? `See the real one, from ${money(p.from)} today` : 'See the real ones';
    return `<a class="ps-real" href="${SITE}/shop.html?${it.link}" target="_blank" rel="noopener">${txt}</a>`;
  }
  function swatch(it, w) {
    const L = it.look;
    if (it.slot === 'ball') return `<span class="sw sw-ball" style="background:${L.ball}"></span>`;
    if (it.slot === 'trail') return `<span class="sw sw-trail ${L.trail || 'none'}" ${L.trail === 'season' ? `style="background:linear-gradient(90deg,transparent,${L.c})"` : ''}></span>`;
    if (it.slot === 'card') return `<span class="sw sw-card ${L.theme || 'th-classic'}"></span>`;
    if (it.slot === 'ride' && !L.ride) return '<span class="sw sw-walk">On foot</span>';
    const tw = { ...w, eq: { ...w.eq, [it.slot]: it.id } };
    if ((it.slot === 'paint' || it.slot === 'wheels') && ITEM[tw.eq.ride].look.ride !== 'buggy') tw.eq.ride = 'buggy';
    if (it.slot === 'eyes' && !L.shades) return '<span class="sw sw-walk">Bare eyes</span>';
    if (it.slot === 'watch' && !L.watch) return '<span class="sw sw-walk">Bare wrist</span>';
    if (it.slot === 'layer' && !L.gilet) return '<span class="sw sw-walk">Just your top</span>';
    // small kit gets a close-up so you can actually see it
    const zoom = it.slot === 'eyes' ? '112 104 76 64' : it.slot === 'head' ? '104 76 100 96' : it.slot === 'watch' ? '78 222 50 46' : it.slot === 'glove' ? (L.glove === 'one' ? '170 228 56 52' : '84 226 136 46') : null;
    if (zoom) return `<span class="sw sw-golfer sw-zoom">${golferSvg(tw, 64).replace(/viewBox="[^"]+"/, `viewBox="${zoom}"`).replace(/height="[^"]+"/, 'height="64"')}</span>`;
    return `<span class="sw sw-golfer">${golferSvg(tw, 64)}</span>`;
  }

  // caddie cards you can buy with Birdies; only one comes into each round, so the game never gets easy
  const CC_COST = { mulligan: 12, tailwind: 8, bigstick: 10, laser: 10, sandwizard: 6, gimme: 10, bounceback: 12, stillair: 8, steady: 10 };
  const locker = () => wallet().cards || {};
  const lockerCount = () => Object.values(locker()).reduce((a, b) => a + b, 0);
  let shopTab = 'head', shopTabX = 0;
  function showShop(back) {
    const w = wallet();
    const nowDrop = ITEMS.filter(i => i.drop === monthKey());
    const hasBuggy = w.owned.some(id => ITEM[id] && ITEM[id].look.ride === 'buggy');
    const items = shopTab === 'cc' ? [] : shopTab === 'new' ? nowDrop : shopTab === 'buggy' ? ITEMS.filter(i => i.slot === 'paint' || i.slot === 'wheels') : ITEMS.filter(i => i.slot === shopTab);
    const nextDrop = DROPS[monthKey(1)];
    const goal = w.goal && ITEM[w.goal] && !w.owned.includes(w.goal) ? ITEM[w.goal] : null;
    overlay(`<div class="kicker">The Pro Shop</div><h2>${bz(w.bal, true)} <small class="bzw">Birdies</small></h2>
      <p class="fine">Earn Birdies by playing: 2 for today's course, 1 for every shot under par, streak bonuses, and 50 for a Hole 10 ace. Kit is looks only and never changes a shot. Caddie cards are the one thing that helps, so you can bring just one into a round. Nothing here costs real money: every Birdie is earned on the course. </p>
      ${w.gift ? '<div class="done">Welcome gift: 5 Birdies to get you started.</div>' : ''}
      <div class="ps-preview">${golferSvg(w, 140)}<button class="ghost" id="myGolfer">My golfer card</button></div>
      ${goal ? `<div class="goal"><b>Saving for: ${esc(goal.name)}</b><div class="se-bar"><i style="width:${Math.min(100, w.bal / goal.cost * 100)}%"></i></div><span>${w.bal} of ${goal.cost} Birdies${w.bal >= goal.cost ? ' \u00B7 you can buy it now' : ''}</span></div>` : ''}
      <div class="tabwrap"><button class="tabarr l" aria-label="Earlier categories">&lsaquo;</button><div class="tabs"><button class="tab ${shopTab === 'new' ? 'on' : ''}" data-t="new">New this month</button>${SLOTS.filter(s => !s.buggy).map(s => `<button class="tab ${s.k === shopTab ? 'on' : ''}" data-t="${s.k}">${s.label}</button>`).join('')}<button class="tab ${shopTab === 'buggy' ? 'on' : ''}" data-t="buggy">Buggy upgrades</button><button class="tab ${shopTab === 'cc' ? 'on' : ''}" data-t="cc">Caddie cards</button></div><button class="tabarr r" aria-label="More categories">&rsaquo;</button></div>
      ${shopTab === 'cc' ? `<p class="fine">Cards wait in your locker. At the first tee of a solo round you can bring <b>one</b> with you, so they help without making the game easy. In your locker: ${lockerCount()}.</p><div class="ps-grid">${E.CARD_IDS.map(id => { const C = E.CARDS[id], have = (w.cards || {})[id] || 0; return `<div class="ps-item"><span class="sw sw-cc"><b>${esc(C.name)}</b></span><span class="ps-real">${esc(C.desc)}</span>${have ? `<em class="newb">In locker: ${have}</em>` : ''}<button class="ps-btn buy" data-cc="${id}" ${w.bal >= CC_COST[id] ? '' : 'disabled'}>${bz(CC_COST[id])}</button></div>`; }).join('')}</div>` : ''}
      ${shopTab === 'buggy' ? `<p class="fine">${hasBuggy ? 'Make it yours. Paint and wheels swap freely; extras stack, so fit as many as you like.' : 'These fit the golf buggy. Save up for the buggy first (in Rides), then kit it out.'}</p>` : ''}
      ${shopTab === 'new' ? `<p class="fine">A new set lands on the 1st of every month and stays in the shop for good, so you never miss out.${nextDrop ? ` Coming next month: ${nextDrop.map(i => esc(i.name)).join(', ')}.` : ''}</p>${nowDrop.length ? '' : '<div class="done">No new set this month. The next one lands on the 1st; until then, everything is in the main tabs.</div>'}` : ''}
      <div class="ps-grid">${items.map(it => {
        const own = w.owned.includes(it.id), on = w.eq[it.slot] === it.id, locked = (it.slot === 'paint' || it.slot === 'wheels') && !hasBuggy && !own, can = w.bal >= it.cost && !locked;
        return `<div class="ps-item ${on ? 'on' : ''} ${it.star ? 'bigone' : ''}">${it.drop ? '<em class="newb">New</em>' : ''}${it.star ? '<em class="starb">Big one</em>' : ''}${swatch(it, w)}<b>${esc(it.name)}</b>
          ${on ? `<button class="ps-btn eq" disabled>${['ride', 'paint', 'wheels'].includes(it.slot) ? 'In use' : 'Wearing'}</button>` : own ? `<button class="ps-btn" data-eq="${it.id}">Use</button>` : (it.season && !window.WN_TEST) ? '<button class="ps-btn" disabled>Season reward</button>' : locked ? '<button class="ps-btn" disabled>Needs the buggy</button>' : can ? `<button class="ps-btn buy" data-buy="${it.id}">${bz(it.cost)}</button>` : `<button class="ps-btn save ${w.goal === it.id ? 'on' : ''}" data-goal="${it.id}">${w.goal === it.id ? 'Saving for this' : `Save for it: ${bz(it.cost)}`}</button>`}
          ${it.season ? `<span class="ps-real">${esc(seasonInfo(it.season).name)}</span>` : priceLine(it)}</div>`; }).join('')}</div>
      ${shopTab === 'buggy' ? `<div class="kicker" style="margin-top:12px">Extras: fit as many as you like</div><div class="ps-grid">${EXTRAS.map(x => {
        const own = (w.xown || []).includes(x.id), fit = (w.extras || []).includes(x.id);
        const tw = { ...w, eq: { ...w.eq, ride: hasBuggy && ITEM[w.eq.ride].look.ride === 'buggy' ? w.eq.ride : 'buggy' }, extras: [x.id] };
        return `<div class="ps-item ${fit ? 'on' : ''}"><span class="sw sw-golfer">${golferSvg(tw, 64)}</span><b>${esc(x.name)}</b><span class="ps-real">${esc(x.blurb)}</span>
          ${own ? `<button class="ps-btn ${fit ? 'eq' : ''}" data-fit="${x.id}">${fit ? 'Fitted \u00B7 remove' : 'Fit it'}</button>` : !hasBuggy ? '<button class="ps-btn" disabled>Needs the buggy</button>' : `<button class="ps-btn buy" data-xbuy="${x.id}" ${w.bal >= x.cost ? '' : 'disabled'}>${bz(x.cost)}</button>`}</div>`; }).join('')}</div>` : ''}
      <button class="ghost" id="psBack">Back</button>`);
    $$('[data-cc]').forEach(b => b.onclick = once(() => {
      const w2 = wallet(), id = b.dataset.cc; if (w2.bal < CC_COST[id]) return;
      w2.bal -= CC_COST[id]; w2.cards = { ...(w2.cards || {}), [id]: ((w2.cards || {})[id] || 0) + 1 }; saveWallet(w2);
      toastTop(`${E.CARDS[id].name}: in your locker.`); showShop(back);
    }));
    $$('[data-fit]').forEach(b => b.onclick = () => { const w2 = wallet(), id = b.dataset.fit; w2.extras = (w2.extras || []).includes(id) ? w2.extras.filter(e => e !== id) : [...(w2.extras || []), id]; saveWallet(w2); showShop(back); });
    $$('[data-xbuy]').forEach(b => b.onclick = once(() => {
      const w2 = wallet(), x = EXTRA[b.dataset.xbuy];
      if (w2.bal < x.cost || (w2.xown || []).includes(x.id)) return;
      w2.bal -= x.cost; w2.xown = [...(w2.xown || []), x.id]; w2.extras = [...(w2.extras || []), x.id]; saveWallet(w2);
      toastTop(`${x.name}: fitted.`); showShop(back);
    }));
    if (w.gift) { w.gift = false; saveWallet(w); }
    $$('.tab').forEach(b => b.onclick = () => { const tb = $('.tabs'); shopTabX = tb ? tb.scrollLeft : 0; shopTab = b.dataset.t; showShop(back); });
    // the category row: keep its place, bring the chosen one into view, arrows and the mouse wheel move it along
    { const tb = $('.tabs'), on = tb && tb.querySelector('.tab.on');
      if (tb) {
        tb.scrollLeft = shopTabX;
        if (on) { const want = on.offsetLeft - (tb.clientWidth - on.offsetWidth) / 2; tb.scrollTo({ left: Math.max(0, want), behavior: 'smooth' }); }
        const arrows = () => { const l = $('.tabarr.l'), r = $('.tabarr.r'); if (l) l.hidden = tb.scrollLeft < 4; if (r) r.hidden = tb.scrollLeft + tb.clientWidth > tb.scrollWidth - 4; };
        tb.addEventListener('scroll', arrows, { passive: true }); setTimeout(arrows, 350); arrows();
        $('.tabarr.l').onclick = () => tb.scrollBy({ left: -tb.clientWidth * 0.7, behavior: 'smooth' });
        $('.tabarr.r').onclick = () => tb.scrollBy({ left: tb.clientWidth * 0.7, behavior: 'smooth' });
        tb.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tb.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
      } }
    $$('[data-eq]').forEach(b => b.onclick = () => { const w2 = wallet(); w2.eq[ITEM[b.dataset.eq].slot] = b.dataset.eq; saveWallet(w2); showShop(back); });
    $$('[data-goal]').forEach(b => b.onclick = () => { const w2 = wallet(); w2.goal = w2.goal === b.dataset.goal ? null : b.dataset.goal; saveWallet(w2); showShop(back); });
    $$('[data-buy]').forEach(b => b.onclick = once(() => {
      const w2 = wallet(), it = ITEM[b.dataset.buy];
      if (w2.bal < it.cost || w2.owned.includes(it.id)) return;
      w2.bal -= it.cost; w2.owned.push(it.id); w2.eq[it.slot] = it.id; if (w2.goal === it.id) w2.goal = null; saveWallet(w2);
      toastTop(`${it.name}: yours. Looking sharp.`); showShop(back);
    }));
    $('#myGolfer').onclick = () => showGolfer(() => showShop(back));
    $('#psBack').onclick = back || showTitle;
  }
  function toastTop(m) { const el = $('#toast'); el.textContent = m; el.classList.add('show'); clearTimeout(window.__tt); window.__tt = setTimeout(() => el.classList.remove('show'), 2200); }

  async function showGolfer(back) {
    const w = wallet(), stats = myStats();
    const draw = async () => {
      const svg = golferCardSvg(w, stats);
      overlay(`<div class="kicker">Your golfer</div>
        <input class="name" id="gName" maxlength="14" placeholder="Your name" value="${esc(w.name || '')}">
        <div class="seg"><button class="${w.body === 'f' ? '' : 'on'}" data-b="m">Male golfer</button><button class="${w.body === 'f' ? 'on' : ''}" data-b="f">Female golfer</button></div>
        <div class="pick-l">Skin</div><div class="skins">${SKINS.map((c, i) => `<button class="skin ${i === (w.skin || 0) ? 'on' : ''}" data-s="${i}" style="background:${c}" aria-label="Skin tone ${i + 1}"></button>`).join('')}</div>
        <div class="pick-l">Hair</div><div class="skins">${HAIRS.map((c, i) => `<button class="skin hairb ${i === (w.hair || 0) ? 'on' : ''}" data-h="${i}" style="background:${c}" aria-label="Hair colour ${i + 1}"></button>`).join('')}</div>
        <div class="pick-l">Hair style <small>(free, any style for any golfer)</small></div>
        <div class="hstyles">${HAIRSTYLES.map((h, i) => `<button class="hst ${i === defaultStyle(w) ? 'on' : ''}" data-hs="${i}" aria-label="${h[0]}">${golferSvg({ ...w, hs: i, eq: { ...w.eq, head: 'hat_none' } }, 64).replace(/viewBox="[^"]+"/, 'viewBox="100 80 100 100"').replace(/height="[^"]+"/, 'height="56"').replace(/width="[^"]+"/, 'width="56"')}<span>${h[0]}</span></button>`).join('')}</div>
        <div class="gcard" id="gcard">${svg}</div>
        <div class="idxline">${stats.index == null ? `Your Wild Nine Index appears after 3 official rounds (${stats.rounds || 0} so far).` : `Wild Nine Index <b>${fmtIdx(stats.index)}</b>: from your best recent official rounds. Just for fun, not a real handicap.`}</div>
        ${lookPanel(w)}
        ${shareBar('shGolfer', 'Share your golfer')}
        <a id="wa" hidden></a><button id="gCopy" hidden></button>
        <button class="ghost" id="gShop">Visit the Pro Shop</button>
        <button class="ghost" id="gBack">Back</button>`);
      const png = await svgToPng(svg);
      if (png && $('#gcard')) $('#gcard').innerHTML = `<img src="${png}" alt="${esc(w.name || 'My')} Wild Nine golfer card">`;
      const link = () => `golfpriceai.com/play/wild-nine#golfer-${golferCode(w, stats)}`;
      const msg = () => {
        const today = store.get('wildnine-' + ymd);
        return `Meet my Wild Nine golfer${w.name ? ', ' + w.name : ''}.${today ? ` Today's card: ${today.tot} (${fmtPar(today.tp)}) at ${E.courseName(ymd)}.` : ''} Think you can beat me? https://${link()}`;
      };
      $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg());
      wireShare('shGolfer', { text: msg().replace(/ https:\/\/\S+$/, ''), url: link(), subject: 'My Wild Nine golfer', fname: 'my-wild-nine-golfer', image: () => svgToPng(svg) });
      $('#gCopy').onclick = async () => { try { await navigator.clipboard.writeText(msg()); $('#gCopy').textContent = 'Copied. Paste it anywhere'; } catch (e) { $('#gCopy').textContent = link(); } };
      $('#gName').onchange = () => { w.name = $('#gName').value.trim().slice(0, 14); saveWallet(w); draw(); };
      const keep = () => { w.name = $('#gName').value.trim().slice(0, 14); };
      $$('[data-s]').forEach(b => b.onclick = () => { keep(); w.skin = +b.dataset.s; saveWallet(w); draw(); });
      $$('[data-h]').forEach(b => b.onclick = () => { keep(); w.hair = +b.dataset.h; saveWallet(w); draw(); });
      $$('[data-b]').forEach(b => b.onclick = () => { keep(); if (w.hs == null) w.hs = defaultStyle(w); w.body = b.dataset.b; saveWallet(w); draw(); });
      $$('[data-hs]').forEach(b => b.onclick = () => { keep(); w.hs = +b.dataset.hs; saveWallet(w); draw(); });
      wireLook();
      $('#gShop').onclick = () => showShop(() => showGolfer(back));
      $('#gBack').onclick = back || showTitle;
    };
    draw();
  }

  function showSharedGolfer(code) {
    const g = parseGolfer(code);
    if (!g) return showTitle();
    const svg = golferCardSvg(g.w, g.stats, true);
    overlay(`<div class="kicker">A challenge from ${esc(g.w.name)}</div><h2>${esc(g.w.name)} wants a game</h2>
      <div class="gcard">${svg}</div>
      <p class="fine">${g.stats.best === null ? 'They have not posted a round yet.' : `Their best round is ${fmtPar(g.stats.best)}.`} Today's course is the same for everyone: ${esc(E.courseName(ymd))}.</p>
      <button class="primary" id="sgPlay">Play today's course</button>
      <button class="ghost" id="sgMake">Build my own golfer</button>`);
    $('#sgPlay').onclick = () => { clearHash(); showTitle(); };
    $('#sgMake').onclick = () => { clearHash(); showGolfer(showTitle); };
  }
  // ---------- coming back for the right reasons: challenges, passport, seasons, stats, ghosts, mates ----------
  // House rules: no paid randomness, no countdowns, no guilt. Everything here rewards playing, never pressure.

  // ---- per-round tracking (solo rounds) ----
  function trackStart() { S.rs = S.rs || { fair: 0, fairTry: 0, gir: 0, holes: 0, putts: 0, pen: 0, three: 0, one: 0, shapedGreen: 0, cards: 0, longDrive: 0, paths: [], hole: [] }; S.hs = { putts: 0, gir: false, path: [{ ...hole().tee }] }; }
  function trackShot(sh, sd, pen) {
    if (!S.rs || S.mode !== 'solo' || S.bonus) return;
    const h = hole(), rs = S.rs, hs = S.hs;
    if (pen) rs.pen++;
    if (sh.club === 'putter') hs.putts++;
    if (sd.swings === 0 && h.par >= 4) { rs.fairTry++; if (sh.finish === 'fairway') rs.fair++; }
    if (sh.club !== 'putter' && (sh.finish === 'green' || sh.result === 'holed') && sd.strokes + 1 + pen <= h.par - 2) hs.gir = true;
    if ((sh.events || []).includes('shaped') && sh.finish === 'green') rs.shapedGreen++;
    if (sh.club === 'driver' && !pen && sh.carry) rs.longDrive = Math.max(rs.longDrive, sh.carry);
    hs.path.push(sh.result === 'holed' ? { ...h.cup } : { ...sh.end });
  }
  function trackHoleEnd(sd) {
    if (!S.rs || S.mode !== 'solo') return;
    const rs = S.rs, hs = S.hs;
    rs.holes++; if (hs.gir) rs.gir++;
    rs.putts += hs.putts; if (hs.putts >= 3) rs.three++; if (hs.putts === 1 && sd.holed) rs.one++;
    rs.paths[S.h] = hs.path; rs.hole[S.h] = { putts: hs.putts, gir: hs.gir };
  }

  // ---- daily challenges: three a day, the same for everyone ----
  const CH = {
    fair: n => ({ text: `Hit ${n} fairways off the tee`, test: rs => rs.fair >= n, prog: rs => `${Math.min(rs.fair, n)}/${n}` }),
    gir: n => ({ text: `Hit ${n} greens in regulation`, test: rs => rs.gir >= n, prog: rs => `${Math.min(rs.gir, n)}/${n}` }),
    noThree: () => ({ text: 'No three-putts all round', test: rs => rs.three === 0 && rs.holes === 9 }),
    noPen: () => ({ text: 'No penalty strokes', test: rs => rs.pen === 0 && rs.holes === 9 }),
    one: n => ({ text: `Hole ${n} one-putts`, test: rs => rs.one >= n, prog: rs => `${Math.min(rs.one, n)}/${n}` }),
    shaped: () => ({ text: 'Land a draw or a fade on the green', test: rs => rs.shapedGreen >= 1 }),
    noCards: () => ({ text: 'Finish without playing a caddie card', test: rs => rs.cards === 0 && rs.holes === 9 }),
    bomb: () => ({ text: 'Carry a drive 235 yards or more', test: rs => rs.longDrive >= 235 }),
    under: () => ({ text: 'Finish under par', test: () => S && toPar(S.sides[0]) < 0 && S.sides[0].scores.length === 9 })
  };
  function challengesFor(seed) {
    const r = E.mulberry32(seed * 13 + 5);
    const pool = [['fair', 3 + Math.floor(r() * 3)], ['gir', 3 + Math.floor(r() * 3)], ['noThree'], ['noPen'], ['one', 2 + Math.floor(r() * 2)], ['shaped'], ['noCards'], ['bomb'], ['under']];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 3).map(([k, n]) => ({ k, n, ...CH[k](n) }));
  }
  function challengeResults() {
    const list = challengesFor(S.cfg.seed);
    return list.map(c => ({ ...c, done: !!(S.rs && c.test(S.rs)) }));
  }
  function payChallenges() {
    if (!S.cfg.official || S.chPaid) return null;
    S.chPaid = true;
    const res = challengeResults(), won = res.filter(c => c.done).length;
    const n = won * 2 + (won === 3 ? 3 : 0);
    if (n) awardBonus(n, won === 3 ? 'all three daily challenges' : `${won} daily challenge${won > 1 ? 's' : ''}`);
    store.set('wildnine-ch-' + ymd, res.map(c => c.done));
    return { res, n };
  }
  function challengeList(res, small) {
    return `<ul class="ch ${small ? 'sm' : ''}">${res.map(c => `<li class="${c.done ? 'ok' : ''}"><i>${c.done ? '✓' : ''}</i><span>${esc(c.text)}${c.prog && S.rs ? ` <small>${c.prog(S.rs)}</small>` : ''}</span><b>+2</b></li>`).join('')}</ul>`;
  }

  // ---- Rain Delay: a streak that forgives a missed day ----
  const RAIN_COST = 6, RAIN_MAX = 2;
  function rain() { return (store.get('wildnine-rain') || { n: 0 }).n; }
  function setRain(n) { store.set('wildnine-rain', { n }); }
  // replaces the earlier streak rules: a missed day or two is covered by Rain Delays you hold
  bumpStreak = function () {
    const st = store.get('wildnine-streak') || { last: 0, n: 0 };
    if (st.last === dayNo) return st;
    let n = 1, used = 0;
    const gap = st.last ? dayNo - st.last - 1 : 99;
    if (gap === 0) n = st.n + 1;
    else if (gap > 0 && gap <= RAIN_MAX && rain() >= gap) { used = gap; setRain(rain() - gap); n = st.n + 1; }
    const out = { last: dayNo, n, best: Math.max(n, st.best || 0), saved: used };
    store.set('wildnine-streak', out); return out;
  };
  streakNow = function () {
    const st = store.get('wildnine-streak');
    if (!st) return 0;
    const gap = dayNo - st.last - 1;
    return gap <= 0 || (gap <= RAIN_MAX && rain() >= gap) ? st.n : 0;
  };

  // ---- course passport: a stamp for every daily course, a bag tag for every full week ----
  function passport() { return store.get('wildnine-passport') || { days: [], weeks: [] }; }
  function stampToday() {
    const pp = passport();
    if (pp.days.includes(dayNo)) return null;
    pp.days.push(dayNo);
    // weeks run Monday to Sunday; day 1 (1 Nov 2026) was a Sunday
    const wk = Math.floor((dayNo + 5) / 7), wkDays = Array.from({ length: 7 }, (_, i) => wk * 7 - 5 + i).filter(d => d >= 1);
    let msg = null;
    if (!pp.weeks.includes(wk) && wkDays.length === 7 && wkDays.every(d => pp.days.includes(d))) { pp.weeks.push(wk); msg = awardBonus(10, 'a full week in your passport'); }
    store.set('wildnine-passport', pp);
    return msg;
  }
  function showPassport(back) {
    const pp = passport(), weeks = [];
    for (let wk = Math.floor((dayNo + 5) / 7); wk >= 0; wk--) {
      const days = Array.from({ length: 7 }, (_, i) => wk * 7 - 5 + i);
      if (days[6] < 1) continue;
      weeks.push(`<div class="pp-week"><div class="pp-wl">${pp.weeks.includes(wk) ? '<b>Full week</b>' : ''}${dateLabel(Math.max(1, days[0]))}</div><div class="pp-row">${days.map(d => {
        if (d < 1 || d > dayNo) return '<span class="stamp empty"></span>';
        const c = E.courseName(seedFor(d)), ini = c.split(' ').filter(w => /^[A-Z]/.test(w)).map(w => w[0]).join('').slice(0, 3);
        const sun = new Date(EPOCH + (d - 1) * 864e5).getUTCDay() === 0;
        return pp.days.includes(d) ? `<span class="stamp on ${sun ? 'major' : ''}" title="${esc(c)}"><b>${ini}</b><i>#${d}</i></span>` : `<span class="stamp miss"><i>#${d}</i></span>`;
      }).join('')}</div></div>`);
    }
    overlay(`<div class="kicker">Your course passport</div><h2>${pp.days.length} stamp${pp.days.length === 1 ? '' : 's'}</h2>
      <p class="fine">Play the daily course to collect its stamp. Fill a whole week, Monday to Sunday, for 10 Birdies and a passport bag tag. Gold stamps are Sunday Majors.</p>
      <div class="pp">${weeks.join('')}</div>
      <div class="rain"><b>Rain Delays: ${rain()} of ${RAIN_MAX}</b><span>Miss a day and a Rain Delay keeps your streak alive, automatically. ${RAIN_COST} Birdies each.</span>
        <button class="ps-btn buy" id="buyRain" ${rain() >= RAIN_MAX || wallet().bal < RAIN_COST ? 'disabled' : ''}>${rain() >= RAIN_MAX ? 'Bag full' : `Buy for ${bz(RAIN_COST)}`}</button></div>
      <button class="ghost" id="ppBack">Back</button>`);
    $('#buyRain').onclick = once(() => { const w = wallet(); if (w.bal < RAIN_COST || rain() >= RAIN_MAX) return; w.bal -= RAIN_COST; saveWallet(w); setRain(rain() + 1); showPassport(back); });
    $('#ppBack').onclick = back || showTitle;
  }

  // ---- seasons, one per month, named after that month's Bag Draft major ----
  function seasonKey(d) { const x = new Date(EPOCH + ((d || dayNo) - 1) * 864e5); return x.getUTCFullYear() + '-' + String(x.getUTCMonth() + 1).padStart(2, '0'); }
  function seasonInfo(key) {
    const m = key.slice(5), M = (window.WN_PROMO && window.WN_PROMO.majors || {})[m] || { name: 'The Wild Nine Season', colour: '#0f3b23', accent: '#e3b23c' };
    const short = M.name.replace(/^The /, '');
    return { key, name: M.name, colour: M.colour, accent: M.accent, tiers: [
      { at: 4, id: `s${key}-cap`, slot: 'head', name: `${short} cap`, look: { hat: 'cap', c: M.colour } },
      { at: 12, id: `s${key}-ball`, slot: 'ball', name: `${short} ball`, look: { ball: M.accent === '#ffffff' ? '#ffffff' : M.accent } },
      { at: 24, id: `s${key}-polo`, slot: 'top', name: `${short} polo`, look: { top: 'polo', c: M.accent === '#ffffff' ? M.colour : M.accent } },
      { at: 40, id: `s${key}-trail`, slot: 'trail', name: `${short} tracer`, look: { trail: 'season', c: M.accent === '#ffffff' ? M.colour : M.accent } },
      { at: 60, id: `s${key}-bag`, slot: 'bag', name: `${short} staff bag`, look: { bag: 'staff', c: M.colour, c2: M.accent } }
    ] };
  }
  // season rewards join the item list so they can be worn like anything else
  function registerSeason(key) {
    for (const t of seasonInfo(key).tiers) if (!ITEM[t.id]) { const it = { id: t.id, slot: t.slot, name: t.name, cost: 0, look: t.look, season: key, game: true }; ITEMS.push(it); ITEM[t.id] = it; }
  }
  function seasonPoints(key) { return (store.get('wildnine-season') || {})[key] || 0; }
  function addSeasonPoints(n) {
    const key = seasonKey(), s = store.get('wildnine-season') || {};
    s[key] = (s[key] || 0) + n; store.set('wildnine-season', s);
    registerSeason(key);
    const w = wallet(), got = [];
    for (const t of seasonInfo(key).tiers) if (s[key] >= t.at && !w.owned.includes(t.id)) { w.owned.push(t.id); got.push(t.name); }
    saveWallet(w);
    return got;
  }
  function showSeason(back) {
    const key = seasonKey(), si = seasonInfo(key), pts = seasonPoints(key), w = wallet();
    registerSeason(key);
    const last = new Date(Date.UTC(+key.slice(0, 4), +key.slice(5), 0)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    overlay(`<div class="kicker">This month's season</div><h2>${esc(si.name)}</h2>
      <p class="fine">Every Birdie you earn this month also counts towards the season. Rewards are free, yours to keep for good, and can't be bought. The season runs to ${last}; next month brings a new set.</p>
      <div class="season" style="--sc:${si.colour};--sa:${si.accent}"><div class="se-bar"><i style="width:${Math.min(100, pts / 60 * 100)}%"></i></div><div class="se-pts">${pts} season points</div>
        ${si.tiers.map(t => { const has = w.owned.includes(t.id); return `<div class="se-t ${has ? 'on' : ''}">${swatch(ITEM[t.id], w)}<b>${esc(t.name)}</b><span>${has ? (w.eq[t.slot] === t.id ? 'Wearing' : `<button class="ps-btn" data-eq="${t.id}">Use</button>`) : `${t.at} points`}</span></div>`; }).join('')}
      </div>
      <button class="ghost" id="seBack">Back</button>`);
    $$('[data-eq]').forEach(b => b.onclick = () => { const w2 = wallet(); w2.eq[ITEM[b.dataset.eq].slot] = b.dataset.eq; saveWallet(w2); showSeason(back); });
    $('#seBack').onclick = back || showTitle;
  }

  // ---- my game: stats that show you getting better ----
  function addStats(tot, tp) {
    if (!S.rs || S.rs.holes < 9) return;
    const st = store.get('wildnine-stats') || { rounds: 0, strokes: 0, tp: 0, fair: 0, fairTry: 0, gir: 0, holes: 0, putts: 0, pen: 0, best: null, recent: [] };
    const rs = S.rs;
    st.rounds++; st.strokes += tot; st.tp += tp; st.fair += rs.fair; st.fairTry += rs.fairTry; st.gir += rs.gir; st.holes += rs.holes; st.putts += rs.putts; st.pen += rs.pen;
    st.best = st.best === null ? tp : Math.min(st.best, tp);
    st.recent = (st.recent || []).concat(tp).slice(-10);
    store.set('wildnine-stats', st);
  }

  // ---- your week: a look back, never a nag ----
  function weekData() {
    const days = [];
    for (let d = Math.max(1, dayNo - 6); d <= dayNo; d++) { const rec = store.get('wildnine-' + seedFor(d)); if (rec && rec.scores) days.push({ d, ...rec, course: E.makeCourse(seedFor(d)) }); }
    if (!days.length) return null;
    let birdies = 0, eagles = 0, pars = 0;
    for (const x of days) x.scores.forEach((s, i) => { const k = s - x.course.holes[i].par; if (k <= -2) eagles++; else if (k === -1) birdies++; else if (k === 0) pars++; });
    const best = days.reduce((a, b) => (b.tp < a.tp ? b : a));
    return { days, n: days.length, birdies, eagles, pars, best, avg: days.reduce((a, b) => a + b.tp, 0) / days.length, from: Math.max(1, dayNo - 6), to: dayNo };
  }
  function weekCardSvg(wk) {
    const w = wallet(), g = golferSvg(w, 112).replace('<svg ', '<svg x="232" y="34" ');
    const dots = Array.from({ length: 7 }, (_, i) => { const d = wk.to - 6 + i, x = wk.days.find(y => y.d === d), cx = 40 + i * 47;
      const lbl = new Date(EPOCH + (d - 1) * 864e5).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2);
      return `<circle cx="${cx}" cy="292" r="17" fill="${x ? (x.tp < 0 ? '#e3b23c' : '#3fae29') : 'rgba(255,255,255,.08)'}" stroke="rgba(255,255,255,.3)"/>
        <text x="${cx}" y="297" text-anchor="middle" font-size="12" font-weight="800" fill="${x ? '#0b2516' : '#fff'}" opacity="${x ? 1 : 0.35}">${x ? fmtPar(x.tp) : '·'}</text>
        <text x="${cx}" y="326" text-anchor="middle" font-size="9" fill="#fff" opacity=".6">${lbl}</text>`; }).join('');
    const stat = (x, v, l) => `<rect x="${x}" y="190" width="98" height="56" rx="10" fill="rgba(0,0,0,.22)"/><text x="${x + 49}" y="220" text-anchor="middle" font-size="22" font-weight="900" fill="#fff">${v}</text><text x="${x + 49}" y="237" text-anchor="middle" font-size="9" fill="#fff" opacity=".7">${l}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 450" font-family="system-ui,-apple-system,Segoe UI,sans-serif">
      <defs><linearGradient id="wg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f3b23"/><stop offset="1" stop-color="#226f40"/></linearGradient></defs>
      <rect width="360" height="450" fill="url(#wg)"/><rect x="9" y="9" width="342" height="432" rx="16" fill="none" stroke="#e3b23c" stroke-width="2"/>
      <text x="24" y="44" font-size="11" font-weight="800" letter-spacing="2.2" fill="#e3b23c">MY WEEK IN WILD NINE</text>
      <text x="24" y="76" font-family="Georgia,serif" font-size="26" font-weight="700" fill="#fff">${esc(w.name || 'My week')}</text>
      <text x="24" y="96" font-size="11" fill="#fff" opacity=".7">${esc(dateLabel(wk.from))} to ${esc(dateLabel(wk.to))}</text>
      <text x="24" y="150" font-size="56" font-weight="900" fill="#fff">${wk.n}<tspan font-size="18" font-weight="700" opacity=".8"> of 7 days</tspan></text>
      ${g}
      ${stat(20, wk.birdies + wk.eagles, wk.eagles ? 'BIRDIES + EAGLES' : 'BIRDIES')}${stat(131, fmtPar(wk.best.tp), 'BEST ROUND')}${stat(242, (wk.avg > 0 ? '+' : '') + wk.avg.toFixed(1), 'AVERAGE')}
      ${dots}
      <text x="24" y="360" font-size="11" fill="#fff" opacity=".85">Best: ${esc(wk.best.course.name)}, ${wk.best.tot} (${fmtPar(wk.best.tp)})</text>
      <rect x="9" y="380" width="342" height="61" fill="#0b2516"/><rect x="9" y="380" width="342" height="2" fill="#e3b23c"/>
      <text x="24" y="408" font-size="19" font-weight="900"><tspan fill="#fff">Golf</tspan><tspan fill="#3fae29">Price</tspan><tspan fill="#fff"> AI</tspan></text>
      <text x="24" y="426" font-family="Georgia,serif" font-style="italic" font-size="11" fill="#fff" opacity=".75">Full Swing. Not full price.</text>
      <text x="336" y="406" text-anchor="end" font-size="12" font-weight="800" fill="#e3b23c">A new nine every day</text>
      <text x="336" y="424" text-anchor="end" font-size="11" fill="#fff">golfpriceai.com/play/wild-nine</text></svg>`;
  }
  function showWeek(back) {
    const wk = weekData();
    if (!wk) { overlay(`<div class="kicker">Your week</div><h2>Nothing yet this week</h2><p class="lede">Play today's nine and your week starts here.</p><button class="ghost" id="wkBack">Back</button>`); $('#wkBack').onclick = back || showTitle; return; }
    const svg = weekCardSvg(wk);
    overlay(`<div class="kicker">Your week</div><h2>${wk.n} round${wk.n === 1 ? '' : 's'} this week</h2>
      <div class="roundimg" id="wkImg">${svg}</div>${shareBar('shWeek', 'Share your week')}<button class="ghost" id="wkBack">Back</button>`);
    svgToPng(svg, 1080, 1350).then(p => { if (p && $('#wkImg')) $('#wkImg').innerHTML = `<img src="${p}" alt="My week in Wild Nine">`; });
    wireShare('shWeek', { text: `My week in Wild Nine: ${wk.n} of 7 days, ${wk.birdies + wk.eagles} birdies, best round ${fmtPar(wk.best.tp)}.`, url: 'golfpriceai.com/play/wild-nine', subject: 'My week in Wild Nine', fname: 'my-wild-nine-week', image: () => svgToPng(svg, 1080, 1350) });
    $('#wkBack').onclick = back || showTitle;
  }

  function showStats(back) {
    setTimeout(() => { const b = $('#stWeek'); if (b) b.onclick = () => showWeek(() => showStats(back)); }, 0);
    const st = store.get('wildnine-stats');
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
    const avg = (a, b, d) => b ? (a / b).toFixed(d) : '–';
    const rec = st && st.recent && st.recent.length ? st.recent : [];
    const mx = Math.max(4, ...rec.map(v => Math.abs(v)));
    overlay(`<div class="kicker">My game</div><h2>${st ? st.rounds + ' round' + (st.rounds === 1 ? '' : 's') : 'No rounds yet'}</h2>
      ${st ? `<div class="stats">
        <div><b>${fmtPar(st.best)}</b><span>Best round</span></div><div><b>${(st.tp / st.rounds >= 0 ? '+' : '') + (st.tp / st.rounds).toFixed(1)}</b><span>Average</span></div>
        <div><b>${pct(st.fair, st.fairTry)}</b><span>Fairways</span></div><div><b>${pct(st.gir, st.holes)}</b><span>Greens in reg</span></div>
        <div><b>${avg(st.putts, st.rounds, 1)}</b><span>Putts a round</span></div><div><b>${avg(st.pen, st.rounds, 1)}</b><span>Penalties a round</span></div></div>
        <div class="sect">Your last ${rec.length} rounds (to par)</div>
        <div class="spark">${rec.map(v => `<i class="${v < 0 ? 'u' : v > 0 ? 'o' : 'e'}" style="height:${10 + Math.abs(v) / mx * 50}px" title="${fmtPar(v)}"><em>${fmtPar(v)}</em></i>`).join('')}</div>
        <p class="fine">Counted from solo rounds you finish. Your best round on each course also becomes a ghost: a faint line showing where your shots went, so you can try to beat yourself.</p>` : '<p class="fine">Finish a solo round and your stats start here.</p>'}
      <button class="ghost" id="stWeek">My week, as a picture</button>
      <button class="ghost" id="stBack">Back</button>`);
    $('#stBack').onclick = back || showTitle;
  }

  // ---- ghosts: your best round on this course, drawn faintly ----
  function saveGhost(tot) {
    if (!S.rs || S.rs.holes < 9) return;
    const k = 'wildnine-ghost-' + S.cfg.seed, prev = store.get(k);
    if (prev && prev.tot <= tot) return;
    store.set(k, { tot, paths: S.rs.paths.map(p => (p || []).map(q => [Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10])) });
  }
  function drawGhost(h) {
    if (S.mode !== 'solo' || S.bonus) return;
    const g = S.ghost || (S.ghost = store.get('wildnine-ghost-' + S.cfg.seed) || false);
    if (!g || !g.paths[S.h]) return;
    const pts = g.paths[S.h].map(([x, y]) => W2S({ x, y }));
    ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5;
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; for (const p of pts.slice(1)) { ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); }
    ctx.restore();
  }


  // ---- "beat my ghost": your whole round in a link, flown beside the next player ----
  const gq = (v, off) => Math.max(0, Math.min(1295, Math.round(v + off))).toString(36).padStart(2, '0');
  function ghostCode() {
    if (!S.rs || S.rs.holes < 9 || S.mode !== 'solo') return null;
    const sd = S.sides[0], w = wallet();
    const name = (w.name || 'Golfer').replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || 'Golfer';
    const paths = S.rs.paths.map(p => (p || []).map(q => gq(q.x, 60) + gq(q.y, 10)).join('')).join('_');
    return `${S.cfg.day || dayNo}-${name}-${sd.scores.map(s => Math.min(35, s).toString(36)).join('')}-${paths}`;
  }
  function parseGhost(code) {
    const m = /^(\d{1,4})-([A-Za-z0-9]{1,14})-([0-9a-z]{9})-([0-9a-z_]+)$/.exec(code || '');
    if (!m) return null;
    const paths = m[4].split('_').map(p => (p.match(/.{4}/g) || []).map(c => ({ x: parseInt(c.slice(0, 2), 36) - 60, y: parseInt(c.slice(2), 36) - 10 })));
    if (paths.length !== 9) return null;
    const scores = [...m[3]].map(c => parseInt(c, 36));
    return { day: +m[1], name: m[2], scores, tot: scores.reduce((a, b) => a + b, 0), paths };
  }
  let RIVAL = null;
  function openGhostLink(code) {
    const g = parseGhost(code);
    if (!g || g.day < 1 || g.day > dayNo) return showTitle();
    const seed = seedFor(g.day), c = E.makeCourse(seed), tp = g.tot - c.par;
    const official = g.day === dayNo && !store.get('wildnine-' + ymd);
    overlay(`<div class="kicker">A ghost from ${esc(g.name)}</div><h2>Beat ${esc(g.name)}'s ghost</h2>
      <div class="today"><span>Wild Nine #${g.day} · ${esc(dateLabel(g.day))}</span><b>${esc(c.name)}</b><i>${esc(g.name)} shot ${g.tot} (${fmtPar(tp)})</i></div>
      <p class="lede">${esc(g.name)}'s ball flies the course with you, shot for shot, in gold. After each hole you'll see who's ahead.</p>
      <button class="mode hero" id="ghGo"><b>Take them on</b><span>${official ? "It's today's course, so this is your official round" : 'Practice round on that day\'s course'}</span></button>
      <button class="ghost" id="ghBack">Not now</button>`);
    $('#ghGo').onclick = once(() => { RIVAL = g; history.replaceState(null, '', location.pathname); SETUP = { mode: 'solo', official, day: g.day, seed, players: [], i: 0 }; setupPlayer(); });
    $('#ghBack').onclick = once(() => { history.replaceState(null, '', location.pathname); showTitle(); });
  }
  function drawRival(h) {
    const g = S.rival; if (!g || S.bonus || S.mode !== 'solo') return;
    const path = g.paths[S.h]; if (!path || !path.length) return;
    const pts = path.map(W2S), dpr = cv.width / cv.clientWidth;
    ctx.save(); ctx.strokeStyle = 'rgba(227,178,60,0.8)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.8 * dpr;
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.setLineDash([]);
    // their ball sits where they were after the same number of shots as you
    const n = Math.min(pts.length - 1, S.sides[0].strokes), p = pts[n];
    ctx.fillStyle = '#e3b23c'; ctx.strokeStyle = '#16241c'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4.5 * dpr, 0, 7); ctx.fill(); ctx.stroke();
    ctx.font = `700 ${10 * dpr}px system-ui, sans-serif`; ctx.textBaseline = 'middle'; const tw = ctx.measureText(g.name).width;
    ctx.fillStyle = 'rgba(10,30,18,0.8)'; rr(p.x + 7 * dpr, p.y - 8 * dpr, tw + 10 * dpr, 16 * dpr, 8 * dpr); ctx.fill();
    ctx.fillStyle = '#e3b23c'; ctx.fillText(g.name, p.x + 12 * dpr, p.y);
    ctx.restore();
  }
  function rivalLine() {
    const g = S.rival; if (!g) return '';
    const mine = S.sides[0].scores, n = mine.length, me = mine.reduce((a, b) => a + b, 0), them = g.scores.slice(0, n).reduce((a, b) => a + b, 0), d = them - me;
    return d > 0 ? `${d} ahead of ${g.name}'s ghost` : d < 0 ? `${-d} behind ${g.name}'s ghost` : `level with ${g.name}'s ghost`;
  }


  // ---- group tables: live on golfpriceai.com, through the site's worker ----
  const WN_API = window.WN_API || 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  const LIVE = /(^|\.)golfpriceai\.com$/.test(location.hostname) || (() => { try { return localStorage.getItem('wildnine-api-test') === '1'; } catch (e) { return false; } })();
  function myPid() {
    let p = store.get('wildnine-pid');
    if (!p) { const a = new Uint8Array(12); (crypto.getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256)); p = [...a].map(x => (x % 36).toString(36)).join('') + Date.now().toString(36).slice(-4); store.set('wildnine-pid', p); }
    return p;
  }
  // the golfer's name, or the nickname used in the site's leagues, so a league's Wild Nine table gets your rounds
  const myNick = () => (wallet().name || store.get('gpNick') || '').replace(/[^A-Za-z0-9 '\-]/g, '').trim().slice(0, 14);
  async function api(path, body) {
    const ctl = window.AbortController ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), 7000);
    try {
      const r = await fetch(WN_API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl && ctl.signal } : { signal: ctl && ctl.signal });
      return await r.json();
    } catch (e) { return { ok: false, error: 'Could not reach the clubhouse. Check your signal and try again.' }; }
    finally { if (t) clearTimeout(t); }
  }
  const myGroups = () => store.get('wildnine-groups') || [];
  function postToLeague(sd, btn) {
    const nick = myNick(); if (!nick) { toastTop('Add a name on your golfer card first.'); return; }
    const tot = sd.scores.reduce((a, b) => a + b, 0), idx = wildIndex();
    return api('/wn/score', { pid: myPid(), nick, day: S.cfg.day || dayNo, tot, tp: toPar(sd), idx: idx == null ? null : idx, league: 1, av: avStr(), grid: sd.scores.map(s => Math.min(35, s).toString(36)).join('') });
  }
  async function showLeague(day, back) {
    overlay(`<div class="kicker">Course league · #${day}</div><h2>Loading…</h2>`);
    const r = LIVE ? await api(`/wn/day?day=${day}&pid=${myPid()}`) : { ok: false, offline: true };
    const name = E.courseName(seedFor(day));
    if (!r.ok) {
      overlay(`<div class="kicker">Course league · #${day}</div><h2>${esc(name)}</h2>
        <p class="lede">Every daily course has its own league: the best rounds anyone posted, gross and net.</p>
        <div class="done">${r.offline ? 'Course leagues switch on when Wild Nine moves to golfpriceai.com/play/wild-nine.' : esc(r.error || '')}</div><button class="ghost" id="lgBack">Back</button>`);
      $('#lgBack').onclick = back || showTitle; return;
    }
    const row = (x, i, net) => `<tr class="${x.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.nick)}${x.idx != null ? ` <small>(${fmtIdx(x.idx)})</small>` : ''}</td><td>${net ? x.net : x.tot}</td><td><b>${fmtPar(net ? x.net - (x.tot - x.tp) : x.tp)}</b></td></tr>`;
    overlay(`<div class="kicker">Course league · #${day}</div><h2>${esc(name)}</h2>
      <div class="seg"><button class="on" data-lg="g">Gross</button><button data-lg="n">Net (Index)</button></div>
      <div id="lgG"><table class="gtab"><tr><th></th><th>Player</th><th>Score</th><th>To par</th></tr>${r.gross.map((x, i) => row(x, i)).join('')}</table></div>
      <div id="lgN" hidden><table class="gtab"><tr><th></th><th>Player</th><th>Net</th><th>To par</th></tr>${r.net.map((x, i) => row(x, i, true)).join('')}</table></div>
      ${r.mine ? `<p class="fine">You: ${r.mine.gross}${ordinal(r.mine.gross)} gross${r.mine.net ? `, ${r.mine.net}${ordinal(r.mine.net)} net` : ''}.</p>` : ''}
      <p class="fine">Net = your score minus your Wild Nine Index, rounded. Only the first official round of each day counts.</p>
      <button class="ghost" id="lgBack">Back</button>`);
    $$('[data-lg]').forEach(b => b.onclick = () => { $$('[data-lg]').forEach(x => x.classList.toggle('on', x === b)); $('#lgG').hidden = b.dataset.lg !== 'g'; $('#lgN').hidden = b.dataset.lg !== 'n'; });
    $('#lgBack').onclick = back || showTitle;
  }
  // after a round (on the result and on the title screen once today's card is in): the way back to the site
  const endNav = () => `<div class="endnav"><b>Where next?</b>
        <a class="en-lg" href="/play/my-clubhouse/?utm_source=wildnine#wn">My Clubhouse: your league tables</a>
        <a class="en-home" href="/?utm_source=wildnine">Take me back to GolfPrice AI</a></div>`;
  const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return s[(v - 20) % 10] || s[v] || s[0]; };
  function postScoreToGroups(sd) {
    if (!LIVE || !myGroups().length || !myNick()) return;
    const tot = sd.scores.reduce((a, b) => a + b, 0);
    api('/wn/score', { pid: myPid(), nick: myNick(), day: S.cfg.day || dayNo, tot, tp: toPar(sd), av: avStr(), grid: sd.scores.map(s => Math.min(35, s).toString(36)).join('') });
  }
  function nickField() { return `<input class="name" id="gNick" maxlength="14" placeholder="Your nickname on the table" value="${esc(myNick())}">`; }
  function takeNick() { const v = ($('#gNick') && $('#gNick').value || '').replace(/[^A-Za-z0-9 '\-]/g, '').trim().slice(0, 14); if (v) { const w = wallet(); w.name = v; saveWallet(w); } return v; }
  async function showGroups(back) {
    if (!LIVE) {
      overlay(`<div class="kicker">Group tables</div><h2>Your society, your mates, one table</h2>
        <p class="lede">Start a group, send one link, and everyone's daily score lands on the table by itself, with a weekly table on top.</p>
        <div class="done">Live group tables switch on when Wild Nine moves to golfpriceai.com/play/wild-nine. Until then, the Mates' table builds a table from the cards your mates send you.</div>
        <button class="primary" id="grMates">Open the Mates' table</button><button class="ghost" id="grLg">Today's course league</button><button class="ghost" id="grBack">Back</button>`);
      $('#grLg').onclick = () => showLeague(dayNo, () => showGroups(back));
      $('#grMates').onclick = () => showMates(dayNo, () => showGroups(back)); $('#grBack').onclick = back || showTitle; return;
    }
    const gs = myGroups();
    overlay(`<div class="kicker">Group tables · #${dayNo}</div><h2>${gs.length ? 'Your groups' : 'Start or join a group'}</h2>
      <div id="grList">${gs.map(g => `<button class="grp" data-c="${g.c}"><b>${esc(g.n)}</b><span id="gr-${g.c}">Loading today's table…</span><em>›</em></button>`).join('')}</div>
      <button class="primary" id="grLeague">Today's course league</button>
      <div class="sect">Start a group</div>${nickField()}<input class="name" id="gName" maxlength="40" placeholder="Group name, e.g. Thursday Roll-Up"><button class="primary" id="grNew">Start it and get the invite link</button>
      <div class="sect">Got a code?</div><div class="remind"><input id="gCode" maxlength="6" placeholder="ABC123" style="text-transform:uppercase;flex:1"><button class="primary" id="grJoin" style="flex:0 0 96px;margin:0">Join</button></div>
      <p class="fine" id="grMsg"></p><button class="ghost" id="grBack">Back</button>`);
    $$('.grp').forEach(b => b.onclick = () => showGroup(b.dataset.c, () => showGroups(back)));
    $('#grLeague').onclick = () => showLeague(dayNo, () => showGroups(back));
    $('#grBack').onclick = back || showTitle;
    $('#grNew').onclick = once(async () => {
      const nick = takeNick(), name = $('#gName').value.trim();
      if (!nick || !name) { $('#grMsg').textContent = 'Add a nickname and a group name.'; return showGroups(back); }
      const r = await api('/wn/new', { pid: myPid(), nick, name });
      if (!r.ok) { $('#grMsg').textContent = r.error; return; }
      store.set('wildnine-groups', myGroups().concat({ c: r.code, n: r.name })); showGroup(r.code, () => showGroups(back), true);
    });
    $('#grJoin').onclick = () => joinFromLink(($('#gCode').value || '').toUpperCase().trim(), () => showGroups(back));
    for (const g of gs) api(`/wn/group?c=${g.c}&day=${dayNo}&pid=${myPid()}`).then(r => { const el = $('#gr-' + g.c); if (!el) return; el.textContent = r.ok ? `${r.today.length} of ${r.members} played today${r.today[0] ? ` · leader ${r.today[0].nick} ${fmtPar(r.today[0].tp)}` : ''}` : r.error; });
  }
  async function showGroup(code, back, fresh) {
    overlay(`<div class="kicker">Group table</div><h2>Loading…</h2>`);
    const r = await api(`/wn/group?c=${code}&day=${dayNo}&pid=${myPid()}`);
    if (!r.ok) { overlay(`<div class="kicker">Group table</div><h2>Hmm</h2><p class="lede">${esc(r.error || '')}</p><button class="ghost" id="g1Back">Back</button>`); $('#g1Back').onclick = back || showTitle; return; }
    const row = (x, i, wk) => `<tr class="${x.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.nick)}</td><td>${wk ? x.rounds : x.tot}</td><td><b>${fmtPar(wk ? x.tp : x.tp)}</b></td></tr>`;
    const played = store.get('wildnine-' + ymd);
    overlay(`<div class="kicker">Group table · code ${esc(code)}</div><h2>${esc(r.name)}</h2>
      ${fresh ? '<div class="done">Your group is ready. Send the invite below: anyone who opens it joins with one tap.</div>' : ''}
      <div class="sect">Today, #${dayNo} · ${esc(E.courseName(ymd))}</div>
      ${r.today.length ? `<table class="gtab"><tr><th></th><th>Player</th><th>Score</th><th>To par</th></tr>${r.today.map((x, i) => row(x, i)).join('')}</table>` : '<p class="fine">Nobody has posted today yet.</p>'}
      ${played ? '' : `<button class="mode hero" id="g1Play"><b>Play today's nine</b><span>Your score goes on this table when you finish</span></button>`}
      <div class="sect">This week <small>average to par, last 7 days</small></div>
      ${r.week.length ? `<table class="gtab"><tr><th></th><th>Player</th><th>Rounds</th><th>To par</th></tr>${r.week.map((x, i) => row(x, i, true)).join('')}</table>` : '<p class="fine">The weekly table fills up as people play.</p>'}
      <p class="fine">${r.members} in the group. Only your nickname and scores are shared: no email, no real name.</p>
      ${shareBar('shGroup', 'Invite to ' + esc(r.name))}
      <button class="ghost" id="g1Leave">Leave this group</button><button class="ghost" id="g1Back">Back</button>`);
    wireShare('shGroup', { text: `Join ${r.name} on Wild Nine: a new nine every day, and our own table.`, url: `golfpriceai.com/play/wild-nine#group-${code}`, subject: `Join ${r.name} on Wild Nine` });
    if ($('#g1Play')) $('#g1Play').onclick = () => startOfficial();
    $('#g1Leave').onclick = once(async () => { await api('/wn/leave', { pid: myPid(), code }); store.set('wildnine-groups', myGroups().filter(g => g.c !== code)); (back || showTitle)(); });
    $('#g1Back').onclick = back || showTitle;
  }
  async function joinFromLink(code, back) {
    back = back || (() => { history.replaceState(null, '', location.pathname); showTitle(); });
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) { toastTop('That code does not look right.'); return back(); }
    if (!LIVE) return showGroups(back);
    if (myGroups().some(g => g.c === code)) return showGroup(code, back);
    const info = await api(`/wn/group?c=${code}&pid=${myPid()}`);
    if (!info.ok) { overlay(`<div class="kicker">Group</div><h2>Hmm</h2><p class="lede">${esc(info.error || '')}</p><button class="ghost" id="jBack">Back</button>`); $('#jBack').onclick = back; return; }
    overlay(`<div class="kicker">You're invited</div><h2>Join ${esc(info.name)}</h2><p class="lede">${info.members} golfer${info.members === 1 ? '' : 's'} on the table. Your daily score goes on it after each official round.</p>
      ${nickField()}<button class="primary" id="jGo">Join the group</button><p class="fine" id="jMsg"></p><button class="ghost" id="jBack">Not now</button>`);
    $('#jBack').onclick = back;
    $('#jGo').onclick = async () => {
      const nick = takeNick(); if (!nick) { $('#jMsg').textContent = 'Pick a nickname for the table.'; return; }
      const r = await api('/wn/join', { pid: myPid(), nick, code });
      if (!r.ok) { $('#jMsg').textContent = r.error; return; }
      store.set('wildnine-groups', myGroups().filter(g => g.c !== code).concat({ c: code, n: r.name }));
      history.replaceState(null, '', location.pathname); showGroup(code, showTitle);
    };
  }

  // ---- mates' table: shared cards become a table for the day ----
  function cardCode() {
    const sd = S.sides[0], w = wallet();
    const name = (w.name || (S.players[0].name && !/^Player \d$/.test(S.players[0].name) ? S.players[0].name : 'Golfer')).replace(/[^A-Za-z0-9]/g, '').slice(0, 14) || 'Golfer';
    return `${S.cfg.day || dayNo}-${name}-${sd.scores.map(s => Math.min(35, s).toString(36)).join('')}`;
  }
  function parseCard(code) {
    const m = /^(\d{1,4})-([A-Za-z0-9]{1,14})-([0-9a-z]{9})$/.exec(code);
    if (!m) return null;
    const scores = m[3].split('').map(c => parseInt(c, 36));
    return { day: +m[1], name: m[2], scores };
  }
  function addMate(card) {
    const k = 'wildnine-mates-' + card.day, list = store.get(k) || [];
    const i = list.findIndex(x => x.name.toLowerCase() === card.name.toLowerCase());
    if (i >= 0) list[i] = card; else list.push(card);
    store.set(k, list); return list;
  }
  function showMates(day, back, flash) {
    day = day || dayNo;
    const c = E.makeCourse(seedFor(day)), mine = store.get('wildnine-' + seedFor(day)) || (day === dayNo ? store.get('wildnine-' + ymd) : null);
    const me = (wallet().name || 'You');
    const rows = (store.get('wildnine-mates-' + day) || []).map(x => ({ ...x, tot: x.scores.reduce((a, b) => a + b, 0) }));
    if (mine && mine.scores) rows.push({ name: me + ' (you)', scores: mine.scores, tot: mine.tot, me: true });
    rows.sort((a, b) => a.tot - b.tot);
    overlay(`<div class="kicker">Mates' table · #${day}</div><h2>${esc(c.name)}</h2>
      ${flash ? `<div class="done">${flash}</div>` : ''}
      ${rows.length ? `<table class="mates">${rows.map((r, i) => `<tr class="${r.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td>${r.tot}</td><td>${fmtPar(r.tot - c.par)}</td></tr>`).join('')}</table>` : '<p class="fine">Nobody on the table yet.</p>'}
      <p class="fine">When a mate shares their card, open their link or paste their message here to add them. On the site, your society's table fills itself in.</p>
      <textarea id="mPaste" class="name" rows="3" placeholder="Paste a mate's Wild Nine message"></textarea>
      <button class="primary" id="mAdd">Add to the table</button>
      ${day === dayNo && !store.get('wildnine-' + ymd) ? '<button class="ghost" id="mPlay">Play today\'s course</button>' : ''}
      <button class="ghost" id="mBack">Back</button>`);
    $('#mAdd').onclick = () => {
      const t = $('#mPaste').value, m = /#card-([0-9]+-[A-Za-z0-9]+-[0-9a-z]{9})/.exec(t);
      const card = m && parseCard(m[1]);
      if (!card) { $('#mPaste').value = ''; $('#mPaste').placeholder = "That doesn't look like a Wild Nine card. Paste the whole message."; return; }
      addMate(card); showMates(card.day, back, `${esc(card.name)} added.`);
    };
    if ($('#mPlay')) $('#mPlay').onclick = () => { SETUP = { mode: 'solo', official: true, day: dayNo, seed: ymd, players: [], i: 0 }; setupPlayer(); };
    $('#mBack').onclick = back || showTitle;
  }
  function openCardLink(code) {
    const card = parseCard(code);
    if (!card) return showTitle();
    addMate(card); clearHash();
    showMates(card.day, showTitle, `${esc(card.name)} shot ${card.scores.reduce((a, b) => a + b, 0)} on Wild Nine #${card.day}. They're on your table now.`);
  }

  registerSeason(seasonKey());
  function clearHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* the viewer may not allow it */ } }

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe($('#stage'));
  resize();
  // a course behind the title screen
  newGame({ mode: 'solo', official: false, seed: ymd, players: [defaultPlayer(0)] });
  closeOverlay();
  route();
  window.addEventListener('hashchange', route);
  requestAnimationFrame(frame);
  window.__wn = { streak: () => ({ now: streakNow(), bump: bumpStreak(), rain: rain() }), boards: h => boardSpots(h), get S() { return S; }, takeShot, useCard, E, nextTurn, jump(i) { S.h = i; startHole(); }, endRound: () => endRound(), get SET() { return SET; } };
})();
