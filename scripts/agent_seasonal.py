"""Seasonal planner: occasion pages built early enough to rank.

The problem it solves: occasion pages only bring traffic if they exist weeks
before the day, but they used to be built by hand close to the date. Black
Friday, Christmas, Boxing Day and gift guides are already automatic
(scripts/seasonal_pages.py); this agent covers the rest of the golf year.

Weekly (inside the Fix pack, Mondays):
  * Each occasion opens 8 weeks before its date. From then until the day, the
    agent rebuilds its page each Monday from live prices: picks at the lowest
    price we've tracked (or good value) in the categories that fit, in budget
    bands, each linking to its price page.
  * Out of season the page stays up (it keeps its search history) with
    "back next year" wording and is refreshed monthly.
  * Pages are listed in the sitemap (data/agent-pages.json) and reach the
    site only when the owner approves the Fix pack.

Occasions: New golf season (spring), Father's Day golf gifts, Summer golf kit,
Winter golf essentials. Every price is a live retailer price, checked against
our own history; never a "was" price; retailers aren't named in the copy.
"""
import json
import os
import re
import sys
from datetime import date, timedelta
from html import escape as e

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, SITE, models, products, save_report, now, pack_note, register_pages)

OUTDIR = ROOT / "prices" / "occasions"
LEAD = 56


def third_sunday_june(y):
    d = date(y, 6, 1)
    first_sun = d + timedelta(days=(6 - d.weekday()) % 7)
    return first_sun + timedelta(days=14)


OCCASIONS = [
    {"slug": "new-golf-season", "name": "New golf season", "day": lambda y: date(y, 3, 21),
     "title": "New golf season: what to buy, and what's cheaper right now",
     "intro": "The new season starts when the clocks go forward. Here's the kit golfers stock up on for spring, at the lowest prices we've tracked across multiple UK retailers.",
     "model_types": ["ball", "driver", "putter", "wedge", "rangefinder", "gps-watch", "electric-trolley", "bag"], "apparel": ["shoe", "glove"]},
    {"slug": "fathers-day-golf-gifts", "name": "Father's Day golf gifts", "day": third_sunday_june,
     "title": "Father's Day golf gifts: ideas by budget, at today's lowest prices",
     "intro": "Golf gifts for Father's Day, sorted by budget. Every price is today's lowest across multiple UK retailers, checked against our own price history.",
     "model_types": ["ball", "putter", "rangefinder", "gps-watch", "wedge", "bag"], "apparel": ["glove", "polo", "cap", "towel"]},
    {"slug": "summer-golf-kit", "name": "Summer golf kit", "day": lambda y: date(y, 6, 1),
     "title": "Summer golf kit: polos, shorts, shoes and more, cheaper now",
     "intro": "Light layers, breathable shoes and everything for long summer evenings on the course, at the lowest prices we've tracked.",
     "model_types": ["ball", "bag", "rangefinder"], "apparel": ["polo", "short", "shoe", "cap", "visor", "sunglasses"], "apparel_first": True},
    {"slug": "winter-golf-essentials", "name": "Winter golf essentials", "day": lambda y: date(y, 11, 1),
     "title": "Winter golf essentials: waterproofs, mitts and warm layers",
     "intro": "Keep playing through the winter: waterproofs, warm layers, mitts and winter gloves, at the lowest prices we've tracked across multiple UK retailers.",
     "model_types": ["electric-trolley", "ball"], "apparel": ["waterproof", "jacket", "mitt", "winter glove", "gilet", "mid layer", "beanie", "trouser"], "apparel_first": True},
]
BANDS = [(0, 25, "Under £25"), (25, 50, "£25 to £50"), (50, 100, "£50 to £100"), (100, 250, "£100 to £250"), (250, 1e9, "Over £250")]


def next_date(o, today):
    d = o["day"](today.year)
    return d if d >= today - timedelta(days=1) else o["day"](today.year + 1)


def money(n):
    return f"£{n:,.0f}" if n >= 100 or float(n).is_integer() else f"£{n:,.2f}"


