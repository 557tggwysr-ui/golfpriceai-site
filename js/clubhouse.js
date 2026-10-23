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
  if (!/^[a-z0-9]{12,32}$/.test(pid)) pid = '';
  fame();
  if (!pid) return;
  fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/pp/my?pid=' + pid).then(function (r) { return r.json(); }).then(function (d) {
    var mine = (d && d.leagues) || [];
    if (!mine.length) return;
    document.getElementById('ch-leagues').innerHTML = '<ul class="pr-lg-list">' + mine.map(function (l) {
      return '<li><a href="/play/league/?l=' + l.id + '"><b>' + esc(l.name) + '</b><span>' + l.size + (l.size === 1 ? ' golfer' : ' golfers') + ' · See the table</span></a></li>';
    }).join('') + '</ul>';
  }).catch(function () {});

  // Hall of Fame: each finished Major's national champion (from the frozen final
  // scores), plus the champions of your own leagues. Until the first Major ends,
  // the panel keeps its "Champions' bags hang here" text.
  function fame() {
    var el = document.getElementById('ch-fame-body');
    if (!el) return;
    Promise.all([
      fetch('/data/draft/majors.json').then(function (r) { return r.json(); }),
      fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/draft/fame' + (pid ? '?pid=' + pid : '')).then(function (r) { return r.json(); })
    ]).then(function (r) {
      var majors = r[0], d = r[1];
      if (!d || !d.ok || !(d.majors || []).length) return;
      var FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      var html = '<h2>National champions</h2><p>The best bag in the country each month. Their name goes on the bag, and the bag goes on this wall.</p><div class="hf-list">' +
        d.majors.map(function (m, i) {
          var mj = majors[m.season.slice(5)] || {}, top = m.places[0], when = FULL[+m.season.slice(5) - 1] + ' ' + m.season.slice(0, 4);
          var rest = m.places.slice(1).map(function (p, k) { return (k ? '3rd ' : '2nd ') + p.nicks.map(esc).join(' & '); }).join(' · ');
          return '<div class="hf-major"><img src="' + esc(mj.art || '') + '" alt="' + esc(mj.name || '') + ' bag" width="92" height="144" loading="lazy">' +
            '<span class="hf-tag">' + esc(top.nicks[0]) + '</span><div>' +
            '<span class="hf-k">' + when + (m.season === '2026-11' ? ' · the first ever' : i === 0 ? ' · latest' : '') + '</span>' +
            '<b>' + esc(mj.name || '') + '</b><strong>' + top.nicks.map(esc).join(' & ') + (top.nicks.length > 1 ? ' (joint)' : '') + '</strong>' +
            '<span>' + top.pts + ' pts · best of ' + m.count + ' bag' + (m.count === 1 ? '' : 's') + '</span>' + (rest ? '<span>' + rest + '</span>' : '') + '</div></div>';
        }).join('') + '</div>';
      if ((d.leagues || []).length) {
        html += '<div class="hf-leagues"><h3>Your leagues’ champions</h3>' + d.leagues.slice(0, 6).map(function (l) {
          return '<div><span>' + esc(l.league) + ' · ' + FULL[+l.season.slice(5) - 1].slice(0, 3) + '</span><b>' + l.champs.map(esc).join(' & ') + '</b></div>';
        }).join('') + '</div>';
      }
      if (d.majors[0].crowned) html += '<p class="ch-small">' + d.majors[0].crowned + ' league' + (d.majors[0].crowned === 1 ? '' : 's') + ' crowned a champion in ' + FULL[+d.majors[0].season.slice(5) - 1] + '.</p>';
      html += '<p><a href="/play/locker/">See your Locker Room</a></p>';
      el.innerHTML = html;
    }).catch(function () {});
  }
})();
