// GolfPrice AI extension: the price panel on golf product pages.
// Reads the product name and price shown on the page, asks the extension's
// background script to look it up, and shows GolfPrice AI's own figures in a
// small panel. Read-only: it never changes the page's links, buttons or cookies.
(function () {
  if (window.top !== window || window.__gpai) return;
  window.__gpai = true;

  var SITE = 'https://golfpriceai.com';
  var UTM = 'utm_source=extension&utm_medium=browser&utm_campaign=panel';
  var host = location.hostname.replace(/^www\./, '');
  var USED_SITE = /(^|\.)(ebay\.co\.uk|golfbidder\.co\.uk|callawaygolfpreowned\.com)$/.test(host);
  var VERDICT = {
    good: ['Good time to buy', '#3fae29', '#fff'],
    typical: ['Typical price', '#e3f0dc', '#1d4d12'],
    wait: ['Wait if you can', '#fff1d6', '#7a4b00'],
    tracking: ['Tracking started', '#eef0ec', '#3c463f']
  };

  // ------------------------------------------------------------ reading the page
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(s) {
    var m = String(s || '').replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?/);
    return m ? parseFloat(m[1].replace(/,/g, '') + (m[2] || '')) : NaN;
  }
  function meta(sel) { var el = document.querySelector(sel); return el ? (el.getAttribute('content') || '').trim() : ''; }
  function text(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }

  function ldProduct() {
    var out = null;
    function walk(o) {
      if (!o || out) return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (typeof o !== 'object') return;
      var t = o['@type'];
      if (t === 'Product' || (Array.isArray(t) && t.indexOf('Product') !== -1)) { out = o; return; }
      if (o['@graph']) walk(o['@graph']);
    }
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      try { walk(JSON.parse(s.textContent)); } catch (e) { /* not our business */ }
    });
    return out;
  }
  function ldPrice(p) {
    if (!p) return NaN;
    var offers = p.offers, list = Array.isArray(offers) ? offers : [offers];
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      if (!o) continue;
      if (o.priceCurrency && o.priceCurrency !== 'GBP') continue;
      var v = num(o.price || o.lowPrice || (o.priceSpecification && o.priceSpecification.price));
      if (v > 0) return v;
    }
    return NaN;
  }
  function pagePrice(ld) {
    var v = ldPrice(ld);
    if (v > 0) return v;
    var metas = ['meta[property="product:price:amount"]', 'meta[property="og:price:amount"]', 'meta[itemprop="price"]'];
    for (var i = 0; i < metas.length; i++) { v = num(meta(metas[i])); if (v > 0) return v; }
    var sels = ['[itemprop="price"]', '.x-price-primary', '#corePrice_feature_div .a-offscreen', '.a-price .a-offscreen',
      '.product-price', '.price--main', '.product__price', '.price'];
    for (i = 0; i < sels.length; i++) {
      var el = document.querySelector(sels[i]);
      var t = el ? (el.getAttribute('content') || text(el)) : '';
      if (t && /£|^\d/.test(t)) { v = num(t); if (v > 0) return v; }
    }
    return NaN;
  }
  // A "was" or RRP price shown next to the page's own price, if any.
  function wasPrice(now) {
    if (!(now > 0)) return NaN;
    var ok = function (v) { return v > now * 1.02 && v < now * 4; };
    var els = document.querySelectorAll('del, s, strike, [class*="was" i], [class*="rrp" i], [class*="compare" i], [class*="old-price" i], [class*="strike" i], [class*="list-price" i]');
    for (var i = 0; i < els.length && i < 200; i++) {
      var t = text(els[i]);
      if (t.length > 0 && t.length < 60 && t.indexOf('£') !== -1) { var v = num(t.slice(t.indexOf('£'))); if (ok(v)) return v; }
    }
    var body = (document.body.innerText || '').slice(0, 30000);
    var rx = /(?:\bwas\b|\brrp\b|list price|previously|compare at)[^£\d\n]{0,14}£\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/ig, m;
    while ((m = rx.exec(body))) { var w = num(m[1]); if (ok(w)) return w; }
    return NaN;
  }
  function isUsed() {
    if (/(^|\.)(golfbidder\.co\.uk|callawaygolfpreowned\.com)$/.test(host)) return true;
    var cond = document.querySelector('.x-item-condition-text, [data-testid="x-item-condition"], .x-item-condition');
    var t = cond ? text(cond) : '';
    return /pre-?owned|used|refurbished|ex[- ]demo/i.test(t);
  }
  function read() {
    var ld = ldProduct();
    var h1 = text(document.querySelector('h1'));
    var titles = [h1, ld && ld.name, meta('meta[property="og:title"]'), document.title].filter(Boolean).map(function (t) { return String(t).slice(0, 300); });
    var p = pagePrice(ld);
    return { titles: titles, price: p, was: wasPrice(p), used: isUsed(), product: !!ld || p > 0 };
  }

  // ------------------------------------------------------------ the panel
  var root, shadow, state = { min: false };
  try { state.min = sessionStorage.getItem('gpai-min') === '1'; } catch (e) { /* private mode */ }

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function link(path, hash) { return SITE + path + (path.indexOf('?') === -1 ? '?' : '&') + UTM + (hash || ''); }
  function niceDate(iso) {
    var d = new Date(iso + 'T12:00:00Z');
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  var CSS = '' +
    ':host{all:initial}' +
    '.gp{position:fixed;right:18px;bottom:18px;z-index:2147483646;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#16241c}' +
    '.card{width:320px;background:#fff;border:1px solid #e7e9e5;border-radius:14px;box-shadow:0 10px 30px rgba(22,36,28,.18);overflow:hidden}' +
    '.top{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#16241c;color:#fff}' +
    '.logo{font-weight:800;font-size:14px;letter-spacing:-.01em;flex:1}.logo b{color:#3fae29}' +
    '.ib{all:unset;cursor:pointer;width:26px;height:26px;border-radius:7px;display:grid;place-items:center;color:#cfd8d2}.ib:hover{background:rgba(255,255,255,.12);color:#fff}' +
    '.body{padding:12px 14px 14px}' +
    '.name{font-weight:700;font-size:15px;margin:0 0 6px}' +
    '.chip{display:inline-block;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;margin-bottom:10px}' +
    '.k{font-size:12px;color:#5b665f;margin:0}.big{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0;line-height:1.15}' +
    '.sub{font-size:12px;color:#5b665f;margin:2px 0 0}' +
    '.row{margin-top:10px;padding:9px 10px;border-radius:10px;background:#f2f7ef;font-size:13px}' +
    '.row.amber{background:#fff7e8}.row b{font-weight:700}' +
    '.spark{display:block;margin-top:8px}' +
    '.btns{display:flex;gap:8px;margin-top:12px}' +
    '.btn{all:unset;box-sizing:border-box;cursor:pointer;flex:1;text-align:center;font-weight:700;font-size:13px;padding:9px 10px;border-radius:9px;border:1.5px solid #3fae29;color:#2f8a1f;background:#fff}' +
    '.btn.p{background:#3fae29;color:#fff}.btn:hover{filter:brightness(.96)}' +
    '.form{display:flex;gap:6px;margin-top:10px}.form input{flex:1;min-width:0;font:inherit;font-size:13px;padding:8px 9px;border:1.5px solid #cfd8d2;border-radius:8px}' +
    '.msg{font-size:12.5px;margin:8px 0 0;color:#2f8a1f}.msg.err{color:#a33}' +
    '.foot{font-size:11.5px;color:#5b665f;margin:10px 0 0}.foot a{color:#2f8a1f}' +
    '.pill{all:unset;cursor:pointer;display:flex;align-items:center;gap:8px;background:#16241c;color:#fff;border-radius:999px;padding:9px 14px 9px 10px;box-shadow:0 8px 24px rgba(22,36,28,.25);font-weight:700;font-size:13px}' +
    '.dot{width:22px;height:22px;border-radius:50%;background:#3fae29;display:grid;place-items:center;font-size:12px;font-weight:800}' +
    'a{color:inherit}';

  function sparkline(series) {
    if (!series || series.length < 2) return '';
    var w = 290, h = 44, pts = series.map(function (s) { return [new Date(s[0]).getTime(), s[1]]; });
    var x0 = pts[0][0], x1 = pts[pts.length - 1][0] || x0 + 1;
    var ys = pts.map(function (p) { return p[1]; }), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 === y0) { y1 += 1; y0 -= 1; }
    var d = '', prevY = null;
    pts.forEach(function (p, i) {
      var x = ((p[0] - x0) / (x1 - x0 || 1)) * (w - 4) + 2, y = h - 4 - ((p[1] - y0) / (y1 - y0)) * (h - 8);
      d += i ? ' H' + x.toFixed(1) + ' V' + y.toFixed(1) : 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
      prevY = y;
    });
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="#3fae29" stroke-width="2" stroke-linejoin="round"/></svg>';
  }

  function render(info, page) {
    var d = info.data, h = d.history || {}, low = d.lowestNewPrice;
    var v = VERDICT[(d.verdict || {}).label] || VERDICT.tracking;
    var nRet = (d.retailers || []).length;
    var html = '<p class="name">' + esc(d.name) + '</p>' +
      '<span class="chip" style="background:' + v[1] + ';color:' + v[2] + '">' + v[0] + '</span>' +
      '<p class="k">Lowest new UK price today</p><p class="big">' + money(low) + (d.unit === 'dozen' ? ' <span class="sub">per dozen</span>' : '') + '</p>' +
      '<p class="sub">Checked across ' + (nRet > 1 ? nRet + ' UK retailers' : 'UK retailers') + ' every 6 hours</p>';

    var p = page.price, u = info.used;
    // This page's price, against new or pre-owned prices as fits.
    if (p > 0) {
      if (page.used && u) {
        var med = u[4], lo = u[2], hi = u[6];
        html += '<div class="row"><b>This listing: ' + money(p) + '</b><br>' +
          (u[0] > 1 ? 'Pre-owned at UK golf retailers: ' + money(lo) + ' to ' + money(hi) + ', typically ' + money(med) + '.'
            : 'Pre-owned at a UK golf retailer: ' + money(med) + '.') +
          (p <= med ? ' This one looks good value.' : '') +
          (low <= p ? ' Brand new is ' + money(low) + ' today, so new could be the better buy.' : '') + '</div>';
      } else if (p < low - 0.5) {
        html += '<div class="row"><b>This page: ' + money(p) + '</b><br>That’s ' + money(low - p) + ' below the lowest new price we track today. Nice find' + (page.used ? '' : ', just check it’s new stock') + '.</div>';
      } else if (p <= low + 0.5) {
        html += '<div class="row"><b>This page: ' + money(p) + '</b><br>That matches the lowest new UK price today. 👍</div>';
      } else {
        html += '<div class="row amber"><b>This page: ' + money(p) + '</b><br>It’s available from ' + money(low) + ' elsewhere today, ' + money(p - low) + ' less.</div>';
      }
    }
    // The "was" price checker.
    if (page.was > 0 && h.daysTracked && h.high) {
      var since = h.series && h.series.length ? niceDate(h.series[0][0]) : '';
      if (page.was <= h.high + 0.5) {
        html += '<div class="row"><b>“Was” ' + money(page.was) + '</b><br>In line with what we’ve tracked: ' + money(h.low) + ' to ' + money(h.high) + ' over ' + h.daysTracked + ' days.</div>';
      } else {
        html += '<div class="row amber"><b>“Was” ' + money(page.was) + '</b><br>Since ' + (since || h.daysTracked + ' days ago') + ', it’s been available for ' + money(h.high) + ' or less across UK retailers, so we’d use that as your guide to the saving.</div>';
      }
    } else if (h.daysTracked > 6) {
      html += '<p class="sub" style="margin-top:8px">Tracked ' + money(h.low) + ' to ' + money(h.high) + ' over ' + h.daysTracked + ' days</p>';
    }
    html += sparkline(h.series);
    if (!page.used && u && USED_SITE) {
      html += '<div class="row">Pre-owned at UK golf retailers: typically <b>' + money(u[4]) + '</b>.</div>';
    }
    html += '<div class="btns"><a class="btn p" target="_blank" rel="noopener" href="' + esc(link('/prices/' + info.slug + '/')) + '">Price history</a>' +
      '<button class="btn" type="button" data-act="watch">🔔 Watch price</button></div>' +
      '<div data-slot="watch"></div>' +
      '<p class="foot">Not the right model? <a target="_blank" rel="noopener" href="' + esc(link('/search.html?q=' + encodeURIComponent(d.name))) + '">Search GolfPrice AI</a></p>';
    return html;
  }

  function mount(info, page) {
    if (root) root.remove();
    root = el('div');
    root.id = 'golfpriceai-panel';
    shadow = root.attachShadow({ mode: 'closed' });
    shadow.appendChild(el('style', null, CSS));
    var wrap = el('div', 'gp');
    shadow.appendChild(wrap);
    document.documentElement.appendChild(root);

    function show() {
      wrap.innerHTML = '';
      if (state.min) {
        var pill = el('button', 'pill', '<span class="dot">£</span>' + money(info.data.lowestNewPrice) + ' lowest UK price');
        pill.type = 'button';
        pill.setAttribute('aria-label', 'Open GolfPrice AI');
        pill.onclick = function () { setMin(false); };
        wrap.appendChild(pill);
        return;
      }
      var card = el('div', 'card');
      var top = el('div', 'top', '<span class="logo">Golf<b>Price</b> AI</span>');
      var mn = el('button', 'ib', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M5 12h14"/></svg>');
      mn.title = 'Minimise'; mn.type = 'button'; mn.onclick = function () { setMin(true); };
      var cl = el('button', 'ib', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>');
      cl.title = 'Close'; cl.type = 'button'; cl.onclick = function () { root.remove(); root = null; closed = location.href; };
      top.appendChild(mn); top.appendChild(cl);
      var body = el('div', 'body', render(info, page));
      card.appendChild(top); card.appendChild(body);
      wrap.appendChild(card);
      body.querySelector('[data-act="watch"]').onclick = function () { startWatch(info, body.querySelector('[data-slot="watch"]')); };
    }
    function setMin(m) {
      state.min = m;
      try { sessionStorage.setItem('gpai-min', m ? '1' : '0'); } catch (e) { /* fine */ }
      show();
    }
    show();
  }

  function startWatch(info, slot) {
    chrome.runtime.sendMessage({ type: 'settings' }, function (s) {
      if (s && s.email) return send(s.email);
      slot.innerHTML = '<form class="form"><input type="email" required placeholder="Your email for the alert" autocomplete="email"><button class="btn p" style="flex:0 0 auto">Watch</button></form>' +
        '<p class="foot">One email when the price drops. We remember this address for one-tap watching next time.</p>';
      var f = slot.querySelector('form');
      f.onsubmit = function (e) {
        e.preventDefault();
        var em = f.querySelector('input').value.trim();
        chrome.runtime.sendMessage({ type: 'saveEmail', email: em }, function () { send(em); });
      };
    });
    function send(email) {
      slot.innerHTML = '<p class="msg">Setting up your alert…</p>';
      chrome.runtime.sendMessage({ type: 'watch', slug: info.slug, name: info.data.name, email: email }, function (r) {
        if (r && r.ok) {
          slot.innerHTML = r.status === 'check-email'
            ? '<p class="msg">Nearly there: check your inbox and tap the confirm link. Then we’ll email you once when it drops.</p>'
            : '<p class="msg">You’re watching it. We’ll email you when the price drops.</p>';
        } else {
          slot.innerHTML = '<p class="msg err">' + esc((r && r.error) || 'Something went wrong. Please try again.') + '</p>';
        }
      });
    }
  }

  // ------------------------------------------------------------ run, and re-run when a shop changes page without reloading
  var last = '', closed = '', busy = false;
  function run() {
    if (busy || location.href === last) return;
    last = location.href;
    if (closed === last) return;
    var page = read();
    if (!page.product) { if (root) { root.remove(); root = null; } return; }
    busy = true;
    chrome.runtime.sendMessage({ type: 'lookup', titles: page.titles }, function (info) {
      busy = false;
      if (chrome.runtime.lastError || !info || !info.found) { if (root) { root.remove(); root = null; } return; }
      chrome.runtime.sendMessage({ type: 'settings' }, function (s) {
        var seen = null;
        try { seen = sessionStorage.getItem('gpai-min'); } catch (e) { /* fine */ }
        if (s && s.auto === false && seen === null) state.min = true;
        mount(info, page);
      });
    });
  }
  run();
  setTimeout(function () { if (!root && !closed) { last = ''; run(); } }, 2500);   // shops that draw the price late
  setInterval(run, 1500);
})();
