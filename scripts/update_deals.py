"""
GolfPrice AI — automated catalog refresh script.

WHAT THIS DOES
--------------
Runs on a schedule (see .github/workflows/update-deals.yml), pulls current
products from your affiliate networks, and merges them into the full
catalog at data/products.json — adding new products, updating prices on
existing ones (matched by name), and leaving everything else untouched.
The website itself never changes — it just reads whatever is in that file.
This is the "hands-off" pipeline, and it scales to hundreds of products
without any further site changes.

WHY IT USES AFFILIATE NETWORK FEEDS INSTEAD OF SCRAPING RETAILERS DIRECTLY
---------------------------------------------------------------------------
Scraping retailer websites (including Amazon) directly violates their
Terms of Service and risks the account being banned — this script will
never do that, regardless of how tempting a shortcut it might seem. The
networks below give you legitimate, ToS-compliant product + price data
because you're a registered affiliate with them.

This also solves the "wrong photo, dead link" problem for good: every
product a network's feed returns already comes with (a) the retailer's own
licensed product photo and (b) a working, trackable affiliate link baked
in. The front-end (js/app.js, js/shop.js) already prefers a real photo
over the placeholder icon whenever one is present, so nothing else needs
to change on the site itself once real data starts flowing in.

CURRENT STATUS (as of last update)
-----------------------------------
- Amazon: no live price data yet (Product Advertising API unlocks after 3
  tracked sales) — existing Amazon search links in the catalog keep working
  regardless; this script doesn't touch them.
- CJ Affiliate: credentials are set, but no advertiser joined yet — returns
  nothing until that changes.
- AWIN (Clickgolf): LIVE — pulls real prices, stock status, and images
  every run from the Create-a-Feed URL stored in the AWIN_CLICKGOLF_FEED_URL
  repo secret. A product only gets a "was" price and a save % if the feed
  itself reports a genuine discount — nothing is invented.
- AWIN (other retailers): credentials are set, applications pending —
  returns nothing until an AWIN_ADVERTISER_ID secret is added for another
  approved retailer.

SETUP YOU NEED TO DO ONCE MORE THINGS ARE APPROVED (see README.md):
1. Once a CJ advertiser is joined, or another AWIN retailer is approved,
   come back to a Claude chat and the matching fetch_* function below gets
   finished off in a few minutes using the real API/feed docs.
2. Nothing else changes — this script already knows how to merge whatever
   it finds into the live catalog.
"""

import csv
import gzip
import io
import json
import os
import re
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "products.json"

# Accumulates data-quality findings across every fetch_* function in a
# single run (RRP inversions, multi-retailer collisions, price-jump
# anomalies), so main() can print one consolidated report at the end
# instead of scattering it across each function's own output. This never
# affects what gets written to products.json — it's visibility only.
DATA_QUALITY_REPORT = {}
PRICE_HISTORY_FILE = Path(__file__).resolve().parent.parent / "data" / "price-history.json"
STOCK_HISTORY_FILE = Path(__file__).resolve().parent.parent / "data" / "stock-history.json"
INDEX_FILE = Path(__file__).resolve().parent.parent / "data" / "price-index.json"
BUNDLE_FILE = Path(__file__).resolve().parent.parent / "data" / "bundles.json"

# How far back "Deal Score" badges look when deciding whether today's price
# is genuinely the lowest seen, and whether a discount is "verified".
LOOKBACK_DAYS = 90

# Best Time to Buy — a product needs at least this many tracked days
# before its price is stable/volatile enough times to say either way.
MIN_DAYS_FOR_VOLATILITY = 21
# Average days between price changes faster than this = "volatile".
VOLATILE_THRESHOLD_DAYS = 10
# Average days between price changes slower than this = "stable"
# (anything between the two thresholds is "moderate").
STABLE_THRESHOLD_DAYS = 30

# A product that's gone from in-stock to out-of-stock at least this many
# times within the lookback window earns a genuine "sells out fast" signal.
SELLS_OUT_FAST_THRESHOLD = 3

# A same-retailer collision where the highest price is at least this many
# times the lowest is treated as a severe, distinctly-flagged case — most
# likely a genuine bug in the retailer's own feed export (as confirmed for
# Callaway Apex Ti Fusion: £289–£2,339, an ~8x spread, all for the exact
# same real product page) rather than ordinary near-duplicate listings.
SEVERE_VARIANCE_RATIO = 2.5

# A "was" price more than this many times the current sale price is
# treated as implausible rather than a genuine discount — confirmed by a
# real incident this session: Cobra King Tour Irons showed rrp_price
# consistently ~6.15x the real sale_price across every duplicate row
# (£6,993 vs £1,139, £5,994 vs £969, etc.) — an ~84% discount that simply
# isn't real; Clickgolf's own page shows no RRP or discount at all for
# this product. A genuine golf retail discount essentially never exceeds
# ~65-70% off even during clearance, so 3x (a 67% discount) is used as
# the ceiling — anything beyond that is rejected as bad data, not a deal.
MAX_PLAUSIBLE_DISCOUNT_RATIO = 3.0
# Safety cap on entries kept per product, regardless of date range — keeps
# the file bounded even for a product whose price changes unusually often.
MAX_HISTORY_ENTRIES = 120
# How long a stored entry is kept at all before being pruned, independent
# of the lookback window used for badge calculations (a longer raw history
# than the badge lookback is deliberate — useful later for an actual price
# trend chart, even though badges themselves only look at LOOKBACK_DAYS).
MAX_HISTORY_AGE_DAYS = 365

# Your Amazon Associates tracking tag. This is safe to keep in code (not a
# secret) — it's the public tag that appears in every affiliate link anyway.
AMAZON_ASSOCIATE_TAG = "golfpriceai-21"


def amazon_search_link(product_name):
    """Builds a real, working, commission-earning Amazon link for a product
    name. Works today even without the Product Advertising API — it just
    won't carry live pricing until that unlocks."""
    return f"https://www.amazon.co.uk/s?k={quote_plus(product_name)}&tag={AMAZON_ASSOCIATE_TAG}"


def fetch_cj_deals():
    """Pull products from CJ Affiliate's GraphQL Product Search API.

    Needs CJ_API_TOKEN and CJ_CID as repo secrets (already set up).
    IMPORTANT: CJ only returns products from advertisers you've actually
    joined — having API credentials isn't enough on its own. Until at least
    one golf retailer shows as "joined" in your CJ account, this safely
    returns nothing.
    """
    token = os.environ.get("CJ_API_TOKEN")
    cid = os.environ.get("CJ_CID")
    if not token or not cid:
        return []
    # TODO: once you've joined a CJ advertiser, real query looks like:
    #   POST https://ads.api.cj.com/query
    #   Header: Authorization: Bearer <CJ_API_TOKEN>
    #   Body: { "query": "{ products(companyId: \"<CJ_CID>\", keywords: \"golf driver\", limit: 20) { ... } }" }
    # Each result should be mapped into the same shape as items already in
    # products.json: id, name, category, retailPrice, salePrice, savePct,
    # retailerCount, rating, affiliateUrl, image.
    return []


def slugify(name):
    """Turns a product name into a stable, URL-safe id fragment."""
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:60]


def _has_word(text, word):
    """Whole-word match (allowing a trailing plural s/es), not a raw
    substring — "wood" must not match inside "Woodmark" or "Wooden", but
    "sunglass" must still match "sunglasses" and "sock" must still match
    "socks". This was a real bug both ways: raw substring matching filed
    "Woodmark Pullover" into Fairway Woods, and a too-strict word boundary
    (an earlier fix attempt) then failed to match legitimate plurals."""
    return re.search(r"\b" + re.escape(word) + r"(e?s)?\b", text) is not None


# Strong accessory signals that should override even a club-shape match in
# the retailer's own category taxonomy — headcovers, tees, and similar
# small accessories are sometimes cross-listed by retailers under their
# matching club type (e.g. a fairway wood headcover filed under "Fairway
# Woods" on Clickgolf's own site), which would otherwise fool step 1 below.
# "grip" included deliberately: a "Putter Grip" or "Driver Grip" accessory
# is not the club itself, even though the club-shape word appears in the
# name too.
ACCESSORY_OVERRIDE_WORDS = [
    "cover", "protector", "headcover", "divot", "tee", "towel",
    "marker", "brush", "groove", "grip", "pouch", "wheel", "enclosure",
    "tracker", "speaker",
]

