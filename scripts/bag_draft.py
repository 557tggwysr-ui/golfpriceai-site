"""The Bag Draft: monthly fantasy golf kit (golfpriceai.com/play/draft/).

Each month is a Major. Players draft six real products at today's prices
within a £1,500 budget, one per slot. Every £1 a pick's lowest UK price falls
is a point (rises cost points), and a pick at the lowest price we've tracked
earns a bonus. Scores live in the alerts worker (Cloudflare D1, /draft/...),
which reads this catalogue for today's prices, so nobody can draft at a
price we didn't publish.

Built every 6 hours by price_pages.build:
  data/draft/catalogue.json   every draftable model: slot, price, photo, Caddie's note
  play/draft/index.html       the game page (js/draft.js does the rest)
No personal data here: prices and product facts only.
"""
import json
import re

from price_pages import SITE, TYPES, NOT_IN_PICKS, _write, breadcrumb, esc, page_shell

BUDGET = 1500
# Slot key, label, product types it takes.
SLOTS = [
    ("driver", "Driver", {"driver"}),
    ("irons", "Irons or wedge", {"irons", "wedge"}),
    ("putter", "Putter", {"putter"}),
    ("ball", "Balls", {"ball"}),
    ("tech", "Tech", {"rangefinder", "gps-watch", "launch-monitor"}),
    ("wild", "Wildcard", {"wood", "hybrid", "bag", "electric-trolley", "set"}),
]
SLOT_OF = {t: k for k, _, ts in SLOTS for t in ts}
# The Majors. Month -> (name, colour, accent, short joke). Names avoid
# official tournament trademarks on purpose.
MAJORS = {
    1: ("The New Year’s Resolution Invitational", "#16224a", "#d9b45a", "New year, new swing, same slice."),
    2: ("The Sweetheart Scramble", "#c4153b", "#f1a7bf", "For golfers whose true love has a graphite shaft."),
    3: ("The Shamrock Shootout", "#1f6a3a", "#ffffff", "Luck of the Irish, prices of the English."),
    4: ("The Easter Egg Hunt", "#7a5aa6", "#f3e27a", "Hunt for bargains, not balls."),
    5: ("The Bank Holiday Bash", "#2b6cb0", "#ffffff", "Three-day weekend, six-pick bag."),
    6: ("The Father’s Day Fourball", "#3a4a2a", "#d9b45a", "The big gift month. Dad’s watching."),
    7: ("The Heatwave Classic", "#d98e04", "#16241c", "Factor 50 and a fresh driver."),
    8: ("The Silly Season Scramble", "#0e7490", "#ffffff", "Seaside stripes, serious savings."),
    9: ("The Autumn Shootout", "#9a4a00", "#f3c47e", "Leaves falling. Prices too, hopefully."),
    10: ("The Halloween Hacker Open", "#4c1d95", "#f08a24", "For all us hackers."),
    11: ("The Black Friday Open", "#1b1d1c", "#f08a24", "The scariest thing in it is full price."),
    12: ("The Christmas Cracker Classic", "#b3262d", "#ffffff", "Draft the bag you’re hoping Santa reads about."),
}
BAG_ART = {11: "bag-nov", 12: "bag-dec", 1: "bag-jan", 2: "bag-feb"}
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)


def caddie(m):
    """One line from our own data: the Caddie's notes."""
    cuts = sum(1 for e in m.get("events") or [] if e.get("kind") == "price_cut")
    label = (m.get("verdict") or {}).get("label")
    days = m.get("historyDays") or 0
    if label == "good":
        return "At the lowest price we’ve tracked. Can it go lower?"
    if cuts >= 3:
        return f"Dropped {cuts} times since we started tracking. A mover."
    if cuts == 0 and days >= 30:
        return "Hasn’t budged in months. A brave pick."
    if label == "high":
        return "Usually cheaper than this. Room to fall?"
    if cuts:
        return f"Dropped {cuts} time{'s' if cuts > 1 else ''} since we started tracking."
    return "New to our tracking. A mystery box."


