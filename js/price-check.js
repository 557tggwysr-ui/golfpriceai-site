/* "Is this a good price?" checker (price-check.html), new and used.
   Uses files the 6-hourly update already writes: data/search-suggest.json
   (model names, with the price-page slug as the 5th field), each model's
   /prices/<slug>/data.json (today's lowest new price, tracked low/high/average
   and the price series) and data/used-prices.json (pre-owned listings per
   model, built by scripts/used_prices.py, because data/search/ holds new
   stock only). Nothing is stored; a link like
   price-check.html?m=taylormade-qi10-driver&p=180&w=ebay&c=used reopens a result. */
(function () {
  var form = document.getElementById('pc-form');
  var q = document.getElementById('pc-q');
  var pInput = document.getElementById('pc-p');
  var list = document.getElementById('pc-list');
  var out = document.getElementById('pc-result');
  var models = [], picked = null, active = -1;

  // Where it's for sale, and the condition each one usually means.
  var WHERE = {
    online: { label: 'Online shop', cond: 'new' },
    pro: { label: 'Pro shop', cond: 'new' },
    ebay: { label: 'eBay', cond: 'used' },
    facebook: { label: 'Facebook Marketplace', cond: 'used' },
    mate: { label: 'A mate', cond: 'used' }
  };
  // Guide bands for a used price as a share of today's lowest new price,
  // used when we have fewer than 3 used listings for the model.
  var BAND_RECENT = [0.55, 0.80], BAND_OLDER = [0.35, 0.60];
  // Too good to be true: under this share of the lowest new price AND
  // well below (85% of) the low end of the fair used range.
  var TGTBT_RECENT = 0.50, TGTBT_OLDER = 0.30;
  var MIN_USED_LISTINGS = 3;
  var JUNIOR_RX = /\b(junior|juniors|jr|kids?|youth|ages? \d)/i;
  var WOMEN_RX = /\b(women'?s|womens|ladies|lady)\b/i;

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function round0(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }
  function niceDate(iso) {
    var d = iso ? new Date(iso + 'T12:00:00') : null;
    return d && !isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  }
  function norm(s) { return s.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim(); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }

  function radioVal(name) { var r = form.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; }
  function setRadio(name, val) { var r = form.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (r) r.checked = true; }

  var ready = fetch('/data/search-suggest.json').then(function (r) { return r.json(); }).then(function (d) {
    models = (d.m || []).filter(function (m) { return m[4]; })
      .map(function (m) { return { name: m[0], slug: m[4], n: m[2] || 0, lc: norm(m[0]), junior: m[1] === 'junior-set' || JUNIOR_RX.test(m[0]), women: WOMEN_RX.test(m[0]) }; });
  }).catch(function () { models = []; });

  var usedData = null;
  function loadUsed() {
    if (!usedData) usedData = fetch('/data/used-prices.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { return d.m || {}; }).catch(function () { return {}; });
    return usedData;
  }

  function search(text) {
    var t = norm(text).split(' ').filter(Boolean);
    if (!t.length) return [];
    var wantJunior = JUNIOR_RX.test(text);
    var hits = models.filter(function (m) {
      if (m.junior && !wantJunior) return false;
      var words = m.lc.split(' ');
      return t.every(function (w) { return words.some(function (x) { return x.indexOf(w) === 0; }) || (w.length > 3 && m.lc.indexOf(w) !== -1); });
    });
    var phrase = t.join(' ');
    hits.sort(function (a, b) {
      return ((b.lc.indexOf(phrase) !== -1) - (a.lc.indexOf(phrase) !== -1)) || (a.women - b.women) || (b.n - a.n) || (a.name.length - b.name.length);
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

  // Picking where it's sold sets New / Used to the usual one; either can be changed.
  form.addEventListener('change', function (e) {
    if (e.target.name === 'pc-w' && WHERE[e.target.value]) setRadio('pc-c', WHERE[e.target.value].cond);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ready.then(function () {
      if (!picked) {
        var best = search(q.value)[0];
        if (!best) { render(null); return; }
        picked = { slug: best.slug, name: best.name };
        q.value = best.name;
      }
      check(picked.slug, parseFloat(pInput.value), radioVal('pc-w') || 'online', radioVal('pc-c') || 'new');
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
    var path = '';
    pts.forEach(function (p, i) {
      var x = ((p[0] - x0) / (x1 - x0 || 1)) * W, y = H - 4 - ((p[1] - y0) / (y1 - y0)) * (H - 8);
      path += (i ? ' H' + x.toFixed(1) + ' V' + y.toFixed(1) : 'M0 ' + y.toFixed(1));
    });
    return '<svg class="pc-spark" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true"><path d="' + path + '" fill="none" stroke="#3fae29" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>';
  }

  // ------------------------------------------------------------ new prices
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

  // Extra line for where it's sold, under a new-price verdict.
  function newNote(p, d, w) {
    if (isNaN(p) || p <= 0) return '';
    var now = d.lowestNewPrice, gap = p - now;
    if (w === 'pro') {
      if (gap > 0.5) return '<p class="pc-note">Your pro is ' + round0(gap) + ' above the lowest online price. Worth asking if they’ll match it: plenty will, and you keep the fitting, the advice and someone to complain to about your slice.</p>';
      return '<p class="pc-note">That’s as good as or better than the lowest online price. Your pro is looking after you: buy local with a clear conscience.</p>';
    }
    if (w !== 'online') return '<p class="pc-note">Buying new from a private seller usually means no retailer warranty or returns, so ask for the receipt.</p>';
    return '';
  }

  // ----------------------------------------------------------- used prices
  function modelAge(name) {
    var m = /\b(20[0-3]\d)\b/.exec(name || '');
    return m ? new Date().getFullYear() - parseInt(m[1], 10) : null;
  }

  // The fair used range: from our used listings when we have 3+, else a guide band.
  function usedRange(d, entry) {
    var now = d.lowestNewPrice, age = modelAge(d.name), recent = age == null || age < 3;
    var band = recent ? BAND_RECENT : BAND_OLDER;
    var r = { recent: recent, n: entry ? entry[0] : 0, tgtbt: recent ? TGTBT_RECENT : TGTBT_OLDER };
    if (entry && entry[0] >= MIN_USED_LISTINGS) {
      r.basis = 'listings';
      r.low = Math.min(entry[3], now * 0.95);
      r.high = Math.min(Math.max(entry[5], r.low), now * 0.95);
      r.mid = Math.min(Math.max(entry[4], r.low), r.high);
    } else {
      r.basis = 'estimate';
      r.low = now * band[0]; r.high = now * band[1]; r.mid = (r.low + r.high) / 2;
      r.band = band;
    }
    return r;
  }

  function usedVerdict(p, d, r, w) {
    var now = d.lowestNewPrice;
    if (isNaN(p) || p <= 0) return null;
    var tooGood = p < now * r.tgtbt && p < r.low * 0.85;
    var mate = w === 'mate' ? ' Mates’ rates confirmed.' : '';
    var rng = (r.basis === 'estimate' ? 'estimated' : 'usual') + ' used range (' + round0(r.low) + '–' + round0(r.high) + ')';
    if (tooGood) return { k: 'check', tooGood: true, t: 'A lot cheaper than usual',
      s: 'That’s ' + Math.round((1 - p / now) * 100) + '% below today’s lowest new price, and well under the ' + rng + '. It may be fine, but check it properly before you pay.' };
    if (p < r.low) return { k: 'good', t: 'Cheap for used',
      s: 'That’s ' + round0(r.low - p) + ' below the ' + rng + '. A good find, as long as the condition matches the photos.' + mate };
    if (p <= r.mid + 0.005) return { k: 'good', t: 'Good used price',
      s: 'That’s in the lower half of the ' + rng + '.' + mate };
    if (p <= r.high + 0.005) return { k: 'fair', t: 'Fair used price',
      s: 'That’s in the ' + rng + ', towards the top end. There may be room for a polite haggle.' };
    if (p < now) return { k: 'high', t: 'High for used',
      s: 'That’s ' + round0(p - r.high) + ' above the ' + rng + ', and only ' + round0(now - p) + ' under the lowest new price.' };
    return { k: 'high', t: 'More than buying new',
      s: 'That’s ' + (p - now > 0.5 ? round0(p - now) + ' more than' : 'the same as') + ' today’s lowest new price (' + money(now) + '). Unless it’s something special, buy it new.' };
  }

  function rangeBar(p, now, r) {
    var max = Math.max(now, isNaN(p) ? 0 : p) * 1.08;
    function pos(x) { return Math.max(0, Math.min(100, x / max * 100)).toFixed(1) + '%'; }
    var mark = !isNaN(p) && p > 0 ? '<span class="pc-bar-you" style="left:' + pos(p) + '"><b>You</b></span>' : '';
    return '<div class="pc-bar" aria-hidden="true"><div class="pc-bar-track">' +
      '<span class="pc-bar-band' + (r.basis === 'estimate' ? ' is-est' : '') + '" style="left:' + pos(r.low) + ';width:calc(' + pos(r.high) + ' - ' + pos(r.low) + ')"></span>' +
      '<span class="pc-bar-new" style="left:' + pos(now) + '"><b>New</b></span>' + mark + '</div></div>';
  }

  function warnBox(d) {
    var kit = /driver|wood|hybrid|iron|wedge|putter|package set/i.test(d.type || '') ? 'clubs' : 'kit';
    return '<div class="pc-warn" role="note"><h3>Before you pay</h3>' +
      '<p>This is a lot cheaper than usual. Fakes and stolen ' + kit + ' are often priced like this.</p><ul>' +
      '<li>Check the seller’s history and reviews.</li>' +
      '<li>Ask for the serial number and a clear photo of it.</li>' +
      '<li>Compare the fonts, ferrule and paint with the brand’s official photos.</li>' +
      '<li>Pay with a method that has buyer protection.</li>' +
      '<li>Never pay by bank transfer to a stranger.</li></ul>' +
      '<a class="pp-btn pp-btn-alt pc-warn-link" href="https://www.immobilise.com/" target="_blank" rel="noopener">Check the serial on Immobilise, the national property register<span class="sr-only"> (opens in a new tab)</span></a></div>';
  }

  function renderUsed(d, slug, p, w, entry) {
    var now = d.lowestNewPrice, h = d.history || {}, r = usedRange(d, entry), v = usedVerdict(p, d, r, w);
    var vHtml = v ? '<div class="pc-verdict pc-' + v.k + '"><strong>' + v.t + '</strong><span>' + v.s + '</span></div>'
      : '<div class="pc-verdict pc-none"><strong>Fair used price: ' + round0(r.low) + '–' + round0(r.high) + '</strong><span>Add the price you’ve seen above to get a verdict on it.</span></div>';
    var basis = r.basis === 'listings'
      ? 'Based on ' + r.n + ' used and pre-owned listings we’re tracking at UK sellers.'
      : '<strong>This is an estimate.</strong> ' + (r.n ? 'We’re only tracking ' + r.n + ' used listing' + (r.n === 1 ? '' : 's') + ' for this model, so we' : 'We don’t have enough used listings for this model yet, so we') +
        ' use a guide: used ' + (r.recent ? 'recent models' : 'models a few years old') + ' typically sell for ' + Math.round(r.band[0] * 100) + '–' + Math.round(r.band[1] * 100) + '% of the lowest new price.';
    var gap = now - p, newLine = '';
    if (v && !v.tooGood && gap > 0.5 && (gap / now < 0.2 || (gap < 60 && gap / now < 0.35)))
      newLine = '<p class="pc-note pc-note-new">For ' + round0(gap) + ' more you can buy it new, with a warranty, from a UK retailer.</p>';
    out.innerHTML =
      '<div class="pp-card pc-card">' +
      '<p class="pc-tag">Used · ' + esc((WHERE[w] || WHERE.ebay).label) + '</p>' +
      '<h2>' + esc(d.name) + '</h2>' + vHtml + newLine + (v && v.tooGood ? warnBox(d) : '') +
      '<div class="pc-stats">' +
      '<div><span>Fair used range' + (r.basis === 'estimate' ? ' (estimate)' : '') + '</span><strong>' + round0(r.low) + '–' + round0(r.high) + '</strong><em>' + (r.basis === 'listings' ? r.n + ' listings' : 'guide band') + '</em></div>' +
      '<div><span>Lowest new price today</span><strong>' + money(now) + '</strong><em>at multiple UK retailers we track</em></div>' +
      '<div><span>Lowest new we’ve tracked</span><strong>' + money(Math.min(h.low != null ? h.low : now, now)) + '</strong><em>in ' + (h.daysTracked || 0) + ' days</em></div>' +
      '</div>' + rangeBar(p, now, r) +
      '<p class="pp-small pc-basis">' + basis + ' Condition matters: a tidy grip and clean face are worth more than a well-loved one.</p>' +
      '<div class="pc-actions"><a class="pp-btn" href="/prices/' + esc(slug) + '/">See new prices and the full history</a>' +
      '<a class="pp-btn pp-btn-alt" href="/prices/' + esc(slug) + '/#price-alert">Email me when the new price drops</a></div>' +
      '<p class="pp-small">New prices checked ' + esc(niceDate(d.checked)) + ', every 6 hours.</p></div>';
    return { basis: r.basis, tooGood: !!(v && v.tooGood) };
  }

  // ---------------------------------------------------------------- render
  function render(d, slug, p, w, c) {
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
      (w && w !== 'online' ? '<p class="pc-tag">New · ' + esc(WHERE[w].label) + '</p>' : '') +
      '<h2>' + esc(d.name) + '</h2>' + vHtml + newNote(p, d, w) +
      '<div class="pc-stats">' +
      '<div><span>Lowest new price today</span><strong>' + money(d.lowestNewPrice) + unit + '</strong><em>' + esc((d.lowestAt || []).join(', ')) + '</em></div>' +
      '<div><span>Lowest we’ve tracked</span><strong>' + money(Math.min(h.low != null ? h.low : d.lowestNewPrice, d.lowestNewPrice)) + '</strong><em>in ' + (h.daysTracked || 0) + ' days</em></div>' +
      '<div><span>Average</span><strong>' + money(h.average || d.lowestNewPrice) + '</strong><em>highest ' + money(h.high || d.lowestNewPrice) + '</em></div>' +
      '</div>' + sparkline(h.series) +
      '<div class="pc-actions"><a class="pp-btn" href="/prices/' + esc(slug) + '/">See every retailer and the full history</a>' +
      '<a class="pp-btn pp-btn-alt" href="/prices/' + esc(slug) + '/#price-alert">Email me when it drops</a></div>' +
      '<p class="pp-small">Prices checked ' + esc(niceDate(d.checked)) + ', every 6 hours. New stock only.</p></div>';
  }

  function check(slug, p, w, c) {
    w = WHERE[w] ? w : 'online';
    c = c === 'used' ? 'used' : 'new';
    var dataP = fetch('/prices/' + encodeURIComponent(slug) + '/data.json').then(function (r) { if (!r.ok) throw 0; return r.json(); });
    Promise.all([dataP, c === 'used' ? loadUsed() : null])
      .then(function (res) {
        var d = res[0], info = null;
        if (c === 'used') info = renderUsed(d, slug, p, w, res[1][slug]);
        else render(d, slug, p, w, c);
        out.hidden = false;
        out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        var url = '?m=' + encodeURIComponent(slug) + (isNaN(p) ? '' : '&p=' + p) + (w !== 'online' ? '&w=' + w : '') + (c !== WHERE[w].cond ? '&c=' + c : '');
        try { history.replaceState(null, '', url); } catch (e) {}
        track('price_check', { model: slug, has_price: !isNaN(p) });
        if (info) track('price_check_used', { model: slug, has_price: !isNaN(p), where: w, basis: info.basis, too_good: info.tooGood });
      })
      .catch(function () { render(null); });
  }

  // Reopen a shared link.
  var params = new URLSearchParams(location.search);
  if (params.get('m')) {
    var slug = params.get('m'), p = parseFloat(params.get('p'));
    var w = WHERE[params.get('w')] ? params.get('w') : 'online';
    var c = params.get('c') === 'used' || params.get('c') === 'new' ? params.get('c') : WHERE[w].cond;
    if (!isNaN(p)) pInput.value = p;
    setRadio('pc-w', w); setRadio('pc-c', c);
    ready.then(function () {
      var m = models.filter(function (x) { return x.slug === slug; })[0];
      if (m) { picked = { slug: m.slug, name: m.name }; q.value = m.name; }
      check(slug, p, w, c);
    });
  }
})();
