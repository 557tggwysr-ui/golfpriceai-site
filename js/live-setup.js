/* Live scoring set-up, opened from a society day in Society HQ (organiser only).
   1. the course card (par and stroke index), 2. handicaps and the allowance,
   3. the groups, 4. the links: a scorecard per group and the leaderboard.
   window.gpLiveSetup({ e: event, S: society, pid: fn, api: fn, done: fn }) */
(function () {
  'use strict';
  var SITE = 'https://golfpriceai.com';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function share(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function addMin(t, m) { if (!/^\d{2}:\d{2}$/.test(t || '')) return ''; var x = Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + m; return ('0' + Math.floor(x / 60) % 24).slice(-2) + ':' + ('0' + x % 60).slice(-2); }
  var COURSES = null;
  function courses() { if (!COURSES) COURSES = fetch('/data/courses/uk.json').then(function (r) { return r.json(); }).then(function (d) { return d.courses || []; }).catch(function () { return []; }); return COURSES; }

  window.gpLiveSetup = function (o) {
    var e = o.e, S = o.S, api = o.api, pid = o.pid;
    var wrap = document.createElement('div'); wrap.className = 'lvs-wrap'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', 'Live scoring set-up');
    wrap.innerHTML = '<div class="lvs"><p class="soc-loading">Opening live scoring…</p></div>';
    document.body.appendChild(wrap); document.body.style.overflow = 'hidden';
    var box = wrap.firstChild;
    function close() { wrap.remove(); document.body.style.overflow = ''; if (o.done) o.done(); }
    var st = { course: '', cname: '', pars: [], si: [], allowance: 95, players: {}, groups: {}, tees: {}, markers: {}, code: '', links: null };
    api('/lv/setup?e=' + e.id + '&pid=' + pid()).then(function (d) {
      if (!d.ok) { box.innerHTML = '<p>' + esc(d.error) + '</p><button type="button" class="soc-btn2 lvs-x">Close</button>'; box.querySelector('.lvs-x').onclick = close; return; }
      st.members = d.members; st.ins = d.ins;
      if (d.round) {
        var r = d.round; st.course = r.course; st.cname = r.cname; st.pars = r.pars; st.si = r.si; st.allowance = r.allowance; st.code = r.code; st.status = r.status;
        r.players.forEach(function (p) { st.players[p.mkey] = { on: true, ch: p.ch, grp: p.grp }; });
        r.groups.forEach(function (g) { st.tees[g.grp] = g.tee; st.markers[g.grp] = g.marker; });
        st.links = r.groups;
      } else {
        st.course = S.course || ''; st.cname = S.cname || e.venue || '';
        d.members.forEach(function (m) { if (d.ins.indexOf(m.mkey) >= 0) st.players[m.mkey] = { on: true, ch: m.ch == null ? '' : m.ch, grp: 0 }; });
        autoGroups(false);
        if (st.course) return loadCard(st.course, paint);
      }
      paint();
    }).catch(function () { box.innerHTML = '<p>We couldn’t reach the clubhouse. Please try again.</p><button type="button" class="soc-btn2 lvs-x">Close</button>'; box.querySelector('.lvs-x').onclick = close; });

    function nick(m) { var x = st.members.filter(function (y) { return y.mkey === m; })[0]; return x ? x.nick : ''; }
    function on() { return st.members.filter(function (m) { return st.players[m.mkey] && st.players[m.mkey].on; }).map(function (m) { return m.mkey; }); }
    function autoGroups(shuffle) {
      var l = on(); if (shuffle) l.sort(function () { return Math.random() - 0.5; });
      var n = Math.ceil(l.length / 4) || 1, size = Math.ceil(l.length / n);
      l.forEach(function (m, i) { st.players[m].grp = Math.floor(i / size) + 1; });
      st.markers = {};
      for (var g = 1; g <= n; g++) if (!st.tees[g]) st.tees[g] = addMin(e.tee, (g - 1) * 8);
    }
    function loadCard(c, then) {
      api('/lv/course?c=' + encodeURIComponent(c)).then(function (r) {
        if (r.ok && r.card) { st.pars = r.card.pars; st.si = r.card.si; st.known = true; } else st.known = false;
        then();
      }).catch(then);
    }
    function cardHtml() {
      var h = '';
      [0, 9].forEach(function (off) {
        h += '<div class="lvs-grid" role="group" aria-label="' + (off ? 'Back nine' : 'Front nine') + '"><span class="lvs-lab">Hole</span>';
        for (var i = 0; i < 9; i++) h += '<b>' + (off + i + 1) + '</b>';
        h += '<span class="lvs-lab">Par</span>';
        for (i = 0; i < 9; i++) h += '<select data-par="' + (off + i) + '" aria-label="Hole ' + (off + i + 1) + ' par">' + [3, 4, 5, 6].map(function (p) { return '<option' + (st.pars[off + i] === p ? ' selected' : '') + '>' + p + '</option>'; }).join('') + '</select>';
        h += '<span class="lvs-lab">SI</span>';
        for (i = 0; i < 9; i++) h += '<input data-si="' + (off + i) + '" inputmode="numeric" maxlength="2" aria-label="Hole ' + (off + i + 1) + ' stroke index" value="' + esc(st.si[off + i] || '') + '">';
        h += '</div>';
      });
      return h;
    }
    function readCard() {
      box.querySelectorAll('[data-par]').forEach(function (s) { st.pars[+s.getAttribute('data-par')] = Number(s.value); });
      box.querySelectorAll('[data-si]').forEach(function (s) { st.si[+s.getAttribute('data-si')] = Number(s.value) || 0; });
      box.querySelectorAll('[data-ch]').forEach(function (s) { var m = s.getAttribute('data-ch'); if (st.players[m]) st.players[m].ch = s.value.trim(); });
      box.querySelectorAll('[data-grp]').forEach(function (s) { var m = s.getAttribute('data-grp'); if (st.players[m]) st.players[m].grp = Number(s.value); });
      box.querySelectorAll('[data-tee]').forEach(function (s) { st.tees[s.getAttribute('data-tee')] = s.value; });
      box.querySelectorAll('[data-mk]').forEach(function (s) { st.markers[s.getAttribute('data-mk')] = s.value; });
      var al = box.querySelector('#lvs-al'); if (al) st.allowance = Number(al.value);
    }
    function cardProblem() {
      for (var i = 0; i < 18; i++) if (!st.pars[i]) return 'Add a par for every hole.';
      var seen = {};
      for (i = 0; i < 18; i++) { var v = st.si[i]; if (!(v >= 1 && v <= 18)) return 'Hole ' + (i + 1) + ' needs a stroke index from 1 to 18.'; if (seen[v]) return 'Stroke index ' + v + ' is on two holes (' + seen[v] + ' and ' + (i + 1) + '). Each one is used once.'; seen[v] = i + 1; }
      return '';
    }
    function groupNums() { var g = {}; on().forEach(function (m) { if (st.players[m].grp) g[st.players[m].grp] = 1; }); return Object.keys(g).map(Number).sort(function (a, b) { return a - b; }); }
    function paint() {
      if (!st.pars.length) { for (var i = 0; i < 18; i++) { st.pars.push(4); st.si.push(''); } }
      var nOn = on().length, gs = groupNums(), maxG = Math.max(4, Math.ceil(nOn / 2));
      var h = '<div class="lvs-top"><span class="soc-kick">SOCIETY HQ · LIVE SCORING</span><button type="button" class="lvs-close" aria-label="Close">×</button></div>' +
        '<h2>' + esc(e.title) + '</h2>';
      if (st.status === 'final') h += '<p class="hq-note is-good">This round is finished and published. <a href="/societies/live/?c=' + esc(st.code) + '">See the final leaderboard</a>.</p>';
      h += '<section class="lvs-sec"><b class="lvs-h">1. The course card</b>' +
        '<label class="lvs-full">Course<input id="lvs-cq" autocomplete="off" placeholder="Start typing a course or town" value="' + esc(st.cname) + '"></label><div class="hq-cpick lvs-pick" hidden></div>' +
        '<p class="soc-small">' + (st.code ? 'Your course card for the day. Change anything that doesn’t match your tees.' : st.known ? esc(st.cname) + ' is already on file, from another society. Check it matches your tees.' : 'Copy the par and stroke index (SI) from the club’s scorecard. Type them in once and every society after you gets them.') + '</p>' +
        cardHtml() + '</section>';
      h += '<section class="lvs-sec"><b class="lvs-h">2. Handicaps and allowance</b>' +
        '<label class="lvs-full">Handicap allowance<select id="lvs-al">' + [[95, '95% (recommended for individual stableford)'], [100, '100%'], [90, '90%'], [85, '85%']].map(function (a) { return '<option value="' + a[0] + '"' + (st.allowance === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select></label>' +
        '<p class="soc-small">Type each golfer’s <b>course handicap</b> for these tees (from their handicap app). We work out the playing handicap with the allowance, and remember it for next time. Untick anyone not playing.</p><div class="lvs-players">' +
        st.members.map(function (m) {
          var p = st.players[m.mkey] || { on: false, ch: m.ch == null ? '' : m.ch, grp: 0 };
          return '<div class="lvs-pl' + (p.on ? '' : ' is-off') + '"><label class="lvs-on"><input type="checkbox" data-on="' + esc(m.mkey) + '"' + (p.on ? ' checked' : '') + '> ' + esc(m.nick) + '</label>' +
            (p.on ? '<input data-ch="' + esc(m.mkey) + '" inputmode="numeric" maxlength="3" placeholder="CH" aria-label="' + esc(m.nick) + ' course handicap" value="' + esc(p.ch) + '">' +
              '<select data-grp="' + esc(m.mkey) + '" aria-label="' + esc(m.nick) + ' group">' + Array.apply(null, { length: maxG }).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (p.grp === i + 1 ? ' selected' : '') + '>Group ' + (i + 1) + '</option>'; }).join('') + '</select>' : '') + '</div>';
        }).join('') + '</div><p class="soc-small">Plus handicaps: type them with a minus, e.g. −2.</p></section>';
      h += '<section class="lvs-sec"><b class="lvs-h">3. The groups</b>' + gs.map(function (g) {
        var who = on().filter(function (m) { return st.players[m].grp === g; });
        return '<div class="lvs-grp"><div><b>Group ' + g + '</b><span>' + who.map(function (m) { return esc(nick(m)); }).join(', ') + '</span></div>' +
          '<label>Tee time<input type="time" data-tee="' + g + '" value="' + esc(st.tees[g] || '') + '"></label>' +
          '<label>Marker<select data-mk="' + g + '">' + who.map(function (m) { return '<option value="' + esc(m) + '"' + (st.markers[g] === m ? ' selected' : '') + '>' + esc(nick(m)) + '</option>'; }).join('') + '</select></label></div>';
      }).join('') + '<button type="button" class="soc-btn2 lvs-shuffle">Shuffle the groups</button><p class="soc-small">The marker keeps the score for the group on their phone.</p></section>';
      h += '<p class="soc-msg" role="status"></p>';
      if (st.status !== 'final') h += '<button type="button" class="soc-btn lvs-save">' + (st.code ? 'Save the changes' : 'Make the scorecards') + '</button>';
      if (st.links) h += linksHtml();
      h += '<button type="button" class="soc-btn2 lvs-close2">Close</button>';
      box.innerHTML = h;
      wire();
    }
    function linksHtml() {
      var board = SITE + '/societies/live/?c=' + st.code;
      return '<section class="lvs-sec lvs-dark"><b class="lvs-h">4. Send the scorecards</b><p>Each marker gets their group’s scorecard link. Everyone else follows the live leaderboard.</p>' +
        '<button type="button" class="soc-btn lvs-send-all">Send tee times and links to the group</button>' +
        st.links.map(function (g) { return '<button type="button" class="soc-btn2 lvs-send" data-g="' + g.grp + '">Send Group ' + g.grp + '’s scorecard to ' + esc(nick(g.marker)) + '</button>'; }).join('') +
        '<a class="soc-btn2" href="' + esc(board) + '" target="_blank" rel="noopener">Open the live leaderboard</a>' +
        '<p class="soc-small" style="color:#c4d0c8">On the day, open the leaderboard to send updates to the group, and to publish the results when the last card’s in.</p></section>';
    }
    function wire() {
      box.querySelector('.lvs-close').onclick = close; box.querySelector('.lvs-close2').onclick = close;
      var q = box.querySelector('#lvs-cq'), pick = box.querySelector('.lvs-pick'), timer;
      q.addEventListener('input', function () {
        clearTimeout(timer); var t = q.value.trim().toLowerCase();
        if (t.length < 3) { pick.hidden = true; return; }
        timer = setTimeout(function () {
          courses().then(function (list) {
            var hits = list.filter(function (c) { return (c.n + ' ' + (c.t || '')).toLowerCase().indexOf(t) >= 0; }).slice(0, 8);
            pick.innerHTML = hits.length ? hits.map(function (c, i) { return '<button type="button" data-i="' + i + '"><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></button>'; }).join('') : '<p class="soc-small">No match yet. Try the town instead.</p>';
            pick.hidden = false;
            pick.querySelectorAll('button').forEach(function (b) {
              b.onclick = function () { readCard(); var c = hits[+b.getAttribute('data-i')]; st.course = c.id; st.cname = c.n; loadCard(c.id, paint); };
            });
          });
        }, 200);
      });
      q.addEventListener('change', function () { if (!pick.hidden) return; st.cname = q.value.trim(); });
      box.querySelectorAll('[data-on]').forEach(function (c) {
        c.onchange = function () { readCard(); var m = c.getAttribute('data-on'), mem = st.members.filter(function (x) { return x.mkey === m; })[0]; st.players[m] = st.players[m] || { ch: mem && mem.ch != null ? mem.ch : '', grp: 0 }; st.players[m].on = c.checked; if (c.checked && !st.players[m].grp) st.players[m].grp = Math.max.apply(null, [1].concat(groupNums())); paint(); };
      });
      box.querySelectorAll('[data-grp]').forEach(function (s) { s.onchange = function () { readCard(); paint(); }; });
      box.querySelector('.lvs-shuffle').onclick = function () { readCard(); autoGroups(true); paint(); };
      var save = box.querySelector('.lvs-save'); if (save) save.onclick = function () {
        readCard();
        var msg = box.querySelector('.soc-msg'), bad = cardProblem();
        if (bad) { msg.textContent = bad; return; }
        var ps = on().map(function (m) { return { m: m, ch: String(st.players[m].ch).replace('−', '-'), grp: st.players[m].grp }; });
        var noCh = ps.filter(function (p) { return p.ch === '' || isNaN(Number(p.ch)); });
        if (noCh.length) { msg.textContent = 'Add a course handicap for ' + noCh.map(function (p) { return nick(p.m); }).join(', ') + '.'; return; }
        if (ps.length < 2) { msg.textContent = 'Tick at least two golfers.'; return; }
        save.disabled = true; msg.textContent = 'Making the scorecards…';
        api('/lv/setup', { e: e.id, pid: pid(), course: st.course, cname: q.value.trim() || st.cname, pars: st.pars, si: st.si, allowance: st.allowance,
          players: ps.map(function (p) { return { m: p.m, ch: Number(p.ch), grp: p.grp }; }),
          groups: groupNums().map(function (g) { return { grp: g, tee: st.tees[g] || '', marker: st.markers[g] || '' }; }) }).then(function (r) {
          save.disabled = false;
          if (!r.ok) { msg.textContent = r.error; return; }
          track('lv_setup', { golfers: ps.length });
          st.code = r.code; st.links = r.groups; r.groups.forEach(function (g) { st.markers[g.grp] = g.marker; st.tees[g.grp] = g.tee; });
          paint();
          var sec = box.querySelector('.lvs-dark'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }).catch(function () { save.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
      };
      var all = box.querySelector('.lvs-send-all'); if (all) all.onclick = function () {
        var board = SITE + '/societies/live/?c=' + st.code;
        var lines = st.links.map(function (g) {
          var who = on().filter(function (m) { return st.players[m].grp === g.grp; }).map(nick);
          return (g.tee ? g.tee + ' ' : '') + 'Group ' + g.grp + ': ' + who.join(', ') + '. Marker ' + nick(g.marker) + ', your scorecard: ' + SITE + '/societies/live/score/?t=' + g.token;
        });
        track('lv_send', { kind: 'all' });
        share(S.name + ', ' + e.title + (st.cname ? ' at ' + st.cname : '') + '. The draw:\n' + lines.join('\n') + '\nEveryone else, follow it live: ' + board + '\nMarkers: tap your link on the first tee, then a score for everyone at the end of each hole.');
      };
      box.querySelectorAll('.lvs-send').forEach(function (b) {
        b.onclick = function () {
          var g = st.links.filter(function (x) { return x.grp === Number(b.getAttribute('data-g')); })[0];
          var who = on().filter(function (m) { return st.players[m].grp === g.grp; }).map(nick);
          track('lv_send', { kind: 'marker' });
          share(nick(g.marker) + ', you’re marking Group ' + g.grp + (g.tee ? ' (' + g.tee + ')' : '') + ': ' + who.join(', ') + '. Your scorecard for ' + e.title + ': ' + SITE + '/societies/live/score/?t=' + g.token + ' Tap a score for everyone at the end of each hole. No signal? It saves and sends later.');
        };
      });
    }
  };
})();
