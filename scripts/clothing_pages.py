"""Clothing, shoe and glove price guides: /prices/golf-shoes/ and friends.

Seven guides (shoes, polo shirts, jackets and waterproofs, mid-layers,
trousers, shorts, gloves), rebuilt every 6 hours with the other price pages
(called from price_pages.build). Approved mock-up 16 Oct 2026.

How each guide works:
  * Listings are grouped into "styles": every size, colour and retailer of
    the same product (the name before " - ") becomes one style, priced at
    its lowest new, in-stock price.
  * New stock only: no pre-owned, no junior items, nothing out of stock,
    nothing without a photo. Odd things filed in the same category (spike
    wrenches with shoes, rain hoods with jackets) are left out by name.
  * Men's and unisex styles lead, as most visitors are men: the answer box
    and fact tiles use men's prices, and women's styles make up no more than
    a quarter of the cards and drops shown before a filter is chosen. The
    brand table has a men's column and a women's column.
  * "Lowest we've tracked" and the drops table use each listing's own price
    history: today's price is at its tracked low and at least £5 and 3%
    (and under 60%) below the highest price we've recorded for it. Never the
    retailer's "was" price.
  * A guide with fewer than 24 styles isn't built (and an existing page is
    left as it is, so links never break).
"""
import json
import re
import statistics
from collections import defaultdict

from price_pages import THUMB_HEAD, thumb_td, PRICES_DIR, SITE, breadcrumb, esc, long_date, method_note, money, retailer_name, _write
from price_pages import page_shell
from seasonal_pages import brand_rank, display_name, _same_thing
from winter_page import _ok

MIN_STYLES = 24
CARDS = 36           # rendered; the page shows 12 at a time
CARDS_SHOWN = 12
DROPS = 10
WOMEN_SHARE = 0.25   # most women's items shown before a filter is picked
JUNIOR_RX = re.compile(r"\b(jr|junior|juniors|kids?|youth|boys|girls|child(ren)?)\b", re.I)
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
WP = r"waterproof|gore-?tex|rain|stadry|dryvr|hydrolite|h2no|climaproof|rain\.rdy"

