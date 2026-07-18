document.getElementById('year').textContent = new Date().getFullYear();

function tagIcon(tag) {
  return tag === 'Hot' ? '🔥' : '📈';
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    const grid = document.getElementById('trend-grid');
    const trending = data.trending || [];

    grid.innerHTML = trending.map(t => {
      const categoryLink = t.category ? `shop.html?category=${encodeURIComponent(t.category)}` : 'shop.html';
      return `
        <div class="trend-card">
          <div class="tag-row">
            <span class="tag" style="padding:4px 12px;">${tagIcon(t.tag)} ${t.tag}</span>
          </div>
          <h3>${t.name}</h3>
          <p>${t.blurb || ''}</p>
          <div style="display:flex;gap:14px;flex-wrap:wrap;">
            <a class="view-link" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">Go fetch this deal 🏌️ →</a>
            <a class="view-link" href="${categoryLink}" style="color:var(--muted);">or browse the category →</a>
          </div>
        </div>`;
    }).join('');
  })
  .catch(err => console.error('Could not load products.json', err));