CLUB_SHAPE_KEYWORDS = [
    ("putter", "putter"), ("driver", "driver"), ("hybrid", "hybrid"),
    ("fairway", "wood"), ("wood", "wood"), ("wedge", "wedge"),
    ("iron", "irons"),
    # A "chipper" is a specialty short-game club (part putter, part
    # wedge) — closest existing category is wedge. Was previously
    # unmatched entirely, falling through to the generic accessories
    # default.
    ("chipper", "wedge"),
]
GENERAL_KEYWORDS = [
    ("ball", "ball"), ("bag", "bag"),
    ("shoe", "shoes"), ("boot", "shoes"),
    ("trouser", "apparel"), ("pant", "apparel"), ("short", "apparel"),
    ("skort", "apparel"), ("polo", "apparel"), ("jacket", "apparel"),
    ("jogger", "apparel"), ("headwear", "apparel"), ("beanie", "apparel"),
    ("base layer", "apparel"), ("baselayer", "apparel"), ("thermal", "apparel"),
    ("full zip", "apparel"), ("fleece", "apparel"),
    ("lisle", "apparel"), ("pique", "apparel"),
    ("windshirt", "apparel"),
    # Broader catch-all beyond the specific zip phrasings above — catches
    # any remaining "Zip" wording not already covered by a more specific
    # match. Deliberately placed after ball/bag/glove/etc. in this list
    # so a genuine accessory that happens to mention a zip pocket/closure
    # still resolves via its own more specific keyword first.
    ("zip", "apparel"),
    # "Chill Out"/"Chill-Out" turned out to be a generic Clickgolf
    # product-line name used across MULTIPLE brands, not just FootJoy —
    # the old "footjoy chill out" phrase-only match missed every one
    # where another word (e.g. "Mens") sat between the two, or where a
    # different brand used the same line name entirely.
    ("chill out", "apparel"), ("chill-out", "apparel"),
    # A retailer product name that just says "Dozen" (no literal "ball")
    # is, in real golf retail convention, essentially always a dozen golf
    # balls — this was a genuine gap when "ball"/"balls" itself wasn't
    # actually present in the title.
    ("dozen", "ball"),
    ("hoodie", "apparel"), ("cap", "apparel"), ("hat", "apparel"),
    ("glove", "accessories"), ("mitten", "accessories"), ("sock", "apparel"), ("belt", "apparel"),
    ("sunglass", "apparel"), ("rangefinder", "accessories"),
    ("gps", "accessories"), ("watch", "accessories"),
    ("cart", "accessories"), ("umbrella", "accessories"),
    ("headcover", "accessories"),
    ("pullover", "apparel"), ("gilet", "apparel"), ("gillet", "apparel"), ("vest", "apparel"),
    ("slipover", "apparel"), ("windstopper", "apparel"),
    ("quarterzip", "apparel"), ("quarter-zip", "apparel"), ("quarter zip", "apparel"),
    ("1/4 zip", "apparel"), ("1/2 zip", "apparel"),
    ("half zip", "apparel"), ("half-zip", "apparel"),
    ("midlayer", "apparel"), ("mid-layer", "apparel"), ("mid layer", "apparel"),
    ("sweater", "apparel"), ("shirt", "apparel"), ("zip top", "apparel"),
    ("golf top", "apparel"), ("golf suit", "apparel"),
    ("footjoy chill out", "apparel"), ("dress", "apparel"),
    # "sweatershirt" (no space) is a real recurring retailer naming quirk
    # — word-boundary matching correctly won't match "sweater" or "shirt"
    # as fragments fused mid-word, so it needs its own explicit entry.
    ("sweatershirt", "apparel"),
    ("capri", "apparel"), ("skirt", "apparel"),
    ("mat", "accessories"), ("storage", "accessories"),
    ("travel", "accessories"), ("charger", "accessories"),
    ("battery", "accessories"), ("drink holder", "accessories"),
    ("bottle holder", "accessories"), ("simulator", "accessories"),
    ("launch monitor", "accessories"),
]


def guess_category(category_name, merchant_category, name, description=None):
    """Category guess in priority order:

    0. If EITHER the product name OR the retailer's own category taxonomy
       contains a strong "this is a small accessory" signal (cover,
       protector, tee, grip, etc.), trust that over everything else.
       Checking both matters: a retailer might file "SuperStroke Putter
       Grip" with "Grips" only in its own category field, not repeated in
       the product title — checking name alone would miss it and let
       "putter" win instead. Retailers also sometimes file headcovers/tees
       under their matching club type, which this also guards against.
    0.5. A handful of specific two-word combinations that need to beat the
         generic per-word matching (see apply_pre_overrides).
    1. Retailer's own taxonomy text (category_name / merchant_category),
       checked against the full keyword list including club shapes.
    2. The product name, checked against GENERAL_KEYWORDS (apparel/
       accessory nouns) first — an unambiguous word like "cap" or "polo"
       wins even if a club-shape word like "driver" also appears.
    3. Only then does it check the name against CLUB_SHAPE_KEYWORDS.
    4. LAST RESORT ONLY: if nothing above matched anything at all, check
       the retailer's own product description text. Confirmed necessary
       by a real case where "Boots" only appeared in the description,
       never in the name or taxonomy fields — everything above this step
       had already found nothing, so this can only add coverage for
       previously-missed products, never override an already-correct
       classification found by a higher-priority step.

    All matching is whole-word (see _has_word) to avoid substring false
    positives like "wood" inside "Woodmark" or "Wooden".
    """
    name_text = (name or "").lower()
    cat_text = " ".join(f for f in (category_name, merchant_category) if f).lower()
    combined_text = (name_text + " " + cat_text).strip()

    pre = apply_pre_overrides(combined_text)
    if pre:
        return pre

    for word in ACCESSORY_OVERRIDE_WORDS:
        if word == "grip" and _has_word(combined_text, "shoe"):
            # "Grip" is a common marketing term for shoe sole traction
            # (e.g. "enhanced grip technology") — a real golf shoe should
            # stay a shoe, not get swept into Accessories > Grips.
            continue
        if word == "tee" and "tee to green" in combined_text:
            # "Tee to Green" is a real, recurring apparel brand/product
            # line name (confirmed: it was swallowing genuine shirts and
            # polos into Accessories, since "tee" alone reads as "this
            # is a literal golf tee" otherwise).
            continue
        if _has_word(combined_text, word):
            return "accessories"

    if cat_text:
        for keyword, category in CLUB_SHAPE_KEYWORDS + GENERAL_KEYWORDS:
            if _has_word(cat_text, keyword):
                return category

    for keyword, category in GENERAL_KEYWORDS:
        if _has_word(name_text, keyword):
            return category
    for keyword, category in CLUB_SHAPE_KEYWORDS:
        if _has_word(name_text, keyword):
            return category

    # Last resort — see step 4 in the docstring. Only reached if nothing
    # above matched anything at all.
    if description:
        desc_text = description.lower()
        for keyword, category in CLUB_SHAPE_KEYWORDS + GENERAL_KEYWORDS:
            if _has_word(desc_text, keyword):
                return category

    return "accessories"


def apply_pre_overrides(name_text):
    """A handful of specific rules that need to run before the general
    keyword matching, because they combine multiple signals or need to
    beat a keyword that would otherwise fire first. Returns a category
    string, or None if none of these apply."""
    # A "driving hybrid iron" (or similarly named hybrid-style iron) is
    # functionally an iron, not a hybrid — this specific combination beats
    # the generic "hybrid" club-shape match.
    if _has_word(name_text, "hybrid") and _has_word(name_text, "iron"):
        return "irons"

    if _has_word(name_text, "caddie") and _has_word(name_text, "shagger"):
        return "accessories"
    if _has_word(name_text, "ball") and _has_word(name_text, "retriever"):
        return "accessories"
    if "ball bag" in name_text or "ball bags" in name_text:
        return "accessories"

    return None


def apply_post_overrides(name_text, base_category):
    """Rules that depend on knowing what the base category was already
    guessed as, applied after the main guess_category logic runs."""

    # A "set" accessory bundle (e.g. a towel/tee/marker gift set) that
    # would otherwise land in Accessories gets its own Clubs > Sets
    # sub-section instead — deliberately narrow: this does NOT touch
    # genuine "Iron Set" / "Wedge Set" club listings, which are already
    # correctly categorized as irons/wedge by the time this check runs.
    #
    # Also deliberately does NOT touch an item that already has a clear,
    # specific accessory identity (e.g. "Headcover Set (3pc)" is a real
    # bundle of headcovers, not remotely a club set) — confirmed as a
    # genuine mis-fire this session. Only a genuinely generic
    # "accessories gift set" with no specific type signal should move.
    if base_category == "accessories" and _has_word(name_text, "set"):
        has_specific_accessory_signal = any(
            _has_word(name_text, w) for w in ACCESSORY_OVERRIDE_WORDS
        )
        if not has_specific_accessory_signal:
            return "sets"

    # A "putter" mentioned in a ball or apparel listing (rather than a
    # real putter product) should move to the Putters section.
    if base_category in ("ball", "apparel") and _has_word(name_text, "putter"):
        return "putter"

    return base_category


