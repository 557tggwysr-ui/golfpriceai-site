/* Quick rounds (/play/scorecard/): a live scorecard for friends, no society needed.
   Pick "Quick round with mates" or "Society day"; for a quick round: the course
   (the card fills itself in when another golfer has typed it), nicknames and
   handicaps, the game (stableford, better-ball pairs or skins), go. The four is
   remembered on this phone (gpCrews) for "Play again". Scoring itself is js/live.js. */
(function () {
  'use strict';
  var box = document.getElementById('qr');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16); crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join(''); put('gpPid', p);
    }
    return p;
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
  }
  function share(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function ago(iso) { var d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? d + ' days ago' : Math.round(d / 7) + ' weeks ago'; }
  function first(n) { return String(n).split(/\s+/)[0]; }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  var COURSES = null;
  function courses() { if (!COURSES) COURSES = fetch('/data/courses/uk.json').then(function (r) { return r.json(); }).then(function (d) { return d.courses || []; }).catch(function () { return []; }); return COURSES; }

  var st = null;
  function fresh(crew) {
    st = { course: '', cname: '', pars: [], si: [], known: false, fmt: 'stb', allowance: 95, title: '', players: [] };
    if (crew) {
      st.course = crew.course || ''; st.cname = crew.cname || ''; st.fmt = crew.fmt || 'stb';
      st.players = crew.names.map(function (p, i) { return { nick: p.nick, ch: p.ch, team: p.team || (i < 2 ? 1 : 2), me: i === (crew.me || 0) }; });
    }
    while (st.players.length < 2) st.players.push({ nick: '', ch: '', team: st.players.length < 2 ? 1 : 2, me: !st.players.length });
  }
  function crews() { return (get('gpCrews', []) || []).filter(function (c) { return c && Array.isArray(c.names); }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }); }

  /* ---- 1. Quick round or society day */
  function choose() {
    var c = crews()[0];
    box.innerHTML = '<div class="qr">' +
      '<button type="button" class="qr-choice is-main" id="qr-go" style="text-align:left;cursor:pointer;font:inherit"><span class="soc-kick" style="color:#2f8a1f">MOST POPULAR</span><b class="qr-t">Quick round with mates</b>' +
      '<span class="qr-d">Up to eight golfers. Course, nicknames, handicaps, go. Stableford, better-ball pairs or skins.</span>' +
      '<span class="qr-tags"><span>No sign-up</span><span>30 seconds</span><span>Remembers your four</span></span><span class="soc-btn" style="text-align:center;margin-top:4px">Start a quick round</span></button>' +
      '<a class="qr-choice" href="/societies/hq/"><b class="qr-t">Society day</b><span class="qr-d">Groups and tee times, a marker per group, then the match report, Order of Merit and League points. Runs in Society HQ.</span><span class="soc-btn2" style="text-align:center;margin-top:4px">Open Society HQ</span></a>' +
      (c ? '<button type="button" class="qr-again" id="qr-again" style="text-align:left;border:0;cursor:pointer;font:inherit"><small>PLAYED BEFORE?</small><b>Play again with ' + esc(list(c.names.map(function (p) { return first(p.nick); }))) + '</b><span>Last time: ' + esc(c.cname || 'your course') + ', ' + ago(c.at) + '. One tap and you’re on the 1st tee.</span></button>' : '') +
      '<p class="soc-small" style="text-align:center">Nicknames and points only. Works with no signal. Still arguing about which Saturday? <a href="/play/poll/?new=1">Start a quick poll</a>.</p></div>';
    document.getElementById('qr-go').onclick = function () { fresh(); setup(); track('qr_choose', { kind: 'quick' }); };
    var ag = document.getElementById('qr-again'); if (ag) ag.onclick = function () { fresh(c); loadCard(setup); track('qr_choose', { kind: 'again' }); };
  }

  /* ---- 2. The set-up */
  function cardGrid() {
    var h = '';
    [0, 9].forEach(function (off) {
      h += '<div class="lvs-grid" role="group" aria-label="' + (off ? 'Back nine' : 'Front nine') + '"><span class="lvs-lab">Hole</span>';
      for (var i = 0; i < 9; i++) h += '<b>' + (off + i + 1) + '</b>';
      h += '<span class="lvs-lab">Par</span>';
      for (i = 0; i < 9; i++) h += '<select data-par="' + (off + i) + '" aria-label="Hole ' + (off + i + 1) + ' par">' + [3, 4, 5, 6].map(function (p) { return '<option' + ((st.pars[off + i] || 4) === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>';
      h += '<span class="lvs-lab">SI</span>';
      for (i = 0; i < 9; i++) h += '<input data-si="' + (off + i) + '" inputmode="numeric" maxlength="2" aria-label="Hole ' + (off + i + 1) + ' stroke index" value="' + esc(st.si[off + i] || '') + '">';
      h += '</div>';
    });
    return h;
  }
  function loadCard(then) {
    if (!st.course) { st.known = false; return then(); }
    api('/lv/course?c=' + encodeURIComponent(st.course)).then(function (r) {
      if (r.ok && r.card) { st.pars = r.card.pars; st.si = r.card.si; st.known = true; } else { st.known = false; st.pars = []; st.si = []; }
      then();
    }).catch(function () { st.known = false; then(); });
  }
  function read() {
    box.querySelectorAll('[data-par]').forEach(function (s) { st.pars[+s.getAttribute('data-par')] = Number(s.value); });
    box.querySelectorAll('[data-si]').forEach(function (s) { st.si[+s.getAttribute('data-si')] = Number(s.value) || 0; });
    box.querySelectorAll('[data-nick]').forEach(function (s) { st.players[+s.getAttribute('data-nick')].nick = s.value; });
    box.querySelectorAll('[data-ch]').forEach(function (s) { st.players[+s.getAttribute('data-ch')].ch = s.value.replace('−', '-').replace('+', '-'); });
    box.querySelectorAll('[data-team]').forEach(function (s) { st.players[+s.getAttribute('data-team')].team = Number(s.value); });
    var me = box.querySelector('input[name="qr-me"]:checked'); st.players.forEach(function (p, i) { p.me = !!me && Number(me.value) === i; });
    var al = box.querySelector('#qr-al'); if (al) st.allowance = Number(al.value);
    var ti = box.querySelector('#qr-title'); if (ti) st.title = ti.value;
    var q = box.querySelector('#qr-cq'); if (q && !st.course) st.cname = q.value.trim();
  }
  function problem() {
    var named = st.players.filter(function (p) { return p.nick.trim(); });
    if (named.length < 2) return 'Add at least two golfers.';
    var noH = named.filter(function (p) { return p.ch === '' || isNaN(Number(p.ch)); });
    if (noH.length) return 'Add a handicap for ' + list(noH.map(function (p) { return p.nick.trim(); })) + ' (0 if they haven’t got one yet: or a guess!).';
    if (st.fmt === 'bb') {
      var sizes = {}; named.forEach(function (p) { sizes[p.team] = (sizes[p.team] || 0) + 1; });
      if (Object.keys(sizes).length < 2 || Object.keys(sizes).some(function (k) { return sizes[k] !== 2; })) return 'Better-ball needs pairs: two golfers on each side.';
    }
    if (!st.known) {
      for (var i = 0; i < 18; i++) if (!st.pars[i]) return 'Add a par for every hole.';
      var seen = {};
      for (i = 0; i < 18; i++) { var v = st.si[i]; if (!(v >= 1 && v <= 18)) return 'Hole ' + (i + 1) + ' needs a stroke index from 1 to 18 (it’s on the club’s scorecard).'; if (seen[v]) return 'Stroke index ' + v + ' is on two holes (' + seen[v] + ' and ' + (i + 1) + '). Each one is used once.'; seen[v] = i + 1; }
    }
    return '';
  }
  function setup(msg) {
    var bb = st.fmt === 'bb';
    var h = '<div class="qr"><div style="display:flex;justify-content:space-between;align-items:center"><span class="soc-kick" style="color:#2f8a1f">QUICK ROUND · NO SIGN-UP</span><button type="button" class="soc-link" id="qr-back">Back</button></div>';
    h += '<section class="qr-sec"><label>Where are you playing?<input id="qr-cq" autocomplete="off" placeholder="Start typing a course or town" value="' + esc(st.cname) + '"></label><div class="hq-cpick" hidden id="qr-pick"></div>';
    if (st.known) h += '<span class="qr-ok">✓ Course card on file (par and stroke index for all 18). <button type="button" class="soc-link" id="qr-check">Check it</button></span>';
    if (!st.known || st.check) h += '<p class="soc-small" style="margin:0">' + (st.known ? 'Change anything that doesn’t match your tees.' : st.course ? 'New course to us. Copy the par and stroke index (SI) from the club’s scorecard once, and every golfer after you gets them.' : 'Pick your course and the card usually fills itself in. If not, copy the par and stroke index (SI) from the scorecard.') + '</p>' + cardGrid();
    h += '</section>';
    h += '<section class="qr-sec"><b>Who’s playing?</b>' + st.players.map(function (p, i) {
      return '<div class="qr-pl' + (bb ? ' has-team' : '') + '"><label>Nickname<input data-nick="' + i + '" maxlength="20" autocomplete="off" value="' + esc(p.nick) + '" placeholder="' + (i === 0 ? 'You' : 'e.g. Big Dave') + '"></label>' +
        (bb ? '<label>Pair<select data-team="' + i + '"><option value="1"' + (p.team === 1 ? ' selected' : '') + '>A</option><option value="2"' + (p.team === 2 ? ' selected' : '') + '>B</option><option value="3"' + (p.team === 3 ? ' selected' : '') + '>C</option><option value="4"' + (p.team === 4 ? ' selected' : '') + '>D</option></select></label>' : '') +
        '<label>Handicap<input data-ch="' + i + '" inputmode="numeric" maxlength="3" value="' + esc(p.ch) + '" style="text-align:center"></label>' +
        '<button type="button" class="qr-x" data-rm="' + i + '" aria-label="Remove ' + esc(p.nick || 'golfer') + '"' + (st.players.length <= 2 ? ' disabled' : '') + '>×</button>' +
        '<label class="qr-me" style="grid-column:1/-1;flex-direction:row"><input type="radio" name="qr-me" value="' + i + '"' + (p.me ? ' checked' : '') + '> This is me (for my My Game stats)</label></div>';
    }).join('') +
      (st.players.length < 8 ? '<button type="button" class="qr-add" id="qr-add">+ Add a golfer</button>' : '') +
      '<span class="soc-small">Handicap = course handicap for your tees (plus handicaps with a minus, e.g. −2). ' + (st.players.length > 4 ? 'More than four? We split you into four-balls, each with its own scorecard.' : '') + '</span></section>';
    h += '<section class="qr-sec"><b>The game</b><div class="qr-fmts">' +
      [['stb', 'Stableford', 'Everyone for themselves'], ['bb', 'Better-ball pairs', '2 v 2, best score counts'], ['skins', 'Skins', 'Win a hole outright, take the skin']].map(function (f) {
        return '<button type="button" data-fmt="' + f[0] + '" aria-pressed="' + (st.fmt === f[0]) + '"><b>' + f[1] + '</b><small>' + f[2] + '</small></button>';
      }).join('') + '</div>' + (bb ? '<span class="soc-small">Individual stableford is on the leaderboard too.</span>' : '') +
      '<details><summary class="soc-small" style="cursor:pointer">More options</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px"><label>Handicap allowance<select id="qr-al">' +
      [[95, '95% (recommended)'], [100, '100%'], [90, '90%'], [85, '85%']].map(function (a) { return '<option value="' + a[0] + '"' + (st.allowance === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') +
      '</select></label><label>Name the round (optional)<input id="qr-title" maxlength="50" placeholder="e.g. The Saturday Grudge Match" value="' + esc(st.title) + '"></label></div></details></section>';
    h += '<p class="qr-msg" role="status">' + esc(msg || '') + '</p><button type="button" class="soc-btn" id="qr-start" style="width:100%;min-height:52px;font-size:16px">Start the round</button>' +
      '<p class="soc-small" style="text-align:center;margin:0">Then send one link to the four-ball: anyone in it can score.</p></div>';
    box.innerHTML = h;
    wire();
  }
  function wire() {
    document.getElementById('qr-back').onclick = choose;
    var ck = document.getElementById('qr-check'); if (ck) ck.onclick = function () { read(); st.check = true; setup(); };
    var q = document.getElementById('qr-cq'), pick = document.getElementById('qr-pick'), timer;
    q.addEventListener('input', function () {
      clearTimeout(timer); var t = q.value.trim().toLowerCase();
      if (st.course) { st.course = ''; st.known = false; }
      if (t.length < 3) { pick.hidden = true; return; }
      timer = setTimeout(function () {
        courses().then(function (lst) {
          var hits = lst.filter(function (c) { return (c.n + ' ' + (c.t || '')).toLowerCase().indexOf(t) >= 0; }).slice(0, 8);
          pick.innerHTML = hits.length ? hits.map(function (c, i) { return '<button type="button" data-i="' + i + '"><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></button>'; }).join('') : '<p class="soc-small">No match yet. Try the town instead.</p>';
          pick.hidden = false;
          pick.querySelectorAll('button').forEach(function (b) {
            b.onclick = function () { read(); var c = hits[+b.getAttribute('data-i')]; st.course = c.id; st.cname = c.n; st.check = false; loadCard(setup); };
          });
        });
      }, 200);
    });
    box.querySelectorAll('[data-fmt]').forEach(function (b) { b.onclick = function () { read(); st.fmt = b.getAttribute('data-fmt'); if (st.fmt === 'bb') st.players.forEach(function (p, i) { if (!p.team) p.team = i % 4 < 2 ? 1 : 2; }); setup(); }; });
    box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { read(); var i = +b.getAttribute('data-rm'), wasMe = st.players[i].me; st.players.splice(i, 1); if (wasMe && st.players[0]) st.players[0].me = true; setup(); }; });
    var add = document.getElementById('qr-add'); if (add) add.onclick = function () { read(); var n = st.players.length; st.players.push({ nick: '', ch: '', team: Math.floor(n / 2) + 1 > 4 ? 1 : (n % 4 < 2 ? 1 : 2) + (n >= 4 ? 2 : 0), me: false }); setup(); box.querySelector('[data-nick="' + n + '"]').focus(); };
    document.getElementById('qr-start').onclick = start;
  }
  function start() {
    read();
    var bad = problem(), btn = document.getElementById('qr-start');
    if (bad) { box.querySelector('.qr-msg').textContent = bad; return; }
    var named = st.players.filter(function (p) { return p.nick.trim(); });
    // Four-balls: in order, by fours (better-ball keeps pairs together).
    var ordered = st.fmt === 'bb' ? named.slice().sort(function (a, b) { return a.team - b.team; }) : named;
    var body = { pid: pid(), course: st.course, cname: st.cname, pars: st.pars, si: st.si, fmt: st.fmt, allowance: st.allowance, title: st.title,
      players: ordered.map(function (p, i) { return { nick: p.nick.trim(), ch: Number(p.ch), team: p.team, grp: Math.floor(i / 4) + 1, me: p.me }; }) };
    btn.disabled = true; btn.textContent = 'Teeing it up…';
    api('/lv/quick', body).then(function (r) {
      if (!r.ok) { btn.disabled = false; btn.textContent = 'Start the round'; box.querySelector('.qr-msg').textContent = r.error; return; }
      track('qr_start', { fmt: st.fmt, golfers: named.length });
      remember(named, r.code);
      done(r);
    }).catch(function () { btn.disabled = false; btn.textContent = 'Start the round'; box.querySelector('.qr-msg').textContent = 'No signal just now. Try again in a moment.'; });
  }
  function remember(named, code) {
    var key = named.map(function (p) { return p.nick.trim().toLowerCase(); }).sort().join('|');
    var all = crews(), c = all.filter(function (x) { return x.key === key; })[0];
    if (!c) { c = { key: key, n: 0, codes: [] }; all.push(c); }
    c.names = named.map(function (p) { return { nick: p.nick.trim(), ch: Number(p.ch), team: p.team }; });
    c.me = Math.max(0, named.findIndex ? named.findIndex(function (p) { return p.me; }) : 0);
    c.course = st.course; c.cname = st.cname; c.fmt = st.fmt; c.at = new Date().toISOString(); c.n = (c.n || 0) + 1;
    c.codes = (c.codes || []).concat([code]).slice(-10);
    put('gpCrews', all.slice(0, 12));
  }
  function done(r) {
    var board = SITE + '/play/scorecard/live/?c=' + r.code;
    var h = '<div class="qr"><section class="qr-done"><span class="soc-kick" style="color:#8fd97c">YOU’RE ON THE 1ST TEE</span><b>' + esc(st.title || (st.cname ? 'Quick round at ' + st.cname : 'Quick round')) + '</b>' +
      '<p>One phone keeps the score (or share it: anyone in the four-ball can score). Everyone else can follow it live.</p>' +
      r.groups.map(function (g) { return '<a class="soc-btn" style="text-align:center" href="/play/scorecard/card/?t=' + esc(g.token) + '">' + (r.groups.length > 1 ? 'Open Group ' + g.grp + '’s scorecard' : 'Open the scorecard') + '</a>'; }).join('') +
      '<button type="button" class="soc-btn2" id="qr-send">Send the links to the group</button>' +
      '<a class="soc-btn2" style="text-align:center" href="' + esc(board) + '">See the live leaderboard</a></section>' +
      '<p class="soc-small" style="text-align:center">Your four is saved on this phone for next time.</p></div>';
    box.innerHTML = h;
    document.getElementById('qr-send').onclick = function () {
      track('qr_send');
      var g = r.groups.map(function (x) { return (r.groups.length > 1 ? 'Group ' + x.grp + ' (' + list(x.names) + ') scorecard: ' : 'Scorecard (anyone can score): ') + SITE + '/play/scorecard/card/?t=' + x.token; }).join('\n');
      var fmt = { stb: 'stableford', bb: 'better-ball', skins: 'skins' }[st.fmt];
      share('Right then, ' + fmt + (st.cname ? ' at ' + st.cname : '') + '. ' + g + '\nLive leaderboard: ' + board + '\nTap your name on it to keep the round in your stats.');
    };
  }

  var again = (location.search.match(/[?&]again=([a-z0-9]{8})/i) || [])[1];
  var c0 = again ? crews().filter(function (c) { return (c.codes || []).indexOf(again.toLowerCase()) >= 0; })[0] : null;
  if (c0) { fresh(c0); loadCard(setup); } else if (/[?&]new=1/.test(location.search)) { fresh(); setup(); } else choose();
})();
