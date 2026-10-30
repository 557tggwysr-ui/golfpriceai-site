/* Improve: handicap calculators (World Handicap System).
   Every calculation runs here in the browser. Nothing is saved or sent. */
(function () {
  'use strict';

  var FORMATS = {
    stableford: 'STABLEFORD OR MEDAL', fourball: 'FOURBALL BETTER BALL', match: 'SINGLES MATCHPLAY',
    fbmatch: 'FOURBALL MATCHPLAY', foursomes: 'FOURSOMES'
  };
  // How many of your best differentials count, and the adjustment, by number of scores (WHS 5.2).
  var TABLE = { 3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0],
    12: [4, 0], 13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0], 20: [8, 0] };

  // Anonymous "used this calculator" count, once a day per browser. Nothing typed is sent.
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }
  function countUse(form, k) { if (form) form.addEventListener('input', function () { gpUse(k); }, { once: true }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function num(el) { if (!el) return NaN; var v = String(el.value).trim(); return v === '' ? NaN : parseFloat(v); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function hcp(x, dp) { // golf convention: a plus handicap shows as +1.5
    if (x === null || isNaN(x)) return '–';
    var s = Math.abs(x).toFixed(dp || 0);
    return x < 0 ? '+' + s : s;
  }
  function out(form, key, val, html) {
    $$('[data-out="' + key + '"]', form).forEach(function (el) { if (html) el.innerHTML = val; else el.textContent = val; });
  }
  function fmt(form) {
    var r = $('input[type="radio"]:checked', form);
    return r ? { id: r.value, pct: parseFloat(r.getAttribute('data-pct')) } : { id: 'stableford', pct: 95 };
  }

  // Handicap index from score differentials (any order). Returns null under 3 scores.
  function indexOf(diffs) {
    var d = diffs.slice(0, 20).filter(function (x) { return !isNaN(x); });
    var rule = TABLE[d.length];
    if (!rule) return null;
    var best = d.slice().sort(function (a, b) { return a - b; }).slice(0, rule[0]);
    var avg = best.reduce(function (s, x) { return s + x; }, 0) / best.length;
    return { value: Math.min(54, r1(avg + rule[1])), count: rule[0], of: d.length, adj: rule[1], used: best };
  }
  function parseDiffs(text) {
    return String(text || '').split(/[\s,;]+/).map(function (x) { return parseFloat(x.replace(/^\+/, '-')); })
      .filter(function (x) { return !isNaN(x); }).slice(0, 20);
  }

  /* ------------------------------------------------ share */
  function wireShare(form, getText) {
    var btn = $('[data-share]', form);
    if (!btn) return;
    btn.addEventListener('click', function () {
      gpUse('calc_share');
      var text = getText() + ' Worked out free at GolfPrice AI:';
      var url = location.origin + location.pathname;
      if (navigator.share) { navigator.share({ text: text, url: url }).catch(function () {}); return; }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text + ' ' + url).then(function () {
          var t = btn.textContent; btn.textContent = 'Copied. Paste it in the group chat'; setTimeout(function () { btn.textContent = t; }, 2200);
        }).catch(function () {});
      }
    });
  }

  countUse($('[data-calc="index"]'), 'calc_index');
  countUse($('[data-calc="course"]'), 'calc_course');
  countUse($('[data-calc="quick"]'), 'calc_course');
  countUse($('[data-calc="playing"]'), 'calc_playing');
  countUse($('[data-calc="shoot"]'), 'calc_shoot');

  /* ------------------------------------------------ hub quick check */
  var quick = $('[data-calc="quick"]');
  if (quick) {
    var qRun = function () {
      var i = num($('#q-index')), s = num($('#q-slope')), d = num($('#q-diff'));
      var ok = !isNaN(i) && s > 0 && !isNaN(d);
      out(quick, 'ch', ok ? hcp(Math.round(i * s / 113 + d)) : '–');
    };
    quick.addEventListener('input', qRun); qRun();
  }

  /* ------------------------------------------------ course handicap */
  var course = $('[data-calc="course"]');
  if (course) {
    var cText = '';
    var cRun = function () {
      var i = num($('#c-index')), s = num($('#c-slope')), cr = num($('#c-rating')), par = num($('#c-par'));
      var f = fmt(course);
      var ok = !isNaN(i) && s > 0 && !isNaN(cr) && !isNaN(par);
      if (!ok) { out(course, 'ch', '–'); out(course, 'ph', '–'); out(course, 'working', 'Fill in all four boxes to see your shots.'); return; }
      var raw = i * (s / 113) + (cr - par), ch = Math.round(raw), ph = Math.round(ch * f.pct / 100);
      out(course, 'ch', hcp(ch)); out(course, 'ph', hcp(ph)); out(course, 'pct', f.pct); out(course, 'fmt', FORMATS[f.id]);
      out(course, 'working', i + ' × (' + s + ' ÷ 113) + (' + cr + ' − ' + par + ') = ' + raw.toFixed(2) + ', rounded to ' + ch + (ch < 0 ? ' (a plus ' + Math.abs(ch) + ' handicap)' : '') +
        (f.id === 'foursomes' ? '. In foursomes, the pair plays off 50% of both course handicaps added together.' : ''));
      cText = 'My course handicap is ' + hcp(ch) + ' (playing handicap ' + hcp(ph) + ' at ' + f.pct + '%).';
    };
    course.addEventListener('input', cRun); course.addEventListener('change', cRun); cRun();
    wireShare(course, function () { return cText; });
  }

  /* ------------------------------------------------ playing handicap */
  var playing = $('[data-calc="playing"]');
  if (playing) {
    var pText = '';
    var pRun = function () {
      var ch = num($('#p-ch')), ch2 = num($('#p-ch2')), f = fmt(playing);
      out(playing, 'fmt', FORMATS[f.id]); out(playing, 'pct', f.pct); out(playing, 'ch', hcp(ch));
      var box = $('[data-out="pairbox"]', playing);
      if (isNaN(ch)) { out(playing, 'ph', '–'); out(playing, 'working', 'Put in your course handicap.'); box.hidden = true; return; }
      var ph = Math.round(ch * f.pct / 100);
      out(playing, 'ph', hcp(ph));
      out(playing, 'working', ch + ' × ' + f.pct + '% = ' + (ch * f.pct / 100).toFixed(2) + ', rounded to ' + ph);
      pText = 'My playing handicap for ' + FORMATS[f.id].toLowerCase() + ' is ' + hcp(ph) + '.';
      if (isNaN(ch2)) { box.hidden = true; return; }
      box.hidden = false;
      var ph2 = Math.round(ch2 * f.pct / 100);
      if (f.id === 'foursomes') {
        var pair = Math.round((ch + ch2) * 0.5);
        out(playing, 'pairlabel', 'YOUR PAIR PLAYS OFF'); out(playing, 'pair', hcp(pair));
        out(playing, 'pairline', '50% of ' + ch + ' + ' + ch2);
        out(playing, 'ph', hcp(pair)); out(playing, 'working', '(' + ch + ' + ' + ch2 + ') × 50% = ' + ((ch + ch2) / 2).toFixed(1) + ', rounded to ' + pair);
        pText = 'Our foursomes handicap is ' + hcp(pair) + '.';
      } else if (f.id === 'match' || f.id === 'fbmatch') {
        var diff = Math.abs(ph - ph2);
        out(playing, 'pairlabel', 'SHOTS BETWEEN YOU'); out(playing, 'pair', diff);
        out(playing, 'pairline', diff === 0 ? 'Level match' : (ph > ph2 ? 'You receive them' : 'You give them') + ' (' + hcp(ph) + ' v ' + hcp(ph2) + ')');
      } else {
        out(playing, 'pairlabel', 'THEY PLAY OFF'); out(playing, 'pair', hcp(ph2)); out(playing, 'pairline', f.pct + '% of ' + ch2);
      }
    };
    playing.addEventListener('input', pRun); playing.addEventListener('change', pRun); pRun();
    wireShare(playing, function () { return pText; });
  }

  /* ------------------------------------------------ handicap index */
  var idxForm = $('[data-calc="index"]');
  if (idxForm) {
    var mode = 'diffs', iText = '';
    $$('[data-tab]', idxForm).forEach(function (b) {
      b.addEventListener('click', function () {
        mode = b.getAttribute('data-tab');
        $$('[data-tab]', idxForm).forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
        $$('[data-panel]', idxForm).forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== mode; });
        iRun();
      });
    });
    var iRun = function () {
      var diffs;
      if (mode === 'diffs') diffs = parseDiffs($('#i-diffs').value);
      else {
        diffs = [];
        $$('[data-row]', idxForm).forEach(function (row) {
          var f = $$('input', row).map(num);
          if (!isNaN(f[0]) && !isNaN(f[1]) && f[2] > 0) diffs.push(r1((113 / f[2]) * (f[0] - f[1])));
        });
      }
      var res = indexOf(diffs);
      var chart = $('[data-out="chart"]', idxForm);
      if (!res) {
        out(idxForm, 'hi', '–'); out(idxForm, 'basis', 'needs 3 or more rounds');
        out(idxForm, 'working', diffs.length + ' round' + (diffs.length === 1 ? '' : 's') + ' so far. You need at least 3 for a handicap index.');
        chart.innerHTML = ''; return;
      }
      out(idxForm, 'hi', hcp(res.value, 1));
      out(idxForm, 'basis', res.count === 1 ? 'your best round of ' + res.of : 'best ' + res.count + ' of ' + res.of);
      var used = res.used.slice();
      var lo = Math.min.apply(null, diffs), hi = Math.max.apply(null, diffs), span = (hi - lo) || 1;
      chart.innerHTML = diffs.slice().reverse().map(function (d) {
        var k = used.indexOf(d), on = k !== -1; if (on) used.splice(k, 1);
        return '<span class="' + (on ? 'on' : '') + '" style="height:' + (22 + 78 * (d - lo) / span).toFixed(0) + '%" title="' + d + '"></span>';
      }).join('');
      out(idxForm, 'working', 'Average of ' + res.used.map(function (x) { return x.toFixed(1); }).join(', ') +
        (res.adj ? ', then ' + res.adj.toFixed(1) : '') + ' = ' + hcp(res.value, 1) + '. Counted rounds are in green.');
      iText = 'My handicap index works out at ' + hcp(res.value, 1) + '.';
    };
    idxForm.addEventListener('input', iRun); iRun();
    wireShare(idxForm, function () { return iText; });
  }

  /* ------------------------------------------------ what do I need to shoot? */
  var shoot = $('[data-calc="shoot"]');
  if (shoot) {
    var sText = '';
    var table = $('[data-out="table"]');
    var sRun = function () {
      var diffs = parseDiffs($('#s-diffs').value), cr = num($('#s-rating')), sl = num($('#s-slope'));
      var now = indexOf(diffs);
      if (!now || isNaN(cr) || !(sl > 0)) {
        out(shoot, 'now', '–'); out(shoot, 'target', '–');
        out(shoot, 'working', 'Paste at least 3 differentials and fill in the next tee’s ratings.'); table.innerHTML = ''; return;
      }
      out(shoot, 'now', hcp(now.value, 1));
      var keep = diffs.length >= 20 ? diffs.slice(0, 19) : diffs.slice();
      var target = null, cells = [];
      for (var score = 65; score <= 115; score++) {
        var d = r1((113 / sl) * (score - cr));
        var nx = indexOf([d].concat(keep)).value;
        if (nx < now.value) target = score;
        var cls = nx < now.value ? 'down' : nx > now.value ? 'up' : 'same';
        cells.push('<div class="' + cls + '"><b>' + score + '</b><span>' + hcp(nx, 1) + '</span></div>');
      }
      table.innerHTML = cells.join('');
      if (target === null) {
        out(shoot, 'target', '–');
        out(shoot, 'working', 'No score from 65 to 115 lowers your index this time.');
        sText = '';
      } else {
        var after = indexOf([r1((113 / sl) * (target - cr))].concat(keep)).value;
        out(shoot, 'target', target);
        out(shoot, 'working', 'A ' + target + ' takes you to ' + hcp(after, 1) + '. ' +
          (diffs.length >= 20 ? 'Your oldest round (' + diffs[diffs.length - 1].toFixed(1) + ') drops off when you post.' : 'You have fewer than 20 rounds, so nothing drops off yet.'));
        sText = 'I need ' + target + ' or better next time out to get cut.';
      }
    };
    shoot.addEventListener('input', sRun); sRun();
    wireShare(shoot, function () { return sText; });
  }
})();
