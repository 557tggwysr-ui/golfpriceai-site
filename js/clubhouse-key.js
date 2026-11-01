/* Clubhouse key: the way back into your Clubhouse on any phone.

   There are no accounts on GolfPrice AI: each browser has a random player id
   (gpPid). Clear the browser, or change phones, and that id is gone. A
   Clubhouse key is a 12-character code (like 7KQ2-M9XR-4HTD) that brings it
   back. The alerts worker keeps only a scrambled copy of the key, plus a small
   backup of this browser's Clubhouse (nickname, saved kit, Shot Saver rounds:
   the same bundle "Move my Clubhouse" carries). No email, no name.

   Passkeys (Face ID, fingerprint or the phone's PIN) unlock it too, with the
   key as the fallback. Backups of the key itself, all on the golfer's side:
     - the phone's own password manager (iCloud Keychain, Google, Chrome)
     - WhatsApp to yourself, or your own email app (we never see the address)
     - the Clubhouse card: an image with a QR code that restores in one scan

   Pages call:
     gpKey.prompt({ why })      the "save your key" panel (makes a key if needed)
     gpKey.status()             { saved, hasCode }
     gpKey.statusCard(why)      HTML for My Clubhouse, wired by gpKey.wire(el)
     gpKey.restoreForm()        HTML for "get my Clubhouse back", wired by gpKey.wire(el)
     gpKey.sync()               refresh the backup (at most daily, or when changed)
     gpKey.fromLink()           a scanned card (#key=...) restores after a confirm */
