"""Monthly "UK golf price watch": /prices/watch/

One edition per complete calendar month, built from our own price history:
how many models got cheaper or dearer, the median change, the biggest
genuine falls and rises, and a category table. Written for journalists and
bloggers to quote (with credit), and for the monthly note John sends.

An edition is written once, the first run after its month ends, then never
rewritten, so a figure someone has quoted never changes under them.
/prices/watch/ always shows the latest edition and lists the rest.
"""
import json
import statistics
from collections import defaultdict
from datetime import date, timedelta

from price_pages import PRICES_DIR, SITE, TYPES, breadcrumb, esc, long_date, method_note, money, page_shell, plural, _write
from seasonal_pages import daily_prices

WATCH_DIR = PRICES_DIR / "watch"
# October 2026 is the first month with the same set of retailers throughout
# (several joined in early September, which would read as price cuts).
FIRST_MONTH = date(2026, 10, 1)
MIN_POUNDS, MIN_PCT = 5.0, 0.03  # same bar as price alerts and the drops page


def month_end(m):
    return (m.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)


def month_name(m):
    return m.strftime("%B %Y")


def edition_facts(models, built, m):
    start, end = m, month_end(m)
    rows = []
    for x in models:
        if x["slug"] not in built:
            continue
        days = daily_prices(x.get("history"), end)
        a, b = days.get(start), days.get(end)
        if a is None or b is None or not a:
            continue
        if not 0.5 <= b / a <= 1.5:
            continue  # more likely a feed change than a real move; left out
        # A model whose lowest price moved because a retailer started selling
        # it this month is counted apart: that's wider choice, not a price cut.
        new_seller = any(e["kind"] == "new_listing" and start < date.fromisoformat(e["date"]) <= end
                         for e in x.get("events") or [])
        rows.append({"m": x, "a": a, "b": b, "chg": b - a, "pct": (b - a) / a * 100, "new": new_seller})
    if len(rows) < 20:
        return None
    sig = lambda r: abs(r["chg"]) >= max(MIN_POUNDS, r["a"] * MIN_PCT)
    fell = [r for r in rows if r["chg"] < 0 and sig(r) and not r["new"]]
    rose = [r for r in rows if r["chg"] > 0 and sig(r) and not r["new"]]
    cats = defaultdict(list)
    for r in rows:
        cats[r["m"]["type"]].append(r)
    return {
        "month": m.strftime("%Y-%m"), "name": month_name(m), "models": len(rows),
        "fell": len(fell), "rose": len(rose), "flat": len(rows) - len(fell) - len(rose),
        "median_pct": round(statistics.median(r["pct"] for r in rows), 1),
        "new_seller": sum(1 for r in rows if r["new"]),
        "top_falls": [_row(r) for r in sorted(fell, key=lambda r: r["pct"])[:6]],
        "top_rises": [_row(r) for r in sorted(rose, key=lambda r: -r["pct"])[:4]],
        "categories": [{"type": t, "label": TYPES[t][1], "hub": TYPES[t][0], "models": len(v),
                        "fell": sum(1 for r in v if r in fell), "rose": sum(1 for r in v if r in rose),
                        "median_pct": round(statistics.median(r["pct"] for r in v), 1)}
                       for t, v in sorted(cats.items(), key=lambda kv: list(TYPES).index(kv[0])) if len(v) >= 3],
    }


def _row(r):
    m = r["m"]
    return {"name": m["name"], "slug": m["slug"], "from": r["a"], "to": r["b"], "pct": round(r["pct"]),
            "unit": " per dozen" if m["type"] == "ball" else ""}


def pct(v):
    return f"{'+' if v > 0 else '−' if v < 0 else ''}{abs(v):.1f}%"


def edition_page(f, editions, today):
    share = lambda n: round(n / f["models"] * 100)
    lead = (f"<strong>{f['fell']} of the {f['models']} golf models we track got cheaper in {f['name']}</strong> "
            f"({share(f['fell'])}%), and {f['rose']} got dearer. The median price change was {pct(f['median_pct'])}."
            + (f" Another {f['new_seller']} changed because a retailer started stocking them; we count those separately."
               if f.get('new_seller') else ""))
    falls = "".join(f"""<tr><th scope="row"><a href="/prices/{r['slug']}/">{esc(r['name'])}</a></th><td><s>{money(r['from'])}</s></td>
<td class="pp-price">{money(r['to'])}{r['unit']}</td><td><span class="sb-down">{r['pct']}%</span></td></tr>""" for r in f["top_falls"])
    rises = "".join(f"""<tr><th scope="row"><a href="/prices/{r['slug']}/">{esc(r['name'])}</a></th><td>{money(r['from'])}</td>
<td class="pp-price">{money(r['to'])}{r['unit']}</td><td><span class="sb-up">+{r['pct']}%</span></td></tr>""" for r in f["top_rises"])
    head = '<thead><tr><th scope="col">Model</th><th scope="col">1st of month</th><th scope="col">End of month</th><th scope="col">Change</th></tr></thead>'
    cats = "".join(f"""<tr><th scope="row"><a href="/prices/{c['hub']}/">{esc(c['label'])}</a></th><td>{c['models']}</td>
<td>{c['fell']}</td><td>{c['rose']}</td><td>{pct(c['median_pct'])}</td></tr>""" for c in f["categories"])
    others = "".join(f'<a class="pp-chip" href="/prices/watch/{e}/">{esc(month_name(date.fromisoformat(e + "-01")))}</a>'
                     for e in editions if e != f["month"])
    quote = (f"{f['fell']} of {f['models']} golf models tracked by GolfPrice AI got cheaper in {f['name']}, "
             f"with a median price change of {pct(f['median_pct'])}.")
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Price watch", "/prices/watch/"), (f["name"], None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">UK golf price watch · {esc(f['name'])}</span>
  <h1>UK golf prices in {esc(f['name'])}: what got cheaper</h1>
  <p class="pp-answer">{lead}</p>
  <p class="pp-small">Lowest new, in-stock UK price for each model on the first and last day of the month, from prices we record every 6 hours across multiple UK retailers. A change counts when it’s at least £5 and 3%.</p>
