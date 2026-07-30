/*
  GolfPrice AI — "The Fairway Index" page logic
  --------------------------------------------------
  Reads data/price-index.json (a separate, small file from
  data/products.json) and renders the per-category summary that
  scripts/update_deals.py computes each run.
*/

document.getElementById('year').textContent = new Date().getFullYear();

const CATEGORY_LABELS = {
  driver: 'Drivers', wood: 'Fairway Woods', hybrid: 'Hybrids', irons: 'Irons',
  wedge: 'Wedges', putter: 'Putters', sets: 'Sets', ball: 'Balls', bag: 'Bags',
  shoes: 'Shoes', apparel: 'Apparel', accessories: 'Accessories',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

async function loadFairwayIndex() {
  const loadingEl = document.getElementById('fi-loading');
  const emptyEl = document.getElementById('fi-empty');
  const gridEl = document.getElementById('fi-grid');

  let data;
  try {
    const res = await fetch('data/price-index.json');
    if (!res.ok) {
      // Most likely explanation: the Index hasn't run yet (the file
      // doesn't exist on the site yet), not a genuine network failure —
      // show the honest "not tracking yet" state rather than an alarming
      // error message.
      loadingEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    data = await res.json();
  } catch (err) {
    loadingEl.textContent = "Couldn't load the Index right now — try refreshing.";
    return;
  }

  const summary = data.summary || {};
  const categories = CATEGORY_ORDER.filter(c => summary[c]);

  loadingEl.hidden = true;
  if (categories.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  gridEl.hidden = false;
  gridEl.innerHTML = categories.map(cat => renderCard(cat, summary[cat])).join('');
}

function renderCard(cat, entry) {
  return `
    <div class="fi-card">
      <p class="fi-card-label">${CATEGORY_LABELS[cat] || cat}</p>
      <div class="fi-card-price">£${entry.currentAvg.toFixed(2)} <span style="font-size:0.7rem;color:var(--muted);font-weight:500;">avg</span></div>
      <div class="fi-change-row">
        ${renderChange('30d', entry.change30d)}
        ${renderChange('90d', entry.change90d)}
      </div>
      <p class="fi-card-count">Tracked across ${entry.count} product${entry.count === 1 ? '' : 's'}</p>
    </div>
  `;
}

function renderChange(label, pct) {
  if (pct === null || pct === undefined) {
    return `<span class="fi-change fi-change--unknown">${label}: tracking</span>`;
  }
  if (Math.abs(pct) < 0.5) {
    return `<span class="fi-change fi-change--flat">${label}: flat</span>`;
  }
  const cls = pct < 0 ? 'fi-change--down' : 'fi-change--up';
  const arrow = pct < 0 ? '↓' : '↑';
  const sign = pct > 0 ? '+' : '';
  return `<span class="fi-change ${cls}">${label}: ${arrow} ${sign}${pct}%</span>`;
}

document.addEventListener('DOMContentLoaded', loadFairwayIndex);
