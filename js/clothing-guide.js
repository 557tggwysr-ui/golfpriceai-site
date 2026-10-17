/* GolfPrice AI — clothing price guide filters (/prices/golf-shoes/ etc.)
   The chips filter the drops table and the cards. "All" keeps the page's own
   order (men's first). Each list shows a set number, with "Show more" for
   the cards. Works without this script too: everything is in the page. */
(function () {
  var chips = document.querySelectorAll('.cg-chip');
  var lists = document.querySelectorAll('.cg-list');
  var more = document.querySelector('.cg-more');
  var filter = 'all', extra = 0;

  function matches(el) {
    if (filter === 'all') return true;
    if (filter === 'm') return el.getAttribute('data-aud') === 'm';
    if (filter === 'w') return el.getAttribute('data-aud') === 'w';
    return (' ' + el.getAttribute('data-tags') + ' ').indexOf(' ' + filter + ' ') !== -1;
  }

  function render() {
    lists.forEach(function (list) {
      var limit = parseInt(list.getAttribute('data-show'), 10) || 12;
      if (list.classList.contains('sg-grid')) limit += extra;
      var shown = 0, hiddenMatches = 0;
      list.querySelectorAll('.cg-item').forEach(function (el) {
        var ok = matches(el);
        var show = ok && shown < limit;
        el.hidden = !show;
        if (show) shown++;
        else if (ok) hiddenMatches++;
      });
      var block = list.closest('.pp-block');
      var none = block && block.querySelector('.cg-none');
      if (none) none.hidden = shown > 0;
      if (list.classList.contains('sg-grid') && more) more.hidden = hiddenMatches === 0;
    });
  }

  // Set guides: "Cheapest ... by brand" follows the filter, built from every
  // matching card (not just the ones on screen).
  var brandBox = document.querySelector('.cg-brands');
  var LABELS = { m: 'men’s ', w: 'women’s ', under: 'under-£400 ', cart: 'cart-bag ', stand: 'stand-bag ', p11: '11+ piece ' };
  function money(n) { return '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function renderBrands() {
    if (!brandBox) return;
    var best = {};
    document.querySelectorAll('.sg-grid .cg-item').forEach(function (el) {
      if (!matches(el)) return;
      var b = el.getAttribute('data-brand'), p = parseFloat(el.getAttribute('data-price'));
      if (!b || isNaN(p)) return;
      var r = best[b] || (best[b] = { n: 0, p: Infinity, name: '' });
      r.n++;
      if (p < r.p) { r.p = p; r.name = el.getAttribute('data-name'); }
    });
    var rows = Object.keys(best).map(function (b) { return [b, best[b]]; })
      .sort(function (a, b) { return b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1); }).slice(0, 10);
    brandBox.querySelector('tbody').innerHTML = rows.map(function (r) {
      return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1].name) + '</td><td class="pp-price">' +
        money(r[1].p) + '</td><td>' + r[1].n + '</td></tr>';
    }).join('');
    brandBox.querySelector('.cg-brands-label').textContent = LABELS[filter] || '';
    brandBox.querySelector('table').hidden = !rows.length;
    brandBox.querySelector('.cg-brands-none').hidden = !!rows.length;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-f');
      extra = 0;
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle('sg-on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
      renderBrands();
      if (window.gtag) gtag('event', 'clothing_guide_filter', { filter: filter });
    });
  });
  if (more) more.addEventListener('click', function () { extra += 12; render(); });
  render();
})();
