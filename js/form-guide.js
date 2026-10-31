/* The Form Guide (/societies/form-guide/?e=<event>): a society day's preview
   before it, and the report after it, written for the group chat. Everything
   comes from the alerts worker (/soc/fg): nicknames and points only. */
(function () {
  'use strict';
  var box = document.getElementById('fg');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  var eid = (location.search.match(/[?&]e=([a-z0-9]{8})/i) || [])[1];
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function nice(iso) { return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }); }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function share(text) {
    gpUse('fg_share');
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  var ms = null;
  function milestones() {
    if (window.gpMilestones) return Promise.resolve(window.gpMilestones);
    if (!ms) ms = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/js/milestones.js?v=20261101b'; s.onload = function () { ok(window.gpMilestones); }; s.onerror = no; document.head.appendChild(s); });
    return ms;
  }
  function initials(n) { var p = String(n).trim().split(/\s+/); return ((p[0] || '')[0] + ((p[1] || '')[0] || (p[0] || '')[1] || '')).toUpperCase(); }
  function formChips(f, played) {
    if (!played) return '<span class="fg-chip fg-debut">Debut</span>';
    var l = f.slice(); while (l.length < 3) l.push('–');
    return l.map(function (v) { return '<span class="fg-chip' + (v === 1 ? ' fg-win' : '') + '">' + (typeof v === 'number' ? ord(v) : esc(v)) + '</span>'; }).join('');
  }
  function oomBlock(d, n) {
    if (!d.oom || !d.oom.length || d.events < 2) return '';
    return '<section class="fg-card fg-dark"><span class="fg-kick fg-kick-l">THE ORDER OF MERIT · ' + esc(d.season) + '</span>' +
      d.oom.slice(0, n).map(function (o, i) { return '<div class="fg-oom"><b>' + (i + 1) + '</b><span>' + esc(o.nick) + '<small>' + o.played + (o.played === 1 ? ' day' : ' days') + (o.wins ? ' · ' + o.wins + (o.wins === 1 ? ' win' : ' wins') : '') + '</small></span><strong>' + o.pts + '</strong></div>'; }).join('') +
      '<p class="fg-small">25 points for a win, 18 for second, down to 1 for tenth.</p></section>';
  }
  function head(d, kind) {
    var meta = [d.venue, nice(d.day), d.tee ? 'first tee ' + d.tee : ''].filter(Boolean).join(' · ');
    return '<span class="fg-kick' + (kind === 'report' ? '' : ' fg-kick-l') + '">THE FORM GUIDE · ' + (kind === 'report' ? 'REPORT' : 'PREVIEW') + '</span>' +
      '<span class="fg-soc">' + esc(d.soc.name) + '</span>' + (kind === 'report' ? '<span class="fg-soc">' + esc(d.title) + '</span>' : '<h1>' + esc(d.title) + '</h1>') +
      (kind === 'report' ? '' : '<span class="fg-meta">' + esc(meta) + '</span>');
  }
  function hqLink(d) {
    return d.member ? '<a class="fg-btn2" href="/societies/hq/?s=' + esc(d.soc.id) + '">Open Society HQ</a>' : '<a class="fg-btn2" href="/societies/hq/?s=' + esc(d.soc.id) + '">Join ' + esc(d.soc.name) + '</a>';
  }

  function preview(d) {
    var n = d.field.length, today = new Date().toISOString().slice(0, 10);
    var quips = [n + ' golfers, one trophy and plenty of opinions. Here’s how the field shapes up.',
      n + ' golfers, ' + Math.ceil(n / 4) + (Math.ceil(n / 4) === 1 ? ' four-ball' : ' four-balls') + ' and a lot of practice swings. Here’s the form.',
      'The field is in. The excuses are being prepared. Here’s how it looks.'];
    var h = '<section class="fg-hero">' + head(d, 'preview') +
      '<div class="fg-stats"><div><b>' + n + '</b><small>in the field</small></div><div><b>' + Math.ceil(n / 4) + '</b><small>' + (Math.ceil(n / 4) === 1 ? 'four-ball' : 'four-balls') + '</small></div><div><b class="fg-green">' + d.waiting + '</b><small>on the waiting list</small></div></div></section>';
    if (!n) {
      h += '<section class="fg-card"><p>Nobody’s signed up yet. The field appears here as golfers say they’re in on Society HQ.</p>' + hqLink(d) + '</section>';
      box.innerHTML = h; return;
    }
    h += '<p class="fg-quip">' + esc(quips[n % quips.length]) + '</p>';
    if (d.watch.length) h += '<span class="fg-kick">PLAYERS TO WATCH</span><div class="fg-watch">' + d.watch.map(function (w) {
      return '<div class="fg-w"><span class="fg-av' + (w.tag === 'Dark horse' ? ' fg-av-o' : '') + '" aria-hidden="true">' + esc(initials(w.nick)) + '</span><span><b>' + esc(w.nick) + ' · ' + esc(w.tag) + '</b><small>' + esc(w.line) + '</small></span></div>';
    }).join('') + '</div>';
    else if (!d.events) h += '<p class="fg-small">The first Form Guide of the season. Once results go in, you’ll see everyone’s form here, plus who to watch.</p>';
    h += '<section class="fg-card"><div class="fg-card-h"><b>The field</b><small>Form: last three finishes</small></div>' +
      d.field.map(function (f) { return '<div class="fg-row"><b>' + esc(f.nick) + '</b><span class="fg-form">' + formChips(f.form, f.played) + '</span></div>'; }).join('') + '</section>';
    h += oomBlock(d, 5);
    h += '<section class="fg-card fg-dark"><span class="fg-kick fg-kick-l">BEFORE YOU GO</span><p class="fg-p-l">How many shots do you get? <a href="/improve/course-handicap-calculator/">Course handicap calculator</a>. Running low on balls? <a href="/prices/golf-balls/">Today’s ball prices</a>.</p></section>';
    h += '<div class="fg-btns"><button type="button" class="fg-btn" data-act="share">Send to the group chat</button>' + hqLink(d) + '</div>';
    if (d.organiser && d.day <= today) h += '<p class="fg-small">You’re the organiser. <a href="/societies/hq/?s=' + esc(d.soc.id) + '">Enter the results in Society HQ</a> and this page becomes the report.</p>';
    box.innerHTML = h;
    box.querySelector('[data-act="share"]').onclick = function () { track('fg_share', { kind: 'preview' }); share('The Form Guide for ' + d.title + (d.venue ? ' at ' + d.venue : '') + ' is out. Who’s in form, who’s the dark horse: ' + SITE + '/societies/form-guide/?e=' + d.id); };
  }

  function report(d) {
    var w = d.winner, lb = d.leaderboard, ok = lb.filter(function (r) { return !r.nr; });
    var h = '<section class="fg-hero fg-hero-g">' + head(d, 'report') + '<h1>' + esc(d.headline || d.title) + '</h1>' +
      (w ? '<span class="fg-meta">' + w.pts + ' points' + (d.venue ? ' at ' + esc(d.venue) : '') + ' · ' + esc(nice(d.day)) + '</span>' : '') + '</section>';
    if (d.line) h += '<p class="fg-quip">“' + esc(d.line) + '” <small>The organiser</small></p>';
    if (d.story && d.story.length) h += '<div class="fg-story">' + d.story.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>';
    h += '<section class="fg-card"><div class="fg-card-h"><b>The leaderboard</b><small>Stableford points</small></div>' + lb.map(function (r, i) {
      var cb = r.cb && i > 0 && ok[i - 1] && ok[i - 1].pts === r.pts && !r.nr;
      return '<div class="fg-lb' + (r.me ? ' fg-me' : '') + '"><b class="fg-pos p' + (r.pos || 0) + '">' + (r.nr ? '–' : r.pos) + '</b><span>' + esc(r.nick) + (r.me ? ' (you)' : '') + (cb ? ' <small>(countback)</small>' : '') + '</span><b>' + (r.nr ? 'NR' : r.pts) + '</b></div>';
    }).join('') + '</section>';
    if (d.awards.length) h += '<div class="fg-awards">' + d.awards.map(function (a) {
      return '<div class="fg-aw' + (a.spoon ? ' fg-spoon' : '') + '"><small>' + esc(a.t.toUpperCase()) + '</small><b>' + esc(a.who) + '</b><span>' + esc(a.line) + '</span></div>';
    }).join('') + '</div>';
    h += oomBlock(d, 5);
    if (w && d.prize) h += '<section class="fg-card"><b class="fg-h3">' + esc(w.nick) + '’s prize</b><p class="fg-p">' + esc(w.nick) + ' picks a £' + d.prize + ' prize from real golf kit at today’s lowest UK prices.</p>' +
      (d.prizeUrl ? '<button type="button" class="fg-btn2" data-act="prize">Send ' + esc(w.nick) + ' the prize link</button><p class="fg-small">Only you can see this button. Send it to the winner, nobody else.</p>' : '') + '</section>';
    h += '<div class="fg-btns"><button type="button" class="fg-btn" data-act="share">Share the report</button>' + (w ? '<button type="button" class="fg-btn2" data-act="card">Winner’s card</button>' : '') + '</div>' +
      '<p class="fg-small">' + hqLink(d).replace('fg-btn2', 'fg-link') + '</p>';
    box.innerHTML = h;
    var card = w ? { kind: 'socwin', date: d.day, d: { who: w.nick, pts: w.pts, title: d.title, society: d.soc.name, venue: d.venue, day: d.day, first: w.first } } : null;
    box.querySelector('[data-act="share"]').onclick = function () { track('fg_share', { kind: 'report' }); share('The report is in: ' + d.soc.name + ', ' + d.title + '. ' + (d.headline || '') + ' ' + SITE + '/societies/form-guide/?e=' + d.id); };
    var c = box.querySelector('[data-act="card"]'); if (c) c.onclick = function () { milestones().then(function (m) { m.open(card, false); }); };
    var pz = box.querySelector('[data-act="prize"]'); if (pz) pz.onclick = function () { share('You won ' + d.title + '! Pick your £' + d.prize + ' prize from real golf kit at today’s prices: ' + SITE + d.prizeUrl); };
    // The winner gets the card on their Milestones shelf.
    if (w && w.me) milestones().then(function (m) { m.award('socwin_' + d.id, 'socwin', card.d); }).catch(function () {});
  }

  if (!eid) { box.innerHTML = '<section class="fg-card"><p>Open a Form Guide from your society’s page in Society HQ.</p><a class="fg-btn" href="/societies/hq/">Society HQ</a></section>'; return; }
  gpUse('fg_view');
  var p = get('gpPid', '');
  fetch(API + '/soc/fg?e=' + eid + (/^[a-z0-9]{12,32}$/.test(p) ? '&pid=' + p : '')).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { box.innerHTML = '<section class="fg-card"><p>' + esc(d.error || 'We couldn’t find that society day.') + '</p></section>'; return; }
    document.title = d.title + ' · ' + d.soc.name + ' | The Form Guide | GolfPrice AI';
    if (d.phase === 'report') report(d); else preview(d);
  }).catch(function () { box.innerHTML = '<section class="fg-card"><p>We couldn’t reach the clubhouse. Please refresh in a minute.</p></section>'; });
})();
