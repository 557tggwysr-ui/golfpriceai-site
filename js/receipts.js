/*
  GolfPrice AI — "Show Us The Receipts" page logic
  ----------------------------------------------------
  Reads data/products.json (already live on the site) and surfaces the
  biggest genuine price drops, using the `priceInsight` field that
  scripts/update_deals.py now writes onto every priced product.

  A product only appears here if priceInsight.verifiedDiscount is true —
  meaning our own tracked history actually recorded a higher price at some
  point in the last 90 days, independent of whatever a retailer's feed
  claims. No history yet (priceInsight.status === "new") means no claim
  gets made, full stop.
*/

const MAX_RESULTS = 24;

async function loadReceipts() {
  const loadingEl = document.getElementById("receipts-loading");
  const emptyEl = document.getElementById("receipts-empty");
  const gridEl = document.getElementById("receipts-grid");

  let data;
  try {
    const res = await fetch("data/products.json");
    data = await res.json();
  } catch (err) {
    loadingEl.textContent = "Couldn't load the receipts right now — try refreshing the page.";
    return;
  }

  const products = (data.products || [])
    .filter(p => p.priceInsight && p.priceInsight.verifiedDiscount && p.image)
    .map(p => {
      const insight = p.priceInsight;
      const dropAmount = insight.historicalHigh - p.salePrice;
      const dropPct = Math.round((dropAmount / insight.historicalHigh) * 100);
      return { ...p, _dropAmount: dropAmount, _dropPct: dropPct };
    })
    .sort((a, b) => b._dropPct - a._dropPct)
    .slice(0, MAX_RESULTS);

  loadingEl.hidden = true;

  if (products.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  gridEl.hidden = false;
  gridEl.innerHTML = products.map(renderCard).join("");
}

function renderCard(p) {
  const insight = p.priceInsight;
  const now = `£${p.salePrice.toFixed(2)}`;
  const was = `£${insight.historicalHigh.toFixed(2)}`;

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
        <p class="receipt-proof-line">Tracked ${insight.daysTracked} days — genuinely this cheap</p>
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
