"""Second opinion on each clothing and accessory listing's type, judged by
the product's own name (added Oct 2026).

Why: guess_icon() in update_deals.py checks a fixed list of words against
the name AND the retailer's category label, and the first word in the list
wins. So a "Golf Hoodie" filed by a retailer under "Golf Shirts" became a
polo, "Blue Tees Player Go Pack" (a rangefinder) and "adidas 1st Tee Duffle
Bag" became tees, and polos sold through accessories feeds sat in
Accessories.

How this works: take the name before " - " (the part after it is usually
colour and size), drop brand names and phrases that only look like product
words ("Blue Tees", "short sleeve"), then find the product word that comes
LAST, because that's the word naming the item: "FootJoy HydroLite X Golf
Hoodie" is a hoodie, "Puma Cloudspun Wheels Polo Shirt" is a polo.

Only clothing and accessory listings are touched, and only when the name
clearly says what the item is. Clubs, balls, bags and shoes are left alone.
Runs on the whole catalogue every pipeline run, so new listings are fixed
too.
"""
import re

# Phrases that look like product words but aren't the product. Removed
# from the name before matching.
FALSE_FRIENDS = [
    r"blue tees", r"1st tee", r"first tee", r"tee time", r"tee to green", r"tee-to-green",
    r"short[ -]sleeve", r"long[ -]sleeve", r"cap[ -]sleeve", r"sleeveless",
    r"galvin green", r"tour edge", r"sun mountain", r"big max", r"under armour",
    r"golf pride", r"lamkin grip", r"bag boy", r"bagboy", r"shot scope", r"hat trick",
    r"glove it", r"towel ring", r"polo ralph lauren", r"ralph lauren polo",
    r"belt loop", r"belt clip", r"with belt", r"\+ ?belt", r"short game", r"shorts? game",
]
FALSE_FRIENDS_RX = re.compile(r"\b(?:" + "|".join(FALSE_FRIENDS) + r")\b", re.I)

