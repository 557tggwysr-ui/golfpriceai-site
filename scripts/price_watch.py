"""Monthly "UK Golf Price Report" (was "price watch"): /prices/watch/

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
from price_pages import NOT_IN_PICKS
from seasonal_pages import daily_prices

WATCH_DIR = PRICES_DIR / "watch"
ROOT_DATA = PRICES_DIR.parent / "data"
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
        if x["slug"] not in built or x["type"] in NOT_IN_PICKS:
            continue  # never junior kit
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
        # At its lowest: the month-end price is the lowest we'd recorded for it by then.
        low = min(p for d, p in days.items() if d <= end) if days else None
        rows.append({"m": x, "a": a, "b": b, "chg": b - a, "pct": (b - a) / a * 100, "new": new_seller,
                     "low": low is not None and b <= low + 0.005})
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
        "at_low": sum(1 for r in rows if r["low"] and r in fell),
        "biggest_fall": round(max((r["a"] - r["b"] for r in fell), default=0), 2),
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


REPORT = "The UK Golf Price Report"
CSS = '<link rel="stylesheet" href="/css/report.css?v=20261106a">\n'


def findings(f):
    """Three or four plain sentences, written from the figures."""
    out = []
    cats = [c for c in f["categories"] if c["models"] >= 10]
    if cats:
        c = max(cats, key=lambda c: (c["fell"] / c["models"], c["models"]))
        if c["fell"]:
            out.append(f"<b>{esc(c['label'])} saw the most cuts:</b> {c['fell']} of {c['models']} models got cheaper ({round(c['fell'] / c['models'] * 100)}%).")
    if f["top_falls"]:
        t = f["top_falls"][0]
        out.append(f"<b>The biggest fall</b> was the <a href=\"/prices/{t['slug']}/\">{esc(t['name'])}</a>, down {abs(t['pct'])}% from {money(t['from'])} to {money(t['to'])}{t['unit']}.")
    if f["rose"] * 3 <= f["fell"]:
        out.append(f"<b>Price rises were rare:</b> {plural(f['rose'], 'model')} got dearer, against {f['fell']} that got cheaper.")
    else:
        out.append(f"<b>{plural(f['rose'], 'model')} got dearer</b> during the month, against {f['fell']} that got cheaper.")
    if f["median_pct"] == 0:
        out.append(f"<b>Most prices held steady:</b> the median change was 0.0%, so a cut is worth acting on when you see one.")
    if f.get("new_seller"):
        out.append(f"<b>{plural(f['new_seller'], 'more model')} changed price</b> because another UK retailer started selling {'it' if f['new_seller'] == 1 else 'them'}. That’s more choice rather than a price cut, so we count those separately.")
    return out[:4]


def stats(f):
    share = round(f["fell"] / f["models"] * 100) if f["models"] else 0
    tiles = [(f"{f['fell']:,}", "golf models got cheaper"), (f"{share}%", f"of the {f['models']:,} models we track"),
             (f"{f['rose']:,}", "got dearer")]
    big = f.get("biggest_fall") or max((r["from"] - r["to"] for r in f["top_falls"]), default=0)
    if f.get("at_low"):
        tiles.append((f"{f['at_low']:,}", "fell to the lowest price we’ve tracked"))
    elif big:
        tiles.append((money(big).replace(".00", ""), "biggest genuine fall on one model"))
    return "".join(f'<div class="rp-stat"><b>{v}</b><span>{l}</span></div>' for v, l in tiles)


def headline(f):
    return f"{f['fell']} of {f['models']:,} golf models got cheaper in {f['name']}"


def edition_page(f, editions, today, images=None):
    images = images or {}
    month_url = f"/prices/watch/{f['month']}/"
    cats = sorted(f["categories"], key=lambda c: -(c["fell"] / c["models"]))
    top = max((c["fell"] / c["models"] for c in cats), default=0) or 1
    bars = "".join(f"""<li><a href="/prices/{c['hub']}/">{esc(c['label'])}</a>
