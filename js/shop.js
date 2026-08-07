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

// Deal Score / Verified Discount badge — reads the `priceInsight` field
// scripts/update_deals.py writes onto every priced product once real
// price history has built up. Returns '' (nothing rendered) for a
// product with no history yet, or one whose current price isn't
// noteworthy either way — a badge only earns its place when it tells the
// shopper something genuinely useful, not on every single card.
// Kept in sync with the equivalent renderPriceBadge() in js/app.js.
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

// Fits You — populated from shop.html's ?fitFlex=&fitLoftMin=&fitLoftMax=
// query params (set by find-your-fit.html). Null until/unless someone
// arrives with an active fit profile in the URL.
let ACTIVE_FIT = null;

function fitsYouBadgeHTML(d) {
  if (!ACTIVE_FIT || !d.flex) return '';
  if (d.flex !== ACTIVE_FIT.flex) return '';
  if (d.loft) {
    const loftNum = parseFloat(d.loft);
    if (!isNaN(loftNum) && (loftNum < ACTIVE_FIT.loftMin || loftNum > ACTIVE_FIT.loftMax)) return '';
  }
  return `<span class="fits-you-badge">✅ Fits You</span>`;
}

// Crowd-Verified Pricing — a simple, honest "something look wrong?" link
// on every card. Uses the same zero-infrastructure mailto pattern as
// Back In Stock Radar's notify-me button. Deliberately a SIBLING of the
// card's own <a>, never nested inside it — nesting an anchor inside
// another anchor is invalid HTML and breaks click behaviour.
function reportPriceLinkHTML(d) {
  const subject = encodeURIComponent(`Pricing issue: ${d.name}`);
  const body = encodeURIComponent(
    `Hi, I think there might be a pricing issue with this product:\n\n${d.name}\nShown price: ${money(d.salePrice)}\nLink: ${d.affiliateUrl}\n\nWhat's wrong: `
  );
  return `<a class="report-price-link" href="mailto:hello@golfpriceai.com?subject=${subject}&body=${body}">⚠️ Report a pricing issue</a>`;
}

function cardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <div class="deal-card-wrap">
      <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
        <div class="${thumbClass(d)}"${thumbStyle(d)}>
          <span class="badge ${badge.cls}">${badge.label}</span>
          ${thumbHTML(d)}
        </div>
        <div class="deal-body">
          <h3>${d.name}</h3>
          <div class="price-row"><span class="retail-price">${money(d.retailPrice)}</span></div>
          <div class="price-row"><span class="sale-price">${money(d.salePrice)}</span></div>
          <span class="save-pill">Save ${money(d.retailPrice - d.salePrice)} (${d.savePct}%)</span>
          ${renderPriceBadge(d)}
          ${fitsYouBadgeHTML(d)}
          <div class="deal-foot">
            <span>Available at ${d.retailerCount} retailers</span>
          </div>
        </div>
      </a>
      ${reportPriceLinkHTML(d)}
    </div>`;
}

/* ============================================
   Brand / colour extraction — best-effort from
   the product name, since neither is a reliably
   populated field in the current feed data yet.
   Kept in sync with scripts/update_deals.py's
   equivalent Python functions.
   ============================================ */
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
  if (p.brand) return p.brand; // trust a real stored value if one exists
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

// Male / Female / Junior filter facet. Kept in sync with
// scripts/update_deals.py's classify_audience(). Junior beats Female/Male
// since a junior item is sometimes also described with "girls"/"boys",
// which would otherwise misread as a gender signal.
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

// Popularity is a proxy, not real purchase/click data — no such data exists
// yet for this static site. Weighted toward being stocked by more retailers
// (a reasonable signal of a mainstream, in-demand product) with discount
// size as a secondary nudge. This is what "natural" default sort uses
// before any custom sort/filter the user applies.
function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

// "Most Popular" sort — until real sales/click data exists, brand
// recognition is used as the primary signal: a well-known, widely
// trusted golf brand is a genuinely reasonable stand-in for "popular"
// in the meantime, far more so than raw discount size or retailer count
// alone (a deep discount on an obscure brand isn't what "popular"
// usually means to a shopper). Tier 1 = the handful of names virtually
// every golfer recognises; Tier 2 = well-established, respected golf
// brands; anything else (including "Other"/unbranded) falls through to
// the existing popularityScore as a tiebreaker only.
const BRAND_POPULARITY_TIERS = {
  "TaylorMade": 3, "Callaway": 3, "Titleist": 3, "Ping": 3, "Nike": 3,
  "Adidas": 3, "FootJoy": 3, "Puma": 3, "Under Armour": 3,
  "Mizuno": 2, "Wilson": 2, "Srixon": 2, "Cobra": 2, "Cleveland Golf": 2,
  "Odyssey": 2, "Bridgestone": 2, "Scotty Cameron": 2, "Bettinardi": 2,
  "Garmin": 2, "Bushnell": 2, "Skechers": 2, "Ecco": 2, "Oakley": 2,
  "PXG": 2, "XXIO": 2, "Honma": 2,
};
function brandPopularityTier(p) {
  const brand = extractBrand(p);
  if (brand in BRAND_POPULARITY_TIERS) return BRAND_POPULARITY_TIERS[brand];
  return brand === "Other" ? 0 : 1; // a recognised-but-unranked brand still beats "Other"
}

/* ============================================
   Category groupings
   ============================================ */
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

// Filter state
let baseCategories = null; // Set of categories the current page/group is scoped to, or null = all
let activeTypeCheckboxes = new Set(); // user-toggled sub-type checkboxes (icon values or, for "all" view, category keys)
let activeBrands = new Set();
let activeColours = new Set();
let activeAudience = new Set();
let priceMin = null;
let priceMax = null;
let sortMode = 'popular';
let searchQuery = '';
let groupNoteHTML = '';

function baseFilteredProducts() {
  // A product without a known inStock value (older entries from before
  // stock tracking existed) is treated as available. Only an explicit
  // inStock:false hides it — a genuinely sold-out product shouldn't be
  // browsable as if it's a live deal.
  return ALL_PRODUCTS.filter(p => p.inStock !== false && (!baseCategories || baseCategories.has(p.category)));
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

// Applies every active filter EXCEPT the one named in `exclude` — this is
// what makes the sidebar "dynamic"/cascading: e.g. computing Brand counts
// excludes the Brand filter itself (so you can still see and switch
// brands) but still respects whatever Product Type / Colour / Price is
// currently selected, so the counts genuinely reflect "if I also picked
// this, how many results" rather than always showing the full unfiltered
// category counts.
function matchesFilters(p, exclude) {
  const q = searchQuery.trim().toLowerCase();
  const matchesQuery = !q || p.name.toLowerCase().includes(q);
  const matchesType = exclude === 'type' || matchesTypeCheckboxes(p);
  const matchesBrand = exclude === 'brand' || activeBrands.size === 0 || activeBrands.has(extractBrand(p));
  const matchesColour = exclude === 'colour' || activeColours.size === 0 || activeColours.has(extractColour(p));
  const matchesAudience = exclude === 'audience' || activeAudience.size === 0 || activeAudience.has(classifyAudience(p));
  const matchesPriceMin = exclude === 'price' || priceMin === null || p.salePrice >= priceMin;
  const matchesPriceMax = exclude === 'price' || priceMax === null || p.salePrice <= priceMax;
  return matchesQuery && matchesType && matchesBrand && matchesColour && matchesAudience && matchesPriceMin && matchesPriceMax;
}

function scopedFor(exclude) {
  return baseFilteredProducts().filter(p => matchesFilters(p, exclude));
}

// How many items count as "the top of the page" for the two Most
// Popular reordering rules below — roughly two rows of a desktop grid,
// a reasonable stand-in for "what a visitor sees without scrolling much".
const POPULAR_TOP_WINDOW = 24;

// Apparel-specific: on top of brand-tier sorting, push the top window to
// ~90% Male-classified items — same swap-based quota mechanic already
// used for the homepage's Hot Deals (80% there), just applied to a
// sorted list's leading slice instead of a fixed-size selection. Female/
// Junior items aren't removed from the catalog, just not front-loaded.
function applyMaleQuotaToTop(sortedProducts, windowSize, minMalePercent) {
  const n = Math.min(windowSize, sortedProducts.length);
  if (n === 0) return sortedProducts;

  // Stable partition — each group keeps its existing brand-tier order.
  const maleItems = sortedProducts.filter(p => classifyAudience(p) === 'Male');
  const otherItems = sortedProducts.filter(p => classifyAudience(p) !== 'Male');

  // Male items fill the FRONT of the window; only whatever's left over
  // (capped at 10%) fills the tail — this is what actually guarantees
  // "male at the top", not just "male somewhere in the top 24 on
  // average". Capped at however many Male items genuinely exist.
  const minMaleCount = Math.min(maleItems.length, Math.ceil(n * minMalePercent));
  const windowMale = maleItems.slice(0, minMaleCount);
  const windowOther = otherItems.slice(0, n - windowMale.length);

  const window = windowMale.concat(windowOther);
  const leftover = maleItems.slice(minMaleCount).concat(otherItems.slice(windowOther.length));
  return window.concat(leftover);
}

// Accessories-specific: "a good mix" — ensures the top window represents
// as many DISTINCT product types (icon/category) as possible, so brand-
// tier sorting alone can't let one popular type (e.g. gloves) monopolise
// the top of the page. Same "no two of the same type" spirit as the
// homepage's existing pickWithConstraints diversity rule.
function applyTypeDiversityToTop(sortedProducts, windowSize) {
  const n = Math.min(windowSize, sortedProducts.length);
  if (n === 0) return sortedProducts;
  const top = sortedProducts.slice(0, n);
  const rest = sortedProducts.slice(n);

  const seenTypes = new Set();
  const result = [];
  const bumped = [];
  for (const p of top) {
    const key = p.icon || p.category;
    if (!seenTypes.has(key)) {
      seenTypes.add(key);
      result.push(p);
    } else {
      bumped.push(p);
    }
  }
  let restIdx = 0;
  while (result.length < n && restIdx < rest.length) {
    const candidate = rest[restIdx];
    const key = candidate.icon || candidate.category;
    if (!seenTypes.has(key)) {
      seenTypes.add(key);
      result.push(candidate);
      rest.splice(restIdx, 1);
    } else {
      restIdx++;
    }
  }
  return result.concat(bumped, rest);
}

// ============================================
// "Did you mean...?" search correction
// ------------------------------------------------
// Runs ONLY when a search returns zero results — never on every
// keystroke, so this has no performance cost during normal typing on an
// ~11,000-product catalog. Matches against a small, curated dictionary
// (brand names + real product-type words) rather than every word in
// every product name — much faster, and avoids suggesting nonsense
// pulled from noisy free-text names/descriptions.
// ============================================
const SEARCH_TERM_DICTIONARY = [
  ...KNOWN_BRANDS,
  "driver", "drivers", "wood", "woods", "fairway", "hybrid", "hybrids",
  "iron", "irons", "wedge", "wedges", "putter", "putters", "set", "sets",
  "ball", "balls", "bag", "bags", "shoe", "shoes", "boot", "boots",
  "polo", "polos", "trouser", "trousers", "pant", "pants", "jogger", "joggers",
  "short", "shorts", "skort", "skorts", "skirt", "skirts",
  "jacket", "jackets", "hoodie", "hoodies", "fleece", "vest", "gilet", "gillet",
  "windstopper", "slipover", "sweater", "dress", "suit",
  "glove", "gloves", "cap", "caps", "hat", "hats", "beanie", "beanies",
  "sunglasses", "belt", "belts", "sock", "socks", "umbrella", "umbrellas",
  "towel", "towels", "tee", "tees", "grip", "grips",
  "rangefinder", "rangefinders", "watch", "watches", "gps", "sensor", "sensors",
  "cart", "carts", "headcover", "headcovers", "mat", "mats",
  "trolley", "trolleys",
];

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Finds the closest dictionary word to a given (likely misspelled) word,
// only accepting matches within a sensible distance relative to word
// length — short words need a near-exact match, longer words tolerate a
// bit more, so "polp" -> "polo" is accepted but "golf" -> "wolf" isn't.
function nearestDictionaryWord(word) {
  const lower = word.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const candidate of SEARCH_TERM_DICTIONARY) {
    const candLower = candidate.toLowerCase();
    if (candLower === lower) return null; // already correct, no correction needed
    const dist = levenshteinDistance(lower, candLower);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate;
    }
  }
  const maxAllowed = Math.max(1, Math.floor(lower.length * 0.34));
  return bestDist > 0 && bestDist <= maxAllowed ? best : null;
}

// Only ever returns a suggestion that would ACTUALLY produce results —
// never guesses blindly. Returns null if no correction was found, or if
// the "corrected" query still wouldn't match anything.
function getSpellingSuggestion(query) {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  let changed = false;
  const correctedWords = words.map(word => {
    const suggestion = nearestDictionaryWord(word);
    if (suggestion) {
      changed = true;
      return suggestion;
    }
    return word;
  });
  if (!changed) return null;

  const correctedQuery = correctedWords.join(' ');
  const correctedLower = correctedQuery.toLowerCase();
  const wouldMatch = baseFilteredProducts().some(p => p.name.toLowerCase().includes(correctedLower));
  return wouldMatch ? correctedQuery : null;
}

function applyFiltersAndSort() {
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('empty-state');

  let filtered = baseFilteredProducts().filter(p => matchesFilters(p, null));

  filtered = filtered.slice().sort((a, b) => {
    if (sortMode === 'price-asc') return a.salePrice - b.salePrice;
    if (sortMode === 'price-desc') return b.salePrice - a.salePrice;
    if (sortMode === 'discount') return b.savePct - a.savePct;
    // 'popular' — brand recognition first (see BRAND_POPULARITY_TIERS),
    // existing popularityScore only breaks ties within the same tier.
    return (brandPopularityTier(b) - brandPopularityTier(a)) || (popularityScore(b) - popularityScore(a));
  });

  // Both reorderings below only apply to Most Popular, and only when
  // scoped to exactly that one category — Shop/Clubs aren't touched.
  if (sortMode === 'popular' && baseCategories && baseCategories.size === 1) {
    if (baseCategories.has('apparel')) {
      filtered = applyMaleQuotaToTop(filtered, POPULAR_TOP_WINDOW, 0.9);
    } else if (baseCategories.has('accessories')) {
      filtered = applyTypeDiversityToTop(filtered, POPULAR_TOP_WINDOW);
    }
  }

  grid.innerHTML = filtered.map(cardHTML).join('');
  empty.style.display = filtered.length ? 'none' : 'block';

  if (filtered.length === 0 && searchQuery.trim()) {
    const suggestion = getSpellingSuggestion(searchQuery);
    if (suggestion) {
      empty.innerHTML = `Nothing here for "${searchQuery}" — even our AI needs a mulligan.<br>
        Did you mean <a href="#" id="spelling-suggestion-link" style="color:var(--green);font-weight:600;">${suggestion}</a>?`;
      const link = document.getElementById('spelling-suggestion-link');
      if (link) {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          searchQuery = suggestion;
          const input = document.getElementById('shop-search-input');
          if (input) input.value = suggestion;
          applyFiltersAndSort();
        });
      }
    } else {
      empty.textContent = "Nothing here — even our AI needs a mulligan. Try another search or category.";
    }
  } else if (filtered.length === 0) {
    empty.textContent = "Nothing here — even our AI needs a mulligan. Try another search or category.";
  }

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

  // Each facet is scoped against every OTHER active filter, not just the
  // page-level category — this is what makes selecting a Product Type
  // immediately narrow which Brands show up, and vice versa.
  const typeScoped = scopedFor('type');
  const brandScoped = scopedFor('brand');
  const colourScoped = scopedFor('colour');
  const audienceScoped = scopedFor('audience');
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

  // Re-apply whichever sections the user had collapsed, since we just
  // rebuilt the whole sidebar's HTML from scratch.
  sidebar.querySelectorAll('.filter-group').forEach(g => {
    if (collapsedGroups.has(g.dataset.groupName)) g.classList.add('collapsed');
  });

  sidebar.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const group = cb.dataset.group;
      const targetSet = group === 'type' ? activeTypeCheckboxes : group === 'brand' ? activeBrands : group === 'audience' ? activeAudience : activeColours;
      if (cb.checked) targetSet.add(cb.value); else targetSet.delete(cb.value);
      if (group === 'type') renderCategoryBanner();
      renderSidebar(); // rebuild so every OTHER facet's counts reflect this new selection (cascading filters)
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
  if (activeTypeCheckboxes.size) params.set('types', [...activeTypeCheckboxes].join(',')); else params.delete('types');
  if (priceMin !== null) params.set('pricemin', priceMin); else params.delete('pricemin');
  if (priceMax !== null) params.set('pricemax', priceMax); else params.delete('pricemax');
  if (sortMode !== 'popular') params.set('sort', sortMode); else params.delete('sort');
  history.replaceState(null, '', '?' + params.toString());
}

function effectiveSingleCategory() {
  // Returns the one category whose themed banner should show right now,
  // or null if the current view spans multiple categories (so no single
  // banner applies).
  if (baseCategories && baseCategories.size === 1) {
    const only = [...baseCategories][0];
    if (only === 'apparel' || only === 'accessories') return null; // these have sub-type icons, not single-category banners in this context
    return only;
  }
  if (isTopCategoryTypeMode() && activeTypeCheckboxes.size === 1) {
    return [...activeTypeCheckboxes][0];
  }
  return null;
}

function bannerGroupKey() {
  // Which banner to show when nothing has narrowed things to one specific
  // category yet.
  if (!baseCategories) return 'all';
  if ([...baseCategories].every(c => CLUB_CATEGORIES.includes(c)) && baseCategories.size > 1) return 'clubs';
  if (baseCategories.size === 1) return [...baseCategories][0];
  return null;
}

function renderCategoryBanner() {
  const el = document.getElementById('category-banner');
  if (!el) return; // page doesn't have this element (e.g. embedded on a hub page) — nothing to do
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

    if (window.SHOP_FORCE_CATEGORY) {
      // A page can pin the filter/grid view to one category directly —
      // used to embed the same filter sidebar + product grid experience
      // on apparel.html/accessories.html (set inline, before shop.js
      // loads) without needing a shop.html?category=... redirect.
      baseCategories = new Set([window.SHOP_FORCE_CATEGORY]);
    } else if (window.SHOP_FORCE_GROUP === 'clubs' || groupParam === 'clubs') {
      baseCategories = new Set(CLUB_CATEGORIES);
    } else if (categoryParam && validCategory) {
      baseCategories = new Set([categoryParam]);
    } else {
      baseCategories = null;
    }

    const typesParam = params.get('types');
    if (typesParam) activeTypeCheckboxes = new Set(typesParam.split(','));

    const brandParam = params.get('brand');
    if (brandParam) activeBrands = new Set(brandParam.split(','));

    const colourParam = params.get('colour');
    if (colourParam) activeColours = new Set(colourParam.split(','));

    const audienceParam = params.get('audience');
    if (audienceParam) activeAudience = new Set(audienceParam.split(','));

    if (params.get('pricemin')) priceMin = Number(params.get('pricemin'));
    if (params.get('pricemax')) priceMax = Number(params.get('pricemax'));
    if (params.get('sort')) sortMode = params.get('sort');

    const labelParam = params.get('label');
    if (labelParam && categoryParam) {
      const categoryLabel = (data.categories.find(c => c.key === categoryParam) || {}).label || categoryParam;
      groupNoteHTML = `<p id="group-note" style="color:var(--muted);font-size:14px;margin:8px 0 0;"><a href="index.html" style="color:var(--muted);">Home</a> / <a href="${categoryParam === 'apparel' ? 'apparel.html' : 'accessories.html'}" style="color:var(--muted);">${categoryLabel}</a> / <strong>${labelParam}</strong> \u00b7 <a href="shop.html?category=${encodeURIComponent(categoryParam)}" style="color:var(--green);font-weight:600;">clear filter \u00d7</a></p>`;
    }

    const fitFlexParam = params.get('fitFlex');
    if (fitFlexParam) {
      const fitLoftMinParam = params.get('fitLoftMin');
      const fitLoftMaxParam = params.get('fitLoftMax');
      ACTIVE_FIT = {
        flex: fitFlexParam,
        loftMin: fitLoftMinParam ? Number(fitLoftMinParam) : -Infinity,
        loftMax: fitLoftMaxParam ? Number(fitLoftMaxParam) : Infinity,
      };
      const loftText = fitLoftMinParam ? `, ${fitLoftMinParam}\u00b0\u2013${fitLoftMaxParam}\u00b0 loft` : '';
      groupNoteHTML += `<p id="fit-note" style="background:var(--green-pale);color:var(--green-dark);border-radius:10px;padding:10px 16px;font-size:13px;font-weight:600;margin:12px 0 0;display:inline-block;">\u2705 Showing your fit: ${fitFlexParam} flex${loftText} \u2014 <a href="shop.html" style="color:var(--green-dark);text-decoration:underline;">clear</a></p>`;
    }

    const sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = sortMode;

    renderCategoryBanner();
    renderSidebar();

    const q = params.get('q');
    if (q) {
      const searchInputEl = document.getElementById('shop-search-input');
      if (searchInputEl) searchInputEl.value = q;
      searchQuery = q;
    }

    applyFiltersAndSort();
  })
  .catch(err => console.error('Could not load products.json', err));

const shopSearchForm = document.getElementById('shop-search-form');
if (shopSearchForm) shopSearchForm.addEventListener('submit', e => e.preventDefault());
const shopSearchInput = document.getElementById('shop-search-input');
if (shopSearchInput) {
  shopSearchInput.addEventListener('input', e => {
    searchQuery = e.target.value;
    applyFiltersAndSort();
  });
}

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
