"""Price-history pages: one static HTML page per model under /prices/<slug>/,
plus category hubs, written fresh on every pipeline run.

Everything on these pages comes from GolfPrice AI's own data: the live
catalogue and the price history we record every 6 hours. Nothing is copied
from retailers and nothing is invented (no reviews, no ratings, no specs).

Which pages get built is controlled by data/price-pages.json:

  {"mode": "pilot", "pilot": [model slugs], "hubs": [hub slugs]}
      Only the listed pages are built, and they carry a noindex tag so
      Google ignores them while they're being reviewed.

  {"mode": "live", ...}
      Every model that passes the quality gate gets a page, plus every hub,
      all indexable and listed in the sitemap.

Files are only rewritten when their content changes, so a page's commit
history matches its real price changes.
"""
import html
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import site_chrome

ROOT = Path(__file__).resolve().parent.parent
PRICES_DIR = ROOT / "prices"
CONFIG_FILE = ROOT / "data" / "price-pages.json"
SITE = "https://golfpriceai.com"

RETAILERS = {
    "awin-clickgolf": "Clickgolf",
    "awin-affordablegolf": "Affordable Golf",
    "awin-majorgolf": "Major Golf Direct",
    "awin-scottsdalegolf": "Scottsdale Golf",
    "awin-callaway": "Callaway Golf",
    "awin-callawaypreowned": "Callaway Golf Preowned",
}

# type -> (hub slug, plural label, singular noun, nav section)
TYPES = {
    "driver": ("drivers", "Drivers", "driver", "clubs"),
    "wood": ("fairway-woods", "Fairway woods", "fairway wood", "clubs"),
    "hybrid": ("hybrids", "Hybrids", "hybrid", "clubs"),
    "irons": ("irons", "Iron sets", "iron set", "clubs"),
    "wedge": ("wedges", "Wedges", "wedge", "clubs"),
    "putter": ("putters", "Putters", "putter", "clubs"),
    "ball": ("golf-balls", "Golf balls", "golf ball", "accessories"),
    "bag": ("golf-bags", "Golf bags", "golf bag", "accessories"),
    "gps-watch": ("gps-watches", "GPS watches", "GPS watch", "accessories"),
    "rangefinder": ("rangefinders", "Rangefinders", "rangefinder", "accessories"),
    "electric-trolley": ("electric-trolleys", "Electric trolleys", "electric trolley", "accessories"),
    "launch-monitor": ("launch-monitors", "Launch monitors", "launch monitor", "accessories"),
    "set": ("golf-package-sets", "Golf package sets", "package set", "clubs"),
    "junior-set": ("junior-golf-sets", "Junior golf sets", "junior golf set", "clubs"),
}
# Hubs built by sets_pages.py (a fuller guide) instead of the standard hub.
GUIDE_HUBS = {"golf-package-sets", "junior-golf-sets"}
# Never in homepage picks, the social feed or the Friday email (junior rule).
NOT_IN_PICKS = {"junior-set"}
HUB_TYPES = {v[0]: k for k, v in TYPES.items()}
# Filled each run by build() from brand_pages.plan(): model slug -> its
# brand + category page, and category -> [(brand, page url)] for the hubs.
BRAND_LINK = {}
DRAFTABLE = set()  # slugs in this run's Bag Draft catalogue
BRAND_CHIPS = {}
CLUB_TYPES = {"driver", "wood", "hybrid", "irons", "wedge", "putter"}
TYPE_ICON = {"driver": "driver", "wood": "wood", "hybrid": "hybrid", "irons": "irons", "wedge": "wedge",
             "putter": "putter", "ball": "ball", "gps-watch": "gps-watch", "rangefinder": "rangefinder",
             "electric-trolley": "pushcart", "bag": "accessories", "launch-monitor": "sensor",
             "set": "irons", "junior-set": "irons"}
SHOP_CATEGORY = {"driver": "driver", "wood": "wood", "hybrid": "hybrid", "irons": "irons", "wedge": "wedge",
                 "putter": "putter", "ball": "ball", "bag": "bag"}


# ---------------------------------------------------------------- formatting
def esc(s):
    return html.escape(str(s), quote=True)


def money(n):
    return f"£{n:,.2f}"


def long_date(d):
    d = d if isinstance(d, date) else date.fromisoformat(d)
    return f"{d.day} {d.strftime('%b %Y')}"


def short_date(d):
    d = d if isinstance(d, date) else date.fromisoformat(d)
    return f"{d.day} {d.strftime('%b')}"


def plural(n, word, many=None):
    return f"{n:,} {word if n == 1 else (many or word + 's')}"


def join_words(items):
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def retailer_name(src):
    return RETAILERS.get(src, src.replace("awin-", "").title())


# ---------------------------------------------------------------- reading listing details
LEFT_RX = re.compile(r"\b(left hand|left-hand|lh)\b", re.I)
LOFT_RX = re.compile(r"\b(\d{1,2}(?:\.\d)?)\s?(?:\*|°|deg\b)", re.I)
WEDGE_LOFT_RX = re.compile(r"\b(4[6-9]|5\d|6[0-4])(?:\.\d{2})?\s?(?:\*|°|deg\b|/|\.\d{2}\b)", re.I)
FLEX_RX = [("Extra stiff", r"\b(extra stiff|x-?stiff|tour x)\b"), ("Stiff", r"\bstiff\b"),
           ("Regular", r"\bregular\b"), ("Senior", r"\b(senior|a-?flex|lite)\b"), ("Ladies", r"\bladies\b")]
SET_SEQ = ["3", "4", "5", "6", "7", "8", "9", "PW", "GW", "SW", "LW"]
SET_RX = re.compile(r"\b([3-9])\s?-\s?(PW|GW|AW|SW|LW|[4-9])\b", re.I)
EXTRA_RX = re.compile(r"\+\s?(AW|GW|SW|LW|\d{2}\s?\*?)", re.I)
BATTERY_RX = re.compile(r"\b(18|27|36)[ -]?hole\b|\b(extended)\b", re.I)


def iron_set(name):
    m = SET_RX.search(name)
    if not m:
        return None
    start, end = m.group(1), m.group(2).upper().replace("AW", "GW")
    if end not in SET_SEQ:
        return None
    count = SET_SEQ.index(end) - SET_SEQ.index(start) + 1 + len(EXTRA_RX.findall(name))
    label = f"{m.group(1)}-{m.group(2).upper()}"
    extras = [x.upper().replace(" ", "") for x in EXTRA_RX.findall(name)]
    if extras:
        label += "+" + "+".join(extras)
    return f"{label} ({count} clubs)" if count > 1 else None


def listing_options(p, type_key):
    """The configuration facts a shopper picks between, read from the name."""
    name = p.get("name", "")
    out = {}
    if type_key in CLUB_TYPES:
        out["Hand"] = "Left" if LEFT_RX.search(name) else "Right"
        if type_key in ("driver", "wood", "hybrid"):
            m = LOFT_RX.search(name)
            if m:
                out["Loft"] = f"{m.group(1)}°"
        if type_key == "wedge":
            m = WEDGE_LOFT_RX.search(name)
            if m:
                out["Loft"] = f"{m.group(1)}°"
        if type_key != "putter":
            for label, rx in FLEX_RX:
                if re.search(rx, name, re.I):
                    out["Flex"] = label
                    break
        if type_key == "irons":
            s = iron_set(name)
            if s:
                out["Set makeup"] = s
            if re.search(r"\bgraphite\b", name, re.I):
                out["Shaft"] = "Graphite"
            elif re.search(r"\bsteel\b", name, re.I):
                out["Shaft"] = "Steel"
    elif type_key == "electric-trolley":
        m = BATTERY_RX.search(name)
        if m:
            out["Battery"] = "36 hole" if m.group(2) else f"{m.group(1)} hole"
        out["Version"] = "With GPS" if re.search(r"\bgps\b", name, re.I) else "Standard"
    elif type_key in ("gps-watch", "rangefinder", "bag", "ball"):
        if p.get("colour"):
            out["Colour"] = p["colour"].title()
        if type_key == "rangefinder" and re.search(r"\bslope\b", name, re.I):
            out["Slope"] = "With slope"
    return out


