/* GolfPrice AI: The Clubhouse (/play/). Shows whether you've played today's
   Par Price (from this browser's own record) and lists your leagues (from the
   alerts worker, by this browser's random player id). Nothing new is stored. */
(function () {
  'use strict';
  var root = document.getElementById('ch');
  if (!root) return;
  var n = Number(root.getAttribute('data-n'));
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // Played today? Work out the score from the saved guesses and today's prices.
  var saved = get('gpParPrice', {});
  if (saved.n === n && (saved.guesses || []).length === 5) {
    fetch('/data/par-price/today.json?n=' + n).then(function (r) { return r.json(); }).then(function (d) {
      var t = saved.guesses.reduce(function (sum, g, i) {
        var off = Math.abs(g - d.items[i].price) / d.items[i].price;
        return sum + (off <= 0.02 ? -2 : off <= 0.05 ? -1 : off <= 0.10 ? 0 : off <= 0.20 ? 1 : 2);
      }, 0);
      var txt = t === 0 ? 'level par' : Math.abs(t) + (t > 0 ? ' over' : ' under');
      document.getElementById('ch-today-line').textContent = 'You went round in ' + txt + ' today. New round tomorrow morning.';
      document.getElementById('ch-today-cta').innerHTML = 'See your scorecard <span aria-hidden="true">&rarr;</span>';
    }).catch(function () {});
  }

  var pid = get('gpPid', '');
  if (!/^[a-z0-9]{12,32}$/.test(pid)) return;
  fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/pp/my?pid=' + pid).then(function (r) { return r.json(); }).then(function (d) {
    var mine = (d && d.leagues) || [];
    if (!mine.length) return;
    document.getElementById('ch-leagues').innerHTML = '<ul class="pr-lg-list">' + mine.map(function (l) {
      return '<li><a href="/play/league/?l=' + l.id + '"><b>' + esc(l.name) + '</b><span>' + l.size + (l.size === 1 ? ' golfer' : ' golfers') + ' · See the table</span></a></li>';
    }).join('') + '</ul>';
  }).catch(function () {});
})();
