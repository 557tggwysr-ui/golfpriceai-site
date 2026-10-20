/* GolfPrice AI: Leagues landing page (/play/leagues/). Start a league in one
   step, or see the ones you're in. Leagues cover Par Price and the Bag Draft.
   Uses this browser's random player id (gpPid) and the nickname you choose. */
(function () {
  'use strict';
  var mineEl = document.getElementById('lh-mine');
  var form = document.getElementById('lh-form');
  if (!form) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n) { if (window.gtag) window.gtag('event', n); }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); });
  }
  function invite(id, name, nick) {
    var text = (nick || 'Someone') + ' has started a golf league: ' + name + '. Par Price every day, the Bag Draft every month. Loser buys the first round? https://golfpriceai.com/play/league/?l=' + id;
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    track('league_invite_landing');
  }

  var nickIn = form.querySelector('[name=nick]');
  if (!nickIn.value) nickIn.value = get('gpNick', '');
  api('/pp/my?pid=' + pid()).then(function (d) {
    var mine = (d && d.leagues) || [];
    if (!mine.length) return;
    mineEl.hidden = false;
    mineEl.querySelector('ul').innerHTML = mine.map(function (l) {
      return '<li><a href="/play/league/?l=' + l.id + '"><b>' + esc(l.name) + '</b><span>' + l.size + (l.size === 1 ? ' golfer' : ' golfers') + ' · See the table</span></a></li>';
    }).join('');
  }).catch(function () {});

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = form.querySelector('.pr-msg'), btn = form.querySelector('button');
    var name = form.querySelector('[name=lname]').value, nick = nickIn.value;
    btn.disabled = true; msg.textContent = 'Setting up the first tee…';
    api('/pp/league/create', { pid: pid(), name: name, nick: nick }).then(function (r) {
      btn.disabled = false;
      if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
      put('gpNick', nick); track('league_create_landing');
      var box = document.getElementById('lh-start');
      box.innerHTML = '<span class="ch-kicker">League started</span><h2>' + esc(r.name) + '</h2>' +
        '<p>Step 2: get the others in. One link, straight to the group chat. They pick a nickname and they’re on the table.</p>' +
        '<button type="button" class="gp-af-btn pr-invite">Send the invite</button>' +
        '<p class="pr-lg-small">Then play today’s round to post the first score. The pressure’s on everyone else.</p>' +
        '<p class="lh-next"><a class="gp-af-btn lh-play" href="/play/par-price/?utm_source=leagues">Play today’s Par Price</a><a href="/play/league/?l=' + r.id + '">See your league table</a></p>';
      box.querySelector('.pr-invite').addEventListener('click', function () { invite(r.id, r.name, nick); });
    }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
  });
})();
