/* GolfPrice AI: Par Price, the daily golf price game (/play/par-price/).
   Today's round comes from /data/par-price/today.json (set each morning by
   scripts/par_price.py). Guesses and streak stay in this browser
   (localStorage). When a round ends we send:
     - the Demand Index's anonymous guess ratios (no score, no player), and
     - the round's score for "You beat X% of golfers" and leagues, under a
       random player id this browser made up (gpPid): no name, no email.
   Leagues (nicknames only) live in the alerts worker's database (/pp/...). */
(function () {
  'use strict';
  var root = document.getElementById('pr-game');
  if (!root) return;
  var stage = root.querySelector('.pr-stage');
  var holesEl = root.querySelector('.pr-holes');
  var totalEl = root.querySelector('.pr-total');
  var SCORES = [
    { max: 0.02, name: 'Eagle', short: 'E', pts: -2, emoji: '🦅' },
    { max: 0.05, name: 'Birdie', short: 'B', pts: -1, emoji: '🟩' },
    { max: 0.10, name: 'Par', short: 'P', pts: 0, emoji: '⬜' },
    { max: 0.20, name: 'Bogey', short: 'Bo', pts: 1, emoji: '🟧' },
    { max: Infinity, name: 'Double bogey', short: 'D', pts: 2, emoji: '🟥' }
  ];
  var QUIPS = {
    '-10': 'A perfect round. Are you secretly a golf retailer?', '-6': 'Tour card material. The pro shop is very nervous.',
    '-3': 'Under par. Your wallet and your handicap would be proud.', '-1': 'Under par. Nicely played.',
    '0': 'Level par. Solid, sensible, very golf club committee.', '2': 'A few over. Even the pros have off days.',
    '5': 'Rough day on the course. The prices are still nicer than your scorecard.', '10': 'Lost a few balls out there. Same time tomorrow?'
  };
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function gpSignal(d) { try { navigator.sendBeacon('https://golfpriceai-alerts.golfpriceai.workers.dev/signal', JSON.stringify(d)); } catch (e) { /* counts are a nice-to-have */ } }
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var LAUNCH = Date.UTC(2026, 9, 18);
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
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function weekOf(n) { var d = new Date(LAUNCH + (n - 1) * 864e5); return n - (d.getUTCDay() + 6) % 7; } // round number of that week's Monday
  var GRID = { E: 'E', B: 'B', P: 'P', Bo: 'O', D: 'D' };
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, ''); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function score(guess, price) {
    var off = Math.abs(guess - price) / price;
    for (var i = 0; i < SCORES.length; i++) if (off <= SCORES[i].max + 1e-9) return SCORES[i];
    return SCORES[SCORES.length - 1];
  }
  // Must match quip() in scripts/par_price_cards.py (the picture says the same).
  function shareQuip(t) {
    if (t <= -6) return 'Tour card material. Pro shop nervous.';
    if (t <= -3) return 'Under par and insufferable about it.';
    if (t < 0) return 'Under par. Drinks are on me.';
    if (t === 0) return 'Level par. Sensible. Very committee.';
    if (t <= 4) return 'A few over. The prices won a hole or two.';
    if (t <= 9) return 'Rough round. The prices won comfortably.';
    return 'Ten over. Lost balls, lost guesses.';
  }
  function fmtTotal(t) { return t === 0 ? 'E' : (t > 0 ? '+' + t : '−' + Math.abs(t)); }
  function quip(t) {
    var keys = Object.keys(QUIPS).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < keys.length; i++) if (t <= keys[i]) return QUIPS[String(keys[i])];
    return QUIPS['10'];
  }

  var round, saved;
  fetch('/data/par-price/today.json?n=' + root.getAttribute('data-n'), { cache: 'no-cache' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      round = d;
      saved = get('gpParPrice', {});
      if (saved.n !== d.n) saved = { n: d.n, guesses: [] };
      render();
    })
    .catch(function () { stage.innerHTML = '<p>Today’s round couldn’t load. Please refresh in a minute.</p>'; });

  function results() {
    return saved.guesses.map(function (g, i) { var it = round.items[i]; return { it: it, guess: g, s: score(g, it.price) }; });
  }
  function total() { return results().reduce(function (t, r) { return t + r.s.pts; }, 0); }

  function paintHoles(current) {
    holesEl.innerHTML = '';
    round.items.forEach(function (_, i) {
      var li = el('li', 'pr-hole');
      var r = results()[i];
      if (r) { li.classList.add('pr-s-' + r.s.short.toLowerCase()); li.title = 'Hole ' + (i + 1) + ': ' + r.s.name; }
      else if (i === current) li.classList.add('pr-now');
      holesEl.appendChild(li);
    });
    if (saved.guesses.length) { totalEl.textContent = fmtTotal(total()) + (saved.guesses.length < round.items.length ? ' so far' : ''); totalEl.hidden = false; }
  }

  // Keep the action on screen: after a guess the page gets shorter, which
  // would otherwise leave phones looking at "How it works".
  function bring(el) {
    if (!el) return;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); // close the phone keyboard
    setTimeout(function () {
      var top = el.getBoundingClientRect().top + window.pageYOffset - 84;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, 60);
  }

  function render(justPlayed, moved) {
    var i = saved.guesses.length;
    paintHoles(i);
    stage.innerHTML = '';
    if (justPlayed != null) {
      var box = resultBox(results()[justPlayed], i >= round.items.length);
      stage.appendChild(box);
      bring(holesEl);
      return;
    }
    if (i >= round.items.length) {
      if (round.pin && saved.pin == null) pinHole(); else scorecard();
      if (moved) bring(holesEl);
      return;
    }
    hole(i);
    if (moved) bring(holesEl);
  }

  function hole(i) {
    var it = round.items[i];
    var card = el('div', 'pr-card');
    var pic = el('span', 'pr-pic');
    if (it.image) { var im = document.createElement('img'); im.src = it.image; im.alt = it.name; im.referrerPolicy = 'no-referrer'; im.onerror = function () { pic.classList.add('sg-noimg'); im.remove(); }; pic.appendChild(im); }
    else pic.classList.add('sg-noimg');
    card.appendChild(pic);
    card.appendChild(el('span', 'pr-hole-no', 'Hole ' + (i + 1) + ' of ' + round.items.length + ' · ' + it.type));
    card.appendChild(el('b', 'pr-name', it.name));
    card.appendChild(el('span', 'pr-q', 'What’s its lowest new UK price today' + (it.unit === 'per dozen' ? ', per dozen?' : '?')));
    stage.appendChild(card);
    var form = el('form', 'pr-form');
    form.setAttribute('novalidate', '');
    form.innerHTML = '<label for="pr-guess">Your guess</label><div class="pr-row"><span class="pr-input"><span aria-hidden="true">£</span>' +
      '<input id="pr-guess" inputmode="decimal" autocomplete="off" placeholder="0"></span><button type="submit" class="gp-af-btn">Tee off</button></div>' +
      '<p class="pr-msg" role="status"></p>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = parseFloat(String(form.querySelector('input').value).replace(/[£,\s]/g, ''));
      if (!(v > 0)) { form.querySelector('.pr-msg').textContent = 'Type a price, e.g. 299'; return; }
      saved.guesses.push(Math.round(v * 100) / 100);
      put('gpParPrice', saved);
      track('par_price_hole', { hole: i + 1, score: score(v, it.price).name });
      render(i);
    });
    stage.appendChild(form);
    setTimeout(function () { var inp = form.querySelector('input'); if (inp && window.matchMedia('(min-width: 700px)').matches) inp.focus(); }, 50);
  }

  /* ---------------------------------------------------------- Closest to the Pin */
  function pinOff() { return saved.pin > 0 && round.pin ? Math.round(Math.abs(saved.pin - round.pin.price) * 100) / 100 : null; }
  function pinHole() {
    var it = round.pin;
    var card = el('div', 'pr-card pr-pin-card');
    var pic = el('span', 'pr-pic');
    if (it.image) { var im = document.createElement('img'); im.src = it.image; im.alt = it.name; im.referrerPolicy = 'no-referrer'; im.onerror = function () { pic.classList.add('sg-noimg'); im.remove(); }; pic.appendChild(im); }
    else pic.classList.add('sg-noimg');
    card.appendChild(el('span', 'pr-kicker', 'Bonus hole · Closest to the Pin'));
    card.appendChild(pic);
    card.appendChild(el('b', 'pr-name', it.name));
    card.appendChild(el('span', 'pr-q', 'Exact guess this time. No par, no mercy. Nearest in your league takes the pin.'));
    stage.appendChild(card);
    var form = el('form', 'pr-form');
    form.setAttribute('novalidate', '');
    form.innerHTML = '<label for="pr-guess">Your exact guess' + (it.unit === 'per dozen' ? ' (per dozen)' : '') + '</label><div class="pr-row"><span class="pr-input"><span aria-hidden="true">£</span>' +
      '<input id="pr-guess" inputmode="decimal" autocomplete="off" placeholder="0.00"></span><button type="submit" class="gp-af-btn">Go for the pin</button></div>' +
      '<p class="pr-msg" role="status"></p><button type="button" class="pr-skip">Skip the bonus hole</button>';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = parseFloat(String(form.querySelector('input').value).replace(/[£,\s]/g, ''));
      if (!(v > 0)) { form.querySelector('.pr-msg').textContent = 'Type a price, e.g. 49.99'; return; }
      saved.pin = Math.round(v * 100) / 100;
      put('gpParPrice', saved);
      track('par_price_pin', { off: pinOff() });
      stage.innerHTML = '';
      stage.appendChild(pinResult());
      bring(holesEl);
    });
    form.querySelector('.pr-skip').addEventListener('click', function () {
      saved.pin = -1; put('gpParPrice', saved);
      stage.innerHTML = ''; scorecard(); bring(holesEl);
    });
    stage.appendChild(form);
  }
  function pinResult() {
    var it = round.pin, off = pinOff();
    var box = el('div', 'pr-result ' + (off / it.price <= 0.05 ? 'pr-s-b' : 'pr-s-p'));
    var top = el('div', 'pr-result-top');
    top.appendChild(el('b', 'pr-result-name', off === 0 ? 'In the hole!' : money(off) + ' out'));
    top.appendChild(el('span', null, 'You said ' + money(saved.pin)));
    box.appendChild(top);
    box.appendChild(el('p', 'pr-result-line', 'The ' + it.name + ' is ' + money(it.price) + (it.unit === 'per dozen' ? ' per dozen' : '') + ' today.' +
      (off === 0 ? ' Spot on. Frame it.' : off / it.price <= 0.02 ? ' Tap-in distance.' : off / it.price <= 0.1 ? ' On the green, at least.' : ' Somewhere in the car park.')));
    var row = el('div', 'pr-result-row');
    var a = el('a', null, 'See its prices'); a.href = it.url + '?utm_source=parprice&utm_medium=pin'; row.appendChild(a);
    var next = el('button', 'gp-af-btn', 'See your scorecard'); next.type = 'button';
    next.addEventListener('click', function () { stage.innerHTML = ''; scorecard(); bring(holesEl); });
    row.appendChild(next);
    box.appendChild(row);
    return box;
  }

  function resultBox(r, last) {
    var box = el('div', 'pr-result pr-s-' + r.s.short.toLowerCase());
    var top = el('div', 'pr-result-top');
    top.appendChild(el('b', 'pr-result-name', r.s.name));
    top.appendChild(el('span', null, 'You said ' + money(r.guess)));
    box.appendChild(top);
    box.appendChild(el('p', 'pr-result-line', 'The ' + r.it.name + ' is ' + money(r.it.price) + (r.it.unit === 'per dozen' ? ' per dozen' : '') + ' today' +
      (r.it.low ? ', the lowest price we’ve tracked.' : '.')));
    var row = el('div', 'pr-result-row');
    var a = el('a', null, 'See its prices'); a.href = r.it.url + '?utm_source=parprice&utm_medium=game'; row.appendChild(a);
    var bonus = last && round.pin && saved.pin == null;
    var next = el('button', 'gp-af-btn', bonus ? 'Bonus hole: Closest to the Pin' : last ? 'See your scorecard' : 'Next hole');
    next.type = 'button';
    next.addEventListener('click', function () {
      if (bonus) { stage.innerHTML = ''; pinHole(); bring(holesEl); }
      else if (last) { stage.innerHTML = ''; paintHoles(round.items.length); scorecard(); bring(holesEl); }
      else render(null, true);
    });
    row.appendChild(next);
    box.appendChild(row);
    setTimeout(function () { if (window.matchMedia('(min-width: 700px)').matches) next.focus({ preventScroll: true }); }, 30);
    return box;
  }

  function scorecard() {
    var t = total();
    // Streak: played yesterday's round too.
    var st = get('gpParStreak', { last: 0, streak: 0, best: null });
    var mulliganNow = false;
    if (st.last !== round.n) {
      // The Mulligan: miss one day in a week and the streak survives.
      if (st.last === round.n - 1) st.streak += 1;
      else if (st.last === round.n - 2 && st.mull !== weekOf(round.n)) { st.streak += 1; st.mull = weekOf(round.n); mulliganNow = true; }
      else st.streak = 1;
      st.last = round.n;
      st.best = st.best == null ? t : Math.min(st.best, t);
      put('gpParStreak', st);
      track('par_price_round', { total: t });
      // Anonymous: how far golfers' guesses are from the real prices, for the
      // Demand Index's Wishful Thinking Index. No score, no streak, no visitor.
      gpSignal({ k: 'pp', items: results().map(function (r) { return [r.it.slug, Math.round(r.guess / r.it.price * 1000) / 1000]; }) });
    }
    var head = el('div', 'pr-final');
    head.appendChild(el('span', 'pr-kicker', 'Your round'));
    head.appendChild(el('b', 'pr-final-score', fmtTotal(t)));
    head.appendChild(el('span', 'pr-final-quip', quip(t)));
    stage.appendChild(head);
    var rank = el('div', 'pr-rank');
    rank.innerHTML = '<p class="pr-rank-line">Checking the clubhouse leaderboard…</p>';
    stage.appendChild(rank);
    sendScore(t, rank);
    var table = el('table', 'pp-table pr-table');
    table.innerHTML = '<thead><tr><th scope="col">Hole</th><th scope="col">You</th><th scope="col">Today</th><th scope="col">Score</th></tr></thead>';
    var tb = el('tbody');
    results().forEach(function (r) {
      var tr = el('tr');
      var th = el('th'); th.scope = 'row'; var a = el('a', null, r.it.name); a.href = r.it.url + '?utm_source=parprice&utm_medium=scorecard'; th.appendChild(a);
      // After the round (never before): where to see it, for anyone who's curious.
      var sub = el('span', 'pr-sub');
      if (r.it.low) sub.appendChild(el('span', 'pr-low', 'Lowest we’ve tracked'));
      var see = el('a', 'pr-see', 'Today’s prices ›'); see.href = r.it.url + '?utm_source=parprice&utm_medium=scorecard_link'; sub.appendChild(see);
      th.appendChild(sub);
      tr.appendChild(th);
      tr.appendChild(el('td', null, money(r.guess)));
      tr.appendChild(el('td', 'pr-real', money(r.it.price)));
      tr.appendChild(el('td', 'pr-sc pr-t-' + r.s.short.toLowerCase(), r.s.name));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    var wrap = el('div', 'pp-card pp-table-wrap'); wrap.appendChild(table); stage.appendChild(wrap);
    var share = el('button', 'gp-af-btn pr-share', 'Share my score'); share.type = 'button';
    share.addEventListener('click', function () {
      // Spoiler-free: coloured squares, no prices. The link is a little page
      // with this score's own picture (play/s/, made by
      // scripts/par_price_cards.py), so the chat shows a proper preview card.
      var grid = results().map(function (r) { return r.s.emoji; }).join('');
      var words = t === 0 ? 'level par' : Math.abs(t) + (t > 0 ? ' over par' : ' under par');
      var slug = t === 0 ? 'e' : (t > 0 ? 'p' : 'm') + Math.abs(Math.max(-10, Math.min(10, t)));
      var url = 'https://golfpriceai.com/play/s/' + slug + '/';
      var text = 'Par Price #' + round.n + ': ' + words + ' ⛳\n' + grid + '\n' + shareQuip(t) + '\nCan you beat me? ' + url;
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      track('par_price_share', { total: t });
    });
    stage.appendChild(share);
    var lows = round.items.filter(function (it) { return it.low; }).length;
    var off = pinOff();
    var info = el('p', 'pr-info');
    var mullUsed = st.mull === weekOf(round.n);
    info.innerHTML = (off !== null ? 'Closest to the Pin: <b>' + money(off) + ' out</b> on the ' + esc(round.pin.name) + '.<br>' : '') +
      (lows ? '<b>' + lows + ' of today’s five ' + (lows === 1 ? 'is' : 'are') + ' at the lowest price we’ve tracked.</b><br>' : '') +
      'Your streak: <b>' + st.streak + (st.streak === 1 ? ' day' : ' days') + '</b> · ' +
      (mulliganNow ? 'You missed a day. Mulligan used. We’ll say no more about it.' : mullUsed ? 'Mulligan used this week.' : 'Mulligan ready: miss a day and your streak survives.') +
      ' New round tomorrow morning.';
    stage.appendChild(info);
    var lowItems = round.items.filter(function (it) { return it.low; });
    if (lowItems.length) {
      var tipIt = lowItems[0], holeNo = round.items.indexOf(tipIt) + 1;
      var tip = el('p', 'pr-tip');
      tip.innerHTML = '<b>The caddie’s tip</b> Hole ' + holeNo + ', the ' + esc(tipIt.name) + ', is at the lowest price we’ve tracked. ' +
        'If you’ve been eyeing one up, now’s a decent time. <a href="' + esc(tipIt.url) + '?utm_source=parprice&amp;utm_medium=caddie_tip">See its prices</a>';
      stage.appendChild(tip);
    }
    var lg = el('section', 'pr-leagues');
    lg.innerHTML = '<p class="pr-rank-line">Loading your leagues…</p>';
    stage.appendChild(lg);
    leagues(lg, t);
    stage.appendChild(reminder());
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* ---------------------------------------------------------- "You beat X% of golfers today" */
  function sendScore(t, box) {
    var grid = results().map(function (r) { return GRID[r.s.short]; }).join('');
    var req = saved.sent ? api('/pp/dist?n=' + round.n) : api('/pp/score', { pid: pid(), n: round.n, grid: grid, pin: pinOff() });
    req.then(function (d) {
      if (!d || !d.ok) throw new Error('no');
      if (!saved.sent) { saved.sent = true; put('gpParPrice', saved); }
      drawRank(box, t, d.dist || {});
    }).catch(function () { box.hidden = true; });
  }
  function drawRank(box, t, dist) {
    var all = 0, worse = 0, lo = t, hi = t, peak = 1;
    Object.keys(dist).forEach(function (k) { var v = dist[k], s = Number(k); all += v; if (s > t) worse += v; lo = Math.min(lo, s); hi = Math.max(hi, s); peak = Math.max(peak, v); });
    if (all < 2) { box.innerHTML = '<p class="pr-rank-line">You’re first on the course today. Early bird gets the eagle.</p><p class="pr-rank-note">Check back later to see how you rank against everyone else.</p>'; return; }
    var pct = Math.round(100 * worse / (all - 1));
    lo = Math.min(lo, -3); hi = Math.max(hi, 6);
    var bars = '';
    for (var s = lo; s <= hi; s++) {
      var v = dist[s] || 0;
      bars += '<span class="pr-bar' + (s === t ? ' is-you' : '') + '" style="height:' + Math.max(4, Math.round(100 * v / peak)) + '%" title="' + fmtTotal(s) + ': ' + v + '"></span>';
    }
    var common = Object.keys(dist).sort(function (a, b) { return dist[b] - dist[a]; })[0];
    box.innerHTML = '<p class="pr-rank-line">You beat <b>' + pct + '%</b> of golfers today</p>' +
      '<div class="pr-bars" role="img" aria-label="Today’s scores from everyone who played, with yours highlighted">' + bars + '</div>' +
      '<div class="pr-bars-axis"><span>' + fmtTotal(lo) + '</span><span>' + fmtTotal(hi) + '</span></div>' +
      '<p class="pr-rank-note">' + all + ' golfers played today. Most popular score: ' + fmtTotal(Number(common)) + '. Golf is hard.</p>';
  }

  /* ---------------------------------------------------------- leagues */
  function leagueUrl(id) { return 'https://golfpriceai.com/play/league/?l=' + id; }
  function invite(id, name, nick) {
    var text = (nick || 'Someone') + ' has started a Par Price league: ' + name + '. Five golf prices a day, scored like a round. Loser buys the first round? ' + leagueUrl(id);
    if (navigator.share) navigator.share({ text: text }).catch(function () {});
    else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    track('par_price_league_invite');
  }
  function leagues(box, t) {
    api('/pp/my?pid=' + pid()).then(function (d) {
      var mine = (d && d.leagues) || [];
      var html = '';
      if (mine.length) {
        html += '<h2>Your leagues</h2><ul class="pr-lg-list">' + mine.map(function (l) {
          return '<li><a href="/play/league/?l=' + l.id + '"><b>' + esc(l.name) + '</b><span>' + l.size + (l.size === 1 ? ' golfer' : ' golfers') + ' · See the table</span></a></li>';
        }).join('') + '</ul><details class="pr-lg-more"><summary>Start another league</summary>' + startForm() + '</details>';
      } else {
        html += '<span class="pr-kicker">New · Leagues</span><h2>Fancy some proper competition?</h2>' +
          '<p>Start a league for your group chat. Everyone plays the same five, the table updates itself, and bragging rights are settled daily. Handicaps not required.</p>' + startForm();
      }
      box.innerHTML = html;
      var f = box.querySelector('form');
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var msg = f.querySelector('.pr-msg'), btn = f.querySelector('button');
        var name = f.querySelector('[name=lname]').value, nick = f.querySelector('[name=nick]').value;
        btn.disabled = true; msg.textContent = 'Setting up the first tee…';
        api('/pp/league/create', { pid: pid(), name: name, nick: nick }).then(function (r) {
          btn.disabled = false;
          if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
          put('gpNick', nick);
          track('par_price_league_create');
          box.innerHTML = '<span class="pr-kicker">League started</span><h2>' + esc(r.name) + '</h2>' +
            '<p>Your ' + fmtTotal(t) + ' is already on the table. Now get the others in: one link, straight to the group chat.</p>' +
            '<button type="button" class="gp-af-btn pr-invite">Send the invite</button>' +
            '<p class="pr-lg-link"><a href="/play/league/?l=' + r.id + '">See your league table</a></p>';
          box.querySelector('.pr-invite').addEventListener('click', function () { invite(r.id, r.name, nick); });
        }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
      });
    }).catch(function () { box.hidden = true; });
  }
  function startForm() {
    return '<form class="pr-lg-form" novalidate><label>League name<input name="lname" maxlength="30" placeholder="The Sunday Swingers" autocomplete="off"></label>' +
      '<label>Your nickname<input name="nick" maxlength="20" placeholder="Big Dave" autocomplete="nickname" value="' + esc(get('gpNick', '')) + '"></label>' +
      '<button type="submit" class="gp-af-btn">Start the league</button><p class="pr-msg" role="status"></p>' +
      '<p class="pr-lg-small">No email, no sign-up: just a link for the group chat. Nicknames only. What happens in the league stays in the league.</p></form>';
  }

  /* ---------------------------------------------------------- tee-time reminder */
  function reminder() {
    var f = el('form', 'pr-remind');
    f.setAttribute('novalidate', '');
    f.innerHTML = '<h2>Want a nudge when the round is ready?</h2>' +
      '<fieldset><legend>How often</legend><label><input type="radio" name="freq" value="daily" checked> Every morning</label><label><input type="radio" name="freq" value="weekly"> Mondays</label></fieldset>' +
      '<div class="gp-af-row"><input type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" aria-label="Email"><button type="submit" class="gp-af-btn">Remind me</button></div>' +
      '<p class="pr-msg" role="status" aria-live="polite"></p><p class="pr-lg-small">One short email, unsubscribe any time. We’ll email you once to confirm first. <a href="/legal/privacy-policy.html">Privacy policy</a></p>';
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = f.querySelector('[name=email]').value.trim(), msg = f.querySelector('.pr-msg'), btn = f.querySelector('button');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { msg.textContent = 'Please enter a full email address.'; return; }
      btn.disabled = true; msg.textContent = 'Sending…';
      fetch(API + '/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email, remind: f.querySelector('[name=freq]:checked').value }) })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          btn.disabled = false;
          msg.textContent = !r.ok ? (r.error || 'Something went wrong. Please try again.')
            : r.status === 'added-remind' ? 'Done: your tee-time reminder is on.' : 'Nearly there: check your inbox to confirm.';
          if (r.ok) track('par_price_remind');
        }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
    return f;
  }
})();
