// Google Analytics 4 + Microsoft Clarity — both only load after the visitor
// accepts cookies. Neither fires on its own; golfPriceLoadAnalytics() is
// called by cookie-consent.js at the moment consent is accepted (or
// immediately on page load if consent was already accepted previously).
window.golfPriceLoadAnalytics = function () {
  if (window.golfPriceAnalyticsLoaded) return; // never load twice
  window.golfPriceAnalyticsLoaded = true;

  // Google Analytics 4
  var gaScript = document.createElement('script');
  gaScript.async = true;
  gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-7ZQDX25S1W';
  document.head.appendChild(gaScript);

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-7ZQDX25S1W');

  // Microsoft Clarity
  (function (c, l, a, r, i, t, y) {
    c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, 'clarity', 'script', 'xotu4uuj46');
};
