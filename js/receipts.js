/*
  GolfPrice AI — "Show Us The Receipts" page logic
  ----------------------------------------------------
  Reads the small, precomputed data/curated-views.json (built every 6
  hours by scripts/update_deals.py's compute_receipts_view) instead of
  downloading the entire multi-MB catalog just to find 24 items in it.
  The selection logic itself — verifiedDiscount only, biggest drop % —
  is unchanged; it just runs once in the pipeline now instead of in
  every visitor's browser. See scripts/update_deals.py for the full
  reasoning and how this was verified against the original logic.
*/

document.getElementById('year').textContent = new Date().getFullYear();

async function loadReceipts() {
  const loadingEl = document.getElementById("receipts-loading");
  const emptyEl = document.getElementById("receipts-empty");
  const gridEl = document.getElementById("receipts-grid");

  let views;
  try {
    const res = await fetch("data/curated-views.json");
    views = await res.json();
  } catch (err) {
    loadingEl.textContent = "Couldn't load the receipts right now — try refreshing the page.";
    return;
  }

  const products = views.receipts || [];

  loadingEl.hidden = true;

  if (products.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  gridEl.hidden = false;
  gridEl.innerHTML = products.map(renderCard).join("");
}

function renderCard(p) {
  const now = `£${p.salePrice.toFixed(2)}`;
  const was = `£${p.historicalHigh.toFixed(2)}`;

  return `
    <article class="receipt-card">
      <img class="receipt-card-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy">
      <div class="receipt-card-body">
        <span class="receipt-drop-badge">${p._dropPct}% off, receipts included</span>
        <p class="receipt-card-brand">${escapeHtml(p.brand || "")}</p>
        <p class="receipt-card-name">${escapeHtml(p.name)}</p>
        <div class="receipt-price-row">
          <span class="receipt-price-now">${now}</span>
          <span class="receipt-price-was">${was}</span>
        </div>
        <p class="receipt-proof-line">Tracked ${p.daysTracked} days — genuinely this cheap</p>
        <a class="receipt-buy-link" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">
          Grab It →
        </a>
      </div>
    </article>
  `;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", loadReceipts);
