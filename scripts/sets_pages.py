"""Package set guides: /prices/golf-package-sets/ and /prices/junior-golf-sets/

Built in place of the standard hub page for the two set types (called from
price_pages.build), every 6 hours. Approved mock-up 17 Oct 2026.

  * Every complete set we track is listed, grouped into sets by
    models.py's strict matching (brand, range, pieces, bag style, year,
    men's or women's, and size for junior sets). A set with its own price
    page links there; any other links to its cheapest retailer.
  * No brand is favoured: lists are ordered by the data (genuine drops and
    lowest tracked prices first, then how widely stocked, then price), with
    no more than two of one brand in the first row.
  * Adult guide: men's sets lead; women's are at most a quarter of the
    first cards shown before a filter is picked.
  * Junior guide: browse by age or by height. Heights are what junior clubs
    are made for; ages are a rough guide only.
  * "Same set, different price" only shows sets matched at 2+ retailers.
"""
import json
import re
import statistics
from collections import defaultdict

from price_pages import THUMB_HEAD, thumb_td, SITE, breadcrumb, esc, long_date, method_note, money, page_shell, retailer_name
from seasonal_pages import brand_rank

WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s|womens)\b", re.I)
CARDS_SHOWN = 12
WOMEN_SHARE = 0.25
AGE_BANDS = [("a3", "3–5 years", 0, 5.5), ("a6", "6–8 years", 5.5, 8.5), ("a9", "9–12 years", 8.5, 12.5), ("a13", "13+ years", 12.5, 99)]
HEIGHT_BANDS = [("h1", "Under 45″", "about 3–5 years", 0, 45), ("h2", "45–51″", "about 5–8 years", 45, 52),
                ("h3", "52–57″", "about 8–10 years", 52, 58), ("h4", "58″ and over", "about 10–13 years", 58, 99)]
PRICE_BANDS = [("Beginner", "under £400", 0, 400), ("Mid-range", "£400–£800", 400, 800), ("Premium", "£800 and over", 800, 1e9)]


def _women(m):
    return bool(WOMEN_RX.search(m["name"]))


def _size(m):
    """(age midpoint or None, height in inches or None) from the set's name."""
    n = m["name"]
    a = re.search(r"Ages (\d+)-(\d+)", n)
    h = re.search(r"(\d{2})″", n)
    lv = re.search(r"Level (\d)", n)
    age = (int(a.group(1)) + int(a.group(2))) / 2 if a else {"1": 4, "2": 6.5, "3": 10.5}.get(lv.group(1)) if lv else None
    if age is None and re.search(r"\bXT\b|teen", n, re.I):
        age = 14
    return age, int(h.group(1)) if h else None


def _pieces(m):
    p = re.search(r"(\d+)-Piece", m["name"])
    return int(p.group(1)) if p else None


def _image(m, by_id):
    rows = sorted((by_id[i] for i in m.get("listingIds", []) if i in by_id), key=lambda p: p.get("salePrice") or 0)
    return next((p["image"] for p in rows if p.get("image")), None)


def _link(m, built, by_id):
    if m["slug"] in built:
        return f"/prices/{m['slug']}/", False
    best = next((by_id[i] for i in m.get("listingIds", []) if i in by_id), None)
    return (best["affiliateUrl"], True) if best and best.get("affiliateUrl") else (None, False)


def _order(models):
    good = lambda m: (m.get("verdict") or {}).get("label") == "good"
    return sorted(models, key=lambda m: (0 if good(m) else 1, brand_rank(m.get("brand") or m["name"]),
                                         -m.get("listingCount", 0), m["minPrice"]))


def _first_row(models, women_cap=True):
    """No more than two of one brand, and (adult guide) women's at most a
    quarter, in the first row; everything else follows in order."""
    first, rest, per = [], [], defaultdict(int)
    w = 0
    for m in models:
        b = (m.get("brand") or "").lower()
        is_w = women_cap and _women(m)
        if len(first) < CARDS_SHOWN and per[b] < 2 and not (is_w and w >= int(CARDS_SHOWN * WOMEN_SHARE)):
            first.append(m); per[b] += 1; w += is_w
        else:
            rest.append(m)
    return first + rest


