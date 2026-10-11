/* "Is this a good price?" checker (price-check.html).
   Uses two files the 6-hourly update already writes: data/search-suggest.json
   (model names, with the price-page slug as the 5th field) and each model's
   /prices/<slug>/data.json (today's lowest price, tracked low/high/average and
   the price series). Nothing is stored; a link like
   price-check.html?m=titleist-pro-v1-golf-balls&p=45 reopens a result. */
(function () {
  var form = document.getElementById('pc-form');
  var q = document.getElementById('pc-q');
  var pInput = document.getElementById('pc-p');
  var list = document.getElementById('pc-list');
  var out = document.getElementById('pc-result');
  var models = [], picked = null, active = -1;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function niceDate(iso) {
    var d = iso ? new Date(iso + 'T12:00:00') : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  function norm(s) { return s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim(); }

  var ready = fetch('/data/search-suggest.json').then(function (r) { return r.json(); }).then(function (d) {
    models = (d.m || []).filter(function (m) { return m[4]; })
      .map(function (m) { return { name: m[0], slug: m[4], n: m[2] || 0, lc: norm(m[0]) }; });
  }).catch(function () { models = []; });

  function search(text) {
    var t = norm(text).split(' ').filter(Boolean);
    if (!t.length) return [];
    var hits = models.filter(function (m) {
      var words = m.lc.split(' ');
      return t.every(function (w) { return words.some(function (x) { return x.indexOf(w) === 0; }) || (w.length > 3 && m.lc.indexOf(w) !== -1); });
    });
    var phrase = t.join(' ');
    hits.sort(function (a, b) {
      return ((b.lc.indexOf(phrase) !== -1) - (a.lc.indexOf(phrase) !== -1)) || (b.n - a.n) || (a.name.length - b.name.length);
    });
    return hits.slice(0, 8);
  }

  function showList(items) {
    active = -1;
    if (!items.length) {
      list.innerHTML = q.value.trim().length > 1 ? '<li class="pc-none">No price page for that yet. Try the model name, e.g. “Qi35 driver”.</li>' : '';
      list.hidden = !list.innerHTML;
      return;
    }
    list.innerHTML = items.map(function (m, i) {
      return '<li role="option" id="pc-o' + i + '" data-slug="' + esc(m.slug) + '">' + esc(m.name) + '</li>';
    }).join('');
    list.hidden = false;
  }

  function choose(slug, name) {
    picked = { slug: slug, name: name };
    q.value = name;
    list.hidden = true;
    pInput.focus();
  }

  q.addEventListener('input', function () {
    picked = null;
    ready.then(function () { showList(search(q.value)); });
  });
  q.addEventListener('keydown', function (e) {
    var items = list.querySelectorAll('li[data-slug]');
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach(function (li, i) { li.classList.toggle('is-active', i === active); });
      q.setAttribute('aria-activedescendant', 'pc-o' + active);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(items[active].getAttribute('data-slug'), items[active].textContent);
    } else if (e.key === 'Escape') { list.hidden = true; }
  });
  list.addEventListener('mousedown', function (e) {
    var li = e.target.closest('li[data-slug]');
    if (li) { e.preventDefault(); choose(li.getAttribute('data-slug'), li.textContent); }
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.pc-product')) list.hidden = true; });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ready.then(function () {
      if (!picked) {
        var best = search(q.value)[0];
        if (!best) { render(null); return; }
        picked = { slug: best.slug, name: best.name };
        q.value = best.name;
      }
      check(picked.slug, parseFloat(pInput.value));
    });
  });

  function sparkline(series) {
    if (!series || series.length < 2) return '';
    var pts = series.map(function (s) { return [new Date(s[0]).getTime(), s[1]]; });
    pts.push([Date.now(), pts[pts.length - 1][1]]);
    var x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    var ys = pts.map(function (p) { return p[1]; }), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    var W = 300, H = 60;
    var path = '', prevY = null;
    pts.forEach(function (p, i) {
      var x = ((p[0] - x0) / (x1 - x0 || 1)) * W, y = H - 4 - ((p[1] - y0) / (y1 - y0)) * (H - 8);
      path += (i ? ' H' + x.toFixed(1) + ' V' + y.toFixed(1) : 'M0 ' + y.toFixed(1));
      prevY = y;
    });
    return '<svg class="pc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + path + '" fill="none" stroke="#3fae29" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>';
  }

  function verdict(p, d) {
    var h = d.history || {}, now = d.lowestNewPrice, low = h.low != null ? Math.min(h.low, now) : now, avg = h.average || now;
    var where = (d.lowestAt || []).join(' and ');
    var unit = d.unit === 'per dozen' ? ' a dozen' : '';
    if (isNaN(p) || p <= 0) return null;
    if (p < low * 0.9) return ['check', 'Unusually cheap: check it first',
      'That’s ' + money(low - p) + ' below the lowest new price we’ve ever tracked (' + money(low) + unit + '). It could be a genuine bargain, but check it’s new, the right spec and from a seller you trust.'];
    if (p < low - 0.005) return ['good', 'Excellent price',
      'That’s ' + money(low - p) + ' below the lowest new price we’ve tracked in ' + (h.daysTracked || 0) + ' days (' + money(low) + unit + ').'];
    if (p <= low + 0.005) return ['good', 'Excellent price',
      'That matches the lowest new price we’ve tracked in ' + (h.daysTracked || 0) + ' days (' + money(low) + unit + ').'];
    if (p <= now + 0.005) return ['good', 'Good price',
      'That’s at or below today’s best new price at the UK retailers we track (' + money(now) + unit + (where ? ' at ' + esc(where) : '') + ').'];
    if (p <= avg + 0.005) return ['fair', 'Fair, but you can do better today',
      'It’s below its usual price (' + money(avg) + unit + ' on average), but it’s ' + money(p - now) + ' cheaper today' + (where ? ' at ' + esc(where) : '') + '.'];
    return ['high', 'High price',
      'That’s ' + money(p - now) + ' more than today’s lowest new price (' + money(now) + unit + (where ? ' at ' + esc(where) : '') + '), and above its usual ' + money(avg) + '.'];
  }

  function render(d, slug, p) {
    out.hidden = false;
    if (!d) {
      out.innerHTML = '<div class="pp-card pc-card"><p>We couldn’t find a price page for that. Try the model name, for example “Pro V1” or “Qi35 driver”, and pick it from the list.</p></div>';
      return;
    }
    var h = d.history || {}, unit = d.unit === 'per dozen' ? ' per dozen' : '';
    var v = verdict(p, d);
    var vHtml = v ? '<div class="pc-verdict pc-' + v[0] + '"><strong>' + v[1] + '</strong><span>' + v[2] + '</span></div>'
      : '<div class="pc-verdict pc-none"><strong>' + esc((d.verdict && d.verdict.summary) || 'Today’s prices') + '</strong><span>Add the price you’ve seen above to get a verdict on it.</span></div>';
    out.innerHTML =
      '<div class="pp-card pc-card">' +
      '<h2>' + esc(d.name) + '</h2>' + vHtml +
      '<div class="pc-stats">' +
      '<div><span>Lowest new price today</span><strong>' + money(d.lowestNewPrice) + unit + '</strong><em>' + esc((d.lowestAt || []).join(', ')) + '</em></div>' +
      '<div><span>Lowest we’ve tracked</span><strong>' + money(Math.min(h.low != null ? h.low : d.lowestNewPrice, d.lowestNewPrice)) + '</strong><em>in ' + (h.daysTracked || 0) + ' days</em></div>' +
      '<div><span>Average</span><strong>' + money(h.average || d.lowestNewPrice) + '</strong><em>highest ' + money(h.high || d.lowestNewPrice) + '</em></div>' +
      '</div>' + sparkline(h.series) +
      '<div class="pc-actions"><a class="pp-btn" href="/prices/' + esc(slug) + '/">See every retailer and the full history</a>' +
      '<a class="pp-btn pp-btn-alt" href="/prices/' + esc(slug) + '/#price-alert">Email me when it drops</a></div>' +
      '<p class="pp-small">Prices checked ' + esc(niceDate(d.checked)) + ', every 6 hours. New stock only.</p></div>';
    out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function check(slug, p) {
    fetch('/prices/' + encodeURIComponent(slug) + '/data.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        render(d, slug, p);
        var url = '?m=' + encodeURIComponent(slug) + (isNaN(p) ? '' : '&p=' + p);
        try { history.replaceState(null, '', url); } catch (e) {}
        if (window.gtag) gtag('event', 'price_check', { model: slug, has_price: !isNaN(p) });
      })
      .catch(function () { render(null); });
  }

  // Reopen a shared link.
  var params = new URLSearchParams(location.search);
  if (params.get('m')) {
    var slug = params.get('m'), p = parseFloat(params.get('p'));
    if (!isNaN(p)) pInput.value = p;
    ready.then(function () {
      var m = models.filter(function (x) { return x.slug === slug; })[0];
      if (m) { picked = { slug: m.slug, name: m.name }; q.value = m.name; }
      check(slug, p);
    });
  }
})();
