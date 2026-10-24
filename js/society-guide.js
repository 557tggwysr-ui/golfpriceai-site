/* GolfPrice AI: the award card maker inside the golf society awards ideas
   guide. Draws the same 1080 x 1350 card as the Awards Night Kit, live, from
   an award, a winner and the society's name. "Save the card" shares or
   downloads it; "Do the full set" carries it into the Awards Night Kit.
   Nothing is sent anywhere. */
(function () {
  'use strict';
  var cv = document.getElementById('gm-cv'), sel = document.getElementById('gm-award');
  if (!cv || !sel) return;
  var data = [];
  try { data = JSON.parse(document.getElementById('gm-data').textContent); } catch (e) { return; }
  var w = document.getElementById('gm-w'), n = document.getElementById('gm-n'), full = document.getElementById('gm-full');
  var QUIPS = [
    [/bandit/i, 'The committee has questions.'], [/spoon|booby|fewest|last/i, 'Character building.'],
    [/donor|ball|water|lost/i, 'The lake thanks you for your service.'], [/improv/i, 'Lessons, or a new driver? We may never know.'],
    [/player of the year|champion|order of merit|major/i, 'Insufferable, frankly. Well played.'], [/fashion/i, 'Bold choices were made.'],
    [/shank/i, 'It went where it wanted.'], [/putt/i, 'Three-putts are a lifestyle.'], [/./, 'Take a bow.']
  ];
  function quip(t) { for (var i = 0; i < QUIPS.length; i++) if (QUIPS[i][0].test(t)) return QUIPS[i][1]; return ''; }
  function track(name, p) { if (window.gtag) window.gtag('event', name, p || {}); }
  sel.innerHTML = data.map(function (a, i) { return '<option value="' + i + '">' + a[0].replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</option>'; }).join('');
  sel.value = '8';
  function cur() { var a = data[+sel.value] || data[0]; return { t: a[0], d: a[1], w: (w.value || '').trim() || 'Your winner', name: (n.value || '').trim() || 'Your golf society' }; }
  function draw() {
    var a = cur(), W = 1080, H = 1350, g = cv.getContext('2d'), gold = '#d9b45a', cream = '#e7dcc3';
    g.fillStyle = '#1b1508'; g.fillRect(0, 0, W, H);
    g.strokeStyle = gold; g.lineWidth = 10; g.strokeRect(40, 40, W - 80, H - 80);
    g.lineWidth = 2; g.strokeRect(62, 62, W - 124, H - 124);
    function t(s, x, y, font, col, max) { g.font = font; g.fillStyle = col; g.textAlign = 'center'; s = String(s); while (max && g.measureText(s).width > max && s.length > 4) s = s.slice(0, -2) + '…'; g.fillText(s, x, y); }
    function fit(s, y, max, size, weight, col) { var f = size; g.font = weight + ' ' + f + 'px Poppins, sans-serif'; while (g.measureText(s).width > max && f > 60) { f -= 4; g.font = weight + ' ' + f + 'px Poppins, sans-serif'; } t(s, W / 2, y, weight + ' ' + f + 'px Poppins, sans-serif', col, max); }
    function wrap(s, y, font, max, lh, col) {
      g.font = font; g.fillStyle = col; g.textAlign = 'center';
      var words = String(s).split(' '), line = '', k = 0;
      for (var i = 0; i < words.length; i++) { var test = line ? line + ' ' + words[i] : words[i]; if (g.measureText(test).width > max && line) { g.fillText(line, W / 2, y + k * lh); k++; line = words[i]; if (k >= 3) return; } else line = test; }
      g.fillText(line, W / 2, y + k * lh);
    }
    var season = String(new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear());
    t((a.name + ' · ' + season + ' awards').toUpperCase(), W / 2, 170, '800 30px Inter, sans-serif', gold, 900);
    g.fillStyle = gold; g.fillRect(300, 205, 480, 3);
    fit(a.t, 520, 900, 64, 700, cream);
    fit(a.w, 700, 900, 150, 800, gold);
    wrap(a.d, 830, '600 40px Inter, sans-serif', 880, 54, '#ffffff');
    wrap(quip(a.t), 1000, 'italic 400 36px Inter, sans-serif', 880, 50, cream);
    g.font = '700 38px Poppins, sans-serif'; g.textAlign = 'left';
    var gw = g.measureText('Golf').width, pw = g.measureText('Price').width, x0 = 110;
    g.fillStyle = '#ffffff'; g.fillText('Golf', x0, H - 120); g.fillStyle = '#3fae29'; g.fillText('Price', x0 + gw, H - 120); g.fillStyle = '#ffffff'; g.fillText(' AI', x0 + gw + pw, H - 120);
    t('golfpriceai.com/societies', W - 110 - 230, H - 120, '600 28px Inter, sans-serif', cream);
    full.href = '/societies/awards/?add=' + encodeURIComponent(a.t) + ((w.value || '').trim() ? '&w=' + encodeURIComponent(w.value.trim()) : '') + ((n.value || '').trim() ? '&n=' + encodeURIComponent(n.value.trim()) : '');
  }
  function ready() { return document.fonts ? Promise.all(['800 64px Poppins', '700 30px Poppins', '600 24px Inter'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : Promise.resolve(); }
  [sel, w, n].forEach(function (el) { el.addEventListener('input', draw); el.addEventListener('change', draw); });
  document.querySelectorAll('.gd-make[data-award]').forEach(function (a) {
    a.addEventListener('click', function (ev) {
      var i = data.map(function (x) { return x[0]; }).indexOf(a.getAttribute('data-award'));
      if (i < 0) return;
      ev.preventDefault(); sel.value = String(i); draw();
      document.getElementById('maker').scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(function () { w.focus({ preventScroll: true }); }, 400);
      track('guide_award_pick', { award: a.getAttribute('data-award') });
    });
  });
  document.getElementById('gm-save').addEventListener('click', function () {
    var a = cur(), name = a.t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png';
    track('guide_card_saved', { award: a.t });
    cv.toBlob(function (b) {
      if (!b) return;
      var file = new File([b], name, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], text: a.t + ': ' + a.w + '. Made free at golfpriceai.com/societies' }).catch(function () {}); return; }
      var l = document.createElement('a'); l.href = URL.createObjectURL(b); l.download = name; document.body.appendChild(l); l.click();
      setTimeout(function () { URL.revokeObjectURL(l.href); l.remove(); }, 2000);
    }, 'image/png');
  });
  ready().then(draw);
})();
