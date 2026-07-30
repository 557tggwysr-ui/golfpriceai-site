/*
  GolfPrice AI — "Back In Stock Radar" page logic
  --------------------------------------------------
  Reads data/products.json and uses the `stockInsight` field
  scripts/update_deals.py now computes to show two honest lists:
  recently-sold-out products (with a manual notify-me mailto link) and
  products that have genuinely gone out of stock multiple times recently
  ("sells out fast" — a real pattern, not manufactured urgency).
*/

document.getElementById('year').textContent = new Date().getFullYear();

const MAX_PER_SECTION = 12;
const NOTIFY_EMAIL = 'hello@golfpriceai.com';

async function loadStockRadar() {
  let data;
  try {
    const res = await fetch('data/products.json');
    data = await res.json();
  } catch (err) {
    document.getElementById('soldout-loading').textContent = "Couldn't load this right now — try refreshing.";
    document.getElementById('fast-loading').textContent = '';
    return;
  }

  const products = data.products || [];

  const soldOut = products
    .filter(p => p.stockInsight && p.stockInsight.currentlyInStock === false && p.image)
    .slice(0, MAX_PER_SECTION);

  const sellsOutFast = products
    .filter(p => p.stockInsight && p.stockInsight.sellsOutFast && p.stockInsight.currentlyInStock && p.image)
    .sort((a, b) => b.stockInsight.outageCount90d - a.stockInsight.outageCount90d)
    .slice(0, MAX_PER_SECTION);

  renderSection('soldout', soldOut, 'soldout');
  renderSection('fast', sellsOutFast, 'fast');
}

function renderSection(prefix, items, kind) {
  const loadingEl = document.getElementById(`${prefix}-loading`);
  const emptyEl = document.getElementById(`${prefix}-empty`);
  const gridEl = document.getElementById(`${prefix}-grid`);

  loadingEl.hidden = true;
  if (items.length === 0) {
    emptyEl.hidden = false;
    return;
  }
  gridEl.hidden = false;
  gridEl.innerHTML = items.map(p => renderCard(p, kind)).join('');
}

function renderCard(p, kind) {
  const insight = p.stockInsight;
  const cardClass = kind === 'fast' ? 'radar-card in-stock' : 'radar-card';

  let badgeHTML = '';
  let actionHTML = '';

  if (kind === 'soldout') {
    badgeHTML = `<span class="radar-badge radar-badge--soldout">Currently sold out</span>`;
    const subject = encodeURIComponent(`Notify me when back in stock: ${p.name}`);
    const body = encodeURIComponent(
      `Hi, please let me know when this is back in stock:\n\n${p.name}\n\nMy email: `
    );
    actionHTML = `<a class="radar-notify-link" href="mailto:${NOTIFY_EMAIL}?subject=${subject}&body=${body}">🔔 Notify Me</a>`;
  } else {
    badgeHTML = `<span class="radar-badge radar-badge--fast">Sold out ${insight.outageCount90d}x recently</span>`;
    actionHTML = `<a class="radar-buy-link" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">Grab It →</a>`;
  }

  return `
    <article class="${cardClass}">
      <img class="radar-card-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">
      <div class="radar-card-body">
        ${badgeHTML}
        <p class="radar-card-brand">${escapeHtml(p.brand || '')}</p>
        <p class="radar-card-name">${escapeHtml(p.name)}</p>
        <div class="radar-card-price">£${p.salePrice.toFixed(2)}</div>
        ${actionHTML}
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadStockRadar);
