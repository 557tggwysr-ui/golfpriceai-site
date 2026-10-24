/* GolfPrice AI: Prize Picker (/societies/prize/?t=<private token>).
   A society winner picks their own prize within the organiser's budget, from
   real products at today's lowest UK price (the site's own search data, built
   every 6 hours). The pick is saved to the alerts worker (/soc/prize) for the
   organiser's shopping list. Nothing is bought or paid here: the organiser
   buys it, and the winner can change their mind until then. */
(function () {
  'use strict';
  var box = document.getElementById('pz');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var token = (location.search.match(/[?&]t=([a-z0-9]{12})/i) || [])[1];
  var F_IN_STOCK = 2, F_DROP = 4, F_USED = 8;
  var CATS = [
    { k: 'for', label: 'For you' },
    { k: 'balls', label: 'Balls', shard: 'ball' },
    { k: 'gloves', label: 'Gloves', shard: 'accessories', rx: /\bglove/i },
    { k: 'kit', label: 'Bits for the bag', shard: 'accessories', rx: /towel|tees?\b|marker|divot|pitch ?mark|brush|alignment|retriever|umbrella|headcover|scorecard|ball (clip|holder|pouch)|tee (holder|pouch)|valuables|pouch/i },
    { k: 'clothing', label: 'Clothing', shard: 'apparel' }
  ];
  var SKIP = /\b(junior|juniors|kids|youth|boys|girls|ladies|lady|women'?s?|womens|personali[sz]ed|logo|practice|foam|recycled|lake|refurb|used|grade [abc]|pearl)\b/i;
  var NOT_DOZEN = /sleeve|\b3[ -]?ball|half dozen|\b6[ -]?(ball|pack)|pack of [36]\b|\b(15|24|30|36|48|50|100)[ -]?(ball|pack)|double|4 for 3|3 for 2|2 dozen|3 dozen/i;
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { n = Number(n); return '£' + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  if (!token) { box.innerHTML = '<section class="soc-card"><p>That prize link doesn’t look right. Ask your organiser to send it again.</p></section>'; return; }

  var P, T, items = {}, cat = 'for', pick = null;
  var SH = {};
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function shard(n) { if (!SH[n]) SH[n] = getJSON('/data/search/' + n + '.json'); return SH[n]; }
  // Listing names carry pack sizes and years we don't need on a prize card.
  function clean(n) { return String(n).replace(/\s*\(dozen\)/i, '').replace(/\s*-?\s*12 pack\b/i, '').replace(/\b20(2[3-9])\b\s*/g, '').replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim(); }
  function img(r) { var i = r[14]; return i && i[1] ? (/^https?:/.test(i[1]) ? i[1] : T.imgPrefixes[i[0]] + i[1]) : ''; }
  // Products for a category: new, in stock, men's or unisex, within budget, one per product.
  function list(c) {
    if (items[c.k]) return Promise.resolve(items[c.k]);
    return shard(c.shard).then(function (d) {
      var seen = {}, out = [];
      d.rows.forEach(function (r) {
        if (!(r[5] & F_IN_STOCK) || (r[5] & F_USED) || r[2] > P.budget || r[2] < 4) return;
        if (r[6] && r[6] !== 'M' && r[6] !== 'U') return;
        if (SKIP.test(r[1])) return;
        if (c.rx && !c.rx.test(r[1])) return;
        if (c.k === 'balls' && NOT_DOZEN.test(r[1])) return;
        if (c.k === 'clothing' && !/shirt|polo|jumper|sweater|pullover|mid ?layer|jacket|gilet|vest|hat|cap|beanie|trousers|shorts|snood|base ?layer/i.test(r[1])) return;
        var base = r[1].split(' - ')[0].replace(/\s+(golf )?(balls?)$/i, '').trim().toLowerCase();
        if (seen[base] && seen[base][2] <= r[2]) return;
        seen[base] = r;
      });
      Object.keys(seen).forEach(function (b) { out.push(seen[b]); });
      // Best use of the budget first, with genuine price drops nudged up.
      out.sort(function (a, b) { return (b[2] + ((b[5] & F_DROP) ? P.budget * 0.15 : 0)) - (a[2] + ((a[5] & F_DROP) ? P.budget * 0.15 : 0)); });
      items[c.k] = out.slice(0, 24).map(function (r) { return { r: r, cat: c.shard, k: c.k }; });
      return items[c.k];
    });
  }
  function forYou() {
    if (items['for']) return Promise.resolve(items['for']);
    return Promise.all(CATS.slice(1).map(list)).then(function (ls) {
      var out = [];
      for (var i = 0; i < 3; i++) ls.forEach(function (l) { if (l[i]) out.push(l[i]); });
      items['for'] = out.slice(0, 12);
      return items['for'];
    });
  }

  function start() {
    var c = P.choice;
    box.innerHTML = '<section class="pz-hero"><span class="soc-kick">' + esc(P.society) + (P.season ? ' · ' + esc(P.season) : '') + '</span>' +
      '<h1>Well played, ' + esc(P.winner) + '!</h1><p>' + esc(P.title) + '. Your prize: pick anything up to</p><b class="pz-budget">' + money(P.budget) + '</b>' +
      '<p class="pz-note">Today’s lowest prices across multiple UK retailers. The organiser buys it; you just choose.</p></section>' +
      (c ? '<p class="pz-done">' + (c.surprise ? 'You chose “Surprise me”. ' : 'You picked <b>' + esc(c.name) + '</b> (' + money(c.price) + '). ') + 'Change your mind below if you like.</p>' : '') +
      '<div class="pz-tabs" role="tablist" aria-label="Prize categories">' + CATS.map(function (x) {
        return '<button type="button" role="tab" class="pz-tab" data-k="' + x.k + '" aria-selected="' + (x.k === cat) + '">' + esc(x.label) + '</button>';
      }).join('') + '</div>' +
      '<div class="pz-grid" id="pz-grid" aria-live="polite"><p class="soc-loading">Finding prizes within ' + money(P.budget) + '…</p></div>' +
      '<div class="pz-bar" id="pz-bar" hidden></div>';
    box.querySelectorAll('.pz-tab').forEach(function (b) { b.onclick = function () { cat = b.getAttribute('data-k'); box.querySelectorAll('.pz-tab').forEach(function (x) { x.setAttribute('aria-selected', x === b); }); grid(); }; });
    grid();
  }
  function grid() {
    var el = box.querySelector('#pz-grid');
    var c = CATS.filter(function (x) { return x.k === cat; })[0];
    (cat === 'for' ? forYou() : list(c)).then(function (l) {
      var cards = l.map(function (it, i) {
        var r = it.r, on = pick && pick.r[0] === r[0];
        return '<button type="button" class="pz-item' + (on ? ' on' : '') + '" data-i="' + i + '" aria-pressed="' + on + '">' +
          (img(r) ? '<img src="' + esc(img(r)) + '" alt="" loading="lazy" width="200" height="200">' : '<span class="pz-noimg">' + esc(r[7] || 'Golf') + '</span>') +
          ((r[5] & F_DROP) ? '<span class="pz-tag">Price drop</span>' : '') +
          '<b>' + esc(clean(r[1])) + (it.k === 'balls' ? ' <small>a dozen</small>' : '') + '</b><span class="pz-price">' + money(r[2]) + '</span></button>';
      });
      cards.push('<button type="button" class="pz-item pz-surprise' + (pick === 'surprise' ? ' on' : '') + '" data-s="1" aria-pressed="' + (pick === 'surprise') + '"><span class="pz-q">?</span><b>Surprise me</b><span class="pz-price">The organiser picks, up to ' + money(P.budget) + '</span></button>');
      el.innerHTML = l.length ? cards.join('') : '<p class="soc-help">Nothing in this category fits ' + money(P.budget) + ' today. Try another, or “Surprise me”.</p>' + cards.pop();
      el.querySelectorAll('.pz-item img').forEach(function (im) {
        im.addEventListener('error', function () { var sp = document.createElement('span'); sp.className = 'pz-noimg'; sp.textContent = 'Photo on the shop’s page'; im.replaceWith(sp); });
      });
      el.querySelectorAll('.pz-item').forEach(function (b) {
        b.onclick = function () {
          pick = b.getAttribute('data-s') ? 'surprise' : l[+b.getAttribute('data-i')];
          el.querySelectorAll('.pz-item').forEach(function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
          bar();
        };
      });
    }).catch(function () { el.innerHTML = '<p class="soc-help">Couldn’t load today’s prices just now. Please refresh.</p>'; });
  }
  function bar() {
    var el = box.querySelector('#pz-bar'); el.hidden = false;
    var name = pick === 'surprise' ? 'Surprise me' : clean(pick.r[1]), price = pick === 'surprise' ? 0 : pick.r[2];
    var left = Math.max(0, P.budget - price);
    el.innerHTML = '<div class="pz-bar-h"><b>Your pick: ' + esc(name) + '</b>' + (price ? '<b>' + money(price) + '</b>' : '') + '</div>' +
      (price ? '<div class="pz-meter" aria-hidden="true"><i style="width:' + Math.min(100, price / P.budget * 100) + '%"></i></div><span class="soc-help">' + money(left) + ' of your ' + money(P.budget) + ' left.</span>' : '<span class="soc-help">The organiser will choose something up to ' + money(P.budget) + '.</span>') +
      '<button type="button" class="soc-btn" id="pz-go">Confirm my prize</button><p class="soc-msg" role="status"></p>';
    el.querySelector('#pz-go').onclick = function () {
      var b = this, msg = el.querySelector('.soc-msg'); b.disabled = true; msg.textContent = 'Wrapping it up…';
      var body = pick === 'surprise' ? { t: token, surprise: true } : { t: token, choice: { id: pick.r[0], cat: pick.cat, name: clean(pick.r[1]), price: pick.r[2] } };
      api('/soc/prize', body).then(function (r) {
        b.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        track('society_prize_pick', { surprise: pick === 'surprise' ? 1 : 0 });
        P.choice = r.choice;
        box.innerHTML = '<section class="pz-hero"><span class="soc-kick">' + esc(P.society) + '</span><h1>Done! 🏆</h1><p>' + (r.choice.surprise ? 'The organiser will pick something up to ' + money(P.budget) + '.' : 'You picked <b>' + esc(r.choice.name) + '</b>. The organiser can see it on their list.') + '</p>' +
          '<button type="button" class="soc-btn2 pz-again">Change my pick</button></section>';
        box.querySelector('.pz-again').onclick = function () { pick = null; start(); };
      }).catch(function () { b.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    };
  }

  Promise.all([api('/soc/prize?t=' + token), getJSON('/data/search/terms.json')]).then(function (res) {
    P = res[0]; T = res[1];
    if (!P.ok) { box.innerHTML = '<section class="soc-card"><p>' + esc(P.error || 'We couldn’t find that prize.') + '</p></section>'; return; }
    start();
  }).catch(function () { box.innerHTML = '<section class="soc-card"><p>We couldn’t reach the clubhouse. Please refresh in a minute.</p></section>'; });
})();
