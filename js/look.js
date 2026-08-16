/*
  GolfPrice AI — "Complete The Look" page logic
  --------------------------------------------------
  Two independent features on this page:

  1. Pre-built outfits — reads data/outfits.json (assembled fresh every
     run by scripts/update_deals.py using real colour-theory matching).

  2. "Shop By Colour" picker — reads data/products.json directly (the
     same full catalog every other page uses) and lets a visitor pick a
     colour swatch to see real, compatible, in-stock apparel items,
     grouped by type. This mirrors the exact same colour-wheel rules the
     backend outfit engine uses (see COLOUR_HUE_ANGLES below) — kept
     hand-in-sync with scripts/update_deals.py's own constants so a
     colour that's "compatible" here is compatible everywhere else on
     the site too. If you ever change one, change both.
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

// ============================================================
// Mirrors scripts/update_deals.py's colour-theory engine exactly —
// same hue angles, same neutrals, same thresholds. Two colours are
// compatible if they're identical, either is a neutral (navy included,
// same as backend — it functions as one in golf specifically), or
// their hue angle is close (analogous) or near-opposite (complementary).
// Anything else is a genuine clash and is excluded, not just deprioritised.
// ============================================================
const COLOUR_HUE_ANGLES = {
  red: 0, brown: 40, orange: 60, gold: 90, yellow: 120,
  khaki: 130, olive: 150, green: 180, blue: 240, purple: 300,
  pink: 330,
};
const NEUTRAL_COLOURS = new Set([
  'black', 'white', 'grey', 'gray', 'navy', 'beige', 'silver',
  'charcoal', 'cream', 'stone', 'tan',
]);
const ANALOGOUS_MAX_ANGLE = 65;
const COMPLEMENTARY_MIN_ANGLE = 150;

function coloursAreCompatible(colourA, colourB) {
  if (!colourA || !colourB) return false;
  const a = colourA.toLowerCase();
  const b = colourB.toLowerCase();
  if (a === b) return true;
  if (NEUTRAL_COLOURS.has(a) || NEUTRAL_COLOURS.has(b)) return true;
  const angleA = COLOUR_HUE_ANGLES[a];
  const angleB = COLOUR_HUE_ANGLES[b];
  if (angleA === undefined || angleB === undefined) return false;
  let diff = Math.abs(angleA - angleB);
  diff = Math.min(diff, 360 - diff);
  return diff <= ANALOGOUS_MAX_ANGLE || diff >= COMPLEMENTARY_MIN_ANGLE;
}

// The full palette offered as swatches — every colour word the backend
// can extract from a product name (see COLOUR_KEYWORDS in
// scripts/update_deals.py), so "select a colour" never offers an option
// that can't possibly match anything.
const SWATCH_ORDER = [
  'black', 'white', 'navy', 'grey', 'blue', 'red', 'green', 'yellow',
  'orange', 'pink', 'purple', 'brown', 'tan', 'beige', 'gold', 'khaki',
  'olive', 'charcoal', 'stone',
];

// Which apparel icons appear in the "Shop By Colour" results, and in
// what order — mirrors the slot types used across the outfit templates
// plus a couple of extras people actually shop for by colour.
const COLOUR_SHOP_ICON_ORDER = [
  { icon: 'polo', label: 'Polos' },
  { icon: 'trousers', label: 'Trousers' },
  { icon: 'shorts', label: 'Shorts' },
  { icon: 'skort', label: 'Skorts' },
  { icon: 'jacket', label: 'Jackets & Layers' },
  { icon: 'cap', label: 'Caps' },
  { icon: 'dress', label: 'Dresses' },
];

let CATALOG_CACHE = null;

async function loadCatalog() {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const res = await fetch('data/products.json');
  if (!res.ok) throw new Error('Catalog fetch failed');
  const data = await res.json();
  CATALOG_CACHE = data.products || [];
  return CATALOG_CACHE;
}

function renderSwatchPicker() {
  const el = document.getElementById('colour-swatch-picker');
  if (!el) return;
  el.innerHTML = SWATCH_ORDER.map(colour => {
    const hex = COLOUR_SWATCH_HEX[colour] || '#ccc';
    const label = colour.charAt(0).toUpperCase() + colour.slice(1);
    return `
      <button type="button" class="colour-swatch-btn" data-colour="${colour}" aria-label="${label}" title="${label}">
        <span class="colour-swatch-dot" style="background:${hex}"></span>
      </button>
    `;
  }).join('');

  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.colour-swatch-btn');
    if (!btn) return;
    el.querySelectorAll('.colour-swatch-btn').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    showColourResults(btn.dataset.colour);
  });
}

async function showColourResults(colour) {
  const statusEl = document.getElementById('colour-shop-status');
  const resultsEl = document.getElementById('colour-shop-results');
  const headingEl = document.getElementById('colour-shop-heading');

  statusEl.hidden = false;
  statusEl.textContent = 'Matching real colours, not just close enough…';
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';

  let products;
  try {
    products = await loadCatalog();
  } catch (err) {
    statusEl.textContent = "Couldn't load the catalog right now — try refreshing.";
    return;
  }

  const label = colour.charAt(0).toUpperCase() + colour.slice(1);
  headingEl.textContent = `Goes with ${label}`;

  const groups = COLOUR_SHOP_ICON_ORDER.map(({ icon, label: groupLabel }) => {
    const items = products
      .filter(p =>
        p.category === 'apparel' &&
        p.icon === icon &&
        p.image &&
        p.colour &&
        p.inStock !== false &&
        coloursAreCompatible(colour, p.colour)
      )
      .sort((a, b) => a.salePrice - b.salePrice)
      .slice(0, 8);
    return { icon, groupLabel, items };
  }).filter(g => g.items.length > 0);

  statusEl.hidden = true;

  if (groups.length === 0) {
    statusEl.hidden = false;
    statusEl.textContent = `Nothing genuinely matches ${label} right now — check back as the catalog grows.`;
    return;
  }

  resultsEl.hidden = false;
  resultsEl.innerHTML = groups.map(g => `
    <div class="colour-shop-group">
      <h3 class="colour-shop-group-title">${escapeHtml(g.groupLabel)}</h3>
      <div class="colour-shop-grid">
        ${g.items.map(renderColourResultItem).join('')}
      </div>
    </div>
  `).join('');
}

function renderColourResultItem(item) {
  const swatchHex = COLOUR_SWATCH_HEX[(item.colour || '').toLowerCase()] || '#ccc';
  return `
    <div class="colour-shop-item">
      <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">
      <span class="colour-shop-item-name">${escapeHtml(item.name)}</span>
      <span class="look-item-colour-row">
        <span class="look-colour-swatch" style="background:${swatchHex}"></span>
        ${escapeHtml(item.colour || '')}
      </span>
      <span class="colour-shop-item-price">£${item.salePrice.toFixed(2)}</span>
      <a class="kit-item-link" href="${escapeHtml(item.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">Buy →</a>
    </div>
  `;
}

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

document.addEventListener('DOMContentLoaded', () => {
  loadLooks();
  renderSwatchPicker();
});
