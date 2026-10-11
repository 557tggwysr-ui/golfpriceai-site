/* GolfPrice AI — search results page (/search.html?q=...).
   Reads what someone typed ("lefty drivers under 300"), loads only the
   category files it needs from data/search/, groups listings into models,
   and never leaves a dead end. Built by scripts/search_index.py. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var money = function (n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var F_LEFT = 1, F_IN_STOCK = 2, F_DROP = 4, F_USED = 8;

  /* ---------------------------------------------------------------- understanding the search */
  var CATS = {
    driver: { label: 'Drivers', words: ['driver', 'drivers'] },
    wood: { label: 'Fairway woods', words: ['fairway', 'fairways', 'wood', 'woods', '3wood', '5wood'] },
    hybrid: { label: 'Hybrids', words: ['hybrid', 'hybrids', 'rescue', 'rescues'] },
    irons: { label: 'Irons', words: ['iron', 'irons'] },
    wedge: { label: 'Wedges', words: ['wedge', 'wedges'] },
    putter: { label: 'Putters', words: ['putter', 'putters'] },
    sets: { label: 'Club sets', words: ['set', 'sets', 'package'] },
    ball: { label: 'Golf balls', words: ['ball', 'balls'] },
    bag: { label: 'Golf bags', words: ['bag', 'bags'] },
    shoes: { label: 'Golf shoes', words: ['shoe', 'shoes', 'trainers', 'spikeless'] },
    apparel: { label: 'Clothing', words: ['polo', 'polos', 'shirt', 'shirts', 'trousers', 'jacket', 'jackets', 'hoodie', 'jumper', 'cap', 'caps', 'hat', 'hats', 'shorts', 'skort', 'gilet', 'clothing', 'apparel', 'top', 'tops', 'midlayer', 'waterproof', 'waterproofs', 'beanie', 'socks', 'belt', 'dress', 'quarter'] },
    accessories: { label: 'Accessories', words: ['rangefinder', 'rangefinders', 'watch', 'watches', 'gps', 'trolley', 'trolleys', 'glove', 'gloves', 'tee', 'tees', 'umbrella', 'towel', 'headcover', 'headcovers', 'grip', 'grips', 'monitor', 'simulator', 'trolley', 'cart', 'speaker', 'marker'] }
  };
  // Words that pick a category but also narrow the names (a "polo" search
  // should find polos, not all clothing).
  var KEEP_AS_TEXT = { polo: 1, polos: 1, shirt: 1, shirts: 1, trousers: 1, jacket: 1, jackets: 1, hoodie: 1, jumper: 1, cap: 1, caps: 1, hat: 1, hats: 1, shorts: 1, skort: 1, gilet: 1, beanie: 1, socks: 1, belt: 1, dress: 1, rangefinder: 1, rangefinders: 1, watch: 1, watches: 1, trolley: 1, trolleys: 1, glove: 1, gloves: 1, tee: 1, tees: 1, umbrella: 1, towel: 1, headcover: 1, headcovers: 1, grip: 1, grips: 1, monitor: 1, simulator: 1, waterproof: 1, waterproofs: 1, midlayer: 1, quarter: 1, speaker: 1, marker: 1, cart: 1, spikeless: 1, rescue: 1 };
  var WORD_TO_CAT = {};
  Object.keys(CATS).forEach(function (c) { CATS[c].words.forEach(function (w) { WORD_TO_CAT[w] = c; }); });
  var CLUBS = ['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter', 'sets'];
  var STOP = { golf: 1, the: 1, a: 1, an: 1, for: 1, and: 1, with: 1, uk: 1, best: 1, new: 1, price: 1, prices: 1, buy: 1, me: 1, my: 1, of: 1, in: 1, on: 1, to: 1, mens: 1, men: 1, "men's": 1 };
  var BRANDS = ['taylormade', 'callaway', 'titleist', 'ping', 'cobra', 'mizuno', 'srixon', 'cleveland', 'wilson', 'odyssey', 'scotty', 'footjoy', 'adidas', 'nike', 'puma', 'under', 'galvin', 'motocaddy', 'powakaddy', 'garmin', 'bushnell', 'bridgestone', 'yonex', 'pxg', 'macgregor', 'ogio', 'sunday', 'big', 'ecco', 'skechers', 'oscar', 'peter', 'j.lindeberg', 'lab', 'evnroll', 'shot', 'skycaddie', 'vega', 'benross', 'ben', 'stewart', 'clicgear', 'sun'];
  var BRAND_LABEL = { taylormade: 'TaylorMade', pxg: 'PXG', footjoy: 'FootJoy', powakaddy: 'PowaKaddy', skycaddie: 'SkyCaddie', macgregor: 'MacGregor', ogio: 'Ogio' };

  function parse(raw) {
    var q = ' ' + raw.toLowerCase().replace(/[’']/g, "'") + ' ';
    var out = { cats: [], hand: null, audience: null, flex: null, loft: null, setOnly: false, min: null, max: null, drops: false, cheap: false, words: [], brand: null };
    var m;
    if ((m = q.match(/(?:£\s*)?(\d+)\s*(?:-|to)\s*£\s*(\d+)/)) || (m = q.match(/between\s*£?\s*(\d+)\s*(?:and|-|to)\s*£?\s*(\d+)/))) {
      out.min = +m[1]; out.max = +m[2]; q = q.replace(m[0], ' ');
    }
    if ((m = q.match(/(?:under|below|less than|up to|upto|max|maximum|cheaper than|<)\s*£?\s*(\d+)(?:\s*(?:quid|pounds|gbp))?/))) { out.max = +m[1]; q = q.replace(m[0], ' '); }
    if ((m = q.match(/(?:over|above|more than|at least|min|minimum|>)\s*£?\s*(\d+)(?:\s*(?:quid|pounds|gbp))?/))) { out.min = +m[1]; q = q.replace(m[0], ' '); }
    if (out.max === null && (m = q.match(/£\s*(\d+)/))) { out.max = +m[1]; q = q.replace(m[0], ' '); }
    if ((m = q.match(/\b(left[ -]?hand(?:ed)?|lefty|lefties|left|l\/h|lh)\b/))) { out.hand = 'L'; q = q.replace(m[0], ' '); }
    else if ((m = q.match(/\b(right[ -]?hand(?:ed)?|righty|r\/h|rh)\b/))) { out.hand = 'R'; q = q.replace(m[0], ' '); }
    if ((m = q.match(/\b(ladies|lady|women'?s?|womens|female|girls?)\b/))) { out.audience = 'F'; q = q.replace(m[0], ' '); }
    else if ((m = q.match(/\b(juniors?|kids?|children'?s?|youth|boys?)\b/))) { out.audience = 'J'; q = q.replace(m[0], ' '); }
    if ((m = q.match(/\b(extra stiff|x-?stiff|stiff|regular|senior|lite)( flex)?\b/))) {
      out.flex = { 'extra stiff': 'X-Stiff', 'x-stiff': 'X-Stiff', xstiff: 'X-Stiff', stiff: 'Stiff', regular: 'Regular', senior: 'Senior', lite: 'Senior' }[m[1]];
      q = q.replace(m[0], ' ');
    }
    if ((m = q.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:°|\*|degrees?|deg)(?=\s|$)/))) { out.loft = m[1] + '°'; q = q.replace(m[0], ' '); }
    if (/\b(?:iron )?sets?\b/.test(q) && /\birons?\b/.test(q)) out.setOnly = true;
    if ((m = q.match(/\b(deals?|sale|offers?|discounts?|reduced|drops?)\b/))) { out.drops = true; q = q.replace(m[0], ' '); }
    if ((m = q.match(/\b(cheap|cheapest|budget|bargain)\b/))) { out.cheap = true; q = q.replace(m[0], ' '); }
    if (/\bclubs?\b/.test(q) && !/\bclub (?:series|set)/.test(q)) { out.cats = CLUBS.slice(); q = q.replace(/\bclubs?\b/, ' '); }
    q = q.replace(/\b(\d) (wood|hybrid|iron)\b/g, '$1$2');
    q.split(/[^a-z0-9.+\-]+/).forEach(function (w) {
      w = w.replace(/^[-.]+|[-.]+$/g, '');
      if (!w || STOP[w]) return;
      var cat = WORD_TO_CAT[w];
      if (/^\d(wood|hybrid)$/.test(w)) { cat = w.slice(1) === 'wood' ? 'wood' : 'hybrid'; }
      if (cat) {
        if (out.cats.indexOf(cat) === -1) out.cats.push(cat);
        if (KEEP_AS_TEXT[w]) out.words.push(w.replace(/s$/, ''));
        return;
      }
      if (!out.brand && BRANDS.indexOf(w) !== -1) out.brand = w;
      out.words.push(w);
    });
    // "iron set" means a set of irons, not a full package set.
    if (out.cats.length > 1 && out.cats.indexOf('sets') !== -1) out.cats = out.cats.filter(function (c) { return c !== 'sets'; });
    return out;
  }

  /* ---------------------------------------------------------------- data */
  var TERMS = null, SHARDS = {};
  function getJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); }); }
  function loadTerms() { return TERMS ? Promise.resolve(TERMS) : getJSON('/data/search/terms.json').then(function (t) { TERMS = t; return t; }); }
  function loadShard(cat) {
    if (!SHARDS[cat]) SHARDS[cat] = getJSON('/data/search/' + cat + '.json').then(function (d) { d.cat = cat; return d; });
    return SHARDS[cat];
  }

  // Which category files contain a word (exact or as the start of a word).
  function catsForWord(w) {
    var hit = TERMS.words[w];
    if (hit) return hit.map(function (i) { return TERMS.cats[i]; });
    var set = {};
    var keys = Object.keys(TERMS.words);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf(w) === 0 || (w.length > 3 && keys[i].replace(/[.\-]/g, '') === w.replace(/[.\-]/g, ''))) {
        TERMS.words[keys[i]].forEach(function (c) { set[TERMS.cats[c]] = 1; });
      }
    }
    return Object.keys(set);
  }

  // "Did you mean": the closest known word, allowing one slip (two for long words).
  function distance(a, b) {
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) { d[i] = [i]; }
    for (j = 0; j <= b.length; j++) { d[0][j] = j; }
    for (i = 1; i <= a.length; i++) {
      for (j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }
  function correct(w) {
    if (w.length < 4 || /\d/.test(w)) return null;
    var limit = w.length >= 7 ? 2 : 1, best = null, bestD = 99, bestN = 0;
    Object.keys(TERMS.words).forEach(function (k) {
      if (Math.abs(k.length - w.length) > limit || /\d/.test(k)) return;
      var dd = distance(w, k);
      var n = TERMS.words[k].length;
      if (dd <= limit && (dd < bestD || (dd === bestD && n > bestN))) { best = k; bestD = dd; bestN = n; }
    });
    return best;
  }

  /* ---------------------------------------------------------------- matching */
  function nameWords(name) { return name.toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)?/g) || []; }
  function wordMatches(w, words, joined) {
    for (var i = 0; i < words.length; i++) { if (words[i].indexOf(w) === 0) return true; }
    return w.length >= 3 && joined.indexOf(w.replace(/[.\-+]/g, '')) !== -1;
  }
  function rowMatches(row, p, model) {
    var flags = row[5];
    if (!state.includeOut && !(flags & F_IN_STOCK)) return false;
    if (p.hand === 'L' && !(flags & F_LEFT)) return false;
    if (p.hand === 'R' && (flags & F_LEFT)) return false;
    if (p.audience && row[6] !== p.audience) return false;
    if (p.flex && row[9] !== p.flex) return false;
    if (p.loft && row[8] !== p.loft) return false;
    if (p.setOnly && !(row[10] || (model && model[4] === 'irons'))) return false;
    if (p.partsOk === false && PARTS_RX.test(row[1])) return false;
    if (p.min !== null && row[2] < p.min) return false;
    if (p.max !== null && row[2] > p.max) return false;
    if (p.drops && !(flags & F_DROP)) return false;
    if (state.brandFilter && (row[7] || '').toLowerCase() !== state.brandFilter) return false;
    if (state.retailerFilter !== null && row[4] !== state.retailerFilter) return false;
    if (p.words.length) {
      if (!row._w) { row._w = nameWords(row[1] + ' ' + row[7] + ' ' + (model ? model[1] : '')); row._j = row._w.join(''); }
      for (var i = 0; i < p.words.length; i++) { if (!wordMatches(p.words[i], row._w, row._j)) return false; }
    }
    return true;
  }

  // Spares and add-ons that share a product's name ("Rangefinder ... Battery").
  var PARTS_RX = /\b(batter(y|ies)|case|strap|band|charger|cable|mount|holder|screen protector|replacement|spare|adapter|clip|skin|cover|bracket|wheel|seat|umbrella holder|sleeve)\b/i;

  /* ---------------------------------------------------------------- state + run */
  var state = { q: '', parsed: null, sort: 'best', shown: 20, includeOut: false, brandFilter: null, retailerFilter: null, corrected: null, groups: [], all: [] };

  function run(q, keepFilters) {
    state.q = q;
    state.edited = false;
    if (!keepFilters) { state.brandFilter = null; state.retailerFilter = null; state.shown = 20; }
    $('sr-q').value = q;
    document.title = q ? 'Search: ' + q + ' | GolfPrice AI' : 'Search | GolfPrice AI';
    var p = state.parsed = parse(q);
    // Searching "rangefinder" shouldn't lead with rangefinder batteries,
    // unless the search itself asks for a part.
    p.partsOk = PARTS_RX.test(q);
    if (p.cheap && state.sort === 'best') state.sort = 'price';
    $('sr-status').textContent = 'Searching…';
    return loadTerms().then(function () {
      state.corrected = null;
      var cats = p.cats.slice();
      if (p.words.length) {
        var fixed = p.words.map(function (w) {
          if (catsForWord(w).length) return w;
          var c = correct(w);
          if (c) { state.corrected = state.corrected || {}; state.corrected[w] = c; return c; }
          return w;
        });
        p.words = fixed;
        if (!cats.length) {
          var sets = p.words.map(catsForWord).filter(function (s) { return s.length; });
          if (sets.length) {
            cats = sets.reduce(function (a, b) { return a.filter(function (c) { return b.indexOf(c) !== -1; }); });
            if (!cats.length) cats = sets[0];
          }
        }
      }
      if (!cats.length) cats = p.words.length ? [] : CLUBS.concat(['ball']);
      return Promise.all(cats.map(loadShard));
    }).then(function (shards) {
      state.shards = shards;
      compute();
      render();
      saveRecent(q);
    }).catch(function () {
      $('sr-status').textContent = 'Sorry, search couldn’t load just now. Try again in a moment.';
    });
  }

  function compute() {
    var p = state.parsed, groups = {}, singles = [], all = [];
    (state.shards || []).forEach(function (shard) {
      shard.rows.forEach(function (row) {
        var model = row[12] >= 0 ? shard.models[row[12]] : null;
        if (!rowMatches(row, p, model)) return;
        all.push({ row: row, shard: shard, model: model });
        if (model) {
          var key = shard.cat + ':' + row[12];
          (groups[key] = groups[key] || { model: model, shard: shard, rows: [] }).rows.push(row);
        } else {
          // Clothing and shoes list each size separately: "... - Navy / M".
          var base = row[1].replace(/\s*\/\s*[^\/]*$/, '').replace(/\s+-\s+[^-]*$/, function (t) { return /\/|\d/.test(t) ? '' : t; });
          var skey = shard.cat + '|' + base.toLowerCase();
          if (!groups[skey]) { groups[skey] = { model: null, base: base, shard: shard, rows: [] }; }
          groups[skey].rows.push(row);
        }
      });
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; }).concat(singles);
    list.forEach(function (g) {
      g.rows.sort(function (a, b) { return a[2] - b[2]; });
      g.from = g.rows[0][2];
      g.drops = g.rows.filter(function (r) { return r[5] & F_DROP; }).length;
      g.retailers = {};
      g.rows.forEach(function (r) { g.retailers[r[4]] = 1; });
      g.bestDrop = Math.max.apply(null, g.rows.map(function (r) { return r[3] ? (r[3] - r[2]) / r[3] : 0; }));
      var name = (g.model ? g.model[1] : (g.base || g.rows[0][1])).toLowerCase();
      var nw = nameWords(name);
      var inName = p.words.filter(function (w) { return name.indexOf(w) !== -1; }).length;
      // Whole-word matches ("v1" in "Pro V1") beat prefix matches ("V1x").
      var exact = p.words.filter(function (w) { return nw.indexOf(w) !== -1; }).length;
      inName += exact;
      g.score = inName * 3 + (g.model && g.model[2] ? 3 : 0) + (g.model ? 2 : 0) + Math.log(1 + g.rows.length) + Object.keys(g.retailers).length + (g.drops ? 1 : 0)
        - (PARTS_RX.test(name) ? 4 : 0)
        + (p.setOnly && g.rows.some(function (r) { return r[10]; }) ? 4 : 0)
        - (p.setOnly && /utility|driving iron/.test(name) ? 4 : 0);
    });
    var sorters = {
      best: function (a, b) { return b.score - a.score || a.from - b.from; },
      price: function (a, b) { return a.from - b.from; },
      drop: function (a, b) { return b.bestDrop - a.bestDrop || a.from - b.from; }
    };
    list.sort(sorters[state.sort] || sorters.best);
    state.groups = list;
    state.all = all;
  }

  /* ---------------------------------------------------------------- rendering */
  var CAT_LINK = { driver: 'drivers', wood: 'fairway-woods', hybrid: 'hybrids', irons: 'irons', wedge: 'wedges', putter: 'putters', ball: 'golf-balls', bag: 'golf-bags' };

  function chip(label, key) {
    return '<span class="sr-chip">' + esc(label) + (key ? '<button type="button" data-drop="' + key + '" aria-label="Remove ' + esc(label) + '">×</button>' : '') + '</span>';
  }

  function understood() {
    var p = state.parsed, out = [];
    p.cats.forEach(function (c) { out.push(chip(CATS[c].label, 'cat:' + c)); });
    if (p.hand) out.push(chip(p.hand === 'L' ? 'Left-handed' : 'Right-handed', 'hand'));
    if (p.audience) out.push(chip({ F: 'Ladies', J: 'Junior', M: "Men's" }[p.audience], 'audience'));
    if (p.flex) out.push(chip(p.flex + ' flex', 'flex'));
    if (p.loft) out.push(chip(p.loft + ' loft', 'loft'));
    if (p.setOnly) out.push(chip('Full sets only', 'set'));
    if (p.min !== null && p.max !== null) out.push(chip('£' + p.min + ' to £' + p.max, 'price'));
    else if (p.max !== null) out.push(chip('Under £' + p.max, 'price'));
    else if (p.min !== null) out.push(chip('Over £' + p.min, 'price'));
    if (p.drops) out.push(chip('Genuine drops only', 'drops'));
    p.words.forEach(function (w) { out.push(chip('“' + w + '”', 'word:' + w)); });
    return out.join('');
  }

  function variantLabel(r, g) {
    if (g && g.base && r[1].indexOf(g.base) === 0 && r[1].length > g.base.length) {
      return r[1].slice(g.base.length).replace(/^[\s\-\/]+/, '');
    }
    var bits = [];
    if (r[10]) bits.push(r[10]);
    if (r[8]) bits.push(r[8]);
    if (r[9]) bits.push(r[9]);
    if (r[5] & F_LEFT) bits.push('Left hand');
    if (!bits.length && r[11]) bits.push(r[11]);
    return bits.length ? bits.join(' · ') : r[1];
  }
  function url(r) { return /^https?:/.test(r[13]) ? r[13] : TERMS.urlPrefix + r[13]; }
  function img(r) { var i = r[14]; return i && i[1] ? (/^https?:/.test(i[1]) ? i[1] : TERMS.imgPrefixes[i[0]] + i[1]) : ''; }

  function groupHTML(g, i) {
    var first = g.rows[0], m = g.model;
    var name = m ? m[1] : (g.base || first[1]).replace(/\b([\w']+(?: [\w']+)?) \1\b/gi, '$1');
    var retailers = Object.keys(g.retailers).length;
    var meta = [];
    if (g.rows.length > 1) meta.push(g.rows.length + ' options');
    meta.push(retailers + (retailers === 1 ? ' retailer' : ' retailers'));
    if (state.parsed.hand === 'L') meta[0] = g.rows.length + ' left-handed option' + (g.rows.length === 1 ? '' : 's');
    var photo = '';
    for (var k = 0; k < g.rows.length && !photo; k++) photo = img(g.rows[k]);
    var drop = g.drops ? '<span class="sr-badge">' + g.drops + ' genuine drop' + (g.drops === 1 ? '' : 's') + '</span>' : '';
    var single = g.rows.length === 1;
    var labelCount = {};
    g.rows.slice(0, 5).forEach(function (r) { var l = variantLabel(r, g); labelCount[l] = (labelCount[l] || 0) + 1; });
    var seen = {};
    var variants = g.rows.slice(0, 5).map(function (r) {
      var label = variantLabel(r, g);
      if (labelCount[label] > 1) {
        var shaft = r[1].split(' - ').slice(1).join(' - ');
        if (shaft) label += ' · ' + shaft;
      }
      seen[label] = 1;
      return '<li><span class="sr-v-label">' + esc(label) + '</span><span class="sr-v-ret">' + esc(TERMS.retailers[r[4]]) + '</span>' +
        '<span class="sr-v-price">' + money(r[2]) + (r[3] ? '<s>' + money(r[3]) + '</s>' : '') + '</span>' +
        '<a class="sr-shop" href="' + esc(url(r)) + '" target="_blank" rel="sponsored nofollow noopener">Shop</a></li>';
    }).join('');
    var more = '';
    if (m && m[2]) more = '<a class="sr-more" href="/prices/' + m[0] + '/">' + (g.rows.length > 5 ? 'All ' + g.rows.length + ' options, ' : '') + 'price history and verdict →</a>';
    else if (g.rows.length > 5) more = '<span class="sr-more-muted">Showing the 5 cheapest of ' + g.rows.length + ' options.</span>';
    return '<article class="sr-card' + (i === 0 && !single ? ' is-open' : '') + '">' +
      '<div class="sr-head">' +
        '<div class="sr-photo">' + (photo ? '<img src="' + esc(photo) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') + '</div>' +
        '<div class="sr-main"><h2 class="sr-name">' + (m && m[2] ? '<a href="/prices/' + m[0] + '/">' + esc(name) + '</a>' : esc(name)) + '</h2>' +
        '<p class="sr-meta">' + esc(meta.join(' · ')) + '</p>' + drop + '</div>' +
        '<div class="sr-price"><span>from</span><strong>' + money(g.from) + '</strong></div>' +
        (single ? '<a class="sr-shop sr-shop-main" href="' + esc(url(first)) + '" target="_blank" rel="sponsored nofollow noopener">Shop</a>'
          : '<button type="button" class="sr-toggle" aria-expanded="' + (i === 0) + '">Options<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg></button>') +
      '</div>' +
      (single ? (more ? '<div class="sr-foot">' + more + '</div>' : '') : '<div class="sr-variants"><ul>' + variants + '</ul>' + more + '</div>') +
      '</article>';
  }

  // Rows matching everything except one filter, so each filter's counts
  // show what you'd get by switching it.
  function rowsWithout(field) {
    var p = state.parsed, saved = {}, out = [];
    var map = { hand: ['hand'], audience: ['audience'], flex: ['flex'], drops: ['drops'] };
    var savedBrand = state.brandFilter, savedRet = state.retailerFilter;
    (map[field] || []).forEach(function (k) { saved[k] = p[k]; p[k] = k === 'drops' ? false : null; });
    if (field === 'brand') state.brandFilter = null;
    if (field === 'retailer') state.retailerFilter = null;
    (state.shards || []).forEach(function (shard) {
      shard.rows.forEach(function (row) {
        var model = row[12] >= 0 ? shard.models[row[12]] : null;
        if (rowMatches(row, p, model)) out.push({ row: row, shard: shard });
      });
    });
    Object.keys(saved).forEach(function (k) { p[k] = saved[k]; });
    state.brandFilter = savedBrand; state.retailerFilter = savedRet;
    return out;
  }

  function facetHTML() {
    var p = state.parsed, rows = state.all;
    function count(fn, field) {
      var c = {};
      (field ? rowsWithout(field) : rows).forEach(function (x) { var k = fn(x.row); if (k) c[k] = (c[k] || 0) + 1; });
      return c;
    }
    function block(title, items) {
      if (!items.length) return '';
      return '<div class="sr-facet"><h3>' + title + '</h3>' + items.join('') + '</div>';
    }
    function opt(label, n, on, action) {
      return '<button type="button" class="sr-opt' + (on ? ' is-on' : '') + '" data-act="' + esc(action) + '"><span>' + esc(label) + '</span><em>' + n + '</em></button>';
    }
    var out = '';
    var hands = count(function (r) { return r[5] & F_LEFT ? 'L' : 'R'; }, 'hand');
    var isClubs = state.parsed.cats.some(function (c) { return CLUBS.indexOf(c) !== -1; }) || rows.some(function (x) { return CLUBS.indexOf(x.shard.cat) !== -1; });
    if (isClubs) out += block('Hand', [opt('Left-handed', hands.L || 0, p.hand === 'L', 'hand:L'), opt('Right-handed', hands.R || 0, p.hand === 'R', 'hand:R')]);
    var aud = count(function (r) { return r[6]; }, 'audience');
    out += block('Who for', [['M', "Men's"], ['F', 'Ladies'], ['J', 'Junior']].filter(function (a) { return aud[a[0]] || p.audience === a[0]; })
      .map(function (a) { return opt(a[1], aud[a[0]] || 0, p.audience === a[0], 'aud:' + a[0]); }));
    var flex = count(function (r) { return r[9]; }, 'flex');
    out += block('Flex', Object.keys(flex).sort(function (a, b) { return flex[b] - flex[a]; }).slice(0, 6)
      .map(function (f) { return opt(f, flex[f], p.flex === f, 'flex:' + f); }));
    var brands = count(function (r) { return r[7]; }, 'brand');
    out += block('Brand', Object.keys(brands).sort(function (a, b) { return brands[b] - brands[a]; }).slice(0, 8)
      .map(function (b) { return opt(b, brands[b], state.brandFilter === b.toLowerCase(), 'brand:' + b.toLowerCase()); }));
    var ret = count(function (r) { return String(r[4] + 1); }, 'retailer');
    out += block('Retailer', Object.keys(ret).sort(function (a, b) { return ret[b] - ret[a]; })
      .map(function (k) { return opt(TERMS.retailers[k - 1], ret[k], state.retailerFilter === k - 1, 'ret:' + (k - 1)); }));
    var drops = rowsWithout('drops').filter(function (x) { return x.row[5] & F_DROP; }).length;
    out += block('Deals', [opt('Genuine drops only', drops, p.drops, 'drops'), opt('Include out of stock', '', state.includeOut, 'out')]);
    return out;
  }

  function noResults() {
    var p = state.parsed;
    var browse = [];
    p.cats.forEach(function (c) {
      if (CAT_LINK[c]) browse.push('<a href="/prices/' + CAT_LINK[c] + '/">' + esc(CATS[c].label) + ' price guide</a>');
      browse.push('<a href="/shop.html?category=' + c + '">All ' + esc(CATS[c].label.toLowerCase()) + '</a>');
    });
    if (!browse.length) browse.push('<a href="/shop.html">Shop all deals</a>', '<a href="/prices/">Price guides</a>');
    return '<div class="sr-empty"><h2>No exact match for “' + esc(state.q) + '”</h2>' +
      '<p>None of the UK retailers we track list that right now' + (state.closest ? '. Here are the closest we do track.' : '.') + '</p>' +
      (state.closest || '') +
      '<div class="sr-empty-alert"><strong>Waiting for it to appear?</strong><span>Get deal alerts and we’ll tell you when prices worth knowing about land.</span><a class="sr-btn" href="/#alerts">Get deal alerts</a></div>' +
      '<p class="sr-browse">Or browse: ' + browse.join(' · ') + '</p></div>';
  }

  // Loosen the search one step at a time until something matches.
  function findClosest() {
    var p = state.parsed, saved = JSON.stringify(p), tries = [];
    if (p.words.length > 1) for (var i = p.words.length - 1; i >= 0; i--) { var w = p.words.slice(); w.splice(i, 1); tries.push({ words: w }); }
    if (p.max !== null || p.min !== null) tries.push({ min: null, max: null });
    if (p.hand || p.audience || p.flex || p.loft || p.drops) tries.push({ hand: null, audience: null, flex: null, loft: null, drops: false });
    if (p.words.length) tries.push({ words: [] });
    for (var t = 0; t < tries.length; t++) {
      state.parsed = Object.assign(JSON.parse(saved), tries[t]);
      compute();
      if (state.groups.length) {
        var html = '<div class="sr-list sr-closest">' + state.groups.slice(0, 3).map(function (g) { return groupHTML(g, 1); }).join('') + '</div>';
        state.parsed = JSON.parse(saved);
        compute();
        return html;
      }
    }
    state.parsed = JSON.parse(saved);
    compute();
    return '';
  }

  function render() {
    var p = state.parsed, n = state.groups.length;
    var corr = '';
    if (state.corrected) {
      corr = '<p class="sr-corrected">Showing results for ' + Object.keys(state.corrected).map(function (k) { return '<strong>' + esc(state.corrected[k]) + '</strong>'; }).join(', ') +
        ' (you typed ' + Object.keys(state.corrected).map(function (k) { return '“' + esc(k) + '”'; }).join(', ') + ')</p>';
    }
    $('sr-understood').innerHTML = (understood() ? '<span class="sr-label">We read that as:</span>' + understood() : '') + corr;
    if (!n) {
      state.closest = findClosest();
      $('sr-title').textContent = 'No exact match';
      $('sr-status').textContent = '';
      $('sr-results').innerHTML = noResults();
      $('sr-facets').innerHTML = '';
      document.querySelector('.sr-side').hidden = true;
      document.querySelector('.sr-layout').classList.add('no-side');
      document.querySelector('.sr-bar').hidden = true;
      $('sr-more').hidden = true;
      if (window.gtag) gtag('event', 'search_no_results', { search_term: state.q });
      return;
    }
    var listings = state.all.length;
    $('sr-title').textContent = n.toLocaleString('en-GB') + (n === 1 ? ' result' : ' results') + (state.q && !state.edited ? ' for “' + state.q + '”' : '');
    $('sr-status').textContent = listings.toLocaleString('en-GB') + ' listing' + (listings === 1 ? '' : 's') + (listings !== n ? ', grouped into ' + n.toLocaleString('en-GB') + ' models and products' : '');
    document.querySelector('.sr-side').hidden = false;
    document.querySelector('.sr-layout').classList.remove('no-side');
    document.querySelector('.sr-bar').hidden = false;
    $('sr-results').innerHTML = state.groups.slice(0, state.shown).map(groupHTML).join('');
    $('sr-facets').innerHTML = facetHTML();
    $('sr-more').hidden = n <= state.shown;
    $('sr-more').textContent = 'Show more (' + (n - state.shown).toLocaleString('en-GB') + ' left)';
    $('sr-sort').value = state.sort;
  }

  /* ---------------------------------------------------------------- interaction */
  function rerender() { state.edited = true; compute(); render(); }
  function dropConstraint(key) {
    var p = state.parsed;
    if (key.indexOf('cat:') === 0) { p.cats = p.cats.filter(function (c) { return c !== key.slice(4); }); }
    else if (key === 'hand') p.hand = null;
    else if (key === 'audience') p.audience = null;
    else if (key === 'flex') p.flex = null;
    else if (key === 'loft') p.loft = null;
    else if (key === 'set') p.setOnly = false;
    else if (key === 'price') { p.min = null; p.max = null; }
    else if (key === 'drops') p.drops = false;
    else if (key.indexOf('word:') === 0) { var w = key.slice(5); p.words = p.words.filter(function (x) { return x !== w; }); }
    // Removing a category may need other category files.
    var need = p.cats.length ? p.cats : (p.words.length ? null : CLUBS.concat(['ball']));
    if (need) {
      Promise.all(need.map(loadShard)).then(function (s) { state.shards = s; rerender(); });
    } else {
      var cats = {};
      p.words.forEach(function (w) { catsForWord(w).forEach(function (c) { cats[c] = 1; }); });
      Promise.all(Object.keys(cats).map(loadShard)).then(function (s) { state.shards = s; rerender(); });
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-drop],[data-act],.sr-toggle');
    if (!t) return;
    if (t.classList.contains('sr-toggle')) {
      var card = t.closest('.sr-card'), open = !card.classList.contains('is-open');
      card.classList.toggle('is-open', open);
      t.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    if (t.hasAttribute('data-drop')) { dropConstraint(t.getAttribute('data-drop')); return; }
    var a = t.getAttribute('data-act'), p = state.parsed, v = a.split(':')[1];
    if (a.indexOf('hand:') === 0) p.hand = p.hand === v ? null : v;
    else if (a.indexOf('aud:') === 0) p.audience = p.audience === v ? null : v;
    else if (a.indexOf('flex:') === 0) p.flex = p.flex === v ? null : v;
    else if (a.indexOf('brand:') === 0) state.brandFilter = state.brandFilter === v ? null : v;
    else if (a.indexOf('ret:') === 0) state.retailerFilter = state.retailerFilter === +v ? null : +v;
    else if (a === 'drops') p.drops = !p.drops;
    else if (a === 'out') state.includeOut = !state.includeOut;
    state.shown = 20;
    rerender();
  });
  $('sr-sort').addEventListener('change', function () { state.sort = this.value; compute(); render(); });
  $('sr-more').addEventListener('click', function () { state.shown += 20; render(); });
  $('sr-filters-btn').addEventListener('click', function () {
    var f = $('sr-facets'), open = !f.classList.contains('is-open');
    f.classList.toggle('is-open', open);
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('sr-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('sr-q').value.trim();
    if (!q) return;
    history.pushState({ q: q }, '', '/search.html?q=' + encodeURIComponent(q));
    if (window.gtag) gtag('event', 'search', { search_term: q });
    state.sort = 'best';
    run(q);
  });
  window.addEventListener('popstate', function () { run(new URLSearchParams(location.search).get('q') || ''); });

  /* ---------------------------------------------------------------- recent searches (this device only) */
  function saveRecent(q) {
    if (!q) return;
    try {
      var list = JSON.parse(localStorage.getItem('gp_recent_searches') || '[]').filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); });
      list.unshift(q);
      localStorage.setItem('gp_recent_searches', JSON.stringify(list.slice(0, 6)));
    } catch (e) { /* storage blocked: fine */ }
  }

  var q0 = new URLSearchParams(location.search).get('q') || '';
  if (q0) run(q0);
  else {
    $('sr-title').textContent = 'Search golf gear';
    $('sr-status').textContent = 'Try a model, a brand, or something like “lefty drivers under £300”.';
    $('sr-more').hidden = true;
  }
})();
