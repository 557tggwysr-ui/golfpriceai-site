(function () {
  var CONSENT_KEY = 'golfpriceai_cookie_consent'; // 'accepted' | 'declined'

  function getConsent() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
  }

  function setConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (e) {}
    hideBanner();
    // Hook point: once you add Google Analytics / ad scripts, only load them
    // here when value === 'accepted'. Nothing is loaded by this file itself.
  }

  function pathToRoot() {
    // Works whether the page is at / or /legal/, so links always resolve.
    return location.pathname.indexOf('/legal/') !== -1 ? '../' : './';
  }

  function buildBanner() {
    var root = pathToRoot();
    var el = document.createElement('div');
    el.id = 'cookie-consent-banner';
    el.style.cssText = [
      'position:fixed', 'left:16px', 'right:16px', 'bottom:16px', 'z-index:9999',
      'max-width:640px', 'margin:0 auto', 'background:#16241c', 'color:#fff',
      'padding:16px 20px', 'border-radius:14px', 'box-shadow:0 8px 30px rgba(0,0,0,0.25)',
      'display:flex', 'flex-wrap:wrap', 'align-items:center', 'gap:12px',
      'font-family:Inter,-apple-system,sans-serif', 'font-size:14px', 'line-height:1.5'
    ].join(';');

    el.innerHTML =
      '<span style="flex:1;min-width:220px;">' +
        'We use cookies to keep the site running and understand what\'s useful. ' +
        '<a href="' + root + 'legal/cookies.html" style="color:#7fd66a;font-weight:600;">Learn more</a>' +
      '</span>' +
      '<span style="display:flex;gap:8px;">' +
        '<button id="cc-decline" style="background:transparent;color:#fff;border:1px solid #3a4a3e;border-radius:999px;padding:8px 16px;font-weight:600;cursor:pointer;">Decline</button>' +
        '<button id="cc-accept" style="background:#3fae29;color:#fff;border:none;border-radius:999px;padding:8px 16px;font-weight:600;cursor:pointer;">Accept</button>' +
      '</span>';

    document.body.appendChild(el);
    document.getElementById('cc-accept').onclick = function () { setConsent('accepted'); };
    document.getElementById('cc-decline').onclick = function () { setConsent('declined'); };
  }

  function hideBanner() {
    var el = document.getElementById('cookie-consent-banner');
    if (el) el.remove();
  }

  function showBanner() {
    if (document.getElementById('cookie-consent-banner')) return;
    buildBanner();
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!getConsent()) showBanner();
  });

  // Exposed so the "Manage cookie preferences" button on the Cookie Policy
  // page can reopen the banner at any time.
  window.golfPriceCookieConsent = {
    openSettings: showBanner,
    getConsent: getConsent
  };
})();
