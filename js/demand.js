/* GolfPrice AI: UK Golf Demand Index (/demand/). Category chips: show the
   top 10 in the chosen category. Nothing is stored or sent. */
(function () {
  'use strict';
  var list = document.getElementById('dm-list');
  if (!list) return;
  var rows = Array.prototype.slice.call(list.querySelectorAll('.dm-row'));
  var empty = document.querySelector('.dm-empty');
  function show(g) {
    var n = 0;
    rows.forEach(function (r) {
      var on = (!g || r.getAttribute('data-g') === g) && n < 10;
      if (on) n++;
      r.classList.toggle('is-shown', on);
      r.hidden = !on;
    });
    if (empty) empty.hidden = n > 0;
  }
  document.querySelectorAll('.dm-chart .dm-chip').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.dm-chart .dm-chip').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      show(b.getAttribute('data-g'));
    });
  });
  show('');
})();