# slug: settings. test = (categories or None, icons or None, must match, must not match, min price)
GUIDES = {
    "golf-shoes": dict(
        name="golf shoes", one="pair", h1="Golf shoe prices UK",
        title="Golf Shoe Prices UK: Compare Spikeless, Spiked & Boots | GolfPrice AI",
        desc="UK golf shoe prices from multiple UK retailers, checked every 6 hours: spikeless, spiked, waterproof and boots from FootJoy, adidas, ECCO and more. Genuine drops only.",
        test=({"shoes"}, None, r"\b(shoes?|boots?)\b", r"\b(wrench|cleat|bag|laces?|insoles?|tool|cleaner|stretcher|shoe ?tree|socks?|spike ?kit)\b", 15),
        need_golf=True, under=60,
        subs=[("Spikeless", r"spikeless|spikless|spike-less"), ("Spiked", r"\bspiked\b|\bspikes?\b"),
              ("Waterproof", WP), ("Boots", r"\bboots?\b")],
        blurbs={"Spikeless": "Comfortable on and off the course.", "Spiked": "More grip on wet or hilly courses.",
                "Waterproof": "Dry feet through the winter.", "Boots": "For proper winter mud."},
        faq=[("When are golf shoes cheapest?",
              "Prices tend to move when new ranges arrive and older colours are cleared, and at sale times like Black Friday. The drops table above shows which ones are genuinely cheaper right now, against our own price history.")]),
    "golf-polo-shirts": dict(
        name="golf polo shirts", one="shirt", h1="Golf polo shirt prices UK",
        title="Golf Polo Shirt Prices UK: Compare Brands & Genuine Drops | GolfPrice AI",
        desc="UK golf polo shirt prices from multiple UK retailers, checked every 6 hours, from FootJoy, adidas, PUMA, Galvin Green and more, with genuine price drops only.",
        test=(None, {"polo"}, r"polo|\bgolf shirt\b|\bshirt\b", r"\b(dress|skort|jacket|trousers?|shorts?|t[- ]?shirt|tee|tank|flannel|oxford|button[- ]down|vest)\b", 8),
        under=30,
        subs=[("Plain", r"solid|plain|essential|core|classic"), ("Printed & striped", r"print|stripe|pattern|geo|camo|floral|jacquard"),
              ("Long sleeve", r"long sleeve|l/s|\bls\b")],
        blurbs={"Plain": "Solid colours that go with anything.", "Printed & striped": "Prints, stripes and patterns.",
                "Long sleeve": "Covered arms for cooler rounds."},
        faq=[("How much should I pay for a golf polo?",
              "Most branded golf polos sit between £25 and £60. Last season's colours from the big brands are often among the genuine drops above.")]),
    "golf-jackets": dict(
        name="golf jackets and waterproofs", one="jacket", h1="Golf jacket and waterproof prices UK",
        title="Golf Jacket & Waterproof Prices UK: Compare Rain & Wind Jackets | GolfPrice AI",
        desc="UK prices on golf waterproofs, wind jackets, gilets and insulated jackets from multiple UK retailers, checked every 6 hours. Genuine price drops only.",
        test=(None, {"jacket"}, r"jacket|waterproof|rain|gilet|\bvest\b|wind|softshell|padded|insulated|anorak|smock|cagoule",
              r"pullover|1/4 zip|quarter zip|half zip|1/2 zip|mid ?-?layer|sweater|jumper|fleece|hoodie|cardigan|\bhood\b|\bcape\b|polo|trousers?|shorts?|crew ?neck|sweatshirt|top\b", 15),
        under=60,
        subs=[("Waterproof", WP), ("Windproof", r"wind"), ("Gilets & vests", r"gilet|\bvest\b|sleeveless"),
              ("Insulated", r"padded|insulated|thermal|quilted|puffer|down\b")],
        blurbs={"Waterproof": "Proper rain jackets for wet rounds.", "Windproof": "Light layers for blustery days.",
                "Gilets & vests": "Warm core, free arms.", "Insulated": "Padded and thermal jackets for winter."},
        faq=[("Is a more expensive golf waterproof worth it?",
              "Often, yes. Higher-priced waterproofs usually come with better waterproof ratings, quieter fabrics and longer guarantees. The genuine drops above are a good way to get one for less.")]),
    "golf-mid-layers": dict(
        name="golf mid-layers", one="mid-layer", h1="Golf mid-layer and jumper prices UK",
        title="Golf Mid-Layer & Jumper Prices UK: 1/4 Zips, Sweaters & Hoodies | GolfPrice AI",
        desc="UK prices on golf 1/4 zips, pullovers, sweaters and hoodies from multiple UK retailers, checked every 6 hours. Genuine price drops only.",
        test=(None, {"jacket", "hoodie"}, r"pullover|1/4 zip|quarter zip|half zip|1/2 zip|mid ?-?layer|sweater|jumper|fleece|hoodie|cardigan|crew ?neck|sweatshirt",
              WP + r"|gilet|\bvest\b|base ?layer|polo|trousers?|shorts?|\bcap\b|beanie|\bhat\b|gaiter|snood|glove|mitt|headband|neck ?warmer", 12),
        under=40,
        subs=[("1/4 zips", r"1/4 zip|quarter zip|half zip|1/2 zip"), ("Jumpers & sweaters", r"sweater|jumper|crew ?neck|sweatshirt|cardigan|v-?neck"),
              ("Hoodies", r"hoodie|hooded"), ("Fleece", r"fleece")],
        blurbs={"1/4 zips": "The classic golf layer.", "Jumpers & sweaters": "Crew and V-necks.",
                "Hoodies": "Casual and warm.", "Fleece": "Light warmth without bulk."},
        faq=[("What should I wear under a golf waterproof?",
              "A thin base layer, then a 1/4 zip or light jumper. It keeps you warm without restricting your swing, and you can take a layer off as the day warms up.")]),
    "golf-trousers": dict(
        name="golf trousers", one="pair", h1="Golf trouser prices UK",
        title="Golf Trouser Prices UK: Compare Winter, Waterproof & Tapered | GolfPrice AI",
        desc="UK golf trouser prices from multiple UK retailers, checked every 6 hours: tapered, winter, waterproof and joggers. Genuine price drops only.",
        test=(None, {"trousers"}, r"trousers?|pants?|joggers?|chinos?", r"\bshorts?\b|jacket|\bsuit\b|skort", 12),
        under=40,
        subs=[("Tapered & slim", r"taper|slim"), ("Winter & thermal", r"winter|thermal|lined|warm|insulated"),
              ("Waterproof", WP), ("Joggers", r"jogger")],
        blurbs={"Tapered & slim": "The modern golf fit.", "Winter & thermal": "Lined and warm for cold rounds.",
                "Waterproof": "Over-trousers for the rain.", "Joggers": "Relaxed fit, still course-smart."},
        faq=[("Do I need waterproof golf trousers?",
              "If you play through the winter, a pair is worth having. Waterproof trousers go over normal golf trousers, so you only need them when it rains.")]),
    "golf-shorts": dict(
        name="golf shorts", one="pair", h1="Golf shorts prices UK",
        title="Golf Shorts Prices UK: Compare Brands & Genuine Drops | GolfPrice AI",
        desc="UK golf shorts and skort prices from multiple UK retailers, checked every 6 hours, with genuine price drops only.",
        test=(None, {"shorts", "skort"}, r"shorts?|skorts?", r"trousers?|jacket|base ?layer|compression", 10),
        under=30,
        subs=[("Shorts", r"\bshorts?\b"), ("Skorts", r"skort")],
        blurbs={"Shorts": "Lightweight and quick to dry.", "Skorts": "Skirt and shorts in one."},
        faq=[("When is the best time to buy golf shorts?",
              "Shorts are often cheaper from late summer into winter, when retailers clear summer stock. Check the genuine drops above to see what's actually reduced.")]),
    "golf-gloves": dict(
        name="golf gloves", one="glove", h1="Golf glove prices UK",
        title="Golf Glove Prices UK: Compare Leather, All-Weather & Winter | GolfPrice AI",
        desc="UK golf glove prices from multiple UK retailers, checked every 6 hours: leather, all-weather, winter and rain gloves from FootJoy, Titleist and more.",
        test=(None, {"glove"}, r"glove|mitt", r"trolley|cart|\bbag\b|umbrella|holder|towel", 5),
        under=15,
        subs=[("Leather", r"leather|cabretta"), ("Winter", r"winter|thermal|cold|mitt"), ("Rain", r"\brain\b|\bwet\b|rainsof|raingrip"),
              ("Multi-packs", r"multi|pack|\b[2-6] ?(pk|pack)|pair")],
        blurbs={"Leather": "Best feel, for dry days.", "Winter": "Pairs and mitts for cold hands.",
                "Rain": "Grip better when wet.", "Multi-packs": "More gloves for less each."},
        faq=[("How often should I replace my golf glove?",
              "It depends how often you play, but a glove that's shiny, stretched or torn won't grip properly. Multi-packs and genuine drops are the cheapest way to keep a fresh one in the bag.")]),
}
# Where each guide is linked from (title, short description) on the price-guide index.
LINKS = {
    "golf-shoes": ("Golf shoes", "Spikeless, spiked and boots"),
    "golf-polo-shirts": ("Golf polo shirts", "Every brand, lowest price first"),
    "golf-jackets": ("Golf jackets and waterproofs", "Rain, wind, gilets and insulated"),
    "golf-mid-layers": ("Golf mid-layers", "1/4 zips, jumpers and hoodies"),
    "golf-trousers": ("Golf trousers", "Tapered, winter and waterproof"),
    "golf-shorts": ("Golf shorts", "Shorts and skorts"),
    "golf-gloves": ("Golf gloves", "Leather, all-weather and winter"),
}


