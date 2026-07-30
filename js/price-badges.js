/*
  GolfPrice AI — Deal Score / Verified Discount badge
  ------------------------------------------------------
  STATUS: starter kit, not yet wired into the site.

  This reads the new `priceInsight` object that scripts/update_deals.py
  now writes onto every priced product (once price-history.json has a
  couple of real runs behind it — day one will show "new" for everything,
  which is expected and correct, not a bug).

  HOW TO INTEGRATE
  -----------------
  Wherever your existing product-card template builds its HTML (in
  js/shop.js and/or js/app.js), call:

      renderPriceBadge(product)

  and drop the returned HTML string into the card, near the price. This
  file doesn't touch any existing rendering — it's additive, designed to
  be dropped in once the real card markup is available to integrate
  against properly.
*/

function renderPriceBadge(product) {
  const insight = product.priceInsight;
  if (!insight || insight.status === "new") {
    return ""; // not enough tracked history yet — show nothing rather than guess
  }

  if (insight.status === "lowest_tracked" && insight.verifiedDiscount) {
    return `<span class="price-badge price-badge--low">Lowest price in ${insight.daysTracked} days</span>`;
  }
  if (insight.status === "lowest_tracked") {
    return `<span class="price-badge price-badge--low">Lowest tracked price</span>`;
  }
  if (insight.trend === "rising") {
    return `<span class="price-badge price-badge--rising">Price recently went up</span>`;
  }
  if (insight.status === "highest_tracked") {
    return `<span class="price-badge price-badge--high">Higher than usual right now</span>`;
  }
  return ""; // "typical" status — nothing noteworthy enough to badge
}

// Small helper for a product page / detail view, where there's room for a
// fuller sentence rather than a compact card badge.
function renderPriceInsightSentence(product) {
  const insight = product.priceInsight;
  if (!insight || insight.status === "new") {
    return "We've just started tracking this price — check back soon for a full history.";
  }
  const low = `£${insight.historicalLow.toFixed(2)}`;
  const high = `£${insight.historicalHigh.toFixed(2)}`;
  if (insight.status === "lowest_tracked") {
    return `This is the lowest price we've tracked over the last ${insight.daysTracked} days (range: ${low}–${high}).`;
  }
  if (insight.status === "highest_tracked") {
    return `This is higher than usual — we've seen it as low as ${low} over the last ${insight.daysTracked} days.`;
  }
  return `Typical price recently — we've tracked it between ${low} and ${high} over the last ${insight.daysTracked} days.`;
}
