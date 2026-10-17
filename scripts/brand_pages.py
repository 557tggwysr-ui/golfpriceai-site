"""Brand price pages (Wave 2): one page per brand and one per brand + category.

  /prices/brands/                      every brand we have pages for
  /prices/brands/taylormade/           all TaylorMade models we track, by category
  /prices/brands/taylormade-drivers/   every TaylorMade driver: lowest price,
                                       retailers and verdict, sortable

They answer searches like "TaylorMade driver prices UK" or "cheapest Titleist
golf balls", which a single model page can't. Built every run from the same
models as the other price pages, so the numbers always match.

A page is first published once it has at least 3 models that pass the
quality checks, and then stays (like model pages) while it has at least one,
so pages don't flick in and out of Google.
"""
import json
import re
from collections import defaultdict
from datetime import date, timedelta

from price_pages import (THUMB_HEAD, thumb_td, PRICES_DIR, SITE, TYPES, breadcrumb, esc, long_date, method_note, money, page_shell,
                         plural, short_date, _write)

BRANDS_DIR = PRICES_DIR / "brands"
MIN_NEW_PAGE = 3
VLAB = {"good": "Good time to buy", "wait": "Wait if you can", "typical": "Typical price", "tracking": "Tracking"}


def brand_slug(brand):
    return re.sub(r"[^a-z0-9]+", "-", brand.lower().replace("&", "and").replace(".", "")).strip("-")


def cat_words(type_key):
    """'Drivers', 'Golf balls', 'GPS watches' -> 'drivers', 'golf balls', 'GPS watches'."""
    label = TYPES[type_key][1]
    return " ".join(w if w.isupper() else w.lower() for w in label.split())


def per(m):
    return " per dozen" if m["type"] == "ball" else ""


def vtag(m):
    v = (m.get("verdict") or {}).get("label", "tracking")
    return f'<span class="pp-vtag pp-v-{v}">{VLAB.get(v, "Tracking")}</span>'


def model_table(ms, built, table_id):
    trs = "".join(f"""<tr data-price="{m['minPrice']}" data-name="{esc(m['name'].lower())}" data-ret="{len(m['retailers'])}">
  <th scope="row"><a href="/prices/{m['slug']}/">{esc(m['name'])}</a></th>
  {thumb_td(m.get('_image'), f"/prices/{m['slug']}/")}
  <td class="pp-price">{money(m['minPrice'])}{per(m)}</td>
  <td>{len(m['retailers'])}</td>
  <td>{vtag(m)}</td>
</tr>""" for m in ms)
    return f"""<div class="pp-card pp-table-wrap"><table class="pp-table pp-hub-table">
<thead><tr><th scope="col">Model</th>{THUMB_HEAD}<th scope="col">From</th><th scope="col">Retailers</th><th scope="col">Verdict</th></tr></thead>
<tbody id="{table_id}">{trs}</tbody></table></div>"""


SORT_JS = """<script>
(function () {
  var body = document.getElementById('pp-hub-rows');
  if (!body) return;
  var rows = Array.prototype.slice.call(body.children);
  document.querySelectorAll('.pp-sort button').forEach(function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-sort');
      rows.sort(function (x, y) {
        if (k === 'price') return x.dataset.price - y.dataset.price;
        if (k === 'ret') return (y.dataset.ret - x.dataset.ret) || (x.dataset.price - y.dataset.price);
        return x.dataset.name < y.dataset.name ? -1 : 1;
      });
      rows.forEach(function (r) { body.appendChild(r); });
      document.querySelectorAll('.pp-sort button').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
    });
  });
})();
</script>"""

SORT_BUTTONS = """<div class="pp-sort" role="group" aria-label="Sort">
    <span>Sort:</span>
    <button type="button" data-sort="price" aria-pressed="true">Lowest price</button>
    <button type="button" data-sort="ret" aria-pressed="false">Most retailers</button>
    <button type="button" data-sort="name" aria-pressed="false">A to Z</button>
  </div>"""


def faq_block(qas):
    items = "".join(f'<div class="pp-card pp-q"><h3>{esc(q)}</h3><p>{a}</p></div>' for q, a in qas)
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)}}
        for q, a in qas]}
    return f'<section class="pp-block"><h2>Questions</h2><div class="pp-q-grid">{items}</div></section>', schema


