/* GolfPrice AI: Society HQ, the society's own page (/societies/hq/?s=<id>).
   No ?s: start a society (the organiser picks a nickname too) or open one this
   phone already belongs to. ?s=<id>: join with a nickname, then the season's
   fixtures, who's in / maybe / out, the waiting list, the organiser's paid
   ticks, a "Pay the organiser" button (the organiser's own PayPal / Monzo /
   Revolut link: no money ever passes through us), the "final numbers"
   message for the WhatsApp group and a prize fund calculator.
   Money Sorted (Nov 2026): pay to confirm (In, then "I've paid", then Paid),
   a payment reference for everyone, "Chase the unpaid", a drop-out rule per
   fixture and a season kitty (the organiser's record of credit and what's
   owed). We still never take, hold or move any money.
   Talks to the alerts worker (/soc/...). Player ids stay private: everyone
   else is a nickname and a random member key. */
(function () {
  'use strict';
  var box = document.getElementById('hq');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { n = Number(n) || 0; return '£' + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
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
    if (body) body.pid = pid();
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function shareText(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function remember(id, name) {
    var l = get('gpSocs', []).filter(function (x) { return x.id !== id; });
    l.unshift({ id: id, name: name }); put('gpSocs', l.slice(0, 10));
  }
  // The Clubhouse key (js/clubhouse-key.js): offered once when someone starts or
  // joins a society, and as a strip on the society page until it's saved.
  function keyPrompt(kick, why, done, after, always) {
    var k = window.gpKey;
    if (!k || k.status().saved || (!always && get('gpKeyLater', '') === new Date().toISOString().slice(0, 10))) { if (after) after(); return; }
    k.prompt({ kick: kick, why: why, done: done, after: after });
  }
  function gpUseCo() { try { fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: 'co_set' }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function copyText(t, btn) {
    var done = function () { if (btn) { var o = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = o; }, 1600); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { window.prompt('Copy this:', t); });
    else window.prompt('Copy this:', t);
  }
  function forget(id) { put('gpSocs', get('gpSocs', []).filter(function (x) { return x.id !== id; })); }
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function nice(iso, long) {
    if (!iso) return '';
    var d = new Date(iso + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short' });
  }
  var PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/society-hq-wide.jpg"><img src="/assets/photos/tools/society-hq-banner.jpg" alt="" width="1536" height="512"></picture>';
  var COUNTIES = ["Bedfordshire", "Berkshire", "Bristol", "Buckinghamshire", "Cambridgeshire", "Cheshire", "Cornwall", "Cumbria", "Derbyshire", "Devon", "Dorset", "Durham", "Essex", "Gloucestershire", "Greater London", "Greater Manchester", "Hampshire", "Herefordshire", "Hertfordshire", "Isle of Wight", "Kent", "Lancashire", "Leicestershire", "Lincolnshire", "Merseyside", "Norfolk", "Northamptonshire", "Northumberland", "Nottinghamshire", "Oxfordshire", "Rutland", "Shropshire", "Somerset", "Staffordshire", "Suffolk", "Surrey", "East Sussex", "West Sussex", "Tyne and Wear", "Warwickshire", "West Midlands", "Wiltshire", "Worcestershire", "Yorkshire", "Aberdeenshire", "Angus and Dundee", "Ayrshire and Arran", "Dumfries and Galloway", "Edinburgh and the Lothians", "Fife", "Glasgow and Clyde", "Highlands and Islands", "Perth and Kinross", "Scottish Borders", "Stirling and Central Scotland", "North Wales", "Mid Wales", "South Wales", "West Wales", "Northern Ireland", "Channel Islands", "Isle of Man"];
  var sid = (location.search.match(/[?&]s=([a-z0-9]{8})/i) || [])[1];
  // From a poll: back to it after joining (?poll=), or a fixture made from its winner (?fix=1&venue=…&day=…).
  var QS = new URLSearchParams(location.search), BACK_POLL = /^[a-z0-9]{8}$/.test(QS.get('poll') || '') ? QS.get('poll') : '';
  var FIX = QS.get('fix') ? { title: '', venue: (QS.get('venue') || '').slice(0, 60), day: /^\d{4}-\d{2}-\d{2}$/.test(QS.get('day') || '') ? QS.get('day') : '' } : null;
  var S = null, open = {};

  /* ---------------------------------------------------------------- start a society */
  function start() {
    var mine = get('gpSocs', []);
    box.innerHTML = '<section class="soc-hero">' + PHOTO + '<span class="soc-kick">Free · Society HQ</span><h1>Run your golf society free</h1>' +
      '<p>Fixtures, sign-ups, who’s paid and a waiting list that sorts itself, all from one link in your golf society’s WhatsApp group. No sign-up, no fees.</p></section>' +
      (mine.length ? '<section class="soc-card"><h2>Your societies</h2><ul class="soc-mine">' + mine.map(function (m) { return '<li><a href="?s=' + esc(m.id) + '">' + esc(m.name) + '</a></li>'; }).join('') + '</ul></section>' : '') +
      '<form class="soc-card" id="hq-new" novalidate><h2>Start your golf society</h2>' + fields({}) +
      '<label>Your nickname<input name="nick" maxlength="20" required placeholder="What the society calls you"></label>' +
      '<p class="soc-msg" role="status"></p><button type="submit" class="soc-btn">Start the society →</button>' +
      '<p class="soc-small">Looking for a society to join? <a href="/societies/find/">Find a Society</a></p></form>';
    var f = box.querySelector('#hq-new');
    coursePicker(f);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn'), body = read(f);
      body.nick = f.nick.value;
      btn.disabled = true; msg.textContent = 'Booking the tee times…';
      api('/soc/new', body).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        remember(r.id, body.name.trim()); track('society_started');
        var go = function () { location.href = '?s=' + r.id; };
        keyPrompt('SOCIETY HQ · ONE LAST THING', 'It’s how you get ' + body.name.trim() + ' back on a new phone, or if your browser forgets you. No email, no password to remember. Just keep it somewhere safe.', 'Done, take me to my society', go, true);
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }
  function fields(d) {
    return '<label>Society name<input name="name" maxlength="40" required value="' + esc(d.name || '') + '" placeholder="The Sunday Slicers"></label>' +
      '<div class="soc-two"><label>Town or area<input name="area" maxlength="40" value="' + esc(d.area || '') + '" placeholder="e.g. Leeds"></label>' +
      '<label>County<select name="county"><option value="">Choose…</option>' + COUNTIES.map(function (c) { return '<option' + (d.county === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></label></div>' +
      '<label>About the society (optional)<input name="about" maxlength="240" value="' + esc(d.about || '') + '" placeholder="e.g. Monthly Stableford, all handicaps, one tour a year"></label>' +
      '<label>Your payment link (optional)<input name="pay" maxlength="120" inputmode="url" value="' + esc(d.pay || '') + '" placeholder="https://monzo.me/yourname"></label>' +
      '<p class="soc-small">Your own PayPal.me, Monzo.me or Revolut.me link. Members tap “Pay the organiser” and pay you directly; we never see the money.</p>' +
      '<label>How to pay (optional)<input name="paynote" maxlength="140" value="' + esc(d.paynote || '') + '" placeholder="e.g. Bank transfer to M Smith, ask me for the details"></label>' +
      '<p class="soc-small">Shown to members next to their payment reference. Anyone with your society’s link can join and see it, so only put what you’d put in the WhatsApp group.</p>' +
      '<div class="hq-course"><label>Home course (for Find a Society distances)<input name="cq" autocomplete="off" value="' + esc(d.cname ? d.cname + (d.ctown ? ', ' + d.ctown : '') : '') + '" placeholder="Start typing a course or town"></label>' +
      '<input type="hidden" name="course" value="' + esc(d.course || '') + '"><input type="hidden" name="cname" value="' + esc(d.cname || '') + '"><input type="hidden" name="ctown" value="' + esc(d.ctown || '') + '">' +
      '<input type="hidden" name="lat" value="' + esc(d.lat == null ? '' : d.lat) + '"><input type="hidden" name="lon" value="' + esc(d.lon == null ? '' : d.lon) + '"><div class="hq-cpick" hidden></div></div>' +
      '<div class="soc-two"><label>When you play<select name="days">' + [['', 'Choose…'], ['sat', 'Saturdays'], ['sun', 'Sundays'], ['wkend', 'Weekends'], ['wkday', 'Weekdays'], ['mix', 'Weekdays and weekends']].map(function (o) { return '<option value="' + o[0] + '"' + (d.days === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Who it suits<select name="ability">' + [['', 'Choose…'], ['all', 'All abilities'], ['beg', 'Beginners welcome'], ['hcp', 'Official handicap needed']].map(function (o) { return '<option value="' + o[0] + '"' + (d.ability === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<label>A golf day usually costs (optional)<input name="cost" maxlength="24" value="' + esc(d.cost || '') + '" placeholder="e.g. £45 to £60"></label>' +
      '<label class="soc-check"><input type="checkbox" name="open"' + (d.open ? ' checked' : '') + '> Open to new members: list us in Find a Society, so golfers nearby can ask to join (we show the name, area, home course, description and any spare places you choose; never members)</label>';
  }
  function read(f) {
    return { name: f.name.value, area: f.area.value, county: f.county.value, about: f.about.value, pay: f.pay.value.trim(), paynote: f.paynote.value.trim(), open: f.open.checked,
      course: f.course.value, cname: f.cname.value, ctown: f.ctown.value, lat: f.lat.value, lon: f.lon.value, days: f.days.value, ability: f.ability.value, cost: f.cost.value };
  }
  // Home course picker: the UK course list (OpenStreetMap), searched by course or town.
  var COURSES = null;
  function coursePicker(f) {
    var q = f.querySelector('[name=cq]'), pick = f.querySelector('.hq-cpick');
    if (!q) return;
    var load = function () { if (!COURSES) COURSES = fetch('/data/courses/uk.json').then(function (r) { return r.json(); }).then(function (d) { return d.courses || []; }).catch(function () { return []; }); return COURSES; };
    q.addEventListener('focus', load);
    q.addEventListener('input', function () {
      var t = q.value.trim().toLowerCase();
      ['course', 'cname', 'ctown', 'lat', 'lon'].forEach(function (k) { f[k].value = ''; });
      if (t.length < 3) { pick.hidden = true; return; }
      load().then(function (list) {
        var hits = list.filter(function (c) { return (c.n + ' ' + (c.t || '')).toLowerCase().indexOf(t) >= 0; }).slice(0, 8);
        pick.innerHTML = hits.length ? hits.map(function (c, i) { return '<button type="button" data-i="' + i + '"><b>' + esc(c.n) + '</b><span>' + esc(c.t || '') + '</span></button>'; }).join('') : '<p class="soc-small">No match yet. Try the town instead.</p>';
        pick.hidden = false;
        pick.querySelectorAll('button').forEach(function (b) {
          b.onclick = function () { var c = hits[+b.getAttribute('data-i')]; f.course.value = c.id; f.cname.value = c.n; f.ctown.value = c.t || ''; f.lat.value = c.lat; f.lon.value = c.lon; q.value = c.n + (c.t ? ', ' + c.t : ''); pick.hidden = true; };
        });
      });
    });
  }

  /* ---------------------------------------------------------------- join */
  function join() {
    box.innerHTML = '<section class="soc-hero">' + PHOTO + (S.founding ? '<span class="soc-found">Founding Society · No. ' + S.founding + '</span>' : '') + '<span class="soc-kick">' + esc(S.area || 'Golf society') + ' · ' + S.count + (S.count === 1 ? ' member' : ' members') + '</span><h1>' + esc(S.name) + '</h1>' +
      (S.about ? '<p>' + esc(S.about) + '</p>' : '') + '</section>' +
      '<form class="soc-card" id="hq-join" novalidate><h2>Join the society</h2><p class="soc-help">Pick the nickname your society knows you by. No email, no sign-up.</p>' +
      '<label>Your nickname<input name="nick" maxlength="20" required></label><p class="soc-msg" role="status"></p>' +
      '<button type="submit" class="soc-btn">Join ' + esc(S.name) + '</button>' +
      '<p class="soc-small">Join on your usual phone, not a private tab: there’s no login, so a private tab forgets you when it closes.</p></form>';
    var f = box.querySelector('#hq-join');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn');
      btn.disabled = true; msg.textContent = 'Signing you in at the starter’s hut…';
      api('/soc/join', { s: sid, nick: f.nick.value }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
        remember(sid, S.name); track('society_joined');
        if (BACK_POLL) { location.href = '/societies/poll/?p=' + BACK_POLL; return; }
        load().then(function () { keyPrompt('YOU’RE IN', 'It keeps your place in ' + S.name + ' (your sign-ups and who’s paid) if you change phones or your browser forgets you. No email, no password.', 'Done', null, false); });
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }

  /* ---------------------------------------------------------------- the society page */
  function counts(e) {
    var c = { in: 0, maybe: 0, out: 0, wait: 0, paid: 0, says: 0 };
    e.entries.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; if (x.status === 'in' && x.paid) c.paid++; if (x.status === 'in' && !x.paid && saysPaid(x)) c.says++; });
    return c;
  }
  function payLink(amount, ref) {
    if (!S.pay) return '';
    var p = S.pay.replace(/\/+$/, '');
    if (amount > 0 && /(paypal\.me|monzo\.me)\/[^\/]+$/.test(p)) p += '/' + (amount % 1 ? amount.toFixed(2) : amount);
    if (ref && /monzo\.me\//.test(p)) p += '?d=' + encodeURIComponent(ref);
    return p;
  }
  /* ---- Money Sorted */
  // Who to chase: in, not paid, hasn't said they've paid, and not the organiser reading this.
  function chaseList(e) { return e.entries.filter(function (x) { return x.status === 'in' && !x.paid && !saysPaid(x) && x.m !== S.you; }).map(function (x) { return x.nick; }); }
  function saysPaid(x) { return !!x.claim && x.claim !== 'no'; }
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  // A payment reference for each member and day, e.g. SWING-22NOV-MO: short enough for any bank (18 characters).
  function payRef(e, nick) {
    var words = String(S.name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(function (w) { return w && ['THE', 'GOLF', 'SOCIETY', 'GS'].indexOf(w) < 0; });
    var soc = (words[0] || 'GOLF').slice(0, 5);
    var d = e.day ? +e.day.slice(8, 10) + MON[+e.day.slice(5, 7) - 1] : '';
    var who = String(nick || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'ME';
    return [soc, d, who].filter(Boolean).join('-');
  }
  function kittyOf(mk) {
    var b = 0; (S.kitty || []).forEach(function (k) { if (k.m === mk) b += Number(k.amount) || 0; });
    return Math.round(b * 100) / 100;
  }
  function dropLine(e, mk) { return (S.kitty || []).filter(function (k) { return k.m === mk && k.event === e.id && /^(drop|held|filled|refund)$/.test(k.kind); })[0] || null; }
  function afterNumbers(e) { var t = new Date().toISOString().slice(0, 10); return !!(e.droprule && e.deadline && t > e.deadline); }
  function payBox(e, mine) {
    var ref = payRef(e, mine.nick), h = '<div class="ms-pay"><div class="ms-pay-h"><b>Pay ' + (e.entry ? money(e.entry) : 'the organiser') + '</b><span>Your place is confirmed once the organiser has your money.</span></div>';
    if (S.pay) h += '<a class="soc-btn hq-pay" href="' + esc(payLink(e.entry, ref)) + '" target="_blank" rel="noopener">Pay the organiser' + (e.entry ? ' ' + money(e.entry) : '') + '</a>';
    if (S.paynote) h += '<p class="ms-paynote">' + esc(S.paynote) + '</p>';
    h += '<div class="ms-ref"><span>Use this reference</span><b>' + esc(ref) + '</b><button type="button" class="ms-copy" data-ref="' + esc(ref) + '">Copy</button></div>';
    if (mine.claim === 'no') h += '<p class="hq-note">The organiser hasn’t found your payment yet. Check you used the reference above, then tap again once it’s gone.</p>';
    if (saysPaid(mine)) h += '<p class="hq-note is-good">Thanks. The organiser will check it and confirm your place.</p><button type="button" class="soc-link ms-ipaid" data-on="0">I haven’t paid yet</button>';
    else h += '<button type="button" class="soc-btn2 ms-ipaid" data-on="1">I’ve paid</button>';
    return h + '</div>';
  }
  function eventCard(e, past) {
    var c = counts(e), mine = e.entries.filter(function (x) { return x.m === S.you; })[0], st = mine ? mine.status : '';
    var link = SITE + '/societies/hq/?s=' + S.id;
    var h = '<article class="hq-ev' + (past ? ' is-past' : '') + '" data-e="' + esc(e.id) + '">' +
      '<div class="hq-ev-h"><div><b class="hq-ev-t">' + esc(e.title) + '</b><span class="hq-ev-m">' + esc(nice(e.day, true)) + (e.tee ? ' · first tee ' + esc(e.tee) : '') + (e.venue ? ' · ' + esc(e.venue) : '') + '</span>' +
      (e.entry ? '<span class="hq-ev-m">' + money(e.entry) + ' entry' + (e.cap ? ' · ' + e.cap + ' places' : '') + '</span>' : e.cap ? '<span class="hq-ev-m">' + e.cap + ' places</span>' : '') + '</div></div>' +
      '<div class="hq-counts"><span class="is-in"><b>' + c.in + '</b>In</span><span><b>' + c.maybe + '</b>Maybe</span><span><b>' + c.out + '</b>Out</span>' + (e.cap ? '<span class="is-wait"><b>' + c.wait + '</b>Waiting</span>' : '') + '</div>';
    if (!past) {
      h += '<div class="hq-rsvp" role="group" aria-label="Are you playing?">' +
        [['in', 'I’m in'], ['maybe', 'Maybe'], ['out', 'Can’t make it']].map(function (o) { return '<button type="button" data-st="' + o[0] + '" aria-pressed="' + (st === o[0] || (o[0] === 'in' && st === 'wait')) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        (st === 'wait' ? '<p class="hq-note">You’re on the waiting list. If someone drops out, you move up automatically.</p>' : '') +
        (open['drop-' + e.id] ? '<div class="hq-note ms-dropask"><b>Numbers have gone to the club.</b> If you drop out now you still owe your ' + money(e.entry) + ', unless someone takes your place.' +
          '<div class="soc-btns"><button type="button" class="soc-btn2 ms-dropgo">Drop out anyway</button><button type="button" class="soc-link ms-dropno">Keep my place</button></div></div>' : '') +
        (st === 'in' && mine && !mine.paid && (e.entry > 0 || S.pay) ? payBox(e, mine) : '') +
        (st === 'in' && mine && mine.paid ? '<p class="hq-note is-good">' + (mine.via === 'kitty' ? 'Paid from your credit and confirmed.' : 'Paid and confirmed.') + ' See you on the first tee.</p>' : '') +
        (st === 'in' && e.droprule && e.deadline && !afterNumbers(e) ? '<p class="soc-small ms-rule">Drop-out rule: numbers go to the club on ' + esc(nice(e.deadline, true)) + '. Drop out after that and you still owe your ' + money(e.entry) + ' unless someone takes your place.</p>' : '') +
        (function () { var d = mine && st !== 'in' ? dropLine(e, S.you) : null; return d ? '<p class="hq-note' + (d.amount >= 0 && d.kind !== 'drop' ? ' is-good' : '') + '">' + esc(d.note) + (d.amount ? ' (' + (d.amount > 0 ? '+' : '−') + money(Math.abs(d.amount)) + ' in your kitty)' : '') + '.</p>' : ''; })();
    }
    h += '<button type="button" class="hq-more" aria-expanded="' + !!open[e.id] + '">' + (open[e.id] ? 'Hide who’s playing' : 'Who’s playing') + (S.organiser ? ' and who’s paid' : '') + '</button>';
    if (open[e.id]) h += whoList(e, c, past);
    if (S.organiser && !past) {
      if (c.says) h += '<p class="hq-note ms-says"><b>' + c.says + (c.says === 1 ? ' member says they’ve' : ' members say they’ve') + ' paid.</b> Check your bank app, then confirm them under “Who’s playing”.</p>';
      h += '<div class="hq-org"><button type="button" class="soc-btn2 hq-share">Send the sign-up link</button>' +
        (chaseList(e).length && e.entry > 0 ? '<button type="button" class="soc-btn2 ms-chase">Chase the unpaid (' + chaseList(e).length + ')</button>' : '') +
        (c.in ? '<button type="button" class="soc-btn2 hq-final">Final numbers message</button>' : '') +
        '<button type="button" class="soc-btn2 hq-edit">Edit</button></div>';
    } else if (!past) h += '<button type="button" class="soc-link hq-share">Send the sign-up link to someone</button>';
    h += liveLinks(e, past);
    h += fgLinks(e, past);
    if (open['res-' + e.id]) h += resultsForm(e);
    return h + '</article>';
  }
  /* ---- Live scoring: a scorecard per group and a live leaderboard (js/live-setup.js) */
  function liveLinks(e, past) {
    var today = new Date().toISOString().slice(0, 10);
    if (!e.live && (!S.organiser || e.day < today)) return '';
    var h = '<div class="hq-fg"><span class="hq-fg-k">LIVE SCORING</span><div class="hq-fg-row">';
    if (e.live) h += '<a class="soc-btn2" href="/societies/live/?c=' + esc(e.live.code) + '">' + (e.live.status === 'final' ? 'Final leaderboard' : 'Follow it live') + '</a>';
    if (S.organiser && (!e.live || e.live.status !== 'final')) h += '<button type="button" class="soc-btn2 hq-live">' + (e.live ? 'Groups and scorecards' : 'Set up live scoring') + '</button>';
    h += '</div>';
    if (!e.live) h += '<p class="soc-small">One phone per group, a live leaderboard for the WhatsApp group and the report written for you. <a href="/societies/live-scoring/">How it works</a></p>';
    return h + '</div>';
  }
  var liveJs = null;
  function openLive(e) {
    if (!liveJs) liveJs = new Promise(function (ok, no) { var sc = document.createElement('script'); sc.src = '/js/live-setup.js?v=20261101b'; sc.onload = ok; sc.onerror = no; document.head.appendChild(sc); });
    liveJs.then(function () { window.gpLiveSetup({ e: e, S: S, pid: pid, api: function (path, body) { return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}).then(function (r) { return r.json(); }); }, done: load }); });
  }
  /* ---- The Form Guide: preview before the day, report after it */
  function fgUrl(e) { return SITE + '/societies/form-guide/?e=' + e.id; }
  function fgLinks(e, past) {
    var today = new Date().toISOString().slice(0, 10), played = e.day <= today;
    var h = '<div class="hq-fg"><span class="hq-fg-k">THE FORM GUIDE</span><div class="hq-fg-row">';
    if (e.report) h += '<a class="soc-btn2" href="' + esc(fgUrl(e)) + '">Read the report</a><button type="button" class="soc-btn2 hq-fg-share" data-kind="report">Send the report</button>';
    else if (!past) h += '<a class="soc-btn2" href="' + esc(fgUrl(e)) + '">The preview</a><button type="button" class="soc-btn2 hq-fg-share" data-kind="preview">Send the preview</button>';
    if (S.organiser && played) h += '<button type="button" class="soc-btn hq-res">' + (e.report ? 'Edit the results' : 'Enter the results') + '</button>';
    h += '</div>';
    if (!e.report && played && !S.organiser) h += '<p class="soc-small">The report appears here once the organiser enters the scores.</p>';
    return h + '</div>';
  }
  function resultsForm(e) {
    var played = {}; e.entries.forEach(function (x) { if (x.status === 'in') played[x.m] = 1; });
    var first = S.members.filter(function (m) { return played[m.m]; }), rest = S.members.filter(function (m) { return !played[m.m]; });
    var prev = open['scores-' + e.id] || { rows: [], extras: null }, by = {};
    (prev.rows || []).forEach(function (r) { by[r.m] = r; });
    var ex = prev.extras || {};
    function row(m) {
      var r = by[m.m] || {}, pts = r.pts == null ? '' : (r.pts < 0 ? 'NR' : r.pts);
      return '<div class="hq-res-row"><label for="pts-' + esc(m.m) + '">' + esc(m.nick) + '</label>' +
        '<input id="pts-' + esc(m.m) + '" data-m="' + esc(m.m) + '" data-f="pts" inputmode="numeric" maxlength="3" placeholder="Points" value="' + esc(pts) + '">' +
        '<input data-m="' + esc(m.m) + '" data-f="back" inputmode="numeric" maxlength="2" placeholder="Back 9" aria-label="' + esc(m.nick) + ' back nine points" value="' + esc(r.back == null ? '' : r.back) + '"></div>';
    }
    function pick(name, cur) {
      return '<select name="' + name + '"><option value="">Nobody</option>' + S.members.map(function (m) { return '<option value="' + esc(m.m) + '"' + (cur && cur.m === m.m ? ' selected' : '') + '>' + esc(m.nick) + '</option>'; }).join('') + '</select>';
    }
    return '<form class="hq-res-form" data-e="' + esc(e.id) + '" novalidate><h3>Results: ' + esc(e.title) + '</h3>' +
      '<p class="soc-small">Stableford points for each golfer who played. Add their back-nine points too and ties are settled on countback. Type NR for no return; leave it blank if they didn’t play.</p>' +
      '<div class="hq-res-head"><span>Golfer</span><span>Points</span><span>Back 9</span></div>' +
      first.map(row).join('') + (rest.length ? (first.length ? '<p class="hq-res-sub">Didn’t sign up but played?</p>' : '') + rest.map(row).join('') : '') +
      '<div class="hq-res-extras"><label>Nearest the pin' + pick('ntp', ex.ntp) + '<input name="ntpTxt" maxlength="40" placeholder="e.g. 7th, 4ft 2in" value="' + esc(ex.ntp ? ex.ntp.txt : '') + '"></label>' +
      '<label>Longest drive' + pick('ld', ex.ld) + '<input name="ldTxt" maxlength="40" placeholder="e.g. 12th" value="' + esc(ex.ld ? ex.ld.txt : '') + '"></label>' +
      '<label class="hq-res-wide">A line from you (optional)<textarea name="line" maxlength="200" rows="2" placeholder="Great day, cracking greens.">' + esc(ex.line || '') + '</textarea></label>' +
      '<label>Winner’s prize, £ (optional)<input name="prize" inputmode="numeric" maxlength="3" placeholder="0" value="' + esc(ex.prize || '') + '"><small>The winner picks their own prize at today’s prices. You send them the link.</small></label>' +
      '<label class="hq-res-check"><input type="checkbox" name="spoon"' + (ex.spoon ? ' checked' : '') + '> Include a wooden spoon (all in good fun)</label></div>' +
      '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">' + (e.report ? 'Update the report' : 'Publish the report') + '</button><button type="button" class="soc-btn2 hq-res-cancel">Cancel</button></div>' +
      (e.report ? '<button type="button" class="soc-x hq-res-down">Take the report down</button>' : '') + '</form>';
  }
  function whoList(e, c, past) {
    var order = { in: 0, wait: 1, maybe: 2, out: 3 };
    var list = e.entries.slice().sort(function (a, b) { return order[a.status] - order[b.status] || (a.at < b.at ? -1 : 1); });
    var silent = S.members.filter(function (m) { return !e.entries.some(function (x) { return x.m === m.m; }); });
    var h = '<div class="hq-who">';
    if (S.organiser && c.in) h += '<div class="ms-stages" aria-label="Pay to confirm"><span><b>' + (c.in - c.paid - c.says) + '</b>Not paid</span><span><b>' + c.says + '</b>Say paid</span><span class="is-ok"><b>' + c.paid + '</b>Confirmed</span></div>' +
      '<p class="soc-small">Only confirmed players count towards the numbers for the club.</p>';
    h += list.map(function (x) {
      var label = { in: 'In', wait: 'Waiting list', maybe: 'Maybe', out: 'Out' }[x.status], right = '', sub = '';
      if (S.organiser) {
        var bal = kittyOf(x.m), d = dropLine(e, x.m);
        if (x.status === 'in') {
          if (x.paid) right = '<button type="button" class="hq-paid is-paid" data-m="' + esc(x.m) + '" aria-pressed="true">' + (x.via === 'kitty' ? 'Paid (credit) ✓' : 'Paid ✓') + '</button>';
          else if (saysPaid(x)) {
            sub = ' · says paid ' + esc(nice(x.claim));
            right = '<span class="ms-btns"><button type="button" class="hq-paid ms-confirm" data-m="' + esc(x.m) + '" aria-pressed="false">Confirm</button><button type="button" class="ms-mini ms-reject" data-m="' + esc(x.m) + '">Not arrived</button></span>';
          } else {
            if (x.claim === 'no') sub = ' · told it hasn’t arrived';
            right = '<span class="ms-btns">' + (e.entry > 0 && bal >= e.entry ? '<button type="button" class="ms-mini ms-usecredit" data-m="' + esc(x.m) + '">Use ' + money(e.entry) + ' credit</button>' : '') +
              '<button type="button" class="hq-paid" data-m="' + esc(x.m) + '" aria-pressed="false">Not paid</button></span>';
          }
          if (e.entry > 0) sub += ' · ' + esc(payRef(e, x.nick));
        } else if (d) {
          right = '<span class="hq-tag' + (d.kind === 'drop' ? ' is-owe' : '') + '">' + (d.kind === 'drop' ? 'Owes ' + money(-d.amount) : d.kind === 'held' ? 'Paid, place not filled' : d.kind === 'refund' ? 'Credit ' + money(d.amount) : 'Place filled') + '</span>';
        } else if (x.paid && e.entry > 0) {
          right = '<button type="button" class="ms-mini ms-tocredit" data-m="' + esc(x.m) + '">Paid · make it credit</button>';
        }
      } else if (x.status === 'in' && x.paid) right = '<span class="hq-tag">Paid</span>';
      return '<div class="hq-row"><span class="hq-nick">' + esc(x.nick) + (x.m === S.you ? ' (you)' : '') + '<small>' + label + sub + '</small></span>' + right + '</div>';
    }).join('');
    if (silent.length) h += '<p class="soc-small">Not replied yet: ' + silent.map(function (m) { return esc(m.nick); }).join(', ') + '.</p>';
    if (S.organiser && !past) h += prizeFund(e, c);
    return h + '</div>';
  }
  function prizeFund(e, c) {
    if (!e.entry || !c.in) return '';
    var pct = open['pct-' + e.id] || 35, pot = c.in * e.entry;
    return '<div class="hq-fund" data-pot="' + pot + '"><b>Prize fund</b><div class="hq-fund-g"><span>' + c.in + ' in × ' + money(e.entry) + '</span><b>' + money(pot) + '</b>' +
      '<label for="pct-' + esc(e.id) + '">Prizes (<span class="hq-pv">' + pct + '</span>%, the usual is 30–40%)</label><b class="hq-fv"></b></div>' +
      '<input type="range" min="10" max="100" step="5" value="' + pct + '" id="pct-' + esc(e.id) + '" class="hq-pct">' +
      '<div class="hq-split"></div>' +
      '<p class="soc-small">The rest (<span class="hq-rv"></span>) goes towards the day. Winners can pick their own prizes with the <a href="/societies/awards/">Awards Night Kit’s Prize Picker</a>.</p></div>';
  }
  function fundFill(el, pct) {
    var pot = +el.getAttribute('data-pot'), fund = Math.round(pot * pct / 100);
    var split = [['1st', .4], ['2nd', .27], ['3rd', .13], ['Nearest the pin', .1], ['Longest drive', .1]];
    el.querySelector('.hq-pv').textContent = pct;
    el.querySelector('.hq-fv').textContent = money(fund);
    el.querySelector('.hq-rv').textContent = money(pot - fund);
    el.querySelector('.hq-split').innerHTML = split.map(function (x) { return '<span>' + x[0] + ' ' + money(Math.round(fund * x[1] * 2) / 2) + '</span>'; }).join('');
  }
  /* ---- Polls: questions for the group, answered from a WhatsApp link (js/poll.js) */
  function pollsCard() {
    var ps = S.polls || [];
    if (!ps.length && !S.organiser) return '';
    var h = '<section class="soc-card hq-polls"><div class="hq-polls-h"><h2>Polls</h2>' + (S.organiser ? '<a class="soc-btn2" href="/societies/poll/?new=1&amp;s=' + esc(S.id) + '">New poll</a>' : '') + '</div>';
    if (!ps.length) h += '<p class="soc-help">Where next, which date, what format? Ask the group: one link in WhatsApp, one tap to vote, and the winner becomes a fixture.</p>';
    h += ps.map(function (p) {
      var st = p.closed ? (p.winner ? 'Closed · ' + (p.winner.day ? nice(p.winner.day) : p.winner.label) + ' won' : 'Closed') : (p.voted ? 'You’ve answered' : 'Waiting for your answer') + ' · ' + p.votes + ' so far';
      return '<a class="hq-poll' + (!p.closed && !p.voted ? ' is-new' : '') + '" href="/societies/poll/?p=' + esc(p.id) + '"><b>' + esc(p.q) + '</b><span>' + esc(st) + '</span></a>';
    }).join('');
    return h + '</section>';
  }
  /* ---- The season kitty: credit carried forward, what's owed, season subs */
  function kittyCard() {
    var lines = S.kitty || [];
    if (!S.organiser) {
      if (!lines.length) return '';
      var b = kittyOf(S.you);
      return '<section class="soc-card ms-kitty"><h2>Your kitty</h2>' +
        '<div class="ms-bal' + (b < 0 ? ' is-owe' : '') + '"><b>' + (b < 0 ? 'You owe ' + money(-b) : b > 0 ? money(b) + ' credit' : 'All square') + '</b><span>' +
        (b < 0 ? 'Pay the organiser as usual, then they’ll mark it settled.' : b > 0 ? 'The organiser can put it towards your next golf day.' : 'Nothing owed either way.') + '</span></div>' +
        kittyLines(lines.slice(0, 12), false) + '<p class="soc-small">Kept by your organiser. GolfPrice AI never holds or moves any money.</p></section>';
    }
    var bal = {}; lines.forEach(function (k) { bal[k.m] = Math.round(((bal[k.m] || 0) + (Number(k.amount) || 0)) * 100) / 100; });
    var held = 0, owed = 0, rows = S.members.filter(function (m) { return bal[m.m]; }).map(function (m) {
      var v = bal[m.m]; if (v > 0) held += v; else owed -= v;
      return '<div class="hq-row"><span class="hq-nick">' + esc(m.nick) + '<small>' + (v > 0 ? 'In credit' : 'Owes the society') + '</small></span><span class="ms-btns"><b class="ms-amt' + (v < 0 ? ' is-owe' : '') + '">' + (v < 0 ? '−' : '') + money(Math.abs(v)) + '</b>' +
        '<button type="button" class="ms-mini ms-settle" data-m="' + esc(m.m) + '" data-v="' + v + '">' + (v > 0 ? 'Paid back' : 'Settled') + '</button></span></div>';
    });
    var h = '<section class="soc-card ms-kitty"><h2>The kitty</h2><p class="soc-help">Credit carried forward, refunds owed and season subs, per member. Your record only: GolfPrice AI never holds or moves any money.</p>' +
      '<div class="ms-stages"><span class="is-ok"><b>' + money(held) + '</b>Credit you hold</span><span class="' + (owed ? 'is-owe' : '') + '"><b>' + money(owed) + '</b>Owed to you</span></div>';
    h += rows.length ? rows.join('') : '<p class="soc-small">Everyone’s square. Drop-out charges and credits from golf days appear here by themselves.</p>';
    if (owed) h += '<button type="button" class="soc-btn2 ms-settleup">Settle-up message for the group</button>';
    var who = '<option value="*">Everyone (' + S.members.length + ')</option>' + S.members.map(function (m) { return '<option value="' + esc(m.m) + '">' + esc(m.nick) + '</option>'; }).join('');
    h += '<details class="ms-add"' + (open.kittyAdd ? ' open' : '') + '><summary>Add to the kitty</summary><form class="ms-kform" novalidate>' +
      '<label>Who<select name="m">' + who + '</select></label>' +
      '<div class="soc-two"><label>What<select name="dir"><option value="-1">They owe (e.g. season subs)</option><option value="1">Credit them (e.g. overpaid)</option></select></label>' +
      '<label>Amount £<input name="amount" inputmode="decimal" placeholder="20"></label></div>' +
      '<label>Note<input name="note" maxlength="60" placeholder="e.g. Season subs 2027"></label>' +
      '<p class="soc-msg" role="status"></p><button type="submit" class="soc-btn">Add it</button></form></details>';
    if (lines.length) h += '<details class="ms-hist"' + (open.kittyHist ? ' open' : '') + '><summary>All kitty lines (' + lines.length + ')</summary>' + kittyLines(lines, true) + '</details>';
    return h + '</section>';
  }
  function kittyLines(lines, org) {
    var nickOf = {}; S.members.forEach(function (m) { nickOf[m.m] = m.nick; });
    return '<ul class="ms-lines">' + lines.map(function (k) {
      var a = Number(k.amount) || 0;
      return '<li><span>' + (org ? '<b>' + esc(nickOf[k.m] || k.nick) + '</b> · ' : '') + esc(k.note) + '<small>' + esc(nice(String(k.at).slice(0, 10))) + '</small></span>' +
        '<span class="ms-btns"><b class="ms-amt' + (a < 0 ? ' is-owe' : '') + '">' + (a ? (a > 0 ? '+' : '−') + money(Math.abs(a)) : '£0') + '</b>' +
        (org && /^(manual|settle)$/.test(k.kind) ? '<button type="button" class="ms-mini ms-kdel" data-id="' + esc(k.id) + '" aria-label="Remove this line">✕</button>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }
  function eventForm(e) {
    e = e || {};
    return '<form class="soc-card hq-evf" data-id="' + esc(e.id || '') + '" novalidate><h2>' + (e.id ? 'Edit the fixture' : 'Add a fixture') + '</h2>' +
      '<label>Name of the day<input name="title" maxlength="50" required value="' + esc(e.title || '') + '" placeholder="Spring Stableford"></label>' +
      '<div class="soc-two"><label>Date<input type="date" name="day" required value="' + esc(e.day || '') + '"></label><label>First tee<input type="time" name="tee" value="' + esc(e.tee || '') + '"></label></div>' +
      '<label>Course<input name="venue" maxlength="60" value="' + esc(e.venue || '') + '" placeholder="Course name"></label>' +
      '<div class="soc-two"><label>Society entry £ (optional)<input name="entry" inputmode="decimal" value="' + esc(e.entry || '') + '" placeholder="15"></label><label>Places (optional)<input name="cap" inputmode="numeric" value="' + esc(e.cap || '') + '" placeholder="e.g. 24"></label></div>' +
      '<label>Final numbers to the club by (optional)<input type="date" name="deadline" value="' + esc(e.deadline || '') + '"></label>' +
      '<label class="soc-check ms-rulebox"><input type="checkbox" name="droprule"' + (e.droprule ? ' checked' : '') + '> Drop-out rule: after the final-numbers date, anyone who drops out still owes their entry, unless their place is filled</label>' +
      '<p class="soc-small">Needs an entry fee and a final-numbers date. Members see the rule when they sign up, and the waiting list fills the place first.</p>' +
      (S.open ? '<label>Spare places to show on Find a Society (optional)<input name="spare" inputmode="numeric" value="' + esc(e.spare || '') + '" placeholder="0: don’t show"></label><p class="soc-small">Golfers nearby can ask for a place on this day. Only the date, course, format and cost are shown, and nobody plays without your yes.</p>' : '') +
      '<label>Notes (optional)<input name="notes" maxlength="300" value="' + esc(e.notes || '') + '" placeholder="e.g. Bacon roll on arrival, two-course meal after"></label>' +
      '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">' + (e.id ? 'Save' : 'Add the fixture') + '</button>' +
      (e.id ? '<button type="button" class="soc-btn2 hq-cancel">Cancel</button><button type="button" class="soc-x hq-del">Delete this fixture</button>' : '') + '</div></form>';
  }
  function page() {
    var today = new Date().toISOString().slice(0, 10);
    var up = S.events.filter(function (e) { return e.day >= today; }), past = S.events.filter(function (e) { return e.day < today; }).reverse();
    var me = S.members.filter(function (m) { return m.m === S.you; })[0];
    var h = '<section class="soc-hero">' + (S.founding ? '<span class="soc-found">Founding Society · No. ' + S.founding + '</span>' : '') + '<span class="soc-kick">' + esc(S.area || 'Golf society') + ' · ' + S.count + (S.count === 1 ? ' member' : ' members') + (S.organiser ? ' · you’re the organiser' : '') + '</span>' +
      '<h1>' + esc(S.name) + '</h1>' + (S.about ? '<p>' + esc(S.about) + '</p>' : '') +
      '<div class="soc-btns"><button type="button" class="soc-btn hq-invite">Invite members</button>' + (S.organiser ? '<button type="button" class="soc-btn2 hq-soc-edit">Edit society</button>' : '') + '</div></section>';
    if (window.gpKey && !gpKey.status().saved) h += '<section class="soc-card hq-key"><div><b>' + (S.organiser ? 'Back up ' + esc(S.name) : 'Keep your place safe') + '</b><span>' +
      (S.organiser ? 'If this phone forgets you, you lose the society. Save your Clubhouse key: it takes 10 seconds.' : 'Save your Clubhouse key so a new phone or a cleared browser doesn’t lose your place.') + '</span></div><button type="button" class="soc-btn hq-key-go">Save my key</button></section>';
    if (S.co && !S.lead) h += '<section class="soc-card hq-co"><span class="soc-kick">You’re the co-organiser</span><h2>Organiser lost their phone?</h2>' +
      '<p class="soc-help">If they’ve lost their phone and their Clubhouse key, send them a one-time link. It hands the organiser role back to them on their new phone, and works once, for 24 hours.</p>' +
      '<p class="soc-msg" role="status"></p><button type="button" class="soc-btn hq-handback">Send the hand-back link on WhatsApp</button></section>';
    if (S.organiser && S.requests && S.requests.length) {
      var evName = {}; S.events.forEach(function (e) { evName[e.id] = nice(e.day) + (e.venue ? ' at ' + e.venue : ''); });
      h += '<section class="soc-card hq-reqs"><h2>' + S.requests.length + (S.requests.length === 1 ? ' golfer wants in' : ' golfers want in') + '</h2>' + S.requests.map(function (r) {
        return '<div class="hq-req" data-r="' + esc(r.id) + '"><span><b>' + esc(r.nick) + '</b> · ' + (r.event ? 'a spare place on ' + esc(evName[r.event] || 'a golf day') : 'wants to join') +
          (r.note ? '<br><small>“' + esc(r.note) + '”</small>' : '') + '</span><div class="soc-btns"><button type="button" class="soc-btn hq-yes">' + (r.event ? 'Yes, they’re in' : 'Yes, welcome') + '</button><button type="button" class="soc-btn2 hq-no">Not this time</button></div></div>';
      }).join('') + '<p class="soc-small">From Find a Society. A yes adds them to the society' + (S.requests.some(function (r) { return r.event; }) ? ' (and puts them down for that day)' : '') + '. They see your answer on your society’s page.</p></section>';
    }
    if (open.editSoc) h += '<form class="soc-card" id="hq-soc" novalidate><h2>Edit society</h2>' + fields(S) + '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">Save</button><button type="button" class="soc-btn2 hq-cancel-soc">Cancel</button></div></form>';
    h += '<section class="soc-card"><h2>Fixtures</h2>' + (up.length ? up.map(function (e) { return open['edit-' + e.id] ? eventForm(e) : eventCard(e, false); }).join('') :
      '<p class="soc-help">' + (S.organiser ? 'No fixtures yet. Add your first one below, then send the sign-up link to the group.' : 'No fixtures yet. The organiser will add them here.') + '</p>') + '</section>';
    h += kittyCard();
    h += pollsCard();
    if (S.organiser) h += eventForm(FIX);
    h += '<section class="soc-card hq-pp" id="hq-pp" hidden></section>';
    h += '<section class="soc-card hq-lg" id="hq-lg" hidden></section>';
    if (S.organiser) h += badgeCard();
    if (past.length) h += '<section class="soc-card"><h2>Recent</h2>' + past.map(function (e) { return eventCard(e, true); }).join('') + '</section>';
    h += '<section class="soc-card"><h2>Members (' + S.members.length + ')</h2><div class="hq-members">' + S.members.map(function (m) {
      return '<span class="hq-mem">' + esc(m.nick) + (m.organiser ? ' <small>organiser</small>' : m.co ? ' <small>co-organiser</small>' : '') + (S.organiser && !m.organiser && m.m !== S.you ? ' <button type="button" class="hq-rm" data-m="' + esc(m.m) + '" aria-label="Remove ' + esc(m.nick) + '">✕</button>' : '') + '</span>';
    }).join('') + '</div>' + (!S.organiser && me ? '<button type="button" class="soc-x hq-leave">Leave this society</button>' : '') + '</section>' +
      (!S.organiser ? '<p class="soc-small hq-another">Run another golf society? <a href="/societies/hq/">Start one free</a>, it takes a minute.</p>' : '');
    if (S.lead && S.members.length > 1) {
      var others = S.members.filter(function (m) { return !m.organiser; });
      h += '<section class="soc-card hq-co"><h2>' + (S.coNick ? 'Co-organiser: ' + esc(S.coNick) : 'Add a co-organiser') + '</h2>' +
        '<p class="soc-help">Someone you trust who can run the society with you: fixtures, results, who’s paid. If you ever lose your phone and your key, they can hand the society back.</p>' +
        '<form class="hq-co-form" novalidate><label>' + (S.coNick ? 'Change to' : 'Pick a member') + '<select name="m"><option value="">Choose…</option>' +
        others.map(function (m) { return '<option value="' + esc(m.m) + '"' + (m.m === S.coKey ? ' selected' : '') + '>' + esc(m.nick) + '</option>'; }).join('') + '</select></label>' +
        '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">' + (S.coNick ? 'Save' : 'Make them co-organiser') + '</button>' +
        (S.coNick ? '<button type="button" class="soc-btn2 hq-co-off">Remove ' + esc(S.coNick) + '</button>' : '') + '</div></form></section>';
    }
    h += '<section class="soc-card soc-next"><span class="soc-kick">End of the season?</span><h2>The Awards Night Kit</h2><p>Award cards, a slideshow for the big night and prizes your winners pick themselves.</p><a class="soc-btn" href="/societies/awards/">Make your awards</a></section>';
    box.innerHTML = h;
    wire();
  }
  function wireKitty(invite) {
    var card = box.querySelector('.ms-kitty');
    if (!card || !S.organiser) return;
    var add = card.querySelector('.ms-add'); if (add) add.ontoggle = function () { open.kittyAdd = add.open; };
    var hist = card.querySelector('.ms-hist'); if (hist) hist.ontoggle = function () { open.kittyHist = hist.open; };
    function send(body, btn, after) {
      if (btn) btn.disabled = true;
      return api('/soc/kitty', Object.assign({ s: S.id }, body)).then(function (r) {
        if (!r.ok) { if (btn) btn.disabled = false; alertMsg(card, r.error); return; }
        gpUse('mny_kitty'); if (after) after(); load();
      }).catch(function () { if (btn) btn.disabled = false; alertMsg(card, 'We couldn’t reach the clubhouse. Please try again.'); });
    }
    var f = card.querySelector('.ms-kform');
    if (f) f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var F = f.elements, msg = f.querySelector('.soc-msg'), amt = Number(String(F.amount.value).replace(/[£,\s]/g, ''));
      if (!(amt > 0)) { msg.textContent = 'Enter an amount, e.g. 20.'; return; }
      if (!F.note.value.trim()) { msg.textContent = 'Add a short note, e.g. Season subs 2027.'; return; }
      var all = F.m.value === '*';
      if (all && !window.confirm('Add ' + (F.dir.value === '1' ? 'a credit of ' : 'a charge of ') + money(amt) + ' for all ' + S.members.length + ' members?')) return;
      send({ m: all ? '' : F.m.value, all: all, amount: amt * Number(F.dir.value), note: F.note.value }, f.querySelector('[type=submit]'), function () { open.kittyAdd = false; });
    });
    card.querySelectorAll('.ms-settle').forEach(function (b) {
      b.onclick = function () {
        var v = +b.getAttribute('data-v');
        if (window.confirm(v > 0 ? 'Mark ' + money(v) + ' as paid back? Their balance goes to zero.' : 'Mark ' + money(-v) + ' as paid? Their balance goes to zero.')) send({ settle: b.getAttribute('data-m') }, b);
      };
    });
    card.querySelectorAll('.ms-kdel').forEach(function (b) { b.onclick = function () { if (window.confirm('Remove this kitty line?')) send({ del: b.getAttribute('data-id') }, b); }; });
    var su = card.querySelector('.ms-settleup'); if (su) su.onclick = function () {
      var bal = {}; (S.kitty || []).forEach(function (k) { bal[k.m] = (bal[k.m] || 0) + (Number(k.amount) || 0); });
      var owe = S.members.filter(function (m) { return bal[m.m] < -0.004; }).map(function (m) { return m.nick + ' ' + money(Math.round(-bal[m.m] * 100) / 100); });
      track('society_settle_up'); gpUse('mny_chase');
      shareText(S.name + ' kitty: a few of us are still to settle up. ' + owe.join(', ') + '.' + (S.pay ? ' Pay here: ' + S.pay + '.' : '') + ' Your balance is on Society HQ: ' + invite + ' Cheers!');
    };
  }
  function wire() {
    var invite = SITE + '/societies/hq/?s=' + S.id;
    box.querySelector('.hq-invite').onclick = function () { track('society_invite'); shareText('Join ' + S.name + ' on Society HQ: fixtures, sign-ups and who’s paid in one place. Tap, pick a nickname, done: ' + invite); };
    var se = box.querySelector('.hq-soc-edit'); if (se) se.onclick = function () { open.editSoc = !open.editSoc; page(); };
    var cs = box.querySelector('.hq-cancel-soc'); if (cs) cs.onclick = function () { open.editSoc = false; page(); };
    wireKitty(invite);
    var fs = box.querySelector('#hq-soc');
    if (fs) coursePicker(fs);
    if (fs) fs.addEventListener('submit', function (e) {
      e.preventDefault(); var msg = fs.querySelector('.soc-msg'), b = read(fs); b.s = S.id;
      api('/soc/edit', b).then(function (r) { if (!r.ok) { msg.textContent = r.error; return; } open.editSoc = false; remember(S.id, b.name.trim()); load(); });
    });
    box.querySelectorAll('.hq-evf').forEach(function (f) {
      var eid = f.getAttribute('data-id');
      if (!eid && FIX && !f.getAttribute('data-fixed')) { f.setAttribute('data-fixed', '1'); f.id = 'hq-fix'; setTimeout(function () { f.scrollIntoView({ block: 'start' }); (FIX.venue ? f.title : f.venue).focus(); }, 50); }
      f.addEventListener('submit', function (ev) {
        ev.preventDefault(); var msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn');
        var b = { s: S.id, e: eid || undefined, title: f.title.value, day: f.day.value, tee: f.tee.value, venue: f.venue.value, entry: f.entry.value.replace(/[£\s]/g, ''), cap: f.cap.value, deadline: f.deadline.value, notes: f.notes.value, spare: f.spare ? f.spare.value : 0, droprule: f.droprule.checked };
        if (b.droprule && (!b.deadline || !(+b.entry > 0))) { msg.textContent = 'The drop-out rule needs an entry fee and a final-numbers date.'; return; }
        btn.disabled = true; msg.textContent = 'Pencilling it in…';
        api('/soc/event', b).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
          if (eid) open['edit-' + eid] = false; else { track('society_fixture_added'); FIX = null; }
          load();
        }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
      });
      var c = f.querySelector('.hq-cancel'); if (c) c.onclick = function () { open['edit-' + eid] = false; page(); };
      var d = f.querySelector('.hq-del'); if (d) d.onclick = function () {
        if (!window.confirm('Delete this fixture and everyone’s replies?')) return;
        api('/soc/event', { s: S.id, e: eid, del: 1 }).then(function () { open['edit-' + eid] = false; load(); });
      };
    });
    box.querySelectorAll('.hq-ev').forEach(function (art) {
      var eid = art.getAttribute('data-e'), e = S.events.filter(function (x) { return x.id === eid; })[0];
      art.querySelectorAll('[data-st]').forEach(function (b) {
        b.onclick = function () {
          var mine = e.entries.filter(function (x) { return x.m === S.you; })[0], to = b.getAttribute('data-st');
          if (mine && mine.status === 'in' && to !== 'in' && afterNumbers(e) && e.entry > 0) { open['drop-' + eid] = true; open['dropst-' + eid] = to; page(); return; }
          b.disabled = true;
          api('/soc/rsvp', { e: eid, status: b.getAttribute('data-st') }).then(function (r) { if (r.ok) { track('society_rsvp', { status: r.status }); load(); } else { b.disabled = false; alertMsg(art, r.error); } });
        };
      });
      var more = art.querySelector('.hq-more'); if (more) more.onclick = function () { open[eid] = !open[eid]; page(); };
      art.querySelectorAll('.hq-paid').forEach(function (b) {
        b.onclick = function () {
          var paid = b.getAttribute('aria-pressed') !== 'true'; b.disabled = true;
          api('/soc/paid', { e: eid, m: b.getAttribute('data-m'), paid: paid }).then(function () { if (paid) gpUse('mny_confirm'); load(); });
        };
      });
      var pct = art.querySelector('.hq-pct'); if (pct) { fundFill(art.querySelector('.hq-fund'), +pct.value); pct.oninput = function () { open['pct-' + eid] = +pct.value; fundFill(art.querySelector('.hq-fund'), +pct.value); }; }
      art.querySelectorAll('.hq-share').forEach(function (b) {
        b.onclick = function () {
          track('society_signup_link');
          shareText(S.name + ': ' + e.title + ', ' + nice(e.day, true) + (e.venue ? ' at ' + e.venue : '') + (e.entry ? ' (' + money(e.entry) + ' entry)' : '') + '. In, out or maybe? Tap: ' + invite + ' (free on Society HQ)');
        };
      });
      var fin = art.querySelector('.hq-final'); if (fin) fin.onclick = function () {
        var unpaid = e.entries.filter(function (x) { return x.status === 'in' && !x.paid; }).map(function (x) { return x.nick; });
        var conf = e.entries.filter(function (x) { return x.status === 'in' && x.paid; }).length;
        var text = S.name + ', ' + e.title + ': numbers go to the club ' + (e.deadline ? 'on ' + nice(e.deadline, true) : 'soon') + '. Not paid = not playing. Confirmed so far: ' + conf + '.' +
          (unpaid.length ? ' Still to pay: ' + unpaid.join(', ') + '. No pressure. Well, a bit.' : ' Everyone’s paid. Look at us!') + (S.pay && unpaid.length ? ' Pay here: ' + S.pay + ' ·' : '') + ' Who’s in: ' + invite + ' (Society HQ, free for golf societies)';
        track('society_final_numbers'); shareText(text);
      };
      // Money Sorted
      var ch = art.querySelector('.ms-chase'); if (ch) ch.onclick = function () {
        var unpaid = chaseList(e);
        if (!unpaid.length) { alertMsg(art, 'Nobody to chase. Anyone left has tapped “I’ve paid”: check your bank app and confirm them.'); return; }
        var text = 'Quick one for ' + e.title + ' (' + nice(e.day, true) + '): still waiting on ' + (unpaid.length > 1 ? unpaid.slice(0, -1).join(', ') + ' and ' + unpaid[unpaid.length - 1] + ', ' + money(e.entry) + ' each.' : unpaid[0] + ', ' + money(e.entry) + '.') +
          (S.pay ? ' Pay here: ' + S.pay + '.' : '') + ' Your payment reference is on Society HQ, and tap “I’ve paid” once it’s gone so I can tick you off: ' + invite + ' Cheers!';
        track('society_chase'); gpUse('mny_chase'); shareText(text);
      };
      art.querySelectorAll('.ms-copy').forEach(function (b) { b.onclick = function () { gpUse('mny_ref'); copyText(b.getAttribute('data-ref'), b); }; });
      art.querySelectorAll('.ms-ipaid').forEach(function (b) {
        b.onclick = function () {
          var on = b.getAttribute('data-on') === '1'; b.disabled = true;
          api('/soc/ipaid', { e: eid, on: on }).then(function (r) { if (r.ok) { if (on) { gpUse('mny_ipaid'); track('society_ipaid'); } load(); } else { b.disabled = false; alertMsg(art, r.error); } })
            .catch(function () { b.disabled = false; alertMsg(art, 'We couldn’t reach the clubhouse. Please try again.'); });
        };
      });
      function money1(b, body, use) {
        b.disabled = true;
        api('/soc/paid', Object.assign({ e: eid, m: b.getAttribute('data-m') }, body)).then(function (r) { if (r.ok) { if (use) gpUse(use); load(); } else { b.disabled = false; alertMsg(art, r.error); } })
          .catch(function () { b.disabled = false; alertMsg(art, 'We couldn’t reach the clubhouse. Please try again.'); });
      }
      art.querySelectorAll('.ms-reject').forEach(function (b) { b.onclick = function () { money1(b, { reject: 1 }); }; });
      art.querySelectorAll('.ms-usecredit').forEach(function (b) { b.onclick = function () { money1(b, { paid: true, kitty: 1 }, 'mny_kitty'); }; });
      art.querySelectorAll('.ms-tocredit').forEach(function (b) { b.onclick = function () { if (window.confirm('Turn their ' + money(e.entry) + ' into credit in the kitty? Their paid tick for this day comes off.')) money1(b, { credit: 1 }, 'mny_kitty'); }; });
      var dg = art.querySelector('.ms-dropgo'); if (dg) dg.onclick = function () {
        dg.disabled = true; open['drop-' + eid] = false;
        api('/soc/rsvp', { e: eid, status: open['dropst-' + eid] || 'out' }).then(function (r) { if (r.ok) { track('society_rsvp', { status: r.status }); if (r.dropped) gpUse('mny_drop'); load(); } else { dg.disabled = false; alertMsg(art, r.error); } });
      };
      var dn = art.querySelector('.ms-dropno'); if (dn) dn.onclick = function () { open['drop-' + eid] = false; page(); };
      var ed = art.querySelector('.hq-edit'); if (ed) ed.onclick = function () { open['edit-' + eid] = true; page(); };
      art.querySelectorAll('.hq-fg-share').forEach(function (b) {
        b.onclick = function () {
          var rep = b.getAttribute('data-kind') === 'report';
          track('society_fg_share', { kind: b.getAttribute('data-kind') });
          shareText(rep ? 'The report is in: ' + S.name + ', ' + e.title + '. Who won, who didn’t and who’s buying the bacon rolls: ' + fgUrl(e)
            : 'The Form Guide for ' + e.title + (e.venue ? ' at ' + e.venue : '') + ' is out. Who’s in form, who’s the dark horse: ' + fgUrl(e));
        };
      });
      var lv = art.querySelector('.hq-live'); if (lv) lv.onclick = function () { track('lv_open'); openLive(e); };
      var rs = art.querySelector('.hq-res'); if (rs) rs.onclick = function () {
        if (open['res-' + eid]) { open['res-' + eid] = false; page(); return; }
        rs.disabled = true;
        api('/soc/scores?e=' + eid + '&pid=' + pid()).then(function (r) { open['scores-' + eid] = r.ok ? r : null; open['res-' + eid] = true; page(); })
          .catch(function () { open['res-' + eid] = true; page(); });
      };
      var rf = art.querySelector('.hq-res-form'); if (rf) {
        rf.querySelector('.hq-res-cancel').onclick = function () { open['res-' + eid] = false; page(); };
        var down = rf.querySelector('.hq-res-down'); if (down) down.onclick = function () {
          if (!window.confirm('Take the report down? The scores are removed too.')) return;
          api('/soc/unpublish', { e: eid }).then(function () { open['res-' + eid] = false; open['done-' + eid] = null; load(); });
        };
        rf.addEventListener('submit', function (ev) {
          ev.preventDefault();
          var rows = {}, msg = rf.querySelector('.soc-msg'), btn = rf.querySelector('[type=submit]');
          rf.querySelectorAll('[data-m]').forEach(function (i) { var m = i.getAttribute('data-m'); rows[m] = rows[m] || { m: m }; rows[m][i.getAttribute('data-f')] = i.value.trim(); });
          var list = Object.keys(rows).map(function (k) { return rows[k]; }).filter(function (r) { return r.pts !== '' && r.pts != null; });
          var bad = list.filter(function (r) { return !/^(nr|\d{1,2})$/i.test(r.pts) || (r.back && !/^\d{1,2}$/.test(r.back)); });
          if (bad.length) { msg.textContent = 'Points should be a number (or NR). Check ' + bad.length + (bad.length === 1 ? ' golfer.' : ' golfers.'); return; }
          if (list.filter(function (r) { return !/^nr$/i.test(r.pts); }).length < 2) { msg.textContent = 'Add at least two golfers’ points.'; return; }
          var f = rf.elements;
          btn.disabled = true; msg.textContent = 'Writing the report…';
          api('/soc/results', { e: eid, rows: list, ntp: f.ntp.value ? { m: f.ntp.value, txt: f.ntpTxt.value } : null, ld: f.ld.value ? { m: f.ld.value, txt: f.ldTxt.value } : null,
            line: f.line.value, spoon: f.spoon.checked, prize: f.prize.value }).then(function (r) {
            btn.disabled = false;
            if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
            track('society_results', { players: list.length });
            open['res-' + eid] = false; open['done-' + eid] = r; load();
          }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
        });
      }
      var done = open['done-' + eid];
      if (done) {
        var winner = '';
        var d = document.createElement('div'); d.className = 'hq-fg-done';
        d.innerHTML = '<b>The report is live.</b><span>Send it to the group, and it’s in every member’s Society HQ too.</span><div class="hq-fg-row"><button type="button" class="soc-btn hq-done-share">Send the report</button><a class="soc-btn2" href="' + esc(SITE + done.url) + '">Read it</a>' +
          (done.prize ? '<button type="button" class="soc-btn2 hq-done-prize">Send the winner their prize link</button>' : '') + '</div>';
        art.appendChild(d);
        d.querySelector('.hq-done-share').onclick = function () { shareText('The report is in: ' + S.name + ', ' + e.title + '. Who won, who didn’t and who’s buying the bacon rolls: ' + SITE + done.url); };
        var pz = d.querySelector('.hq-done-prize'); if (pz) pz.onclick = function () { shareText('You won! Pick your prize for ' + e.title + ' from real golf kit at today’s prices: ' + SITE + done.prize + winner); };
      }
    });
    box.querySelectorAll('.hq-rm').forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm('Remove this member from the society?')) return;
        api('/soc/remove', { s: S.id, m: b.getAttribute('data-m') }).then(function () { load(); });
      };
    });
    league();
    ppLeague();
    wireBadge();
    box.querySelectorAll('.hq-req').forEach(function (rq) {
      var answer = function (yes) { rq.querySelectorAll('button').forEach(function (b) { b.disabled = true; }); api('/soc/answer', { s: S.id, r: rq.getAttribute('data-r'), yes: yes }).then(function () { track('society_request_' + (yes ? 'yes' : 'no')); load(); }); };
      rq.querySelector('.hq-yes').onclick = function () { answer(true); };
      rq.querySelector('.hq-no').onclick = function () { answer(false); };
    });
    var kg = box.querySelector('.hq-key-go'); if (kg) kg.onclick = function () { keyPrompt('SOCIETY HQ', null, 'Done', function () { page(); }, true); };
    var cf = box.querySelector('.hq-co-form'); if (cf) {
      cf.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var msg = cf.querySelector('.soc-msg');
        if (!cf.m.value) { msg.textContent = 'Pick a member.'; return; }
        api('/soc/coorg', { s: S.id, m: cf.m.value }).then(function (r) { if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; } track('society_coorg'); gpUseCo(); load(); });
      });
      var off = cf.querySelector('.hq-co-off'); if (off) off.onclick = function () {
        if (!window.confirm('Remove ' + S.coNick + ' as co-organiser?')) return;
        api('/soc/coorg', { s: S.id, m: '' }).then(function () { load(); });
      };
    }
    var hb = box.querySelector('.hq-handback'); if (hb) hb.onclick = function () {
      var msg = hb.parentNode.querySelector('.soc-msg');
      hb.disabled = true;
      api('/soc/handback', { s: S.id }).then(function (r) {
        hb.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
        track('society_handback');
        shareText('Here’s ' + S.name + ' back on your new phone. Open this link on it (it works once, for 24 hours): ' + SITE + '/societies/hq/?s=' + S.id + '&hb=' + r.token);
      }).catch(function () { hb.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    };
    var lv = box.querySelector('.hq-leave'); if (lv) lv.onclick = function () {
      if (!window.confirm('Leave ' + S.name + '?')) return;
      api('/soc/leave', { s: S.id }).then(function () { forget(S.id); location.href = '/societies/hq/'; });
    };
  }
  /* ---- The National Society League: enter (organiser) or see where we are (members) */

  /* ---- "Find us on GolfPrice AI" badges: for the society's own website, club page or Instagram.
     Only for societies listed in Find a Society, so a private society's page is never linked. */
  var BADGE = { style: 'light' };
  function socSlug() { return (S.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'golf-society') + '-' + S.id; }
  function badgeUrl() { return SITE + '/societies/find/' + socSlug() + '/'; }
  function badgeSub() { return [S.name, S.area].filter(Boolean).join(' · '); }
  var FLAG = function (c, size) { return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="' + c + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4M6 4l11 4-11 4M3 21h8"/></svg>'; };
  function badgeHtml(style) {
    var F = 'font-family:Inter,Arial,Helvetica,sans-serif;', url = esc(badgeUrl()), name = esc(S.name), sub = esc(badgeSub());
    var logo = function (dark) { return '<b style="' + F + 'font-size:16px;font-weight:800;color:' + (dark ? '#fff' : '#14211a') + '">Golf<span style="color:' + (dark ? '#5fd14a' : '#2f8a1f') + '">Price</span> AI</b>'; };
    if (style === 'small') return '<a href="' + url + '" target="_blank" rel="noopener" title="' + name + ' on GolfPrice AI" style="' + F + 'display:inline-flex;align-items:center;gap:8px;background:#fff;border:1px solid #d5d9d1;border-radius:999px;padding:6px 14px 6px 8px;color:#14211a;text-decoration:none;font-size:13px;font-weight:700;line-height:1.2">' +
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:#14211a">' + FLAG('#8fd97c', 13) + '</span>Find us on GolfPrice AI</a>';
    if (style === 'dark') return '<a href="' + url + '" target="_blank" rel="noopener" style="' + F + 'display:inline-flex;align-items:center;gap:14px;background:#14211a;border-radius:14px;padding:12px 16px;color:#fff;text-decoration:none;line-height:1.25;max-width:100%;box-sizing:border-box">' +
      '<span style="display:flex;flex-direction:column;gap:2px"><small style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#8fd97c">NEW MEMBERS WELCOME</small>' + logo(true) + '<small style="font-size:12px;color:#c4d0c8">Join ' + name + ' &rarr;</small></span>' +
      (S.founding ? '<span style="border:1px solid #c9a64a;color:#e6c66b;border-radius:999px;padding:4px 9px;font-size:10px;font-weight:700;letter-spacing:.08em;white-space:nowrap">FOUNDING No. ' + S.founding + '</span>' : '') + '</a>';
    return '<a href="' + url + '" target="_blank" rel="noopener" style="' + F + 'display:inline-flex;align-items:center;gap:12px;background:#fff;border:1px solid #d5d9d1;border-radius:14px;padding:12px 16px;color:#14211a;text-decoration:none;line-height:1.25;max-width:100%;box-sizing:border-box">' +
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;background:#14211a;flex:none">' + FLAG('#8fd97c', 22) + '</span>' +
      '<span style="display:flex;flex-direction:column;gap:2px"><small style="font-size:10px;font-weight:700;letter-spacing:.12em;color:#2f8a1f">FIND US ON</small>' + logo(false) + '<small style="font-size:12px;color:#4a554e">' + sub + '</small></span></a>';
  }
  function badgeCard() {
    if (!S.open) return '<section class="soc-card hq-badge"><h2>Show off your society</h2><p class="soc-help">Get a “Find us on GolfPrice AI” badge for your website, club page or Instagram, so new golfers can find you and ask to join. Tick <b>Open to new members</b> in <i>Edit society</i> first: the badge links to your page in Find a Society.</p></section>';
    var opt = function (v, l) { return '<label class="hq-bopt"><input type="radio" name="hq-bstyle" value="' + v + '"' + (BADGE.style === v ? ' checked' : '') + '> ' + l + '</label>'; };
    return '<section class="soc-card hq-badge"><h2>Show off your society</h2>' +
      '<p class="soc-help">A badge for your website, club page or Instagram bio. It links to ' + esc(S.name) + '’s page in Find a Society, so new golfers can find you and ask to join.</p>' +
      '<div class="hq-bopts" role="radiogroup" aria-label="Badge style">' + opt('light', 'Light') + opt('dark', 'Dark') + opt('small', 'Small') + '</div>' +
      '<div class="hq-bprev' + (BADGE.style === 'dark' ? ' is-dark' : '') + '">' + badgeHtml(BADGE.style) + '</div>' +
      '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="button" class="soc-btn hq-bcopy">Copy website code</button><button type="button" class="soc-btn2 hq-bpic">Save as a picture</button></div>' +
      '<p class="soc-small">Works on Wix, Squarespace, WordPress, Google Sites and club websites: paste it into an “Embed” or “Custom HTML” block. Your society’s page goes live within 6 hours of ticking Open to new members.</p></section>';
  }
  function badgePng(style) {
    var c = document.createElement('canvas'), k = 2, W = style === 'small' ? 300 : 420, H = style === 'small' ? 52 : 92;
    c.width = W * k; c.height = H * k;
    var x = c.getContext('2d'); x.scale(k, k);
    var dark = style === 'dark', rr = function (X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); };
    rr(1, 1, W - 2, H - 2, style === 'small' ? 25 : 16); x.fillStyle = dark ? '#14211a' : '#fff'; x.fill();
    if (!dark) { x.strokeStyle = '#d5d9d1'; x.lineWidth = 1.5; x.stroke(); }
    var flag = function (X, Y, s) { x.save(); x.translate(X, Y); x.scale(s / 24, s / 24); x.strokeStyle = '#8fd97c'; x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.beginPath(); x.moveTo(6, 21); x.lineTo(6, 4); x.lineTo(17, 8); x.lineTo(6, 12); x.moveTo(3, 21); x.lineTo(11, 21); x.stroke(); x.restore(); };
    var fit = function (t, w) { while (t.length > 3 && x.measureText(t).width > w) t = t.slice(0, -2); return t === arguments[0] ? t : t.replace(/\s+$/, '') + '…'; };
    var logo = function (X, Y) { x.font = '800 20px Poppins, Inter, Arial, sans-serif'; x.fillStyle = dark ? '#fff' : '#14211a'; x.fillText('Golf', X, Y); var a = x.measureText('Golf').width; x.fillStyle = dark ? '#5fd14a' : '#2f8a1f'; x.fillText('Price', X + a, Y); var b = x.measureText('Price').width; x.fillStyle = dark ? '#fff' : '#14211a'; x.fillText(' AI', X + a + b, Y); };
    x.textBaseline = 'alphabetic';
    if (style === 'small') { rr(10, 13, 26, 26, 7); x.fillStyle = '#14211a'; x.fill(); flag(14, 17, 18); x.font = '700 15px Inter, Arial, sans-serif'; x.fillStyle = '#14211a'; x.fillText('Find us on GolfPrice AI', 46, 31); }
    else if (dark) {
      x.font = '700 11px Inter, Arial, sans-serif'; x.fillStyle = '#8fd97c'; x.fillText('NEW MEMBERS WELCOME', 20, 28); logo(20, 54);
      x.font = '500 13px Inter, Arial, sans-serif'; x.fillStyle = '#c4d0c8'; x.fillText(fit('Join ' + S.name + ' →', S.founding ? 250 : 380), 20, 76);
      if (S.founding) { var t = 'FOUNDING No. ' + S.founding; x.font = '700 11px Inter, Arial, sans-serif'; var tw = x.measureText(t).width + 20; rr(W - tw - 18, 34, tw, 24, 12); x.strokeStyle = '#c9a64a'; x.lineWidth = 1; x.stroke(); x.fillStyle = '#e6c66b'; x.fillText(t, W - tw - 8, 50); }
    } else {
      rr(18, 22, 48, 48, 12); x.fillStyle = '#14211a'; x.fill(); flag(29, 33, 26);
      x.font = '700 11px Inter, Arial, sans-serif'; x.fillStyle = '#2f8a1f'; x.fillText('FIND US ON', 80, 30); logo(80, 55);
      x.font = '500 13px Inter, Arial, sans-serif'; x.fillStyle = '#4a554e'; x.fillText(fit(badgeSub(), 320), 80, 76);
    }
    return c;
  }
  function wireBadge() {
    var card = box.querySelector('.hq-badge');
    if (!card || !S.open) return;
    var msg = card.querySelector('.soc-msg');
    card.querySelectorAll('input[name="hq-bstyle"]').forEach(function (r) { r.onchange = function () { BADGE.style = r.value; page(); var c = box.querySelector('.hq-badge input:checked'); if (c) c.focus(); }; });
    card.querySelector('.hq-bcopy').onclick = function () {
      var code = badgeHtml(BADGE.style), done = function () { msg.textContent = 'Copied. Paste it into your website’s Embed or Custom HTML block.'; track('society_badge_copy', { style: BADGE.style }); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, function () { window.prompt('Copy this code:', code); });
      else window.prompt('Copy this code:', code);
    };
    card.querySelector('.hq-bpic').onclick = function () {
      var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      fonts.then(function () {
        badgePng(BADGE.style).toBlob(function (blob) {
          if (!blob) return;
          var name = 'golfpriceai-badge-' + socSlug().slice(0, 40) + '.png';
          track('society_badge_picture', { style: BADGE.style });
          try {
            var f = new File([blob], name, { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [f] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) { navigator.share({ files: [f], text: 'Find ' + S.name + ' on GolfPrice AI: ' + badgeUrl() }).catch(function () {}); return; }
          } catch (e) { /* older browser: download instead */ }
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
          msg.textContent = 'Saved. Your page link: ' + badgeUrl();
        }, 'image/png');
      });
    };
  }
  function league() {
    var el = box.querySelector('#hq-lg');
    if (!el) return;
    api('/lg/mine?s=' + S.id + '&pid=' + pid()).then(function (d) {
      if (!d.ok) return;
      var e = d.entry, table = e ? '/societies/league/?r=' + encodeURIComponent(e.region) + '&d=' + e.division : '/societies/league/';
      var h = '<span class="soc-kick">The National Society League · ' + esc(d.season) + '</span>';
      if (e && !open.lgEdit) {
        h += '<h2>' + (S.organiser ? 'You’re in: ' : 'We’re in the League: ') + esc(e.region) + ' Division ' + e.division + '</h2>' +
          '<p class="soc-help">Every society day you report in the Form Guide counts automatically. ' + (d.open ? 'Matchdays run April to October.' : 'Entries open 1 February; the first matchday is in April.') + (S.organiser ? ' Playing off ' + e.allowance + '% handicap allowance.' : '') + '</p>' +
          '<div class="soc-btns"><a class="soc-btn" href="' + table + '">See the table</a><button type="button" class="soc-btn2 hq-lg-share">Tell the group</button>' + (S.organiser ? '<button type="button" class="soc-btn2 hq-lg-edit">Change details</button>' : '') + '</div>';
      } else if (S.organiser) {
        var cur = e || {};
        h += '<h2>' + (e ? 'League details' : 'Enter ' + esc(S.name) + ' in the League') + '</h2>' +
          '<p class="soc-help">Free. Your society against every other society in your region, with promotion and relegation. Every society day you report in the Form Guide counts automatically.</p>' +
          '<form class="hq-lg-form" novalidate><label>Your region<select name="region"><option value="">Choose…</option>' + d.regions.map(function (r) { return '<option' + (cur.region === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select></label>' +
          '<fieldset class="hq-lg-allow"><legend>Handicap allowance you play off</legend><label><input type="radio" name="allowance" value="95"' + (cur.allowance !== 100 ? ' checked' : '') + '> 95%</label><label><input type="radio" name="allowance" value="100"' + (cur.allowance === 100 ? ' checked' : '') + '> 100%</label>' +
          '<small>Fixed once the season starts on 1 April. Societies on 100% have 1 point taken off their team score, shown on the table.</small></fieldset>' +
          '<div class="hq-lg-rules"><b>The rules, in short</b><span>Each month, your best four stableford scores (one per golfer) make your team score.</span><span>At least four golfers must play for a day to count.</span><span>Scores on the honour system. Anything daft comes off the table.</span></div>' +
          '<label class="hq-lg-check"><input type="checkbox" name="public"' + (cur.public === 0 ? '' : ' checked') + '> Show our society’s name on the League tables</label>' +
          '<label class="hq-lg-check"><input type="checkbox" name="champ"' + (cur.champ ? ' checked' : '') + '> We’d be up for a Champions’ Day if one happens (just showing interest, nothing booked)</label>' +
          '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">' + (e ? 'Save' : d.open ? 'Enter the League' : 'Register early') + '</button>' +
          (e ? '<button type="button" class="soc-btn2 hq-lg-cancel">Cancel</button>' : '<a class="soc-btn2" href="/societies/league/">How it works</a>') + '</div>' +
          (e ? '<button type="button" class="soc-x hq-lg-leave">Leave the League</button>' : '') + '</form>';
      } else {
        h += '<h2>Fancy a league?</h2><p class="soc-help">Your organiser can enter the society in the National Society League, free. Every society day counts towards a regional table.</p><a class="soc-link-a" href="/societies/league/">How the League works →</a>';
      }
      el.innerHTML = h; el.hidden = false;
      var sh = el.querySelector('.hq-lg-share'); if (sh) sh.onclick = function () { track('league_tell'); shareText(S.name + ' are in the National Society League: ' + e.region + ' Division ' + e.division + '. Every society day counts now, so no pressure. Table: ' + SITE + table); };
      var ed = el.querySelector('.hq-lg-edit'); if (ed) ed.onclick = function () { open.lgEdit = true; league(); };
      var cc = el.querySelector('.hq-lg-cancel'); if (cc) cc.onclick = function () { open.lgEdit = false; league(); };
      var lv = el.querySelector('.hq-lg-leave'); if (lv) lv.onclick = function () {
        if (!window.confirm('Take ' + S.name + ' out of the League?')) return;
        api('/lg/leave', { s: S.id }).then(function () { open.lgEdit = false; league(); });
      };
      var f = el.querySelector('.hq-lg-form'); if (f) f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var msg = f.querySelector('.soc-msg'), btn = f.querySelector('[type=submit]');
        if (!f.region.value) { msg.textContent = 'Pick your region.'; return; }
        btn.disabled = true;
        api('/lg/enter', { s: S.id, region: f.region.value, allowance: Number((f.querySelector('[name=allowance]:checked') || {}).value || 95), public: f.public.checked, champ: f.champ.checked }).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
          track('league_enter', { region: r.region }); open.lgEdit = false; league();
        }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
      });
    }).catch(function () {});
  }
  // Par Price league: every member is in, worked out from their daily rounds.
  function ppSc(t) { t = Number(t); return t === 0 ? 'E' : t < 0 ? '−' + Math.abs(t) : '+' + t; }
  function ppAvg(t) { t = Math.round(Number(t) * 100) / 100; return t === 0 ? 'E' : t < 0 ? '−' + Math.abs(t) : '+' + t; }
  function ppLeague() {
    var el = box.querySelector('#hq-pp');
    if (!el) return;
    api('/soc/pp?s=' + S.id + '&pid=' + pid()).then(function (d) {
      if (!d.ok) return;
      var h = '';
      if (!d.on) {
        if (!S.organiser) return;
        h = '<span class="soc-kick">Par Price league · switched off</span><h2>A daily game for the society</h2><p class="soc-help">Five real golf prices a day, scored like a round. Every member is in automatically, with a weekly table, and the society can take on other societies.</p>' +
          '<div class="soc-btns"><button type="button" class="soc-btn hq-pp-on">Switch it on</button></div>';
        el.innerHTML = h; el.hidden = false;
        el.querySelector('.hq-pp-on').onclick = function () { ppSave(true, true); };
        return;
      }
      var t = d.table || [], you = t.filter(function (p) { return p.you; })[0], lead = t[0];
      var left = d.daysLeft === 0 ? 'last day' : d.daysLeft === 1 ? '1 day left' : d.daysLeft + ' days left';
      h += '<span class="soc-kick">Par Price league · this week · ' + left + '</span>';
      h += '<h2>' + (!lead ? 'No rounds yet this week' : t.length > 1 && t[1].week === lead.week ? 'All square at the top' : lead.you ? 'You’re leading ' + esc(S.name) : esc(lead.nick) + ' leads ' + esc(S.name)) + '</h2>';
      h += '<p class="soc-help">Every member’s in. Your best ' + d.best + ' rounds of the week count, Monday to Sunday. A round you can’t play any more counts +' + d.missed + '.</p>';
      if (t.length) {
        var show = t.slice(0, 10);
        if (you && show.indexOf(you) < 0) show.push(you);
        h += '<ol class="hq-pp-table">' + show.map(function (p) {
          var pos = 1 + t.filter(function (x) { return x.week < p.week; }).length;
          return '<li class="' + (p.you ? 'you' : '') + '"><span class="hq-pp-pos">' + pos + '</span><span class="hq-pp-nick">' + esc(p.nick) + (p.you ? ' (you)' : '') + '</span><span class="hq-pp-rds">' + p.rounds + (p.rounds === 1 ? ' round' : ' rounds') + '</span><b' + (p.week > 0 ? ' class="over"' : '') + '>' + ppSc(p.week) + '</b></li>';
        }).join('') + '</ol>';
      }
      h += '<p class="soc-small">' + t.length + ' of ' + d.count + ' members have played this week.</p>';
      if (d.national && d.rank) {
        h += '<div class="hq-pp-nat"><span class="soc-kick">Society v Society</span>' + (d.rank.pos ? '<b>' + esc(S.name) + ' are ' + ordinal(d.rank.pos) + ' of ' + d.rank.of + '</b><span>The best ' + d.team + ' average ' + ppAvg(d.rank.avg) + ' this week.</span>' :
          '<b>' + d.rank.need + ' more ' + (d.rank.need === 1 ? 'member needs' : 'members need') + ' to play</b><span>A society needs ' + d.team + ' members playing in a week to go on the national table.</span>') +
          '<a href="/societies/par-price/">See the national table →</a></div>';
      }
      var last = d.last || [];
      if (last.length >= 2) h += '<p class="hq-pp-last"><b>Last week:</b> ' + esc(last[0].nick) + ' won (' + ppSc(last[0].week) + ')' + (last.length >= 3 ? '. Wooden spoon: ' + esc(last[last.length - 1].nick) : '') + '.</p>';
      h += '<div class="soc-btns">';
      if (!you || you.today === null) h += '<a class="soc-btn" href="/play/par-price/">Play today’s round</a>';
      if (S.organiser && d.waiting && d.waiting.length) h += '<button type="button" class="soc-btn2 hq-pp-nudge">Nudge the ' + d.waiting.length + ' who haven’t played</button>';
      if (t.length >= 2 || last.length >= 2) h += '<button type="button" class="soc-btn2 hq-pp-pic">' + (t.length >= 2 ? 'Share the table' : 'Share last week') + '</button>';
      h += '</div>';
      if (S.organiser) h += '<details class="hq-pp-set"><summary>League settings</summary><label class="hq-lg-check"><input type="checkbox" name="on" checked> Run a Par Price league for the society</label>' +
        '<label class="hq-lg-check"><input type="checkbox" name="national"' + (d.national ? ' checked' : '') + '> Enter the Society v Society table (shows the society’s name and area)</label><p class="soc-msg" role="status"></p></details>';
      el.innerHTML = h; el.hidden = false;
      var nudge = el.querySelector('.hq-pp-nudge');
      if (nudge) nudge.onclick = function () {
        track('soc_pp_nudge');
        shareText('⛳ ' + S.name + ' Par Price: ' + t.length + ' of us have played this week' + (lead ? ' and ' + lead.nick + ' is out in front on ' + ppSc(lead.week) : '') + '. Still to tee off: ' + d.waiting.slice(0, 12).join(', ') + (d.waiting.length > 12 ? ' and more' : '') + '. Two minutes, five golf prices: ' + SITE + '/play/par-price/');
      };
      var pic = el.querySelector('.hq-pp-pic');
      if (pic) pic.onclick = function () {
        var cur = t.length >= 2, rows = cur ? t : last;
        track('soc_pp_picture', { week: cur ? 'this' : 'last' });
        if (!window.gpMilestones || !gpMilestones.shareSociety) return shareText(S.name + ' Par Price table: ' + rows.slice(0, 5).map(function (p, i) { return (i + 1) + '. ' + p.nick + ' ' + ppSc(p.week); }).join(', ') + '. ' + SITE + '/play/par-price/');
        gpMilestones.shareSociety({ soc: S.name, current: cur, left: left, rows: rows.slice(0, 3).map(function (p) { return { nick: p.nick, week: p.week }; }),
          spoon: rows.length >= 4 ? { nick: rows[rows.length - 1].nick, week: rows[rows.length - 1].week, pos: rows.length } : null,
          played: rows.length, count: d.count, rank: cur ? (d.rank && d.rank.pos ? d.rank : null) : d.lastRank }, pic);
      };
      var set = el.querySelector('.hq-pp-set');
      if (set) set.addEventListener('change', function () {
        var on = set.querySelector('[name=on]').checked, nat = set.querySelector('[name=national]');
        if (!on && !window.confirm('Switch off the Par Price league for ' + S.name + '? Members’ own rounds and streaks aren’t touched.')) { set.querySelector('[name=on]').checked = true; return; }
        ppSave(on, nat.checked);
      });
    }).catch(function () {});
  }
  function ppSave(on, national) {
    api('/soc/ppset', { s: S.id, on: on, national: national }).then(function (r) {
      if (!r.ok) { var m = box.querySelector('.hq-pp-set .soc-msg'); if (m) m.textContent = r.error || 'Something went wrong.'; return; }
      track('soc_pp_settings', { on: on, national: national }); ppLeague();
    }).catch(function () {});
  }
  function ordinal(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function alertMsg(art, t) { var p = document.createElement('p'); p.className = 'hq-note'; p.textContent = t || 'Something went wrong.'; art.appendChild(p); }

  function load() {
    return api('/soc/s?s=' + sid + '&pid=' + pid()).then(function (d) {
      if (!d.ok) { box.innerHTML = '<section class="soc-card"><p>' + esc(d.error || 'We couldn’t find that society.') + '</p><a class="soc-btn" href="/societies/hq/">Start a society</a></section>'; forget(sid); return; }
      S = d;
      if (!d.member) return join();
      remember(d.id, d.name);
      page();
    }).catch(function () { box.innerHTML = '<section class="soc-card"><p>We couldn’t reach the clubhouse. Please refresh in a minute.</p></section>'; });
  }
  // A hand-back link from the co-organiser: ?s=<id>&hb=<token>
  var hbTok = (location.search.match(/[?&]hb=([a-z0-9]{16})/) || [])[1];
  function claim() {
    box.innerHTML = '<section class="soc-card"><span class="soc-kick">Society HQ</span><h2>Take back the organiser role?</h2><p class="soc-help">Your co-organiser sent you this link to put you back in charge on this phone. Your member place, sign-ups and paid ticks come with it.</p>' +
      '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="button" class="soc-btn hq-claim">Yes, that’s me</button><a class="soc-btn2" href="?s=' + esc(sid) + '">Not now</a></div></section>';
    box.querySelector('.hq-claim').onclick = function () {
      var b = this, msg = box.querySelector('.soc-msg'); b.disabled = true;
      api('/soc/claim', { t: hbTok }).then(function (r) {
        if (!r.ok) { b.disabled = false; msg.textContent = r.error || 'Something went wrong.'; return; }
        remember(r.id, r.name); track('society_claimed');
        try { history.replaceState(null, '', '?s=' + sid); } catch (e) { /* fine */ }
        keyPrompt('YOU’RE BACK IN CHARGE', 'Save your Clubhouse key this time, so it never comes to this again. It brings ' + r.name + ' back on any phone.', 'Done, take me to my society', function () { load(); }, true);
      }).catch(function () { b.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    };
  }
  if (window.gpKey && gpKey.status().saved) gpKey.sync();
  if (!sid) start(); else if (hbTok) claim(); else load();
})();
