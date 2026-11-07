// GolfPrice AI extension: match a retailer's product title to one of our models.
// Every word of our model name must be in the title, and no extra "model" words
// may sit inside the stretch of title the name covers (so "ZXi LS Driver" never
// matches our "ZXi Driver"). Shared by the extension and the test script.
(function (root) {
  var SYN = { iron: 'irons', woods: 'wood', fairways: 'fairway', hybrids: 'hybrid', rescue: 'hybrid', drivers: 'driver',
    wedges: 'wedge', putters: 'putter', balls: 'ball', ladies: 'womens', women: 'womens', woman: 'womens', lady: 'womens',
    men: 'mens', gents: 'mens', trolleys: 'trolley', bags: 'bag', shoes: 'shoe', gloves: 'glove' };
  var GENERIC = {};
  ('mens womens left right hand handed lh rh golf steel graphite shaft shafted the new and with in of for a ' +
   'club clubs set 2023 2024 2025 2026 2027 regular stiff senior lite x flex x-stiff uniflex custom stock ' +
   'mrh lrh rhd lhd mlh womens junior edition lithium gps piece pc dozen pack ' +
   'black white red blue navy grey gray green yellow orange pink purple silver gold charcoal olive lime').split(' ').forEach(function (w) { GENERIC[w] = 1; });

  function words(s) {
    s = String(s || '').toLowerCase().replace(/['’]s\b/g, 's').replace(/&/g, ' and ').replace(/[^a-z0-9.+]+/g, ' ');
    return s.split(' ').filter(Boolean).map(function (w) {
      w = w.replace(/^\.+|\.+$/g, '');
      return SYN[w] || w;
    }).filter(Boolean);
  }

  function prep(models) {  // models: [[name, type, n, alias, slug], ...] from search-suggest.json
    return models.filter(function (m) { return m[4]; }).map(function (m) {
      var seen = {}, w = words(m[0]).filter(function (x) {
        if (seen[x] || x === 'golf') return false;   // "Cart Bag Golf Bag" -> cart, bag
        seen[x] = 1; return true;
      });
      return { name: m[0], slug: m[4], n: m[2] || 0, w: w };
    });
  }

  function score(m, t, pos) {
    var at = [], i, p;
    for (i = 0; i < m.w.length; i++) {
      p = pos[m.w[i]];
      if (p === undefined) return 0;
      at.push(p);
    }
    var lo = Math.min.apply(null, at), hi = Math.max.apply(null, at), mine = {};
    m.w.forEach(function (w) { mine[w] = 1; });
    for (i = lo; i <= hi; i++) if (!mine[t[i]] && !GENERIC[t[i]] && !(/^\d+$/.test(t[i]) && +t[i] >= 10)) return 0;
    return m.w.length;
  }

  function find(title, list) {
    var t = words(title), pos = {}, best = null, bs = 0, tie = false;
    t.forEach(function (w, i) { if (pos[w] === undefined) pos[w] = i; });
    for (var k = 0; k < list.length; k++) {
      var s = score(list[k], t, pos);
      if (!s) continue;
      if (s > bs) { bs = s; best = list[k]; tie = false; }
      else if (s === bs && best && list[k].slug !== best.slug) tie = true;
    }
    return best && !tie && bs >= 2 ? best : null;
  }

  var api = { words: words, prep: prep, find: find };
  if (typeof module !== 'undefined') module.exports = api; else root.GPMatch = api;
})(this);
