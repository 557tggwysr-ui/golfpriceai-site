"""Winter golf page: /prices/winter-golf/

Waterproofs, warm layers and the small things that make winter golf
bearable, at live UK prices, rebuilt every 6 hours with the other price
pages (called from price_pages.build).

  * Each shelf shows 6 items (one full row on desktop, two on tablet, three
    on a phone). A shelf with fewer than 6 good items is left out.
  * Within a shelf: well-known brands first, and items at the lowest price
    we've tracked for them (and genuinely below their tracked high) first
    within that. One or two per brand, so it's a real choice.
  * "Lowest we've tracked" comes from each listing's own price history, never
    from the retailer's "was" price.
  * New stock only: no pre-owned, no junior items, nothing out of stock.
  * The "winter kit" box adds up today's cheapest well-known-brand jacket,
    trousers, mitts and hat from the shelves.

The homepage strip under the hero links here from mid-October to the end of
February (outside the Black Friday, Christmas and Boxing Day windows).
"""
import re
from collections import defaultdict

from price_pages import PRICES_DIR, SITE, breadcrumb, esc, long_date, method_note, money, retailer_name, _write
from price_pages import page_shell
from seasonal_pages import brand_rank, display_name, model_card, per, signup_box, _same_thing

SLUG = "winter-golf"
PER_SHELF = 6
MIN_PRICE = 5.0
# Brands known for winter and wet-weather golf wear, on top of the site-wide list.
WINTER_BRANDS = {"sunderland": 40, "abacus": 41, "proquip": 42, "stuburt": 43, "oscar jacobson": 44, "glenmuir": 45,
                 "island green": 46, "zero restriction": 47, "rohnisch": 48, "daily sports": 49, "skechers": 50}
# (title, test) where test = (categories or None, icons or None, must match, must not match, min price)
SHELVES = {
    "dry": [
        ("Waterproof jackets", (None, {"jacket"}, r"waterproof|rain|gore-?tex|stadry|hydrolite|dryvr|climaproof", r"gilet|vest|hoodie|polo|mid-?layer|pullover|fleece", 30)),
        ("Waterproof trousers", (None, {"trousers"}, r"waterproof|rain", r"short|jacket|suit", 25)),
        ("Waterproof golf shoes", ({"shoes"}, None, r"waterproof|gore-?tex", r"junior|kids|spike ?wrench|bag", 40)),
        ("Umbrellas", (None, {"umbrella"}, r"umbrella", r"holder|cover|mount|bracket|adaptor|adapter", 10)),
    ],
    "warm": [
        ("Thermal and insulated mid-layers", (None, {"jacket", "hoodie", "polo", "base-layer"},
                                              r"thermal|thermo|insulated|padded|sensorwarm|fleece|quilted|warm",
                                              r"waterproof|rain|short|legging|sleeveless|gaiter|snood", 25)),
        ("Winter trousers", (None, {"trousers"}, r"winter|thermal|lined|sensorwarm|warm", r"short|waterproof|rain", 30)),
        ("Winter gloves and mitts", (None, {"glove"}, r"winter|mitt|cold|thermal|rain|wet", r"junior|kids", 9)),
        ("Hats and snoods", (None, {"cap"}, r"beanie|bobble|snood|neck warmer|gaiter|winter|trapper|knit|pom", r"junior|kids|visor", 8)),
    ],
}
SOFT_BALLS = re.compile(r"supersoft|soft feel|trufeel|duo soft|tour soft|q-?star", re.I)
LITTLE = re.compile(r"hand ?warmer|winter tee|fairway mat|winter mat|rain ?cover|rain ?hood|trolley mitt|cart mitt|towel", re.I)


def _rank(p):
    r = brand_rank(p.get("brand") or p["name"])
    return r if r != 99 else WINTER_BRANDS.get((p.get("brand") or "").strip().lower(), 99)


def _at_low(p):
    ins = p.get("priceInsight") or {}
    low, high = ins.get("historicalLow"), ins.get("historicalHigh") or 0
    price = p["salePrice"]
    return low is not None and price <= low + 0.005 and high - price >= max(5.0, high * 0.03)


def _ok(p):
    return (p.get("inStock", True) and p.get("image") and p.get("affiliateUrl") and (p.get("brand") or "").strip()
            and p.get("source") != "awin-callawaypreowned" and not p.get("condition") and p.get("audience") != "Junior"
            and not re.search(r"\b(youth|junior|kids?|boys|girls)\b", p["name"], re.I)
            and (p.get("salePrice") or 0) >= MIN_PRICE)


