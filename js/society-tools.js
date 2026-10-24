/* GolfPrice AI: small tools inside the golf society guides.
   - Golf society day cost calculator (#dc)
   - Copy / send buttons for templates ([data-copy], [data-share])
   Everything stays in the browser. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function money(n) { return '£' + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }
  function num(el, max) { var v = parseFloat(String(el.value).replace(/[£,\s]/g, '')); return isFinite(v) ? Math.min(max, Math.max(0, v)) : 0; }
  function share(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  var out = $('dc-out');
  if (out) {
    out.innerHTML = '<div id="dc-res"></div><div class="soc-btns"><button type="button" class="soc-btn" id="dc-share">Send to the WhatsApp group</button></div>';
    var res = $('dc-res'), text = '';
    $('dc-share').onclick = function () { if (window.gtag) window.gtag('event', 'day_cost_shared'); share(text); };
    var calc = function () {
      var n = Math.round(num($('dc-n'), 400)), g = num($('dc-g'), 500), f = num($('dc-f'), 300), en = num($('dc-e'), 200);
      var each = g + f + en; if ($('dc-r').checked) each = Math.ceil(each);
      var spare = each - (g + f + en);
      text = 'Society day: ' + money(each) + ' each (green fee ' + money(g) + ', food ' + money(f) + ', society entry ' + money(en) + '). Pay the organiser before final numbers go to the club. Worked out free at golfpriceai.com/societies';
      res.innerHTML = '<b>Your golf society day</b><div class="hq-fund-g"><span>Charge each player</span><b>' + money(each) + '</b>' +
        '<span>' + n + ' players pay in</span><b>' + money(each * n) + '</b>' +
        '<span>To the golf club (green fees and food)</span><b>' + money((g + f) * n) + '</b>' +
        '<span>Society entry: prizes and trophies</span><b>' + money(en * n) + '</b>' +
        (spare > 0 ? '<span>From rounding up (kitty)</span><b>' + money(spare * n) + '</b>' : '') + '</div>' +
        '<p class="soc-small">Most golf societies put 30–40% of the society entry into prizes on the day: about ' + money(Math.round(en * n * 0.35)) + ' here. <a href="/societies/prize-fund-calculator/">Split the prize fund</a>.</p>';
    };
    ['dc-n', 'dc-g', 'dc-f', 'dc-e', 'dc-r'].forEach(function (id) { $(id).addEventListener('input', calc); $(id).addEventListener('change', calc); });
    calc();
  }
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = $(b.getAttribute('data-copy')).textContent, label = b.textContent;
      function done() { b.textContent = 'Copied'; setTimeout(function () { b.textContent = label; }, 2000); }
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(done, function () {});
      else { var r = document.createRange(); r.selectNodeContents($(b.getAttribute('data-copy'))); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
      if (window.gtag) window.gtag('event', 'template_copied');
    });
  });
  document.querySelectorAll('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () { share($(b.getAttribute('data-share')).textContent); });
  });
})();
