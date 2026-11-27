(function () {
  var CONSENT_KEY = 'golfpriceai_cookie_consent'; // 'accepted' | 'declined'

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
    hideBanner();
    if (value === 'accepted' && window.golfPriceLoadAnalytics) {
      window.golfPriceLoadAnalytics();
    }
  }

  function pathToRoot() {
    // Always the site root. The old relative version ('./' or '../')
    // broke on price pages (/prices/<model>/), where "Learn more" pointed
    // at /prices/<model>/legal/cookies.html, a page that doesn't exist
    // (Google Search Console flagged it as a 404, Oct 2026).
    return '/';
  }

  // Slimmer banner (27 Nov 2026): one compact bar instead of a tall card, so it no longer
  // covers the buy button on phones. Still clearly visible, says plainly what the cookies
  // are for, links the policy, and Reject is exactly as big and easy as Accept (ICO/PECR).
  // The page gets bottom padding while it shows, so nothing is ever hidden behind it.
  var BTN = 'flex:0 0 auto;min-width:72px;min-height:36px;border-radius:999px;padding:7px 14px;' +
            'font:600 13px/1.2 Inter,-apple-system,sans-serif;cursor:pointer;';

  function buildBanner() {
    var root = pathToRoot();
    var el = document.createElement('div');
    el.id = 'cookie-consent-banner';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Cookie choice');
    el.style.cssText = [
      'position:fixed', 'left:10px', 'right:10px', 'bottom:10px', 'z-index:9999',
      'max-width:720px', 'margin:0 auto', 'background:#16241c', 'color:#fff',
      'padding:10px 12px 10px 16px', 'border-radius:12px', 'border:1px solid #3fae29',
      'box-shadow:0 6px 24px rgba(0,0,0,0.28)',
      'display:flex', 'align-items:center', 'gap:10px',
      'font-family:Inter,-apple-system,sans-serif', 'font-size:13px', 'line-height:1.35'
    ].join(';');

    el.innerHTML =
      '<span style="flex:1;min-width:0;">' +
        '🍪 Optional cookies help us see what\'s useful. Your choice. ' +
        '<a href="' + root + 'legal/cookies.html" style="color:#7fd66a;font-weight:600;white-space:nowrap;">Cookie policy</a>' +
      '</span>' +
      '<button id="cc-decline" style="' + BTN + 'background:#fff;color:#16241c;border:2px solid #fff;">Reject</button>' +
      '<button id="cc-accept" style="' + BTN + 'background:#3fae29;color:#fff;border:2px solid #3fae29;">Accept</button>';

    document.body.appendChild(el);
    document.getElementById('cc-accept').onclick = function () { setConsent('accepted'); };
    document.getElementById('cc-decline').onclick = function () { setConsent('declined'); };
    makeRoom(el);
  }

  var oldPad = null;
  function makeRoom(el) {
    // keep the bottom of the page (buy buttons, footer links) scrollable above the bar
    oldPad = document.body.style.paddingBottom;
    document.body.style.paddingBottom = (el.offsetHeight + 20) + 'px';
  }

  function hideBanner() {
    var el = document.getElementById('cookie-consent-banner');
    if (el) el.remove();
    if (oldPad !== null) { document.body.style.paddingBottom = oldPad; oldPad = null; }
  }

  function showBanner() {
    if (document.getElementById('cookie-consent-banner')) return;
    buildBanner();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var consent = getConsent();
    if (!consent) {
      showBanner();
    } else if (consent === 'accepted' && window.golfPriceLoadAnalytics) {
      window.golfPriceLoadAnalytics();
    }
  });

  // Exposed so the "Manage cookie preferences" button on the Cookie Policy
  // page can reopen the banner at any time.
  window.golfPriceCookieConsent = {
    openSettings: showBanner,
    getConsent: getConsent
  };
})();
