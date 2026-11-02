"""/prices/used/ — "Used golf club prices UK": every model we have a price
page for that also has used or ex-demo stock on sale, with the lowest new
price next to the cheapest and typical used price. Rebuilt every 6 hours.
Each row links to the model page's "New or used?" section.
"""
from price_pages import PRICES_DIR, SITE, TYPES, breadcrumb, esc, method_note, money, page_shell, plural, _write

ORDER = ["driver", "wood", "hybrid", "irons", "single-iron", "wedge", "putter", "set", "bag"]
CSS = '<link rel="stylesheet" href="/css/used.css?v=20261102a">\n'


def rows_for(models, built):
    out = []
    for m in models:
        u = m.get("used")
        if m["slug"] not in built or not u or not u.get("count") or m["type"] not in ORDER:
            continue
        out.append(m)
    return out


def build(models, built, today):
    rows = rows_for(models, built)
    if len(rows) < 10:
        return [], []
    by = {}
    for m in rows:
        by.setdefault(m["type"], []).append(m)
    total = sum(m["used"]["count"] for m in rows)
    chips, sections = [], []
    for t in ORDER:
        ms = sorted(by.get(t, []), key=lambda m: (-m["used"]["count"], m["name"]))
        if not ms:
            continue
        label = TYPES[t][1]
        anchor = TYPES[t][0]
        chips.append(f'<a class="pp-chip" href="#{anchor}">{esc(label)} ({len(ms)})</a>')
        trs = []
        for m in ms:
            u = m["used"]
            save = m["minPrice"] - u["min"]
            pill = f'<span class="ug-save">−{round(save / m["minPrice"] * 100)}%</span>' if save >= 1 else ""
            trs.append(f"""<tr data-n="{esc(m['name'].lower())}"><th scope="row"><a href="/prices/{m['slug']}/#new-or-used">{esc(m['name'])}</a></th>
<td>{money(m['minPrice'])}</td><td class="ug-used">{money(u['min'])}{pill}</td><td>{money(u['median'])}</td><td>{u['count']}</td></tr>""")
        sections.append(f"""<section class="pp-block ug-sec" id="{anchor}">
  <h2>Used {esc(label.lower())}</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table ug-table">
  <thead><tr><th scope="col">Model</th><th scope="col">New from</th><th scope="col">Used from</th><th scope="col">Typical used</th><th scope="col">For sale</th></tr></thead>
  <tbody>{''.join(trs)}</tbody></table></div>
</section>""")
    top = max(rows, key=lambda m: m["used"]["count"])
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Used golf club prices", None)])
    answer = (f"<strong>{plural(total, 'used or ex-demo club')}</strong> on sale today across {plural(len(rows), 'model')} we track, "
              f"from multiple UK retailers, each next to its lowest new price. The most for sale: the {esc(top['name'])}, "
              f"{top['used']['count']} used from {money(top['used']['min'])} (new from {money(top['minPrice'])}).")
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Used golf club price guide · updated every 6 hours</span>
  <h1>Used golf club prices UK: what’s a used club worth?</h1>
  <p class="pp-answer">{answer}</p>
  <label class="ug-find"><span class="pp-small">Find a club</span><input type="search" id="ug-q" placeholder="e.g. Qi35 driver, G430 hybrid" autocomplete="off"></label>
  <div class="ug-chips">{''.join(chips)}</div>
  <p class="pp-disclose">“Typical used” is the middle price of every used and ex-demo listing on sale today. Tap a model for its full used price guide and a hand, loft and flex finder.</p>
</section>
{''.join(sections)}
<p class="pp-small" id="ug-none" hidden>No model matches that search. Try a shorter name, like “Qi35”.</p>
<section class="pp-block"><div class="pp-chips"><a class="pp-chip" href="/shop.html?source=awin-callawaypreowned">Shop all preowned clubs</a><a class="pp-chip" href="/prices/drops/">Price drops today</a><a class="pp-chip" href="/prices/">All price guides</a></div></section>
{method_note(today)}
</div>
<script>
(function () {{
  var q = document.getElementById('ug-q'); if (!q) return;
  q.addEventListener('input', function () {{
    var w = q.value.trim().toLowerCase().split(/\\s+/).filter(Boolean), any = false;
    document.querySelectorAll('.ug-sec').forEach(function (sec) {{
      var shown = 0;
      sec.querySelectorAll('tbody tr').forEach(function (tr) {{
        var n = tr.getAttribute('data-n'), ok = w.every(function (x) {{ return n.indexOf(x) !== -1; }});
        tr.hidden = !ok; if (ok) shown++;
      }});
      sec.hidden = !shown; if (shown) any = true;
    }});
    document.getElementById('ug-none').hidden = any;
  }});
}})();
</script>"""
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": "Used golf club prices UK",
                 "numberOfItems": len(rows),
                 "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": m["name"], "url": f"{SITE}/prices/{m['slug']}/"}
                                     for i, m in enumerate(sorted(rows, key=lambda m: -m["used"]["count"])[:50])]}
    html_ = page_shell(title="Used Golf Club Prices UK: What’s My Club Worth? | GolfPrice AI",
                       description=(f"{total:,} used and ex-demo golf clubs on sale today across {len(rows)} models: cheapest and typical used "
                                    f"price next to the lowest new price. Drivers, woods, hybrids, irons, wedges and putters. Updated every 6 hours."),
                       canonical=f"{SITE}/prices/used/", body=body, section="", schema=[item_list, crumbs_schema],
                       noindex=False, extra_head=CSS)
    changed = ["/prices/used/"] if _write(PRICES_DIR / "used" / "index.html", html_) else []
    return changed, [("prices/used/", today.isoformat())]
