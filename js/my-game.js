/* My Game: a golfer's own stats from every round they've scored live
   (quick rounds they've claimed, and society days), plus their Shot Saver.
   - In My Clubhouse: a card (#mc-mygame).
   - At /improve/my-game/: the full stats (#mg).
   Rounds come from the alerts worker (/lv/mine) by the phone's random id
   (gpPid), which a Clubhouse key carries to a new phone. Nobody else sees them. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var cardBox = null, full = null;
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function one(v) { return (Math.round(v * 10) / 10).toFixed(1); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function shots(ph, si) { if (ph >= 0) return Math.floor(ph / 18) + ((ph % 18) >= si ? 1 : 0); var b = -ph; return -(Math.floor(b / 18) + ((b % 18) > (18 - si) ? 1 : 0)); }
  function points(st, par, ph, si) { return st > 0 ? Math.max(0, par + shots(ph, si) - st + 2) : 0; }
  function nice(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }); }
  function avg(a) { return a.length ? a.reduce(function (t, v) { return t + v; }, 0) / a.length : null; }

  // Every round, worked out. Only full 18-hole rounds go into the averages.
  function work(rounds) {
    var rs = rounds.map(function (r) {
      var out = { day: r.day, cname: r.cname, course: r.course || r.cname, title: r.title, kind: r.kind, holes: 0, pts: 0, front: 0, back: 0, byPar: { 3: [], 4: [], 5: [] }, blobs: 0, fwHit: 0, fwOf: 0, putts: 0, puttHoles: 0, gross: 0, pickups: 0, per: {} };
      for (var h = 1; h <= 18; h++) {
        var x = r.h[h]; if (!x) continue;
        var s = x[0], par = r.pars[h - 1], p = points(s, par, r.ph, r.si[h - 1]);
        out.holes++; out.pts += p; if (h <= 9) out.front += p; else out.back += p;
        (out.byPar[Math.min(5, par)] || []).push(p); if (!p) out.blobs++;
        if (s > 0) out.gross += s; else out.pickups++;
        if (par >= 4 && (x[1] === 0 || x[1] === 1)) { out.fwOf++; out.fwHit += x[1]; }
        if (x[2] != null) { out.putts += x[2]; out.puttHoles++; }
        out.per[h] = p;
      }
      out.par = r.pars.reduce(function (t, v) { return t + v; }, 0);
      return out;
    }).filter(function (r) { return r.holes; });
    var fullR = rs.filter(function (r) { return r.holes === 18; }).sort(function (a, b) { return a.day < b.day ? -1 : 1; });
    var st = { all: rs, full: fullR, n: fullR.length };
    if (!fullR.length) return st;
    st.avg = avg(fullR.map(function (r) { return r.pts; }));
    st.best = fullR.reduce(function (b, r) { return r.pts > b.pts ? r : b; }, fullR[0]);
    var k = Math.min(4, Math.floor(fullR.length / 2));
    st.change = k >= 2 ? avg(fullR.slice(-k).map(function (r) { return r.pts; })) - avg(fullR.slice(0, k).map(function (r) { return r.pts; })) : null;
    st.trend = fullR.slice(-10).map(function (r) { return r.pts; });
    st.front = avg(fullR.map(function (r) { return r.front; })); st.back = avg(fullR.map(function (r) { return r.back; }));
    st.par = {};
    [3, 4, 5].forEach(function (p) { var all = []; fullR.forEach(function (r) { all = all.concat(r.byPar[p]); }); st.par[p] = all.length ? avg(all) : null; });
    st.blobs = avg(fullR.map(function (r) { return r.blobs; }));
    var fw = fullR.filter(function (r) { return r.fwOf >= 7; });
    st.fw = fw.length ? avg(fw.map(function (r) { return r.fwHit / r.fwOf * 100; })) : null;
    var pu = fullR.filter(function (r) { return r.puttHoles === 18; });
    st.putts = pu.length ? avg(pu.map(function (r) { return r.putts; })) : null;
    // The course played most, hole by hole, once there are three rounds there.
    var by = {}; fullR.forEach(function (r) { (by[r.course] = by[r.course] || []).push(r); });
    var top = Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length; })[0];
    if (top && by[top].length >= 3) {
      var src = rounds.filter(function (r) { return (r.course || r.cname) === top; })[0];
      st.map = { cname: by[top][0].cname, n: by[top].length, pars: src.pars, holes: [] };
      for (var h = 1; h <= 18; h++) st.map.holes.push(avg(by[top].map(function (r) { return r.per[h]; }).filter(function (v) { return v != null; })));
    }
    return st;
  }
  function ss() {
    var core = window.gpShotSaverCore; if (!core) return null;
    var s = core.get(); return s.rounds.length ? core.summary(s, 5) : null;
  }
  function spark(vals, w, h) {
    var lo = Math.min.apply(null, vals.concat([30])) - 2, hi = Math.max.apply(null, vals.concat([36])) + 2;
    var X = function (i) { return vals.length < 2 ? w / 2 : 6 + i * (w - 12) / (vals.length - 1); }, Y = function (v) { return h - 6 - (v - lo) / (hi - lo) * (h - 18); };
    return '<svg class="mg-spark" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Stableford points over your last ' + vals.length + ' rounds: ' + vals.join(', ') + '">' +
      '<line x1="0" x2="' + w + '" y1="' + Y(36).toFixed(1) + '" y2="' + Y(36).toFixed(1) + '" stroke="#b9c2bb" stroke-dasharray="4 4"/>' +
      '<text x="' + w + '" y="' + (Y(36) - 4).toFixed(1) + '" text-anchor="end" font-size="10" fill="#5b665f" font-family="Inter,sans-serif">36 = playing to handicap</text>' +
      (vals.length > 1 ? '<polyline points="' + vals.map(function (v, i) { return X(i).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') + '" fill="none" stroke="#14211a" stroke-width="2.5" stroke-linejoin="round"/>' : '') +
      vals.map(function (v, i) { var last = i === vals.length - 1; return '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (last ? 4.5 : 3) + '" fill="' + (last ? '#3fae29' : '#14211a') + '"/>'; }).join('') + '</svg>';
  }
  function bars(items, max) {
    return items.map(function (b) {
      return '<div class="mg-bar"><span>' + esc(b.label) + '</span><span class="mg-track"><span style="width:' + Math.max(3, Math.min(100, b.v / max * 100)).toFixed(0) + '%" class="' + (b.hl ? 'is-hl' : '') + '"></span></span><b>' + esc(b.txt) + '</b></div>';
    }).join('');
  }
  function parLine(st) {
    var p = st.par, ks = [3, 4, 5].filter(function (k) { return p[k] != null; });
    if (ks.length < 2) return '';
    var lo = ks.reduce(function (a, k) { return p[k] < p[a] ? k : a; }, ks[0]), hi = ks.reduce(function (a, k) { return p[k] > p[a] ? k : a; }, ks[0]);
    if (p[hi] - p[lo] < 0.2) return 'Nicely balanced: about the same on par 3s, 4s and 5s.';
    return 'Par ' + lo + 's are costing you most: ' + one(p[lo]) + ' points a hole against ' + one(p[hi]) + ' on par ' + hi + 's.';
  }
  function parBars(st) {
    var lo = Math.min.apply(null, [3, 4, 5].filter(function (k) { return st.par[k] != null; }).map(function (k) { return st.par[k]; }));
    return bars([3, 4, 5].filter(function (k) { return st.par[k] != null; }).map(function (k) { return { label: 'Par ' + k + 's', v: st.par[k], txt: one(st.par[k]), hl: st.par[k] === lo }; }), 3);
  }
  function ssBlock(sum, dark) {
    if (!sum || !sum.leaks.length) return '';
    var lead = sum.leaks[0];
    return '<section class="' + (dark ? 'mg-dark' : 'mg-card') + '"><span class="mg-k">FROM YOUR SHOT SAVER</span><b class="mg-h">The guilty party: ' + esc(lead.label.toLowerCase()) + '</b>' +
      '<p>Against ' + esc(sum.aim.who) + ', ' + esc(lead.label.toLowerCase()) + ' cost' + (/s$/.test(lead.label) && !/ing$/.test(lead.label) ? '' : 's') + ' you about ' + one(lead.v) + ' shots a round.</p>' +
      (dark ? '' : bars(sum.leaks.map(function (c, i) { return { label: c.label, v: c.v, txt: one(c.v), hl: i === 0 }; }), Math.max(3, sum.leaks[0].v))) +
      '<a href="/improve/shot-saver/">' + (dark ? 'Open Shot Saver →' : 'Add a round to Shot Saver →') + '</a></section>';
  }
  function empty(where) {
    return '<section class="mg-card mg-empty mg-wide"><b class="mg-h">Your golf, in numbers</b><p>Score a round on the free live scorecard (a quick round with mates, or your society day) and tap your name. After one round you get your points; after a few, where they go: par 3s or 5s, front nine or back, your best and worst holes.</p>' +
      '<a class="mg-btn" href="/play/scorecard/">Start a quick round</a>' + (where === 'full' ? '<p class="mg-small">Played on someone else’s phone? Open the leaderboard link from the group chat and tap “Which one are you?”.</p>' : '') + '</section>';
  }

  /* ---- My Clubhouse card */
  function paintCard(st) {
    if (!st.all.length) { cardBox.innerHTML = empty('card'); return; }
    if (!st.n) { cardBox.innerHTML = '<section class="mg-card"><b class="mg-h">My Game</b><p>' + st.all.length + (st.all.length === 1 ? ' round' : ' rounds') + ' started. Finish an 18-hole round and your stats appear here.</p><a href="/improve/my-game/">See My Game →</a></section>'; return; }
    var courses = {}; st.full.forEach(function (r) { courses[r.course] = 1; });
    cardBox.innerHTML = '<section class="mg-card"><div class="mg-top"><b class="mg-h">My Game</b><small>' + st.n + (st.n === 1 ? ' round' : ' rounds') + ' · ' + Object.keys(courses).length + (Object.keys(courses).length === 1 ? ' course' : ' courses') + '</small></div>' +
      '<div class="mg-tiles"><div class="is-dark"><b>' + one(st.avg) + '</b><small>avg points</small></div><div><b>' + st.best.pts + '</b><small>best round</small></div><div><b>' + (st.change == null ? st.trend[st.trend.length - 1] : (st.change >= 0 ? '▲ ' : '▼ ') + one(Math.abs(st.change))) + '</b><small>' + (st.change == null ? 'last round' : 'recent v early') + '</small></div></div>' +
      (st.trend.length > 1 ? '<small class="mg-k2">POINTS, LAST ' + st.trend.length + ' ROUNDS</small>' + spark(st.trend, 320, 70) : '') +
      '<small class="mg-k2">POINTS PER HOLE</small>' + parBars(st) + '<p>' + esc(parLine(st)) + '</p>' +
      '<a href="/improve/my-game/">See the full stats →</a></section>';
  }

  /* ---- The full page */
  function cellCol(v) { return v == null ? '#f6f6f3' : v >= 2.2 ? '#2f8a1f' : v >= 1.8 ? '#8fd97c' : v >= 1.5 ? '#e9ece6' : v >= 1.3 ? '#f8c48a' : '#f08a24'; }
  function head(st) {
    var t = !st.n ? 'Your golf, in numbers' : st.change == null ? 'The story so far' : st.change >= 1 ? 'You’re getting better. Mostly.' : st.change <= -1 ? 'A dip. Every golfer has one.' : 'Steady as she goes.';
    var sub = !st.n ? 'Free stats from the rounds you score live.' : st.change == null ? one(st.avg) + ' points a round so far. Here’s where they come from.' : (st.change >= 0 ? 'Up ' : 'Down ') + one(Math.abs(st.change)) + ' points a round on your early rounds. Here’s where the rest are hiding.';
    return '<section class="mg-hero"><span class="mg-k" style="color:#8fd97c">MY GAME' + (st.n ? ' · ' + st.n + (st.n === 1 ? ' ROUND' : ' ROUNDS') : '') + '</span><h1>' + t + '</h1><p>' + sub + '</p></section>';
  }
  function paintFull(st) {
    var sum = ss(), h = head(st) + '<div class="mg-main">';
    if (!st.n) { h += st.all.length ? '<section class="mg-card"><p>' + st.all.length + ' round' + (st.all.length === 1 ? '' : 's') + ' started, none finished yet. Your stats appear after an 18-hole round.</p></section>' : empty('full'); h += ssBlock(sum, false) + '</div>'; full.innerHTML = h; return; }
    h += '<section class="mg-card"><b class="mg-h">Points per round</b>' + spark(st.trend, 330, 110) + '<p class="mg-small">Each dot is a round. The dashed line is 36 points: playing to your handicap. Best: ' + st.best.pts + ' at ' + esc(st.best.cname || 'your course') + ', ' + nice(st.best.day) + '.</p></section>';
    var gap = st.front - st.back;
    h += '<section class="mg-card"><b class="mg-h">Front nine v back nine</b>' + bars([{ label: 'Front nine', v: st.front, txt: one(st.front), hl: gap < 0 }, { label: 'Back nine', v: st.back, txt: one(st.back), hl: gap > 0 }], 22) +
      '<p>' + (Math.abs(gap) < 0.6 ? 'Even all the way round. Consistent, or consistently something.' : gap > 0 ? 'You drop about ' + one(gap) + ' points coming home. Bacon roll wearing off? A banana at the turn is cheaper than a lesson.' : 'Slow starter: ' + one(-gap) + ' points better on the back nine. A few balls before the first tee might fix that.') + '</p></section>';
    h += '<section class="mg-card"><b class="mg-h">Par 3s, 4s and 5s</b>' + parBars(st) + '<p>' + esc(parLine(st)) + ' And about ' + one(st.blobs) + ' holes a round with no points.</p></section>';
    if (st.fw != null || st.putts != null) h += '<section class="mg-card"><b class="mg-h">Fairways and putts</b><div class="mg-tiles">' + (st.fw != null ? '<div><b>' + Math.round(st.fw) + '%</b><small>fairways hit</small></div>' : '') + (st.putts != null ? '<div><b>' + one(st.putts) + '</b><small>putts a round</small></div>' : '') + '</div><p class="mg-small">From the rounds you added extra detail to.</p></section>';
    if (st.map) {
      var hs = st.map.holes, valid = hs.map(function (v, i) { return { v: v, h: i + 1 }; }).filter(function (x) { return x.v != null; });
      var worst = valid.reduce(function (a, x) { return x.v < a.v ? x : a; }, valid[0]), best = valid.reduce(function (a, x) { return x.v > a.v ? x : a; }, valid[0]);
      h += '<section class="mg-card mg-wide"><div class="mg-top"><b class="mg-h">Your ' + esc(st.map.cname || 'course') + ', hole by hole</b><small>avg points</small></div><div class="mg-map">' +
        hs.map(function (v, i) { return '<div style="background:' + cellCol(v) + ';color:' + (v != null && v >= 2.2 ? '#fff' : '#14211a') + '"><b>' + (i + 1) + '</b><span>' + (v == null ? '–' : one(v)) + '</span></div>'; }).join('') +
        '</div><div class="mg-legend"><span><i style="background:#f08a24"></i> your nemesis</span><span><i style="background:#2f8a1f"></i> your favourite</span></div>' +
        '<p>The <b>' + ord(worst.h) + '</b> (par ' + st.map.pars[worst.h - 1] + ') averages ' + one(worst.v) + ' points; the <b>' + ord(best.h) + '</b> (par ' + st.map.pars[best.h - 1] + ') ' + one(best.v) + '. From ' + st.map.n + ' rounds there.</p></section>';
    } else h += '<section class="mg-card mg-wide"><b class="mg-h">Hole by hole</b><p class="mg-small">Play the same course three times and you get its map here: your nemesis holes in orange, your favourites in green.</p></section>';
    h += ssBlock(sum, false);
    // Send a detailed round to Shot Saver: score, fairways and putts.
    var sent = get('gpMgSS', []), cand = st.full.filter(function (r) { return !r.pickups && r.fwOf >= 7 && r.puttHoles === 18 && sent.indexOf(r.day + r.course) < 0; }).pop();
    if (cand && window.gpShotSaverCore) h += '<section class="mg-card"><b class="mg-h">Add your ' + nice(cand.day) + ' round to Shot Saver?</b><p>' + cand.gross + ' shots, ' + cand.fwHit + ' fairways, ' + cand.putts + ' putts. Shot Saver adds greens and penalties if you know them.</p><button type="button" class="mg-btn" id="mg-ss">Add it to Shot Saver</button></section>';
    h += '<section class="mg-dark"><b class="mg-h">Want sharper stats?</b><p>Turn on “Extra detail for me” at the bottom of the scorecard and it asks two quick taps a hole for your own score: fairway hit? how many putts? Only on your phone, only if you want it.</p></section>';
    h += '<section class="mg-card mg-wide"><b class="mg-h">Your rounds</b>' + st.all.slice(0, 12).map(function (r) {
      return '<div class="mg-row"><span><b>' + esc(r.cname || r.title || 'Round') + '</b><small>' + nice(r.day) + (r.holes < 18 ? ' · ' + r.holes + ' holes' : '') + (r.kind === 'soc' ? ' · society day' : '') + '</small></span><b>' + r.pts + '</b></div>';
    }).join('') + '</section></div>';
    full.innerHTML = h;
    var b = document.getElementById('mg-ss');
    if (b) b.onclick = function () {
      var core = window.gpShotSaverCore, s = core.get();
      s.rounds.push({ d: cand.day, s: cand.gross, f: Math.min(14, cand.fwHit), p: cand.putts, par: Math.max(66, Math.min(74, cand.par)) });
      if (core.put(s)) { sent.push(cand.day + cand.course); put('gpMgSS', sent); track('mg_to_ss'); location.href = '/improve/shot-saver/#ss-out'; }
    };
  }
  function load() {
    var p = get('gpPid', '');
    var go = function (rounds) { var st = work(rounds || []); if (cardBox) paintCard(st); if (full) { paintFull(st); gpUse('mg_view'); track('my_game_view', { rounds: st.n }); } };
    if (!/^[a-z0-9]{12,32}$/.test(p)) return go([]);
    var cached = get('gpMgCache', null);
    if (cached && cached.p === p) go(cached.r);
    fetch(API + '/lv/mine?pid=' + p, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) return; put('gpMgCache', { p: p, r: d.rounds }); go(d.rounds);
    }).catch(function () { if (!cached) go([]); });
  }
  // My Clubhouse draws its rows after its own fetch, so it calls mount() once #mc-mygame exists.
  function mount() { cardBox = document.getElementById('mc-mygame'); full = document.getElementById('mg'); if (cardBox || full) load(); }
  window.gpMyGame = { mount: mount };
  mount();
})();