def _tags(m, junior):
    tags = []
    if junior:
        age, h = _size(m)
        if age is not None:
            tags += [k for k, _, lo, hi in AGE_BANDS if lo <= age < hi]
        if h is not None:
            tags += [k for k, _, _, lo, hi in HEIGHT_BANDS if lo <= h < hi]
        if m["minPrice"] < 150:
            tags.append("under")
        p = _pieces(m)
        if p is not None:
            tags.append("starter" if p <= 5 else "full")
    else:
        if m["minPrice"] < 400:
            tags.append("under")
        n = m["name"].lower()
        if "cart bag" in n:
            tags.append("cart")
        if "stand bag" in n or "carry bag" in n:
            tags.append("stand")
        if (_pieces(m) or 0) >= 11:
            tags.append("p11")
    aud = "w" if (not junior and _women(m)) else "m"
    return f'data-aud="{aud}" data-tags="{" ".join(tags)}"'


def card(m, built, by_id, junior):
    href, external = _link(m, built, by_id)
    if not href:
        return ""
    img = _image(m, by_id)
    pic = (f'<img src="{esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" '
           f'onerror="this.parentNode.classList.add(\'sg-noimg\');this.remove()">') if img else ""
    good = (m.get("verdict") or {}).get("label") == "good"
    badge = '<span class="sg-badge">Lowest we’ve tracked</span>' if good else ""
    n_ret = len(m.get("retailers") or {})
    where = (f"{n_ret} retailers · compare prices" if n_ret > 1 and not external
             else "compare prices" if not external else f"at {retailer_name(m['minRetailer'])}")
    attrs = ' target="_blank" rel="sponsored nofollow noopener"' if external else ""
    data = (f' data-brand="{esc(m.get("brand") or "")}" data-price="{m["minPrice"]:.2f}" data-name="{esc(m["name"])}"'
            f' data-img="{esc(img or "")}"')
    return f"""<a class="pp-card sg-card cg-item" {_tags(m, junior)}{data} href="{esc(href)}"{attrs}>
  <span class="sg-img{'' if img else ' sg-noimg'}">{pic}</span>
  <span class="pp-sub">{esc(m.get('brand') or '')}</span>
  <span class="sg-name">{esc(m['name'])}</span>
  <span class="sg-price">from {money(m['minPrice'])}</span>
  <span class="pp-sub">{esc(where)}</span>{badge}
</a>"""


def same_set_rows(models, built):
    rows = []
    for m in models:
        if m["slug"] not in built or len(m.get("retailers") or {}) < 2:
            continue
        mins = sorted(((retailer_name(s), r["min"]) for s, r in m["retailers"].items() if r.get("min")), key=lambda x: x[1])
        gap = mins[-1][1] - mins[0][1]
        rows.append((m, mins, gap))
    rows.sort(key=lambda r: (_women(r[0]), -r[2], r[0]["minPrice"]))
    return rows


def _faq_html(qas):
    return "".join(f"<details class=\"gp-guide-q\"{' open' if i == 0 else ''}><summary>{esc(q)}</summary><p>{esc(a)}</p></details>"
                   for i, (q, a) in enumerate(qas))


def _faq_schema(qas):
    return {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qas]}


