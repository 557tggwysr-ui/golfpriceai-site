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
  const topMovers = data.topMovers || {};
  const categories = CATEGORY_ORDER.filter(c => summary[c]);

  loadingEl.hidden = true;
  if (categories.length === 0) {
    emptyEl.hidden = false;
    return;
  }

  gridEl.hidden = false;
  gridEl.innerHTML = categories.map(cat => renderCard(cat, summary[cat], topMovers[cat] || [])).join('');
}

// The CTA is only ever framed by a REAL tracked trend — falling prices
// point at the Shop page sorted by biggest discount; rising prices point
// at buying now before it climbs further (genuine, evidenced urgency,
// not a manufactured countdown timer); no meaningful trend yet gets a
// plain, honest link with no urgency framing at all.
function trendCTA(cat, entry) {
  const label = CATEGORY_LABELS[cat] || cat;
  const change = (entry.change30d !== null && entry.change30d !== undefined) ? entry.change30d : entry.change90d;
  if (change !== null && change !== undefined && change <= -2) {
    return { text: `📉 Prices Dropping — Shop ${label} →`, href: `shop.html?category=${cat}&sort=discount`, cls: 'fi-cta--down' };
  }
  if (change !== null && change !== undefined && change >= 2) {
    return { text: `📈 Rising — Buy Before It Climbs →`, href: `shop.html?category=${cat}&sort=price-asc`, cls: 'fi-cta--up' };
  }
  return { text: `Shop ${label} →`, href: `shop.html?category=${cat}`, cls: '' };
}

function renderCard(cat, entry, movers) {
  const cta = trendCTA(cat, entry);
  return `
    <div class="fi-card">
      <p class="fi-card-label">${CATEGORY_LABELS[cat] || cat}</p>
      <div class="fi-card-price">£${entry.currentAvg.toFixed(2)} <span style="font-size:0.7rem;color:var(--muted);font-weight:500;">avg</span></div>
      <div class="fi-change-row">
        ${renderChange('30d', entry.change30d)}
        ${renderChange('90d', entry.change90d)}
      </div>
      <p class="fi-card-count">Tracked across ${entry.count} product${entry.count === 1 ? '' : 's'}</p>
      ${movers.length ? renderMovers(movers) : ''}
      <a class="fi-cta ${cta.cls}" href="${cta.href}">${cta.text}</a>
    </div>
  `;
}

function renderMovers(movers) {
  return `
    <div class="fi-movers">
      <p class="fi-movers-label">Real drops behind the number:</p>
      ${movers.map(m => `
        <a class="fi-mover" href="${escapeHtml(m.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">
          <img src="${escapeHtml(m.image)}" alt="${escapeHtml(m.name)}" loading="lazy">
          <span class="fi-mover-info">
            <span class="fi-mover-name">${escapeHtml(m.name)}</span>
            <span class="fi-mover-price">£${m.salePrice.toFixed(2)} <span class="fi-mover-drop">↓${m.dropPct}%</span></span>
          </span>
        </a>
      `).join('')}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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
