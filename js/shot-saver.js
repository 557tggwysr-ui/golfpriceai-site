/* Shot Saver page (/improve/shot-saver/). Adds a round, shows where the shots
   go against the chosen level, the free fix for the biggest leak, practice kit
   at live prices, and the round-by-round trend. The maths is in
   shot-saver-core.js. Rounds stay in this browser. */
(function () {
  'use strict';
  var C = window.gpShotSaverCore, root = document.getElementById('ss');
  if (!C || !root) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* counts are a nice-to-have */ } }
  function money(n) { return '£' + Number(n).toFixed(2); }
  function nick() { try { return String(JSON.parse(localStorage.getItem('gpNick')) || '').slice(0, 24); } catch (e) { return ''; } }
  var one = C.one, kits = {};
  try { kits = JSON.parse($('ss-kit-data').textContent) || {}; } catch (e) { kits = {}; }

  // The free fix for each leak, then a line of humour.
  var FIX = {
    putt: ['<b>The 3-foot circle.</b> Eight balls round the hole at three feet. Hole all eight before you leave. Miss one, start again. Ten minutes before each round.',
      '<b>The ladder.</b> Putts from 20, 30 and 40 feet, each one to stop inside a putter length. This is where three-putts go to die.'],
    pen: ['<b>The club you can’t lose.</b> On any tee with water or out of bounds, take the club that can’t reach trouble. A bogey beats a reload every time.',
      '<b>Sideways is a shot, not a sin.</b> In the trees, chip back to the fairway. One shot lost, not three.'],
    app: ['<b>One more club.</b> Most amateur approach shots finish short of the green. Take one more club than you think, and swing easy.',
      '<b>Middle of the green.</b> Aim at the centre, whatever the flag is doing. Greens hit, not flags attacked.'],
    rest: ['<b>One club round the green.</b> Pick a 9-iron or pitching wedge and chip with it from every lie for a month. Low and rolling beats high and hopeful.',
      '<b>The towel drill.</b> Lay a towel a few paces on to the green and land ten chips on it. Get the landing spot right and the ball does the rest.']
  };
  var QUIP = {
    putt: 'Good news: the driver’s innocent. Bad news: the putter’s running up a tab.',
    pen: 'Your golf balls are trying to escape. Let’s stop helping them.',
    app: 'You’re getting there. Just not in regulation.',
    rest: 'It’s the little shots. The ones nobody practises.'
  };
  var LABEL = { putt: 'Putting', pen: 'Penalties', app: 'Approach shots', rest: 'Short game and the rest' };

  var state = C.get();
  $('ss-aim').value = state.aim;
  $('ss-par').value = String(state.par);

  // The −/+ buttons. An empty box starts from its placeholder.
  root.querySelectorAll('.ss-pm').forEach(function (b) {
    b.addEventListener('click', function () {
      var inp = $('ss-' + b.getAttribute('data-for')), lo = +inp.min, hi = +inp.max;
      var v = inp.value === '' ? +inp.placeholder : +inp.value + Number(b.getAttribute('data-step'));
      inp.value = String(Math.max(lo, Math.min(hi, v)));
    });
  });
  $('ss-aim').addEventListener('change', function () { state.aim = this.value; C.put(state); render(); });
  $('ss-par').addEventListener('change', function () { state.par = +this.value; C.put(state); });

  $('ss-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var r = { d: new Date().toISOString().slice(0, 10), par: state.par }, msg = $('ss-msg'), bad = '';
    ['s', 'f', 'g', 'p', 'n'].forEach(function (k) {
      var inp = $('ss-' + k);
      if (inp.value === '') return;
      var v = Number(inp.value);
      if (!isFinite(v) || v < +inp.min || v > +inp.max || v % 1) bad = bad || inp.previousElementSibling.previousElementSibling.querySelector('b').textContent;
      else r[k] = v;
    });
    if (r.s == null) { msg.textContent = 'Add your score first. The rest you can skip.'; $('ss-s').focus(); return; }
    if (bad) { msg.textContent = 'That ' + bad.toLowerCase() + ' doesn’t look right. Have another look?'; return; }
    if (r.p != null && r.p > r.s) { msg.textContent = 'More putts than shots? That’s a new one. Have another look.'; return; }
    if (!C.valid(r)) { msg.textContent = 'One of those doesn’t look right. Have another look?'; return; }
    state.rounds.push(r); state.rounds = state.rounds.slice(-20);
    if (!C.put(state)) msg.textContent = 'This browser won’t let us save rounds (private mode?), so this one is just for now.';
    else msg.textContent = 'Round added.';
    ['s', 'f', 'g', 'p', 'n'].forEach(function (k) { $('ss-' + k).value = ''; });
    gpUse('ss_round'); track('shot_saver_round', { aim: state.aim, rounds: state.rounds.length });
    render(true);
    milestone();
  });

  $('ss-undo').addEventListener('click', function () {
    if (!state.rounds.length) return;
    state.rounds.pop(); C.put(state); render(); $('ss-msg').textContent = 'Last round removed.';
  });
  $('ss-share').addEventListener('click', function () { share(this); });

  function bars(sum) {
    var top = sum.leaks.length ? sum.leaks[0].v : 1;
    return sum.leaks.map(function (c, i) {
      return '<div class="ss-bar"><b>' + esc(c.label) + '</b><span class="ss-track"><span class="ss-fill' + (i === 0 ? ' ss-top' : '') + '" style="width:' +
        Math.max(4, Math.round(c.v / top * 100)) + '%"></span></span><b class="ss-v">' + one(c.v) + '</b></div>';
    }).join('');
  }
  function kitRows(k) {
    return (kits[k] || []).map(function (i) {
      return '<a class="ss-kit-row" href="' + esc(i.url) + '"' + (i.out ? ' rel="sponsored nofollow noopener" target="_blank"' : '') + '><span><b>' + esc(i.what) + '</b><small>' + esc(i.note) + '</small></span><b class="ss-price">from ' + money(i.price) + '</b></a>';
    }).join('');
  }

  function render(scroll) {
    var s = C.summary(state, 5);
    $('ss-count').textContent = state.rounds.length ? 'Round ' + (state.rounds.length + 1) + ' · we use your last 5' : 'Your first one';
    if (!s) return;   // keep the sample
    var aim = s.aim;
    $('ss-badge').textContent = s.n === 1 ? '1 round' : 'Last ' + s.n + ' rounds';
    $('ss-vs').textContent = (s.n === 1 ? 'YOUR ROUND' : 'YOUR LAST ' + s.n + ' ROUNDS') + ', AGAINST ' + aim.who.toUpperCase() + ' (AVERAGES ' + aim.score + ')';
    var strong = $('ss-strong');
    if (!s.leaks.length) {
      $('ss-total').textContent = 'Nothing to save. Not bad at all.';
      $('ss-bars').innerHTML = '';
      $('ss-quip').textContent = 'You’re already beating ' + aim.who + '. Time to raise the bar: pick the next level up.';
      $('ss-fix').hidden = true;
    } else {
      $('ss-fix').hidden = false;
      $('ss-total').textContent = one(s.total) + (one(s.total) === '1.0' ? ' shot' : ' shots') + ' to save a round';
      $('ss-bars').innerHTML = bars(s);
      var lead = s.leaks[0].k;
      var tee = s.avg.fwShort != null && s.avg.fwShort >= 3;
      $('ss-quip').textContent = lead === 'rest' && s.missing ? 'Add your putts, greens and penalty shots next time and we’ll split this up properly.' : tee && lead !== 'pen' ? 'You’re missing more fairways than ' + aim.who + ' too. Worth a look, but the bars show where the shots actually go.' : QUIP[lead];
      $('ss-fix-kick').textContent = 'BIGGEST LEAK · ' + LABEL[lead].toUpperCase() + ' · ' + one(s.leaks[0].v) + ' SHOTS';
      $('ss-drills').innerHTML = FIX[lead].map(function (t) { return '<p>' + t + '</p>'; }).join('');
      var rows = kitRows(lead);
      $('ss-kit').innerHTML = rows || '<p class="ss-small ss-small-dark">No kit needed for this one. The fix is free.</p>';
      var also = $('ss-also'), second = s.leaks[1];
      if (second && second.v >= 0.5) {
        also.hidden = false;
        also.innerHTML = '<b class="ss-also-h">Second leak: ' + esc(second.label.toLowerCase()) + ', ' + one(second.v) + '</b><p>' + FIX[second.k][0] + '</p>';
      } else also.hidden = true;
    }
    if (s.strengths.length) {
      strong.hidden = false;
      strong.innerHTML = 'Where you already beat ' + esc(aim.who) + ': ' + s.strengths.map(function (c) { return '<b>' + esc(c.label.toLowerCase()) + '</b> (' + one(-c.v) + ' better)'; }).join(', ') + '.';
    } else strong.hidden = true;
    // Round by round.
    $('ss-trend-sec').hidden = false;
    $('ss-trend').innerHTML = s.trend.map(function (t, i) {
      var d = new Date(t.d + 'T12:00:00');
      return '<div class="ss-chip' + (i === s.trend.length - 1 ? ' ss-chip-now' : '') + '"><small>' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + '</small><b>' + one(t.v) + '</b></div>';
    }).join('');
    var since = $('ss-since');
    if (s.sinceFirst != null && Math.abs(s.sinceFirst) >= 0.5) {
      since.hidden = false;
      since.className = 'ss-pill' + (s.sinceFirst > 0 ? '' : ' ss-pill-up');
      since.textContent = (s.sinceFirst > 0 ? 'Down ' : 'Up ') + one(Math.abs(s.sinceFirst)) + ' since round 1';
    } else since.hidden = true;
    if (scroll && window.matchMedia('(max-width: 900px)').matches) $('ss-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // "Saved a shot": the first time a round has a full shot fewer to save than the first one.
  function milestone() {
    var all = state.rounds.map(function (r) { return C.round(r, state.aim).leaks; });
    if (all.length < 3 || all[0] - all[all.length - 1] < 1 || !window.gpMilestones) return;
    gpMilestones.award('ss_saved1', 'saved', { from: Math.round(all[0] * 10) / 10, to: Math.round(all[all.length - 1] * 10) / 10, aim: C.AIMS[state.aim].label });
  }

  /* ------------------------------------------------------------ the share card */
  function rr(x, cx, cy, w, h, r) { x.beginPath(); x.moveTo(cx + r, cy); x.arcTo(cx + w, cy, cx + w, cy + h, r); x.arcTo(cx + w, cy + h, cx, cy + h, r); x.arcTo(cx, cy + h, cx, cy, r); x.arcTo(cx, cy, cx + w, cy, r); x.closePath(); }
  function text(x, s, px, y, font, color, align) { x.font = font; x.fillStyle = color; x.textAlign = align || 'left'; x.fillText(s, px, y); }
  function draw(s) {
    var cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    var x = cv.getContext('2d'), L = 120, R = 960, me = nick();
    x.fillStyle = '#14211a'; x.fillRect(0, 0, 1080, 1350);
    x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.16)'; rr(x, 56, 56, 968, 1238, 36); x.stroke();
    text(x, 'Golf', L, 172, '800 40px Poppins, sans-serif', '#fff'); var w1 = x.measureText('Golf').width;
    text(x, 'Price', L + w1, 172, '800 40px Poppins, sans-serif', '#5fd14a'); var w2 = x.measureText('Price').width;
    text(x, ' AI', L + w1 + w2, 172, '800 40px Poppins, sans-serif', '#fff');
    text(x, 'SHOT SAVER', R, 166, '700 22px Inter, sans-serif', '#8fd97c', 'right');
    text(x, ((me ? me + ' · ' : '') + 'chasing ' + s.aim.label.toLowerCase()).toUpperCase(), L, 330, '700 28px Inter, sans-serif', '#f08a24');
    text(x, 'Where my', L, 450, '800 104px Poppins, sans-serif', '#fff');
    text(x, 'shots go', L, 560, '800 104px Poppins, sans-serif', '#fff');
    var top = s.leaks.length ? s.leaks[0].v : 1, y = 680;
    s.leaks.slice(0, 4).forEach(function (c, i) {
      text(x, c.label === 'Short game and the rest' ? 'Short game' : c.label, L, y + 12, '400 34px Inter, sans-serif', '#c4d0c8');
      x.fillStyle = '#24372c'; rr(x, 420, y - 16, 420, 30, 15); x.fill();
      x.fillStyle = i === 0 ? '#f08a24' : '#5fd14a'; rr(x, 420, y - 16, Math.max(30, 420 * c.v / top), 30, 15); x.fill();
      text(x, one(c.v), R, y + 12, '700 36px Poppins, sans-serif', '#fff', 'right');
      y += 86;
    });
    text(x, one(s.total) + ' shots to save a round', L, 1060, '700 40px Poppins, sans-serif', '#fff');
    x.fillStyle = 'rgba(255,255,255,.14)'; x.fillRect(L, 1120, R - L, 2);
    text(x, 'It was never the driver.', L, 1200, '400 32px Inter, sans-serif', '#c4d0c8');
    x.font = '700 26px Inter, sans-serif'; var pw = x.measureText('Find yours: golfpriceai.com').width + 52;
    x.fillStyle = '#3fae29'; rr(x, R - pw, 1172, pw, 60, 16); x.fill();
    text(x, 'Find yours: golfpriceai.com', R - pw / 2, 1211, '700 26px Inter, sans-serif', '#fff', 'center');
    return cv;
  }
  function share(btn) {
    var s = C.summary(state, 5);
    if (!s || !s.leaks.length) return;
    gpUse('ss_share'); track('shot_saver_share');
    var words = 'Where my golf shots go: ' + s.leaks.slice(0, 3).map(function (c) { return c.label.toLowerCase() + ' ' + one(c.v); }).join(', ') + '. It was never the driver. Find yours:';
    var url = 'https://golfpriceai.com/improve/shot-saver/';
    var ready = document.fonts && document.fonts.load ? Promise.all(['800 100px Poppins', '700 40px Poppins', '400 30px Inter', '700 26px Inter'].map(function (f) { return document.fonts.load(f).catch(function () {}); })) : Promise.resolve();
    ready.then(function () {
      draw(s).toBlob(function (blob) {
        if (!blob) return;
        var file = window.File ? new File([blob], 'where-my-shots-go.png', { type: 'image/png' }) : null;
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], text: words + ' ' + url }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'where-my-shots-go.png';
          document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
          var t = btn.textContent; btn.textContent = 'Saved. Add it to the group chat'; setTimeout(function () { btn.textContent = t; }, 2500);
        }
      }, 'image/png');
    });
  }

  gpUse('ss_view');
  render();
})();
