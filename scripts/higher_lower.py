"""Higher or Lower: the quick daily price game (golfpriceai.com/play/higher-or-lower/).

Two real products; is the second one's lowest new UK price higher or lower?
Keep going until you're wrong. Everyone gets the same daily run of up to 50
pairs (the one that counts for leagues and the daily table), then unlimited
free play from a bigger pool.

Built by price_pages.build every 6 hours. The first run of each day picks
that day's chain and freezes its prices, like Par Price; later runs that day
leave it alone. Fair by design: men's or unisex only, never junior sets, no
balls (pack sizes make them a lottery), only models with a photo and a price
page, and neighbouring products are always at least 5% apart in price.

Writes
  data/higher-or-lower/today.json   the daily chain (51 products)
  data/higher-or-lower/pool.json    free-play products, current prices
  play/higher-or-lower/index.html   the game page
"""
import json
import random
import re

from price_pages import PRICES_DIR, SITE, TYPES, NOT_IN_PICKS, _write, breadcrumb, page_shell

ROOT = PRICES_DIR.parent
DIR = ROOT / "data" / "higher-or-lower"
TODAY_FILE = DIR / "today.json"
POOL_FILE = DIR / "pool.json"
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
JUNIOR_RX = re.compile(r"\b(junior|juniors|kids|youth|boys|girls|ages)\b", re.I)
RUN = 51          # 50 pairs
GAP = 1.05        # neighbours at least 5% apart


def item(m):
    return {"slug": m["slug"], "name": m["name"], "image": m.get("_image"),
            "price": round(float(m["minPrice"]), 2), "type": TYPES[m["type"]][2]}


def eligible(passing, built):
    return [m for m in passing
            if m["slug"] in built and m["type"] in TYPES and m["type"] not in NOT_IN_PICKS and m["type"] != "ball"
            and m.get("_image") and not WOMEN_RX.search(m["name"]) and not JUNIOR_RX.search(m["name"])
            and len(m.get("retailers") or []) >= 1 and float(m["minPrice"]) >= 10]


def far_enough(a, b):
    lo, hi = sorted([a, b])
    return hi >= lo * GAP


def chain(pool, rng, length=RUN):
    """A run where each product is at least 5% away in price from the one
    before it and doesn't repeat; mixes types so it isn't all putters."""
    pool = pool[:]
    rng.shuffle(pool)
    out = [pool.pop()]
    while len(out) < length and pool:
        prev = out[-1]
        pick = None
        for i, m in enumerate(pool):
            if far_enough(float(m["minPrice"]), float(prev["minPrice"])) and m["type"] != prev["type"]:
                pick = pool.pop(i)
                break
        if pick is None:
            for i, m in enumerate(pool):
                if far_enough(float(m["minPrice"]), float(prev["minPrice"])):
                    pick = pool.pop(i)
                    break
        if pick is None:
            break
        out.append(pick)
    return out


def page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", "/play/"), ("Higher or Lower", None)])
    game = {"@context": "https://schema.org", "@type": "VideoGame", "name": "Higher or Lower: golf prices",
            "url": f"{SITE}/play/higher-or-lower/", "genre": "Quiz", "isAccessibleForFree": True,
            "description": "Is this golf club dearer than that one? A free daily game played on real lowest UK prices."}
    body = f"""<div class="hl-wrap">
{crumbs_html}
<section class="hl-game" id="hl" aria-live="polite"><p class="hl-loading">Racking up the balls…</p></section>
<noscript><p>Higher or Lower needs JavaScript switched on. You can still <a href="/play/par-price/">play Par Price</a>.</p></noscript>
<section class="hl-how">
  <h1>Higher or Lower: golf prices</h1>
  <p>Two real golf products. Is the second one’s lowest new UK price today higher or lower than the first? Keep going until you’re wrong.</p>
  <ul>
    <li>Everyone gets the same daily run of up to 50 pairs. That’s the one that counts for your league and the daily table.</li>
    <li>Then play as much as you like in free play.</li>
    <li>Prices are the lowest new UK price we found this morning, across multiple UK retailers. Products are never closer than 5% in price, so no coin flips.</li>
  </ul>
  <p><a href="/play/">The Clubhouse</a> · <a href="/play/par-price/">Par Price</a> · <a href="/play/leagues/">Start a league</a></p>
</section>
<p class="gp-real">Every price in our games is real: the lowest new UK price we found this morning, across multiple UK retailers. <a href="/about.html">How we track prices</a> · <a href="/shop.html">Browse the shop</a> · <a href="/deal-tools.html">Free deal tools</a></p>
</div>
<script src="/js/higher-lower.js?v=20261024" defer></script>"""
    return page_shell(title="Higher or Lower: the golf price game | GolfPrice AI",
                      description="Is this putter dearer than that driver? A free daily higher or lower game on real UK golf prices. Same run for everyone, then unlimited free play.",
                      canonical=f"{SITE}/play/higher-or-lower/", body=body, section="play", schema=[crumbs_schema, game],
                      noindex=False, og_image="/assets/cards/higher-or-lower.jpg",
                      extra_head='<link rel="stylesheet" href="/css/higher-lower.css?v=20261024">\n')


def build(passing, built, today):
    import par_price
    pool = eligible(passing, built)
    changed = []
    if len(pool) < 20:
        print("Higher or Lower: not enough products")
        return changed
    n = par_price.number(today)
    current = None
    if TODAY_FILE.exists():
        try:
            current = json.loads(TODAY_FILE.read_text())
        except ValueError:
            current = None
    if not current or current.get("date") != today.isoformat():
        rng = random.Random(f"higher-or-lower-{today.isoformat()}")
        run = chain(pool, rng)
        current = {"n": n, "date": today.isoformat(), "items": [item(m) for m in run]}
        if _write(TODAY_FILE, json.dumps(current, ensure_ascii=False, separators=(",", ":")) + "\n"):
            changed.append("/data/higher-or-lower/today.json")
    free = sorted(pool, key=lambda m: -(m.get("listingCount") or 0))[:400]
    if _write(POOL_FILE, json.dumps({"date": today.isoformat(), "items": [item(m) for m in free]}, ensure_ascii=False, separators=(",", ":")) + "\n"):
        changed.append("/data/higher-or-lower/pool.json")
    if _write(ROOT / "play" / "higher-or-lower" / "index.html", page()):
        changed.append("/play/higher-or-lower/")
    return changed
