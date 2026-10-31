/* Course pages (/courses/...). On a full course page it refreshes the ace
   board live and runs the shots calculator; on /courses/course/?c=<id> it
   draws the whole page from the course list; on the hub it runs search,
   "courses near me" (the location never leaves the device) and nations. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function short(d) { var p = String(d).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0]; }
  function api(path) { return fetch(API + path).then(function (r) { return r.json(); }); }
  function miles(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 3958.8 * 2 * Math.asin(Math.sqrt(h));
  }
  function norm(s) { return String(s).toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  var data = null;
  function load() {
    if (data) return data;
    data = Promise.all([
      fetch('/data/courses/uk.json').then(function (r) { return r.json(); }),
      fetch('/data/courses/pages.json').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ]).then(function (rs) {
      var cs = rs[0].courses || [];
      cs.forEach(function (c) { c._k = norm(c.n + ' ' + (c.t || '')); });
      return { courses: cs, pages: rs[1] || {} };
    });
    return data;
  }
  function href(c, pages) { return pages[c.id] ? '/courses/' + pages[c.id] + '/' : '/courses/course/?c=' + encodeURIComponent(c.id); }

  /* ------------------------------------------------ a course page */
  function boardRows(aces) {
    return aces.length ? '<ul class="cs-rows" id="cs-rows">' + aces.map(function (a) {
      return '<li><span><b>' + ord(a.hole) + '</b> · ' + esc(a.nick) + ' · ' + esc(a.club) + ' · ' + a.yards + ' yds</span><span class="cs-date">' + short(a.day) + '</span></li>';
    }).join('') + '</ul>' : '<p class="cs-empty" id="cs-rows">No aces on this board yet. The first one gets the top line forever.</p>';
  }
  function liveBoard(root) {
    var id = root.getAttribute('data-course');
    api('/ace/board?c=' + encodeURIComponent(id)).then(function (r) {
      if (!r || !r.ok) return;
      var aces = r.aces || [], byHole = {}, top = null;
      aces.forEach(function (a) { byHole[a.hole] = (byHole[a.hole] || 0) + 1; if (!top || byHole[a.hole] > byHole[top]) top = a.hole; });
      var rows = $('cs-rows'); if (rows) rows.outerHTML = boardRows(aces);
      $('cs-count').textContent = aces.length;
      if (top) $('cs-hole').textContent = 'The ' + ord(top);
    }).catch(function () {});
  }
  function wire(root) {
    var name = (root.querySelector('h1') || {}).textContent || 'this course';
    var share = $('cs-share');
    if (share) share.addEventListener('click', function () {
      var text = 'The hole-in-one board for ' + name + ' on GolfPrice AI:', url = location.href.split('#')[0];
      if (navigator.share) navigator.share({ text: text, url: url }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
    });
    var calc = $('cs-calc');
    if (calc) {
      var run = function () {
        var i = parseFloat($('cs-i').value), s = parseFloat($('cs-s').value);
        $('cs-ch').textContent = !isNaN(i) && s > 0 ? Math.round(i * s / 113) : '–';
      };
      calc.addEventListener('input', run); run();
    }
    liveBoard(root);
  }
  var full = document.querySelector('.cs[data-course]');
  if (full) wire(full);

  // /courses/course/?c=<id>: the same page, drawn here from the course list.
  var any = $('cs-any');
  if (any) {
    var id = new URLSearchParams(location.search).get('c') || '';
    load().then(function (d) {
      var c = d.courses.filter(function (x) { return x.id === id; })[0];
      if (!c) { any.innerHTML = '<p class="cs-empty">We couldn’t find that course. <a href="/courses/">Search all UK courses</a>.</p>'; return; }
      if (d.pages[c.id]) { location.replace('/courses/' + d.pages[c.id] + '/'); return; }
      var near = d.courses.filter(function (o) { return o.id !== c.id && Math.abs(o.lat - c.lat) < 0.6 && Math.abs(o.lon - c.lon) < 1; })
        .map(function (o) { return { d: miles(c, o), o: o }; }).filter(function (x) { return x.d <= 30; }).sort(function (a, b) { return a.d - b.d; });
      var within10 = near.filter(function (x) { return x.d <= 10; }).length;
      document.title = c.n + (c.t ? ' (' + c.t + ')' : '') + ' | GolfPrice AI';
      var maps = 'https://www.google.com/maps/dir/?api=1&destination=' + c.lat + ',' + c.lon;
      any.setAttribute('data-course', c.id);
      any.innerHTML =
        '<section class="cs-top"><nav class="cs-crumbs" aria-label="Breadcrumb"><a href="/courses/">Courses</a>' + (c.t ? ' › ' + esc(c.t) : '') + '</nav>' +
        '<h1>' + esc(c.n) + '</h1><p class="cs-meta">Golf course' + (c.t ? ' near ' + esc(c.t) : '') + (c.c ? ', ' + esc(c.c) : '') +
        ' <span aria-hidden="true">·</span> <a href="' + maps + '" rel="nofollow noopener" target="_blank">Directions</a>' +
        (c.w && /^https?:\/\//.test(c.w) ? ' <span aria-hidden="true">·</span> <a href="' + esc(c.w) + '" rel="nofollow noopener" target="_blank">Club website</a>' : '') + '</p></section>' +
        '<section class="cs-tiles"><div class="cs-tile cs-dark"><b id="cs-count">0</b><span>aces on record</span></div>' +
        '<div class="cs-tile"><b id="cs-hole">–</b><span>the hungriest hole</span></div>' +
        '<div class="cs-tile"><b>' + within10 + '</b><span>other courses within 10 miles</span></div>' +
        '<div class="cs-tile"><b>' + (near[0] ? near[0].d.toFixed(1) + ' mi' : '–') + '</b><span>to the nearest other course</span></div></section>' +
        '<section class="cs-grid"><div class="cs-main"><div class="cs-card cs-board"><div class="cs-head"><h2>The ace board</h2><a href="/play/aces/">From the Ace Register</a></div>' +
        boardRows([]) + '<div class="cs-ctas"><a class="cs-btn" href="/play/aces/?c=' + encodeURIComponent(c.id) + '#log">Log an ace here</a><button type="button" class="cs-btn cs-ghost" id="cs-share">Share the board with the club</button></div></div>' +
        '<form class="cs-card cs-calc" id="cs-calc" onsubmit="return false"><div class="cs-calc-copy"><span class="cs-kick">YOUR SHOTS HERE</span><b>How many shots do you get at ' + esc(c.n) + '?</b>' +
        '<span>Pop in your handicap index and the slope rating from the scorecard.</span></div><div class="cs-calc-box"><div class="cs-calc-in"><label>Your index<input id="cs-i" type="number" inputmode="decimal" step="0.1" value="14.2"></label>' +
        '<label>Slope<input id="cs-s" type="number" inputmode="numeric" value="125"></label></div><div class="cs-calc-out"><b id="cs-ch">16</b><span>shots, before the course rating and par adjustment</span></div>' +
        '<a href="/improve/course-handicap-calculator/">The exact figure, with course rating and par &rarr;</a></div></form></div>' +
        '<div class="cs-side"><div class="cs-card"><h2>Golf societies near ' + esc(c.t || 'here') + '</h2><p class="cs-text">Looking for regular golf without a club membership? Find a society open to new members, or start your own free with Society HQ.</p>' +
        '<div class="cs-links"><a href="/societies/find/">Find a Society &rarr;</a><a href="/societies/">Run your own society free &rarr;</a></div></div>' +
        '<div class="cs-card"><h2>Nearby courses</h2><div class="cs-near">' + (near.slice(0, 5).map(function (x) {
          return '<a href="' + href(x.o, d.pages) + '"><span>' + esc(x.o.n) + '</span><span class="cs-date">' + x.d.toFixed(1) + ' mi</span></a>';
        }).join('') || '<p class="cs-empty">No other courses within 30 miles.</p>') + '</div></div></div></section>' +
        '<section class="cs-kit"><div><b>Playing ' + esc(c.n) + ' soon?</b><span>Balls, gloves and waterproofs at the lowest prices we’ve tracked, checked every 6 hours across multiple UK retailers.</span></div>' +
        '<div class="cs-kit-links"><a href="/prices/start-golf/">New to golf? Full kit</a><a href="/prices/golf-balls/">Golf balls</a><a href="/prices/golf-gloves/">Gloves</a><a href="/prices/golf-jackets/">Waterproofs</a></div></section>' +
        '<p class="cs-attr">Course location © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL). Not affiliated with ' + esc(c.n) + '.</p>';
      wire(any);
    }).catch(function () { any.innerHTML = '<p class="cs-empty">We couldn’t load the course list. Please refresh in a minute.</p>'; });
  }

  /* ------------------------------------------------ the hub */
  var q = $('cs-q');
  if (!q) return;
  var list = $('cs-list'), results = $('cs-results'), items = [], active = -1;
  function draw() {
    load().then(function (d) {
      var words = norm(q.value).split(' ').filter(Boolean);
      if (!words.length) { list.hidden = true; q.setAttribute('aria-expanded', 'false'); return; }
      items = d.courses.filter(function (c) { return words.every(function (w) { return c._k.indexOf(w) !== -1; }); })
        .sort(function (a, b) { return (b._k.indexOf(norm(q.value)) === 0) - (a._k.indexOf(norm(q.value)) === 0) || a.n.length - b.n.length; }).slice(0, 8);
      list.innerHTML = items.length ? items.map(function (c, i) {
        return '<li role="option" data-i="' + i + '"' + (i === active ? ' aria-selected="true"' : '') + '><a href="' + href(c, d.pages) + '"><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></a></li>';
      }).join('') : '<li class="cs-none">No match yet. Try fewer words, or the town.</li>';
      list.hidden = false; q.setAttribute('aria-expanded', 'true');
    });
  }
  q.addEventListener('input', function () { active = -1; draw(); });
  q.addEventListener('keydown', function (e) {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); var a = list.querySelector('[data-i="' + active + '"] a'); if (a) location.href = a.href; }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  q.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; }, 200); });

  function show(title, rows) {
    results.innerHTML = '<div class="cs-card"><div class="cs-head"><h2>' + esc(title) + '</h2><button type="button" class="cs-link" id="cs-close">Close</button></div><div class="cs-cols">' + rows + '</div></div>';
    results.hidden = false;
    $('cs-close').addEventListener('click', function () { results.hidden = true; history.replaceState(null, '', '/courses/'); });
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('cs-me').addEventListener('click', function () {
    var btn = this;
    if (!navigator.geolocation) { show('Courses near you', '<p class="cs-empty">Your browser can’t share a location. Try searching by town instead.</p>'); return; }
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      var me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      load().then(function (d) {
        var near = d.courses.map(function (c) { return { d: miles(me, c), c: c }; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 12);
        show('Courses near you', near.map(function (x) { return '<a href="' + href(x.c, d.pages) + '"><span>' + esc(x.c.n) + '<small>' + esc(x.c.t || '') + '</small></span><span class="cs-date">' + x.d.toFixed(1) + ' mi</span></a>'; }).join(''));
      });
    }, function () { btn.disabled = false; show('Courses near you', '<p class="cs-empty">We didn’t get your location. Try searching by course name or town instead.</p>'); }, { timeout: 10000, maximumAge: 600000 });
  });
  function nation(n) {
    load().then(function (d) {
      var cs = d.courses.filter(function (c) { return c.c === n; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
      show('Golf courses in ' + n + ' (' + cs.length.toLocaleString('en-GB') + ')', cs.map(function (c) { return '<a href="' + href(c, d.pages) + '"><span>' + esc(c.n) + '<small>' + esc(c.t || '') + '</small></span></a>'; }).join(''));
    });
  }
  document.querySelectorAll('[data-nation]').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); history.replaceState(null, '', a.getAttribute('href')); nation(a.getAttribute('data-nation')); });
  });
  if (location.hash === '#near') $('cs-me').click();
  var nq = new URLSearchParams(location.search).get('nation');
  if (nq) nation(nq);

  api('/ace/latest').then(function (r) {
    var el = $('cs-latest');
    if (!r || !r.ok || !r.latest || !r.latest.length) { el.innerHTML = '<p class="cs-empty">No aces on the register yet. Yours could be the first.</p>'; return; }
    load().then(function (d) {
      var by = {}; d.courses.forEach(function (c) { by[c.id] = c; });
      el.innerHTML = r.latest.slice(0, 6).map(function (a) {
        var c = by[a.course];
        return '<a href="' + (c ? href(c, d.pages) : '/play/aces/?c=' + encodeURIComponent(a.course)) + '"><span>' + esc(a.cname) + '<small>the ' + ord(a.hole) + ' · ' + esc(a.nick) + '</small></span><span class="cs-date">' + short(a.day) + '</span></a>';
      }).join('');
    });
  }).catch(function () { $('cs-latest').innerHTML = '<p class="cs-empty">The register is taking a breather.</p>'; });
})();
