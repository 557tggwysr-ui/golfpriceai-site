"""
GolfPrice AI: catalogue clean-up and model grouping.

Called from update_deals.py on every scheduled run. Three jobs:

1. audit_categories(): self-healing category fixes applied to the whole
   catalogue every run (shaft adapters filed as drivers, polo shirts filed
   as putters, "No Headcover" ex-demo clubs filed as accessories, and so on).
   Every change is logged so it can be reviewed, and nothing is deleted.

2. drop_unpriced(): removes listings with a £0 (or negative) price. These are
   retailer feed rows for custom-fit items with no real price; left in, they
   would be recorded in price history as a fake 100% "drop".

3. build_models(): groups individual retailer listings into one record per
   real-world model (e.g. every loft, flex, hand and retailer of the
   "TaylorMade Qi35 Driver"), with a model-level daily price history, a list
   of what caused each change (a genuine price cut, a price rise, or a
   cheaper listing simply appearing), an honest verdict, and the quality
   gate that decides whether the model earns a public price page.

Output: data/models.json (used to build the price pages) and
data/model-review.json (a short weekly check-list of uncertain groupings
and every category fix made this run).
"""

import json
import re
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MODELS_FILE = DATA_DIR / "models.json"
REVIEW_FILE = DATA_DIR / "model-review.json"
ALIASES_FILE = DATA_DIR / "model-aliases.json"

CLUB_CATS = {"driver", "wood", "hybrid", "irons", "wedge", "putter"}
ALL_CLUB_CATS = CLUB_CATS | {"sets"}

# Quality gate (see the SEO spec, section "Quality gate").
GATE_MIN_HISTORY_DAYS = 30
GATE_SINGLE_RETAILER_DAYS = 60
GATE_MIN_LISTINGS_MULTI = 3
GATE_MIN_LISTINGS_SINGLE = 8
ACCESSORY_MIN_PRICE = 100.0

PREOWNED_SOURCES = {"awin-callawaypreowned"}
USED_CONDITIONS = {"Preowned", "Used", "Very Good", "Average", "Good", "Like New"}

# ----------------------------------------------------------------------
# 1. Category audit
# ----------------------------------------------------------------------

APPAREL_RX = re.compile(
    r"\b(crew ?neck|polo shirt|polo|baseball cap|jumper|sweater|jacket|gilet|hoodie|"
    r"trousers|shorts|skort|beanie|socks|mid ?layer|quarter zip|1/4 zip|pullover)\b",
    re.I,
)
# Words that always mean "not a club", even when the name also carries club
# details (e.g. "Titleist Driver Adapter Right Hand/Left Hand .335").
ACCESSORY_STRONG_RX = re.compile(
    r"\b(adapter|adaptor|weight kit|wrench|ferrule|umbrella holder|umbrella|"
    r"tee set|tee combo|cleat)\b",
    re.I,
)
ACCESSORY_RX = re.compile(
    r"\b(adapter|adaptor|weight kit|wrench|ferrule|umbrella holder|umbrella|"
    r"tee set|tee combo|tees|cleat|spike|headcover only|head ?cover)\b",
    re.I,
)
NO_COVER_RX = re.compile(r"\b(no (head ?)?covers?|without (head ?)?cover)\b", re.I)
CLUB_SPEC_RX = re.compile(
    r"(\d+(\.\d+)?\s?(\*|°|deg\b))|\b(stiff|regular|senior|x-?stiff|extra stiff|lite flex|"
    r"ladies flex|right hand|left hand|ex demo|ex-demo|pre ?owned|\d{2}(\.\d)?\")",
    re.I,
)
CLUB_TYPE_WORDS = [
    (re.compile(r"\bputter\b", re.I), "putter"),
    (re.compile(r"\bwedge\b", re.I), "wedge"),
    (re.compile(r"\b(hybrid|rescue|utility wood)\b", re.I), "hybrid"),
    (re.compile(r"\b(fairway wood|fairway|\d wood)\b", re.I), "wood"),
    (re.compile(r"\bdriver\b", re.I), "driver"),
    (re.compile(r"\birons?\b", re.I), "irons"),
]


