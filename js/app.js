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

// If a real product image URL is broken (dead retailer link, hotlink
// protection, slow/failed CDN request) the browser shows its own small
// broken-image icon — this swaps that out for the same clean icon
// fallback already used for products with no image field at all, rather
// than ever letting a broken-image icon reach a visitor. Kept as a
// duplicate of shop.js's identical function — no build step / module
// system on this site, consistent with how other small helpers are
// already duplicated between app.js and shop.js.
function handleImgError(imgEl, iconSrc) {
  imgEl.onerror = null;
  const container = imgEl.closest('.thumb, .drop-thumb');
  if (!container) return;
  container.classList.add('icon-thumb');
  // Replace ONLY the <img> itself, not the whole container — see
  // shop.js's identical function for the full explanation of the real
  // bug this fixes (was silently destroying sibling badges).
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

// Crowd-Verified Pricing — same pattern as shop.js's reportPriceLinkHTML,
// kept as a duplicate here rather than a shared import since this site
// has no build step / module system; consistent with how other small
// helpers (money, thumbHTML, etc.) are already duplicated between
// app.js and shop.js.
function reportPriceLinkHTML(d) {
  const subject = encodeURIComponent(`Pricing issue: ${d.name}`);
  const body = encodeURIComponent(
    `Hi, I think there might be a pricing issue with this product:\n\n${d.name}\nShown price: ${money(d.salePrice)}\nLink: ${d.affiliateUrl}\n\nWhat's wrong: `
  );
  const mailto = `mailto:hello@golfpriceai.com?subject=${subject}&body=${body}`;
  // Must NOT be a real <a> — .deal-card is itself an <a>, and a nested
  // <a> inside another <a> is invalid HTML. Browsers silently auto-close
  // the outer anchor the instant they hit the nested one, which ejects
  // everything after it (the rest of .deal-body — title, price, this
  // link, all of it) out of the card entirely, as a stray sibling. That
  // was the real cause of the card layout breaking. A span styled and
  // behaving identically (click + keyboard) avoids the nested-anchor
  // problem entirely while working exactly the same for a visitor.
  return `<span class="report-price-link" role="button" tabindex="0" onclick="event.preventDefault();event.stopPropagation();window.location.href='${mailto}';" onkeydown="if(event.key==='Enter'){event.preventDefault();event.stopPropagation();window.location.href='${mailto}';}">⚠️ Report a pricing issue</span>`;
}

// Product/Offer structured data (schema.org), one block per card. Kept
// deliberately conservative: only marks up fields the site is genuinely
// confident in. Price comes straight from the same salePrice already
// shown on the card — the exact figure that's already passed the site's
// own Data Quality checks (RRP-inversion rejection, implausible-discount
// rejection, etc. in scripts/update_deals.py) — never a separately
// "nicer" number. Always uses JSON.stringify rather than manual string
// building, so a product name containing a quote or apostrophe (e.g.
// "Men's") can never produce broken/invalid JSON.
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

// Preowned/condition badge — shown alongside (never instead of) the
// existing discount badge, top-right so they never overlap. Shows the
// specific grade when the retailer's feed provides one (e.g. "Very
// Good"), or the honest generic "Preowned" when it doesn't — never
// invents a grade that isn't genuinely in the data.
function conditionBadgeHTML(d) {
  if (!d.condition) return '';
  return `<span class="condition-badge">${d.condition}</span>`;
}

function dealCardHTML(d) {
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
        <div class="price-row">
          <span class="retail-price">${money(d.retailPrice)}</span>
        </div>
        <div class="price-row">
          <span class="sale-price">${money(d.salePrice)}</span>
        </div>
        <span class="save-pill">Save ${money(d.retailPrice - d.salePrice)} (${d.savePct}%)</span>
        <div class="deal-foot">
          <span>Available at ${d.retailerCount} retailers</span>
          ${reportPriceLinkHTML(d)}
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

// Trending pills have a fixed-ish width, so a very long real product name
// (much more common now the catalog has thousands of items instead of ~78
// hand-shortened ones) can overflow the pill. Truncates by word count
// rather than raw character count so it never cuts a word in half.
function truncateWords(name, maxWords) {
  const words = name.split(' ');
  if (words.length <= maxWords) return name;
  return words.slice(0, maxWords).join(' ') + '…';
}

function renderTrending(items) {
  const list = document.getElementById('trending-list');
  if (!list) return;
  list.innerHTML = items.map(t => `
    <a class="tag" href="${t.affiliateUrl}" target="_blank" rel="sponsored noopener">
      <span class="tag-name">${truncateWords(t.name, 5)}</span>
      <span class="${t.tag.toLowerCase()}">${t.tag === 'Hot' ? '🔥' : '📈'} ${t.tag}</span>
    </a>
  `).join('');
}

// Selection logic (the daily-seeded shuffle, the 85%-Male / min-6-clubs
// constraint solving, popularity scoring) used to run here, in every
// visitor's browser, after downloading the ENTIRE catalog just to derive
// 30 items from it. It's now precomputed once every 6 hours by the
// Python pipeline (scripts/update_deals.py — see compute_homepage_views
// and its neighbours) and shipped as one small file, verified
// byte-for-byte identical to what this file used to compute client-side
// before the switch. This fetch is now just rendering, not selecting.
fetch('data/curated-views.json')
  .then(r => r.json())
  .then(views => {
    const bestGrid = document.getElementById('best-deals');
    if (bestGrid) bestGrid.innerHTML = views.home.bestDeals.map(dealCardHTML).join('');

    const dropList = document.getElementById('price-drop-list');
    if (dropList) dropList.innerHTML = views.home.priceDrops.map(dropRowHTML).join('');

    renderTrending(views.home.trending);
  })
  .catch(err => console.error('Could not load curated-views.json', err));

const searchForm = document.getElementById('search-form');
if (searchForm) {
  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    const q = document.getElementById('search-input').value.trim();
    window.location.href = 'shop.html' + (q ? ('?q=' + encodeURIComponent(q)) : '');
  });
}
