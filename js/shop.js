document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '£' + n.toFixed(2);
}

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

const ICON_BACKDROPS = {
  'gps-watch': 'https://images.pexels.com/photos/9130511/pexels-photo-9130511.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600'
};

// If a real product image URL is broken (dead retailer link, hotlink
// protection, slow/failed CDN request) the browser shows its own small
// broken-image icon — this swaps that out for the same clean icon
// fallback already used for products with no image field at all, rather
// than ever letting a broken-image icon reach a visitor.
function handleImgError(imgEl, iconSrc) {
  imgEl.onerror = null;
  const container = imgEl.closest('.thumb, .drop-thumb');
  if (!container) return;
  container.classList.add('icon-thumb');
  // Replace ONLY the <img> itself, not the whole container — the
  // original version did container.innerHTML = ..., which wiped out
  // any sibling badges (discount badge, condition badge) living
  // inside the same container. Found via a real bug: every product
  // whose image fails to load (e.g. Scottsdale Golf's entire catalog,
  // blocked by their hotlink protection) was silently losing its
  // discount badge along with the broken image.
  const iconBadge = document.createElement('span');
  iconBadge.className = 'icon-badge';
  const iconImg = document.createElement('img');
  iconImg.src = iconSrc;
  iconImg.alt = imgEl.alt;
  iconBadge.appendChild(iconImg);
  imgEl.replaceWith(iconBadge);
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

// Crowd-Verified Pricing. Must NOT be a real <a> — .deal-card is itself
// an <a>, and a nested <a> inside another <a> is invalid HTML. Browsers
// silently auto-close the outer anchor the instant they hit the nested
// one, ejecting everything after it (the rest of .deal-body — title,
// price, this link, all of it) out of the card entirely as a stray
// sibling, breaking the card's layout. A span styled and behaving
// identically (click + keyboard) avoids that while working exactly the
// same for a visitor. Kept as a duplicate of app.js's identical
// function — no build step / module system on this site.
function reportPriceLinkHTML(d) {
  const subject = encodeURIComponent(`Pricing issue: ${d.name}`);
  const body = encodeURIComponent(
    `Hi, I think there might be a pricing issue with this product:\n\n${d.name}\nShown price: ${money(d.salePrice)}\nLink: ${d.affiliateUrl}\n\nWhat's wrong: `
  );
  const mailto = `mailto:hello@golfpriceai.com?subject=${subject}&body=${body}`;
  return `<span class="report-price-link" role="button" tabindex="0" onclick="event.preventDefault();event.stopPropagation();window.location.href='${mailto}';" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();window.location.href='${mailto}';}">⚠️ Report a pricing issue</span>`;
}

// Product/Offer structured data — identical logic to app.js's function
// of the same name (kept as a duplicate, no build step on this site).
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

// Preowned/condition badge — same duplicate-by-design pattern as this
// site's other small helpers (no build step / module system).
function conditionBadgeHTML(d) {
  if (!d.condition) return '';
  return `<span class="condition-badge">${d.condition}</span>`;
}

function cardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      ${productSchemaJSON(d)}
      <div class="${thumbClass(d)}"${thumbStyle(d)}>
        <span class="badge ${badge.cls}">${badge.label}</span>
        ${conditionBadgeHTML(d)}
        ${thumbHTML(d)}
      </div>
      <div class="deal-body">
        <h3>${d.name}</h3>
        <div class="price-row"><span class="retail-price">${money(d.retailPrice)}</span></div>
        <div class="price-row"><span class="sale-price">${money(d.salePrice)}</span></div>
        <span class="save-pill">Save ${money(d.retailPrice - d.salePrice)} (${d.savePct}%)</span>
        <div class="deal-foot">
          <span>Available at ${d.retailerCount} retailers</span>
          ${reportPriceLinkHTML(d)}
        </div>
      </div>
    </a>`;
}

const KNOWN_BRANDS = [
  "Scotty Cameron", "Under Armour", "Ben Sayers", "Cleveland Golf",
  "J.Lindeberg", "Tour Edge", "Sun Mountain", "Shot Scope",
  "TaylorMade", "Callaway", "Titleist", "Bridgestone", "Bettinardi",
  "Evnroll", "Mizuno", "Wilson", "Srixon", "Cobra", "Honma", "XXIO",
  "PXG", "Nike", "Adidas", "Puma", "FootJoy", "Ecco", "Oakley",
  "Garmin", "Bushnell", "Motocaddy", "PowaKaddy", "Clicgear", "Ogio",
  "Galvin Green", "Peter Millar", "Aspire", "Odyssey", "Ping",
  "Woodmark", "Longridge", "Hedgehog", "Arccos", "Skechers",
];

function extractBrand(p) {
  if (p.brand) return p.brand;
  const name = p.name || '';
  const lower = name.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (lower.startsWith(brand.toLowerCase() + ' ') || lower === brand.toLowerCase()) {
      return brand;
    }
  }
  for (const brand of KNOWN_BRANDS) {
    const re = new RegExp('\\b' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(name)) return brand;
  }
  return 'Other';
}

const COLOUR_KEYWORDS = [
  'black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'green',
  'yellow', 'orange', 'pink', 'purple', 'brown', 'tan', 'beige',
  'silver', 'gold', 'khaki', 'olive', 'charcoal', 'cream', 'stone',
];
const COLOUR_SWATCH_HEX = {
  Black: '#222', White: '#fff', Grey: '#9aa19a', Navy: '#1b2a4a',
  Blue: '#2f6fd1', Red: '#c93b3b', Green: '#3fae29', Yellow: '#e6c73f',
  Orange: '#e0812f', Pink: '#e88fb0', Purple: '#7a5cb8', Brown: '#7a5236',
  Tan: '#d2b48c', Beige: '#e8dcc8', Silver: '#c4c8c4', Gold: '#c9a227',
  Khaki: '#8a8154', Olive: '#6c6b3f', Charcoal: '#454a45', Cream: '#f2ecd8',
  Stone: '#ada893',
};

function extractColour(p) {
  if (p.colour) return p.colour;
  const name = p.name || '';
  const lower = name.toLowerCase();
  let bestMatch = null;
  let bestIndex = Infinity;
  for (const colour of COLOUR_KEYWORDS) {
    const re = new RegExp('\\b' + colour + '\\b', 'i');
    const m = re.exec(lower);
    if (m && m.index < bestIndex) {
      bestIndex = m.index;
      bestMatch = colour;
    }
  }
  if (!bestMatch) return null;
  return bestMatch === 'gray' ? 'Grey' : bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1);
}

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

function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

const CLUB_CATEGORIES = ['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter', 'sets'];

const CLUB_TYPE_OPTIONS = [
  { key: 'driver', label: 'Drivers' }, { key: 'wood', label: 'Fairway Woods' },
  { key: 'hybrid', label: 'Hybrids' }, { key: 'irons', label: 'Irons' },
  { key: 'wedge', label: 'Wedges' }, { key: 'putter', label: 'Putters' },
  { key: 'sets', label: 'Sets' },
];
const APPAREL_TYPE_OPTIONS = [
  { key: 'polo', label: 'Polo Tees' }, { key: 'trousers', label: 'Trousers' },
  { key: 'shorts', label: 'Shorts' }, { key: 'skort', label: 'Skorts' },
  { key: 'jacket', label: 'Jackets & Layers' }, { key: 'hoodie', label: 'Hoodies' },
  { key: 'cap', label: 'Caps & Hats' }, { key: 'sunglasses', label: 'Sunglasses' },
  { key: 'belt', label: 'Belts' }, { key: 'socks', label: 'Socks' },
];
const ACCESSORIES_TYPE_OPTIONS = [
  { key: 'gps-watch', label: 'GPS Watches' }, { key: 'rangefinder', label: 'Rangefinders' },
  { key: 'sensor', label: 'Smart Sensors' }, { key: 'pushcart', label: 'Push Carts' },
  { key: 'headcover', label: 'Headcovers' }, { key: 'umbrella', label: 'Umbrellas' },
  { key: 'tee', label: 'Tees' }, { key: 'grip', label: 'Grips' },
  { key: 'towel', label: 'Towels' }, { key: 'glove', label: 'Gloves & Mittens' },
  { key: 'divot-tool', label: 'Divot Tools' }, { key: 'alignment-sticks', label: 'Alignment Sticks' },
  { key: 'ball-bag', label: 'Ball Bags' }, { key: 'ball-retriever', label: 'Ball Retrievers' },
  { key: 'caddie-shagger', label: 'Caddie & Shagger Sets' },
  { key: 'launch-monitor', label: 'Launch Monitors & Simulators' },
  { key: 'pouch', label: 'Pouches' }, { key: 'wheel', label: 'Wheels' },
  { key: 'mat', label: 'Putting & Training Mats' }, { key: 'enclosure', label: 'Covers & Enclosures' },
  { key: 'storage', label: 'Storage' }, { key: 'travel', label: 'Travel' },
  { key: 'battery-charger', label: 'Battery & Chargers' }, { key: 'drink-holder', label: 'Drink Holders' },
  { key: 'speaker', label: 'Speakers' },
  { key: 'accessories', label: 'Other Accessories' },
];
const BAG_TYPE_OPTIONS = [
  { key: 'golf-bag', label: 'Golf Bags' }, { key: 'range-bag', label: 'Range Bags' },
  { key: 'carry-bag', label: 'Carry Bags' }, { key: 'shoe-bag', label: 'Shoe Bags' },
];
const ALL_TOP_CATEGORY_OPTIONS = [
  { key: 'driver', label: 'Drivers' }, { key: 'wood', label: 'Fairway Woods' },
  { key: 'hybrid', label: 'Hybrids' }, { key: 'irons', label: 'Irons' },
  { key: 'wedge', label: 'Wedges' }, { key: 'putter', label: 'Putters' },
  { key: 'sets', label: 'Sets' },
  { key: 'ball', label: 'Balls' }, { key: 'bag', label: 'Bags' },
  { key: 'shoes', label: 'Shoes' }, { key: 'apparel', label: 'Apparel' },
  { key: 'accessories', label: 'Accessories' },
];

let ALL_PRODUCTS = [];

let baseCategories = null;
let baseSource = null;
let activeTypeCheckboxes = new Set();
let activeBrands = new Set();
let activeColours = new Set();
let activeAudience = new Set();
let activeCondition = new Set();
let priceMin = null;
let priceMax = null;
let sortMode = 'popular';
let searchQuery = '';
let groupNoteHTML = '';

// "New" isn't a real field on most products — it's simply the absence
// of a condition value. Only products with a genuine condition field
// (from Callaway Golf Preowned's structured grading, or the generic
// "Preowned" fallback detected for retailers like Scottsdale that just
// mark used items with a "- Used" suffix) count as Preowned.
function classifyCondition(p) {
  // Inside the dedicated Preowned & Trade Ins section, every product is
  // already preowned — a New/Preowned toggle would be meaningless (100%
  // would always be Preowned). Show the real specific grade instead.
  // "Preowned" (generic) still covers the ~30% of items with no grade
  // recorded in the feed — a genuine option, not hidden from filtering.
  if (baseSource === 'awin-callawaypreowned') {
    return p.condition || 'Preowned';
  }
  return p.condition ? 'Preowned' : 'New';
}

function baseFilteredProducts() {
  return ALL_PRODUCTS.filter(p =>
    (!baseCategories || baseCategories.has(p.category)) &&
    (!baseSource || p.source === baseSource)
  );
}

function currentTypeOptions() {
  if (!baseCategories) return ALL_TOP_CATEGORY_OPTIONS;
  if ([...baseCategories].every(c => CLUB_CATEGORIES.includes(c))) return CLUB_TYPE_OPTIONS;
  const only = [...baseCategories][0];
  if (baseCategories.size === 1 && only === 'apparel') return APPAREL_TYPE_OPTIONS;
  if (baseCategories.size === 1 && only === 'accessories') return ACCESSORIES_TYPE_OPTIONS;
  if (baseCategories.size === 1 && only === 'bag') return BAG_TYPE_OPTIONS;
  return null;
}

function isTopCategoryTypeMode() {
  const opts = currentTypeOptions();
  return opts === CLUB_TYPE_OPTIONS || opts === ALL_TOP_CATEGORY_OPTIONS;
}

function matchesTypeCheckboxes(p) {
  if (activeTypeCheckboxes.size === 0) return true;
  if (isTopCategoryTypeMode()) return activeTypeCheckboxes.has(p.category);
  return activeTypeCheckboxes.has(p.icon);
}

function matchesFilters(p, exclude) {
  const q = searchQuery.trim().toLowerCase();
  const matchesQuery = !q || p.name.toLowerCase().includes(q);
  const matchesType = exclude === 'type' || matchesTypeCheckboxes(p);
  const matchesBrand = exclude === 'brand' || activeBrands.size === 0 || activeBrands.has(extractBrand(p));
  const matchesColour = exclude === 'colour' || activeColours.size === 0 || activeColours.has(extractColour(p));
  const matchesAudience = exclude === 'audience' || activeAudience.size === 0 || activeAudience.has(classifyAudience(p));
  const matchesCondition = exclude === 'condition' || activeCondition.size === 0 || activeCondition.has(classifyCondition(p));
  const matchesPriceMin = exclude === 'price' || priceMin === null || p.salePrice >= priceMin;
  const matchesPriceMax = exclude === 'price' || priceMax === null || p.salePrice <= priceMax;
  return matchesQuery && matchesType && matchesBrand && matchesColour && matchesAudience && matchesCondition && matchesPriceMin && matchesPriceMax;
}

function scopedFor(exclude) {
  return baseFilteredProducts().filter(p => matchesFilters(p, exclude));
}

// Applies the same ~80% Male convention used on the homepage and in
// Complete The Look — but here, nothing is ever hidden or removed (this
// is a full product catalog, not a fixed 12-slot homepage section).
// Instead, this reorders just the first "window" of results so what a
// visitor sees first roughly matches that 80/20 split, then lets every
// remaining result fall back to plain popularity order untouched. Only
// applied to the natural default view — explicit user choices (an
// active Audience filter, or a different sort like Price/Discount)
// always override this and are never re-biased.
const AUDIENCE_BIAS_WINDOW = 24;
function applyAudienceBias(sortedList) {
  const windowSize = Math.min(AUDIENCE_BIAS_WINDOW, sortedList.length);
  const male = sortedList.filter(p => classifyAudience(p) === 'Male');
  const other = sortedList.filter(p => classifyAudience(p) !== 'Male');

  const targetMale = Math.min(Math.ceil(windowSize * 0.8), male.length);
  const windowMale = male.slice(0, targetMale);
  const windowOther = other.slice(0, windowSize - windowMale.length);

  const windowSet = new Set([...windowMale, ...windowOther]);
  // Rebuild the window in its ORIGINAL popularity order (stable) so it
  // still reads as a naturally popularity-sorted list, not visibly
  // clustered by audience — then append everything else, untouched.
  const window = sortedList.filter(p => windowSet.has(p));
  const rest = sortedList.filter(p => !windowSet.has(p));
  return [...window, ...rest];
}

function applyFiltersAndSort() {
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('empty-state');

  let filtered = baseFilteredProducts().filter(p => matchesFilters(p, null));

  filtered = filtered.slice().sort((a, b) => {
    if (sortMode === 'price-asc') return a.salePrice - b.salePrice;
    if (sortMode === 'price-desc') return b.salePrice - a.salePrice;
    if (sortMode === 'discount') return b.savePct - a.savePct;
    return popularityScore(b) - popularityScore(a);
  });

  if (sortMode === 'popular' && activeAudience.size === 0) {
    filtered = applyAudienceBias(filtered);
  }

  grid.innerHTML = filtered.map(cardHTML).join('');
  empty.style.display = filtered.length ? 'none' : 'block';

  const countEl = document.getElementById('shop-result-count');
  if (countEl) countEl.textContent = `${filtered.length} product${filtered.length === 1 ? '' : 's'}`;

  renderActiveChips();
}

function renderActiveChips() {
  const wrap = document.getElementById('active-filter-chips');
  if (!wrap) return;
  const chips = [];
  activeTypeCheckboxes.forEach(key => {
    const opts = currentTypeOptions() || [];
    const label = (opts.find(o => o.key === key) || {}).label || key;
    chips.push({ label, remove: () => { activeTypeCheckboxes.delete(key); refreshAfterFilterChange(); } });
  });
  activeBrands.forEach(b => chips.push({ label: b, remove: () => { activeBrands.delete(b); refreshAfterFilterChange(); } }));
  activeColours.forEach(c => chips.push({ label: c, remove: () => { activeColours.delete(c); refreshAfterFilterChange(); } }));
  activeAudience.forEach(a => chips.push({ label: a, remove: () => { activeAudience.delete(a); refreshAfterFilterChange(); } }));
  activeCondition.forEach(c => chips.push({ label: c, remove: () => { activeCondition.delete(c); refreshAfterFilterChange(); } }));
  if (priceMin !== null || priceMax !== null) {
    chips.push({
      label: `${money(priceMin || 0)} \u2013 ${money(priceMax || 99999)}`,
      remove: () => { priceMin = null; priceMax = null; refreshAfterFilterChange(); }
    });
  }
  wrap.innerHTML = chips.map((c, i) => `<span class="active-filter-chip" data-i="${i}">${c.label} <button type="button" aria-label="Remove filter">\u2715</button></span>`).join('');
  wrap.querySelectorAll('.active-filter-chip button').forEach((btn, i) => {
    btn.addEventListener('click', chips[i].remove);
  });
}

function refreshAfterFilterChange() {
  renderCategoryBanner();
  renderSidebar();
  applyFiltersAndSort();
  updateURL();
}

function buildOptionList(id, options, activeSet, extra) {
  if (!options.length) return `<p style="color:var(--muted);font-size:12px;">None available in this view.</p>`;
  return `<div class="filter-option-list">` + options.map(o => `
    <label class="filter-option">
      <input type="checkbox" data-group="${id}" value="${o.key}" ${activeSet.has(o.key) ? 'checked' : ''}>
      ${extra ? extra(o.key) : ''}${o.label}
      <span class="count">${o.count}</span>
    </label>`).join('') + `</div>`;
}

let collapsedGroups = new Set();

function renderSidebar() {
  const sidebar = document.getElementById('filter-sidebar-body');
  if (!sidebar) return;

  const typeScoped = scopedFor('type');
  const brandScoped = scopedFor('brand');
  const colourScoped = scopedFor('colour');
  const audienceScoped = scopedFor('audience');
  const conditionScoped = scopedFor('condition');
  const priceScoped = scopedFor('price');

  const typeOptsRaw = currentTypeOptions();
  let typeSection = '';
  if (typeOptsRaw) {
    const isTopCat = isTopCategoryTypeMode();
    const counted = typeOptsRaw.map(o => ({
      ...o,
      count: typeScoped.filter(p => (isTopCat ? p.category : p.icon) === o.key).length
    })).filter(o => o.count > 0 || activeTypeCheckboxes.has(o.key));
    typeSection = `
      <div class="filter-group" data-group-name="type">
        <div class="filter-group-head">Product Type <span class="chevron">\u25be</span></div>
        <div class="filter-group-body">${buildOptionList('type', counted, activeTypeCheckboxes)}</div>
      </div>`;
  }

  const brandCounts = {};
  brandScoped.forEach(p => { const b = extractBrand(p); brandCounts[b] = (brandCounts[b] || 0) + 1; });
  const brandOpts = Object.entries(brandCounts)
    .filter(([b]) => b !== 'Other')
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  const showColour = baseCategories && baseCategories.size === 1 && baseCategories.has('apparel');
  let colourSection = '';
  if (showColour) {
    const colourCounts = {};
    colourScoped.forEach(p => { const c = extractColour(p); if (c) colourCounts[c] = (colourCounts[c] || 0) + 1; });
    const colourOpts = Object.entries(colourCounts)
      .map(([key, count]) => ({ key, label: key, count }))
      .sort((a, b) => b.count - a.count);
    colourSection = `
      <div class="filter-group" data-group-name="colour">
        <div class="filter-group-head">Colour <span class="chevron">\u25be</span></div>
        <div class="filter-group-body">${buildOptionList('colour', colourOpts, activeColours, key => `<span class="swatch" style="background:${COLOUR_SWATCH_HEX[key] || '#ccc'}"></span>`)}</div>
      </div>`;
  }

  const audienceCounts = {};
  audienceScoped.forEach(p => { const a = classifyAudience(p); audienceCounts[a] = (audienceCounts[a] || 0) + 1; });
  const audienceOrder = ['Male', 'Female', 'Junior'];
  const audienceOpts = audienceOrder
    .map(key => ({ key, label: key, count: audienceCounts[key] || 0 }));
  const audienceSection = `
    <div class="filter-group" data-group-name="audience">
      <div class="filter-group-head">Audience <span class="chevron">\u25be</span></div>
      <div class="filter-group-body">${buildOptionList('audience', audienceOpts, activeAudience)}</div>
    </div>`;

  // Same "always shown, never count-gated" treatment as Audience — a
  // permanent global toggle rather than something that disappears when
  // the current view happens to have zero preowned items.
  const conditionCounts = {};
  conditionScoped.forEach(p => { const c = classifyCondition(p); conditionCounts[c] = (conditionCounts[c] || 0) + 1; });
  const conditionOrder = baseSource === 'awin-callawaypreowned'
    ? ['Like New', 'Very Good', 'Good', 'Average', 'Preowned']
    : ['New', 'Preowned'];
  const conditionOpts = conditionOrder
    .map(key => ({ key, label: key, count: conditionCounts[key] || 0 }));
  const conditionSection = `
    <div class="filter-group" data-group-name="condition">
      <div class="filter-group-head">Condition <span class="chevron">\u25be</span></div>
      <div class="filter-group-body">${buildOptionList('condition', conditionOpts, activeCondition)}</div>
    </div>`;

  const prices = priceScoped.map(p => p.salePrice).filter(n => typeof n === 'number');
  const lo = prices.length ? Math.floor(Math.min(...prices)) : 0;
  const hi = prices.length ? Math.ceil(Math.max(...prices)) : 1000;

  sidebar.innerHTML = `
    ${typeSection}
    <div class="filter-group" data-group-name="brand">
      <div class="filter-group-head">Brand <span class="chevron">\u25be</span></div>
      <div class="filter-group-body">${buildOptionList('brand', brandOpts, activeBrands)}</div>
    </div>
    ${audienceSection}
    ${conditionSection}
    <div class="filter-group" data-group-name="price">
      <div class="filter-group-head">Price <span class="chevron">\u25be</span></div>
      <div class="filter-group-body">
        <div class="price-range-inputs">
          <input type="number" id="price-min-input" placeholder="\u00a3${lo}" value="${priceMin !== null ? priceMin : ''}" min="0">
          <span>\u2013</span>
          <input type="number" id="price-max-input" placeholder="\u00a3${hi}" value="${priceMax !== null ? priceMax : ''}" min="0">
        </div>
      </div>
    </div>
    ${colourSection}
  `;

  sidebar.querySelectorAll('.filter-group').forEach(g => {
    if (collapsedGroups.has(g.dataset.groupName)) g.classList.add('collapsed');
  });

  sidebar.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const group = cb.dataset.group;
      const targetSet = group === 'type' ? activeTypeCheckboxes : group === 'brand' ? activeBrands : group === 'audience' ? activeAudience : group === 'condition' ? activeCondition : activeColours;
      if (cb.checked) targetSet.add(cb.value); else targetSet.delete(cb.value);
      if (group === 'type') renderCategoryBanner();
      renderSidebar();
      applyFiltersAndSort();
      updateURL();
    });
  });

  const minInput = document.getElementById('price-min-input');
  const maxInput = document.getElementById('price-max-input');
  function commitPrice() {
    priceMin = minInput.value ? Number(minInput.value) : null;
    priceMax = maxInput.value ? Number(maxInput.value) : null;
    renderSidebar();
    applyFiltersAndSort();
    updateURL();
  }
  minInput.addEventListener('change', commitPrice);
  maxInput.addEventListener('change', commitPrice);

  sidebar.querySelectorAll('.filter-group-head').forEach(head => {
    head.addEventListener('click', () => {
      const group = head.parentElement;
      const name = group.dataset.groupName;
      group.classList.toggle('collapsed');
      if (group.classList.contains('collapsed')) collapsedGroups.add(name);
      else collapsedGroups.delete(name);
    });
  });
}

function updateURL() {
  const params = new URLSearchParams(window.location.search);
  if (activeBrands.size) params.set('brand', [...activeBrands].join(',')); else params.delete('brand');
  if (activeColours.size) params.set('colour', [...activeColours].join(',')); else params.delete('colour');
  if (activeAudience.size) params.set('audience', [...activeAudience].join(',')); else params.delete('audience');
  if (activeCondition.size) params.set('condition', [...activeCondition].join(',')); else params.delete('condition');
  if (activeTypeCheckboxes.size) params.set('types', [...activeTypeCheckboxes].join(',')); else params.delete('types');
  if (priceMin !== null) params.set('pricemin', priceMin); else params.delete('pricemin');
  if (priceMax !== null) params.set('pricemax', priceMax); else params.delete('pricemax');
  if (sortMode !== 'popular') params.set('sort', sortMode); else params.delete('sort');
  history.replaceState(null, '', '?' + params.toString());
}

function effectiveSingleCategory() {
  if (baseCategories && baseCategories.size === 1) {
    const only = [...baseCategories][0];
    if (only === 'apparel' || only === 'accessories') return null;
    return only;
  }
  if (isTopCategoryTypeMode() && activeTypeCheckboxes.size === 1) {
    return [...activeTypeCheckboxes][0];
  }
  return null;
}

function bannerGroupKey() {
  if (!baseCategories) return 'all';
  if ([...baseCategories].every(c => CLUB_CATEGORIES.includes(c)) && baseCategories.size > 1) return 'clubs';
  if (baseCategories.size === 1) return [...baseCategories][0];
  return null;
}

function renderCategoryBanner() {
  const el = document.getElementById('category-banner');
  if (!el) return;

  if (baseSource === 'awin-callawaypreowned') {
    el.innerHTML = `
      <div class="theme-banner">
        <h2>\u267b\ufe0f Preowned & Trade Ins</h2>
        <p>These are secondhand clubs and trade-ins from Callaway Golf Preowned \u2014 kept in their own
        section deliberately, since trade-in pricing works differently to new retail and mixing the
        two would distort genuine price comparisons. Most items have a real condition grade
        (Average, Good, Very Good, or Like New) shown right on the card.</p>
        <p class="tagline">Real Secondhand Prices.<span class="quip"> Kept Separate, On Purpose.</span></p>
      </div>` + (groupNoteHTML || '');
    return;
  }

  const singleCategory = effectiveSingleCategory();
  const key = singleCategory || bannerGroupKey();
  const data = key && window.GOLFPRICE_CATEGORY_BANNERS && window.GOLFPRICE_CATEGORY_BANNERS[key];
  if (!data) {
    el.innerHTML = groupNoteHTML || '';
    return;
  }
  const retailerBtn = data.retailer
    ? `<a href="${data.retailer.url}" class="btn btn-outline" rel="sponsored noopener" target="_blank">Also shop ${data.label} at ${data.retailer.name} \u2197</a>`
    : '';
  el.innerHTML = `
    <div class="theme-banner">
      <h2>${data.icon} ${data.label}</h2>
      <p>${data.blurb}</p>
      <p class="tagline">${data.tagline} <span class="quip">${data.quip}</span></p>
      ${retailerBtn}
    </div>` + (groupNoteHTML || '');
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;

    const params = new URLSearchParams(window.location.search);
    const groupParam = params.get('group');
    const categoryParam = params.get('category');
    const validCategory = data.categories.some(c => c.key === categoryParam);

    if (groupParam === 'clubs') {
      baseCategories = new Set(CLUB_CATEGORIES);
    } else if (categoryParam && validCategory) {
      baseCategories = new Set([categoryParam]);
    } else {
      baseCategories = null;
    }

    const sourceParam = params.get('source');
    baseSource = sourceParam || null;

    const typesParam = params.get('types');
    if (typesParam) activeTypeCheckboxes = new Set(typesParam.split(','));

    const brandParam = params.get('brand');
    if (brandParam) activeBrands = new Set(brandParam.split(','));

    const colourParam = params.get('colour');
    if (colourParam) activeColours = new Set(colourParam.split(','));

    const audienceParam = params.get('audience');
    if (audienceParam) activeAudience = new Set(audienceParam.split(','));

    const conditionParam = params.get('condition');
    if (conditionParam) activeCondition = new Set(conditionParam.split(','));

    if (params.get('pricemin')) priceMin = Number(params.get('pricemin'));
    if (params.get('pricemax')) priceMax = Number(params.get('pricemax'));
    if (params.get('sort')) sortMode = params.get('sort');

    const labelParam = params.get('label');
    if (labelParam && categoryParam) {
      const categoryLabel = (data.categories.find(c => c.key === categoryParam) || {}).label || categoryParam;
      groupNoteHTML = `<p id="group-note" style="color:var(--muted);font-size:14px;margin:8px 0 0;"><a href="index.html" style="color:var(--muted);">Home</a> / <a href="${categoryParam === 'apparel' ? 'apparel.html' : 'accessories.html'}" style="color:var(--muted);">${categoryLabel}</a> / <strong>${labelParam}</strong> \u00b7 <a href="shop.html?category=${encodeURIComponent(categoryParam)}" style="color:var(--green);font-weight:600;">clear filter \u00d7</a></p>`;
    }

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = sortMode;

    renderCategoryBanner();
    renderSidebar();

    const q = params.get('q');
    if (q) {
      document.getElementById('shop-search-input').value = q;
      searchQuery = q;
    }

    applyFiltersAndSort();
  })
  .catch(err => console.error('Could not load products.json', err));

document.getElementById('shop-search-form').addEventListener('submit', e => e.preventDefault());
document.getElementById('shop-search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  applyFiltersAndSort();
});

const sortSelectEl = document.getElementById('sort-select');
if (sortSelectEl) {
  sortSelectEl.addEventListener('change', () => {
    sortMode = sortSelectEl.value;
    applyFiltersAndSort();
    updateURL();
  });
}

const clearAllBtn = document.getElementById('filter-clear-all');
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
    activeTypeCheckboxes = new Set();
    activeBrands = new Set();
    activeColours = new Set();
    activeAudience = new Set();
    activeCondition = new Set();
    priceMin = null;
    priceMax = null;
    refreshAfterFilterChange();
  });
}

const mobileToggle = document.getElementById('mobile-filter-toggle');
if (mobileToggle) {
  mobileToggle.addEventListener('click', () => {
    document.getElementById('filter-sidebar').classList.toggle('open');
  });
}