# word -> (category, icon). Longer phrases are listed so they win over
# their last word ("bucket hat" over "hat", "sweatshirt" over "shirt").
TYPE_WORDS = {
    # clothing
    "polo": ("apparel", "polo"), "polos": ("apparel", "polo"), "polo shirt": ("apparel", "polo"),
    "shirt": ("apparel", "polo"), "shirts": ("apparel", "polo"), "t-shirt": ("apparel", "polo"), "tee shirt": ("apparel", "polo"),
    "golf tee shirt": ("apparel", "polo"), "lisle": ("apparel", "polo"), "pique": ("apparel", "polo"), "mock neck": ("apparel", "polo"),
    "trouser": ("apparel", "trousers"), "trousers": ("apparel", "trousers"), "pant": ("apparel", "trousers"),
    "pants": ("apparel", "trousers"), "jogger": ("apparel", "trousers"), "joggers": ("apparel", "trousers"),
    "chino": ("apparel", "trousers"), "chinos": ("apparel", "trousers"), "trackies": ("apparel", "trousers"),
    "track pants": ("apparel", "trousers"), "leggings": ("apparel", "trousers"),
    "short": ("apparel", "shorts"), "shorts": ("apparel", "shorts"),
    "skort": ("apparel", "skort"), "skorts": ("apparel", "skort"), "skirt": ("apparel", "skort"),
    "dress": ("apparel", "dress"), "golf suit": ("apparel", "suit"), "hoodie suit": ("apparel", "suit"), "rain suit": ("apparel", "suit"), "waterproof suit": ("apparel", "suit"),
    "jacket": ("apparel", "jacket"), "smock": ("apparel", "jacket"), "anorak": ("apparel", "jacket"), "parka": ("apparel", "jacket"),
    "gilet": ("apparel", "jacket"), "vest": ("apparel", "jacket"), "slipover": ("apparel", "jacket"),
    "sweater": ("apparel", "jacket"), "jumper": ("apparel", "jacket"), "pullover": ("apparel", "jacket"),
    "cardigan": ("apparel", "jacket"), "crewneck": ("apparel", "jacket"), "crew neck": ("apparel", "jacket"),
    "sweatshirt": ("apparel", "jacket"), "sweat": ("apparel", "jacket"), "fleece": ("apparel", "jacket"),
    "windshirt": ("apparel", "jacket"), "windbreaker": ("apparel", "jacket"), "midlayer": ("apparel", "jacket"),
    "mid layer": ("apparel", "jacket"), "mid-layer": ("apparel", "jacket"), "1/4 zip": ("apparel", "jacket"),
    "quarter zip": ("apparel", "jacket"), "1/2 zip": ("apparel", "jacket"), "half zip": ("apparel", "jacket"),
    "full zip": ("apparel", "jacket"), "zip top": ("apparel", "jacket"), "golf top": ("apparel", "jacket"),
    "hoodie": ("apparel", "hoodie"), "hoody": ("apparel", "hoodie"), "hooded top": ("apparel", "hoodie"),
    "base layer": ("apparel", "base-layer"), "baselayer": ("apparel", "base-layer"),
    "snood": ("apparel", "base-layer"), "neck warmer": ("apparel", "base-layer"), "neckwarmer": ("apparel", "base-layer"),
    "cap": ("apparel", "cap"), "caps": ("apparel", "cap"), "visor": ("apparel", "cap"), "hat": ("apparel", "cap"),
    "bucket hat": ("apparel", "cap"), "beanie": ("apparel", "cap"), "bobble hat": ("apparel", "cap"), "headband": ("apparel", "cap"),
    "belt": ("apparel", "belt"), "sock": ("apparel", "socks"), "socks": ("apparel", "socks"),
    "sunglasses": ("apparel", "sunglasses"), "sunglass": ("apparel", "sunglasses"),
    # accessories
    "glove": ("accessories", "glove"), "gloves": ("accessories", "glove"), "mitt": ("accessories", "glove"),
    "mitts": ("accessories", "glove"), "mitten": ("accessories", "glove"), "mittens": ("accessories", "glove"),
    "tee": ("accessories", "tee"), "tees": ("accessories", "tee"), "tee pegs": ("accessories", "tee"), "tee peg": ("accessories", "tee"),
    "towel": ("accessories", "towel"), "umbrella": ("accessories", "umbrella"), "sunbrella": ("accessories", "umbrella"),
    "headcover": ("accessories", "headcover"), "headcovers": ("accessories", "headcover"), "head cover": ("accessories", "headcover"),
    "grip": ("accessories", "grip"), "grips": ("accessories", "grip"),
    "divot tool": ("accessories", "divot-tool"), "pitchfork": ("accessories", "divot-tool"), "pitch fork": ("accessories", "divot-tool"),
    "repair tool": ("accessories", "divot-tool"),
    "alignment sticks": ("accessories", "alignment-sticks"), "alignment stick": ("accessories", "alignment-sticks"),
    "rangefinder": ("accessories", "rangefinder"), "range finder": ("accessories", "rangefinder"),
    "gps watch": ("accessories", "gps-watch"), "golf watch": ("accessories", "gps-watch"),
    "push cart": ("accessories", "pushcart"), "pushcart": ("accessories", "pushcart"), "trolley": ("accessories", "pushcart"),
    "launch monitor": ("accessories", "launch-monitor"), "simulator": ("accessories", "launch-monitor"),
    "putting mat": ("accessories", "mat"), "hitting mat": ("accessories", "mat"), "practice mat": ("accessories", "mat"),
    "pouch": ("accessories", "pouch"), "valuables pouch": ("accessories", "pouch"),
    "travel cover": ("accessories", "travel"), "travel bag": ("accessories", "travel"), "duffle": ("accessories", "travel"),
    "duffle bag": ("accessories", "travel"), "duffel bag": ("accessories", "travel"), "holdall": ("accessories", "travel"),
    "backpack": ("accessories", "travel"), "kit bag": ("accessories", "travel"), "boot bag": ("accessories", "travel"),
    "ball marker": ("accessories", "accessories"), "ball markers": ("accessories", "accessories"),
    "marker": ("accessories", "accessories"), "holder": ("accessories", "accessories"), "clip": ("accessories", "accessories"),
    "brush": ("accessories", "accessories"), "cleaner": ("accessories", "accessories"),
}
_WORDS = sorted(TYPE_WORDS, key=len, reverse=True)
TYPE_RX = re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in _WORDS) + r")(?![a-z0-9])", re.I)

