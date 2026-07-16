document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '$' + n.toFixed(2);
}

function starIcon() {
  return '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
}

function badgeClass(badge) {
  if (badge === 'PRICE DROP') return 'badge price-drop';
  if (badge === 'HOT DEAL') return 'badge hot-deal';
  return 'badge';
}

function renderBestDeals(deals) {
  const grid = document.getElementById('best-deals');
  grid.innerHTML = deals.map(d => `
    <a class="deal-card" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <div class="thumb">
        <span class="${badgeClass(d.badge)}">${d.badge}</span>
        <img src="${d.image}" alt="${d.name}" loading="lazy">
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
          <span class="rating">${starIcon()} ${d.rating}</span>
        </div>
      </div>
    </a>
  `).join('');
}

function renderPriceDrops(drops) {
  const list = document.getElementById('price-drop-list');
  list.innerHTML = drops.map(d => `
    <a class="drop-row" href="${d.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <img src="${d.image}" alt="${d.name}" loading="lazy">
      <div class="info">
        <h4>${d.name}</h4>
        <span class="was">Was ${money(d.wasPrice)}</span>
      </div>
      <div class="now">${money(d.nowPrice)}<span class="pct">${d.dropPct}% drop</span></div>
    </a>
  `).join('');
}

function renderTrending(items) {
  const list = document.getElementById('trending-list');
  list.innerHTML = items.map(t => `
    <span class="tag">${t.name} <span class="${t.tag.toLowerCase()}">${t.tag === 'Hot' ? '🔥' : '📈'} ${t.tag}</span></span>
  `).join('');
}

fetch('data/deals.json')
  .then(r => r.json())
  .then(data => {
    renderBestDeals(data.bestDeals);
    renderPriceDrops(data.priceDrops);
    renderTrending(data.trending);
  })
  .catch(err => console.error('Could not load deals.json', err));

document.getElementById('search-form').addEventListener('submit', function (e) {
  e.preventDefault();
  const q = document.getElementById('search-input').value.trim();
  if (q) {
    document.getElementById('deals').scrollIntoView({ behavior: 'smooth' });
  }
});