# ---------------------------------------------------------------- model view
class Model:
    def __init__(self, m, products_by_id, today):
        self.m = m
        self.today = today
        self.name = m["name"]
        self.slug = m["slug"]
        self.type = m["type"]
        self.hub_slug, self.hub_label, self.noun, self.section = TYPES[self.type]
        self.is_ball = self.type == "ball"
        self.listings = [products_by_id[i] for i in m.get("listingIds", []) if i in products_by_id]
        self.preowned = [products_by_id[i] for i in m.get("preownedIds", []) if i in products_by_id]
        self.low_price = m["minPrice"]
        self.history = [(date.fromisoformat(d), p) for d, p in m.get("history") or []]
        self.days = m.get("historyDays") or 0

    # price of one listing in the unit the page compares (per dozen for balls)
    def unit(self, p):
        if self.is_ball:
            from models import ball_pack_size
            size = ball_pack_size(p["name"])
            return round(p["salePrice"] / size * 12, 2) if size else None
        return p["salePrice"]

    def pack_note(self, p):
        if not self.is_ball:
            return ""
        from models import ball_pack_size
        stated = ball_pack_size(p["name"], assume_dozen=False)
        if stated is None:
            return "pack size not stated"
        if stated == 48 and re.search(r"4 for 3", p["name"], re.I):
            return "4 dozen for the price of 3"
        return {3: "3-ball sleeve", 6: "6-ball pack", 12: "12-ball pack", 15: "15-ball pack",
                24: "2 dozen", 36: "3 dozen", 48: "4 dozen"}.get(stated, f"{stated} balls")

    def priced(self):
        rows = [(self.unit(p), p) for p in self.listings]
        return [(u, p) for u, p in rows if u is not None and u >= self.low_price - 0.005]

    def retailer_rows(self):
        by = defaultdict(list)
        for u, p in self.priced():
            by[p["source"]].append((u, p))
        rows = []
        for src, items in by.items():
            items.sort(key=lambda x: x[0])
            u, cheapest = items[0]
            names = {p["name"] for _, p in items}
            rows.append({
                "retailer": retailer_name(src),
                "price": u,
                "from": len({x for x, _ in items}) > 1,
                "options": len(names),
                "url": cheapest["affiliateUrl"],
                "listing": cheapest,
                "note": self.pack_note(cheapest),
            })
        rows.sort(key=lambda r: (r["price"], r["retailer"]))
        return rows

    def option_groups(self):
        groups = defaultdict(lambda: defaultdict(list))
        for u, p in self.priced():
            for k, v in listing_options(p, self.type).items():
                groups[k][v].append((u, p))
        order = ["Set makeup", "Hand", "Loft", "Flex", "Shaft", "Battery", "Version", "Slope", "Colour"]
        out = []
        for k in order:
            if k not in groups or (len(groups[k]) < 2 and k not in ("Hand",)):
                continue
            vals = []
            for v, items in groups[k].items():
                srcs = {p["source"] for _, p in items}
                vals.append({"value": v, "count": len({p["name"] for _, p in items}), "from": min(u for u, _ in items),
                             "retailers": len(srcs)})
            if k == "Loft":
                vals.sort(key=lambda x: float(x["value"].rstrip("°")))
            elif k == "Set makeup":
                vals.sort(key=lambda x: x["from"])
            else:
                vals.sort(key=lambda x: -x["count"])
            out.append((k, vals[:10]))
        return out

    def left_handed(self):
        lefts = [(u, p) for u, p in self.priced() if LEFT_RX.search(p["name"])]
        if not lefts:
            return None
        return {"count": len({p["name"] for _, p in lefts}), "from": min(u for u, _ in lefts),
                "retailers": sorted({retailer_name(p["source"]) for _, p in lefts})}

    def image(self):
        # Men's listings first (a women's photo shouldn't front a unisex model), then cheapest.
        for _, p in sorted(self.priced(), key=lambda x: (bool(WOMEN_PHOTO_RX.search(x[1].get("name", ""))), x[0])):
            if p.get("image"):
                return p["image"]
        return None

    def per(self):
        return " per dozen" if self.is_ball else ""

    # -------------------------------------------------------------- history facts
    def series_daily(self):
        """Expand the change-point history into one price per day."""
        if not self.history:
            return []
        out = []
        pts = self.history
        for i, (d, p) in enumerate(pts):
            end = pts[i + 1][0] if i + 1 < len(pts) else self.today
            cur = d
            while cur < end or (i + 1 == len(pts) and cur <= end):
                out.append((cur, p))
                cur = date.fromordinal(cur.toordinal() + 1)
        return out

    def facts(self):
        daily = self.series_daily()
        if not daily:
            return None
        prices = [p for _, p in daily]
        current = prices[-1]
        changes = sum(1 for a, b in zip(prices, prices[1:]) if a != b)
        since = daily[-1][0]
        for d, p in reversed(daily):
            if p != current:
                break
            since = d
        return {
            "first": daily[0][0], "days": len(daily), "low": min(prices), "high": max(prices),
            "avg": round(sum(prices) / len(prices), 2), "changes": changes, "current": current,
            "since": since,
        }

    def events(self):
        return [dict(e, date=date.fromisoformat(e["date"])) for e in self.m.get("events") or []]

    def verdict(self):
        f = self.facts()
        v = self.m.get("verdict") or {}
        label = v.get("label", "tracking")
        if not f or f["days"] < 30:
            return ("tracking", "Tracking started",
                    f"We've tracked the {self.name} for {plural(f['days'] if f else 0, 'day')}; a verdict appears at 30 days.")
        cur, low, high, days = f["current"], f["low"], f["high"], f["days"]
        held = (self.today - f["since"]).days + 1
        if label == "good":
            cuts = [e for e in self.events() if e["kind"] == "price_cut"]
            why = f" after a price cut on {short_date(cuts[-1]['date'])}" if cuts else ""
            return ("good", "Good time to buy",
                    f"{money(cur)}{self.per()} is the lowest price in {days} days of tracking{why}.")
        if label == "wait":
            rises = [e for e in self.events() if e["kind"] == "price_rise"]
            when = f" It went up on {short_date(rises[-1]['date'])}." if rises else ""
            return ("wait", f"Wait if you can: {money(cur - low)} above its tracked low",
                    f"It was {money(low)}{self.per()} earlier in our {days} days of tracking.{when} "
                    f"Set a price alert and we’ll email you if it comes back down.")
        if cur <= low:
            body = (f"The cheapest option has been {money(cur)}{self.per()} since {short_date(f['since'])}, "
                    f"the lowest in {days} days of tracking." if held < days else
                    f"The cheapest option has held at {money(cur)}{self.per()} for all {days} days we've tracked it.")
            return ("typical", f"Typical price: steady for {plural(held, 'day')}", body + " No sign of a drop coming.")
        return ("typical", "Typical price",
                f"{money(cur)}{self.per()} today. Over {days} days it has ranged from {money(low)} to {money(high)}.")