def item(m):
    return {"slug": m["slug"], "name": m["name"], "brand": m.get("brand") or "", "type": TYPES[m["type"]][2],
            "slot": SLOT_OF[m["type"]], "price": round(float(m["minPrice"]), 2),
            "unit": "per dozen" if m["type"] == "ball" else "", "image": m.get("_image") or "",
            "low": 1 if (m.get("verdict") or {}).get("label") == "good" else 0, "note": caddie(m)}


def page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", "/play/"), ("The Bag Draft", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="bd-wrap" id="bd" aria-live="polite"><p class="pr-loading">Opening the locker room…</p></section>
<noscript><p>The Bag Draft needs JavaScript. Our <a href="/prices/">price guides</a> work without it.</p></noscript>
<section class="pp-block bd-how">
  <h2>How the Bag Draft works</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>What do I do?</h3><p>Each month is a Major. Draft six real products, one per slot, at today’s lowest UK prices, within £{BUDGET:,}. Then let the real prices do the rest.</p></div>
    <div class="pp-card pp-q"><h3>How does scoring work?</h3><p>Every £1 a pick’s price falls is a point; rises cost points. A pick at the lowest price we’ve tracked earns 10 bonus points. One transfer a week, and one lock per Major to bank a pick’s points for good.</p></div>
    <div class="pp-card pp-q"><h3>Who can see my bag?</h3><p>Nobody, until the draft closes on the 7th. Then bags are revealed to your leagues, and the national leaderboard shows nicknames and points only.</p></div>
    <div class="pp-card pp-q"><h3>Is there a prize?</h3><p>Glory only: no money, no stakes, free to play. The winner’s name is engraved on that month’s bag in their Locker Room, and the national champion goes in the Hall of Fame.</p></div>
  </div>
</section>
</div>
<script src="/js/draft.js?v=20261021" defer></script>"""
    return page_shell(title="The Bag Draft: fantasy golf kit | GolfPrice AI",
                      description=f"Free monthly fantasy golf kit: draft six real products within £{BUDGET:,}, then real UK prices decide the winner. Play with your mates or the whole country.",
                      canonical=f"{SITE}/play/draft/", body=body, section="play", schema=[crumbs_schema], noindex=False,
                      og_image="/assets/cards/bag-draft.jpg",
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261024">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def build(passing, built, today):
    items = [item(m) for m in passing
             if m["slug"] in built and m["type"] in SLOT_OF and m["type"] not in NOT_IN_PICKS
             and m.get("_image") and float(m.get("minPrice") or 0) >= 5 and not WOMEN_RX.search(m["name"])]
    items.sort(key=lambda x: (x["slot"], x["price"]))
    major = MAJORS[today.month]
    cat = {"about": "The Bag Draft catalogue: today's lowest new UK price of every draftable model. Prices only.",
           "date": today.isoformat(), "budget": BUDGET,
           "season": today.strftime("%Y-%m"),
           "major": {"name": major[0], "colour": major[1], "accent": major[2], "joke": major[3],
                     "art": f"/assets/play/{BAG_ART.get(today.month, 'bag-nov')}.svg"},
           "majors": {f"{m:02d}": {"name": v[0], "colour": v[1], "accent": v[2],
                                   "art": f"/assets/play/{BAG_ART.get(m, 'bag-nov')}.svg"} for m, v in MAJORS.items()},
           "slots": [{"key": k, "label": label} for k, label, _ in SLOTS],
           "items": items}
    root = PRICES_ROOT()
    _write(root / "data" / "draft" / "catalogue.json", json.dumps(cat, ensure_ascii=False, separators=(",", ":")))
    changed = []
    if _write(root / "play" / "draft" / "index.html", page()):
        changed.append("/play/draft/")
    counts = {k: sum(1 for i in items if i["slot"] == k) for k, _, _ in SLOTS}
    print(f"Bag Draft: {len(items)} draftable models " + ", ".join(f"{k} {n}" for k, n in counts.items()) + f"; {major[0]}.")
    return changed


def PRICES_ROOT():
    from price_pages import PRICES_DIR
    return PRICES_DIR.parent