# Sub-type "icon" keywords — these match the exact values used in
# js/groups-config.js's "types" arrays for the Apparel/Accessories hub
# pages. Without one of these set, an apparel/accessories product is
# correctly categorized but invisible on every hub sub-page, since those
# pages filter by icon, not just by the broad category.
ICON_KEYWORDS = [
    # "Cap Sleeve" is a short-sleeve style on a top, not headwear — must
    # be checked before the generic "cap" entry further down (which
    # would otherwise correctly-but-wrongly match the word "cap" inside
    # this phrase and route it to Headwear & Extras instead).
    ("cap sleeve", "polo"),
    ("polo", "polo"), ("shirt", "polo"), ("lisle", "polo"), ("pique", "polo"),
    ("trouser", "trousers"), ("pant", "trousers"), ("jogger", "trousers"),
    ("skort", "skort"), ("skirt", "skort"),
    ("short", "shorts"),
    ("jacket", "jacket"),
    ("hoodie", "hoodie"),
    ("pullover", "jacket"), ("gilet", "jacket"), ("gillet", "jacket"), ("vest", "jacket"),
    ("slipover", "jacket"), ("windstopper", "jacket"),
    ("quarterzip", "jacket"), ("quarter-zip", "jacket"), ("quarter zip", "jacket"),
    ("1/4 zip", "jacket"), ("1/2 zip", "jacket"), ("sweater", "jacket"), ("zip top", "jacket"),
    ("golf top", "jacket"), ("footjoy chill out", "jacket"),
    ("chill out", "jacket"), ("chill-out", "jacket"),
    ("full zip", "jacket"), ("fleece", "jacket"), ("windshirt", "jacket"),
    ("zip", "jacket"),
    ("sweatershirt", "jacket"),
    ("half zip", "jacket"), ("half-zip", "jacket"),
    ("midlayer", "jacket"), ("mid-layer", "jacket"), ("mid layer", "jacket"),
    ("base layer", "base-layer"), ("baselayer", "base-layer"), ("thermal", "base-layer"),
    ("dress", "dress"), ("golf suit", "suit"),
    ("cap", "cap"), ("visor", "cap"), ("hat", "cap"), ("headwear", "cap"), ("beanie", "cap"),
    ("sunglass", "sunglasses"),
    ("belt", "belt"),
    ("sock", "socks"),
    ("gps watch", "gps-watch"), ("golf watch", "gps-watch"),
    ("rangefinder", "rangefinder"), ("range finder", "rangefinder"),
    ("shot tracker", "sensor"), ("arccos", "sensor"), ("tracker", "sensor"),
    ("push cart", "pushcart"), ("pushcart", "pushcart"), ("trolley", "pushcart"),
    ("headcover", "headcover"), ("head cover", "headcover"),
    ("umbrella", "umbrella"),
    # "Sunbrella" is a real premium outdoor-fabric brand name commonly
    # used in golf umbrella product titles (e.g. "Titleist Players
    # Sunbrella Umbrella") — doesn't literally contain the word
    # "umbrella" as a substring, so needed its own entry.
    ("sunbrella", "umbrella"),
    ("divot", "divot-tool"),
    ("alignment stick", "alignment-sticks"),
    ("glove", "glove"), ("mitten", "glove"),
    ("tee", "tee"),
    ("grip", "grip"),
    ("towel", "towel"),
    ("pouch", "pouch"),
    ("wheel", "wheel"),
    ("putting mat", "mat"), ("training mat", "mat"), ("hitting mat", "mat"),
    ("enclosure", "enclosure"), ("net", "enclosure"),
    ("storage", "storage"),
    ("travel", "travel"),
    ("charger", "battery-charger"), ("battery", "battery-charger"),
    ("drink holder", "drink-holder"), ("bottle holder", "drink-holder"),
    ("speaker", "speaker"),
    ("launch monitor", "launch-monitor"), ("simulator", "launch-monitor"),
]


def apply_icon_pre_overrides(name_text):
    """Combo-word icon rules that need both words present, not just one —
    can't be expressed as a single ICON_KEYWORDS entry."""
    if _has_word(name_text, "caddie") and _has_word(name_text, "shagger"):
        return "caddie-shagger"
    if _has_word(name_text, "ball") and _has_word(name_text, "retriever"):
        return "ball-retriever"
    if "ball bag" in name_text or "ball bags" in name_text:
        return "ball-bag"
    return None


BAG_TYPE_KEYWORDS = [
    ("range bag", "range-bag"),
    ("carry bag", "carry-bag"), ("stand bag", "carry-bag"),
    ("shoe bag", "shoe-bag"),
]


def guess_bag_type(category_name, merchant_category, name):
    """Sub-type for the Bags category — Golf Bags / Range Bags / Carry Bags
    / Shoe Bags. Defaults to the general "golf-bag" bucket when nothing
    more specific matches, since most cart/trolley bags won't mention a
    specific sub-type by name."""
    text = " ".join(f for f in (category_name, merchant_category, name) if f).lower()
    for keyword, bag_type in BAG_TYPE_KEYWORDS:
        if keyword in text:
            return bag_type
    return "golf-bag"


def guess_icon(category_name, merchant_category, name, category, description=None):
    """Best-effort sub-type icon for apparel/accessories/bag products.
    Returns None (no icon set) if nothing matches and the category doesn't
    have a catch-all bucket — the product still shows up fine everywhere
    except a specific hub sub-page filter, which is a much smaller miss
    than not showing up on the site at all."""
    if category == "bag":
        return guess_bag_type(category_name, merchant_category, name)
    if category not in ("apparel", "accessories"):
        return None
    text = " ".join(f for f in (category_name, merchant_category, name) if f).lower()
    combo = apply_icon_pre_overrides(text)
    if combo:
        return combo
    for keyword, icon in ICON_KEYWORDS:
        if _has_word(text, keyword):
            return icon
    # Last resort — only reached if nothing above matched at all. Same
    # "can only add coverage, never override" safety property as
    # guess_category's description fallback.
    if description and category == "apparel":
        desc_text = description.lower()
        for keyword, icon in ICON_KEYWORDS:
            if _has_word(desc_text, keyword):
                return icon
    if category == "accessories":
        return "accessories"  # generic catch-all bucket, matches groups-config.js
    return None


# Kept in sync with js/shop.js's KNOWN_BRANDS — same list, same order
# (longest/most-specific phrases first so "Scotty Cameron" matches before
# a shorter accidental collision).
KNOWN_BRANDS = [
    "Scotty Cameron", "Under Armour", "Ben Sayers", "Cleveland Golf",
    "J.Lindeberg", "Tour Edge", "Sun Mountain", "Shot Scope",
    "TaylorMade", "Callaway", "Titleist", "Bridgestone", "Bettinardi",
    "Evnroll", "Mizuno", "Wilson", "Srixon", "Cobra", "Honma", "XXIO",
    "PXG", "Nike", "Adidas", "Puma", "FootJoy", "Ecco", "Oakley",
    "Garmin", "Bushnell", "Motocaddy", "PowaKaddy", "Clicgear", "Ogio",
    "Galvin Green", "Peter Millar", "Aspire", "Odyssey", "Ping",
    "Woodmark", "Longridge", "Hedgehog", "Arccos", "Skechers",
]


def extract_brand(name, feed_brand=None):
    """Prefer a real brand_name value from the feed if the retailer actually
    populated it — but normalized against KNOWN_BRANDS first, since a
    retailer's own feed can use a slightly different form of the same
    real brand (confirmed: Callaway Europe's feed sends "Callaway Golf",
    not "Callaway"). Trusting that verbatim would silently split one real
    brand into two different values — "Callaway" and "Callaway Golf" —
    meaning selecting "Callaway" in the site's Brand filter would miss
    every Callaway Golf-sourced product entirely. Falls back to matching
    against the product name if the feed's brand doesn't match anything
    known, same as before."""
    if feed_brand and feed_brand.strip():
        feed_brand_clean = feed_brand.strip()
        feed_brand_lower = feed_brand_clean.lower()
        for brand in KNOWN_BRANDS:
            brand_lower = brand.lower()
            if feed_brand_lower == brand_lower or feed_brand_lower.startswith(brand_lower + " "):
                return brand  # use our canonical spelling, not the feed's raw variant
        return feed_brand_clean  # no known match — trust the feed's own value as-is
    if not name:
        return "Other"
    lower = name.lower()
    for brand in KNOWN_BRANDS:
        if lower.startswith(brand.lower() + " ") or lower == brand.lower():
            return brand
    for brand in KNOWN_BRANDS:
        if _has_word(lower, brand.lower()):
            return brand
    return "Other"


COLOUR_KEYWORDS = [
    "black", "white", "grey", "gray", "navy", "blue", "red", "green",
    "yellow", "orange", "pink", "purple", "brown", "tan", "beige",
    "silver", "gold", "khaki", "olive", "charcoal", "cream", "stone",
]


def extract_colour(name):
    """Best-effort colour from the product name — picks whichever colour
    word appears earliest in the text when more than one is present (e.g.
    "White/Black" correctly returns White, not whichever happened to be
    checked first in the keyword list)."""
    if not name:
        return None
    lower = name.lower()
    best_word = None
    best_index = None
    for colour in COLOUR_KEYWORDS:
        match = re.search(r"\b" + colour + r"\b", lower)
        if match and (best_index is None or match.start() < best_index):
            best_index = match.start()
            best_word = colour
    if not best_word:
        return None
    return "Grey" if best_word == "gray" else best_word.capitalize()


# Categories where a "Fits You" spec claim actually makes sense — a
# driver/wood/hybrid/iron/wedge/set genuinely has a loft and a shaft
# flex a buyer cares about matching to their swing; a putter or a glove
# does not, so those are deliberately excluded rather than guessing.
CLUB_SPEC_CATEGORIES = {"driver", "wood", "hybrid", "irons", "wedge", "sets"}

# Longest/most-specific phrases first, same convention as KNOWN_BRANDS —
# "X-Stiff"/"Extra Stiff" must be checked before the plain "Stiff" word
# they'd otherwise also (correctly, but redundantly) match inside.
FLEX_KEYWORDS = [
    ("x-stiff", "X-Stiff"), ("x stiff", "X-Stiff"), ("extra stiff", "X-Stiff"),
    ("stiff", "Stiff"),
    ("regular", "Regular"),
    ("senior", "Senior"),
    ("ladies", "Ladies"), ("lady", "Ladies"),
    ("junior", "Junior"),
]


def extract_flex(name):
    """Best-effort shaft flex from the product name, only meaningful for
    real club categories (see CLUB_SPEC_CATEGORIES) — the caller is
    responsible for gating by category before calling this."""
    if not name:
        return None
    lower = name.lower()
    for keyword, flex in FLEX_KEYWORDS:
        if re.search(r"\b" + re.escape(keyword) + r"\b", lower):
            return flex
    return None