</section>
{'<section class="pp-block"><h2>Biggest falls</h2><div class="pp-card pp-table-wrap"><table class="pp-table sb-table">' + head + '<tbody>' + falls + '</tbody></table></div></section>' if falls else ''}
{'<section class="pp-block"><h2>Biggest rises</h2><div class="pp-card pp-table-wrap"><table class="pp-table sb-table">' + head + '<tbody>' + rises + '</tbody></table></div></section>' if rises else ''}
<section class="pp-block">
  <h2>By category</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
  <thead><tr><th scope="col">Category</th><th scope="col">Models</th><th scope="col">Cheaper</th><th scope="col">Dearer</th><th scope="col">Median change</th></tr></thead>
  <tbody>{cats}</tbody></table></div>
</section>
<section class="pp-block">
  <h2>Using these figures</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>Quote it</h3><p>“{esc(quote)}” Please credit <strong>GolfPrice AI (golfpriceai.com)</strong> with a link. This edition won’t change after publication.</p></div>
    <div class="pp-card pp-q"><h3>Want the raw data?</h3><p>Every model’s price and history is free to download from our <a href="/prices/data/">open data page</a>. For a specific figure or a comment, email <a href="mailto:hello@golfpriceai.com">hello@golfpriceai.com</a>.</p></div>
  </div>
</section>
{'<section class="pp-block"><h2>Other months</h2><div class="pp-chips">' + others + '</div></section>' if others else ''}
{method_note(today)}
</div>"""
    article = {"@context": "https://schema.org", "@type": "Article", "headline": f"UK golf prices in {f['name']}: what got cheaper",
               "datePublished": today.isoformat(), "author": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "mainEntityOfPage": f"{SITE}/prices/watch/{f['month']}/"}
    return page_shell(title=f"UK Golf Prices {f['name']}: What Got Cheaper | GolfPrice AI",
                      description=f"{quote} The biggest falls and rises, by category, from our own UK price tracking.",
                      canonical=f"{SITE}/prices/watch/{f['month']}/", body=body, section="",
                      schema=[article, crumbs_schema], noindex=False)


def build(passing, built, today):
    """Writes any new complete-month editions and the /prices/watch/ index.
    Returns (changed, sitemap entries, whether any edition exists)."""
    changed, sitemap = [], []
    WATCH_DIR.mkdir(parents=True, exist_ok=True)
    m = FIRST_MONTH
    while month_end(m) < today:
        folder = WATCH_DIR / m.strftime("%Y-%m")
        if not (folder / "facts.json").exists():
            f = edition_facts(passing, built, m)
            if f:
                f["published"] = today.isoformat()
                _write(folder / "facts.json", json.dumps(f, indent=1))
                print(f"Price watch: published the {f['name']} edition ({f['models']} models).")
        m = month_end(m) + timedelta(days=1)
    editions = sorted((d.name for d in WATCH_DIR.iterdir() if (d / "facts.json").exists()), reverse=True)
    if not editions:
        return changed, sitemap, False
    for e in editions:
        f = json.loads((WATCH_DIR / e / "facts.json").read_text())
        published = date.fromisoformat(f.get("published", today.isoformat()))
        if _write(WATCH_DIR / e / "index.html", edition_page(f, editions, published)):
            changed.append(f"/prices/watch/{e}/")
        sitemap.append((f"prices/watch/{e}/", f.get("published")))
    latest = json.loads((WATCH_DIR / editions[0] / "facts.json").read_text())
    page = edition_page(latest, editions, date.fromisoformat(latest["published"]))
    # The index shows the latest edition; its canonical points at that edition.
    if _write(WATCH_DIR / "index.html", page):
        changed.append("/prices/watch/")
    return changed, sitemap, True
