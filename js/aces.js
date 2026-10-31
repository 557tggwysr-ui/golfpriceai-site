/* The Ace Register (/play/aces/). Log a hole-in-one against a UK course,
   draw the certificate on this device (js/milestones.js), and show the
   boards from the alerts worker. Witnesses and the ball never leave this
   browser: they're only drawn on the golfer's own certificate. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function $(id) { return document.getElementById(id); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function short(d) { var p = String(d).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }
  gpUse('ace_view');

  /* ------------------------------------------------ the course list */
  var courses = null, loading = null;
  function norm(s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function loadCourses() {
    if (loading) return loading;
    loading = Promise.all([
      fetch('/data/courses/uk.json').then(function (r) { return r.ok ? r.json() : { courses: [] }; }).catch(function () { return { courses: [] }; }),
      api('/ace/extra').catch(function () { return { courses: [] }; }),
    ]).then(function (rs) {
      courses = (rs[0].courses || []).concat((rs[1] && rs[1].courses) || []);
      courses.forEach(function (c) { c._k = norm(c.n + ' ' + (c.t || '')); });
      return courses;
    });
    return loading;
  }
  function search(q) {
    var words = norm(q).split(' ').filter(Boolean);
    if (!words.length || !courses) return [];
    var out = [];
    for (var i = 0; i < courses.length && out.length < 200; i++) {
      var c = courses[i];
      if (words.every(function (w) { return c._k.indexOf(w) !== -1; })) out.push(c);
    }
    var first = norm(q);
    out.sort(function (a, b) { return (b._k.indexOf(first) === 0) - (a._k.indexOf(first) === 0) || a.n.length - b.n.length; });
    return out.slice(0, 8);
  }
  function combo(input, list, onPick) {
    var items = [], active = -1;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
    function draw() {
      items = search(input.value);
      if (!items.length) {
        list.innerHTML = input.value.trim().length > 2 && courses ? '<li class="ac-none">No match yet. Try fewer words, or the town.</li>' : '';
        list.hidden = !list.innerHTML; input.setAttribute('aria-expanded', list.hidden ? 'false' : 'true'); return;
      }
      list.innerHTML = items.map(function (c, i) {
        return '<li role="option" id="' + list.id + '-' + i + '" data-i="' + i + '"' + (i === active ? ' aria-selected="true"' : '') + '><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></li>';
      }).join('');
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('focus', function () { loadCourses().then(draw); });
    input.addEventListener('input', function () { active = -1; input.removeAttribute('data-id'); loadCourses().then(draw); });
    input.addEventListener('keydown', function (e) {
      if (list.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
      else if (e.key === 'Escape') close();
    });
    list.addEventListener('mousedown', function (e) {
      var li = e.target.closest('[data-i]'); if (!li) return;
      e.preventDefault(); pick(items[+li.getAttribute('data-i')]);
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    function pick(c) { input.value = c.n + (c.t ? ', ' + c.t : ''); input.setAttribute('data-id', c.id); close(); onPick(c); }
  }

  /* ------------------------------------------------ logging an ace */
  var picked = null;
  var form = $('ac-form');
  if (form) {
    combo($('ac-course'), $('ac-list'), function (c) { picked = c; });
    var today = new Date().toISOString().slice(0, 10);
    $('ac-date').max = today; $('ac-date').value = today;
    var nick = String(get('gpNick', '') || '');
    if (nick) { $('ac-nick').value = nick; $('ac-nick-row').hidden = true; }
    $('ac-missing').addEventListener('click', function () { var b = $('ac-missing-box'); b.hidden = !b.hidden; if (!b.hidden) $('ac-sname').focus(); });
    $('ac-ssend').addEventListener('click', function () {
      var msg = $('ac-smsg'), btn = this;
      btn.disabled = true; msg.textContent = 'Sending…';
      api('/ace/suggest', { name: $('ac-sname').value, town: $('ac-stown').value }).then(function (r) {
        msg.textContent = r.ok ? 'Thanks. We’ll check it and add it soon. Come back and log your ace once it’s in the list.' : (r.error || 'That didn’t work. Please try again.');
        btn.disabled = !!r.ok;
      }).catch(function () { msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; btn.disabled = false; });
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('ac-msg'), btn = form.querySelector('.ac-go');
      var par = form.querySelector('input[name="ac-par"]:checked');
      var nk = $('ac-nick').value.trim();
      if (!picked || $('ac-course').getAttribute('data-id') !== picked.id) { msg.textContent = 'Pick your course from the list as you type.'; $('ac-course').focus(); return; }
      if (nk.length < 2) { msg.textContent = 'Pick a nickname for the board (at least 2 letters).'; $('ac-nick-row').hidden = false; $('ac-nick').focus(); return; }
      var body = { pid: pid(), nick: nk, course: picked.id, hole: +$('ac-hole').value, yards: +$('ac-yards').value, par: par ? +par.value : 3,
        club: $('ac-club').value.trim(), day: $('ac-date').value, public: $('ac-public').checked };
      btn.disabled = true; msg.textContent = 'Putting it on record…';
      api('/ace/log', body).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'That didn’t work. Please try again.'; return; }
        if (!get('gpNick', '')) put('gpNick', nk);
        msg.textContent = r.again ? 'You’d already logged that one. Here’s your certificate again.' : 'It’s on record. Congratulations!';
        var d = { cid: r.course.id, course: r.course.n, town: r.course.t, hole: body.hole, yards: body.yards, par: body.par, club: body.club,
          ball: $('ac-ball').value.trim(), witnesses: $('ac-wit').value.trim(), date: body.day, no: r.no, onBoard: body.public ? r.onBoard : 0, inYear: r.inYear };
        if (window.gpMilestones) {
          var id = 'ace_' + r.no;
          if (!gpMilestones.award(id, 'ace', d)) {
            var m = gpMilestones.list().filter(function (x) { return x.id === id; })[0];
            if (m) { m.d = d; gpMilestones.open(m, false); }
          }
        }
        latest();
        if (body.public) board(r.course.id, true);
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }

  /* ------------------------------------------------ the register */
  function latest() {
    api('/ace/latest').then(function (r) {
      if (!r || !r.ok) return;
      var set = function (k, v) { document.querySelectorAll('[data-ac="' + k + '"]').forEach(function (el) { el.textContent = v; }); };
      set('total', r.total || 0); set('totalLabel', 'aces logged in ' + r.year); set('courses', r.courses || 0);
      set('club', r.topClub ? r.topClub.replace(/^./, function (c) { return c.toUpperCase(); }) : '–');
      var el = $('ac-latest');
      el.innerHTML = r.latest && r.latest.length ? '<table class="ac-table"><thead><tr><th>Golfer</th><th>Course</th><th>Hole</th><th>Club</th><th>Date</th></tr></thead><tbody>' +
        r.latest.map(function (a) {
          return '<tr><td><b>' + esc(a.nick) + '</b></td><td><a href="?c=' + esc(a.course) + '" data-c="' + esc(a.course) + '">' + esc(a.cname) + '</a></td><td>' + ord(a.hole) + '</td><td>' + esc(a.club) + '</td><td>' + short(a.day) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="ac-empty">No aces on the register yet. Yours could be the first.</p>';
      var h = $('ac-holes');
      if (r.holes && r.holes.length) h.innerHTML = '<ol class="ac-holes">' + r.holes.map(function (x) {
        return '<li><a href="?c=' + esc(x.course) + '" data-c="' + esc(x.course) + '">' + esc(x.cname) + ', ' + ord(x.hole) + '</a><b>' + x.c + ' aces</b></li>';
      }).join('') + '</ol>';
    }).catch(function () { $('ac-latest').innerHTML = '<p class="ac-empty">The register is taking a breather. Please refresh in a minute.</p>'; });
  }
  latest();

  /* ------------------------------------------------ a course's board */
  function board(id, scroll) {
    var el = $('board');
    api('/ace/board?c=' + encodeURIComponent(id)).then(function (r) {
      if (!r || !r.ok || !r.course) { el.hidden = true; return; }
      var aces = r.aces || [], byHole = {};
      aces.forEach(function (a) { byHole[a.hole] = (byHole[a.hole] || 0) + 1; });
      var top = Object.keys(byHole).sort(function (a, b) { return byHole[b] - byHole[a]; })[0];
      el.innerHTML = '<div class="ac-card ac-course-board"><span class="ac-kick">A COURSE’S ACE BOARD</span>' +
        '<h2>' + esc(r.course.n) + '</h2><span class="ac-sub">' + esc(r.course.t || '') + (r.course.t ? ' · ' : '') + aces.length + (aces.length === 1 ? ' ace' : ' aces') + ' on record</span>' +
        (aces.length ? '<ul class="ac-rows">' + aces.map(function (a) {
          return '<li><span><b>' + ord(a.hole) + '</b> · ' + esc(a.nick) + ' · ' + esc(a.club) + ' · ' + a.yards + ' yds</span><span class="ac-date">' + short(a.day) + '</span></li>';
        }).join('') + '</ul>' : '<p class="ac-empty">No aces on this board yet. The first one gets the top line forever.</p>') +
        (top && byHole[top] > 1 ? '<p class="ac-sub">The hungriest hole: <b>the ' + ord(top) + '</b>, ' + byHole[top] + ' aces.</p>' : '') +
        '<div class="ac-ctas"><button type="button" class="ac-btn" id="ac-share-board">Share this board with the club</button><a class="ac-btn ac-btn-ghost" href="#log">Log an ace here</a></div></div>';
      el.hidden = false;
      document.title = r.course.n + ' ace board | GolfPrice AI';
      $('ac-share-board').addEventListener('click', function () {
        gpUse('ace_share');
        var url = location.origin + '/play/aces/?c=' + encodeURIComponent(id), text = 'The hole-in-one board for ' + r.course.n + ' on the GolfPrice AI Ace Register:';
        if (navigator.share) navigator.share({ text: text, url: url }).catch(function () {});
        else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
      });
      // Pre-fill the form with this course.
      loadCourses().then(function () {
        var c = courses.filter(function (x) { return x.id === id; })[0];
        if (c && form && !picked) { picked = c; $('ac-course').value = c.n + (c.t ? ', ' + c.t : ''); $('ac-course').setAttribute('data-id', c.id); }
      });
      if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function () { el.hidden = true; });
  }
  function go(id) { history.pushState(null, '', '?c=' + encodeURIComponent(id)); board(id, true); }
  var find = $('ac-find');
  if (find) combo(find, $('ac-flist'), function (c) { go(c.id); });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-c]');
    if (!a) return;
    e.preventDefault(); go(a.getAttribute('data-c'));
  });
  window.addEventListener('popstate', function () {
    var c = new URLSearchParams(location.search).get('c');
    if (c) board(c, false); else $('board').hidden = true;
  });
  var first = new URLSearchParams(location.search).get('c');
  if (first && /^(?:[nwr]\d{1,12}|x\d{1,6})$/.test(first)) board(first, true);
})();