def _club_type_from_name(name):
    for rx, cat in CLUB_TYPE_WORDS:
        if rx.search(name):
            return cat
    return None


def audit_categories(products):
    """Fix misfiled products in place. Returns a list of changes made."""
    changes = []
    for p in products:
        name = p.get("name", "")
        cat = p.get("category")
        new_cat = None

        if cat in ALL_CLUB_CATS and APPAREL_RX.search(name):
            new_cat = "apparel"
        elif cat in ALL_CLUB_CATS:
            stripped = NO_COVER_RX.sub("", name)
            if ACCESSORY_STRONG_RX.search(stripped) or (
                ACCESSORY_RX.search(stripped) and not CLUB_SPEC_RX.search(name)
            ):
                new_cat = "accessories"
        elif cat == "accessories":
            stripped = NO_COVER_RX.sub("", name)
            club = _club_type_from_name(stripped)
            price = p.get("salePrice") or 0
            looks_like_club = bool(NO_COVER_RX.search(name) or CLUB_SPEC_RX.search(name))
            if club and looks_like_club and price >= 30 and not ACCESSORY_RX.search(stripped):
                new_cat = club

        if new_cat and new_cat != cat:
            changes.append({"name": name, "from": cat, "to": new_cat})
            p["category"] = new_cat
            # A club-only field or an accessory icon would now be wrong.
            if new_cat in ("apparel", "accessories"):
                p.pop("loft", None)
                p.pop("flex", None)
            else:
                p.pop("icon", None)

        # Ex-demo / pre-owned clubs listed by new-goods retailers are kept,
        # but marked so they never count as a "new" price on a model page.
        if not p.get("condition") and re.search(r"\b(ex[ -]?demo|pre ?owned)\b", name, re.I):
            p["condition"] = "Ex-demo" if re.search(r"ex[ -]?demo", name, re.I) else "Preowned"

    if changes:
        print(f"Category audit: fixed {len(changes)} misfiled product(s).")
    return changes


def drop_unpriced(products):
    """Remove listings whose price is zero or negative (feed rows with no
    real price). Products with no price at all (None) are left alone: those
    are search-link placeholders handled elsewhere."""
    kept, dropped = [], []
    for p in products:
        price = p.get("salePrice")
        if isinstance(price, (int, float)) and price <= 0:
            dropped.append(p.get("name"))
        else:
            kept.append(p)
    if dropped:
        print(f"Dropped {len(dropped)} listing(s) with a £0 price.")
    return kept, dropped


# ----------------------------------------------------------------------
# 2. Model resolver
# ----------------------------------------------------------------------

BRAND_ALIASES = {
    "cleveland golf": "Cleveland",
    "us kids": "US Kids Golf",
    "u.s. kids golf": "US Kids Golf",
    "u.s. kids": "US Kids Golf",
    "shotscope": "Shot Scope",
    "ping": "Ping",
    "taylormade": "TaylorMade",
    "nike golf": "Nike",
}

STOP_WORDS = {
    "golf", "mens", "men's", "men", "ladies", "lady", "womens", "women's", "women",
    "junior", "juniors", "right", "left", "hand", "handed", "rh", "lh", "graphite",
    "steel", "the", "new", "and", "with", "club", "clubs", "gps", "smart",
    "black", "white", "grey", "gray", "navy", "red", "blue", "green", "silver",
    "gold", "orange", "yellow", "pink", "purple", "cream", "neutral", "titanium",
    "matte", "carbon", "custom", "standard", "edition", "2024", "2025", "2026", "2027",
}

