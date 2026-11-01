/* Polls: a question for the group, answered in one tap from a WhatsApp link.
   /societies/poll/?p=<id>  a society poll (members vote)     ?new=1&s=<society>  start one (organiser)
   /play/poll/?p=<id>       a quick poll (anyone with a nickname)  ?new=1         start one
   Everything comes from the alerts worker (/pl/...). Nicknames only. */
(function () {
  'use strict';
  var box = document.getElementById('pl');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16); crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join(''); put('gpPid', p);
    }
    return p;
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' }).then(function (r) { return r.json(); });
  }
  function share(text) {
    gpUse('pl_share');
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function day(iso, long) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: long ? 'long' : 'short' }); }
  function when(iso) { var d = new Date(iso), h = d.getHours(), m = d.getMinutes(); return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '') + ', ' + (h % 12 || 12) + (m ? ':' + ('0' + m).slice(-2) : '') + (h < 12 ? 'am' : 'pm'); }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function label(o) { return o.day ? day(o.day) : o.label; }
  function link(p) { return SITE + (p.soc ? '/societies/poll/' : '/play/poll/') + '?p=' + p.id; }
  var COURSES = null;
  function courses() { if (!COURSES) COURSES = fetch('/data/courses/uk.json').then(function (r) { return r.json(); }).then(function (d) { return d.courses || []; }).catch(function () { return []; }); return COURSES; }
  function picker(input, pick, onPick) {
    var timer;
    input.addEventListener('input', function () {
      clearTimeout(timer); var t = input.value.trim().toLowerCase();
      if (t.length < 3) { pick.hidden = true; return; }
      timer = setTimeout(function () {
        courses().then(function (all) {
          var hits = all.filter(function (c) { return (c.n + ' ' + (c.t || '')).toLowerCase().indexOf(t) >= 0; }).slice(0, 6);
          pick.innerHTML = hits.map(function (c, i) { return '<button type="button" data-i="' + i + '"><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></button>'; }).join('');
          pick.hidden = !hits.length;
          pick.querySelectorAll('button').forEach(function (b) { b.onclick = function () { pick.hidden = true; onPick(hits[+b.getAttribute('data-i')]); }; });
        });
      }, 200);
    });
  }
  var qs = new URLSearchParams(location.search), PID = (qs.get('p') || '').toLowerCase(), SOC = (qs.get('s') || '').toLowerCase();

  /* ------------------------------------------------------------ start a poll */
  var QUICK = {
    where: { kind: 'pick', q: 'Where should we play next?', opts: [], courses: true },
    trip: { kind: 'pick', q: 'Where’s the trip this year?', opts: [] },
    doo: { kind: 'pick', q: 'What are we doing for the end-of-season do?', opts: ['Dinner at the club', 'Curry night', 'Day out at the races'] },
    fmt: { kind: 'pick', q: 'What format next time?', opts: ['Stableford', 'Better-ball pairs', 'Texas scramble', 'Medal'] },
    date: { kind: 'date', q: 'When’s the next game?', opts: [] }
  };
  var nw = null;
  function defaultClose() { var d = new Date(Date.now() + 5 * 864e5); d.setHours(18, 0, 0, 0); var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); }
  function startNew() {
    nw = { kind: 'pick', q: '', opts: [{ label: '' }, { label: '' }], days: [], named: true, multi: false, adds: true, closes: defaultClose(), soc: null };
    if (SOC) api('/soc/s?s=' + SOC + '&pid=' + pid()).then(function (d) { nw.soc = d.ok ? d : null; paintNew(); }).catch(paintNew);
    else paintNew();
  }
  function readNew() {
    var f = box.querySelector('#pl-new'); if (!f) return;
    nw.q = f.q.value;
    box.querySelectorAll('[data-opt]').forEach(function (i) { var o = nw.opts[+i.getAttribute('data-opt')]; if (o.label !== i.value) { o.label = i.value; o.course = ''; o.town = ''; } });
    box.querySelectorAll('[data-day]').forEach(function (i) { nw.days[+i.getAttribute('data-day')] = i.value; });
    nw.named = f.named.checked; nw.multi = f.multi ? f.multi.checked : false; nw.adds = f.adds ? f.adds.checked : false; nw.closes = f.closes.value;
  }
  function paintNew(msg) {
    var soc = nw.soc, date = nw.kind === 'date';
    if (SOC && soc && !soc.organiser) { box.innerHTML = '<div class="pl"><section class="pl-card"><p>Only the organiser of ' + esc(soc.name) + ' can start a society poll. <a href="/play/poll/?new=1">Start a quick poll</a> instead?</p></section></div>'; return; }
    var h = '<div class="pl"><span class="pl-k">' + (soc ? 'SOCIETY HQ · ' + esc(soc.name).toUpperCase() + ' · NEW POLL' : 'QUICK POLL · NO SIGN-UP') + '</span><h1>Ask the group</h1>' +
      '<form id="pl-new" novalidate><section class="pl-card"><b class="pl-h">What kind of poll?</b><div class="pl-two">' +
      '<button type="button" class="pl-kind" data-kind="pick" aria-pressed="' + !date + '"><b>Pick one</b><small>Courses, formats, the trip</small></button>' +
      '<button type="button" class="pl-kind" data-kind="date" aria-pressed="' + date + '"><b>Find a date</b><small>Who can make which days</small></button></div>' +
      '<p class="pl-small">Quick starts: ' + [['where', 'Where next?'], ['trip', 'Trip destination'], ['doo', 'End-of-season do'], ['fmt', 'Format'], ['date', 'Next date']].map(function (x) { return '<button type="button" class="pl-link" data-quick="' + x[0] + '">' + x[1] + '</button>'; }).join(' · ') + '</p></section>' +
      '<section class="pl-card"><label>Question<input name="q" maxlength="100" value="' + esc(nw.q) + '" placeholder="' + (date ? 'When’s the April game?' : 'Where should we play in April?') + '"></label>';
    if (date) {
      h += '<b class="pl-sub">Dates</b>' + nw.days.map(function (d, i) { return '<div class="pl-opt"><input type="date" data-day="' + i + '" value="' + esc(d) + '" aria-label="Date ' + (i + 1) + '"><button type="button" class="pl-x" data-rmday="' + i + '" aria-label="Remove this date">×</button></div>'; }).join('') +
        (nw.days.length < 12 ? '<button type="button" class="pl-add" id="pl-addday">+ Add a date</button>' : '');
    } else {
      h += '<b class="pl-sub">Options</b>' + nw.opts.map(function (o, i) { return '<div class="pl-opt"><input data-opt="' + i + '" maxlength="50" value="' + esc(o.label) + '" placeholder="Option ' + (i + 1) + '"' + (o.course ? ' aria-describedby="pl-t' + i + '"' : '') + '><button type="button" class="pl-x" data-rm="' + i + '" aria-label="Remove this option">×</button>' + (o.town ? '<small id="pl-t' + i + '" class="pl-town">' + esc(o.town) + '</small>' : '') + '</div>'; }).join('') +
        (nw.opts.length < 12 ? '<button type="button" class="pl-add" id="pl-addopt">+ Add an option</button><label class="pl-cq">Or add a course<input id="pl-cq" autocomplete="off" placeholder="Start typing a course or town"></label><div class="hq-cpick" id="pl-cpick" hidden></div>' : '');
    }
    h += '</section><section class="pl-card"><b class="pl-h">Settings</b>' +
      '<label class="pl-check"><input type="checkbox" name="named"' + (nw.named ? ' checked' : '') + '> Show who voted for what</label>' +
      (date ? '' : '<label class="pl-check"><input type="checkbox" name="multi"' + (nw.multi ? ' checked' : '') + '> People can pick more than one</label><label class="pl-check"><input type="checkbox" name="adds"' + (nw.adds ? ' checked' : '') + '> People can add their own option</label>') +
      '<label>Closes<input type="datetime-local" name="closes" value="' + esc(nw.closes) + '"></label></section>' +
      '<p class="pl-msg" role="status">' + esc(msg || '') + '</p><button type="submit" class="pl-btn">Create the poll</button></form></div>';
    box.innerHTML = h;
    var f = box.querySelector('#pl-new');
    box.querySelectorAll('[data-kind]').forEach(function (b) { b.onclick = function () { readNew(); nw.kind = b.getAttribute('data-kind'); if (nw.kind === 'date' && !nw.days.length) nw.days = ['', '']; paintNew(); }; });
    box.querySelectorAll('[data-quick]').forEach(function (b) {
      b.onclick = function () {
        var t = QUICK[b.getAttribute('data-quick')]; readNew(); nw.kind = t.kind; nw.q = t.q;
        if (t.kind === 'date') nw.days = nw.days.filter(Boolean).length ? nw.days : ['', '', ''];
        else nw.opts = t.opts.length ? t.opts.map(function (x) { return { label: x }; }) : [{ label: '' }, { label: '' }];
        paintNew(); if (t.courses) { var c = box.querySelector('#pl-cq'); if (c) c.focus(); }
      };
    });
    box.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { readNew(); nw.opts.splice(+b.getAttribute('data-rm'), 1); if (nw.opts.length < 2) nw.opts.push({ label: '' }); paintNew(); }; });
    box.querySelectorAll('[data-rmday]').forEach(function (b) { b.onclick = function () { readNew(); nw.days.splice(+b.getAttribute('data-rmday'), 1); paintNew(); }; });
    var ao = box.querySelector('#pl-addopt'); if (ao) ao.onclick = function () { readNew(); nw.opts.push({ label: '' }); paintNew(); var i = box.querySelector('[data-opt="' + (nw.opts.length - 1) + '"]'); if (i) i.focus(); };
    var ad = box.querySelector('#pl-addday'); if (ad) ad.onclick = function () { readNew(); nw.days.push(''); paintNew(); };
    var cq = box.querySelector('#pl-cq');
    if (cq) picker(cq, box.querySelector('#pl-cpick'), function (c) {
      readNew();
      var empty = nw.opts.filter(function (o) { return !o.label.trim(); })[0];
      var o = { label: c.n, course: c.id, town: c.t || '' };
      if (empty) nw.opts[nw.opts.indexOf(empty)] = o; else nw.opts.push(o);
      paintNew();
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault(); readNew();
      var opts = nw.kind === 'date' ? nw.days.filter(Boolean).map(function (d) { return { day: d }; }) : nw.opts.filter(function (o) { return o.label.trim(); });
      if (nw.q.trim().length < 4) return paintNew('Ask a question first.');
      if (opts.length < 2) return paintNew(nw.kind === 'date' ? 'Add at least two dates.' : 'Add at least two options.');
      var btn = f.querySelector('.pl-btn'); btn.disabled = true; btn.textContent = 'Creating…';
      var closes = nw.closes ? new Date(nw.closes).toISOString() : '';
      api('/pl/new', { pid: pid(), s: SOC, kind: nw.kind, q: nw.q.trim(), options: opts, named: nw.named, multi: nw.multi, adds: nw.adds, closes: closes }).then(function (r) {
        if (!r.ok) { btn.disabled = false; btn.textContent = 'Create the poll'; f.querySelector('.pl-msg').textContent = r.error; return; }
        track('poll_new', { kind: nw.kind, society: !!SOC });
        location.href = (SOC ? '/societies/poll/' : '/play/poll/') + '?p=' + r.id + '&made=1';
      }).catch(function () { btn.disabled = false; btn.textContent = 'Create the poll'; f.querySelector('.pl-msg').textContent = 'No signal just now. Try again in a moment.'; });
    });
  }

  /* ------------------------------------------------------------ vote and results */
  var P = null, sel = {}, ans = {};
  // WhatsApp messages: *bold*, _italic_, one item a line, and the link on its own line so the preview card shows.
  function head(p) { return '*' + (p.soc ? p.soc.name.toUpperCase() + ' · ' : 'GOLF GROUP · ') + (p.kind === 'date' ? 'FIND A DATE' : 'POLL') + '*\n*' + p.q + '*'; }
  function bar(n, max) { var f = max ? Math.round(n / max * 8) : 0; if (n && !f) f = 1; return new Array(f + 1).join('▰') + new Array(9 - f).join('▱'); }
  function invite(p) {
    var lines = p.options.map(function (o, i) { return (p.kind === 'date' ? '▸ ' + day(o.day) : (i + 1) + '. ' + o.label + (o.town ? ' _(' + o.town + ')_' : '')); });
    return head(p) + '\n\n' + (p.kind === 'date' ? 'Which days can you make?\n' : '') + lines.join('\n') + '\n\n' +
      (p.kind === 'date' ? 'Tap yes, maybe or no for each day:' : p.multi ? 'Pick as many as you like, one tap each:' : 'Vote in one tap:') + '\n' + link(p) +
      '\n\n_Closes ' + when(p.closes) + '. Results update live._';
  }
  function standings(p) {
    return p.options.slice().sort(function (a, b) { return (b.yes + b.maybe / 2) - (a.yes + a.maybe / 2) || a.oid - b.oid; });
  }
  function resultsText(p) {
    var s = standings(p), max = Math.max.apply(null, s.map(function (o) { return o.yes; }).concat([0])), top = s[0];
    var count = p.total ? p.voters + ' of ' + p.total + ' answered' : p.voters + (p.voters === 1 ? ' answer' : ' answers');
    var rows = s.slice(0, 8).map(function (o) { return bar(o.yes, max) + ' *' + o.yes + '* ' + (p.kind === 'date' ? day(o.day) + (o.maybe ? ' _(+' + o.maybe + ' maybe)_' : '') : o.label); });
    var lead = top && top.yes ? (p.kind === 'date' ? '*' + day(top.day, true) + '* works for the most' + (p.closed ? '.' : ' so far.') : (p.closed ? '*' + label(top) + ' it is.*' : '*' + label(top) + '* leads.')) : '';
    return head(p) + '\n_' + (p.closed ? 'Final result' : 'Results so far') + ' · ' + count + '_\n\n' + rows.join('\n') + (lead ? '\n\n' + lead : '') +
      (p.closed ? '' : '\n\nNot answered yet? One tap:\n' + link(p) + '\n_Closes ' + when(p.closes) + '._');
  }
  function nudge(p) {
    return '*Still to answer:* ' + list(p.waiting) + '\n\n' + p.q + '\nIt takes ten seconds:\n' + link(p) + '\n\n_Closes ' + when(p.closes) + '._';
  }
  function bars(p) {
    var s = standings(p), max = Math.max(1, s[0] ? s[0].yes : 0);
    return s.map(function (o, i) {
      var lead = i === 0 && o.yes > 0 && (!s[1] || o.yes > s[1].yes);
      return '<div class="pl-bar"><div><b>' + esc(label(o)) + (lead ? ' <span class="pl-lead">' + (p.closed ? 'winner' : 'leading') + '</span>' : '') + '</b><b>' + o.yes + '</b></div>' +
        '<span class="pl-track"><span style="width:' + Math.round(o.yes / max * 100) + '%"' + (lead ? ' class="is-lead"' : '') + '></span></span>' +
        (o.who && o.who.length ? '<small>' + esc(o.who.map(function (w) { return w.nick; }).join(', ')) + '</small>' : o.town ? '<small>' + esc(o.town) + '</small>' : '') + '</div>';
    }).join('');
  }
  function grid(p) {
    if (!p.named) return p.options.map(function (o) { return '<div class="pl-bar"><div><b>' + esc(day(o.day)) + '</b><b>' + o.yes + (o.maybe ? ' <small>+' + o.maybe + ' maybe</small>' : '') + '</b></div></div>'; }).join('');
    var names = {}; p.options.forEach(function (o) { (o.who || []).forEach(function (w) { names[w.nick] = 1; }); });
    var ns = Object.keys(names).sort();
    var best = standings(p)[0];
    var h = '<div class="pl-grid" style="grid-template-columns:minmax(64px,1fr) repeat(' + p.options.length + ',minmax(38px,48px))"><span></span>' + p.options.map(function (o) { return '<b>' + esc(day(o.day)).replace(' ', '<br>') + '</b>'; }).join('');
    ns.forEach(function (n) {
      h += '<b class="pl-gn">' + esc(n) + '</b>' + p.options.map(function (o) { var w = (o.who || []).filter(function (x) { return x.nick === n; })[0]; return '<span class="pl-c' + (w ? (w.ans === 'm' ? ' is-m' : ' is-y') : '') + '" aria-label="' + (w ? (w.ans === 'm' ? 'maybe' : 'yes') : 'no') + '">' + (w ? (w.ans === 'm' ? '?' : '✓') : '–') + '</span>'; }).join('');
    });
    h += '<b class="pl-gn pl-small">CAN DO</b>' + p.options.map(function (o) { return '<b class="pl-cnt' + (best && o.oid === best.oid && o.yes ? ' is-best' : '') + '">' + o.yes + (o.maybe ? '<small>+' + o.maybe + '?</small>' : '') + '</b>'; }).join('') + '</div>';
    return h + (best && best.yes ? '<p class="pl-small"><b class="pl-good">' + esc(day(best.day, true)) + '</b> works for the most golfers' + (p.closed ? '.' : ' so far.') + '</p>' : '');
  }
  function paint(msg) {
    var p = P, voted = p.mine.length > 0, showRes = voted || p.closed || p.canClose;
    var h = '<div class="pl"><section class="pl-hero"><div class="pl-top"><span class="pl-k">' + esc((p.soc ? p.soc.name + ' · ' : 'QUICK ') + (p.kind === 'date' ? 'FIND A DATE' : 'POLL')).toUpperCase() + '</span><span class="pl-when' + (p.closed ? ' is-closed' : '') + '">' + (p.closed ? 'CLOSED' : 'CLOSES ' + esc(when(p.closes)).toUpperCase()) + '</span></div>' +
      '<h1>' + esc(p.q) + '</h1><span class="pl-meta">' + (p.total ? p.voters + ' of ' + p.total + ' members have answered' : p.voters + (p.voters === 1 ? ' person has' : ' people have') + ' answered') + (voted && !p.closed ? ' · you’re in' : '') + '</span></section><div class="pl-main">';
    if (qs.get('made') && !p.closed) h += '<section class="pl-card pl-made"><b class="pl-h">Poll ready. Send it to the group</b><p>One tap: it opens WhatsApp (or your share menu) with the message written.</p><button type="button" class="pl-btn" id="pl-invite">Send the poll to the group</button></section>';
    if (!p.closed) {
      if (p.soc && !p.member) h += '<section class="pl-card"><b class="pl-h">Join ' + esc(p.soc.name) + ' to vote</b><p>Members vote with their nickname. It takes ten seconds.</p><a class="pl-btn" href="/societies/hq/?s=' + esc(p.soc.id) + '&poll=' + esc(p.id) + '">Join and vote</a></section>';
      else {
        h += '<section class="pl-card"><b class="pl-h">' + (voted ? 'Your answer' : p.kind === 'date' ? 'Which days can you make?' : p.multi ? 'Pick as many as you like' : 'Pick one') + '</b>';
        if (p.kind === 'date') {
          h += p.options.map(function (o) {
            var a = ans[o.oid] || 'n';
            return '<div class="pl-day"><b>' + esc(day(o.day)) + '</b><span>' + [['y', 'Yes'], ['m', 'Maybe'], ['n', 'No']].map(function (x) { return '<button type="button" data-ans="' + o.oid + ':' + x[0] + '" aria-pressed="' + (a === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</span></div>';
          }).join('');
        } else {
          h += p.options.map(function (o) {
            var on = !!sel[o.oid];
            return '<button type="button" class="pl-o" data-oid="' + o.oid + '" aria-pressed="' + on + '"><span><b>' + esc(o.label) + '</b>' + (o.town || o.by ? '<small>' + esc([o.town, o.by ? 'added by ' + o.by : ''].filter(Boolean).join(' · ')) + '</small>' : '') + '</span><i class="' + (p.multi ? 'is-sq' : '') + '" aria-hidden="true"></i></button>';
          }).join('') + (p.adds || p.canClose ? '<div class="pl-addrow" id="pl-addrow"><button type="button" class="pl-add" id="pl-suggest">+ Suggest another</button></div>' : '');
        }
        if (!p.soc) h += '<label class="pl-nick">Your nickname<input id="pl-nick" maxlength="20" autocomplete="nickname" value="' + esc((p.me && p.me.nick) || get('gpNick', '') || '') + '" placeholder="e.g. Big Dave"></label>';
        else if (p.me) h += '<p class="pl-small">Answering as <b>' + esc(p.me.nick) + '</b>.</p>';
        h += '<p class="pl-msg" role="status">' + esc(msg || '') + '</p><button type="button" class="pl-btn" id="pl-vote">' + (voted ? 'Update my answer' : p.kind === 'date' ? 'Save my answers' : 'Vote') + '</button></section>';
      }
    }
    if (showRes) {
      h += '<section class="pl-card"><b class="pl-h">' + (p.closed ? 'The result' : 'Everyone so far') + '</b>' + (p.kind === 'date' ? grid(p) : bars(p)) + '</section>';
      if (p.waiting && p.waiting.length && !p.closed) h += '<section class="pl-card pl-wait"><p><b>Still to answer (' + p.waiting.length + '):</b> ' + esc(p.waiting.join(', ')) + '.</p><button type="button" class="pl-link" id="pl-nudge">Give them a nudge</button></section>';
      h += '<button type="button" class="pl-btn" id="pl-res">Send the results to the group</button>';
    } else if (!p.closed) h += '<p class="pl-small" style="text-align:center">Results show once you’ve answered.</p>';
    if (p.canClose) {
      var top = standings(p)[0], winTxt = top && top.yes ? label(top) : '';
      if (!p.closed) h += '<section class="pl-dark"><span class="pl-k">' + (p.soc ? 'ORGANISER ONLY' : 'YOU STARTED THIS POLL') + '</span>' + (winTxt ? '<b class="pl-h">' + esc(winTxt) + ' it is?</b>' : '<b class="pl-h">Close the poll</b>') +
        (p.soc ? '<p>Close the poll and turn the winner into a fixture: ' + (p.kind === 'date' ? 'the date' : 'the course') + ' is filled in for you.</p><button type="button" class="pl-btn" id="pl-close-fix">Close it and make the fixture</button><button type="button" class="pl-link pl-l" id="pl-close">Just close it</button>' :
          '<p>Closing stops the voting and shows the result to everyone.</p><button type="button" class="pl-btn" id="pl-close">Close the poll</button>') + '</section>';
      else if (p.soc) h += '<a class="pl-btn2" href="' + esc(fixtureLink(p)) + '">Make it a fixture</a>';
      h += '<button type="button" class="pl-link pl-del" id="pl-del">Delete this poll</button>';
    }
    h += '<p class="pl-small" style="text-align:center">Nicknames only. ' + (p.soc ? '<a href="/societies/hq/?s=' + esc(p.soc.id) + '">Back to ' + esc(p.soc.name) + '</a>' : '<a href="/play/poll/?new=1">Start your own poll</a> · <a href="/play/scorecard/">Free golf scorecard</a>') + '</p></div></div>';
    box.innerHTML = h;
    wire();
  }
  function fixtureLink(p) {
    var w = p.options.filter(function (o) { return o.oid === p.winner; })[0] || standings(p)[0] || {};
    var u = new URLSearchParams({ s: p.soc.id, fix: '1' });
    if (p.kind === 'date' && w.day) u.set('day', w.day); else if (w.label) u.set('venue', w.label);
    return '/societies/hq/?' + u.toString() + '#hq-fix';
  }
  function wire() {
    var p = P;
    box.querySelectorAll('[data-oid]').forEach(function (b) { b.onclick = function () { var o = +b.getAttribute('data-oid'); if (!p.multi) sel = {}; sel[o] = !sel[o] || !p.multi ? true : false; if (p.multi && !sel[o]) delete sel[o]; paint(); }; });
    box.querySelectorAll('[data-ans]').forEach(function (b) { b.onclick = function () { var x = b.getAttribute('data-ans').split(':'); ans[+x[0]] = x[1]; paint(); }; });
    var inv = document.getElementById('pl-invite'); if (inv) inv.onclick = function () { track('poll_invite'); share(invite(p)); };
    var res = document.getElementById('pl-res'); if (res) res.onclick = function () { track('poll_results'); share(resultsText(p)); };
    var nud = document.getElementById('pl-nudge'); if (nud) nud.onclick = function () { track('poll_nudge'); share(nudge(p)); };
    var sug = document.getElementById('pl-suggest');
    if (sug) sug.onclick = function () {
      var row = document.getElementById('pl-addrow');
      row.innerHTML = '<input id="pl-new-opt" maxlength="50" placeholder="Course, place or idea" autocomplete="off" aria-label="Your suggestion"><div class="hq-cpick" id="pl-spick" hidden></div><button type="button" class="pl-btn2" id="pl-add-go">Add it</button>';
      var inp = document.getElementById('pl-new-opt'), chosen = null; inp.focus();
      picker(inp, document.getElementById('pl-spick'), function (c) { chosen = c; inp.value = c.n; });
      document.getElementById('pl-add-go').onclick = function () {
        var v = inp.value.trim(); if (!v) return;
        api('/pl/add', { p: p.id, pid: pid(), label: v, course: chosen && chosen.n === v ? chosen.id : '', town: chosen && chosen.n === v ? chosen.t || '' : '' }).then(function (r) {
          if (!r.ok) return paint(r.error);
          if (!p.multi) sel = {}; sel[r.oid] = true; load();
        });
      };
    };
    var vote = document.getElementById('pl-vote');
    if (vote) vote.onclick = function () {
      var body = { p: p.id, pid: pid() };
      if (p.kind === 'date') { body.answers = {}; p.options.forEach(function (o) { if (ans[o.oid] && ans[o.oid] !== 'n') body.answers[o.oid] = ans[o.oid]; }); }
      else { body.oids = Object.keys(sel).map(Number); if (!body.oids.length) return paint('Pick an option first.'); }
      var nk = document.getElementById('pl-nick');
      if (nk) { body.nick = nk.value.trim(); if (body.nick.length < 2) return paint('Pick a nickname first (so the group knows who’s who).'); put('gpNick', body.nick); }
      vote.disabled = true; vote.textContent = 'Saving…';
      api('/pl/vote', body).then(function (r) { if (!r.ok) { paint(r.error); return; } track('poll_vote', { kind: p.kind }); load(); }).catch(function () { paint('No signal just now. Try again in a moment.'); });
    };
    function closeIt(fix) {
      api('/pl/close', { p: p.id, pid: pid() }).then(function (r) {
        if (!r.ok) return paint(r.error);
        track('poll_close', { fix: !!fix });
        if (fix) { p.winner = r.winner; location.href = fixtureLink(p); } else load();
      });
    }
    var cf = document.getElementById('pl-close-fix'); if (cf) cf.onclick = function () { closeIt(true); };
    var cl = document.getElementById('pl-close'); if (cl) cl.onclick = function () { closeIt(false); };
    var del = document.getElementById('pl-del');
    if (del) del.onclick = function () {
      if (!window.confirm('Delete this poll and everyone’s answers?')) return;
      api('/pl/delete', { p: p.id, pid: pid() }).then(function () { location.href = p.soc ? '/societies/hq/?s=' + p.soc.id : '/play/poll/?new=1'; });
    };
  }
  function load() {
    api('/pl/get?p=' + PID + '&pid=' + pid()).then(function (d) {
      if (!d.ok) { box.innerHTML = '<div class="pl"><section class="pl-card"><p>' + esc(d.error) + '</p><p><a href="/play/poll/?new=1">Start a poll</a></p></section></div>'; return; }
      P = d; sel = {}; ans = {};
      d.mine.forEach(function (m) { if (m.oid) { sel[m.oid] = true; ans[m.oid] = m.ans; } });
      paint(); gpUse('pl_view');
    }).catch(function () { box.innerHTML = '<div class="pl"><section class="pl-card"><p>No signal just now. Open the link again in a moment.</p></section></div>'; });
  }
  if (/^[a-z0-9]{8}$/.test(PID)) load();
  else if (qs.get('new')) startNew();
  else startNew();
})();
