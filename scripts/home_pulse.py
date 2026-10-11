"""Homepage "Where prices are heading" (data/home-pulse.json).

Eight category tiles, each saying how many of the models we track got
cheaper or dearer over the last two weeks. Replaces the old "Trending Right
Now" pills, which ranked items by the retailer's own claimed discount.

A model counts as cheaper or dearer when its lowest new, in-stock price
today differs from its usual price two to four weeks ago (the median of
those 15 days) by at least £5 and 3%. Using the usual price rather than a
single day means a three-day sale that happened to fall exactly 14 days ago
doesn't make everything look dearer now. Moves over 60% are left out (more
likely a feed problem than a real price).

Only models with a price page are counted, same as everything else.
"""
import json
import statistics
from datetime import timedelta

from price_pages import ROOT, TYPES
from seasonal_pages import daily_prices

OUT = ROOT / "data" / "home-pulse.json"
MIN_POUNDS, MIN_PCT, MAX_PCT = 5.0, 0.03, 0.60
# Tile order and photo for each. object-position keeps the club head in view.
TILES = [
    ("driver", "/assets/photos/driver-head.jpg", "60% 50%"),
    ("irons", "/assets/photos/irons-head.jpg", "55% 50%"),
    ("putter", "/assets/photos/putter-mallet.jpg", "50% 40%"),
    ("wedge", "/assets/photos/wedge-real.jpg", "60% 50%"),
    ("rangefinder", "/assets/photos/rangefinder-real.jpg", "40% 40%"),
    ("gps-watch", "/assets/photos/gps-watch-real.jpg", "50% 50%"),
    ("bag", "/assets/photos/golfbag-with-clubs.jpg", "50% 35%"),
    ("electric-trolley", "/assets/photos/pushcart-loaded.jpg", "55% 50%"),
]


def movement(m, today):
    """-1 cheaper, 1 dearer, 0 held, None if not enough history."""
    days = daily_prices(m.get("history"), today)
    usual = [days[d] for d in (today - timedelta(days=n) for n in range(14, 29)) if d in days]
    if len(usual) < 7:
        return None
    base, now = statistics.median(usual), float(m["minPrice"])
    change = now - base
    if abs(change) < max(MIN_POUNDS, base * MIN_PCT) or abs(change) > base * MAX_PCT:
        return 0
    return -1 if change < 0 else 1


def build(passing, built, today):
    tiles = []
    for t, photo, pos in TILES:
        models = [m for m in passing if m["type"] == t and m["slug"] in built]
        if not models:
            continue
        moves = [movement(m, today) for m in models]
        tiles.append({
            "type": t, "label": TYPES[t][1], "hub": f"/prices/{TYPES[t][0]}/", "photo": photo, "pos": pos,
            "models": len(models), "from": min(float(m["minPrice"]) for m in models),
            "unit": " per dozen" if t == "ball" else "",
            "cheaper": moves.count(-1), "dearer": moves.count(1), "compared": sum(1 for x in moves if x is not None),
        })
    OUT.write_text(json.dumps({"date": today.isoformat(), "tiles": tiles}, separators=(",", ":")))
    print("Price pulse: " + ", ".join(f"{x['label']} {x['cheaper']}↓ {x['dearer']}↑" for x in tiles))
    return tiles