def extract_loft(name):
    """Best-effort loft angle from the product name, e.g. "10.5°" from
    "TaylorMade Stealth Driver 10.5° Regular" or "9.5 Degree" — both the
    degree symbol and the spelled-out word are used across different
    retailers' naming conventions."""
    if not name:
        return None
    match = re.search(r"(\d{1,2}(?:\.\d)?)\s*°", name)
    if not match:
        match = re.search(r"\b(\d{1,2}(?:\.\d)?)\s*(?:deg|degrees?)\b", name, re.IGNORECASE)
    if not match:
        return None
    return f"{match.group(1)}°"


# Checked in this order: Junior beats Female/Male, since a junior product
# is sometimes also described with "girls"/"boys" which could otherwise
# read as a gender signal — junior is the more specific, correct bucket.
JUNIOR_WORDS = ["junior", "boys", "girls", "kids golf", "us kids golf"]
FEMALE_WORDS = ["women's", "womens", "women", "ladies", "lady's"]


def classify_audience(name, icon=None):
    """Male / Female / Junior filter facet. Defaults to "Male" when
    nothing else matches — most golf gear is unisex in reality, and this
    matches the same "male or unisex" convention already used for the
    homepage's gender-balanced Hot Deals picks, rather than introducing a
    fourth ambiguous "Unisex" bucket the person didn't ask for.

    A real gap found and fixed this session: this used to check ONLY the
    product name for gendered wording (e.g. "ladies", "women's"). But a
    skort or a dress is unambiguously women's golf apparel by its very
    sub-type, regardless of whether the retailer happened to also put
    "women's" in the product title — many don't. Without this check,
    those items silently defaulted to "Male", which meant the homepage's
    80%-Male quota was being satisfied on paper while still visibly
    surfacing skorts and dresses, undermining the whole point of the
    quota.
    """
    if not name:
        return "Male"
    lower = name.lower()
    for word in JUNIOR_WORDS:
        if _has_word(lower, word):
            return "Junior"
    if icon in ("skort", "dress"):
        return "Female"
    for word in FEMALE_WORDS:
        if _has_word(lower, word):
            return "Female"
    return "Male"


def load_price_history():
    """Loads data/price-history.json, or starts a fresh empty structure if
    it doesn't exist yet (e.g. the very first run after this feature is
    deployed)."""
    if PRICE_HISTORY_FILE.exists():
        try:
            return json.loads(PRICE_HISTORY_FILE.read_text())
        except json.JSONDecodeError:
            print("price-history.json was unreadable — starting fresh rather than crashing the run.")
    return {"products": {}}


def save_price_history(history):
    PRICE_HISTORY_FILE.write_text(json.dumps(history, indent=2))


def _prune_history_entries(entries, today):
    """Drops entries older than MAX_HISTORY_AGE_DAYS and caps the list to
    MAX_HISTORY_ENTRIES, always keeping at least the single most recent
    entry so a product never ends up with an empty history."""
    kept = [
        e for e in entries
        if (today - date.fromisoformat(e["date"])).days <= MAX_HISTORY_AGE_DAYS
    ]
    if not kept and entries:
        kept = [entries[-1]]
    if len(kept) > MAX_HISTORY_ENTRIES:
        kept = kept[-MAX_HISTORY_ENTRIES:]
    return kept


def compute_price_insight(entries, current_price, today_str):
    """Turns a product's recorded price-history entries into the small
    summary embedded directly on the product as `priceInsight`, so the
    front-end can render a Deal Score / Verified Discount badge without a
    second fetch.

    Also computes a "Best Time to Buy" volatility read: how often this
    specific product's price actually moves, in real tracked days between
    changes — not generic seasonal folklore, just this item's own history.

    Deliberately conservative: a product needs at least two distinct
    recorded price points before it claims anything about "lowest" or
    "verified" — a single data point (day one of tracking) genuinely
    doesn't support either claim yet, and status "new" says so honestly
    rather than guessing. Volatility needs even more history
    (MIN_DAYS_FOR_VOLATILITY) before it claims "stable" vs "volatile",
    for the same reason.
    """
    if len(entries) < 2:
        today = date.fromisoformat(today_str)
        first_date = date.fromisoformat(entries[0]["date"])
        days_tracked = (today - first_date).days
        # A price that has never once changed, tracked for long enough,
        # is genuinely "stable" — zero changes over real elapsed time is
        # meaningful volatility data even though there's no second price
        # point to compare against for a "lowest tracked"/verified claim.
        if days_tracked >= MIN_DAYS_FOR_VOLATILITY:
            volatility = "stable"
        else:
            volatility = "insufficient_data"
        return {
            "status": "new",
            "trend": "stable",
            "verifiedDiscount": False,
            "historicalLow": current_price,
            "historicalHigh": current_price,
            "daysTracked": days_tracked,
            "volatility": volatility,
            "avgDaysBetweenChanges": None,
            "numChanges": 0,
        }

    today = date.fromisoformat(today_str)
    window_entries = [
        e for e in entries
        if (today - date.fromisoformat(e["date"])).days <= LOOKBACK_DAYS
    ] or entries  # fall back to full history if the window is somehow empty

    prices = [e["price"] for e in window_entries]
    historical_low = min(prices)
    historical_high = max(prices)
    first_date = date.fromisoformat(entries[0]["date"])
    days_tracked = (today - first_date).days

    # A discount only counts as "verified" if a genuinely higher price was
    # actually recorded within the lookback window — not invented, not
    # taken from a retailer's own (sometimes unreliable, per this
    # session's investigation) RRP claim.
    verified_discount = historical_high > current_price * 1.05

    if current_price <= historical_low + 0.01:
        status = "lowest_tracked"
    elif current_price >= historical_high - 0.01:
        status = "highest_tracked"
    else:
        status = "typical"

    # Trend vs. whatever the price was immediately before today's value.
    if entries[-1]["date"] == today_str and len(entries) >= 2:
        prev_price = entries[-2]["price"]
    else:
        prev_price = entries[-1]["price"]  # price hasn't changed since last recorded
    if current_price < prev_price - 0.01:
        trend = "falling"
    elif current_price > prev_price + 0.01:
        trend = "rising"
    else:
        trend = "stable"

    # Best Time to Buy — how often THIS product's price actually changes,
    # measured within the lookback window only (older history would skew
    # the average toward a stale, less relevant rate of change).
    num_changes = max(len(window_entries) - 1, 0)
    window_span_days = (today - date.fromisoformat(window_entries[0]["date"])).days
    if days_tracked < MIN_DAYS_FOR_VOLATILITY or num_changes == 0:
        volatility = "insufficient_data"
        avg_days_between_changes = None
    else:
        avg_days_between_changes = round(window_span_days / num_changes, 1)
        if avg_days_between_changes < VOLATILE_THRESHOLD_DAYS:
            volatility = "volatile"
        elif avg_days_between_changes < STABLE_THRESHOLD_DAYS:
            volatility = "moderate"
        else:
            volatility = "stable"

    return {
        "status": status,
        "trend": trend,
        "verifiedDiscount": verified_discount,
        "historicalLow": historical_low,
        "historicalHigh": historical_high,
        "daysTracked": days_tracked,
        "volatility": volatility,
        "avgDaysBetweenChanges": avg_days_between_changes,
        "numChanges": num_changes,
    }


# A single-run price change bigger than these ratios is treated as
# suspicious rather than trusted outright — most likely a feed glitch
# (e.g. a missing digit, a currency mix-up, a temporarily broken row)
# rather than a genuine same-day price move. The product's real price
# might well be correct, but "might" isn't good enough for a page whose
# entire premise is that a claimed discount is provably genuine.
SUSPICIOUS_DROP_RATIO = 0.4   # new price under 40% of the previous one
SUSPICIOUS_RISE_RATIO = 2.5   # new price over 250% of the previous one


def record_and_score_prices(catalog_products, history, today_str):
    """For every product with a live sale price, record a price-history
    entry — but only when the price has actually changed since the last
    recorded value, not on every single scheduled run. This keeps the
    history file's growth proportional to real price movement across
    thousands of products, rather than 4x-daily duplicate noise.

    Every priced product then gets a `priceInsight` summary written
    directly onto it, computed fresh from its history.

    A price change big enough to look like a feed glitch rather than a
    genuine move (see SUSPICIOUS_DROP_RATIO/SUSPICIOUS_RISE_RATIO) is
    still recorded — the data itself is never discarded or "corrected" —
    but its priceInsight is forced to a "flagged_anomaly" status with
    verifiedDiscount always False, so it can't power a Deal Score badge
    or appear on the Receipts page until the new price has been confirmed
    stable on a later run (at which point it's just the new normal price,
    and scores normally like anything else).
    """
    today = date.fromisoformat(today_str)
    products_history = history.setdefault("products", {})
    scored = 0
    flagged = []

    for p in catalog_products:
        price = p.get("salePrice")
        if price is None:
            continue
        name = p["name"]
        entries = products_history.setdefault(name, [])

        is_suspicious = False
        if entries and entries[-1]["price"] != price:
            prev_price = entries[-1]["price"]
            if prev_price:
                ratio = price / prev_price
                if ratio < SUSPICIOUS_DROP_RATIO or ratio > SUSPICIOUS_RISE_RATIO:
                    is_suspicious = True
                    flagged.append((name, prev_price, price))

        if not entries or entries[-1]["price"] != price:
            entries.append({"date": today_str, "price": price})
        entries[:] = _prune_history_entries(entries, today)

        insight = compute_price_insight(entries, price, today_str)
        if is_suspicious:
            insight["status"] = "flagged_anomaly"
            insight["verifiedDiscount"] = False
        p["priceInsight"] = insight
        scored += 1

    # Drop history for products no longer in the catalog at all, so the
    # file doesn't grow forever with discontinued items.
    current_names = {p["name"] for p in catalog_products}
    stale_names = [n for n in products_history if n not in current_names]
    for n in stale_names:
        del products_history[n]

    print(
        f"Price history: scored {scored} products, tracking history for "
        f"{len(products_history)} products total"
        + (f" (dropped {len(stale_names)} discontinued)." if stale_names else ".")
    )
    if flagged:
        print(
            f"Price history: {len(flagged)} product(s) had a suspiciously large "
            f"single-run price change — recorded, but held back from any "
            f"Verified Discount claim until confirmed stable on a later run."
        )
        for name, old_p, new_p in flagged[:10]:
            print(f"  - {name}: £{old_p:.2f} -> £{new_p:.2f}")
    DATA_QUALITY_REPORT["price_jump_anomalies"] = flagged
    return history


