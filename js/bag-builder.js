document.getElementById('year').textContent = new Date().getFullYear();

function money(n) {
  return '£' + n.toFixed(2);
}

function popularityScore(p) {
  return (p.retailerCount || 1) * 10 + (p.savePct || 0) * 2;
}

function thumbHTML(p, size) {
  if (p.image) return `<img src="${p.image}" alt="${p.name}" loading="lazy">`;
  const known = ['driver', 'putter', 'irons', 'wood', 'hybrid', 'wedge', 'ball', 'bag', 'apparel', 'shoes', 'accessories'];
  const iconFile = p.icon && known.includes(p.icon) ? p.icon : (known.includes(p.category) ? p.category : 'accessories');
  return `<img src="assets/icons/${iconFile}.svg" alt="${p.name}" loading="lazy">`;
}
function thumbClass(p) {
  return p.image ? '' : 'icon-thumb';
}

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
    if (!raw) return { bagId: null, accessoryIds: [] };
    const parsed = JSON.parse(raw);
    return {
      bagId: parsed.bagId || null,
      accessoryIds: Array.isArray(parsed.accessoryIds) ? parsed.accessoryIds : [],
    };
  } catch (e) {
    return { bagId: null, accessoryIds: [] };
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
let activeTab = ACCESSORY_TABS[0].key;

function findById(id) {
  return ALL_PRODUCTS.find(p => p.id === id);
}

function renderBagPicker() {
  const grid = document.getElementById('bag-picker-grid');
  const bags = ALL_PRODUCTS
    .filter(p => p.category === 'bag')
    .sort((a, b) => popularityScore(b) - popularityScore(a))
    .slice(0, 8);

  grid.innerHTML = bags.map(p => `
    <div class="pick-card ${state.bagId === p.id ? 'selected' : ''}" data-bag-id="${p.id}">
      <div class="thumb ${thumbClass(p)}">${thumbHTML(p)}</div>
      <div class="pick-body">
        <h4>${p.name}</h4>
        <div class="pick-price">${money(p.salePrice)}</div>
        <button type="button" data-select-bag="${p.id}">${state.bagId === p.id ? '✓ Selected' : 'Select this bag'}</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-select-bag]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-select-bag');
      state.bagId = state.bagId === id ? null : id; // click again to deselect
      saveState(state);
      renderAll();
    });
  });
}

function renderAccessoryTabs() {
  const tabsEl = document.getElementById('accessory-tabs');
  tabsEl.innerHTML = ACCESSORY_TABS.map(t => `
    <button type="button" class="accessory-tab ${activeTab === t.key ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>
  `).join('');
  tabsEl.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      renderAccessoryTabs();
      renderAccessoryGrid();
    });
  });
}

function renderAccessoryGrid() {
  const grid = document.getElementById('accessory-grid');
  const tab = ACCESSORY_TABS.find(t => t.key === activeTab);
  const items = ALL_PRODUCTS
    .filter(tab.match)
    .sort((a, b) => popularityScore(b) - popularityScore(a))
    .slice(0, 8);

  if (!items.length) {
    grid.innerHTML = `<p style="color:var(--muted);grid-column:1/-1;">Nothing available in this category right now — check back soon.</p>`;
    return;
  }

  grid.innerHTML = items.map(p => {
    const added = state.accessoryIds.includes(p.id);
    return `
    <div class="pick-card ${added ? 'selected' : ''}">
      <div class="thumb ${thumbClass(p)}">${thumbHTML(p)}</div>
      <div class="pick-body">
        <h4>${p.name}</h4>
        <div class="pick-price">${money(p.salePrice)}</div>
        <button type="button" data-toggle-accessory="${p.id}">${added ? '✓ Added' : '+ Add to bag'}</button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-toggle-accessory]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-accessory');
      if (state.accessoryIds.includes(id)) {
        state.accessoryIds = state.accessoryIds.filter(x => x !== id);
      } else {
        state.accessoryIds.push(id);
      }
      saveState(state);
      renderAll();
    });
  });
}

function currentListItems() {
  const items = [];
  if (state.bagId) {
    const bag = findById(state.bagId);
    if (bag) items.push(bag);
  }
  state.accessoryIds.forEach(id => {
    const p = findById(id);
    if (p) items.push(p);
  });
  return items;
}

function removeFromList(id) {
  if (state.bagId === id) state.bagId = null;
  state.accessoryIds = state.accessoryIds.filter(x => x !== id);
  saveState(state);
  renderAll();
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
        <span class="sl-tag">${p.category === 'bag' ? 'Your bag' : 'Accessory'}</span>
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
    tray.innerHTML = `<p class="tray-empty-msg">Empty so far — pick a bag and a few accessories below.</p>`;
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
  renderAccessoryGrid();
  renderShoppingList();
  renderBagGraphic();
}

fetch('data/products.json')
  .then(r => r.json())
  .then(data => {
    ALL_PRODUCTS = data.products;
    renderAccessoryTabs();
    renderAll();
  })
  .catch(err => console.error('Could not load products.json', err));

const clearBtn = document.getElementById('clear-list-btn');
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    state = { bagId: null, accessoryIds: [] };
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
