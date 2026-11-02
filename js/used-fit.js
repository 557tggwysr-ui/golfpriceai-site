/* "Find a used one that fits you" on a model page's New or used? section.
   Pick a hand, loft and flex: the button shows how many used ones match,
   from what price, and opens Clubs › Preowned with those filters set. */
(function () {
  document.querySelectorAll('.nu-fit').forEach(function (box) {
    var items; try { items = JSON.parse(box.getAttribute('data-items') || '[]'); } catch (e) { return; }
    var shop = box.getAttribute('data-shop'), noun = box.getAttribute('data-noun') || 'club';
    var IDX = { hand: 1, loft: 2, flex: 3 }, pick = {};
    var btn = box.querySelector('.nu-btn'), chips = box.querySelectorAll('.nu-chip');
    function match(it, skip) {
      return Object.keys(pick).every(function (k) { return k === skip || it[IDX[k]] === pick[k]; });
    }
    function money(n) { return '£' + n.toFixed(2); }
    function draw() {
      var hit = items.filter(function (it) { return match(it); });
      chips.forEach(function (c) {
        var k = c.getAttribute('data-k'), v = c.getAttribute('data-v');
        var on = pick[k] === v, n = items.filter(function (it) { return match(it, k) && it[IDX[k]] === v; }).length;
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
        c.disabled = !on && n === 0;
        var s = c.querySelector('small'); if (s) s.textContent = '(' + n + ')';
      });
      var url = shop;
      Object.keys(pick).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(pick[k]); });
      btn.href = url;
      var parts = [pick.hand ? (pick.hand === 'Right' ? 'right-handed' : 'left-handed') : '', pick.loft || '', pick.flex ? pick.flex.toLowerCase() : ''].filter(Boolean).join(' ');
      if (!Object.keys(pick).length) btn.textContent = 'See all ' + items.length + ' used from ' + money(items[0][0]);
      else if (!hit.length) btn.textContent = 'None in that spec today: see all used';
      else btn.textContent = 'See ' + parts + ' ones from ' + money(Math.min.apply(null, hit.map(function (it) { return it[0]; })));
      if (!hit.length && Object.keys(pick).length) btn.href = shop;
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        var k = c.getAttribute('data-k'), v = c.getAttribute('data-v');
        if (pick[k] === v) delete pick[k]; else pick[k] = v;
        draw();
        if (window.gtag) window.gtag('event', 'used_fit_pick', { k: k });
      });
    });
    btn.addEventListener('click', function () { if (window.gtag) window.gtag('event', 'used_fit_go', { picks: Object.keys(pick).length }); });
    draw();
  });
})();