(function () {
  'use strict';
  if (window.gpKey) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  // The same bundle as Move my Clubhouse (js/move.js), kept in step by hand.
  var KEYS = { nick: 'gpNick', streak: 'gpParStreak', card: 'gpParPrice', wip: 'gpDraftWip', socs: 'gpSocs', list: 'gpShortlist', watch: 'gpWatch',
    fit: 'golfpriceai-fit-profile', bag: 'golfpriceai-bag-builder', hl: 'gpHL', wish: 'gpWishlist', ss: 'gpShotSaver', ms: 'gpMilestones' };
  var SPARE = ['wip', 'watch', 'bag', 'wish', 'card', 'ms'];

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
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
  function post(path, body) {
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function longDay(iso) { var d = new Date(iso + 'T12:00:00'); return isNaN(d) ? '' : d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]; }

  /* ------------------------------------------------------------ state */
  // gpKeyCode: the key itself (this device only, so "Show my key" works).
  // gpKeyInfo: { at, saved, how: [...] }  saved = the golfer ticked "I've saved it".
  function info() { return get('gpKeyInfo', null) || {}; }
  function status() { var i = info(); return { saved: !!i.saved, at: i.at || '', how: i.how || [], hasCode: !!get('gpKeyCode', '') }; }
  function note(how) { var i = info(); i.how = (i.how || []).filter(function (x) { return x !== how; }).concat([how]); put('gpKeyInfo', i); }
  function make() {
    var have = get('gpKeyCode', '');
    if (have) return Promise.resolve(have);
    return post('/ck/make', { pid: pid() }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Something went wrong.');
      put('gpKeyCode', r.key); put('gpKeyInfo', { at: today(), saved: false, how: [] });
      return r.key;
    });
  }
  function fresh() {   // a new key; the old one stops working
    put('gpKeyCode', '');
    try { localStorage.removeItem('gpKeyCode'); } catch (e) { /* fine */ }
    return make();
  }

  /* ------------------------------------------------------------ the backup bundle */
  function bundle() {
    var data = {};
    Object.keys(KEYS).forEach(function (k) { var v = get(KEYS[k], null); if (v != null) data[k] = v; });
    SPARE.forEach(function (k) { if (JSON.stringify(data).length > 7800) delete data[k]; });
    return data;
  }
  function sum(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h); }
  function sync(force) {
    if (!info().at) return Promise.resolve(false);
    var data = bundle(), s = sum(JSON.stringify(data)), last = get('gpVault', {});
    if (!force && last.s === s && last.d === today()) return Promise.resolve(false);
    return post('/ck/sync', { pid: pid(), data: data }).then(function (r) {
      if (r.ok) put('gpVault', { s: s, d: today() });
      return !!r.ok;
    }).catch(function () { return false; });
  }

  /* ------------------------------------------------------------ restore */
  function restore(key) {
    return post('/ck/restore', { key: key }).then(apply);
  }
  function apply(r) {
    {
      if (!r.ok) throw new Error(r.error || 'That key didn’t work.');
      put('gpPid', r.pid);
      var d = r.data || {};
      Object.keys(KEYS).forEach(function (k) { if (d[k] != null) put(KEYS[k], d[k]); });
      if (r.nick && !get('gpNick', '')) put('gpNick', r.nick);
      // Societies come from the clubhouse itself, so they're right even without a backup.
      var socs = get('gpSocs', []);
      (r.socs || []).forEach(function (s) { if (!socs.some(function (x) { return x.id === s.id; })) socs.push({ id: s.id, name: s.name }); });
      put('gpSocs', socs.slice(0, 10));
      put('gpKeyInfo', { at: today(), saved: true, how: ['restored'] });
      try { localStorage.removeItem('gpKeyCode'); } catch (e) { /* the code isn't kept: they have it already */ }
      track('clubhouse_restored');
      return r;
    }
  }

  /* ------------------------------------------------------------ passkeys (Face ID, fingerprint, PIN)
     A standard passkey for golfpriceai.com, kept and synced by Apple, Google or
     the browser. Only the public half reaches us. */
  function pkOk() { return !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create); }
  function rpId() { return /(^|\.)golfpriceai\.com$/.test(location.hostname) ? 'golfpriceai.com' : location.hostname; }
  function b64u(buf) { var s = '', u = new Uint8Array(buf); for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(t) { t = String(t).replace(/-/g, '+').replace(/_/g, '/'); var b = atob(t + '==='.slice((t.length + 3) % 4)), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function pkError(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'AbortError') return new Error('No problem, nothing was saved. Try again whenever you like.');
    if (n === 'InvalidStateError') return new Error('This phone already has a passkey for your Clubhouse.');
    return new Error('This phone couldn’t make a passkey. Your Clubhouse key still works.');
  }
  function addPasskey() {
    if (!pkOk()) return Promise.reject(new Error('This browser doesn’t do passkeys. Your Clubhouse key still works.'));
    var me = pid(), nick = String(get('gpNick', '') || '').slice(0, 24);
    return post('/ck/pk/begin', { pid: me }).then(function (b) {
      if (!b.ok) throw new Error(b.error || 'Please try again.');
      var uid = new Uint8Array(16); crypto.getRandomValues(uid);
      return navigator.credentials.create({ publicKey: {
        challenge: unb64u(b.challenge), rp: { id: rpId(), name: 'GolfPrice AI' },
        user: { id: uid, name: 'GolfPrice AI Clubhouse' + (nick ? ' (' + nick + ')' : ''), displayName: nick || 'My Clubhouse' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        excludeCredentials: (b.have || []).map(function (id) { return { type: 'public-key', id: unb64u(id) }; }),
        attestation: 'none', timeout: 120000 } }).catch(function (e) { throw pkError(e); });
    }).then(function (cred) {
      var res = cred.response, spki = res.getPublicKey ? res.getPublicKey() : null, alg = res.getPublicKeyAlgorithm ? res.getPublicKeyAlgorithm() : null;
      if (!spki || alg == null) throw new Error('This phone is a little too old for passkeys. Your Clubhouse key still works.');
      return post('/ck/pk/add', { pid: me, id: cred.id, publicKey: b64u(spki), alg: alg, clientDataJSON: b64u(res.clientDataJSON) });
    }).then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Please try again.');
      var i = info(); if (!i.at) i.at = today(); i.saved = true; i.how = (i.how || []).filter(function (x) { return x !== 'passkey'; }).concat(['passkey']); put('gpKeyInfo', i);
      put('gpPasskey', today()); gpUse('pk_added'); track('clubhouse_passkey_added'); sync(true);
      return true;
    });
  }
  function unlock() {
    if (!pkOk()) return Promise.reject(new Error('This browser doesn’t do passkeys. Use your Clubhouse key instead.'));
    return post('/ck/pk/begin', {}).then(function (b) {
      if (!b.ok) throw new Error(b.error || 'Please try again.');
      return navigator.credentials.get({ publicKey: { challenge: unb64u(b.challenge), rpId: rpId(), userVerification: 'required', allowCredentials: [], timeout: 120000 } })
        .catch(function (e) { if (e && e.name === 'NotAllowedError') throw new Error('No passkey found on this phone, or it was cancelled. Try your Clubhouse key instead.'); throw pkError(e); });
    }).then(function (cred) {
      var res = cred.response;
      return post('/ck/pk/unlock', { id: cred.id, clientDataJSON: b64u(res.clientDataJSON), authenticatorData: b64u(res.authenticatorData), signature: b64u(res.signature) });
    }).then(function (r) { var out = apply(r); put('gpPasskey', today()); var i = info(); i.how = ['passkey']; put('gpKeyInfo', i); return out; });
  }
  // The Clubhouse card's QR code opens /play/my-clubhouse/#key=XXXX-XXXX-XXXX.
  function fromLink() {
    var m = location.hash.match(/key=([A-Za-z0-9-]{12,16})/);
    if (!m) return false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* fine */ }
    var have = get('gpSocs', []).length || get('gpNick', '');
    if (have && !window.confirm('Bring back the Clubhouse on this card? It replaces what’s on this phone now.')) return true;
    restore(m[1]).then(function () { location.replace('/play/my-clubhouse/?restored=1'); },
      function (e) { window.alert(e.message); });
    return true;
  }

  /* ------------------------------------------------------------ styles */
  function css() {
    if (document.getElementById('ck-css')) return;
    var s = document.createElement('style'); s.id = 'ck-css';
    s.textContent =
      '.ck-back{position:fixed;inset:0;background:rgba(20,33,26,.55);z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:0}' +
      '@media(min-width:600px){.ck-back{align-items:center;padding:24px}}' +
      '.ck-panel{background:#f6f6f3;width:100%;max-width:440px;max-height:94vh;overflow:auto;border-radius:22px 22px 0 0;padding:16px;display:flex;flex-direction:column;gap:12px;font-family:Inter,sans-serif;color:#14211a;box-sizing:border-box}' +
      '@media(min-width:600px){.ck-panel{border-radius:22px}}' +
      '.ck-top{background:#14211a;color:#fff;border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:8px}' +
      '.ck-kick{font:700 11px Inter,sans-serif;letter-spacing:.14em;color:#8fd97c}.ck-top h2{margin:0;font:800 24px/1.1 Poppins,sans-serif}.ck-top p{margin:0;font-size:14px;line-height:1.5;color:#c4d0c8}' +
      '.ck-box{background:#fff;border:1px solid #e4e6e0;border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px}' +
      '.ck-box b.ck-h{font:700 16px Poppins,sans-serif}' +
      '.ck-code{height:56px;border:2px dashed #3fae29;border-radius:12px;background:#f3faf0;text-align:center;font:800 24px Poppins,sans-serif;letter-spacing:.06em;color:#14211a;width:100%;box-sizing:border-box}' +
      '.ck-small{margin:0;font-size:12.5px;line-height:1.45;color:#5b665f}' +
      '.ck-btn,.ck-btn2{min-height:50px;border-radius:12px;font:700 15px Inter,sans-serif;display:flex;align-items:center;gap:12px;padding:0 16px;cursor:pointer;text-decoration:none;box-sizing:border-box}' +
      '.ck-btn{border:0;background:#3fae29;color:#fff}.ck-btn:hover{background:#2f8a1f;color:#fff}' +
      '.ck-btn2{border:1px solid #d5d9d1;background:#fff;color:#14211a}.ck-btn2:hover{border-color:#3fae29;color:#14211a}' +
      '.ck-btn2.done,.ck-btn.done{border-color:#3fae29;background:#eef7ea;color:#1f6a12}' +
      '.ck-dark{border:0;background:#14211a;color:#fff;justify-content:center}.ck-dark:disabled{opacity:.45;cursor:default}' +
      '.ck-check{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;line-height:1.45;padding:0 4px}.ck-check input{width:22px;height:22px;margin:0;flex:none}' +
      '.ck-pw{display:flex;flex-direction:column;gap:8px;border-top:1px solid #eef0ec;padding-top:10px}.ck-pw input{height:44px;border:1px solid #d5d9d1;border-radius:10px;padding:0 10px;font:600 15px Inter,sans-serif}' +
      '.ck-msg{margin:0;font-size:13.5px;font-weight:600;color:#2f8a1f}.ck-msg:empty{display:none}.ck-err{color:#b3261e}' +
      '.ck-field{height:52px;border:1px solid #d5d9d1;border-radius:12px;background:#fbfbf9;text-align:center;font:700 20px Poppins,sans-serif;letter-spacing:.06em;color:#14211a;width:100%;box-sizing:border-box;text-transform:uppercase}' +
      '.ck-or{display:flex;align-items:center;gap:10px;color:#5b665f;font-size:12.5px}.ck-or:before,.ck-or:after{content:"";flex:1;height:1px;background:#e4e6e0}' +
      '.ck-warn{background:#fdf0e3;border:1px solid #f3cfa6;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:8px;color:#5c3109}' +
      '.ck-warn b{font:700 17px Poppins,sans-serif}.ck-warn span{font-size:14px;line-height:1.5}' +
      '.ck-ok{background:#fff;border:1px solid #e4e6e0;border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}' +
      '.ck-ok-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.ck-ok-top b{font:700 17px Poppins,sans-serif}' +
      '.ck-pill{background:#eef7ea;color:#1f6a12;border-radius:999px;padding:5px 10px;font:700 12px Inter,sans-serif}' +
      '.ck-row{display:flex;gap:8px;flex-wrap:wrap}.ck-row .ck-btn2{min-height:44px;font-size:14px;padding:0 14px}' +
      '.ck-link{border:0;background:none;color:#2f8a1f;font:600 13px Inter,sans-serif;text-decoration:underline;cursor:pointer;padding:0;align-self:flex-start}' +
      '.ck-show{font:800 22px Poppins,sans-serif;letter-spacing:.06em;text-align:center;background:#f3faf0;border-radius:12px;padding:10px}';
    document.head.appendChild(s);
  }
  var IC = {
    lock: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M7 11V7a5 5 0 0110 0v4M5 11h14v10H5z"/></svg>',
    wa: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M21 12a9 9 0 01-13.5 7.8L3 21l1.2-4.5A9 9 0 1121 12z"/></svg>',
    mail: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 6h18v12H3zM3 6l9 7 9-7"/></svg>',
    face: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M9 10v1M15 10v1M12 10v3h-1M9.5 16a4 4 0 005 0"/></svg>',
    qr: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2M18 14h2v2M14 18h2v2h4"/></svg>'
  };

  /* ------------------------------------------------------------ the four backups */
  function keyText(code) {
    return 'My GolfPrice AI Clubhouse key: ' + code + '\nIf I lose my phone or clear my browser, I type it at ' + SITE + '/play/my-clubhouse/ to get my societies, leagues and rounds back. Keep it private.';
  }
  function toPasswords(code, btn, form) {
    // Chrome and Android: store it straight in the password manager.
    if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
      try {
        return navigator.credentials.store(new window.PasswordCredential({ id: 'GolfPrice AI Clubhouse', password: code, name: 'GolfPrice AI Clubhouse' }))
          .then(function () { done(btn, 'Saved to your passwords'); note('passwords'); gpUse('ck_saved'); }, function () { showForm(); });
      } catch (e) { /* fall through */ }
    }
    showForm();
    function showForm() { form.hidden = false; var b = form.querySelector('button'); if (b) b.focus(); }
  }
  function done(btn, label) { if (!btn) return; btn.classList.add('done'); var t = btn.querySelector('span'); if (t) t.textContent = label; }
  function toWhatsApp(code, btn) {
    window.open('https://wa.me/?text=' + encodeURIComponent(keyText(code)), '_blank', 'noopener');
    done(btn, 'Sent to WhatsApp (pick “Message yourself”)'); note('whatsapp'); gpUse('ck_saved');
  }
  function toEmail(code, btn) {
    location.href = 'mailto:?subject=' + encodeURIComponent('My GolfPrice AI Clubhouse key') + '&body=' + encodeURIComponent(keyText(code));
    done(btn, 'Opened your email app'); note('email'); gpUse('ck_saved');
  }

  /* ------------------------------------------------------------ the Clubhouse card */
  function qrPath(text) {
    if (!window.qrcode) return null;
    var q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q;
  }
  function loadQr() {
    if (window.qrcode) return Promise.resolve();
    return new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/js/vendor/qrcode.min.js?v=144'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  function rr(x, cx, cy, w, h, r) { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r); x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath(); }
  function text(x, s, px, y, font, color, align) { x.font = font; x.fillStyle = color; x.textAlign = align || 'left'; x.fillText(s, px, y); }
  function drawCard(code) {
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d'), L = 110, R = 970, nick = String(get('gpNick', '') || '').slice(0, 24);
    x.fillStyle = '#14211a'; x.fillRect(0, 0, 1080, 1350);
    x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.16)'; rr(x, 50, 50, 980, 1250, 36); x.stroke();
    text(x, 'Golf', L, 170, '800 40px Poppins, sans-serif', '#fff'); var w1 = x.measureText('Golf').width;
    text(x, 'Price', L + w1, 170, '800 40px Poppins, sans-serif', '#5fd14a'); var w2 = x.measureText('Price').width;
    text(x, ' AI', L + w1 + w2, 170, '800 40px Poppins, sans-serif', '#fff');
    text(x, 'CLUBHOUSE CARD', R, 164, '700 22px Inter, sans-serif', '#8fd97c', 'right');
    if (nick) text(x, nick.toUpperCase(), L, 300, '700 28px Inter, sans-serif', '#f08a24');
    text(x, 'Your way back in', L, 390, '800 78px Poppins, sans-serif', '#fff');
    text(x, 'Scan this on any phone to bring back your', L, 460, '400 32px Inter, sans-serif', '#c4d0c8');
    text(x, 'societies, leagues, handicap and rounds.', L, 504, '400 32px Inter, sans-serif', '#c4d0c8');
    var q = qrPath(SITE + '/play/my-clubhouse/#key=' + code), size = 420, top = 570;
    x.fillStyle = '#fff'; rr(x, L, top, size + 40, size + 40, 24); x.fill();
    if (q) {
      var n = q.getModuleCount(), cell = size / n;
      x.fillStyle = '#14211a';
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) x.fillRect(L + 20 + c * cell, top + 20 + r * cell, Math.ceil(cell), Math.ceil(cell));
    }
    var kx = L + size + 90;
    text(x, 'OR TYPE YOUR KEY', kx, top + 150, '700 22px Inter, sans-serif', '#8fd97c');
    var parts = code.split('-');
    parts.forEach(function (p, i) { text(x, p, kx, top + 230 + i * 74, '800 64px Poppins, sans-serif', '#fff'); });
    text(x, 'at golfpriceai.com', kx, top + 440, '400 24px Inter, sans-serif', '#c4d0c8');
    x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(L, 1150, R - L, 2);
    text(x, 'Keep it private. Like a spare key under the mat, but safer.', L, 1225, '400 30px Inter, sans-serif', '#c4d0c8');
    return cv;
  }
  function saveCard(code, btn) {
    var ready = document.fonts && document.fonts.load ? Promise.all(['800 78px Poppins', '400 32px Inter', '700 22px Inter'].map(function (f) { return document.fonts.load(f).catch(function () {}); })) : Promise.resolve();
    Promise.all([ready, loadQr()]).then(function () {
      drawCard(code).toBlob(function (blob) {
        if (!blob) return;
        var file = window.File ? new File([blob], 'golfpriceai-clubhouse-card.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(function () {});
        else { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'golfpriceai-clubhouse-card.png'; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
        done(btn, 'Card saved. Keep it in your photos'); note('card'); gpUse('ck_card');
      }, 'image/png');
    }).catch(function () { window.alert('The card wouldn’t draw just now. Use one of the other options.'); });
  }

  /* ------------------------------------------------------------ the "save your key" panel */
  function prompt(opts) {
    opts = opts || {};
    css();
    var old = document.querySelector('.ck-back'); if (old) old.remove();
    var back = document.createElement('div'); back.className = 'ck-back';
    back.innerHTML = '<div class="ck-panel" role="dialog" aria-modal="true" aria-labelledby="ck-h"><section class="ck-top"><span class="ck-kick">' + esc(opts.kick || 'ONE LAST THING') + '</span>' +
      '<h2 id="ck-h">Save your Clubhouse key</h2><p>' + esc(opts.why || 'It’s how you get your Clubhouse back on a new phone, or if your browser forgets you. No email, no password to remember. Just keep it somewhere safe.') + '</p></section>' +
      '<section class="ck-box"><label for="ck-code" style="font:600 13px Inter,sans-serif;color:#4a554e">Your Clubhouse key</label><input id="ck-code" class="ck-code" type="text" readonly value="Making your key…">' +
      '<p class="ck-small" style="text-align:center">Anyone with this key can open your Clubhouse. Keep it to yourself.</p></section>' +
      '<section class="ck-box"><b class="ck-h">Save it two ways (it takes 10 seconds)</b>' +
      (pkOk() ? '<button type="button" class="ck-btn" data-ck="pk">' + IC.face + '<span>Use Face ID, fingerprint or PIN</span></button>' : '') +
      '<button type="button" class="' + (pkOk() ? 'ck-btn2' : 'ck-btn') + '" data-ck="pw">' + IC.lock + '<span>Save to my phone’s passwords</span></button>' +
      '<form class="ck-pw" hidden autocomplete="on" action="#" method="post"><span class="ck-small">Tap Save and your phone should offer to keep it as a password for golfpriceai.com.</span>' +
      '<input type="text" name="username" autocomplete="username" value="GolfPrice AI Clubhouse" readonly aria-label="Name">' +
      '<input type="password" name="password" autocomplete="new-password" aria-label="Clubhouse key"><button type="submit" class="ck-btn2" style="justify-content:center"><span>Save</span></button></form>' +
      '<button type="button" class="ck-btn2" data-ck="wa">' + IC.wa + '<span>WhatsApp it to myself</span></button>' +
      '<button type="button" class="ck-btn2" data-ck="mail">' + IC.mail + '<span>Email it to myself</span></button>' +
      '<button type="button" class="ck-btn2" data-ck="card">' + IC.qr + '<span>Save my Clubhouse card (QR)</span></button>' +
      '<p class="ck-small">Email opens your own email app. It goes from you, to you: we never see or keep your address.</p></section>' +
      '<label class="ck-check"><input type="checkbox" id="ck-saved"> I’ve saved my key somewhere I’ll find it</label>' +
      '<p class="ck-msg" role="status"></p>' +
      '<button type="button" class="ck-btn ck-dark" id="ck-done" disabled>' + esc(opts.done || 'Done') + '</button>' +
      '<button type="button" class="ck-link" id="ck-later">Remind me later</button></div>';
    document.body.appendChild(back);
    var code = '', msg = back.querySelector('.ck-msg'), form = back.querySelector('.ck-pw');
    make().then(function (c) { code = c; back.querySelector('#ck-code').value = c; form.querySelector('[name=password]').value = c; },
      function (e) { msg.className = 'ck-msg ck-err'; msg.textContent = e.message || 'We couldn’t make a key just now. Please try again in a minute.'; });
    back.querySelector('[data-ck=pw]').onclick = function () { if (code) toPasswords(code, this, form); };
    var pkb = back.querySelector('[data-ck=pk]'); if (pkb) pkb.onclick = function () {
      var b = this; b.disabled = true;
      addPasskey().then(function () { b.disabled = false; done(b, 'Face ID / fingerprint added'); msg.className = 'ck-msg'; msg.textContent = 'Passkey saved. Save the key one more way too, just in case.'; },
        function (e) { b.disabled = false; msg.className = 'ck-msg ck-err'; msg.textContent = e.message; });
    };
    form.addEventListener('submit', function (e) { e.preventDefault(); done(back.querySelector('[data-ck=pw]'), 'Offered to your passwords'); note('passwords'); gpUse('ck_saved'); form.hidden = true; });
    back.querySelector('[data-ck=wa]').onclick = function () { if (code) toWhatsApp(code, this); };
    back.querySelector('[data-ck=mail]').onclick = function () { if (code) toEmail(code, this); };
    back.querySelector('[data-ck=card]').onclick = function () { if (code) saveCard(code, this); };
    var tick = back.querySelector('#ck-saved'), go = back.querySelector('#ck-done');
    tick.onchange = function () { go.disabled = !tick.checked || !code; };
    go.onclick = function () {
      var i = info(); i.saved = true; i.savedAt = today(); put('gpKeyInfo', i);
      track('clubhouse_key_saved', { how: (i.how || []).join(',') });
      sync(true); close(); if (opts.after) opts.after();
    };
    back.querySelector('#ck-later').onclick = function () { put('gpKeyLater', today()); close(); if (opts.after) opts.after(); };
    function close() { back.remove(); }
    setTimeout(function () { back.querySelector('[data-ck=pw]').focus(); }, 30);
  }

  /* ------------------------------------------------------------ My Clubhouse pieces */
  function statusCard(why) {
    css();
    var s = status();
    if (!s.saved) return '<div class="ck-warn"><b>Your Clubhouse isn’t backed up</b><span>' + esc(why || 'If this browser forgets you, your Clubhouse goes with it.') + ' Save your key: it takes 10 seconds.</span>' +
      '<button type="button" class="ck-btn ck-dark" data-ckw="save">Save my Clubhouse key</button></div>';
    var how = s.how.map(function (h) { return { passwords: 'your phone’s passwords', whatsapp: 'your WhatsApp', email: 'your email', card: 'your Clubhouse card', restored: 'your key', passkey: 'your phone’s Face ID / fingerprint' }[h]; }).filter(Boolean);
    return '<div class="ck-ok"><div class="ck-ok-top"><b>Backed up</b><span class="ck-pill">Safe</span></div>' +
      '<span class="ck-small" style="font-size:14px;color:#4a554e">' + (how.length ? 'Saved to ' + how.join(' and ') : 'Saved') + (s.at ? ', ' + longDay(s.at) : '') + '. Works on any phone.</span>' +
      '<div class="ck-row">' + (s.hasCode ? '<button type="button" class="ck-btn2" data-ckw="show">Show my key</button><button type="button" class="ck-btn2" data-ckw="card">My Clubhouse card</button>' : '') +
      '<button type="button" class="ck-btn2" data-ckw="again">Save it again</button>' +
      (pkOk() && s.how.indexOf('passkey') < 0 && !get('gpPasskey', '') ? '<button type="button" class="ck-btn2" data-ckw="pk">' + IC.face + 'Add Face ID or fingerprint</button>' : '') + '</div><div data-ckw-out></div>' +
      '<span class="ck-small">Think someone’s seen your key? <button type="button" class="ck-link" data-ckw="new">Get a new one</button> and the old one stops working.</span></div>';
  }
  function restoreForm() {
    css();
    return '<form class="ck-box" data-ckr novalidate autocomplete="on"><b class="ck-h">Been here before?</b>' +
      '<span class="ck-small" style="font-size:14px;color:#4a554e">New phone, or cleared your browser? Your societies, leagues, handicap and rounds come straight back.</span>' +
      (pkOk() ? '<button type="button" class="ck-btn" data-ckw="unlock" style="justify-content:center">' + IC.face + 'Unlock with Face ID, fingerprint or PIN</button><div class="ck-or">or</div>' : '') +
      '<input type="text" name="username" autocomplete="username" value="GolfPrice AI Clubhouse" hidden>' +
      '<label for="ck-in" class="ck-small">Type your key (or tap the box, if your phone saved it)</label>' +
      '<input id="ck-in" class="ck-field" name="password" type="text" autocomplete="current-password" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX" maxlength="16">' +
      '<button type="submit" class="ck-btn ck-dark">Get my Clubhouse back</button><p class="ck-msg" role="status"></p>' +
      '<span class="ck-small">Got a Clubhouse card? Scan its QR code with your phone’s camera.</span></form>';
  }
  function wire(el) {
    if (!el) return;
    el.querySelectorAll('[data-ckw]').forEach(function (b) {
      b.onclick = function () {
        var w = b.getAttribute('data-ckw'), out = el.querySelector('[data-ckw-out]');
        if (w === 'save' || w === 'again') prompt({ kick: 'MY CLUBHOUSE', after: function () { location.reload(); } });
        else if (w === 'show' && out) out.innerHTML = '<div class="ck-show">' + esc(get('gpKeyCode', '')) + '</div>';
        else if (w === 'card') saveCard(get('gpKeyCode', ''), b);
        else if (w === 'pk') {
          b.disabled = true;
          addPasskey().then(function () { location.reload(); }, function (e) { b.disabled = false; if (out) out.innerHTML = '<p class="ck-msg ck-err">' + esc(e.message) + '</p>'; });
        }
        else if (w === 'unlock') {
          var m = el.querySelector('[data-ckr] .ck-msg'); b.disabled = true;
          if ((get('gpSocs', []).length || get('gpNick', '')) && !window.confirm('Bring back your Clubhouse? It replaces what’s on this phone now.')) { b.disabled = false; return; }
          unlock().then(function () { location.replace('/play/my-clubhouse/?restored=1'); },
            function (e) { b.disabled = false; if (m) { m.className = 'ck-msg ck-err'; m.textContent = e.message; } });
        }
        else if (w === 'new') {
          if (!window.confirm('Get a new key? Your old key stops working straight away.')) return;
          fresh().then(function () { put('gpKeyInfo', { at: today(), saved: false, how: [] }); prompt({ kick: 'YOUR NEW KEY', after: function () { location.reload(); } }); },
            function (e) { window.alert(e.message); });
        }
      };
    });
    var f = el.querySelector('[data-ckr]');
    if (f) f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.ck-msg'), btn = f.querySelector('[type=submit]'), v = f.password.value;
      if (String(v).replace(/[^A-Za-z0-9]/g, '').length !== 12) { msg.className = 'ck-msg ck-err'; msg.textContent = 'A Clubhouse key is 12 letters and numbers, like 7KQ2-M9XR-4HTD.'; return; }
      if ((get('gpSocs', []).length || get('gpNick', '')) && !window.confirm('Bring back your Clubhouse? It replaces what’s on this phone now.')) return;
      btn.disabled = true; msg.className = 'ck-msg'; msg.textContent = 'Opening your locker…';
      restore(v).then(function () { location.replace('/play/my-clubhouse/?restored=1'); },
        function (err) { btn.disabled = false; msg.className = 'ck-msg ck-err'; msg.textContent = err.message || 'That key didn’t work.'; });
    });
  }

  window.gpKey = { prompt: prompt, status: status, statusCard: statusCard, restoreForm: restoreForm, wire: wire, sync: sync, fromLink: fromLink, restore: restore, make: make,
    addPasskey: addPasskey, unlock: unlock, passkeys: pkOk };
})();
