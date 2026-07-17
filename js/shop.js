document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '$' + n.toFixed(2);
}

function starIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
}

function iconFor(category) {
  const known = ['driver', 'putter', 'irons', 'wood', 'hybrid', 'wedge', 'ball', 'bag', 'apparel', 'shoes', 'accessories'];
  const file = known.includes(category) ? category : 'driver';
  const iconFile = file === 'hybrid' ? 'wood' : file;
  return `assets/icons/${iconFile}.svg`;
}

function badgeFor(savePct) {
  if (savePct >= 28) return { label: 'HOT DEAL', cls: 'hot-deal' };
  if (savePct >= 20) return { label: 'PRICE DROP', cls: 'price-drop' };
  return { label: 'BEST PRICE', cls: '' };
}

function cardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <div class="thumb">
        <span class="badge ${badge.cls}">${badge.label}</span>
        <img src="${d.image || iconFor(d.category)}" alt="${d.name}" loading="lazy">
      </div>
      <div class="deal-body">
        <h3>${d.name}</h3>
        <div class="price-row"><span class="retail-price">${money(d.retailPrice)}</span></div>
        <div class="price-row"><span class="sale-price">${money(d.salePrice)}</span></div>
        <span class="save-pill">Save ${money(d.retailPrice - d.salePrice)} (${d.savePct}%)</span>
        <div class="deal-foot">
          <span>Available at ${d.retailerCount} retailers</span>
          <span class="rating">${starIcon()} ${d.rating}</span>
        </div>
      </div>
    </a>`;
}

let ALL_PRODUCTS = [];
let ACTIVE_CATEGORY = 'all';

function applyFilters() {
  const q = document.getElementById('shop-search-input').value.trim().toLowerCase();
  const grid = document.getElementById('shop-grid');
  const empty = document.getElementById('empty-state');

  const filtered = ALL_PRODUCTS.filter(p => {
    const matchesCategory = ACTIVE_CATEGORY === 'all' || p.category === ACTIVE_CATEGORY;
    const matchesQuery = !q || p.name.toLowerCase().includes(q);
    return matchesCategory && matchesQuery;
  });

  grid.innerHTML = filtered.map(cardHTML).join('');
  empty.style.display = filtered.length ? 'none' : 'block';
}

function renderFilterBar(categories) {
  const bar = document.getElementById('filter-bar');
  const chips = [{ key: 'all', label: 'All' }, ...categories];
  bar.innerHTML = chips.map(c =>
    `<button class="filter-chip${c.key === 'all' ? ' active' : ''}" data-key="${c.key}">${c.label}</button>`
  ).join('');
  bar.querySelectorAll('.filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_CATEGORY = btn.dataset.key;
      bar.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;
    renderFilterBar(data.categories);

    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) document.getElementById('shop-search-input').value = q;

    applyFilters();
  })
  .catch(err => console.error('Could not load products.json', err));

document.getElementById('shop-search-form').addEventListener('submit', e => e.preventDefault());
document.getElementById('shop-search-input').addEventListener('input', applyFilters);
