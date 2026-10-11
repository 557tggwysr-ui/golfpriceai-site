/* Homepage "Most compared this week" and "Where prices are heading".
   Data comes from data/home-popular.json (scripts/most_compared.py) and
   data/home-pulse.json (scripts/home_pulse.py), both rebuilt every 6 hours.
   This file only draws them. */
(function () {
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(n) { return '£' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function track(name, params) { if (window.gtag) gtag('event', name, params); }

  /* ---------- Where prices are heading ---------- */
  var pulse = document.getElementById('pulse-grid');
  if (pulse) {
    fetch('/data/home-pulse.json').then(function (r) { return r.json(); }).then(function (d) {
      var tiles = d.tiles || [];
      if (!tiles.length) { document.getElementById('pulse').hidden = true; return; }
      pulse.innerHTML = tiles.map(function (t) {
        var n = t.compared || t.models;
        var f = n ? t.cheaper / n * 100 : 0, r = n ? t.dearer / n * 100 : 0;
        var said = t.cheaper + ' cheaper, ' + t.dearer + ' dearer';
        return '<a class="gp-pulse-tile" href="' + esc(t.hub) + '" data-type="' + esc(t.type) + '">' +
          '<img src="' + esc(t.photo) + '" alt="" loading="lazy" style="object-position:' + esc(t.pos) + '">' +
          '<span class="gp-pulse-in"><span class="gp-pulse-title">' + esc(t.label) + '</span>' +
          '<span class="gp-pulse-from">From <b>' + money(t.from) + '</b>' + esc(t.unit || '') + '<span class="gp-pulse-n"> · ' + t.models + ' models</span></span>' +
          '<span class="gp-pulse-bar" role="img" aria-label="' + said + '"><i class="is-f" style="width:' + f.toFixed(1) + '%"></i><i class="is-r" style="width:' + r.toFixed(1) + '%"></i></span>' +
          '<span class="gp-pulse-line"><span><b class="is-f">' + t.cheaper + ' cheaper</b> · <b class="is-r">' + t.dearer + ' dearer</b></span><span>2 weeks</span></span>' +
          '</span></a>';
      }).join('');
    }).catch(function () { document.getElementById('pulse').hidden = true; });
  }

  /* ---------- Most compared this week ---------- */
  var section = document.getElementById('popular');
  var list = document.getElementById('popular-list');
  var chips = document.getElementById('popular-chips');
  if (section && list) {
    fetch('/data/home-popular.json').then(function (r) { return r.json(); }).then(function (d) {
      var items = d.items || [];
      if (items.length < 8) return; // stays hidden until there's a fair top 8
      var filter = 'all';
      function move(x, i) {
        if (filter !== 'all') return '';
        if (!x.prev) return '<span class="gp-rank-mv is-new">New</span>';
        var m = x.prev - (i + 1);
        if (m > 0) return '<span class="gp-rank-mv is-up" aria-label="Up ' + m + '">▲ ' + m + '</span>';
        if (m < 0) return '<span class="gp-rank-mv" aria-label="Down ' + (-m) + '">▼ ' + (-m) + '</span>';
        return '<span class="gp-rank-mv" aria-label="No change">–</span>';
      }
      function render() {
        var rows = items.filter(function (x) { return filter === 'all' || x.group === filter; }).slice(0, 8);
        rows = rows.slice(0, rows.length - rows.length % 2); // two columns: even rows only
        list.innerHTML = rows.map(function (x, i) {
          return '<li><a class="gp-rank" href="/prices/' + esc(x.slug) + '/" data-slug="' + esc(x.slug) + '">' +
            '<span class="gp-rank-n">' + (i + 1) + '</span>' +
            '<span class="gp-rank-img"><img src="' + esc(x.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>' +
            '<span class="gp-rank-txt"><span class="gp-rank-name">' + esc(x.name) + '</span>' +
            '<span class="gp-rank-sub">Cheapest of ' + x.retailers + ' retailer' + (x.retailers === 1 ? '' : 's') + '</span></span>' +
            '<span class="gp-rank-pr"><strong>' + money(x.now) + (x.unit ? '<small>' + esc(x.unit) + '</small>' : '') + '</strong>' + move(x, i) + '</span>' +
            '</a></li>';
        }).join('');
      }
      var groups = {};
      items.forEach(function (x) { groups[x.group] = (groups[x.group] || 0) + 1; });
      Array.prototype.forEach.call(chips.querySelectorAll('button'), function (b) {
        var f = b.getAttribute('data-f');
        if (f !== 'all' && (groups[f] || 0) < 4) b.hidden = true;
        b.addEventListener('click', function () {
          filter = f;
          Array.prototype.forEach.call(chips.querySelectorAll('button'), function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
          render();
        });
      });
      render();
      section.hidden = false;
    }).catch(function () {});
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.gp-rank, .gp-pulse-tile');
    if (!a) return;
    if (a.classList.contains('gp-rank')) track('home_popular_click', { model: a.getAttribute('data-slug') });
    else track('home_pulse_click', { category: a.getAttribute('data-type') });
  });
})();
