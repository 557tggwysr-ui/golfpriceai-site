document.getElementById('year').textContent = new Date().getFullYear();

function slug(s) {
  return encodeURIComponent(s);
}

function groupLink(category, group) {
  // A group can override its own top-level category (e.g. "Golf Balls"
  // living in the Accessories dropdown but really belonging to the real
  // "ball" product category, or every club-type tile on clubs.html
  // needing its own real category rather than the literal string
  // "clubs") — group.category is that override when present. Previously
  // this always used the hub's own key regardless, which silently sent
  // Golf Balls to category=accessories (zero real matches) and every
  // tile on clubs.html to the non-existent category=clubs.
  const realCategory = group.category || category;
  const params = new URLSearchParams();
  params.set('category', realCategory);
  if (group.types && group.types.length) params.set('types', group.types.join(','));
  params.set('label', group.label);
  return `shop.html?${params.toString()}`;
}

// Render the current hub page's own grid of group cards.
// Every card gets the SAME overlay treatment (title + subtitle + icon
// badge + "View Deals" rendered live on top of the photo) — built in
// CSS/HTML, not baked into any image file. That matters: baked-in image
// text is exactly what caused several mismatched-label bugs earlier this
// build (a relabeled card silently keeping its old baked text). This way
// relabeling a card is just an edit to groups-config.js, never a new image.
//
// Hub tiles NEVER fall back to an icon in place of a photo — a group only
// renders if it has a real "image". The small emoji badge below is a
// decorative accent sitting ON TOP of a real photo (matching the site's
// existing dark-banner emoji pattern), not a substitute for one.
const hubKey = document.currentScript.getAttribute('data-hub');
if (hubKey && window.GOLFPRICE_GROUPS) {
  const groups = GOLFPRICE_GROUPS[hubKey] || [];
  const grid = document.getElementById('hub-grid');
  if (grid) {
    grid.innerHTML = groups.filter(g => g.image).map(g => `
      <a class="hub-card" href="${groupLink(hubKey, g)}">
        <div class="hub-thumb">
          <img src="${g.image}" alt="${g.label}" loading="lazy">
          <div class="hub-thumb-overlay">
            <div class="hub-thumb-text">
              <h4>${g.label.toUpperCase()}</h4>
            </div>
            <span class="hub-thumb-cta"><span class="hub-thumb-badge">${g.emoji || '⛳'}</span> VIEW DEALS</span>
          </div>
        </div>
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
    ).join('')
      // Complete The Look lives here now rather than as its own top-level
      // nav item — same pattern as Find Your Fit living inside the Clubs
      // dropdown rather than getting its own ribbon slot. It's still
      // fully discoverable via the homepage banner too.
      + `<a href="complete-the-look.html">👔 Complete The Look</a>`;
  }
  const accessoriesDropdown = document.getElementById('accessories-dropdown');
  if (accessoriesDropdown) {
    accessoriesDropdown.innerHTML = GOLFPRICE_GROUPS.accessories.map(g =>
      `<a href="${groupLink('accessories', g)}">${g.label}</a>`
    ).join('');
  }
}
