/* Live scoring for society days.
   /societies/live/?c=<code>         the live leaderboard (anyone with the link; ?tv=1 for the clubhouse TV)
   /societies/live/score/?t=<token>  a group's scorecard (the marker's link)
   Everything comes from the alerts worker (/lv/...): nicknames and points only.
   The scorecard saves on the phone first and sends when there's signal. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  var board = document.getElementById('lv-board'), card = document.getElementById('lv-score');
  if (!board && !card) return;
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function nice(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function pid(make) {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      if (!make) return '';
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16); crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join(''); put('gpPid', p);
    }
    return p;
  }
  // "Which one are you?" for quick rounds: the round then counts in your My Game.
  function claimBox(d) {
    if (d.kind !== 'quick' || !d.claim) return '';
    var mine = d.claim.filter(function (x) { return x.mine; })[0];
    if (mine) return '<p class="lv-small">Counting for <b>' + esc(mine.nick) + '</b> in <a href="/improve/my-game/">My Game</a>. <button type="button" class="lv-link" id="lv-unclaim">Not you?</button></p>';
    var open = d.claim.filter(function (x) { return !x.taken; });
    if (!open.length) return '';
    return '<section class="lv-card lv-pad lv-claim"><b class="lv-h">Playing? Which one are you?</b><p>Tap your name and this round goes into your free <a href="/improve/my-game/">My Game</a> stats. Only you see them.</p><div class="lv-chips">' +
      open.map(function (x) { return '<button type="button" data-claim="' + esc(x.m) + '">' + esc(x.nick) + '</button>'; }).join('') + '</div></section>';
  }
  function wireClaim(root, d, after) {
    root.querySelectorAll('[data-claim]').forEach(function (b) {
      b.onclick = function () {
        api('/lv/claim', { c: d.code, m: b.getAttribute('data-claim'), pid: pid(true) }).then(function (r) { if (r.ok) { gpUse('lv_claim'); track('lv_claim'); } else b.textContent = r.error || 'Try again'; after(); });
      };
    });
    var un = root.querySelector('#lv-unclaim'); if (un) un.onclick = function () { api('/lv/claim', { c: d.code, m: '', pid: pid() }).then(after); };
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
      .then(function (r) { return r.json(); });
  }
  // Stableford: shots on a hole from the playing handicap and stroke index.
  function shots(ph, si) {
    if (ph >= 0) return Math.floor(ph / 18) + ((ph % 18) >= si ? 1 : 0);
    var b = -ph; return -(Math.floor(b / 18) + ((b % 18) > (18 - si) ? 1 : 0));
  }
  function points(st, par, ph, si) { return st > 0 ? Math.max(0, par + shots(ph, si) - st + 2) : 0; }
  function word(d) { return ({ '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', '0': 'Par', '1': 'Bogey', '2': 'Double bogey' })[String(d)] || (d < -3 ? 'Hole-in-one!' : ''); }
  var NUM = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  var FMT = { stb: 'STABLEFORD', bb: 'BETTER-BALL', skins: 'SKINS' };
  function boardPath(kind) { return kind === 'quick' ? '/play/scorecard/live/?c=' : '/societies/live/?c='; }
  function nm(n) { n = String(n); return n.length <= 10 ? n : n.split(/\s+/)[0]; }
  function pair(names) { return (names || []).map(nm).join(' & '); }
  function err(box, msg) { box.innerHTML = '<div class="lv-err"><p>' + esc(msg) + '</p><p><a href="/societies/">Society HQ</a></p></div>'; }

  /* ------------------------------------------------------------------ the leaderboard */
  // WhatsApp: *bold*, _italic_, one golfer a line, the link on its own line so the preview card shows.
  function shareText(d) {
    var rows = d.rows.filter(function (r) { return r.thru; }), url = SITE + boardPath(d.kind) + d.code, fin = d.status === 'final';
    var top = '*' + (d.society || FMT[d.fmt] || 'STABLEFORD').toUpperCase() + ' · ' + (fin ? 'FINAL' : 'LIVE') + '*\n*' + d.title + '*';
    if (!rows.length) return top + '\n_' + [d.venue, 'first scores coming soon'].filter(Boolean).join(' · ') + '_\n\nFollow it live:\n' + url;
    var thrus = rows.map(function (r) { return r.thru; }).sort(function (a, b) { return a - b; }), mid = thrus[Math.floor(thrus.length / 2)];
    var stage = fin || thrus[0] >= 18 ? 'Final result' : mid >= 9 && mid <= 10 ? 'At the turn' : mid >= 13 && mid <= 17 ? NUM[18 - mid] + ' to play' : 'After ' + mid + (mid === 1 ? ' hole' : ' holes');
    var sub = '_' + [stage, d.venue].filter(Boolean).join(' · ') + '_';
    var lines = [], line = '';
    if (d.fmt === 'bb' && d.teams && d.teams.length > 1) {
      var A = d.teams[0], B = d.teams[1], g2 = A.pts - B.pts;
      lines = d.teams.map(function (t, i) { return (i === 0 && g2 ? '*' : '') + pair(t.names) + ' ' + t.pts + (i === 0 && g2 ? '*' : ''); });
      line = g2 ? '*' + pair(A.names) + '* ' + (fin ? 'win the better-ball by ' : 'lead by ') + g2 + '.' : 'All square on ' + A.pts + '.';
    } else if (d.fmt === 'skins' && d.skins) {
      lines = d.skins.map(function (x, i) { return (i === 0 && x.n ? '*' : '') + x.nick + ' ' + x.n + (x.n === 1 ? ' skin' : ' skins') + (i === 0 && x.n ? '*' : ''); });
      line = d.carry ? '_' + d.carry + (d.carry === 1 ? ' skin' : ' skins') + ' carrying over._' : '';
    } else {
      lines = rows.slice(0, 6).map(function (r, i) { var t = (r.tie ? '=' : '') + r.pos + '. ' + r.nick + ' ' + r.pts + (r.thru < 18 && !fin ? ' _(thru ' + r.thru + ')_' : ''); return i === 0 ? '*' + t.replace(/ _\(thru \d+\)_$/, '') + '*' + (r.thru < 18 && !fin ? ' _(thru ' + r.thru + ')_' : '') : t; });
      if (rows.length > 6) lines.push('_…and ' + (rows.length - 6) + ' more_');
      var a = rows[0], b = rows[1], gap = b ? a.pts - b.pts : 0;
      if (fin || thrus[0] >= 18) line = '*' + a.nick + '* ' + (a.tie ? 'shares it on ' + a.pts + '.' : 'wins with ' + a.pts + ' points' + (b && b.pts === a.pts ? ', on countback.' : '.'));
      else line = '*' + a.nick + '* ' + (a.tie ? 'shares the lead.' : 'leads by ' + (gap === 1 ? 'one' : gap === 2 ? 'two' : gap) + '.');
      var bird = (d.feed || []).filter(function (f) { return /birdies|eagles|HOLE-IN-ONE|albatross/.test(f.txt); })[0];
      if (bird && !fin) line += ' ' + bird.txt.replace(/\. \d+ points and a smug face\./, ' and won’t stop talking about it.');
    }
    return top + '\n' + sub + '\n\n' + lines.join('\n') + (line ? '\n\n' + line : '') + '\n\n' +
      (fin && d.report ? 'The match report:\n' + SITE + d.report : (fin ? 'The full card:' : 'Follow it live:') + '\n' + url);
  }
  // Once a round is final: each golfer's stats and the full card.
  function cardStats(d) {
    if (!d.pars || !d.rows.length || !d.rows[0].holes) return null;
    return d.rows.map(function (r) {
      var o = { nick: r.nick, pos: r.pos, tie: r.tie, pts: r.pts, gross: 0, pickups: 0, front: 0, back: 0, birdies: 0, pars: 0, blobs: 0, best: 0, bestPts: -1, holes: r.holes, played: 0 };
      for (var h = 1; h <= 18; h++) {
        var st = r.holes[h]; if (st === undefined) continue;
        var par = d.pars[h - 1], p = points(st, par, r.ph, d.si[h - 1]);
        o.played++; if (st > 0) o.gross += st; else o.pickups++;
        if (h <= 9) o.front += p; else o.back += p;
        if (st > 0 && st < par) o.birdies++; else if (st === par) o.pars++;
        if (!p) o.blobs++;
        if (p > o.bestPts) { o.bestPts = p; o.best = h; }
      }
      return o;
    });
  }
  function scoreCell(st, par) {
    if (st === undefined) return '<span class="lv-c">·</span>';
    if (st === 0) return '<span class="lv-c lv-cp" title="Picked up">–</span>';
    var dd = st - par;
    return '<span class="lv-c' + (dd <= -2 ? ' lv-ce' : dd === -1 ? ' lv-cb' : dd === 1 ? ' lv-cg' : dd >= 2 ? ' lv-cd' : '') + '">' + st + '</span>';
  }
  function grossTxt(o) { return o.played < 18 ? o.played + ' holes' : o.pickups ? 'NR' : String(o.gross); }
  function finalHtml(d) {
    var cs = cardStats(d); if (!cs) return '';
    var h = '<span class="lv-kick" style="color:#2f8a1f">HOW EVERYONE PLAYED</span><div class="lv-stats">' + cs.map(function (o, i) {
      return '<section class="lv-st' + (i === 0 ? ' is-win' : '') + '"><div class="lv-st-h"><b>' + (o.tie ? '=' : '') + o.pos + '. ' + esc(o.nick) + '</b><b class="lv-st-p">' + o.pts + ' <small>pts</small></b></div>' +
        '<div class="lv-st-g"><span><b>' + grossTxt(o) + '</b>gross</span><span><b>' + o.front + '–' + o.back + '</b>out–in pts</span><span><b>' + o.birdies + '/' + o.pars + '</b>birdies/pars</span><span><b>' + o.blobs + '</b>blobs</span></div>' +
        (o.bestPts > 0 ? '<small class="lv-st-n">Best hole: the ' + ord(o.best) + ', ' + o.bestPts + (o.bestPts === 1 ? ' point' : ' points') + '.' + (o.pickups ? ' Picked up on ' + o.pickups + (o.pickups === 1 ? ' hole.' : ' holes.') : '') + '</small>' : '') + '</section>';
    }).join('') + '</div>';
    function nine(off, label) {
      var t = '<div class="lv-nine"><table><thead><tr><th scope="col">Hole</th>';
      for (var i = 0; i < 9; i++) t += '<th scope="col">' + (off + i + 1) + '</th>';
      t += '<th scope="col">' + label + '</th></tr><tr class="lv-par"><th scope="row">Par</th>';
      var ps = 0; for (i = 0; i < 9; i++) { t += '<td>' + d.pars[off + i] + '</td>'; ps += d.pars[off + i]; }
      t += '<td>' + ps + '</td></tr></thead><tbody>';
      cs.forEach(function (o) {
        var tot = 0, full = true;
        t += '<tr><th scope="row">' + esc(nm(o.nick)) + '</th>';
        for (var j = 0; j < 9; j++) { var st = o.holes[off + j + 1]; t += '<td>' + scoreCell(st, d.pars[off + j]) + '</td>'; if (st > 0) tot += st; else full = false; }
        t += '<td><b>' + (full ? tot : '–') + '</b></td></tr>';
      });
      return t + '</tbody></table></div>';
    }
    h += '<section class="lv-card lv-pad"><b class="lv-h">The card</b>' + nine(0, 'Out') + nine(9, 'In') +
      '<div class="lv-legend"><span>' + scoreCell(3, 4) + ' birdie</span><span>' + scoreCell(5, 4) + ' bogey</span><span>' + scoreCell(6, 4) + ' double or worse</span><span>' + scoreCell(0, 4) + ' picked up</span></div></section>';
    return h;
  }
  // The final picture: result, a stats line each, and the card (up to eight golfers).
  function finalImage(d) {
    var cs = cardStats(d).slice(0, 8), n = cs.length;
    var H = 260 + n * 74 + 20 + 2 * (92 + n * 58) + 20 + 120;
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = Math.max(1080, H);
    var x = cv.getContext('2d');
    function rr(cx, cy, w, h, r) { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r); x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath(); }
    function t(s, px, py, font, col, al) { x.font = font; x.fillStyle = col; x.textAlign = al || 'left'; x.fillText(s, px, py); }
    function fit(s, max, font) { x.font = font; while (s.length > 3 && x.measureText(s).width > max) s = s.slice(0, -2) + '…'; return s; }
    x.fillStyle = '#14211a'; x.fillRect(0, 0, cv.width, cv.height);
    var y = 100;
    t('Golf', 64, y, '800 40px Poppins, sans-serif', '#fff'); var w = x.measureText('Golf').width;
    t('Price', 64 + w, y, '800 40px Poppins, sans-serif', '#5fd14a'); var w2 = x.measureText('Price').width;
    t(' AI', 64 + w + w2, y, '800 40px Poppins, sans-serif', '#fff');
    t('FINAL · ' + (FMT[d.fmt] || 'STABLEFORD'), 1016, y - 4, '700 22px Inter, sans-serif', '#8fd97c', 'right');
    y += 84; t(fit(d.title, 950, '800 56px Poppins, sans-serif'), 64, y, '800 56px Poppins, sans-serif', '#fff');
    var win = cs[0], sub = (d.society ? d.society + ' · ' : '') + nice(d.day) + ' · ' + win.nick + (win.tie ? ' shares it on ' : ' wins on ') + win.pts;
    if (d.fmt === 'bb' && d.teams && d.teams[0]) sub = nice(d.day) + ' · ' + pair(d.teams[0].names) + ' win on ' + d.teams[0].pts;
    if (d.fmt === 'skins' && d.skins && d.skins[0]) sub = nice(d.day) + ' · ' + d.skins[0].nick + ' takes ' + d.skins[0].n + ' skins';
    y += 46; t(fit(sub.toUpperCase(), 950, '700 22px Inter, sans-serif'), 64, y, '700 22px Inter, sans-serif', '#8fd97c');
    y += 30;
    cs.forEach(function (o, i) {
      if (i === 0) { x.fillStyle = '#1f3127'; rr(48, y, 984, 66, 16); x.fill(); }
      t((o.tie ? '=' : '') + o.pos, 70, y + 45, '800 28px Poppins, sans-serif', i === 0 ? '#8fd97c' : '#c4d0c8');
      t(fit(o.nick, 300, '700 28px Poppins, sans-serif'), 130, y + 45, '700 28px Poppins, sans-serif', '#fff');
      t(grossTxt(o) + (o.played === 18 && !o.pickups ? ' gross' : ''), 600, y + 43, '500 22px Inter, sans-serif', '#c4d0c8', 'right');
      t(o.birdies + (o.birdies === 1 ? ' birdie' : ' birdies'), 790, y + 43, '500 22px Inter, sans-serif', '#c4d0c8', 'right');
      t(o.blobs + (o.blobs === 1 ? ' blob' : ' blobs'), 920, y + 43, '500 22px Inter, sans-serif', '#c4d0c8', 'right');
      t(String(o.pts), 1012, y + 47, '800 34px Poppins, sans-serif', '#fff', 'right');
      y += 74;
    });
    y += 20;
    x.fillStyle = '#1a2a21'; rr(48, y, 984, 2 * (92 + n * 58) + 20, 20); x.fill();
    var col0 = 72, colW = 76, colX = function (i) { return 220 + i * colW + colW / 2; };
    [0, 9].forEach(function (off) {
      y += 46;
      t('HOLE', col0, y, '700 18px Inter, sans-serif', '#8fd97c');
      for (var i = 0; i < 9; i++) t(String(off + i + 1), colX(i), y, '700 22px Inter, sans-serif', '#c4d0c8', 'center');
      t(off ? 'IN' : 'OUT', 975, y, '700 18px Inter, sans-serif', '#8fd97c', 'center');
      y += 14;
      var parY = y + 22; t('PAR', col0, parY, '600 17px Inter, sans-serif', '#8a9a90');
      var ps = 0; for (i = 0; i < 9; i++) { t(String(d.pars[off + i]), colX(i), parY, '500 20px Inter, sans-serif', '#8a9a90', 'center'); ps += d.pars[off + i]; }
      t(String(ps), 975, parY, '500 20px Inter, sans-serif', '#8a9a90', 'center');
      y = parY + 10;
      cs.forEach(function (o) {
        var cy = y + 30, tot = 0, full = true;
        t(fit(nm(o.nick), 140, '700 22px Poppins, sans-serif'), col0, cy + 8, '700 22px Poppins, sans-serif', '#fff');
        for (var j = 0; j < 9; j++) {
          var st = o.holes[off + j + 1], par = d.pars[off + j], cx = colX(j);
          if (st === undefined) { t('·', cx, cy + 8, '700 22px Inter, sans-serif', '#8a9a90', 'center'); full = false; continue; }
          if (st === 0) { t('–', cx, cy + 8, '700 22px Inter, sans-serif', '#c4d0c8', 'center'); full = false; continue; }
          tot += st; var dd = st - par;
          if (dd < 0) { x.strokeStyle = '#5fd14a'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, 21, 0, Math.PI * 2); x.stroke(); if (dd <= -2) { x.beginPath(); x.arc(cx, cy, 16, 0, Math.PI * 2); x.stroke(); } }
          else if (dd === 1) { x.fillStyle = '#2c3f34'; rr(cx - 21, cy - 21, 42, 42, 6); x.fill(); }
          else if (dd >= 2) { x.fillStyle = '#5a3a1c'; rr(cx - 21, cy - 21, 42, 42, 6); x.fill(); }
          t(String(st), cx, cy + 8, (dd < 0 || dd >= 2 ? '800' : '600') + ' 22px Inter, sans-serif', dd >= 2 ? '#f8c48a' : '#fff', 'center');
        }
        t(full ? String(tot) : '–', 975, cy + 8, '800 22px Poppins, sans-serif', '#fff', 'center');
        y += 58;
      });
    });
    y += 60;
    t('Circled = birdie or better · ' + (d.kind === 'quick' ? 'Free live scorecard' : 'Live scoring by Society HQ') + ' at golfpriceai.com', 64, Math.min(cv.height - 40, y), '500 22px Inter, sans-serif', '#c4d0c8');
    return new Promise(function (ok) { cv.toBlob(function (b) { ok(b); }, 'image/png'); });
  }
  function shareImage(d) {
    if (d.status === 'final' && cardStats(d)) return finalImage(d);
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d');
    function rr(cx, cy, w, h, r) { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r); x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath(); }
    function t(s, px, py, font, col, al) { x.font = font; x.fillStyle = col; x.textAlign = al || 'left'; x.fillText(s, px, py); }
    x.fillStyle = '#14211a'; x.fillRect(0, 0, 1080, 1350);
    t('Golf', 80, 130, '800 46px Poppins, sans-serif', '#fff'); var w = x.measureText('Golf').width;
    t('Price', 80 + w, 130, '800 46px Poppins, sans-serif', '#5fd14a'); var w2 = x.measureText('Price').width;
    t(' AI', 80 + w + w2, 130, '800 46px Poppins, sans-serif', '#fff');
    var thru = Math.min.apply(null, d.rows.filter(function (r) { return r.thru; }).map(function (r) { return r.thru; }).concat([18]));
    t(d.status === 'final' ? 'FINAL RESULT' : 'LIVE · THRU ' + Math.max.apply(null, d.rows.map(function (r) { return r.thru; }).concat([0])), 1000, 128, '700 26px Inter, sans-serif', d.status === 'final' ? '#8fd97c' : '#f08a24', 'right');
    var title = d.title.length > 26 ? d.title.slice(0, 25) + '…' : d.title;
    t(title, 80, 250, '800 72px Poppins, sans-serif', '#fff');
    t(((d.society || FMT[d.fmt] || '') + ' · ' + d.venue).toUpperCase().slice(0, 44), 80, 310, '700 26px Inter, sans-serif', '#8fd97c');
    var list = d.fmt === 'bb' && d.teams ? d.teams.map(function (tm, i) { return { pos: i + 1, nick: pair(tm.names), thru: tm.thru, pts: tm.pts }; })
      : d.fmt === 'skins' && d.skins ? d.skins.map(function (k, i) { return { pos: i + 1, nick: k.nick, thru: 0, pts: k.n }; }) : d.rows;
    list.slice(0, 7).forEach(function (r, i) {
      var y = 380 + i * 112;
      if (i === 0) { x.fillStyle = '#1f3127'; rr(64, y, 952, 96, 20); x.fill(); }
      t((r.tie ? '=' : '') + r.pos, 104, y + 64, '800 44px Poppins, sans-serif', i === 0 ? '#8fd97c' : '#c4d0c8');
      t(r.nick.slice(0, 18), 210, y + 64, '700 44px Poppins, sans-serif', '#fff');
      t(r.thru >= 18 ? 'F' : r.thru ? 'thru ' + r.thru : '', 820, y + 62, '500 28px Inter, sans-serif', '#c4d0c8', 'right');
      t(String(r.pts), 990, y + 66, '800 52px Poppins, sans-serif', '#fff', 'right');
    });
    t((d.fmt === 'skins' ? 'Skins won · ' : '') + (d.kind === 'quick' ? 'Free live scorecard · golfpriceai.com' : 'Live scoring by Society HQ · golfpriceai.com'), 80, 1270, '500 28px Inter, sans-serif', '#c4d0c8');
    void thru;
    return new Promise(function (ok) { cv.toBlob(function (b) { ok(b); }, 'image/png'); });
  }
  function share(d, btn) {
    var text = shareText(d);
    gpUse('lv_share'); track('lv_share', { status: d.status });
    shareImage(d).then(function (blob) {
      var file = blob && window.File ? new File([blob], 'leaderboard.png', { type: 'image/png' }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], text: text }).catch(function () {});
      if (navigator.share) return navigator.share({ text: text }).catch(function () {});
      window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    });
    if (btn) { var o = btn.textContent; btn.textContent = 'Message ready'; setTimeout(function () { btn.textContent = o; }, 2500); }
  }
  function move(r) {
    if (!r.thru) return '<small>Not started</small>';
    if (r.move > 0) return '<small class="lv-up">▲ ' + r.move + '</small>';
    if (r.move < 0) return '<small>▼ ' + (-r.move) + '</small>';
    return '<small>–</small>';
  }
  function thruTxt(r) { return r.thru >= 18 ? 'F' : r.thru ? String(r.thru) : '–'; }
  var showAll = false, last = null, timer = null;
  function paintTv(d) {
    var tv = document.getElementById('lv-tv') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'lv-tv', className: 'lv-tv' }));
    var url = SITE + boardPath(d.kind) + d.code;
    tv.innerHTML = '<div><div class="lv-tv-brand"><span>Golf<i>Price</i> AI</span><span class="lv-live' + (d.status === 'final' ? ' lv-final' : '') + '">' + (d.status === 'final' ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<span class="lv-kick">' + esc((d.society || FMT[d.fmt]) + ' · ' + d.venue) + '</span><h2>' + esc(d.title) + '</h2>' +
      d.rows.slice(0, 7).map(function (r, i) { return '<div class="lv-tv-row' + (i === 0 ? ' lv-lead' : '') + '"><b>' + (r.tie ? '=' : '') + r.pos + '</b><b>' + esc(r.nick) + '</b><span>' + (r.thru >= 18 ? 'F' : r.thru ? 'thru ' + r.thru : '') + '</span><strong>' + r.pts + '</strong></div>'; }).join('') + '</div>' +
      '<div><div class="lv-tv-box"><span class="lv-kick" style="color:#f08a24">ON THE COURSE</span>' + ((d.feed || []).slice(0, 3).map(function (f) { return '<span>' + esc(f.txt) + '</span>'; }).join('') || '<span>First scores coming soon.</span>') + '</div>' +
      '<div class="lv-tv-box" style="display:grid;grid-template-columns:1fr 1fr">' + extra('Nearest the pin', d.extras.ntp) + extra('Longest drive', d.extras.ld) + '</div>' +
      '<div class="lv-tv-qr"><span id="lv-qr"></span><span><b>Follow it on your phone</b><span>' + esc(url.replace('https://', '')) + '</span></span></div></div>';
    qr(url, document.getElementById('lv-qr'));
    if (!document.getElementById('lv-tv-x')) {
      var x = document.createElement('button'); x.id = 'lv-tv-x'; x.className = 'lv-tv-x'; x.textContent = 'Exit TV view';
      x.onclick = function () { location.href = boardPath(d.kind) + d.code; }; document.body.appendChild(x);
    }
  }
  function qr(text, el) {
    if (!el) return;
    var go = function () { try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); var s = el.querySelector('svg'); if (s) { s.style.width = '8vw'; s.style.height = '8vw'; } } catch (e) { /* no QR */ } };
    if (window.qrcode) return go();
    var s = document.createElement('script'); s.src = '/js/vendor/qrcode.min.js?v=144'; s.onload = go; document.head.appendChild(s);
  }
  function extra(label, x) { return '<div><small>' + label + '</small><b' + (x ? '' : ' class="lv-none"') + '>' + (x ? esc(x.nick + (x.txt ? ', ' + x.txt : '')) : 'Not yet') + '</b></div>'; }
  function paintBoard(d) {
    last = d;
    var tv = /[?&]tv=1/.test(location.search);
    if (tv) return paintTv(d);
    var n = d.rows.length, groups = d.groups.length;
    var rows = showAll ? d.rows : d.rows.slice(0, 8);
    var ago = Math.round((Date.now() - new Date(d.updated).getTime()) / 60000);
    var upd = ago < 1 ? 'updated just now' : ago < 60 ? 'updated ' + ago + ' min ago' : 'updated ' + new Date(d.updated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    var quick = d.kind === 'quick';
    var h = '<section class="lv-hero"><div class="lv-top"><span class="lv-kick">' + esc(quick ? FMT[d.fmt] + ' · QUICK ROUND' : d.society + ' · STABLEFORD') + '</span><span class="lv-live' + (d.status === 'final' ? ' lv-final' : '') + '">' + (d.status === 'final' ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<h1>' + esc(d.title) + '</h1><span class="lv-meta">' + esc([d.venue, nice(d.day)].filter(Boolean).join(' · ')) + ' · ' + n + ' golfers' + (groups > 1 ? ' in ' + groups + ' groups' : '') + ' · ' + upd + '</span></section>';
    h += '<div class="lv-main">' + claimBox(d) + '<div id="lv-alerts"></div>';
    if (d.fmt === 'bb' && d.teams) {
      var lead = d.teams.length > 1 ? d.teams[0].pts - d.teams[1].pts : 0;
      h += '<section class="lv-card" aria-label="The better-ball"><div class="lv-th"><span>#</span><span>PAIR</span><span>THRU</span><span>PTS</span></div>' +
        d.teams.map(function (tm, i) { var tied = d.teams.filter(function (x) { return x.pts === tm.pts; }).length > 1, pos = 1 + d.teams.filter(function (x) { return x.pts > tm.pts; }).length; return '<div class="lv-tr' + (i === 0 && lead ? ' lv-lead' : '') + '"><b class="lv-pos">' + (tied ? '=' : '') + pos + '</b><span class="lv-who"><b>' + esc(pair(tm.names)) + '</b><small>' + (tm.pts === d.teams[0].pts ? (lead ? 'leads by ' + lead : 'all square') : (d.teams[0].pts - tm.pts) + ' back') + '</small></span><span class="lv-thru">' + (tm.thru >= 18 ? 'F' : tm.thru || '–') + '</span><b class="lv-pts">' + tm.pts + '</b></div>'; }).join('') +
        '</section><span class="lv-kick" style="color:#2f8a1f">INDIVIDUAL STABLEFORD</span>';
    }
    if (d.fmt === 'skins' && d.skins) {
      h += '<section class="lv-card" aria-label="Skins"><div class="lv-th lv-th3"><span>#</span><span>GOLFER</span><span>SKINS</span></div>' +
        d.skins.map(function (k, i) { return '<div class="lv-tr lv-th3' + (i === 0 && k.n ? ' lv-lead' : '') + '"><b class="lv-pos">' + (i + 1) + '</b><span class="lv-who"><b>' + esc(k.nick) + '</b></span><b class="lv-pts">' + k.n + '</b></div>'; }).join('') +
        '<p class="lv-small" style="padding:10px 14px;text-align:left">' + (d.carry ? '<b>' + d.carry + (d.carry === 1 ? ' skin' : ' skins') + ' carrying over</b> to the next hole. ' : '') + (d.skinHoles && d.skinHoles.length ? 'Last won: ' + d.skinHoles.slice(-3).reverse().map(function (x) { return esc(x.nick) + ' on the ' + ord(x.h) + (x.n > 1 ? ' (' + x.n + ')' : ''); }).join(', ') + '.' : 'Lowest net score on a hole wins it outright. A tie carries the skin on.') + '</p></section>' +
        '<span class="lv-kick" style="color:#2f8a1f">STABLEFORD POINTS</span>';
    }
    var finCard = d.status === 'final' && quick && cardStats(d);
    if (finCard) h = h.replace(/<span class="lv-kick" style="color:#2f8a1f">(INDIVIDUAL STABLEFORD|STABLEFORD POINTS)<\/span>$/, '') + finalHtml(d);
    else h += '<section class="lv-card" aria-label="Leaderboard"><div class="lv-th"><span>#</span><span>GOLFER</span><span>THRU</span><span>PTS</span></div>' +
      rows.map(function (r, i) { return '<div class="lv-tr' + (i === 0 && r.thru ? ' lv-lead' : '') + '"><b class="lv-pos">' + (r.tie && r.thru ? '=' : '') + r.pos + '</b><span class="lv-who"><b>' + esc(r.nick) + '</b>' + move(r) + '</span><span class="lv-thru">' + thruTxt(r) + '</span><b class="lv-pts">' + r.pts + '</b></div>'; }).join('') +
      (n > 8 ? '<button type="button" class="lv-more" id="lv-all">' + (showAll ? 'Show the top 8' : 'Show all ' + n + ' golfers') + '</button>' : '') + '</section>';
    if (d.feed && d.feed.length) h += '<section class="lv-feed" aria-live="polite"><small>ON THE COURSE</small>' + d.feed.slice(0, 5).map(function (f) { return '<span>' + esc(f.txt) + '</span>'; }).join('') + '</section>';
    if (d.status === 'final' && !finCard) h += finalHtml(d);
    if (!quick || d.extras.ntp || d.extras.ld) h += '<section class="lv-card lv-extras">' + extra('Nearest the pin', d.extras.ntp) + extra('Longest drive', d.extras.ld) + '</section>';
    h += '<div class="lv-btns"><button type="button" class="lv-btn" id="lv-share">' + (d.status === 'final' && d.pars ? 'Send the result and card to the group' : 'Send the leaderboard to the group') + '</button>';
    if (d.report) h += '<a class="lv-btn2" href="' + esc(d.report) + '">Read the match report</a>';
    if (!quick && d.organiser && d.status !== 'final') h += '<button type="button" class="lv-btn2" id="lv-final">Everyone’s in? Publish the results</button>';
    if (quick && d.tokens) h += d.tokens.map(function (g) { return '<a class="lv-btn2" href="/play/scorecard/card/?t=' + esc(g.token) + '">' + (d.tokens.length > 1 ? 'Group ' + g.grp + ' scorecard' : 'Open the scorecard') + '</a>'; }).join('');
    if (quick && d.organiser && d.status !== 'final') h += '<button type="button" class="lv-btn2" id="lv-end">Finish the round now</button>';
    if (quick && d.status === 'final') h += '<a class="lv-btn2" href="/play/scorecard/?again=' + esc(d.code) + '">Play again with this lot</a>';
    if (!quick) h += '<a class="lv-btn2" href="?c=' + esc(d.code) + '&amp;tv=1">Clubhouse TV view</a>';
    h += '</div>';
    if (quick && d.status === 'final' && d.organiser) {
      var crew = (get('gpCrews', []) || []).filter(function (c) { return c.codes && c.codes.indexOf(d.code) >= 0; })[0];
      if (crew && crew.n >= 3) h += '<section class="lv-feed"><small>YOU LOT PLAY A LOT</small><b style="font:700 17px Poppins,sans-serif">That’s ' + crew.n + ' rounds together. Make it official?</b><span>Turn this group into a golf society: fixtures, who’s paid, an Order of Merit and the National Society League. Still free.</span><a class="lv-btn" href="/societies/hq/">Turn us into a society</a></section>';
    }
    h += '<p class="lv-small">Nicknames and points only. ' + (d.status === 'final' ? 'Final scores.' : 'Updates itself every few seconds.') + ' <a href="' + (quick ? '/play/scorecard/' : '/societies/live-scoring/') + '">How it works</a></p></div>';
    board.innerHTML = h;
    if (window.gpLiveAlerts) window.gpLiveAlerts(d, document.getElementById('lv-alerts'), boardPath(d.kind) + d.code);
    var all = document.getElementById('lv-all'); if (all) all.onclick = function () { showAll = !showAll; paintBoard(last); };
    document.getElementById('lv-share').onclick = function () { share(d, this); };
    wireClaim(board, d, load);
    var end = document.getElementById('lv-end');
    if (end) end.onclick = function () {
      if (!window.confirm('Finish the round now? Whoever hasn’t got 18 scores keeps what they’ve got.')) return;
      api('/lv/end', { c: d.code, pid: pid() }).then(function () { load(); });
    };
    var fin = document.getElementById('lv-final');
    if (fin) fin.onclick = function () {
      var notIn = d.rows.filter(function (r) { return r.thru < 18; }).length;
      if (notIn && !window.confirm(notIn + (notIn === 1 ? ' golfer hasn’t' : ' golfers haven’t') + ' got 18 scores yet: they’ll go down as NR (no return). Publish anyway?')) return;
      fin.disabled = true; fin.textContent = 'Publishing…';
      api('/lv/final', { e: d.event, pid: pid() }).then(function (r) {
        if (!r.ok) { fin.disabled = false; fin.textContent = r.error || 'Please try again.'; return; }
        track('lv_final'); load();
      }).catch(function () { fin.disabled = false; fin.textContent = 'No signal. Try again in a moment.'; });
    };
  }
  function load() {
    var c = (location.search.match(/[?&]c=([a-z0-9]{8})/i) || [])[1];
    if (!c) return err(board, 'This page needs a leaderboard link from your organiser.');
    var q = '/lv/board?c=' + c.toLowerCase() + (pid() ? '&pid=' + pid() : '');
    api(q).then(function (d) {
      if (!d.ok) { if (!last) err(board, d.error); return; }
      paintBoard(d); gpUse('lv_view');
      clearTimeout(timer);
      if (d.status !== 'final') timer = setTimeout(tick, document.hidden ? 60000 : 20000);
    }).catch(function () { if (!last) err(board, 'No signal just now. The leaderboard will appear when you’re back in range.'); timer = setTimeout(tick, 30000); });
  }
  function tick() { if (document.hidden) { timer = setTimeout(tick, 60000); return; } load(); }
  if (board) { load(); document.addEventListener('visibilitychange', function () { if (!document.hidden && last && last.status !== 'final') { clearTimeout(timer); load(); } }); }

  /* ------------------------------------------------------------------ the scorecard */
  if (!card) return;
  var token = ((location.search.match(/[?&]t=([a-z0-9]{12})/i) || [])[1] || '').toLowerCase();
  var KEY = 'gpLv_' + token, st = null, hole = 1, local = get(KEY, { s: {}, q: [], d: {} });
  if (!local.d) local.d = {};
  // local.d[hole] = { fw: 1|0, pt: n }: the optional extra detail, for this phone's own golfer only
  function detailOn() { return !!(st && st.me && get('gpLvDetail', false) && st.players.some(function (p) { return p.m === st.me; })); }
  function det(h) { return local.d[h] || (st.detail && st.detail[h]) || {}; }
  // local.s[mkey][hole] = strokes (0 = picked up); local.q = holes waiting to send
  function strokes(m, h) { var l = local.s[m]; if (l && l[h] !== undefined) return l[h]; var p = st.players.filter(function (x) { return x.m === m; })[0]; return p && p.holes[h] !== undefined ? p.holes[h] : null; }
  function save() { put(KEY, local); }
  function done(h) { return st.players.every(function (p) { return strokes(p.m, h) !== null; }); }
  function totals() {
    return st.players.map(function (p) {
      var pts = 0, thru = 0;
      for (var h = 1; h <= 18; h++) { var s = strokes(p.m, h); if (s === null) continue; thru++; pts += points(s, st.pars[h - 1], p.ph, st.si[h - 1]); }
      return { nick: p.nick, pts: pts, thru: thru };
    }).sort(function (a, b) { return b.pts - a.pts; });
  }
  function short(n) { return String(n).split(/\s+/)[0]; }
  var sending = false;
  function flush() {
    if (sending || !local.q.length || !navigator.onLine) return paintSync();
    sending = true;
    var h = local.q[0], scores = {};
    st.players.forEach(function (p) { var l = local.s[p.m]; if (l && l[h] !== undefined) scores[p.m] = l[h]; });
    var body = { t: token, hole: h, scores: scores };
    if (st.me && local.d[h]) { if (scores[st.me] === undefined) { var cur = strokes(st.me, h); if (cur !== null) scores[st.me] = cur; } body.detail = {}; body.detail[st.me] = local.d[h]; }
    api('/lv/score', body).then(function (r) {
      sending = false;
      if (r.ok) {
        local.q.shift();
        st.players.forEach(function (p) { if (scores[p.m] !== undefined) { p.holes[h] = scores[p.m]; if (local.s[p.m]) delete local.s[p.m][h]; } });
        if (body.detail) { st.detail = st.detail || {}; st.detail[h] = local.d[h]; delete local.d[h]; }
        save(); paintSync(); if (local.q.length) flush();
      } else { if (/finished|locked/.test(r.error || '')) { local.q = []; save(); st.status = 'final'; paintCard(); } paintSync(r.error); }
    }).catch(function () { sending = false; paintSync(); setTimeout(flush, 15000); });
  }
  function paintSync(msg) {
    var el = document.getElementById('lv-sync'); if (!el) return;
    var n = local.q.length;
    el.className = 'lv-sync' + (n || msg ? ' lv-wait' : '');
    el.textContent = msg || (n ? (n === 1 ? '1 hole' : n + ' holes') + ' saved on this phone, waiting for signal. It sends when you’re back in range.' : 'Saved on this phone as you go. No signal? It sends when you’re back in range.');
  }
  function queue(h) { if (local.q.indexOf(h) < 0) local.q.push(h); save(); flush(); }
  function setScore(m, h, v) { (local.s[m] = local.s[m] || {})[h] = v; save(); }
  function firstOpen() { for (var h = 1; h <= 18; h++) if (!done(h)) return h; return 18; }
  function modal(html, wire) {
    var m = document.createElement('div'); m.className = 'lv-modal'; m.innerHTML = '<div role="dialog" aria-modal="true">' + html + '</div>';
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    document.body.appendChild(m); wire(m); var f = m.querySelector('select,input,button'); if (f) f.focus();
  }
  function pickUp() {
    modal('<b class="lv-h">Picked up on the ' + ord(hole) + '?</b><p style="margin:0;font-size:14px;color:#4a554e">No score on the hole means no points. Tap who picked up.</p>' +
      st.players.map(function (p) { return '<button type="button" class="lv-btn2" data-m="' + esc(p.m) + '">' + esc(p.nick) + (strokes(p.m, hole) === 0 ? ' (picked up)' : '') + '</button>'; }).join('') +
      '<button type="button" class="lv-btn2" data-x="1">Cancel</button>', function (m) {
      m.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { var who = b.getAttribute('data-m'); setScore(who, hole, strokes(who, hole) === 0 ? st.pars[hole - 1] : 0); m.remove(); paintCard(); }; });
      m.querySelector('[data-x]').onclick = function () { m.remove(); };
    });
  }
  function extraBox(kind) {
    var lbl = kind === 'ntp' ? 'Nearest the pin' : 'Longest drive', cur = st.extras[kind];
    modal('<b class="lv-h">' + lbl + ' on the ' + ord(hole) + '</b><label>Who?<select id="lv-xm"><option value="">Pick a golfer</option>' +
      st.players.map(function (p) { return '<option value="' + esc(p.m) + '"' + (cur && cur.m === p.m ? ' selected' : '') + '>' + esc(p.nick) + '</option>'; }).join('') +
      '</select></label><label>' + (kind === 'ntp' ? 'How close? (optional)' : 'A note (optional)') + '<input id="lv-xt" maxlength="40" placeholder="' + (kind === 'ntp' ? 'e.g. 9 feet' : 'e.g. 285 yards, down the middle') + '"></label>' +
      '<p style="margin:0;font-size:12.5px;color:#5b665f">Only beat by a later group? They can change it on their card.</p>' +
      '<button type="button" class="lv-btn" id="lv-xs">Save</button><button type="button" class="lv-btn2" id="lv-xc">Cancel</button>', function (m) {
      m.querySelector('#lv-xc').onclick = function () { m.remove(); };
      m.querySelector('#lv-xs').onclick = function () {
        var who = m.querySelector('#lv-xm').value, txt = m.querySelector('#lv-xt').value.trim();
        if (!who) return;
        var t = (kind === 'ntp' ? ord(hole) + (txt ? ', ' + txt : '') : txt) || '';
        api('/lv/extra', { t: token, kind: kind, m: who, txt: kind === 'ntp' ? (txt ? txt + ' on the ' + ord(hole) : 'on the ' + ord(hole)) : txt }).then(function (r) {
          if (r.ok) { st.extras[kind] = { m: who, txt: t }; m.remove(); paintCard(); } else m.querySelector('#lv-xs').textContent = r.error || 'Please try again.';
        }).catch(function () { m.querySelector('#lv-xs').textContent = 'No signal. Try again in a moment.'; });
      };
    });
  }
  function paintCard() {
    var par = st.pars[hole - 1], si = st.si[hole - 1], locked = st.status === 'final' && st.kind !== 'quick', quick = st.kind === 'quick';
    var board = boardPath(st.kind) + st.code;
    // Better-ball: which score counts for each pair on this hole
    var counts = {};
    if (st.fmt === 'bb') {
      var best = {};
      st.players.forEach(function (p) { var s0 = strokes(p.m, hole); if (s0 === null) return; var v = points(s0, par, p.ph, si); if (!best[p.team] || v > best[p.team].v) best[p.team] = { v: v, m: p.m }; });
      Object.keys(best).forEach(function (k) { if (best[k].v > 0) counts[best[k].m] = 1; });
    }
    var dots = ''; for (var h = 1; h <= 18; h++) dots += '<button type="button" aria-label="Hole ' + h + '" data-h="' + h + '" class="' + (h === hole ? 'lv-now' : done(h) ? 'lv-done' : '') + '"></button>';
    var h2 = '<section class="lv-hero"><div class="lv-top"><span class="lv-kick">' + esc(quick ? FMT[st.fmt] + (st.venue ? ' · ' + st.venue : '') : st.society + ' · GROUP ' + st.grp + (st.tee ? ' · ' + st.tee : '')) + '</span><span class="lv-live' + (locked ? ' lv-final' : '') + '">' + (locked ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<div class="lv-hole"><button type="button" class="lv-nav" id="lv-prev" aria-label="Previous hole"' + (hole === 1 ? ' disabled' : '') + '>‹</button><div><b>Hole ' + hole + '</b><span>Par ' + par + ' · Stroke index ' + si + '</span></div>' +
      '<button type="button" class="lv-nav lv-go" id="lv-next" aria-label="' + (hole === 18 ? 'Finish' : 'Next hole') + '">' + (hole === 18 ? '✓' : '›') + '</button></div><div class="lv-dots">' + dots + '</div></section>';
    h2 += '<div class="lv-main">';
    if (locked) h2 += '<p class="lv-sync">This round is finished and the scores are locked.</p>';
    if (quick && !st.me && !get('gpLvNoClaim_' + st.code, false) && st.claim && st.claim.some(function (x) { return !x.taken; })) h2 += '<section class="lv-card lv-pad lv-claim"><b class="lv-h">Which one are you?</b><p>Tap your name to keep this round in your free My Game stats.</p><div class="lv-chips">' +
      st.claim.filter(function (x) { return !x.taken; }).map(function (x) { return '<button type="button" data-claim="' + esc(x.m) + '">' + esc(x.nick) + '</button>'; }).join('') + '<button type="button" id="lv-noclaim">Just keeping score</button></div></section>';
    var teamSeen = {};
    st.players.slice().sort(function (a, b) { return st.fmt === 'bb' ? (a.team - b.team) : 0; }).forEach(function (p) {
      if (st.fmt === 'bb' && !teamSeen[p.team]) {
        teamSeen[p.team] = 1;
        h2 += '<span class="lv-kick" style="color:#2f8a1f">' + esc(st.players.filter(function (x) { return x.team === p.team; }).map(function (x) { return nm(x.nick); }).join(' & ').toUpperCase()) + '</span>';
      }
      var s = strokes(p.m, hole), sh = shots(p.ph, si), pt = s === null ? null : points(s, par, p.ph, si);
      var w = s > 0 ? word(s - par) : '', good = s > 0 && s - par < 0;
      var sub = s === 0 ? 'Picked up' : good ? w : (p.m === st.me ? 'You · ' : '') + 'Plays off ' + (p.ph < 0 ? '+' + (-p.ph) : p.ph) + (sh > 0 ? ' · ' + sh + (sh === 1 ? ' shot' : ' shots') + ' here' : sh < 0 ? ' · gives ' + (-sh) + ' back here' : '');
      h2 += '<div class="lv-p' + (good ? ' lv-good' : '') + '" data-m="' + esc(p.m) + '"><span class="lv-who"><b>' + esc(p.nick) + '</b><small>' + esc(sub) + '</small></span>' +
        '<button type="button" class="lv-pm" data-d="-1" aria-label="One less for ' + esc(p.nick) + '"' + (locked ? ' disabled' : '') + '>−</button>' +
        '<b class="lv-n' + (s === null ? ' lv-blank' : '') + '" aria-live="polite">' + (s === null ? par : s === 0 ? '–' : s) + '</b>' +
        '<button type="button" class="lv-pm" data-d="1" aria-label="One more for ' + esc(p.nick) + '"' + (locked ? ' disabled' : '') + '>+</button>' +
        '<span class="lv-pt"><b class="' + (pt === null ? '' : pt >= 3 || counts[p.m] ? 'lv-g' : pt === 0 ? 'lv-z' : pt === 1 ? 'lv-z' : '') + '">' + (pt === null ? '·' : pt) + '</b><small>' + (counts[p.m] ? 'counts' : 'pts') + '</small></span></div>';
      if (p.m === st.me && detailOn() && !locked) {
        var dd = det(hole);
        h2 += '<div class="lv-det">' + (par >= 4 ? '<span>Fairway</span><button type="button" data-fw="1" aria-pressed="' + (dd.fw === 1) + '">Hit</button><button type="button" data-fw="0" aria-pressed="' + (dd.fw === 0) + '">Missed</button>' : '') +
          '<span>Putts</span><button type="button" data-pt="-1" aria-label="One putt fewer">−</button><b>' + (dd.pt == null ? '–' : dd.pt) + '</b><button type="button" data-pt="1" aria-label="One putt more">+</button></div>';
      }
    });
    var xk = par === 3 ? 'ntp' : 'ld', xl = par === 3 ? 'Nearest the pin?' : 'Longest drive?';
    h2 += '<div class="lv-two"><button type="button" id="lv-x"' + (locked ? ' disabled' : '') + '>' + xl + '</button><button type="button" id="lv-pu"' + (locked ? ' disabled' : '') + '>Picked up (no score)</button></div>';
    var t = totals(), thru = Math.min.apply(null, t.map(function (x) { return x.thru; }));
    if (st.fmt === 'bb') {
      var tp = {};
      st.players.forEach(function (p) { tp[p.team] = tp[p.team] || { names: [], h: {} }; tp[p.team].names.push(nm(p.nick)); });
      for (var hh = 1; hh <= 18; hh++) st.players.forEach(function (p) { var s1 = strokes(p.m, hh); if (s1 === null) return; var v1 = points(s1, st.pars[hh - 1], p.ph, st.si[hh - 1]); var T = tp[p.team]; T.h[hh] = Math.max(T.h[hh] || 0, v1); });
      t = Object.keys(tp).map(function (k) { var T = tp[k], sum = 0; Object.keys(T.h).forEach(function (x) { sum += T.h[x]; }); return { nick: T.names.join(' & '), pts: sum }; }).sort(function (a, b) { return b.pts - a.pts; });
    }
    h2 += '<div class="lv-sum"><span><small>THIS GROUP' + (thru ? ', THRU ' + thru : '') + '</small><b>' + t.map(function (x) { return esc(st.fmt === 'bb' ? x.nick : short(x.nick)) + ' ' + x.pts; }).join(' · ') + '</b></span><a href="' + esc(board) + '">Leaderboard →</a></div>';
    h2 += '<p class="lv-sync" id="lv-sync"></p>';
    h2 += '<p class="lv-small">Tap + or − to set each score (it starts at par). Then › for the next hole. <a href="' + (quick ? '/play/scorecard/' : '/societies/live-scoring/') + '">Help</a></p>';
    if (st.me) h2 += '<label class="lv-small lv-detail-t"><input type="checkbox" id="lv-detail"' + (get('gpLvDetail', false) ? ' checked' : '') + '> Extra detail for me (fairways and putts, for My Game)</label>';
    h2 += '</div>';
    card.innerHTML = h2; paintSync();
    card.querySelectorAll('.lv-pm').forEach(function (b) {
      b.onclick = function () {
        var m = b.parentNode.getAttribute('data-m'), s = strokes(m, hole), d = Number(b.getAttribute('data-d'));
        var v = s === null ? par + (d < 0 ? -1 : 0) : s === 0 ? par : s + d;
        if (s === null && d > 0) v = par;
        setScore(m, hole, Math.max(1, Math.min(15, v))); paintCard();
      };
    });
    card.querySelectorAll('.lv-dots button').forEach(function (b) { b.onclick = function () { go(Number(b.getAttribute('data-h'))); }; });
    document.getElementById('lv-prev').onclick = function () { go(hole - 1); };
    document.getElementById('lv-next').onclick = function () {
      if (!locked) {
        // Anyone left on the starting par gets par: it's what was shown.
        var changed = false;
        st.players.forEach(function (p) { if (strokes(p.m, hole) === null) { setScore(p.m, hole, par); changed = true; } });
        var mine = st.players.some(function (p) { return local.s[p.m] && local.s[p.m][hole] !== undefined; });
        if (mine || changed) queue(hole);
      }
      if (hole === 18) { location.href = board; return; }
      go(hole + 1);
    };
    document.getElementById('lv-x').onclick = function () { extraBox(xk); };
    document.getElementById('lv-pu').onclick = pickUp;
    var dt = document.getElementById('lv-detail'); if (dt) dt.onchange = function () { put('gpLvDetail', dt.checked); paintCard(); };
    card.querySelectorAll('[data-fw]').forEach(function (b) { b.onclick = function () { var d0 = local.d[hole] = Object.assign({}, det(hole)); d0.fw = Number(b.getAttribute('data-fw')); save(); paintCard(); }; });
    card.querySelectorAll('[data-pt]').forEach(function (b) { b.onclick = function () { var d0 = local.d[hole] = Object.assign({}, det(hole)); d0.pt = Math.max(0, Math.min(6, (d0.pt == null ? 2 : d0.pt + Number(b.getAttribute('data-pt'))))); save(); paintCard(); }; });
    var nc = document.getElementById('lv-noclaim'); if (nc) nc.onclick = function () { put('gpLvNoClaim_' + st.code, true); paintCard(); };
    wireClaim(card, { code: st.code }, function () { start(); });
  }
  function go(h) { hole = Math.max(1, Math.min(18, h)); put(KEY + '_h', hole); paintCard(); window.scrollTo(0, 0); }
  function start() {
    if (!/^[a-z0-9]{12}$/.test(token)) return err(card, 'This page needs your group’s scorecard link.');
    var cached = get(KEY + '_st', null);
    api('/lv/card?t=' + token + (pid() ? '&pid=' + pid() : '')).then(function (d) {
      if (!d.ok) return cached ? boot(cached) : err(card, d.error);
      put(KEY + '_st', d); boot(d);
    }).catch(function () { if (cached) boot(cached); else err(card, 'No signal just now. Open this link again when you’re back in range, and from then on it works offline.'); });
  }
  function boot(d) {
    var again = !!st; st = d; if (!again) hole = get(KEY + '_h', 0) || firstOpen();
    paintCard(); flush(); gpUse('lv_card');
  }
  window.addEventListener('online', flush);
  setInterval(flush, 30000);
  start();
})();
