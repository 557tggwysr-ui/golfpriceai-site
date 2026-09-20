/*
  GolfPrice AI — "Best Time To Buy" page logic
  --------------------------------------------------
  Reads the small, precomputed data/curated-views.json (built every 6
  hours by scripts/update_deals.py's compute_timing_view) instead of
  downloading the entire multi-MB catalog just to find 24 items in it.
  The selection logic — "stable" vs "volatile" by each product's own
  tracked history — is unchanged; it just runs once in the pipeline now
  instead of in every visitor's browser.
*/

document.getElementById('year').textContent = new Date().getFullYear();

async function loadTiming() {
  let views;
  try {
    const res = await fetch('data/curated-views.json');
    views = await res.json();
  } catch (err) {
    document.getElementById('stable-loading').textContent = "Couldn't load this right now — try refreshing.";
    document.getElementById('volatile-loading').textContent = '';
    return;
  }

  const stable = (views.timing && views.timing.stable) || [];
  const volatile = (views.timing && views.timing.volatile) || [];

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
  const badgeLabel = kind === 'stable'
    ? `Steady for ${p.daysTracked}+ days`
    : `Changes every ~${p.avgDaysBetweenChanges} days`;
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
