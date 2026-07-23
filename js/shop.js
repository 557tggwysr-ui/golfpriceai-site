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

let ALL_PRODUCTS = [];
let ACTIVE_CATEGORY = 'all';
let ACTIVE_TYPES = null; // null = no type restriction; otherwise a Set of icon values

function applyFilters() {
  const q = document.getElementById('shop-search-input').value.trim().toLowerCase();
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('empty-state');

  const filtered = ALL_PRODUCTS.filter(p => {
    const matchesCategory = ACTIVE_CATEGORY === 'all' || p.category === ACTIVE_CATEGORY;
    const matchesTypes = !ACTIVE_TYPES || ACTIVE_TYPES.has(p.icon);
    const matchesQuery = !q || p.name.toLowerCase().includes(q);
    return matchesCategory && matchesTypes && matchesQuery;
  });

  grid.innerHTML = filtered.map(cardHTML).join('');
  empty.style.display = filtered.length ? 'none' : 'block';
}

function renderCategoryBanner() {
  const el = document.getElementById('category-banner');
  const data = window.GOLFPRICE_CATEGORY_BANNERS && window.GOLFPRICE_CATEGORY_BANNERS[ACTIVE_CATEGORY];
  if (!data) {
    el.innerHTML = '';
    return;
  }
  const retailerBtn = data.retailer
    ? `<a href="${data.retailer.url}" class="btn btn-outline" rel="sponsored noopener" target="_blank">Also shop ${data.label} at ${data.retailer.name} ↗</a>`
    : '';
  el.innerHTML = `
    <div class="theme-banner">
      <h2>${data.icon} ${data.label}</h2>
      <p>${data.blurb}</p>
      <p class="tagline">${data.tagline} <span class="quip">${data.quip}</span></p>
      ${retailerBtn}
    </div>`;
}

function renderFilterBar(categories) {
  const bar = document.getElementById('filter-bar');
  const chips = [{ key: 'all', label: 'All' }, ...categories];
  bar.innerHTML = chips.map(c =>
    `<button class="filter-chip${c.key === ACTIVE_CATEGORY ? ' active' : ''}" data-key="${c.key}">${c.label}</button>`
  ).join('');
  bar.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_CATEGORY = btn.dataset.key;
      ACTIVE_TYPES = null;
      bar.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCategoryBanner();
      applyFilters();
    });
  });
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;

    const params = new URLSearchParams(window.location.search);
    const categoryParam = params.get('category');
    const validCategory = data.categories.some(c => c.key === categoryParam);
    if (categoryParam && validCategory) ACTIVE_CATEGORY = categoryParam;

    const typesParam = params.get('types');
    if (typesParam) ACTIVE_TYPES = new Set(typesParam.split(','));

    const labelParam = params.get('label');
    if (labelParam) {
      const categoryLabel = (data.categories.find(c => c.key === categoryParam) || {}).label || categoryParam;
      const note = document.getElementById('group-note');
      note.style.display = 'block';
      note.innerHTML = `<a href="index.html" style="color:var(--muted);">Home</a> / <a href="${categoryParam === 'apparel' ? 'apparel.html' : 'accessories.html'}" style="color:var(--muted);">${categoryLabel}</a> / <strong>${labelParam}</strong> · <a href="shop.html?category=${encodeURIComponent(categoryParam || 'all')}" style="color:var(--green);font-weight:600;">clear filter ×</a>`;
    }

    renderFilterBar(data.categories);
    renderCategoryBanner();

    const q = params.get('q');
    if (q) document.getElementById('shop-search-input').value = q;

    applyFilters();
  })
  .catch(err => console.error('Could not load products.json', err));

document.getElementById('shop-search-form').addEventListener('submit', e => e.preventDefault());
document.getElementById('shop-search-input').addEventListener('input', applyFilters);
