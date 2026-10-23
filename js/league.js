/* GolfPrice AI: a Par Price league table (/play/league/?l=<code>).
   Data comes from the alerts worker (/pp/league). Members are nicknames only;
   the browser's random player id (gpPid, made by par-price.js or here) says
   which row is "you". Nothing else about anyone is stored. */
(function () {
  'use strict';
  var box = document.getElementById('lg');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var code = (new URLSearchParams(location.search).get('l') || '').toLowerCase();
  var view = 'today', data = null;

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fmt(t) { return t === 0 ? 'E' : (t > 0 ? '+' + t : '−' + Math.abs(t)); }
  function cls(t) { return t < 0 ? 'lg-under' : t > 0 ? 'lg-over' : ''; }
  function link() { return 'https://golfpriceai.com/play/league/?l=' + code; }
  function share(text, files) {
    if (files && navigator.canShare && navigator.canShare({ files: files })) return navigator.share({ files: files, text: text }).catch(function () {});
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function load() {
    if (!/^[a-hj-km-np-z2-9]{6}$/.test(code)) return fail('That doesn’t look like a league link. Ask whoever sent it for a fresh one.');
    api('/pp/league?l=' + code + '&pid=' + pid()).then(function (d) {
      if (!d.ok) return fail(d.error);
      data = d;
      document.title = d.name + ' · Par Price league | GolfPrice AI';
      d.members.some(function (m) { return m.you; }) ? table() : join();
    }).catch(function () { fail('We couldn’t reach the clubhouse. Please refresh in a minute.'); });
  }
  function fail(msg) {
    box.innerHTML = '<div class="lg-hero"><span class="pr-kicker">Par Price leagues</span><h1>Hmm. No sign of that league.</h1><p>' + esc(msg || '') + '</p></div>' +
      '<a class="gp-af-btn lg-btn" href="/play/par-price/">Play today’s round anyway</a>';
  }

  /* ---------------------------------------------------------- join */
  function leader(rows) {
    var played = rows.filter(function (m) { return m.today; }).sort(function (a, b) { return a.today.total - b.today.total; });
    return played[0] || null;
  }
  function join() {
    var lead = leader(data.members), n = data.members.length;
    box.innerHTML = '<div class="lg-hero"><span class="pr-kicker">You’ve been invited</span>' +
      '<h1>' + (data.members[0] ? esc(data.members[0].nick) + ' wants to beat you at ' : 'Join ') + esc(data.name) + '</h1>' +
      '<p>' + n + (n === 1 ? ' golfer' : ' golfers') + ' so far.' + (lead ? ' Today’s leader: ' + esc(lead.nick) + ' (' + fmt(lead.today.total) + '), who will be telling everyone.' : ' Nobody’s teed off today yet.') + '</p></div>' +
      '<div class="lg-card" style="padding:14px"><b>How it works</b><ol class="lg-how"><li>Five real golf products a day. Guess each one’s UK price.</li>' +
      '<li>Scored like a round: within 2% is an eagle, 5% a birdie, 10% par.</li><li>Your score lands on the league table. Lowest wins, as golf intended.</li></ol></div>' +
      '<form class="lg-join" novalidate><h2>Pick a nickname for the table</h2>' +
      '<div class="pr-lg-form"><label>Nickname<input name="nick" maxlength="20" placeholder="e.g. The Shank Redemption" autocomplete="nickname" value="' + esc(get('gpNick', '')) + '"></label>' +
      '<button type="submit" class="gp-af-btn">Join and tee off</button><p class="pr-msg" role="status"></p>' +
      '<p class="pr-lg-small">Nicknames only: no email, no sign-up, no real names needed. What happens in the league stays in the league. Join on your usual phone, not a private tab: there’s no login, so a private tab forgets you when it closes.</p></div></form>' +
      '<p style="text-align:center;margin:0"><a href="/play/par-price/">Just play today’s round without joining</a></p>';
    var f = box.querySelector('form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = f.querySelector('[name=nick]').value, msg = f.querySelector('.pr-msg'), btn = f.querySelector('button');
      btn.disabled = true; msg.textContent = 'Finding you a locker…';
      api('/pp/league/join', { pid: pid(), id: code, nick: nick }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        put('gpNick', nick);
        track('par_price_league_join');
        load();
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }

  /* ---------------------------------------------------------- the table */
  var WAITING = ['Still in the car park.', 'Warming up on the range.', 'Looking for a tee.', 'Says they’re “just parking”.'];
  function lineFor(m, i, played, view) {
    if (view === 'week') return m.played + ' of ' + (data.n - data.monday + 1) + ' rounds this week';
    if (view === 'all') return m.wins + (m.wins === 1 ? ' win' : ' wins') + (m.streak > 1 ? ' · ' + m.streak + '-day streak' : '');
    if (!m.today) return WAITING[i % WAITING.length];
    var t = m.today.total;
    if (i === 0 && played > 1) return 'Leader. Insufferable about it.';
    if (i === played - 1 && played > 2) return 'Thinks everything costs £50.';
    if (m.you) return t < 0 ? 'Under par. Smug, and rightly so.' : 'Respectable. Quietly furious.';
    return t <= -3 ? 'Sharp eye. Suspiciously sharp.' : t < 0 ? 'Under par. Smug, rightly.' : t === 0 ? 'Level par. Very committee.' : t <= 4 ? 'The prices won a hole or two.' : 'Somewhere in the rough.';
  }
  function sorted(v) {
    var ms = data.members.slice();
    if (v === 'today') ms.sort(function (a, b) { return (a.today ? a.today.total : 99) - (b.today ? b.today.total : 99); });
    else if (v === 'week') ms.sort(function (a, b) { return a.week - b.week; });
    else ms.sort(function (a, b) { return b.wins - a.wins || b.streak - a.streak; });
    return ms;
  }
  function rowsHtml(v) {
    var ms = sorted(v), played = ms.filter(function (m) { return m.today; }).length, pos = 0, last = null;
    return ms.map(function (m, i) {
      var val = v === 'today' ? (m.today ? m.today.total : null) : v === 'week' ? m.week : m.wins;
      if (val !== null && val !== last) { pos = i + 1; last = val; }
      var lead = val !== null && pos === 1 && (v !== 'all' || val > 0);
      var right = v === 'today'
        ? (m.today ? '<span class="lg-grid" aria-label="Holes">' + m.today.grid.split('').map(function (c) { return '<i class="lg-g-' + c + '"></i>'; }).join('') + '</span>' +
          '<b class="lg-score ' + cls(m.today.total) + '">' + fmt(m.today.total) + '</b>' : '<span class="lg-wait">Not played yet</span><span></span>')
        : v === 'week' ? '<span></span><b class="lg-score ' + cls(m.week) + '">' + fmt(m.week) + '</b>'
        : '<span></span><b class="lg-score">' + m.wins + '</b>';
      return '<li class="lg-row' + (lead ? ' is-lead' : '') + (m.you ? ' is-you' : '') + '"><b class="lg-pos">' + (val === null ? '–' : pos) + '</b>' +
        '<span class="lg-who"><span class="lg-nick">' + esc(m.nick) + '</span><span class="lg-line">' + esc(lineFor(m, i, played, v)) + '</span></span>' + right + '</li>';
    }).join('');
  }
  function awards() {
    var ms = data.members, out = [];
    var eagle = ms.slice().sort(function (a, b) { return b.eagles - a.eagles; })[0];
    if (eagle && eagle.eagles > 0) out.push(['Sharpest eye', eagle.nick, eagle.eagles + (eagle.eagles === 1 ? ' eagle' : ' eagles') + ' this week. Suspicious.']);
    var active = ms.filter(function (m) { return m.played > 0; });
    if (active.length >= 3) {
      var spoon = active.slice().sort(function (a, b) { return b.week - a.week; })[0];
      out.push(['Wooden spoon', spoon.nick, fmt(spoon.week) + ' this week. A true commitment to the bit.', 1]);
    }
    var streak = ms.slice().sort(function (a, b) { return b.streak - a.streak; })[0];
    if (streak && streak.streak > 1) out.push(['Longest streak', streak.nick, streak.streak + ' days. Never missed a tee time.']);
    var p = data.pin || {};
    if (p.today) out.push(['Closest to the Pin today', p.today.nick, '£' + p.today.off.toFixed(2) + ' out. Tap-in territory.']);
    else if (p.yesterday) out.push(['Yesterday’s pin', p.yesterday.nick, '£' + p.yesterday.off.toFixed(2) + ' out. Frame it.']);
    if (!out.length) return '';
    return '<div class="lg-awards">' + out.map(function (a) {
      return '<div class="lg-award' + (a[3] ? ' is-spoon' : '') + '"><span>' + a[0] + '</span><b>' + esc(a[1]) + '</b><small>' + esc(a[2]) + '</small></div>';
    }).join('') + '</div>';
  }
  function table() {
    var me = data.members.filter(function (m) { return m.you; })[0];
    var waiting = data.members.filter(function (m) { return !m.today; });
    var lead = leader(data.members), n = data.members.length;
    var tag = lead && data.members.filter(function (m) { return m.today; }).length > 1 ? esc(lead.nick) + ' is leading today and has mentioned it at least twice.'
      : lead ? esc(lead.nick) + ' has posted a score. The pressure is on.' : 'Nobody’s teed off yet today. Be the first.';
    box.innerHTML = '<div class="lg-hero"><span class="pr-kicker">League · ' + n + (n === 1 ? ' golfer' : ' golfers') + ' · Par Price #' + data.n + '</span>' +
      '<h1>' + esc(data.name) + '</h1><p>' + tag + '</p></div>' +
      '<section class="lg-card"><div class="lg-card-head"><h2>' + (view === 'today' ? 'Today’s round' : view === 'week' ? 'This week' : 'All time') + '</h2>' +
      '<div class="lg-tabs" role="group" aria-label="Which table">' +
      [['today', 'Today'], ['week', 'Week'], ['all', 'All time']].map(function (t) { return '<button type="button" data-v="' + t[0] + '" aria-pressed="' + (view === t[0]) + '">' + t[1] + '</button>'; }).join('') +
      '</div></div><ol class="lg-rows">' + rowsHtml(view) + '</ol>' +
      '<div class="lg-actions">' + (me && !me.today ? '<a class="gp-af-btn" href="/play/par-price/?utm_source=league">Play today’s round</a>' : '<button type="button" class="gp-af-btn lg-share">Share today’s table</button>') +
      (waiting.length && me && me.today ? '<button type="button" class="lg-btn2 lg-nudge">Nudge ' + (waiting.length === 1 ? esc(waiting[0].nick) + ' (they’re holding us up)' : 'the stragglers') + '</button>' : '') +
      (n < 2 ? '<button type="button" class="lg-btn2 lg-invite">Invite your mates</button>' : '') + '</div>' +
      (view === 'week' ? '<p class="lg-note">Weekly champion crowned Monday morning. A missed round counts as ' + fmt(data.missed) + ': golf for “should’ve turned up”.</p>'
        : view === 'all' ? '<p class="lg-note">Wins are rounds where you had the best score in the league (ties share it).</p>' : '') +
      '</section>' + awards() +
      '<div class="lg-foot"><button type="button" class="lg-invite2">Invite more golfers to the league</button>' +
      '<span>Nicknames only. No emails, no sign-up. What happens in the league stays in the league. Quiet leagues tidy themselves away after 90 days. Play on the same phone and browser each time (not a private tab) so the table knows it’s you.</span>' +
      '<button type="button" class="lg-leave">Leave this league</button></div>';
    box.querySelectorAll('.lg-tabs button').forEach(function (b) { b.addEventListener('click', function () { view = b.getAttribute('data-v'); table(); }); });
    var s = box.querySelector('.lg-share'); if (s) s.addEventListener('click', shareTable);
    var nu = box.querySelector('.lg-nudge'); if (nu) nu.addEventListener('click', function () {
      share((waiting.length === 1 ? waiting[0].nick + ', you’re' : 'Some of you are') + ' holding up the four-ball. Today’s Par Price is waiting: ' + link());
      track('par_price_league_nudge');
    });
    box.querySelectorAll('.lg-invite, .lg-invite2').forEach(function (b) { b.addEventListener('click', function () {
      share('Join ' + data.name + ', our Par Price league: five golf prices a day, scored like a round. ' + link());
      track('par_price_league_invite');
    }); });
    box.querySelector('.lg-leave').addEventListener('click', function () {
      if (!window.confirm('Leave ' + data.name + '? Your scores stay out of its table from now on.')) return;
      api('/pp/league/leave', { pid: pid(), id: code }).then(function () { location.href = '/play/'; });
    });
  }

  /* ---------------------------------------------------------- share today's table (picture + text) */
  function shareTable() {
    var ms = sorted('today'), played = ms.filter(function (m) { return m.today; });
    var medals = ['🥇', '🥈', '🥉'];
    var text = '🏆 ' + data.name + ' · Par Price #' + data.n + '\n' +
      played.map(function (m, i) { return (medals[i] || (i + 1) + '.') + ' ' + m.nick + ' ' + fmt(m.today.total); }).join('\n') +
      ms.filter(function (m) { return !m.today; }).map(function (m) { return '\n⏳ ' + m.nick; }).join('') +
      '\n' + verdict(played) + '\n' + link();
    track('par_price_league_share');
    drawCard(ms, played).then(function (file) { share(text, file ? [file] : null); }, function () { share(text); });
  }
  function verdict(played) {
    if (played.length < 2) return 'Can anyone beat it?';
    return played[0].nick + ' leads. ' + played[played.length - 1].nick + ' is buying the first round.';
  }
  function drawCard(ms, played) {
    return new Promise(function (ok, no) {
      try {
        var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
        var g = c.getContext('2d');
        var COL = { E: '#1a6812', B: '#3fae29', P: '#b9c2bb', O: '#e0a245', D: '#9a4a00' };
        g.fillStyle = '#14211a'; g.fillRect(0, 0, 1200, 630);
        g.fillStyle = '#8fd77e'; g.font = '700 22px Inter, sans-serif'; g.fillText(('Par Price #' + data.n + ' · Today’s table').toUpperCase(), 64, 80);
        g.fillStyle = '#fff'; g.font = '800 50px Poppins, sans-serif'; g.fillText(fit(g, data.name, 680), 64, 142);
        ms.slice(0, 6).forEach(function (m, i) {
          var y = 200 + i * 62;
          if (i === 0 && m.today) { g.fillStyle = '#1f2c25'; round(g, 48, y - 8, 700, 56, 12); g.fill(); }
          g.fillStyle = m.today ? (i === 0 ? '#8fd77e' : '#c4d0c8') : '#7d8c82'; g.font = '800 28px Poppins, sans-serif'; g.fillText(m.today ? String(i + 1) : '–', 66, y + 30);
          g.fillStyle = '#fff'; g.font = '700 26px Inter, sans-serif'; g.fillText(fit(g, m.nick, 300), 112, y + 30);
          if (m.today) {
            m.today.grid.split('').forEach(function (ch, k) { g.fillStyle = COL[ch]; round(g, 440 + k * 30, y + 8, 22, 22, 5); g.fill(); });
            g.fillStyle = m.today.total < 0 ? '#8fd77e' : m.today.total > 0 ? '#f3c47e' : '#fff'; g.font = '800 30px Poppins, sans-serif';
            var s = fmt(m.today.total); g.fillText(s, 730 - g.measureText(s).width, y + 32);
          } else { g.fillStyle = '#9fb0a5'; g.font = '400 22px Inter, sans-serif'; g.fillText('still in the car park', 440, y + 30); }
        });
        g.fillStyle = '#1f2c25'; round(g, 790, 200, 346, 250, 20); g.fill();
        g.fillStyle = '#8fd77e'; g.font = '700 17px Inter, sans-serif'; g.fillText('VERDICT FROM THE CLUBHOUSE', 816, 240);
        g.fillStyle = '#fff'; g.font = '700 28px Poppins, sans-serif'; wrap(g, verdict(played), 816, 284, 296, 36);
        g.font = '700 30px Poppins, sans-serif'; g.fillStyle = '#fff'; g.fillText('Golf', 900, 82);
        var w1 = g.measureText('Golf').width; g.fillStyle = '#3fae29'; g.fillText('Price', 900 + w1, 82);
        g.fillStyle = '#fff'; g.fillText(' AI', 900 + w1 + g.measureText('Price').width, 82);
        g.fillStyle = '#3fae29'; round(g, 790, 482, 346, 64, 14); g.fill();
        g.fillStyle = '#fff'; g.font = '700 22px Inter, sans-serif'; g.fillText('Play: golfpriceai.com/play', 814, 522);
        c.toBlob(function (b) { b ? ok(new File([b], 'par-price-league.png', { type: 'image/png' })) : no(); }, 'image/png');
      } catch (e) { no(e); }
    });
  }
  function round(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, s, w) { s = String(s); while (g.measureText(s).width > w && s.length > 3) s = s.slice(0, -2) + '…'; return s; }
  function wrap(g, s, x, y, w, lh) {
    var words = s.split(' '), line = '';
    words.forEach(function (word) { var t = line ? line + ' ' + word : word; if (g.measureText(t).width > w && line) { g.fillText(line, x, y); y += lh; line = word; } else line = t; });
    if (line) g.fillText(line, x, y);
  }

  load();
})();
