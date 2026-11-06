/* "Get the UK Golf Price Report each month" (report and press note pages).
   Double opt-in through the alerts worker: we email a confirm link first. */
(function () {
  'use strict';
  var box = document.getElementById('rp-sign'); if (!box) return;
  var f = box.querySelector('form'), msg = box.querySelector('.rp-sign-msg'), btn = f.querySelector('button');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = f.querySelector('#rp-email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = 'That email address doesn’t look right.'; return; }
    btn.disabled = true; msg.textContent = '';
    fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, press: 1, website: f.querySelector('[name=website]').value }) })
      .then(function (r) { return r.json(); }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Please try again.'; return; }
        msg.textContent = r.status === 'added-press' ? 'Done: you’ll get the next edition.' : 'Nearly there: check your inbox and tap the confirm link.';
        f.hidden = true;
        try { if (window.gtag) window.gtag('event', 'press_signup', {}); } catch (x) { /* fine */ }
      }).catch(function () { btn.disabled = false; msg.textContent = 'No signal just now. Please try again.'; });
  });
})();
