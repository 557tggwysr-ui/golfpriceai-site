/*
  GolfPrice AI — "Find Your Fit" (rebuilt Oct 2026, to the approved mock-up)
  --------------------------------------------------
  Eight questions, one at a time, with a "Your answers" rail you can jump
  back from. The result gives a suggested flex, loft, club type and length,
  says why, and shows 3 matching models that have a price page, at today's
  lowest price, filtered by club type, left-handed stock and budget.

  The models come from the search index (data/search/<type>.json, built
  every 6 hours by scripts/search_index.py), so nothing here is invented:
  every price is a live retailer price. Answers are kept on this device
  (localStorage) so a returning visitor goes straight to their result.

  This is a general fitting-chart guide, not a fitting. The page says so.
*/
(function () {
  'use strict';

  var STORAGE_KEY = 'golfpriceai-fit-profile';
  var F_LEFT = 1, F_IN_STOCK = 2, F_DROP = 4, F_USED = 8;

  var Q = [
    { k: 'club', r: 'Club', t: 'What are you shopping for?', h: 'We’ll tailor the result to the club.', o: [
      ['driver', 'Driver', 'Distance off the tee'], ['irons', 'Irons', 'The heart of the bag'], ['woods', 'Fairway or hybrid', 'Long approaches'],
      ['wedges', 'Wedges', 'Scoring clubs'], ['putter', 'Putter', 'Where it all goes wrong'], ['set', 'Full set', 'Starting fresh']] },
    { k: 'hcp', r: 'Handicap', t: 'What’s your handicap?', h: 'A rough guess is fine. No one’s checking.', cls: 'four', o: [
      ['low', '0–9', 'Low single figures'], ['mid', '10–18', 'Solid club golfer'], ['high', '19–28', 'Getting there'], ['new', '29+ or new', 'Just started']] },
    { k: 'dist', r: '7-iron distance', t: 'How far do you hit a 7-iron?', h: 'Carry distance, on a decent strike. Honesty helps more than ego here.', o: [
      ['1', 'Under 110 yards', ''], ['2', '110–130 yards', ''], ['3', '130–150 yards', ''], ['4', '150–170 yards', ''], ['5', '170+ yards', ''], ['0', 'Not sure', 'We’ll go middle of the road']] },
    { k: 'miss', r: 'Usual miss', t: 'What’s your usual miss?', h: 'The one that turns up when it matters.', o: [
      ['slice', 'Slice', 'Starts left, ends up right'], ['hook', 'Hook', 'Curls hard left'], ['thin', 'Thin or topped', 'Skulls and worm-burners'],
      ['fat', 'Fat', 'Divot before the ball'], ['straight', 'Pretty straight', 'Lucky you'], ['all', 'All of the above', 'A bit of everything']] },
    { k: 'flight', r: 'Ball flight', t: 'How high does the ball fly?', h: 'Think about your mid-irons.', cls: 'four', o: [
      ['low', 'Low', 'Penetrating, runs out'], ['mid', 'Mid', 'Normal-looking'], ['high', 'High', 'Balloons in the wind'], ['unsure', 'Not sure', '']] },
    { k: 'height', r: 'Height and hand', t: 'How tall are you?', h: 'Helps us flag if standard length might not suit you.', cls: 'four', o: [
      ['s', 'Under 5′7″', ''], ['m', '5′7″–6′0″', ''], ['t', '6′0″–6′3″', ''], ['xt', 'Over 6′3″', '']],
      sub: { k: 'hand', p: 'Which hand?', o: [['right', 'Right-handed'], ['left', 'Left-handed']] } },
    { k: 'shaft', r: 'Shaft range', t: 'Which shaft range?', h: 'Women’s flex usually suits slower swing speeds better than Senior.', cls: 'two', o: [
      ['std', 'Standard range', 'Senior to X-Stiff'], ['ladies', 'Women’s range', 'Ladies flex and up']] },
    { k: 'budget', r: 'Budget', t: 'What’s your budget?', h: 'For the club, or each club if you picked a full set.', cls: 'four', o: [
      ['value', 'Best value', 'The cheapest third of matching models'], ['mid', 'Middle ground', 'Sensible money'], ['premium', 'Premium', 'The good stuff'], ['any', 'Don’t mind', 'Show me what fits best']] }
  ];

  var A = { hand: 'right' };
  var step = 0;
  var rail = document.getElementById('fyf-rail');
  var stage = document.getElementById('fyf-stage');
  if (!rail || !stage) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function label(q) { var o = q.o.filter(function (x) { return x[0] === A[q.k]; })[0]; return o ? o[1] : ''; }
  function answered(i) { return !!A[Q[i].k]; }
  function track(name, params) { if (window.gtag) gtag('event', name, params || {}); }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ answers: A, saved: new Date().toISOString(), version: 2 })); } catch (e) { /* storage blocked: fine */ }
  }
  function load() {
    try {
      var p = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (p && p.version === 2 && p.answers) { A = p.answers; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  /* ---------------------------------------------------------------- the rail */
  function firstUnanswered() { for (var i = 0; i < Q.length; i++) { if (!answered(i)) return i; } return Q.length; }
  function drawRail() {
    var allDone = firstUnanswered() >= Q.length;
    rail.innerHTML = Q.map(function (q, i) {
      var cls = i === step ? 'on' : (answered(i) ? 'done' : '');
      var can = answered(i) || i <= firstUnanswered();
      return '<li><button type="button" class="' + cls + '" data-i="' + i + '"' + (can ? '' : ' disabled') + ' aria-label="Question ' + (i + 1) + ': ' + esc(q.r) + (answered(i) ? ', ' + esc(label(q)) : '') + '">' +
        '<span class="fyf-dot">' + (answered(i) && i !== step ? '✓' : i + 1) + '</span>' +
        '<span class="fyf-rail-label">' + esc(q.r) + '<small>' + esc(answered(i) ? label(q) : '') + '</small></span></button></li>';
    }).join('') +
      '<li><button type="button" class="' + (step === Q.length ? 'on' : '') + '" data-i="' + Q.length + '"' + (allDone ? '' : ' disabled') + ' aria-label="Your fit">' +
      '<span class="fyf-dot">★</span><span class="fyf-rail-label">Your fit</span></button></li>';
  }
  rail.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.disabled) return;
    step = +b.getAttribute('data-i');
    draw(true);
  });

  function draw(focus) {
    drawRail();
    if (step >= Q.length) result(); else question();
    if (focus) {
      var h = stage.querySelector('h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      if (window.innerWidth < 860) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------------------------------------------------------------- a question */
  // "Skip" picks the middle-of-the-road answer, shown plainly in the rail.
  var DEFAULTS = { club: 'irons', hcp: 'mid', dist: '0', miss: 'all', flight: 'unsure', height: 'm', shaft: 'std', budget: 'any' };
  function question() {
    var q = Q[step];
    var opts = q.o.map(function (o) {
      return '<button type="button" class="fyf-opt" data-v="' + o[0] + '" aria-pressed="' + (A[q.k] === o[0]) + '"><b>' + esc(o[1]) + '</b>' + (o[2] ? '<span>' + esc(o[2]) + '</span>' : '') + '</button>';
    }).join('');
    var sub = q.sub ? '<div class="fyf-sub"><p>' + esc(q.sub.p) + '</p><div class="fyf-seg" role="group" aria-label="' + esc(q.sub.p) + '">' +
      q.sub.o.map(function (o) { return '<button type="button" data-s="' + o[0] + '" aria-pressed="' + (A[q.sub.k] === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>' : '';
    var last = step === Q.length - 1;
    stage.innerHTML = '<div class="fyf-bar" aria-hidden="true"><i style="width:' + (step / Q.length * 100) + '%"></i></div>' +
      '<div class="fyf-q"><span class="fyf-qnum">Question ' + (step + 1) + ' of ' + Q.length + '</span><h2>' + esc(q.t) + '</h2><p class="fyf-help">' + esc(q.h) + '</p>' +
      '<div class="fyf-opts' + (q.cls ? ' ' + q.cls : '') + '">' + opts + '</div>' + sub + '</div>' +
      '<div class="fyf-nav"><button type="button" class="fyf-btn" id="fyf-back"' + (step ? '' : ' disabled') + '>← Back</button>' +
      (A[q.k] ? '' : '<button type="button" class="fyf-skip" id="fyf-skip">Not sure, skip this</button>') +
      '<button type="button" class="fyf-btn primary" id="fyf-next"' + (A[q.k] ? '' : ' disabled') + '>' + (last ? 'See my fit →' : 'Next →') + '</button></div>';
    stage.querySelectorAll('.fyf-opt').forEach(function (b) {
      b.onclick = function () {
        A[q.k] = b.getAttribute('data-v');
        // The height question also asks which hand, so stay put there.
        if (q.sub) { draw(false); return; }
        next();
      };
    });
    stage.querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { A[q.sub.k] = b.getAttribute('data-s'); draw(false); }; });
    document.getElementById('fyf-back').onclick = function () { step--; draw(true); };
    document.getElementById('fyf-next').onclick = next;
    var skip = document.getElementById('fyf-skip');
    if (skip) skip.onclick = function () { A[q.k] = DEFAULTS[q.k]; next(); };
  }
  function next() {
    // On to the first unanswered question; once all 8 are in, the result.
    step = firstUnanswered();
    if (step >= Q.length) { step = Q.length; track('fit_complete', { club: A.club, handicap: A.hcp }); }
    save();
    draw(true);
  }

  /* ---------------------------------------------------------------- the fit itself */
  // General fitting-chart rules, as in the mock-up John approved.
  function computeFit() {
    var speed = { '1': 'slow', '2': 'slow', '3': 'moderate', '4': 'fast', '5': 'very-fast', '0': 'moderate' }[A.dist] || 'moderate';
    var flex = A.shaft === 'ladies'
      ? { slow: 'Ladies', moderate: 'Ladies', fast: 'Regular', 'very-fast': 'Stiff' }[speed]
      : { slow: 'Senior', moderate: 'Regular', fast: 'Stiff', 'very-fast': 'X-Stiff' }[speed];
    var kind = A.hcp === 'low' ? 'players' : A.hcp === 'mid' ? 'gi' : 'sgi';
    var kindLabel = { players: 'Players or players-distance', gi: 'Game-improvement', sgi: 'Super game-improvement' }[kind];
    var draw = A.miss === 'slice' && ['driver', 'woods', 'set'].indexOf(A.club) !== -1;
    var loft;
    if (A.club === 'driver' || A.club === 'set') {
      loft = { low: '9°–10.5°', mid: '10.5°–12°', high: '12°–14°', new: '13°–16°' }[A.hcp];
      if (A.club === 'set') loft = 'Driver ' + loft;
    } else if (A.club === 'woods') {
      loft = A.hcp === 'low' ? '15° wood, 19°–21° hybrid' : '16.5°–18° wood, 21°–24° hybrid';
    } else if (A.club === 'wedges') {
      loft = '50° / 54° / 58°';
    } else if (A.club === 'putter') {
      loft = 'Standard (3°–4°)';
    } else {
      loft = A.flight === 'low' ? 'Standard, or a higher-launch set' : 'Standard lofts';
    }
    var len = { s: 'Standard, maybe −½″', m: 'Standard', t: 'Standard to +½″', xt: '+½″ to +1″' }[A.height] || 'Standard';
    var typeCard = A.club === 'putter'
      ? (kind === 'players' ? 'Blade or mallet' : 'Mallet')
      : A.club === 'wedges'
        ? (A.miss === 'fat' || kind !== 'players' ? 'Wide sole, more bounce' : 'Standard sole')
        : kindLabel;
    var typeSub = A.club === 'putter' ? 'Steadier on off-centre strikes' : A.club === 'wedges' ? 'Kinder on heavy strikes' : (draw ? 'With draw-bias' : 'Neutral bias');
    return { flex: flex, kind: kind, kindLabel: kindLabel, draw: draw, loft: loft, len: len, typeCard: typeCard, typeSub: typeSub };
  }

  var NOUN = { driver: 'driver', irons: 'irons', woods: 'fairway woods and hybrids', wedges: 'wedges', putter: 'putter', set: 'clubs for a full set' };
  var NOUN_PL = { driver: 'drivers', irons: 'irons', woods: 'fairways and hybrids', wedges: 'wedges', putter: 'putters', set: 'clubs' };

  function whyList(f) {
    var why = [];
    if (A.club !== 'putter') {
      why.push(A.dist === '0'
        ? 'Without a 7-iron distance we’ve gone middle of the road: a ' + f.flex + ' shaft suits most club golfers.'
        : { '1': 'A 7-iron under 110 yards', '2': 'A 110–130 yard 7-iron', '3': 'A 130–150 yard 7-iron', '4': 'A 150–170 yard 7-iron', '5': 'A 7-iron over 170 yards' }[A.dist] + ' usually means a ' + f.flex + ' shaft.');
    }
    if (A.miss === 'slice') why.push('A slice is often helped by a draw-bias head and a slightly softer flex, so we’ve leaned that way.');
    if (A.miss === 'hook') why.push('A hook usually means avoiding draw-bias heads, so we’ve left those out of the top picks.');
    if (A.miss === 'thin') why.push('Thin strikes are kinder with a wide sole and a low centre of gravity, so we’ve favoured those.');
    if (A.miss === 'fat') why.push('Fat shots are kinder with more bounce and a wider sole, so we’ve favoured those.');
    if (A.club === 'putter') why.push(f.kind === 'players' ? 'At your level a blade or a mallet both work: it’s down to what looks right to you.' : 'Mallets stay steadier on off-centre strikes, which is where most putts are lost.');
    else why.push(f.kindLabel + ' heads suit a ' + label(Q[1]) + ' handicap: ' + (f.kind === 'players' ? 'more control and feel, less help on mishits.' : 'more forgiveness on off-centre hits.'));
    if (A.flight === 'low' && A.club !== 'putter') why.push('Your ball flight is low, so a little more loft or a higher-launching head will help carry.');
    if (A.height === 'xt' || A.height === 't') why.push('At your height a fitter may suggest slightly longer clubs. Worth asking before you buy.');
    if (A.height === 's') why.push('At your height standard length is usually fine, but a fitter may suggest a touch shorter.');
    if (A.hand === 'left') why.push('We only show left-handed versions that are in stock today.');
    return why;
  }

  /* ---------------------------------------------------------------- matching models */
  var SHARDS = {};
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function shard(cat) { if (!SHARDS[cat]) SHARDS[cat] = getJSON('/data/search/' + cat + '.json').then(function (d) { d.cat = cat; return d; }); return SHARDS[cat]; }

  var GI_RX = /\b(max|10k|hl|sft|draw|launcher|halo|xl|big bertha|ultralite|lite|offset|os|hot metal|t350|t300|zx4|elyte x|dcb|g4[0-4]0|g425|dynapwr|xr|hd|full-face|full face|cavity|qi|mallet|spider|2-ball|jailbird|fang|ten|seven|zero torque|lab|mezz|squareback|cbx|zipcore xl|smart sole|glide)\b/i;
  var PLAYERS_RX = /\b(blade|blades|mb|muscle ?back|t100|t150|p7mb|p7cb|p770|mp-?\d+|pro 24[135]|blueprint|i240|i230|zx7|zx5|apex pro|apex mb|tour|ls|tsr4|gt3|gt4|triple diamond|forged|anser|newport|tyne)\b/i;
  var DRAW_RX = /\b(draw|max d|max-d|sft|offset|d)\b/i;
  var CURRENT_RX = /\b(2025|2026|qi35|qi4d|elyte|quantum|g440|gt1|gt2|gt3|gt4|zxi|ds-adapt|optm|jpx one|dynapwr|ai-one|ai-dual|sm11|spider tour|t100|t150|t250|t350|p790|p770|i240|studio style|phantom)\b/i;
  var JUNIOR_RX = /\b(junior|juniors|kids|kid's|youth|boys|girls|us kids|ages)\b/i;
  var LADIES_RX = /\b(ladies|lady|women'?s?|womens)\b/i;
  var SINGLE_RX = /\b(single|utility|driving iron|ut|crossover|individual)\b/i;

  function catsFor(club) { return { driver: ['driver'], irons: ['irons'], woods: ['wood', 'hybrid'], wedges: ['wedge'], putter: ['putter'] }[club]; }

  function candidates(cats, f) {
    return Promise.all(cats.map(shard)).then(function (shards) {
      var out = [];
      shards.forEach(function (sh) {
        var byModel = {};
        sh.rows.forEach(function (r) {
          if (r[12] < 0) return;
          var m = sh.models[r[12]];
          if (!m || !m[2]) return;                                   // price-page models only
          if (!(r[5] & F_IN_STOCK) || (r[5] & F_USED)) return;        // new stock, in stock
          if (r[6] === 'J' || r[9] === 'Junior' || JUNIOR_RX.test(r[1])) return;
          if (A.hand === 'left' && !(r[5] & F_LEFT)) return;
          if (A.hand !== 'left' && (r[5] & F_LEFT)) return;
          (byModel[r[12]] = byModel[r[12]] || { model: m, rows: [], cat: sh.cat }).rows.push(r);
        });
        Object.keys(byModel).forEach(function (k) {
          var g = byModel[k], m = g.model, name = m[1];
          if (JUNIOR_RX.test(name)) return;
          var ladiesModel = LADIES_RX.test(name);
          if (A.shaft !== 'ladies' && ladiesModel) return;
          g.rows.sort(function (a, b) { return a[2] - b[2]; });
          g.from = g.rows[0][2];
          g.url = '/prices/' + m[0] + '/';
          if (g.cat === 'irons' && (SINGLE_RX.test(name) || g.from < 150)) return;   // single irons, not sets
          var retailers = {};
          g.rows.forEach(function (r) { retailers[r[4]] = 1; });
          g.retailers = Object.keys(retailers).length;
          var flexes = {};
          g.rows.forEach(function (r) { if (r[9]) flexes[r[9]] = 1; });
          g.hasFlex = !!flexes[f.flex];
          g.gi = GI_RX.test(name); g.pl = PLAYERS_RX.test(name);
          var s = 0;
          if (f.kind === 'players') s += g.pl ? 10 : g.gi ? -4 : 2;
          else if (f.kind === 'gi') s += g.gi ? 8 : g.pl ? -10 : 2;
          else s += g.gi ? 12 : g.pl ? -14 : 0;
          if (f.draw) s += DRAW_RX.test(name) ? 6 : 0;
          if (A.miss === 'hook' && DRAW_RX.test(name)) s -= 6;
          if (A.shaft === 'ladies') s += (ladiesModel || flexes.Ladies) ? 6 : -2;
          if (g.hasFlex) s += 3;
          if (CURRENT_RX.test(name)) s += 3;
          s += Math.min(g.retailers, 3);
          if (g.rows.some(function (r) { return r[5] & F_DROP; })) s += 2;
          g.score = s;
          out.push(g);
        });
      });
      return out;
    });
  }

  // Budget: matching models split into thirds by today's price.
  function byBudget(list) {
    var sort = function (a, b) { return b.score - a.score || a.from - b.from; };
    if (!list.length || A.budget === 'any') return list.slice().sort(sort);
    var prices = list.map(function (g) { return g.from; }).sort(function (a, b) { return a - b; });
    var t1 = prices[Math.floor((prices.length - 1) / 3)], t2 = prices[Math.floor((prices.length - 1) * 2 / 3)];
    var inBand = list.filter(function (g) {
      return A.budget === 'value' ? g.from <= t1 : A.budget === 'premium' ? g.from >= t2 : g.from > t1 && g.from < t2;
    });
    var rest = list.filter(function (g) { return inBand.indexOf(g) === -1; });
    return inBand.sort(sort).concat(rest.sort(sort));
  }

  function pickModels(f) {
    if (A.club === 'set') {
      // Full sets don't have price pages, so suggest one of each from the price guides.
      var parts = [['driver', 'Driver'], ['irons', 'Irons'], ['putter', 'Putter']];
      return Promise.all(parts.map(function (p) { return candidates(catsFor(p[0]), f).then(byBudget); })).then(function (lists) {
        return lists.map(function (l, i) { var g = l[0]; if (g) g.part = parts[i][1]; return g; }).filter(Boolean);
      });
    }
    return candidates(catsFor(A.club), f).then(function (list) {
      var ranked = byBudget(list);
      var good = ranked.filter(function (g) { return g.score > 0; });
      return (good.length >= 3 ? good : ranked).slice(0, 3);
    });
  }

  function fitLine(g, f) {
    var bits = [];
    if (g.gi && !g.pl) bits.push(A.club === 'putter' || g.part === 'Putter' ? 'Forgiving head shape' : 'Game-improvement');
    else if (g.pl && !g.gi) bits.push(A.club === 'putter' || g.part === 'Putter' ? 'Classic shape' : 'Players model');
    if (f.draw && DRAW_RX.test(g.model[1])) bits.push('draw-bias');
    if (g.hasFlex && A.club !== 'putter' && g.part !== 'Putter') bits.push(f.flex + ' flex in stock');
    if (A.hand === 'left') bits.push('left-handed in stock');
    return bits.length ? bits.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) : 'Matches your answers';
  }

  // "See all matching": the smarter search understands these words.
  function searchLink(f) {
    var words = [];
    var skill = f.kind === 'players' ? 'low handicap' : f.kind === 'sgi' ? 'high handicap' : 'mid handicap';
    if (A.club === 'putter') words.push(f.kind === 'players' ? 'putter' : 'forgiving putter');
    else if (A.club === 'set') words.push(skill, 'clubs');
    else words.push(skill, { driver: 'driver', irons: 'irons', woods: 'hybrid', wedges: 'wedges' }[A.club]);
    if (['driver', 'irons', 'woods', 'set'].indexOf(A.club) !== -1 && f.flex !== 'Ladies') words.push(f.flex.toLowerCase() + ' flex');
    if (A.shaft === 'ladies') words.push('ladies');
    if (A.hand === 'left') words.push('left handed');
    return '/search.html?q=' + encodeURIComponent(words.join(' '));
  }

  /* ---------------------------------------------------------------- the result */
  function result() {
    var f = computeFit();
    var club = A.club;
    var headline = club === 'putter'
      ? 'Your fit: a ' + f.typeCard.toLowerCase() + ' putter'
      : club === 'wedges'
        ? 'Your fit: wedges with a ' + f.typeCard.toLowerCase()
        : 'Your fit: ' + f.kindLabel.toLowerCase().replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + NOUN[club] + ', ' + f.flex + ' flex';
    stage.innerHTML =
      '<div class="fyf-res-top"><div><h2>' + esc(headline) + '</h2><p>Based on your ' + Q.length + ' answers. Here’s the starting point, why we picked it, and models that match at today’s prices.</p></div>' +
      '<button type="button" class="fyf-btn" id="fyf-redo">Start again</button></div>' +
      '<div class="fyf-specs">' +
        '<div class="fyf-spec"><small>Flex</small><b>' + esc(club === 'putter' ? 'Not needed' : f.flex) + '</b><span>' + (club === 'putter' ? 'Putters don’t have a flex' : 'From your 7-iron distance') + '</span></div>' +
        '<div class="fyf-spec"><small>Loft</small><b>' + esc(f.loft) + '</b><span>' + (club === 'wedges' ? 'A typical gap, sand and lob set-up' : club === 'putter' ? 'Most putters are about the same' : 'From handicap and ball flight') + '</span></div>' +
        '<div class="fyf-spec"><small>Club type</small><b>' + esc(f.typeCard) + '</b><span>' + esc(f.typeSub) + '</span></div>' +
        '<div class="fyf-spec"><small>Length</small><b>' + esc(f.len) + '</b><span>From your height</span></div>' +
      '</div>' +
      '<div class="fyf-why"><h3>Why we suggested this</h3><ul>' + whyList(f).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="fyf-picks-h"><h3>Matching ' + esc(NOUN_PL[club]) + ' at today’s prices</h3><a href="' + searchLink(f) + '">See all matching ' + esc(NOUN_PL[club]) + ' →</a></div>' +
      '<div class="fyf-picks" id="fyf-picks"><p class="fyf-none">Finding matching models at today’s prices…</p></div>' +
      '<p class="fyf-disc">This is a general guide based on typical fitting charts, not a fitting. A real fitting looks at your tempo, strike and launch numbers. Treat this as a much better starting point than guessing. We remember your answers on this device only, so you can come back to your result.</p>';
    document.getElementById('fyf-redo').onclick = function () { A = { hand: A.hand || 'right' }; step = 0; save(); draw(true); };
    var picksEl = document.getElementById('fyf-picks');
    pickModels(f).then(function (picks) {
      if (!picks.length) {
        picksEl.outerHTML = '<p class="fyf-none">Nothing with a price page matches all of that today' + (A.hand === 'left' ? ' in left-handed stock' : '') +
          '. Try <a href="' + searchLink(f) + '">searching all matching ' + esc(NOUN_PL[club]) + '</a>, or pick a different budget.</p>';
        return;
      }
      picksEl.innerHTML = picks.map(function (g, i) {
        return '<a class="fyf-pick" href="' + esc(g.url) + '" data-slug="' + esc(g.model[0]) + '"><span class="fyf-tag">' + (club === 'set' ? esc(g.part) : i === 0 ? 'Best match' : 'Also fits') + '</span>' +
          '<b>' + esc(g.model[1]) + '</b>' +
          '<span class="fyf-pr">' + money(g.from) + ' <small>lowest today · ' + g.retailers + (g.retailers === 1 ? ' retailer' : ' retailers') + '</small></span>' +
          '<span class="fyf-fit">' + esc(fitLine(g, f)) + '</span><span class="fyf-go">Compare prices →</span></a>';
      }).join('');
    }).catch(function () {
      picksEl.outerHTML = '<p class="fyf-none">Couldn’t load today’s prices just now. Try refreshing, or <a href="' + searchLink(f) + '">search matching ' + esc(NOUN_PL[club]) + '</a>.</p>';
    });
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.fyf-pick');
    if (a) track('fit_pick_click', { model: a.getAttribute('data-slug') });
  });

  /* ---------------------------------------------------------------- start */
  // A returning visitor with all 8 answers goes straight to their fit.
  if (load() && firstUnanswered() >= Q.length) step = Q.length;
  else step = firstUnanswered() < Q.length ? firstUnanswered() : 0;
  draw(false);
})();
