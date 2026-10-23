/* GolfPrice AI: The Clubhouse Report (league page, /play/league/?l=…#report).
   Each league's Monday paper, written by the alerts worker (/pp/report) from the
   week that just finished: Par Price rounds, Bag Draft weekly gains, picks that
   moved, head-to-head results, next week's fixtures and the monthly table.
   A banner at the top of the league page opens it; "Send the report to the
   group" shares it as a 1080 x 1350 picture. Nicknames only. */
(function () {
  'use strict';
  var box = document.getElementById('cr');
  var code = (location.search.match(/[?&]l=([a-z0-9]{6})/i) || [])[1];
  if (!box || !code) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n) { if (window.gtag) window.gtag('event', n); }
  function sgn(n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; }
  function par(n) { return n === 0 ? 'level' : n < 0 ? Math.abs(n) + ' under' : n + ' over'; }
  function day(iso, opts) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', Object.assign({ timeZone: 'UTC' }, opts)); }
  var pid = get('gpPid', ''), open = location.hash === '#report';
  if (!/^[a-z0-9]{12,32}$/.test(pid)) pid = '';

  function load(w) {
    fetch(API + '/pp/report?l=' + code + (pid ? '&pid=' + pid : '') + (w ? '&w=' + w : '')).then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok && !d.empty) render(d); else if (!w) box.hidden = true; })
      .catch(function () {});
  }

  function render(d) {
    var monday = day(d.next || addDays(d.last, 1), { weekday: 'long', day: 'numeric', month: 'long' });
    var stamp = 'Edition ' + d.edition + ' · ' + day(d.from, { day: 'numeric', month: 'short' }) + ' to ' + day(d.last, { day: 'numeric', month: 'short' });
    if (!open) {
      box.innerHTML = '<button type="button" class="cr-banner"><span><b>The Clubhouse Report</b><small>' + esc(stamp) + ' · ' + esc(d.golfer ? d.golfer.headline : 'This week in the league') + '</small></span><span class="cr-read">Read it ›</span></button>';
      box.hidden = false;
      box.querySelector('button').addEventListener('click', function () { open = true; render(d); track('clubhouse_report_open'); });
      return;
    }
    var h = '<article class="cr-paper"><header class="cr-mast"><small>' + esc(stamp) + '</small><h2>The Clubhouse Report</h2><em>' + esc(d.name) + '’s weekly paper of record</em></header>';
    if (d.golfer) h += '<section class="cr-lead"><span class="cr-k">Golfer of the week</span><h3>' + esc(d.golfer.headline) + '</h3><p>' + esc(d.golfer.line) + '</p></section>';
    var tiles = [];
    if (d.bag && d.bag.pick) tiles.push(['Pick of the week', esc(d.bag.pick.nick) + '’s ' + esc(short(d.bag.pick.name)), 'Down £' + d.bag.pick.d + '. ' + esc(d.bag.pick.quip)]);
    if (d.bag && d.bag.shank) tiles.push(['Shank of the week', esc(d.bag.shank.nick) + '’s ' + esc(short(d.bag.shank.name)), 'Up £' + Math.abs(d.bag.shank.d) + '. ' + esc(d.bag.shank.quip)]);
    if (d.pp) tiles.push(['Par Price round of the week', esc(d.pp.round.nick) + ', ' + par(d.pp.round.total), day(d.pp.round.day, { weekday: 'long' }) + '. ' + d.pp.rounds + ' rounds played in the league this week.']);
    if (d.pp && d.pp.spoon) tiles.push(['Wooden spoon', esc(d.pp.spoon.nick), esc(d.pp.spoon.quip)]);
    else if (d.pp && d.pp.ever.length) tiles.push(['Ever-present', esc(d.pp.ever.join(', ')), 'Played every round. Do they have jobs?']);
    if (tiles.length) h += '<section class="cr-grid">' + tiles.map(function (t) { return '<div><span class="cr-k">' + t[0] + '</span><b>' + t[1] + '</b><small>' + t[2] + '</small></div>'; }).join('') + '</section>';
    if (d.results && d.results.length) {
      h += '<section class="cr-sec"><span class="cr-k">Head-to-head results' + (d.bag && d.bag.double ? ' (double points)' : '') + '</span>' + d.results.map(function (f) {
        return '<p>' + esc(f.a.nick) + ' ' + sgn(f.a.score) + ' v ' + sgn(f.b.score) + ' ' + esc(f.b.nick) + '</p>';
      }).join('') + '</section>';
    }
    if (d.fixtures && d.fixtures.length) h += '<section class="cr-sec"><span class="cr-k">Next week</span><p>' + d.fixtures.map(function (f) { return esc(f.a) + ' v ' + esc(f.b); }).join(' · ') + '</p></section>';
    if (d.table && d.table.length) h += '<section class="cr-sec"><span class="cr-k">The Bag Draft table</span><p>' + d.table.slice(0, 8).map(function (t, i) { return (i + 1) + ' ' + esc(t.nick) + ' ' + sgn(t.pts); }).join(' · ') + '</p></section>';
    else if (d.bag && d.bag.gains.length) h += '<section class="cr-sec"><span class="cr-k">Bag Draft gains this week</span><p>' + d.bag.gains.map(function (g) { return esc(g.nick) + ' ' + sgn(g.score); }).join(' · ') + '</p></section>';
    h += '</article><div class="cr-btns"><button type="button" class="gp-af-btn cr-share">Send the report to the group</button>' +
      (d.prev ? '<button type="button" class="cr-btn2" data-w="' + d.prev + '">Last week’s edition</button>' : '') +
      (d.next ? '<button type="button" class="cr-btn2" data-w="' + d.next + '">Next edition</button>' : '') + '</div>' +
      '<p class="cr-small">Written automatically every Monday from the league’s scores, picks and Par Price rounds.</p>';
    box.innerHTML = h; box.hidden = false;
    box.querySelectorAll('[data-w]').forEach(function (b) { b.addEventListener('click', function () { load(b.getAttribute('data-w')); }); });
    box.querySelector('.cr-share').addEventListener('click', function (e) { shareReport(d, e.currentTarget, tiles); });
    if (location.hash === '#report') setTimeout(function () { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
  }
  function addDays(iso, k) { return new Date(Date.parse(iso + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10); }
  function short(name) { return String(name || '').replace(/\s+golf\s+balls?$/i, ' balls'); }
  function strip(s) { var t = document.createElement('span'); t.innerHTML = s; return t.textContent; }

  /* ---- the WhatsApp picture */
  function shareReport(d, btn, tiles) {
    var text = 'The Clubhouse Report, edition ' + d.edition + ' (' + d.name + ')' + (d.golfer ? ': ' + d.golfer.headline + '.' : '.') +
      ' Read it: https://golfpriceai.com/play/league/?l=' + code + '#report';
    track('clubhouse_report_share');
    btn.disabled = true;
    draw(d, tiles).then(function (file) {
      btn.disabled = false;
      if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], text: text }).catch(function () {});
      var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }, function () {
      btn.disabled = false;
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    });
  }
  function draw(d, tiles) {
    var fonts = document.fonts ? Promise.all(['800 64px Poppins', '700 30px Poppins', '600 24px Inter', '400 24px Inter'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : null;
    return Promise.resolve(fonts).then(function () {
      var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d'), ink = '#16241c', paper = '#fbf8f0';
      g.fillStyle = paper; g.fillRect(0, 0, W, H);
      g.strokeStyle = ink; g.lineWidth = 6; g.strokeRect(36, 36, W - 72, H - 72);
      function t(s, x, y, font, col, align, max) { g.font = font; g.fillStyle = col || ink; g.textAlign = align || 'left'; s = String(s); while (max && g.measureText(s).width > max && s.length > 4) s = s.slice(0, -2) + '…'; g.fillText(s, x, y); }
      function wrap(s, x, y, font, max, lh, lines) {
        g.font = font; g.fillStyle = ink; g.textAlign = 'left';
        var words = String(s).split(' '), line = '', n = 0;
        for (var i = 0; i < words.length; i++) {
          var test = line ? line + ' ' + words[i] : words[i];
          if (g.measureText(test).width > max && line) { g.fillText(line, x, y + n * lh); n++; line = words[i]; if (n >= lines) return y + n * lh; }
          else line = test;
        }
        g.fillText(line, x, y + n * lh); return y + (n + 1) * lh;
      }
      t(('Edition ' + d.edition + ' · ' + day(d.from, { day: 'numeric', month: 'short' }) + ' to ' + day(d.last, { day: 'numeric', month: 'short', year: 'numeric' })).toUpperCase(), W / 2, 104, '700 22px Inter, sans-serif', ink, 'center');
      t('The Clubhouse Report', W / 2, 190, '800 72px Poppins, sans-serif', ink, 'center', 980);
      t(d.name + '’s weekly paper of record', W / 2, 238, 'italic 400 28px Inter, sans-serif', ink, 'center', 940);
      g.fillRect(70, 262, W - 140, 4); g.fillRect(70, 272, W - 140, 2);
      var y = 330;
      if (d.golfer) {
        t('GOLFER OF THE WEEK', 70, y, '800 22px Inter, sans-serif', '#8a5a00');
        y = wrap(d.golfer.headline, 70, y + 62, '800 56px Poppins, sans-serif', W - 140, 64, 2) + 4;
        y = wrap(d.golfer.line, 70, y + 10, '400 30px Inter, sans-serif', W - 140, 40, 2) + 10;
      }
      g.fillRect(70, y, W - 140, 2); y += 50;
      var colW = (W - 140 - 40) / 2;
      tiles.slice(0, 4).forEach(function (tl, i) {
        var x = 70 + (i % 2) * (colW + 40), yy = y + Math.floor(i / 2) * 190;
        t(tl[0].toUpperCase(), x, yy, '800 20px Inter, sans-serif', '#4a554e', 'left', colW);
        t(strip(tl[1]), x, yy + 44, '700 30px Poppins, sans-serif', ink, 'left', colW);
        var yb = yy + 84; g.font = '400 24px Inter, sans-serif'; wrap(strip(tl[2]), x, yb, '400 24px Inter, sans-serif', colW, 32, 2);
      });
      y += Math.ceil(Math.min(tiles.length, 4) / 2) * 190 + 10;
      if (d.results && d.results.length && y < 1100) {
        g.fillRect(70, y, W - 140, 2); y += 46;
        t('HEAD-TO-HEAD RESULTS', 70, y, '800 20px Inter, sans-serif', '#4a554e'); y += 40;
        d.results.slice(0, 3).forEach(function (f) { t(f.a.nick + ' ' + sgn(f.a.score) + ' v ' + sgn(f.b.score) + ' ' + f.b.nick, 70, y, '600 28px Inter, sans-serif', ink, 'left', W - 140); y += 40; });
      }
      t('Golf', 70, H - 78, '700 34px Poppins, sans-serif', ink);
      g.font = '700 34px Poppins, sans-serif'; var gw = g.measureText('Golf').width, pw = g.measureText('Price').width;
      t('Price', 70 + gw, H - 78, '700 34px Poppins, sans-serif', '#2f8a1f'); t(' AI', 70 + gw + pw, H - 78, '700 34px Poppins, sans-serif', ink);
      t('golfpriceai.com/play', W - 70, H - 78, '600 26px Inter, sans-serif', ink, 'right');
      return new Promise(function (ok, no) { cv.toBlob(function (b) { b ? ok(new File([b], 'clubhouse-report.png', { type: 'image/png' })) : no(); }, 'image/png'); });
    });
  }

  load('');
})();
