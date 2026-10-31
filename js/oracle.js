/* The Oracle board (/play/oracle/): Crowd Caddie's tables, the crowd's record,
   the biggest open calls and this browser's own calls, from /cc/board. */
(function () {
  'use strict';
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WORD = { down: 'Cheaper', same: 'Holds', up: 'Pricier' };
  function $(id) { return document.getElementById(id); }
  function get(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function put(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private tab */ } }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function money(n) { return '£' + Number(n).toFixed(2); }
  function short(d) { var p = String(d).split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1].slice(0, 3); }
  function pct(a, n) { return n ? Math.round(a / n * 100) : 0; }
  function num(n) { return Number(n || 0).toLocaleString('en-GB'); }
  function gpUse(k) { try { var d = new Date().toISOString().slice(0, 10), key = 'gpUse_' + k; if (localStorage.getItem(key) === d) return; localStorage.setItem(key, d); fetch(API + '/use', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k: k }), keepalive: true }).catch(function () {}); } catch (e) { /* fine */ } }
  gpUse('oracle_view');

  var data = null, tab = 'top';
  function rows(list) {
    if (!list || !list.length) {
      var firstDue = data && data.crowd && data.crowd.firstDue;
      return '<p class="or-empty">' + (data && data.crowd && !data.crowd.everN && firstDue
        ? 'The first calls settle on ' + short(firstDue) + '. Make yours on any <a href="/prices/">price page</a> and add a nickname to get on the board.'
        : 'Nobody’s on this board yet. Five settled calls and a nickname gets you on it.') + '</p>';
    }
    return list.map(function (x, i) {
      return '<div class="or-row' + (x.me ? ' or-me' : '') + '"><span class="or-pos' + (i < 3 ? ' p' + (i + 1) : '') + '">' + (i + 1) + '</span>' +
        '<span class="or-who"><b>' + esc(x.nick) + (x.me ? ' (you)' : '') + '</b><small>' + x.r + ' of ' + x.n + ' right</small></span><span class="or-pct">' + pct(x.r, x.n) + '%</span></div>';
    }).join('');
  }
  function drawBoard() { $('or-board').innerHTML = rows(data ? data[tab] : []); }
  function drawYou(me) {
    var el = $('or-you');
    if (!me || !me.calls || !me.calls.length) return;
    var m = me.month, e = me.ever, need = Math.max(0, data.min - m.n);
    var waiting = me.calls.filter(function (c) { return !c.outcome; }).length;
    var who = me.nick ? esc(me.nick) + ': ' : 'You: ';
    var head = '<div class="or-you-top"><span><b>' + who + (m.n ? m.r + ' of ' + m.n + ' right this month' : waiting + (waiting === 1 ? ' call' : ' calls') + ' waiting on the price') + '</b></span>' + (m.n ? '<span class="or-big">' + pct(m.r, m.n) + '%</span>' : '') + '</div>';
    var line = me.rank ? 'You’re ' + me.rank + (me.rank === 1 ? 'st' : me.rank === 2 ? 'nd' : me.rank === 3 ? 'rd' : 'th') + ' on this month’s board.'
      : !me.nick ? 'Add a nickname to get on the board.'
      : need ? (need === 1 ? 'One more settled call' : need + ' more settled calls') + ' this month to get on the board.' : '';
    if (e.n > m.n) line += (line ? ' ' : '') + 'All time: ' + e.r + ' of ' + e.n + '.';
    var nickForm = '<form class="cc-nick" id="or-nick" novalidate><label for="or-nick-in">' + (me.nick ? 'Change your nickname' : 'Your nickname for the board') + '</label>' +
      '<div class="cc-nick-row"><input id="or-nick-in" name="nick" maxlength="20" autocomplete="nickname" placeholder="e.g. Fairway Prophet" value="' + esc(me.nick || get('gpNick', '') || '') + '"><button type="submit" class="cc-btn cc-btn-dark">Save</button></div><p class="cc-msg" role="status"></p></form>';
    var list = '<ul class="or-calls">' + me.calls.map(function (c, i) {
      var tag = !c.outcome ? '<span class="or-tag">Result ' + short(c.due) + '</span>'
        : c.outcome === 'void' ? '<span class="or-tag">Didn’t count</span>'
        : c.hit ? '<span class="or-tag or-hit">Called it</span>' : '<span class="or-tag or-miss">' + (c.outcome === 'down' ? 'It dropped' : c.outcome === 'up' ? 'It rose' : 'It held') + '</span>';
      var detail = WORD[c.call] + ' at ' + money(c.price) + (c.outcome && c.outcome !== 'void' ? ', then ' + money(c.result) : '');
      return '<li><span><a href="/prices/' + esc(c.slug) + '/#crowd-caddie">' + esc(c.name) + '</a><small>' + detail + '</small>' +
        (c.hit ? '<button type="button" class="or-card-btn" data-card="' + i + '">Get the card</button>' : '') + '</span>' + tag + '</li>';
    }).join('') + '</ul>';
    el.innerHTML = head + (line ? '<p class="cc-small">' + line + '</p>' : '') + nickForm + list;
    el.querySelectorAll('[data-card]').forEach(function (b) {
      b.addEventListener('click', function () {
        var c = me.calls[+b.getAttribute('data-card')];
        gpUse('cc_share');
        loadMs().then(function (ms) { ms.open({ kind: 'called', date: c.due, d: { name: c.name, call: c.call, from: c.price, to: c.result, slug: c.slug, day: c.due } }, false); });
      });
    });
    var f = $('or-nick');
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var nick = f.nick.value.trim(), msg = f.querySelector('.cc-msg');
      if (nick.length < 2) { msg.textContent = 'Pick a nickname (at least 2 letters).'; return; }
      fetch(API + '/cc/nick', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: get('gpPid', ''), nick: nick }) })
        .then(function (r) { return r.json(); }).then(function (r) {
          if (!r.ok) { msg.textContent = r.error || 'Something went wrong.'; return; }
          put('gpCcNick', r.nick); if (!get('gpNick', '')) put('gpNick', r.nick);
          msg.textContent = 'Saved.'; load();
        }).catch(function () { msg.textContent = 'Couldn’t save that just now. Please try again.'; });
    });
  }
  var ms = null;
  function loadMs() {
    if (window.gpMilestones) return Promise.resolve(window.gpMilestones);
    if (!ms) ms = new Promise(function (ok, no) { var s = document.createElement('script'); s.src = '/js/milestones.js?v=20261101'; s.onload = function () { ok(window.gpMilestones); }; s.onerror = no; document.head.appendChild(s); });
    return ms;
  }
  function drawHot(hot) {
    if (!hot || !hot.length) return;
    $('or-hot').innerHTML = hot.map(function (h) {
      var top = [['down', h.down, 'cheaper'], ['same', h.same, 'holds'], ['up', h.up, 'pricier']].sort(function (a, b) { return b[1] - a[1]; })[0];
      return '<a href="/prices/' + esc(h.slug) + '/#crowd-caddie"><span>' + esc(h.name) + '</span><b>' + pct(top[1], h.n) + '% ' + top[2] + '</b></a>';
    }).join('');
  }
  function load() {
    var p = get('gpPid', '');
    fetch(API + '/cc/board' + (/^[a-z0-9]{12,32}$/.test(p) ? '?pid=' + p : '')).then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.ok) throw new Error('no');
      data = d;
      var c = d.crowd, mo = d.month.split('-');
      $('or-month').textContent = MONTHS[+mo[1] - 1].toUpperCase();
      document.querySelector('[data-or="acc"]').textContent = c.n ? pct(c.r, c.n) + '%' : '–';
      document.querySelector('[data-or="settled"]').textContent = num(c.n);
      document.querySelector('[data-or="open"]').textContent = num(c.open);
      drawBoard(); drawHot(d.hot); drawYou(d.me);
    }).catch(function () { $('or-board').innerHTML = '<p class="or-empty">The board is taking a breather. Please try again in a minute.</p>'; });
  }
  document.querySelectorAll('.or-tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      tab = b.getAttribute('data-tab');
      document.querySelectorAll('.or-tabs button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      drawBoard();
    });
  });
  load();
})();