def _womens(p):
    return p.get("audience") == "Female" or bool(WOMEN_RX.search(p["name"]))


def _low_info(p):
    """(at its tracked low and genuinely below its tracked high, highest tracked)"""
    ins = p.get("priceInsight") or {}
    low, high = ins.get("historicalLow"), ins.get("historicalHigh") or 0
    price = p["salePrice"]
    fall = high - price
    ok = (low is not None and price <= low + 0.005 and fall >= max(5.0, high * 0.03) and fall < high * 0.60)
    return ok, high


def styles(products, g):
    cats, icons, need, skip, floor = g["test"]
    need, skip = re.compile(need, re.I), re.compile(skip, re.I)
    golf = re.compile(r"golf|spikeless|spikless|spiked|\bspikes?\b", re.I)
    groups = {}
    for p in products:
        if not _ok(p) or p["salePrice"] < floor:
            continue
        if (cats and p.get("category") not in cats) or (icons and p.get("icon") not in icons):
            continue
        head = p["name"].split(" - ")[0]
        if not need.search(head) or skip.search(head):
            continue
        if g.get("need_golf") and not golf.search(p["name"]):
            continue
        if JUNIOR_RX.search(p["name"]):
            continue
        name = display_name(p)
        key = name.lower()
        s = groups.get(key)
        if not s:
            s = groups[key] = {"name": name, "best": p, "n": 0, "sources": set(), "women": False}
        s["n"] += 1
        s["sources"].add(p["source"])
        s["women"] = s["women"] or _womens(p)
        if p["salePrice"] < s["best"]["salePrice"]:
            s["best"] = p
    out = []
    for s in groups.values():
        p = s["best"]
        low, high = _low_info(p)
        text = s["name"] + " " + p["name"]
        s.update(price=p["salePrice"], brand=(p.get("brand") or "").strip(), low=low, high=high,
                 subs=[label for label, rx in g["subs"] if re.search(rx, text, re.I)])
        out.append(s)
    return out


