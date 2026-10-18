/* GolfPrice AI: Par Price, the daily golf price game (/play/).
   Today's round comes from /data/par-price/today.json (set each morning by
   scripts/par_price.py). Guesses, streak and best score stay in this browser
   only (localStorage); nothing is sent to us. */
(function () {
  'use strict';
  var root = document.getElementById('pr-game');
  if (!root) return;
  var stage = root.querySelector('.pr-stage');
  var holesEl = root.querySelector('.pr-holes');
  var totalEl = root.querySelector('.pr-total');
  var SCORES = [
    { max: 0.02, name: 'Eagle', short: 'E', pts: -2, emoji: '🦅' },
    { max: 0.05, name: 'Birdie', short: 'B', pts: -1, emoji: '🐦' },
    { max: 0.10, name: 'Par', short: 'P', pts: 0, emoji: '⛳' },
    { max: 0.20, name: 'Bogey', short: 'Bo', pts: 1, emoji: '🟧' },
    { max: Infinity, name: 'Double bogey', short: 'D', pts: 2, emoji: '⬛' }
  ];
  var QUIPS = {
    '-10': 'A perfect round. Are you secretly a golf retailer?', '-6': 'Tour card material. The pro shop is very nervous.',
    '-3': 'Under par. Your wallet and your handicap would be proud.', '-1': 'Under par. Nicely played.',
    '0': 'Level par. Solid, sensible, very golf club committee.', '2': 'A few over. Even the pros have off days.',
    '5': 'Rough day on the course. The prices are still nicer than your scorecard.', '10': 'Lost a few balls out there. Same time tomorrow?'
  };
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, ''); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function score(guess, price) {
    var off = Math.abs(guess - price) / price;
    for (var i = 0; i < SCORES.length; i++) if (off <= SCORES[i].max + 1e-9) return SCORES[i];
    return SCORES[SCORES.length - 1];
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

  function render(justPlayed) {
    var i = saved.guesses.length;
    paintHoles(i);
    stage.innerHTML = '';
    if (justPlayed != null) stage.appendChild(resultBox(results()[justPlayed], i >= round.items.length));
    if (i >= round.items.length) { if (justPlayed == null) scorecard(); return; }
    if (justPlayed != null) return;
    hole(i);
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
    var next = el('button', 'gp-af-btn', last ? 'See your scorecard' : 'Next hole');
    next.type = 'button';
    next.addEventListener('click', function () { if (last) { stage.innerHTML = ''; paintHoles(round.items.length); scorecard(); } else render(); });
    row.appendChild(next);
    box.appendChild(row);
    setTimeout(function () { next.focus({ preventScroll: true }); }, 30);
    return box;
  }

  function scorecard() {
    var t = total();
    // Streak: played yesterday's round too.
    var st = get('gpParStreak', { last: 0, streak: 0, best: null });
    if (st.last !== round.n) {
      st.streak = st.last === round.n - 1 ? st.streak + 1 : 1;
      st.last = round.n;
      st.best = st.best == null ? t : Math.min(st.best, t);
      put('gpParStreak', st);
      track('par_price_round', { total: t });
    }
    var head = el('div', 'pr-final');
    head.appendChild(el('span', 'pr-kicker', 'Your round'));
    head.appendChild(el('b', 'pr-final-score', fmtTotal(t)));
    head.appendChild(el('span', 'pr-final-quip', quip(t)));
    stage.appendChild(head);
    var table = el('table', 'pp-table pr-table');
    table.innerHTML = '<thead><tr><th scope="col">Hole</th><th scope="col">You</th><th scope="col">Today</th><th scope="col">Score</th></tr></thead>';
    var tb = el('tbody');
    results().forEach(function (r) {
      var tr = el('tr');
      var th = el('th'); th.scope = 'row'; var a = el('a', null, r.it.name); a.href = r.it.url + '?utm_source=parprice&utm_medium=scorecard'; th.appendChild(a);
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
      var grid = results().map(function (r) { return r.s.emoji; }).join('');
      var text = 'Par Price #' + round.n + ' · ' + fmtTotal(t) + (t < 0 ? ' under par' : t > 0 ? ' over par' : ' level par') + '\n' + grid + '\nCan you beat me?';
      var url = location.origin + '/play/?utm_source=parprice&utm_medium=share';
      if (navigator.share) navigator.share({ text: text, url: url }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank', 'noopener');
      track('par_price_share', { total: t });
    });
    stage.appendChild(share);
    var lows = round.items.filter(function (it) { return it.low; }).length;
    var info = el('p', 'pr-info');
    info.innerHTML = (lows ? '<b>' + lows + ' of today’s five ' + (lows === 1 ? 'is' : 'are') + ' at the lowest price we’ve tracked.</b> ' : '') +
      'Your streak: <b>' + st.streak + (st.streak === 1 ? ' day' : ' days') + '</b> · New round tomorrow morning.';
    stage.appendChild(info);
    var f = el('form', 'gp-alert-form pr-signup');
    f.setAttribute('novalidate', '');
    f.innerHTML = '<label class="gp-af-label" for="pr-email">Get the Friday email: the week’s genuine price drops</label>' +
      '<div class="gp-af-row"><input id="pr-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required><button type="submit" class="gp-af-btn">Sign me up</button></div>' +
      '<div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<p class="gp-af-small">We’ll email you once to confirm first. <a href="/legal/privacy-policy.html">Privacy policy</a></p><p class="gp-af-msg" role="status" aria-live="polite"></p>';
    stage.appendChild(f);
  }
})();
