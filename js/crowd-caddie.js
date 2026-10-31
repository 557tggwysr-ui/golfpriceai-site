/* Crowd Caddie, on every price page: "Where's this price heading in the next
   two weeks?" Cheaper, Holds or Pricier. The alerts worker (/cc/...) locks in
   today's lowest UK price from the page's own data.json and settles the call
   14 days later. Calls are kept under this browser's random player id
   (gpPid). A nickname is optional, only for the Oracle board. */
(function () {
  'use strict';
  var box = document.getElementById('crowd-caddie');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WORD = { down: 'Cheaper', same: 'Holds', up: 'Pricier' };
  var slug = box.getAttribute('data-slug'), name = box.getAttribute('data-name') || '', per = box.getAttribute('data-per') || '';
  var btns = box.querySelectorAll('.cc-call'), mineEl = box.querySelector('.cc-mine'), crowdEl = box.querySelector('.cc-crowd');

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { return '£' + Number(n).toFixed(2); }
  function short(d) { var p = String(d).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1]; }
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
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }
  function track(ev, p) { try { if (window.gtag) window.gtag('event', ev, p || {}); } catch (e) { /* fine */ } }
  var TICK = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2f8a1f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';

  // The "You called it" card lives in js/milestones.js: load it only when needed.
  var msLoad = null;
  function milestones() {
    if (window.gpMilestones) return Promise.resolve(window.gpMilestones);
    if (!msLoad) msLoad = new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = '/js/milestones.js?v=20261101'; s.onload = function () { ok(window.gpMilestones); }; s.onerror = no;
      document.head.appendChild(s);
    });
    return msLoad;
  }
  function cardData(c) { return { name: c.name || name, call: c.call, from: c.price, to: c.result, per: per, slug: slug, day: c.due }; }

  /* ------------------------------------------------ drawing */
  function setPressed(call, lock) {
    btns.forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-call') === call ? 'true' : 'false');
      b.disabled = !!lock;
    });
  }
  function nickForm() {
    var have = get('gpNick', '') || '';
    if (get('gpCcNick', '')) return '<p class="cc-small">You’re on the Oracle board as <b>' + esc(get('gpCcNick', '')) + '</b>. <a href="/play/oracle/">See where you stand</a></p>';
    return '<form class="cc-nick" novalidate><label for="cc-nick-in">Add a nickname for the Oracle board (optional)</label>' +
      '<div class="cc-nick-row"><input id="cc-nick-in" name="nick" maxlength="20" autocomplete="nickname" placeholder="e.g. Fairway Prophet" value="' + esc(have) + '">' +
      '<button type="submit" class="cc-btn cc-btn-dark">Save</button></div><p class="cc-msg" role="status"></p></form>';
  }
  function drawMine(d) {
    var m = d.mine, last = d.last, html = '';
    if (last && !m) {
      if (last.outcome === 'void') {
        html += '<div class="cc-last"><b>Your last call couldn’t be settled</b><span>This product dropped off our price list before the 14 days were up, so that one doesn’t count.</span></div>';
      } else if (last.hit) {
        html += '<div class="cc-last cc-hit"><b>You called it: ' + WORD[last.call] + '.</b><span>' + money(last.price) + per + ' on ' + short(last.day) + ', ' + money(last.result) + per + ' on ' + short(last.due) + '.</span>' +
          '<button type="button" class="cc-btn" data-cc="card">Get the card</button></div>';
      } else {
        html += '<div class="cc-last"><b>Last time you said ' + WORD[last.call] + '. It ' + (last.outcome === 'down' ? 'got cheaper' : last.outcome === 'up' ? 'went up' : 'held') + '.</b><span>' + money(last.price) + per + ' then, ' + money(last.result) + per + ' on ' + short(last.due) + '. Fancy another go?</span></div>';
      }
    }
    if (m) {
      setPressed(m.call, true);
      html += '<div class="cc-locked">' + TICK + '<span><b>Your call: ' + WORD[m.call] + '</b><small>' + (m.settling
        ? 'Locked at ' + money(m.price) + per + '. We’re checking the price now.'
        : 'Locked at ' + money(m.price) + per + '. Result on ' + short(m.due) + '.') + '</small></span></div>';
      html += nickForm();
      if (m.call === 'down') html += '<p class="cc-small">Think it’ll drop? <a href="#price-alert">Get one email when it does</a>.</p>';
    } else {
      setPressed(null, false);
    }
    mineEl.innerHTML = html;
    mineEl.hidden = !html;
    var card = mineEl.querySelector('[data-cc="card"]');
    if (card) {
      card.addEventListener('click', function () {
        gpUse('cc_share');
        milestones().then(function (ms) { ms.open({ kind: 'called', date: last.due, d: cardData(last) }, false); });
      });
      // The first call a golfer gets right goes on their Milestones shelf.
      milestones().then(function (ms) { ms.award('called_first', 'called', cardData(last)); }).catch(function () {});
    }
    var f = mineEl.querySelector('.cc-nick');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = f.nick.value.trim(), msg = f.querySelector('.cc-msg');
      if (nick.length < 2) { msg.textContent = 'Pick a nickname (at least 2 letters).'; return; }
      api('/cc/nick', { pid: pid(), nick: nick }).then(function (r) {
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
        put('gpCcNick', r.nick); if (!get('gpNick', '')) put('gpNick', r.nick);
        f.outerHTML = '<p class="cc-small">Saved. You’re on the Oracle board as <b>' + esc(r.nick) + '</b> once five calls are settled. <a href="/play/oracle/">The Oracle board</a></p>';
      }).catch(function () { msg.textContent = 'Couldn’t save that just now. Please try again.'; });
    });
  }
  function bar(cls, label, n, total) {
    var p = pct(n, total);
    return '<div class="cc-bar ' + cls + '"><span class="cc-bar-top"><span>' + label + '</span><span>' + p + '%</span></span>' +
      '<span class="cc-bar-track"><span class="cc-bar-fill" style="width:' + p + '%"></span></span></div>';
  }
  function drawCrowd(d) {
    var o = d.open, voted = !!d.mine, html = '<span class="cc-kick cc-kick-dark">THE CROWD</span>';
    if (!voted) {
      html += '<b class="cc-crowd-h">' + (o.n ? (o.n === 1 ? 'One golfer has' : o.n + ' golfers have') + ' made a call on this one' : 'Be the first to call this one') + '</b>' +
        '<p class="cc-crowd-p">Make yours to see which way the crowd is leaning.</p>';
    } else if (o.n < 3) {
      html += '<b class="cc-crowd-h">You’re one of the first to call it</b><p class="cc-crowd-p">The crowd’s split shows here as more golfers make their call. Check back in a day or two.</p>';
    } else {
      var top = [['down', o.down], ['same', o.same], ['up', o.up]].sort(function (a, b) { return b[1] - a[1]; })[0];
      var lead = { down: 'think it’s getting cheaper', same: 'think it’ll hold', up: 'think it’s going up' }[top[0]];
      html += '<b class="cc-crowd-h">' + pct(top[1], o.n) + '% of golfers ' + lead + '</b>' +
        '<div class="cc-bars">' + bar('cc-bar-down', 'Cheaper', o.down, o.n) + bar('cc-bar-same', 'Holds', o.same, o.n) + bar('cc-bar-up', 'Pricier', o.up, o.n) + '</div>' +
        '<p class="cc-crowd-p">' + o.n + ' calls in the last two weeks' + (d.total > o.n ? ', ' + d.total + ' in all' : '') + '.</p>';
    }
    if (d.past) {
      var p = d.past, maj = [['down', p.down], ['same', p.same], ['up', p.up]].sort(function (a, b) { return b[1] - a[1]; })[0];
      var said = { down: 'said cheaper', same: 'said it would hold', up: 'said pricier' }[maj[0]];
      var went = p.outcome === 'down' ? 'it dropped' + (p.from && p.to ? ' ' + money(p.from - p.to) : '') : p.outcome === 'up' ? 'it went up' + (p.from && p.to ? ' ' + money(p.to - p.from) : '') : 'it held';
      html += '<p class="cc-past"><b>Crowd vs reality:</b> last time, ' + pct(maj[1], p.n) + '% ' + said + ', and ' + went + '.</p>';
    } else if (d.site) {
      html += '<p class="cc-past">Across every price we track, the crowd got ' + pct(d.site.right, d.site.n) + '% of its calls right in the last 30 days.</p>';
    }
    html += '<p class="cc-crowd-p"><a href="/play/oracle/">The Oracle board →</a></p>';
    crowdEl.innerHTML = html;
  }
  function draw(d) { if (!d || !d.ok) return; drawMine(d); drawCrowd(d); }

  /* ------------------------------------------------ calls */
  var busy = false;
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      if (busy || b.disabled) return;
      busy = true;
      var call = b.getAttribute('data-call');
      setPressed(call, true);
      api('/cc/vote', { pid: pid(), slug: slug, call: call }).then(function (r) {
        busy = false;
        if (!r.ok) { setPressed(null, false); mineEl.hidden = false; mineEl.innerHTML = '<p class="cc-msg" role="status">' + esc(r.error || 'Something went wrong. Please try again.') + '</p>'; return; }
        track('crowd_caddie_call', { call: call });
        draw(r);
      }).catch(function () {
        busy = false; setPressed(null, false);
        mineEl.hidden = false; mineEl.innerHTML = '<p class="cc-msg" role="status">Couldn’t send your call just now. Please try again.</p>';
      });
    });
  });

  // Load the state when the box comes into view (most visitors never scroll that far).
  function load() {
    gpUse('cc_view');
    var p = get('gpPid', '');
    api('/cc/state?s=' + encodeURIComponent(slug) + (/^[a-z0-9]{12,32}$/.test(p) ? '&pid=' + p : '')).then(draw).catch(function () {});
  }
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); } }, { rootMargin: '300px' });
    io.observe(box);
  } else load();
})();
