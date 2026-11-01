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
  function pid() { var p = get('gpPid', ''); return /^[a-z0-9]{12,32}$/.test(p) ? p : ''; }
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
  function err(box, msg) { box.innerHTML = '<div class="lv-err"><p>' + esc(msg) + '</p><p><a href="/societies/">Society HQ</a></p></div>'; }

  /* ------------------------------------------------------------------ the leaderboard */
  function shareText(d) {
    var rows = d.rows.filter(function (r) { return r.thru; }), url = SITE + '/societies/live/?c=' + d.code;
    if (!rows.length) return d.title + ' is under way. Follow it live: ' + url;
    var thrus = rows.map(function (r) { return r.thru; }).sort(function (a, b) { return a - b; }), mid = thrus[Math.floor(thrus.length / 2)];
    var a = rows[0], b = rows[1], s;
    if (d.status === 'final' || thrus[0] >= 18) {
      s = 'Final result: ' + a.nick + ' wins ' + d.title + ' with ' + a.pts + ' points' + (b ? ', ' + b.nick + ' ' + (b.pts === a.pts ? 'level but beaten on countback.' : 'second on ' + b.pts + '.') : '.');
      return s + (d.report ? ' The report: ' + SITE + d.report : ' Full board: ' + url);
    }
    var when = mid >= 9 && mid <= 10 ? 'At the turn' : mid >= 13 && mid <= 17 ? NUM[18 - mid] + ' to play' : 'After ' + mid + ' holes';
    var gap = b ? a.pts - b.pts : 0;
    s = when + ': ' + a.nick + (a.tie ? ' shares the lead on ' : ' leads on ') + a.pts + (b && !a.tie ? ', ' + b.nick + ' ' + (gap === 1 ? 'one' : gap === 2 ? 'two' : gap) + ' back.' : '.');
    var bird = (d.feed || []).filter(function (f) { return /birdies|eagles|HOLE-IN-ONE|albatross/.test(f.txt); })[0];
    if (bird) s += ' ' + bird.txt.replace(/ \d+ points and a smug face\./, ' and won’t stop talking about it.');
    return s + ' Live: ' + url;
  }
  function shareImage(d) {
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
    t((d.society + ' · ' + d.venue).toUpperCase().slice(0, 44), 80, 310, '700 26px Inter, sans-serif', '#8fd97c');
    d.rows.slice(0, 7).forEach(function (r, i) {
      var y = 380 + i * 112;
      if (i === 0) { x.fillStyle = '#1f3127'; rr(64, y, 952, 96, 20); x.fill(); }
      t((r.tie ? '=' : '') + r.pos, 104, y + 64, '800 44px Poppins, sans-serif', i === 0 ? '#8fd97c' : '#c4d0c8');
      t(r.nick.slice(0, 18), 210, y + 64, '700 44px Poppins, sans-serif', '#fff');
      t(r.thru >= 18 ? 'F' : r.thru ? 'thru ' + r.thru : '', 820, y + 62, '500 28px Inter, sans-serif', '#c4d0c8', 'right');
      t(String(r.pts), 990, y + 66, '800 52px Poppins, sans-serif', '#fff', 'right');
    });
    t('Live scoring by Society HQ · golfpriceai.com', 80, 1270, '500 28px Inter, sans-serif', '#c4d0c8');
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
    var url = SITE + '/societies/live/?c=' + d.code;
    tv.innerHTML = '<div><div class="lv-tv-brand"><span>Golf<i>Price</i> AI</span><span class="lv-live' + (d.status === 'final' ? ' lv-final' : '') + '">' + (d.status === 'final' ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<span class="lv-kick">' + esc(d.society + ' · ' + d.venue) + '</span><h2>' + esc(d.title) + '</h2>' +
      d.rows.slice(0, 7).map(function (r, i) { return '<div class="lv-tv-row' + (i === 0 ? ' lv-lead' : '') + '"><b>' + (r.tie ? '=' : '') + r.pos + '</b><b>' + esc(r.nick) + '</b><span>' + (r.thru >= 18 ? 'F' : r.thru ? 'thru ' + r.thru : '') + '</span><strong>' + r.pts + '</strong></div>'; }).join('') + '</div>' +
      '<div><div class="lv-tv-box"><span class="lv-kick" style="color:#f08a24">ON THE COURSE</span>' + ((d.feed || []).slice(0, 3).map(function (f) { return '<span>' + esc(f.txt) + '</span>'; }).join('') || '<span>First scores coming soon.</span>') + '</div>' +
      '<div class="lv-tv-box" style="display:grid;grid-template-columns:1fr 1fr">' + extra('Nearest the pin', d.extras.ntp) + extra('Longest drive', d.extras.ld) + '</div>' +
      '<div class="lv-tv-qr"><span id="lv-qr"></span><span><b>Follow it on your phone</b><span>golfpriceai.com/societies/live/?c=' + esc(d.code) + '</span></span></div></div>';
    qr(url, document.getElementById('lv-qr'));
    if (!document.getElementById('lv-tv-x')) {
      var x = document.createElement('button'); x.id = 'lv-tv-x'; x.className = 'lv-tv-x'; x.textContent = 'Exit TV view';
      x.onclick = function () { location.href = '/societies/live/?c=' + d.code; }; document.body.appendChild(x);
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
    var h = '<section class="lv-hero"><div class="lv-top"><span class="lv-kick">' + esc(d.society) + ' · STABLEFORD</span><span class="lv-live' + (d.status === 'final' ? ' lv-final' : '') + '">' + (d.status === 'final' ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<h1>' + esc(d.title) + '</h1><span class="lv-meta">' + esc([d.venue, nice(d.day)].filter(Boolean).join(' · ')) + ' · ' + n + ' golfers in ' + groups + (groups === 1 ? ' group' : ' groups') + ' · ' + upd + '</span></section>';
    h += '<div class="lv-main"><section class="lv-card" aria-label="Leaderboard"><div class="lv-th"><span>#</span><span>GOLFER</span><span>THRU</span><span>PTS</span></div>' +
      rows.map(function (r, i) { return '<div class="lv-tr' + (i === 0 && r.thru ? ' lv-lead' : '') + '"><b class="lv-pos">' + (r.tie && r.thru ? '=' : '') + r.pos + '</b><span class="lv-who"><b>' + esc(r.nick) + '</b>' + move(r) + '</span><span class="lv-thru">' + thruTxt(r) + '</span><b class="lv-pts">' + r.pts + '</b></div>'; }).join('') +
      (n > 8 ? '<button type="button" class="lv-more" id="lv-all">' + (showAll ? 'Show the top 8' : 'Show all ' + n + ' golfers') + '</button>' : '') + '</section>';
    if (d.feed && d.feed.length) h += '<section class="lv-feed" aria-live="polite"><small>ON THE COURSE</small>' + d.feed.slice(0, 5).map(function (f) { return '<span>' + esc(f.txt) + '</span>'; }).join('') + '</section>';
    h += '<section class="lv-card lv-extras">' + extra('Nearest the pin', d.extras.ntp) + extra('Longest drive', d.extras.ld) + '</section>';
    h += '<div class="lv-btns"><button type="button" class="lv-btn" id="lv-share">Send the leaderboard to the group</button>';
    if (d.report) h += '<a class="lv-btn2" href="' + esc(d.report) + '">Read the match report</a>';
    if (d.organiser && d.status !== 'final') h += '<button type="button" class="lv-btn2" id="lv-final">Everyone’s in? Publish the results</button>';
    h += '<a class="lv-btn2" href="?c=' + esc(d.code) + '&amp;tv=1">Clubhouse TV view</a></div>';
    h += '<p class="lv-small">Nicknames and points only. ' + (d.status === 'final' ? 'Final scores.' : 'Updates itself every few seconds.') + ' <a href="/societies/live-scoring/">How live scoring works</a></p></div>';
    board.innerHTML = h;
    var all = document.getElementById('lv-all'); if (all) all.onclick = function () { showAll = !showAll; paintBoard(last); };
    document.getElementById('lv-share').onclick = function () { share(d, this); };
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
  var KEY = 'gpLv_' + token, st = null, hole = 1, local = get(KEY, { s: {}, q: [] });
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
    api('/lv/score', { t: token, hole: h, scores: scores }).then(function (r) {
      sending = false;
      if (r.ok) {
        local.q.shift();
        st.players.forEach(function (p) { if (scores[p.m] !== undefined) { p.holes[h] = scores[p.m]; delete local.s[p.m][h]; } });
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
    var par = st.pars[hole - 1], si = st.si[hole - 1], locked = st.status === 'final';
    var dots = ''; for (var h = 1; h <= 18; h++) dots += '<button type="button" aria-label="Hole ' + h + '" data-h="' + h + '" class="' + (h === hole ? 'lv-now' : done(h) ? 'lv-done' : '') + '"></button>';
    var h2 = '<section class="lv-hero"><div class="lv-top"><span class="lv-kick">' + esc(st.society) + ' · GROUP ' + st.grp + (st.tee ? ' · ' + esc(st.tee) : '') + '</span><span class="lv-live' + (locked ? ' lv-final' : '') + '">' + (locked ? 'FINAL' : 'LIVE') + '</span></div>' +
      '<div class="lv-hole"><button type="button" class="lv-nav" id="lv-prev" aria-label="Previous hole"' + (hole === 1 ? ' disabled' : '') + '>‹</button><div><b>Hole ' + hole + '</b><span>Par ' + par + ' · Stroke index ' + si + '</span></div>' +
      '<button type="button" class="lv-nav lv-go" id="lv-next" aria-label="' + (hole === 18 ? 'Finish' : 'Next hole') + '">' + (hole === 18 ? '✓' : '›') + '</button></div><div class="lv-dots">' + dots + '</div></section>';
    h2 += '<div class="lv-main">';
    if (locked) h2 += '<p class="lv-sync">This round is finished and the scores are locked.</p>';
    st.players.forEach(function (p) {
      var s = strokes(p.m, hole), sh = shots(p.ph, si), pt = s === null ? null : points(s, par, p.ph, si);
      var w = s > 0 ? word(s - par) : '', good = s > 0 && s - par < 0;
      var sub = s === 0 ? 'Picked up' : good ? w : 'Plays off ' + (p.ph < 0 ? '+' + (-p.ph) : p.ph) + (sh > 0 ? ' · ' + sh + (sh === 1 ? ' shot' : ' shots') + ' here' : sh < 0 ? ' · gives ' + (-sh) + ' back here' : '');
      h2 += '<div class="lv-p' + (good ? ' lv-good' : '') + '" data-m="' + esc(p.m) + '"><span class="lv-who"><b>' + esc(p.nick) + '</b><small>' + esc(sub) + '</small></span>' +
        '<button type="button" class="lv-pm" data-d="-1" aria-label="One less for ' + esc(p.nick) + '"' + (locked ? ' disabled' : '') + '>−</button>' +
        '<b class="lv-n' + (s === null ? ' lv-blank' : '') + '" aria-live="polite">' + (s === null ? par : s === 0 ? '–' : s) + '</b>' +
        '<button type="button" class="lv-pm" data-d="1" aria-label="One more for ' + esc(p.nick) + '"' + (locked ? ' disabled' : '') + '>+</button>' +
        '<span class="lv-pt"><b class="' + (pt === null ? '' : pt >= 3 ? 'lv-g' : pt === 0 ? 'lv-z' : pt === 1 ? 'lv-z' : '') + '">' + (pt === null ? '·' : pt) + '</b><small>pts</small></span></div>';
    });
    var xk = par === 3 ? 'ntp' : 'ld', xl = par === 3 ? 'Nearest the pin?' : 'Longest drive?';
    h2 += '<div class="lv-two"><button type="button" id="lv-x"' + (locked ? ' disabled' : '') + '>' + xl + '</button><button type="button" id="lv-pu"' + (locked ? ' disabled' : '') + '>Picked up (no score)</button></div>';
    var t = totals(), thru = Math.min.apply(null, t.map(function (x) { return x.thru; }));
    h2 += '<div class="lv-sum"><span><small>THIS GROUP' + (thru ? ', THRU ' + thru : '') + '</small><b>' + t.map(function (x) { return esc(short(x.nick)) + ' ' + x.pts; }).join(' · ') + '</b></span><a href="/societies/live/?c=' + esc(st.code) + '">Leaderboard →</a></div>';
    h2 += '<p class="lv-sync" id="lv-sync"></p>';
    h2 += '<p class="lv-small">Tap + or − to set each score (it starts at par). Then › for the next hole. <a href="/societies/live-scoring/">Help</a></p></div>';
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
      if (hole === 18) { location.href = '/societies/live/?c=' + st.code; return; }
      go(hole + 1);
    };
    document.getElementById('lv-x').onclick = function () { extraBox(xk); };
    document.getElementById('lv-pu').onclick = pickUp;
  }
  function go(h) { hole = Math.max(1, Math.min(18, h)); put(KEY + '_h', hole); paintCard(); window.scrollTo(0, 0); }
  function start() {
    if (!/^[a-z0-9]{12}$/.test(token)) return err(card, 'This page needs your group’s scorecard link from the organiser.');
    var cached = get(KEY + '_st', null);
    api('/lv/card?t=' + token).then(function (d) {
      if (!d.ok) return cached ? boot(cached) : err(card, d.error);
      put(KEY + '_st', d); boot(d);
    }).catch(function () { if (cached) boot(cached); else err(card, 'No signal just now. Open this link again when you’re back in range, and from then on it works offline.'); });
  }
  function boot(d) {
    st = d; hole = get(KEY + '_h', 0) || firstOpen();
    paintCard(); flush(); gpUse('lv_card');
  }
  window.addEventListener('online', flush);
  setInterval(flush, 30000);
  start();
})();