def _varied(items, limit, per_brand=2):
    """Drop near-duplicates (the same product listed twice under slightly
    different names), and let no brand take more than two of the first
    `limit` places, so it's a real choice."""
    kept = []
    for s in items:
        if any(s["brand"] == k["brand"] and _same_thing(s["name"], k["name"]) for k in kept):
            continue
        kept.append(s)
    first, rest, per = [], [], defaultdict(int)
    for s in kept:
        b = s["brand"].lower()
        if len(first) < limit and per[b] < per_brand:
            first.append(s); per[b] += 1
        else:
            rest.append(s)
    return first + rest


def _women_capped(items, limit):
    """Men's and unisex first; women's at most a quarter of what's shown."""
    cap = max(1, int(limit * WOMEN_SHARE))
    first, rest, w = [], [], 0
    for s in items:
        if s["women"]:
            if w < cap and len(first) < limit:
                first.append(s); w += 1
            else:
                rest.append(s)
        elif len(first) < limit:
            first.append(s)
        else:
            rest.append(s)
    return first + rest


def _data_attrs(s, g):
    subs = " ".join(re.sub(r"[^a-z]+", "-", x.lower()).strip("-") for x in s["subs"])
    under = " under" if s["price"] <= g["under"] else ""
    return f'data-aud="{"w" if s["women"] else "m"}" data-tags="{subs}{under}"'


