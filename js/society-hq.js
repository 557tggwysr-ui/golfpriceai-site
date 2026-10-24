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
  var sid = (location.search.match(/[?&]s=([a-z0-9]{8})/i) || [])[1];
  var S = null, open = {};

  /* ---------------------------------------------------------------- start a society */
  function start() {
    var mine = get('gpSocs', []);
    box.innerHTML = '<section class="soc-hero"><span class="soc-kick">Free · Society HQ</span><h1>Run your society</h1>' +
      '<p>Fixtures, sign-ups, who’s paid and a waiting list that sorts itself, all from one link in the WhatsApp group. No sign-up, no fees.</p></section>' +
      (mine.length ? '<section class="soc-card"><h2>Your societies</h2><ul class="soc-mine">' + mine.map(function (m) { return '<li><a href="?s=' + esc(m.id) + '">' + esc(m.name) + '</a></li>'; }).join('') + '</ul></section>' : '') +
      '<form class="soc-card" id="hq-new" novalidate><h2>Start your society</h2>' + fields({}) +
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
      '<label>Where you play (town or county)<input name="area" maxlength="40" value="' + esc(d.area || '') + '" placeholder="e.g. Leeds"></label>' +
      '<label>About the society (optional)<input name="about" maxlength="240" value="' + esc(d.about || '') + '" placeholder="e.g. Monthly Stableford, all handicaps, one tour a year"></label>' +
      '<label>Your payment link (optional)<input name="pay" maxlength="120" inputmode="url" value="' + esc(d.pay || '') + '" placeholder="https://monzo.me/yourname"></label>' +
      '<p class="soc-small">Your own PayPal.me, Monzo.me or Revolut.me link. Members tap “Pay the organiser” and pay you directly; we never see the money.</p>' +
      '<label class="soc-check"><input type="checkbox" name="open"' + (d.open ? ' checked' : '') + '> Open to new members: list us in Find a Society (name, area and description only)</label>';
  }
  function read(f) { return { name: f.name.value, area: f.area.value, about: f.about.value, pay: f.pay.value.trim(), open: f.open.checked }; }

  /* ---------------------------------------------------------------- join */
  function join() {
    box.innerHTML = '<section class="soc-hero"><span class="soc-kick">' + esc(S.area || 'Golf society') + ' · ' + S.count + (S.count === 1 ? ' member' : ' members') + '</span><h1>' + esc(S.name) + '</h1>' +
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
    return h + '</article>';
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
    var h = '<section class="soc-hero"><span class="soc-kick">' + esc(S.area || 'Golf society') + ' · ' + S.count + (S.count === 1 ? ' member' : ' members') + (S.organiser ? ' · you’re the organiser' : '') + '</span>' +
      '<h1>' + esc(S.name) + '</h1>' + (S.about ? '<p>' + esc(S.about) + '</p>' : '') +
      '<div class="soc-btns"><button type="button" class="soc-btn hq-invite">Invite members</button>' + (S.organiser ? '<button type="button" class="soc-btn2 hq-soc-edit">Edit society</button>' : '') + '</div></section>';
    if (open.editSoc) h += '<form class="soc-card" id="hq-soc" novalidate><h2>Edit society</h2>' + fields(S) + '<p class="soc-msg" role="status"></p><div class="soc-btns"><button type="submit" class="soc-btn">Save</button><button type="button" class="soc-btn2 hq-cancel-soc">Cancel</button></div></form>';
    h += '<section class="soc-card"><h2>Fixtures</h2>' + (up.length ? up.map(function (e) { return open['edit-' + e.id] ? eventForm(e) : eventCard(e, false); }).join('') :
      '<p class="soc-help">' + (S.organiser ? 'No fixtures yet. Add your first one below, then send the sign-up link to the group.' : 'No fixtures yet. The organiser will add them here.') + '</p>') + '</section>';
    if (S.organiser) h += eventForm(null);
    if (past.length) h += '<section class="soc-card"><h2>Recent</h2>' + past.map(function (e) { return eventCard(e, true); }).join('') + '</section>';
    h += '<section class="soc-card"><h2>Members (' + S.members.length + ')</h2><div class="hq-members">' + S.members.map(function (m) {
      return '<span class="hq-mem">' + esc(m.nick) + (m.organiser ? ' <small>organiser</small>' : '') + (S.organiser && !m.organiser ? ' <button type="button" class="hq-rm" data-m="' + esc(m.m) + '" aria-label="Remove ' + esc(m.nick) + '">✕</button>' : '') + '</span>';
    }).join('') + '</div>' + (!S.organiser && me ? '<button type="button" class="soc-x hq-leave">Leave this society</button>' : '') + '</section>';
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
          shareText(S.name + ': ' + e.title + ', ' + nice(e.day, true) + (e.venue ? ' at ' + e.venue : '') + (e.entry ? ' (' + money(e.entry) + ' entry)' : '') + '. In, out or maybe? Tap: ' + invite);
        };
      });
      var fin = art.querySelector('.hq-final'); if (fin) fin.onclick = function () {
        var unpaid = e.entries.filter(function (x) { return x.status === 'in' && !x.paid; }).map(function (x) { return x.nick; });
        var text = S.name + ', ' + e.title + ': numbers go to the club ' + (e.deadline ? 'on ' + nice(e.deadline, true) : 'soon') + '. Not paid = not playing.' +
          (unpaid.length ? ' Still to pay: ' + unpaid.join(', ') + '. No pressure. Well, a bit.' : ' Everyone’s paid. Look at us!') + (S.pay && unpaid.length ? ' Pay here: ' + S.pay + ' ·' : '') + ' Who’s in: ' + invite;
        track('society_final_numbers'); shareText(text);
      };
      var ed = art.querySelector('.hq-edit'); if (ed) ed.onclick = function () { open['edit-' + eid] = true; page(); };
    });
    box.querySelectorAll('.hq-rm').forEach(function (b) {
      b.onclick = function () {
        if (!window.confirm('Remove this member from the society?')) return;
        api('/soc/remove', { s: S.id, m: b.getAttribute('data-m') }).then(function () { load(); });
      };
    });
    var lv = box.querySelector('.hq-leave'); if (lv) lv.onclick = function () {
      if (!window.confirm('Leave ' + S.name + '?')) return;
      api('/soc/leave', { s: S.id }).then(function () { forget(S.id); location.href = '/societies/hq/'; });
    };
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
