/* GolfPrice AI: Society HQ, the society's own page (/societies/hq/?s=<id>).
   No ?s: start a society (the organiser picks a nickname too) or open one this
   phone already belongs to. ?s=<id>: join with a nickname, then the season's
   fixtures, who's in / maybe / out, the waiting list, the organiser's paid
   ticks, a "Pay the organiser" button (the organiser's own PayPal / Monzo /
   Revolut link: no money ever passes through us), the "final numbers"
   message for the WhatsApp group and a prize fund calculator.
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
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn'), body = read(f);
      body.nick = f.nick.value;
      btn.disabled = true; msg.textContent = 'Booking the tee times…';
      api('/soc/new', body).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        remember(r.id, body.name.trim()); track('society_started');
        location.href = '?s=' + r.id;
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
      '<label class="soc-check"><input type="checkbox" name="open"' + (d.open ? ' checked' : '') + '> Open to new members: list us in Find a Society (name, area and description only)</label>';
  }
  function read(f) { return { name: f.name.value, area: f.area.value, county: f.county.value, about: f.about.value, pay: f.pay.value.trim(), open: f.open.checked }; }

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
        remember(sid, S.name); track('society_joined'); load();
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }

  /* ---------------------------------------------------------------- the society page */
  function counts(e) {
    var c = { in: 0, maybe: 0, out: 0, wait: 0, paid: 0 };
    e.entries.forEach(function (x) { c[x.status] = (c[x.status] || 0) + 1; if (x.status === 'in' && x.paid) c.paid++; });
    return c;
  }
  function payLink(amount) {
    if (!S.pay) return '';
    var p = S.pay.replace(/\/+$/, '');
    if (amount > 0 && /(paypal\.me|monzo\.me)\/[^\/]+$/.test(p)) p += '/' + (amount % 1 ? amount.toFixed(2) : amount);
    return p;
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
        (st === 'in' && S.pay && mine && !mine.paid ? '<a class="soc-btn hq-pay" href="' + esc(payLink(e.entry)) + '" target="_blank" rel="noopener">Pay the organiser' + (e.entry ? ' ' + money(e.entry) : '') + '</a><p class="soc-small">Opens the organiser’s own payment link. Once it arrives, they’ll tick you off.</p>' : '') +
        (st === 'in' && mine && mine.paid ? '<p class="hq-note is-good">Paid and confirmed. See you on the first tee.</p>' : '');
    }
    h += '<button type="button" class="hq-more" aria-expanded="' + !!open[e.id] + '">' + (open[e.id] ? 'Hide who’s playing' : 'Who’s playing') + (S.organiser ? ' and who’s paid' : '') + '</button>';
    if (open[e.id]) h += whoList(e, c, past);
    if (S.organiser && !past) {
      h += '<div class="hq-org"><button type="button" class="soc-btn2 hq-share">Send the sign-up link</button>' +
        (c.in ? '<button type="button" class="soc-btn2 hq-final">Final numbers message</button>' : '') +
        '<button type="button" class="soc-btn2 hq-edit">Edit</button></div>';
    } else if (!past) h += '<button type="button" class="soc-link hq-share">Send the sign-up link to someone</button>';
    h += fgLinks(e, past);
    if (open['res-' + e.id]) h += resultsForm(e);
    return h + '</article>';
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
    if (S.organiser && c.in) h += '<p class="hq-note">Only paid players are confirmed: <b>' + c.paid + ' of ' + c.in + '</b>.</p>';
    h += list.map(function (x) {
      var label = { in: 'In', wait: 'Waiting list', maybe: 'Maybe', out: 'Out' }[x.status];
      return '<div class="hq-row"><span class="hq-nick">' + esc(x.nick) + (x.m === S.you ? ' (you)' : '') + '<small>' + label + '</small></span>' +
        (S.organiser && x.status === 'in' ? '<button type="button" class="hq-paid' + (x.paid ? ' is-paid' : '') + '" data-m="' + esc(x.m) + '" aria-pressed="' + x.paid + '">' + (x.paid ? 'Paid ✓' : 'Not paid') + '</button>'
          : x.status === 'in' && x.paid ? '<span class="hq-tag">Paid</span>' : '') + '</div>';
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
  function eventForm(e) {
    e = e || {};
    return '<form class="soc-card hq-evf" data-id="' + esc(e.id || '') + '" novalidate><h2>' + (e.id ? 'Edit the fixture' : 'Add a fixture') + '</h2>' +
      '<label>Name of the day<input name="title" maxlength="50" required value="' + esc(e.title || '') + '" placeholder="Spring Stableford"></label>' +
      '<div class="soc-two"><label>Date<input type="date" name="day" required value="' + esc(e.day || '') + '"></label><label>First tee<input type="time" name="tee" value="' + esc(e.tee || '') + '"></label></div>' +
      '<label>Course<input name="venue" maxlength="60" value="' + esc(e.venue || '') + '" placeholder="Course name"></label>' +
      '<div class="soc-two"><label>Society entry £ (optional)<input name="entry" inputmode="decimal" value="' + esc(e.entry || '') + '" placeholder="15"></label><label>Places (optional)<input name="cap" inputmode="numeric" value="' + esc(e.cap || '') + '" placeholder="e.g. 24"></label></div>' +
      '<label>Final numbers to the club by (optional)<input type="date" name="deadline" value="' + esc(e.deadline || '') + '"></label>' +
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
    if (open.editSoc) h += '<form class="soc-card" id="hq-soc" novalidate><h2>Edit society</h2>' + fields(S) + '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">Save</button><button type="button" class="soc-btn2 hq-cancel-soc">Cancel</button></div></form>';
    h += '<section class="soc-card"><h2>Fixtures</h2>' + (up.length ? up.map(function (e) { return open['edit-' + e.id] ? eventForm(e) : eventCard(e, false); }).join('') :
      '<p class="soc-help">' + (S.organiser ? 'No fixtures yet. Add your first one below, then send the sign-up link to the group.' : 'No fixtures yet. The organiser will add them here.') + '</p>') + '</section>';
    if (S.organiser) h += eventForm(null);
    h += '<section class="soc-card hq-lg" id="hq-lg" hidden></section>';
    if (past.length) h += '<section class="soc-card"><h2>Recent</h2>' + past.map(function (e) { return eventCard(e, true); }).join('') + '</section>';
    h += '<section class="soc-card"><h2>Members (' + S.members.length + ')</h2><div class="hq-members">' + S.members.map(function (m) {
      return '<span class="hq-mem">' + esc(m.nick) + (m.organiser ? ' <small>organiser</small>' : '') + (S.organiser && !m.organiser ? ' <button type="button" class="hq-rm" data-m="' + esc(m.m) + '" aria-label="Remove ' + esc(m.nick) + '">✕</button>' : '') + '</span>';
    }).join('') + '</div>' + (!S.organiser && me ? '<button type="button" class="soc-x hq-leave">Leave this society</button>' : '') + '</section>' +
      (!S.organiser ? '<p class="soc-small hq-another">Run another golf society? <a href="/societies/hq/">Start one free</a>, it takes a minute.</p>' : '');
    h += '<section class="soc-card soc-next"><span class="soc-kick">End of the season?</span><h2>The Awards Night Kit</h2><p>Award cards, a slideshow for the big night and prizes your winners pick themselves.</p><a class="soc-btn" href="/societies/awards/">Make your awards</a></section>';
    box.innerHTML = h;
    wire();
  }
  function wire() {
    var invite = SITE + '/societies/hq/?s=' + S.id;
    box.querySelector('.hq-invite').onclick = function () { track('society_invite'); shareText('Join ' + S.name + ' on Society HQ: fixtures, sign-ups and who’s paid in one place. Tap, pick a nickname, done: ' + invite); };
    var se = box.querySelector('.hq-soc-edit'); if (se) se.onclick = function () { open.editSoc = !open.editSoc; page(); };
    var cs = box.querySelector('.hq-cancel-soc'); if (cs) cs.onclick = function () { open.editSoc = false; page(); };
    var fs = box.querySelector('#hq-soc');
    if (fs) fs.addEventListener('submit', function (e) {
      e.preventDefault(); var msg = fs.querySelector('.soc-msg'), b = read(fs); b.s = S.id;
      api('/soc/edit', b).then(function (r) { if (!r.ok) { msg.textContent = r.error; return; } open.editSoc = false; remember(S.id, b.name.trim()); load(); });
    });
    box.querySelectorAll('.hq-evf').forEach(function (f) {
      var eid = f.getAttribute('data-id');
      f.addEventListener('submit', function (ev) {
        ev.preventDefault(); var msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn');
        var b = { s: S.id, e: eid || undefined, title: f.title.value, day: f.day.value, tee: f.tee.value, venue: f.venue.value, entry: f.entry.value.replace(/[£\s]/g, ''), cap: f.cap.value, deadline: f.deadline.value, notes: f.notes.value };
        btn.disabled = true; msg.textContent = 'Pencilling it in…';
        api('/soc/event', b).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
          if (eid) open['edit-' + eid] = false; else track('society_fixture_added');
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
          b.disabled = true;
          api('/soc/rsvp', { e: eid, status: b.getAttribute('data-st') }).then(function (r) { if (r.ok) { track('society_rsvp', { status: r.status }); load(); } else { b.disabled = false; alertMsg(art, r.error); } });
        };
      });
      var more = art.querySelector('.hq-more'); if (more) more.onclick = function () { open[eid] = !open[eid]; page(); };
      art.querySelectorAll('.hq-paid').forEach(function (b) {
        b.onclick = function () {
          var paid = b.getAttribute('aria-pressed') !== 'true'; b.disabled = true;
          api('/soc/paid', { e: eid, m: b.getAttribute('data-m'), paid: paid }).then(function () { load(); });
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
        var text = S.name + ', ' + e.title + ': numbers go to the club ' + (e.deadline ? 'on ' + nice(e.deadline, true) : 'soon') + '. Not paid = not playing.' +
          (unpaid.length ? ' Still to pay: ' + unpaid.join(', ') + '. No pressure. Well, a bit.' : ' Everyone’s paid. Look at us!') + (S.pay && unpaid.length ? ' Pay here: ' + S.pay + ' ·' : '') + ' Who’s in: ' + invite + ' (Society HQ, free for golf societies)';
        track('society_final_numbers'); shareText(text);
      };
      var ed = art.querySelector('.hq-edit'); if (ed) ed.onclick = function () { open['edit-' + eid] = true; page(); };
      art.querySelectorAll('.hq-fg-share').forEach(function (b) {
        b.onclick = function () {
          var rep = b.getAttribute('data-kind') === 'report';
          track('society_fg_share', { kind: b.getAttribute('data-kind') });
          shareText(rep ? 'The report is in: ' + S.name + ', ' + e.title + '. Who won, who didn’t and who’s buying the bacon rolls: ' + fgUrl(e)
            : 'The Form Guide for ' + e.title + (e.venue ? ' at ' + e.venue : '') + ' is out. Who’s in form, who’s the dark horse: ' + fgUrl(e));
        };
      });
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
    var lv = box.querySelector('.hq-leave'); if (lv) lv.onclick = function () {
      if (!window.confirm('Leave ' + S.name + '?')) return;
      api('/soc/leave', { s: S.id }).then(function () { forget(S.id); location.href = '/societies/hq/'; });
    };
  }
  /* ---- The National Society League: enter (organiser) or see where we are (members) */
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
  if (!sid) start(); else load();
})();