def load_stock_history():
    if STOCK_HISTORY_FILE.exists():
        try:
            return json.loads(STOCK_HISTORY_FILE.read_text())
        except json.JSONDecodeError:
            print("stock-history.json was unreadable — starting fresh rather than crashing the run.")
    return {"products": {}}


def save_stock_history(history):
    STOCK_HISTORY_FILE.write_text(json.dumps(history, indent=2))


def compute_stock_insight(entries, current_in_stock, today_str):
    """Turns a product's recorded stock-history entries into the small
    `stockInsight` summary embedded directly on the product — powers
    "Recently sold out" / "Back in stock" listings and a genuine "sells
    out fast" signal, without a second fetch.
    """
    today = date.fromisoformat(today_str)
    first_date = date.fromisoformat(entries[0]["date"])
    days_tracked = (today - first_date).days

    window_entries = [
        e for e in entries
        if (today - date.fromisoformat(e["date"])).days <= LOOKBACK_DAYS
    ] or entries

    outage_count = 0
    for i in range(1, len(window_entries)):
        if window_entries[i]["inStock"] is False and window_entries[i - 1]["inStock"] is True:
            outage_count += 1

    went_out_recently = (
        not current_in_stock and entries[-1]["date"] == today_str
        and len(entries) >= 2 and entries[-2]["inStock"] is True
    )
    came_back_recently = (
        current_in_stock and entries[-1]["date"] == today_str
        and len(entries) >= 2 and entries[-2]["inStock"] is False
    )
    sells_out_fast = (
        outage_count >= SELLS_OUT_FAST_THRESHOLD
        and days_tracked >= MIN_DAYS_FOR_VOLATILITY
    )

    return {
        "currentlyInStock": current_in_stock,
        "wentOutOfStockRecently": went_out_recently,
        "cameBackRecently": came_back_recently,
        "outageCount90d": outage_count,
        "daysTracked": days_tracked,
        "sellsOutFast": sells_out_fast,
    }


def record_and_score_stock(catalog_products, stock_history, today_str):
    """Same pattern as record_and_score_prices: records a stock-history
    entry only when in-stock status actually changes, then computes a
    stockInsight summary for every product with a known stock status."""
    today = date.fromisoformat(today_str)
    products_history = stock_history.setdefault("products", {})
    scored = 0

    for p in catalog_products:
        in_stock = p.get("inStock")
        if in_stock is None:
            continue
        name = p["name"]
        entries = products_history.setdefault(name, [])
        if not entries or entries[-1]["inStock"] != in_stock:
            entries.append({"date": today_str, "inStock": in_stock})
        entries[:] = _prune_history_entries(entries, today)

        p["stockInsight"] = compute_stock_insight(entries, in_stock, today_str)
        scored += 1

    current_names = {p["name"] for p in catalog_products}
    stale_names = [n for n in products_history if n not in current_names]
    for n in stale_names:
        del products_history[n]

    print(
        f"Stock history: scored {scored} products, tracking stock for "
        f"{len(products_history)} products total"
        + (f" (dropped {len(stale_names)} discontinued)." if stale_names else ".")
    )
    return stock_history


def backfill_catalog(products):
    """Self-healing pass applied to the ENTIRE catalog every run — not just
    freshly-fetched items. This is what lets brand/colour/icon coverage
    improve retroactively for old hand-curated products too, without ever
    needing to edit data/products.json by hand (which would risk
    overwriting whatever the live automated feed has already built up)."""
    updated = 0
    for p in products:
        changed = False
        if not p.get("brand"):
            p["brand"] = extract_brand(p.get("name", ""))
            changed = True
        if "colour" not in p:
            colour = extract_colour(p.get("name", ""))
            if colour:
                p["colour"] = colour
                changed = True
        if not p.get("icon") and p.get("category") in ("apparel", "accessories"):
            icon = guess_icon("", "", p.get("name", ""), p.get("category"))
            if icon:
                p["icon"] = icon
                changed = True
        # Safety net: a product whose category is neither apparel,
        # accessories, nor bag should never carry a leftover sub-type icon
        # (e.g. "grip") from before a category fix. This catches anything
        # merge_products' None-clearing didn't reach — for instance a
        # product that's briefly missing from one run's fresh feed.
        if p.get("icon") and p.get("category") not in ("apparel", "accessories", "bag"):
            del p["icon"]
            changed = True
        if "audience" not in p:
            p["audience"] = classify_audience(p.get("name", ""), p.get("icon"))
            changed = True
        if p.get("category") in CLUB_SPEC_CATEGORIES:
            if "loft" not in p:
                loft = extract_loft(p.get("name", ""))
                if loft:
                    p["loft"] = loft
                    changed = True
            if "flex" not in p:
                flex = extract_flex(p.get("name", ""))
                if flex:
                    p["flex"] = flex
                    changed = True
        if changed:
            updated += 1
    print(f"Catalog backfill: enriched {updated}/{len(products)} products with brand/colour/icon/audience/loft/flex.")
    return products