DEFAULT_ALIASES = [
    # [pattern, replacement], applied to lower-cased names before grouping.
    [r"\bstealth ?2\b", "stealth2"],
    [r"\bqi ?35\b", "qi35"],
    [r"\bqi ?10\b", "qi10"],
    [r"\bqi ?4d\b", "qi4d"],
    [r"\bai[- ]one\b", "ai-one"],
    [r"\bai[- ]smoke\b", "ai-smoke"],
    [r"\bds[- ]adapt\b", "ds-adapt"],
    [r"\bpro v1 ?x\b", "pro v1x"],
    [r"\bchrome ?soft\b", "chrome soft"],
    [r"\btp5 ?x\b", "tp5x"],
    [r"\bz[- ]star\b", "z-star"],
    [r"\bshot ?scope\b", "shot scope"],
]


def load_aliases():
    rules = list(DEFAULT_ALIASES)
    if ALIASES_FILE.exists():
        try:
            extra = json.loads(ALIASES_FILE.read_text()).get("rename", [])
            rules.extend(extra)
        except (ValueError, OSError):
            print("model-aliases.json was unreadable; using built-in aliases only.")
    return [(re.compile(a, re.I), b) for a, b in rules]


ACCESSORY_TYPES = [
    (re.compile(r"\brangefinder\b", re.I), "rangefinder", "Rangefinder"),
    (re.compile(r"\bwatch\b", re.I), "gps-watch", "GPS Watch"),
    (re.compile(r"\blaunch monitor\b", re.I), "launch-monitor", "Launch Monitor"),
    (re.compile(r"\b(electric|lithium)\b.*\b(trolley|cart)\b|\b(trolley|cart)\b.*\b(electric|lithium)\b", re.I),
     "electric-trolley", "Electric Trolley"),
]
ACCESSORY_EXCLUDE_RX = re.compile(
    r"\b(charger|cable|battery only|replacement battery|band|strap|screen protector|case|"
    r"cover|holder|mount|bag|seat|accessory|accessories|wheel|clip|umbrella|scorecard)\b",
    re.I,
)

CLUB_TYPE_LABEL = {
    "driver": "Driver", "wood": "Fairway Wood", "hybrid": "Hybrid",
    "irons": "Irons", "wedge": "Wedge", "putter": "Putter",
}
TYPE_WORD_RX = {
    "driver": r"\bdriver\b",
    "wood": r"\b(fairway woods?|fairway|woods?)\b",
    "hybrid": r"\b(hybrids?|rescue|utility)\b",
    "irons": r"\b(irons?|iron set)\b",
    "wedge": r"\bwedges?\b",
    "putter": r"\bputter\b",
}

SINGLE_IRON_RX = re.compile(r"\bsingle\b|\b\d\s?iron\b(?!s)|\b(pw|gw|aw|sw)\b(?!\s?-)", re.I)
IRON_SET_RX = re.compile(r"\b\d\s?-\s?(pw|gw|aw|sw|\d)\b|\birons\b|\bset\b|\b\d+\s?(piece|pc)\b", re.I)

BALL_PACK_RULES = [
    (re.compile(r"\b(4 dozen|48|4 for 3)\b", re.I), 48),
    (re.compile(r"\b(3 dozen|36)\b", re.I), 36),
    (re.compile(r"\b(2 dozen|two dozen|24)\b", re.I), 24),
    (re.compile(r"\b(half dozen|6 ?(ball|pack|pk))\b", re.I), 6),
    (re.compile(r"\b(sleeve|3 ?(ball|pack|pk))\b", re.I), 3),
    (re.compile(r"\b(15 ?(ball|pack|pk))\b", re.I), 15),
    (re.compile(r"\b(dozen|12 ?(ball|pack|pk|balls))\b", re.I), 12),
]
RECYCLED_RX = re.compile(r"\b(rewashed|refurbished|recycled|lake balls?|pearl grade|a[- ]grade|b[- ]grade)\b", re.I)


def ball_pack_size(name, assume_dozen=True):
    """Balls in a pack. UK retailers sell balls by the dozen unless they say
    otherwise, so an unstated pack is taken as 12; build_models then drops
    any listing whose implied per-dozen price looks implausibly low, so a
    mislabelled sleeve can never show up as a fake 'cheapest dozen'."""
    for rx, n in BALL_PACK_RULES:
        if rx.search(name):
            return n
    return 12 if assume_dozen else None