def shelf(products, test, known_only=True):
    cats, icons, need, skip, floor = test
    need, skip = re.compile(need, re.I), re.compile(skip, re.I) if skip else None
    cands = [p for p in products if _ok(p) and p["salePrice"] >= floor
             and (cats is None or p.get("category") in cats) and (icons is None or p.get("icon") in icons)
             and need.search(p["name"]) and not (skip and skip.search(p["name"]))]
    if known_only:
        cands = [p for p in cands if _rank(p) != 99]
    # Men's and unisex first (most of our visitors), then women's.
    cands.sort(key=lambda p: (0 if _at_low(p) else 1, _rank(p),
                              1 if p.get("audience") == "Female" else 0, p["salePrice"]))
    out, names, brands, female = [], [], defaultdict(int), 0
    for p in cands:
        name = display_name(p)
        b = p["brand"].strip().lower()
        if brands[b] >= 2 or any(_same_thing(name, n) for n in names):
            continue
        if p.get("audience") == "Female":
            if female >= 2:
                continue
            female += 1
        names.append(name)
        brands[b] += 1
        out.append(dict(p, _display=name, _low=_at_low(p)))
        if len(out) == PER_SHELF:
            break
    return out


def card(p):
    ins = p.get("priceInsight") or {}
    badge = (f'<span class="sg-badge">Lowest in {ins.get("daysTracked")} days</span>'
             if p["_low"] and ins.get("daysTracked") else "")
    return f"""<a class="pp-card sg-card" href="{esc(p['affiliateUrl'])}" target="_blank" rel="sponsored nofollow noopener">
  <span class="sg-img"><img src="{esc(p['image'])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('sg-noimg');this.remove()"></span>
  <span class="sg-name">{esc(p['_display'])}</span>
  <span class="sg-price">{money(p['salePrice'])}</span>
  <span class="pp-sub">at {esc(retailer_name(p['source']))}</span>{badge}
</a>"""


def _section(title, items, note=""):
    return (f'<section class="pp-block"><h3 class="wg-shelf">{esc(title)}</h3>{note}'
            f'<div class="sg-grid">{"".join(card(p) for p in items)}</div></section>')


def build(passing, built, products, today):
    """Returns (changed urls, sitemap entries)."""
    shelves, counts, n_low = {}, {}, 0
    for group, lst in SHELVES.items():
        shelves[group] = []
        for title, test in lst:
            items = shelf(products, test)
            if len(items) == PER_SHELF:
                shelves[group].append((title, items))
                n_low += sum(1 for p in items if p["_low"])
    # The little things: hand warmers, winter tees, rain covers, mitts for the
    # trolley... topped up with at most two towels.
    shown = {p["id"] for g in shelves.values() for _, items in g for p in items}
    rest = [p for p in products if p["id"] not in shown]
    small = shelf(rest, (None, None, LITTLE.pattern, r"junior|kids|holder|towel", 1), known_only=False)[:4]
    towels = shelf(rest, (None, {"towel"}, r"towel", r"junior|kids", 5))
    little_items = small + [t for t in towels if not any(_same_thing(t["_display"], x["_display"]) for x in small)][:PER_SHELF - len(small)]
    balls = [m for m in passing if m["type"] == "ball" and m["slug"] in built and SOFT_BALLS.search(m["name"])]
    balls.sort(key=lambda m: (0 if (m.get("verdict") or {}).get("label") == "good" else 1, -len(m["retailers"]), m["minPrice"]))
    ball_out = []
    for m in balls:
        if not any(_same_thing(m["name"], o["name"]) for o in ball_out):
            ball_out.append(m)
    images = {p["id"]: p.get("image") for p in products if p.get("image")}
    for m in ball_out:
        m["_image"] = next((images[i] for i in m.get("listingIds", []) if images.get(i)), None)
    ball_out = ball_out[:6] if len(ball_out) >= 6 else ball_out[:3] if len(ball_out) >= 3 else []

    total = sum(len(i) for g in shelves.values() for _, i in g)
    if total < 24:
        print(f"Winter golf page: only {total} items, not built.")
        return [], []

    # Winter kit: cheapest item on each of four shelves.
    kit_from = {"Waterproof jackets": "Waterproof jacket", "Waterproof trousers": "Waterproof trousers",
                "Winter gloves and mitts": "Gloves or mitts", "Hats and snoods": "Hat or snood"}
    kit = []
    for group in shelves.values():
        for title, items in group:
            if title in kit_from:
                p = min(items, key=lambda x: x["salePrice"])
                kit.append((kit_from[title], p))
    kit_total = sum(p["salePrice"] for _, p in kit)
    kit_rows = "".join(f'<li><span>{esc(label)}</span><a href="{esc(p["affiliateUrl"])}" target="_blank" rel="sponsored nofollow noopener">'
                       f'{esc(p["_display"])}</a><b>{money(p["salePrice"])}</b></li>' for label, p in kit)
    kit_box = (f"""<section class="pp-block wg-kit">
  <div><span class="sb-kicker">Winter kit, today’s cheapest</span>
  <h2>Kitted out for {money(kit_total)}</h2>
  <p class="pp-small">The cheapest jacket, trousers, gloves and hat from well-known brands on this page today. Each one links to the retailer.</p></div>
  <ul>{kit_rows}</ul>
</section>""" if len(kit) == 4 else "")

    dry = "".join(_section(t, i) for t, i in shelves["dry"])
    warm = "".join(_section(t, i) for t, i in shelves["warm"])
    extra = ""
    if ball_out:
        extra += (f'<section class="pp-block"><h3 class="wg-shelf">Softer golf balls for cold days</h3>'
                  f'<p class="pp-small">Lower-compression balls feel less like a stone off the face in the cold. These link to our price pages, where you can compare every retailer.</p>'
                  f'<div class="sg-grid">{"".join(model_card(m) for m in ball_out)}</div></section>')
    if len(little_items) == PER_SHELF:
        extra += _section("The little things", little_items)

    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Winter golf", None)])
    jump = "".join(f'<a class="pp-chip" href="#{a}">{t}</a>' for a, t in
                   [("stay-dry", "Stay dry"), ("stay-warm", "Stay warm"), ("winter-course", "The winter course"), ("layering", "How to layer")])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top wg-top">
  <div class="wg-top-copy">
    <span class="sb-kicker">Winter golf · updated {long_date(today)}</span>
    <h1>Winter golf gear: stay dry, stay warm, keep playing</h1>
    <p class="pp-answer">Waterproofs, warm layers and the small things that make a frosty 8am tee time bearable, at live prices from multiple UK retailers, checked every 6 hours. Where something is at the lowest price we’ve tracked, we say so. No made-up “was” prices.</p>
    <div class="pp-chips">{jump}</div>
    <p class="pp-disclose">We may earn a commission if you buy through these links. It never changes the price or what we pick.</p>
  </div>
  <img class="wg-top-img" src="/assets/photos/winter-jacket.jpg" alt="A golfer zipping up a navy waterproof jacket in the rain" width="580" height="725">
