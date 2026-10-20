/* GolfPrice AI: The Bag Draft (/play/draft/), monthly fantasy golf kit.
   Prices come from /data/draft/catalogue.json (rebuilt every 6 hours by
   scripts/bag_draft.py). Bags, points and leagues live in the alerts worker
   (/draft/...), keyed by this browser's random player id (gpPid) and the
   nickname you choose. A half-finished bag waits in this browser (gpDraftWip). */
(function () {
  'use strict';
  var box = document.getElementById('bd');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var test = /[?&]test=1/.test(location.search);
  var cat, state, by = {}, wip, view = 'home', pickSlot = null, transfer = false, search = '';
  var SLOT_WORD = { driver: 'driver', irons: 'irons or wedge', putter: 'putter', ball: 'balls', tech: 'tech', wild: 'wildcard' };

  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function pid() {
    var p = get('gpPid', '');
    if (!/^[a-z0-9]{12,32}$/.test(p)) {
      var a = 'abcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      p = Array.prototype.map.call(b, function (x) { return a[x % a.length]; }).join('');
      put('gpPid', p);
    }
    return p;
  }
  function season() { return test ? 'test' : cat.season; }
  function api(path, body) {
    return fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json(); });
  }
  function track(n, p) { if (window.gtag) window.gtag('event', n, p || {}); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n, dp) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: dp === 0 ? 0 : 2, maximumFractionDigits: dp === 0 ? 0 : 2 }).replace(/\.00$/, ''); }
  function pts(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n) + (Math.abs(n) === 1 ? ' pt' : ' pts'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function img(src, alt) { return src ? '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy" referrerpolicy="no-referrer">' : ''; }
  function major() { return test ? { name: 'The Practice Range', colour: '#14211a', accent: '#8fd77e', joke: 'Practice season: nothing counts, everything’s allowed.', art: cat.major.art } : cat.major; }

  Promise.all([fetch('/data/draft/catalogue.json', { cache: 'no-cache' }).then(function (r) { return r.json(); })]).then(function (r) {
    cat = r[0];
    cat.items.forEach(function (it) { by[it.slug] = it; });
    wip = get('gpDraftWip', {});
    if (wip.season !== season()) wip = { season: season(), picks: {} };
    load();
  }).catch(function () { box.innerHTML = '<p>The draft room couldn’t load. Please refresh in a minute.</p>'; });

  function load() {
    api('/draft/state?season=' + season() + '&pid=' + pid()).then(function (s) {
      state = s;
      if (!s.ok) throw new Error(s.error);
      render();
    }).catch(function () {
      state = { phase: { open: false }, mine: null, national: { count: 0, top: [] } };
      render();
    });
  }

  function render() {
    var ph = state.phase || {};
    if (view === 'pick') return picker();
    if (state.mine && view !== 'build') return myBag();
    if (ph.open) return builder();
    teaser();
  }

  /* ---------------------------------------------------------- before launch */
  function teaser() {
    var nov = cat.majors['11'];
    box.innerHTML = '<div class="bd-hero" style="background:' + nov.colour + '">' +
      '<div class="bd-hero-art">' + img(nov.art, 'The Black Friday Open bag') + '</div>' +
      '<div class="bd-hero-text"><span class="bd-kicker" style="color:' + nov.accent + '">The Bag Draft · Coming 1 November</span>' +
      '<h1>' + esc(nov.name) + '</h1><p>Fantasy football, but for golf kit. Draft six real products within ' + money(cat.budget, 0) +
      ', then watch real UK prices move every 6 hours. Every £1 your picks drop is a point.</p>' +
      '<p class="bd-small">The draft opens on 1 November. Want to see how it works first? Have a go on the practice range: nothing counts, everything’s allowed.</p>' +
      '<div class="bd-btns"><a class="gp-af-btn" href="?test=1">Try the practice range</a><a class="bd-btn2" href="/play/par-price/">Play today’s Par Price</a></div></div></div>';
  }

  /* ---------------------------------------------------------- drafting */
  function spent(picks) { return cat.slots.reduce(function (t, s) { var it = by[picks[s.key]]; return t + (it ? it.price : 0); }, 0); }
  function builder() {
    var m = major(), sp = spent(wip.picks), left = cat.budget - sp, n = cat.slots.filter(function (s) { return by[wip.picks[s.key]]; }).length;
    var redraft = !!state.mine;
    box.innerHTML = '<div class="bd-hero" style="background:' + m.colour + '">' +
      '<div class="bd-hero-art">' + img(m.art, '') + '</div>' +
      '<div class="bd-hero-text"><span class="bd-kicker" style="color:' + m.accent + '">The Bag Draft · ' + (test ? 'Practice' : 'Draft open') + '</span>' +
      '<h1>' + esc(m.name) + '</h1><p>' + esc(m.joke) + '</p>' +
      '<div class="bd-meter"><div><b>' + money(sp) + '</b> of ' + money(cat.budget, 0) + '</div><div class="bd-bar"><span style="width:' + Math.min(100, sp / cat.budget * 100) + '%"></span></div>' +
      '<div class="' + (left < 0 ? 'bd-over' : '') + '">' + (left < 0 ? 'Over budget by ' + money(-left) : money(left) + ' left') + ' · ' + n + ' of 6 picked</div></div></div></div>' +
      '<ol class="bd-slots">' + cat.slots.map(function (s) {
        var it = by[wip.picks[s.key]];
        return '<li><button type="button" class="bd-slot' + (it ? ' is-full' : '') + '" data-slot="' + s.key + '">' +
          '<span class="bd-slot-pic">' + (it ? img(it.image, '') : '<span>+</span>') + '</span>' +
          '<span class="bd-slot-text"><span class="bd-slot-label">' + esc(s.label) + '</span>' +
          (it ? '<b>' + esc(it.name) + '</b><span class="bd-slot-price">' + money(it.price) + (it.unit ? ' ' + it.unit : '') + '</span><span class="bd-note">' + esc(it.note) + '</span>'
            : '<b>Choose your ' + SLOT_WORD[s.key] + '</b><span class="bd-note">' + slotHint(s.key) + '</span>') +
          '</span><span class="bd-slot-go">' + (it ? 'Change' : 'Pick') + '</span></button></li>';
      }).join('') + '</ol>' +
      '<form class="bd-seal" novalidate><label>Your nickname for the leaderboard<input name="nick" maxlength="20" autocomplete="nickname" placeholder="Big Dave" value="' + esc(get('gpNick', '') || (state.mine && state.mine.nick) || '') + '"></label>' +
      '<button type="submit" class="gp-af-btn"' + (n < 6 || left < 0 ? ' disabled' : '') + '>' + (redraft ? 'Re-seal my bag' : 'Seal my bag') + '</button>' +
      '<p class="pr-msg" role="status"></p><p class="bd-small">' + (test ? 'Practice bags don’t count for anything. Go wild.' : 'Bags stay sealed until the 8th: only you can see yours. Until then you can redraft as often as you like, at that day’s prices.') + '</p>' +
      (redraft ? '<button type="button" class="bd-link bd-cancel">Keep my current bag</button>' : '') + '</form>';
    box.querySelectorAll('.bd-slot').forEach(function (b) { b.addEventListener('click', function () { pickSlot = b.getAttribute('data-slot'); transfer = false; search = ''; view = 'pick'; render(); top(); }); });
    var c = box.querySelector('.bd-cancel'); if (c) c.addEventListener('click', function () { view = 'home'; render(); });
    var f = box.querySelector('.bd-seal');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var nick = f.querySelector('[name=nick]').value, msg = f.querySelector('.pr-msg'), btn = f.querySelector('button[type=submit]');
      btn.disabled = true; msg.textContent = 'Sealing the bag…';
      api('/draft/save', { pid: pid(), season: season(), nick: nick, picks: wip.picks }).then(function (r) {
        btn.disabled = false;
        if (!r.ok) { msg.textContent = r.error || 'Something went wrong. Please try again.'; return; }
        put('gpNick', nick); track('bag_draft_seal', { season: season() });
        view = 'home'; load(); top();
      }).catch(function () { btn.disabled = false; msg.textContent = 'We couldn’t reach the clubhouse. Please try again.'; });
    });
  }
  function slotHint(k) {
    return { driver: 'The big stick. Big prices, big swings.', irons: 'A set of irons or a single wedge.', putter: 'Blame it now, before the round.',
      ball: 'Priced per dozen. Small numbers, small moves.', tech: 'Rangefinder, GPS watch or launch monitor.',
      wild: 'Anything else: a wood, hybrid, bag, trolley or full set.' }[k];
  }

  function picker() {
    var slot = pickSlot, label = cat.slots.filter(function (s) { return s.key === slot; })[0].label;
    var others = transfer ? state.mine.picks.reduce(function (t, p) { return t + (p.slot === slot ? 0 : p.price); }, 0)
      : cat.slots.reduce(function (t, s) { var it = by[wip.picks[s.key]]; return t + (s.key !== slot && it ? it.price : 0); }, 0);
    var room = cat.budget - others;
    var words = search.toLowerCase().split(/\s+/).filter(Boolean);
    var list = cat.items.filter(function (it) {
      if (it.slot !== slot) return false;
      var hay = (it.name + ' ' + it.brand + ' ' + it.type).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    });
    box.innerHTML = '<div class="bd-pick-head"><button type="button" class="bd-link bd-back">← Back to your bag</button>' +
      '<h2>' + (transfer ? 'Transfer: ' : 'Pick your ') + esc(label.toLowerCase()) + '</h2>' +
      '<p>You can spend up to <b>' + money(room) + '</b> on this slot. Prices are today’s lowest new UK prices.</p>' +
      '<label class="bd-search"><input type="search" aria-label="Search ' + esc(label.toLowerCase()) + '" placeholder="Search ' + esc(label.toLowerCase()) + ' by name or brand" value="' + esc(search) + '"></label></div>' +
      '<ul class="bd-list">' + list.map(function (it) {
        var over = it.price > room + 0.001;
        return '<li class="bd-item' + (over ? ' is-over' : '') + '"><span class="bd-item-pic">' + img(it.image, '') + '</span>' +
          '<span class="bd-item-text"><b>' + esc(it.name) + '</b><span class="bd-note">' + esc(it.note) + '</span>' +
          '<a href="/prices/' + it.slug + '/?utm_source=bagdraft&amp;utm_medium=picker" target="_blank" rel="noopener">Price history</a></span>' +
          '<span class="bd-item-buy"><b>' + money(it.price) + '</b>' + (it.low ? '<span class="bd-low">Lowest tracked</span>' : '') +
          '<button type="button" class="gp-af-btn" data-slug="' + it.slug + '"' + (over ? ' disabled' : '') + '>' + (over ? 'Over budget' : 'Pick') + '</button></span></li>';
      }).join('') + (list.length ? '' : '<li class="bd-empty">Nothing matches that. Try a brand name.</li>') + '</ul>';
    box.querySelector('.bd-back').addEventListener('click', function () { view = state.mine && transfer ? 'home' : 'build'; render(); top(); });
    var inp = box.querySelector('.bd-search input');
    inp.addEventListener('input', function () { search = inp.value; var pos = inp.selectionStart; picker(); var i2 = box.querySelector('.bd-search input'); i2.focus(); try { i2.setSelectionRange(pos, pos); } catch (e) {} });
    box.querySelectorAll('.bd-item button').forEach(function (b) { b.addEventListener('click', function () {
      var slug = b.getAttribute('data-slug');
      if (transfer) return doTransfer(slot, slug);
      wip.picks[slot] = slug; put('gpDraftWip', wip);
      view = 'build'; render(); top();
    }); });
  }

  /* ---------------------------------------------------------- your bag */
  function myBag() {
    var m = major(), me = state.mine, ph = state.phase, nat = state.national || {};
    var was = me.picks.reduce(function (t, p) { return t + p.price; }, 0), now = me.picks.reduce(function (t, p) { return t + p.now; }, 0);
    var diff = Math.round(was - now);
    var line = diff > 0 ? 'Your bag is worth ' + money(diff, 0) + ' less than when you drafted it' : diff < 0 ? 'Your bag has gone up ' + money(-diff, 0) + '. Prices, eh.' : 'Your bag hasn’t moved yet. Patience, grasshopper.';
    var drops = me.picks.filter(function (p) { return p.now < p.price - 0.5 && p.lock == null; });
    box.innerHTML = '<div class="bd-hero" style="background:' + m.colour + '">' +
      '<div class="bd-hero-art">' + img(m.art, '') + '</div>' +
      '<div class="bd-hero-text"><span class="bd-kicker" style="color:' + m.accent + '">' + esc(m.name) + (ph.revealed ? '' : ' · Bags sealed until the 8th') + '</span>' +
      '<h1>' + line + '</h1><p>' + (diff > 0 ? 'In this game, that’s a very good thing. ' : '') + '<b>' + pts(me.total) + '</b>' +
      (nat.rank ? ' · ' + ord(nat.rank) + ' of ' + nat.count + ' in the country' : '') + '.</p>' +
      '<p class="bd-small">Prices update every 6 hours. You’re drafting as ' + esc(me.nick) + '.</p></div></div>' +
      '<section class="bd-card"><div class="bd-card-head"><h2>Your six</h2><span>' + money(was) + ' drafted · ' + money(cat.budget - was) + ' left</span></div><ul class="bd-mine">' +
      me.picks.map(function (p) {
        var label = cat.slots.filter(function (s) { return s.key === p.slot; })[0].label, locked = p.lock != null;
        return '<li class="' + (p.pts > 0 ? 'is-up' : '') + '"><span class="bd-slot-pic">' + img(p.image, '') + '</span>' +
          '<span class="bd-mine-text"><span class="bd-slot-label">' + esc(label) + (locked ? ' · locked in' : '') + '</span><b>' + esc(p.name) + '</b>' +
          '<span class="bd-note">Drafted ' + money(p.price) + ' · now ' + money(p.now) + (p.low && !locked ? ' · lowest we’ve tracked, +10' : '') + '</span>' +
          (locked ? '' : '<span class="bd-mine-acts">' + (!me.locked && !ph.over ? '<button type="button" class="bd-link" data-lock="' + p.slot + '">Lock it in</button>' : '') +
            (ph.canTransfer && !me.transferUsed ? '<button type="button" class="bd-link" data-swap="' + p.slot + '">Transfer</button>' : '') + '</span>') +
          '</span><b class="bd-pts ' + (p.pts > 0 ? 'up' : p.pts < 0 ? 'down' : '') + '">' + pts(p.pts) + '</b></li>';
      }).join('') + '</ul>' +
      '<p class="bd-small bd-pad">' + (me.banked ? 'Banked from transfers: ' + pts(me.banked) + '. ' : '') +
      'One transfer a week' + (me.transferUsed ? ' (used this week)' : ph.canTransfer ? '' : ' (from the 8th)') + ', one lock per Major' + (me.locked ? ' (used)' : '') + '. Choose wisely, like a 2-iron.</p>' +
      (ph.canEdit ? '<div class="bd-pad"><button type="button" class="bd-btn2 bd-redraft">Redraft my bag</button></div>' : '') +
      '<div class="bd-pad"><button type="button" class="gp-af-btn bd-share">Share my bag</button></div></section>' +
      drops.map(function (p) {
        var slug = (p.slug || ''), d = Math.round(p.price - p.now);
        return '<section class="bd-drop"><b>Your ' + esc(SLOT_WORD[p.slot]) + ' pick just dropped ' + money(d, 0) + '</b><span>The ' + esc(p.name) + ' is ' + money(p.now) +
          ' across multiple UK retailers. If you actually fancy owning it, now’s a genuinely good time.</span>' +
          '<span class="bd-drop-links"><a href="/prices/' + slug + '/?utm_source=bagdraft&amp;utm_medium=drop">See today’s prices</a><a href="/prices/' + slug + '/?utm_source=bagdraft&amp;utm_medium=drop#price-alert">Email me if it drops again</a></span></section>';
      }).join('') +
      '<section class="bd-card" id="bd-leagues"><div class="bd-card-head"><h2>Your leagues</h2></div><div class="bd-pad bd-small">Loading…</div></section>' +
      '<section class="bd-card"><div class="bd-card-head"><h2>National leaderboard</h2><span>' + (nat.count || 0) + ' bags</span></div><ol class="bd-table">' +
      (nat.top || []).map(function (r, i) { return '<li class="' + (r.you ? 'is-you' : '') + '"><b>' + (i + 1) + '</b><span>' + esc(r.nick) + (r.you ? ' (you)' : '') + '</span><b>' + pts(r.pts) + '</b></li>'; }).join('') +
      '</ol></section>';
    box.querySelectorAll('[data-lock]').forEach(function (b) { b.addEventListener('click', function () {
      var slot = b.getAttribute('data-lock');
      if (!window.confirm('Lock in your ' + SLOT_WORD[slot] + ' pick? Its points are banked for good, and you only get one lock this Major.')) return;
      api('/draft/lock', { pid: pid(), season: season(), slot: slot }).then(function (r) { if (!r.ok) window.alert(r.error); track('bag_draft_lock'); load(); });
    }); });
    box.querySelectorAll('[data-swap]').forEach(function (b) { b.addEventListener('click', function () {
      pickSlot = b.getAttribute('data-swap'); transfer = true; search = ''; view = 'pick'; render(); top();
    }); });
    var rd = box.querySelector('.bd-redraft'); if (rd) rd.addEventListener('click', function () {
      wip = { season: season(), picks: {} }; me.picks.forEach(function (p) { wip.picks[p.slot] = p.slug; }); put('gpDraftWip', wip);
      view = 'build'; render(); top();
    });
    box.querySelector('.bd-share').addEventListener('click', shareBag);
    leagues();
  }

  function doTransfer(slot, slug) {
    var it = by[slug];
    if (!window.confirm('Transfer in the ' + it.name + ' at ' + money(it.price) + '? Your old pick’s points are banked, and that’s your transfer for this week.')) return;
    api('/draft/transfer', { pid: pid(), season: season(), slot: slot, slug: slug }).then(function (r) {
      if (!r.ok) { window.alert(r.error); return; }
      track('bag_draft_transfer'); view = 'home'; load(); top();
    });
  }

  function leagues() {
    var el = document.getElementById('bd-leagues');
    api('/pp/my?pid=' + pid()).then(function (d) {
      var mine = (d && d.leagues) || [];
      if (!mine.length) {
        el.querySelector('.bd-pad').innerHTML = 'You’re not in a league yet. Leagues are shared with <a href="/play/par-price/">Par Price</a>: finish a round, start one, and send the link to the group chat. Everyone in it shows up here.';
        return;
      }
      return Promise.all(mine.map(function (l) { return api('/draft/league?l=' + l.id + '&pid=' + pid() + '&season=' + season()); })).then(function (rs) {
        el.innerHTML = '<div class="bd-card-head"><h2>Your leagues</h2>' + (state.phase.revealed ? '' : '<span>Bags revealed on the 8th</span>') + '</div>' + rs.map(function (r) {
          if (!r.ok) return '';
          return '<div class="bd-league"><h3><a href="/play/league/?l=' + r.id + '">' + esc(r.name) + '</a></h3><ol class="bd-table">' + r.members.map(function (m, i) {
            return '<li class="' + (m.you ? 'is-you' : '') + '"><b>' + (m.drafted ? i + 1 : '–') + '</b><span>' + esc(m.nick) + (m.you ? ' (you)' : '') +
              (m.drafted ? (m.picks && !m.you ? '<small>' + m.picks.map(function (p) { return esc(p.name); }).join(' · ') + '</small>' : state.phase.revealed || m.you ? '' : '<small>Bag sealed</small>') : '<small>No bag yet. Nudge them.</small>') +
              '</span><b>' + (m.drafted ? pts(m.pts) : '') + '</b></li>';
          }).join('') + '</ol></div>';
        }).join('');
      });
    }).catch(function () { el.hidden = true; });
  }

  /* ---------------------------------------------------------- share card */
  function shareBag() {
    var m = major(), me = state.mine;
    var text = 'My ' + m.name + ' bag on GolfPrice AI: ' + pts(me.total) + ' so far ⛳\n' +
      me.picks.map(function (p) { return '• ' + p.name; }).join('\n') + '\nThink you can draft better? https://golfpriceai.com/play/draft/';
    track('bag_draft_share');
    drawCard(m, me).then(function (file) { share(text, file ? [file] : null); }, function () { share(text); });
  }
  function share(text, files) {
    if (files && navigator.canShare && navigator.canShare({ files: files })) return navigator.share({ files: files, text: text }).catch(function () {});
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  function drawCard(m, me) {
    return new Promise(function (ok, no) {
      var bag = new Image();
      bag.onload = function () {
        try {
          var c = document.createElement('canvas'); c.width = 1200; c.height = 630;
          var g = c.getContext('2d');
          g.fillStyle = m.colour; g.fillRect(0, 0, 1200, 630);
          g.drawImage(bag, 60, 60, 330, 516);
          g.fillStyle = m.accent; g.font = '700 22px Inter, sans-serif'; g.fillText(('The Bag Draft · ' + me.nick).toUpperCase(), 440, 92);
          g.fillStyle = '#fff'; g.font = '800 46px Poppins, sans-serif'; g.fillText(fit(g, m.name, 700), 440, 150);
          me.picks.forEach(function (p, i) {
            var y = 210 + i * 50;
            g.fillStyle = '#ffffff'; g.font = '600 24px Inter, sans-serif'; g.fillText(fit(g, p.name, 560), 440, y);
            g.fillStyle = p.pts > 0 ? '#8fd77e' : p.pts < 0 ? '#f3c47e' : '#c9cdca'; g.font = '800 24px Poppins, sans-serif';
            var s = pts(p.pts); g.fillText(s, 1140 - g.measureText(s).width, y);
          });
          g.fillStyle = m.accent; g.font = '800 40px Poppins, sans-serif'; g.fillText(pts(me.total), 440, 540);
          g.fillStyle = '#fff'; g.font = '600 22px Inter, sans-serif'; var u = 'golfpriceai.com/play/draft'; g.fillText(u, 1140 - g.measureText(u).width, 540);
          c.toBlob(function (b) { b ? ok(new File([b], 'my-bag-draft.png', { type: 'image/png' })) : no(); }, 'image/png');
        } catch (e) { no(e); }
      };
      bag.onerror = no;
      bag.src = m.art;
    });
  }
  function fit(g, s, w) { s = String(s); while (g.measureText(s).width > w && s.length > 3) s = s.slice(0, -2) + '…'; return s; }
  function top() { var y = box.getBoundingClientRect().top + window.pageYOffset - 84; if (window.pageYOffset > y) window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); }
})();
