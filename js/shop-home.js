/* The Shop (/shop/): fills the live parts from the 6-hourly data files.
   data/home-deals.json: biggest genuine drop + lowest-tracked picks.
   data/curated-views.json: genuine drop counts and product totals.
   If a file fails, the page still works: the cards just stay hidden. */
(function () {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function gbp(n) { n = Number(n); return '£' + (n % 1 ? n.toFixed(2) : n.toLocaleString('en-GB')); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(n) { return Number(n).toLocaleString('en-GB'); }
  function d(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function day(s) { var x = d(s); return x.getDate() + ' ' + MONTHS[x.getMonth()].slice(0, 3); }

  // Step line of the price history, scaled to the box.
  function line(series, w, h, pad) {
    if (!series || series.length < 2) return '';
    var t0 = d(series[0][0]).getTime(), t1 = d(series[series.length - 1][0]).getTime() || t0 + 1;
    var ps = series.map(function (r) { return r[1]; });
    var lo = Math.min.apply(null, ps), hi = Math.max.apply(null, ps);
    var span = hi - lo || 1, xs = t1 - t0 || 1, pts = [], prevY = null;
    series.forEach(function (r) {
      var x = ((d(r[0]).getTime() - t0) / xs) * w;
      var y = pad + (1 - (r[1] - lo) / span) * (h - pad * 2);
      if (prevY !== null) pts.push(x.toFixed(1) + ',' + prevY.toFixed(1));
      pts.push(x.toFixed(1) + ',' + y.toFixed(1));
      prevY = y;
    });
    return { pts: pts.join(' '), endY: prevY };
  }
  // When did it first sit at its old ("was") price?
  function wasSince(x) {
    var s = (x.series || []).filter(function (r) { return r[1] === x.was; })[0];
    return s ? MONTHS[d(s[0]).getMonth()] : null;
  }
  function link(x) { return '/prices/' + x.slug + '/?utm_source=shop'; }

  function featured(x) {
    var box = document.getElementById('sh-feat');
    if (!box || !x) return;
    var l = line(x.series, 420, 110, 14);
    var since = wasSince(x);
    box.href = link(x);
    box.classList.remove('is-loading');
    box.innerHTML =
      '<span class="sh-feat-kick">BIGGEST GENUINE DROP TODAY</span>' +
      '<b class="sh-feat-name">' + esc(x.name) + '</b>' +
      '<div class="sh-feat-price"><b>' + gbp(x.now) + '</b>' + (x.save ? '<span>−' + gbp(x.save) + '</span>' : '') + '</div>' +
      (l ? '<svg viewBox="0 0 420 110" preserveAspectRatio="none" role="img" aria-label="Price history: ' + (x.was ? gbp(x.was) + ' down to ' : '') + gbp(x.now) + '">' +
        '<line x1="0" x2="420" y1="96" y2="96" stroke="rgba(255,255,255,.12)"/>' +
        '<polyline points="' + l.pts + '" fill="none" stroke="#5fd14a" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>' : '') +
      '<div class="sh-feat-meta"><span>' + (x.was && since ? gbp(x.was) + ' in ' + since : '') + '</span><span>' +
        (x.dropDate ? day(x.dropDate) + ': ' + gbp(x.now) : '') + (x.lowest ? ', lowest we’ve tracked' : '') + '</span></div>' +
      '<span class="sh-feat-go">' + (x.retailers > 1 ? 'Compare ' + x.retailers + ' retailers →' : 'See the price →') + '</span>';
  }

  function card(x) {
    var l = line(x.series, 220, 44, 6);
    var since = wasSince(x);
    var gap = x.save ? gbp(x.save) + (since ? ' less than in ' + since : ' off') : '';
    return '<a class="sh-card" href="' + link(x) + '">' +
      (x.image ? '<img src="' + esc(x.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
      '<span class="sh-tag">' + (x.lowest ? 'Lowest we’ve tracked' : 'Genuine drop') + '</span>' +
      '<span class="sh-card-type">' + esc(x.label || x.type) + '</span>' +
      '<span class="sh-card-name">' + esc(x.name) + '</span>' +
      '<span class="sh-card-price"><b>' + gbp(x.now) + '</b>' + (gap ? '<span>' + gap + '</span>' : '') + '</span>' +
      (l ? '<svg viewBox="0 0 220 44" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + l.pts + '" fill="none" stroke="#3fae29" stroke-width="2.4" vector-effect="non-scaling-stroke"/></svg>' : '') +
      '<span class="sh-card-foot">' + x.retailers + ' retailer' + (x.retailers === 1 ? '' : 's') + ' · <em>' + (x.retailers > 1 ? 'compare' : 'see price') + ' →</em></span></a>';
  }

  fetch('/data/home-deals.json').then(function (r) { return r.json(); }).then(function (data) {
    var deals = (data.deals || []).filter(function (x) { return x.save > 0; });
    var top = deals.slice().sort(function (a, b) { return b.save - a.save; })[0];
    featured(top);
    // Four cards: lowest tracked first, one per kind of kit where possible.
    var pool = deals.filter(function (x) { return x !== top; }).sort(function (a, b) { return (b.lowest - a.lowest) || (b.pct - a.pct); });
    var picked = [], types = {}, brands = {};
    pool.forEach(function (x) { if (picked.length < 4 && !types[x.type] && !brands[x.brand]) { picked.push(x); types[x.type] = brands[x.brand] = 1; } });
    pool.forEach(function (x) { if (picked.length < 4 && picked.indexOf(x) < 0) picked.push(x); });
    var grid = document.getElementById('sh-cards');
    if (grid && picked.length) { grid.innerHTML = picked.map(card).join(''); document.getElementById('sh-lowest').hidden = false; }
  }).catch(function () {
    var box = document.getElementById('sh-feat');
    if (box) box.hidden = true;
  });

  fetch('/data/curated-views.json').then(function (r) { return r.json(); }).then(function (data) {
    var st = (data.home || {}).stats || {}, g = st.genuineDrops || {}, total = 0;
    Object.keys(g).forEach(function (k) {
      total += g[k] || 0;
      document.querySelectorAll('.sh-pill[data-drops="' + k + '"]').forEach(function (el) { el.textContent = fmt(g[k]) + ' genuine drops'; el.hidden = false; });
    });
    var p = document.getElementById('sh-products');
    if (p && st.products) p.textContent = fmt(st.products);
    var t = document.getElementById('sh-drops');
    if (t && total) { t.textContent = fmt(total); t.parentNode.hidden = false; }
  }).catch(function () {});

  // The Bag Draft card: say when the next one opens.
  var bd = document.getElementById('sh-draft-when');
  if (bd) {
    var now = new Date();
    if (now < new Date(2026, 10, 1)) bd.textContent = 'The Black Friday Open starts 1 November.';
    else if (now.getDate() <= 7) bd.textContent = 'Drafting is open until the 7th.';
    else bd.textContent = 'Bags are sealed. Next draft opens on the 1st.';
  }
})();
