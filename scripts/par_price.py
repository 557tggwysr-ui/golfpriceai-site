"""Par Price: the daily golf price game (golfpriceai.com/play/).

Every day, five real products. Players guess each one's lowest new UK price
today and score it like golf: within 2% is an eagle, 5% a birdie, 10% par,
20% a bogey, anything further a double bogey.

Built by price_pages.build every 6 hours. The first run of each day picks
that day's five and freezes their prices, so everyone plays the same round
all day; later runs that day leave it alone.

Picking is fair and repeatable: seeded by the date, five different product
types, five different brands, men's models first, never junior sets, only
models with a photo, at least two retailers and two weeks of history, and
nothing used in the last 30 days.

Writes
  data/par-price/today.json   the round (no personal data; guesses stay in
                              each player's own browser)
  data/par-price-state.json   which models were used on which day
  play/index.html             the game page
"""
import json
import random
import re
from datetime import date, timedelta

from price_pages import PRICES_DIR, SITE, TYPES, NOT_IN_PICKS, _write, breadcrumb, esc, page_shell

ROOT = PRICES_DIR.parent
TODAY_FILE = ROOT / "data" / "par-price" / "today.json"
STATE = ROOT / "data" / "par-price-state.json"
LAUNCH = date(2026, 10, 18)  # puzzle #1
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
HOLES = 5
CARD = "/assets/cards/par-price.jpg"


def number(day):
    return (day - LAUNCH).days + 1


def pick(passing, built, day, recent):
    rng = random.Random(f"par-price-{day.isoformat()}")
    pool = [m for m in passing
            if m["slug"] in built and m["type"] in TYPES and m["type"] not in NOT_IN_PICKS
            and m.get("_image") and not WOMEN_RX.search(m["name"]) and m["slug"] not in recent
            and len(m.get("retailers") or []) >= 2 and (m.get("historyDays") or 0) >= 14 and m["minPrice"] >= 10]
    rng.shuffle(pool)
    # Popular models more often: sort the shuffled pool by listings in bands of 10.
    pool.sort(key=lambda m: -(min(m.get("listingCount") or 0, 30) // 10))
    out, types, brands = [], set(), set()
    for m in pool:
        if m["type"] in types or m["brand"] in brands:
            continue
        out.append(m)
        types.add(m["type"])
        brands.add(m["brand"])
        if len(out) == HOLES:
            break
    rng.shuffle(out)
    return out


def item(m):
    return {"slug": m["slug"], "name": m["name"], "image": m.get("_image"), "price": round(float(m["minPrice"]), 2),
            "unit": "per dozen" if m["type"] == "ball" else "each", "type": TYPES[m["type"]][2],
            "low": (m.get("verdict") or {}).get("label") == "good",
            "url": f"/prices/{m['slug']}/"}


def page(n, today):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Deal Tools", "/deal-tools.html"), ("Par Price", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pr-game" id="pr-game" data-n="{n}" aria-live="polite">
  <div class="pr-top">
    <div>
      <span class="pr-kicker">Daily · Par Price #{n}</span>
      <h1>Par Price: the daily golf price game</h1>
    </div>
    <span class="pr-total" hidden></span>
  </div>
  <p class="pr-lede">Five real products. Guess each one’s lowest new UK price today and score it like a round of golf. Within 2% is an eagle, 5% a birdie, 10% par.</p>
  <ol class="pr-holes" aria-label="Holes"></ol>
  <div class="pr-stage"><p class="pr-loading">Teeing up today’s round…</p></div>
  <noscript><p>Par Price needs JavaScript to play. Today’s prices are all on our <a href="/prices/">price guides</a>.</p></noscript>
</section>
<section class="pp-block pr-how">
  <h2>How it works</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>Where do the prices come from?</h3><p>Our own tracking: the lowest new, in-stock price across multiple UK retailers, frozen when the round is set each morning so everyone plays the same course.</p></div>
    <div class="pp-card pp-q"><h3>How is it scored?</h3><p>Within 2% of the real price is an eagle (−2), 5% a birdie (−1), 10% par, 20% a bogey (+1), anything further a double bogey (+2). Five holes, par is level.</p></div>
    <div class="pp-card pp-q"><h3>Is anything about me stored?</h3><p>No. Your score and streak stay in your own browser. When you finish, we count only how close each guess was, with no score and nothing about you, for our <a href="/demand/">Demand Index</a>.</p></div>
    <div class="pp-card pp-q"><h3>When is the next round?</h3><p>A new round every morning, with five different products from five different brands.</p></div>
  </div>
</section>
</div>
<script src="/js/par-price.js?v=20261020" defer></script>"""
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "Par Price", "url": f"{SITE}/play/",
           "applicationCategory": "GameApplication", "operatingSystem": "Any",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
           "description": "A free daily game: guess the lowest UK price of five real golf products and score it like a round of golf."}
    return page_shell(title=f"Par Price #{n}: the daily golf price game | GolfPrice AI",
                      description="Guess today’s lowest UK price of five real golf products and score it like a round: eagle, birdie, par. A new round every day. Free.",
                      canonical=f"{SITE}/play/", body=body, section="tools", schema=[app, crumbs_schema], noindex=False,
                      og_image=CARD,
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261019">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def build(passing, built, today):
    """Set today's round if it isn't set yet, and write the page."""
    try:
        state = json.loads(STATE.read_text())
    except (OSError, ValueError):
        state = {"about": "Which models each Par Price round used (no personal data).", "days": {}}
    n = number(today)
    current = None
    try:
        current = json.loads(TODAY_FILE.read_text())
    except (OSError, ValueError):
        pass
    if not current or current.get("date") != today.isoformat():
        cutoff = (today - timedelta(days=30)).isoformat()
        recent = {s for d, slugs in state["days"].items() if d >= cutoff for s in slugs}
        chosen = pick(passing, built, today, recent)
        if len(chosen) < HOLES:  # not enough fresh models: allow repeats rather than skip a day
            chosen = pick(passing, built, today, set())
        if len(chosen) == HOLES:
            current = {"n": n, "date": today.isoformat(), "items": [item(m) for m in chosen]}
            _write(TODAY_FILE, json.dumps(current, ensure_ascii=False, indent=1) + "\n")
            state["days"][today.isoformat()] = [m["slug"] for m in chosen]
            state["days"] = {d: v for d, v in state["days"].items() if d >= cutoff}
            STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
            print(f"Par Price #{n}: " + ", ".join(m["name"] for m in chosen))
    changed = []
    if current and _write(ROOT / "play" / "index.html", page(current.get("n", n), today)):
        changed.append("/play/")
    return changed
