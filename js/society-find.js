/* GolfPrice AI: Find a Society (/societies/find/). Lists societies whose
   organiser ticked "Open to new members": name, area, description, size. */
(function () {
  'use strict';
  var box = document.getElementById('fd'), q = document.getElementById('fd-q');
  if (!box) return;
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev', all = [];
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function show() {
    var t = (q && q.value || '').trim().toLowerCase();
    var list = all.filter(function (s) { return !t || (s.name + ' ' + (s.area || '') + ' ' + (s.about || '')).toLowerCase().indexOf(t) >= 0; });
    if (!all.length) { box.innerHTML = '<div class="soc-card"><p class="soc-help">No societies are listed yet. Run one? Be the first: it’s free.</p></div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="soc-card"><p class="soc-help">No listed societies match “' + esc(t) + '” yet. Try a nearby town or your county.</p></div>'; return; }
    box.innerHTML = '<div class="fd-list">' + list.map(function (s) {
      return '<article class="soc-card fd-card"><span class="fd-meta">' + esc(s.area || 'UK') + ' · ' + s.members + (s.members === 1 ? ' member' : ' members') + '</span><h2>' + esc(s.name) + '</h2>' +
        (s.about ? '<p>' + esc(s.about) + '</p>' : '') + '<div class="fd-foot"><a class="soc-btn" href="/societies/hq/?s=' + esc(s.id) + '">Have a look</a>' +
        '<a class="fd-report" href="mailto:hello@golfpriceai.com?subject=' + encodeURIComponent('Report a society listing: ' + s.name + ' (' + s.id + ')') + '&body=' + encodeURIComponent('What’s wrong with this listing?\n\n') + '">Report this listing</a></div></article>';
    }).join('') + '</div>';
  }
  fetch(API + '/soc/find').then(function (r) { return r.json(); }).then(function (d) { all = (d && d.societies) || []; show(); })
    .catch(function () { box.innerHTML = '<div class="soc-card"><p class="soc-help">We couldn’t reach the clubhouse. Please refresh in a minute.</p></div>'; });
  if (q) q.addEventListener('input', show);
})();