def _brand_of(p):
    raw = (p.get("brand") or "").strip()
    return BRAND_ALIASES.get(raw.lower(), raw) or "Unbranded"


def _base_name(name):
    # Retailers put variant details after " - " (colour, loft, shaft, size).
    base = name.split(" - ")[0]
    base = re.sub(r"\(.*?\)", " ", base)
    return base


def _model_type(p):
    """Returns (group, type_key, type_label) or None if out of scope."""
    cat = p.get("category")
    name = p.get("name", "")
    price = p.get("salePrice") or 0
    if cat in CLUB_CATS:
        if cat == "irons":
            if SINGLE_IRON_RX.search(name) and not re.search(r"\b\d\s?-\s?(pw|gw|aw|sw|\d)\b", name, re.I):
                return ("club", "single-iron", "Single Iron")
            return ("club", "irons", "Irons")
        return ("club", cat, CLUB_TYPE_LABEL[cat])
    if cat == "ball":
        return ("ball", "ball", "Golf Balls")
    if cat == "bag" and price >= ACCESSORY_MIN_PRICE:
        return ("bag", "bag", "Golf Bag")
    if cat == "accessories" and price >= ACCESSORY_MIN_PRICE and not ACCESSORY_EXCLUDE_RX.search(name):
        for rx, key, label in ACCESSORY_TYPES:
            if rx.search(name):
                return ("accessory", key, label)
    return None


def _core_tokens(p, type_key, aliases):
    name = _base_name(p.get("name", "")).lower()
    for rx, rep in aliases:
        name = rx.sub(rep, name)
    brand = _brand_of(p).lower()
    for b in {brand, (p.get("brand") or "").lower()}:
        if b:
            name = re.sub(r"\b" + re.escape(b) + r"\b", " ", name)
    if type_key in TYPE_WORD_RX:
        m = re.search(TYPE_WORD_RX[type_key if type_key != "single-iron" else "irons"], name)
        if m:
            name = name[: m.start()]
    elif type_key == "ball":
        name = re.split(r"\bgolf balls?\b|\bballs?\b", name)[0]
    else:
        name = re.split(r"\b(gps|golf)?\s*(rangefinder|watch|launch monitor|trolley|cart|bag)\b", name)[0] or name
    name = re.sub(r"\b\d+(\.\d+)?\s?(\*|°|deg)", " ", name)
    name = re.sub(r"[^a-z0-9+.\- ]", " ", name)
    tokens = [t.strip(".") for t in name.split()]
    tokens = [t for t in tokens if t and t not in STOP_WORDS and t != "-"]
    # "Stealth Ladies 5 Hybrid": a bare number before the type is the club
    # number, not the model (generations like "Stealth 2" are joined by the
    # alias rules first).
    if type_key in ("wood", "hybrid") and tokens and re.fullmatch(r"(no)?\d", tokens[-1]):
        tokens = tokens[:-1]
    if type_key == "electric-trolley":
        tokens = [t for t in tokens if t not in ("electric", "lithium", "trolley", "cart")]
    # Bags: the bag style word is part of the model ("cart", "stand").
    if type_key == "bag":
        style = re.search(r"\b(cart|stand|tour|carry|pencil|staff)\b", p.get("name", ""), re.I)
        if style and style.group(1).lower() not in tokens:
            tokens.append(style.group(1).lower())
    return tokens[:5]


def _slugify(text):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


# How grouped names should read on the page when the retailers disagree.
DISPLAY_OVERRIDES = {
    "stealth2": "Stealth 2", "qi35": "Qi35", "qi10": "Qi10", "qi4d": "Qi4D",
    "ai-smoke": "Ai Smoke", "ai-one": "Ai-ONE", "ds-adapt": "DS-Adapt",
    "tp5x": "TP5x", "tp5": "TP5", "pro": "Pro", "v1": "V1", "v1x": "V1x",
}


