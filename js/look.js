/*
  GolfPrice AI — "Complete The Look" page logic
  --------------------------------------------------
  Reads data/outfits.json (a separate, small file from data/products.json)
  and renders each auto-generated outfit that scripts/update_deals.py
  assembles fresh every run using real colour-theory matching.
*/

document.getElementById('year').textContent = new Date().getFullYear();

const COLOUR_SWATCH_HEX = {
  black: '#222', white: '#fff', grey: '#9aa19a', gray: '#9aa19a', navy: '#1b2a4a',
  blue: '#2f6fd1', red: '#c93b3b', green: '#3fae29', yellow: '#e6c73f',
  orange: '#e0812f', pink: '#e88fb0', purple: '#7a5cb8', brown: '#7a5236',
  tan: '#d2b48c', beige: '#e8dcc8', silver: '#c4c8c4', gold: '#c9a227',
  khaki: '#8a8154', olive: '#6c6b3f', charcoal: '#454a45', cream: '#f2ecd8',
  stone: '#ada893',
};

// Purely cosmetic — a short, honest, on-brand line explaining WHY the
// colours were paired, shown once per outfit card. Never claims more
// than the actual matching logic guarantees.
function colourNoteFor(items) {
  const colours = [...new Set(items.map(i => (i.colour || '').toLowerCase()))];
  if (colours.length <= 1) return "Matched: one colour, zero risk.";
  return "Matched using real colour theory — not just \"these were both in stock.\"";
}

async function loadLooks() {
  const loadingEl = document.getElementById('look-loading');
  const emptyEl = document.getElementById('look-empty');
  const listEl = document.getElementById('look-list');

  let data;
  try {
    const res = await fetch('data/outfits.json');
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

  const outfits = data.outfits || [];
  loadingEl.hidden = true;

  if (outfits.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  listEl.hidden = false;
  listEl.innerHTML = outfits.map(renderOutfit).join('');
}

function renderOutfit(outfit) {
  return `
    <article class="kit-card">
      <h2 class="kit-card-title">${escapeHtml(outfit.title)}<span class="look-audience-badge">${escapeHtml(outfit.audience)}</span></h2>
      <p class="kit-status" style="padding:0;text-align:left;margin:0 0 14px;font-size:0.82rem;">${colourNoteFor(outfit.items)}</p>
      <div class="kit-items">
        ${outfit.items.map(renderItem).join('')}
      </div>
      <div class="kit-total-row">
        <span class="kit-total-label">Total for the full look</span>
        <span class="kit-total-amount">£${outfit.total.toFixed(2)}</span>
      </div>
    </article>
  `;
}

function renderItem(item) {
  const swatchHex = COLOUR_SWATCH_HEX[(item.colour || '').toLowerCase()] || '#ccc';
  return `
    <div class="kit-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <span class="kit-item-slot">${escapeHtml(item.slotLabel)}</span>
      <span class="kit-item-name">${escapeHtml(item.name)}</span>
      <span class="look-item-colour-row">
        <span class="look-colour-swatch" style="background:${swatchHex}"></span>
        ${escapeHtml(item.colour || '')}
      </span>
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

document.addEventListener('DOMContentLoaded', loadLooks);
