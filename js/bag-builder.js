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

function renderBagGraphic() {
  const tray = document.getElementById('bag-tray');
  if (!tray) return;
  const items = currentListItems();

  if (!items.length) {
    tray.innerHTML = `<p class="tray-empty-msg">Empty so far — pick a bag, some clubs, and a few accessories below.</p>`;
    return;
  }

  // 3 slots per row, wraps to as many rows as needed for whatever's picked.
  const rows = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));

  tray.innerHTML = rows.map(row => `
    <div class="tray-row">
      ${row.map(p => `
        <div class="tray-slot">
          <div class="name">${p.name}</div>
          <div class="price">${money(p.salePrice)}</div>
        </div>`).join('')}
    </div>`).join('');
}

function renderAll() {
  renderBagPicker();
  renderClubGrid();
  renderAccessoryGrid();
  renderShoppingList();
  renderBagGraphic();
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;
    renderClubTabs();
    renderAccessoryTabs();
    renderAll();
  })
  .catch(err => console.error('Could not load products.json', err));

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
