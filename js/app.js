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
  // hybrid reuses the wood icon/photo — close enough visually, no dedicated asset yet
  const iconFile = file === 'hybrid' ? 'wood' : file;
  return `assets/icons/${iconFile}.svg`;
}

function badgeFor(savePct) {
  if (savePct >= 28) return { label: 'HOT DEAL', cls: 'hot-deal' };
  if (savePct >= 20) return { label: 'PRICE DROP', cls: 'price-drop' };
  return { label: 'BEST PRICE', cls: '' };
}

function dealCardHTML(d) {
  const badge = badgeFor(d.savePct);
  return `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <div class="thumb">
        <span class="badge ${badge.cls}">${badge.label}</span>
        <img src="${d.image || iconFor(d.category)}" alt="${d.name}" loading="lazy">
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
      <img src="${d.image || iconFor(d.category)}" alt="${d.name}" loading="lazy">
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
  list.innerHTML = items.map(t => `
    <a class="tag" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">${t.name} <span class="${t.tag.toLowerCase()}">${t.tag === 'Hot' ? '🔥' : '📈'} ${t.tag}</span></a>
  `).join('');
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    const sorted = [...data.products].sort((a, b) => b.savePct - a.savePct);

    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = sorted.slice(0, 3).map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = sorted.slice(3, 6).map(dropRowHTML).join('');

    if (data.trending) renderTrending(data.trending);
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