# ---------------------------------------------------------------- chart
def nice_ticks(lo, hi, n=4):
    span = hi - lo or max(hi * 0.1, 1)
    raw = span / (n - 1)
    mag = 10 ** len(str(int(raw))) / 10 if raw >= 1 else 1
    for m in (1, 2, 2.5, 5, 10):
        step = m * mag
        if step >= raw:
            break
    start = (lo // step) * step
    ticks = []
    t = start
    while t < hi + step * 0.999:
        ticks.append(round(t, 2))
        t += step
    if len(ticks) < 2:
        ticks.append(ticks[-1] + step)
    return ticks


def chart_svg(model, phone=False):
    daily = model.series_daily()
    if len(daily) < 2:
        return ""
    # Two drawings of the same chart: a wide one, and a narrow one whose
    # text stays readable when a phone shrinks it to fit.
    W, H, L, R, T, B = (380, 250, 50, 10, 20, 34) if phone else (1000, 270, 64, 24, 24, 44)
    d0, d1 = daily[0][0], daily[-1][0]
    span_days = max((d1 - d0).days, 1)
    prices = [p for _, p in daily]
    ticks = nice_ticks(min(prices) * 0.97, max(prices) * 1.03)
    ylo, yhi = ticks[0], ticks[-1]

    def x(d):
        return L + (W - L - R) * (d - d0).days / span_days

    def y(p):
        return T + (H - T - B) * (1 - (p - ylo) / (yhi - ylo))

    path = f"M{x(daily[0][0]):.1f} {y(daily[0][1]):.1f}"
    for (da, pa), (db, pb) in zip(daily, daily[1:]):
        if pb != pa:
            path += f" H{x(db):.1f} V{y(pb):.1f}"
    path += f" H{x(d1):.1f}"

    grid = "".join(f'<line x1="{L}" x2="{W - R}" y1="{y(t):.1f}" y2="{y(t):.1f}"/>' for t in ticks)
    ylabels = "".join(f'<text x="{L - 10}" y="{y(t) + 4:.1f}">£{t:,.0f}</text>' for t in ticks)
    # x labels: first day, the 1st of each month, today
    xl = [(d0, "start")]
    m = date(d0.year, d0.month, 1)
    while True:
        m = date(m.year + (m.month // 12), m.month % 12 + 1, 1)
        if m >= d1:
            break
        if (m - d0).days > span_days * (0.2 if phone else 0.12) and (d1 - m).days > span_days * (0.2 if phone else 0.08):
            xl.append((m, "middle"))
    xl.append((d1, "end"))
    xlabels = "".join(f'<text x="{x(d):.1f}" y="{H - 14}" text-anchor="{a}">{short_date(d)}</text>' for d, a in xl)

    # Explain the biggest move, so a new cheaper retailer isn't mistaken for a price cut.
    note = ""
    evs = [e for e in model.events() if d0 < e["date"] <= d1]
    if evs:
        e = max(evs, key=lambda e: abs(e["to"] - e["from"]))
        ex = x(e["date"])
        text = {"new_listing": ("A cheaper listing appeared", "Not a price cut"),
                "price_cut": (f"Price cut: {money(e['from'])} to {money(e['to'])}", "A retailer lowered its price"),
                "price_rise": (f"Price rise: {money(e['from'])} to {money(e['to'])}", "The cheapest option went up")}[e["kind"]]
        anchor, tx = ("start", ex + 8) if ex < W * (0.5 if phone else 0.62) else ("end", ex - 8)
        if phone:
            text = (text[0].split(":")[0] if e["kind"] != "new_listing" else "Cheaper listing", text[1] if e["kind"] == "new_listing" else "")
        # Put the note in whichever half of the chart the line isn't in.
        # The text sits right of the marker (after the change) or left of it
        # (before), so check the line's level on that side.
        level = e["to"] if anchor == "start" else e["from"]
        ty = T + 18 if y(level) > (T + H - B) / 2 else H - B - 30
        note = (f'<line x1="{ex:.1f}" x2="{ex:.1f}" y1="{T}" y2="{H - B}" stroke="#16241c" stroke-width="1" stroke-dasharray="4 4"/>'
                f'<text x="{tx:.1f}" y="{ty}" text-anchor="{anchor}" font-weight="600" fill="#16241c">{short_date(e["date"])}: {esc(text[0])}</text>'
                f'<text x="{tx:.1f}" y="{ty + 18}" text-anchor="{anchor}" fill="#5b665f">{esc(text[1])}</text>')
    last_y = y(daily[-1][1])
    label_y = last_y - 12 if last_y > T + 50 else last_y + 22
    desc = (f"Cheapest {model.name} price each day from {short_date(d0)} to {short_date(d1)}: "
            f"low {money(min(prices))}, high {money(max(prices))}, today {money(prices[-1])}.")
    cls = "pp-chart pp-chart-m" if phone else "pp-chart pp-chart-d"
    return f"""<svg class="{cls}" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(desc)}">
<g stroke="#eef0ec" stroke-width="1">{grid}</g>
<g font-size="13" fill="#5b665f" text-anchor="end">{ylabels}</g>
<g font-size="13" fill="#5b665f">{xlabels}</g>
<g font-size="13">{note}</g>
<path d="{path}" fill="none" stroke="#3fae29" stroke-width="3" stroke-linejoin="round"/>
<circle cx="{x(d1):.1f}" cy="{last_y:.1f}" r="5" fill="#3fae29"/>
<text x="{x(d1) - 8:.1f}" y="{label_y:.1f}" font-size="13" font-weight="700" fill="#2f8a1f" text-anchor="end">{money(prices[-1])} today</text>
</svg>"""


# ---------------------------------------------------------------- shared page parts
ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"></path></svg>'
WOMEN_PHOTO_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
FOURBALL_CSS = '<link rel="stylesheet" href="/css/fourball.css?v=20261018c">\n'
ICON_HEART = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"></path></svg>'
ICON_GROUP = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#2f8a1f" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="16" cy="8" r="3"></circle><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 14.5c1-.3 2-.5 4-.5 3.3 0 6 2.7 6 6"></path></svg>'
ICON_BELL = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 003.4 0"></path></svg>'
VERDICT_ICON = {
    "good": '<path d="M12 5v14M6 13l6 6 6-6"></path>',
    "wait": '<path d="M12 19V5M6 11l6-6 6 6"></path>',
    "typical": '<path d="M4 12h16"></path>',
    "tracking": '<circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path>',
}


def thumb_td(img, href=None):
    """A small product photo cell for price tables (empty cell when no photo)."""
    if not img:
        return '<td class="pp-thumb" aria-hidden="true"></td>'
    pic = (f'<img src="{esc(img)}" alt="" loading="lazy" width="56" height="56" referrerpolicy="no-referrer" '
           f'onerror="this.remove()">')
    inner = f'<a href="{esc(href)}" tabindex="-1">{pic}</a>' if href else f'<span>{pic}</span>'
    return f'<td class="pp-thumb" aria-hidden="true">{inner}</td>'


THUMB_HEAD = '<td class="pp-thumb" aria-hidden="true"></td>'


def page_shell(*, title, description, canonical, body, section, schema, noindex, extra_head="",
               og_image=None):
    # The picture shown when the page is shared (WhatsApp, Facebook, X...):
    # the product photo for a price page, the section photo for a guide,
    # otherwise the site's own share image.
    if not og_image:
        path = canonical.replace(SITE, "", 1)
        og_image = ("/assets/photos/golf-gifts.jpg" if path.startswith("/prices/golf-gifts")
                    else _index_photo(path) or "/assets/social-share.jpg")
    og_image_url = og_image if og_image.startswith("http") else SITE + og_image
    robots = '<meta name="robots" content="noindex, follow">\n' if noindex else ""
    schema_html = "".join(
        f'<script type="application/ld+json">{json.dumps(s, ensure_ascii=False, separators=(",", ":"))}</script>\n'
        for s in schema)
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<meta name="description" content="{esc(description)}">
{robots}<link rel="canonical" href="{canonical}">
<link rel="icon" href="/assets/logo-full.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/site.css?v=20261030">
<link rel="stylesheet" href="/css/prices.css?v=20261029">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GolfPrice AI">
<meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{esc(og_image_url)}">
<meta name="twitter:card" content="summary_large_image">
{extra_head}{schema_html}</head>
<body data-section="{section}">
<a href="#main-content" class="skip-link">Skip to content</a>
{site_chrome.header_html()}
<main id="main-content" class="pp">
{body}
</main>
{site_chrome.footer_html()}
<script src="/js/analytics.js"></script>
<script src="/js/cookie-consent.js"></script>
<script src="/js/site.js?v=20261030" defer></script>
</body>
</html>
"""


def breadcrumb(items):
    """items: list of (label, url or None). Returns (html, schema)."""
    parts, schema = [], []
    for i, (label, url) in enumerate(items):
        last = i == len(items) - 1
        if url and not last:
            parts.append(f'<a href="{url}">{esc(label)}</a>')
        else:
            parts.append(f'<span{" aria-current=\"page\"" if last else ""}>{esc(label)}</span>')
        # Google needs a link for every step except the last, so steps
        # without a page of their own (the brand on a model page) are shown
        # but left out of the structured data.
        if not url and not last:
            continue
        entry = {"@type": "ListItem", "position": len(schema) + 1, "name": label}
        if url:
            entry["item"] = SITE + url
        schema.append(entry)
    html_ = '<nav class="pp-crumbs" aria-label="Breadcrumb">' + '<span class="pp-sep">›</span>'.join(parts) + "</nav>"
    return html_, {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": schema}


def method_note(today, gift=False, onward=True):
    return (while_here(gift) if onward else "") + f"""<section class="pp-method">
  <p>Prices on this page were checked on {long_date(today)}. We check every listing at the retailers we track every 6 hours and keep our own record of every price, which is where the history and the verdict come from. Prices can change on the retailer's site, so check there before you buy. <a href="/about.html">How we track prices</a>.</p>
  <p>GolfPrice AI is reader-supported: when you buy through our links we may earn a commission, at no extra cost to you. It never changes the order or the verdict.</p>
</section>"""


# ---------------------------------------------------------------- model page
def model_link(m, built, today_hint=None):
    """Where a mention of another model should point: its page if it has
    one, otherwise a shop search that finds it."""
    if m["slug"] in built:
        return f"/prices/{m['slug']}/"
    cat = SHOP_CATEGORY.get(m["type"], "accessories")
    q = re.sub(r"[^a-z0-9.]+", "+", m["name"].lower()).strip("+")
    return f"/shop.html?category={cat}&amp;q={q}"


def related(m, all_models, limit=4):
    same_type = [x for x in all_models if x["type"] == m["type"] and x["slug"] != m["slug"] and x["gate"]["passes"]]
    price = m["minPrice"]
    brand_sibs = sorted([x for x in same_type if x["brand"] == m["brand"]], key=lambda x: abs(x["minPrice"] - price))[:2]
    others = sorted([x for x in same_type if x["brand"] != m["brand"] and abs(x["minPrice"] - price) <= price * 0.25],
                    key=lambda x: (-len(x["retailers"]), abs(x["minPrice"] - price)))
    picks, brands = [], set()
    for x in others:
        if x["brand"] not in brands:
            picks.append(x)
            brands.add(x["brand"])
        if len(picks) >= limit - len(brand_sibs):
            break
    out = [("Same brand", x) for x in brand_sibs] + [("Similar price", x) for x in picks]
    return out[:limit]


def compare_block(model, all_models, today):
    """How this model sits against every other model of its type we track:
    price rank, the typical price, its discount off RRP against the typical
    discount, how many rivals dropped lately, and its brand's range. All from
    our own tracked data, so every page says something only it can say.
    Returns (html, (question, answer)) or ("", None) when there's too little to compare."""
    m, t = model.m, model.type
    same = [x for x in all_models if x["type"] == t and x["gate"]["passes"] and x.get("minPrice")]
    if len(same) < 4 or t not in TYPES:
        return "", None
    plural_noun = TYPES[t][1].lower().replace("gps", "GPS")
    per = " per dozen" if model.is_ball else ""
    price = model.low_price
    n = len(same)
    pricier = sum(1 for x in same if x["minPrice"] > price + 0.005)
    cheaper = sum(1 for x in same if x["minPrice"] < price - 0.005)
    prices = sorted(x["minPrice"] for x in same)
    median = prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2
    if cheaper == 0:
        rank = f"The cheapest of the {n} {plural_noun} we track"
    elif pricier == 0:
        rank = f"The most expensive of the {n} {plural_noun} we track"
    else:
        rank = f"Cheaper than {round(100 * pricier / (n - 1))}% of the {n} {plural_noun} we track"
    vs = "under" if price < median - 0.005 else "over" if price > median + 0.005 else "right on"
    typical = (f"A typical {TYPES[t][2]} costs about {money(median)}{per}; this one is "
               + (f"{money(abs(median - price))} {vs} that." if vs != "right on" else "right on it."))
    tiles = [(rank, typical)]
    # discount off RRP, against the typical discount for the type
    discs = sorted(round(100 * (x["rrp"] - x["minPrice"]) / x["rrp"]) for x in same
                   if x.get("rrp") and x["rrp"] > x["minPrice"] and not model.is_ball)
    rrp = m.get("rrp")
    disc_line = ""
    if rrp and rrp > price and len(discs) >= 4 and not model.is_ball:
        mine = round(100 * (rrp - price) / rrp)
        td = discs[len(discs) // 2]
        how = "a bigger saving than most" if mine > td + 2 else "a smaller saving than most" if mine < td - 2 else "about the usual saving"
        tiles.append((f"{mine}% under RRP",
                      f"{plural_noun[0].upper() + plural_noun[1:]} typically sell about {td}% under RRP, so that's {how}."))
        disc_line = f" It's {mine}% under RRP, against a typical {td}%."
    # recent movement across the category
    cutoff = (today - timedelta(days=30)).isoformat()
    def cut_lately(x):
        return any(e.get("kind") == "price_cut" and str(e.get("date", "")) >= cutoff for e in (x.get("events") or []))
    moved = sum(1 for x in same if cut_lately(x))
    me_moved = cut_lately(m)
    tiles.append((f"{moved} of {n} dropped in the last 30 days",
                  ("This one has, too." if me_moved else "This one hasn't, so far.")))
    # its brand's range
    bros = sorted((x for x in same if x["brand"] == m["brand"]), key=lambda x: x["minPrice"])
    brand_line = ""
    if len(bros) >= 2:
        pos = [x["slug"] for x in bros].index(m["slug"]) + 1 if m["slug"] in [x["slug"] for x in bros] else None
        nth = {2: "2nd", 3: "3rd"}.get(pos, f"{pos}th")
        where = ("the cheapest" if pos == 1 else "the priciest" if pos == len(bros) else f"the {nth} cheapest") if pos else "one"
        link = BRAND_LINK.get(m["slug"])
        bname = f'<a href="{link}">{esc(m["brand"])} {esc(plural_noun)}</a>' if link else f"{esc(m['brand'])} {esc(plural_noun)}"
        tiles.append((f"{len(bros)} {m['brand']} {plural_noun}",
                      f"From {money(bros[0]['minPrice'])} to {money(bros[-1]['minPrice'])}{per}; this is {where}."))
        brand_line = f" Of the {len(bros)} {m['brand']} {plural_noun} we track, it's {where}."
    cells = "".join(f'<div class="pp-card pp-cmp"><strong>{esc(a)}</strong><span>{esc(b)}</span></div>' for a, b in tiles)
    more = (f'<p class="pp-small">See every one on our <a href="/prices/{TYPES[t][0]}/">{esc(plural_noun)} price guide</a>'
            + (f' or just the {bname}' if len(bros) >= 2 else '') + '.</p>')
    html = f"""<section class="pp-block">
  <h2>How the {esc(model.name)} compares</h2>
  <p class="pp-small">Against every {esc(TYPES[t][2])} we track across multiple UK retailers, at today’s lowest new prices.</p>
  <div class="pp-cmp-grid">{cells}</div>
  {more}
</section>"""
    answer = (f"{rank}, at {money(price)}{per}. A typical {TYPES[t][2]} costs about {money(median)}{per}." + disc_line + brand_line)
    return html, (f"How does the {model.name} compare with other {plural_noun}?", answer)


def alert_form(model):
    """The "Email me when it drops" box. Posting it is handled by js/site.js;
    the emails come from scripts/alerts.py using the rule described here, so
    keep the two in step."""
    per = " per dozen" if model.is_ball else ""
    return f"""<section class="pp-block pp-alert" id="price-alert">
  <div class="pp-alert-copy">
    <h2>Email me when the {esc(model.name)} drops</h2>
    <p>We’ll email you when the lowest new price{per} drops by at least £5 (or 3%, whichever is bigger). It’s {money(model.low_price)} today. No newsletter, no spam, and you can stop it in one click.</p>
  </div>
  <form class="gp-alert-form" data-model="{esc(model.slug)}" data-model-name="{esc(model.name)}" novalidate>
    <label class="gp-af-label" for="pp-alert-email">Your email</label>
    <div class="gp-af-row">
      <input id="pp-alert-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
      <button type="submit" class="gp-af-btn">Email me</button>
    </div>
    <div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="gp-af-small">New to alerts? We’ll email you once to confirm first. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
    <p class="gp-af-msg" role="status" aria-live="polite"></p>
  </form>
  {fourball_invite(model)}
</section>"""


def fourball_invite(model):
    """Fourball Alerts: send this model to the group chat. Shown by
    js/fourball.js (it needs the share menu), and lit up after a sign-up."""
    return f"""<div class="fb-invite" id="fourball" hidden>
    <div class="fb-invite-top">{ICON_GROUP}<h3 class="fb-head">Tell your four-ball or society</h3></div>
    <p>Playing partners eyeing the same {esc(model.noun)}? Send them the link. Each adds their own email, and you’ll all hear when it drops.</p>
    <div class="fb-invite-row">
      <label>Your first name (optional)<input type="text" name="fb-name" maxlength="20" autocomplete="given-name"></label>
      <button type="button" class="gp-af-btn fb-send">Send to my four-ball</button>
    </div>
    <p class="gp-af-small">We never see or store your mates’ details. They choose whether to sign up. <a href="/fourball/">How Fourball Alerts work</a></p>
  </div>"""


def bought_box(model):
    """"Bought it? We'll keep watching": one email within 30 days if the price
    drops below what they paid. Sent by scripts/alerts.py (BOUGHTWATCH)."""
    fid = f"bw-{model.slug}"[:60]
    return f"""<details class="pp-bought" id="bought-watch">
  <summary><span><strong>Already bought it?</strong> Tell us what you paid. If the price drops in the next 30 days, we’ll email you once, so you can ask the retailer to match it.</span><span class="pp-bought-btn">Watch my price</span></summary>
  <form class="gp-alert-form pp-bought-form" data-bought="{esc(model.slug)}" novalidate>
    <div class="pp-bought-row">
      <label for="{fid}-paid">What you paid{' (per dozen)' if model.is_ball else ''}<input id="{fid}-paid" name="paid" type="text" inputmode="decimal" autocomplete="off" value="{model.low_price:.2f}" required></label>
      <label for="{fid}-email">Your email<input id="{fid}-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required></label>
      <button type="submit" class="gp-af-btn">Watch my price</button>
    </div>
    <div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="gp-af-small">One email at most, only if the lowest UK price falls below what you paid. After 30 days we delete it. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
    <p class="gp-af-msg" role="status" aria-live="polite"></p>
  </form>
</details>"""


def keep_looking(model, hub_url, price):
    """Plain onward links: the brand's range, the nearest 'best under £N'
    guides and the category guide, so a visitor from search has somewhere to go."""
    import compare_pages
    m = model.m
    words = model.hub_label.lower()
    chips = []
    blink = BRAND_LINK.get(m["slug"])
    if blink:
        label = f"All {m['brand']} {words}" if blink.rstrip("/").endswith(model.hub_slug) else f"All {m['brand']} prices"
        chips.append((label, blink))
    budgets = []
    for t, u in compare_pages.BUDGET_CHIPS.get(model.hub_slug) or []:
        mt = re.search(r"£(\d+)", t)
        if mt:
            budgets.append((int(mt.group(1)), u))
    budgets.sort()
    above = [b for b in budgets if b[0] >= price]
    below = [b for b in budgets if b[0] < price]
    if above:
        chips.append((f"Best {words} under £{above[0][0]}", above[0][1]))
    if below:
        chips.append((f"Cheaper: {words} under £{below[-1][0]}", below[-1][1]))
    if hub_url:
        chips.append((f"{model.hub_label} price guide", hub_url))
    if len(chips) < 2:
        return ""
    links = "".join(f'<a class="pp-chip" href="{esc(u)}">{esc(t)}</a>' for t, u in chips)
    return f"""<section class="pp-block">
  <h2>Keep looking</h2>
  <div class="pp-chips">{links}</div>
</section>"""


def while_here(gift=False):
    """Three free things to do next, above the footer on price pages."""
    first = (("GIFT IDEAS", "Drop a hint", "Make a golf wishlist with today’s prices and send it to whoever’s buying.",
              "Make a wishlist", "/prices/golf-gifts/") if gift else
             ("PAR PRICE", "Guess today’s prices, scored like a round",
              "Five real bits of golf kit. Eagle, birdie or a double bogey?", "Play today’s round", "/play/par-price/"))
    cards = [first,
             ("LEAGUES", "Take on your mates", "One link for the group chat. Weekly table, loser buys the first round.",
              "Start a league", "/play/leagues/"),
             ("SOCIETY HQ", "Run your golf society for free", "Fixtures, sign-ups, who’s paid and a waiting list. No app needed.",
              "Set up your society", "/societies/")]
    tiles = "".join(f'<a href="{u}"><span class="wyh-k">{k}</span><span class="wyh-h">{esc(h)}</span>'
                    f'<span class="wyh-p">{esc(p)}</span><span class="wyh-go">{esc(go)} →</span></a>'
                    for k, h, p, go, u in cards)
    return f"""<section class="wyh">
  <h2>While you’re here</h2>
  <p>Free golf games and tools that run on real UK prices.</p>
  <div class="wyh-g">{tiles}</div>
</section>"""


def build_model_page(model, all_models, built, hubs_built, today, noindex):
    m, name = model.m, model.name
    rows = model.retailer_rows()
    if not rows:
        return None
    f = model.facts()
    low = rows[0]
    per = model.per()
    n_ret = len(rows)
    vlabel, vtitle, vtext = model.verdict()
    hub_url = f"/prices/{model.hub_slug}/" if model.hub_slug in hubs_built else None

    crumbs_html, crumbs_schema = breadcrumb([
        ("Home", "/"), ("Prices", "/prices/"), (model.hub_label, hub_url), (m["brand"], BRAND_LINK.get(m["slug"])),
        (name.replace(m["brand"] + " ", "", 1), None)])

    cheapest_at = [r["retailer"] for r in rows if abs(r["price"] - low["price"]) < 0.005]
    if len(cheapest_at) == n_ret and n_ret > 1:
        where = f"the same at all {n_ret} retailers we track"
    elif len(cheapest_at) > 1:
        where = f"at {join_words(cheapest_at)}"
    else:
        where = f"at {low['retailer']}"
    if len(cheapest_at) == n_ret and n_ret > 1:
        answer = (f"On {long_date(today)} the lowest new UK price for the {esc(name)} is "
                  f"<strong>{money(low['price'])}{per}</strong>, the same at all {n_ret} retailers we track.")
    else:
        answer = (f"On {long_date(today)} the lowest new UK price for the {esc(name)} is "
                  f"<strong>{money(low['price'])}{per}</strong> {where}, across "
                  f"{plural(model.m['listingCount'], 'listing')} at {plural(n_ret, 'retailer')}.")
    if model.type == "irons":
        makeup = listing_options(low["listing"], "irons").get("Set makeup")
        if makeup:
            answer += f" That price is for a {esc(makeup.replace(' (', ' set (', 1))}; prices depend on how many clubs are in the set."
    rrp = m.get("rrp")
    rrp_html = f'<span class="pp-rrp">Retailer\'s RRP {money(rrp)}</span>' if rrp and not model.is_ball else ""

    img = model.image()
    img_html = (f'<img src="{esc(img)}" alt="{esc(name)}" width="440" height="400" loading="eager" '
                f'referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'pp-photo-none\');this.remove()">'
                if img else "")

    # Where to buy
    trs = []
    for i, r in enumerate(rows):
        price = ("from " if r["from"] else "") + money(r["price"]) + per
        note = f'<span class="pp-sub">{esc(r["note"])}</span>' if r["note"] else ""
        trs.append(f"""<tr>
  <th scope="row">{esc(r['retailer'])}</th>
  <td class="pp-price">{price}{note}</td>
  <td>{plural(r['options'], 'option')}</td>
  <td class="pp-stock">In stock</td>
  <td><a class="pp-shop{' pp-shop-main' if i == 0 else ''}" href="{esc(r['url'])}" target="_blank" rel="sponsored nofollow noopener">Shop<span class="sr-only"> at {esc(r['retailer'])}</span></a></td>
</tr>""")
    same_note = ""
    if len(cheapest_at) == n_ret and n_ret > 1:
        same_note = '<p class="pp-small">Same price at every retailer today, so pick the one you prefer.</p>'
    if model.is_ball:
        same_note += ('<p class="pp-small">Every price is converted to a price per dozen so sleeves, 12-packs and '
                      'multi-buys compare fairly. Where a retailer doesn\'t state the pack size we assume a dozen.</p>')

    # Options
    opt_html = ""
    groups = model.option_groups()
    if groups:
        blocks = []
        for k, vals in groups:
            chips = "".join(
                f'<span class="pp-chip">{esc(v["value"])} <em>{v["count"]} · from {money(v["from"])}</em></span>' for v in vals)
            blocks.append(f'<div class="pp-optgroup"><div class="pp-label">{esc(k)}</div><div class="pp-chips">{chips}</div></div>')
        opt_html = f"""<div class="pp-col">
  <h2>Options available</h2>
  <div class="pp-card pp-options">{''.join(blocks)}</div>
</div>"""

    # History
    hist_html = ""
    if f:
        hist_html = f"""<section class="pp-block">
  <h2>{esc(name)} price history</h2>
  <p class="pp-small">Cheapest new price available each day{per} · {plural(f['days'], 'day')} tracked · low {money(f['low'])} · high {money(f['high'])} · average {money(f['avg'])} · {plural(f['changes'], 'price change')}</p>
  <div class="pp-card pp-chart-wrap">{chart_svg(model)}{chart_svg(model, phone=True)}</div>
</section>"""

    # Pre-owned
    pre_html = ""
    if model.preowned:
        items = []
        for p in model.preowned[:4]:
            cond = p.get("condition") or ("Preowned" if p.get("source") == "awin-callawaypreowned" else "Used")
            items.append(f"""<li><a href="{esc(p['affiliateUrl'])}" target="_blank" rel="sponsored nofollow noopener">
  <span>{esc(p['name'])}</span><span class="pp-sub">{esc(cond)} · {esc(retailer_name(p['source']))}</span><strong>{money(p['salePrice'])}</strong></a></li>""")
        pre_html = f"""<section class="pp-block">
  <h2>Pre-owned and ex-demo {esc(name)}</h2>
  <p class="pp-small">Kept separate from the new prices above, because condition changes what a fair price is.</p>
  <ul class="pp-card pp-list">{''.join(items)}</ul>
</section>"""

    # Questions, answered from the data
    qs = []
    others = [r for r in rows if r is not low][:2]
    also = (" Also at " + join_words(f"{r['retailer']} from {money(r['price'])}" for r in others) + ".") if others else ""
    if len(cheapest_at) == n_ret and n_ret > 1:
        a1 = f"It's {money(low['price'])}{per} at all {n_ret} retailers we track today: {join_words(cheapest_at)}."
    else:
        a1 = f"{low['retailer']}, from {money(low['price'])}{per} today.{also}"
    qs.append((f"Where's the cheapest place to buy the {name}?", a1))

    evs = model.events()
    cuts = [e for e in evs if e["kind"] == "price_cut"]
    rises = [e for e in evs if e["kind"] == "price_rise"]
    adds = [e for e in evs if e["kind"] == "new_listing"]
    if cuts:
        e = cuts[-1]
        a2 = f"Yes. On {long_date(e['date'])} the cheapest price fell from {money(e['from'])} to {money(e['to'])}{per}."
    elif adds and f and f["current"] < f["high"]:
        e = adds[-1]
        a2 = (f"Not as a price cut. The cheapest price fell from {money(e['from'])} to {money(e['to'])}{per} on "
              f"{long_date(e['date'])} because a cheaper listing appeared, not because a retailer lowered its price.")
    elif rises:
        e = rises[-1]
        a2 = f"No, it has gone up. On {long_date(e['date'])} the cheapest price rose from {money(e['from'])} to {money(e['to'])}{per}."
    elif f:
        a2 = f"No. The cheapest price has held at {money(f['current'])}{per} for all {f['days']} days we've tracked it."
    else:
        a2 = "We've only just started tracking it, so there's no history yet."
    if m.get("verifiedDrops"):
        a2 += (f" {plural(m['verifiedDrops'], 'individual listing')} {'shows' if m['verifiedDrops'] == 1 else 'show'} "
               f"a genuine drop against our own price history.")
    qs.append((f"Has the {name} price dropped?", a2))

    if f:
        a3 = f"{vtitle}. {vtext}"
        if "ranged from" not in vtext and f["high"] > f["low"]:
            a3 += f" Over {f['days']} days it has ranged from {money(f['low'])} to {money(f['high'])}{per}."
        qs.append((f"Is {money(low['price'])} a good price for the {name}?", a3))

    if model.type in CLUB_TYPES:
        lh = model.left_handed()
        if lh:
            qs.append((f"Is there a left-handed {name}?",
                       f"Yes: {plural(lh['count'], 'left-handed option')} from {money(lh['from'])}, at {join_words(lh['retailers'])}."))
        else:
            qs.append((f"Is there a left-handed {name}?",
                       "Not at the retailers we track right now. We'll show it here as soon as one lists it."))
    if model.is_ball:
        qs.append((f"How much is the {name} per dozen?",
                   f"From {money(low['price'])} per dozen at {low['retailer']}. We convert sleeves, 12-packs and "
                   f"multi-buys to a per-dozen price so every pack compares fairly."))
    sets = dict(groups).get("Set makeup")
    if sets:
        qs.append((f"Which {name} set makeups can I buy?",
                   "; ".join(f"{v['value']} from {money(v['from'])}" for v in sets[:4]) + "."))
    colours = dict(groups).get("Colour")
    if colours and not model.is_ball:
        qs.append((f"Which colours can I get the {name} in?",
                   join_words(f"{v['value']} ({plural(v['retailers'], 'retailer')})" for v in colours) + "."))
    if model.preowned:
        pm = min(p["salePrice"] for p in model.preowned)
        qs.append((f"Can I buy the {name} pre-owned?",
                   f"Yes: {plural(len(model.preowned), 'pre-owned or ex-demo listing')} from {money(pm)}."))
    cmp_html, cmp_q = compare_block(model, all_models, today)
    if cmp_q:
        qs.append(cmp_q)
    q_html = "".join(f'<div class="pp-card pp-q"><h3>{esc(q)}</h3><p>{esc(a)}</p></div>' for q, a in qs)
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage",
                  "mainEntity": [{"@type": "Question", "name": q,
                                  "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qs]}

    # Related
    rel = related(m, all_models)
    rel_html = ""
    import compare_pages
    cmp = compare_pages.COMPARE_FOR.get(model.slug) or []
    if cmp:
        chips = "".join(f'<a class="pp-chip" href="{u}">vs {esc(x["name"])} · {money(x["minPrice"])}</a>' for x, u in cmp[:4])
        rel_html += f"""<section class="pp-block">
  <h2>Compare the {esc(name)} side by side</h2>
  <div class="pp-chips">{chips}</div>
</section>"""
    rel_html += keep_looking(model, hub_url, low["price"])
    if rel:
        cards = "".join(f"""<a class="pp-card pp-rel" href="{model_link(x, built)}">
  <span class="pp-tag">{tag}</span><span class="pp-rel-name">{esc(x['name'])}</span>
  <span class="pp-rel-price">from {money(x['minPrice'])}{' per dozen' if x['type'] == 'ball' else ''}</span>
  <span class="pp-sub">{plural(len(x['retailers']), 'retailer')}</span></a>""" for tag, x in rel)
        rel_html += f"""<section class="pp-block">
  <h2>Worth comparing</h2>
  <div class="pp-rel-grid">{cards}</div>
</section>"""

    _p = money(low['price']) + (" per dozen" if per else "")
    _is = "are" if name.lower().endswith(("balls", "irons", "wedges", "shoes", "gloves", "sets")) else "is"
    if m.get("_card"):
        share_text = f"The {name} {_is} {_p} today, the lowest price GolfPrice AI has tracked:"
    elif vlabel == "good":
        share_text = f"The {name} {_is} {_p} today, a good price according to GolfPrice AI:"
    else:
        share_text = f"Compare UK prices for the {name}, from {_p} today on GolfPrice AI:"
    import bag_draft
    draft_card = bag_draft.product_card(m, DRAFTABLE, today, plural=(_is == "are"))
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-top">
  <div class="pp-photo" style="--pp-icon:url('/assets/icons/{TYPE_ICON.get(model.type, 'accessories')}.svg')">{img_html}</div>
  <div class="pp-summary">
    <h1>{esc(name)} price UK</h1>
    <p class="pp-answer">{answer}</p>
    <div class="pp-from"><span class="pp-sub">from</span><span class="pp-big">{money(low['price'])}</span>{'<span class="pp-sub">per dozen</span>' if per else ''}{rrp_html}</div>
    <div class="pp-verdict pp-v-{vlabel}">
      <span class="pp-v-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{VERDICT_ICON[vlabel]}</svg></span>
      <div><strong>{esc(vtitle)}</strong><span>{esc(vtext)}</span></div>
    </div>
    <div class="pp-ctas">
      <a class="pp-btn" href="{esc(low['url'])}" target="_blank" rel="sponsored nofollow noopener">Shop from {money(low['price'])}{per}</a>
      <a class="pp-btn pp-btn-alt" href="#price-alert">{ICON_BELL}Email me when it drops</a>
      <button type="button" class="pp-btn pp-btn-alt gp-share" data-text="{esc(share_text)}">{ICON_SHARE}Share this deal</button>
    </div>
    <p class="pp-disclose">We may earn a commission if you buy through these links. It never changes the prices or the verdict.</p>
    <div class="fb-row" hidden><button type="button" class="fb-save" aria-pressed="false">{ICON_HEART}<span>Add to four-ball shortlist</span></button><span class="fb-row-note"></span></div>
    <p class="pp-check fb-nudge" hidden>Buying with mates? <a href="#fourball">Make it a four-ball alert →</a></p>
    <p class="pp-check">Seen it somewhere else? <a href="/price-check.html?m={esc(model.slug)}">Check if that price is any good →</a></p>
    {bought_box(model)}
  </div>
</section>
{draft_card}
<div class="pp-two">
  <div class="pp-col pp-col-main">
    <h2>Where to buy the {esc(name)}</h2>
    <div class="pp-card pp-table-wrap"><table class="pp-table">
      <thead><tr><th scope="col">Retailer</th><th scope="col">Price{' per dozen' if per else ''}</th><th scope="col">Options</th><th scope="col">Stock</th><th scope="col"><span class="sr-only">Link</span></th></tr></thead>
      <tbody>{''.join(trs)}</tbody>
    </table></div>
    {same_note}
  </div>
  {opt_html}
</div>
{hist_html}
{alert_form(model)}
{pre_html}
{cmp_html}
<section class="pp-block">
  <h2>Questions about the {esc(name)}</h2>
  <div class="pp-q-grid">{q_html}</div>
</section>
{rel_html}
{method_note(today)}
<p class="pp-small pp-data">The facts on this page as data: <a href="/prices/{model.slug}/data.json">data.json</a></p>
</div>
<script src="/js/gift-finder.js?v=20261018d" defer></script>
<script src="/js/fourball.js?v=20261024" defer></script>"""

    title = f"{name} Price UK: from {money(low['price'])}{per}"
    if model.is_ball:
        desc = (f"Every UK {name} price, converted to per dozen so pack sizes compare fairly. "
                f"From {money(low['price'])} per dozen today. Updated every 6 hours.")
    else:
        desc = (f"Lowest UK price today across {plural(n_ret, 'retailer')}, plus "
                f"{plural(f['days'] if f else 0, 'day')} of price history. See if now's a good time to buy the {name}.")
    canonical = f"{SITE}/prices/{model.slug}/"
    product = {
        "@context": "https://schema.org", "@type": "Product", "name": name,
        "brand": {"@type": "Brand", "name": m["brand"]}, "url": canonical,
        "offers": {"@type": "AggregateOffer", "priceCurrency": "GBP", "lowPrice": round(low["price"], 2),
                   "highPrice": round(max(r["price"] for r in rows), 2), "offerCount": m["listingCount"],
                   "availability": "https://schema.org/InStock"},
    }
    if img:
        product["image"] = img
    if model.is_ball:
        product["offers"]["description"] = "Prices per dozen balls"
    page = page_shell(title=title, description=desc, canonical=canonical, body=body, section=model.section,
                      og_image=(m.get("_card") or m.get("_image") or img or None),
                      extra_head=FOURBALL_CSS + (('<meta property="og:image:width" content="1200">\n'
                                  '<meta property="og:image:height" content="630">\n') if m.get("_card") else ""),
                      schema=[product, crumbs_schema, faq_schema], noindex=noindex)

    data = {
        "name": name, "brand": m["brand"], "type": model.noun, "url": canonical, "checked": today.isoformat(),
        "currency": "GBP", "unit": "per dozen" if model.is_ball else "each",
        "lowestNewPrice": low["price"], "lowestAt": cheapest_at,
        "retailers": [{"name": r["retailer"], "from": r["price"], "options": r["options"]} for r in rows],
        "history": {"daysTracked": f["days"], "low": f["low"], "high": f["high"], "average": f["avg"],
                    "priceChanges": f["changes"], "series": m.get("history")} if f else None,
        "verdict": {"label": vlabel, "summary": vtitle},
        "image": m.get("_image") or img or None,
        "source": "GolfPrice AI's own price tracking, checked every 6 hours",
    }
    return page, json.dumps(data, ensure_ascii=False, indent=1)


# ---------------------------------------------------------------- hub page
def _budget_chips(hub_slug):
    import compare_pages
    chips = compare_pages.BUDGET_CHIPS.get(hub_slug) or []
    if not chips:
        return ""
    return ('<div class="pp-chips cp-budgets"><span class="cp-budgets-label">Best by budget:</span>'
            + "".join(f'<a class="pp-chip" href="{u}">{esc(t)}</a>' for t, u in chips) + "</div>")


def build_hub_page(hub_slug, all_models, built, hubs_built, today, noindex):
    type_key = HUB_TYPES[hub_slug]
    _, label, noun, section = TYPES[type_key]
    ms = sorted([m for m in all_models if m["type"] == type_key and m["gate"]["passes"]], key=lambda m: m["minPrice"])
    if not ms:
        return None
    per = " per dozen" if type_key == "ball" else ""
    retailers = {s for m in ms for s in m["retailers"]}
    good = [m for m in ms if (m.get("verdict") or {}).get("label") == "good"]
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (label, None)])
    answer = (f"On {long_date(today)} we track {plural(len(ms), noun)} at {plural(len(retailers), 'UK retailer')}, "
              f"from <strong>{money(ms[0]['minPrice'])}{per}</strong> ({esc(ms[0]['name'])}) to "
              f"{money(ms[-1]['minPrice'])}{per}.")
    if good:
        answer += f" {len(good)} of them {'is' if len(good) == 1 else 'are'} at the lowest price we've tracked."
    vlab = {"good": "Good time to buy", "wait": "Wait if you can", "typical": "Typical price", "tracking": "Tracking"}
    trs = "".join(f"""<tr data-price="{m['minPrice']}" data-name="{esc(m['name'].lower())}" data-ret="{len(m['retailers'])}">
  <th scope="row"><a href="{model_link(m, built)}">{esc(m['name'])}</a></th>
  {thumb_td(m.get('_image'), model_link(m, built))}
  <td class="pp-price">{money(m['minPrice'])}{per}</td>
  <td>{len(m['retailers'])}</td>
  <td><span class="pp-vtag pp-v-{(m.get('verdict') or {}).get('label', 'tracking')}">{vlab.get((m.get('verdict') or {}).get('label', 'tracking'))}</span></td>
</tr>""" for m in ms)
    others = [h for h in hubs_built if h != hub_slug]
    other_html = ""
    if BRAND_CHIPS.get(type_key):
        bchips = "".join(f'<a class="pp-chip" href="{u}">{esc(b)}</a>' for b, u in BRAND_CHIPS[type_key])
        other_html += f'<section class="pp-block"><h2>{esc(label)} by brand</h2><div class="pp-chips">{bchips}</div></section>'
    if others:
        links = "".join(f'<a class="pp-chip" href="/prices/{h}/">{TYPES[HUB_TYPES[h]][1]}</a>' for h in others)
        other_html += f'<section class="pp-block"><h2>More price guides</h2><div class="pp-chips">{links}</div></section>'
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <h1>{esc(noun[0].upper() + noun[1:])} prices UK</h1>
  <p class="pp-answer">{answer}</p>
  {_budget_chips(hub_slug)}
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes the order or the verdicts.</p>
</section>
<section class="pp-block">
  <div class="pp-sort" role="group" aria-label="Sort">
    <span>Sort:</span>
    <button type="button" data-sort="price" aria-pressed="true">Lowest price</button>
    <button type="button" data-sort="ret" aria-pressed="false">Most retailers</button>
    <button type="button" data-sort="name" aria-pressed="false">A to Z</button>
  </div>
  <div class="pp-card pp-table-wrap"><table class="pp-table pp-hub-table">
    <thead><tr><th scope="col">Model</th>{THUMB_HEAD}<th scope="col">From</th><th scope="col">Retailers</th><th scope="col">Verdict</th></tr></thead>
    <tbody id="pp-hub-rows">{trs}</tbody>
  </table></div>
  <p class="pp-small">Lowest new, in-stock price{per} for each model, checked every 6 hours. Verdicts compare today's price with the model's own tracked history.</p>
</section>
{other_html}
{method_note(today)}
</div>
<script>
(function () {{
  var body = document.getElementById('pp-hub-rows');
  var rows = Array.prototype.slice.call(body.children);
  document.querySelectorAll('.pp-sort button').forEach(function (b) {{
    b.addEventListener('click', function () {{
      var k = b.getAttribute('data-sort');
      rows.sort(function (x, y) {{
        if (k === 'price') return x.dataset.price - y.dataset.price;
        if (k === 'ret') return (y.dataset.ret - x.dataset.ret) || (x.dataset.price - y.dataset.price);
        return x.dataset.name < y.dataset.name ? -1 : 1;
      }});
      rows.forEach(function (r) {{ body.appendChild(r); }});
      document.querySelectorAll('.pp-sort button').forEach(function (o) {{ o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); }});
    }});
  }});
}})();
</script>"""
    canonical = f"{SITE}/prices/{hub_slug}/"
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": f"{noun[0].upper() + noun[1:]} prices UK",
                 "numberOfItems": len(ms),
                 "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": m["name"],
                                      **({"url": SITE + f"/prices/{m['slug']}/"} if m["slug"] in built else {})}
                                     for i, m in enumerate(ms)]}
    title_noun = " ".join(w if w.isupper() else w.capitalize() for w in noun.split())
    golf = "" if "golf" in noun.lower() else "Golf "
    title = f"{golf}{title_noun} Prices UK: Compare {len(ms)} from {money(ms[0]['minPrice'])}{per}"
    desc = (f"{plural(len(ms), noun)} tracked across UK retailers, lowest first, with each one's price history "
            f"and a verdict on whether now's a good time to buy.")
    return page_shell(title=title, description=desc, canonical=canonical, body=body, section=section,
                      schema=[item_list, crumbs_schema], noindex=noindex)


# Photos for the price-guide index cards (17 Oct 2026): the site's own
# photos, reused from the hub pages and Deal Tools. A section only switches
# to photo cards when every card in it has a photo, so it never looks
# half-finished; drop the named file into assets/photos/ and it appears.
INDEX_PHOTOS = {
    "/prices/drivers/": "driver-head.jpg", "/prices/fairway-woods/": "fairway-wood-head.jpg",
    "/prices/hybrids/": "hybrid-head.jpg", "/prices/irons/": "irons-head.jpg", "/prices/wedges/": "wedges-trio.jpg",
    "/prices/putters/": "putter-mallet.jpg", "/prices/golf-balls/": "golf-ball-branded.jpg",
    "/prices/golf-bags/": "golfbag-with-clubs.jpg", "/prices/gps-watches/": "gps-watch-real.jpg",
    "/prices/rangefinders/": "rangefinder-real.jpg", "/prices/electric-trolleys/": "pushcart-loaded.jpg",
    "/prices/launch-monitors/": "launch-monitor-display.jpg", "/prices/golf-package-sets/": "clubs-set-bag.jpg",
    "/prices/junior-golf-sets/": "junior-golf-set.jpg",
    "/prices/golf-shoes/": "shoes-white-pair.jpg", "/prices/golf-polo-shirts/": "polo-navy-walk.jpg",
    "/prices/golf-jackets/": "jacket-grey-darksleeve.jpg", "/prices/golf-mid-layers/": "midlayer-green-quarterzip.jpg",
    "/prices/golf-trousers/": "trousers-navy.jpg", "/prices/golf-shorts/": "shorts-cream-belt.jpg",
    "/prices/golf-gloves/": "glove-pair-ongrass.jpg",
    "/prices/drops/": "tools/price-drops-wide.jpg", "/price-check.html": "tools/good-price-wide.jpg",
    "/prices/winter-golf/": "winter-jacket.jpg", "/prices/data/": "tools/fairway-index-wide.jpg",
    "/prices/black-friday/": "black-friday.jpg", "/prices/christmas/": "christmas.jpg",
    "/prices/boxing-day-sales/": "boxing-day.jpg", "/prices/golf-gifts/": "golf-gifts.jpg",
}


def _index_photo(url):
    f = INDEX_PHOTOS.get(url)
    return f"/assets/photos/{f}" if f and (ROOT / "assets" / "photos" / f).exists() else None


INDEX_FALLBACK = {}  # url -> a product photo, filled by build() for hubs without their own photo yet


def _index_cards(items):
    """items: (url, title, subtitle html). Photo cards if every one has a
    photo (a hub may borrow a product photo until its own arrives)."""
    photos = [_index_photo(u) for u, _, _ in items]
    shots = [(ph, "") if ph else (INDEX_FALLBACK.get(u), " pp-rel-product") for (u, _, _), ph in zip(items, photos)]
    if items and all(ph for ph, _ in shots):
        return "".join(f'<a class="pp-card pp-rel pp-rel-photo" href="{u}"><span class="pp-rel-img{cls}"><img src="{esc(ph)}" alt="" loading="lazy" width="400" height="250"{' referrerpolicy="no-referrer"' if cls else ""}></span>'
                       f'<span class="pp-rel-body"><span class="pp-rel-name">{esc(t)}</span><span class="pp-sub">{d}</span></span></a>'
                       for (u, t, d), (ph, cls) in zip(items, shots))
    return "".join(f'<a class="pp-card pp-rel" href="{u}"><span class="pp-rel-name">{esc(t)}</span><span class="pp-sub">{d}</span></a>'
                   for u, t, d in items)


def build_index_page(all_models, hubs_built, today, noindex, seasonal_links=(), brand_counts=None, clothing_links=()):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", None)])
    seasonal_html = ""
    if clothing_links:
        cc = _index_cards([(u, t, esc(d)) for u, t, d in clothing_links])
        seasonal_html += f'<section class="pp-block"><h2>Golf clothing, shoes and gloves</h2><div class="pp-rel-grid">{cc}</div></section>'
    if seasonal_links:
        sc = _index_cards([(u, t, esc(d)) for u, t, d in seasonal_links])
        seasonal_html += f'<section class="pp-block"><h2>Seasonal guides</h2><div class="pp-rel-grid">{sc}</div></section>'
    if brand_counts:
        from brand_pages import brand_slug
        top = sorted(brand_counts.items(), key=lambda x: -x[1])[:16]
        chips = "".join(f'<a class="pp-chip" href="/prices/brands/{brand_slug(b)}/">{esc(b)} <em>{n}</em></a>' for b, n in top)
        seasonal_html += (f'<section class="pp-block"><h2>By brand</h2><div class="pp-chips">{chips}'
                          f'<a class="pp-chip" href="/prices/brands/">All {len(brand_counts)} brands →</a></div></section>')
    items = []
    for h in hubs_built:
        t = HUB_TYPES[h]
        ms = [m for m in all_models if m["type"] == t and m["gate"]["passes"]]
        if ms:
            items.append((f"/prices/{h}/", TYPES[t][1],
                          f"{plural(len(ms), 'model')} tracked · from {money(min(m['minPrice'] for m in ms))}{' per dozen' if t == 'ball' else ''}"))
    cards = [_index_cards(items)]
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <h1>UK golf price guides</h1>
  <p class="pp-answer">Every price guide is built from our own record of UK golf prices, checked every 6 hours since August 2026: the lowest price today, where to buy it, and whether now's a good time.</p>
</section>
<section class="pp-block"><div class="pp-rel-grid">{''.join(cards)}</div></section>
{seasonal_html}
{method_note(today)}
</div>"""
    return page_shell(title="UK Golf Price Guides | GolfPrice AI",
                      description="Price guides for golf clubs, balls and accessories, built from our own UK price tracking: today's lowest price, price history and a verdict.",
                      canonical=f"{SITE}/prices/", body=body, section="", schema=[crumbs_schema], noindex=noindex)


# ---------------------------------------------------------------- writing
def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_text(encoding="utf-8") == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


def load_config():
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {"mode": "off"}


# ---------------------------------------------------------------- old /products/ pages
OLD_PRODUCTS_DIR = ROOT / "products"
_TYPE_WORDS = [("putter", r"\bputter"), ("wedge", r"\bwedge"), ("hybrid", r"\b(hybrid|rescue)"), ("irons", r"\birons?\b"),
               ("wood", r"\b(fairway|wood)"), ("driver", r"\bdriver"), ("ball", r"\bballs?\b"), ("bag", r"\bbag\b"),
               ("gps-watch", r"\bwatch"), ("rangefinder", r"rangefinder"), ("electric-trolley", r"trolley")]
_GENERIC = {"golf", "balls", "ball", "bag", "fairway", "wood", "woods", "irons", "iron", "driver", "hybrid", "putter",
            "wedge", "wedges", "watch", "gps", "rangefinder", "laser", "electric", "trolley", "cart", "stand"}
_NOISE = {"graphite", "steel", "mens", "men", "s", "womens", "ladies", "2024", "2025", "2026", "satin", "chrome", "the", "golf"}


def forward_old_product_pages(models_list, products, live_slugs):
    """The 200 product pages from the first version of the site no longer
    update. Each becomes a tiny page that forwards to the matching price
    guide (or a shop search), so old links and bookmarks still work."""
    if not OLD_PRODUCTS_DIR.exists():
        return 0
    by_name = {}
    for p in products:
        by_name.setdefault(p["name"].strip().lower(), p)
    page_for = {}
    for m in models_list:
        if m["slug"] in live_slugs:
            for i in m.get("listingIds", []) + m.get("preownedIds", []):
                page_for[i] = m["slug"]
    changed = 0
    for f in sorted(OLD_PRODUCTS_DIR.glob("*.html")):
        text = f.read_text(encoding="utf-8")
        found = re.search(r'"name": "(.*?)"', text) or re.search(r"<title>(.*?) \| GolfPrice AI</title>", text)
        if not found:
            continue
        name = html.unescape(found.group(1))
        p = by_name.get(name.strip().lower())
        slug = page_for.get(p["id"]) if p else None
        if not slug:
            words = set(re.findall(r"[a-z0-9]+", name.lower()))
            kind = next((t for t, rx in _TYPE_WORDS if re.search(rx, name, re.I)), None)
            for m in models_list:
                if m["slug"] not in live_slugs or m["type"] != kind:
                    continue
                brand = set(re.findall(r"[a-z0-9]+", m["brand"].lower()))
                mw = set(re.findall(r"[a-z0-9]+", m["name"].lower())) - _GENERIC - brand
                if mw and mw <= words and not (words - mw - _GENERIC - _NOISE - brand):
                    slug = m["slug"]
                    break
        if slug:
            target, label = f"/prices/{slug}/", "its price guide"
        else:
            q = re.sub(r"[^a-z0-9]+", "+", name.lower()).strip("+")
            target, label = f"/shop.html?q={q}", "today's prices in the shop"
        page = f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<title>{esc(name)} | GolfPrice AI</title>
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="{esc(SITE + target)}">
<meta http-equiv="refresh" content="0; url={esc(target)}">
<script>location.replace({json.dumps(target)});</script>
</head>
<body>
<p>This page has moved. See <a href="{esc(target)}">{esc(name)}: {label}</a>.</p>
</body>
</html>
"""
        if _write(f, page):
            changed += 1
    return changed


# Filled in by build(): listing id -> its model page address, so other parts
# of the pipeline (the deals feed) can link to the price page.
PAGE_FOR_LISTING = {}
INDEXNOW_LIST = Path("/tmp/indexnow-urls.txt")
SITEMAP_PRICES = ROOT / "sitemap-prices.xml"
SITEMAP_PAGES = ROOT / "sitemap-pages.xml"
SITEMAP_INDEX = ROOT / "sitemap.xml"
STATIC_PAGES = ["", "shop/", "shop.html", "clubs.html", "apparel.html", "accessories.html", "deal-tools.html", "build-your-bag.html",
                "complete-the-look.html", "complete-the-kit.html", "find-your-fit.html", "fairway-index.html",
                "best-time-to-buy.html", "back-in-stock.html", "receipts.html", "about.html",
                "faq.html", "price-check.html", "ai.html", "legal/privacy-policy.html", "legal/cookies.html"]


def last_price_change(m):
    """The day this model's cheapest price last changed (or tracking began)."""
    hist = m.get("history") or []
    last = hist[0][0] if hist else None
    for (d0, p0), (d1, p1) in zip(hist, hist[1:]):
        if p1 != p0:
            last = d1
    return last


def _facts_only(data_json):
    """data.json without the 'checked' date: what changed in the prices."""
    try:
        d = json.loads(data_json)
        d.pop("checked", None)
        d.pop("image", None)  # a new photo isn't a price change
        return json.dumps(d, sort_keys=True)
    except ValueError:
        return data_json


def retired_page(slug, name, hub_slug, today):
    hub = TYPES[HUB_TYPES[hub_slug]][1] if hub_slug in HUB_TYPES else "price guides"
    hub_url = f"/prices/{hub_slug}/" if hub_slug in HUB_TYPES else "/prices/"
    body = f"""<div class="pp-wrap">
<section class="pp-hub-top">
  <h1>{esc(name)} price UK</h1>
  <p class="pp-answer">As of {long_date(today)}, none of the UK retailers we track has the {esc(name)} in stock, so we've stopped showing prices for it.</p>
  <p><a class="pp-btn" href="{hub_url}">See {esc(hub.lower())} we track today</a></p>
</section>
{method_note(today)}
</div>"""
    return page_shell(title=f"{name} Price UK | GolfPrice AI", description=f"The {name} is no longer stocked by the UK retailers we track.",
                      canonical=f"{SITE}/prices/{slug}/", body=body, section="", schema=[], noindex=True)


def write_sitemaps(entries, today):
    """sitemap.xml becomes an index of two sitemaps: the site's own pages and
    the price pages. Each price page's date is the day its prices last
    changed, which is the only date search engines trust."""
    def urlset(rows):
        lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
        for loc, lastmod in rows:
            lm = f"<lastmod>{lastmod}</lastmod>" if lastmod else ""
            lines.append(f"  <url><loc>{SITE}/{loc}</loc>{lm}</url>")
        lines.append("</urlset>")
        return "\n".join(lines) + "\n"

    # One line per page: if a page is listed twice (e.g. a brand page that
    # also comes from another builder), keep its newest date.
    best = {}
    for loc, lastmod in entries:
        if loc not in best or (lastmod or "") > (best[loc] or ""):
            best[loc] = lastmod
    entries = list(best.items())
    _write(SITEMAP_PAGES, urlset([(p, None) for p in STATIC_PAGES]))
    _write(SITEMAP_PRICES, urlset(sorted(entries)))
    newest = max((lm for _, lm in entries if lm), default=today.isoformat())
    index = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
             f"  <sitemap><loc>{SITE}/sitemap-pages.xml</loc></sitemap>",
             f"  <sitemap><loc>{SITE}/sitemap-prices.xml</loc><lastmod>{newest}</lastmod></sitemap>",
             "</sitemapindex>"]
    _write(SITEMAP_INDEX, "\n".join(index) + "\n")


def build(models_list, products, today_str):
    """Called from update_deals.py after the models are built."""
    cfg = load_config()
    mode = cfg.get("mode", "off")
    PRICES_DIR.mkdir(exist_ok=True)
    if mode == "off":
        return []
    today = date.fromisoformat(today_str)
    by_id = {p["id"]: p for p in products}
    by_slug = {m["slug"]: m for m in models_list if m["type"] in TYPES}
    passing = [m for m in models_list if m["gate"]["passes"] and m["type"] in TYPES]
    # One product photo per model for the price tables (JPG/PNG first).
    for m in models_list:
        # Men's listings first, then JPG/PNG before WebP.
        pics = sorted(((bool(WOMEN_PHOTO_RX.search(by_id[i].get("name", ""))), by_id[i]["image"].lower().split("?")[0].endswith(".webp"), n, by_id[i]["image"])
                       for n, i in enumerate(m.get("listingIds") or []) if i in by_id and by_id[i].get("image")))
        m["_image"] = pics[0][3] if pics else None
    from seasonal_pages import SEASONAL_SLUGS
    existing = {d.name for d in PRICES_DIR.iterdir()
                if d.is_dir() and d.name not in HUB_TYPES and d.name not in SEASONAL_SLUGS and d.name not in ("brands", "drops", "data", "watch", "best", "compare")}
    if mode == "pilot":
        wanted = cfg.get("pilot", [])
        chosen = [m for m in passing if m["slug"] in wanted]
        missing = sorted(set(wanted) - {m["slug"] for m in chosen})
        if missing:
            print(f"Price pages: pilot model(s) not passing the gate this run, skipped: {', '.join(missing)}")
        hubs = [h for h in cfg.get("hubs", []) if h in HUB_TYPES]
    else:
        chosen = list(passing)
        # Once published, a page stays while its model is still on sale
        # somewhere, so it doesn't flick in and out of Google.
        chosen_slugs = {m["slug"] for m in chosen}
        for slug in existing - chosen_slugs:
            m = by_slug.get(slug)
            if m and m.get("listingIds"):
                chosen.append(m)
        hubs = sorted({TYPES[m["type"]][0] for m in passing})
    noindex = mode != "live"
    built = {m["slug"] for m in chosen}
    changed, price_changed, sitemap = [], [], []
    import brand_pages
    b_pages, t_pages = brand_pages.plan(passing) if mode == "live" else ({}, {})
    BRAND_LINK.clear()
    BRAND_CHIPS.clear()
    for m in passing:
        link = brand_pages.crumb_link(m, t_pages, b_pages)
        if link:
            BRAND_LINK[m["slug"]] = link
    for (b, t), slug in sorted(t_pages.items(), key=lambda x: x[0][0].lower()):
        BRAND_CHIPS.setdefault(t, []).append((b, f"/prices/brands/{slug}/"))
    PAGE_FOR_LISTING.clear()
    import share_cards
    changed_cards = share_cards.build(chosen, built, SITE)
    # Budget guides and comparisons: planned first so model and hub pages can link to them.
    import compare_pages
    cplan = None
    if mode == "live":
        try:
            cplan = compare_pages.plan(passing, built, today)
        except Exception as e:  # never stop the main build
            print(f"Budget/comparison planning skipped: {e}")
            compare_pages.COMPARE_FOR.clear()
            compare_pages.BUDGET_CHIPS.clear()
    import bag_draft
    DRAFTABLE.clear()
    DRAFTABLE.update(m["slug"] for m in passing if bag_draft.draftable(m, built))
    for m in chosen:
        out = build_model_page(Model(m, by_id, today), passing, built, set(hubs), today, noindex)
        if not out:
            continue
        page, data = out
        url = f"/prices/{m['slug']}/"
        data_path = PRICES_DIR / m["slug"] / "data.json"
        old_facts = _facts_only(data_path.read_text(encoding="utf-8")) if data_path.exists() else None
        if _write(PRICES_DIR / m["slug"] / "index.html", page):
            changed.append(url)
        _write(data_path, data)
        if old_facts != _facts_only(data):
            price_changed.append(url)
        sitemap.append((f"prices/{m['slug']}/", last_price_change(m)))
        for lid in m.get("listingIds", []):
            PAGE_FOR_LISTING[lid] = SITE + url
    if mode == "live":
        # A model that has vanished from every retailer: say so plainly
        # rather than leave old prices up.
        for slug in existing - built:
            old = PRICES_DIR / slug / "index.html"
            if old.exists() and "none of the UK retailers we track has" not in old.read_text(encoding="utf-8"):
                name = re.search(r"<h1>(.*?) price UK</h1>", old.read_text(encoding="utf-8"))
                try:
                    noun = json.loads((PRICES_DIR / slug / "data.json").read_text(encoding="utf-8")).get("type")
                except (OSError, ValueError):
                    noun = None
                hub = next((v[0] for v in TYPES.values() if v[2] == noun), "")
                _write(old, retired_page(slug, html.unescape(name.group(1)) if name else slug.replace("-", " ").title(), hub, today))
                changed.append(f"/prices/{slug}/")
    INDEX_FALLBACK.clear()
    for h in hubs:
        if not _index_photo(f"/prices/{h}/"):
            ms = sorted((m for m in passing if TYPES[m["type"]][0] == h), key=lambda m: -m.get("listingCount", 0))
            for m in ms:
                img = next((by_id[i]["image"] for i in m.get("listingIds", []) if i in by_id and by_id[i].get("image")), None)
                if img:
                    INDEX_FALLBACK[f"/prices/{h}/"] = img
                    break
    for h in hubs:
        if h in GUIDE_HUBS:
            import sets_pages
            page = sets_pages.build_guide(h, models_list, passing, built, by_id, today, noindex)
        else:
            page = build_hub_page(h, passing, built, hubs, today, noindex)
        if page and _write(PRICES_DIR / h / "index.html", page):
            changed.append(f"/prices/{h}/")
        hub_models = [m for m in passing if TYPES[m["type"]][0] == h]
        sitemap.append((f"prices/{h}/", max((last_price_change(m) or "") for m in hub_models) or None))
    seasonal_links = []
    clothing_links = []
    brand_counts = {}
    if mode == "live":
        b_changed, b_sitemap, brand_counts = brand_pages.build(passing, built, today, b_pages, t_pages)
        changed += b_changed
        sitemap += b_sitemap
        import seasonal_pages
        picks_ok = [m for m in passing if m["type"] not in NOT_IN_PICKS]
        s_changed, s_sitemap, seasonal_links = seasonal_pages.build(picks_ok, built, products, today)
        changed += s_changed
        sitemap += s_sitemap
        import winter_page
        w_changed, w_sitemap = winter_page.build(passing, built, products, today)
        changed += w_changed
        sitemap += w_sitemap
        if w_sitemap:
            seasonal_links.append(("/prices/winter-golf/", "Winter golf gear", "Waterproofs, thermals and gloves at live prices"))
        try:
            import clothing_pages
            c_changed, c_sitemap, clothing_links = clothing_pages.build(products, today)
            changed += c_changed
            sitemap += c_sitemap
        except Exception as e:  # never stop the main build
            print(f"Clothing guides skipped: {e}")
        try:
            import email_lookup
            email_lookup.build(products, passing, built)
        except Exception as e:  # never stop the main build
            print(f"Email lookup skipped: {e}")
        import drops_page
        d_changed, d_sitemap, _ = drops_page.build(passing, built, today,
                                                   {p["id"]: p["image"] for p in products if p.get("image")})
        changed += d_changed
        sitemap += d_sitemap
        try:
            import social_feed
            social_feed.build([m for m in passing if m["type"] not in NOT_IN_PICKS], built, products, today)
        except Exception as e:  # never stop the main build
            print(f"Social feed skipped: {e}")
        import home_deals
        home_deals.build(passing, built, products, today)
        import home_pulse
        home_pulse.build(passing, built, today)
        import most_compared
        most_compared.build(passing, built, products, today)
        import open_data
        o_changed, o_sitemap = open_data.build(passing, built, today)
        changed += o_changed
        sitemap += o_sitemap
        try:
            import fourball_pages
            f_changed, _ = fourball_pages.build()
            changed += f_changed
            sitemap.append(("fourball/", None))
        except Exception as e:  # never stop the main build
            print(f"Fourball pages skipped: {e}")
        if cplan:
            try:
                c_changed, c_sitemap = compare_pages.build(cplan, by_id, today)
                changed += c_changed
                sitemap += c_sitemap
            except Exception as e:  # never stop the main build
                print(f"Budget/comparison pages skipped: {e}")
        try:
            import par_price
            changed += par_price.build(passing, built, today)
            sitemap += [("play/", None), ("play/par-price/", None), ("play/leagues/", None)]
        except Exception as e:  # never stop the main build
            print(f"Par Price skipped: {e}")
        try:
            import bag_draft
            changed += bag_draft.build(passing, built, today)
            sitemap.append(("play/draft/", None))
        except Exception as e:  # never stop the main build
            print(f"Bag Draft skipped: {e}")
        try:
            import higher_lower
            changed += higher_lower.build(passing, built, today)
            sitemap.append(("play/higher-or-lower/", None))
        except Exception as e:  # never stop the main build
            print(f"Higher or Lower skipped: {e}")
        try:
            import society
            changed += society.build()
            if society.LAUNCHED:
                sitemap += [("societies/", None), ("societies/hq/", None), ("societies/find/", None), ("societies/awards/", None), ("societies/clubs/", None)]
                import society_guides
                sitemap += [(u, None) for u in society_guides.SITEMAP]
                sitemap += [(u, None) for u in society.COUNTY_URLS]
        except Exception as e:  # never stop the main build
            print(f"Society HQ skipped: {e}")
        try:
            import my_clubhouse
            changed += my_clubhouse.build()
        except Exception as e:  # never stop the main build
            print(f"My Clubhouse skipped: {e}")
        try:
            import demand_index
            dm_changed, dm_sitemap = demand_index.build(passing, built, today)
            changed += dm_changed
            sitemap += dm_sitemap
        except Exception as e:  # never stop the main build
            print(f"Demand Index skipped: {e}")
        import price_watch
        w_changed, w_sitemap, has_watch = price_watch.build(passing, built, today)
        changed += w_changed
        sitemap += w_sitemap
        seasonal_links = [("/prices/drops/", "Price drops today", "Genuine drops only, updated every 6 hours"),
                          ("/price-check.html", "Is this a good price?", "Check any price against our own history")] + list(seasonal_links) \
            + ([("/prices/watch/", "UK golf price watch", "Monthly: what got cheaper, and what didn’t")] if has_watch else []) \
            + [("/prices/data/", "Open price data", "Free CSV downloads, updated every 6 hours")]
    if _write(PRICES_DIR / "index.html", build_index_page(passing, hubs, today, noindex, seasonal_links, brand_counts, clothing_links)):
        changed.append("/prices/")
    sitemap.append(("prices/", max((lm or "" for _, lm in sitemap), default=None) or None))
    if mode == "live":
        forwarded = forward_old_product_pages(models_list, products, built)
        if forwarded:
            print(f"Old product pages: {forwarded} forwarding page(s) updated.")
        write_sitemaps(sitemap, today)
        # Tell Bing and the other IndexNow engines about pages whose prices
        # changed (sent after the files are published).
        urls = set(price_changed + ([f"/prices/{h}/" for h in hubs] + ["/prices/", "/prices/drops/"]
                                    if price_changed else []))
        # Plus the other public pages this run actually changed (games,
        # societies, guides), and any one-off list in data/indexnow-once.txt
        # (deleted once read, so each list is sent a single time).
        urls |= {u for u in changed if u.endswith("/") and not u.startswith(("/prices/", "/data/", "/products/", "/wishlist/", "/societies/prize/"))}
        # Monday's first run: re-send the main pages (deal tools, games,
        # societies...), so Bing keeps them fresh even when only their
        # wording changed through an upload.
        now = datetime.now(timezone.utc)
        if now.weekday() == 0 and now.hour < 6:
            core = ROOT / "sitemap-pages.xml"
            if core.exists():
                urls |= {u.replace(SITE, "") for u in re.findall(r"<loc>([^<]+)</loc>", core.read_text())}
            urls |= {"/play/", "/societies/", "/fourball/", "/demand/", "/prices/black-friday/", "/prices/golf-gifts/"}
        once = ROOT / "data" / "indexnow-once.txt"
        if once.exists():
            urls |= {u.strip() for u in once.read_text().splitlines() if u.strip().startswith("/")}
            once.unlink()
        urls = sorted(urls)
        INDEXNOW_LIST.write_text("\n".join(SITE + u for u in urls) + ("\n" if urls else ""))
    print(f"Price pages ({mode}): {len(built)} model page(s), {len(hubs)} hub(s); {len(changed)} page file(s) changed, "
          f"{len(price_changed)} with new prices.")
    return changed