<span class="rp-bar" aria-hidden="true"><i style="width:{max(2, round(c['fell'] / c['models'] / top * 100))}%"></i></span>
<b>{round(c['fell'] / c['models'] * 100)}%</b><small>{c['fell']} of {c['models']}</small></li>""" for c in cats)
    def card(r):
        img = images.get(r["slug"])
        pic = (f'<img src="{esc(img)}" alt="{esc(r["name"])}" loading="lazy" width="160" height="160" referrerpolicy="no-referrer" onerror="this.remove()">' if img else "")
        return (f'<a class="rp-fall" href="/prices/{r["slug"]}/"><span class="rp-pic">{pic}</span><span class="rp-pct">{r["pct"]}%</span>'
                f'<b>{esc(r["name"])}</b><span class="rp-p"><strong>{money(r["to"])}</strong>{r["unit"]} <s>{money(r["from"])}</s></span></a>')
    falls = "".join(card(r) for r in f["top_falls"])
    rises = "".join(f"""<tr><th scope="row"><a href="/prices/{r['slug']}/">{esc(r['name'])}</a></th><td>{money(r['from'])}</td>
<td class="pp-price">{money(r['to'])}{r['unit']}</td><td><span class="sb-up">+{r['pct']}%</span></td></tr>""" for r in f["top_rises"])
    others = "".join(f'<a class="pp-chip" href="/prices/watch/{e}/">{esc(month_name(date.fromisoformat(e + "-01")))}</a>'
                     for e in editions if e != f["month"])
    quote = (f"{f['fell']} of {f['models']} golf models tracked by GolfPrice AI got cheaper in {f['name']}, "
             f"with a median price change of {pct(f['median_pct'])}.")
    cite = f"GolfPrice AI ({f['month'][:4]}). {REPORT}, {f['name']}. {SITE}{month_url}"
    nxt = month_end(date.fromisoformat(f["month"] + "-01")) + timedelta(days=1)
    nxt_name = month_name(nxt)
    pub = date.fromisoformat(f.get("published", today.isoformat()))
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Price report", "/prices/watch/"), (f["name"], None)])
    find = "".join(f"<li>{x}</li>" for x in findings(f))
    body = f"""<div class="pp-wrap rp">
{crumbs_html}
<section class="rp-hero">
  <span class="rp-kick">{REPORT} · {esc(f['name'])} · published {long_date(pub)}</span>
  <h1>{esc(headline(f))}</h1>
  <p>Every month we check the lowest new, in-stock UK price of every golf model we track, across multiple UK retailers, and report what really happened. Here is {esc(f['name'].split()[0])}.</p>
  <div class="rp-stats">{stats(f)}</div>
</section>
<div class="rp-two">
  <section class="rp-card"><h2>Share of models that got cheaper</h2><ul class="rp-bars">{bars}</ul>
  <p class="rp-note">Each model’s lowest new UK price on the first and last day of {esc(f['name'])}. A change counts when it’s at least £5 and 3%.</p></section>
  <section class="rp-card"><h2>The findings</h2><ol class="rp-find">{find}</ol></section>
</div>
{f'<section class="rp-card"><h2>Biggest genuine falls</h2><div class="rp-falls">{falls}</div></section>' if falls else ''}
{'<section class="rp-card"><h2>Biggest rises</h2><div class="pp-table-wrap"><table class="pp-table sb-table"><thead><tr><th scope="col">Model</th><th scope="col">1st of month</th><th scope="col">End of month</th><th scope="col">Change</th></tr></thead><tbody>' + rises + '</tbody></table></div></section>' if rises else ''}
<div class="rp-three">
  <section class="rp-card"><h2>How we measure</h2><p>The lowest new, in-stock UK price for each model, from prices we record every 6 hours across multiple UK retailers. No pre-owned or junior kit, and never a retailer’s “was” price: every change is against what the model actually sold for. <a href="/about.html">How we track prices</a>.</p></section>
  <section class="rp-card"><h2>Use these numbers</h2><p>Free to quote with a link to this page: “{esc(quote)}” This edition won’t change after publication. The data is free to download (CC BY 4.0).</p><a class="rp-link" href="/prices/data/">Download the price data &rarr;</a></section>
  <section class="rp-card rp-dark"><h2>Cite this report</h2><p class="rp-cite">{esc(cite)}</p></section>