def recent_cuts(ms, today, days=30):
    out = []
    for m in ms:
        cuts = [e for e in m.get("events") or [] if e["kind"] in ("price_cut", "new_listing") and e["to"] < e["from"]
                and (today - date.fromisoformat(e["date"])).days <= days]
        if cuts and m["minPrice"] <= cuts[-1]["to"] + 0.005:
            out.append((m, cuts[-1]))
    out.sort(key=lambda x: -(x[1]["from"] - x[1]["to"]) / x[1]["from"])
    return out


# ---------------------------------------------------------------- pages
def build_brand_type_page(brand, type_key, ms, built, today, siblings):
    bslug = brand_slug(brand)
    hub_slug, label, noun, section = TYPES[type_key]
    words = cat_words(type_key)
    ms = sorted(ms, key=lambda m: m["minPrice"])
    rets = {s for m in ms for s in m["retailers"]}
    good = [m for m in ms if (m.get("verdict") or {}).get("label") == "good"]
    pd = per(ms[0])
    answer = (f"On {long_date(today)} we track {plural(len(ms), brand + ' ' + noun, brand + ' ' + words)} at "
              f"{plural(len(rets), 'UK retailer')}. The cheapest is the <strong>{esc(ms[0]['name'])}</strong> from "
              f"<strong>{money(ms[0]['minPrice'])}{pd}</strong>")
    answer += (f"; the dearest is the {esc(ms[-1]['name'])} at {money(ms[-1]['minPrice'])}{pd}." if len(ms) > 1 else ".")
    if good:
        answer += f" {len(good)} {'is' if len(good) == 1 else 'are'} at the lowest price we’ve tracked."
    cuts = recent_cuts(ms, today)
    qas = [(f"What’s the cheapest {brand} {noun} in the UK right now?",
            f"The {esc(ms[0]['name'])}, from {money(ms[0]['minPrice'])}{pd} on {long_date(today)}. "
            f"We check prices at every UK retailer we track every 6 hours.")]
    if cuts:
        m, e = cuts[0]
        qas.append((f"Which {brand} {words} have dropped in price recently?",
                    f"The {esc(m['name'])} dropped from {money(e['from'])} to {money(e['to'])}{per(m)} on {short_date(e['date'])}"
                    + (f", and {plural(len(cuts) - 1, 'other')} {'has' if len(cuts) == 2 else 'have'} also come down in the last 30 days." if len(cuts) > 1 else ".")))
    qas.append((f"Is now a good time to buy {brand} {words}?" if type_key == "ball" else f"Is now a good time to buy a {brand} {noun}?",
                (f"For {plural(len(good), 'model')} yes: {'it is' if len(good) == 1 else 'they are'} at the lowest price we’ve tracked. "
                 if good else "None is at its lowest tracked price today. ")
                + "Each model’s page shows its full price history and our verdict."))
    faq_html, faq_schema = faq_block(qas)
    others = "".join(f'<a class="pp-chip" href="/prices/brands/{s}/">{esc(b)}</a>' for b, s in siblings if b != brand)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Brands", "/prices/brands/"),
                                             (brand, f"/prices/brands/{bslug}/"),
                                             (f"{brand} {words}", None)])
    title_words = " ".join(w if w.isupper() else w.capitalize() for w in noun.split())
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <h1>{esc(brand)} {esc(noun)} prices UK</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes the order or the verdicts.</p>
</section>
<section class="pp-block">
  {SORT_BUTTONS}
  {model_table(ms, built, "pp-hub-rows")}
  <p class="pp-small">Lowest new, in-stock price{pd} for each model, checked every 6 hours. Verdicts compare today’s price with the model’s own tracked history.</p>