# A few words are too vague to overrule what the retailer said on their own.
WEAK = {"short", "sweat", "cap", "hat", "clip", "holder", "brush", "cleaner", "marker", "ball marker", "ball markers",
        "vest", "shirt", "shirts", "tee", "tees"}
# "Opti Grip" and "Thermal Grip" are gloves: a glove is never moved to grips.
NEVER = {("glove", "grip")}


def name_type(name):
    """(category, icon, word) from the product's own name, or None if the
    name doesn't clearly say what it is."""
    base = (name or "").split(" - ")[0]
    base = re.sub(r"\([^)]*\)", " ", base)          # "(Rangefinder, Tags, Towel)" lists contents
    text = FALSE_FRIENDS_RX.sub(" ", base.lower())
    best = None
    for m in TYPE_RX.finditer(text):
        word = m.group(0).lower()
        key = (m.end(), len(word))
        if best is None or key > best[0]:
            best = (key, word)
    if not best:
        return None
    word = best[1]
    cat, icon = TYPE_WORDS[word]
    return cat, icon, word


def fix_types(products, classify_audience=None):
    """Corrects category/icon on clothing and accessory listings whose own
    name clearly says they're something else. Returns a list of
    (id, name, old, new) for the run log and the review report."""
    changes = []
    apparel_icons = {icon for c, icon in TYPE_WORDS.values() if c == "apparel"}
    for p in products:
        cat = p.get("category")
        if cat not in ("apparel", "accessories"):
            continue
        # Clothing that a retailer filed in its accessories feed (T-shirts
        # like "Nike Golf Tee" already typed as tops): move it to Apparel.
        named = name_type(p.get("name"))
        # A single "Tee" already typed as a top is a T-shirt ("Nike Golf Tee"),
        # not a golf tee; "Tees" (plural) stays with the golf tees.
        tshirt = named and named[2] == "tee" and p.get("icon") == "polo"
        if cat == "accessories" and p.get("icon") in apparel_icons and (tshirt or not (named and named[0] == "accessories")):
            old = (cat, p.get("icon"))
            p["category"] = cat = "apparel"
            changes.append((p.get("id"), p.get("name"), old, (cat, p.get("icon"))))
        got = name_type(p.get("name"))
        if not got:
            # Typed as tees only because of a brand or phrase ("Blue Tees
            # Player Go Pack", "1st Tee ..."): drop to the general bucket.
            if p.get("icon") == "tee" and cat == "accessories" and FALSE_FRIENDS_RX.search(p.get("name") or ""):
                old = (cat, p.get("icon"))
                p["icon"] = "accessories"
                changes.append((p.get("id"), p.get("name"), old, (cat, "accessories")))
            continue
        new_cat, new_icon, word = got
        old = (cat, p.get("icon"))
        if old == (new_cat, new_icon):
            continue
        # A vague word ("cap", "short", "tee") only fills a gap or confirms
        # the same section; it never moves a listing that already has a
        # specific type from its retailer.
        if word in WEAK and p.get("icon") not in (None, "accessories") and new_cat == cat:
            continue
        if word in WEAK and new_cat != cat:
            continue
        if (p.get("icon"), new_icon) in NEVER:
            continue
        p["category"], p["icon"] = new_cat, new_icon
        if classify_audience and p.get("audience") != "Junior":
            p["audience"] = classify_audience(p.get("name", ""), new_icon)
        changes.append((p.get("id"), p.get("name"), old, (new_cat, new_icon)))
    return changes
