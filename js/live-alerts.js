/* Live alerts on the live leaderboards (/societies/live/ and /play/scorecard/live/).
   "Alert me" asks this browser for a push address and hands it to the alerts
   worker (/lv/push) with the alerts picked: a new leader, birdies (everyone's
   or just some golfers') and the final result. /sw.js shows them.
   iPhones only allow alerts for a site saved to the Home Screen, so on an
   iPhone in Safari the button explains that step first.
   Nothing personal is sent: the push address, the alert kinds and nicknames.
   This phone remembers which rounds it's following in localStorage. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var STORE = 'gpLvAlerts';
  var KINDS = [
    { id: 'lead', title: 'New leader', sub: 'When someone goes top on their own', short: 'new leader' },
    { id: 'birdie', title: 'Birdies and better', sub: 'Birdies, eagles and the odd hole-in-one', short: 'birdies' },
    { id: 'final', title: 'The final result', sub: 'Who won, the moment it’s in', short: 'final result' },
  ];
  var ua = navigator.userAgent || '';
  var ios = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var standalone = navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  var canPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  var needsHome = ios && !standalone && !canPush;
  var board = null, path = '', boxEl = null, prep = null, swReg = null, appKey = null;

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n) { try { if (window.gtag) window.gtag('event', n, {}); } catch (e) { /* fine */ } }
  function mine(code) { return (get(STORE, {}) || {})[code] || null; }
  function setMine(code, v) {
    var all = get(STORE, {}) || {}, cut = Date.now() - 3 * 86400000;
    Object.keys(all).forEach(function (k) { if (!all[k] || !(all[k].at > cut)) delete all[k]; });
    if (v) { v.at = Date.now(); all[code] = v; } else delete all[code];
    put(STORE, all);
  }
  function post(p, body) {
    return fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  function bytes(b64) {
    var t = b64.replace(/-/g, '+').replace(/_/g, '/'), s = atob(t + '==='.slice((t.length + 3) % 4)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function b64(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  var BELL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path></svg>';
  var TICK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

  function summary(m) {
    var bits = KINDS.filter(function (k) { return m.kinds.indexOf(k.id) >= 0; }).map(function (k) {
      return k.id === 'birdie' && m.who && m.who.length ? 'birdies for ' + m.who.join(', ') : k.short;
    });
    return bits.join(', ');
  }

  // The card on the board: off, on, or blocked.
  window.gpLiveAlerts = function (d, box, boardPath) {
    if (!box) return;
    board = d; path = boardPath; boxEl = box;
    var m = mine(d.code);
    if (d.status === 'final') { if (m) setMine(d.code, null); return; }
    if (!canPush && !needsHome) return;
    var h;
    if (canPush && Notification.permission === 'denied') {
      h = '<section class="lva-card lva-blocked"><b>Alerts are blocked on this phone</b><span>Allow notifications for golfpriceai.com in your browser’s settings (the padlock by the web address), then come back. The board still updates itself here.</span></section>';
    } else if (m && canPush) {
      h = '<section class="lva-card lva-on">' + TICK + '<span><b>Alerts on</b> · ' + esc(summary(m)) + '</span><button type="button" class="lva-link" id="lva-open">Change</button></section>';
    } else {
      h = '<section class="lva-card"><span class="lva-bell">' + BELL + '</span><span class="lva-txt"><b>Not at the course?</b><span>Get a buzz for a new leader, birdies and the result.</span></span><button type="button" class="lva-go" id="lva-open">Alert me</button></section>';
    }
    box.innerHTML = h;
    var b = document.getElementById('lva-open');
    if (b) b.onclick = function () { track('lv_alerts_open'); open(); };
  };

  function sheet(html, wire) {
    var old = document.querySelector('.lva-sheet'); if (old) old.remove();
    var m = document.createElement('div'); m.className = 'lv-modal lva-sheet';
    m.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="lva-h"><span class="lva-grab" aria-hidden="true"></span>' + html + '</div>';
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    document.body.appendChild(m); wire(m);
    var f = m.querySelector('button'); if (f) f.focus();
  }

  function open() {
    if (needsHome) return iphone();
    // Get the service worker and the key ready now, so the tap on
    // "Turn on alerts" can ask for permission straight away.
    if (!prep) prep = Promise.all([
      navigator.serviceWorker.register('/sw.js').then(function () { return navigator.serviceWorker.ready; }).then(function (r) { swReg = r; }),
      fetch(API + '/lv/pushkey').then(function (r) { return r.json(); }).then(function (j) { if (j.ok) appKey = j.key; }),
    ]).catch(function () { prep = null; });
    var d = board, m = mine(d.code), on = m ? m.kinds : ['lead', 'birdie', 'final'], who = m && m.who ? m.who : [];
    var some = who.length > 0, picked = {};
    who.forEach(function (n) { picked[n] = 1; });
    var nicks = d.rows.map(function (r) { return r.nick; });
    var h = '<h2 id="lva-h" class="lva-h">Live alerts for ' + esc(d.title) + '</h2>' +
      '<p class="lva-p">We’ll buzz this phone while the round is on. They stop by themselves once the result is in.</p>' +
      '<div class="lva-kinds">' + KINDS.map(function (k) {
        return '<label class="lva-kind"><span><b>' + k.title + '</b><small>' + k.sub + '</small></span><input type="checkbox" data-k="' + k.id + '"' + (on.indexOf(k.id) >= 0 ? ' checked' : '') + '></label>';
      }).join('') + '</div>' +
      '<div class="lva-whose" id="lva-whose"><b class="lva-sh">Whose birdies?</b><div class="lva-two"><button type="button" id="lva-all" aria-pressed="' + !some + '">Everyone</button><button type="button" id="lva-some" aria-pressed="' + some + '">Just my mates</button></div>' +
      '<div class="lva-chips" id="lva-chips"' + (some ? '' : ' hidden') + '>' + nicks.map(function (n) {
        return '<button type="button" class="lva-chip" aria-pressed="' + !!picked[n] + '" data-n="' + esc(n) + '">' + esc(n) + '</button>';
      }).join('') + '</div></div>' +
      '<p class="lva-msg" id="lva-msg" role="alert" hidden></p>' +
      '<button type="button" class="lva-go lva-big" id="lva-save">' + (m ? 'Save changes' : 'Turn on alerts') + '</button>' +
      (m ? '<button type="button" class="lva-off" id="lva-stop">Turn off alerts</button>' : '<button type="button" class="lva-off" id="lva-x">Not now</button>') +
      '<p class="lva-small">' + (m ? 'Alerts for this round only.' : 'Your phone will ask “Allow notifications?”. Tap Allow.') + ' No email, no sign-up: we keep only this phone’s alert address, and only until the result is in.</p>';
    sheet(h, function (el) {
      var msg = el.querySelector('#lva-msg'), save = el.querySelector('#lva-save');
      function say(t) { msg.textContent = t; msg.hidden = !t; }
      function paintWhose() {
        var bird = el.querySelector('[data-k="birdie"]').checked;
        el.querySelector('#lva-whose').hidden = !bird;
        el.querySelector('#lva-all').setAttribute('aria-pressed', String(!some));
        el.querySelector('#lva-some').setAttribute('aria-pressed', String(some));
        el.querySelector('#lva-chips').hidden = !some;
      }
      el.querySelectorAll('[data-k]').forEach(function (c) { c.onchange = paintWhose; });
      el.querySelector('#lva-all').onclick = function () { some = false; paintWhose(); };
      el.querySelector('#lva-some').onclick = function () { some = true; paintWhose(); };
      el.querySelectorAll('.lva-chip').forEach(function (c) {
        c.onclick = function () { var n = c.getAttribute('data-n'); if (picked[n]) delete picked[n]; else picked[n] = 1; c.setAttribute('aria-pressed', String(!!picked[n])); };
      });
      paintWhose();
      var x = el.querySelector('#lva-x'); if (x) x.onclick = function () { el.remove(); };
      var stop = el.querySelector('#lva-stop');
      if (stop) stop.onclick = function () {
        stop.disabled = true;
        post('/lv/unpush', { c: d.code, ep: m.ep }).catch(function () { /* it ends with the round anyway */ }).then(function () {
          setMine(d.code, null); el.remove(); track('lv_alerts_off'); window.gpLiveAlerts(board, boxEl, path);
        });
      };
      save.onclick = function () {
        var kinds = KINDS.map(function (k) { return k.id; }).filter(function (id) { return el.querySelector('[data-k="' + id + '"]').checked; });
        var whoNow = kinds.indexOf('birdie') >= 0 && some ? nicks.filter(function (n) { return picked[n]; }) : [];
        if (!kinds.length) return say('Pick at least one alert.');
        if (kinds.indexOf('birdie') >= 0 && some && !whoNow.length) return say('Tap at least one golfer, or pick Everyone.');
        say('');
        if (!swReg || !appKey) {
          save.disabled = true; save.textContent = 'One moment…';
          (prep || Promise.reject()).then(function () { save.disabled = false; save.textContent = m ? 'Save changes' : 'Turn on alerts'; if (swReg && appKey) save.click(); else say('No signal just now. Try again in a moment.'); },
            function () { save.disabled = false; save.textContent = m ? 'Save changes' : 'Turn on alerts'; say('No signal just now. Try again in a moment.'); });
          return;
        }
        save.disabled = true; save.textContent = 'Turning on…';
        // Straight from the tap: this is what shows "Allow notifications?".
        swReg.pushManager.getSubscription().then(function (s) {
          return s || swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(appKey) });
        }).then(function (s) {
          return post('/lv/push', { c: d.code, ep: s.endpoint, p256dh: b64(s.getKey('p256dh')), auth: b64(s.getKey('auth')), kinds: kinds, who: whoNow }).then(function (r) {
            if (!r.ok) { var er = new Error(r.error || 'Please try again.'); er.srv = true; throw er; }
            setMine(d.code, { kinds: kinds, who: whoNow, ep: s.endpoint });
            track(m ? 'lv_alerts_change' : 'lv_alerts_on');
            el.remove(); window.gpLiveAlerts(board, boxEl, path);
          });
        }).catch(function (e) {
          save.disabled = false; save.textContent = m ? 'Save changes' : 'Turn on alerts';
          if (Notification.permission === 'denied') { el.remove(); window.gpLiveAlerts(board, boxEl, path); return; }
          say(e && e.srv ? e.message : 'Alerts didn’t switch on that time. Tap Allow when your phone asks, then try again.');
        });
      };
    });
  }

  // iPhone: a Home Screen web app starts with empty storage. So before the
  // golfer saves the board, put a one-use hand-over code in its link: the
  // Home Screen copy swaps it for this phone's player id and saved fours, so
  // the organiser still sees their scorecard and "Finish the round" buttons.
  function handOver() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p) || /[?&]h=/.test(location.search)) return;
    var crews = ''; try { crews = localStorage.getItem('gpCrews') || ''; } catch (e) { /* fine */ }
    post('/lv/hand', { pid: p, crews: crews.length <= 6000 ? crews : '' }).then(function (r) {
      if (r.ok) history.replaceState(null, '', location.pathname + location.search + '&h=' + r.code + location.hash);
    }).catch(function () { /* they'll just be a follower on the Home Screen */ });
  }
  function takeOver() {
    var h = (location.search.match(/[?&]h=([a-z0-9]{12})/) || [])[1];
    if (!h) return;
    var clean = location.pathname + location.search.replace(/[?&]h=[a-z0-9]{12}/, '').replace(/^&/, '?') + location.hash;
    history.replaceState(null, '', clean);
    // Only a Home Screen copy with no player id of its own takes one over.
    if (!standalone || get('gpPid', '')) return;
    post('/lv/take', { h: h }).then(function (r) {
      if (!r.ok || !/^[a-z0-9]{12,32}$/.test(r.pid || '')) return;
      put('gpPid', r.pid);
      if (r.crews) { try { JSON.parse(r.crews); localStorage.setItem('gpCrews', r.crews); } catch (e) { /* skip */ } }
      track('lv_alerts_handover');
      location.replace(clean);
    }).catch(function () { /* fine */ });
  }
  takeOver();

  function iphone() {
    track('lv_alerts_ios');
    handOver();
    sheet('<span class="lva-kick">ON AN IPHONE</span><h2 id="lva-h" class="lva-h">One quick step first</h2>' +
      '<p class="lva-p">iPhones only send alerts to sites saved on the Home Screen. It takes ten seconds and you’ll land straight back on this board.</p>' +
      '<ol class="lva-steps"><li><b>1</b><span>Tap Share at the bottom of Safari (the square with an arrow).</span></li><li><b>2</b><span>Choose “Add to Home Screen”, then Add.</span></li><li><b>3</b><span>Open GolfPrice AI from your Home Screen and tap Alert me.</span></li></ol>' +
      '<button type="button" class="lva-go lva-big lva-dark" id="lva-x">Got it</button>' +
      '<p class="lva-small">Android phones and computers skip this step: they ask straight away. Needs iOS 16.4 or newer.</p>', function (el) {
      el.querySelector('#lva-x').onclick = function () { el.remove(); };
    });
  }
})();
