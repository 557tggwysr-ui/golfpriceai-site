/*
  GolfPrice AI — "Find Your Fit" page logic
  --------------------------------------------------
  A deliberately simple, general-fitting-chart-style mapping from swing
  speed + handicap to a suggested flex and loft range. Stored to
  localStorage (same pattern as Assemble Your Arsenal's bag persistence)
  and passed to shop.html as query params, which shop.js reads to badge
  matching clubs using the real loft/flex fields
  scripts/update_deals.py now extracts from product names.
*/

document.getElementById('year').textContent = new Date().getFullYear();

const STORAGE_KEY = 'golfpriceai-fit-profile';

const FLEX_MAP_STANDARD = {
  slow: 'Senior', moderate: 'Regular', fast: 'Stiff', 'very-fast': 'X-Stiff', unsure: 'Regular',
};
const FLEX_MAP_LADIES = {
  slow: 'Ladies', moderate: 'Ladies', fast: 'Regular', 'very-fast': 'Stiff', unsure: 'Ladies',
};

const LOFT_RANGE_MAP = {
  low: { label: '9°–10.5°', min: 9, max: 10.5 },
  mid: { label: '10.5°–12°', min: 10.5, max: 12 },
  high: { label: '12°–14°', min: 12, max: 14 },
  new: { label: '13°–16°', min: 13, max: 16 },
};

const form = document.getElementById('fit-quiz');
const resultEl = document.getElementById('fit-result');
const resultFlexEl = document.getElementById('result-flex');
const resultLoftEl = document.getElementById('result-loft');
const ctaEl = document.getElementById('see-matching-clubs');

form.addEventListener('submit', (e) => {
  e.preventDefault();

  const swingSpeed = document.getElementById('swing-speed').value;
  const handicapBracket = document.getElementById('handicap-bracket').value;
  const useLadies = document.getElementById('use-ladies-flex').checked;

  const flexMap = useLadies ? FLEX_MAP_LADIES : FLEX_MAP_STANDARD;
  const flex = flexMap[swingSpeed] || 'Regular';
  const loftRange = LOFT_RANGE_MAP[handicapBracket] || LOFT_RANGE_MAP.mid;

  const profile = {
    swingSpeed, handicapBracket, useLadies,
    flex, loftLabel: loftRange.label, loftMin: loftRange.min, loftMax: loftRange.max,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch (err) {
    // Private browsing / storage disabled — the result still displays
    // and the Shop link still works via query params, it just won't be
    // remembered on a future visit.
  }

  resultFlexEl.textContent = flex;
  resultLoftEl.textContent = loftRange.label;
  ctaEl.href = `shop.html?group=clubs&fitFlex=${encodeURIComponent(flex)}&fitLoftMin=${loftRange.min}&fitLoftMax=${loftRange.max}`;
  resultEl.hidden = false;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
