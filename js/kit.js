/*
  GolfPrice AI — "Complete The Kit" page logic
  --------------------------------------------------
  Reads data/bundles.json (a separate, small file from
  data/products.json) and renders each auto-generated bundle that
  scripts/update_deals.py computes fresh every run.
*/

document.getElementById('year').textContent = new Date().getFullYear();

async function loadKit() {
  const loadingEl = document.getElementById('kit-loading');
  const emptyEl = document.getElementById('kit-empty');
  const listEl = document.getElementById('kit-list');

  let data;
  try {
    const res = await fetch('data/bundles.json');
    if (!res.ok) {
      // Most likely explanation: the pipeline hasn't run with this
      // feature deployed yet, not a genuine network failure.
      loadingEl.hidden = true;
      emptyEl.hidden = false;
      return;
    }
    data = await res.json();
  } catch (err) {
    loadingEl.textContent = "Couldn't load this right now — try refreshing.";
    return;
  }

  const bundles = data.bundles || [];
  loadingEl.hidden = true;

  if (bundles.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  listEl.hidden = false;
  listEl.innerHTML = bundles.map(renderBundle).join('');
}

function renderBundle(bundle) {
  return `
    <article class="kit-card">
      <h2 class="kit-card-title">${escapeHtml(bundle.title)}</h2>
      <div class="kit-items">
        ${bundle.items.map(renderItem).join('')}
      </div>
      <div class="kit-total-row">
        <span class="kit-total-label">Total if you grab all of these</span>
        <span class="kit-total-amount">£${bundle.total.toFixed(2)}</span>
      </div>
    </article>
  `;
}

function renderItem(item) {
  return `
    <div class="kit-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <span class="kit-item-slot">${escapeHtml(item.slotLabel)}</span>
      <span class="kit-item-name">${escapeHtml(item.name)}</span>
      <span class="kit-item-price">£${item.salePrice.toFixed(2)}</span>
      <a class="kit-item-link" href="${escapeHtml(item.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">Buy →</a>
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadKit);
