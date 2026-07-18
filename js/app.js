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

// Backdrop photos matched to what the icon actually represents — reusing the
// same verified photos already grouped by theme on the Apparel/Accessories
// hub pages, so a GPS watch sits on an active-play shot, bag gear sits on a
// bag photo, and course-essentials items sit on a green/putting shot.
const ICON_BACKDROPS = {
  'gps-watch': 'https://images.pexels.com/photos/9207654/pexels-photo-9207654.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'rangefinder': 'https://images.pexels.com/photos/9207654/pexels-photo-9207654.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'sensor': 'https://images.pexels.com/photos/9207654/pexels-photo-9207654.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'pushcart': 'https://images.pexels.com/photos/35320703/pexels-photo-35320703.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'headcover': 'https://images.pexels.com/photos/35320703/pexels-photo-35320703.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'umbrella': 'https://images.pexels.com/photos/54122/pexels-photo-54122.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'accessories': 'https://images.pexels.com/photos/54122/pexels-photo-54122.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'divot-tool': 'https://images.pexels.com/photos/54122/pexels-photo-54122.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'alignment-sticks': 'https://images.pexels.com/photos/54122/pexels-photo-54122.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'polo': 'https://images.pexels.com/photos/8786045/pexels-photo-8786045.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'shorts': 'https://images.pexels.com/photos/6542427/pexels-photo-6542427.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'trousers': 'https://images.pexels.com/photos/6542427/pexels-photo-6542427.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'skort': 'https://images.pexels.com/photos/6542427/pexels-photo-6542427.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'jacket': 'https://images.pexels.com/photos/6542400/pexels-photo-6542400.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'hoodie': 'https://images.pexels.com/photos/6542400/pexels-photo-6542400.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'base-layer': 'https://images.pexels.com/photos/6542400/pexels-photo-6542400.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'cap': 'https://images.pexels.com/photos/9366508/pexels-photo-9366508.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'sunglasses': 'https://images.pexels.com/photos/9366508/pexels-photo-9366508.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'belt': 'https://images.pexels.com/photos/9366508/pexels-photo-9366508.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600',
  'socks': 'https://images.pexels.com/photos/9366508/pexels-photo-9366508.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600'
};
const DEFAULT_BACKDROP = 'https://images.pexels.com/photos/6542427/pexels-photo-6542427.jpeg?auto=compress&cs=tinysrgb&h=400&fit=crop&w=600';

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
  const backdrop = ICON_BACKDROPS[d.icon] || DEFAULT_BACKDROP;
  return ` style="background-image:url('${backdrop}')"`;
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
    // Prefer products with a real photo over icon-only ones when picking the
    // homepage's top 3 — still genuinely the best discounts, just weighted so
    // the hero section always leads with its best-looking cards.
    const sorted = [...data.products].sort((a, b) => {
      const aHasImage = a.image ? 1 : 0;
      const bHasImage = b.image ? 1 : 0;
      if (aHasImage !== bHasImage) return bHasImage - aHasImage;
      return b.savePct - a.savePct;
    });

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
