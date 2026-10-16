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
    r"club glove",   # Titleist's travel-bag range, not a glove
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
    "wind shirt": ("apparel", "jacket"), "wind breaker": ("apparel", "jacket"), "rain shirt": ("apparel", "jacket"),
    "rain top": ("apparel", "jacket"), "waterproof top": ("apparel", "jacket"), "windproof top": ("apparel", "jacket"),
    "wind top": ("apparel", "jacket"), "romper": ("apparel", "dress"), "jumpsuit": ("apparel", "dress"),
    "overshirt": ("apparel", "jacket"), "shacket": ("apparel", "jacket"), "down shirt": ("apparel", "jacket"),
    "shirt jacket": ("apparel", "jacket"),
    "compression sleeve": ("apparel", "base-layer"), "compression sleeves": ("apparel", "base-layer"),
    "sleeves": ("apparel", "base-layer"), "arm sleeves": ("apparel", "base-layer"),
    "baseball cap": ("apparel", "cap"), "dad hat": ("apparel", "cap"), "trucker cap": ("apparel", "cap"),
    "compression vest": ("apparel", "base-layer"), "base layer vest": ("apparel", "base-layer"),
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
    "traveler": ("accessories", "travel"), "traveller": ("accessories", "travel"), "duffel": ("accessories", "travel"),
    "rolling duffle bag": ("accessories", "travel"), "rolling duffel bag": ("accessories", "travel"),
    "ball marker": ("accessories", "accessories"), "ball markers": ("accessories", "accessories"),
    "marker": ("accessories", "accessories"), "holder": ("accessories", "accessories"), "clip": ("accessories", "accessories"),
    "brush": ("accessories", "accessories"), "cleaner": ("accessories", "accessories"),
}
_WORDS = sorted(TYPE_WORDS, key=len, reverse=True)
TYPE_RX = re.compile(r"(?<![a-z0-9])(?:" + "|".join(re.escape(w) for w in _WORDS) + r")(?![a-z0-9])", re.I)

# A few words are too vague to overrule what the retailer said on their own.
WEAK = {"short", "sweat", "cap", "hat", "clip", "holder", "brush", "cleaner", "marker", "ball marker", "ball markers",
        "shirt", "shirts", "tee", "tees"}
# "Opti Grip" and "Thermal Grip" are gloves: a glove is never moved to grips.
NEVER = {("glove", "grip")}
# Words that can retype clothing but never pull an accessory into clothing
# ("Trolley Rear Wheel Sleeves" are not arm sleeves).
NO_CROSS = {"sleeves"}


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


# ---------------------------------------------------------------- golf balls
# The Golf Balls section had launch monitors "with free balls", rescues,
# putters, a rangefinder, stand bags, practice nets and training aids in it,
# because retailers filed them under balls. Judge each by its own name: the
# main product is the part before " - ", "with", "+" or "&" (so "Launch
# Monitor + 3 Golf Balls" is a launch monitor).
BALL_RX = re.compile(r"\b(balls?|dozen|pro ?v ?1x?|tp5x?|chrome (soft|tour)|z-?star|tour b|society pack)\b", re.I)
MAIN_CUT_RX = re.compile(r"\s(?:with|\+|&|incl\.?|including)\s|\bfree\b", re.I)   # not "plus": "Distance Plus" is a ball
# (pattern, category, icon, needs a real club price). Checked in order.
BALL_MOVES = [
    (r"launch monitor|simulator", "accessories", "launch-monitor", False),
    (r"range ?r?finder|rangerfinder", "accessories", "rangefinder", False),
    (r"gps watch|golf watch", "accessories", "gps-watch", False),
    (r"tracking|club tags?|tracker|game improvement pack", "accessories", "sensor", False),
    (r"\b(rescue|hybrid)\b", "hybrid", None, True),
    (r"\b(putter|mallet)\b|\b2-ball\b|\bptm", "putter", None, True),   # Odyssey "2-Ball" putters
    (r"\bdriver\b", "driver", None, True),
    (r"stand ?bag|cart ?bag|carry ?bag|golf bag", "bag", "golf-bag", False),
    (r"\bnets?\b|\bcage\b|enclosure", "accessories", "enclosure", False),
    (r"putting mat|putt matt?|\bmatt?\b|turf|sand pad", "accessories", "mat", False),
    (r"alignment (rods?|sticks?|stix|tool)|drill.?stix", "accessories", "alignment-sticks", False),
    (r"pick ?-?up|clikka|retriever|ball tube", "accessories", "ball-retriever", False),
    (r"trainer|training aid|mirror|returner|putting cup|hoops|bunker buddy|swing solution|smart ?(golf )?ball",
     "accessories", "accessories", False),
]
BALL_MOVES = [(re.compile(rx, re.I), c, i, club) for rx, c, i, club in BALL_MOVES]


def ball_main_product(name):
    head = (name or "").split(" - ")[0]
    return MAIN_CUT_RX.split(head)[0]


def fix_balls(products):
    changes = []
    for p in products:
        if p.get("category") != "ball":
            continue
        main = ball_main_product(p.get("name"))
        target = None
        for rx, cat, icon, club in BALL_MOVES:
            if rx.search(main):
                if club and (p.get("salePrice") or 0) < 40:
                    continue
                target = (cat, icon)
                break
        if not target and not BALL_RX.search(main):
            target = ("accessories", "accessories")   # kits, gift sets, scorecards
        if not target:
            continue
        old = ("ball", p.get("icon"))
        p["category"] = target[0]
        if target[1]:
            p["icon"] = target[1]
        else:
            p.pop("icon", None)
        changes.append((p.get("id"), p.get("name"), old, target))
    return changes


def fix_types(products, classify_audience=None):
    """Corrects category/icon on clothing and accessory listings whose own
    name clearly says they're something else. Returns a list of
    (id, name, old, new) for the run log and the review report."""
    changes = fix_balls(products)
    apparel_icons = {icon for c, icon in TYPE_WORDS.values() if c == "apparel"}
    for p in products:
        cat = p.get("category")
        # Travel bags filed as golf bags ("Club Glove Rolling Duffel Bag").
        if cat == "bag":
            got = name_type(p.get("name"))
            if got and got[1] == "travel":
                changes.append((p.get("id"), p.get("name"), (cat, p.get("icon")), ("accessories", "travel")))
                p["category"], p["icon"] = "accessories", "travel"
            continue
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
        if word in NO_CROSS and new_cat != cat:
            continue
        p["category"], p["icon"] = new_cat, new_icon
        if classify_audience and p.get("audience") != "Junior":
            p["audience"] = classify_audience(p.get("name", ""), new_icon)
        changes.append((p.get("id"), p.get("name"), old, (new_cat, new_icon)))
    return changes
