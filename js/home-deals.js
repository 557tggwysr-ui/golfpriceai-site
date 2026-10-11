/* Homepage "Today's genuine price drops": a Deal of the day plus six cards,
   with category chips. The picks come from data/home-deals.json, written by
   scripts/home_deals.py every 6 hours; this file only draws them. */
(function () {
  var feature = document.getElementById('deal-feature');
  var grid = document.getElementById('deal-grid');
  var chips = document.getElementById('deal-chips');
  if (!grid) return;
  var DATA = null, filter = 'all';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function day(d) { return Number(d.slice(8)) + ' ' + MONTHS[Number(d.slice(5, 7)) - 1]; }
  function short(d) { return d.brand && d.name.indexOf(d.brand + ' ') === 0 ? d.name.slice(d.brand.length + 1) : d.name; }

  function spark(d, h) {
    var today = DATA.date;
    var pts = (d.series || []).map(function (s) { return [Date.parse(s[0]), s[1]]; });
    pts.push([Date.parse(today), d.now]);
    if (pts.length < 2) return '';
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    var W = 200, path = '';
    pts.forEach(function (p, i) {
      var x = ((p[0] - x0) / (x1 - x0 || 1)) * (W - 4) + 2, y = h - 3 - ((p[1] - y0) / (y1 - y0)) * (h - 8);
      path += i ? ' H' + x.toFixed(1) + ' V' + y.toFixed(1) : 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
    });
    return '<svg class="gp-spark" viewBox="0 0 ' + W + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path d="' + path + ' V' + h + ' H2 Z" class="gp-spark-fill"/><path d="' + path + '" class="gp-spark-line"/></svg>';
  }

  function badge(d) {
    if (d.lowest) return '<span class="gp-deal-badge">Lowest in ' + d.days + ' days</span>';
    if (d.dropDate) return '<span class="gp-deal-badge is-cut">Price cut ' + day(d.dropDate) + '</span>';
    return '';
  }
  function photo(d) {
    return '<span class="gp-deal-photo">' + badge(d) +
      '<img src="' + esc(d.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'is-missing\');this.remove()">' +
      '<span class="gp-deal-ph">' + esc(d.brand) + '</span></span>';
  }
  function priceLine(d, big) {
    return '<span class="gp-deal-price"><strong>' + money(d.now) + (d.unit ? '<small>' + esc(d.unit) + '</small>' : '') + '</strong>' +
      (d.was ? '<span class="gp-deal-save">−' + money(d.save) + (big ? ' since ' + day(d.dropDate) : '') + '</span>' : '') + '</span>';
  }
  function card(d) {
    return '<a class="gp-deal-card" href="/prices/' + esc(d.slug) + '/" data-slug="' + esc(d.slug) + '">' + photo(d) +
      '<span class="gp-deal-body"><span class="gp-deal-brand">' + esc(d.brand) + '</span>' +
      '<span class="gp-deal-name">' + esc(short(d)) + '</span>' + priceLine(d, false) +
      '<span class="gp-deal-was">' + (d.was ? 'Was ' + money(d.was) + ' until ' + day(d.dropDate) : 'Lowest price in ' + d.days + ' days') + '</span>' +
      spark(d, 30) +
      '<span class="gp-deal-foot"><span>Cheapest of ' + d.retailers + ' retailer' + (d.retailers === 1 ? '' : 's') + '</span><b>Compare →</b></span></span></a>';
  }
  function featureCard(d) {
    var line = (d.lowest ? 'The lowest price in the ' + d.days + ' days we’ve tracked it' : 'Genuinely cheaper than it was') +
      ', at the cheapest of ' + d.retailers + ' UK retailer' + (d.retailers === 1 ? '' : 's') + '.';
    var series = d.series || [], first = series.length ? series[0] : null;
    var hi = Math.max.apply(null, series.map(function (s) { return s[1]; }).concat([d.now]));
    var chart = '<span class="gp-deal-chart"><span class="gp-deal-chart-head"><span>Lowest new UK price</span><span>' +
      (first ? 'since ' + day(first[0]) : '') + '</span></span>' + spark(d, 96) +
      '<span class="gp-deal-chart-foot"><span>High ' + money(hi) + '</span><span>Today <b>' + money(d.now) + '</b></span></span></span>';
    return '<a class="gp-deal-card gp-deal-feature" href="/prices/' + esc(d.slug) + '/" data-slug="' + esc(d.slug) + '">' + photo(d) +
      '<span class="gp-deal-body"><span class="gp-deal-info"><span class="gp-deal-kicker">Deal of the day</span><span class="gp-deal-brand">' + esc(d.brand) + '</span>' +
      '<span class="gp-deal-name">' + esc(short(d)) + '</span>' + priceLine(d, true) +
      '<span class="gp-deal-line">' + line + '</span>' +
      '<span class="gp-deal-cta">Compare all ' + d.retailers + ' prices →</span></span>' + chart + '</span></a>';
  }

  function render() {
    var list = DATA.deals.filter(function (d) { return filter === 'all' || d.group === filter; });
    var top = null;
    if (filter === 'all') top = DATA.deals.filter(function (d) { return d.slug === DATA.featured; })[0];
    if (!top) top = list.slice().sort(function (a, b) { return b.pct - a.pct; })[0];
    feature.innerHTML = top ? featureCard(top) : '';
    // Full rows only: 6 or 3 cards (3 across on desktop). On 2-across screens
    // an odd count drops its last card (see .is-odd in home.css).
    var rest = list.filter(function (d) { return d !== top; }).slice(0, 6);
    if (rest.length >= 3) rest = rest.slice(0, rest.length - rest.length % 3);
    grid.classList.toggle('is-odd', rest.length % 2 === 1);
    grid.innerHTML = rest.length ? rest.map(card).join('') :
      '<p class="gp-deals-empty">No other genuine drops in this category today. <a href="/prices/drops/">See every drop this week</a>.</p>';
  }

  fetch('/data/home-deals.json').then(function (r) { return r.json(); }).then(function (d) {
    DATA = d;
    if (!d.deals || !d.deals.length) {
      grid.innerHTML = '<p class="gp-deals-empty">No genuine drops today. <a href="/prices/drops/">See every drop this week</a>.</p>';
      return;
    }
    var groups = {};
    d.deals.forEach(function (x) { groups[x.group] = (groups[x.group] || 0) + 1; });
    Array.prototype.forEach.call(chips.querySelectorAll('button'), function (b) {
      var f = b.getAttribute('data-f');
      if (f !== 'all' && (groups[f] || 0) < 4) b.hidden = true; // needs a Deal of the day + a row of 3
      b.addEventListener('click', function () {
        filter = f;
        Array.prototype.forEach.call(chips.querySelectorAll('button'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
        render();
      });
    });
    chips.hidden = false;
    render();
  }).catch(function () {
    grid.innerHTML = '<p class="gp-deals-empty">Deals couldn’t load just now. <a href="/prices/drops/">See this week’s price drops</a>.</p>';
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.gp-deal-card');
    if (a && window.gtag) gtag('event', 'home_deal_click', { model: a.getAttribute('data-slug'), featured: a.classList.contains('gp-deal-feature') });
  });
})();
