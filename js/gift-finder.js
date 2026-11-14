/* GolfPrice AI: gift finder, wishlists and "Drop a hint".
   - Gift hub (/prices/golf-gifts/): three questions filter the gift cards.
   - Any gift card: the heart saves it to a wishlist kept in this browser only;
     "Drop a hint" shares one gift, "Send it as a hint" shares the whole list.
   - Wishlist page (/prices/golf-gifts/wishlist/?i=...): shows the shared list
     with today's prices from /data/gifts.json.
   - Any ".gp-share" button shares the current page.
   - The Cheat Sheet (/cheat-sheet/): a golfer's glove hand and size, ball,
     clothing and shoe sizes, kept in this browser (gpSizes) and written into
     the wishlist link they send, so the buyer sees them on /wishlist/.
     Anonymous daily counts only (cs_make, cs_view, cs_click).
   Nothing here is sent to us: sharing uses the phone's share menu or WhatsApp.
   The page works without this script; only these extras need it. */
(function () {
  var KEY = 'gpWishlist';
  var BASE = location.origin + '/wishlist/';

  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 30) : []; }
    catch (e) { return []; }
  }
  function store(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* private mode */ } }
  function track(name, params) { if (window.gtag) window.gtag('event', name, params || {}); }

  function share(text, url) {
    if (navigator.share) {
      navigator.share({ text: text, url: url }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
    }
  }
  function count(k) { try { navigator.sendBeacon('https://golfpriceai-alerts.golfpriceai.workers.dev/use', JSON.stringify({ k: k })); } catch (e) { /* nice-to-have */ } }
  // ---------------------------------------------------------- the Cheat Sheet
  var SZ = 'gpSizes', FIELDS = ['gh', 'gs', 'b', 'sh', 'w', 'lg', 'sz', 'no'];
  var OK = {
    gh: /^[LR]$/, gs: /^(Cadet )?(S|M|M\/L|L|XL|XXL)$/, sh: /^(XS|S|M|L|XL|XXL|3XL)$/, w: /^(2[89]|3\d|4[0-6])$/, lg: /^[SRL]$/,
    sz: /^(5|6|7|8|9|10|11|12|13|14)(\.5)?$/, b: /^[\w À-ɏ'’&.,+\/-]{2,40}$/, no: /^[\w À-ɏ'’&.,+\/-]{2,60}$/
  };
  function clean(k, v) { v = String(v == null ? '' : v).trim(); return OK[k] && OK[k].test(v) ? v : ''; }
  function sizes() {
    try { var v = JSON.parse(localStorage.getItem(SZ) || '{}'); var o = {}; FIELDS.forEach(function (k) { var c = clean(k, v[k]); if (c) o[k] = c; }); o.for = cleanName(v.for); return o; }
    catch (e) { return {}; }
  }
  function saveSizes(o) { try { localStorage.setItem(SZ, JSON.stringify(o)); } catch (e) { /* private mode */ } }
  function cleanName(n) { return String(n || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').trim().slice(0, 20); }
  function sheetQuery(o) { return FIELDS.filter(function (k) { return o[k]; }).map(function (k) { return k + '=' + encodeURIComponent(o[k]); }).join('&'); }
  function hasSheet(o) { return FIELDS.some(function (k) { return o[k] && k !== 'no'; }); }
  function listUrl(keys, name, withSheet) {
    var q = [];
    if (name) q.push('for=' + encodeURIComponent(name));
    if (keys.length) q.push('i=' + keys.join(','));
    if (withSheet) { var sq = sheetQuery(sizes()); if (sq) q.push(sq); }
    return BASE + (q.length ? '?' + q.join('&') : '');
  }

  // ---------------------------------------------------------- page sharing
  document.querySelectorAll('.gp-share').forEach(function (b) {
    b.addEventListener('click', function () {
      share(b.getAttribute('data-text') || document.title, location.origin + location.pathname + '?utm_source=share&utm_medium=social');
      track('share_page', { page: location.pathname });
    });
  });

  // ---------------------------------------------------------- wishlist + hints
  var wish = load();
  var bar = document.querySelector('.gf-bar');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.gf-card'));

  function paint() {
    cards.forEach(function (c) {
      var on = wish.indexOf(c.getAttribute('data-key')) !== -1;
      var b = c.querySelector('.gf-save');
      if (b) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('gf-on', on); }
    });
    if (bar) {
      bar.hidden = wish.length === 0;
      bar.querySelector('.gf-bar-count b').textContent = wish.length;
    }
  }
  cards.forEach(function (c) {
    var key = c.getAttribute('data-key');
    var save = c.querySelector('.gf-save');
    var hint = c.querySelector('.gf-hint');
    if (save) save.addEventListener('click', function () {
      var i = wish.indexOf(key);
      if (i === -1) wish.push(key); else wish.splice(i, 1);
      store(wish); paint();
      track('wishlist_save', { saved: i === -1 });
    });
    if (hint) hint.addEventListener('click', function () {
      share('Hint, hint… the ' + c.getAttribute('data-name') + ' is ' + c.getAttribute('data-price') +
            ' today on GolfPrice AI:', listUrl([key], ''));
      track('drop_hint', { items: 1 });
    });
  });
  if (bar) {
    bar.querySelector('.gf-send').addEventListener('click', function () {
      if (!wish.length) return;
      var name = (bar.querySelector('input').value || '').trim().replace(/[^A-Za-zÀ-ɏ' -]/g, '').slice(0, 20);
      var withSheet = hasSheet(sizes());
      share('Hint, hint… ' + (name ? name + '’s' : 'my') + ' golf wishlist' + (withSheet ? ' and sizes' : '') + ', with today’s best UK prices on GolfPrice AI:', listUrl(wish, name, withSheet));
      track('drop_hint', { items: wish.length });
      if (withSheet) count('cs_make');
    });
    bar.querySelector('.gf-clear').addEventListener('click', function () {
      if (!window.confirm('Clear your wishlist? This removes every saved gift.')) return;
      wish = [];
      store(wish); paint();
      track('wishlist_clear');
    });
  }
  paint();

  // ---------------------------------------------------------- gift finder
  var grid = document.querySelector('.gf-grid');
  if (grid) {
    var pick = { band: 'any', kind: 'any', safe: '1' };
    var LIMIT = 24, extra = 0;
    var more = document.querySelector('.gf-more');
    var none = document.querySelector('.gf-none');
    var count = document.querySelector('.gf-count');
    function ok(c) {
      return (pick.band === 'any' || c.getAttribute('data-band') === pick.band) &&
             (pick.kind === 'any' || c.getAttribute('data-kind') === pick.kind) &&
             (pick.safe === 'any' || c.getAttribute('data-safe') === '1');
    }
    function render() {
      var n = 0, shown = 0;
      cards.forEach(function (c) {
        var m = ok(c);
        if (m) n++;
        var show = m && shown < LIMIT + extra;
        c.hidden = !show;
        if (show) shown++;
      });
      if (none) none.hidden = n > 0;
      if (more) more.hidden = n <= shown;
      if (count) count.textContent = n + (n === 1 ? ' gift idea' : ' gift ideas') + (pick.safe === '1' ? ', all gift-safe' : '');
    }
    document.querySelectorAll('.gf-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var g = chip.getAttribute('data-group');
        pick[g] = chip.getAttribute('data-v');
        extra = 0;
        document.querySelectorAll('.gf-chip[data-group="' + g + '"]').forEach(function (o) {
          var on = o === chip;
          o.classList.toggle('sg-on', on);
          o.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        render();
        track('gift_finder', { band: pick.band, kind: pick.kind, safe: pick.safe });
      });
    });
    if (more) more.addEventListener('click', function () { extra += LIMIT; render(); });
    render();
  }

  // ---------------------------------------------------------- shared wishlist page
  var wl = document.getElementById('gf-wishlist');
  if (wl) {
    var params = new URLSearchParams(location.search);
    var keys = (params.get('i') || '').split(',').filter(function (k) { return /^[0-9a-f]{10}$/.test(k); }).slice(0, 30);
    var who = (params.get('for') || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').trim().slice(0, 20);
    if (who) wl.querySelector('.gf-wl-title').textContent = who + '’s golf wishlist';
    var list = document.querySelector('.gf-wl-list');
    var empty = document.querySelector('.gf-wl-empty');
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
    function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    fetch('/data/gifts.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (data) {
      var found = 0;
      keys.forEach(function (k) {
        var g = data[k];
        if (!g) return;
        found++;
        var li = el('li', 'pp-card gf-wl-item');
        var img = el('span', 'gf-wl-img');
        if (g.img) { var im = document.createElement('img'); im.src = g.img; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.onerror = function () { img.classList.add('sg-noimg'); im.remove(); }; img.appendChild(im); }
        else img.classList.add('sg-noimg');
        var mid = el('span', 'gf-wl-mid');
        var tags = el('span', 'gf-tags');
        tags.appendChild(el('span', 'gf-tag ' + (g.check ? 'gf-check' : 'gf-safe'), g.check || 'Gift-safe'));
        if (g.verdict === 'good') tags.appendChild(el('span', 'gf-tag gf-good', 'Good price today'));
        if (g.verdict === 'wait') tags.appendChild(el('span', 'gf-tag gf-wait', 'Usually cheaper: maybe wait'));
        mid.appendChild(tags);
        mid.appendChild(el('span', 'sg-name', g.name));
        mid.appendChild(el('span', 'pp-sub', g.sub));
        var end = el('span', 'gf-wl-end');
        end.appendChild(el('span', 'sg-price', money(g.price) + (g.per ? ' ' + g.per : '')));
        var a = el('a', 'gp-af-btn', g.ext ? 'See it at the retailer' : 'Compare prices');
        a.href = g.href;
        if (g.ext) { a.target = '_blank'; a.rel = 'sponsored nofollow noopener'; }
        end.appendChild(a);
        if (!g.ext) { var al = el('a', 'gf-wl-alert', 'Email me if it drops'); al.href = g.href + '#price-alert'; end.appendChild(al); }
        li.appendChild(img); li.appendChild(mid); li.appendChild(end);
        list.appendChild(li);
      });
      if (empty) empty.hidden = found > 0;
      track('wishlist_view', { items: found });
    }).catch(function () { if (empty) empty.hidden = false; });
  }

  // ---------------------------------------------------------- Cheat Sheet page
  var csf = document.getElementById('cs-form');
  if (csf) {
    var F = csf.elements, mine = sizes();
    if (mine.for) F['for'].value = mine.for;
    FIELDS.forEach(function (k) { if (mine[k] && F[k]) F[k].value = mine[k]; });
    var wishLine = csf.querySelector('.cs-wish'), prev = csf.querySelector('.cs-preview');
    function readForm() { var o = { for: cleanName(F['for'].value) }; FIELDS.forEach(function (k) { var c = clean(k, F[k].value); if (c) o[k] = c; }); return o; }
    function refresh() {
      var o = readForm(); saveSizes(o);
      var w = load();
      wishLine.textContent = w.length ? 'Your ' + w.length + (w.length === 1 ? ' saved gift goes' : ' saved gifts go') + ' on the sheet too.' : '';
      prev.href = listUrl(w, o.for, true);
      return o;
    }
    csf.addEventListener('input', refresh); csf.addEventListener('change', refresh);
    refresh();
    // Opened from a buyer's "Ask for their Cheat Sheet" message.
    var asked = /[?&]ask=1\b/.test(location.search);
    if (asked) {
      var note = document.querySelector('.cs-ask-note'); if (note) note.hidden = false;
      var sendBtn = csf.querySelector('.cs-send'); if (sendBtn) sendBtn.textContent = 'Send it back';
      document.querySelectorAll('.pp-hub-top .cs-box-btns').forEach(function (b) { b.hidden = true; });
      count('cs_asked');
    }
    csf.addEventListener('submit', function (e) {
      e.preventDefault();
      var o = refresh();
      if (!hasSheet(o)) { wishLine.textContent = 'Add at least your glove, ball or a size first.'; return; }
      share(asked ? 'Here’s my golf Cheat Sheet: my glove, ball and sizes, so it fits first time.' : 'Buying me a golf present? Here’s my Cheat Sheet: glove, ball and sizes, so it fits first time.', listUrl(load(), o.for, true));
      track('cheat_sheet_send'); count('cs_make');
    });
  }

  // ---------------------------------------------------------- Cheat Sheet on a shared wishlist
  var sheet = document.querySelector('.cs-sheet');
  if (sheet) {
    var qp = new URLSearchParams(location.search), got = {};
    FIELDS.forEach(function (k) { var c = clean(k, qp.get(k)); if (c) got[k] = c; });
    if (hasSheet(got)) {
      var whoName = cleanName(qp.get('for'));
      var h = document.querySelector('.gf-wl-title'); if (h) h.textContent = (whoName ? whoName + '’s' : 'A') + ' golf Cheat Sheet';
      var rows = [];
      if (got.gh || got.gs) rows.push(['Golf glove', [got.gh ? (got.gh === 'L' ? 'Left hand' : 'Right hand') : '', got.gs ? 'size ' + got.gs : ''].filter(Boolean).join(', '), '/prices/golf-gloves/',
        got.gh ? (got.gh === 'L' ? 'A left-hand glove: the usual one for right-handed golfers.' : 'A right-hand glove: the one left-handed golfers wear.') : '']);
      if (got.b) rows.push(['Golf ball', got.b, '/search.html?q=' + encodeURIComponent(got.b), 'Golf balls are sold by the dozen. Get the exact model: golfers are fussy about this one.']);
      if (got.sh) rows.push(['Shirt or polo', got.sh, '/shop.html?category=apparel&types=polo&label=Polo+Tees', '']);
      if (got.w || got.lg) rows.push(['Trousers', [got.w ? got.w + '-inch waist' : '', got.lg ? { S: 'short', R: 'regular', L: 'long' }[got.lg] + ' leg' : ''].filter(Boolean).join(', '), '/shop.html?category=apparel&types=trousers&label=Bottoms', '']);
      if (got.sz) rows.push(['Golf shoes', 'UK ' + got.sz, '/prices/golf-shoes/', '']);
      var ul = sheet.querySelector('.cs-rows');
      rows.forEach(function (r) {
        var li = el('li', 'cs-row'), a = el('a', 'cs-link');
        a.href = r[2];
        a.appendChild(el('span', 'cs-k', r[0])); a.appendChild(el('b', 'cs-v', r[1])); a.appendChild(el('span', 'cs-go', 'See prices'));
        li.appendChild(a);
        if (r[3]) li.appendChild(el('span', 'pp-sub cs-tip', r[3]));
        ul.appendChild(li);
      });
      if (got.no) { var no = sheet.querySelector('.cs-no'); no.textContent = 'Please don’t buy: ' + got.no + '.'; no.hidden = false; }
      sheet.hidden = false;
      count('cs_view');
      var emptyBox = document.querySelector('.gf-wl-empty');
      if (!(qp.get('i') || '').length && emptyBox) { emptyBox.textContent = ''; emptyBox.appendChild(document.createTextNode('No gifts picked yet. Gifts that need no sizes at all: ')); var ga = el('a', '', 'golf gift ideas'); ga.href = '/prices/golf-gifts/'; emptyBox.appendChild(ga); emptyBox.appendChild(document.createTextNode('.')); }
      // Any shop click from a Cheat Sheet visit counts once a day.
      document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a.cs-link, .gf-wl-item a');
        if (a) count('cs_click');
      });
    }
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }
})();
