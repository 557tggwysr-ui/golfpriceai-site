document.getElementById('year').textContent = new Date().getFullYear();

function slug(s) {
  return encodeURIComponent(s);
}

function groupLink(category, group) {
  const types = group.types.join(',');
  return `shop.html?category=${category}&types=${slug(types)}&label=${slug(group.label)}`;
}

// Render the current hub page's own grid of group cards
const hubKey = document.currentScript.getAttribute('data-hub');
if (hubKey && window.GOLFPRICE_GROUPS) {
  const groups = GOLFPRICE_GROUPS[hubKey] || [];
  const grid = document.getElementById('hub-grid');
  if (grid) {
    grid.innerHTML = groups.map(g => `
      <a class="hub-card" href="${groupLink(hubKey, g)}">
        <div class="hub-thumb"><img src="${g.image}" alt="${g.label}" loading="lazy"></div>
        <div class="hub-body">
          <h3>${g.label}</h3>
          <p>${g.blurb}</p>
          <span class="hub-link">Shop ${g.label} →</span>
        </div>
      </a>`).join('');
  }
}

// Populate the Apparel / Accessories nav dropdowns on every page that has them
if (window.GOLFPRICE_GROUPS) {
  const apparelDropdown = document.getElementById('apparel-dropdown');
  if (apparelDropdown) {
    apparelDropdown.innerHTML = GOLFPRICE_GROUPS.apparel.map(g =>
      `<a href="${groupLink('apparel', g)}">${g.label}</a>`
    ).join('');
  }
  const accessoriesDropdown = document.getElementById('accessories-dropdown');
  if (accessoriesDropdown) {
    accessoriesDropdown.innerHTML = GOLFPRICE_GROUPS.accessories.map(g =>
      `<a href="${groupLink('accessories', g)}">${g.label}</a>`
    ).join('');
  }
}