</section>
{faq_html}
<section class="pp-block"><h2>Other brands’ {esc(words)}</h2><div class="pp-chips"><a class="pp-chip" href="/prices/{hub_slug}/">All {esc(words)}</a>{others}</div></section>
{method_note(today)}
</div>
{SORT_JS}"""
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": f"{brand} {noun} prices UK",
                 "numberOfItems": len(ms),
                 "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": m["name"],
                                      "url": f"{SITE}/prices/{m['slug']}/"} for i, m in enumerate(ms)]}
    title = f"{brand} {title_words} Prices UK: from {money(ms[0]['minPrice'])}{pd} | GolfPrice AI"
    desc = (f"Every {brand} {noun} we track across UK retailers, cheapest first, with price history and a verdict "
            f"on whether now’s a good time to buy.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/brands/{bslug}-{hub_slug}/", body=body,
                      section=section, schema=[item_list, crumbs_schema, faq_schema], noindex=False)


def build_brand_page(brand, by_type, built, today, type_pages, all_brands):
    bslug = brand_slug(brand)
    all_ms = [m for ms in by_type.values() for m in ms]
    rets = {s for m in all_ms for s in m["retailers"]}
    good = [m for m in all_ms if (m.get("verdict") or {}).get("label") == "good"]
    order = [t for t in TYPES if t in by_type]
    parts = []
    for t in order:
        ms = sorted(by_type[t], key=lambda m: m["minPrice"])
        words = cat_words(t)
        more = (f'<p class="pp-small"><a href="/prices/brands/{bslug}-{TYPES[t][0]}/">All {esc(brand)} {esc(words)} →</a></p>'
                if t in type_pages else "")
        parts.append(f"""<section class="pp-block">
  <h2>{esc(brand)} {esc(words)}</h2>
  <p class="pp-small">{plural(len(ms), 'model')} · from {money(ms[0]['minPrice'])}{per(ms[0])}</p>
  {model_table(ms[:8], built, f"rows-{t}")}
  {more}
</section>""")
    summary = ", ".join(f"{cat_words(t)} from {money(min(m['minPrice'] for m in by_type[t]))}{per(by_type[t][0])}"
                        for t in order[:4])
    answer = (f"We track {plural(len(all_ms), brand + ' model')} at {plural(len(rets), 'UK retailer')}, checked every "
              f"6 hours: {summary}.")
    if good:
        answer += f" {len(good)} {'is' if len(good) == 1 else 'are'} at the lowest price we’ve tracked right now."
    qas = [(f"What’s the cheapest {brand} {TYPES[t][2]} in the UK?",
            f"The {esc(min(by_type[t], key=lambda m: m['minPrice'])['name'])}, from "
            f"{money(min(m['minPrice'] for m in by_type[t]))}{per(by_type[t][0])} on {long_date(today)}.")
           for t in order[:4]]
    faq_html, faq_schema = faq_block(qas)
    others = "".join(f'<a class="pp-chip" href="/prices/brands/{brand_slug(b)}/">{esc(b)}</a>' for b in all_brands if b != brand)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Brands", "/prices/brands/"), (brand, None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <h1>{esc(brand)} golf prices UK</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes the order or the verdicts.</p>
</section>
{''.join(parts)}
{faq_html}
<section class="pp-block"><h2>More brands</h2><div class="pp-chips">{others}</div></section>
{method_note(today)}
</div>"""
    title = f"{brand} Golf Prices UK: {plural(len(all_ms), 'Model')} Tracked | GolfPrice AI"
    desc = (f"Today’s lowest UK prices for {plural(len(all_ms), brand + ' model')}: "
            + ", ".join(cat_words(t) for t in order[:4]) + ". With price history and a buy-or-wait verdict.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/brands/{bslug}/", body=body,
                      section="", schema=[crumbs_schema, faq_schema], noindex=False)


def build_brands_index(brand_counts, today):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Brands", None)])
    chips = "".join(f'<a class="pp-chip" href="/prices/brands/{brand_slug(b)}/">{esc(b)} <em>{n}</em></a>'
                    for b, n in sorted(brand_counts.items(), key=lambda x: x[0].lower()))
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <h1>Golf brands: UK price guides</h1>
  <p class="pp-answer">Price guides for {plural(len(brand_counts), 'golf brand')}, built from our own record of UK prices, checked every 6 hours. The number is how many of that brand’s models we track.</p>
</section>
<section class="pp-block"><div class="pp-chips">{chips}</div></section>
{method_note(today)}
</div>"""
    return page_shell(title="Golf Brand Price Guides UK | GolfPrice AI",
                      description="UK price guides for TaylorMade, Callaway, Titleist, Ping and every other golf brand we track, with price history and verdicts.",
                      canonical=f"{SITE}/prices/brands/", body=body, section="", schema=[crumbs_schema], noindex=False)


def gone_page(slug, today):
    body = f"""<div class="pp-wrap">
<section class="pp-hub-top">
  <h1>No prices to show here right now</h1>
  <p class="pp-answer">As of {long_date(today)}, none of the models on this page is new and in stock at the UK retailers we track, so we’ve stopped showing prices for it.</p>
  <p><a class="pp-btn" href="/prices/brands/">See every brand we track</a></p>
