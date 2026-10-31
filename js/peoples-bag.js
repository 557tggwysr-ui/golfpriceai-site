/* The People's Bag (/play/peoples-bag/). Pick a model in each of eight slots;
   the most-picked in each slot makes the People's Bag. The models come from
   /data/peoples-bag.json (prices updated every 6 hours); picks go to the
   alerts worker (/pb/...) under this browser's random player id (gpPid). */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var root = document.querySelector('.pb');
  if (!root) return;
  function $(s, el) { return (el || root).querySelector(s); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(a, n) { return n ? Math.round(a / n * 100) : 0; }
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
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function track(ev, p) { try { if (window.gtag) window.gtag('event', ev, p || {}); } catch (e) { /* fine */ } }
  gpUse('pb_view');

  var data = null, state = null, bySlot = {}, items = {};
  function set(k, v, html) { root.querySelectorAll('[data-pb="' + k + '"]').forEach(function (el) { if (html) el.innerHTML = v; else el.textContent = v; }); }

  // The People's pick in a slot: most picks; ties go to the more-viewed model.
  function winner(key) {
    var s = state && state.slots[key];
    if (!s || !s.top.length) return null;
    var best = s.top.filter(function (t) { return t.c === s.top[0].c && items[key][t.s]; });
    if (!best.length) return null;
    var order = bySlot[key].items.map(function (x) { return x.s; });
    best.sort(function (a, b) { return order.indexOf(a.s) - order.indexOf(b.s); });
    return { s: best[0].s, c: best[0].c, n: s.n };
  }
  function mine() { return (state && state.mine) || get('gpPbMine', {}) || {}; }

  function draw() {
    if (!data) return;
    var my = mine(), total = 0, filled = 0, myTotal = 0, myN = 0, agree = 0, race = null;
    data.slots.forEach(function (sl) {
      var row = $('.pb-slot[data-slot="' + sl.key + '"]'), w = winner(sl.key), it = w && items[sl.key][w.s];
      var unit = sl.unit ? ' ' + sl.unit : '';
      if (it) {
        total += it.p; filled++;
        $('[data-pb="name"]', row).innerHTML = '<a href="/prices/' + esc(it.s) + '/">' + esc(it.n) + '</a>';
        $('[data-pb="sub"]', row).textContent = pct(w.c, w.n) + '% of golfers' + (my[sl.key] === it.s ? ' · your pick too' : '') + (unit ? ' ·' + unit : '');
        $('[data-pb="price"]', row).textContent = money(it.p);
      } else {
        $('[data-pb="name"]', row).textContent = 'No picks yet. Be the first.';
        $('[data-pb="sub"]', row).textContent = '';
        $('[data-pb="price"]', row).textContent = '';
      }
      var mi = my[sl.key] && items[sl.key][my[sl.key]];
      $('.pb-pick', row).textContent = mi ? 'Change' : 'Pick yours';
      if (mi) { myTotal += mi.p; myN++; if (it && it.s === mi.s) agree++; }
      var s = state && state.slots[sl.key];
      if (s && s.top.length > 1 && s.top[1].c >= 2) {
        var gap = s.top[0].c - s.top[1].c;
        if (!race || gap < race.gap) race = { gap: gap, slot: sl, a: s.top[0], b: s.top[1], n: s.n };
      }
    });
    var tot = filled ? money(total) : '–';
    set('total', filled ? '£' + Math.round(total).toLocaleString('en-GB') : '–'); set('total2', filled < 8 && filled ? tot + ' so far' : tot);
    set('pickers', state ? Number(state.pickers).toLocaleString('en-GB') : '–');
    set('progress', 'Your bag: ' + myN + ' of 8 slots picked');
    $('[data-pb="bar"]').style.width = (myN / 8 * 100) + '%';
    var next = data.slots.filter(function (sl) { return !my[sl.key]; })[0];
    var nb = $('[data-pb="next"]');
    nb.hidden = !next;
    if (next) { nb.textContent = 'Pick my ' + next.noun; nb.setAttribute('data-slot', next.key); }
    set('youline', myN === 8 ? 'Your bag’s full. Change any slot whenever you like.' : 'Fill all eight and you’ll see how your bag stacks up against the nation’s, to the penny.');
    var vs = $('#pb-vs');
    if (myN === 8 && filled === 8) {
      var d = myTotal - total, h;
      if (Math.abs(d) < 10) h = 'Practically the same money as the nation. Great minds.';
      else if (d < 0) h = 'You’re ' + money(-d) + ' cheaper than the nation. Thrifty.';
      else h = 'You’re ' + money(d) + ' dearer than the nation. Treat yourself.';
      set('vs', h);
      set('vsline', 'Your bag: ' + money(myTotal) + '. You agree with the crowd on ' + agree + ' of 8 slots. Share it and let your four-ball judge.');
      vs.hidden = false;
    } else vs.hidden = true;
    var rc = $('#pb-race');
    if (race) {
      var ia = items[race.slot.key][race.a.s], ib = items[race.slot.key][race.b.s];
      if (ia && ib) {
        set('race', race.slot.label + ': ' + (race.gap === 0 ? 'dead level' : race.gap === 1 ? 'one pick in it' : race.gap + ' picks in it'));
        set('raceline', ia.n + ' ' + pct(race.a.c, race.n) + '% · ' + ib.n + ' ' + pct(race.b.c, race.n) + '%. Your pick could swing it.');
        rc.hidden = false;
      }
    } else rc.hidden = true;
  }

  /* ------------------------------------------------ the picker sheet */
  var back = null;
  function close() { if (back) { back.remove(); back = null; document.removeEventListener('keydown', onKey); } }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function opt(sl, x, note) {
    var on = mine()[sl.key] === x.s;
    return '<button type="button" class="pb-opt" data-s="' + esc(x.s) + '" aria-pressed="' + on + '"><span><b>' + esc(x.n) + '</b>' + (note ? '<small>' + note + '</small>' : '') + '</span><strong>' + money(x.p) + '</strong></button>';
  }
  function open(key) {
    close();
    var sl = bySlot[key], idx = data.slots.indexOf(sl), s = state && state.slots[key];
    back = document.createElement('div'); back.className = 'pb-back';
    var picked = (s ? s.top : []).filter(function (t) { return items[key][t.s]; }).slice(0, 5);
    var pickedHtml = picked.map(function (t) { return opt(sl, items[key][t.s], pct(t.c, s.n) + '% of golfers' + (mine()[key] === t.s ? ' · your pick' : '')); }).join('');
    var seen = {}; picked.forEach(function (t) { seen[t.s] = 1; });
    var popular = sl.items.filter(function (x) { return !seen[x.s]; }).slice(0, picked.length ? 5 : 8).map(function (x) { return opt(sl, x, mine()[key] === x.s ? 'your pick' : ''); }).join('');
    back.innerHTML = '<section class="pb-sheet" role="dialog" aria-modal="true" aria-label="Pick your ' + esc(sl.noun) + '">' +
      '<div class="pb-sheet-top"><span>SLOT ' + (idx + 1) + ' OF 8</span><button type="button" class="pb-x" aria-label="Close"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#14211a" stroke-width="2.4" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<h2>Which ' + esc(sl.noun) + ' goes in your bag?</h2>' +
      '<p>Pick the one you’d actually bag. Price isn’t everything, but it’s shown anyway. We’re like that.</p>' +
      '<label class="pb-search">Search ' + sl.items.length + ' ' + esc(sl.label.toLowerCase()) + (sl.key === 'irons' ? '' : 's') + '<input type="search" autocomplete="off" placeholder="Type a brand or model"></label>' +
      '<div class="pb-found" hidden><div class="pb-list"></div></div>' +
      '<div class="pb-lists">' + (pickedHtml ? '<span class="pb-list-h">MOST PICKED SO FAR</span><div class="pb-list">' + pickedHtml + '</div>' : '') +
      '<span class="pb-list-h">MOST VIEWED ON GOLFPRICE AI</span><div class="pb-list">' + popular + '</div></div>' +
      '<p class="pb-msg" role="status"></p></section>';
    document.body.appendChild(back);
    document.addEventListener('keydown', onKey);
    var input = back.querySelector('input'), found = back.querySelector('.pb-found'), lists = back.querySelector('.pb-lists');
    input.addEventListener('input', function () {
      var q = input.value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
      if (!q.length) { found.hidden = true; lists.hidden = false; return; }
      var hits = sl.items.filter(function (x) { var n = x.n.toLowerCase(); return q.every(function (w) { return n.indexOf(w) >= 0; }); }).slice(0, 12);
      found.querySelector('.pb-list').innerHTML = hits.length ? hits.map(function (x) { return opt(sl, x, ''); }).join('') : '<p>Nothing matches that. Try just the brand.</p>';
      found.hidden = false; lists.hidden = true;
    });
    back.addEventListener('click', function (e) {
      if (e.target === back || e.target.closest('.pb-x')) return close();
      var b = e.target.closest('.pb-opt');
      if (b) choose(sl, b.getAttribute('data-s'), b);
      var n = e.target.closest('[data-next]');
      if (n) open(n.getAttribute('data-next'));
    });
    setTimeout(function () { var x = back && back.querySelector('.pb-x'); if (x) x.focus(); }, 30);
  }
  function choose(sl, slug, btn) {
    var msg = back.querySelector('.pb-msg');
    btn.disabled = true;
    fetch(API + '/pb/pick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: pid(), slot: sl.key, slug: slug }) })
      .then(function (r) { return r.json(); }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        state = r; put('gpPbMine', r.mine || {});
        track('peoples_bag_pick', { slot: sl.key });
        draw();
        var s = r.slots[sl.key], mineC = 0;
        (s ? s.top : []).forEach(function (t) { if (t.s === slug) mineC = t.c; });
        var share = s && mineC ? pct(mineC, s.n) : 0;
        var next = data.slots.filter(function (x) { return !(r.mine || {})[x.key]; })[0];
        var left = data.slots.filter(function (x) { return !(r.mine || {})[x.key]; }).length;
        var sheet = back.querySelector('.pb-sheet');
        sheet.querySelectorAll('.pb-search, .pb-found, .pb-lists, p:not(.pb-msg)').forEach(function (el) { el.remove(); });
        var head = sheet.querySelector('h2');
        head.textContent = items[sl.key][slug].n;
        var done = document.createElement('div'); done.className = 'pb-done';
        done.innerHTML = '<span>PICKED</span><b>' + (share >= 100 && s.n === 1 ? 'You’re the first to pick this slot. Trendsetter.' : share ? 'Nice. You and ' + share + '% of the nation agree.' : 'Nice pick.') + '</b>' +
          '<p>' + (next ? 'Next up: ' + esc(next.noun) + '. ' + (left === 1 ? 'One slot to go.' : left + ' slots to go.') : 'That’s your bag full. See how it compares.') + '</p>' +
          (next ? '<button type="button" class="cc-btn" data-next="' + next.key + '">Pick my ' + esc(next.noun) + '</button>' : '<button type="button" class="cc-btn pb-close">See my bag</button>');
        sheet.insertBefore(done, msg);
        var c = done.querySelector('.pb-close'); if (c) c.addEventListener('click', close);
        var f = done.querySelector('button'); if (f) f.focus();
      }).catch(function () { btn.disabled = false; msg.textContent = 'Couldn’t save that just now. Please try again.'; });
  }

  root.addEventListener('click', function (e) {
    var b = e.target.closest('[data-pick], [data-pb="next"]');
    if (b && data) open(b.getAttribute('data-pick') || b.getAttribute('data-slot'));
    if (e.target.closest('[data-pb="share"]')) shareBag();
  });
  function shareBag() {
    var my = mine(), lines = [], tot = 0;
    data.slots.forEach(function (sl) { var x = items[sl.key][my[sl.key]]; if (x) { lines.push(sl.label + ': ' + x.n); tot += x.p; } });
    var text = 'My golf bag on GolfPrice AI, ' + money(tot) + ' at today’s UK prices:\n' + lines.join('\n') + '\nBuild yours and see how it compares with the People’s Bag:';
    var url = 'https://golfpriceai.com/play/peoples-bag/';
    gpUse('pb_share');
    if (navigator.share) navigator.share({ text: text, url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text + ' ' + url).then(function () { set('vsline', 'Copied. Paste it in the group chat.'); });
  }

  Promise.all([
    fetch('/data/peoples-bag.json').then(function (r) { return r.json(); }),
    fetch(API + '/pb/state' + (/^[a-z0-9]{12,32}$/.test(get('gpPid', '')) ? '?pid=' + get('gpPid', '') : '')).then(function (r) { return r.json(); }).catch(function () { return null; }),
  ]).then(function (rs) {
    data = rs[0];
    data.slots.forEach(function (sl) { bySlot[sl.key] = sl; items[sl.key] = {}; sl.items.forEach(function (x) { items[sl.key][x.s] = x; }); });
    state = rs[1] && rs[1].ok ? rs[1] : { pickers: 0, slots: {}, mine: get('gpPbMine', {}) };
    if (rs[1] && rs[1].ok && rs[1].mine) put('gpPbMine', rs[1].mine);
    draw();
  }).catch(function () { set('name', 'The bag is taking a breather. Please try again in a minute.'); });
})();
