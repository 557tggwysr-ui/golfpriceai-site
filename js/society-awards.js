/* GolfPrice AI: Society Awards Night Kit (/societies/awards/).
   No ?k: the organiser types the society's awards and winners (a draft is kept
   on this device) and saves them to the alerts worker (/soc/kit).
   ?k=<id>: everyone sees the award cards (drawn here as 1080 x 1350 pictures
   for the WhatsApp group) and the presentation-night slideshow. The organiser's
   browser (same player id that made it) also sees the edit button and the
   Prize Picker links: one private link per award with a budget, and a
   shopping list of what each winner chose, at today's lowest price.
   Nicknames or first names only; no money ever goes through the site. */
(function () {
  'use strict';
  var box = document.getElementById('aw');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var SITE = 'https://golfpriceai.com';
  var STD = [
    ['Player of the Year', 'e.g. 3 wins and the Order of Merit'],
    ['Most Improved', 'e.g. Handicap down from 24 to 19'],
    ['Bandit of the Year', 'e.g. Cut 6 shots this season'],
    ['Ball Donor of the Year', 'e.g. 41 balls lost, 9 in one pond'],
    ['Wooden Spoon', 'e.g. 22 points at the Spring Stableford']
  ];
  var QUIPS = [
    [/bandit/i, 'The committee has questions.'],
    [/spoon|last|wooden/i, 'Character building.'],
    [/donor|ball|lake|lost/i, 'The lake thanks you for your service.'],
    [/improv/i, 'Lessons, or a new driver? We may never know.'],
    [/player of the year|champion|order of merit/i, 'Insufferable, frankly. Well played.'],
    [/trouser|dress|fashion|outfit/i, 'Bold choices were made.'],
    [/shank/i, 'It went where it wanted.'],
    [/putt/i, 'Three-putts are a lifestyle.'],
    [/drive|longest/i, 'Found the fairway eventually.'],
    [/./, 'Take a bow.']
  ];
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function money(n) { n = Number(n); return '£' + (n % 1 ? n.toFixed(2) : n.toFixed(0)); }
  function quip(t) { for (var i = 0; i < QUIPS.length; i++) if (QUIPS[i][0].test(t)) return QUIPS[i][1]; return ''; }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  var kit = (location.search.match(/[?&]k=([a-z0-9]{8})/i) || [])[1];
  var defSeason = String(new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear());

  /* ---------------------------------------------------------------- the form */
  function form(d) {
    d = d || get('gpAwDraft', null) || { name: '', season: defSeason, awards: STD.map(function (s) { return { t: s[0], w: '', d: '', b: '' }; }) };
    var mine = get('gpSocKits', []);
    var h = '';
    if (mine.length && !d.id) {
      h += '<section class="soc-card"><h2>Your award nights</h2><ul class="soc-mine">' + mine.map(function (m) {
        return '<li><a href="?k=' + esc(m.id) + '">' + esc(m.name) + ' · ' + esc(m.season) + '</a></li>';
      }).join('') + '</ul></section>';
    }
    h += '<form class="soc-card" id="aw-form" novalidate><h2>' + (d.id ? 'Edit your awards' : 'Your society') + '</h2>' +
      '<div class="soc-two"><label>Society name<input name="name" maxlength="40" required value="' + esc(d.name) + '" placeholder="The Sunday Slicers"></label>' +
      '<label>Season<input name="season" maxlength="20" value="' + esc(d.season) + '"></label></div>' +
      '<h2 class="soc-h2b">The awards</h2><p class="soc-help">Type each winner. The extra line is optional and goes on the card. Give an award a prize budget and its winner picks their own prize.</p>' +
      '<div id="aw-rows"></div>' +
      '<button type="button" class="soc-btn2" id="aw-add">+ Add your own award</button>' +
      '<p class="soc-msg" role="status"></p>' +
      '<button type="submit" class="soc-btn">' + (d.id ? 'Save the awards' : 'Make our awards →') + '</button>' +
      (d.id ? ' <a class="soc-link" href="?k=' + esc(d.id) + '">Cancel</a>' : '') + '</form>';
    box.innerHTML = h;
    var rows = box.querySelector('#aw-rows'), f = box.querySelector('#aw-form');
    function row(a, i) {
      var hint = (STD.filter(function (s) { return s[0] === a.t; })[0] || [0, 'e.g. a line for the card'])[1];
      return '<fieldset class="soc-aw" data-i="' + i + '"><legend class="soc-vh">Award ' + (i + 1) + '</legend>' +
        '<label class="soc-aw-t">Award<input name="t" maxlength="40" value="' + esc(a.t) + '" placeholder="Worst Trousers"></label>' +
        '<label class="soc-aw-w">Winner<input name="w" maxlength="30" value="' + esc(a.w) + '" placeholder="Nickname or first name"></label>' +
        '<label class="soc-aw-d">Line for the card (optional)<input name="d" maxlength="80" value="' + esc(a.d) + '" placeholder="' + esc(hint) + '"></label>' +
        '<label class="soc-aw-b">Prize budget (optional)<span class="soc-pound"><span aria-hidden="true">£</span><input name="b" inputmode="numeric" maxlength="3" value="' + esc(a.b || '') + '" placeholder="0"></span></label>' +
        '<button type="button" class="soc-x" aria-label="Remove this award">Remove</button></fieldset>';
    }
    function read() {
      return {
        id: d.id, name: f.name.value, season: f.season.value,
        awards: [].map.call(rows.querySelectorAll('.soc-aw'), function (fs) {
          return { t: fs.querySelector('[name=t]').value, w: fs.querySelector('[name=w]').value, d: fs.querySelector('[name=d]').value, b: fs.querySelector('[name=b]').value.replace(/\D/g, '') };
        })
      };
    }
    function draw(list) {
      rows.innerHTML = list.map(row).join('');
      rows.querySelectorAll('.soc-x').forEach(function (b) {
        b.onclick = function () { var cur = read(); cur.awards.splice(+b.closest('.soc-aw').getAttribute('data-i'), 1); draw(cur.awards); keep(); };
      });
      box.querySelector('#aw-add').disabled = list.length >= 12;
    }
    function keep() { if (!d.id) put('gpAwDraft', read()); }
    draw(d.awards);
    f.addEventListener('input', keep);
    box.querySelector('#aw-add').onclick = function () { var cur = read(); cur.awards.push({ t: '', w: '', d: '', b: '' }); draw(cur.awards); keep(); var l = rows.querySelector('.soc-aw:last-child input'); if (l) l.focus(); };
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var cur = read(), msg = f.querySelector('.soc-msg'), btn = f.querySelector('.soc-btn');
      cur.awards = cur.awards.filter(function (a) { return a.t.trim() && a.w.trim(); });
      if (cur.name.trim().length < 3) { msg.textContent = 'Give your society a name (at least 3 letters).'; f.name.focus(); return; }
      if (!cur.awards.length) { msg.textContent = 'Add at least one award with a winner.'; return; }
      btn.disabled = true; msg.textContent = 'Engraving the trophies…';
      api('/soc/kit', { pid: pid(), id: d.id, name: cur.name, season: cur.season, awards: cur.awards.map(function (a) { return { t: a.t, w: a.w, d: a.d, b: Number(a.b) || 0 }; }) }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        var list = get('gpSocKits', []).filter(function (m) { return m.id !== r.id; });
        list.unshift({ id: r.id, name: cur.name.trim(), season: cur.season.trim() });
        put('gpSocKits', list.slice(0, 20));
        if (!d.id) { try { localStorage.removeItem('gpAwDraft'); } catch (err) { /* fine */ } track('society_awards_made', { awards: cur.awards.length }); }
        location.href = '?k=' + r.id;
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }

  /* ---------------------------------------------------------------- the award cards */
  function fonts() {
    return document.fonts ? Promise.all(['800 64px Poppins', '700 30px Poppins', '600 24px Inter', '400 24px Inter'].map(function (f) { return document.fonts.load(f); })).catch(function () {}) : Promise.resolve();
  }
  function drawCard(k, a) {
    var W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d'), gold = '#d9b45a', cream = '#e7dcc3';
    g.fillStyle = '#1b1508'; g.fillRect(0, 0, W, H);
    g.strokeStyle = gold; g.lineWidth = 10; g.strokeRect(40, 40, W - 80, H - 80);
    g.lineWidth = 2; g.strokeRect(62, 62, W - 124, H - 124);
    function t(s, x, y, font, col, max) {
      g.font = font; g.fillStyle = col; g.textAlign = 'center'; s = String(s);
      while (max && g.measureText(s).width > max && s.length > 4) s = s.slice(0, -2) + '…';
      g.fillText(s, x, y);
    }
    function fit(s, y, max, size, weight, col) {
      var f = size; g.font = weight + ' ' + f + 'px Poppins, sans-serif';
      while (g.measureText(s).width > max && f > 60) { f -= 4; g.font = weight + ' ' + f + 'px Poppins, sans-serif'; }
      t(s, W / 2, y, weight + ' ' + f + 'px Poppins, sans-serif', col, max);
    }
    function wrap(s, y, font, max, lh, col) {
      g.font = font; g.fillStyle = col; g.textAlign = 'center';
      var words = String(s).split(' '), line = '', n = 0;
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (g.measureText(test).width > max && line) { g.fillText(line, W / 2, y + n * lh); n++; line = words[i]; if (n >= 3) return; }
        else line = test;
      }
      g.fillText(line, W / 2, y + n * lh);
    }
    t((k.name + ' · ' + (k.season ? k.season + ' ' : '') + 'awards').toUpperCase(), W / 2, 170, '800 30px Inter, sans-serif', gold, 900);
    g.fillStyle = gold; g.fillRect(300, 205, 480, 3);
    fit(a.t, 520, 900, 64, 700, cream);
    fit(a.w, 700, 900, 150, 800, gold);
    if (a.d) wrap(a.d, 830, '600 40px Inter, sans-serif', 880, 54, '#ffffff');
    wrap(quip(a.t), a.d ? 960 : 850, 'italic 400 36px Inter, sans-serif', 880, 50, cream);
    g.font = '700 38px Poppins, sans-serif'; g.textAlign = 'left';
    var gw = g.measureText('Golf').width, pw = g.measureText('Price').width, x0 = 110;
    g.fillStyle = '#ffffff'; g.fillText('Golf', x0, H - 120); g.fillStyle = '#3fae29'; g.fillText('Price', x0 + gw, H - 120); g.fillStyle = '#ffffff'; g.fillText(' AI', x0 + gw + pw, H - 120);
    t('golfpriceai.com/societies', W - 110 - 230, H - 120, '600 28px Inter, sans-serif', cream);
    return cv;
  }
  function blob(cv, name) {
    return new Promise(function (ok, no) { cv.toBlob(function (b) { b ? ok(new File([b], name, { type: 'image/png' })) : no(); }, 'image/png'); });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'award'; }
  function shareFiles(files, text) {
    if (navigator.canShare && navigator.canShare({ files: files })) return navigator.share({ files: files, text: text }).catch(function () {});
    files.forEach(function (file, i) {
      setTimeout(function () {
        var a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      }, i * 400);
    });
  }

  /* ---------------------------------------------------------------- the kit page */
  function show(k) {
    var link = SITE + '/societies/awards/?k=' + k.id;
    var h = '<section class="soc-card soc-kit"><span class="soc-kick">' + esc(k.season || '') + ' awards</span><h2 class="soc-kit-h">' + esc(k.name) + '</h2>' +
      '<div class="soc-cards" id="aw-cards" tabindex="0" aria-label="Award cards">' + k.awards.map(function (a, i) {
        return '<figure class="soc-cardimg" data-i="' + i + '"><div class="soc-ph">Drawing the card…</div><figcaption>' + esc(a.t) + ': ' + esc(a.w) + '</figcaption></figure>';
      }).join('') + '</div>' +
      '<div class="soc-btns"><button type="button" class="soc-btn" id="aw-all">Send all ' + k.awards.length + ' cards</button>' +
      '<button type="button" class="soc-btn2" id="aw-show">Open the slideshow</button>' +
      '<button type="button" class="soc-btn2" id="aw-link">Share the awards page</button>' +
      (k.owner ? '<a class="soc-btn2" href="?k=' + esc(k.id) + '&edit=1">Edit awards</a>' : '') + '</div>' +
      '<p class="soc-small">Tap a card to send just that one.</p></section>';
    if (k.owner) {
      var prized = k.awards.map(function (a, i) { return { a: a, i: i }; }).filter(function (x) { return x.a.prize; });
      if (prized.length) {
        h += '<section class="soc-card"><h2>Prizes: winners pick their own</h2><p class="soc-help">Send each winner their private link. They pick something within budget at today’s lowest UK price; you buy it from the link below. Only you can see this list.</p>' +
          '<div class="soc-plist">' + prized.map(function (x) {
            var p = x.a.prize, c = p.choice, st = c ? (c.surprise ? 'Surprise me' : 'Chosen') : 'Waiting';
            return '<div class="soc-prow" data-i="' + x.i + '"><div class="soc-prow-h"><span>' + esc(x.a.t) + ' · ' + esc(x.a.w) + ' · ' + money(x.a.b) + '</span><b class="soc-st soc-st-' + slug(st) + '">' + st + '</b></div>' +
              (c && !c.surprise ? '<b class="soc-prow-n">' + esc(c.name) + '</b><div class="soc-prow-b"><span class="soc-prow-p" data-id="' + esc(c.id) + '" data-cat="' + esc(c.cat) + '">' + money(c.price) + ' when chosen</span><a class="soc-buy" href="/search.html?q=' + encodeURIComponent(c.name) + '" target="_blank" rel="noopener">Find it ›</a></div>' :
                c && c.surprise ? '<span class="soc-prow-n">Your call, up to ' + money(x.a.b) + '.</span>' : '') +
              '<button type="button" class="soc-btn2 soc-send" data-t="' + esc(p.token) + '">' + (c ? 'Send the link again' : 'Send ' + esc(x.a.w) + ' their prize link') + '</button></div>';
          }).join('') + '</div></section>';
      }
      h += '<section class="soc-card soc-next"><span class="soc-kick">Next season</span><h2>Run next season in Society HQ, free</h2><p>Fixtures, sign-ups, who’s paid, results and a Society Report after every round, with your winners in the Hall of Fame. Coming early 2027: we’ll keep your awards so you can carry straight on.</p></section>';
    } else {
      h += '<section class="soc-card soc-next"><h2>Running a society?</h2><p>Make your own award cards, slideshow and winners’ prizes in five minutes. Free, no sign-up.</p><a class="soc-btn" href="/societies/awards/">Make our awards</a></section>';
    }
    box.innerHTML = h;
    var cards = [];
    fonts().then(function () {
      k.awards.forEach(function (a, i) {
        var cv = drawCard(k, a); cards[i] = cv;
        var fig = box.querySelector('.soc-cardimg[data-i="' + i + '"]');
        cv.toBlob(function (b) {
          if (!b || !fig) return;
          fig.querySelector('.soc-ph').outerHTML = '<button type="button" class="soc-cardbtn" aria-label="Send the ' + esc(a.t) + ' card"><img src="' + URL.createObjectURL(b) + '" alt="' + esc(a.t) + ': ' + esc(a.w) + (a.d ? '. ' + esc(a.d) : '') + '" width="1080" height="1350"></button>';
          fig.querySelector('.soc-cardbtn').onclick = function () {
            track('society_card_share', { one: 1 });
            blob(cv, slug(k.name) + '-' + slug(a.t) + '.png').then(function (file) { shareFiles([file], a.t + ': ' + a.w + ' 🏆 ' + link); });
          };
        }, 'image/png');
      });
    });
    box.querySelector('#aw-all').onclick = function () {
      track('society_card_share', { all: 1 });
      Promise.all(k.awards.map(function (a, i) { return blob(cards[i] || drawCard(k, a), (i + 1) + '-' + slug(a.t) + '.png'); }))
        .then(function (files) { shareFiles(files, k.name + ' ' + (k.season || '') + ' awards 🏆 ' + link); });
    };
    box.querySelector('#aw-link').onclick = function (e) {
      var text = k.name + ' ' + (k.season || '') + ' awards 🏆 ' + link;
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
    };
    box.querySelector('#aw-show').onclick = function () { slideshow(k); };
    box.querySelectorAll('.soc-send').forEach(function (b) {
      b.onclick = function () {
        var row = k.awards[+b.closest('.soc-prow').getAttribute('data-i')];
        var text = 'Congratulations, ' + row.w + '! You won ' + row.t + ' 🏆 Pick your own prize (up to ' + money(row.b) + '): ' + SITE + '/societies/prize/?t=' + b.getAttribute('data-t');
        track('society_prize_link');
        if (navigator.share) navigator.share({ text: text }).catch(function () {});
        else window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
      };
    });
    todayPrices();
  }
  // Organiser's list: today's price and a direct link for each chosen prize.
  var SH = {};
  function shard(cat) { if (!SH[cat]) SH[cat] = Promise.all([fetch('/data/search/' + cat + '.json').then(function (r) { return r.json(); }), terms()]); return SH[cat]; }
  var T;
  function terms() { if (!T) T = fetch('/data/search/terms.json').then(function (r) { return r.json(); }); return T; }
  function todayPrices() {
    box.querySelectorAll('.soc-prow-p[data-id]').forEach(function (el) {
      shard(el.getAttribute('data-cat')).then(function (res) {
        var d = res[0], tm = res[1], id = el.getAttribute('data-id');
        var r = d.rows.filter(function (x) { return x[0] === id; })[0];
        if (!r) { el.textContent += ' · no longer listed'; return; }
        el.textContent = money(r[2]) + ' today';
        var a = el.parentNode.querySelector('.soc-buy');
        a.href = /^https?:/.test(r[13]) ? r[13] : tm.urlPrefix + r[13];
        a.setAttribute('rel', 'nofollow sponsored noopener');
        a.textContent = 'Buy at the lowest price ›';
      }).catch(function () {});
    });
  }

  /* ---------------------------------------------------------------- the slideshow */
  function slideshow(k) {
    track('society_slideshow');
    var slides = [{ kind: 'title' }].concat(k.awards.map(function (a) { return { kind: 'award', a: a }; }), [{ kind: 'end' }]);
    var at = 0, revealed = false;
    var ov = document.createElement('div');
    ov.className = 'soc-show'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Awards slideshow');
    document.body.appendChild(ov);
    if (ov.requestFullscreen) ov.requestFullscreen().catch(function () {});
    function paint() {
      var s = slides[at], inner;
      if (s.kind === 'title') inner = '<span class="soc-show-k">' + esc(k.name) + '</span><b class="soc-show-big">' + esc(k.season || '') + ' Awards</b><span class="soc-show-sub">Tap or press → to begin</span>';
      else if (s.kind === 'end') inner = '<span class="soc-show-k">' + esc(k.name) + '</span><b class="soc-show-big">Congratulations, all</b><span class="soc-show-sub">Same again next season?</span>';
      else inner = '<span class="soc-show-k">' + esc(k.name) + ' · ' + esc(k.season || '') + ' awards</span><span class="soc-show-t">The ' + esc(s.a.t.replace(/^the\s+/i, '')) + (/award$/i.test(s.a.t) ? '' : ' award') + ' goes to…</span>' +
        (revealed ? '<b class="soc-show-big soc-show-win">' + esc(s.a.w) + '</b>' + (s.a.d ? '<span class="soc-show-d">' + esc(s.a.d) + '</span>' : '') + '<span class="soc-show-q">' + esc(quip(s.a.t)) + '</span>'
          : '<button type="button" class="soc-show-reveal">Tap to reveal</button>');
      ov.innerHTML = '<div class="soc-show-stage">' + inner + '</div><div class="soc-show-bar"><button type="button" class="soc-show-nav" data-d="-1">← Back</button><span>' +
        (s.kind === 'award' ? 'Award ' + at + ' of ' + k.awards.length : '') + '</span><button type="button" class="soc-show-nav" data-d="1">' + (at === slides.length - 1 ? 'Close' : 'Next →') + '</button><button type="button" class="soc-show-x" aria-label="Close the slideshow">✕</button></div>';
      var rv = ov.querySelector('.soc-show-reveal'); if (rv) { rv.onclick = function (e) { e.stopPropagation(); revealed = true; paint(); }; rv.focus(); }
      ov.querySelectorAll('.soc-show-nav').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); go(+b.getAttribute('data-d')); }; });
      ov.querySelector('.soc-show-x').onclick = function (e) { e.stopPropagation(); close(); };
    }
    function go(dlt) {
      var s = slides[at];
      if (dlt > 0 && s.kind === 'award' && !revealed) { revealed = true; return paint(); }
      at += dlt;
      if (at >= slides.length || at < 0) return close();
      revealed = false; paint();
    }
    function close() {
      document.removeEventListener('keydown', key);
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      ov.remove();
      var b = document.getElementById('aw-show'); if (b) b.focus();
    }
    function key(e) {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', key);
    ov.addEventListener('click', function (e) { if (e.target === ov || e.target.closest('.soc-show-stage')) go(1); });
    paint();
  }

  /* ---------------------------------------------------------------- start */
  if (!kit) { form(); return; }
  api('/soc/kit?k=' + kit + '&pid=' + pid()).then(function (k) {
    if (!k.ok) { box.innerHTML = '<section class="soc-card"><p>' + esc(k.error || 'We couldn’t find those awards.') + '</p><a class="soc-btn" href="/societies/awards/">Make new awards</a></section>'; return; }
    if (k.owner && /[?&]edit=1/.test(location.search)) {
      return form({ id: k.id, name: k.name, season: k.season, awards: k.awards.map(function (a) { return { t: a.t, w: a.w, d: a.d, b: a.b || '' }; }) });
    }
    show(k);
  }).catch(function () { box.innerHTML = '<section class="soc-card"><p>We couldn’t reach the clubhouse. Please refresh in a minute.</p></section>'; });
})();