</section>
{kit_box}
<section class="wg-group" id="stay-dry">
  <div class="wg-group-head"><h2>Stay dry</h2><p>A good waterproof is the one thing worth paying more for. Look for a proper waterproof rating, taped seams and a guarantee, and make sure it’s quiet when you swing.</p></div>
  {dry}
</section>
<section class="wg-group" id="stay-warm">
  <div class="wg-group-head"><h2>Stay warm</h2><p>Several thin layers beat one thick one: you can take one off by the 4th and still swing freely. Cold hands cost more shots than cold anything else.</p></div>
  {warm}
</section>
<section class="wg-group" id="winter-course">
  <div class="wg-group-head"><h2>The winter course</h2><p>Mats on the fairways, temporary greens and wet towels. A few cheap things help a lot.</p></div>
  {extra}
</section>
<section class="pp-block" id="layering">
  <h2>How to dress for winter golf</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>Three layers, not one big coat</h3><p>A thin base layer to keep sweat off your skin, a warm mid-layer, and a waterproof or windproof shell on top. Big coats restrict your turn; layers don’t, and you can shed one as you warm up.</p></div>
    <div class="pp-card pp-q"><h3>Waterproof or water-resistant?</h3><p>“Water-resistant” copes with a shower. For proper rain you want fully waterproof, with taped seams. Waterproof ratings are given in millimetres: around 10,000mm and up is solid for golf. Some brands also guarantee their waterproofs for a year or more; the retailer page will say.</p></div>
    <div class="pp-card pp-q"><h3>What to buy first</h3><p>Hands and feet first: winter gloves or mitts between shots, and waterproof shoes. Then waterproof trousers, which get wetter than jackets on long grass. A hat costs little and makes a big difference.</p></div>
  </div>
</section>
{signup_box("Waiting for a better price?", "Our Friday email lists the week’s genuine price drops, including waterproofs and winter layers, checked against our own price history.")}
{method_note(today)}
</div>"""
    title = f"Winter Golf Gear UK {today.year}: Waterproofs, Thermals & Gloves at Live Prices | GolfPrice AI"
    desc = ("Winter golf gear at live UK prices: waterproof jackets and trousers, thermal layers, winter gloves, mitts and hats, "
            "checked every 6 hours. We flag anything at the lowest price we’ve tracked.")
    page = page_shell(title=title, description=desc, canonical=f"{SITE}/prices/{SLUG}/", body=body, section="",
                      schema=[crumbs_schema], noindex=False)
    changed = [f"/prices/{SLUG}/"] if _write(PRICES_DIR / SLUG / "index.html", page) else []
    print(f"Winter golf page: {total} items on {sum(len(g) for g in shelves.values())} shelves, {n_low} at their lowest tracked price, "
          f"kit {money(kit_total) if kit else 'n/a'}.")
    return changed, [(f"prices/{SLUG}/", today.isoformat())]
