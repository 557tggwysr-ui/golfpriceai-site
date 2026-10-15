document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '£' + n.toFixed(2);
}

function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

function thumbHTML(p) {
  if (p.image) return `<img src="${p.image}" alt="${p.name}" loading="lazy">`;
  const known = ['driver', 'putter', 'irons', 'wood', 'hybrid', 'wedge', 'ball', 'bag', 'apparel', 'shoes', 'accessories'];
  const iconFile = p.icon && known.includes(p.icon) ? p.icon : (known.includes(p.category) ? p.category : 'accessories');
  return `<img src="assets/icons/${iconFile}.svg" alt="${p.name}" loading="lazy">`;
}
function thumbClass(p) {
  return p.image ? '' : 'icon-thumb';
}

// Club categories offered in the picker — every real club type EXCEPT
// "sets", since a bundled set doesn't make sense alongside individually
// picked clubs in the same bag.
const CLUB_TABS = [
  { key: 'driver', label: 'Drivers', match: p => p.category === 'driver' },
  { key: 'wood', label: 'Fairway Woods', match: p => p.category === 'wood' },
  { key: 'hybrid', label: 'Hybrids', match: p => p.category === 'hybrid' },
  { key: 'irons', label: 'Irons', match: p => p.category === 'irons' },
  { key: 'wedge', label: 'Wedges', match: p => p.category === 'wedge' },
  { key: 'putter', label: 'Putters', match: p => p.category === 'putter' },
];

// Accessory categories offered in the picker — each maps to either a
// product "category" or a specific "icon" sub-type. Curated to the things
// someone would realistically add when building out a bag from scratch.
const ACCESSORY_TABS = [
  { key: 'ball', label: 'Balls', match: p => p.category === 'ball' },
  { key: 'glove', label: 'Gloves', match: p => p.icon === 'glove' },
  { key: 'tee', label: 'Tees', match: p => p.icon === 'tee' },
  { key: 'gps-watch', label: 'GPS Watches', match: p => p.icon === 'gps-watch' },
  { key: 'rangefinder', label: 'Rangefinders', match: p => p.icon === 'rangefinder' },
  { key: 'pushcart', label: 'Push Carts', match: p => p.icon === 'pushcart' },
  { key: 'headcover', label: 'Headcovers', match: p => p.icon === 'headcover' },
  { key: 'umbrella', label: 'Umbrellas', match: p => p.icon === 'umbrella' },
  { key: 'towel', label: 'Towels', match: p => p.icon === 'towel' },
  { key: 'grip', label: 'Grips', match: p => p.icon === 'grip' },
];

const STORAGE_KEY = 'golfpriceai-bag-builder';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { bagId: null, clubIds: [], accessoryIds: [] };
    const parsed = JSON.parse(raw);
    return {
      bagId: parsed.bagId || null,
      clubIds: Array.isArray(parsed.clubIds) ? parsed.clubIds : [],
      accessoryIds: Array.isArray(parsed.accessoryIds) ? parsed.accessoryIds : [],
    };
  } catch (e) {
    return { bagId: null, clubIds: [], accessoryIds: [] };
  }
}
function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    // localStorage can fail (private browsing, storage full) — the tool
    // still works fine for the current page view, it just won't persist
    // across a reload. Not worth surfacing an error for that.
  }
}

let ALL_PRODUCTS = [];
let state = loadState();
let activeClubTab = CLUB_TABS[0].key;
let activeAccessoryTab = ACCESSORY_TABS[0].key;
let searchValues = { bag: '', club: '', accessory: '' };

function findById(id) {
  return ALL_PRODUCTS.find(p => p.id === id);
}

