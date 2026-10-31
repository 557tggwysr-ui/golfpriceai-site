/* Milestone cards: shareable 1080x1350 cards for the moments worth bragging
   about. First Price Handicap, Scratch Club, Bandit of the Month, Bag Draft
   champion and Par Price streaks of 30, 60, 90 and 120 days.

   Everything happens in this browser: the card is drawn on a canvas here and
   the list of milestones is kept in localStorage (gpMilestones). Only the
   golfer's own nickname ever appears on a card. Nothing is sent anywhere.

   Pages call:  gpMilestones.award(id, kind, data)   shows the unlock panel once
                gpMilestones.shelf(element)          the list in My Clubhouse   */
(function () {
  'use strict';
  if (window.gpMilestones) return;

  var KEY = 'gpMilestones';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var C = { ink: '#14211a', green: '#3fae29', bright: '#5fd14a', soft: '#8fd97c', grey: '#c4d0c8', dim: '#a9b8af', orange: '#f08a24', night: '#1b1d1c', paper: '#f6f6f3' };

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab: fine */ } }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function nick() { return String(get('gpNick', '') || '').slice(0, 24) || 'A GolfPrice AI golfer'; }
  function longDate(iso) { var d = new Date(iso + 'T12:00:00'); return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }
  function hcp(v) { return v < 0 ? '+' + Math.abs(v).toFixed(1) : Number(v).toFixed(1); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function gpUse(k) { try { var d = today(), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch('https://golfpriceai-alerts.golfpriceai.workers.dev/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }

  var STREAK = {
    30: { title: 'days in a row.', line: 'A month of guessing real UK golf prices every single morning. More dedicated than most to the range.', next: 'Next stop: 60' },
    60: { title: 'Two months straight.', line: 'Sixty mornings, sixty rounds. The coffee goes cold. The streak doesn’t.', next: 'Next stop: 90' },
    90: { title: 'A full season.', line: 'Three months without missing a morning. Most golfers can’t say that about the range.', next: 'Next stop: 120' },
    120: { title: 'Ever-present.', line: 'Four months. Every single morning. Par Price royalty.', next: 'Ever-present' }
  };

  // What each milestone is called, and the words that go with sharing it.
  function ord(n) { n = Number(n); var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function meta(m) {
    var d = m.d || {};
    switch (m.kind) {
      case 'first_hcp': return { label: 'First Price Handicap', sub: 'PH ' + hcp(d.v), text: 'I’ve got a Price Handicap: ' + hcp(d.v) + '. Fancy beating it?', url: 'https://golfpriceai.com/play/par-price/' };
      case 'scratch': return { label: 'Scratch Club', sub: 'PH ' + hcp(d.v), text: 'Scratch Club. Price Handicap ' + hcp(d.v) + '. I know the price of everything.', url: 'https://golfpriceai.com/play/par-price/' };
      case 'bandit': return { label: 'Bandit of the Month', sub: 'Cut ' + Number(d.cut).toFixed(1) + ' · ' + (d.month || ''), text: 'Bandit of the Month in ' + (d.league || 'our league') + '. Cut my Price Handicap by ' + Number(d.cut).toFixed(1) + '. No questions, please.', url: 'https://golfpriceai.com/play/par-price/' };
      case 'champion': return { label: 'Bag Draft champion', sub: (d.major || 'The Bag Draft') + ' · ' + d.pts + ' pts', text: 'Champion of ' + (d.major || 'The Bag Draft') + ' in ' + (d.league || 'our league') + '. Loser buys the first round.', url: 'https://golfpriceai.com/play/draft/' };
      case 'ace': return { label: 'Hole-in-one', sub: 'the ' + ord(d.hole) + ' at ' + d.course, text: 'Hole-in-one! The ' + ord(d.hole) + ' at ' + d.course + ', ' + d.yards + ' yards with a ' + d.club + '. On the Ace Register for good.', url: 'https://golfpriceai.com/play/aces/' + (d.cid ? '?c=' + d.cid : '') };
      case 'streak': return { label: d.n + '-day Par Price streak', sub: STREAK[d.n] ? STREAK[d.n].title : '', text: d.n + ' days in a row on Par Price. Beat that.', url: 'https://golfpriceai.com/play/par-price/' };
    }
    return { label: 'Milestone', sub: '', text: 'A GolfPrice AI milestone.', url: 'https://golfpriceai.com/play/' };
  }

  /* ------------------------------------------------------------ drawing */
  function fonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    return Promise.all(['800 100px Poppins', '700 40px Poppins', '700 30px Inter', '400 30px Inter', 'italic 600 40px "Cormorant Garamond"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }))
      .then(function () {}, function () {});
  }
  function rr(x, cx, cy, w, h, r) {
    x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r);
    x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath();
  }
  function text(x, s, px, y, font, color, align) { x.font = font; x.fillStyle = color; x.textAlign = align || 'left'; x.textBaseline = 'alphabetic'; x.fillText(s, px, y); }
  function wrap(x, s, px, y, maxW, lh, font, color) {
    x.font = font; var words = String(s).split(' '), line = '', lines = 0;
    words.forEach(function (w) {
      var t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > maxW && line) { text(x, line, px, y + lines * lh, font, color); line = w; lines++; } else line = t;
    });
    if (line) text(x, line, px, y + lines * lh, font, color);
    return y + (lines + 1) * lh;
  }
  function logo(x, px, y, dark, mid) {
    x.font = '800 40px Poppins, sans-serif'; x.textAlign = 'left';
    var a = 'Golf', b = 'Price', c = ' AI';
    x.fillStyle = dark; x.fillText(a, px, y); var w = x.measureText(a).width;
    x.fillStyle = mid; x.fillText(b, px + w, y); w += x.measureText(b).width;
    x.fillStyle = dark; x.fillText(c, px + w, y);
  }
  function pill(x, s, right, y, bg, fg) {
    x.font = '700 28px Inter, sans-serif'; var w = x.measureText(s).width + 56;
    x.fillStyle = bg; rr(x, right - w, y - 52, w, 72, 20); x.fill();
    text(x, s, right - w + 28, y - 6, '700 28px Inter, sans-serif', fg);
  }
  function grid(x, n, cols, top, size, gap, color, lastColor) {
    var w = (952 - 64 * 2 - gap * (cols - 1)) / cols;
    for (var i = 0; i < n; i++) {
      var col = i % cols, row = Math.floor(i / cols);
      x.fillStyle = i === n - 1 && lastColor ? lastColor : color;
      rr(x, 120 + col * (w + gap), top + row * (size + gap), w, size, Math.min(10, size / 4)); x.fill();
    }
    return top + Math.ceil(n / cols) * (size + gap);
  }

  // Each style: background, frame, colours. All cards share the frame at 56px.

  // The hole-in-one certificate: cream paper, a double green border, a flag seal.
  function drawAce(m) {
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d'), d = m.d || {}, me = nick(), G = '#1f6a12', grey = '#4a554e', serif = "'Cormorant Garamond', Georgia, serif";
    x.fillStyle = C.ink; x.fillRect(0, 0, 1080, 1350);
    x.fillStyle = '#f7f3e8'; rr(x, 48, 48, 984, 1254, 28); x.fill();
    x.strokeStyle = G; x.lineWidth = 3; rr(x, 76, 76, 928, 1198, 18); x.stroke();
    x.lineWidth = 1; rr(x, 87, 87, 906, 1176, 12); x.stroke();
    logo(x, 150, 172, C.ink, C.green);
    text(x, d.no ? 'ACE REGISTER No. ' + String(d.no).padStart(4, '0') : 'ACE REGISTER', 930, 166, '700 20px Inter, sans-serif', G, 'right');
    // the seal
    x.strokeStyle = G; x.lineWidth = 3; x.beginPath(); x.arc(540, 290, 56, 0, Math.PI * 2); x.stroke();
    x.lineWidth = 1.5; x.beginPath(); x.arc(540, 290, 48, 0, Math.PI * 2); x.stroke();
    x.fillStyle = G; x.beginPath(); x.ellipse(540, 314, 18, 6, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = C.ink; x.lineWidth = 3; x.beginPath(); x.moveTo(540, 314); x.lineTo(540, 260); x.stroke();
    x.fillStyle = C.orange; x.beginPath(); x.moveTo(540, 260); x.lineTo(566, 269); x.lineTo(540, 278); x.closePath(); x.fill();
    text(x, 'This is to certify that', 540, 410, 'italic 600 40px ' + serif, grey, 'center');
    var nf = me.length > 14 ? '800 60px Poppins, sans-serif' : '800 76px Poppins, sans-serif';
    text(x, me, 540, 490, nf, C.ink, 'center');
    text(x, 'holed out in one at', 540, 552, 'italic 600 40px ' + serif, grey, 'center');
    text(x, 'The ' + ord(d.hole), 540, 690, '800 132px Poppins, sans-serif', G, 'center');
    var cf = 34; x.font = '700 ' + cf + 'px Poppins, sans-serif';
    while (x.measureText(d.course || '').width > 820 && cf > 22) { cf -= 2; x.font = '700 ' + cf + 'px Poppins, sans-serif'; }
    text(x, d.course || '', 540, 752, '700 ' + cf + 'px Poppins, sans-serif', C.ink, 'center');
    text(x, d.yards + ' yards · par ' + (d.par || 3) + (d.town ? ' · ' + d.town : ''), 540, 796, '500 26px Inter, sans-serif', grey, 'center');
    x.fillStyle = '#c9c2ab'; x.fillRect(150, 846, 780, 1); x.fillRect(150, 960, 780, 1);
    var cols = [['DATE', longDate(d.date || m.date)], ['CLUB', d.club || ''], ['BALL', d.ball || '–']];
    cols.forEach(function (c, i) {
      var cx = 150 + 130 + i * 260;
      text(x, c[0], cx, 890, '700 16px Inter, sans-serif', '#5b665f', 'center');
      var f = 26; x.font = '700 ' + f + 'px Poppins, sans-serif';
      while (x.measureText(c[1]).width > 240 && f > 16) { f -= 2; x.font = '700 ' + f + 'px Poppins, sans-serif'; }
      text(x, c[1], cx, 930, '700 ' + f + 'px Poppins, sans-serif', C.ink, 'center');
    });
    if (d.witnesses) {
      var wf = 34; x.font = 'italic 600 ' + wf + 'px ' + serif;
      var wt = 'Witnessed by ' + d.witnesses;
      while (x.measureText(wt).width > 800 && wf > 22) { wf -= 2; x.font = 'italic 600 ' + wf + 'px ' + serif; }
      text(x, wt, 540, 1020, 'italic 600 ' + wf + 'px ' + serif, grey, 'center');
    }
    if (d.onBoard) text(x, 'The ' + ord(d.onBoard) + ' ace on this course’s board', 150, 1196, '500 20px Inter, sans-serif', '#5b665f');
    if (d.inYear) text(x, 'and the ' + ord(d.inYear) + ' in the UK in ' + String(d.date || m.date).slice(0, 4), 150, 1224, '500 20px Inter, sans-serif', '#5b665f');
    pill(x, 'golfpriceai.com/play/aces', 930, 1236, G, '#fff');
    return cv;
  }

  function draw(m) {
    if (m.kind === 'ace') return drawAce(m);
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d'), d = m.d || {}, me = nick();
    var L = 120, R = 960, light = (m.kind === 'scratch' || (m.kind === 'streak' && d.n === 90)), green = m.kind === 'streak' && d.n === 30;
    var orange = m.kind === 'bandit' || (m.kind === 'streak' && d.n === 120);
    var bg = light ? C.paper : green ? C.green : orange ? C.night : C.ink;
    var fg = light || green ? C.ink : '#fff';
    var sub = light ? '#4a554e' : green ? C.ink : C.grey;
    var accent = orange ? C.orange : light ? '#2f8a1f' : green ? '#fff' : C.bright;
    x.fillStyle = bg; x.fillRect(0, 0, 1080, 1350);
    if (orange) { var g = x.createRadialGradient(900, 200, 0, 900, 200, 520); g.addColorStop(0, 'rgba(240,138,36,.24)'); g.addColorStop(1, 'rgba(240,138,36,0)'); x.fillStyle = g; x.fillRect(0, 0, 1080, 1350); }
    if (light) { x.fillStyle = '#fff'; rr(x, 56, 56, 968, 1238, 36); x.fill(); }
    x.lineWidth = light ? 3 : 2; x.strokeStyle = light ? C.ink : orange ? 'rgba(240,138,36,.6)' : green ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.14)';
    rr(x, 56, 56, 968, 1238, 36); x.stroke();
    logo(x, L, 172, green ? C.ink : fg, green ? '#fff' : light ? C.green : C.bright);
    var tag = { first_hcp: 'MILESTONE', scratch: 'MEMBERS ONLY', bandit: 'LEAGUE AWARD', champion: 'THE BAG DRAFT', streak: 'PAR PRICE STREAK' }[m.kind];
    text(x, tag, R, 166, '700 22px Inter, sans-serif', orange || m.kind === 'champion' ? C.orange : green ? C.ink : light ? '#2f8a1f' : C.soft, 'right');
    var foot = { first_hcp: longDate(m.date), scratch: 'Joined ' + longDate(m.date), bandit: d.month || '', champion: 'Loser buys the first round', streak: STREAK[d.n] ? STREAK[d.n].next : '' }[m.kind];
    var cta = m.kind === 'champion' ? 'golfpriceai.com/play/draft' : 'golfpriceai.com/play';
    var y;

    if (m.kind === 'first_hcp' || m.kind === 'scratch') {
      if (m.kind === 'first_hcp') text(x, 'OFFICIALLY HANDICAPPED', L, 330, '700 30px Inter, sans-serif', C.soft);
      else { x.fillStyle = C.ink; rr(x, L, 286, 300, 60, 30); x.fill(); text(x, 'SCRATCH CLUB', L + 150, 327, '700 26px Inter, sans-serif', '#fff', 'center'); }
      var h1 = m.kind === 'first_hcp' ? ['First Price', 'Handicap'] : ['Knows the price', 'of everything.'];
      text(x, h1[0], L, 440, '800 92px Poppins, sans-serif', fg); text(x, h1[1], L, 536, '800 92px Poppins, sans-serif', fg);
      text(x, 'PH', L, 770, '700 44px Poppins, sans-serif', light ? '#5b665f' : C.grey);
      text(x, hcp(d.v), L + 90, 790, '800 250px Poppins, sans-serif', m.kind === 'scratch' ? '#2f8a1f' : '#fff');
      wrap(x, m.kind === 'first_hcp' ? 'Five rounds of Par Price, and the verdict is in. A proper eye for a golf bargain.' : 'A Price Handicap of scratch or better. Better than par at guessing golf prices.', L, 880, 820, 48, '400 34px Inter, sans-serif', sub);
    } else if (m.kind === 'bandit') {
      x.save(); x.translate(L + 10, 330); x.rotate(-0.087);
      x.lineWidth = 12; x.strokeStyle = C.orange; rr(x, 0, 0, 470, 140, 30); x.stroke();
      text(x, 'BANDIT', 235, 106, '800 100px Poppins, sans-serif', C.orange, 'center'); x.restore();
      text(x, 'of the Month.', L, 600, '800 78px Poppins, sans-serif', '#fff');
      text(x, 'Questions are being asked.', L, 680, '800 58px Poppins, sans-serif', C.orange);
      text(x, 'Cut', L, 880, '700 40px Poppins, sans-serif', C.grey);
      text(x, Number(d.cut).toFixed(1), L + 90, 900, '800 200px Poppins, sans-serif', '#fff');
      wrap(x, 'The biggest Price Handicap cut in ' + (d.league || 'the league') + ': ' + hcp(d.from) + ' down to ' + hcp(d.to) + '.', L, 990, 820, 46, '400 32px Inter, sans-serif', C.grey);
    } else if (m.kind === 'champion') {
      text(x, 'CHAMPION', L, 330, '700 30px Inter, sans-serif', C.orange);
      y = wrap(x, d.major || 'The Bag Draft', L, 430, 840, 104, '800 100px Poppins, sans-serif', '#fff');
      text(x, (d.league || ''), L, y + 10, '600 32px Inter, sans-serif', C.grey);
      if (d.best) {
        x.fillStyle = 'rgba(255,255,255,.08)'; rr(x, L, y + 60, 840, 110, 18); x.fill();
        text(x, 'Best pick: ' + d.best.label, L + 30, y + 128, '600 32px Inter, sans-serif', C.grey);
        text(x, '−£' + d.best.drop, L + 810, y + 128, '700 36px Poppins, sans-serif', C.soft, 'right');
      }
      text(x, String(d.pts), L, 1030, '800 200px Poppins, sans-serif', C.orange);
      x.font = '800 200px Poppins, sans-serif'; var pw = x.measureText(String(d.pts)).width;
      text(x, 'points', L + pw + 24, 1030, '700 40px Poppins, sans-serif', C.grey);
    } else if (m.kind === 'streak') {
      var s = STREAK[d.n] || STREAK[30];
      text(x, d.n === 30 ? 'STREAK' : '', L, 330, '700 30px Inter, sans-serif', C.ink);
      text(x, String(d.n), L - 10, 600, '800 320px Poppins, sans-serif', accent);
      text(x, s.title, L, 710, (s.title.length > 16 ? '800 72px' : '800 84px') + ' Poppins, sans-serif', fg);
      var cols = d.n <= 30 ? 10 : d.n <= 60 ? 12 : 15, size = d.n <= 30 ? 44 : d.n <= 60 ? 38 : d.n <= 90 ? 32 : 26;
      y = grid(x, d.n, cols, 760, size, d.n <= 60 ? 9 : 7, d.n === 30 ? C.ink : d.n === 60 ? C.bright : d.n === 90 ? C.green : C.orange, d.n === 30 ? '#fff' : null);
      wrap(x, s.line, L, y + 46, 840, 46, '400 32px Inter, sans-serif', sub);
    }

    x.fillStyle = light ? C.ink : green ? 'rgba(20,33,26,.25)' : 'rgba(255,255,255,.14)'; x.fillRect(L, 1120, R - L, light ? 3 : 2);
    text(x, me, L, 1192, '700 44px Poppins, sans-serif', fg);
    text(x, foot, L, 1238, '400 28px Inter, sans-serif', light ? '#5b665f' : green ? C.ink : C.dim);
    pill(x, cta, R, 1230, orange ? C.orange : light || green ? C.ink : C.green, orange ? C.night : '#fff');
    return cv;
  }

  /* ------------------------------------------------------------ sharing */
  function share(m, btn) {
    var info = meta(m);
    gpUse('ms_share');
    fonts().then(function () {
      var cv = draw(m);
      cv.toBlob(function (blob) {
        if (!blob) return;
        var name = 'golfpriceai-' + m.kind + '.png';
        var file = window.File ? new File([blob], name, { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: info.text + ' ' + info.url }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          if (btn) { var t = btn.textContent; btn.textContent = 'Saved. Add it to the group chat'; setTimeout(function () { btn.textContent = t; }, 2500); }
        }
      }, 'image/png');
    });
  }
  function save(m, btn) {
    fonts().then(function () {
      draw(m).toBlob(function (blob) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'golfpriceai-' + m.kind + '.png';
        document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        if (btn) { var t = btn.textContent; btn.textContent = 'Saved'; setTimeout(function () { btn.textContent = t; }, 2000); }
      }, 'image/png');
    });
  }

  /* ------------------------------------------------------------ the unlock panel */
  var styled = false;
  function css() {
    if (styled) return; styled = true;
    var s = document.createElement('style');
    s.textContent =
      '.ms-back{position:fixed;inset:0;background:rgba(10,20,14,.55);z-index:100000;display:flex;align-items:flex-end;justify-content:center}' +
      '.ms-sheet{background:#fff;width:100%;max-width:460px;border-radius:24px 24px 0 0;padding:14px 20px calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:12px;align-items:center;box-sizing:border-box;max-height:94vh;overflow-y:auto;color:#14211a;font-family:Inter,sans-serif}' +
      '@media (min-width:700px){.ms-back{align-items:center}.ms-sheet{border-radius:24px}}' +
      '.ms-grip{width:40px;height:5px;border-radius:99px;background:#d5d9d1}' +
      '.ms-kick{font-size:12px;font-weight:700;letter-spacing:.14em;color:#2f8a1f}' +
      '.ms-title{font:800 24px/1.2 Poppins,sans-serif;text-align:center;margin:0}' +
      '.ms-img{width:220px;max-width:60vw;aspect-ratio:1080/1350;border-radius:14px;box-shadow:0 14px 30px rgba(20,33,26,.3);background:#14211a}' +
      '.ms-note{font-size:14px;line-height:1.5;color:#4a554e;text-align:center;margin:0;max-width:340px}' +
      '.ms-go{width:100%;background:#3fae29;color:#fff;border:0;font:700 16px Inter,sans-serif;padding:15px;border-radius:12px;cursor:pointer}' +
      '.ms-go:hover{background:#2f8a1f}' +
      '.ms-row{display:flex;gap:10px;width:100%}' +
      '.ms-row button{flex:1;background:#fff;border:1px solid #d5d9d1;border-radius:12px;padding:13px;font:600 15px Inter,sans-serif;color:#14211a;cursor:pointer}' +
      '.ms-shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}' +
      '.ms-item{background:#fff;border:1px solid #e4e6e0;border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:8px;font:600 14px Inter,sans-serif;color:#14211a;cursor:pointer;text-align:left}' +
      '.ms-item:hover{border-color:#3fae29}' +
      '.ms-item img{width:100%;aspect-ratio:1080/1350;border-radius:10px;display:block;background:#14211a}' +
      '.ms-item small{font-weight:400;color:#5b665f;font-size:12.5px}' +
      '.ms-empty{font-size:14px;color:#4a554e;line-height:1.5;margin:0}';
    document.head.appendChild(s);
  }
  function open(m, fresh) {
    css();
    var info = meta(m);
    var back = document.createElement('div'); back.className = 'ms-back';
    back.innerHTML = '<section class="ms-sheet" role="dialog" aria-modal="true" aria-label="' + esc(info.label) + '">' +
      '<span class="ms-grip" aria-hidden="true"></span><span class="ms-kick">' + (m.kind === 'ace' ? 'ON THE RECORD' : fresh ? 'MILESTONE UNLOCKED' : 'YOUR MILESTONE') + '</span>' +
      '<h2 class="ms-title">' + esc(info.label) + (info.sub ? ': ' + esc(info.sub) : '') + '</h2>' +
      '<img class="ms-img" alt="' + esc(info.label) + ' card">' +
      '<p class="ms-note">' + (fresh ? 'Saved to your Milestones in My Clubhouse. ' : '') + (m.kind === 'ace' ? 'Who saw it is only on your copy. The board shows your nickname.' : 'Your nickname is the only name on it.') + '</p>' +
      '<button type="button" class="ms-go" data-ms="share">Share to the group chat</button>' +
      '<div class="ms-row"><button type="button" data-ms="save">Save image</button><button type="button" data-ms="close">' + (fresh ? 'Not now' : 'Close') + '</button></div></section>';
    document.body.appendChild(back);
    fonts().then(function () { var img = back.querySelector('img'); if (img) img.src = draw(m).toDataURL('image/png'); });
    function close() { back.remove(); document.removeEventListener('keydown', key); }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    back.addEventListener('click', function (e) {
      if (e.target === back) return close();
      var b = e.target.closest('[data-ms]'); if (!b) return;
      var a = b.getAttribute('data-ms');
      if (a === 'share') share(m, b); else if (a === 'save') save(m, b); else close();
    });
    setTimeout(function () { var g = back.querySelector('.ms-go'); if (g) g.focus(); }, 30);
  }

  /* ------------------------------------------------------------ public */
  function list() { return get(KEY, []); }
  function award(id, kind, data) {
    try {
      var all = list();
      if (all.some(function (m) { return m.id === id; })) return false;
      var m = { id: id, kind: kind, date: today(), d: data || {} };
      all.unshift(m); put(KEY, all.slice(0, 60));
      gpUse('ms_' + kind);
      // Never on top of another panel: wait for the page to settle.
      setTimeout(function () { if (!document.querySelector('.ms-back')) open(m, true); }, 900);
      return true;
    } catch (e) { return false; }
  }
  function shelf(el) {
    if (!el) return;
    css();
    var all = list();
    if (!all.length) {
      el.innerHTML = '<p class="ms-empty">No milestones yet. Your first one: play 5 rounds of <a href="/play/par-price/">Par Price</a> to get a Price Handicap. Streaks of 30, 60, 90 and 120 days, Scratch Club, Bandit of the Month and Bag Draft champion cards are all up for grabs.</p>';
      return;
    }
    el.innerHTML = '<div class="ms-shelf">' + all.map(function (m, i) {
      var info = meta(m);
      return '<button type="button" class="ms-item" data-i="' + i + '"><img alt=""><span>' + esc(info.label) + '</span><small>' + longDate(m.date) + '</small></button>';
    }).join('') + '</div>';
    fonts().then(function () {
      el.querySelectorAll('.ms-item').forEach(function (b) { b.querySelector('img').src = draw(all[+b.getAttribute('data-i')]).toDataURL('image/jpeg', 0.7); });
    });
    el.querySelectorAll('.ms-item').forEach(function (b) { b.addEventListener('click', function () { open(all[+b.getAttribute('data-i')], false); }); });
  }
  // Price Handicap milestones, from any /pp/my reply that carries a handicap.
  function fromHandicap(hc) {
    if (!hc || hc.value === null || hc.value === undefined) return;
    award('first_hcp', 'first_hcp', { v: hc.value });
    if (hc.value <= 0) award('scratch', 'scratch', { v: hc.value });
  }
  function fromStreak(streak, n) {
    if (STREAK[streak]) award('streak' + streak + '_' + (n - streak), 'streak', { n: streak });
  }

  window.gpMilestones = { award: award, shelf: shelf, list: list, fromHandicap: fromHandicap, fromStreak: fromStreak, draw: draw, open: open };
})();