</section>
{method_note(today)}
</div>"""
    return page_shell(title="No current prices | GolfPrice AI", description="No current prices for this page.",
                      canonical=f"{SITE}/prices/brands/{slug}/", body=body, section="", schema=[], noindex=True)


# ---------------------------------------------------------------- planning and entry point
def plan(passing):
    """Which brand and brand+category pages exist this run. Used by the model
    pages too (their breadcrumb links to the brand+category page)."""
    existing = {d.name for d in BRANDS_DIR.iterdir() if d.is_dir()} if BRANDS_DIR.exists() else set()
    groups = defaultdict(lambda: defaultdict(list))
    for m in passing:
        if m.get("brand") and m["type"] in TYPES:
            groups[m["brand"]][m["type"]].append(m)
    brand_pages, type_pages = {}, {}
    for brand, by_type in groups.items():
        bslug = brand_slug(brand)
        if not bslug:
            continue
        n = sum(len(v) for v in by_type.values())
        if n >= MIN_NEW_PAGE or (bslug in existing and n >= 1):
            brand_pages[brand] = by_type
        for t, ms in by_type.items():
            s = f"{bslug}-{TYPES[t][0]}"
            if len(ms) >= MIN_NEW_PAGE or (s in existing and ms):
                type_pages[(brand, t)] = s
    return brand_pages, type_pages


def crumb_link(m, type_pages, brand_pages):
    s = type_pages.get((m.get("brand"), m["type"]))
    if s:
        return f"/prices/brands/{s}/"
    if m.get("brand") in brand_pages:
        return f"/prices/brands/{brand_slug(m['brand'])}/"
    return None


def build(passing, built, today, brand_pages, type_pages):
    """Returns (changed urls, sitemap entries)."""
    changed, sitemap = [], []
    by_type_brands = defaultdict(list)
    for (b, t), s in type_pages.items():
        by_type_brands[t].append((b, s))
    for t in by_type_brands:
        by_type_brands[t].sort(key=lambda x: x[0].lower())
    built_ms = lambda ms: [m for m in ms if m["slug"] in built]

    def lastmod(ms):
        dates = [h[0] for m in ms for h, prev in zip((m.get("history") or [])[1:], m.get("history") or []) if h[1] != prev[1]]
        return max(dates) if dates else None

    for (brand, t), s in type_pages.items():
        ms = built_ms(brand_pages.get(brand, {}).get(t, []))
        if not ms:
            continue
        page = build_brand_type_page(brand, t, ms, built, today, by_type_brands[t])
        if _write(BRANDS_DIR / s / "index.html", page):
            changed.append(f"/prices/brands/{s}/")
        sitemap.append((f"prices/brands/{s}/", lastmod(ms)))
    counts = {}
    for brand, by_type in brand_pages.items():
        by_type = {t: built_ms(ms) for t, ms in by_type.items() if built_ms(ms)}
        if not by_type:
            continue
        counts[brand] = sum(len(v) for v in by_type.values())
        tp = {t for (b, t) in type_pages if b == brand}
        page = build_brand_page(brand, by_type, built, today, tp, sorted(brand_pages, key=str.lower))
        s = brand_slug(brand)
        if _write(BRANDS_DIR / s / "index.html", page):
            changed.append(f"/prices/brands/{s}/")
        sitemap.append((f"prices/brands/{s}/", lastmod([m for v in by_type.values() for m in v])))
    # A brand page whose models have all gone (or failed the checks) says so
    # plainly instead of leaving old prices up.
    live = {s for s in type_pages.values()} | {brand_slug(b) for b in counts}
    if BRANDS_DIR.exists():
        for d in BRANDS_DIR.iterdir():
            if d.is_dir() and d.name not in live and (d / "index.html").exists():
                if _write(d / "index.html", gone_page(d.name, today)):
                    changed.append(f"/prices/brands/{d.name}/")
    if counts:
        if _write(BRANDS_DIR / "index.html", build_brands_index(counts, today)):
            changed.append("/prices/brands/")
        sitemap.append(("prices/brands/", None))
    print(f"Brand pages: {len(counts)} brand page(s), {len(type_pages)} brand + category page(s).")
    return changed, sitemap, counts