// Shared renderer for all three picker sections (Bag / Clubs / Accessories).
// When there's no search text, shows a "Quick Picks" shortlist (top 8 by
// popularity). Typing a search searches the FULL matching pool for that
// section (up to 24 results), surfacing more of the site's real catalog
// than the quick-pick shortlist alone.
function renderPickerSection(opts) {
  const grid = document.getElementById(opts.gridId);
  const labelEl = document.getElementById(opts.labelId);
  if (!grid) return;
  const q = (opts.searchValue || '').trim().toLowerCase();

  let items;
  if (q) {
    items = opts.pool.filter(p => p.name.toLowerCase().includes(q))
      .sort((a, b) => popularityScore(b) - popularityScore(a))
      .slice(0, 24);
    if (labelEl) labelEl.style.display = 'none';
  } else {
    items = opts.pool.slice()
      .sort((a, b) => popularityScore(b) - popularityScore(a))
      .slice(0, 8);
    if (labelEl) labelEl.style.display = 'block';
  }

  if (!items.length) {
    grid.innerHTML = q
      ? `<p style="color:var(--muted);grid-column:1/-1;">No matches for "${opts.searchValue}" here — try another search.</p>`
      : `<p style="color:var(--muted);grid-column:1/-1;">Nothing available in this category right now — check back soon.</p>`;
    return;
  }

  grid.innerHTML = items.map(p => {
    const selected = opts.isSelected(p);
    const label = selected ? (opts.multiSelect ? '✓ Added' : '✓ Selected') : (opts.selectLabel || '+ Add to bag');
    return `
    <div class="pick-card ${selected ? 'selected' : ''}">
      <div class="thumb ${thumbClass(p)}">${thumbHTML(p)}</div>
      <div class="pick-body">
        <h4>${p.name}</h4>
        <div class="pick-price">${money(p.salePrice)}</div>
        <button type="button" data-id="${p.id}">${label}</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = findById(btn.getAttribute('data-id'));
      if (item) opts.onToggle(item);
    });
  });
}

function renderBagPicker() {
  const pool = ALL_PRODUCTS.filter(p => p.category === 'bag');
  renderPickerSection({
    gridId: 'bag-picker-grid',
    labelId: 'bag-quick-picks-label',
    pool,
    searchValue: searchValues.bag,
    isSelected: p => state.bagId === p.id,
    selectLabel: 'Select this bag',
    multiSelect: false,
    onToggle: p => {
      state.bagId = state.bagId === p.id ? null : p.id; // click again to deselect
      saveState(state);
      renderAll();
    },
  });
}

function renderClubTabs() {
  const tabsEl = document.getElementById('club-tabs');
  if (!tabsEl) return;
  tabsEl.innerHTML = CLUB_TABS.map(t => `
    <button type="button" class="accessory-tab ${activeClubTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>
  `).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeClubTab = btn.getAttribute('data-tab');
      searchValues.club = '';
      const searchInput = document.getElementById('club-search');
      if (searchInput) searchInput.value = '';
      renderClubTabs();
      renderClubGrid();
    });
  });
}

function renderClubGrid() {
  const tab = CLUB_TABS.find(t => t.key === activeClubTab);
  const pool = ALL_PRODUCTS.filter(tab.match);
  renderPickerSection({
    gridId: 'club-grid',
    labelId: 'club-quick-picks-label',
    pool,
    searchValue: searchValues.club,
    isSelected: p => state.clubIds.includes(p.id),
    multiSelect: true,
    onToggle: p => {
      if (state.clubIds.includes(p.id)) {
        state.clubIds = state.clubIds.filter(x => x !== p.id);
      } else {
        state.clubIds.push(p.id);
      }
      saveState(state);
      renderAll();
    },
  });
}

function renderAccessoryTabs() {
  const tabsEl = document.getElementById('accessory-tabs');
  tabsEl.innerHTML = ACCESSORY_TABS.map(t => `
    <button type="button" class="accessory-tab ${activeAccessoryTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>
  `).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeAccessoryTab = btn.getAttribute('data-tab');
      searchValues.accessory = '';
      const searchInput = document.getElementById('accessory-search');
      if (searchInput) searchInput.value = '';
      renderAccessoryTabs();
      renderAccessoryGrid();
    });
  });
}

function renderAccessoryGrid() {
  const tab = ACCESSORY_TABS.find(t => t.key === activeAccessoryTab);
  const pool = ALL_PRODUCTS.filter(tab.match);
  renderPickerSection({
    gridId: 'accessory-grid',
    labelId: 'accessory-quick-picks-label',
    pool,
    searchValue: searchValues.accessory,
    isSelected: p => state.accessoryIds.includes(p.id),
    multiSelect: true,
    onToggle: p => {
      if (state.accessoryIds.includes(p.id)) {
        state.accessoryIds = state.accessoryIds.filter(x => x !== p.id);
      } else {
        state.accessoryIds.push(p.id);
      }
      saveState(state);
      renderAll();
    },
  });
}

function currentListItems() {
  const items = [];
  if (state.bagId) {
    const bag = findById(state.bagId);
    if (bag) items.push(bag);
  }
  state.clubIds.forEach(id => {
    const p = findById(id);
    if (p) items.push(p);
  });
  state.accessoryIds.forEach(id => {
    const p = findById(id);
    if (p) items.push(p);
  });
  return items;
}

function removeFromList(id) {
  if (state.bagId === id) state.bagId = null;
  state.clubIds = state.clubIds.filter(x => x !== id);
  state.accessoryIds = state.accessoryIds.filter(x => x !== id);
  saveState(state);
  renderAll();
}

function tagFor(p) {
  if (p.category === 'bag') return 'Your bag';
  const clubCats = ['driver', 'wood', 'hybrid', 'irons', 'wedge', 'putter'];
  if (clubCats.includes(p.category)) return 'Club';
  return 'Accessory';
}

function renderShoppingList() {
  const items = currentListItems();
  const emptyEl = document.getElementById('shopping-list-empty');
  const listEl = document.getElementById('shopping-list');
  const totalEl = document.getElementById('shopping-list-total');
  const actionsEl = document.getElementById('shopping-list-actions');

  if (!items.length) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    totalEl.style.display = 'none';
    actionsEl.style.display = 'none';
    return;
  }

  emptyEl.style.display = 'none';
  totalEl.style.display = 'flex';
  actionsEl.style.display = 'flex';

  listEl.innerHTML = items.map(p => `
    <div class="shopping-list-item">
      <div class="sl-thumb ${thumbClass(p)}">${thumbHTML(p)}</div>
      <div class="sl-info">
        <h4>${p.name}</h4>
        <span class="sl-tag">${tagFor(p)}</span>
      </div>
      <div class="sl-price">${money(p.salePrice)}</div>
      <a class="sl-buy" href="${p.affiliateUrl}" target="_blank" rel="sponsored noopener">Buy →</a>
      <button type="button" class="sl-remove" data-remove="${p.id}" aria-label="Remove ${p.name}">✕</button>
    </div>`).join('');

  const total = items.reduce((sum, p) => sum + p.salePrice, 0);
  document.getElementById('shopping-list-total-amount').textContent = money(total);

  listEl.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => removeFromList(btn.getAttribute('data-remove')));
  });
}

// ============================================================
// "Your bag" card (rebuilt Oct 2026). An illustrated stand bag that
// draws what's been picked (a head per club, an iron set adds 7, kit
// hanging off the side) beside a tidy list where the names and prices
// live, so long names never get squashed into the drawing. Also counts
// clubs against golf's 14-club limit.
// ============================================================
const AB_INK = '#16241c', AB_STEEL = '#cfd5ce', AB_SHAFT = '#8e988f';

function abEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// How many of the 14 clubs a pick uses. An iron set is usually 7 (4-PW);
// a single iron (house rule: under £120, or under £450 from Callaway's
// own feed, or named as single/utility) counts as one.
function abIsIronSet(p) {
  if (p.category !== 'irons') return false;
  if (/\b(single|utility|driving iron|individual)\b/i.test(p.name || '')) return false;
  if (p.salePrice < 120) return false;
  if ((p.source || '').indexOf('callaway') !== -1 && p.source !== 'awin-callawaypreowned' && p.salePrice < 450) return false;
  return true;
}
function abSlots(p) { return abIsIronSet(p) ? 7 : 1; }
function abClubType(p) { return p.category === 'irons' ? 'irons' : p.category; }

// Only clubs added since the last draw drop in; the rest stay still.
let abSeenIds = null;
function abHeads(clubs) {
  // Putter and wedges on the left of the fan, woods on the right (the
  // bag leans left, so the tall headcovers stay inside the picture).
  const order = { putter: 0, wedge: 1, irons: 2, hybrid: 3, wood: 4, driver: 5 };
  const out = [];
  clubs.slice().sort((a, b) => (order[abClubType(a)] ?? 2) - (order[abClubType(b)] ?? 2)).forEach(c => {
    const fresh = abSeenIds !== null && !abSeenIds.has(c.id);
    for (let i = 0; i < abSlots(c); i++) out.push({ t: abClubType(c), fresh });
  });
  // Too many to draw: drop iron heads first, so woods and putter always show.
  while (out.length > 16) { const k = out.map(h => h.t).lastIndexOf('irons'); if (k === -1) break; out.splice(k, 1); }
  return out.slice(0, 16);
}

function abHeadSVG(type, x, y, ang) {
  let g;
  if (type === 'driver' || type === 'wood' || type === 'hybrid') {
    const w = type === 'driver' ? 26 : type === 'wood' ? 22 : 19, h = w * 1.25;
    const col = type === 'driver' ? AB_INK : type === 'wood' ? '#2f8a1f' : '#6b7a6e';
    g = `<rect x="${-w / 2}" y="${-h}" width="${w}" height="${h + 6}" rx="${w / 2}" fill="${col}" stroke="${AB_INK}" stroke-width="1.5"/>` +
      `<rect x="${-w / 2}" y="-7" width="${w}" height="5" fill="#fff" opacity=".9"/>` +
      `<circle cx="0" cy="${-h - 4}" r="5" fill="#fff" stroke="${AB_INK}" stroke-width="1.2"/>`;
  } else if (type === 'putter') {
    g = `<path d="M2 0 h-20 a10 10 0 0 1 -10 -10 v-1 a4 4 0 0 1 4 -4 h24 a2 2 0 0 1 2 2 z" fill="${AB_STEEL}" stroke="${AB_INK}" stroke-width="1.6"/>` +
      `<path d="M-20 -8 h14" stroke="#3fae29" stroke-width="2.4" stroke-linecap="round"/>`;
  } else {
    const w = type === 'wedge' ? 17 : 14, col = type === 'wedge' ? '#eef1ed' : AB_STEEL;
    g = `<path d="M2 0 L${-w} -3 Q${-w - 3} -4 ${-w - 2} -8 L${-w + 1} -14 Q${-w + 3} -16 ${-w + 6} -15 L2 -8 z" fill="${col}" stroke="${AB_INK}" stroke-width="1.5"/>`;
  }
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})">${g}</g>`;
}

function abClubsSVG(hs) {
  const n = hs.length;
  const LEN = { driver: 122, wood: 114, hybrid: 106, wedge: 84, putter: 98 };
  return hs.map((h, i) => {
    const t = h.t;
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const ang = f * Math.min(46, 14 + n * 2.4);
    const len = t === 'irons' ? 88 + (i % 2) * 8 : (LEN[t] || 92);
    const bx = 110 + f * 64, by = 118;
    const rad = ang * Math.PI / 180, tx = bx + Math.sin(rad) * len, ty = by - Math.cos(rad) * len;
    return `<g${h.fresh ? ' class="ab-club"' : ''}><line x1="${bx.toFixed(1)}" y1="${by + 6}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${AB_SHAFT}" stroke-width="2.4" stroke-linecap="round"/>${abHeadSVG(t, tx, ty, ang)}</g>`;
  }).join('');
}

function abKitType(p) {
  if (p.icon === 'umbrella') return 'umbrella';
  if (p.icon === 'towel') return 'towel';
  if (p.icon === 'rangefinder' || p.icon === 'gps-watch') return 'rangefinder';
  return 'other';
}
function abKitSVG(kit) {
  const types = {};
  kit.forEach(k => { types[abKitType(k)] = (types[abKitType(k)] || 0) + 1; });
  let out = '';
  if (types.umbrella) out += `<g><path d="M162 128 l7 -9 l7 9 v150 a7 7 0 0 1 -14 0 z" fill="#2b3a30" stroke="${AB_INK}" stroke-width="1.5"/><path d="M162 160 h14 M162 200 h14" stroke="#3fae29" stroke-width="3"/><path d="M169 284 v12 a6 6 0 0 1 -12 0" fill="none" stroke="${AB_INK}" stroke-width="3" stroke-linecap="round"/></g>`;
  if (types.towel) out += `<g><circle cx="58" cy="150" r="6" fill="none" stroke="${AB_INK}" stroke-width="3"/><path d="M44 156 h28 l4 58 h-36 z" fill="#fff" stroke="${AB_INK}" stroke-width="1.8"/><path d="M42 202 h33" stroke="#3fae29" stroke-width="4"/><path d="M42 214 v5 M48 214 v5 M54 214 v5 M60 214 v5 M66 214 v5 M72 214 v5" stroke="${AB_INK}" stroke-width="1.2"/></g>`;
  if (types.rangefinder) out += `<g><rect x="96" y="244" width="40" height="30" rx="7" fill="${AB_INK}"/><circle cx="106" cy="259" r="7" fill="${AB_STEEL}"/><rect x="118" y="252" width="12" height="5" rx="2.5" fill="#3fae29"/></g>`;
  const extra = kit.length - (types.umbrella ? 1 : 0) - (types.towel ? 1 : 0) - (types.rangefinder ? 1 : 0);
  if (extra > 0) out += `<g><path d="M146 150 v12" stroke="${AB_INK}" stroke-width="2"/><rect x="132" y="162" width="28" height="34" rx="5" fill="#fff8e6" stroke="${AB_INK}" stroke-width="1.8"/><circle cx="146" cy="170" r="2.5" fill="${AB_INK}"/><text x="146" y="189" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" font-weight="700" fill="${AB_INK}">+${extra}</text></g>`;
  return out;
}

function abBagSVG(bag, clubs, kit) {
  const hs = abHeads(clubs);
  if (!bag) {
    return `<svg viewBox="-20 -46 260 406" role="img" aria-label="An empty bag outline">` +
      `<path d="M62 128 Q62 116 76 114 H144 Q158 116 158 128 L154 312 Q154 334 132 334 H88 Q66 334 66 312 Z" fill="none" stroke="#9aa39b" stroke-width="3" stroke-dasharray="8 7"/>` +
      `<ellipse cx="110" cy="122" rx="48" ry="9" fill="none" stroke="#9aa39b" stroke-width="3" stroke-dasharray="8 7"/>` +
      (hs.length ? `<g transform="rotate(-5 110 340)">${abClubsSVG(hs)}</g>` : '') +
      `<text x="110" y="226" text-anchor="middle" font-family="Inter,sans-serif" font-size="15" font-weight="700" fill="#5b665f">Pick a bag</text>` +
      `<text x="110" y="246" text-anchor="middle" font-family="Inter,sans-serif" font-size="12" fill="#5b665f">and watch it fill up</text></svg>`;
  }
  const label = `Your bag with ${hs.length} club${hs.length === 1 ? '' : 's'} and ${kit.length} accessor${kit.length === 1 ? 'y' : 'ies'}`;
  return `<svg viewBox="-20 -46 260 406" role="img" aria-label="${label}">` +
    `<g transform="rotate(-5 110 340)">` +
      `<path d="M84 250 L44 350 M136 250 L176 350" stroke="#5d6b61" stroke-width="5" stroke-linecap="round"/>` +
      abClubsSVG(hs) +
      `<path d="M62 128 Q62 116 76 114 H144 Q158 116 158 128 L154 312 Q154 334 132 334 H88 Q66 334 66 312 Z" fill="#2f8a1f" stroke="${AB_INK}" stroke-width="4"/>` +
      `<ellipse cx="110" cy="122" rx="48" ry="9" fill="${AB_INK}"/>` +
      `<path d="M66 150 H154" stroke="${AB_INK}" stroke-width="2.5"/>` +
      `<rect x="78" y="168" width="64" height="58" rx="12" fill="#26762a" stroke="${AB_INK}" stroke-width="2.5"/>` +
      `<path d="M86 184 h48" stroke="${AB_INK}" stroke-width="2" stroke-dasharray="4 4"/>` +
      `<rect x="84" y="284" width="52" height="30" rx="9" fill="#26762a" stroke="${AB_INK}" stroke-width="2.5"/>` +
      `<path d="M156 150 C196 176 196 262 154 294" fill="none" stroke="${AB_INK}" stroke-width="8" stroke-linecap="round"/>` +
      `<rect x="70" y="316" width="80" height="12" rx="6" fill="${AB_INK}"/>` +
      abKitSVG(kit) +
    `</g></svg>`;
}

const AB_CLUB_LABEL = { driver: 'Driver', wood: 'Fairway wood', hybrid: 'Hybrid', wedge: 'Wedge', putter: 'Putter' };
function abRow(p, sub) {
  const img = p.image
    ? `<img src="${abEsc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
    : '';
  return `<li class="ab-row"><span class="ab-thumb" aria-hidden="true">${img}</span>` +
    `<span class="ab-txt"><span class="ab-name">${abEsc(p.name)}</span>${sub ? `<span class="ab-sub">${abEsc(sub)}</span>` : ''}</span>` +
    `<span class="ab-price">${money(p.salePrice)}</span></li>`;
}

function renderBagGraphic() {
  const el = document.getElementById('arsenal-bag');
  if (!el) return;
  const bag = state.bagId ? findById(state.bagId) : null;
  const clubs = state.clubIds.map(findById).filter(Boolean);
  const kit = state.accessoryIds.map(findById).filter(Boolean);
  const used = clubs.reduce((s, c) => s + abSlots(c), 0);
  const total = (bag ? bag.salePrice : 0) + clubs.concat(kit).reduce((s, x) => s + x.salePrice, 0);
  let bar = '';
  for (let i = 0; i < 14; i++) bar += `<i class="${i < Math.min(used, 14) ? (used > 14 ? 'over' : 'on') : ''}"></i>`;
  const clubSub = c => abIsIronSet(c) ? 'Iron set, about 7 clubs' : (c.category === 'irons' ? 'Single iron' : AB_CLUB_LABEL[c.category] || '');
  const svg = abBagSVG(bag, clubs, kit);
  abSeenIds = new Set(clubs.map(c => c.id));
  el.innerHTML =
    `<div class="ab-stage">${svg}<div class="ab-ground"></div></div>` +
    `<div class="ab-side">` +
      `<div class="ab-head"><h2>Your bag</h2><span class="ab-total"><small>Total</small>${money(total)}</span></div>` +
      `<div class="ab-meter"><span>Clubs</span><span class="ab-bar" role="img" aria-label="${used} of 14 clubs">${bar}</span>` +
        `<span><b>${used}</b> of 14${used > 14 ? ' · over the limit' : ''}</span></div>` +
      `<div class="ab-groups">` +
        `<div class="ab-group wide"><h3>Bag</h3>${bag ? `<ul class="ab-list">${abRow(bag)}</ul>` : '<p class="ab-empty">No bag yet. Pick one in step 1.</p>'}</div>` +
        `<div class="ab-group"><h3>Clubs</h3>${clubs.length ? `<ul class="ab-list">${clubs.map(c => abRow(c, clubSub(c))).join('')}</ul>` : '<p class="ab-empty">No clubs yet. Add them in step 2.</p>'}</div>` +
        `<div class="ab-group"><h3>Accessories</h3>${kit.length ? `<ul class="ab-list">${kit.map(k => abRow(k)).join('')}</ul>` : '<p class="ab-empty">Nothing yet. Add them in step 3.</p>'}</div>` +
      `</div>` +
      `<div class="ab-foot"><a href="#shopping-list-section">See your shopping list ↓</a><span>Each item buys from its own retailer.</span></div>` +
    `</div>`;
}

function renderAll() {
  renderBagPicker();
  renderClubGrid();
  renderAccessoryGrid();
  renderShoppingList();
  renderBagGraphic();
}

// Assemble Your Arsenal needs live, arbitrary text search across every
// category — that can't be precomputed ahead of time the way the
// homepage/Receipts/Back In Stock/Best Time To Buy curated lists can.
// It still gets a real size win though: data/products-lite.json is the
// same full breadth of products as data/products.json, minus the
// priceInsight/stockInsight fields this page never uses (confirmed —
// neither field is referenced anywhere else in this file), which alone
// cuts the download by roughly 39% on the real catalog.
fetch('data/products-lite.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;
    renderClubTabs();
    renderAccessoryTabs();
    renderAll();
  })
  .catch(err => console.error('Could not load products-lite.json', err));

// Search inputs — debounce-free since this is client-side filtering over
// an already-loaded array, not a network request.
const bagSearchInput = document.getElementById('bag-search');
if (bagSearchInput) {
  bagSearchInput.addEventListener('input', e => {
    searchValues.bag = e.target.value;
    renderBagPicker();
  });
}
const clubSearchInput = document.getElementById('club-search');
if (clubSearchInput) {
  clubSearchInput.addEventListener('input', e => {
    searchValues.club = e.target.value;
    renderClubGrid();
  });
}
const accessorySearchInput = document.getElementById('accessory-search');
if (accessorySearchInput) {
  accessorySearchInput.addEventListener('input', e => {
    searchValues.accessory = e.target.value;
    renderAccessoryGrid();
  });
}

const clearBtn = document.getElementById('clear-list-btn');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    state = { bagId: null, clubIds: [], accessoryIds: [] };
    saveState(state);
    renderAll();
  });
}

const emailBtn = document.getElementById('email-list-btn');
if (emailBtn) {
  emailBtn.addEventListener('click', () => {
    const items = currentListItems();
    if (!items.length) return;
    const total = items.reduce((sum, p) => sum + p.salePrice, 0);
    const lines = items.map(p => `${p.name} — ${money(p.salePrice)}\n${p.affiliateUrl}`);
    const body = [
      "Here's the bag I put together on GolfPrice AI:",
      '',
      ...lines,
      '',
      `Total: ${money(total)}`,
      '',
      'Built at https://golfpriceai.com/build-your-bag.html',
    ].join('\n');
    const subject = 'My GolfPrice AI Bag';
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}