def _display_tokens(tokens, listings):
    """Restore the most common original capitalisation for each token."""
    seen = defaultdict(Counter)
    for p in listings:
        for word in re.findall(r"[A-Za-z0-9+\-]+(?:\.[0-9]+)?", p.get("name", "")):
            seen[word.lower()][word] += 1
    out = []
    for t in tokens:
        if t in DISPLAY_OVERRIDES:
            out.append(DISPLAY_OVERRIDES[t])
        elif seen.get(t):
            out.append(seen[t].most_common(1)[0][0])
        else:
            out.append(t.upper() if re.match(r"^[a-z]{1,3}\d", t) else t.capitalize())
    return out


def _is_new(p):
    if p.get("source") in PREOWNED_SOURCES:
        return False
    if p.get("condition") in USED_CONDITIONS or p.get("condition") == "Ex-demo":
        return False
    if re.search(r"\bused\b\s*$", p.get("name", ""), re.I):
        return False
    if p.get("category") == "ball" and RECYCLED_RX.search(p.get("name", "")):
        return False
    return True


LEFT_RX = re.compile(r"\b(left hand|left-hand|lh)\b", re.I)


def _options(listings, type_key):
    opts = {}
    hands = Counter("Left" if LEFT_RX.search(p["name"]) else "Right" for p in listings)
    if type_key in {"driver", "wood", "hybrid", "irons", "single-iron", "wedge", "putter"}:
        opts["hand"] = dict(hands)
        lofts = Counter(p.get("loft") for p in listings if p.get("loft"))
        flexes = Counter(p.get("flex") for p in listings if p.get("flex"))
        if lofts:
            opts["loft"] = dict(lofts)
        if flexes:
            opts["flex"] = dict(flexes)
    colours = Counter(p.get("colour") for p in listings if p.get("colour"))
    if colours:
        opts["colour"] = dict(colours)
    return opts


# ----------------------------------------------------------------------
# 3. Model-level history, events and verdict
# ----------------------------------------------------------------------

def _daily_series(listings, history, today, multiplier=None):
    """Cheapest price available each day across a model's listings,
    built from each listing's own recorded price changes. Returns a list of
    (date, min_price, listing_name) plus each listing's first-seen date."""
    first_seen = {}
    per_listing = {}
    for p in listings:
        entries = history.get(p["name"]) or []
        if not entries:
            continue
        entries = sorted(entries, key=lambda e: e["date"])
        if multiplier:
            m = multiplier(p)
            if not m:
                continue
            entries = [{"date": e["date"], "price": round(e["price"] * m, 2)} for e in entries]
        first_seen[p["name"]] = date.fromisoformat(entries[0]["date"])
        per_listing[p["name"]] = entries
    if not per_listing:
        return [], first_seen
    start = min(first_seen.values())
    series = []
    cursors = {n: 0 for n in per_listing}
    current = {}
    d = start
    while d <= today:
        ds = d.isoformat()
        for n, entries in per_listing.items():
            i = cursors[n]
            while i < len(entries) and entries[i]["date"] <= ds:
                current[n] = entries[i]["price"]
                i += 1
            cursors[n] = i
        live = [(price, n) for n, price in current.items() if price and price > 0]
        if live:
            price, n = min(live)
            series.append((d, round(price, 2), n))
        d += timedelta(days=1)
    return series, first_seen


def _events(series, first_seen, history):
    events = []
    for (d0, p0, n0), (d1, p1, n1) in zip(series, series[1:]):
        if p1 == p0:
            continue
        if p1 < p0:
            kind = "new_listing" if first_seen.get(n1) == d1 else "price_cut"
        else:
            kind = "price_rise"
        events.append({"date": d1.isoformat(), "from": p0, "to": p1, "kind": kind})
    return events