def picks_for(o):
    out = []
    for m in models():
        if m.get("type") not in o["model_types"] or re.search(r"single-iron|junior|kids|shaft", m["slug"]):
            continue
        if (m.get("verdict") or {}).get("label") not in ("good", "typical") or not (m.get("gate") or {}).get("passes"):
            continue
        out.append({"name": m["name"], "price": float(m["minPrice"]), "url": f"/prices/{m['slug']}/",
                    "low": (m.get("verdict") or {}).get("label") == "good", "retailers": len(m.get("retailers") or {})})
    words = o.get("apparel") or []
    for p in products():
        if p.get("category") not in ("apparel", "shoes", "accessories") or not p.get("inStock") or p.get("condition"):
            continue
        n = p.get("name", "").lower()
        if not any(w in n for w in words) or (p.get("audience") or "").lower().startswith(("junior", "kid")):
            continue
        pi = p.get("priceInsight") or {}
        if pi.get("status") != "lowest_tracked":
            continue
        out.append({"name": p["name"], "price": float(p["salePrice"]), "url": p["affiliateUrl"], "low": True, "retailers": 1, "buy": True})
    out.sort(key=lambda x: (not x["low"], -x["retailers"], x["price"]))
    seen, uniq = set(), []
    for x in out:
        k = re.sub(r"\s+-\s+.*$", "", x["name"].lower())
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq


def page(o, items, today, when):
    from price_pages import page_shell, breadcrumb
    days = (when - today).days
    status = (f"{o['name']} is on {when.strftime('%A %d %B')}, {days} days away." if 0 < days <= LEAD
              else f"It's {o['name'].lower()} time." if -1 <= days <= 0
              else f"Back for {when.year}: this page is refreshed weekly from {(when - timedelta(days=LEAD)).strftime('%d %B')}.")
    sections = ""
    for lo, hi, label in BANDS:
        inband = [x for x in items if lo <= x["price"] < hi]
        kit = [x for x in inband if x.get("buy")][:5]       # clothing and small kit first where the occasion is about it
        gear = [x for x in inband if not x.get("buy")][:8 - len(kit)]
        band = (kit + gear) if o.get("apparel_first") else (gear[:5] + kit)[:8]
        if not band:
            continue
        lis = "".join(
            f"<li><a href=\"{e(x['url'])}\"{' rel=\"sponsored nofollow noopener\" target=\"_blank\"' if x.get('buy') else ''}>{e(x['name'])}</a> "
            f"<strong>{money(x['price'])}</strong>{' <span class=\"pp-badge\">Lowest we&#39;ve tracked</span>' if x['low'] else ''}</li>" for x in band)
        sections += f"<h2>{label}</h2><ul class=\"oc-list\">{lis}</ul>"
    crumbs, schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (o["name"], None)])
    body = (f"<div class=\"pp-wrap\">{crumbs}<h1>{e(o['title'])}</h1><p class=\"pp-lede\">{e(o['intro'])}</p>"
            f"<p><strong>{e(status)}</strong> Updated {today.strftime('%d %B %Y')}.</p>{sections}"
            "<p class=\"pp-disclose\">We may earn a commission if you buy through these links. It never changes the prices.</p></div>")
    return page_shell(title=f"{o['title']} | GolfPrice AI", description=o["intro"][:155], canonical=f"{SITE}/prices/occasions/{o['slug']}/",
                      body=body, section="prices", schema=[schema], noindex=False)


def main():
    today = now().date()
    built, notes = [], []
    for o in OCCASIONS:
        when = next_date(o, today)
        f = OUTDIR / o["slug"] / "index.html"
        in_window = 0 <= (when - today).days <= LEAD
        monthly = today.day <= 7
        if not (in_window or not f.exists() or monthly):
            continue
        items = picks_for(o)
        if len(items) < 6:
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(page(o, items, today, when), encoding="utf-8")
        built.append(f"prices/occasions/{o['slug']}/")
        notes.append(f"{o['name']} ({len(items)} picks{', in season' if in_window else ''})")
    if built:
        register_pages(built)
        pack_note("prices/occasions", "Seasonal pages: build or refresh " + "; ".join(notes) + ". Each is in the sitemap so it can rank before the day.")
    save_report("seasonal-report.json", {"about": "Seasonal planner: occasion pages built 8 weeks ahead and refreshed weekly in season.",
                                         "built": built, "upcoming": [{"occasion": o["name"], "date": str(next_date(o, today))} for o in OCCASIONS]})
    print("built:", built)


if __name__ == "__main__":
    main()
