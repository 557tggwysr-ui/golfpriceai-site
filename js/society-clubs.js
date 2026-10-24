/* GolfPrice AI: the free society card for golf clubs (/societies/clubs/).
   Draws the club's name onto the back of the card in the browser; nothing is
   sent anywhere. */
(function () {
  'use strict';
  var cv = document.getElementById('cl-cv'), name = document.getElementById('cl-name');
  if (!cv) return;
  var g = cv.getContext('2d'), base = new Image(), ready = false;
  base.onload = function () { ready = true; draw(); };
  base.src = '/assets/societies/society-card-back.png';
  function wrap(text, max) {
    var words = text.split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) { var t = cur ? cur + ' ' + w : w; if (g.measureText(t).width <= max || !cur) cur = t; else { lines.push(cur); cur = w; } });
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  }
  function draw() {
    if (!ready) return;
    g.drawImage(base, 0, 0, 1240, 1748);
    var club = (name.value || '').trim();
    if (!club) return;
    g.fillStyle = '#ffffff'; g.fillRect(100, 350, 1040, 195);
    var size = 76; g.font = '700 ' + size + 'px Poppins, sans-serif';
    var lines = wrap(club, 1000);
    while (lines.length > 1 && g.measureText(lines.join(' ')).width > 2000 && size > 52) { size -= 4; g.font = '700 ' + size + 'px Poppins, sans-serif'; lines = wrap(club, 1000); }
    g.fillStyle = '#2f8a1f'; g.textBaseline = 'top';
    lines.forEach(function (l, i) { g.fillText(l, 120, 356 + i * (size + 16)); });
  }
  var fonts = document.fonts ? document.fonts.load('700 76px Poppins') : Promise.resolve();
  fonts.then(draw, draw);
  name.addEventListener('input', draw);
  document.getElementById('cl-back').addEventListener('click', function () {
    draw();
    var club = (name.value || '').trim(), file = 'society-card-back' + (club ? '-' + club.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '') + '.png';
    if (window.gtag) window.gtag('event', 'club_card_download');
    cv.toBlob(function (b) {
      if (!b) return;
      var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = file; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }, 'image/png');
  });
  var copy = document.getElementById('cl-copy');
  if (copy) copy.addEventListener('click', function () {
    var t = document.getElementById('cl-line').textContent, label = copy.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { copy.textContent = 'Copied'; setTimeout(function () { copy.textContent = label; }, 2000); }, function () {});
  });
})();
