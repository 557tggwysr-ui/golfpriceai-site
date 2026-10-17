/* GolfPrice AI: gift finder, wishlists and "Drop a hint".
   - Gift hub (/prices/golf-gifts/): three questions filter the gift cards.
   - Any gift card: the heart saves it to a wishlist kept in this browser only;
     "Drop a hint" shares one gift, "Send it as a hint" shares the whole list.
   - Wishlist page (/prices/golf-gifts/wishlist/?i=...): shows the shared list
     with today's prices from /data/gifts.json.
   - Any ".gp-share" button shares the current page.
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
  function listUrl(keys, name) {
    return BASE + '?' + (name ? 'for=' + encodeURIComponent(name) + '&' : '') + 'i=' + keys.join(',');
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
      share('Hint, hint… ' + (name ? name + '’s' : 'my') + ' golf wishlist, with today’s best UK prices on GolfPrice AI:', listUrl(wish, name));
      track('drop_hint', { items: wish.length });
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
})();
