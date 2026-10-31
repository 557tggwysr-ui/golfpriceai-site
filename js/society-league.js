/* The National Society League (/societies/league/). The regions and their
   divisions, Society of the Month, and a division's table (?r=<region>&d=<n>),
   live from the alerts worker (/lg/...). Society names only, never members. */
(function () {
  'use strict';
  var root = document.getElementById('nsl');
  if (!root) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function ord(n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function track(n, p) { try { if (window.gtag) window.gtag('event', n, p || {}); } catch (e) { /* fine */ } }
  function share(text) {
    if (navigator.share) return navigator.share({ text: text }).catch(function () {});
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }
  var q = new URLSearchParams(location.search), region = q.get('r'), div = Number(q.get('d')) || 1;

  function home(d) {
    var set = function (k, v) { var el = root.querySelector('[data-nsl="' + k + '"]'); if (el) el.textContent = v; };
    set('total', Number(d.total).toLocaleString('en-GB'));
    if (d.open) { set('open', 'Open'); set('openl', 'entries for ' + d.season); }
    $('nsl-regions').innerHTML = d.regions.map(function (r) {
      var ds = r.divisions.length ? r.divisions : [1];
      return '<li><a href="?r=' + encodeURIComponent(r.region) + '&amp;d=' + ds[0] + '"><b>' + esc(r.region) + '</b><small>' +
        (r.societies ? r.societies + (r.societies === 1 ? ' society' : ' societies') + ' · ' + r.divisions.length + (r.divisions.length === 1 ? ' division' : ' divisions') : 'Be the first society here') + '</small></a></li>';
    }).join('');
    if (d.sotm) {
      var m = d.sotm.month.split('-'), el = $('nsl-sotm');
      el.innerHTML = '<span class="cc-kick cc-kick-dark nsl-orange">SOCIETY OF THE MONTH · ' + MONTHS[+m[1] - 1].toUpperCase() + '</span><b class="pb-vs-h">' + esc(d.sotm.name) + '</b>' +
        '<span class="pb-vs-p">Best team score in the country: ' + d.sotm.score.toFixed(2) + ', the average of their best four. ' + esc(d.sotm.region) + ' Division ' + d.sotm.division + '.</span>' +
        '<a class="nsl-link-l" href="?r=' + encodeURIComponent(d.sotm.region) + '&amp;d=' + d.sotm.division + '">See the table →</a>';
      el.hidden = false;
    }
  }

  function table(t) {
    var main = $('nsl-main'), n = t.rows.length;
    var form = function (f) { return f.map(function (p) { return '<span class="fg-chip' + (p === 1 ? ' fg-win' : '') + '">' + (p ? ord(p) : '–') + '</span>'; }).join(''); };
    var rows = t.rows.map(function (r, i) {
      var zone = n >= 6 && i === 1 ? ' nsl-up' : n >= 6 && i === n - 3 ? ' nsl-down' : '';
      return '<div class="nsl-row' + zone + (r.champion ? ' nsl-champ' : '') + '"><b class="nsl-pos">' + r.pos + '</b><span class="nsl-name"><b>' + esc(r.name) + (r.champion ? ' · Champions' : '') + '</b><small>' +
        (r.played ? r.played + (r.played === 1 ? ' month' : ' months') : 'No matchdays yet') + (r.allowance === 100 ? ' · 100% allowance, 1 pt adjusted' : '') + '</small></span>' +
        '<span class="nsl-form">' + form(r.form) + '</span><span class="nsl-avg">' + (r.avg == null ? '–' : r.avg.toFixed(2)) + '</span><b class="nsl-pts">' + r.pts + '</b></div>';
    }).join('');
    main.outerHTML = '<div class="nsl-div" id="nsl-main">' +
      '<p class="nsl-back"><a href="/societies/league/">← All regions</a></p>' +
      '<section class="or-card"><div class="or-head"><h2>' + esc(t.region) + ' · Division ' + t.division + '</h2><span class="pb-dim">' + t.season + ' season · ' + (t.months ? t.months + (t.months === 1 ? ' month played' : ' months played') : 'first matchday in April') + '</span></div>' +
      (n ? '<div class="nsl-row nsl-head"><span>#</span><span>Society</span><span class="nsl-form">Form</span><span class="nsl-avg">Avg</span><span class="nsl-pts">Pts</span></div>' + rows +
        '<p class="pb-dim nsl-key">' + (n >= 6 ? 'Above the green line: promotion. Below the orange line: relegation. ' : '') + 'Avg = the team score (best four) averaged over the months played.</p>'
        : '<p class="or-empty">No societies in this division yet. Enter yours from Society HQ and it’s yours to win.</p>') + '</section>' +
      (t.note ? '<section class="or-card pb-vs"><span class="cc-kick cc-kick-dark">THE LATEST MATCHDAY</span><span class="pb-vs-p">' + esc(t.note) + '</span></section>' : '') +
      '<div class="nsl-btns"><button type="button" class="cc-btn" id="nsl-share">Share the table</button><a class="nsl-ghost nsl-ghost-d" href="/societies/hq/">Enter your society</a></div></div>';
    document.title = t.region + ' Division ' + t.division + ' | National Society League | GolfPrice AI';
    var b = $('nsl-share');
    if (b) b.onclick = function () {
      track('league_share');
      var top = t.rows[0];
      share('The National Society League, ' + t.region + ' Division ' + t.division + (top && top.played ? ': ' + top.name + ' top with ' + top.pts + ' points.' : '.') + ' See the table: ' + location.href);
    };
  }

  if (region) {
    fetch(API + '/lg/div?r=' + encodeURIComponent(region) + '&d=' + div).then(function (r) { return r.json(); }).then(function (t) {
      if (!t.ok) throw new Error(t.error);
      table(t);
    }).catch(function () { var r = $('nsl-regions'); if (r) r.insertAdjacentHTML('beforebegin', '<p class="or-empty">We couldn’t find that division. Pick your region below.</p>'); });
  }
  fetch(API + '/lg/home').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) return;
    if ($('nsl-regions')) return home(d);
    var set = function (k, v) { var el = root.querySelector('[data-nsl="' + k + '"]'); if (el) el.textContent = v; };
    set('total', Number(d.total).toLocaleString('en-GB'));
    if (d.open) { set('open', 'Open'); set('openl', 'entries for ' + d.season); }
  }).catch(function () {});
})();
