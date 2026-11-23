/* Homepage v2 (John, 21 Nov 2026). The page ships with a snapshot of today's deal and drops
   written into the HTML (so search engines and AI apps see real content); this script refreshes
   them from the 6-hourly data, runs the drop filters, the seasonal banner and the game clips.
   The tile counts ("2,058 drops") are filled by js/app.js from data/curated-views.json. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var gbp = function (n) { n = Number(n); return '£' + (n % 1 ? n.toFixed(2) : n.toLocaleString('en-GB')); };
  var TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

  function spark(series) {
    var v = (series || []).map(function (p) { return Number(p[1]); }).filter(function (x) { return x > 0; });
    if (v.length < 2) return '';
    var hi = Math.max.apply(null, v), lo = Math.min.apply(null, v), span = hi - lo || 1;
    var pts = v.map(function (x, i) { return (i / (v.length - 1) * 200).toFixed(1) + ',' + (4 + (hi - x) / span * 20).toFixed(1); }).join(' ');
    return '<svg class="hm-spark" viewBox="0 0 200 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="#3cb43c" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>';
  }
  function badge(d) { return d.lowest && d.days ? '<span class="hm-badge">' + TICK + 'Lowest in ' + d.days + ' days</span>' : ''; }
  function shops(n) { return n > 1 ? 'Compared across ' + n + ' UK retailers' : 'Lowest UK price we track'; }
  function card(d) {
    return '<a class="hm-pc" href="/prices/' + esc(d.slug) + '/" data-group="' + esc(d.group) + '" data-type="' + esc(d.type) + '">' +
      '<span class="hm-pc-im"><img src="' + esc(d.image) + '" alt="' + esc(d.name) + '" loading="lazy" width="232" height="140">' + badge(d) + '</span>' +
      '<span class="hm-pc-bd" style="display:block"><span class="hm-pc-br">' + esc(d.brand) + '</span><h3>' + esc(d.name.replace(new RegExp('^' + (d.brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i'), '')) + '</h3>' +
      '<span class="hm-pc-row"><span class="hm-pc-p">' + gbp(d.now) + '</span>' + (d.save ? '<span class="hm-pc-d">' + gbp(Math.round(d.save)) + ' under its high</span>' : '') + '</span>' +
      spark(d.series) + '<span class="hm-pc-r">' + shops(d.retailers) + '</span></span></a>';
  }

  // today's deal and drops
  fetch('/data/home-deals.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (data) {
    if (!data || !data.deals || !data.deals.length) return;
    var deals = data.deals, f = deals.filter(function (d) { return d.slug === data.featured; })[0] || deals[0];
    var box = document.getElementById('hm-deal');
    if (box && f) {
      box.querySelector('[data-deal="img"]').innerHTML = '<img src="' + esc(f.image) + '" alt="' + esc(f.name) + '" width="300" height="300">';
      box.querySelector('[data-deal="badge"]').innerHTML = badge(f);
      box.querySelector('[data-deal="name"]').textContent = f.name;
      box.querySelector('[data-deal="price"]').textContent = gbp(f.now);
      box.querySelector('[data-deal="sub"]').textContent = shops(f.retailers).replace('Compared', 'compared');
      box.querySelector('[data-deal="date"]').textContent = 'Updated ' + new Date(data.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      box.querySelector('.hm-deal-btn').href = '/prices/' + f.slug + '/';
    }
    var rail = document.getElementById('hm-rail');
    if (rail) rail.innerHTML = deals.filter(function (d) { return d !== f; }).map(card).join('');
    filter(current);
  }).catch(function () { /* the snapshot in the page stays */ });

  // drop filters
  var current = 'all';
  var MATCH = {
    all: function () { return true; },
    clubs: function (el) { return el.dataset.group === 'clubs'; },
    balls: function (el) { return el.dataset.type === 'ball'; },
    tech: function (el) { return el.dataset.group === 'tech'; },
    bags: function (el) { return el.dataset.type === 'bag'; }
  };
  function filter(key) {
    current = key;
    document.querySelectorAll('.hm-fc').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.f === key ? 'true' : 'false'); });
    var shown = 0;
    document.querySelectorAll('#hm-rail .hm-pc').forEach(function (el) { var ok = MATCH[key](el); el.hidden = !ok; if (ok) shown++; });
    var rail = document.getElementById('hm-rail');
    if (rail) rail.scrollLeft = 0;
  }
  document.querySelectorAll('.hm-fc').forEach(function (b) { b.addEventListener('click', function () { filter(b.dataset.f); }); });

  // seasonal banner: Black Friday 1 Nov to 1 Dec, Christmas 2 to 24 Dec, Boxing Day 25 Dec to 10 Jan,
  // winter golf in October and 11 Jan to end of Feb; hidden the rest of the year. Preview with ?season=
  (function () {
    var a = document.getElementById('hm-season'); if (!a) return;
    var now = new Date(), y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    var season = (location.search.match(/[?&]season=(bf|xmas|boxing|winter)/) || [])[1];
    if (!season) {
      if (m === 11 || (m === 12 && d <= 1)) season = 'bf';
      else if (m === 12 && d >= 2 && d <= 24) season = 'xmas';
      else if ((m === 12 && d >= 25) || (m === 1 && d <= 10)) season = 'boxing';
      else if (m === 10 || m === 1 || m === 2) season = 'winter';
    }
    if (!season) { a.hidden = true; return; }
    var c = {
      bf: ['Black Friday: real deals only', 'Checked against October prices, so the real ones stand out.', 'See what’s really cheaper', '/prices/black-friday/', 'black-friday'],
      xmas: ['Golf gifts at their lowest price', 'Gift ideas from under £25, with live UK prices.', 'Find a gift', '/prices/christmas/', 'christmas'],
      boxing: ['Boxing Day sales: is it really cheaper?', 'Every sale price compared with early December.', 'See the real deals', '/prices/boxing-day-sales/', 'boxing-day'],
      winter: ['Winter golf: stay dry, keep playing', 'Waterproofs, thermals and gloves at live UK prices.', 'Gear up for winter', '/prices/winter-golf/', 'winter-frost']
    }[season];
    a.querySelector('b').textContent = c[0];
    a.querySelector('small').textContent = c[1];
    a.querySelector('em').textContent = c[2] + ' →';
    a.href = c[3];
    a.style.backgroundImage = 'url(/assets/photos/' + c[4] + '.jpg)';
    a.hidden = false;
  })();

  // game clips play only while on screen (saves data and battery)
  var vids = document.querySelectorAll('.hm-game video');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { var v = e.target; if (e.isIntersecting) { if (v.preload !== 'auto') v.preload = 'auto'; var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause(); });
    }, { rootMargin: '120px' });
    vids.forEach(function (v) { io.observe(v); });
  }
})();
