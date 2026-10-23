/* GolfPrice AI: your Locker Room (/play/locker/). One slot per monthly Major:
   a champion bag (won your league), a bag tag (2nd or 3rd in a league of four or
   more), or your record. Results come from the alerts worker (/draft/locker), which
   settles each finished Major on that month's final prices. Pictures only: no
   prizes, no bags in the post. */
(function () {
  'use strict';
  var box = document.getElementById('lk');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function pts(n) { return (n < 0 ? '−' : '') + Math.abs(n) + (Math.abs(n) === 1 ? ' pt' : ' pts'); }
  function track(n) { if (window.gtag) window.gtag('event', n); }
  function add(s, k) { var y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + k; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + '-' + (m < 9 ? '0' : '') + (m + 1); }
  function mon(s) { return MON[+s.slice(5, 7) - 1]; }

  var pid = get('gpPid', ''), cur = new Date().toISOString().slice(0, 7);
  if (!/^[a-z0-9]{12,32}$/.test(pid)) pid = '';
  Promise.all([
    fetch('/data/draft/majors.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }),
    pid ? fetch(API + '/draft/locker?pid=' + pid).then(function (r) { return r.json(); }) : { ok: true, months: [], hidden: false }
  ]).then(function (r) { render(r[0], r[1]); })
    .catch(function () { box.innerHTML = '<p>The Locker Room door is stuck. Please refresh in a minute.</p>'; });

  function render(majors, d) {
    var months = (d && d.ok && d.months) || [], by = {};
    months.forEach(function (m) { by[m.season] = m; });
    var start = cur >= '2027-11' ? add(cur, -11) : '2026-11', slots = [];
    for (var i = 0; i < 12; i++) slots.push(add(start, i));
    var champs = months.filter(function (m) { return m.award === 'champion'; }).length;
    var tags = months.filter(function (m) { return m.award === 'tag'; }).length;
    var played = months.filter(function (m) { return m.award !== 'live'; }).length;
    var nick = months.length ? months[months.length - 1].nick : get('gpNick', '');
    var html;

    if (!months.length) {
      var first = cur < '2026-11' ? '2026-11' : cur, fm = majors[first.slice(5)];
      html = '<section class="lk-head"><span class="lk-kicker">Your Locker Room</span><h1>Empty. For now.</h1>' +
        '<p>Win your league in a Major and that month’s bag hangs here with your name engraved on it. Twelve of them is the Grand Slam.</p></section>' +
        '<div class="lk-hook"><img src="' + esc(fm.art) + '" alt="" width="90" height="140"><div><span class="lk-k2">' + (first === cur ? 'Live now · ' : 'First up · ') + FULL[+first.slice(5) - 1] + '</span>' +
        '<b>' + esc(fm.name) + '</b><span>This hook has your name on it. Probably.</span></div></div>' +
        '<div class="lk-mini">' + slots.filter(function (s) { return s > first; }).map(function (s) { return '<span>' + mon(s) + '</span>'; }).join('') + '</div>' +
        '<p class="lk-btns"><a class="gp-af-btn" href="/play/draft/">Draft your bag</a><a class="lk-btn2" href="/play/draft/?test=1">Try the practice range</a></p>';
    } else {
      html = '<section class="lk-head"><span class="lk-kicker">Your Locker Room</span><h1>' + (nick ? esc(nick) + '’s locker' : 'Your locker') + '</h1>' +
        '<div class="lk-stats"><div><b class="lk-gold">' + champs + '</b><span>champion bag' + (champs === 1 ? '' : 's') + '</span></div>' +
        '<div><b>' + tags + '</b><span>bag tag' + (tags === 1 ? '' : 's') + '</span></div><div><b>' + played + '</b><span>Major' + (played === 1 ? '' : 's') + ' played</span></div></div>' +
        '<div class="lk-slam"><span><span>The Grand Slam</span><span>' + Math.min(champs, 12) + ' of 12 champion bags</span></span><i><em style="width:' + (Math.min(champs, 12) / 12 * 100).toFixed(1) + '%"></em></i></div></section>' +
        '<div class="lk-grid">' + months.map(function (m, i) { return card(m, majors[m.season.slice(5)], i); }).join('') + '</div>' +
        '<div class="lk-mini">' + slots.filter(function (s) { return !by[s] && s > months[months.length - 1].season; }).map(function (s) {
          return s === cur ? '<a href="/play/draft/">' + mon(s) + ': draft now</a>' : '<span>' + mon(s) + '</span>';
        }).join('') + '</div>';
    }
    html += '<section class="lk-prefs"><label><input type="checkbox" id="lk-show"' + (d && d.hidden ? '' : ' checked') + '> Show my nickname on the national leaderboard and in the Hall of Fame</label>' +
      '<span>Untick to keep it to your leagues: your mates still see you, the rest of the country doesn’t.</span></section>' +
      '<p class="lk-small">Pictures only, no bags in the post. Bragging rights, fully engraved. Playing on another device? <a href="/play/#move">Bring your locker with you</a>.</p>';
    box.innerHTML = html;

    box.querySelectorAll('[data-card]').forEach(function (b) {
      b.addEventListener('click', function () {
        var m = months[+b.getAttribute('data-card')], mj = majors[m.season.slice(5)];
        if (window.gpChampion) window.gpChampion.share({ league: m.best ? m.best.league : '', nick: m.nick, you: true, pts: m.pts, of: m.best ? m.best.of : 1, season: m.season, major: mj, last: '', best: null }, b);
        track('locker_champion_card');
      });
    });
    var chk = document.getElementById('lk-show');
    chk.disabled = !pid;
    chk.addEventListener('change', function () {
      chk.disabled = true;
      fetch(API + '/pp/prefs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: pid, hidden: !chk.checked }) })
        .then(function (r) { return r.json(); }).then(function (r) { chk.disabled = false; if (!r.ok) chk.checked = !chk.checked; track(chk.checked ? 'national_show' : 'national_hide'); })
        .catch(function () { chk.disabled = false; chk.checked = !chk.checked; });
    });
  }

  function card(m, mj, i) {
    var b = m.best, kick, line, extra = '', cls = 'lk-slot';
    if (m.award === 'champion') {
      cls += ' is-champ'; kick = 'Champion · ' + mon(m.season);
      line = (b ? '1st in ' + esc(b.league) + ' · ' : '') + pts(m.pts);
      extra = '<span class="lk-tag">' + esc(m.nick) + '</span><button type="button" class="lk-card" data-card="' + i + '">Champion’s card</button>';
    } else if (m.award === 'tag') {
      cls += ' is-tag'; kick = 'Bag tag · ' + mon(m.season);
      line = ord(b.rank) + ' in ' + esc(b.league) + ' · ' + pts(m.pts);
      extra = '<span class="lk-tag lk-tag2">' + ord(b.rank) + '</span>';
    } else if (m.award === 'live') {
      cls += ' is-live'; kick = 'Live now · ' + mon(m.season);
      line = b && b.of > 1 ? ord(b.rank) + ' of ' + b.of + ' in ' + esc(b.league) + ' right now' : ord(m.nat.rank) + ' of ' + m.nat.of + ' nationally right now';
      extra = '<a href="/play/draft/">See your bag</a>';
    } else {
      cls += ' is-played'; kick = 'Played · ' + mon(m.season);
      line = (b && b.of > 1 ? ord(b.rank) + ' of ' + b.of + ' in ' + esc(b.league) : ord(m.nat.rank) + ' of ' + m.nat.of + ' nationally') + ' · ' + pts(m.pts);
    }
    return '<div class="' + cls + '" style="--mj:' + esc(mj.colour) + '"><span class="lk-k">' + kick + '</span>' +
      '<img src="' + esc(mj.art) + '" alt="' + esc(mj.name) + ' bag" width="96" height="150"><b>' + esc(mj.name) + '</b><span class="lk-line">' + line + '</span>' + extra + '</div>';
  }
})();
