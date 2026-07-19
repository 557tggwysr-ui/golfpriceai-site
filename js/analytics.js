// Google Analytics 4 — only loads after the visitor accepts cookies.
// Never fires on its own; golfPriceLoadAnalytics() is called by
// cookie-consent.js at the moment consent is accepted (or immediately on
// page load if consent was already accepted on a previous visit).
window.golfPriceLoadAnalytics = function () {
  if (window.golfPriceAnalyticsLoaded) return; // never load twice
  window.golfPriceAnalyticsLoaded = true;

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-7ZQDX25S1W';
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-7ZQDX25S1W');
};
