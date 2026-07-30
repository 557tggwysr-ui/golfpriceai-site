/*
  GolfPrice AI — "Best Time To Buy" page logic
  --------------------------------------------------
  Reads data/products.json and splits products into two lists using the
  `priceInsight.volatility` field scripts/update_deals.py now computes:
  "stable" (price rarely changes) or "volatile" (changes often) — both
  based purely on that specific product's own tracked history, never a
  category-wide guess.
*/

document.getElementById('year').textContent = new Date().getFullYear();

const MAX_PER_SECTION = 12;

async function loadTiming() {
  let data;
  try {
    const res = await fetch('data/products.json');
    data = await res.json();
  } catch (err) {
    document.getElementById('stable-loading').textContent = "Couldn't load this right now — try refreshing.";
    document.getElementById('volatile-loading').textContent = '';
    return;
  }

  const products = data.products || [];

  const stable = products
    .filter(p => p.priceInsight && p.priceInsight.volatility === 'stable' && p.image)
    .sort((a, b) => (b.priceInsight.daysTracked || 0) - (a.priceInsight.daysTracked || 0))
    .slice(0, MAX_PER_SECTION);

  const volatile = products
    .filter(p => p.priceInsight && p.priceInsight.volatility === 'volatile' && p.image)
    .sort((a, b) => (a.priceInsight.avgDaysBetweenChanges || 999) - (b.priceInsight.avgDaysBetweenChanges || 999))
    .slice(0, MAX_PER_SECTION);

  renderSection('stable', stable, 'stable');
  renderSection('volatile', volatile, 'volatile');
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
  const insight = p.priceInsight;
  const badgeLabel = kind === 'stable'
    ? `Steady for ${insight.daysTracked}+ days`
    : `Changes every ~${insight.avgDaysBetweenChanges} days`;
  const badgeClass = kind === 'stable' ? 'timing-badge--stable' : 'timing-badge--volatile';
  const note = kind === 'stable'
    ? "Hasn't moved — safe to buy whenever suits you."
    : 'Price has moved several times recently — worth a second look.';

  return `
    <article class="timing-card">
      <img class="timing-card-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">
      <div class="timing-card-body">
        <span class="timing-badge ${badgeClass}">${badgeLabel}</span>
        <p class="timing-card-brand">${escapeHtml(p.brand || '')}</p>
        <p class="timing-card-name">${escapeHtml(p.name)}</p>
        <div class="timing-card-price">£${p.salePrice.toFixed(2)}</div>
        <p class="timing-card-note">${note}</p>
        <a class="timing-buy-link" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">
          View Deal →
        </a>
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadTiming);
