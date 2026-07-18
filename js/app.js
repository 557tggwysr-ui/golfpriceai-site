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
  // Keep trending "name" values to ~25 characters max (including spaces) so
  // they fit on one line inside the pill alongside the icon + Hot/Rising
  // label without wrapping or clipping. Longest currently in use: 26 chars
  // ("Titleist Pro V1 Golf Balls"), which is the safe upper edge — don't
  // go meaningfully past that without checking it still fits.
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

    // Pick the top N items with no two sharing the same specific type
    // (driver, putter, headcover, etc.) so the featured section doesn't show
    // two headcovers or two drivers side by side. Falls back to allowing
    // repeats only if there genuinely aren't enough distinct types.
    function pickDiverseTop(list, count, usedKeys) {
      const picked = [];
      const seen = new Set(usedKeys);
      for (const item of list) {
        const key = item.icon || item.category;
        if (seen.has(key)) continue;
        picked.push(item);
        seen.add(key);
        if (picked.length === count) break;
      }
      if (picked.length < count) {
        for (const item of list) {
          if (picked.length === count) break;
          if (!picked.includes(item)) picked.push(item);
        }
      }
      return picked;
    }

    const bestDeals = pickDiverseTop(sorted, 4, []);
    const bestKeys = bestDeals.map(d => d.icon || d.category);
    const priceDrops = pickDiverseTop(
      sorted.filter(d => !bestDeals.includes(d)), 3, bestKeys
    );

    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = bestDeals.map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = priceDrops.map(dropRowHTML).join('');

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
