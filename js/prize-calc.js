/* GolfPrice AI: golf society prize fund calculator. Everything happens in the
   browser; nothing is stored or sent. */
(function () {
  'use strict';
  var out = document.getElementById('pc-out');
  if (!out) return;
  function $(id) { return document.getElementById(id); }
  function money(n) { n = Math.round(n * 2) / 2; return '£' + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }
  function num(el, min, max, d) { var v = parseFloat(String(el.value).replace(/[£,\s]/g, '')); return isFinite(v) ? Math.min(max, Math.max(min, v)) : d; }
  var last = '';
  function calc() {
    var n = Math.round(num($('pc-n'), 1, 400, 0)), e = num($('pc-e'), 0, 1000, 0), pct = +$('pc-p').value;
    $('pc-pv').textContent = pct;
    var pot = n * e, fund = pot * pct / 100, side = [];
    if ($('pc-ntp').checked) side.push('Nearest the pin');
    if ($('pc-ld').checked) side.push('Longest drive');
    var places = $('pc-4th').checked ? [['1st', 36], ['2nd', 24], ['3rd', 14], ['4th', 6]] : [['1st', 40], ['2nd', 27], ['3rd', 13]];
    var sideShare = side.length * 10, placeShare = places.reduce(function (s, p) { return s + p[1]; }, 0);
    var scale = (100 - sideShare) / placeShare;
    var split = places.map(function (p) { return [p[0], fund * p[1] * scale / 100]; }).concat(side.map(function (s) { return [s, fund * .1]; }));
    out.innerHTML = '<b>Your golf society prize fund</b><div class="hq-fund-g"><span>' + n + ' players × ' + money(e) + '</span><b>' + money(pot) + '</b>' +
      '<span>Prize fund (' + pct + '%)</span><b>' + money(fund) + '</b></div>' +
      '<div class="hq-split">' + split.map(function (x) { return '<span>' + x[0] + ' ' + money(x[1]) + '</span>'; }).join('') + '</div>' +
      '<p class="soc-small">' + money(pot - fund) + ' left for the day: the trophy, the meal or the season fund. Amounts are rounded to the nearest 50p.</p>' +
      '<div class="soc-btns"><button type="button" class="soc-btn" id="pc-share">Send to the WhatsApp group</button></div>';
    last = 'Prize fund for the day: ' + n + ' players at ' + money(e) + ' = ' + money(pot) + '. Prizes ' + money(fund) + ' (' + pct + '%): ' +
      split.map(function (x) { return x[0] + ' ' + money(x[1]); }).join(', ') + '. Worked out free at golfpriceai.com/societies/prize-fund-calculator/';
    $('pc-share').onclick = function () {
      if (window.gtag) window.gtag('event', 'prize_calc_shared');
      if (navigator.share) navigator.share({ text: last }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(last), '_blank', 'noopener');
    };
  }
  ['pc-n', 'pc-e', 'pc-p', 'pc-ntp', 'pc-ld', 'pc-4th'].forEach(function (id) { $(id).addEventListener('input', calc); $(id).addEventListener('change', calc); });
  calc();
})();
