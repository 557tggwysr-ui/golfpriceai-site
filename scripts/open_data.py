"""Open UK golf price data: /prices/data/

Two CSV files, rebuilt every run from the same models as the price pages,
plus a page describing them (with schema.org Dataset markup, so they show up
in Google Dataset Search). Free to reuse with credit (CC BY 4.0), which is the
point: journalists, bloggers and AI tools cite data like this and link back.

  golf-prices-uk.csv          one row per model: today's lowest new price,
                              tracked low/high/average, verdict, page link
  golf-price-history-uk.csv   every change in each model's lowest new price

New, in-stock prices only; second-hand stock is never included.
"""
import csv
import io
import statistics
from collections import defaultdict

from price_pages import PRICES_DIR, SITE, TYPES, breadcrumb, esc, long_date, method_note, money, page_shell, plural, _write

DATA_DIR = PRICES_DIR / "data"
LICENCE = "https://creativecommons.org/licenses/by/4.0/"
DOI = "https://doi.org/10.5281/zenodo.23436242"
# The same data, listed where researchers, data scientists and AI developers look.
MIRRORS = [
    ("Hugging Face", "https://huggingface.co/datasets/GolfPriceAI/uk-golf-prices", "Load it straight into Python with the datasets library, and preview it in the browser."),
    ("Kaggle", "https://www.kaggle.com/datasets/golfpriceai/uk-golf-equipment-prices-daily-golfprice-ai", "Explore it in a free Kaggle notebook."),
    ("Zenodo (DOI)", DOI, "A permanent, citable archive copy with a DOI, for research and reporting."),
]


def _csv(rows, header):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def build(passing, built, today):
    ms = sorted([m for m in passing if m["slug"] in built], key=lambda m: (list(TYPES).index(m["type"]), m["name"]))
    if not ms:
        return [], []
    current, history = [], []
    for m in ms:
        hist = m.get("history") or []
        prices = [p for _, p in hist] or [m["minPrice"]]
        current.append([today.isoformat(), m["slug"], m["name"], m.get("brand") or "", TYPES[m["type"]][2],
                        f"{m['minPrice']:.2f}", "per dozen" if m["type"] == "ball" else "each",
                        len(m["retailers"]), m.get("historyDays") or 0, f"{min(prices + [m['minPrice']]):.2f}",
                        f"{max(prices):.2f}", (m.get("verdict") or {}).get("label", "tracking"),
                        f"{SITE}/prices/{m['slug']}/"])
        prev = None
        for d, p in hist:
            if p != prev:
                history.append([m["slug"], d, f"{p:.2f}"])
                prev = p
    changed = []
    if _write(DATA_DIR / "golf-prices-uk.csv", _csv(current, [
            "date", "model_id", "model", "brand", "category", "lowest_new_price_gbp", "price_unit", "retailers",
            "days_tracked", "tracked_low_gbp", "tracked_high_gbp", "verdict", "price_page"])):
        changed.append("/prices/data/golf-prices-uk.csv")
    _write(DATA_DIR / "golf-price-history-uk.csv", _csv(history, ["model_id", "date", "lowest_new_price_gbp"]))

    # Category summary for the page.
    by_type = defaultdict(list)
    for m in ms:
        by_type[m["type"]].append(m)
    rows = "".join(f"""<tr><th scope="row"><a href="/prices/{TYPES[t][0]}/">{esc(TYPES[t][1])}</a></th>
<td>{len(v)}</td><td class="pp-price">{money(statistics.median(x['minPrice'] for x in v))}{' per dozen' if t == 'ball' else ''}</td>
<td>{sum(1 for x in v if (x.get('verdict') or {}).get('label') == 'good')}</td></tr>"""
                   for t, v in sorted(by_type.items(), key=lambda kv: list(TYPES).index(kv[0])))
    first = min((m["history"][0][0] for m in ms if m.get("history")), default=today.isoformat())
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Open data", None)])
    dataset = {
        "@context": "https://schema.org", "@type": "Dataset",
        "name": "UK golf equipment prices (GolfPrice AI)",
        "description": ("Daily lowest new, in-stock UK retail prices for golf clubs, balls, bags, rangefinders, GPS "
                        "watches, trolleys and launch monitors, with full price-change history, recorded every 6 hours "
                        "by GolfPrice AI across multiple UK retailers."),
        "url": f"{SITE}/prices/data/", "license": LICENCE, "identifier": DOI,
        "sameAs": [u for _, u, _ in MIRRORS], "isAccessibleForFree": True,
        "creator": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
        "temporalCoverage": f"{first}/{today.isoformat()}", "spatialCoverage": "United Kingdom",
        "dateModified": today.isoformat(),
        "keywords": ["golf", "prices", "UK", "golf clubs", "golf balls", "price history", "retail prices"],
        "variableMeasured": "Lowest new in-stock retail price (GBP)",
        "distribution": [
            {"@type": "DataDownload", "encodingFormat": "text/csv", "name": "Current prices",
             "contentUrl": f"{SITE}/prices/data/golf-prices-uk.csv"},
            {"@type": "DataDownload", "encodingFormat": "text/csv", "name": "Price history",
             "contentUrl": f"{SITE}/prices/data/golf-price-history-uk.csv"}],
    }
    mirrors = "\n    ".join(
        f'<a class="pp-card pp-rel" href="{u}" rel="noopener"><span class="pp-rel-name">{esc(n)}</span><span class="pp-sub">{esc(d)}</span></a>'
        for n, u, d in MIRRORS)
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Open data · updated every 6 hours</span>
  <h1>UK golf price data: free to download</h1>
  <p class="pp-answer">The lowest new, in-stock UK price for {plural(len(ms), 'golf model')}, and every change in it since {long_date(first)}, recorded every 6 hours across multiple UK retailers. Free to use, including commercially, as long as you credit GolfPrice AI with a link.</p>