def card(s, g):
    p = s["best"]
    where = (f"at {esc(retailer_name(p['source']))}" if len(s["sources"]) == 1
             else f"{len(s['sources'])} retailers")
    opts = f"{s['n']} sizes &amp; colours · " if s["n"] > 1 and len(s["sources"]) == 1 else ""
    badge = '<span class="sg-badge">Lowest we’ve tracked</span>' if s["low"] else ""
    return f"""<a class="pp-card sg-card cg-item" {_data_attrs(s, g)} href="{esc(p['affiliateUrl'])}" target="_blank" rel="sponsored nofollow noopener">
  <span class="sg-img"><img src="{esc(p['image'])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('sg-noimg');this.remove()"></span>
  <span class="pp-sub">{esc(s['brand'])}</span>
  <span class="sg-name">{esc(s['name'])}</span>
  <span class="sg-price">{money(s['price'])}</span>
  <span class="pp-sub">{opts}{where}</span>{badge}
</a>"""


def drop_row(s, g):
    p = s["best"]
    fall = s["high"] - s["price"]
    return f"""<tr class="cg-item" {_data_attrs(s, g)}>
  <th scope="row"><a href="{esc(p['affiliateUrl'])}" target="_blank" rel="sponsored nofollow noopener">{esc(s['name'])}</a><span class="pp-sub sb-type">{"Women’s · " if s["women"] else ""}at {esc(retailer_name(p['source']))}</span></th>
  {thumb_td(p.get('image'))}
  <td><s>{money(s['high'])}</s></td>
  <td class="pp-price">{money(s['price'])}</td>
  <td><span class="sb-down">−{money(fall)} ({round(fall / s['high'] * 100)}%)</span></td>
</tr>"""


def _median(xs):
    return statistics.median(xs) if xs else None


