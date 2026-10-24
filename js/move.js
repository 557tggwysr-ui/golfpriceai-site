/* GolfPrice AI: Play on another device (Clubhouse, /play/#move).
   There are no logins: a player is the random id saved in their browser (gpPid).
   The device you already use asks the alerts worker for a code (8 characters,
   30 minutes, works once). The new device swaps the code for that id, plus the
   few things kept in the browser: nickname, Par Price streak, today's card and a
   half-built Bag Draft, plus the My Clubhouse bits (Society HQ list, shortlist
   and the prices it was saved at, fit answers, bag, Higher or Lower best and
   gift wishlist). Nothing else is stored, and no email or name is needed. */
(function () {
  'use strict';
  var box = document.getElementById('move');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  // The panel is a slim bar that opens on a tap, or straight away from a #move link.
  function openIf() { if (location.hash === '#move' && 'open' in box) box.open = true; }
  openIf(); window.addEventListener('hashchange', openIf);
  if ('open' in box) box.addEventListener('toggle', function () { if (box.open) track('play_move_open'); });
  var KEYS = { nick: 'gpNick', streak: 'gpParStreak', card: 'gpParPrice', wip: 'gpDraftWip', socs: 'gpSocs', list: 'gpShortlist', watch: 'gpWatch',
    fit: 'golfpriceai-fit-profile', bag: 'golfpriceai-bag-builder', hl: 'gpHL', wish: 'gpWishlist' };
  // Dropped first if the bundle is too big for one code (the worker takes 8,000 characters).
  var SPARE = ['wip', 'watch', 'bag', 'wish', 'card'];
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n) { if (window.gtag) window.gtag('event', n); }
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function pretty(c) { c = c.toUpperCase(); return c.slice(0, 4) + '-' + c.slice(4); }

  /* ---- On the device you already play on: get a code */
  var make = document.getElementById('mv-make'), out = document.getElementById('mv-out');
  make.addEventListener('click', function () {
    var pid = get('gpPid', '');
    out.hidden = false;
    if (!/^[a-z0-9]{12,32}$/.test(pid)) {
      out.innerHTML = '<p>Nothing to move yet. Play a round of <a href="/play/par-price/">Par Price</a>, join a league or join your golf society on this device first.</p>';
      return;
    }
    var data = {};
    Object.keys(KEYS).forEach(function (k) { var v = get(KEYS[k], null); if (v != null) data[k] = v; });
    SPARE.forEach(function (k) { if (JSON.stringify(data).length > 7800) delete data[k]; });
    make.disabled = true; out.innerHTML = '<p>Getting a code…</p>';
    post('/pp/move/create', { pid: pid, data: data }).then(function (r) {
      make.disabled = false;
      if (!r.ok) { out.innerHTML = '<p>' + esc(r.error || 'Something went wrong. Please try again.') + '</p>'; return; }
      var link = 'https://golfpriceai.com/play/?move=' + r.code + '#move';
      out.innerHTML = '<p class="mv-code" aria-label="Your code">' + pretty(r.code) + '</p>' +
        '<p>Type this code on your other device, or send yourself the link. It works once, for the next ' + r.mins + ' minutes.</p>' +
        '<p class="mv-btns">' + (navigator.share ? '<button type="button" class="ch-btn mv-share">Send me the link</button>' : '') +
        '<button type="button" class="mv-copy">Copy link</button></p>';
      var sh = out.querySelector('.mv-share');
      if (sh) sh.addEventListener('click', function () { navigator.share({ title: 'GolfPrice AI', text: 'Open this on my other device: ', url: link }).catch(function () {}); });
      out.querySelector('.mv-copy').addEventListener('click', function (e) {
        var b = e.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { window.prompt('Copy this link:', link); });
      });
      track('play_move_code');
    }).catch(function () { make.disabled = false; out.innerHTML = '<p>We couldn’t reach the clubhouse. Please try again.</p>'; });
  });

  /* ---- On the new device: use the code */
  var form = document.getElementById('mv-form'), input = form.querySelector('[name=code]'), msg = form.querySelector('.pr-msg');
  var fromLink = (location.search.match(/[?&]move=([a-z0-9]{8})/i) || [])[1];
  if (fromLink) {
    if ('open' in box) box.open = true;
    input.value = pretty(fromLink);
    msg.textContent = 'Nearly there: tap “Use code” to make this device you.';
    if (history.replaceState) history.replaceState(null, '', location.pathname + '#move');
    setTimeout(function () { box.scrollIntoView({ block: 'start' }); form.querySelector('button').focus(); }, 300);
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = form.querySelector('button');
    btn.disabled = true; msg.textContent = 'Checking the code…';
    post('/pp/move/claim', { code: input.value }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
      var ok = put('gpPid', r.pid);
      Object.keys(KEYS).forEach(function (k) { if (r.data && r.data[k] != null) put(KEYS[k], r.data[k]); });
      if (!ok) { msg.textContent = 'This browser won’t save anything (is it a private tab?). Try a normal tab.'; return; }
      track('play_move_done');
      var nick = r.data && r.data.nick;
      msg.textContent = (nick ? 'Welcome back, ' + nick + '! ' : 'Done! ') + 'This device is now you. Loading your clubhouse…';
      setTimeout(function () { location.href = location.pathname; }, 1400);
    }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
  });
})();
