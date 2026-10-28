/* GolfPrice AI: My Clubhouse (/play/my-clubhouse/), v2.
   One personal page with no login. It reads what this browser already keeps
   (the random player id, nickname, streaks, Society HQ list, shortlist, fit and
   bag) and asks the alerts worker for the live parts: leagues (with your place
   this week), societies and the Bag Draft locker. The only new thing it keeps is
   the price of each shortlisted item when it was first saved (gpWatch), so it can
   say "down £40 since you saved it". Nothing is sent anywhere except the random
   player id.

   Layout: one full-width row per kind of thing (games, societies, leagues, kit),
   each a grid that adapts to how many cards it holds, so the page stays balanced
   whether a golfer has none, one or six of something. */
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
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function niceDay(iso) { var d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; }
  function pad(n) { return String(n).padStart(2, '0'); }
  var NOW = new Date(), TODAY = NOW.getFullYear() + '-' + pad(NOW.getMonth() + 1) + '-' + pad(NOW.getDate()), MONTH = TODAY.slice(0, 7);

  // ---------------------------------------------------------------- what this browser keeps
  var pid = get('gpPid', '');
  if (!/^[a-z0-9]{12,32}$/.test(pid)) pid = '';
  var nick = String(get('gpNick', '') || '').slice(0, 20);
  var socs = get('gpSocs', []); if (!Array.isArray(socs)) socs = [];
  var shortlist = get('gpShortlist', []); if (!Array.isArray(shortlist)) shortlist = [];
  shortlist = shortlist.filter(function (s) { return /^[a-z0-9-]{3,100}$/.test(s); }).slice(0, 12);
  var wish = get('gpWishlist', []); if (!Array.isArray(wish)) wish = [];
  var fit = get('golfpriceai-fit-profile', null);
  var bag = get('golfpriceai-bag-builder', null) || {};
  var bagIds = [].concat(bag.bagId ? [bag.bagId] : [], bag.clubIds || [], bag.accessoryIds || []).filter(function (x) { return typeof x === 'string' && x.length < 200; }).slice(0, 30);
  var streak = get('gpParStreak', null);
  var card = get('gpParPrice', {});
  var hl = get('gpHL', {});

  // ---------------------------------------------------------------- hello
  var hour = NOW.getHours();
  var hi = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  var anything = pid || socs.length || shortlist.length || wish.length || fit || bagIds.length || streak;
  if (nick) document.getElementById('mc-hello').textContent = hi + ', ' + nick + '.';
  else if (!anything) {
    document.getElementById('mc-hello').textContent = 'Your locker’s empty. For now.';
    document.getElementById('mc-sub').textContent = 'Play a round, join your golf society or save some kit, and it all turns up here. No sign-up, no password, nothing to remember.';
  }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }
  gpUse('mc_view');
  if (!anything) { box.innerHTML = starters(); track('my_clubhouse_view', { state: 'new' }); return; }

  // ---------------------------------------------------------------- the live parts, all at once
  var jobs = {
    pp: json('/data/par-price/today.json').catch(function () { return null; }),
    hl: json('/data/higher-or-lower/today.json').catch(function () { return null; }),
    majors: json('/data/draft/majors.json').catch(function () { return null; }),
    leagues: pid ? json(API + '/pp/my?pid=' + pid).catch(function () { return null; }) : Promise.resolve(null),
    locker: pid ? json(API + '/draft/locker?pid=' + pid).catch(function () { return null; }) : Promise.resolve(null),
    socs: Promise.all(socs.slice(0, 6).map(function (s) {
      return json(API + '/soc/s?s=' + encodeURIComponent(s.id) + (pid ? '&pid=' + pid : '')).then(function (d) { return d && d.ok ? d : null; }).catch(function () { return null; });
    })),
    kit: Promise.all(shortlist.map(function (s) {
      return json('/prices/' + s + '/data.json').then(function (d) { d.slug = s; return d; }).catch(function () { return null; });
    })),
    bag: bagItems(bagIds)
  };
  var keys = Object.keys(jobs);
  Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (r) {
    var g = {}; keys.forEach(function (k, i) { g[k] = r[i]; });
    var soc = (g.socs || []).filter(Boolean), lg = (g.leagues && g.leagues.leagues) || [];
    var bits = [];
    if (soc.length) bits.push(plural(soc.length, 'golf society', 'golf societies'));
    if (lg.length) bits.push(plural(lg.length, 'league'));
    if (shortlist.length) bits.push(plural(shortlist.length, 'thing') + ' you’re watching');
    if (nick && bits.length) document.getElementById('mc-sub').textContent = bits.join(' · ') + '. Saved on this device, no sign-up.';
    box.innerHTML = games(g.pp, g.hl, g.locker, g.majors) +
      (soc.length || lg.length ? societies(soc) + leagues(lg) : group()) +
      kit(g.kit, g.bag) +
      '<div class="mc-pair">' + alerts() + '</div>';
    // Move my Clubhouse sits beside Price alerts on wide screens.
    var mv = document.getElementById('move'), pair = box.querySelector('.mc-pair');
    if (mv && pair) pair.appendChild(mv);
    track('my_clubhouse_view', { state: 'regular', societies: soc.length, leagues: lg.length, kit: shortlist.length, bag: bagIds.length });
  });

  // ---------------------------------------------------------------- helpers for sections
  function row(title, count, link, label, inner, cls) {
    return '<section class="mc-row-sec' + (cls ? ' ' + cls : '') + '"><div class="mc-row-head"><h2>' + title + (count ? ' <span>· ' + count + '</span>' : '') + '</h2>' +
      (link ? '<a href="' + link + '">' + label + '</a>' : '') + '</div>' + inner + '</section>';
  }
  function tile(href, kicker, big, line, go, cls) {
    return '<a class="mc-game' + (cls ? ' ' + cls : '') + '" href="' + href + '"><span class="mc-k">' + kicker + '</span><b class="mc-big">' + big + '</b>' +
      '<span class="mc-dim">' + line + '</span><span class="mc-go">' + go + '</span></a>';
  }

  // ---------------------------------------------------------------- My games
  function games(pp, hlDay, locker, majors) {
    var html = '';
    // Par Price
    var n = pp && pp.n, played = n && card.n === n && (card.guesses || []).length === 5;
    var alive = streak && n && streak.last >= n - 2 ? streak.streak : 0;
    if (n && !played) document.getElementById('mc-play').hidden = false;
    if (played) {
      var t = card.guesses.reduce(function (sum, g, i) {
        var it = pp.items[i]; if (!it) return sum;
        var off = Math.abs(g - it.price) / it.price;
        return sum + (off <= 0.02 ? -2 : off <= 0.05 ? -1 : off <= 0.10 ? 0 : off <= 0.20 ? 1 : 2);
      }, 0);
      html += tile('/play/par-price/', 'Par Price #' + n, t === 0 ? 'Level par' : Math.abs(t) + (t > 0 ? ' over' : ' under'),
        'Played today' + (alive ? ' · ' + alive + '-day streak' : ''), 'Your scorecard →', 'mc-done');
    } else {
      html += tile('/play/par-price/', 'Par Price' + (n ? ' #' + n : ''), 'Ready to play',
        alive ? 'Keep your ' + alive + '-day streak going' : 'Guess 5 golf prices. About a minute.', '<span class="mc-btn">Play today’s round</span>', 'mc-live');
    }
    // Higher or Lower
    var best = Number(hl && hl.best) || 0, hlDone = hlDay && hl && hl.n === hlDay.n && hl.done;
    html += tile('/play/higher-or-lower/', 'Higher or Lower', hlDone ? 'Run of ' + (Number(hl.streak) || 0) : best ? 'Best run: ' + best : 'Not played yet',
      hlDone ? 'Played today' + (best ? ' · best ' + best : '') : best ? 'Today’s run not played yet' : 'Which costs more? One run a day.',
      hlDone ? 'Free play →' : best ? 'Beat it →' : 'Have a go →', hlDone ? 'mc-done' : '');
    // Bag Draft
    var months = (locker && locker.ok && locker.months) || [];
    var mine = months.filter(function (m) { return m.season === MONTH; })[0];
    var major = majors && majors[MONTH.slice(5)];
    var champs = months.filter(function (m) { return m.award === 'champion'; }).length;
    html += tile(mine ? '/play/locker/' : '/play/draft/', 'Bag Draft' + (major ? ' · ' + esc(MONTHS[+MONTH.slice(5) - 1]) : ''),
      mine ? 'Drafted' : 'Not drafted',
      mine ? (champs ? plural(champs, 'champion bag') + ' in your locker' : plural(months.length, 'Major') + ' played') : (major ? esc(major.name) : 'Pick a bag on a budget. Win the month.'),
      mine ? 'Your locker →' : 'Pick your bag →', mine ? 'mc-done' : '');
    return row('My games', 0, '/play/', 'All games in the Clubhouse', '<div class="mc-games">' + html + '</div>');
  }

  // ---------------------------------------------------------------- Societies
  function societies(list) {
    if (!list.length) return row('My golf society', 0, '', '', '<a class="mc-strip" href="/societies/"><b>Run a golf society, or play in one?</b> <span>Society HQ does the fixtures, who’s in and who’s paid, free. Find or start one →</span></a>');
    var cards = list.map(function (s) {
      var meta = plural(s.count, 'member') + (s.founding ? ' · Founding Society No. ' + s.founding : '') + (s.organiser ? ' · You run it' : '');
      var next = (s.events || []).filter(function (e) { return e.day >= TODAY; })[0], inner;
      if (next) {
        var ins = (next.entries || []).filter(function (x) { return x.status === 'in'; }).length;
        var mine = (next.entries || []).filter(function (x) { return x.m === s.you; })[0];
        var me = !mine ? 'You haven’t said yet.' : mine.status === 'in' ? 'You’re in.' : mine.status === 'maybe' ? 'You said maybe.' : mine.status === 'wait' ? 'You’re on the waiting list.' : 'You said you’re out.';
        inner = '<span class="mc-next' + (mine ? '' : ' mc-warn') + '"><span class="mc-next-k">' + (mine ? 'Next golf day' : 'Next golf day · reply needed') + '</span><b>' + esc(niceDay(next.day)) + (next.venue ? ' · ' + esc(next.venue) : '') + '</b>' +
          '<span>' + plural(ins, 'golfer') + ' in so far. ' + me + '</span></span>';
      } else if (s.organiser) inner = '<span class="mc-next mc-warn"><span class="mc-next-k">Needs you</span><b>No golf day in the diary yet</b><span>Add one and the group gets the link.</span></span>';
      else if (s.member) inner = '<span class="mc-next mc-quiet"><span class="mc-next-k">Next golf day</span><b>Nothing in the diary yet</b></span>';
      else inner = '<span class="mc-next mc-quiet"><b>Have a look and join</b></span>';
      return '<a class="mc-card mc-soc" href="/societies/hq/?s=' + encodeURIComponent(s.id) + '"><b class="mc-name">' + esc(s.name) + '</b><span class="mc-dim">' + meta + '</span>' + inner + '</a>';
    });
    return row(list.length === 1 ? 'My golf society' : 'My golf societies', list.length > 1 ? list.length : 0, '/societies/find/', 'Find or start a society',
      '<div class="mc-grid mc-grid-soc mc-n' + Math.min(list.length, 3) + '">' + cards.join('') + '</div>');
  }

  // ---------------------------------------------------------------- Leagues
  function leagues(mine) {
    if (!mine.length) return row('My leagues', 0, '', '', '<a class="mc-strip" href="/play/leagues/"><b>Play against your mates?</b> <span>Start a Par Price league for your four-ball or society. Ten seconds →</span></a>');
    var cards = mine.map(function (l) {
      var pos = l.rank ? (l.tied ? '=' : '') + ord(l.rank) : '';
      return '<a class="mc-card mc-lg" href="/play/league/?l=' + encodeURIComponent(l.id) + '"><span class="mc-lg-t"><b class="mc-name">' + esc(l.name) + '</b>' +
        '<span class="mc-dim">' + plural(l.size, 'golfer') + (pos ? ' · this week' : ' · see the table') + '</span></span>' +
        (pos ? '<b class="mc-pos' + (l.rank === 1 ? ' mc-pos-1' : '') + '">' + pos + '</b>' : '<span class="mc-go">→</span>') + '</a>';
    });
    return row('My leagues', mine.length > 1 ? mine.length : 0, '/play/leagues/', 'Start a league',
      '<div class="mc-grid mc-grid-lg mc-n' + Math.min(mine.length, 3) + '">' + cards.join('') + '</div>');
  }

  // Neither a society nor a league yet: one tidy row instead of two empty ones.
  function group() {
    return row('Play with your group', 0, '', '', '<div class="mc-grid mc-n2">' +
      '<a class="mc-card mc-invite" href="/societies/"><b class="mc-name">Your golf society</b><span class="mc-dim">Fixtures, who’s in and who’s paid, all from one WhatsApp link. Free.</span><span class="mc-go">Find or start a society →</span></a>' +
      '<a class="mc-card mc-invite" href="/play/leagues/"><b class="mc-name">A league with your mates</b><span class="mc-dim">Par Price every morning, scored against each other in a weekly table.</span><span class="mc-go">Start a league →</span></a></div>');
  }

  // ---------------------------------------------------------------- My kit
  function kit(rows, bagRows) {
    return row('My kit', 0, '', '', '<div class="mc-grid mc-kit">' + watching(rows) + myBag(bagRows) + myFit() + '</div>');
  }
  function panel(title, sub, body, link, label) {
    return '<div class="mc-card mc-panel"><div class="mc-panel-h"><b>' + title + '</b><span>' + sub + '</span></div>' + body +
      '<a class="mc-panel-go" href="' + link + '">' + label + '</a></div>';
  }
  function watching(rows) {
    rows = (rows || []).filter(Boolean);
    var watch = get('gpWatch', {}), changed = false;
    var items = rows.slice(0, 4).map(function (d) {
      var now = Number(d.lowestNewPrice), w = watch[d.slug];
      if (!w && now) { w = watch[d.slug] = { p: now, d: TODAY }; changed = true; }
      var diff = w && now ? Math.round((w.p - now) * 100) / 100 : 0;
      var line = diff >= 1 ? '<span class="mc-down">Down ' + gbp(diff) + '</span>' : diff <= -1 ? '<span class="mc-dim">Up ' + gbp(-diff) + '</span>' : '<span class="mc-dim">Same price</span>';
      var pic = d.image ? '<img src="' + esc(d.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '';
      return '<a class="mc-item" href="/prices/' + encodeURIComponent(d.slug) + '/?utm_source=clubhouse&amp;utm_medium=watching"><span class="mc-pic">' + pic + '</span>' +
        '<span class="mc-item-t"><b>' + esc(d.name) + '</b>' + line + '</span><b class="mc-price">' + (now ? gbp(now) : '') + '</b></a>';
    });
    Object.keys(watch).forEach(function (k) { if (shortlist.indexOf(k) === -1) { delete watch[k]; changed = true; } });
    if (changed) put('gpWatch', watch);
    if (!items.length) return panel('Watching', 'Nothing saved yet',
      '<p class="mc-panel-p">Tap <b>Add to four-ball shortlist</b> on any price page and it shows up here, with how much it’s dropped since.</p>', '/shop.html', 'Browse today’s deals →');
    return panel('Watching', 'Your shortlist, with drops since you saved it', '<div class="mc-items">' + items.join('') + '</div>' +
      (rows.length > 4 ? '<p class="mc-panel-p mc-dim">+ ' + (rows.length - 4) + ' more</p>' : ''), '/fourball/list/', 'See the shortlist →');
  }
  function myBag(items) {
    items = (items || []).filter(Boolean);
    if (!bagIds.length) return panel('My bag', 'From Assemble Your Arsenal',
      '<p class="mc-panel-p">Build your dream bag, club by club, and see what it costs at today’s prices.</p>', '/build-your-bag.html', 'Build my bag →');
    var total = items.reduce(function (s, x) { return s + x.price; }, 0);
    var pics = items.filter(function (x) { return x.image; }).slice(0, 4);
    var more = bagIds.length - pics.length;
    var grid = '<div class="mc-bag-pics">' + pics.map(function (x) {
      return '<span class="mc-pic"><img src="' + esc(x.image) + '" alt="" title="' + esc(x.name) + '" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>';
    }).join('') + (more > 0 ? '<span class="mc-pic mc-more">+' + more + '</span>' : '') + '</div>';
    var sum = items.length ? '<div class="mc-bag-sum"><b>' + gbp(Math.round(total)) + '</b><span>' + plural(items.length, 'item') + ' at today’s lowest UK prices' +
      (items.length < bagIds.length ? ' (' + (bagIds.length - items.length) + ' no longer listed)' : '') + '</span></div>'
      : '<div class="mc-bag-sum"><span>' + plural(bagIds.length, 'item') + ' picked</span></div>';
    return panel('My bag', 'From Assemble Your Arsenal', grid + sum, '/build-your-bag.html', 'Open my bag →');
  }
  var FIT = {
    club: { driver: 'Driver', irons: 'Irons', woods: 'Fairway or hybrid', wedges: 'Wedges', putter: 'Putter', set: 'Full set', ball: 'Golf balls' },
    hcp: { low: 'Handicap 0–9', mid: 'Handicap 10–18', high: 'Handicap 19–28', 'new': 'Handicap 29+ or new' },
    dist: { 1: '7-iron under 110 yds', 2: '7-iron 110–130 yds', 3: '7-iron 130–150 yds', 4: '7-iron 150–170 yds', 5: '7-iron 170+ yds' },
    miss: { slice: 'Miss: slice', hook: 'Miss: hook', thin: 'Miss: thin', fat: 'Miss: fat', straight: 'Pretty straight', all: 'Miss: a bit of everything' },
    flight: { low: 'Low flight', mid: 'Mid flight', high: 'High flight' },
    hand: { right: 'Right-handed', left: 'Left-handed' },
    shaft: { ladies: 'Women’s shafts' },
    budget: { value: 'Best value budget', mid: 'Middle ground budget', premium: 'Premium budget' },
    bdist: { 1: 'Driver under 200 yds', 2: 'Driver 200–230 yds', 3: 'Driver 230–260 yds', 4: 'Driver 260+ yds' },
    bwant: { dist: 'Wants distance', green: 'Wants greenside spin', feel: 'Wants soft feel', cheap: 'Tough and cheap' },
    blost: { 1: 'Loses 0–1 a round', 2: 'Loses about 2', 3: 'Loses 3–4', 5: 'Loses 5+' },
    bcol: { white: 'White', yellow: 'Yellow', matte: 'Matte or coloured' },
    bbud: { value: 'Under £25 a dozen', mid: '£25–£40 a dozen', prem: '£40+ a dozen' }
  };
  function myFit() {
    var a = fit && fit.answers;
    if (!a || !a.club) return panel('My fit', 'Not done yet',
      '<p class="mc-panel-p">A few quick taps and we’ll show the clubs or balls that suit your game, at today’s prices.</p>', '/find-your-fit.html', 'Find your fit →');
    var order = a.club === 'ball' ? ['bdist', 'bwant', 'blost', 'bcol', 'bbud'] : ['hcp', 'dist', 'miss', 'flight', 'hand', 'shaft', 'budget'];
    var chips = order.map(function (k) { return FIT[k] && FIT[k][a[k]]; }).filter(Boolean);
    return panel('My fit', 'From Find Your Fit · ' + esc(FIT.club[a.club] || 'Your answers'),
      '<div class="mc-chips">' + chips.map(function (c) { return '<span>' + esc(c) + '</span>'; }).join('') + '</div>', '/find-your-fit.html', 'See my matches at today’s prices →');
  }

  // Bag items: name, price and photo from the small lookup files the email
  // worker uses (data/lookup/<first two hex of SHA-1(id)>.json).
  function bagItems(ids) {
    if (!ids.length || !window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve([]);
    return Promise.all(ids.map(function (id) {
      return crypto.subtle.digest('SHA-1', new TextEncoder().encode(id)).then(function (h) { return [id, ('0' + new Uint8Array(h)[0].toString(16)).slice(-2)]; });
    })).then(function (pairs) {
      var shards = {};
      pairs.forEach(function (p) { shards[p[1]] = 1; });
      return Promise.all(Object.keys(shards).map(function (s) {
        return json('/data/lookup/' + s + '.json').then(function (d) { shards[s] = d; }).catch(function () { shards[s] = {}; });
      })).then(function () {
        return pairs.map(function (p) { var r = shards[p[1]] && shards[p[1]][p[0]]; return r ? { name: r[0], price: Number(r[1]) || 0, image: r[4] } : null; });
      });
    }).catch(function () { return []; });
  }

  function alerts() {
    return '<section class="mc-card mc-alerts"><b class="mc-name">Price alerts</b><span class="mc-dim">They live in your email, so we never need to know who you are. To add one, tap <b>Email me when it drops</b> on any price page.</span></section>';
  }

  function starters() {
    var c = [
      ['/play/par-price/', 'Play today’s Par Price', 'Guess 5 golf prices. About a minute. Starts your streak.'],
      ['/societies/', 'Find or start your golf society', 'Golf days, who’s in and prize funds, all in Society HQ. Free.'],
      ['/find-your-fit.html', 'Find your fit', 'A few quick taps, then the matches at today’s prices.'],
      ['/shop.html', 'Save kit you’re eyeing up', 'Add it to your shortlist on any price page and we’ll show you when it drops.']
    ];
    return '<section class="mc-row-sec"><div class="mc-row-head"><h2>Four ways to fill it</h2></div><div class="mc-grid mc-starts">' + c.map(function (x) {
      return '<a class="mc-card mc-start" href="' + x[0] + '"><b class="mc-name">' + x[1] + ' <span>→</span></b><span class="mc-dim">' + x[2] + '</span></a>';
    }).join('') + '</div></section><p class="mc-dim mc-have">Already got a Clubhouse on another phone? Use <b>Move my Clubhouse</b> below.</p>';
  }
})();
