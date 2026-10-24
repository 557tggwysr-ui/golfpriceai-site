/* GolfPrice AI: Fourball Alerts.
   Price alerts for a whole four-ball (or golf society): one golfer sends a link
   to the group chat, each mate adds their own email, and everyone gets one
   email when the price genuinely drops.

   - Price pages: "Tell your four-ball" panel (#fourball), shown straight after
     an alert sign-up too; the heart adds the model to a shortlist kept in this
     browser; ?fb=Name&c=code shows the "John's four-ball is watching this" panel
     with a live count of golfers who joined through that invite.
   - /fourball/list/: a shared shortlist (?for=Name&i=slug,slug&c=code) with
     "Watch all 3", or your own shortlist when there's no ?i=.
   - /fourball/: the tool page. /alerts-confirmed.html: invite after confirming.

   Privacy: we never see the mates' details. Sharing uses the phone's share
   menu or WhatsApp. The invite code is random; the alerts worker keeps only
   "code -> how many joined" (no names, no emails). */
(function () {
  'use strict';
  var ALERTS = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function gpSignal(d) { try { navigator.sendBeacon('https://golfpriceai-alerts.golfpriceai.workers.dev/signal', JSON.stringify(d)); } catch (e) { /* counts are a nice-to-have */ } }
  var LIST_KEY = 'gpShortlist', CODE_KEY = 'gpFbCodes', NAME_KEY = 'gpFbName';
  var MAX = 6;

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function cleanName(s) { return String(s || '').replace(/[^A-Za-zÀ-ɏ' -]/g, '').trim().slice(0, 20); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function rand() {
    var a = 'abcdefghijkmnpqrstuvwxyz23456789', out = '', b = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(b);
    for (var i = 0; i < 8; i++) out += a[b[i] % a.length];
    return out;
  }
  // One invite code per item (or per shortlist) per browser, so the count
  // under "John's invite" adds up across everyone John sent it to.
  function codeFor(key) {
    var codes = get(CODE_KEY, {});
    if (!codes[key]) { codes[key] = rand(); put(CODE_KEY, codes); }
    return codes[key];
  }
  function share(text, url, what) {
    if (navigator.share) navigator.share({ text: text, url: url }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
    track('fourball_invite', { what: what });
  }
  function params() { return new URLSearchParams(location.search); }
  function utm(campaign) { return '&utm_source=fourball&utm_medium=share&utm_campaign=' + campaign; }

  function inviteItem(slug, name, price, who) {
    var url = location.origin + '/prices/' + slug + '/?fb=' + encodeURIComponent(who || '1') + '&c=' + codeFor(slug) + utm('invite');
    share((who ? who + ' here: I’m' : 'I’m') + ' watching the ' + name + (price ? ' (' + price + ' today)' : '') +
          '. Join the four-ball alert and we’ll all get one email when it genuinely drops:', url, 'item');
  }
  function inviteList(slugs, who) {
    var url = location.origin + '/fourball/list/?' + (who ? 'for=' + encodeURIComponent(who) + '&' : '') +
              'i=' + slugs.join(',') + '&c=' + codeFor('list:' + slugs.slice().sort().join(',')) + utm('shortlist');
    share((who ? who + '’s' : 'Our') + ' four-ball shortlist: ' + slugs.length + (slugs.length === 1 ? ' bit' : ' bits') +
          ' of kit with today’s lowest UK prices. Watch them all with one email:', url, 'shortlist');
  }
  function countChip(code, who, into) {
    if (!/^[a-z0-9]{8}$/.test(code || '')) return;
    fetch(ALERTS + '/fourball?c=' + code).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !(d.n >= 1)) return;
      into.textContent = d.n + (d.n === 1 ? ' golfer' : ' golfers') + ' joined through ' + (who ? who + '’s' : 'this') + ' invite';
      into.hidden = false;
    }).catch(function () {});
  }

  // The invite panel: name box + "Send to my four-ball".
  function wireInvite(box, slug, name, price) {
    var input = box.querySelector('input[name=fb-name]');
    var btn = box.querySelector('.fb-send');
    if (input) input.value = get(NAME_KEY, '') || '';
    btn.addEventListener('click', function () {
      var who = cleanName(input ? input.value : '');
      if (input) put(NAME_KEY, who);
      inviteItem(slug, name, price, who);
    });
    box.hidden = false;
  }

  /* ------------------------------------------------------------ price pages */
  var alertForm = document.querySelector('#price-alert .gp-alert-form[data-model]');
  if (alertForm) {
    var slug = alertForm.getAttribute('data-model');
    var name = alertForm.getAttribute('data-model-name');
    var bigPrice = (document.querySelector('.pp-big') || {}).textContent || '';
    var invite = document.getElementById('fourball');
    if (invite) wireInvite(invite, slug, name, bigPrice.trim());
    document.querySelectorAll('.fb-nudge').forEach(function (n) { n.hidden = false; });

    // Straight after "Email me when it drops": suggest telling the group.
    document.addEventListener('gp:alert-signup', function (e) {
      if (!invite || !e.detail || e.detail.form.getAttribute('data-model') !== slug) return;
      invite.classList.add('fb-lit');
      invite.querySelector('.fb-head').textContent = 'Done. Now tell your four-ball or society';
      setTimeout(function () { invite.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 600);
    });
    if (location.hash === '#fourball' && invite) setTimeout(function () { invite.scrollIntoView({ block: 'center' }); }, 300);

    // Someone tapped a four-ball link: show who's watching, with the sign-up.
    var p = params();
    if (p.get('fb')) {
      var who = cleanName(p.get('fb') === '1' ? '' : p.get('fb'));
      var code = /^[a-z0-9]{8}$/.test(p.get('c') || '') ? p.get('c') : '';
      var sec = el('section', 'fb-landing');
      sec.setAttribute('aria-labelledby', 'fb-land-h');
      sec.innerHTML = '<h2 id="fb-land-h">' + esc(who ? who + '’s four-ball is watching this' : 'Your four-ball is watching this') + '</h2>' +
        '<span class="fb-chip" hidden></span>' +
        '<p>Add your email to get the same alert: one email when the ' + esc(name) + ' genuinely drops in price. No spam, stop it in one click.</p>' +
        '<form class="gp-alert-form fb-land-form" novalidate>' +
        '<label class="gp-af-label" for="fb-land-email">Your email</label>' +
        '<div class="gp-af-row"><input id="fb-land-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>' +
        '<button type="submit" class="gp-af-btn">Join the four-ball alert</button></div>' +
        '<div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
        '<p class="gp-af-small">We’ll email you once to confirm first. We don’t tell ' + esc(who || 'anyone') + ' whether you joined. <a href="/legal/privacy-policy.html">Privacy policy</a></p>' +
        '<p class="gp-af-msg" role="status" aria-live="polite"></p></form>';
      var f = sec.querySelector('form');
      f.setAttribute('data-model', slug);
      f.setAttribute('data-model-name', name);
      if (code) f.setAttribute('data-fb', code);
      var top = document.querySelector('.pp-top');
      if (top) top.parentNode.insertBefore(sec, top);
      countChip(code, who, sec.querySelector('.fb-chip'));
      track('fourball_landing', { model: slug });
    }

    // The heart: add this model to the four-ball shortlist.
    var row = document.querySelector('.fb-row');
    if (row) {
      var heart = row.querySelector('.fb-save'), note = row.querySelector('.fb-row-note');
      var paint = function () {
        var list = get(LIST_KEY, []);
        var on = list.indexOf(slug) !== -1;
        heart.setAttribute('aria-pressed', on ? 'true' : 'false');
        heart.querySelector('span').textContent = on ? 'On your shortlist' : 'Add to four-ball shortlist';
        note.innerHTML = list.length
          ? '<a href="/fourball/list/">Your shortlist: ' + list.length + (list.length === 1 ? ' item' : ' items') + '</a> · <button type="button" class="fb-link fb-send-list">Send to my four-ball</button>'
          : 'Weighing up a few? Shortlist them and send the lot to the group.';
        var s = note.querySelector('.fb-send-list');
        if (s) s.addEventListener('click', function () { inviteList(get(LIST_KEY, []), cleanName(get(NAME_KEY, ''))); });
      };
      heart.addEventListener('click', function () {
        var list = get(LIST_KEY, []), i = list.indexOf(slug);
        if (i === -1) { list.push(slug); if (list.length > MAX) list.shift(); } else list.splice(i, 1);
        put(LIST_KEY, list); paint();
        track('fourball_shortlist', { saved: i === -1, items: list.length });
        // My Clubhouse: remember today's price, so it can say how much it has dropped since.
        var watch = get('gpWatch', {});
        if (i !== -1) { delete watch[slug]; put('gpWatch', watch); }
        else fetch('/prices/' + slug + '/data.json').then(function (r) { return r.json(); }).then(function (d) {
          if (d && d.lowestNewPrice) { var w = get('gpWatch', {}); w[slug] = { p: Number(d.lowestNewPrice), d: new Date().toISOString().slice(0, 10) }; put('gpWatch', w); }
        }).catch(function () {});
        if (i === -1) gpSignal({ k: 'heart', m: slug }); // anonymous count for the Demand Index
      });
      paint();
      row.hidden = false;
    }
  }

  /* ------------------------------------------------------------ "Send it to your four-ball" for a set of models (comparison pages) */
  document.querySelectorAll('.fb-share-list').forEach(function (b) {
    b.addEventListener('click', function () {
      var slugs = (b.getAttribute('data-slugs') || '').split(',').filter(function (s) { return /^[a-z0-9-]{3,100}$/.test(s); }).slice(0, MAX);
      if (slugs.length) inviteList(slugs, cleanName(get(NAME_KEY, '')));
    });
  });

  /* ------------------------------------------------------------ shortlist page */
  var listBox = document.getElementById('fb-list');
  if (listBox) {
    var q = params();
    var shared = (q.get('i') || '').split(',').filter(function (s) { return /^[a-z0-9-]{3,100}$/.test(s); }).slice(0, MAX);
    var mine = !shared.length;
    var slugs = mine ? get(LIST_KEY, []) : shared;
    var whoL = cleanName(q.get('for'));
    var codeL = /^[a-z0-9]{8}$/.test(q.get('c') || '') ? q.get('c') : '';
    var titleEl = listBox.querySelector('.fb-list-title');
    var ol = listBox.querySelector('.fb-items');
    var empty = listBox.querySelector('.fb-empty');
    var watchForm = listBox.querySelector('.fb-watch');
    var mineBox = listBox.querySelector('.fb-mine');
    Promise.all(slugs.map(function (s) {
      return fetch('/prices/' + s + '/data.json').then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { if (d) d.slug = s; return d; }).catch(function () { return null; });
    })).then(function (rows) {
      rows = rows.filter(Boolean);
      if (!rows.length) { empty.hidden = false; return; }
      var types = rows.map(function (d) { return d.type; });
      var same = types.every(function (t) { return t && t === types[0]; }) ? types[0] + ' ' : '';
      if (mine) titleEl.textContent = 'Your four-ball shortlist';
      else titleEl.textContent = (whoL ? whoL + '’s four-ball: ' : 'Four-ball ') + same + 'shortlist';
      var VL = { good: 'Good time to buy', wait: 'Usually cheaper: maybe wait', typical: 'Typical price' };
      rows.forEach(function (d) {
        var li = el('li', 'fb-item');
        var a = el('a', 'fb-item-link'); a.href = '/prices/' + d.slug + '/?utm_source=fourball&utm_medium=shortlist';
        var pic = el('span', 'fb-pic');
        if (d.image) { var im = document.createElement('img'); im.src = d.image; im.alt = ''; im.loading = 'lazy'; im.referrerPolicy = 'no-referrer'; im.onerror = function () { im.remove(); }; pic.appendChild(im); }
        var mid = el('span', 'fb-mid');
        mid.appendChild(el('b', null, d.name));
        var v = d.verdict && VL[d.verdict.label];
        if (v) mid.appendChild(el('span', 'fb-v fb-v-' + d.verdict.label, v));
        a.appendChild(pic); a.appendChild(mid);
        a.appendChild(el('b', 'fb-price', money(d.lowestNewPrice) + (d.unit === 'per dozen' ? ' /dozen' : '')));
        li.appendChild(a);
        if (mine) {
          var rm = el('button', 'fb-link fb-rm', 'Remove'); rm.type = 'button';
          rm.addEventListener('click', function () {
            put(LIST_KEY, get(LIST_KEY, []).filter(function (x) { return x !== d.slug; }));
            location.reload();
          });
          li.appendChild(rm);
        }
        ol.appendChild(li);
      });
      var ok = rows.map(function (d) { return d.slug; });
      var n = ok.length;
      listBox.querySelector('.fb-count-word').textContent = n === 1 ? 'it' : n === 2 ? 'both' : 'all ' + n;
      watchForm.querySelector('.fb-watch-btn').textContent = n === 1 ? 'Watch it' : n === 2 ? 'Watch both' : 'Watch all ' + n;
      watchForm.querySelector('.gp-alert-form').setAttribute('data-models', ok.join(','));
      if (codeL) watchForm.querySelector('.gp-alert-form').setAttribute('data-fb', codeL);
      watchForm.hidden = false;
      if (!mine) countChip(codeL, whoL, listBox.querySelector('.fb-chip'));
      if (mine && mineBox) {
        var input = mineBox.querySelector('input');
        input.value = get(NAME_KEY, '') || '';
        mineBox.querySelector('.fb-send').addEventListener('click', function () {
          var w = cleanName(input.value); put(NAME_KEY, w); inviteList(ok, w);
        });
        mineBox.querySelector('.fb-clear').addEventListener('click', function () {
          if (!window.confirm('Clear your shortlist?')) return;
          put(LIST_KEY, []); location.reload();
        });
        mineBox.hidden = false;
      }
      track('fourball_list_view', { items: n, shared: !mine });
    });
  }

  /* ------------------------------------------------------------ tool page */
  var tool = document.getElementById('fb-tool');
  if (tool) {
    fetch(ALERTS + '/fourball').then(function (r) { return r.json(); }).then(function (d) {
      var t = tool.querySelector('.fb-total');
      // Only worth showing once it's a number to be proud of.
      if (d && d.total >= 25 && t) { t.querySelector('b').textContent = Number(d.total).toLocaleString('en-GB'); t.hidden = false; }
    }).catch(function () {});
    var mineN = get(LIST_KEY, []).length;
    var ml = tool.querySelector('.fb-my-list');
    if (ml && mineN) { ml.querySelector('b').textContent = mineN + (mineN === 1 ? ' item' : ' items'); ml.hidden = false; }
    // Picking a product from the search suggestions goes straight to its invite panel.
    tool.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('.gp-suggest a[href^="/prices/"]');
      if (a && a.getAttribute('href').indexOf('#') === -1) a.setAttribute('href', a.getAttribute('href') + '#fourball');
    }, true);
  }

  /* ------------------------------------------------------------ alert confirmed */
  var conf = document.getElementById('fb-confirm');
  if (conf) {
    var cq = params();
    var cs = /^[a-z0-9-]{3,100}$/.test(cq.get('m') || '') ? cq.get('m') : '';
    if (cq.get('status') === 'ok' && cs) {
      fetch('/prices/' + cs + '/data.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        if (!d) return;
        conf.querySelector('.fb-product').textContent = d.name;
        if (cq.get('fb')) conf.querySelector('.fb-head').textContent = 'Anyone else in the group after one?';
        wireInvite(conf, cs, d.name, money(d.lowestNewPrice) + (d.unit === 'per dozen' ? ' per dozen' : ''));
      }).catch(function () {});
    }
  }
})();