def _verdict(series, events, current, today):
    if not series:
        return None
    days = len(series)
    if days < GATE_MIN_HISTORY_DAYS:
        return {"label": "tracking", "text": f"We've tracked this for {days} days; a verdict appears at 30 days."}
    prices = [p for _, p, _ in series]
    low, typical = min(prices), statistics.median(prices)
    recent_cut = any(
        e["kind"] == "price_cut" and (today - date.fromisoformat(e["date"])).days <= 30 for e in events
    )
    last = events[-1] if events else None
    if current <= low and (recent_cut or current <= typical * 0.95):
        return {"label": "good", "text": f"Good time to buy: the lowest price in {days} days of tracking."}
    if current >= low * 1.05 and last and last["kind"] == "price_rise":
        return {
            "label": "wait",
            "text": f"Wait if you can: £{current - low:,.2f} above its tracked low of £{low:,.2f}.",
        }
    return {"label": "typical", "text": f"Typical price: in line with {days} days of tracking."}


def _gate(group, new_listings, retailers, history_days, min_price):
    reasons = []
    n, r = len(new_listings), len(retailers)
    if min_price is None or min_price <= 0:
        reasons.append("no valid price")
    if group in ("club",):
        multi_ok = n >= GATE_MIN_LISTINGS_MULTI and r >= 2 and history_days >= GATE_MIN_HISTORY_DAYS
        single_ok = r == 1 and n >= GATE_MIN_LISTINGS_SINGLE and history_days >= GATE_SINGLE_RETAILER_DAYS
    else:
        multi_ok = r >= 2 and history_days >= GATE_MIN_HISTORY_DAYS
        single_ok = r == 1 and history_days >= GATE_SINGLE_RETAILER_DAYS
    if not (multi_ok or single_ok):
        reasons.append(
            f"needs more coverage ({n} listing(s), {r} retailer(s), {history_days} day(s) of history)"
        )
    return {"passes": not reasons, "reasons": reasons}


