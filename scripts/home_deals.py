"""Homepage "Today's genuine price drops" (data/home-deals.json).

Replaces the old "Today's Best Golf Deals" picks, which were ranked by the
retailer's own "was" price (so a £4,995 RRP on £809 irons showed as 84% off).
Every deal here is a drop confirmed by our own price history, on a model
with a price page:

  * the model's lowest new, in-stock price fell by at least £5 and 3% in the
    last 30 days, the fall is under 60%, and it's still at that price;
  * hero gear only (price-page categories), above a minimum price for its
    category, no junior items, from brands golfers know;
  * at most 2 per category and 2 per brand, so it stays varied.

The homepage shows one "Deal of the day" (the biggest drop in the chosen
category, rotated daily among the top few) and six cards, with category
chips. If fewer than 7 drops qualify, models at their lowest tracked price
fill the gap, labelled as such.
"""
import hashlib
import json
import re
from datetime import date, timedelta

from price_pages import ROOT, TYPES
from seasonal_pages import BRAND_RANK, brand_rank

OUT = ROOT / "data" / "home-deals.json"
MIN_POUNDS, MIN_PCT, MAX_PCT, WINDOW_DAYS = 5.0, 0.03, 0.60, 30
GROUP_TARGET = 7  # Deal of the day + 6 cards per category chip
FLOOR = {"driver": 120, "wood": 80, "hybrid": 70, "irons": 250, "wedge": 50, "putter": 80, "ball": 15,
         "bag": 60, "gps-watch": 80, "rangefinder": 80, "electric-trolley": 200, "launch-monitor": 100}
GROUP = {"driver": "clubs", "wood": "clubs", "hybrid": "clubs", "irons": "clubs", "wedge": "clubs", "putter": "clubs",
         "gps-watch": "tech", "rangefinder": "tech", "launch-monitor": "tech",
         "ball": "bags", "bag": "bags", "electric-trolley": "bags"}
JUNIOR = re.compile(r"\b(junior|kids?|youth)\b", re.I)


def _image(m, products_by_id):
    rows = sorted((products_by_id[i] for i in m.get("listingIds", []) if i in products_by_id),
                  key=lambda p: p.get("salePrice") or 0)
    return next((p["image"] for p in rows if p.get("image")), None)


def build(passing, built, products, today):
    by_id = {p["id"]: p for p in products}
    since = today - timedelta(days=WINDOW_DAYS)
    drops, lows = [], []
    for m in passing:
        t = m["type"]
        if m["slug"] not in built or t not in GROUP or m["minPrice"] < FLOOR.get(t, 0) or JUNIOR.search(m["name"]):
            continue
        if brand_rank(m["name"]) == 99 and (m.get("brand") or "").lower() not in BRAND_RANK:
            continue
        img = _image(m, by_id)
        if not img:
            continue
        now = float(m["minPrice"])
        good = (m.get("verdict") or {}).get("label") == "good"
        base = {"slug": m["slug"], "name": m["name"], "brand": m.get("brand") or "", "type": t, "group": GROUP[t],
                "label": TYPES[t][2], "now": now, "retailers": len(m["retailers"]), "lowest": good,
                "days": m.get("historyDays") or 0, "image": img, "unit": " per dozen" if t == "ball" else "",
                "series": [h for h in (m.get("history") or []) if h[0] >= (today - timedelta(days=90)).isoformat()]
                or (m.get("history") or [])[-1:]}
        drop = None
        for e in reversed(m.get("events") or []):
            d = date.fromisoformat(e["date"])
            if d < since:
                break
            fall = e["from"] - e["to"]
            if e["kind"] in ("price_cut", "new_listing") and fall >= max(MIN_POUNDS, e["from"] * MIN_PCT) \
                    and fall <= e["from"] * MAX_PCT and now <= e["to"] + 0.005:
                drop = e
                break
        if drop:
            drops.append(dict(base, was=drop["from"], dropDate=drop["date"], save=round(drop["from"] - now, 2),
                              pct=round((drop["from"] - now) / drop["from"] * 100)))
        elif good:
            lows.append(dict(base, was=None, dropDate=None, save=0, pct=0))

    def score(d):
        return (d["pct"] + (8 if d["lowest"] else 0) + min(d["retailers"], 4) * 2 - brand_rank(d["name"]) * 0.2)

    ranked = sorted(drops, key=score, reverse=True) + sorted(lows, key=score, reverse=True)
    picked, per_type, per_brand = [], {}, {}
    for d in ranked:
        if per_type.get(d["type"], 0) >= 2 or per_brand.get(d["brand"], 0) >= 2:
            continue
        if not d["was"] and len([x for x in picked if x["was"]]) >= 7:
            continue  # fillers only when real drops run short
        per_type[d["type"]] = per_type.get(d["type"], 0) + 1
        per_brand[d["brand"]] = per_brand.get(d["brand"], 0) + 1
        picked.append(d)
        if len(picked) == 24:
            break
    # Each category chip shows a Deal of the day plus a full row (or two) of
    # three cards, so top every category up to GROUP_TARGET: more genuine drops
    # first (allowing 3 per type and brand), then models at their lowest
    # tracked price. These go at the end so the "All" view is unchanged.
    for g in sorted(set(GROUP.values())):
        have = [d for d in picked if d["group"] == g]
        for cap in (2, 3):
            for d in ranked:
                if len(have) >= GROUP_TARGET:
                    break
                if d["group"] != g or d in picked:
                    continue
                if sum(x["type"] == d["type"] for x in have) >= cap or sum(x["brand"] == d["brand"] for x in have) >= cap:
                    continue
                have.append(d)
                picked.append(d)
    # A different "Deal of the day" each day, from the top few.
    seed = int(hashlib.sha1(today.isoformat().encode()).hexdigest(), 16)
    top = [d for d in picked[:5] if d["was"]] or picked[:1]
    featured = top[seed % len(top)]["slug"] if top else None
    OUT.write_text(json.dumps({"date": today.isoformat(), "featured": featured, "deals": picked},
                              separators=(",", ":")))
    print(f"Homepage deals: {len(picked)} picked ({sum(1 for d in picked if d['was'])} genuine drops), "
          f"featured {featured}.")
    return picked
