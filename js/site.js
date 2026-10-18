/* GolfPrice AI — site-wide behaviour for the header, menus, search
   suggestions, footer and deal-click tracking. The HTML these work on is
   written by scripts/site_chrome.py. No libraries, no build step. */
(function () {
  'use strict';

  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  var DESKTOP = window.matchMedia('(min-width: 1080px)');
  var header = document.getElementById('gp-header');
  if (!header) return;

  /* ------------------------------------------------------------ desktop menus */
  var items = Array.prototype.slice.call(header.querySelectorAll('.gp-nav-item'));
  var closeTimer = null;

  function setOpen(item, open) {
    item.classList.toggle('is-open', open);
    var trigger = item.querySelector('.gp-nav-link');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeAll(except) {
    items.forEach(function (i) { if (i !== except) setOpen(i, false); });
  }

  items.forEach(function (item) {
    var trigger = item.querySelector('.gp-nav-link');
    item.addEventListener('mouseenter', function () {
      if (!DESKTOP.matches) return;
      clearTimeout(closeTimer);
      closeAll(item);
      setOpen(item, true);
    });
    item.addEventListener('mouseleave', function () {
      if (!DESKTOP.matches) return;
      closeTimer = setTimeout(function () { setOpen(item, false); }, 160);
    });
    // Deal Tools is a button: click or tap toggles it.
    if (trigger.tagName === 'BUTTON') {
      trigger.addEventListener('click', function () {
        var open = !item.classList.contains('is-open');
        closeAll(item);
        setOpen(item, open);
      });
    }
    // Keyboard: arrow down on a section opens it and moves into the list.
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        closeAll(item);
        setOpen(item, true);
        var first = item.querySelector('.gp-drop a');
        if (first) first.focus();
      }
    });
    item.addEventListener('focusout', function (e) {
      if (!item.contains(e.relatedTarget)) setOpen(item, false);
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.gp-nav-item')) closeAll();
    if (searchPanel && !searchPanel.hidden && !e.target.closest('.gp-search-panel, .gp-search-btn')) toggleSearch(false);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var openItem = items.filter(function (i) { return i.classList.contains('is-open'); })[0];
    if (openItem) { setOpen(openItem, false); openItem.querySelector('.gp-nav-link').focus(); }
    if (searchPanel && !searchPanel.hidden) { toggleSearch(false); searchBtn.focus(); }
    if (menu && !menu.hidden) toggleMenu(false);
  });

  /* ------------------------------------------------------------ which section are we in? */
  (function markActive() {
    var path = location.pathname.replace(/\/index\.html$/, '/');
    var params = new URLSearchParams(location.search);
    var cat = params.get('category');
    // Pages can name their section directly (the /prices/ pages do).
    var section = document.body.getAttribute('data-section') || null;
    var clubCats = ['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter', 'sets'];
    if (section) { /* already known */ }
    else if (/\/(clubs|find-your-fit)\.html$/.test(path) || params.get('group') === 'clubs' ||
        clubCats.indexOf(cat) !== -1 || params.get('source') === 'awin-callawaypreowned') section = 'clubs';
    else if (/\/apparel\.html$/.test(path) || cat === 'apparel' || cat === 'shoes') section = 'apparel';
    else if (/\/accessories\.html$/.test(path) || cat === 'accessories' || cat === 'ball' || cat === 'bag') section = 'accessories';
    else if (/\/(build-your-bag|receipts|complete-the-look|best-time-to-buy|complete-the-kit|back-in-stock|fairway-index)\.html$/.test(path)) section = 'tools';
    if (!section) return;
    var el = header.querySelector('.gp-nav-item[data-section="' + section + '"]');
    if (el) {
      el.classList.add('is-active');
      el.querySelector('.gp-nav-link').setAttribute('aria-current', 'true');
    }
  })();

  /* ------------------------------------------------------------ header search panel */
  var searchBtn = header.querySelector('.gp-search-btn');
  var searchPanel = document.getElementById('gp-search-panel');
  function toggleSearch(open) {
    if (!searchPanel) return;
    searchPanel.hidden = !open;
    searchBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      closeAll();
      var input = searchPanel.querySelector('input');
      setTimeout(function () { input.focus(); }, 30);
    }
  }
  if (searchBtn) {
    searchBtn.addEventListener('click', function () {
      // On the homepage the hero already has a big search box: use that.
      var hero = document.getElementById('search-input');
      if (hero && hero.getBoundingClientRect().bottom > 80 && window.scrollY < 400) {
        hero.focus();
        return;
      }
      toggleSearch(searchPanel.hidden);
    });
  }

  /* ------------------------------------------------------------ phone menu */
  var menu = document.getElementById('gp-menu');
  var menuBtn = header.querySelector('.gp-menu-btn');
  function toggleMenu(open) {
    if (!menu) return;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.classList.toggle('gp-lock', open);
    if (open) menu.querySelector('.gp-menu-close').focus();
    else menuBtn.focus();
  }
  if (menu && menuBtn) {
    menuBtn.addEventListener('click', function () { toggleMenu(true); });
    menu.querySelector('.gp-menu-close').addEventListener('click', function () { toggleMenu(false); });
    var accBtns = Array.prototype.slice.call(menu.querySelectorAll('.gp-acc-btn'));
    accBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') !== 'true';
        accBtns.forEach(function (b) {
          b.setAttribute('aria-expanded', 'false');
          b.nextElementSibling.hidden = true;
        });
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.nextElementSibling.hidden = !open;
      });
    });
    // Open the section you're already in.
    var active = header.querySelector('.gp-nav-item.is-active');
    if (active) {
      var idx = items.indexOf(active);
      if (accBtns[idx]) { accBtns[idx].setAttribute('aria-expanded', 'true'); accBtns[idx].nextElementSibling.hidden = false; }
    }
    // Close the menu if the screen grows to desktop size.
    DESKTOP.addEventListener && DESKTOP.addEventListener('change', function (e) { if (e.matches && !menu.hidden) toggleMenu(false); });
  }

  /* ------------------------------------------------------------ footer (phone accordions) */
  Array.prototype.slice.call(document.querySelectorAll('.gp-foot-head')).forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (window.matchMedia('(min-width: 901px)').matches) return;
      btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
    });
  });

  /* ------------------------------------------------------------ search suggestions */
  var CATEGORIES = [
    ['Drivers', '/shop.html?category=driver&label=Drivers', 'driver drivers'],
    ['Fairway woods', '/shop.html?category=wood&label=Fairway+Woods', 'fairway wood woods 3 wood 5 wood'],
    ['Hybrids', '/shop.html?category=hybrid&label=Hybrids', 'hybrid hybrids rescue utility'],
    ['Irons', '/shop.html?category=irons&label=Irons', 'irons iron set'],
    ['Wedges', '/shop.html?category=wedge&label=Wedges', 'wedge wedges sand lob gap'],
    ['Putters', '/shop.html?category=putter&label=Putters', 'putter putters'],
    ['Club sets', '/shop.html?category=sets&label=Sets', 'set sets package beginner'],
    ['Golf balls', '/shop.html?category=ball&label=Golf+Balls', 'ball balls golf balls dozen'],
    ['Golf bags', '/shop.html?category=bag', 'bag bags stand cart carry'],
    ['Golf shoes', '/shop.html?category=shoes', 'shoe shoes spikeless footwear'],
    ['Polo shirts', '/shop.html?category=apparel&types=polo&label=Polo+Tees', 'polo polos shirt shirts top tops'],
    ['Trousers', '/shop.html?category=apparel&types=trousers&label=Bottoms', 'trousers pants bottoms chinos joggers'],
    ['Outerwear', '/shop.html?category=apparel&types=jacket,hoodie,base-layer&label=Outerwear', 'jacket jackets waterproof hoodie midlayer layer quarter zip'],
    ['Caps and hats', '/shop.html?category=apparel&types=cap,sunglasses,belt,socks&label=Headwear+%26+Extras', 'cap caps hat hats beanie visor'],
    ['GPS watches', '/shop.html?category=accessories&types=gps-watch&label=GPS+Watches', 'gps watch watches garmin'],
    ['Rangefinders', '/shop.html?category=accessories&types=rangefinder&label=Rangefinders', 'rangefinder rangefinders laser bushnell'],
    ['Push and electric trolleys', '/shop.html?category=accessories&types=pushcart&label=Push+Carts', 'trolley trolleys push cart electric motocaddy'],
    ['Gloves', '/shop.html?category=accessories&types=glove&label=Gloves', 'glove gloves'],
    ['Launch monitors', '/shop.html?category=accessories&types=launch-monitor&label=Launch+Monitors+%26+Simulators', 'launch monitor simulator'],
    ['Left-handed clubs', '/shop.html?group=clubs&q=left+hand', 'left handed left-handed lefty lh'],
    ['Preowned clubs', '/shop.html?source=awin-callawaypreowned', 'preowned pre-owned used second hand trade in']
  ];
  var TYPE_LABEL = {
    driver: 'Driver', wood: 'Fairway wood', hybrid: 'Hybrid', irons: 'Iron set', wedge: 'Wedge', putter: 'Putter',
    bag: 'Golf bag', ball: 'Golf balls', 'electric-trolley': 'Trolley', rangefinder: 'Rangefinder',
    'launch-monitor': 'Launch monitor', 'gps-watch': 'GPS watch'
  };
  // Which shop category a model's listings live in, so a suggestion only searches there.
  var TYPE_CATEGORY = {
    driver: 'driver', wood: 'wood', hybrid: 'hybrid', irons: 'irons', wedge: 'wedge', putter: 'putter',
    bag: 'bag', ball: 'ball', 'electric-trolley': 'accessories', rangefinder: 'accessories',
    'launch-monitor': 'accessories', 'gps-watch': 'accessories'
  };
  var index = null, indexPromise = null;
  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch('/data/search-suggest.json')
        .then(function (r) { return r.ok ? r.json() : { m: [] }; })
        .then(function (d) {
          index = (d.m || []).map(function (m) { return { name: m[0], type: m[1], n: m[2], q: m[3] || m[0].toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim(), lc: m[0].toLowerCase(), page: m[4] || null }; });
          return index;
        })
        .catch(function () { index = []; return index; });
    }
    return indexPromise;
  }
  function norm(s) { return s.toLowerCase().replace(/[^a-z0-9.£ ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function boldTokens(name, tokens) {
    var out = esc(name);
    tokens.forEach(function (t) {
      if (!t) return;
      var re = new RegExp('(^|[^a-z0-9])(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'i');
      out = out.replace(re, '$1<strong>$2</strong>');
    });
    return out;
  }

  function findProducts(q) {
    var tokens = norm(q).split(' ').filter(Boolean);
    if (!tokens.length || !index) return [];
    var hits = [];
    for (var i = 0; i < index.length && hits.length < 400; i++) {
      var m = index[i];
      var words = m.lc.replace(/[^a-z0-9.]+/g, ' ').split(' ');
      var ok = tokens.every(function (t) {
        return words.some(function (w) { return w.indexOf(t) === 0; }) || (t.length > 3 && m.lc.indexOf(t) !== -1);
      });
      if (ok) hits.push(m);
    }
    // Names that contain what was typed, as typed ("pro v" in "Pro V1"), first.
    var phrase = tokens.join(' ');
    hits.forEach(function (m) { m.s = (m.lc.replace(/[^a-z0-9.]+/g, ' ').indexOf(phrase) !== -1 ? 1000 : 0) + m.n; });
    hits.sort(function (a, b) { return (b.s - a.s) || (a.name.length - b.name.length); });
    return hits.slice(0, 5);
  }
  function findCategories(q) {
    var n = norm(q);
    if (n.length < 2) return [];
    return CATEGORIES.filter(function (c) {
      return c[2].split(' ').some(function (k) { return k.indexOf(n) === 0 || n.indexOf(k) === 0 && k.length > 3; })
        || c[0].toLowerCase().indexOf(n) === 0;
    }).slice(0, 3);
  }

  function attachSuggest(form) {
    var input = form.querySelector('input');
    var box = form.querySelector('.gp-suggest');
    if (!input || !box) return;
    var rows = [], activeIdx = -1, lastQ = '';

    function close() { box.hidden = true; activeIdx = -1; input.setAttribute('aria-expanded', 'false'); }
    function setActive(i) {
      rows.forEach(function (r, k) { r.classList.toggle('is-active', k === i); });
      activeIdx = i;
    }
    function renderRecent() {
      var recent = [];
      try { recent = JSON.parse(localStorage.getItem('gp_recent_searches') || '[]'); } catch (e) { recent = []; }
      if (!recent.length) { close(); return; }
      box.innerHTML = '<div class="gp-suggest-head">Your recent searches</div>' + recent.map(function (r) {
        return '<a class="gp-suggest-row" role="option" href="/search.html?q=' + encodeURIComponent(r) + '" data-kind="recent"><span>' + esc(r) + '</span><span></span></a>';
      }).join('');
      rows = Array.prototype.slice.call(box.querySelectorAll('a'));
      activeIdx = -1;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function render() {
      var q = input.value.trim();
      lastQ = q;
      if (!q) { renderRecent(); return; }
      if (q.length < 2) { close(); return; }
      var tokens = norm(q).split(' ').filter(Boolean);
      var prods = findProducts(q), cats = findCategories(q);
      var html = '';
      if (prods.length) {
        html += '<div class="gp-suggest-head">Products</div>';
        html += prods.map(function (m) {
          var cat = TYPE_CATEGORY[m.type];
          var href = m.page ? '/prices/' + m.page + '/'
            : '/shop.html?' + (cat ? 'category=' + cat + '&amp;' : '') + 'q=' + encodeURIComponent(m.q);
          return '<a class="gp-suggest-row" role="option" href="' + href + '" data-kind="' + (m.page ? 'price-page' : 'product') + '">' +
            '<span>' + boldTokens(m.name, tokens) + '</span><span>' + esc(TYPE_LABEL[m.type] || '') + '</span></a>';
        }).join('');
      }
      if (cats.length) {
        html += '<div class="gp-suggest-head">Categories</div>';
        html += cats.map(function (c) {
          return '<a class="gp-suggest-row" role="option" href="' + esc(c[1]) + '" data-kind="category"><span>' + esc(c[0]) + '</span><span>All brands</span></a>';
        }).join('');
      }
      html += '<a class="gp-suggest-all" role="option" href="/search.html?q=' + encodeURIComponent(q) + '">See all results for &ldquo;' + esc(q) + '&rdquo; &rarr;</a>';
      box.innerHTML = html;
      rows = Array.prototype.slice.call(box.querySelectorAll('a'));
      activeIdx = -1;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.addEventListener('focus', function () { loadIndex(); if (!input.value.trim()) renderRecent(); });
    input.addEventListener('input', function () {
      if (index) render(); else loadIndex().then(render);
    });
    input.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, rows.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, -1)); }
      else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); rows[activeIdx].click(); }
      else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
    box.addEventListener('mousedown', function (e) { e.preventDefault(); }); // keep focus while clicking
    box.addEventListener('click', function (e) {
      var a = e.target.closest('a');
      if (a && window.gtag) gtag('event', 'search_suggestion', { search_term: lastQ, kind: a.getAttribute('data-kind') || 'all' });
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    form.addEventListener('submit', function (e) {
      var q = input.value.trim();
      if (!q) { e.preventDefault(); input.focus(); return; }
      if (window.gtag) gtag('event', 'search', { search_term: q });
    });
  }
  Array.prototype.slice.call(document.querySelectorAll('form[data-suggest]')).forEach(attachSuggest);
  // Narrow screens: a shorter placeholder that isn't cut off mid-word.
  if (window.matchMedia('(max-width: 420px)').matches) {
    Array.prototype.slice.call(document.querySelectorAll('.gp-search input')).forEach(function (i) {
      i.placeholder = 'Search clubs, balls...';
    });
  }

  /* ------------------------------------------------------------ deal-click tracking */
  // Records which product and retailer someone clicked through to, so the
  // Google Analytics "deal_click" report shows what people actually want.
  // Only sends anything if the visitor accepted analytics cookies (gtag
  // only exists after consent).
  var RETAILERS = { '2849': 'Clickgolf', '82141': 'Affordable Golf', '813': 'Scottsdale Golf', '83219': 'Major Golf Direct',
    '19186': 'Callaway Golf', '19187': 'Callaway Golf Preowned' };
  function retailerFor(href) {
    var m = href.match(/[?&](?:m|awinmid)=(\d+)/);
    if (m && RETAILERS[m[1]]) return RETAILERS[m[1]];
    if (/tidd\.ly/.test(href)) return 'Discount Golf Store';
    try { return new URL(href).hostname.replace(/^www\./, ''); } catch (e) { return 'unknown'; }
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.href;
    var isDeal = /awin1\.com|tidd\.ly|amazon\.|amzn\.to/.test(href) || /\bsponsored\b/.test(a.getAttribute('rel') || '');
    if (!isDeal || !window.gtag) return;
    var card = a.closest('.deal-card, .drop-row, .tag, .shop-card, .receipt-card, .kit-item, .fi-mover, [data-product]') || a;
    var nameEl = card.querySelector('h3, h4, .tag-name, .kit-item-name, .receipt-name');
    var priceEl = card.querySelector('.sale-price, .now, .kit-item-price, .receipt-price');
    var price = priceEl ? parseFloat((priceEl.textContent.match(/£\s*([\d,]+(?:\.\d+)?)/) || [0, ''])[1].replace(/,/g, '')) : undefined;
    gtag('event', 'deal_click', {
      retailer: retailerFor(href),
      product_name: (nameEl ? nameEl.textContent : a.textContent).trim().slice(0, 100),
      value: isNaN(price) ? undefined : price,
      currency: 'GBP',
      page_type: location.pathname.replace(/^\/$/, '/index.html'),
      link_area: card.className ? String(card.className).split(' ')[0] : 'link'
    });
  }, true);

  /* ------------------------------------------------------------ Demand Index */
  // One anonymous count per model page view, for the UK Golf Demand Index
  // (/demand/). Only the model's name is sent: no cookie, nothing stored in
  // the browser, nothing about the visitor.
  (function () {
    var m = /^\/prices\/([a-z0-9-]{3,100})\/$/.exec(location.pathname);
    if (!m || !document.querySelector('form.gp-alert-form[data-model="' + m[1] + '"]')) return;
    function gpSignal(d) { try { navigator.sendBeacon('https://golfpriceai-alerts.golfpriceai.workers.dev/signal', JSON.stringify(d)); } catch (e) { /* counts are a nice-to-have */ } }
    gpSignal({ k: 'view', m: m[1] });
  })();

  /* ------------------------------------------------------------ deal alerts */
  // Any <form class="gp-alert-form"> on any page (homepage, price pages, the
  // search page's "no results" box) posts here. data-model / data-model-name
  // on the form say which model to watch; without them it's a general
  // sign-up. The worker sends a "please confirm" email first.
  var ALERTS_URL = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.classList || !form.classList.contains('gp-alert-form')) return;
    e.preventDefault();
    var input = form.querySelector('input[type=email]');
    var bought = form.getAttribute('data-bought') || '';
    var paidEl = form.querySelector('input[name=paid]');
    var btn = form.querySelector('button[type=submit]');
    var msg = form.querySelector('.gp-af-msg');
    var hp = form.querySelector('input[name=website]');
    var email = (input.value || '').trim();
    function say(text, kind) { msg.textContent = text; msg.className = 'gp-af-msg' + (kind ? ' is-' + kind : ''); }
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { say('Please enter a full email address.', 'error'); input.focus(); return; }
    var paid = paidEl ? parseFloat(String(paidEl.value).replace(/[£,\s]/g, '')) : 0;
    if (bought && !(paid >= 1)) { say('Please enter the price you paid, e.g. 299.00', 'error'); paidEl.focus(); return; }
    btn.disabled = true;
    say('Sending…');
    fetch(ALERTS_URL + '/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(bought
        ? { email: email, bought: bought, paid: paid, website: hp ? hp.value : '' }
        : form.getAttribute('data-budget')
        ? { email: email, budget: form.getAttribute('data-budget'), website: hp ? hp.value : '' }
        : form.getAttribute('data-models')
        ? { email: email, models: form.getAttribute('data-models').split(','), list: form.getAttribute('data-list') || 1,
            fb: form.getAttribute('data-fb') || '', website: hp ? hp.value : '' }
        : { email: email, model: form.getAttribute('data-model') || '',
            modelName: form.getAttribute('data-model-name') || '', fb: form.getAttribute('data-fb') || '',
            website: hp ? hp.value : '' })
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { say(res.error || 'Something went wrong. Please try again in a minute.', 'error'); return; }
        form.classList.add('is-done');
        say(res.status === 'added-bought'
          ? 'Done: we’ll watch it for 30 days and email you once if it drops below what you paid.'
          : res.status === 'added' && form.getAttribute('data-models')
          ? 'Done: they’re all on your alert list. Nothing to confirm, you’re already signed up.'
          : res.status === 'added'
          ? 'Done: it’s on your alert list. Nothing to confirm, you’re already signed up.'
          : res.status === 'added-budget'
          ? 'Done: your budget alert is on. Nothing to confirm, you’re already signed up.'
          : res.status === 'added-digest'
          ? 'Done: you’ll get the Friday email. Nothing to confirm, you’re already signed up.'
          : 'Nearly there: check your inbox for a confirmation email from GolfPrice AI and click the button in it. Nothing is sent until you do.', 'ok');
        if (window.gtag) gtag('event', bought ? 'bought_watch_signup' : 'alert_signup', { model: bought || form.getAttribute('data-model') || form.getAttribute('data-budget') || form.getAttribute('data-models') || 'general', status: res.status });
        // js/fourball.js shows "Tell your four-ball" after a price alert sign-up.
        if (!bought) document.dispatchEvent(new CustomEvent('gp:alert-signup', { detail: { form: form, status: res.status } }));
      })
      .catch(function () { btn.disabled = false; say('Couldn’t reach the alert service. Please check your connection and try again.', 'error'); });
  });

  // "Email me when it drops" buttons jump to the form and put the cursor in it.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#price-alert"]');
    if (!a) return;
    var box = document.getElementById('price-alert');
    if (!box) return;
    e.preventDefault();
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var i = box.querySelector('input[type=email]');
    if (i) setTimeout(function () { i.focus({ preventScroll: true }); }, 350);
  });
})();
