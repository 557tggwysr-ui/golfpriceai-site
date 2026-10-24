/* GolfPrice AI: Higher or Lower (/play/higher-or-lower/).
   The daily run (data/higher-or-lower/today.json, the same 51 products for
   everyone, built every morning) counts: its streak goes to the alerts worker
   (/pp/hl) for the daily table and league tables. Progress is kept in this
   browser so a closed tab carries on where it left off. After the daily run,
   free play makes endless chains from data/higher-or-lower/pool.json.
   No personal data: a random player id (gpPid) and a streak number. */
(function () {
  'use strict';
  var box = document.getElementById('hl');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { n = Number(n); return '£' + (n % 1 ? n.toFixed(2) : n.toLocaleString('en-GB')); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DAY, POOL, mode = 'daily', items = [], pos = 0, streak = 0, busy = false, result = null;
  var S = get('gpHL', {});                         // {n, pos, streak, done, beat, best, free}
  var MISS = ['The prices won that one.', 'Nobody saw that coming. Well, someone did.', 'A lip-out.', 'Into the water.'];

  function save() { put('gpHL', S); }
  function card(it, show, cls) {
    return '<div class="hl-card ' + (cls || '') + '"><div class="hl-img">' + (it.image ? '<img src="' + esc(it.image) + '" alt="" loading="eager">' : '') + '</div>' +
      '<div class="hl-txt"><span class="hl-type">' + esc(it.type) + '</span><b class="hl-name">' + esc(it.name) + '</b>' +
      (show ? '<b class="hl-price">' + money(it.price) + '</b>' : '<b class="hl-price hl-q" aria-label="Price hidden">£ ?</b>') + '</div></div>';
  }
  function head() {
    var best = mode === 'daily' ? (S.best || 0) : (S.free || 0);
    return '<div class="hl-top"><span class="hl-kick">' + (mode === 'daily' ? 'Daily run #' + DAY.n : 'Free play') + '</span>' +
      '<span class="hl-score">Streak <b>' + streak + '</b> · Best ' + Math.max(best, streak) + '</span></div>' +
      (mode === 'daily' ? '<div class="hl-bar" aria-hidden="true"><i style="width:' + Math.min(100, streak / Math.max(1, items.length - 1) * 100) + '%"></i></div>' : '');
  }
  function play() {
    var a = items[pos], b = items[pos + 1];
    if (!b) return over(true);
    box.innerHTML = head() + '<div class="hl-pair">' + card(a, true, 'hl-a') + '<span class="hl-vs" aria-hidden="true">VS</span>' + card(b, false, 'hl-b') + '</div>' +
      '<p class="hl-ask">Is the <b>' + esc(b.type) + '</b> higher or lower than ' + money(a.price) + '?</p>' +
      '<div class="hl-btns"><button type="button" class="hl-hi" data-g="hi">Higher</button><button type="button" class="hl-lo" data-g="lo">Lower</button></div>' +
      (mode === 'daily' ? '<p class="hl-small">Same pairs for everyone today. This run counts for your league.</p>' : '<p class="hl-small">Free play: doesn’t count for the table. <button type="button" class="hl-link" id="hl-quit">Back to today’s result</button></p>');
    box.querySelectorAll('[data-g]').forEach(function (btn) { btn.onclick = function () { guess(btn.getAttribute('data-g')); }; });
    var q = box.querySelector('#hl-quit'); if (q) q.onclick = function () { mode = 'daily'; over(false, true); };
  }
  function guess(g) {
    if (busy) return; busy = true;
    var a = items[pos], b = items[pos + 1], right = g === 'hi' ? b.price > a.price : b.price < a.price;
    box.querySelectorAll('[data-g]').forEach(function (x) { x.disabled = true; x.classList.toggle('is-picked', x.getAttribute('data-g') === g); });
    var el = box.querySelector('.hl-b .hl-price'), cardB = box.querySelector('.hl-b');
    var t0 = null, dur = reduce ? 1 : 650;
    function tick(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = money(Math.round(b.price * e * 100) / 100);
      if (k < 1) return requestAnimationFrame(tick);
      el.textContent = money(b.price); el.classList.remove('hl-q'); el.removeAttribute('aria-label');
      cardB.classList.add(right ? 'is-right' : 'is-wrong');
      cardB.insertAdjacentHTML('beforeend', '<span class="hl-flag">' + (g === 'hi' ? 'Higher' : 'Lower') + (right ? '. Correct!' : '. Not this time.') + '</span>');
      if (right) {
        streak++; pos++;
        if (mode === 'daily') { S.n = DAY.n; S.pos = pos; S.streak = streak; save(); }
        setTimeout(function () { busy = false; play(); }, reduce ? 500 : 950);
      } else {
        result = { a: a, b: b, g: g };
        setTimeout(function () { busy = false; over(false); }, 1300);
      }
    }
    requestAnimationFrame(tick);
  }
  function over(perfect, back) {
    if (mode === 'daily' && !back) {
      S.n = DAY.n; S.done = true; S.streak = streak; S.best = Math.max(S.best || 0, streak);
      if (result) S.miss = { a: result.a, b: result.b, g: result.g };
      save();
      track('hl_daily_end', { streak: streak });
      fetch(API + '/pp/hl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: pid(), n: DAY.n, streak: streak }) })
        .then(function (r) { return r.json(); }).then(function (r) { if (r && r.ok) { S.beat = r.beat; S.runs = r.runs; S.streak = r.streak; save(); if (mode === 'daily') endScreen(); } }).catch(function () {});
    }
    if (mode === 'free' && !back) { S.free = Math.max(S.free || 0, streak); save(); track('hl_free_end', { streak: streak }); }
    if (mode === 'daily' || back) return endScreen(perfect);
    freeEnd();
  }
  function missLine(m) {
    if (!m) return '';
    var dir = m.b.price > m.a.price ? 'higher' : 'lower';
    return '<div class="hl-miss"><span>The one that got you</span><p><b>' + esc(m.b.name) + '</b> is ' + money(m.b.price) + ', ' + dir + ' than ' + esc(m.a.name) + ' at ' + money(m.a.price) + '. ' + (/putter/i.test(m.a.type + m.b.type) ? 'Putters, eh.' : MISS[(m.b.price * 100 | 0) % MISS.length]) + '</p>' +
      '<a href="/prices/' + esc(m.b.slug) + '/?utm_source=higher_lower">See today’s prices ›</a></div>';
  }
  function endScreen(perfect) {
    mode = 'daily';
    var s = S.streak || 0, beat = S.beat;
    box.innerHTML = '<div class="hl-end"><span class="hl-kick">Daily run #' + DAY.n + (perfect || s >= items.length - 1 ? ' · perfect' : ' over') + '</span>' +
      '<h2>' + s + ' in a row</h2><p>' + (beat !== null && beat !== undefined && S.runs > 1 ? 'Better than ' + beat + '% of today’s runs. ' : '') + 'Your best is ' + (S.best || s) + '.</p>' +
      missLine(S.miss) +
      '<div class="hl-actions"><button type="button" class="hl-btn" id="hl-share">Share my streak</button><button type="button" class="hl-btn2" id="hl-free">Free play</button></div>' +
      '<p class="hl-small">Next daily run: tomorrow morning, with the new prices. <a href="/play/leagues/">Your leagues</a> · <a href="/play/par-price/">Par Price</a></p></div>';
    box.querySelector('#hl-share').onclick = share;
    box.querySelector('#hl-free').onclick = free;
  }
  function freeEnd() {
    box.innerHTML = '<div class="hl-end"><span class="hl-kick">Free play</span><h2>' + streak + ' in a row</h2><p>Free-play best: ' + (S.free || streak) + '. Today’s daily run stays at ' + (S.streak || 0) + '.</p>' +
      missLine(result) + '<div class="hl-actions"><button type="button" class="hl-btn" id="hl-free">Go again</button><button type="button" class="hl-btn2" id="hl-back">Today’s result</button></div></div>';
    box.querySelector('#hl-free').onclick = free;
    box.querySelector('#hl-back').onclick = function () { endScreen(); };
  }
  function free() {
    track('hl_free_start');
    (POOL ? Promise.resolve(POOL) : fetch('/data/higher-or-lower/pool.json').then(function (r) { return r.json(); }).then(function (d) { POOL = d.items; return POOL; }))
      .then(function (pool) {
        var bag = pool.slice(), out = [];
        for (var i = bag.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = bag[i]; bag[i] = bag[j]; bag[j] = t; }
        out.push(bag.pop());
        while (out.length < 200 && bag.length) {
          var prev = out[out.length - 1], k = -1;
          for (var x = 0; x < bag.length; x++) {
            var lo = Math.min(bag[x].price, prev.price), hi = Math.max(bag[x].price, prev.price);
            if (hi >= lo * 1.05 && bag[x].type !== prev.type) { k = x; break; }
          }
          if (k < 0) break;
          out.push(bag.splice(k, 1)[0]);
        }
        mode = 'free'; items = out; pos = 0; streak = 0; result = null; play();
      }).catch(function () { box.innerHTML = '<p class="hl-loading">Couldn’t load free play just now. Please refresh.</p>'; });
  }

  /* ---- the share picture */
  function share() {
    var s = S.streak || 0, text = 'I got ' + s + ' in a row on Higher or Lower (golf prices) today. Beat me: ' + SITE + '/play/higher-or-lower/';
    track('hl_share', { streak: s });
    var fonts = document.fonts ? Promise.all(['800 64px Poppins', '700 30px Poppins', '600 24px Inter'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : Promise.resolve();
    fonts.then(function () {
      var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d');
      g.fillStyle = '#141515'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#3fae29'; g.lineWidth = 8; g.strokeRect(40, 40, W - 80, H - 80);
      g.fillStyle = '#8fd77e'; g.font = '800 30px Inter, sans-serif'; g.fillText(('Higher or Lower · Daily run #' + DAY.n).toUpperCase(), 100, 150);
      g.fillStyle = '#ffffff'; g.font = '800 150px Poppins, sans-serif'; g.fillText(s + ' in a row', 100, 330);
      g.fillStyle = '#c9cdca'; g.font = '600 40px Inter, sans-serif';
      g.fillText(S.beat !== null && S.beat !== undefined && S.runs > 1 ? 'Better than ' + S.beat + '% of today’s runs' : 'Golf prices, real and painful', 100, 410);
      var cells = Math.min(50, s + (S.miss ? 1 : 0)), cols = 10, size = 70, gap = 14, x0 = 100, y0 = 500;
      for (var i = 0; i < Math.max(cells, 1); i++) {
        g.fillStyle = i < s ? '#3fae29' : '#f08a24';
        var cx = x0 + (i % cols) * (size + gap), cy = y0 + Math.floor(i / cols) * (size + gap);
        if (g.roundRect) { g.beginPath(); g.roundRect(cx, cy, size, size, 12); g.fill(); } else g.fillRect(cx, cy, size, size);
      }
      g.font = '700 46px Poppins, sans-serif'; g.fillStyle = '#ffffff'; g.fillText('Golf', 100, H - 130);
      var gw = g.measureText('Golf').width; g.fillStyle = '#3fae29'; g.fillText('Price', 100 + gw, H - 130);
      var pw = g.measureText('Price').width; g.fillStyle = '#ffffff'; g.fillText(' AI', 100 + gw + pw, H - 130);
      g.fillStyle = '#c9cdca'; g.font = '600 32px Inter, sans-serif'; g.textAlign = 'right'; g.fillText('Beat me: golfpriceai.com/play', W - 100, H - 132);
      cv.toBlob(function (b) {
        var file = b ? new File([b], 'higher-or-lower.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], text: text }).catch(function () {});
        if (navigator.share) return navigator.share({ text: text }).catch(function () {});
        window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      }, 'image/png');
    });
  }

  fetch('/data/higher-or-lower/today.json').then(function (r) { if (!r.ok) throw new Error('today'); return r.json(); }).then(function (d) {
    DAY = d; items = d.items || [];
    if (S.n !== d.n) S = { best: S.best || 0, free: S.free || 0, n: d.n, pos: 0, streak: 0, done: false };
    if (S.done) return endScreen();
    pos = S.pos || 0; streak = S.streak || 0;
    if (!pos) track('hl_daily_start');
    play();
  }).catch(function () { box.innerHTML = '<p class="hl-loading">Today’s run isn’t ready yet. Please try again in a minute.</p>'; });
})();
