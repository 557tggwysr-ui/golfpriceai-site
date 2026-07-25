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

function cardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
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
        <div class="deal-foot">
          <span>Available at ${d.retailerCount} retailers</span>
        </div>
      </div>
    </a>`;
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

// Popularity is a proxy, not real purchase/click data — no such data exists
// yet for this static site. Weighted toward being stocked by more retailers
// (a reasonable signal of a mainstream, in-demand product) with discount
// size as a secondary nudge. This is what "natural" default sort uses
// before any custom sort/filter the user applies.
function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

/* ============================================
   Category groupings
   ============================================ */
const CLUB_CATEGORIES = ['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter', 'sets', 'junior'];

const CLUB_TYPE_OPTIONS = [
  { key: 'driver', label: 'Drivers' }, { key: 'wood', label: 'Fairway Woods' },
  { key: 'hybrid', label: 'Hybrids' }, { key: 'irons', label: 'Irons' },
  { key: 'wedge', label: 'Wedges' }, { key: 'putter', label: 'Putters' },
  { key: 'sets', label: 'Sets' }, { key: 'junior', label: 'Junior' },
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
  { key: 'sets', label: 'Sets' }, { key: 'junior', label: 'Junior' },
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
let priceMin = null;
let priceMax = null;
let sortMode = 'popular';
let searchQuery = '';
let groupNoteHTML = '';

function baseFilteredProducts() {
  return ALL_PRODUCTS.filter(p => !baseCategories || baseCategories.has(p.category));
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
  const matchesPriceMin = exclude === 'price' || priceMin === null || p.salePrice >= priceMin;
  const matchesPriceMax = exclude === 'price' || priceMax === null || p.salePrice <= priceMax;
  return matchesQuery && matchesType && matchesBrand && matchesColour && matchesPriceMin && matchesPriceMax;
}

function scopedFor(exclude) {
  return baseFilteredProducts().filter(p => matchesFilters(p, exclude));
}

function applyFiltersAndSort() {
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('empty-state');

  let filtered = baseFilteredProducts().filter(p => matchesFilters(p, null));

  filtered = filtered.slice().sort((a, b) => {
    if (sortMode === 'price-asc') return a.salePrice - b.salePrice;
    if (sortMode === 'price-desc') return b.salePrice - a.salePrice;
    if (sortMode === 'discount') return b.savePct - a.savePct;
    return popularityScore(b) - popularityScore(a); // 'popular' — the natural default
  });

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

  const prices = priceScoped.map(p => p.salePrice).filter(n => typeof n === 'number');
  const lo = prices.length ? Math.floor(Math.min(...prices)) : 0;
  const hi = prices.length ? Math.ceil(Math.max(...prices)) : 1000;

  sidebar.innerHTML = `
    ${typeSection}
    <div class="filter-group" data-group-name="brand">
      <div class="filter-group-head">Brand <span class="chevron">\u25be</span></div>
      <div class="filter-group-body">${buildOptionList('brand', brandOpts, activeBrands)}</div>
    </div>
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
      const targetSet = group === 'type' ? activeTypeCheckboxes : group === 'brand' ? activeBrands : activeColours;
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

    const typesParam = params.get('types');
    if (typesParam) activeTypeCheckboxes = new Set(typesParam.split(','));

    const brandParam = params.get('brand');
    if (brandParam) activeBrands = new Set(brandParam.split(','));

    const colourParam = params.get('colour');
    if (colourParam) activeColours = new Set(colourParam.split(','));

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