def build_models(products, price_history, today_str):
    today = date.fromisoformat(today_str)
    history = price_history.get("products", {})
    aliases = load_aliases()

    groups = defaultdict(list)
    meta = {}
    for p in products:
        if p.get("salePrice") is None:
            continue
        t = _model_type(p)
        if not t:
            continue
        group, type_key, type_label = t
        tokens = _core_tokens(p, type_key, aliases)
        brand = _brand_of(p)
        key = f"{brand.lower()}|{type_key}|{' '.join(tokens)}"
        groups[key].append(p)
        meta[key] = (group, type_key, type_label, brand, tokens)

    models, review = [], []
    for key, listings in groups.items():
        group, type_key, type_label, brand, tokens = meta[key]
        new = [p for p in listings if _is_new(p)]
        new_in_stock = [p for p in new if p.get("inStock", True)]
        used = [p for p in listings if not _is_new(p) and p.get("inStock", True)]
        if not new_in_stock:
            continue

        display = " ".join([brand] + _display_tokens(tokens, listings) + [type_label]).strip()
        slug = _slugify(display)

        # Golf balls compare fairly only per dozen.
        def unit_price(p):
            if type_key == "ball":
                size = ball_pack_size(p["name"])
                return round(p["salePrice"] / size * 12, 2) if size else None
            return p["salePrice"]

        priced = [(unit_price(p), p) for p in new_in_stock]
        priced = [(u, p) for u, p in priced if u]
        if type_key == "ball" and len(priced) >= 3:
            med = statistics.median(u for u, _ in priced)
            odd = [p for u, p in priced if u < med * 0.6]
            if odd:
                review.append({"model": " ".join([brand] + tokens), "issue":
                               f"{len(odd)} ball listing(s) priced implausibly low per dozen; excluded until the pack size is confirmed",
                               "listings": len(odd)})
            priced = [(u, p) for u, p in priced if u >= med * 0.6]
        if not priced:
            continue
        min_price, cheapest = min(priced, key=lambda x: x[0])
        retailers = defaultdict(lambda: {"min": None, "count": 0})
        for u, p in priced:
            r = retailers[p["source"]]
            r["count"] += 1
            r["min"] = u if r["min"] is None else min(r["min"], u)

        if type_key == "ball":
            def per_dozen(p):
                size = ball_pack_size(p["name"])
                return 12 / size if size else None
            series, first_seen = _daily_series(new, history, today, per_dozen)
        else:
            series, first_seen = _daily_series(new, history, today)
        events = _events(series, first_seen, history) if series else []
        history_days = len(series) if series else max(
            [(p.get("priceInsight") or {}).get("daysTracked") or 0 for p in new] or [0]
        )
        verdict = _verdict(series, events, cheapest["salePrice"], today) if series else None
        gate = _gate(group, new_in_stock, retailers, history_days, min_price)

        prices = [u for u, _ in priced]
        if not tokens:
            # e.g. "Ben Sayers Electric Trolley": no model name at all, so it
            # may lump different products together. Held back from pages.
            gate["passes"] = False
            gate["reasons"].append("no model name: held back for review")
            review.append({"model": display, "issue": "no model name: held back until an alias names it", "listings": len(listings)})
        elif len(prices) > 1 and max(prices) / min(prices) >= 3:
            review.append({
                "model": display,
                "issue": f"price spread £{min(prices):,.2f} to £{max(prices):,.2f}: may mix different products",
                "listings": len(listings),
            })

        rrp = max((p.get("retailPrice") or 0) for _, p in priced) or None
        models.append({
            "slug": slug,
            "name": display,
            "brand": brand,
            "group": group,
            "type": type_key,
            "unit": "per dozen" if type_key == "ball" else None,
            "minPrice": min_price,
            "minRetailer": cheapest["source"],
            "maxPrice": max(prices),
            "rrp": rrp if rrp and rrp > min_price else None,
            "listingCount": len(new_in_stock),
            "retailers": {s: v for s, v in retailers.items()},
            "options": _options(new_in_stock, type_key),
            "verifiedDrops": sum(1 for p in new_in_stock if (p.get("priceInsight") or {}).get("verifiedDiscount")),
            "preowned": {"count": len(used), "min": min((p["salePrice"] for p in used), default=None)} if used else None,
            "historyDays": history_days,
            "history": [[d.isoformat(), price] for i, (d, price, _) in enumerate(series)
                        if i == 0 or price != series[i - 1][1] or i == len(series) - 1],
            "low": min((p for _, p, _ in series), default=None),
            "high": max((p for _, p, _ in series), default=None),
            "events": events[-20:],
            "verdict": verdict,
            "gate": gate,
            "listingIds": [p["id"] for _, p in sorted(priced, key=lambda x: x[0])],
        })

    # Two different models must never share a page address.
    slug_counts = Counter(m["slug"] for m in models)
    for m in models:
        if slug_counts[m["slug"]] > 1:
            m["slug"] = f"{m['slug']}-{_slugify(m['type'])}"
    models.sort(key=lambda m: (not m["gate"]["passes"], m["group"], m["type"], m["name"]))
    return models, review


def save_models(models, review, category_changes, dropped, today_str):
    passing = [m for m in models if m["gate"]["passes"]]
    MODELS_FILE.write_text(json.dumps({
        "lastUpdated": today_str,
        "count": len(models),
        "passingCount": len(passing),
        "models": models,
    }, separators=(",", ":")))
    REVIEW_FILE.write_text(json.dumps({
        "lastUpdated": today_str,
        "uncertainGroupings": review[:200],
        "categoryFixes": category_changes,
        "droppedUnpriced": dropped,
    }, indent=1))
    by_type = Counter(m["type"] for m in passing)
    print(f"Models: {len(models)} grouped, {len(passing)} pass the page quality gate "
          f"({', '.join(f'{k} {v}' for k, v in sorted(by_type.items()))}).")
    print(f"Model review list: {len(review)} uncertain grouping(s), "
          f"{len(category_changes)} category fix(es), {len(dropped)} unpriced listing(s) dropped.")
