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

// If a real product image URL is broken (dead retailer link, hotlink
// protection, slow/failed CDN request) the browser shows its own small
// broken-image icon — this swaps that out for the same clean icon
// fallback already used for products with no image field at all, rather
// than ever letting a broken-image icon reach a visitor. Kept as a
// duplicate of shop.js's identical function — no build step / module
// system on this site, consistent with how other small helpers are
// already duplicated between app.js and shop.js.
function handleImgError(imgEl, iconSrc) {
  imgEl.onerror = null;
  const container = imgEl.closest('.thumb, .drop-thumb');
  if (!container) return;
  container.classList.add('icon-thumb');
  container.innerHTML = `<span class="icon-badge"><img src="${iconSrc}" alt="${imgEl.alt}"></span>`;
}

function thumbHTML(d) {
  if (d.image) {
    const fallbackIcon = d.icon ? `assets/icons/${d.icon}.svg` : iconFor(d.category);
    return `<img src="${d.image}" alt="${d.name}" loading="lazy" onerror="handleImgError(this, '${fallbackIcon}')">`;
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

// Crowd-Verified Pricing — same pattern as shop.js's reportPriceLinkHTML,
// kept as a duplicate here rather than a shared import since this site
// has no build step / module system; consistent with how other small
// helpers (money, thumbHTML, etc.) are already duplicated between
// app.js and shop.js.
function reportPriceLinkHTML(d) {
  const subject = encodeURIComponent(`Pricing issue: ${d.name}`);
  const body = encodeURIComponent(
    `Hi, I think there might be a pricing issue with this product:\n\n${d.name}\nShown price: ${money(d.salePrice)}\nLink: ${d.affiliateUrl}\n\nWhat's wrong: `
  );
  const mailto = `mailto:hello@golfpriceai.com?subject=${subject}&body=${body}`;
  // Must NOT be a real <a> — .deal-card is itself an <a>, and a nested
  // <a> inside another <a> is invalid HTML. Browsers silently auto-close
  // the outer anchor the instant they hit the nested one, which ejects
  // everything after it (the rest of .deal-body — title, price, this
  // link, all of it) out of the card entirely, as a stray sibling. That
  // was the real cause of the card layout breaking. A span styled and
  // behaving identically (click + keyboard) avoids the nested-anchor
  // problem entirely while working exactly the same for a visitor.
  return `<span class="report-price-link" role="button" tabindex="0" onclick="event.preventDefault();event.stopPropagation();window.location.href='${mailto}';" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();window.location.href='${mailto}';}">⚠️ Report a pricing issue</span>`;
}

// Product/Offer structured data (schema.org), one block per card. Kept
// deliberately conservative: only marks up fields the site is genuinely
// confident in. Price comes straight from the same salePrice already
// shown on the card — the exact figure that's already passed the site's
// own Data Quality checks (RRP-inversion rejection, implausible-discount
// rejection, etc. in scripts/update_deals.py) — never a separately
// "nicer" number. Always uses JSON.stringify rather than manual string
// building, so a product name containing a quote or apostrophe (e.g.
// "Men's") can never produce broken/invalid JSON.
function productSchemaJSON(d) {
  const schema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": d.name,
    "url": d.affiliateUrl,
    "offers": {
      "@type": "Offer",
      "url": d.affiliateUrl,
      "priceCurrency": "GBP",
      "price": d.salePrice,
      "availability": d.inStock === false
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
    },
  };
  if (d.image) schema.image = d.image;
  if (d.brand) schema.brand = { "@type": "Brand", "name": d.brand };
  return `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
}

function dealCardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      ${productSchemaJSON(d)}
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
          ${reportPriceLinkHTML(d)}
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
  list.innerHTML = items.map(t => `
    <a class="tag" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <span class="tag-name">${truncateWords(t.name, 5)}</span>
      <span class="${t.tag.toLowerCase()}">${t.tag === 'Hot' ? '🔥' : '📈'} ${t.tag}</span>
    </a>
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
    const qualityRanked = [...data.products].sort((a, b) => {
      const aHasImage = a.image ? 1 : 0;
      const bHasImage = b.image ? 1 : 0;
      if (aHasImage !== bHasImage) return bHasImage - aHasImage;
      return b.savePct - a.savePct;
    });

    const todaySeed = new Date().toISOString().slice(0, 10);
    const qualifiedPool = qualityRanked.slice(0, Math.min(80, qualityRanked.length));
    const dailyPool = seededShuffle(qualifiedPool, todaySeed);

    const bestDeals = pickWithConstraints(dailyPool, 12, [], { minMalePercent: 0.8, minClubCount: 5 }, qualityRanked);
    const bestKeys = bestDeals.map(d => d.icon || d.category);

    const priceDrops = pickWithConstraints(
      dailyPool.filter(d => !bestDeals.includes(d)), 6, bestKeys, { minMalePercent: 0.8 }, qualityRanked
    );
    const priceDropKeys = priceDrops.map(d => d.icon || d.category);

    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = bestDeals.map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = priceDrops.map(dropRowHTML).join('');

    const usedForTrending = new Set([...bestKeys, ...priceDropKeys]);
    const trendingPool = [...dailyPool]
      .filter(d => !bestDeals.includes(d) && !priceDrops.includes(d))
      .sort((a, b) => popularityScore(b) - popularityScore(a));
    const trendingRaw = pickWithConstraints(trendingPool, 12, [...usedForTrending], { minMalePercent: 0.8 }, qualityRanked);
    const trendingPicks = trendingRaw.map(item => ({
      name: item.name,
      tag: item.savePct >= 25 ? 'Hot' : 'Rising',
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
