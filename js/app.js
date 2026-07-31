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

// Deal Score / Verified Discount badge — reads the `priceInsight` field
// scripts/update_deals.py writes onto every priced product once real
// price history has built up. Returns '' (nothing rendered) for a
// product with no history yet, or one whose current price isn't
// noteworthy either way — a badge only earns its place when it tells the
// shopper something genuinely useful, not on every single card.
// Kept in sync with the equivalent renderPriceBadge() in js/shop.js.
function renderPriceBadge(p) {
  const insight = p.priceInsight;
  if (!insight || insight.status === 'new') return '';
  if (insight.status === 'lowest_tracked' && insight.verifiedDiscount) {
    return `<span class="price-insight-badge price-insight-badge--low">Lowest price in ${insight.daysTracked} days</span>`;
  }
  if (insight.status === 'lowest_tracked') {
    return `<span class="price-insight-badge price-insight-badge--low">Lowest tracked price</span>`;
  }
  if (insight.trend === 'rising') {
    return `<span class="price-insight-badge price-insight-badge--rising">Price recently went up</span>`;
  }
  if (insight.status === 'highest_tracked') {
    return `<span class="price-insight-badge price-insight-badge--high">Higher than usual right now</span>`;
  }
  return '';
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
        ${renderPriceBadge(d)}
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
        ${renderPriceBadge(d)}
      </div>
      <div class="now">${money(d.salePrice)}<span class="pct">${d.savePct}% drop</span></div>
    </a>`;
}

// Trending pills have a fixed-ish width, so a very long real product name
// (much more common now the catalog has thousands of items instead of ~78
// hand-shortened ones) can overflow the pill. Truncates by word count
// rather than raw character count so it never cuts a word in half.
function truncateWords(name, maxWords) {
  const words = name.split(' ');
  if (words.length <= maxWords) return name;
  return words.slice(0, maxWords).join(' ') + '…';
}

function renderTrending(items) {
  const list = document.getElementById('trending-list');
  if (!list) return;
  list.innerHTML = items.map(t => {
    const tag = t.tagInfo;
    return `
    <a class="tag" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <span class="tag-name">${truncateWords(t.name, 5)}</span>
      <span class="${tag.cls}">${tag.emoji} ${tag.label}</span>
    </a>
  `;
  }).join('');
}

// Real, evidence-backed tag variety — every label here reflects an actual
// signal on the product (a genuinely verified low price, a live falling
// trend, a real repeated stock-out pattern), never an arbitrary label for
// variety's sake alone. Checked in priority order; falls back to the
// original Hot/Rising discount-size split if nothing more specific
// applies, so there's always a sensible label without ever inventing one.
function classifyTrendingTag(item) {
  const insight = item.priceInsight;
  if (insight && insight.status === 'lowest_tracked' && insight.verifiedDiscount) {
    return { label: 'Verified Low', emoji: '💎', cls: 'verified-low' };
  }
  if (insight && insight.trend === 'falling') {
    return { label: 'Dropping', emoji: '📉', cls: 'dropping' };
  }
  if (item.stockInsight && item.stockInsight.sellsOutFast) {
    return { label: 'Sells Fast', emoji: '🏃', cls: 'sells-fast' };
  }
  if (item.savePct >= 28) {
    return { label: 'Hot', emoji: '🔥', cls: 'hot' };
  }
  return { label: 'Rising', emoji: '📈', cls: 'rising' };
}

// Popularity is a proxy, not real purchase/click data — no live click
// tracking exists for this static site yet (would need Google Analytics'
// Data API wired into a scheduled job, similar to how the price feed
// works). Weighted toward being stocked by more retailers, with discount
// size as a secondary nudge.
function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

// Male / Female / Junior — kept in sync with js/shop.js's classifyAudience
// and scripts/update_deals.py's classify_audience(). Junior beats
// Female/Male since a junior item is sometimes also described with
// "girls"/"boys", which would otherwise misread as a gender signal.
const JUNIOR_WORDS = ['junior', 'boys', 'girls', 'kids golf', 'us kids golf'];
const FEMALE_WORDS = ["women's", 'womens', 'women', 'ladies', "lady's"];
function classifyAudience(p) {
  if (p.audience) return p.audience;
  const name = p.name || '';
  const lower = name.toLowerCase();
  for (const word of JUNIOR_WORDS) {
    const re = new RegExp('\\b' + word.replace(/'/g, "'?") + '\\b', 'i');
    if (re.test(lower)) return 'Junior';
  }
  // A skort or dress is unambiguously women's apparel by its sub-type,
  // regardless of whether the product name also says "women's"/"ladies"
  // — kept in sync with scripts/update_deals.py's classify_audience().
  if (p.icon === 'skort' || p.icon === 'dress') return 'Female';
  for (const word of FEMALE_WORDS) {
    const re = new RegExp('\\b' + word.replace(/'/g, "'?") + '\\b', 'i');
    if (re.test(lower)) return 'Female';
  }
  return 'Male';
}

// Real golf club categories — used for the "Today's Best Golf Deals"
// minimum-clubs rule. Note: the no-duplicate-category diversity rule below
// means at most ONE item per category can appear, so "at least 5 clubs"
// in practice means at least 5 of these 7 distinct club types represented
// (one driver, one iron set, etc.) — not 5 different drivers.
const CLUB_CATEGORIES = new Set(['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter', 'sets']);

// Deterministic per-day shuffle: same seed (today's date) always produces
// the same order for every visitor on the same day, but a new day produces
// a different order — this is what makes "Today's Best Golf Deals" and
// Trending genuinely rotate daily without needing any real backend state,
// while still only ever drawing from a pool of genuinely good discounts.
function seededShuffle(array, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  function rng() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Picks `count` items from `pool` with:
//  - no two sharing the same specific type (driver, putter, headcover,
//    etc.) so the section doesn't show two of basically the same thing
//  - optionally, a minimum number of golf-club items (minClubCount)
//  - optionally, a minimum percentage classified "Male" (minMalePercent) —
//    golf's core audience skews male, but women's apparel tends to carry
//    deeper/more frequent discounts, so a pure "best discount" sort would
//    over-represent women's items relative to the audience
// Club-minimum is enforced before the male-minimum, since satisfying it
// tends to also help the male count (clubs are overwhelmingly male-default
// in this catalog), reducing how many further swaps are needed.
// Club-minimum is enforced before the male-minimum, since satisfying it
// tends to also help the male count (clubs are overwhelmingly male-default
// in this catalog), reducing how many further swaps are needed.
//
// `fallbackPool` (the full, unrestricted product list) is used specifically
// for replacement searches during swaps — this matters because the daily
// rotating `pool` is filtered to a top-discount slice, and if Female/Junior
// items systematically carry bigger discounts than Male items (true here —
// women's apparel tends to see deeper markdowns), that top-discount slice
// could end up with too few Male candidates to hit 80% no matter how the
// swap logic works. Searching the full catalog for replacements removes
// that ceiling.
function pickWithConstraints(pool, count, usedKeys, opts, fallbackPool) {
  const searchPool = fallbackPool || pool;
  const { minMalePercent, minClubCount } = opts || {};
  const seen = new Set(usedKeys);
  const picked = [];

  function tryPick(item) {
    const key = item.icon || item.category;
    if (seen.has(key)) return false;
    picked.push(item);
    seen.add(key);
    return true;
  }

  for (const item of pool) {
    if (picked.length === count) break;
    tryPick(item);
  }

  if (minClubCount) {
    let guard = 0;
    while (picked.filter(p => CLUB_CATEGORIES.has(p.category)).length < minClubCount && guard < count * 3) {
      guard++;
      const nonClubIdx = [...picked].reverse().findIndex(p => !CLUB_CATEGORIES.has(p.category));
      if (nonClubIdx === -1) break;
      const realIdx = picked.length - 1 - nonClubIdx;
      const replacement = searchPool.find(item =>
        CLUB_CATEGORIES.has(item.category) && !picked.includes(item) && !seen.has(item.icon || item.category)
      );
      if (!replacement) break;
      seen.delete(picked[realIdx].icon || picked[realIdx].category);
      picked[realIdx] = replacement;
      seen.add(replacement.icon || replacement.category);
    }
  }

  if (minMalePercent) {
    const minMaleCount = Math.ceil(count * minMalePercent);
    let guard = 0;
    while (picked.filter(p => classifyAudience(p) === 'Male').length < minMaleCount && guard < count * 3) {
      guard++;
      const nonMaleIdx = [...picked].reverse().findIndex(p => classifyAudience(p) !== 'Male');
      if (nonMaleIdx === -1) break;
      const realIdx = picked.length - 1 - nonMaleIdx;
      const replacement = searchPool.find(item =>
        classifyAudience(item) === 'Male' && !picked.includes(item) && !seen.has(item.icon || item.category)
      );
      if (!replacement) break;
      seen.delete(picked[realIdx].icon || picked[realIdx].category);
      picked[realIdx] = replacement;
      seen.add(replacement.icon || replacement.category);
    }
  }

  // Fill any remaining slots with fresh, unseen keys first — this MUST
  // respect `seen`, otherwise it can silently reintroduce a duplicate
  // category/icon (including one already used by an earlier homepage
  // section, since that's passed in via usedKeys).
  if (picked.length < count) {
    for (const item of searchPool) {
      if (picked.length === count) break;
      const key = item.icon || item.category;
      if (!picked.includes(item) && !seen.has(key)) {
        picked.push(item);
        seen.add(key);
      }
    }
  }
  // Absolute last resort — only reached if the catalog genuinely doesn't
  // have enough distinct categories/icons to fill every slot uniquely.
  if (picked.length < count) {
    for (const item of searchPool) {
      if (picked.length === count) break;
      if (!picked.includes(item)) picked.push(item);
    }
  }
  return picked;
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    // Products without a known inStock value (e.g. older hand-curated
    // entries from before stock tracking existed) are treated as
    // available — only an explicit inStock:false excludes a product here.
    // A product that's genuinely sold out should never be one of the
    // "best deals" someone clicks through to, only to find it unavailable.
    const availableProducts = data.products.filter(p => p.inStock !== false);

    // Prefer products with a real photo over icon-only ones, then by
    // discount size — this is the quality gate before daily rotation kicks
    // in below, so rotation only ever surfaces genuinely good deals.
    const qualityRanked = [...availableProducts].sort((a, b) => {
      const aHasImage = a.image ? 1 : 0;
      const bHasImage = b.image ? 1 : 0;
      if (aHasImage !== bHasImage) return bHasImage - aHasImage;
      return b.savePct - a.savePct;
    });

    // Take a generous top-quality pool, then deterministically shuffle it
    // using today's date as the seed. Same day = same order for everyone;
    // a new day reshuffles which of these top deals surface and in what
    // combination — this is what makes the homepage feel like it changes
    // daily without needing any real backend/database.
    const todaySeed = new Date().toISOString().slice(0, 10);
    // Widened from an earlier 80 — with an ~11,000-product catalog, the
    // top 80 by discount alone was often dominated by whichever categories
    // happen to carry the deepest blanket discounts (commonly
    // apparel/accessories), leaving too few genuine club candidates to
    // satisfy minClubCount without constant swapping — and too few
    // day-to-day differences for real rotation to be visible at all.
    const qualifiedPool = qualityRanked.slice(0, Math.min(250, qualityRanked.length));
    const dailyPool = seededShuffle(qualifiedPool, todaySeed);
    // A SEPARATE daily shuffle of the full quality-ranked catalog, used
    // only as the search source for constraint-driven swaps (club-count /
    // male-quota replacements) below. Previously these swaps always
    // searched the raw, fixed discount-sorted order and so always found
    // the same single highest-discount candidate — meaning any day that
    // needed a swap (most days, given how tight the constraints are)
    // showed an identical replacement regardless of the date. Shuffling
    // this too means swap-ins genuinely rotate day to day as well.
    const shuffledFullPool = seededShuffle(qualityRanked, todaySeed + '-swap');

    const bestDeals = pickWithConstraints(dailyPool, 12, [], { minMalePercent: 0.8, minClubCount: 5 }, shuffledFullPool);
    const bestKeys = bestDeals.map(d => d.icon || d.category);

    const priceDrops = pickWithConstraints(
      dailyPool.filter(d => !bestDeals.includes(d)), 6, bestKeys, { minMalePercent: 0.8 }, shuffledFullPool
    );
    const priceDropKeys = priceDrops.map(d => d.icon || d.category);

    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = bestDeals.map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = priceDrops.map(dropRowHTML).join('');

    // Trending: same daily-rotating pool, popularity-ordered within it,
    // also held to the 80% Male rule for the hero page as a whole.
    const usedForTrending = new Set([...bestKeys, ...priceDropKeys]);
    const trendingPool = [...dailyPool]
      .filter(d => !bestDeals.includes(d) && !priceDrops.includes(d))
      .sort((a, b) => popularityScore(b) - popularityScore(a));
    const trendingRaw = pickWithConstraints(trendingPool, 12, [...usedForTrending], { minMalePercent: 0.8 }, shuffledFullPool);
    const trendingPicks = trendingRaw.map(item => ({
      name: item.name,
      tagInfo: classifyTrendingTag(item),
      affiliateUrl: item.affiliateUrl,
      category: item.category,
    }));
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
