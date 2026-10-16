/* GolfPrice AI — clothing price guide filters (/prices/golf-shoes/ etc.)
   The chips filter the drops table and the cards. "All" keeps the page's own
   order (men's first). Each list shows a set number, with "Show more" for
   the cards. Works without this script too: everything is in the page. */
(function () {
  var chips = document.querySelectorAll('.cg-chip');
  var lists = document.querySelectorAll('.cg-list');
  var more = document.querySelector('.cg-more');
  var filter = 'all', extra = 0;

  function matches(el) {
    if (filter === 'all') return true;
    if (filter === 'm') return el.getAttribute('data-aud') === 'm';
    if (filter === 'w') return el.getAttribute('data-aud') === 'w';
    return (' ' + el.getAttribute('data-tags') + ' ').indexOf(' ' + filter + ' ') !== -1;
  }

  function render() {
    lists.forEach(function (list) {
      var limit = parseInt(list.getAttribute('data-show'), 10) || 12;
      if (list.classList.contains('sg-grid')) limit += extra;
      var shown = 0, hiddenMatches = 0;
      list.querySelectorAll('.cg-item').forEach(function (el) {
        var ok = matches(el);
        var show = ok && shown < limit;
        el.hidden = !show;
        if (show) shown++;
        else if (ok) hiddenMatches++;
      });
      var block = list.closest('.pp-block');
      var none = block && block.querySelector('.cg-none');
      if (none) none.hidden = shown > 0;
      if (list.classList.contains('sg-grid') && more) more.hidden = hiddenMatches === 0;
    });
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      filter = chip.getAttribute('data-f');
      extra = 0;
      chips.forEach(function (c) {
        var on = c === chip;
        c.classList.toggle('sg-on', on);
        c.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      render();
      if (window.gtag) gtag('event', 'clothing_guide_filter', { filter: filter });
    });
  });
  if (more) more.addEventListener('click', function () { extra += 12; render(); });
  render();
})();
