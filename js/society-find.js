/* GolfPrice AI: Find a Society (/societies/find/) and each society's own page
   (/societies/find/<name>-<id>/).

   Find: the listing is built into the page (#fd-data), so it works without
   the network. "Use my location" asks the phone for its position and works
   out distances here, on the phone: the position is never sent anywhere. A
   town or postcode typed in is looked up with postcodes.io (free, no key).
   Distances are from each society's home course.

   Society pages: "Ask to join" (or ask for a spare place on one golf day)
   sends a nickname and an optional note to the organiser's Society HQ. The
   answer shows on the society's page, and in My Clubhouse. No email, no phone
   number. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
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
    body.pid = pid();
    return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json(); });
  }
  var DAYS = { sat: 'Saturdays', sun: 'Sundays', wkend: 'Weekends', wkday: 'Weekdays', mix: 'Weekdays and weekends' };
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function nice(iso) { var d = new Date(iso + 'T12:00:00'); return WD[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }
  function miles(a, b, c, d) {
    var r = Math.PI / 180, h = Math.pow(Math.sin((c - a) * r / 2), 2) + Math.cos(a * r) * Math.cos(c * r) * Math.pow(Math.sin((d - b) * r / 2), 2);
    return 3959 * 2 * Math.asin(Math.sqrt(h));
  }

  /* ------------------------------------------------------------ the Find page */
  var box = $('fd'), dataEl = $('fd-data');
  if (box && dataEl) {
    var all = [];
    try { all = JSON.parse(dataEl.textContent) || []; } catch (e) { all = []; }
    var here = null, words = '', filters = {}, msg = $('fd-msg'), head = $('fd-h');
    var card = function (s) {
      var bits = [s.course ? 'Home course ' + s.course : [s.area, s.county && s.county !== s.area ? s.county : ''].filter(Boolean).join(', ') || 'UK', s.members + (s.members === 1 ? ' member' : ' members')].concat(DAYS[s.days] ? [DAYS[s.days]] : []);
      var badges = (s.founding ? '<span class="fd-badge fd-b-found">Founding No. ' + s.founding + '</span>' : '') + (s.league ? '<span class="fd-badge fd-b-lg">League: ' + esc(s.league.region) + ' Div ' + s.league.division + '</span>' : '') + (s.ability === 'beg' ? '<span class="fd-badge fd-b-beg">Beginners welcome</span>' : '');
      var sp = s.spare && s.spare[0] ? '<span class="fd-spare">' + s.spare[0].spare + (s.spare[0].spare === 1 ? ' spare place' : ' spare places') + ' · ' + nice(s.spare[0].day) + '</span>' : '';
      return '<a class="soc-card fd-card" href="' + esc(s.url) + '"><div class="fd-card-top"><h2>' + esc(s.name) + '</h2>' + (s.d != null && s.d < 900 ? '<span class="fd-dist">' + (s.d < 10 ? s.d.toFixed(1) : Math.round(s.d)) + ' mi</span>' : '') + '</div>' +
        '<span class="fd-meta">' + esc(bits.join(' · ')) + '</span>' + (badges ? '<span class="fd-badges">' + badges + '</span>' : '') + (s.about ? '<p>' + esc(s.about) + '</p>' : '') +
        (s.cost ? '<span class="fd-cost">Usually ' + esc(s.cost) + ' a golf day</span>' : '') + sp + '<span class="fd-go">Have a look →</span></a>';
    };
    var show = function () {
      var r = Number($('fd-r').value) || 25;
      var list = all.map(function (s) { var c = Object.assign({}, s); c.d = here && s.lat != null ? miles(here.lat, here.lon, s.lat, s.lon) : null; return c; });
      if (here) list = list.filter(function (s) { return s.d != null && s.d <= r; }).sort(function (a, b) { return a.d - b.d; });
      else if (words) list = list.filter(function (s) { return (s.name + ' ' + s.area + ' ' + s.county + ' ' + s.town + ' ' + s.course + ' ' + (s.about || '')).toLowerCase().indexOf(words) >= 0; });
      if (filters.wkend) list = list.filter(function (s) { return ['sat', 'sun', 'wkend', 'mix'].indexOf(s.days) >= 0; });
      if (filters.wkday) list = list.filter(function (s) { return ['wkday', 'mix'].indexOf(s.days) >= 0; });
      if (filters.beg) list = list.filter(function (s) { return s.ability === 'beg' || s.ability === 'all'; });
      if (filters.nohcp) list = list.filter(function (s) { return s.ability !== 'hcp'; });
      if (filters.spare) list = list.filter(function (s) { return s.spare && s.spare.length; });
      head.textContent = here ? list.length + (list.length === 1 ? ' golf society' : ' golf societies') + (r < 999 ? ' within ' + r + ' miles' : '') + (here.label ? ' of ' + here.label : '') :
        'Golf societies open to new members (' + list.length + ')';
      box.innerHTML = list.length ? '<div class="fd-list">' + list.map(card).join('') + '</div>' :
        '<div class="soc-card"><p class="soc-help">' + (all.length ? 'No listed golf societies match yet' + (here && r < 999 ? ' within ' + r + ' miles. Try a bigger distance, or ' : '. Try ') + 'fewer filters. Or <a href="/societies/guides/how-to-start-a-golf-society/">start your own</a>: four mates and a WhatsApp group is all it takes.' : 'No golf societies are listed yet. Run one? Be the first: it’s free.') + '</p></div>';
    };
    var say = function (t) { if (msg) msg.textContent = t || ''; };
    $('fd-loc').addEventListener('click', function () {
      if (!navigator.geolocation) { say('This browser can’t share its location. Type a town or postcode instead.'); return; }
      say('Finding you…');
      navigator.geolocation.getCurrentPosition(function (p) {
        here = { lat: p.coords.latitude, lon: p.coords.longitude, label: '' }; words = ''; say('Showing golf societies near you.'); show();
        track('find_society_near', { how: 'location' });
      }, function () { say('No luck finding you. Type a town or postcode instead.'); }, { timeout: 10000, maximumAge: 600000 });
    });
    var PC = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i, OUT = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
    $('fd-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var t = $('fd-q').value.trim();
      if (!t) { here = null; words = ''; say(''); show(); return; }
      var url = PC.test(t) ? 'https://api.postcodes.io/postcodes/' + encodeURIComponent(t) : OUT.test(t) ? 'https://api.postcodes.io/outcodes/' + encodeURIComponent(t) : 'https://api.postcodes.io/places?limit=1&q=' + encodeURIComponent(t);
      say('Looking up ' + t + '…');
      fetch(url).then(function (r) { return r.json(); }).then(function (d) {
        var x = d && d.result && (Array.isArray(d.result) ? d.result[0] : d.result);
        if (x && x.latitude != null) { here = { lat: x.latitude, lon: x.longitude, label: x.name_1 || t.toUpperCase() }; words = ''; say(''); track('find_society_near', { how: 'typed' }); }
        else { here = null; words = t.toLowerCase(); say('We couldn’t place “' + t + '” on the map, so here are societies that mention it.'); }
        show();
      }).catch(function () { here = null; words = t.toLowerCase(); say(''); show(); });
    });
    $('fd-r').addEventListener('change', show);
    document.querySelectorAll('.fd-f').forEach(function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-f'); filters[k] = !filters[k]; b.setAttribute('aria-pressed', String(!!filters[k])); show(); });
    });
    // Fresh numbers (members, spare places) between builds.
    fetch(API + '/soc/find').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.societies) return;
      var urls = {}; all.forEach(function (s) { urls[s.id] = s.url; });
      var fresh = d.societies.filter(function (s) { return urls[s.id]; }).map(function (s) { s.url = urls[s.id]; return s; });
      if (fresh.length) { all = fresh; if (here || words || Object.keys(filters).length) show(); }
    }).catch(function () {});
  }

  /* ------------------------------------------------------------ a society's own page: Ask to join */
  var page = document.querySelector('.fd-soc');
  if (!page) return;
  var sid = page.getAttribute('data-s'), sname = page.getAttribute('data-name'), status = $('fd-status');
  function setStatus(t, ok) { if (!status) return; status.hidden = !t; status.innerHTML = t; status.style.color = ok ? '#8fd97c' : '#fff'; }
  // Already asked, or already in?
  fetch(API + '/soc/asks?pid=' + pid()).then(function (r) { return r.json(); }).then(function (d) {
    var mine = ((d && d.asks) || []).filter(function (a) { return a.s === sid; })[0];
    if (!mine) return;
    if (mine.status === 'new') setStatus('Request sent' + (mine.day ? ' for ' + nice(mine.day) : '') + '. The organiser will say yes or no in Society HQ: check back here.');
    else if (mine.status === 'yes') setStatus('You’re in! <a href="/societies/hq/?s=' + esc(sid) + '" style="color:#8fd97c">Open ' + esc(sname) + ' in Society HQ →</a>', true);
    else setStatus('The organiser said not this time. Plenty more societies on <a href="/societies/find/" style="color:#8fd97c">Find a Society</a>.');
  }).catch(function () {});

  function ask(eid, day) {
    var old = document.querySelector('.fd-ask-back'); if (old) old.remove();
    var back = document.createElement('div'); back.className = 'fd-ask-back';
    back.innerHTML = '<div class="fd-ask-panel" role="dialog" aria-modal="true" aria-labelledby="fd-ask-h"><div class="fd-ask-top"><span class="soc-kick fd-kick-l">' + (eid ? 'Ask for a spare place' : 'Ask to join') + '</span>' +
      '<b id="fd-ask-h">' + esc(sname) + '</b><span>The organiser sees your nickname and note in Society HQ. If it’s a yes, you’ll see it on this page, and in My Clubhouse.</span></div>' +
      '<form novalidate><label>Your nickname<input name="nick" maxlength="20" required value="' + esc(get('gpNick', '')) + '" autocomplete="nickname"></label>' +
      '<label>A line about you (optional)<textarea name="note" rows="3" maxlength="200" placeholder="e.g. Off 18, play most Saturdays, just moved to the area."></textarea></label>' +
      (eid ? '<p class="soc-help">Asking for a spare place on <b>' + esc(day) + '</b>. If it’s a yes, you’re in the society and down to play that day.</p>' : '') +
      '<p class="soc-msg" role="status"></p><button type="submit" class="soc-btn">Send my request</button><button type="button" class="soc-x fd-ask-x">Cancel</button>' +
      '<p class="soc-small">No email, no phone number. Join from your usual phone, not a private tab, so the answer finds you.</p></form></div>';
    document.body.appendChild(back);
    var f = back.querySelector('form'), m = f.querySelector('.soc-msg');
    var close = function () { back.remove(); };
    back.querySelector('.fd-ask-x').onclick = close;
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var b = f.querySelector('[type=submit]'); b.disabled = true; m.textContent = 'Sending…';
      post('/soc/ask', { s: sid, e: eid || '', nick: f.nick.value, note: f.note.value }).then(function (r) {
        b.disabled = false;
        if (!r.ok) { m.textContent = r.error || 'Something went wrong.'; if (r.member) location.href = '/societies/hq/?s=' + sid; return; }
        put('gpNick', f.nick.value.trim());
        var asks = get('gpAsks', []).filter(function (x) { return x.s !== sid; }); asks.unshift({ s: sid, name: sname, url: location.pathname }); put('gpAsks', asks.slice(0, 10));
        track('society_ask', { spare: !!eid });
        close(); setStatus('Request sent' + (day ? ' for ' + esc(day) : '') + '. The organiser will say yes or no in Society HQ: check back here.');
      }).catch(function () { b.disabled = false; m.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
    setTimeout(function () { f.nick.focus(); }, 30);
  }
  document.querySelectorAll('.fd-ask').forEach(function (b) {
    b.addEventListener('click', function () { ask(b.getAttribute('data-e'), b.getAttribute('data-day')); });
  });
})();
