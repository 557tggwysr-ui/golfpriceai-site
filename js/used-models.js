/* Used-only price pages (/prices/used/<model>/ and /prices/used/<type>/):
   the hand / loft / flex filter over the list of used clubs on sale, and the
   model search on the type hubs. Built by scripts/used_models.py. */
(function () {
  'use strict';
  var fit = document.querySelector('.um-fit'), table = document.querySelector('#for-sale .um-table');
  if (fit && table) {
    var pick = {}, rows = [].slice.call(table.querySelectorAll('tbody tr')), out = document.getElementById('um-showing');
    fit.addEventListener('click', function (e) {
      var b = e.target.closest('.um-chip'); if (!b) return;
      var k = b.getAttribute('data-k'), v = b.getAttribute('data-v');
      pick[k] = pick[k] === v ? '' : v;
      fit.querySelectorAll('.um-chip[data-k="' + k + '"]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.getAttribute('data-v') === pick[k])); });
      var n = 0;
      rows.forEach(function (tr) {
        var ok = ['h', 'l', 'f'].every(function (x) { return !pick[x] || tr.getAttribute('data-' + x) === pick[x]; });
        tr.hidden = !ok; if (ok) n++;
      });
      var any = pick.h || pick.l || pick.f;
      out.textContent = !any ? 'Showing all ' + rows.length + ', cheapest first.' : n ? 'Showing ' + n + ' of ' + rows.length + ' that fit. Tap a choice again to clear it.' : 'None on sale in that spec right now. Tap a choice again to clear it.';
      try { if (window.gtag) window.gtag('event', 'um_filter', { key: k }); } catch (x) { /* fine */ }
    });
  }
  var q = document.getElementById('um-q');
  if (q) q.addEventListener('input', function () {
    var w = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean), any = false;
    document.querySelectorAll('.um-sec').forEach(function (sec) {
      var shown = 0;
      sec.querySelectorAll('tbody tr').forEach(function (tr) {
        var n = tr.getAttribute('data-n'), ok = w.every(function (x) { return n.indexOf(x) !== -1; });
        tr.hidden = !ok; if (ok) shown++;
      });
      sec.hidden = !shown; if (shown) any = true;
    });
    document.getElementById('um-none').hidden = any;
  });
})();
