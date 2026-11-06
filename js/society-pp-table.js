/* Society v Society (/societies/par-price/): each golf society's Par Price week,
   the average of its best four members. Data from the alerts worker. */
(function () {
  var API = 'https://golfpriceai-alerts.golfpriceai.workers.dev';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function avg(t) { t = Math.round(Number(t) * 100) / 100; return t === 0 ? 'E' : t < 0 ? '−' + Math.abs(t) : '+' + t; }
  function rows(list) {
    return list.map(function (x, i) {
      return '<li class="' + (i === 0 ? 'top' : '') + '"><span class="spp-pos">' + x.pos + '</span><span class="spp-name">' + esc(x.name) + (x.area ? '<small>' + esc(x.area) + '</small>' : '') + '</span>' +
        '<span class="spp-n">' + x.played + ' played</span><b' + (x.avg > 0 ? ' class="over"' : '') + '>' + avg(x.avg) + '</b></li>';
    }).join('');
  }
  var sub = document.getElementById('spp-sub'), table = document.getElementById('spp-table');
  fetch(API + '/soc/ppnat').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) throw new Error();
    var left = d.daysLeft === 0 ? 'last day' : d.daysLeft === 1 ? '1 day left' : d.daysLeft + ' days left';
    if (d.table.length) {
      document.getElementById('spp-h').textContent = d.table[0].name + ' lead the week';
      sub.textContent = d.table.length + (d.table.length === 1 ? ' society' : ' societies') + ' on the table · ' + left + ' · score = average of the best ' + d.team + ' members';
      table.innerHTML = rows(d.table);
    } else {
      sub.textContent = 'No society has four members playing yet this week (' + left + '). Yours could be first.';
    }
    if (d.last && d.last.length) {
      document.getElementById('spp-last').innerHTML = rows(d.last);
      document.getElementById('spp-last-card').hidden = false;
    }
  }).catch(function () { sub.textContent = 'We couldn’t reach the clubhouse. Please refresh in a minute.'; });
})();