def fetch_awin_generic_feed(retailer_label, env_var_name, source_slug):
    """Pull real, live products + prices from any AWIN Create-a-Feed
    retailer datafeed. Extracted this session when a second retailer
    (Major Golf Direct) joined AWIN — this used to be a Clickgolf-only
    function; every retailer on this shared AWIN pipeline now just needs
    a short wrapper below (see fetch_awin_clickgolf_deals /
    fetch_awin_majorgolf_deals) rather than a copy-pasted duplicate.

    Needs `env_var_name` set as a repo secret — the manual download URL
    generated in Awin's Toolbox > Create-a-Feed (CSV, gzip,
    comma-delimited), configured with these columns: aw_deep_link,
    product_name, aw_product_id, merchant_product_id, merchant_image_url,
    description, merchant_category, search_price, store_price,
    merchant_deep_link, last_updated, display_price, category_name,
    brand_name, rrp_price, savings_percent, product_price_old, in_stock.
    Every AWIN retailer feed uses this same column schema, so no
    per-retailer parsing changes are needed here — just the feed URL.

    PRICE FIELD PRIORITY: "search_price" is AWIN's standard field for the
    actual current online selling price — what a shopper is really
    charged. "store_price" is a separate, retailer-populated field that
    isn't guaranteed to reflect the live online price, so it's only ever
    used as a possible RRP/"was" signal when genuinely higher than
    search_price and no explicit rrp_price/product_price_old was given
    (see the FootJoy sock bug from an earlier session for why this order
    matters).

    A genuine "deal" only counts here if the feed itself reports a real
    saving — nothing is invented or estimated.
    """
    feed_url = os.environ.get(env_var_name)
    if not feed_url:
        print(f"{retailer_label} feed: {env_var_name} secret not set or empty — skipping this retailer entirely.")
        return []

    try:
        with urllib.request.urlopen(feed_url, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        # AWIN's API returns a detailed JSON error body even on failures
        # (confirmed by the earlier "Invalid fid format" bug) — reading
        # it gives the real reason, not just a generic "HTTP Error 400"
        # with nothing useful after it.
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = "(could not read error response body)"
        print(f"{retailer_label} feed download failed, leaving catalog untouched: HTTP {exc.code} {exc.reason}")
        print(f"{retailer_label} feed error detail: {body}")
        return []
    except Exception as exc:
        print(f"{retailer_label} feed download failed, leaving catalog untouched: {exc}")
        return []

    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass  # feed wasn't actually gzipped — use as-is

    # utf-8-sig strips a leading byte-order-mark if present — AWIN feeds
    # sometimes include one, which otherwise silently corrupts the very
    # first column name (e.g. "aw_deep_link" becomes "\ufeffaw_deep_link")
    # and makes every row.get("aw_deep_link") return None.
    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    print(f"{retailer_label} feed: columns found = {reader.fieldnames}")

    products = []
    total_rows = 0
    skipped_no_name = 0
    out_of_stock_count = 0
    skipped_no_price = 0
    skipped_no_link = 0
    rrp_inversion_names = []
    implausible_rrp_names = []

    for row in reader:
        total_rows += 1
        name = (row.get("product_name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue

        # An out-of-stock row is kept (not skipped) and explicitly marked
        # inStock=False, so the catalog and stock history reflect real
        # current availability rather than silently going stale — see
        # the out-of-stock bug fixed in an earlier session.
        in_stock_raw = (row.get("in_stock") or "").strip().lower()
        in_stock = in_stock_raw not in ("0", "false", "no")
        if not in_stock:
            out_of_stock_count += 1

        def to_float(key):
            val = (row.get(key) or "").strip()
            if not val:
                return None
            try:
                return float(val)
            except ValueError:
                return None

        sp = to_float("search_price")
        if sp is None:
            sp = to_float("display_price")
        sale_price = sp
        if sale_price is None:
            skipped_no_price += 1
            continue

        old_price = to_float("rrp_price")
        if old_price is None:
            old_price = to_float("product_price_old")
        if old_price is None:
            store_price = to_float("store_price")
            if store_price and store_price > sale_price:
                old_price = store_price
        save_pct_raw = to_float("savings_percent")

        raw_rrp = to_float("rrp_price")
        raw_old = to_float("product_price_old")
        row_rrp_inverted = False
        for raw_candidate in (raw_rrp, raw_old):
            if raw_candidate is not None and raw_candidate <= sale_price:
                rrp_inversion_names.append(name)
                row_rrp_inverted = True
                break

        if old_price and old_price > sale_price:
            if old_price <= sale_price * MAX_PLAUSIBLE_DISCOUNT_RATIO:
                retail_price = old_price
                save_pct = round((1 - sale_price / retail_price) * 100)
            else:
                # The "was" price is more than 3x the sale price — not a
                # real discount, almost certainly bad/mismapped feed data
                # (see MAX_PLAUSIBLE_DISCOUNT_RATIO docstring). Reject it
                # rather than displaying a fake mega-discount, and treat
                # this row the same as a genuine RRP inversion for dedup
                # trust purposes — its price data isn't reliable either way.
                implausible_rrp_names.append((name, old_price, sale_price))
                row_rrp_inverted = True
                retail_price = sale_price
                save_pct = 0
        elif save_pct_raw and save_pct_raw > 0:
            retail_price = round(sale_price / (1 - save_pct_raw / 100), 2)
            save_pct = round(save_pct_raw)
        else:
            retail_price = sale_price
            save_pct = 0

        affiliate_url = (row.get("aw_deep_link") or row.get("merchant_deep_link") or "").strip()
        if not affiliate_url:
            skipped_no_link += 1
            continue

        # The retailer's own product page URL is a far more reliable
        # identity signal than the product name for telling "genuinely
        # the same real product, listed twice" apart from "two different
        # real products that happen to share truncated/similar names".
        # Internal-only — stripped out before the product ever reaches
        # products.json, see dedupe_products().
        merchant_page_url = (row.get("merchant_deep_link") or "").strip()

        image = (row.get("merchant_image_url") or "").strip()
        cat_name = row.get("category_name")
        merch_cat = row.get("merchant_category")
        raw_description = row.get("description")
        category = guess_category(cat_name, merch_cat, name, raw_description)
        combined_text = (name.lower() + " " + " ".join(f for f in (cat_name, merch_cat) if f).lower()).strip()
        category = apply_post_overrides(combined_text, category)
        icon = guess_icon(cat_name, merch_cat, name, category, raw_description)
        brand = extract_brand(name, row.get("brand_name"))
        colour = extract_colour(name)
        audience = classify_audience(name, icon)
        loft = extract_loft(name) if category in CLUB_SPEC_CATEGORIES else None
        flex = extract_flex(name) if category in CLUB_SPEC_CATEGORIES else None
        product_id = f"{category}-{slugify(name)}-{source_slug}"

        product = {
            "id": product_id,
            "name": name,
            "category": category,
            "retailPrice": retail_price,
            "salePrice": sale_price,
            "savePct": max(save_pct, 0),
            "retailerCount": 1,
            "affiliateUrl": affiliate_url,
            "source": f"awin-{source_slug}",
            "brand": brand,
            "audience": audience,
            "inStock": in_stock,
            "_mpu": merchant_page_url,
            "_rrpInverted": row_rrp_inverted,
        }
        if image:
            product["image"] = image
        product["icon"] = icon
        if colour:
            product["colour"] = colour
        if loft:
            product["loft"] = loft
        if flex:
            product["flex"] = flex
        products.append(product)

    category_counts = {}
    for p in products:
        category_counts[p["category"]] = category_counts.get(p["category"], 0) + 1

    apparel_accessories = [p for p in products if p["category"] in ("apparel", "accessories")]
    with_icon = sum(1 for p in apparel_accessories if p.get("icon"))
    icon_counts = {}
    for p in apparel_accessories:
        key = p.get("icon") or "(none)"
        icon_counts[key] = icon_counts.get(key, 0) + 1

    print(
        f"{retailer_label} feed: {total_rows} rows read, {len(products)} usable. "
        f"Skipped — no name: {skipped_no_name}, "
        f"no price: {skipped_no_price}, no link: {skipped_no_link}. "
        f"(Out of stock: {out_of_stock_count} — tracked with inStock=False, no longer skipped.)"
    )
    print(f"{retailer_label} feed: category breakdown = {category_counts}")
    print(
        f"{retailer_label} feed: {with_icon}/{len(apparel_accessories)} apparel/accessories "
        f"products got a hub-page icon assigned. Icon breakdown = {icon_counts}"
    )
    if rrp_inversion_names:
        print(
            f"{retailer_label} feed: {len(rrp_inversion_names)} row(s) reported a \"was\" price "
            f"that wasn't actually higher than the current price (a real data-quality "
            f"issue on the retailer's end) — safely ignored, no discount was claimed "
            f"for these. Examples: {rrp_inversion_names[:5]}"
        )
    if implausible_rrp_names:
        print(
            f"{retailer_label} feed: {len(implausible_rrp_names)} row(s) reported a \"was\" "
            f"price more than {MAX_PLAUSIBLE_DISCOUNT_RATIO}x the sale price (an implausible "
            f"discount, likely bad/mismapped feed data) — rejected, no discount was claimed "
            f"for these."
        )
        for name, old_p, new_p in implausible_rrp_names[:5]:
            print(f"  - {name}: claimed was £{old_p:.2f} vs sale £{new_p:.2f} ({old_p/new_p:.1f}x)")
    existing_inversions = DATA_QUALITY_REPORT.get("rrp_inversions", [])
    DATA_QUALITY_REPORT["rrp_inversions"] = existing_inversions + rrp_inversion_names
    existing_implausible = DATA_QUALITY_REPORT.get("implausible_rrp", [])
    DATA_QUALITY_REPORT["implausible_rrp"] = existing_implausible + implausible_rrp_names
    return products


def fetch_awin_clickgolf_deals():
    """Clickgolf — first AWIN retailer onboarded. See
    fetch_awin_generic_feed for the shared implementation."""
    return fetch_awin_generic_feed("Clickgolf", "AWIN_CLICKGOLF_FEED_URL", "clickgolf")


def fetch_awin_majorgolf_deals():
    """Major Golf Direct — second AWIN retailer onboarded. See
    fetch_awin_generic_feed for the shared implementation."""
    return fetch_awin_generic_feed("Major Golf Direct", "AWIN_MAJORGOLF_FEED_URL", "majorgolf")


def fetch_awin_callaway_deals():
    """Callaway Europe — third AWIN retailer onboarded. See
    fetch_awin_generic_feed for the shared implementation."""
    return fetch_awin_generic_feed("Callaway Europe", "AWIN_CALLAWAY_FEED_URL", "callaway")


def fetch_awin_deals():
    """Pull products from AWIN's product data feed (general/legacy path).

    Needs AWIN_API_TOKEN and AWIN_PUBLISHER_ID as repo secrets (already set
    up), plus an AWIN_ADVERTISER_ID for each retailer you're approved
    with — add one once a pending application is approved. Clickgolf uses
    its own dedicated fetch_awin_clickgolf_deals() above instead, since it
    already has a configured Create-a-Feed URL.
    """
    token = os.environ.get("AWIN_API_TOKEN")
    if not token:
        return []
    advertiser_id = os.environ.get("AWIN_ADVERTISER_ID")
    if not advertiser_id:
        return []
    # TODO: once approved, real feed download looks like:
    #   GET https://productdata.awin.com/datafeed/download/apikey/<AWIN_API_TOKEN>
    #       /language/en/cid/<advertiser_id>/format/csv
    # Parse the CSV (columns include product name, price, image URL, and
    # aw_deep_link — a working affiliate link already built in) and map
    # each row into the same product shape used in products.json.
    return []


def fetch_impact_deals():
    """Placeholder: pull products from Impact's Catalog API, once joined."""
    api_key = os.environ.get("IMPACT_API_KEY")
    if not api_key:
        return []
    # TODO: real Impact Catalog API call goes here once you're set up with
    # a retailer on Impact. Docs: https://developer.impact.com/
    return []


def categorize_placeholder(name):
    """Very rough guess at category from a product name, used only as a
    fallback for products arriving from a feed without one. Real feed data
    usually includes its own category, which should be preferred."""
    name_lower = name.lower()
    for key in ["driver", "wood", "hybrid", "iron", "wedge", "putter", "ball",
                "bag", "shoe", "glove", "rangefinder", "cart", "umbrella"]:
        if key in name_lower:
            return {"iron": "irons", "shoe": "shoes", "glove": "accessories",
                    "rangefinder": "accessories", "cart": "accessories",
                    "umbrella": "accessories"}.get(key, key)
    return "accessories"


def _median_offer(offers):
    """Returns the offer whose salePrice is the statistical median among
    a group of same-name listings — far more robust to a single outlier
    (e.g. one individually-listed spare club dragging the group's
    cheapest price down to a fraction of the real set price) than
    blindly taking the minimum would be. For an even count, takes the
    lower of the two middle offers — a small, deliberate bias toward the
    cheaper side, consistent with the site's "don't overstate price"
    ethos, while still being far more representative than the true min."""
    sorted_offers = sorted(offers, key=lambda o: o["salePrice"])
    mid = len(sorted_offers) // 2
    if len(sorted_offers) % 2 == 1:
        return sorted_offers[mid]
    return sorted_offers[mid - 1]


def _best_representative(offers):
    """Picks the representative offer for a group of same-product-page
    duplicate listings — trying to do better than plain median where
    possible, using a real signal instead of a guess.

    Confirmed by a real incident this session (Titleist Pro V1x AIM
    balls: three duplicate rows for the identical product page, priced
    £49.99 / £94.99 / £134.97 against a consistent £52.00 RRP): plain
    median would have picked £94.99 — WRONG, the confirmed real price
    was £49.99, the only one of the three whose price doesn't
    contradict its own advertised RRP (the other two exceed their own
    RRP by 80%+ and 160%, which no genuine sale price would ever do).

    So: prefer offers whose own RRP data is internally consistent
    (`_rrpInverted` is False) over ones that aren't, and take the
    median only among THOSE. If none are RRP-consistent (or no RRP data
    exists to judge by at all, as was the case for the Callaway irons
    incident), fall back to the median of everyone — the best available
    estimate when there's truly no way to tell.
    """
    clean = [o for o in offers if not o.get("_rrpInverted")]
    return _median_offer(clean) if clean else _median_offer(offers)


def dedupe_products(fresh_products):
    """Collapses duplicate product listings into one catalog entry.

    IDENTITY KEY: groups by the retailer's own product page URL
    (`_mpu`, internal-only, stripped before returning) when available,
    falling back to product name otherwise. A real incident this session
    showed why name alone isn't reliable enough: ~19 separate feed rows
    for "Callaway Apex Ti Fusion Golf Irons - Steel" all pointed to the
    EXACT SAME real product page (confirmed via merchant_deep_link) and
    had the identical full-set spec table in their description — yet
    carried wildly different prices (£289 to £2,269) under fabricated-
    looking product IDs. That's not a naming ambiguity between genuinely
    different configurations (this session's earlier working theory) —
    it's the retailer's feed export generating inconsistent duplicate
    rows for one single real product. The page URL is the one field that
    correctly reflects "this actually is the same real thing" here.

    GENUINE cross-retailer duplicate (multiple different `source`
    values): keep the cheapest — correct, unchanged behaviour.

    SAME-RETAILER collision (every offer shares one `source`): uses the
    median price, since blindly keeping the cheapest here already proved
    actively dangerous once. IMPORTANT HONESTY NOTE: median is a
    defensible least-wrong estimate, not a guarantee of accuracy — for
    the Apex Ti Fusion case specifically, it landed at £1,699 against a
    confirmed real live price of £1,419. When a collision's price spread
    is severe (see SEVERE_VARIANCE_RATIO), that's flagged distinctly in
    the Data Quality Report rather than silently smoothed over, because
    it likely reflects a genuine feed bug on the retailer's end that no
    amount of client-side statistics can fully correct — worth reporting
    to the retailer directly.

    `retailerCount` reflects the real number of DISTINCT RETAILERS, not
    raw row count.
    """
    by_key = {}
    for p in fresh_products:
        key = p.get("_mpu") or p["name"]
        by_key.setdefault(key, []).append(p)

    deduped = []
    cross_retailer_collisions = []
    same_retailer_collisions = []
    severe_variance_collisions = []

    for key, offers in by_key.items():
        display_name = offers[0]["name"]

        if len(offers) == 1:
            winner = dict(offers[0])
            winner["retailerCount"] = 1
            winner.pop("_mpu", None)
            winner.pop("_rrpInverted", None)
            deduped.append(winner)
            continue

        sources = sorted({o["source"] for o in offers})

        if len(sources) == 1:
            prices = [o["salePrice"] for o in offers]
            variance_ratio = max(prices) / min(prices) if min(prices) > 0 else 1
            winner = dict(_best_representative(offers))
            winner["retailerCount"] = 1
            winner.pop("_mpu", None)
            winner.pop("_rrpInverted", None)
            same_retailer_collisions.append((display_name, sources[0], len(offers), winner["salePrice"]))
            if variance_ratio >= SEVERE_VARIANCE_RATIO:
                severe_variance_collisions.append(
                    (display_name, sources[0], len(offers), min(prices), max(prices), winner["salePrice"])
                )
            deduped.append(winner)
            continue

        # Genuine cross-retailer duplicate. Collapse any same-retailer
        # collisions WITHIN each source first, then pick the cheapest
        # across those per-retailer representatives.
        per_source_repr = []
        for src in sources:
            src_offers = [o for o in offers if o["source"] == src]
            if len(src_offers) > 1:
                prices = [o["salePrice"] for o in src_offers]
                variance_ratio = max(prices) / min(prices) if min(prices) > 0 else 1
                rep = _best_representative(src_offers)
                same_retailer_collisions.append((display_name, src, len(src_offers), rep["salePrice"]))
                if variance_ratio >= SEVERE_VARIANCE_RATIO:
                    severe_variance_collisions.append(
                        (display_name, src, len(src_offers), min(prices), max(prices), rep["salePrice"])
                    )
            else:
                rep = src_offers[0]
            per_source_repr.append(rep)

        winner = dict(min(per_source_repr, key=lambda o: o["salePrice"]))
        winner["retailerCount"] = len(sources)
        winner.pop("_mpu", None)
        winner.pop("_rrpInverted", None)
        cross_retailer_collisions.append((display_name, len(sources), winner["salePrice"]))
        deduped.append(winner)

    if cross_retailer_collisions:
        print(
            f"Dedup: {len(cross_retailer_collisions)} product(s) were offered by more than "
            f"one DISTINCT RETAILER this run — kept the cheapest genuine price each time."
        )
        for name, count, price in cross_retailer_collisions[:10]:
            print(f"  - {name}: {count} retailers, kept £{price:.2f}")

    if same_retailer_collisions:
        print(
            f"Dedup: {len(same_retailer_collisions)} product(s) had multiple listings from "
            f"the SAME retailer for what's confirmed to be the same real product — used the "
            f"median price rather than the cheapest, to avoid a single outlier listing "
            f"distorting the shown price."
        )
        for name, source, count, price in same_retailer_collisions[:10]:
            print(f"  - {name} ({source}): {count} listings, used median £{price:.2f}")

    if severe_variance_collisions:
        print(
            f"\n⚠️  {len(severe_variance_collisions)} product(s) had a SEVERE price spread "
            f"(≥{SEVERE_VARIANCE_RATIO}x between lowest and highest) across duplicate listings "
            f"of the same real product. This is likely a genuine bug in the retailer's own "
            f"feed export, not something further client-side logic can fully correct — the "
            f"median shown is a best-effort estimate, not a confirmed-accurate price. Worth "
            f"spot-checking these against the retailer's live site, and worth reporting to "
            f"the retailer directly if the pattern persists."
        )
        for name, source, count, lo, hi, used in severe_variance_collisions[:10]:
            print(f"  - {name} ({source}): {count} listings, £{lo:.2f}\u2013£{hi:.2f}, used median £{used:.2f}")

    DATA_QUALITY_REPORT["cross_retailer_collisions"] = cross_retailer_collisions
    DATA_QUALITY_REPORT["same_retailer_name_collisions"] = same_retailer_collisions
    DATA_QUALITY_REPORT["severe_variance_collisions"] = severe_variance_collisions
    return deduped


def merge_products(catalog_products, fresh_products):
    """Merge freshly-fetched products into the existing catalog: update
    matching items by name, add new ones, and never delete anything that
    isn't in the fresh batch (so a temporary feed hiccup can't wipe the
    catalog).

    One exception: if a fresh item explicitly sets a field to None (e.g.
    icon, when a product's category no longer needs one), that field is
    actively removed from the existing entry. A plain dict.update() can
    only add/overwrite keys that are present in the new data — it can
    never delete a key that's simply absent — so without this, a stale
    sub-type icon from before a category fix would silently persist
    forever even after the underlying bug was corrected.
    """
    by_name = {p["name"]: p for p in catalog_products}
    for item in fresh_products:
        if item["name"] in by_name:
            existing = by_name[item["name"]]
            existing.update(item)
            for key, value in item.items():
                if value is None:
                    existing.pop(key, None)
        else:
            by_name[item["name"]] = {k: v for k, v in item.items() if v is not None}
    return list(by_name.values())


# ============================================================
# The Fairway Index — a category-level "inflation index" for golf
# gear, built entirely from this site's own tracked history. Records
# one snapshot per day (average current price per category, across
# in-stock tracked products only), then compares the latest snapshot
# against the closest available snapshot from ~30 and ~90 days ago to
# report a genuine, evidenced percentage change — never invented, and
# honestly reported as unavailable until real history exists that far
# back.
# ============================================================
INDEX_CATEGORIES = [
    "driver", "wood", "hybrid", "irons", "wedge", "putter", "sets",
    "ball", "bag", "shoes", "apparel", "accessories",
]
INDEX_COMPARE_WINDOWS = {"change30d": 30, "change90d": 90}
# One snapshot/day is tiny (a dozen numbers), so this comfortably covers
# more than two years of daily history without the file growing large.
MAX_INDEX_SNAPSHOTS = 800


def load_index_history():
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except json.JSONDecodeError:
            print("price-index.json was unreadable — starting fresh rather than crashing the run.")
    return {"snapshots": []}


def save_index_history(history):
    INDEX_FILE.write_text(json.dumps(history, indent=2))


def record_index_snapshot(products, index_history, today_str):
    """Records today's average price per category. If a snapshot for
    today already exists (e.g. a second run on the same day), it's
    replaced rather than duplicated — one snapshot per calendar day."""
    snapshots = index_history.setdefault("snapshots", [])
    if snapshots and snapshots[-1]["date"] == today_str:
        snapshots.pop()

    totals = {}
    for p in products:
        cat = p.get("category")
        price = p.get("salePrice")
        if cat not in INDEX_CATEGORIES or price is None or p.get("inStock") is False:
            continue
        t = totals.setdefault(cat, {"sum": 0.0, "count": 0})
        t["sum"] += price
        t["count"] += 1

    categories_snapshot = {
        cat: {"avgPrice": round(t["sum"] / t["count"], 2), "count": t["count"]}
        for cat, t in totals.items() if t["count"] > 0
    }
    snapshots.append({"date": today_str, "categories": categories_snapshot})
    if len(snapshots) > MAX_INDEX_SNAPSHOTS:
        del snapshots[: len(snapshots) - MAX_INDEX_SNAPSHOTS]

    index_history["snapshots"] = snapshots
    print(f"Fairway Index: recorded {today_str} snapshot across {len(categories_snapshot)} categories.")
    return index_history


def _find_nearest_snapshot(snapshots, today, target_days_ago):
    """Finds the snapshot closest to (today - target_days_ago) among
    snapshots that are AT LEAST that old — a snapshot from yesterday
    should never masquerade as a 90-day baseline just because it's the
    oldest one on file yet."""
    target_date = today - timedelta(days=target_days_ago)
    candidates = [s for s in snapshots if date.fromisoformat(s["date"]) <= target_date]
    if not candidates:
        return None
    candidates.sort(key=lambda s: abs((date.fromisoformat(s["date"]) - target_date).days))
    return candidates[0]


def compute_index_summary(index_history, today_str):
    """Turns the raw snapshot history into the per-category summary the
    Fairway Index page reads directly — genuine % change vs ~30/90 days
    ago, or None (honestly, not a guess) if history doesn't reach back
    that far yet."""
    snapshots = index_history.get("snapshots", [])
    if not snapshots:
        return {}
    today = date.fromisoformat(today_str)
    latest = snapshots[-1]
    summary = {}
    for cat, latest_data in latest.get("categories", {}).items():
        entry = {"currentAvg": latest_data["avgPrice"], "count": latest_data["count"]}
        for key, days in INDEX_COMPARE_WINDOWS.items():
            baseline = _find_nearest_snapshot(snapshots, today, days)
            base_data = baseline.get("categories", {}).get(cat) if baseline else None
            if base_data and base_data["avgPrice"]:
                entry[key] = round(
                    (latest_data["avgPrice"] - base_data["avgPrice"]) / base_data["avgPrice"] * 100, 1
                )
            else:
                entry[key] = None
        summary[cat] = entry
    return summary


# ============================================================
# Complete The Kit — auto-generated, genuinely-priced pairings from
# whatever's actually cheapest in the catalog right now. Deliberately
# NOT framed as "bundle & save" anywhere — there's no real merged
# discount here, just convenient grouping of items people commonly buy
# together, each at its own already-tracked lowest real price. Framing
# it as a "deal" would be exactly the kind of fake-discount claim this
# site's whole brand promise exists to avoid.
# ============================================================
BUNDLE_TEMPLATES = [
    {"id": "driver-headcover", "title": "🏌️ Driver + Headcover", "slots": [
        {"label": "Driver", "category": "driver"},
        {"label": "Headcover", "icon": "headcover"},
    ]},
    {"id": "irons-bag", "title": "⛳ Iron Set + Golf Bag", "slots": [
        {"label": "Irons", "category": "irons"},
        {"label": "Golf Bag", "category": "bag"},
    ]},
    {"id": "course-day-essentials", "title": "🧢 Course Day Essentials", "slots": [
        {"label": "Glove", "icon": "glove"},
        {"label": "Tees", "icon": "tee"},
        {"label": "Towel", "icon": "towel"},
    ]},
    {"id": "putter-alignment", "title": "🎯 Putter + Alignment Sticks", "slots": [
        {"label": "Putter", "category": "putter"},
        {"label": "Alignment Sticks", "icon": "alignment-sticks"},
    ]},
    {"id": "shoes-socks", "title": "👟 Shoes + Socks", "slots": [
        {"label": "Golf Shoes", "category": "shoes"},
        {"label": "Socks", "icon": "socks"},
    ]},
    {"id": "balls-retriever", "title": "🎾 Balls + Ball Retriever", "slots": [
        {"label": "Golf Balls", "category": "ball"},
        {"label": "Ball Retriever", "icon": "ball-retriever"},
    ]},
]


def _slot_matches(product, slot):
    if product.get("inStock") is False or not product.get("image"):
        return False
    if "category" in slot and product.get("category") != slot["category"]:
        return False
    if "icon" in slot and product.get("icon") != slot["icon"]:
        return False
    return True


def compute_bundles(products):
    """Rebuilds every bundle from scratch each run, always picking the
    single cheapest currently in-stock, real-photo match for each slot.
    A template is skipped entirely (not shown with a gap) if any one of
    its slots has no genuine match right now."""
    bundles = []
    for template in BUNDLE_TEMPLATES:
        items = []
        complete = True
        for slot in template["slots"]:
            candidates = [p for p in products if _slot_matches(p, slot)]
            if not candidates:
                complete = False
                break
            cheapest = min(candidates, key=lambda p: p["salePrice"])
            items.append({
                "slotLabel": slot["label"],
                "id": cheapest.get("id"),
                "name": cheapest["name"],
                "image": cheapest.get("image"),
                "salePrice": cheapest["salePrice"],
                "affiliateUrl": cheapest["affiliateUrl"],
                "brand": cheapest.get("brand"),
            })
        if not complete:
            continue
        bundles.append({
            "id": template["id"],
            "title": template["title"],
            "items": items,
            "total": round(sum(i["salePrice"] for i in items), 2),
        })
    return bundles


def save_bundles(bundles):
    BUNDLE_FILE.write_text(json.dumps(
        {"bundles": bundles, "lastUpdated": datetime.now(timezone.utc).isoformat()},
        indent=2,
    ))


def main():
    catalog = json.loads(DATA_FILE.read_text())

    fresh = (
        fetch_cj_deals()
        + fetch_awin_deals()
        + fetch_awin_clickgolf_deals()
        + fetch_awin_majorgolf_deals()
        + fetch_awin_callaway_deals()
        + fetch_impact_deals()
    )
    fresh = dedupe_products(fresh)

    if fresh:
        catalog["products"] = merge_products(catalog["products"], fresh)
        print(f"Merged {len(fresh)} products from live feeds into the catalog "
              f"({len(catalog['products'])} products total).")
    else:
        print("No live feed data returned this run — catalog left as-is "
              f"({len(catalog['products'])} products, Amazon links still active).")

    catalog["products"] = backfill_catalog(catalog["products"])

    today_str = datetime.now(timezone.utc).date().isoformat()
    price_history = load_price_history()
    price_history = record_and_score_prices(catalog["products"], price_history, today_str)
    save_price_history(price_history)

    stock_history = load_stock_history()
    stock_history = record_and_score_stock(catalog["products"], stock_history, today_str)
    save_stock_history(stock_history)

    index_history = load_index_history()
    index_history = record_index_snapshot(catalog["products"], index_history, today_str)
    index_history["summary"] = compute_index_summary(index_history, today_str)
    index_history["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    save_index_history(index_history)

    bundles = compute_bundles(catalog["products"])
    save_bundles(bundles)
    print(f"Complete The Kit: generated {len(bundles)}/{len(BUNDLE_TEMPLATES)} bundle(s) from current lowest prices.")

    existing_category_keys = {c["key"] for c in catalog.get("categories", [])}
    if "sets" not in existing_category_keys:
        catalog.setdefault("categories", []).append({"key": "sets", "label": "Sets"})
        print("Added 'Sets' to the categories list.")

    catalog["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.write_text(json.dumps(catalog, indent=2))

    print_data_quality_report()


def print_data_quality_report():
    """One consolidated summary of every data-quality signal found this
    run, printed last so it's easy to spot at the bottom of the Actions
    log. Purely informational — nothing here changes what was written to
    products.json; the individual checks already handled that safely as
    they ran."""
    inversions = DATA_QUALITY_REPORT.get("rrp_inversions", [])
    implausible = DATA_QUALITY_REPORT.get("implausible_rrp", [])
    cross_retailer = DATA_QUALITY_REPORT.get("cross_retailer_collisions", [])
    same_retailer = DATA_QUALITY_REPORT.get("same_retailer_name_collisions", [])
    severe_variance = DATA_QUALITY_REPORT.get("severe_variance_collisions", [])
    jumps = DATA_QUALITY_REPORT.get("price_jump_anomalies", [])

    print("\n" + "=" * 60)
    print("Data Quality Report")
    print("=" * 60)
    print(f"RRP/was-price inversions (retailer's own data, safely ignored):    {len(inversions)}")
    print(f"Implausible discounts (\u2265{MAX_PLAUSIBLE_DISCOUNT_RATIO}x sale price, rejected):          {len(implausible)}")
    print(f"Cross-retailer duplicates (kept the cheapest genuine price):       {len(cross_retailer)}")
    print(f"Same-retailer name collisions (used median, not cheapest):        {len(same_retailer)}")
    print(f"  \u21b3 of which SEVERE price spread (\u2265{SEVERE_VARIANCE_RATIO}x, likely a retailer feed bug — worth reviewing): {len(severe_variance)}")
    print(f"Suspicious single-run price jumps (flagged, not yet trusted):     {len(jumps)}")
    if not (inversions or implausible or cross_retailer or same_retailer or jumps):
        print("Nothing flagged this run — feed data looked clean.")
    print("=" * 60)


if __name__ == "__main__":
    main()
