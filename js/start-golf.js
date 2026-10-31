/* Start golf for £X: the kit-level toggle and the shopping list. */
(function () {
  'use strict';
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tier]'));
  var tier = 'easy';
  tabs.forEach(function (b) {
    b.addEventListener('click', function () {
      tier = b.getAttribute('data-tier');
      tabs.forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      document.querySelectorAll('[data-panel]').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tier; });
    });
  });
  var btn = document.getElementById('sg-list-btn'), msg = document.getElementById('sg-msg');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var panel = document.querySelector('[data-panel="' + tier + '"]');
    var lines = Array.prototype.map.call(panel.querySelectorAll('.sg-list li'), function (li) {
      var a = li.querySelector('a'), what = li.querySelector('span b').textContent, price = li.querySelector('.sg-price').textContent;
      return '- ' + what + ': ' + (a ? a.textContent : '') + ', ' + price + (a ? ' ' + a.href : '');
    });
    var text = 'My first golf kit, at today’s lowest UK prices (GolfPrice AI):\n' + lines.join('\n') + '\nTotal: ' + panel.querySelector('.sg-sum').textContent;
    if (navigator.share) { navigator.share({ text: text }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { msg.textContent = 'Copied. Paste it wherever you like.'; }).catch(function () {});
  });
})();
