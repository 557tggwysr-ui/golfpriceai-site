/* GolfPrice AI: the champion's card (1080 x 1350), shared by the Bag Draft page
   and the Locker Room. A league champion's name engraved on a picture of that
   month's themed bag: bragging rights only, no bags in the post.
   window.gpChampion.share(card, button) shows the picture first; sharing or
   saving it is the viewer's choice. */
(function () {
  'use strict';
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function pts(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + (Math.abs(n) === 1 ? ' pt' : ' pts'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function fit(g, s, w) { s = String(s); while (g.measureText(s).width > w && s.length > 3) s = s.slice(0, -2) + '…'; return s; }
  function share(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function shareChampion(c, btn) {
    var text = c.nick + ' is the ' + c.major.name + ' champion in ' + c.league + ' (' + pts(c.pts) + '). Name engraved on the bag, bragging rights for a month. Think you can beat them? https://golfpriceai.com/play/draft/?utm_source=champion';
    track('bag_draft_champion_card', { you: c.you ? 1 : 0 });
    if (btn) btn.disabled = true;
    drawChampion(c).then(function (file) {
      if (btn) btn.disabled = false;
      preview(file, text, btn);
    }, function () { if (btn) btn.disabled = false; share(text); });
  }
  // Show the card first; sharing or saving it is the viewer's choice.
  function preview(file, text, back) {
    var url = URL.createObjectURL(file), canFiles = navigator.canShare && navigator.canShare({ files: [file] });
    var m = document.createElement('div');
    m.className = 'bd-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Champion’s card');
    m.innerHTML = '<div class="bd-modal-box"><img src="' + url + '" alt="The champion’s card" width="1080" height="1350">' +
      '<div class="bd-modal-btns">' + (canFiles || navigator.share ? '<button type="button" class="gp-af-btn bd-m-share">Share</button>' : '') +
      '<a class="gp-af-btn" href="' + url + '" download="' + file.name + '">Save picture</a>' +
      '<button type="button" class="bd-modal-close">Close</button></div>' +
      '<p>On a phone you can also press and hold the picture to save it.</p></div>';
    function close() { document.removeEventListener('keydown', esc1); m.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 500); if (back) back.focus(); }
    function esc1(e) { if (e.key === 'Escape') close(); }
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    m.querySelector('.bd-modal-close').addEventListener('click', close);
    var sh = m.querySelector('.bd-m-share');
    if (sh) sh.addEventListener('click', function () {
      track('bag_draft_champion_share');
      if (canFiles) navigator.share({ files: [file], text: text }).catch(function () {}); else share(text);
    });
    m.querySelector('a[download]').addEventListener('click', function () { track('bag_draft_champion_save'); });
    document.addEventListener('keydown', esc1);
    document.body.appendChild(m);
    m.querySelector('.bd-modal-close').focus();
  }
  function drawChampion(c) {
    var fonts = document.fonts ? Promise.all(['800 96px Poppins', '700 28px Poppins', '800 20px Inter', '500 20px Inter'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : null;
    var bag = new Promise(function (ok, no) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = no; im.src = c.major.art; });
    return Promise.all([bag, fonts]).then(function (r) {
      var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var g = cv.getContext('2d'), gold = '#d9b45a', soft = '#c9cdca';
      var hi = dark(c.major.accent) ? '#f08a24' : c.major.accent;
      var when = c.season === 'test' ? 'Practice round' : new Date(c.season + '-15').toLocaleString('en-GB', { month: 'long', year: 'numeric' });
      var short = c.season === 'test' ? 'Practice' : new Date(c.season + '-15').toLocaleString('en-GB', { month: 'short', year: 'numeric' });
      function sp(px) { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; }
      function txt(t, x, y, font, col, align, max) { g.font = font; g.fillStyle = col; g.textAlign = align || 'left'; g.fillText(max ? fit(g, t, max) : t, x, y); }
      g.fillStyle = '#141515'; g.fillRect(0, 0, W, H);
      sp(2); txt(('The Bag Draft · ' + when).toUpperCase(), 64, 92, '800 20px Inter, sans-serif', hi); sp(0);
      g.font = '700 28px Poppins, sans-serif'; g.textAlign = 'left';
      var wA = g.measureText('Golf').width, wB = g.measureText('Price').width, wC = g.measureText(' AI').width, x0 = W - 64 - wA - wB - wC;
      txt('Golf', x0, 92, g.font, '#ffffff'); txt('Price', x0 + wA, 92, g.font, '#3fae29'); txt(' AI', x0 + wA + wB, 92, g.font, '#ffffff');
      sp(8); txt('LEAGUE CHAMPION', W / 2, 206, '800 24px Inter, sans-serif', gold, 'center'); sp(0);
      txt(c.nick, W / 2, 304, size(g, c.nick, 800, 96, 56, 'Poppins', 950), '#ffffff', 'center', 950);
      var win = 'Winner of ' + c.major.name + ' in ' + c.league;
      txt(win, W / 2, 362, size(g, win, 500, 28, 20, 'Inter', 950), soft, 'center', 950);
      g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.ellipse(W / 2, 1000, 190, 22, 0, 0, Math.PI * 2); g.fill();
      g.drawImage(r[0], 345, 392, 390, 610);
      g.strokeStyle = gold; g.lineWidth = 4; g.beginPath(); g.moveTo(636, 790); g.quadraticCurveTo(670, 800, 702, 770); g.stroke();
      g.save(); g.translate(700, 820); g.rotate(7 * Math.PI / 180);
      var tagFont = size(g, c.nick, 800, 30, 18, 'Poppins', 290);
      g.font = tagFont; var nick = fit(g, c.nick, 290), tw = Math.max(170, g.measureText(nick).width) + 40;
      g.fillStyle = '#0b0c0c'; rr(g, -20, -56, tw, 108, 14); g.fill();
      g.fillStyle = gold; rr(g, -20, -64, tw, 108, 14); g.fill(); g.lineWidth = 3; g.strokeStyle = '#0b0c0c'; g.stroke();
      sp(2); txt('ENGRAVED', 0, -34, '800 13px Inter, sans-serif', '#141515'); sp(0);
      txt(nick, 0, 2, tagFont, '#141515');
      txt(short + ' · ' + pts(c.pts), 0, 30, '700 16px Inter, sans-serif', '#141515', 'left', tw - 40);
      g.restore();
      var stats = [[String(c.pts).replace('-', '−'), 'points'], [ord(1) + ' of ' + c.of, 'in the league'],
        c.best ? [c.best.label, c.best.drop > 0 ? 'best pick, down £' + c.best.drop : 'best pick, ' + pts(c.best.pts)] : ['Glory', 'all of it']];
      stats.forEach(function (st, i) {
        var bx = 64 + i * (W - 128 + 16) / 3, bw = (W - 128 - 32) / 3;
        g.fillStyle = '#232525'; rr(g, bx, 1086, bw, 116, 18); g.fill();
        txt(st[0], bx + 20, 1144, '800 40px Poppins, sans-serif', hi, 'left', bw - 40);
        txt(st[1], bx + 20, 1180, '500 18px Inter, sans-serif', soft, 'left', bw - 40);
      });
      txt(c.last ? c.last + ' finished last and has been asked to say a few words.' : 'Glory only. Bragging rights: maximum.', 64, 1270, '500 19px Inter, sans-serif', soft, 'left', 680);
      txt('golfpriceai.com/play', W - 64, 1270, '700 19px Inter, sans-serif', '#ffffff', 'right');
      return new Promise(function (ok, no) { cv.toBlob(function (b) { b ? ok(new File([b], 'champions-card.png', { type: 'image/png' })) : no(); }, 'image/png'); });
    });
  }
  // Largest font size (down to min) at which the text fits the width.
  function size(g, t, weight, max, min, fam, w) {
    for (var px = max; px > min; px -= 2) { g.font = weight + ' ' + px + 'px ' + fam + ', sans-serif'; if (g.measureText(t).width <= w) break; }
    return weight + ' ' + px + 'px ' + fam + ', sans-serif';
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function dark(hex) { var n = parseInt(String(hex || '').slice(1), 16); if (isNaN(n)) return true; return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) < 90; }
  window.gpChampion = { share: shareChampion, draw: drawChampion };
})();