</section>
<section class="pp-block">
  <h2>Downloads</h2>
  <div class="pp-rel-grid">
    <a class="pp-card pp-rel" href="/prices/data/golf-prices-uk.csv" download><span class="pp-rel-name">Current prices (CSV)</span><span class="pp-sub">One row per model: lowest new price today, retailers, days tracked, tracked low and high, our verdict, and its price page.</span></a>
    <a class="pp-card pp-rel" href="/prices/data/golf-price-history-uk.csv" download><span class="pp-rel-name">Price history (CSV)</span><span class="pp-sub">Every change in each model’s lowest new price, by date. Join to the current file on model_id.</span></a>
  </div>
</section>
<section class="pp-block">
  <h2>Also on</h2>
  <div class="pp-rel-grid">
    {mirrors}
  </div>
  <p class="pp-sub">These copies are refreshed regularly. The files on this page are always the newest.</p>
</section>
<section class="pp-block">
  <h2>Today at a glance</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
  <thead><tr><th scope="col">Category</th><th scope="col">Models</th><th scope="col">Median lowest price</th><th scope="col">At lowest tracked price</th></tr></thead>
  <tbody>{rows}</tbody></table></div>
</section>
<section class="pp-block">
  <h2>How to use it</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>Licence</h3><p>Creative Commons Attribution 4.0 (<a href="{LICENCE}">CC BY 4.0</a>). Use it however you like; just credit “GolfPrice AI (golfpriceai.com)” with a link.</p></div>
    <div class="pp-card pp-q"><h3>What’s a “price” here?</h3><p>The lowest price for a new, in-stock listing of that model at the UK retailers we track, in pounds including VAT. Golf balls are per dozen. Second-hand and ex-demo stock is never included.</p></div>
    <div class="pp-card pp-q"><h3>How fresh is it?</h3><p>Both files are rebuilt every 6 hours with the rest of the site, so the link always gives you the latest data.</p></div>
    <div class="pp-card pp-q"><h3>How to cite it</h3><p>GolfPrice AI (2026). <em>UK Golf Equipment Prices (Daily, GolfPrice AI)</em> [Data set]. Zenodo. <a href="{DOI}">{DOI}</a>. For the latest figures, link to this page.</p></div>
    <div class="pp-card pp-q"><h3>Need more?</h3><p>For other categories, longer history or a custom feed, email <a href="mailto:hello@golfpriceai.com">hello@golfpriceai.com</a>.</p></div>
  </div>
</section>
{method_note(today)}
</div>"""
    page = page_shell(title="UK Golf Price Data: Free Download (CSV) | GolfPrice AI",
                      description="Free UK golf price data: lowest new prices and full price history for clubs, balls, bags and gadgets, updated every 6 hours. CSV, CC BY 4.0.",
                      canonical=f"{SITE}/prices/data/", body=body, section="", schema=[dataset, crumbs_schema], noindex=False)
    if _write(DATA_DIR / "index.html", page):
        changed.append("/prices/data/")
    print(f"Open data: {len(current)} model(s), {len(history)} price change(s).")
    return changed, [("prices/data/", today.isoformat())]