</div>
<section class="rp-press"><p><b>Journalists and writers:</b> a ready-to-use press note for {esc(f['name'])}, and any figure for any category on request.</p><a class="rp-btn" href="{month_url}press/">Read the press note</a></section>
{signup_box()}
<p class="rp-more">{('Past reports: ' + others + ' · ') if others else ''}Next report: early {esc(nxt_name)}</p>
{method_note(today)}
</div>"""
    article = {"@context": "https://schema.org", "@type": "Report", "name": f"{REPORT}: {f['name']}", "headline": headline(f),
               "datePublished": pub.isoformat(), "author": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "isBasedOn": f"{SITE}/prices/data/", "mainEntityOfPage": f"{SITE}{month_url}"}
    return page_shell(title=f"UK Golf Price Report {f['name']}: {f['fell']} Models Got Cheaper | GolfPrice AI",
                      description=f"{quote} The biggest genuine falls and rises, and every category, from our own UK price tracking.",
                      canonical=f"{SITE}{month_url}", body=body, section="",
                      schema=[article, crumbs_schema], noindex=False, extra_head=CSS)


def signup_box():
    """'Get the report each month': a double opt-in email sign-up (the alerts
    worker's /subscribe with press: 1). One email a month, sent by
    scripts/press_email.py. Hidden when printing."""
    return """<section class="rp-sign" id="rp-sign"><div><b>Get the UK Golf Price Report each month</b>
<span>One email when each new edition is out: the headline figures and the press note. For journalists, writers and anyone who wants the numbers.</span></div>
<form class="rp-sign-f" novalidate><label class="rp-sr" for="rp-email">Email address</label><input id="rp-email" type="email" autocomplete="email" placeholder="you@newsroom.co.uk" required>
<input type="text" name="website" tabindex="-1" autocomplete="off" class="rp-hp" aria-hidden="true"><button type="submit" class="rp-btn">Sign me up</button></form>
<p class="rp-sign-msg" role="status"></p><small>We’ll email you once to confirm. One-click unsubscribe in every email.</small></section>
<script src="/js/press-signup.js?v=20261106a" defer></script>"""


def press_page(f, quotes):
    """A one-page press release for the edition. Names no retailers."""
    pub = date.fromisoformat(f["published"])
    share = round(f["fell"] / f["models"] * 100)
    cats = [c for c in f["categories"] if c["models"] >= 10]
    best = max(cats, key=lambda c: c["fell"] / c["models"]) if cats else None
    t = f["top_falls"][0] if f["top_falls"] else None
    q = (quotes or {}).get(f["month"])
    month = f["name"].split()[0]
    paras = [
        f"<b>{long_date(pub)}:</b> {f['fell']} of the {f['models']:,} golf models tracked by GolfPrice AI got cheaper during {f['name']} ({share}%), "
        f"while {f['rose']} got dearer, according to {REPORT}. The median price change across all models was {pct(f['median_pct'])}.",
    ]
    if best and best["fell"]:
        paras.append(f"{best['label']} saw the most cuts, with {best['fell']} of {best['models']} models falling in price ({round(best['fell'] / best['models'] * 100)}%)."
                     + (f" The largest single fall was {round(abs(t['pct']))}%, on the {esc(t['name'])}, from {money(t['from'])} to {money(t['to'])}." if t else ""))
    if q:
        paras.append(f"“{esc(q['text'])}” said {esc(q.get('who', 'the founder of GolfPrice AI'))}.")
    paras.append("GolfPrice AI records the lowest new, in-stock price of each golf model across multiple UK retailers every six hours. "
                 "Each change in the report is measured against what the model actually sold for, not a retailer’s “was” price, so a fall in the report is a real fall.")
    figures = [f"{f['fell']} of {f['models']:,} models cheaper at month end ({share}%)", f"{f['rose']} models dearer",
               f"Median price change: {pct(f['median_pct'])}"]
    if f.get("at_low"):
        figures.append(f"{f['at_low']} models fell to their lowest tracked price")
    if f.get("new_seller"):
        figures.append(f"{f['new_seller']} more models changed price because another retailer started selling them (counted separately)")
    sub = (f"{best['label']} lead the falls" if best and best["fell"] else "Most prices held steady") + f"; {f['rose']} models got dearer"
    body = f"""<div class="pp-wrap rp">
<article class="rp-release">
  <header><b class="rp-logo">Golf<span>Price</span> AI</b><span>Press release · {long_date(pub)}</span></header>
  <h1>{esc(headline(f))}, GolfPrice AI tracking shows</h1>
  <p class="rp-sub">{esc(sub)}</p>
  {''.join(f'<p>{x}</p>' for x in paras)}
  <div class="rp-keys"><b>Key figures, {esc(f['name'])}</b><ul>{''.join(f'<li>{esc(x)}</li>' for x in figures)}</ul></div>
  <h2>Notes to editors</h2>
  <p><b>About GolfPrice AI:</b> golfpriceai.com is a free UK golf price comparison site, with free tools for golfers and golf societies. It tracks new golf equipment prices across multiple UK retailers every six hours. Its price data is free to use with credit (CC BY 4.0, DOI 10.5281/zenodo.23436241).</p>
  <p><b>Full report, charts and data:</b> <a href="{SITE}/prices/watch/{f['month']}/">golfpriceai.com/prices/watch/{f['month']}/</a></p>
  <p><b>Media contact:</b> <a href="mailto:hello@golfpriceai.com">hello@golfpriceai.com</a></p>
  <p class="rp-end">Ends</p>
</article>
<div class="rp-print"><button type="button" class="rp-btn" onclick="window.print()">Print or save as PDF</button><a href="/prices/watch/{f['month']}/">&larr; Back to the {esc(month)} report</a></div>
{signup_box()}
</div>"""
    return page_shell(title=f"Press release: UK golf prices in {f['name']} | GolfPrice AI",
                      description=f"Press release: {headline(f)}. Figures from {REPORT}.",
                      canonical=f"{SITE}/prices/watch/{f['month']}/press/", body=body, section="",
                      schema=[], noindex=True, extra_head=CSS)


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
    images = {m["slug"]: m.get("_image") for m in passing if m.get("_image")}
    try:
        quotes = json.loads((ROOT_DATA / "press-quotes.json").read_text())
    except (OSError, ValueError):
        quotes = {}
    for e in editions:
        f = json.loads((WATCH_DIR / e / "facts.json").read_text())
        published = date.fromisoformat(f.get("published", today.isoformat()))
        if _write(WATCH_DIR / e / "index.html", edition_page(f, editions, published, images)):
            changed.append(f"/prices/watch/{e}/")
        (WATCH_DIR / e / "press").mkdir(exist_ok=True)
        if _write(WATCH_DIR / e / "press" / "index.html", press_page(f, quotes)):
            changed.append(f"/prices/watch/{e}/press/")
        sitemap.append((f"prices/watch/{e}/", f.get("published")))
    latest = json.loads((WATCH_DIR / editions[0] / "facts.json").read_text())
    page = edition_page(latest, editions, date.fromisoformat(latest["published"]), images)
    # The index shows the latest edition; its canonical points at that edition.
    if _write(WATCH_DIR / "index.html", page):
        changed.append("/prices/watch/")
    return changed, sitemap, True