def build_one(slug, g, products, today):
    st = styles(products, g)
    if len(st) < MIN_STYLES:
        print(f"Clothing guide {slug}: only {len(st)} styles, not built.")
        return None
    men = [s for s in st if not s["women"]]
    women = [s for s in st if s["women"]]
    base = men if len(men) >= 10 else st
    cheapest = min(base, key=lambda s: s["price"])
    typical = _median([s["price"] for s in base])
    n_low = sum(1 for s in st if s["low"])

    women_bit = ""
    if len(women) >= 3:
        w_cheap = min(women, key=lambda s: s["price"])
        women_bit = f" Women’s {g['name']} start from <strong>{money(w_cheap['price'])}</strong>."
    who = "men’s " if base is men else ""
    answer = (f"On {long_date(today)}, {who}{g['name']} start from <strong>{money(cheapest['price'])}</strong> "
              f"({esc(cheapest['name'])} at {esc(retailer_name(cheapest['best']['source']))}), and a typical {who}{g['one']} "
              f"costs about <strong>{money(typical)}</strong>.{women_bit} We track <strong>{len(st)} styles</strong> across "
              f"multiple UK retailers, and {n_low} {'is' if n_low == 1 else 'are'} at the lowest price we’ve recorded.")

    # Popular styles: well-known brands, widely stocked, at their low first.
    pop = sorted(st, key=lambda s: (0 if s["low"] else 1, brand_rank(s["brand"] or s["name"]), -s["n"], s["price"]))
    pop = _women_capped(_varied(pop, CARDS_SHOWN * 2), CARDS_SHOWN)[:CARDS]
    # A filter needs something to show: make sure some of each kind are in.
    have = {s["name"] for s in pop}
    for label, _ in g["subs"]:
        extra = [s for s in st if label in s["subs"] and s["name"] not in have
                 and not any(s["brand"] == k["brand"] and _same_thing(s["name"], k["name"]) for k in pop)]
        extra.sort(key=lambda s: (0 if s["low"] else 1, brand_rank(s["brand"] or s["name"]), s["price"]))
        for s in extra[:4]:
            pop.append(s); have.add(s["name"])
    w_extra = sorted([s for s in women if s["name"] not in have], key=lambda s: (brand_rank(s["brand"] or s["name"]), s["price"]))
    pop += w_extra[:6]

    drops = sorted([s for s in st if s["low"]], key=lambda s: -(s["high"] - s["price"]) / s["high"])
    drops = _women_capped(_varied(drops, DROPS * 2), DROPS)[:DROPS * 3]

    # Brand table: brands with 3+ styles, by number of men's styles.
    by_brand = defaultdict(list)
    for s in st:
        if s["brand"]:
            by_brand[s["brand"]].append(s)
    brands = [(b, ss) for b, ss in by_brand.items() if len(ss) >= 3]
    brands.sort(key=lambda x: (-sum(1 for s in x[1] if not s["women"]), -len(x[1])))
    brand_rows = []
    for b, ss in brands[:10]:
        m = [s for s in ss if not s["women"]]
        w = [s for s in ss if s["women"]]
        mc = min(m, key=lambda s: s["price"]) if m else None
        wc = min(w, key=lambda s: s["price"]) if w else None
        brand_rows.append(f"""<tr><th scope="row">{esc(b)}</th>
  {thumb_td(mc["best"].get("image") if mc else None)}
  <td>{f'{esc(mc["name"])}<span class="pp-sub sb-type">at {esc(retailer_name(mc["best"]["source"]))}</span>' if mc else '<span class="pp-sub">None tracked</span>'}</td>
  <td class="pp-price">{money(mc['price']) if mc else '–'}</td>
  <td class="pp-price">{money(wc['price']) if wc else '–'}</td>
  <td>{len(ss)}</td></tr>""")

    # Types: typical and lowest price for each (men's where there are enough).
    type_cells = []
    for label, _ in g["subs"]:
        ss = [s for s in st if label in s["subs"]]
        if len(ss) < 3:
            continue
        sm = [s for s in ss if not s["women"]]
        use = sm if len(sm) >= 3 else ss
        type_cells.append(f"""<div class="cg-type"><h3>{esc(label)}</h3><p>{len(ss)} styles. Typical{' men’s' if use is sm else ''} price <b>{money(_median([s['price'] for s in use]))}</b>, from <b>{money(min(s['price'] for s in use))}</b>. {esc(g['blurbs'].get(label, ''))}</p></div>""")

    chips = [("all", "All"), ("m", "Men’s")] + ([("w", "Women’s")] if len(women) >= 3 else [])
    chips += [(re.sub(r"[^a-z]+", "-", label.lower()).strip("-"), label) for label, _ in g["subs"]
              if sum(1 for s in st if label in s["subs"]) >= 3]
    chips.append(("under", f"Under £{g['under']}"))
    chip_html = "".join(f'<button type="button" class="pp-chip cg-chip{" sg-on" if k == "all" else ""}" data-f="{k}" aria-pressed="{"true" if k == "all" else "false"}">{esc(t)}</button>'
                        for k, t in chips)

    faq = [(f"How much should I pay for {g['name']}?",
            f"Today a typical {who}{g['one']} costs about {money(typical)}, and the cheapest {who}{g['name']} start from {money(cheapest['price'])}. "
            f"Anything marked “Lowest we’ve tracked” is cheaper than we’ve seen it before.")] + g["faq"] + [
           ("Are these new?", "Yes. These guides only cover new stock that's in stock now. Junior sizes and second-hand items are left out."),
           ("Are the price drops real?", "Yes. A drop only counts when today's price is the lowest we've recorded for it and at least £5 and 3% below its highest tracked price. We never use a retailer's own “was” price.")]
    faq_html = "".join(f"<details class=\"gp-guide-q\"{' open' if i == 0 else ''}><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for i, (q, a) in enumerate(faq))
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage",
                  "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}
    others = "".join(f'<a class="pp-chip" href="/prices/{s}/">{esc(LINKS[s][0])}</a>' for s in GUIDES if s != slug)

    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (LINKS[slug][0], None)])
    drops_html = (f"""<section class="pp-block">
  <h2>Biggest genuine drops on {esc(g['name'])}</h2>
  <p class="pp-small">Each one is at the lowest price we’ve recorded for it, and at least £5 and 3% below the highest price we’ve tracked. Never the retailer’s “was” price.</p>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table cg-list" data-show="{DROPS}">
<thead><tr><th scope="col">Style</th>{THUMB_HEAD}<th scope="col">Highest tracked</th><th scope="col">Now</th><th scope="col">Drop</th></tr></thead>
<tbody>{''.join(drop_row(s, g) for s in drops)}</tbody></table></div>
  <p class="pp-small cg-none" hidden>Nothing in this filter has a genuine drop right now.</p>
</section>""" if drops else "")
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Updated every 6 hours</span>
  <h1>{esc(g['h1'])}</h1>
  <p class="pp-answer">{answer}</p>
  <div class="pp-chips cg-chips" role="group" aria-label="Show">{chip_html}</div>
  <p class="pp-disclose">We may earn a commission if you buy through links on this page. It never changes the prices or the order.</p>
