/*
  GolfPrice AI — "Back In Stock Radar" page logic
  --------------------------------------------------
  Reads the small, precomputed data/curated-views.json (built every 6
  hours by scripts/update_deals.py's compute_stock_radar_view) instead
  of downloading the entire multi-MB catalog just to find 24 items in
  it. The selection logic — recently-sold-out, and genuinely-repeat
  "sells out fast" — is unchanged; it just runs once in the pipeline
  now instead of in every visitor's browser.
*/

document.getElementById('year').textContent = new Date().getFullYear();

// "Notify me" posts to the alerts worker: one email when the product (or
// any size or colour of it) is back, sent by scripts/alerts.py after the
// person confirms their address.
const ALERTS_URL = 'https://golfpriceai-alerts.golfpriceai.workers.dev';

document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('[data-notify]');
  if (!btn) return;
  const form = btn.nextElementSibling;
  const open = form.hidden;
  form.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) form.querySelector('input[type=email]').focus();
});

document.addEventListener('submit', (e) => {
  const form = e.target;
  if (!form.classList || !form.classList.contains('radar-notify-form')) return;
  e.preventDefault();
  const input = form.querySelector('input[type=email]');
  const btn = form.querySelector('button[type=submit]');
  const msg = form.querySelector('.radar-notify-msg');
  const email = (input.value || '').trim();
  const say = (text, kind) => { msg.textContent = text; msg.className = 'radar-notify-msg' + (kind ? ' is-' + kind : ''); };
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) { say('Please enter a full email address.', 'error'); input.focus(); return; }
  btn.disabled = true;
  say('Sending…');
  fetch(ALERTS_URL + '/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, stock: form.getAttribute('data-stock'), website: form.querySelector('input[name=website]').value }),
  }).then((r) => r.json().catch(() => ({ ok: false })))
    .then((res) => {
      btn.disabled = false;
      if (!res.ok) { say(res.error || 'Something went wrong. Please try again in a minute.', 'error'); return; }
      input.hidden = true; btn.hidden = true;
      say(res.status === 'added-stock'
        ? 'Done. We’ll email you once when it’s back.'
        : 'Nearly there: check your inbox and confirm, then we’ll email you once when it’s back.', 'ok');
      if (window.gtag) gtag('event', 'stock_alert_signup', { status: res.status });
    })
    .catch(() => { btn.disabled = false; say('Couldn’t reach the alert service. Please try again.', 'error'); });
});

async function loadStockRadar() {
  let views;
  try {
    const res = await fetch('data/curated-views.json');
    views = await res.json();
  } catch (err) {
    document.getElementById('back-loading').textContent = "Couldn't load this right now — try refreshing.";
    document.getElementById('soldout-loading').textContent = '';
    document.getElementById('fast-loading').textContent = '';
    return;
  }

  const backInStock = (views.stockRadar && views.stockRadar.backInStock) || [];
  const soldOut = (views.stockRadar && views.stockRadar.soldOut) || [];
  const sellsOutFast = (views.stockRadar && views.stockRadar.sellsOutFast) || [];

  renderSection('back', backInStock, 'back');
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
  const cardClass = kind === 'soldout' ? 'radar-card' : 'radar-card in-stock';

  let badgeHTML = '';
  let actionHTML = '';

  if (kind === 'back') {
    badgeHTML = `<span class="radar-badge radar-badge--back">Back in stock ${whenText(p.changed)}</span>`;
    actionHTML = `<a class="radar-buy-link" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">See It →</a>`;
  } else if (kind === 'soldout') {
    badgeHTML = `<span class="radar-badge radar-badge--soldout">Sold out ${whenText(p.changed)}</span>`;
    actionHTML = `<button type="button" class="radar-notify-link" data-notify aria-expanded="false">🔔 Notify me</button>
      <form class="radar-notify-form" data-stock="${escapeHtml(p.id || '')}" hidden novalidate>
        <label class="sr-only" for="rn-${escapeHtml(p.id || '')}">Your email</label>
        <input id="rn-${escapeHtml(p.id || '')}" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
        <span class="radar-hp" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></span>
        <button type="submit">Email me when it’s back</button>
        <p class="radar-notify-msg" role="status" aria-live="polite"></p>
      </form>`;
  } else {
    badgeHTML = `<span class="radar-badge radar-badge--fast">Sold out ${p.outageCount90d}x recently</span>`;
    actionHTML = `<a class="radar-buy-link" href="${escapeHtml(p.affiliateUrl)}" target="_blank" rel="nofollow sponsored noopener">Grab It →</a>`;
  }

  return `
    <article class="${cardClass}">
      <img class="radar-card-image" src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}" loading="lazy" referrerpolicy="no-referrer">
      <div class="radar-card-body">
        ${badgeHTML}
        <p class="radar-card-brand">${escapeHtml(p.brand || '')}</p>
        <p class="radar-card-name">${escapeHtml(p.name)}</p>
        <div class="radar-card-price">£${p.salePrice.toFixed(2)}</div>
        ${kind === 'back' && p.options > 1 ? `<p class="radar-card-note">${p.options} sizes or colours back</p>` : ''}
        ${actionHTML}
      </div>
    </article>
  `;
}

// "today", "yesterday" or "on 14 Oct" (dates are UK days from the pipeline).
function whenText(day) {
  if (!day) return '';
  const d = new Date(day + 'T12:00:00');
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const diff = Math.round((now - d) / 86400000);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'yesterday';
  return 'on ' + d.getDate() + ' ' + d.toLocaleString('en-GB', { month: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', loadStockRadar);
