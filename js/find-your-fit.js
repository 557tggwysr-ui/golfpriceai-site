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
      ['wedges', 'Wedges', 'Scoring clubs'], ['putter', 'Putter', 'Where it all goes wrong'], ['set', 'Full set', 'Starting fresh'],
      ['ball', 'Golf balls', 'Which ball, and why. 5 quick questions.']] },
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

  // Golf balls get their own five questions: a ball is fitted differently from a club.
  var QB = [
    { k: 'bdist', r: 'Driver distance', t: 'How far do you hit your driver?', h: 'Carry plus roll on a decent one. We won’t tell your playing partners.', o: [
      ['1', 'Under 200 yards', ''], ['2', '200–230 yards', ''], ['3', '230–260 yards', ''], ['4', '260+ yards', 'Show-off'], ['0', 'Not sure', 'We’ll go middle of the road']] },
    { k: 'bwant', r: 'Priority', t: 'What matters most from your ball?', h: 'Pick the one you’d miss most. You can only have one favourite child.', cls: 'four', o: [
      ['dist', 'Distance off the tee', 'Every yard counts'], ['green', 'Stopping it on the green', 'Spin and control around the greens'],
      ['feel', 'Soft feel', 'Off the putter and the irons'], ['cheap', 'Tough and cheap', 'It’s going in the water anyway']] },
    { k: 'blost', r: 'Balls lost', t: 'How many balls do you lose a round?', h: 'Be honest. The gorse already knows.', cls: 'four', o: [
      ['1', '0–1', 'Tidy'], ['2', 'About 2', 'Normal service'], ['3', '3–4', 'Donating to the lake'], ['5', '5 or more', 'Buy in bulk']] },
    { k: 'bcol', r: 'Colour', t: 'Which colour?', h: 'Yellow is easier to follow in the air. White is tradition.', cls: 'four', o: [
      ['white', 'White', 'Classic'], ['yellow', 'Yellow', 'Easy to spot'], ['matte', 'Matte or coloured', 'Pink, orange, green and friends'], ['any', 'Don’t mind', 'Whatever’s best value']] },
    { k: 'bbud', r: 'Budget', t: 'What’s your budget per dozen?', h: 'Per 12 balls. We work out the per-dozen price from multi-packs too.', cls: 'four', o: [
      ['value', 'Under £25', 'Sensible'], ['mid', '£25–£40', 'A bit of quality'], ['prem', '£40+', 'Tour balls'], ['any', 'Don’t mind', 'Show me what fits best']] }
  ];
  function L() { return A.club === 'ball' ? [Q[0]].concat(QB) : Q; }

  var A = { hand: 'right' };
  var step = 0;
  var rail = document.getElementById('fyf-rail');
  var stage = document.getElementById('fyf-stage');
  if (!rail || !stage) return;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function label(q) { var o = q.o.filter(function (x) { return x[0] === A[q.k]; })[0]; return o ? o[1] : ''; }
  function answered(i) { return !!A[L()[i].k]; }
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
  function firstUnanswered() { var Qs = L(); for (var i = 0; i < Qs.length; i++) { if (!answered(i)) return i; } return Qs.length; }
  function drawRail() {
    var Q = L();
    var allDone = firstUnanswered() >= Q.length;
    rail.style.setProperty('--fyf-n', Q.length + 1);
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
    if (step >= L().length) { if (A.club === 'ball') ballResult(); else result(); } else question();
    if (focus) {
      var h = stage.querySelector('h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
      if (window.innerWidth < 860) stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  /* ---------------------------------------------------------------- a question */
  // "Skip" picks the middle-of-the-road answer, shown plainly in the rail.
  var DEFAULTS = { club: 'irons', hcp: 'mid', dist: '0', miss: 'all', flight: 'unsure', height: 'm', shaft: 'std', budget: 'any',
    bdist: '0', bwant: 'feel', blost: '2', bcol: 'any', bbud: 'any' };
  function question() {
    var Q = L(), q = Q[step];
    var opts = q.o.map(function (o) {
      var ball = o[0] === 'ball';
      return '<button type="button" class="fyf-opt' + (ball ? ' fyf-opt-ball' : '') + '" data-v="' + o[0] + '" aria-pressed="' + (A[q.k] === o[0]) + '"><b>' + esc(o[1]) + (ball ? ' <i class="fyf-new">New</i>' : '') + '</b>' + (o[2] ? '<span>' + esc(o[2]) + '</span>' : '') + '</button>';
    }).join('');
    var num = A.club === 'ball' ? (step ? 'Ball question ' + step + ' of ' + QB.length : 'Question 1') : 'Question ' + (step + 1) + ' of ' + Q.length;
    var sub = q.sub ? '<div class="fyf-sub"><p>' + esc(q.sub.p) + '</p><div class="fyf-seg" role="group" aria-label="' + esc(q.sub.p) + '">' +
      q.sub.o.map(function (o) { return '<button type="button" data-s="' + o[0] + '" aria-pressed="' + (A[q.sub.k] === o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') + '</div></div>' : '';
    var last = step === Q.length - 1;
    stage.innerHTML = '<div class="fyf-bar" aria-hidden="true"><i style="width:' + (step / Q.length * 100) + '%"></i></div>' +
      '<div class="fyf-q"><span class="fyf-qnum">' + num + '</span><h2>' + esc(q.t) + '</h2><p class="fyf-help">' + esc(q.h) + '</p>' +
      '<div class="fyf-opts' + (q.cls ? ' ' + q.cls : '') + '">' + opts + '</div>' + sub + '</div>' +
      '<div class="fyf-nav"><button type="button" class="fyf-btn" id="fyf-back"' + (step ? '' : ' disabled') + '>← Back</button>' +
      (A[q.k] ? '' : '<button type="button" class="fyf-skip" id="fyf-skip">Not sure, skip this</button>') +
      '<button type="button" class="fyf-btn primary" id="fyf-next"' + (A[q.k] ? '' : ' disabled') + '>' + (last ? (A.club === 'ball' ? 'See my ball →' : 'See my fit →') : 'Next →') + '</button></div>';
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
    // On to the first unanswered question; once they're all in, the result.
    step = firstUnanswered();
    var n = L().length;
    if (step >= n) { step = n; track('fit_complete', A.club === 'ball' ? { club: 'ball', priority: A.bwant } : { club: A.club, handicap: A.hcp }); }
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

  /* ---------------------------------------------------------------- golf balls */
  // One profile per ball family, from published specs: cover (u = urethane,
  // i = ionomer), pieces, compression band and what the ball is built for
  // (tour, tourv = cheaper urethane, soft, dist). Compression figures vary by
  // source, so we only ever use broad bands. Order matters: first match wins.
  var BALLS = [
    ['Titleist', /pro ?v1x/i, 'u', 4, 'high', 'tour'], ['Titleist', /pro ?v1/i, 'u', 3, 'mid', 'tour'],
    ['Titleist', /\bavx\b/i, 'u', 3, 'mid', 'tour'], ['Titleist', /tour soft/i, 'i', 2, 'mid', 'soft'],
    ['Titleist', /velocity/i, 'i', 2, 'high', 'dist'], ['Titleist', /trufeel/i, 'i', 2, 'low', 'soft'],
    ['TaylorMade', /tp5x/i, 'u', 5, 'high', 'tour'], ['TaylorMade', /tp5/i, 'u', 5, 'mid', 'tour'],
    ['TaylorMade', /tour response/i, 'u', 3, 'mid', 'tourv'], ['TaylorMade', /speedsoft/i, 'i', 2, 'low', 'soft'],
    ['TaylorMade', /distance ?(\+|plus)/i, 'i', 2, 'mid', 'dist'],
    ['Callaway', /triple diamond/i, 'u', 4, 'high', 'tour'], ['Callaway', /chrome tour x/i, 'u', 4, 'high', 'tour'],
    ['Callaway', /chrome tour/i, 'u', 4, 'mid', 'tour'], ['Callaway', /chrome soft/i, 'u', 3, 'mid', 'tour'],
    ['Callaway', /e ?r ?c soft/i, 'i', 3, 'low', 'soft'], ['Callaway', /supersoft/i, 'i', 2, 'low', 'soft'],
    ['Callaway', /warbird/i, 'i', 2, 'high', 'dist'],
    ['Srixon', /z-? ?star xv/i, 'u', 4, 'high', 'tour'], ['Srixon', /z-? ?star diamond/i, 'u', 3, 'high', 'tour'],
    ['Srixon', /z-? ?star/i, 'u', 3, 'mid', 'tour'], ['Srixon', /q.?star tour/i, 'u', 3, 'mid', 'tourv'],
    ['Srixon', /soft feel/i, 'i', 2, 'low', 'soft'], ['Srixon', /ultisoft/i, 'i', 2, 'low', 'soft'],
    ['Srixon', /ad333/i, 'i', 2, 'low', 'dist'], ['Srixon', /\bdistance\b/i, 'i', 2, 'mid', 'dist'],
    ['Wilson', /staff model/i, 'u', 4, 'high', 'tour'], ['Wilson', /triad/i, 'u', 3, 'mid', 'tourv'],
    ['Wilson', /duo soft/i, 'i', 2, 'low', 'soft'], ['Wilson', /\bultra\b/i, 'i', 2, 'mid', 'dist'],
    ['Wilson', /tour velocity/i, 'i', 2, 'mid', 'dist'],
    ['Mizuno', /pro x/i, 'u', 3, 'high', 'tour'], ['Mizuno', /pro s/i, 'u', 3, 'high', 'tour'],
    ['Mizuno', /rb ?max/i, 'i', 3, 'mid', 'dist'], ['Mizuno', /rb ?566/i, 'i', 2, 'low', 'soft'],
    ['Bridgestone', /tour b ?x\b/i, 'u', 3, 'high', 'tour'], ['Bridgestone', /tour b ?rx\b/i, 'u', 3, 'mid', 'tour'],
    ['PXG', /xtreme tour/i, 'u', 3, 'high', 'tour'], ['Pinnacle', /distance/i, 'i', 2, 'mid', 'dist']
  ];
  var BALL_SKIP = /\b(reva|clubhouse|mavrik|lady|ladies|women'?s?|junior|personali[sz]ed|logo|printed|practice|foam|recycled|grade [abc]|lake|refurb|pearl|used|prior)\b/i;
  var COMP_TXT = { low: 'low compression', mid: 'mid compression', high: 'high compression' };

  function familyOf(model) {
    var name = model[1], brand = model[3];
    if (BALL_SKIP.test(name)) return null;
    for (var i = 0; i < BALLS.length; i++) { var b = BALLS[i]; if (b[0] === brand && b[1].test(name)) return { i: i, brand: brand, cover: b[2], pieces: b[3], comp: b[4], kind: b[5] }; }
    return null;
  }
  // Balls in a pack, from the listing's own name. Plain listings are a dozen.
  function packOf(n) {
    n = n.toLowerCase(); var m;
    if (/4\s*for\s*3/.test(n)) return 48;
    if (/3\s*for\s*2/.test(n)) return 36;
    if ((m = n.match(/(\d)\s*dozen/))) return +m[1] * 12;
    if (/double (dozen|pack)/.test(n)) return 24;
    if (/\bdozen\b/.test(n)) return 12;
    if (/half dozen/.test(n)) return 6;
    if (/sleeve/.test(n)) return 3;
    if ((m = n.match(/(\d{1,3})\s*-?\s*(?:balls?|pack|pk)\b/)) && +m[1] >= 3 && +m[1] <= 120) return +m[1];
    if ((m = n.match(/pack of (\d{1,3})/)) && +m[1] >= 3) return +m[1];
    return 12;
  }
  function colourOf(r) {
    var n = r[1].toLowerCase(), c = (r[11] || '').toLowerCase();
    if (c === 'yellow' || /yellow|optic|high.?vis|neon yellow/.test(n)) return 'yellow';
    if ((c && c !== 'white') || /matte|brite|splatter|distressed|pink|orange|\bred\b|green|blue|purple|black|neon/.test(n)) return 'matte';
    return 'white';
  }

  function ballFamilies(want) {
    return shard('ball').then(function (sh) {
      var fams = {}, rows = [];
      sh.rows.forEach(function (r) {
        if (r[12] < 0) return;
        var m = sh.models[r[12]];
        if (!m || !m[2] || !(r[5] & F_IN_STOCK) || (r[5] & F_USED) || BALL_SKIP.test(r[1])) return;
        var f = familyOf(m);
        if (!f) return;
        var pack = packOf(r[1]);
        rows.push({ r: r, m: m, f: f, pack: pack, doz: Math.round(r[2] / pack * 12 * 100) / 100, col: colourOf(r) });
      });
      // A multi-buy offer can be listed at the price of one box, so a per-dozen
      // price far below that ball's normal dozen price is a mis-read: leave it out.
      var dozen = {};
      rows.forEach(function (x) { if (x.pack === 12) (dozen[x.f.i] = dozen[x.f.i] || []).push(x.doz); });
      function median(a) { a = a.slice().sort(function (p, q) { return p - q; }); return a[Math.floor(a.length / 2)]; }
      rows.forEach(function (x) {
        if (x.doz < 8 || x.doz > 90) return;
        if (x.pack !== 12 && dozen[x.f.i] && x.doz < median(dozen[x.f.i]) * 0.55) return;
        if (want && want !== 'any' && x.col !== want) return;
        var g = fams[x.f.i] || (fams[x.f.i] = Object.assign({}, x.f, { doz: Infinity, retailers: {} }));
        g.retailers[x.r[4]] = 1;
        var plain = !/limited|edition|major|dog|happy gilmore|area 51|suits|sweater|nights|trash|luck|love|cheers|flowers|mother|cricket|vitality|usa|turnbox|coastal|animals/i.test(x.m[1]);
        if (x.doz < g.doz - 0.005 || (Math.abs(x.doz - g.doz) < 0.005 && plain && !g.plain)) { g.doz = x.doz; g.pack = x.pack; g.model = x.m; g.plain = plain; }
      });
      return Object.keys(fams).map(function (k) { var g = fams[k]; g.retailers = Object.keys(g.retailers).length; return g; });
    });
  }

  function ballTarget() {
    var sp = A.bdist, w = A.bwant, bud = A.bbud, lost = +A.blost || 2;
    var comp = { '1': ['low'], '2': ['low', 'mid'], '3': ['mid'], '4': ['high', 'mid'], '0': ['mid'] }[sp] || ['mid'];
    var cover, kinds;
    if (w === 'green') { cover = 'u'; kinds = (bud === 'prem' || (bud === 'any' && lost <= 2)) ? ['tour', 'tourv'] : ['tourv', 'tour']; }
    else if (w === 'feel') { cover = bud === 'value' ? 'i' : 'u'; kinds = cover === 'u' ? ['tourv', 'tour'] : ['soft']; if (cover === 'u' && comp[0] === 'high') comp = ['mid', 'high']; if (cover === 'i') comp = ['low', 'mid']; }
    else if (w === 'dist') { cover = (bud === 'prem' || (bud === 'any' && (sp === '3' || sp === '4') && lost <= 2)) ? 'u' : 'i'; kinds = cover === 'u' ? ['tour'] : ['dist']; }
    else { cover = 'i'; kinds = sp === '1' || sp === '2' ? ['soft', 'dist'] : ['dist', 'soft']; }
    var band = { value: [0, 25], mid: [25, 40], prem: [40, 999], any: null }[bud];
    return { cover: cover, kinds: kinds, comp: comp, band: band, lost: lost };
  }
  function ballScore(g, t) {
    var s = g.cover === t.cover ? 12 : -10;
    var k = t.kinds.indexOf(g.kind); s += k === 0 ? 8 : k === 1 ? 4 : 0;
    var c = t.comp.indexOf(g.comp); s += c === 0 ? 6 : c === 1 ? 3 : (t.comp[0] === 'low' && g.comp === 'high') || (t.comp[0] === 'high' && g.comp === 'low') ? -6 : 0;
    if (t.band) { var gap = g.doz < t.band[0] ? t.band[0] - g.doz : g.doz > t.band[1] ? g.doz - t.band[1] : 0; s += gap ? -Math.min(12, gap / 2) : 6; }
    if (t.lost >= 3) s -= g.doz / (t.lost >= 5 ? 5 : 8);
    if (A.bwant === 'cheap') s -= g.doz / 4;
    s += Math.min(g.retailers, 3) / 2;
    return s;
  }
  function ballPicks(fams, t) {
    fams.forEach(function (g) { g.score = ballScore(g, t); });
    var ranked = fams.slice().sort(function (a, b) { return b.score - a.score || a.doz - b.doz; });
    var out = [], brands = {};
    function add(g, tag) { out.push(Object.assign({ tag: tag }, g)); brands[g.brand] = 1; }
    if (!ranked.length) return out;
    add(ranked[0], 'Best match');
    var next = ranked.filter(function (g) { return !brands[g.brand]; })[0];
    if (next) add(next, '');
    // Best value: the cheapest strong match from a third brand.
    var top = out[0].score, pool = ranked.filter(function (g) { return !brands[g.brand] && g.score >= top - 10; });
    pool.sort(function (a, b) { return a.doz - b.doz; });
    if (pool[0]) add(pool[0], out.every(function (g) { return pool[0].doz < g.doz; }) ? 'Best value' : '');
    else { var third = ranked.filter(function (g) { return !brands[g.brand]; })[0]; if (third) add(third, ''); }
    return out;
  }

  function ballWhy(t) {
    var why = [], u = t.cover === 'u';
    var dist = { '1': 'A driver under 200 yards usually means a slower swing, so a low-compression ball squashes properly and gives you more speed, rather than feeling like a pebble.',
      '2': 'A 200–230 yard drive usually means a moderate swing speed, so a softer core compresses properly instead of feeling like a pebble.',
      '3': 'A 230–260 yard drive is a healthy swing speed: a mid-compression ball gets the most out of it.',
      '4': 'At 260 yards and beyond you can compress a firmer ball, which keeps spin down off the tee and holds its line.',
      '0': 'Without a driver distance we’ve gone middle of the road: mid compression suits most club golfers.' }[A.bdist];
    if (dist) why.push(dist);
    why.push({ green: 'You want it to stop on the green, and urethane covers are what give short shots their bite.',
      feel: u ? 'You want soft feel, and a urethane cover feels softer off the putter and wedges than a hard-wearing one.' : 'You want soft feel on a sensible budget: a low-compression two-piece feels soft without the tour price.',
      dist: u ? 'You want distance and your swing can handle a firmer multi-layer ball: speed off the tee, with control kept for the short game.' : 'You want distance, and a two-piece ball with a tough ionomer cover is built for low spin and long, straight drives.',
      cheap: 'You want tough and cheap. An ionomer cover shrugs off cart paths, trees and the odd wall.' }[A.bwant]);
    if (t.lost <= 1) why.push(u ? 'You hardly lose any, so a premium ball is money well spent.' : 'You hardly lose any, so if you ever fancy more greenside spin, a urethane ball is a fair upgrade.');
    else if (t.lost === 2) why.push(u && A.bbud !== 'prem' ? 'You lose about 2 a round, so a mid-price urethane ball often makes more sense than a tour ball. You can have the spin without the heartbreak.' : 'You lose about 2 a round, so the price per ball matters. The sums are below.');
    else why.push('You lose ' + (t.lost >= 5 ? '5 or more' : '3–4') + ' a round, so the price per ball matters more than the last bit of spin. Check the sums below.');
    if (A.bcol === 'yellow') why.push('Yellow is easier to follow in the air and to find in the rough. It flies the same as white.');
    if (A.bcol === 'matte') why.push('Matte and coloured balls are easy to spot, and the finish makes little difference to how they fly.');
    return why;
  }

  function ballResult() {
    var t = ballTarget(), u = t.cover === 'u';
    var compLabel = t.comp.length > 1 ? (t.comp[0] === 'low' ? 'Low to mid' : t.comp[0] === 'high' ? 'Mid to high' : 'Mid to high') : { low: 'Low', mid: 'Mid', high: 'High' }[t.comp[0]];
    var headline = u ? (t.comp[0] === 'high' ? 'Your fit: a firm, multi-layer tour ball' : 'Your fit: a multi-layer ball with a soft urethane cover')
      : (A.bwant === 'dist' || t.comp[0] !== 'low' ? 'Your fit: a two-piece distance ball' : 'Your fit: a soft two-piece ball');
    var colTxt = { white: 'White', yellow: 'Yellow', matte: 'Matte or coloured', any: 'Any colour' }[A.bcol] || 'Any colour';
    stage.innerHTML =
      '<div class="fyf-res-top"><div><h2>' + esc(headline) + '</h2><p>Based on your 5 answers. Here’s why, the balls that match at today’s prices, and what your lost balls really cost you.</p></div>' +
      '<button type="button" class="fyf-btn" id="fyf-redo">Start again</button></div>' +
      '<div class="fyf-specs">' +
        '<div class="fyf-spec"><small>Construction</small><b>' + (u ? 'Three-piece or more' : 'Two-piece') + '</b><span>From your priority</span></div>' +
        '<div class="fyf-spec"><small>Cover</small><b>' + (u ? 'Urethane' : 'Ionomer') + '</b><span>' + (u ? (A.bwant === 'dist' ? 'Speed, with greenside control' : A.bwant === 'feel' ? 'For soft feel' : 'For greenside spin') : 'Tough, low spin off the tee') + '</span></div>' +
        '<div class="fyf-spec"><small>Compression</small><b>' + esc(compLabel) + '</b><span>From your driver distance</span></div>' +
        '<div class="fyf-spec"><small>Colour</small><b>' + esc(colTxt) + '</b><span>Your call</span></div>' +
      '</div>' +
      '<div class="fyf-why"><h3>Why we suggested this</h3><ul>' + ballWhy(t).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
      '<p class="fyf-why-note">A general guide from published ball specs, not a fitting. If you’re serious, a ball fitting on a launch monitor is the gold standard.</p></div>' +
      '<div class="fyf-picks-h"><h3>Matching balls at today’s prices</h3><a href="/prices/golf-balls/">All golf ball prices →</a></div>' +
      '<div class="fyf-picks" id="fyf-picks"><p class="fyf-none">Finding matching balls at today’s prices…</p></div>' +
      '<div id="fyf-lost"></div>' +
      '<p class="fyf-disc">Prices are per dozen, worked out from today’s lowest price for each ball, including multi-packs. We remember your answers on this device only, so you can come back to your result.</p>';
    document.getElementById('fyf-redo').onclick = function () { A = { hand: A.hand || 'right' }; step = 0; save(); draw(true); };
    var picksEl = document.getElementById('fyf-picks');
    ballFamilies(A.bcol).then(function (fams) {
      var picks = ballPicks(fams, t);
      if (!picks.length) {
        picksEl.outerHTML = '<p class="fyf-none">Nothing matches all of that in stock today' + (A.bcol !== 'any' ? ' in that colour' : '') + '. Try “Don’t mind” for colour, or browse <a href="/prices/golf-balls/">all golf ball prices</a>.</p>';
        return;
      }
      picksEl.innerHTML = picks.map(function (g) {
        var m = g.model;
        return '<a class="fyf-pick" href="/prices/' + esc(m[0]) + '/" data-slug="' + esc(m[0]) + '">' +
          (g.tag ? '<span class="fyf-tag' + (g.tag === 'Best value' ? ' value' : '') + '">' + g.tag + '</span>' : '') +
          '<b>' + esc(m[1]) + '</b>' +
          '<span class="fyf-pr">' + money(g.doz) + ' <small>per dozen' + (g.pack !== 12 ? ', in a ' + g.pack + '-ball pack' : '') + '</small></span>' +
          '<span class="fyf-fit">' + g.pieces + '-piece, ' + (g.cover === 'u' ? 'urethane' : 'ionomer') + ', ' + COMP_TXT[g.comp] + '</span><span class="fyf-go">See prices →</span></a>';
      }).join('') ;
      // Name the construction from the best match itself, now we know it.
      var h2 = stage.querySelector('.fyf-res-top h2');
      if (u && t.comp[0] !== 'high' && picks[0].pieces === 3 && h2) h2.textContent = 'Your fit: a three-piece ball with a soft urethane cover';
      if (u && t.band && t.band[1] <= 25 && picks[0].doz > 25) {
        var ul = stage.querySelector('.fyf-why ul');
        if (ul) ul.insertAdjacentHTML('beforeend', '<li>Urethane balls rarely dip under £25 a dozen, so these are the closest to your budget. Multi-buy packs bring the price down most.</li>');
      }
      lostCheck(fams, picks[0]);
    }).catch(function () {
      picksEl.outerHTML = '<p class="fyf-none">Couldn’t load today’s prices just now. Try refreshing, or browse <a href="/prices/golf-balls/">all golf ball prices</a>.</p>';
    });
  }

  // The lost-ball reality check: what a year of lost balls costs at three price levels.
  function lostCheck(fams, mine) {
    var box = document.getElementById('fyf-lost');
    if (!box) return;
    // The comparison rows use every colour, so a yellow-only answer still gets a fair sum.
    if (A.bcol && A.bcol !== 'any') ballFamilies('any').then(draw2); else draw2(fams);
    function draw2(list) {
      // A typical tour ball (the middle price of the tour balls on sale today), not the cheapest deal.
      var tours = list.filter(function (g) { return g.kind === 'tour'; }).sort(function (a, b) { return a.doz - b.doz; });
      var tour = tours[Math.floor(tours.length / 2)];
      var two = list.filter(function (g) { return g.pieces === 2; }).sort(function (a, b) { return a.doz - b.doz; })[0];
      var lost = +A.blost || 2, rounds = 4;
      try { rounds = +localStorage.getItem('gpFitRounds') || 4; } catch (e) { /* fine */ }
      var bits = [['A typical tour ball', tour, false], ['Your match', mine, true], ['The cheapest two-piece', two, false]].filter(function (x) { return x[1]; });
      box.innerHTML = '<section class="fyf-lost"><span class="fyf-lost-k">The lost-ball reality check</span>' +
        '<b class="fyf-lost-h" aria-live="polite"></b>' +
        '<div class="fyf-lost-g">' + bits.map(function (x, i) { return '<span' + (x[2] ? ' class="me"' : '') + '>' + x[0] + ' at ' + money(x[1].doz) + '/dozen</span><b' + (x[2] ? ' class="me"' : '') + ' data-y="' + i + '"></b>'; }).join('') + '</div>' +
        '<div class="fyf-lost-s"><label>Rounds a month <output data-o="r"></output><input type="range" min="1" max="12" step="1" value="' + rounds + '" data-k="r"></label>' +
        '<label>Balls lost a round <output data-o="l"></output><input type="range" min="0.5" max="8" step="0.5" value="' + lost + '" data-k="l"></label></div>' +
        '<span class="fyf-lost-n">Worked out from today’s lowest prices per dozen. Slide to change rounds a month or balls lost.</span></section>' +
        '<a class="fyf-alert" href="/prices/' + esc(mine.model[0]) + '/#price-alert">Email me when ' + esc(mine.model[1].replace(/\s+golf balls$/i, '')) + ' drops ›</a>';
      function paint() {
        var balls = Math.round(lost * rounds * 12);
        box.querySelector('.fyf-lost-h').textContent = 'You lose about ' + lost + ' a round. Playing ' + rounds + ' round' + (rounds === 1 ? '' : 's') + ' a month, that’s roughly ' + balls + ' balls a year.';
        bits.forEach(function (x, i) { box.querySelector('[data-y="' + i + '"]').textContent = money(Math.round(balls / 12 * x[1].doz)) + ' a year'; });
        box.querySelector('[data-o="r"]').textContent = rounds;
        box.querySelector('[data-o="l"]').textContent = lost;
      }
      box.querySelectorAll('input[type=range]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          if (inp.getAttribute('data-k') === 'r') { rounds = +inp.value; try { localStorage.setItem('gpFitRounds', rounds); } catch (e) { /* fine */ } }
          else lost = +inp.value;
          paint();
        });
      });
      paint();
    }
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.fyf-pick');
    if (a) track('fit_pick_click', { model: a.getAttribute('data-slug') });
  });

  /* ---------------------------------------------------------------- start */
  // A returning visitor with all 8 answers goes straight to their fit.
  if (load() && firstUnanswered() >= L().length) step = L().length;
  else step = firstUnanswered() < L().length ? firstUnanswered() : 0;
  draw(false);
})();
