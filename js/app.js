document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '£' + n.toFixed(2);
}

// Until real per-product photos flow in from an approved affiliate feed, we
// show a clean category icon/photo instead of a stock image that doesn't
// match the exact item. Real feed data will include an "image" field with
// the retailer's own licensed product photo — when present, that's used
// automatically instead.
function iconFor(category) {
  const known = ['driver', 'putter', 'irons', 'wood', 'hybrid', 'wedge', 'ball', 'bag', 'apparel', 'shoes', 'accessories'];
  const file = known.includes(category) ? category : 'driver';
  return `assets/icons/${file}.svg`;
}

function badgeFor(savePct) {
  if (savePct >= 28) return { label: 'HOT DEAL', cls: 'hot-deal' };
  if (savePct >= 20) return { label: 'PRICE DROP', cls: 'price-drop' };
  return { label: 'BEST PRICE', cls: '' };
}

// Only one category had a genuinely matching, verified free photo available
// (a generic smartwatch shot — close enough to a GPS watch to be honest).
// Everything else on this list (rangefinders, push carts, gloves, umbrellas,
// most apparel types) turned up nothing but paid Getty/iStock content or
// branded retailer photography after real searching — so those fall back to
// a clean icon on a plain background rather than forcing a mismatched photo.
const ICON_BACKDROPS = {
  'gps-watch': 'https://images.pexels.com/photos/9130511/pexels-photo-9130511.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600'
};

function thumbHTML(d) {
  if (d.image) {
    return `<img src="${d.image}" alt="${d.name}" loading="lazy">`;
  }
  const iconSrc = d.icon ? `assets/icons/${d.icon}.svg` : iconFor(d.category);
  return `<span class="icon-badge"><img src="${iconSrc}" alt="${d.name}" loading="lazy"></span>`;
}
function thumbClass(d) {
  return d.image ? 'thumb' : 'thumb icon-thumb';
}
function thumbStyle(d) {
  if (d.image) return '';
  const backdrop = ICON_BACKDROPS[d.icon];
  return backdrop ? ` style="background-image:url('${backdrop}')"` : '';
}

function dealCardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <div class="${thumbClass(d)}"${thumbStyle(d)}>
        <span class="badge ${badge.cls}">${badge.label}</span>
        ${thumbHTML(d)}
      </div>
      <div class="deal-body">
        <h3>${d.name}</h3>
        <div class="price-row">
          <span class="retail-price">${money(d.retailPrice)}</span>
        </div>
        <div class="price-row">
          <span class="sale-price">${money(d.salePrice)}</span>
        </div>
        <span class="save-pill">Save ${money(d.retailPrice - d.salePrice)} (${d.savePct}%)</span>
        <div class="deal-foot">
          <span>Available at ${d.retailerCount} retailers</span>
        </div>
      </div>
    </a>`;
}

function dropRowHTML(d) {
  return `
    <a class="drop-row" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <div class="drop-thumb ${d.image ? '' : 'icon-thumb'}"${thumbStyle(d)}>${thumbHTML(d)}</div>
      <div class="info">
        <h4>${d.name}</h4>
        <span class="was">Was ${money(d.retailPrice)}</span>
      </div>
      <div class="now">${money(d.salePrice)}<span class="pct">${d.savePct}% drop</span></div>
    </a>`;
}

function renderTrending(items) {
  const list = document.getElementById('trending-list');
  if (!list) return;
  // Long real product names are handled by the .tag CSS (white-space:
  // nowrap + text-overflow: ellipsis) rather than a fixed character limit,
  // since this list is now built dynamically from the live catalog instead
  // of a small hand-picked, hand-shortened curated list.
  list.innerHTML = items.map(t => `
    <a class="tag" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">${t.name} <span class="${t.tag.toLowerCase()}">${t.tag === 'Hot' ? '🔥' : '📈'} ${t.tag}</span></a>
  `).join('');
}

// Popularity is a proxy, not real purchase/click data — no live click
// tracking exists for this static site yet (would need Google Analytics'
// Data API wired into a scheduled job, similar to how the price feed
// works). Weighted toward being stocked by more retailers, with discount
// size as a secondary nudge.
function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

const FEMALE_KEYWORDS = ["women's", "womens", "women", "ladies", "lady's", "girls", "girl's"];
function isFemaleProduct(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return FEMALE_KEYWORDS.some(k => new RegExp('\\b' + k.replace("'", "'?") + '\\b', 'i').test(lower));
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    // Prefer products with a real photo over icon-only ones when picking the
    // homepage's top cards — still genuinely the best discounts, just
    // weighted so the hero section always leads with its best-looking cards.
    const sorted = [...data.products].sort((a, b) => {
      const aHasImage = a.image ? 1 : 0;
      const bHasImage = b.image ? 1 : 0;
      if (aHasImage !== bHasImage) return bHasImage - aHasImage;
      return b.savePct - a.savePct;
    });

    // Pick the top N items with no two sharing the same specific type
    // (driver, putter, headcover, etc.) so the featured section doesn't show
    // two headcovers or two drivers side by side. Falls back to allowing
    // repeats only if there genuinely aren't enough distinct types.
    //
    // minMaleOrUnisex enforces a minimum count of non-explicitly-female
    // items in the pick — golf skews male in participation, but women's
    // apparel tends to carry deeper/more frequent discounts, so a pure
    // "best discount" sort would over-represent women's items relative to
    // the audience. This keeps the featured section broadly representative
    // without excluding women's deals outright.
    function pickDiverseTop(list, count, usedKeys, minMaleOrUnisex) {
      const picked = [];
      const seen = new Set(usedKeys);
      let maleOrUnisexCount = 0;

      function tryPick(item) {
        const key = item.icon || item.category;
        if (seen.has(key)) return false;
        picked.push(item);
        seen.add(key);
        if (!isFemaleProduct(item.name)) maleOrUnisexCount++;
        return true;
      }

      for (const item of list) {
        if (picked.length === count) break;
        tryPick(item);
      }

      // If we came up short on male/unisex representation, do a second
      // pass: swap out the lowest-ranked female-flagged pick for the next
      // best male/unisex item not already used, repeating until the
      // minimum is met or we run out of candidates.
      if (minMaleOrUnisex) {
        let guard = 0;
        while (maleOrUnisexCount < minMaleOrUnisex && guard < count * 2) {
          guard++;
          const femaleIdx = [...picked].reverse().findIndex(p => isFemaleProduct(p.name));
          if (femaleIdx === -1) break;
          const realIdx = picked.length - 1 - femaleIdx;
          const replacement = list.find(item =>
            !isFemaleProduct(item.name) &&
            !picked.includes(item) &&
            !seen.has(item.icon || item.category)
          );
          if (!replacement) break;
          seen.delete(picked[realIdx].icon || picked[realIdx].category);
          picked[realIdx] = replacement;
          seen.add(replacement.icon || replacement.category);
          maleOrUnisexCount++;
        }
      }

      if (picked.length < count) {
        for (const item of list) {
          if (picked.length === count) break;
          if (!picked.includes(item)) picked.push(item);
        }
      }
      return picked;
    }

    const bestDeals = pickDiverseTop(sorted, 12, [], 9);
    const bestKeys = bestDeals.map(d => d.icon || d.category);
    const priceDrops = pickDiverseTop(
      sorted.filter(d => !bestDeals.includes(d)), 6, bestKeys
    );

    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = bestDeals.map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = priceDrops.map(dropRowHTML).join('');

    // Trending: computed from the live catalog by popularity proxy, not
    // the old small hand-picked list — this scales properly now that the
    // catalog has thousands of real products instead of ~78. "Hot" vs
    // "Rising" is a simple discount-size split, also a proxy.
    const usedForTrending = new Set([...bestKeys]);
    const trendingPicks = [];
    for (const item of [...data.products].sort((a, b) => popularityScore(b) - popularityScore(a))) {
      const key = item.icon || item.category;
      if (usedForTrending.has(key)) continue;
      trendingPicks.push({
        name: item.name,
        tag: item.savePct >= 25 ? 'Hot' : 'Rising',
        affiliateUrl: item.affiliateUrl,
        category: item.category,
      });
      usedForTrending.add(key);
      if (trendingPicks.length === 12) break;
    }
    renderTrending(trendingPicks);
  })
  .catch(err => console.error('Could not load products.json', err));

const searchForm = document.getElementById('search-form');
if (searchForm) {
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    window.location.href = 'shop.html' + (q ? ('?q=' + encodeURIComponent(q)) : '');
  });
}