def build_guide(hub_slug, models_list, passing, built, by_id, today, noindex):
    junior = hub_slug == "junior-golf-sets"
    t = "junior-set" if junior else "set"
    sets = [m for m in models_list if m["type"] == t and m.get("listingIds")]
    if len(sets) < 10:
        return None
    ordered = _first_row(_order(sets), women_cap=not junior)
    cards = "".join(card(m, built, by_id, junior) for m in ordered)
    same = same_set_rows(sets, built)
    same_html = ""
    if same:
        trs = "".join(f"""<tr class="cg-item" {_tags(m, junior)}><th scope="row"><a href="/prices/{m['slug']}/">{esc(m['name'])}</a></th>
  {thumb_td(_image(m, by_id), f"/prices/{m['slug']}/")}
  <td>{'<br>'.join(f'<strong>{esc(r)} {money(p)}</strong>' if i == 0 else f'{esc(r)} {money(p)}' for i, (r, p) in enumerate(mins))}</td>
  <td><span class="sb-down">{'Save ' + money(gap) if gap > 0.005 else 'Same price'}</span></td></tr>""" for m, mins, gap in same)
        same_html = f"""<section class="pp-block">
  <h2>Same set, different price</h2>
  <p class="pp-small">Sets we’ve matched at more than one UK retailer, biggest difference first. We only pair sets when we’re sure they’re identical, so this list is short but reliable.</p>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table cg-list" data-show="20">
<thead><tr><th scope="col">Set</th>{THUMB_HEAD}<th scope="col">Prices today, cheapest first</th><th scope="col">Difference</th></tr></thead>
<tbody>{trs}</tbody></table></div>
  <p class="pp-small cg-none" hidden>No matched sets for this filter right now.</p>
</section>"""

    prices = [m["minPrice"] for m in sets]
    if junior:
        h1, crumb = "Junior golf set prices UK", "Junior golf sets"
        title = "Junior Golf Set Prices UK: By Age & Height | GolfPrice AI"
        desc = ("UK junior golf set prices from multiple UK retailers, checked every 6 hours. Browse by age or by your "
                "child’s height, with genuine price drops only.")
        brands = sorted({m.get("brand") for m in sets if m.get("brand")}, key=lambda b: -sum(1 for m in sets if m.get("brand") == b))[:6]
        answer = (f"On {long_date(today)}, junior golf sets start from <strong>{money(min(prices))}</strong> and a typical set "
                  f"costs about <strong>{money(statistics.median(prices))}</strong>. We track <strong>{len(sets)} junior sets</strong> "
                  f"across multiple UK retailers, from brands including {esc(', '.join(brands))}. Pick by age or, better, by your child’s height.")
        def band_tiles(bands, by):
            out = []
            for b in bands:
                key, label = b[0], b[1]
                lo, hi = b[-2], b[-1]
                ms = [m for m in sets if (v := _size(m)[by]) is not None and lo <= v < hi]
                if not ms:
                    continue
                sub = f"{b[2]} · " if by == 1 else ""
                out.append(f'<button type="button" class="cg-band cg-chip" data-f="{key}" aria-pressed="false"><b>{esc(label)}</b>'
                           f'<span>{esc(sub)}{len(ms)} sets · from {money(min(m["minPrice"] for m in ms))} · typical {money(statistics.median([m["minPrice"] for m in ms]))}</span></button>')
            return "".join(out)
        chips = [("all", "All"), ("under", "Under £150"), ("starter", "Starter (up to 5 pieces)"), ("full", "Fuller sets (6+ pieces)")]
        extra_after = ""
        extra = f"""<section class="pp-block"><h2>Shop by age</h2><div class="cg-bands">{band_tiles(AGE_BANDS, 0)}</div></section>
<section class="pp-block"><h2>Shop by height (most accurate)</h2>
  <p class="pp-small">Junior clubs are made for a child’s height, not their age, and children the same age can be very different sizes. Measure them in their shoes, then pick the band. The ages are a rough guide only; check the retailer’s size chart before you buy.</p>
  <div class="cg-bands">{band_tiles(HEIGHT_BANDS, 1)}</div></section>"""
        guide = """<section class="pp-block"><h2>Buying a junior set as a gift?</h2><div class="cg-types">
  <div class="cg-type"><h3>Size matters most</h3><p>Clubs that are too long are harder to swing. If a child is between sizes, most coaches suggest the size that fits now rather than one to grow into.</p></div>
  <div class="cg-type"><h3>How many clubs?</h3><p>Young beginners only need 3 to 5 clubs. Bigger sets suit children who already play or have lessons.</p></div>
  <div class="cg-type"><h3>Watch the price</h3><p>Open any set’s price page and tap “Email me when it drops”. We’ll tell you if it gets cheaper before you buy.</p></div>
</div></section>"""
        qas = [("What size junior golf set do I need?",
                "Go by height rather than age. Measure your child in their shoes and pick the set made for that height; sets sold by age give a rough range, and the retailer’s size chart is the final word."),
               ("How much does a junior golf set cost?",
                f"Today junior sets start from {money(min(prices))}, and a typical set is about {money(statistics.median(prices))}. Prices rise with the number of clubs and the size of the set."),
               ("Are these prices for new sets?",
                "Yes. We only list new stock that’s in stock now, and check every price every 6 hours across multiple UK retailers."),
               ("Are the price drops real?",
                "Yes. A set is marked “Lowest we’ve tracked” only when today’s price is the lowest we’ve recorded for it, checked against our own price history.")]
    else:
        h1, crumb = "Golf package set prices UK", "Golf package sets"
        title = "Golf Package Set Prices UK: Compare Complete Sets | GolfPrice AI"
        desc = ("UK golf package set prices from multiple UK retailers, checked every 6 hours: complete men’s and women’s sets "
                "for beginners and improvers, with genuine price drops only.")
        men = [m for m in sets if not _women(m)]
        women = [m for m in sets if _women(m)]
        base = men or sets
        answer = (f"On {long_date(today)}, men’s golf package sets start from <strong>{money(min(m['minPrice'] for m in base))}</strong> "
                  f"and a typical men’s set costs about <strong>{money(statistics.median([m['minPrice'] for m in base]))}</strong>."
                  + (f" Women’s sets start from <strong>{money(min(m['minPrice'] for m in women))}</strong>." if women else "")
                  + f" We track <strong>{len(sets)} complete sets</strong> across multiple UK retailers, new stock only.")
        chips = [("all", "All"), ("m", "Men’s")] + ([("w", "Women’s")] if len(women) >= 3 else []) + \
                [("under", "Under £400"), ("cart", "Cart bag"), ("stand", "Stand bag"), ("p11", "11+ pieces")]
        tiles = "".join(f'<div class="cg-type"><h3>{esc(n)} <span class="pp-sub">{esc(r)}</span></h3>'
                        f'<p><b>{sum(1 for m in men if lo <= m["minPrice"] < hi)}</b> men’s sets</p></div>' for n, r, lo, hi in PRICE_BANDS)
        if women:
            tiles += f'<div class="cg-type"><h3>Women’s sets</h3><p><b>{len(women)}</b> sets · typical {money(statistics.median([m["minPrice"] for m in women]))}</p></div>'
        # Server-rendered for "All"; js/clothing-guide.js rebuilds it from the
        # cards whenever a filter is picked, so it always matches the chips.
        by_brand = defaultdict(list)
        for m in sets:
            if m.get("brand"):
                by_brand[m["brand"]].append(m)
        brows = sorted(by_brand.items(), key=lambda x: (-len(x[1]), x[0]))[:10]
        def lead(ms):  # men's or unisex first, as on the rest of the site
            men = [m for m in ms if not _women(m)] or ms
            return min(men, key=lambda m: m["minPrice"])
        brand_rows = "".join(f"""<tr><th scope="row">{esc(b)}</th>{thumb_td(_image(lead(ms), by_id))}<td>{esc(lead(ms)['name'])}</td>
  <td class="pp-price">{money(lead(ms)['minPrice'])}</td><td>{len(ms)}</td></tr>""" for b, ms in brows)
        extra_after = f"""<section class="pp-block"><h2>What do you get for your money?</h2><div class="cg-types">{tiles}</div></section>"""
        if brand_rows:
            extra_after += f"""<section class="pp-block cg-brands" data-noun="package set">
  <h2>Cheapest <span class="cg-brands-label"></span>package set by brand</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table"><thead><tr><th scope="col">Brand</th>{THUMB_HEAD}<th scope="col">Cheapest set today</th><th scope="col">From</th><th scope="col">Sets</th></tr></thead>
<tbody>{brand_rows}</tbody></table></div>
  <p class="pp-small cg-brands-none" hidden>No sets for this filter right now.</p></section>"""
        extra = ""
        guide = """<section class="pp-block"><h2>New to golf? What’s in a package set</h2><div class="cg-types">
  <div class="cg-type"><h3>Pieces</h3><p>“11-piece” counts every item: usually a driver, a wood or hybrid, irons, a wedge, a putter, the bag and headcovers. More pieces doesn’t always mean more clubs.</p></div>
  <div class="cg-type"><h3>Cart or stand bag?</h3><p>Stand bags have legs and are lighter to carry. Cart bags sit on a trolley and have more pockets. Pick the one that matches how you get round.</p></div>
  <div class="cg-type"><h3>Set or separate clubs?</h3><p>For beginners and improvers, a set is usually far cheaper than buying the same clubs one by one. Better players tend to choose clubs individually.</p></div>
</div></section>"""
        qas = [("How much does a golf package set cost?",
                f"Today men’s sets start from {money(min(m['minPrice'] for m in base))}, and a typical set is about {money(statistics.median([m['minPrice'] for m in base]))}. Beginner sets sit under £400; premium sets from the big brands run to £800 and more."),
               ("Is a package set good for beginners?",
                "Yes. A package set gives you a full, matched set of clubs and a bag for much less than buying them separately, which is ideal while you find out how much you’ll play."),
               ("What does “piece” mean in a golf set?",
                "It counts every item in the box, usually including the bag and headcovers, so an 11-piece set might have 8 or 9 clubs."),
               ("Are the price drops real?",
                "Yes. A set is marked “Lowest we’ve tracked” only when today’s price is the lowest we’ve recorded for it, checked against our own price history across multiple UK retailers.")]

    chip_html = "".join(f'<button type="button" class="pp-chip cg-chip{" sg-on" if k == "all" else ""}" data-f="{k}" aria-pressed="{"true" if k == "all" else "false"}">{esc(lbl)}</button>'
                        for k, lbl in chips)
    other = ('<a class="pp-chip" href="/prices/golf-package-sets/">Adult package sets</a>' if junior
             else '<a class="pp-chip" href="/prices/junior-golf-sets/">Junior golf sets</a>')
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (crumb, None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Updated every 6 hours</span>
  <h1>{h1}</h1>
  <p class="pp-answer">{answer}</p>
  <div class="pp-chips cg-chips" role="group" aria-label="Show">{chip_html}</div>
  <p class="pp-disclose">We may earn a commission if you buy through links on this page. It never changes the prices or the order.</p>
</section>
{extra}
<section class="pp-block">
  <h2>{'Junior golf sets' if junior else 'Golf package sets'} we track</h2>
  <p class="pp-small">Ordered by the data, not by brand: genuine drops and lowest tracked prices first. Sets with a price page show their full price history there.</p>
  <div class="sg-grid cg-list" data-show="{CARDS_SHOWN}">{cards}</div>
  <p class="pp-small cg-none" hidden>Nothing to show for this filter right now.</p>
  <p><button type="button" class="pp-chip cg-more">Show more</button></p>
</section>
{same_html}
{extra_after}
{guide}
<section class="pp-block"><h2>Common questions</h2><div class="cg-faq">{_faq_html(qas)}</div></section>
<section class="pp-block"><h2>More price guides</h2><div class="pp-chips">{other}<a class="pp-chip" href="/prices/irons/">Iron sets</a><a class="pp-chip" href="/prices/golf-bags/">Golf bags</a><a class="pp-chip" href="/prices/golf-gifts/">Golf gifts</a><a class="pp-chip" href="/prices/">All price guides</a></div></section>
{method_note(today)}
</div>
<script src="/js/clothing-guide.js?v=20261018" defer></script>"""
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/{hub_slug}/", body=body,
                      section="clubs", schema=[crumbs_schema, _faq_schema(qas)], noindex=noindex)
