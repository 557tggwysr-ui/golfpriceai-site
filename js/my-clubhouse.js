/* GolfPrice AI: My Clubhouse (/play/my-clubhouse/).
   One personal page with no login. It reads what this browser already keeps
   (the random player id, nickname, streaks, Society HQ list, shortlist, fit and
   bag) and asks the alerts worker for the live parts: leagues, societies and the
   Bag Draft locker. The only new thing it keeps is the price of each shortlisted
   item when it was first seen here (gpWatch), so it can say "down £40 since you
   saved it". Nothing is sent anywhere except the random player id. */
(function () {
  'use strict';
  var box = document.getElementById('mc');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab: fine */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function json(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function gbp(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function niceDay(iso) { var d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ---------------------------------------------------------------- what this browser keeps
  var pid = get('gpPid', '');
  if (!/^[a-z0-9]{12,32}$/.test(pid)) pid = '';
  var nick = String(get('gpNick', '') || '').slice(0, 20);
  var socs = get('gpSocs', []); if (!Array.isArray(socs)) socs = [];
  var shortlist = get('gpShortlist', []); if (!Array.isArray(shortlist)) shortlist = [];
  shortlist = shortlist.filter(function (s) { return /^[a-z0-9-]{3,100}$/.test(s); }).slice(0, 12);
  var wish = get('gpWishlist', []); if (!Array.isArray(wish)) wish = [];
  var fit = get('golfpriceai-fit-profile', null);
  var bag = get('golfpriceai-bag-builder', null);
  var bagCount = bag ? (bag.bagId ? 1 : 0) + (bag.clubIds || []).length + (bag.accessoryIds || []).length : 0;
  var streak = get('gpParStreak', null);
  var card = get('gpParPrice', {});
  var hl = get('gpHL', {});

  // ---------------------------------------------------------------- hello
  var hour = new Date().getHours();
  var hi = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  var anything = pid || socs.length || shortlist.length || wish.length || fit || bagCount || streak;
  if (nick) document.getElementById('mc-hello').textContent = hi + ', ' + nick + '.';
  else if (!anything) {
    document.getElementById('mc-hello').textContent = 'Your locker’s empty. For now.';
    document.getElementById('mc-sub').textContent = 'Play a round, join your golf society or save some kit, and it all turns up here. No sign-up, no password, nothing to remember.';
  }

  if (!anything) { box.innerHTML = starters(); track('my_clubhouse_view', { state: 'new' }); return; }

  // ---------------------------------------------------------------- the live parts, all at once
  var jobs = {
    pp: json('/data/par-price/today.json').catch(function () { return null; }),
    leagues: pid ? json(API + '/pp/my?pid=' + pid).catch(function () { return null; }) : Promise.resolve(null),
    locker: pid ? json(API + '/draft/locker?pid=' + pid).catch(function () { return null; }) : Promise.resolve(null),
    socs: Promise.all(socs.slice(0, 6).map(function (s) {
      return json(API + '/soc/s?s=' + encodeURIComponent(s.id) + (pid ? '&pid=' + pid : '')).then(function (d) { return d && d.ok ? d : null; }).catch(function () { return null; });
    })),
    kit: Promise.all(shortlist.map(function (s) {
      return json('/prices/' + s + '/data.json').then(function (d) { d.slug = s; return d; }).catch(function () { return null; });
    }))
  };
  var keys = Object.keys(jobs);
  Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (r) {
    var got = {}; keys.forEach(function (k, i) { got[k] = r[i]; });
    box.innerHTML = '<div class="mc-col">' + games(got.pp, got.locker) + kit(got.kit) + '</div><div class="mc-col">' + societies(got.socs) + leagues(got.leagues) + alerts() + '</div>';
    track('my_clubhouse_view', { state: 'regular', societies: (got.socs || []).filter(Boolean).length, kit: shortlist.length });
  });

  // ---------------------------------------------------------------- sections
  function head(title, link, label) {
    return '<div class="mc-head"><h2>' + title + '</h2>' + (link ? '<a href="' + link + '">' + label + '</a>' : '') + '</div>';
  }

  function games(pp, locker) {
    var n = pp && pp.n, played = n && card.n === n && (card.guesses || []).length === 5;
    var alive = streak && n && streak.last >= n - 2 ? streak.streak : 0;
    if (n && !played) document.getElementById('mc-play').hidden = false;
    var ppLine = !n ? 'A new round every morning.'
      : played ? 'Played today. ' + (alive ? 'Streak: ' + plural(alive, 'day') + '.' : 'New round tomorrow morning.')
      : 'Not played yet. ' + (alive ? 'Your streak: ' + plural(alive, 'day') + '.' : 'Start a streak today.');
    var html = '<section class="mc-sec mc-today mc-o1"><h2 class="mc-h2">Today</h2>' +
      '<a class="mc-tile mc-wide" href="/play/par-price/"><span class="mc-tile-t"><b>Par Price' + (n ? ' #' + n : '') + '</b><span>' + ppLine + '</span></span>' +
      '<span class="mc-pill' + (played ? ' mc-pill-done' : '') + '">' + (played ? 'Scorecard' : 'Play') + '</span></a><div class="mc-two">';
    var best = Number(hl && hl.best) || 0;
    html += '<a class="mc-tile" href="/play/higher-or-lower/"><span class="mc-small-k">Higher or Lower</span><b class="mc-big">' + (best ? 'Best ' + best : 'New') + '</b><span class="mc-go">' + (best ? 'Beat it' : 'Have a go') + ' →</span></a>';
    var months = (locker && locker.ok && locker.months) || [];
    var champs = months.filter(function (m) { return m.award === 'champion'; }).length;
    html += '<a class="mc-tile" href="' + (months.length ? '/play/locker/' : '/play/draft/') + '"><span class="mc-small-k">Bag Draft</span><b class="mc-big">' +
      (champs ? plural(champs, 'title') : months.length ? plural(months.length, 'Major') : 'Draft') + '</b><span class="mc-go">' + (months.length ? 'Your locker' : 'Pick your bag') + ' →</span></a>';
    return html + '</div></section>';
  }

  function societies(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) return '<section class="mc-sec mc-card mc-o2">' + head('My golf society', '/societies/', 'Society HQ') +
      '<p class="mc-empty">Run a golf society, or play in one? Society HQ does the fixtures, who’s in and who’s paid, free. <a href="/societies/find/">Find a society</a> or <a href="/societies/hq/">start yours</a>.</p></section>';
    var t = today();
    return '<section class="mc-sec mc-card mc-o2">' + head(list.length === 1 ? 'My golf society' : 'My golf societies', '/societies/', 'Society HQ') + list.map(function (s) {
      var meta = plural(s.count, 'member') + (s.founding ? ' · Founding Society No. ' + s.founding : '') + (s.organiser ? ' · You run it' : '');
      var next = (s.events || []).filter(function (e) { return e.day >= t; })[0];
      var inner = '';
      if (next) {
        var ins = (next.entries || []).filter(function (x) { return x.status === 'in'; }).length;
        var mine = (next.entries || []).filter(function (x) { return x.m === s.you; })[0];
        var me = !mine ? 'You haven’t said yet.' : mine.status === 'in' ? 'You’re in.' : mine.status === 'maybe' ? 'You said maybe.' : mine.status === 'wait' ? 'You’re on the waiting list.' : 'You said you’re out.';
        inner = '<span class="mc-next"><span class="mc-next-k">Next golf day</span><b>' + esc(niceDay(next.day)) + (next.venue ? ' · ' + esc(next.venue) : '') + '</b>' +
          '<span>' + plural(ins, 'golfer') + ' in so far. ' + me + '</span></span>';
      } else if (s.member) inner = '<span class="mc-dim">No golf days in the diary yet.</span>';
      return '<a class="mc-row mc-soc" href="/societies/hq/?s=' + encodeURIComponent(s.id) + '"><b class="mc-name">' + esc(s.name) + '</b><span class="mc-dim">' + meta + '</span>' + inner + '</a>';
    }).join('') + '</section>';
  }

  function leagues(d) {
    var mine = (d && d.leagues) || [];
    if (!mine.length) return '<section class="mc-sec mc-card mc-o3">' + head('My leagues', '/play/leagues/', 'Start one') +
      '<p class="mc-empty">Play Par Price against your mates, your four-ball or your golf society. <a href="/play/leagues/">Start a league</a>: it takes ten seconds.</p></section>';
    return '<section class="mc-sec mc-card mc-o3">' + head('My leagues', '/play/leagues/', 'Start one') + mine.map(function (l) {
      return '<a class="mc-row mc-lg" href="/play/league/?l=' + encodeURIComponent(l.id) + '"><b class="mc-name">' + esc(l.name) + '</b><span class="mc-dim">' + plural(l.size, 'golfer') + ' · See the table →</span></a>';
    }).join('') + '</section>';
  }

  function kit(rows) {
    rows = (rows || []).filter(Boolean);
    var watch = get('gpWatch', {}), day = today(), changed = false;
    var items = rows.map(function (d) {
      var now = Number(d.lowestNewPrice);
      var w = watch[d.slug];
      if (!w && now) { w = watch[d.slug] = { p: now, d: day }; changed = true; }
      var diff = w && now ? Math.round((w.p - now) * 100) / 100 : 0;
      var line = diff >= 1 ? '<span class="mc-down">Down ' + gbp(diff) + ' since you saved it</span>'
        : diff <= -1 ? '<span class="mc-dim">' + gbp(-diff) + ' more than when you saved it</span>'
        : '<span class="mc-dim">Same price as when you saved it</span>';
      var pic = d.image ? '<img src="' + esc(d.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
      return '<a class="mc-row mc-item" href="/prices/' + encodeURIComponent(d.slug) + '/?utm_source=clubhouse&amp;utm_medium=watching"><span class="mc-pic">' + pic + '</span>' +
        '<span class="mc-item-t"><b>' + esc(d.name) + '</b>' + line + '</span><b class="mc-price">' + (now ? gbp(now) + (d.unit === 'per dozen' ? '<small>/dozen</small>' : '') : '') + '</b></a>';
    });
    // Forget the saved price of anything taken off the shortlist.
    Object.keys(watch).forEach(function (k) { if (shortlist.indexOf(k) === -1) { delete watch[k]; changed = true; } });
    if (changed) put('gpWatch', watch);
    var extras = [];
    if (fit) extras.push('<span><b>Your fit:</b> your answers are saved. <a href="/find-your-fit.html">See your matches at today’s prices</a></span>');
    if (bagCount) extras.push('<span><b>Your bag:</b> ' + plural(bagCount, 'item') + ' picked. <a href="/build-your-bag.html">Open it</a></span>');
    if (wish.length) extras.push('<span><b>Your gift wishlist:</b> ' + plural(wish.length, 'idea') + '. <a href="/wishlist/?i=' + wish.map(encodeURIComponent).join(',') + '">See it</a></span>');
    var body = items.length ? items.join('')
      : '<p class="mc-empty">Tap <b>Add to four-ball shortlist</b> on any price page and it shows up here, with how much it’s dropped since. <a href="/shop.html">Browse the deals</a></p>';
    return '<section class="mc-sec mc-card mc-o4">' + head('Kit I’m watching', items.length ? '/fourball/list/' : '', 'My shortlist') + body +
      (items.length ? '<p class="mc-note">Lowest new UK price today, across multiple UK retailers. Prices checked every 6 hours.</p>' : '') +
      (extras.length ? '<div class="mc-extras">' + extras.join('') + '</div>' : '') + '</section>';
  }

  function alerts() {
    return '<section class="mc-sec mc-card mc-pad mc-o5"><h2 class="mc-h2s">Price alerts</h2><p class="mc-dim">Your alerts live in your email, so we never need to know who you are. Every alert email has a link to change or stop it. To add one, open any price page and tap <b>Email me when it drops</b>.</p></section>';
  }

  function starters() {
    var c = [
      ['/play/par-price/', 'Play today’s Par Price', 'Guess 5 golf prices. About a minute. Starts your streak.'],
      ['/societies/', 'Find or start your golf society', 'Golf days, who’s in and prize funds, all in Society HQ. Free.'],
      ['/find-your-fit.html', 'Find your fit', 'A few quick taps, then the matches at today’s prices.'],
      ['/shop.html', 'Save kit you’re eyeing up', 'Add it to your shortlist on any price page and we’ll show you when it drops.']
    ];
    return '<h2 class="mc-h2">Four ways to fill it</h2><div class="mc-starts">' + c.map(function (x) {
      return '<a class="mc-start" href="' + x[0] + '"><b>' + x[1] + '</b><span>' + x[2] + '</span></a>';
    }).join('') + '</div><p class="mc-dim mc-have">Already got a Clubhouse on another phone? Use <b>Move my Clubhouse</b> below.</p>';
  }
})();