</section>
{drops_html}
<section class="pp-block">
  <h2>Popular {esc(g['name'])}</h2>
  <p class="pp-small">Sizes and colours are grouped, and each price is the lowest across them. Each one links to the retailer.</p>
  <div class="sg-grid cg-list" data-show="{CARDS_SHOWN}">{''.join(card(s, g) for s in pop)}</div>
  <p class="pp-small cg-none" hidden>Nothing to show for this filter right now.</p>
  <p><button type="button" class="pp-chip cg-more">Show more</button></p>
</section>
{f'''<section class="pp-block">
  <h2>Cheapest {esc(g['name'])} by brand</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
<thead><tr><th scope="col">Brand</th>{THUMB_HEAD}<th scope="col">Cheapest men’s style</th><th scope="col">Men’s from</th><th scope="col">Women’s from</th><th scope="col">Styles</th></tr></thead>
<tbody>{''.join(brand_rows)}</tbody></table></div>
</section>''' if brand_rows else ''}
{f'<section class="pp-block"><h2>Which type?</h2><div class="cg-types">{"".join(type_cells)}</div></section>' if type_cells else ''}
<section class="pp-block">
  <h2>Common questions</h2>
  <div class="cg-faq">{faq_html}</div>
</section>
<section class="pp-block"><h2>More clothing price guides</h2><div class="pp-chips">{others}<a class="pp-chip" href="/apparel.html">All golf clothing</a></div></section>
{method_note(today)}
</div>
<script src="/js/clothing-guide.js?v=20261018" defer></script>"""
    page = page_shell(title=g["title"], description=g["desc"], canonical=f"{SITE}/prices/{slug}/", body=body,
                      section="apparel", schema=[crumbs_schema, faq_schema], noindex=False)
    changed = _write(PRICES_DIR / slug / "index.html", page)
    print(f"Clothing guide {slug}: {len(st)} styles ({len(women)} women’s), {n_low} at their lowest, "
          f"{len(pop)} cards, {len(brand_rows)} brands.")
    return changed


def build(products, today):
    """Returns (changed urls, sitemap entries, index links)."""
    changed, sitemap, links = [], [], []
    for slug, g in GUIDES.items():
        try:
            res = build_one(slug, g, products, today)
        except Exception as e:  # one bad guide never stops the others
            print(f"Clothing guide {slug}: skipped ({e}).")
            res = None
        if res is None and not (PRICES_DIR / slug / "index.html").exists():
            continue
        if res:
            changed.append(f"/prices/{slug}/")
        sitemap.append((f"prices/{slug}/", today.isoformat() if res else None))
        links.append((f"/prices/{slug}/", LINKS[slug][0], LINKS[slug][1]))
    return changed, sitemap, links
