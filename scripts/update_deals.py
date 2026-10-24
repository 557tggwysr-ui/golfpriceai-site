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

import collections
import csv
import gzip
import hashlib
import io
import json
import math
import os
import re
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote_plus
from xml.sax.saxutils import escape as xml_escape

import models  # scripts/models.py: category audit, £0 clean-up, model grouping
import price_pages  # scripts/price_pages.py: static /prices/ pages, sitemaps
import identity  # scripts/identity.py: one listing = retailer + name
import search_index  # scripts/search_index.py: data/search/ for the search page
import used_prices  # scripts/used_prices.py: data/used-prices.json for the price checker
import product_types  # scripts/product_types.py: fixes clothing/accessory types from the product name
import retailer_images  # scripts/retailer_images.py: real Scottsdale photo addresses

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
CURATED_VIEWS_FILE = Path(__file__).resolve().parent.parent / "data" / "curated-views.json"
DEALS_FEED_RSS_FILE = Path(__file__).resolve().parent.parent / "data" / "deals-feed.xml"
DEALS_FEED_JSON_FILE = Path(__file__).resolve().parent.parent / "data" / "deals-feed.json"
LITE_DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "products-lite.json"
APPAREL_LITE_FILE = Path(__file__).resolve().parent.parent / "data" / "apparel-lite.json"
OUTFIT_FILE = Path(__file__).resolve().parent.parent / "data" / "outfits.json"

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
# (Was 3 until 16 Oct 2026; nothing had sold out 3 times yet, so the
# section was always empty. Twice in 90 days is still a real pattern, and
# the card says exactly how many times.)
SELLS_OUT_FAST_THRESHOLD = 2

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

    # Push trolleys and scorecard holders were getting miscategorized as
    # "ball" — found via a real catalog audit, 27 products affected. Root
    # cause: "ball" is checked early in the general keyword list, and
    # almost every trolley's retailer taxonomy text mentions a "ball tray"
    # (a standard trolley accessory feature) even when the word "ball"
    # never appears in the product's own visible name — scorecard holders
    # get caught the same way, since retailers typically bundle them
    # under the same trolley-accessories taxonomy branch. "trolley" and
    # "scorecard holder" are unambiguous — never a ball, whatever else
    # the combined text happens to mention — so this is safe to catch
    # unconditionally, before the generic "ball" keyword ever gets a look.
    if "trolley" in name_text:
        return "accessories"
    if "scorecard holder" in name_text:
        return "accessories"

    # A multi-club combo/box set (e.g. "Men's XR 13-Piece Combo" — driver,
    # irons, putter, and a bag all bundled as one product) needs to be
    # caught here, BEFORE any single club-shape keyword gets a chance to
    # claim it. Without this, CLUB_SHAPE_KEYWORDS checks "putter" first
    # in its list — so a combo set that happens to mention a putter as
    # one of its included pieces was getting miscategorized as a Putter
    # itself, showing up in the Putters section (and its Fairway Index
    # "real drops" list) as a genuine £1,000+ full set, not a putter.
    # "piece" (as in "13-Piece") and "box set" are specific, safe
    # signals with no plausible false positive. "combo" is also
    # deliberately excluded when paired with "grip", since "Combo Grip"
    # is a real, unrelated accessory product type. "package set" is a
    # second, distinct wording for the exact same kind of bundled
    # starter set (found during a real catalog audit — 59 products,
    # mostly Wilson/Callaway/US Kids junior and adult starter sets,
    # were showing up miscategorized as Putters or Drivers because
    # their name never contains the word "piece" at all, just
    # "Package Set").
    if _has_word(name_text, "piece"):
        return "sets"
    if "box set" in name_text or "boxed set" in name_text:
        return "sets"
    if "package set" in name_text:
        return "sets"
    if _has_word(name_text, "combo") and not _has_word(name_text, "grip"):
        return "sets"

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
        entries = products_history.setdefault(identity.listing_key(p), [])

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
    current_names = {identity.listing_key(p) for p in catalog_products}
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
        # When the stock status last changed, and what it was before, for
        # the Back In Stock Radar's "back in stock" and "sold out" lists.
        "lastChange": entries[-1]["date"] if len(entries) >= 2 else None,
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
        entries = products_history.setdefault(identity.listing_key(p), [])
        if not entries or entries[-1]["inStock"] != in_stock:
            entries.append({"date": today_str, "inStock": in_stock})
        entries[:] = _prune_history_entries(entries, today)

        p["stockInsight"] = compute_stock_insight(entries, in_stock, today_str)
        scored += 1

    current_names = {identity.listing_key(p) for p in catalog_products}
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


def _parse_google_shopping_price(value):
    """Google Shopping feed prices are formatted as 'NUMBER CURRENCY'
    (e.g. '199.99 GBP'), not a bare number like AWIN's classic feeds —
    this strips the currency code before parsing."""
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    first_token = value.split()[0]
    try:
        return float(first_token)
    except ValueError:
        return None


def normalize_google_shopping_row(row):
    """Converts a row from a Google Merchant Center-style feed (used by
    Major Golf Direct via AWIN's "My Google Feed" / Darwin download
    system — a genuinely different feed format from AWIN's own classic
    Create-a-Feed, discovered when the fid/F4356 bug turned out to be a
    red herring and this was the real underlying cause) into the exact
    same shape fetch_awin_generic_feed's downstream logic already
    expects — so every existing check (RRP-inversion rejection,
    implausible-discount rejection, categorization, brand/colour/
    audience extraction) runs completely unchanged regardless of which
    format the row actually came from. Nothing about the classic-format
    path (Clickgolf, Callaway, Discount Golf Store) changes.

    Google's price fields work differently to AWIN's: "price" is the
    regular/list price, "sale_price" is the current discounted price —
    only present when genuinely on sale. When there's no sale_price,
    "price" IS the current selling price and no discount should be
    claimed — mirrored here by leaving rrp_price blank in that case,
    same as an AWIN row with no genuine "was" price.
    """
    price = _parse_google_shopping_price(row.get("price"))
    sale_price = _parse_google_shopping_price(row.get("sale_price"))

    if sale_price is not None:
        current_price = sale_price
        was_price = price
    else:
        current_price = price
        was_price = None

    availability_raw = (row.get("availability") or "").strip().lower()
    # Confirmed via the real feed (not the Google Merchant Center spec's
    # documented "in stock" with a space) that Major Golf Direct's feed
    # actually uses underscores: "in_stock" / "out_of_stock". Normalizing
    # underscores to spaces first means this also still works correctly
    # if a future feed genuinely does use the space-separated spec
    # format instead — covers both without needing to guess which one
    # any given Google-format feed actually uses.
    availability_normalized = availability_raw.replace("_", " ")
    in_stock = "1" if availability_normalized == "in stock" else "0"

    return {
        "product_name": row.get("title"),
        "aw_deep_link": row.get("aw_deep_link") or row.get("link"),
        "merchant_deep_link": row.get("link"),
        "search_price": f"{current_price}" if current_price is not None else "",
        "display_price": f"{current_price}" if current_price is not None else "",
        "rrp_price": f"{was_price}" if was_price is not None else "",
        "product_price_old": "",
        "store_price": "",
        "savings_percent": "",
        "category_name": row.get("product_type") or row.get("google_product_category"),
        "merchant_category": row.get("product_type") or row.get("google_product_category"),
        "description": row.get("description"),
        "merchant_image_url": row.get("image_link"),
        "brand_name": row.get("brand"),
        "in_stock": in_stock,
    }


# Callaway Golf Preowned encodes internal SKU/grading codes directly
# into the product title (e.g. "MAVRIK MAX 20 Fairway Wood -
# CG|FWMAVRKMAX|AV|Right Hand|3 Wood|Stiff / Average") — confirmed via
# a full audit of the real feed (4,169 rows, 4 Sept 2026): every single
# title reliably has exactly one " - " separating the real model name
# from the internal codes, and ends with " / {grade}" where {grade} is
# one of exactly 4 real values (Average/Good/Very Good/Like New) for
# 2,908 products, or "One-Color" for the remaining 1,261 (genuinely
# preowned items without a specific grade recorded in the feed — never
# fabricated, just labelled generically as "Preowned").
PREOWNED_GRADE_VALUES = {"Average", "Good", "Very Good", "Like New"}

def extract_preowned_title_and_condition(raw_title):
    """Returns (clean_name, condition_label) from a Callaway Golf
    Preowned-style title. condition_label is always a real, honest
    value — either a specific verified grade, or the generic
    "Preowned" fallback when no specific grade is present in the feed,
    never invented."""
    condition_label = "Preowned"
    title = raw_title or ""
    if " / " in title:
        base, suffix = title.rsplit(" / ", 1)
        suffix = suffix.strip()
        if suffix in PREOWNED_GRADE_VALUES:
            condition_label = suffix
        title = base
    if " - " in title:
        title = title.split(" - ", 1)[0]
    return title.strip(), condition_label


# Affordable Golf sells thousands of second-hand clubs alongside new stock
# and its feed doesn't say which is which. Every second-hand item's photo is
# named after its stock code, starting "sh-" ("sh-ek74643a.jpg"); no new item's
# is. Checked across their whole feed (Oct 2026): 4,698 listings, all
# second-hand, matching their "Second Hand" pages on the website.
AFFORDABLE_SECONDHAND_IMAGE = re.compile(r"/sh-[^/]*$", re.I)


def is_affordable_secondhand(p):
    image = (p.get("image") or "").split("?")[0]
    return p.get("source") == "awin-affordablegolf" and bool(AFFORDABLE_SECONDHAND_IMAGE.search(image))


def mark_secondhand(products):
    """Run on the whole catalogue every time, so a second-hand listing is
    labelled even on a run where its retailer's feed failed to download."""
    n = 0
    for p in products:
        if not p.get("condition") and is_affordable_secondhand(p):
            p["condition"] = "Used"
            n += 1
    # Oct 2026: Scottsdale's used clubs ("... Golf Driver - Used") were
    # reaching search and shop pages without a condition, because the
    # "- Used" check only ran on freshly fetched titles. Label them here too.
    m = 0
    for p in products:
        if not p.get("condition") and re.search(r"\s-\s*Used\s*$", p.get("name") or "", re.IGNORECASE):
            p["condition"] = "Used"
            m += 1
    if n:
        print(f"Second-hand: labelled {n} Affordable Golf second-hand listing(s) as Used.")
    if m:
        print(f"Second-hand: labelled {m} listing(s) ending in '- Used' as Used.")
    return products


def detect_generic_used_suffix(raw_title):
    """Generic fallback for ordinary (non-dedicated-preowned-marketplace)
    retailers whose feed marks an individual used item with a plain
    trailing "- Used" suffix on the name, rather than a structured
    condition/grade field. Confirmed via a full audit of Scottsdale
    Golf's real catalog: 126 of 3,102 products match, zero false
    positives — the match requires "Used" to be the final word after a
    hyphen at the very end of the name, so a name like "Dazed &
    Transfused Performance Jersey Polo Shirt" correctly does NOT match
    just because it contains the substring "used".
    Returns (clean_name, condition_label). condition_label is None
    (and clean_name is the original title, unchanged) whenever there's
    no genuine used-suffix match, so ordinary new-stock items never get
    a condition field fabricated for them."""
    title = raw_title or ""
    match = re.search(r"\s*-\s*Used\s*$", title, re.IGNORECASE)
    if not match:
        return title, None
    return title[:match.start()].strip(), "Used"


def fetch_awin_generic_feed(retailer_label, env_var_name, source_slug, feed_format="awin_classic", is_preowned_marketplace=False):
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
        if feed_format == "google_shopping":
            row = normalize_google_shopping_row(row)
        preowned_condition = None
        if is_preowned_marketplace:
            clean_name, preowned_condition = extract_preowned_title_and_condition(row.get("product_name"))
            row["product_name"] = clean_name
        else:
            clean_name, generic_condition = detect_generic_used_suffix(row.get("product_name"))
            if generic_condition:
                row["product_name"] = clean_name
                preowned_condition = generic_condition
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

        # Usually merchant_image_url; for Scottsdale's broken old addresses,
        # another image column from the same feed if there is one.
        image = retailer_images.choose_image(row)
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
        elif retailer_images.needs_fixing(row.get("merchant_image_url")):
            # Scottsdale photo that no longer exists: clear any old address
            # kept from earlier runs (None removes it in merge_products).
            product["image"] = None
        product["icon"] = icon
        if not preowned_condition and is_affordable_secondhand(product):
            preowned_condition = "Used"
        if preowned_condition:
            product["condition"] = preowned_condition
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
    """Major Golf Direct — second AWIN retailer onboarded. Uses a
    genuinely different feed format from the other AWIN retailers — a
    Google Merchant Center-style feed via AWIN's "My Google Feed" /
    Darwin download system, not AWIN's own classic Create-a-Feed. See
    normalize_google_shopping_row for the column mapping, and
    fetch_awin_generic_feed for the shared downstream implementation."""
    return fetch_awin_generic_feed("Major Golf Direct", "AWIN_MAJORGOLF_FEED_URL", "majorgolf", feed_format="google_shopping")


def fetch_awin_callaway_deals():
    """Callaway Europe — third AWIN retailer onboarded. See
    fetch_awin_generic_feed for the shared implementation."""
    return fetch_awin_generic_feed("Callaway Europe", "AWIN_CALLAWAY_FEED_URL", "callaway")


def fetch_awin_affordablegolf_deals():
    """Affordable Golf — fourth AWIN retailer onboarded, via AWIN's
    classic Create-a-Feed system (same URL structure — productdata.awin.com
    — as Clickgolf and Callaway, unlike Major Golf Direct's Google-format
    feed). See fetch_awin_generic_feed for the shared implementation."""
    return fetch_awin_generic_feed("Affordable Golf", "AWIN_AFFORDABLEGOLF_FEED_URL", "affordablegolf")


def fetch_awin_scottsdalegolf_deals():
    """Scottsdale Golf — fifth AWIN retailer onboarded, via AWIN's
    classic Create-a-Feed system. See fetch_awin_generic_feed for the
    shared implementation."""
    products = fetch_awin_generic_feed("Scottsdale Golf", "AWIN_SCOTTSDALEGOLF_FEED_URL", "scottsdalegolf")
    if products:
        print(retailer_images.report(products))
    return products


def fetch_awin_callawaypreowned_deals():
    """Callaway Golf Preowned — sixth AWIN retailer onboarded. Same
    Google Merchant Center-style feed format as Major Golf Direct, but
    ALSO needs its own title-cleaning/condition-extraction (see
    extract_preowned_title_and_condition) since this retailer bakes
    internal SKU and grading codes directly into the title field — a
    convention specific to this one retailer, not applied to any other
    google_shopping-format feed."""
    return fetch_awin_generic_feed(
        "Callaway Golf Preowned", "AWIN_CALLAWAYPREOWNED_FEED_URL", "callawaypreowned",
        feed_format="google_shopping", is_preowned_marketplace=True,
    )


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
        # One listing = one retailer's product. Identical names at two
        # different retailers are two listings, never merged (since Oct 2026;
        # merging them made them share one price history).
        key = (p.get("source"), p.get("_mpu") or p["name"])
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
    by_key = {identity.listing_key(p): p for p in catalog_products}
    for item in fresh_products:
        key = identity.listing_key(item)
        if key in by_key:
            existing = by_key[key]
            existing.update(item)
            for k, value in item.items():
                if value is None:
                    existing.pop(k, None)
        else:
            by_key[key] = {k: v for k, v in item.items() if v is not None}
    return list(by_key.values())


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
    INDEX_FILE.write_text(json.dumps(history))


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


# How many real product examples to surface under each category's trend
# stats — deliberately small, these are meant as concrete proof of the
# trend, not a mini shop grid.
TOP_MOVERS_PER_CATEGORY = 2


def compute_category_top_movers(products):
    """Turns the Fairway Index from an abstract percentage into concrete,
    clickable proof — the actual products whose price has moved the most
    within each category. Reuses `priceInsight` (already computed by
    record_and_score_prices) rather than inventing a second, separate
    measure of "moved" — a product only qualifies if verifiedDiscount is
    already true, meaning a genuinely higher price was actually recorded
    for it, not a guess or an unverified retailer RRP claim."""
    by_category = {}
    for p in products:
        insight = p.get("priceInsight")
        if not insight or not insight.get("verifiedDiscount"):
            continue
        cat = p.get("category")
        if cat not in INDEX_CATEGORIES or not p.get("image"):
            continue
        high = insight.get("historicalHigh")
        current = p.get("salePrice")
        if not high or not current or high <= 0:
            continue
        drop_pct = round((high - current) / high * 100)
        by_category.setdefault(cat, []).append((drop_pct, p))

    result = {}
    for cat, entries in by_category.items():
        entries.sort(key=lambda t: t[0], reverse=True)
        top = entries[:TOP_MOVERS_PER_CATEGORY]
        result[cat] = [
            {
                "name": p["name"], "image": p.get("image"), "salePrice": p["salePrice"],
                "affiliateUrl": p["affiliateUrl"], "dropPct": drop_pct,
            }
            for drop_pct, p in top
        ]
    return result



# ============================================================
# Complete The Look — real colour theory assembling genuine outfit
# sets from live, currently-cheapest matching products. Same underlying
# "pick genuinely available, currently-lowest items per slot" pattern as
# Complete The Kit below, with a colour-compatibility check layered on
# top so the assembled pieces actually work together, not just happen to
# share a category.
#
# COLOUR THEORY, KEPT DELIBERATELY SIMPLE: real colour-wheel positions
# for the palette already extracted on every apparel product (see
# COLOUR_KEYWORDS above) — no new data source needed, this reuses what's
# already there. Two colours are treated as compatible if either is a
# neutral (goes with almost anything by convention — navy included,
# since it functions as a neutral in golf/prep style specifically), or
# if their hue angle is close (analogous — cohesive) or near-opposite
# (complementary — a deliberate, confident contrast). Anything landing
# in between (a "clashing" zone) is rejected — no outfit gets forced
# together just to fill a slot.
# ============================================================
COLOUR_HUE_ANGLES = {
    "red": 0, "brown": 40, "orange": 60, "gold": 90, "yellow": 120,
    "khaki": 130, "olive": 150, "green": 180, "blue": 240, "purple": 300,
    "pink": 330,
}
# Neutrals pair safely with virtually anything — standard styling
# convention, and navy is included deliberately since it functions as a
# practical neutral in golf apparel specifically (as common a "base"
# colour as black or grey in this context).
NEUTRAL_COLOURS = {
    "black", "white", "grey", "gray", "navy", "beige", "silver",
    "charcoal", "cream", "stone", "tan",
}
ANALOGOUS_MAX_ANGLE = 65
COMPLEMENTARY_MIN_ANGLE = 150


def colours_are_compatible(colour_a, colour_b):
    """Whether two colours genuinely work together, using real colour-
    wheel relationships rather than a guess. Same colour, or either being
    a neutral, always passes. Otherwise checks for an analogous (close
    hue, cohesive) or complementary (near-opposite hue, confident
    contrast) relationship — anything else is treated as a clash and
    rejected outright."""
    if not colour_a or not colour_b:
        return False
    a, b = colour_a.lower(), colour_b.lower()
    if a == b:
        return True
    if a in NEUTRAL_COLOURS or b in NEUTRAL_COLOURS:
        return True
    angle_a = COLOUR_HUE_ANGLES.get(a)
    angle_b = COLOUR_HUE_ANGLES.get(b)
    if angle_a is None or angle_b is None:
        return False  # an unmapped colour word — don't guess, treat as incompatible
    diff = abs(angle_a - angle_b)
    diff = min(diff, 360 - diff)  # shortest distance around the wheel
    return diff <= ANALOGOUS_MAX_ANGLE or diff >= COMPLEMENTARY_MIN_ANGLE


# Ranks HOW deliberately-styled a colour pairing reads, not just whether
# it passes the compatibility check. This is what lets outfit assembly
# prefer a genuine same-colour or complementary pairing over "well, one
# of them is grey so technically it's fine" — Complete The Look is meant
# to suggest considered style pairings, not just clear the lowest bar of
# "doesn't clash". Assumes colours_are_compatible() has already been
# checked true; behaviour is undefined for a genuine clash.
#   4 = same colour (deliberate monochrome)
#   3 = complementary (classic, confident colour-wheel contrast)
#   2 = analogous (adjacent hues, cohesive)
#   1 = neutral-led (safe and wearable, but the least "styled" pairing —
#       used as a fallback, never the first choice, when a genuine
#       colour relationship is available instead)
def pairing_quality(colour_a, colour_b):
    a, b = colour_a.lower(), colour_b.lower()
    if a == b:
        return 4
    if a in NEUTRAL_COLOURS or b in NEUTRAL_COLOURS:
        return 1
    angle_a = COLOUR_HUE_ANGLES.get(a)
    angle_b = COLOUR_HUE_ANGLES.get(b)
    if angle_a is None or angle_b is None:
        return 1
    diff = abs(angle_a - angle_b)
    diff = min(diff, 360 - diff)
    if diff >= COMPLEMENTARY_MIN_ANGLE:
        return 3
    if diff <= ANALOGOUS_MAX_ANGLE:
        return 2
    return 1


# ============================================================
# Complete The Look (data/outfits.json)
#
# Rebuilt 15 Oct 2026 after customer feedback: "The Classic Look" showed
# twice, the same navy Nilsson polo was in 4 looks (its size variants
# weren't treated as one product) and junior items got in.
#
# How it works now:
#   * About 24 named looks, each with its own rules: which item types,
#     a colour palette, a price level, style words to require or prefer,
#     an audience (men's/unisex or women's) and, for some, a season.
#   * Item types are matched on the feed's icon AND the words in the
#     name, because the icon alone is unreliable (some hoodies are
#     tagged as trousers, some jumpers as polos).
#   * Every product appears ONCE across the whole page: sizes and
#     colours of the same item count as the same product (name before
#     " - "). No junior, no second-hand, in stock, real photo.
#   * Colours still have to work together (the colour-wheel rules
#     above), on top of each look's own palette.
#   * Looks with scarce ingredients (knit vests, bucket hats, Christmas
#     jumpers...) choose first; the page order is set separately.
#   * A look that can't be filled properly is hidden for the run, never
#     padded out. Picks rotate daily among the best few.
# ============================================================

LOOK_JUNIOR_WORDS = ("junior", "youth", "kids", "kid's", "boys", "girls", "child", "toddler")
LOOK_PREMIUM_BRANDS = ("peter millar", "g/fore", "j lindeberg", "galvin green", "travismathew", "kjus",
                       "boss", "malbon", "castore", "ralph lauren", "rlx", "lyle & scott", "oscar jacobson",
                       "original penguin", "calvin klein", "psycho bunny", "greyson", "holderness")
LOOK_APPAREL_BRANDS = LOOK_PREMIUM_BRANDS + (
    "adidas", "footjoy", "under armour", "ping", "puma", "callaway", "nike", "proquip", "stuburt", "mizuno",
    "glenmuir", "titleist", "taylormade", "sunderland", "reflo", "island green", "forelson", "oakley",
    "wilson", "cobra", "rohnisch", "ashworth", "abacus", "srixon", "ecco", "skechers", "cutter & buck",
    "ben hogan", "farah", "ellesse", "green lamb", "swing out sister", "tommy hilfiger", "greg norman",
    "nilsson", "druids", "sunice", "zerofit", "2undr", "vega", "spurk", "lija")

# Every item type a look can ask for: feed icons/categories it may come
# from, words the name must contain, words that rule it out, and a
# normal price band with a "sweet spot" price.
LOOK_KINDS = {
    "polo": {"icons": ("polo",), "words": ("polo", "shirt"),
             "not": ("hoodie", "jumper", "sweater", "zip", "jacket", "vest", "pullover", "trouser", "short",
                     "skort", "dress", "layer", "crew neck", "crewneck", "long sleeve", "sweatshirt"),
             "band": (20, 95), "target": 45},
    "print-polo": {"icons": ("polo",), "words": ("print", "printed", "floral", "tropical", "palm", "paisley",
                                                 "hawaiian", "aloha", "camo", "geo"),
                   "also": ("polo", "shirt"),
                   "not": ("hoodie", "jumper", "zip", "jacket", "vest", "trouser", "short", "skort", "dress",
                           "layer", "long sleeve"),
                   "band": (20, 95), "target": 45},
    "trousers": {"icons": ("trousers",), "words": ("trouser", "trousers", "pant", "pants", "chino", "chinos"),
                 "not": ("short", "hoodie", "jacket", "polo", "skort", "jogger", "rain", "waterproof",
                         "thermal", "base layer", "sweat", "track"),
                 "band": (30, 120), "target": 60},
    "joggers": {"icons": ("trousers",), "words": ("jogger", "joggers"), "not": ("short", "hoodie", "jacket"),
                "band": (25, 120), "target": 55},
    "rain-trousers": {"icons": ("trousers",), "words": ("waterproof", "rain", "gore-tex", "goretex", "hydro",
                                                       "storm", "paclite"),
                      "also": ("trouser", "trousers", "pant", "pants"), "not": ("short", "jacket", "suit"),
                      "band": (30, 200), "target": 80},
    "warm-trousers": {"icons": ("trousers",), "words": ("thermal", "thermo", "winter", "warm", "fleece",
                                                       "insulated", "lined"),
                      "also": ("trouser", "trousers", "pant", "pants"), "not": ("short", "jacket"),
                      "band": (30, 150), "target": 70},
    "shorts": {"icons": ("shorts",), "words": ("short", "shorts"),
               "not": ("skort", "trouser", "polo", "zip", "sleeve", "base layer"),
               "band": (20, 75), "target": 40},
    "print-shorts": {"icons": ("shorts",), "words": ("print", "printed", "floral", "tropical", "palm", "camo",
                                                    "pattern", "check"),
                     "also": ("short", "shorts"), "not": ("skort", "trouser", "polo"),
                     "band": (20, 80), "target": 45},
    "skort": {"icons": ("skort",), "words": ("skort", "skirt"), "band": (25, 90), "target": 50},
    "midlayer": {"icons": ("jacket", "polo"), "words": ("1/4 zip", "quarter zip", "half zip", "1/2 zip",
                                                         "mid layer", "midlayer", "pullover", "sweater", "jumper",
                                                         "crew neck", "crewneck", "knit", "cardigan"),
                 "not": ("vest", "gilet", "slipover", "hoodie", "hoody", "trouser", "short", "rain",
                         "waterproof", "christmas", "festive", "sleeveless", "base layer", "baselayer"),
                 "band": (35, 140), "target": 70},
    "knit-vest": {"icons": ("jacket", "polo"), "words": ("knit vest", "knitted vest", "sweater vest", "slipover",
                                                         "knit golf vest", "full zip knit vest"),
                  "band": (40, 180), "target": 85},
    "gilet": {"icons": ("jacket",), "words": ("vest", "gilet"),
              "not": ("knit", "knitted", "slipover", "sweater vest", "base"),
              "band": (40, 200), "target": 80},
    "wind-layer": {"icons": ("jacket",), "words": ("wind", "windproof", "windbreaker", "wind.rdy"),
                   "not": ("vest", "gilet", "trouser", "polo"), "band": (40, 220), "target": 90},
    "rain-jacket": {"icons": ("jacket",), "words": ("waterproof", "rain", "gore-tex", "goretex", "hydrolite",
                                                   "hydroseries", "paclite", "storm"),
                    "also": ("jacket", "top", "smock", "anorak"),
                    "not": ("vest", "gilet", "trouser", "bag", "umbrella", "suit", "short"),
                    "band": (50, 320), "target": 140},
    "warm-jacket": {"icons": ("jacket",), "words": ("thermal", "thermo", "insulated", "padded", "quilted",
                                                   "puffer", "fleece", "winter"),
                    "not": ("vest", "gilet", "trouser", "polo", "snood"),
                    "band": (50, 250), "target": 110},
    "hoodie": {"icons": ("hoodie",), "words": ("hoodie", "hoody", "hooded"),
               "not": ("trouser", "jogger", "polo", "jacket", "waterproof"), "band": (30, 110), "target": 55},
    "base-layer": {"icons": ("base-layer", "jacket", "polo"), "words": ("base layer", "baselayer",
                                                                         "thermal top", "mock neck", "mock"),
                   "not": ("trouser", "legging", "short", "vest", "snood", "neck warmer"),
                   "band": (15, 70), "target": 35},
    "christmas-jumper": {"icons": ("jacket", "polo", "accessories", None), "words": ("christmas", "festive"),
                         "also": ("jumper", "sweater", "pullover", "knit"), "band": (30, 120), "target": 60},
    "cap": {"icons": ("cap",), "words": ("cap",), "not": ("bucket", "beanie", "visor", "bobble", "marker",
                                                         "clip"), "band": (12, 35), "target": 22},
    "bucket-hat": {"icons": ("cap",), "words": ("bucket",), "band": (14, 45), "target": 25},
    "beanie": {"icons": ("cap",), "words": ("beanie", "bobble"), "not": ("gift set", "set"),
               "band": (12, 35), "target": 20},
    "visor": {"icons": ("cap",), "words": ("visor",), "band": (12, 35), "target": 20},
    "snood": {"icons": ("accessories", "jacket", "base-layer", "cap"), "words": ("snood", "neck warmer",
                                                                               "neckwarmer"),
              "not": ("gift set",), "band": (10, 35), "target": 20},
    "mitts": {"icons": ("glove", "accessories", "base-layer", "jacket"), "words": ("mitts", "mittens", "mitt"),
              "not": ("trolley", "pushcart"), "band": (14, 45), "target": 25},
    "belt": {"icons": ("belt",), "words": ("belt",), "band": (15, 70), "target": 30},
    "socks": {"icons": ("socks",), "words": ("sock", "socks"), "not": ("training", "running"),
              "band": (6, 22), "target": 11},
    "sunglasses": {"icons": ("sunglasses",), "words": ("sunglasses", "glasses", "eyewear", "shades"),
                   "band": (20, 180), "target": 60},
    "shoes": {"categories": ("shoes",), "words": ("golf shoe", "golf shoes", "spikeless", "spiked", "golf boot"),
              "not": ("trainer", "trainers", "sandal", "slide", "wrench", "bag", "laces", "spikes only"),
              "band": (60, 190), "target": 110},
}

BOLD_COLOURS = ("red", "orange", "yellow", "gold", "green", "blue", "purple", "pink")
NEUTRAL_LIST = ("black", "white", "grey", "navy", "charcoal", "stone", "beige", "cream", "silver", "tan")

# Price levels scale each kind's normal band and sweet spot.
LOOK_PRICE_LEVELS = {
    "budget":  {"band": (0.4, 0.75), "target": 0.5},
    "mid":     {"band": (1.0, 1.0), "target": 1.0},
    "smart":   {"band": (1.0, 1.4), "target": 1.25},
    "premium": {"band": (1.4, 2.6), "target": 2.0},
}


def _look_slot(label, kind, **extra):
    return {"label": label, "kind": kind, **extra}


# Order here = the order looks choose their products (scarcest first).
# "show" sets the order on the page.
OUTFIT_TEMPLATES = [
    {"id": "christmas-jumper-round", "show": 23, "title": "🎄 The Christmas Jumper Round",
     "blurb": "One round a year where the dress code is 'festive'. Make it count.",
     "months": (12,), "palette": None, "price": "mid",
     "slots": [_look_slot("Christmas Jumper", "christmas-jumper", any_colour=True), _look_slot("Trousers", "trousers"),
               _look_slot("Beanie", "beanie")]},
    {"id": "old-money", "tonal": True, "show": 13, "title": "⛵ The Old Money",
     "blurb": "Cream, navy and a knitted vest. Looks like the family has owned the course since 1890.",
     "palette": ("cream", "navy", "white", "stone", "beige", "grey", "charcoal", "green", "red", "blue"),
     "price": "smart", "prefer_brands": LOOK_PREMIUM_BRANDS + ("glenmuir", "footjoy", "proquip"),
     "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "slots": [_look_slot("Knitted Vest", "knit-vest"), _look_slot("Polo", "polo", palette=("white", "cream", "navy", "stone", "beige")),
               _look_slot("Trousers", "trousers", palette=("navy", "stone", "beige", "cream", "grey", "charcoal"))]},
    {"id": "florida-dad", "show": 10, "title": "🌴 The Florida Dad",
     "blurb": "Loud print, short shorts, bucket hat. Has opinions about the clubhouse burger.",
     "palette": None, "price": "mid", "anchor_bold": True,
     "slots": [_look_slot("Printed Polo", "print-polo"),
               _look_slot("Shorts", "shorts", palette=BOLD_COLOURS + ("white", "stone", "beige")),
               _look_slot("Bucket Hat", "bucket-hat")]},
    {"id": "range-rat", "tonal": True, "show": 19, "title": "🏌️ The Range Rat",
     "blurb": "Joggers, hoodie, cap. Here to hit 200 balls and not talk to anyone.",
     "palette": ("black", "grey", "charcoal", "navy", "white", "green", "blue", "olive"), "price": "mid",
     "slots": [_look_slot("Hoodie", "hoodie"), _look_slot("Joggers", "joggers"), _look_slot("Cap", "cap")]},
    {"id": "frost-delay", "tonal": True, "show": 22, "title": "🥶 The 7am Frost Delay",
     "blurb": "Thermal everything. You'll be warm while everyone else stands about in the car park.",
     "palette": ("black", "navy", "charcoal", "grey", "green", "blue", "olive"), "price": "mid",
     "slots": [_look_slot("Base Layer", "base-layer"), _look_slot("Insulated Layer", "warm-jacket"),
               _look_slot("Winter Trousers", "warm-trousers"), _look_slot("Mitts", "mitts")]},
    {"id": "links-warrior", "show": 17, "title": "🌬️ The Links Warrior",
     "blurb": "Windproof layers and a beanie for when the 1st tee is basically a wind tunnel.",
     "palette": ("navy", "black", "charcoal", "grey", "green", "olive", "blue", "red"), "price": "mid",
     "slots": [_look_slot("Wind Layer", "wind-layer"), _look_slot("Trousers", "trousers"),
               _look_slot("Beanie", "beanie"), _look_slot("Snood", "snood")]},
    {"id": "tour-tryhard", "show": 15, "title": "🏆 The Tour Tryhard",
     "blurb": "Head to toe in one brand. Plays off 24, dresses like he's on the Ryder Cup team.",
     "palette": None, "price": "smart", "one_brand": True,
     "slots": [_look_slot("Polo", "polo"), _look_slot("Trousers", "trousers"), _look_slot("Cap", "cap"),
               _look_slot("Belt", "belt")]},
    {"id": "monochrome-assassin", "tonal": True, "show": 12, "title": "🖤 The Monochrome Assassin",
     "blurb": "All black, no fuss. Says nothing, takes your money on the 18th.",
     "palette": ("black",), "price": "smart",
     "slots": [_look_slot("Polo", "polo"), _look_slot("Trousers", "trousers"), _look_slot("Cap", "cap"),
               _look_slot("Belt", "belt")]},
    {"id": "big-spender", "show": 11, "title": "💸 The Big Spender",
     "blurb": "Premium labels, top of the price range. The swing is optional.",
     "palette": ("navy", "white", "black", "grey", "charcoal", "stone", "beige", "blue", "green"),
     "price": "premium", "brands": LOOK_PREMIUM_BRANDS,
     "slots": [_look_slot("Polo", "polo"), _look_slot("Mid Layer", "midlayer"), _look_slot("Trousers", "trousers")]},
    {"id": "ladies-captain", "show": 8, "title": "💐 The Ladies' Captain", "audience": "Female",
     "blurb": "Polished, coordinated and clubhouse-ready. Also running the committee meeting afterwards.",
     "palette": ("white", "navy", "black", "grey", "stone", "beige", "cream", "pink", "blue"), "price": "smart",
     "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "slots": [_look_slot("Polo", "polo"), _look_slot("Skort or Trousers", "skort", alt_kind="trousers"),
               _look_slot("Visor or Cap", "visor", alt_kind="cap")]},
    {"id": "power-fader", "show": 14, "title": "⚡ The Power Fader", "audience": "Female",
     "blurb": "Sporty, modern and one bold colour. The drive goes left to right on purpose.",
     "palette": BOLD_COLOURS + ("white", "black", "navy"), "price": "mid", "anchor_bold": True,
     "slots": [_look_slot("Polo", "polo"), _look_slot("Skort or Shorts", "skort", alt_kind="shorts"),
               _look_slot("Cap", "cap", alt_kind="visor")]},
    {"id": "retro-revival", "show": 16, "title": "📼 The Retro Revival",
     "blurb": "Bold colours straight out of an 80s pro shop. Mullet sold separately.",
     "palette": BOLD_COLOURS + ("white", "navy", "black"), "price": "mid", "anchor_bold": True,
     "prefer_words": ("retro", "heritage", "stripe", "striped", "block", "vintage", "classic", "throwback"),
     "slots": [_look_slot("Polo", "polo"), _look_slot("Trousers", "trousers"), _look_slot("Cap", "cap"),
               _look_slot("Socks", "socks")]},
    {"id": "scandi-minimalist", "tonal": True, "show": 18, "title": "❄️ The Scandi Minimalist",
     "blurb": "Muted neutrals, clean lines, nothing shouty. Probably brought a flask of oat latte.",
     "palette": ("grey", "stone", "beige", "cream", "charcoal", "white", "black", "silver"), "price": "smart",
     "prefer_brands": ("j lindeberg", "galvin green", "oscar jacobson", "kjus", "rohnisch", "abacus"),
     "slots": [_look_slot("Mid Layer", "midlayer"), _look_slot("Trousers", "trousers"), _look_slot("Cap", "cap")]},
    {"id": "society-day-hero", "show": 20, "title": "🍺 The Society Day Hero",
     "blurb": "Smart enough for the clubhouse, comfy enough for the 19th hole that follows.",
     "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "palette": ("navy", "white", "grey", "stone", "blue", "green", "charcoal"), "price": "mid",
     "slots": [_look_slot("Polo", "polo"), _look_slot("Quarter Zip", "midlayer"),
               _look_slot("Trousers", "trousers"), _look_slot("Belt", "belt")]},
    {"id": "first-tee", "show": 21, "title": "🌱 The First Tee",
     "blurb": "Everything a beginner needs to look the part without spending a fortune.",
     "palette": ("navy", "black", "white", "grey", "blue", "green"), "price": "budget", "any_brand": True,
     "slots": [_look_slot("Polo", "polo"), _look_slot("Trousers", "trousers", contrast=True), _look_slot("Cap", "cap")]},
    # The nine originals, cleaned up.
    {"id": "classic", "show": 1, "title": "🏌️ The Classic Look",
     "blurb": "Polo, trousers, cap. Never wrong, never out of date.",
     "palette": ("navy", "white", "black", "grey", "stone"), "price": "mid", "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "slots": [_look_slot("Polo", "polo", palette=("navy", "white", "grey", "stone")),
               _look_slot("Trousers", "trousers", contrast=True), _look_slot("Cap", "cap")]},
    {"id": "rain-ready", "show": 4, "title": "🌧️ The Rain Ready",
     "blurb": "Proper waterproofs and a bucket hat, because it's the UK and it's always about to rain.",
     "palette": ("black", "navy", "charcoal", "grey", "olive", "blue", "green"), "price": "mid",
     "slots": [_look_slot("Waterproof Jacket", "rain-jacket"), _look_slot("Waterproof Trousers", "rain-trousers"),
               _look_slot("Bucket Hat", "bucket-hat", alt_kind="cap")]},
    {"id": "cold-morning", "show": 9, "title": "🧣 The Cold Morning",
     "blurb": "Layers that keep you warm for the first nine and come off by the turn.",
     "palette": ("navy", "charcoal", "grey", "black", "olive", "green", "brown", "khaki"), "price": "mid",
     "slots": [_look_slot("Base Layer", "base-layer"), _look_slot("Mid Layer", "midlayer"),
               _look_slot("Trousers", "trousers"), _look_slot("Beanie", "beanie")]},
    {"id": "smart-layer", "show": 3, "title": "🧥 The Smart Layer",
     "blurb": "A crisp polo under a quarter zip. Smart from the car park to the clubhouse.",
     "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "palette": ("navy", "charcoal", "grey", "black", "white", "blue"), "price": "mid",
     "slots": [_look_slot("Polo", "polo"), _look_slot("Quarter Zip", "midlayer", contrast=True),
               _look_slot("Trousers", "trousers")]},
    {"id": "sharp-dresser", "show": 6, "title": "🎩 The Sharp Dresser",
     "blurb": "Dark, tailored and finished with a proper belt. Dress for the handicap you want.",
     "palette": ("black", "navy", "charcoal", "grey", "white"), "price": "smart", "avoid_words": ("print", "printed", "camo", "floral", "geo", "graphic", "tropical"),
     "slots": [_look_slot("Polo", "polo", palette=("black", "navy", "charcoal", "grey")),
               _look_slot("Trousers", "trousers", palette=("black", "navy", "charcoal", "grey")),
               _look_slot("Belt", "belt"), _look_slot("Golf Shoes", "shoes")]},
    {"id": "off-duty", "show": 7, "title": "😌 The Off-Duty",
     "blurb": "Hoodie, trousers, cap. For the casual nine after work.",
     "palette": ("grey", "black", "olive", "navy", "khaki", "charcoal", "green"), "price": "mid",
     "slots": [_look_slot("Hoodie", "hoodie"), _look_slot("Trousers", "trousers"), _look_slot("Cap", "cap")]},
    {"id": "full-package", "show": 5, "title": "🧦 The Full Package",
     "blurb": "Cap to shoes, socks included. One less thing to think about on the 1st tee.",
     "palette": ("navy", "white", "black", "grey", "blue", "green", "red"), "price": "mid",
     "slots": [_look_slot("Cap", "cap"), _look_slot("Polo", "polo"), _look_slot("Trousers", "trousers", contrast=True),
               _look_slot("Golf Shoes", "shoes")]},
    {"id": "weekend-casual", "show": 2, "title": "😎 The Weekend Casual",
     "blurb": "Polo, shorts and a cap for a relaxed Saturday nine.",
     "palette": ("blue", "green", "white", "navy", "grey", "red", "pink"), "price": "mid", "anchor_bold": True,
     "slots": [_look_slot("Polo", "polo"), _look_slot("Shorts", "shorts"), _look_slot("Cap", "cap")]},
    {"id": "sun-seeker", "show": 24, "title": "🕶️ The Sun Seeker",
     "blurb": "Light colours, shorts and shades. For the three sunny days the UK gets each year.",
     "palette": ("white", "blue", "pink", "yellow", "orange", "green", "grey", "navy"), "price": "mid",
     "slots": [_look_slot("Polo", "polo"), _look_slot("Shorts", "shorts"), _look_slot("Sunglasses", "sunglasses", any_colour=True)]},
]



# The feed's own "colour" field is read from anywhere in the name, so
# "Galvin Green ... - Black" comes out as Green and "Wine" isn't
# recognised at all. Complete The Look reads colour from the variant
# part of the name (after " - "), with golf-retail colour names mapped
# to plain ones. Unknown colour = not used in a colour-matched slot.
LOOK_COLOUR_WORDS = [
    # longest phrases first
    ("off white", "cream"), ("off-white", "cream"), ("collegiate navy", "navy"), ("dark navy", "navy"),
    ("jet black", "black"), ("true navy", "navy"), ("fairway green", "green"), ("british racing green", "green"),
    ("oxford blue", "navy"), ("steel blue", "blue"), ("light grey", "grey"), ("dark grey", "charcoal"),
    ("black", "black"), ("onyx", "black"), ("white", "white"), ("ivory", "cream"), ("ecru", "cream"),
    ("cream", "cream"), ("oatmeal", "beige"), ("sand", "beige"), ("beige", "beige"), ("camel", "tan"),
    ("tan", "tan"), ("khaki", "khaki"), ("stone", "stone"), ("putty", "stone"), ("taupe", "stone"),
    ("navy", "navy"), ("midnight", "navy"), ("ink", "navy"), ("grey", "grey"), ("gray", "grey"),
    ("heather", "grey"), ("slate", "grey"), ("steel", "grey"), ("ash", "grey"), ("silver", "silver"),
    ("pewter", "grey"), ("charcoal", "charcoal"), ("graphite", "charcoal"), ("carbon", "charcoal"),
    ("asphalt", "charcoal"), ("gunmetal", "charcoal"), ("blue", "blue"), ("royal", "blue"), ("cobalt", "blue"),
    ("teal", "blue"), ("aqua", "blue"), ("turquoise", "blue"), ("sky", "blue"), ("red", "red"),
    ("wine", "red"), ("burgundy", "red"), ("maroon", "red"), ("cardinal", "red"), ("scarlet", "red"),
    ("claret", "red"), ("crimson", "red"), ("green", "green"), ("lime", "green"), ("forest", "green"),
    ("sage", "green"), ("mint", "green"), ("emerald", "green"), ("olive", "olive"), ("yellow", "yellow"),
    ("lemon", "yellow"), ("mustard", "yellow"), ("gold", "gold"), ("orange", "orange"), ("tango", "orange"),
    ("rust", "orange"), ("coral", "pink"), ("pink", "pink"), ("fuchsia", "pink"), ("magenta", "pink"),
    ("rose", "pink"), ("purple", "purple"), ("violet", "purple"), ("lilac", "purple"), ("lavender", "purple"),
    ("plum", "purple"), ("brown", "brown"), ("chocolate", "brown"), ("mocha", "brown"),
]
LOOK_BRAND_COLOUR_TRAPS = ("galvin green", "green lamb", "greyson", "blue tees", "black clover", "red bull")


def _look_colours(p):
    """All plain colours in the product's variant text, in order."""
    name = (p.get("name") or "").lower()
    for trap in LOOK_BRAND_COLOUR_TRAPS:
        name = name.replace(trap, " ")
    parts = re.split(r"\s-\s|\s-(?=\s?\w)|-\s", name, maxsplit=1)
    text = parts[1] if len(parts) > 1 else parts[0]
    found = []
    for word, plain in LOOK_COLOUR_WORDS:
        for m in re.finditer(r"\b" + re.escape(word) + r"\b", text):
            found.append((m.start(), plain))
            text = text[:m.start()] + " " * len(word) + text[m.end():]
    found.sort()
    out = []
    for _, plain in found:
        if plain not in out:
            out.append(plain)
    return out


def _look_display_name(p):
    name = _kit_display_name(p)
    head, sep, tail = name.rpartition(" - ")
    if sep:  # sizes only ever sit in the variant part: "Black / 38\" / Long" -> "Black"
        tail = re.sub(r"\s+/\s*(\d[^/]*|XXS|XS|S|M|L|XL|XXL|XXXL|S/M|M/L|L/XL|One Size)(\s*/.*)?$", "", tail,
                      flags=re.I)
        name = head + sep + tail
    head, sep, tail = name.rpartition(" - ")
    # "Collegiate Navy Collegiate Navy" -> "Collegiate Navy"
    words = tail.split()
    if sep and len(words) % 2 == 0 and words[:len(words) // 2] == words[len(words) // 2:]:
        name = head + sep + " ".join(words[:len(words) // 2])
    return name.strip()


def _look_words(text):
    return f" {re.sub(r'[^a-z0-9/&+.]+', ' ', (text or '').lower())} "


def _look_has(text, words):
    t = _look_words(text)
    return any(_look_words(w) in t for w in words)


def _look_base(p):
    return (p.get("name") or "").split(" - ")[0].strip().lower()


def _look_brand(p):
    """A normalised brand name, so 'Castore Golf' and 'Castore' match."""
    b = (p.get("brand") or "").strip().lower()
    for known in LOOK_APPAREL_BRANDS:
        if b.startswith(known) or (p.get("name") or "").lower().startswith(known):
            return known
    return b


def _look_ok(p, audience):
    if p.get("inStock") is False or not p.get("image") or not p.get("affiliateUrl"):
        return False
    if is_preowned_partner(p) or "/sh-" in (p.get("image") or ""):
        return False
    if p.get("audience") == "Junior" or _look_has(p.get("name"), LOOK_JUNIOR_WORDS):
        return False
    if p.get("audience") != audience:
        return False
    return (p.get("salePrice") or 0) > 0


def _look_kind_match(p, kind_name):
    kind = LOOK_KINDS[kind_name]
    if kind.get("categories"):
        if p.get("category") not in kind["categories"]:
            return False
    elif p.get("icon") not in kind["icons"]:
        return False
    name = p.get("name") or ""
    if not _look_has(name, kind["words"]):
        return False
    if kind.get("also") and not _look_has(name, kind["also"]):
        return False
    return not (kind.get("not") and _look_has(name, kind["not"]))


def _look_band(kind_name, level):
    kind, lv = LOOK_KINDS[kind_name], LOOK_PRICE_LEVELS[level]
    lo, hi = kind["band"]
    return lo * lv["band"][0], hi * lv["band"][1], kind["target"] * lv["target"]


def _look_rotate(items, key, n=3):
    if not items:
        return None
    top = items[:n]
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return top[int(hashlib.md5(f"{day}:{key}".encode()).hexdigest(), 16) % len(top)]


def _look_pick(pool, template, slot, kind_name, anchor_colour, used, brand=None):
    level = template.get("price", "mid")
    lo, hi, target = _look_band(kind_name, level)
    palette = slot.get("palette") or template.get("palette")
    allowed_brands = template.get("brands")
    prefer_brands = template.get("prefer_brands") or ()
    prefer_words = template.get("prefer_words") or ()
    ranked, seen = [], set()
    for p in pool:
        if not _look_kind_match(p, kind_name):
            continue
        base = _look_base(p)
        if base in used or base in seen:
            continue
        price = p["salePrice"]
        if not (lo <= price <= hi):
            continue
        colours = _look_colours(p)
        colour = colours[0] if colours else ""
        if not slot.get("any_colour"):
            if not colour:
                continue
            if palette and colour not in palette:
                continue
            if len(palette or ()) == 1 and colours != [palette[0]]:
                continue  # all-black means all black, not black/white
            if anchor_colour and not colours_are_compatible(anchor_colour, colour):
                continue
        if template.get("avoid_words") and _look_has(p.get("name"), template["avoid_words"]):
            continue
        b = _look_brand(p)
        if allowed_brands and b not in allowed_brands:
            continue
        if not template.get("any_brand") and not allowed_brands and b not in LOOK_APPAREL_BRANDS:
            continue
        if brand and b != brand:
            continue
        if template.get("anchor_bold") and anchor_colour is None and colour not in BOLD_COLOURS \
                and kind_name not in ("print-polo",):
            continue
        seen.add(base)
        quality = pairing_quality(anchor_colour, colour) if anchor_colour and colour and not slot.get("any_colour") else 2
        if anchor_colour and colour and not template.get("tonal"):
            # Most looks read better with some contrast than head-to-toe
            # one colour: any compatible different colour beats a repeat.
            quality = 2 if colour == anchor_colour else 3
        if slot.get("contrast") and anchor_colour and colour == anchor_colour:
            quality = 0  # this slot should break up the colour, not repeat it
        # The first item sets the look's colour: favour the palette's lead
        # colours, so not every look ends up black.
        lead = (palette.index(colour) // 2) if (anchor_colour is None and palette and colour in palette) else 0
        score = (
            0 if (not prefer_brands or b in prefer_brands) else 1,
            0 if (not prefer_words or _look_has(p.get("name"), prefer_words)) else 1,
            lead,
            -quality,
            abs(price - target) / max(target, 1),
        )
        ranked.append((score, p))
    ranked.sort(key=lambda r: r[0])
    if not ranked:
        return None
    best = ranked[0][0][:4]
    pool_best = [p for s, p in ranked if s[:4] == best]
    return _look_rotate(pool_best, f"{template['id']}:{slot['label']}")


def _look_try(template, pools, used, brand=None):
    audience = template.get("audience", "Male")
    pool = pools[audience]
    items, taken, anchor_colour = [], set(), None
    for slot in template["slots"]:
        pick, kind_used = None, None
        for kind_name in (slot["kind"], slot.get("alt_kind")):
            if not kind_name:
                continue
            pick = _look_pick(pool, template, slot, kind_name, anchor_colour, used | taken, brand)
            if pick:
                kind_used = kind_name
                break
        if not pick:
            return None, slot["label"]
        pick_colours = _look_colours(pick)
        colour = pick_colours[0] if pick_colours else ""
        if anchor_colour is None and colour and not slot.get("any_colour"):
            anchor_colour = colour
        taken.add(_look_base(pick))
        label = slot["label"]
        if " or " in label:  # "Skort or Trousers" -> what was actually picked
            label = {"skort": "Skort", "trousers": "Trousers", "shorts": "Shorts", "visor": "Visor",
                     "cap": "Cap"}.get(kind_used, label)
        if kind_used == "cap" and slot["kind"] == "bucket-hat":
            label = "Cap"
        items.append({
            "slotLabel": label, "id": pick.get("id"), "name": _look_display_name(pick),
            "image": pick.get("image"), "salePrice": pick["salePrice"], "affiliateUrl": pick["affiliateUrl"],
            "brand": pick.get("brand"), "colour": colour.title() if colour else "",
        })
    return items, None


def compute_outfits(products):
    """Builds every look in OUTFIT_TEMPLATES (see the notes above).
    Products are used once across the whole page."""
    pools = {aud: [p for p in products if p.get("category") in ("apparel", "accessories", "shoes")
                   and _look_ok(p, aud)] for aud in ("Male", "Female")}
    month = datetime.now(timezone.utc).month
    used, outfits = set(), []
    for template in OUTFIT_TEMPLATES:
        if template.get("months") and month not in template["months"]:
            continue
        if template.get("one_brand"):
            # Try each well-known brand in turn (rotating daily), keep the
            # first that can dress the whole look.
            brands = [b for b in LOOK_APPAREL_BRANDS[:30]]
            day = datetime.now(timezone.utc).toordinal()
            brands = brands[day % len(brands):] + brands[:day % len(brands)]
            items, missing = None, "a single brand"
            for b in brands:
                items, _ = _look_try(template, pools, used, brand=b)
                if items:
                    break
        else:
            items, missing = _look_try(template, pools, used)
        if not items:
            print(f"Complete The Look: skipped '{template['id']}' today (no proper {missing}).")
            continue
        used |= {_look_base({"name": i["name"]}) for i in items}
        used |= {_look_base(p) for p in products if p.get("id") in {i["id"] for i in items}}
        audience = template.get("audience", "Male")
        outfits.append({
            "id": template["id"],
            "title": template["title"],
            "blurb": template.get("blurb", ""),
            "audience": audience,
            "audienceLabel": "Women's" if audience == "Female" else "Men's",
            "show": template.get("show", 99),
            "items": items,
            "total": round(sum(i["salePrice"] for i in items), 2),
        })
    outfits.sort(key=lambda o: o["show"])
    for o in outfits:
        o.pop("show", None)
    return outfits


def save_outfits(outfits):
    OUTFIT_FILE.write_text(json.dumps(
        {"outfits": outfits, "lastUpdated": datetime.now(timezone.utc).isoformat()},
    ))


# ============================================================
# Complete The Kit — auto-generated, genuinely-priced pairings from
# whatever's actually cheapest in the catalog right now. Deliberately
# NOT framed as "bundle & save" anywhere — there's no real merged
# discount here, just convenient grouping of items people commonly buy
# together, each at its own already-tracked lowest real price. Framing
# it as a "deal" would be exactly the kind of fake-discount claim this
# site's whole brand promise exists to avoid.
# ============================================================
# ============================================================
# Curated homepage/tool-page views, precomputed here instead of
# client-side.
#
# Why this exists: an audit (following a real reported slowness bug on
# Shop All Deals) found that 7 of the site's pages -- homepage, Assemble
# Your Arsenal, Complete The Look, Show Us The Receipts, Back In Stock
# Radar, Best Time To Buy -- each independently downloaded and
# JSON-parsed the ENTIRE catalog (tens of MB, 45,000+ products) in every
# visitor's browser, purely to derive a curated set of 6-24 items. Only
# Shop All Deals genuinely needs full-catalog browsing; the others don't.
#
# This precomputes those small result sets here, once every pipeline
# run, and ships them as one small file (data/curated-views.json) --
# typically tens of KB, not tens of MB. The selection LOGIC below is a
# byte-for-byte port of what used to run in js/app.js, js/receipts.js,
# js/stock-radar.js, and js/timing.js -- verified against the real,
# live catalog (not just synthetic tests) to produce IDENTICAL output
# to the original JS across multiple real dates, including the seeded
# shuffle's exact 32-bit PRNG behaviour, before being trusted here.
# Assemble Your Arsenal and Complete The Look are NOT included here --
# both need live, arbitrary user-driven search/filtering across a broad
# slice of the catalog that can't be precomputed ahead of time. They
# instead get a separate, smaller "lite" catalog file (fewer fields,
# same product count) -- see save_lite_catalog() below.
# ============================================================

HOMEPAGE_CLUB_CATEGORIES = {"driver", "wood", "hybrid", "irons", "wedge", "putter", "sets"}


def _to_int32(n):
    n &= 0xFFFFFFFF
    return n - 0x100000000 if n & 0x80000000 else n


def _to_uint32(n):
    return n & 0xFFFFFFFF


def _imul(a, b):
    return _to_int32((_to_uint32(a) * _to_uint32(b)) & 0xFFFFFFFF)


def seeded_shuffle(array, seed_str):
    """Exact port of js/app.js's seededShuffle. Verified byte-identical
    against the real JS engine across 7+ seeds (including the empty
    string, an 80-element array, and several real calendar dates) before
    being trusted with production data. Must be kept in lockstep with
    app.js's own copy if that algorithm ever changes -- this replicates
    it, it doesn't reinvent it."""
    seed = 0
    for ch in seed_str:
        seed = _to_uint32(seed * 31 + ord(ch))
    state = seed

    def rng():
        nonlocal state
        s = _to_int32(state + 0x6D2B79F5)
        state = s
        t = _imul(s ^ (_to_uint32(s) >> 15), 1 | s)
        t = _to_int32((t + _imul(t ^ (_to_uint32(t) >> 7), 61 | t)) ^ t)
        return _to_uint32(t ^ (_to_uint32(t) >> 14)) / 4294967296

    arr = list(array)
    for i in range(len(arr) - 1, 0, -1):
        j = int(rng() * (i + 1))
        arr[i], arr[j] = arr[j], arr[i]
    return arr


def _homepage_audience(p):
    # Real catalog products always carry a computed `audience` field by
    # this point in the pipeline -- this default only matters for the
    # hypothetical case where one doesn't, matching classifyAudience's
    # own "Male" fallback in app.js.
    return p.get("audience") or "Male"


def _homepage_popularity(p):
    return (p.get("retailerCount") or 1) * 10 + (p.get("savePct") or 0) * 2


def _homepage_key(item):
    return item.get("icon") or item.get("category")


def pick_with_constraints(pool, count, used_keys, min_male_percent=None, min_club_count=None, fallback_pool=None):
    """Exact port of js/app.js's pickWithConstraints -- see that file
    for the original, heavily-commented version. Verified end-to-end
    (not just this function in isolation) against the real catalog."""
    search_pool = fallback_pool if fallback_pool is not None else pool
    seen = set(used_keys)
    picked = []
    picked_ids = set()

    for item in pool:
        if len(picked) == count:
            break
        key = _homepage_key(item)
        if key in seen:
            continue
        picked.append(item)
        picked_ids.add(item["id"])
        seen.add(key)

    if min_club_count:
        guard = 0
        while sum(1 for p in picked if p["category"] in HOMEPAGE_CLUB_CATEGORIES) < min_club_count and guard < count * 3:
            guard += 1
            non_club_idx = None
            for idx in range(len(picked) - 1, -1, -1):
                if picked[idx]["category"] not in HOMEPAGE_CLUB_CATEGORIES:
                    non_club_idx = idx
                    break
            if non_club_idx is None:
                break
            replacement = None
            for item in search_pool:
                if item["category"] in HOMEPAGE_CLUB_CATEGORIES and item["id"] not in picked_ids and _homepage_key(item) not in seen:
                    replacement = item
                    break
            if replacement is None:
                break
            seen.discard(_homepage_key(picked[non_club_idx]))
            picked_ids.discard(picked[non_club_idx]["id"])
            picked[non_club_idx] = replacement
            picked_ids.add(replacement["id"])
            seen.add(_homepage_key(replacement))

    if min_male_percent:
        min_male_count = math.ceil(count * min_male_percent)
        guard = 0
        while sum(1 for p in picked if _homepage_audience(p) == "Male") < min_male_count and guard < count * 3:
            guard += 1
            non_male_idx = None
            for idx in range(len(picked) - 1, -1, -1):
                if _homepage_audience(picked[idx]) != "Male":
                    non_male_idx = idx
                    break
            if non_male_idx is None:
                break
            replacement = None
            for item in search_pool:
                if _homepage_audience(item) == "Male" and item["id"] not in picked_ids and _homepage_key(item) not in seen:
                    replacement = item
                    break
            if replacement is None:
                break
            seen.discard(_homepage_key(picked[non_male_idx]))
            picked_ids.discard(picked[non_male_idx]["id"])
            picked[non_male_idx] = replacement
            picked_ids.add(replacement["id"])
            seen.add(_homepage_key(replacement))

    if len(picked) < count:
        for item in search_pool:
            if len(picked) == count:
                break
            key = _homepage_key(item)
            if item["id"] not in picked_ids and key not in seen:
                picked.append(item)
                picked_ids.add(item["id"])
                seen.add(key)

    if len(picked) < count:
        for item in search_pool:
            if len(picked) == count:
                break
            if item["id"] not in picked_ids:
                picked.append(item)
                picked_ids.add(item["id"])

    return picked


def _trim(p, fields):
    return {f: p.get(f) for f in fields if p.get(f) is not None}


HOME_CARD_FIELDS = ["id", "name", "image", "icon", "category", "retailPrice", "salePrice",
                     "savePct", "retailerCount", "affiliateUrl", "condition", "brand", "inStock"]


PREOWNED_ONLY_SOURCES = {"awin-callawaypreowned"}


USED_GRADES = {"Preowned", "Used", "Like New", "Very Good", "Good", "Average"}


def is_preowned_partner(p):
    """Second-hand stock from any retailer: Callaway Preowned, plus anything
    carrying a condition (Callaway grades, Affordable Golf and Scottsdale
    "Used", Major Golf "Ex-demo"/"Preowned"). New stock never has one. All of
    it lives only in the Preowned and trade-ins section (Oct 2026 decision),
    so used prices never sit in "lowest price" lists."""
    return p.get("source") in PREOWNED_ONLY_SOURCES or bool(p.get("condition"))


def new_stock_only(products):
    """Callaway Preowned listings belong only in the Preowned & Trade Ins
    section of the shop. Every other list, view and feed uses new stock, so
    used clubs never skew "lowest price" lists (or borrow a new club's
    price history and look like a 90% drop)."""
    return [p for p in products if not is_preowned_partner(p)]


def compute_homepage_views(products):
    quality_ranked = sorted(products, key=lambda p: (0 if p.get("image") else 1, -(p.get("savePct") or 0)))
    today_seed = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    qualified_pool = quality_ranked[: min(80, len(quality_ranked))]
    daily_pool = seeded_shuffle(qualified_pool, today_seed)

    best_deals = pick_with_constraints(daily_pool, 12, [], min_male_percent=0.85, min_club_count=6, fallback_pool=quality_ranked)
    best_ids = {d["id"] for d in best_deals}
    best_keys = [_homepage_key(d) for d in best_deals]

    price_drops = pick_with_constraints(
        [d for d in daily_pool if d["id"] not in best_ids], 6, best_keys,
        min_male_percent=0.85, fallback_pool=quality_ranked,
    )
    price_drop_ids = {d["id"] for d in price_drops}
    price_drop_keys = [_homepage_key(d) for d in price_drops]

    used_for_trending = set(best_keys) | set(price_drop_keys)
    trending_pool = sorted(
        [d for d in daily_pool if d["id"] not in best_ids and d["id"] not in price_drop_ids],
        key=lambda p: -_homepage_popularity(p),
    )
    trending_raw = pick_with_constraints(trending_pool, 12, list(used_for_trending), min_male_percent=0.85, fallback_pool=quality_ranked)

    trending = [{
        "name": t["name"],
        "tag": "Hot" if (t.get("savePct") or 0) >= 25 else "Rising",
        "affiliateUrl": t["affiliateUrl"],
        "category": t["category"],
    } for t in trending_raw]

    return {
        "bestDeals": [_trim(p, HOME_CARD_FIELDS) for p in best_deals],
        "priceDrops": [_trim(p, HOME_CARD_FIELDS) for p in price_drops],
        "trending": trending,
        "stats": compute_home_stats(products),
    }


HOME_TILE_GROUPS = {
    "clubs": {"driver", "wood", "hybrid", "irons", "wedge", "putter", "sets"},
    "apparel": {"apparel", "shoes"},
    "accessories": {"accessories", "bag", "ball"},
}


def compute_home_stats(products):
    """The live numbers on the homepage: genuine drops per category tile
    (verified against our own price history, in stock today) and the
    proof line under the search box (products tracked, retailers)."""
    drops = {key: 0 for key in HOME_TILE_GROUPS}
    for p in products:
        if not (p.get("priceInsight") or {}).get("verifiedDiscount") or p.get("inStock") is False:
            continue
        for key, cats in HOME_TILE_GROUPS.items():
            if p.get("category") in cats:
                drops[key] += 1
    return {
        "genuineDrops": drops,
        "products": len(products),
        "retailers": len({p.get("source") for p in products if p.get("source")}),
    }


RECEIPT_FIELDS = ["id", "name", "image", "brand", "salePrice", "affiliateUrl"]


BIG_DROP_PCT = 60
BIG_DROP_MIN_DAYS_AT_HIGH = 14
_HISTORY_CACHE = {}


def credible_drop(p):
    """A drop of 60% or more only counts if the higher price really stood
    for at least 14 days. A high that lasted a day or two at the start of
    tracking is nearly always a different product sharing the name (a full
    set vs one iron, new vs pre-owned), not a genuine price cut."""
    insight = p.get("priceInsight") or {}
    high = insight.get("historicalHigh")
    if not high or not p.get("salePrice"):
        return False
    if (high - p["salePrice"]) / high * 100 < BIG_DROP_PCT:
        return True
    if "products" not in _HISTORY_CACHE:
        try:
            _HISTORY_CACHE["products"] = json.loads(PRICE_HISTORY_FILE.read_text()).get("products", {})
        except (OSError, ValueError):
            _HISTORY_CACHE["products"] = {}
    entries = sorted(_HISTORY_CACHE["products"].get(identity.listing_key(p)) or [], key=lambda e: e["date"])
    if not entries:
        return False
    today = datetime.now(timezone.utc).date()
    days_at_high = 0
    for i, e in enumerate(entries):
        if abs(e["price"] - high) < 0.01:
            start = datetime.fromisoformat(e["date"]).date()
            end = datetime.fromisoformat(entries[i + 1]["date"]).date() if i + 1 < len(entries) else today
            days_at_high += (end - start).days
    # Prices that keep flipping between the high and today's price are two
    # products sharing a name, not a cut.
    flips = sum(1 for a, b in zip(entries, entries[1:])
                if abs(a["price"] - high) < 0.01 and abs(b["price"] - p["salePrice"]) < 0.01)
    return days_at_high >= BIG_DROP_MIN_DAYS_AT_HIGH and flips <= 1


def compute_receipts_view(products):
    candidates = [p for p in products if p.get("priceInsight", {}).get("verifiedDiscount") and p.get("image")
                  and credible_drop(p)]
    scored = []
    for p in candidates:
        insight = p["priceInsight"]
        drop_pct = round(((insight["historicalHigh"] - p["salePrice"]) / insight["historicalHigh"]) * 100)
        item = _trim(p, RECEIPT_FIELDS)
        item["_dropPct"] = drop_pct
        item["historicalHigh"] = insight["historicalHigh"]
        item["daysTracked"] = insight.get("daysTracked")
        scored.append(item)
    scored.sort(key=lambda p: -p["_dropPct"])
    return scored[:24]


STOCK_FIELDS = ["id", "name", "image", "brand", "salePrice", "affiliateUrl"]
RADAR_RECENT_DAYS = {"back": 7, "out": 14}
RADAR_MAX = 12
RADAR_SECONDHAND_RX = re.compile(r"\b(recycled|refurbished|lake balls?|pre-?owned|used)\b", re.I)


def _radar_glitch_days(products):
    """Days when a retailer's whole feed flipped at once (e.g. 28 Aug 2026,
    when about 6,700 Major Golf listings 'came back' together after a feed
    hiccup). Those aren't real restocks, so they're left out."""
    per_source, flips = collections.Counter(), collections.Counter()
    for p in products:
        per_source[p.get("source")] += 1
        day = (p.get("stockInsight") or {}).get("lastChange")
        if day:
            flips[(p.get("source"), day)] += 1
    return {k for k, n in flips.items() if n >= 300 or n >= 0.2 * per_source[k[0]]}


def _radar_ok(p):
    """New, adult, photographed listings only (second-hand stock belongs
    in Preowned; no junior items in picks)."""
    return (p.get("image") and not p.get("condition") and p.get("audience") != "Junior"
            and p.get("salePrice") and not RADAR_SECONDHAND_RX.search(p.get("name", "")))


def _radar_group(products, today, days, glitches):
    """One card per product: sizes, colours and other options of the same
    product (the name before " - ") are grouped, newest change first."""
    groups = {}
    for p in products:
        si = p.get("stockInsight") or {}
        day = si.get("lastChange")
        if not day or (p.get("source"), day) in glitches:
            continue
        if (today - date.fromisoformat(day)).days > days:
            continue
        base, _, option = p["name"].partition(" - ")
        g = groups.setdefault(base.strip().lower(), {"p": p, "base": base.strip(), "day": day, "options": []})
        if day > g["day"] or (day == g["day"] and p.get("salePrice", 0) > g["p"].get("salePrice", 0)):
            g["p"], g["day"] = p, day
        if option:
            g["options"].append(option.strip())
    out = []
    for g in sorted(groups.values(), key=lambda g: (g["day"], g["p"].get("salePrice", 0)), reverse=True)[:RADAR_MAX]:
        item = _trim(g["p"], STOCK_FIELDS)
        item["name"] = g["base"]
        item["changed"] = g["day"]
        item["options"] = len(g["options"])
        out.append(item)
    return out


def compute_stock_radar_view(products, today_str=None):
    today = date.fromisoformat(today_str) if today_str else date.today()
    glitches = _radar_glitch_days(products)
    ok = [p for p in products if _radar_ok(p) and p.get("stockInsight")]

    back = _radar_group([p for p in ok if p["stockInsight"].get("currentlyInStock")],
                        today, RADAR_RECENT_DAYS["back"], glitches)
    # "Sold out" means sold out everywhere we track it: if any size, colour
    # or retailer still has it in stock, it isn't listed.
    in_stock_bases = {p["name"].partition(" - ")[0].strip().lower() for p in products
                      if p.get("inStock") is not False}
    sold_out = _radar_group([p for p in ok if p["stockInsight"].get("currentlyInStock") is False
                             and p["name"].partition(" - ")[0].strip().lower() not in in_stock_bases],
                            today, RADAR_RECENT_DAYS["out"], glitches)

    fast_candidates = [p for p in ok
                       if p["stockInsight"].get("sellsOutFast") and p["stockInsight"].get("currentlyInStock")]
    fast_candidates.sort(key=lambda p: (-p["stockInsight"]["outageCount90d"], -(p.get("salePrice") or 0)))
    sells_out_fast, seen = [], set()
    for p in fast_candidates:
        base = p["name"].partition(" - ")[0].strip()
        if base.lower() in seen:
            continue
        seen.add(base.lower())
        item = _trim(p, STOCK_FIELDS)
        item["name"] = base
        item["outageCount90d"] = p["stockInsight"]["outageCount90d"]
        sells_out_fast.append(item)
        if len(sells_out_fast) == RADAR_MAX:
            break

    print(f"Back In Stock Radar: {len(back)} back in stock, {len(sold_out)} recently sold out, "
          f"{len(sells_out_fast)} sell out fast"
          + (f" (ignored {len(glitches)} whole-feed stock change(s))." if glitches else "."))
    return {"backInStock": back, "soldOut": sold_out, "sellsOutFast": sells_out_fast}


TIMING_FIELDS = ["id", "name", "image", "brand", "salePrice", "affiliateUrl"]


def compute_timing_view(products):
    stable_candidates = [p for p in products if p.get("priceInsight", {}).get("volatility") == "stable" and p.get("image")]
    stable_candidates.sort(key=lambda p: -(p["priceInsight"].get("daysTracked") or 0))
    stable = []
    for p in stable_candidates[:12]:
        item = _trim(p, TIMING_FIELDS)
        item["daysTracked"] = p["priceInsight"].get("daysTracked")
        stable.append(item)

    volatile_candidates = [p for p in products if p.get("priceInsight", {}).get("volatility") == "volatile" and p.get("image")]
    volatile_candidates.sort(key=lambda p: (p["priceInsight"].get("avgDaysBetweenChanges") or 999))
    volatile = []
    for p in volatile_candidates[:12]:
        item = _trim(p, TIMING_FIELDS)
        item["avgDaysBetweenChanges"] = p["priceInsight"].get("avgDaysBetweenChanges")
        volatile.append(item)

    return {"stable": stable, "volatile": volatile}


def save_curated_views(products):
    products = new_stock_only(products)
    views = {
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
        "home": compute_homepage_views(products),
        "receipts": compute_receipts_view(products),
        "stockRadar": compute_stock_radar_view(products),
        "timing": compute_timing_view(products),
    }
    CURATED_VIEWS_FILE.write_text(json.dumps(views))


LITE_CATALOG_DROP_FIELDS = ("priceInsight", "stockInsight")


def save_lite_catalog(catalog):
    """A full-breadth (all categories, all products) but lighter-weight
    catalog for pages that need live, arbitrary user-driven search
    across a broad slice of products -- Assemble Your Arsenal and
    Complete The Look -- and so can't use the precomputed small views
    above. Drops priceInsight/stockInsight, which neither page uses:
    confirmed on the real catalog this alone is a ~39% size cut with
    zero effect on what either page actually needs to render."""
    lite_products = [
        {k: v for k, v in p.items() if k not in LITE_CATALOG_DROP_FIELDS}
        for p in new_stock_only(catalog["products"])
    ]
    lite = {
        "lastUpdated": catalog.get("lastUpdated"),
        "categories": catalog.get("categories"),
        "products": lite_products,
    }
    LITE_DATA_FILE.write_text(json.dumps(lite))


def save_apparel_lite_catalog(catalog):
    """Complete The Look only ever filters within category === "apparel"
    for its colour-compatibility matching -- it never needs the other
    ~50% of the catalog at all. Confirmed on the real catalog: apparel
    alone is 22,926 of 45,904 products, and combined with dropping
    priceInsight/stockInsight (also unused here) this file comes to
    about a quarter the size of the original full catalog."""
    apparel_lite = [
        {k: v for k, v in p.items() if k not in LITE_CATALOG_DROP_FIELDS}
        for p in new_stock_only(catalog["products"]) if p.get("category") == "apparel"
    ]
    lite = {"lastUpdated": catalog.get("lastUpdated"), "products": apparel_lite}
    APPAREL_LITE_FILE.write_text(json.dumps(lite))



# ============================================================
# Public deals feed (RSS 2.0 + JSON Feed 1.1)
#
# Why this exists: a real, machine-readable feed lets other sites, deal
# aggregators, newsletter writers, and AI answer engines discover and
# cite GolfPrice AI's genuinely verified deals automatically, without
# needing to already know the site exists -- a real, low-effort
# discovery channel distinct from search ranking.
#
# Same honesty rule as Show Us The Receipts: a product only qualifies
# if priceInsight.verifiedDiscount is true, meaning GolfPrice AI's own
# tracked history recorded a real higher price -- never an unverified
# retailer RRP claim. The feed is deliberately larger than the 24 shown
# on-site (50), since external consumers pick and choose from it rather
# than displaying the whole thing verbatim.
#
# Each item links back to a real, live GolfPrice AI page for that exact
# product (a search-filtered Shop All Deals view), not straight to the
# retailer's affiliate URL. A raw affiliate-link feed would let other
# sites/readers bypass golfpriceai.com entirely -- the whole point of
# this feed is to be found by people who don't know the site exists,
# which means the link needs to land them ON it.
# ============================================================

DEALS_FEED_SIZE = 50


def compute_deals_feed_items(products):
    candidates = [p for p in products if p.get("priceInsight", {}).get("verifiedDiscount") and p.get("image")
                  and credible_drop(p)]
    scored = []
    for p in candidates:
        insight = p["priceInsight"]
        drop_pct = round(((insight["historicalHigh"] - p["salePrice"]) / insight["historicalHigh"]) * 100)
        scored.append((drop_pct, p))
    scored.sort(key=lambda t: -t[0])
    return scored[:DEALS_FEED_SIZE]


def _feed_site_link(product):
    # The product's price page when it has one, so every republished feed
    # item points people (and links) at the pages we want found.
    page = price_pages.PAGE_FOR_LISTING.get(product.get("id"))
    if page:
        return page
    return f"https://golfpriceai.com/shop.html?q={quote_plus(product['name'])}"


def _feed_item_title(drop_pct, p):
    insight = p["priceInsight"]
    return f"{p['name']} — £{p['salePrice']:.2f} (was £{insight['historicalHigh']:.2f}, {drop_pct}% off)"


def _feed_item_description(drop_pct, p):
    insight = p["priceInsight"]
    return (f"Genuinely tracked price drop, not a claimed RRP — GolfPrice AI recorded a real "
            f"historical high of £{insight['historicalHigh']:.2f} for this item, now down to "
            f"£{p['salePrice']:.2f} ({drop_pct}% off). Compare prices across UK golf retailers at GolfPrice AI.")


def _feed_image_mime_type(url):
    lower = (url or "").lower().split("?")[0]
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


def build_deals_rss(items, generated_at_rfc822):
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0"><channel>',
        '<title>GolfPrice AI — Verified Deals</title>',
        '<link>https://golfpriceai.com/</link>',
        '<description>Genuinely verified golf gear price drops, tracked across UK retailers. '
        'A product only appears here if we recorded a real higher price ourselves — never an '
        'unverified retailer RRP claim.</description>',
        f'<lastBuildDate>{generated_at_rfc822}</lastBuildDate>',
    ]
    for drop_pct, p in items:
        parts.append("<item>")
        parts.append(f"<title>{xml_escape(_feed_item_title(drop_pct, p))}</title>")
        parts.append(f"<link>{xml_escape(_feed_site_link(p))}</link>")
        parts.append(f'<guid isPermaLink="false">{xml_escape(p["id"])}</guid>')
        parts.append(f"<description>{xml_escape(_feed_item_description(drop_pct, p))}</description>")
        parts.append(f'<enclosure url="{xml_escape(p["image"])}" type="{_feed_image_mime_type(p["image"])}"/>')
        parts.append(f"<pubDate>{generated_at_rfc822}</pubDate>")
        parts.append("</item>")
    parts.append("</channel></rss>")
    return "\n".join(parts)


def build_deals_json_feed(items, generated_at_iso):
    feed_items = []
    for drop_pct, p in items:
        feed_items.append({
            "id": p["id"],
            "url": _feed_site_link(p),
            "title": _feed_item_title(drop_pct, p),
            "content_text": _feed_item_description(drop_pct, p),
            "image": p.get("image"),
            "date_published": generated_at_iso,
        })
    return {
        "version": "https://jsonfeed.org/version/1.1",
        "title": "GolfPrice AI — Verified Deals",
        "home_page_url": "https://golfpriceai.com/",
        "feed_url": "https://golfpriceai.com/data/deals-feed.json",
        "description": "Genuinely verified golf gear price drops, tracked across UK retailers. "
                        "A product only appears here if we recorded a real higher price ourselves — "
                        "never an unverified retailer RRP claim.",
        "items": feed_items,
    }


def save_deals_feed(products):
    items = compute_deals_feed_items(products)
    now_rfc822 = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")
    now_iso = datetime.now(timezone.utc).isoformat()
    DEALS_FEED_RSS_FILE.write_text(build_deals_rss(items, now_rfc822))
    DEALS_FEED_JSON_FILE.write_text(json.dumps(build_deals_json_feed(items, now_iso)))
    return len(items)


# ============================================================
# Complete The Kit (data/bundles.json)
#
# Rebuilt 15 Oct 2026 after customer feedback. The old version took the
# single cheapest product whose category matched, which put a £1.99 grip
# in as "the putter", a gym sack in as "the irons" and a spike wrench in
# as "the shoes".
#
# How it works now:
#   * The main ("hero") club or device comes ONLY from models that have a
#     live price page (data/models.json + /prices/<slug>/index.html), from
#     a known brand, in a realistic price band, at its cheapest in-stock
#     new listing right now. So "the putter" is always a real putter.
#   * Add-ons are matched on item type AND name words, from known brands
#     where that brand range exists, inside a sensible price band. Within
#     the band we favour known brands and a mid-band price, not the
#     cheapest filler.
#   * Never: second-hand, junior, practice/recycled balls, out of stock,
#     no photo. A product is used once across the whole page.
#   * A kit is hidden for the run (not padded with junk) if any slot has
#     no proper match.
#   * The picks rotate daily among the best few, so the page doesn't go
#     stale, but stay the same all day.
# ============================================================
import hashlib

KIT_JUNIOR_WORDS = ("junior", "youth", "kids", "kid's", "boys", "girls", "child")
KIT_BAD_BALL_WORDS = ("practice", "recycled", "refurb", "lake", "pearl grade", "used", "x-out", "xout",
                      "foam", "plastic", "almost golf", "airflow", "range ball")
KIT_PREMIUM_BALL_WORDS = ("pro v1", "pro v1x", "prov1", "tp5", "chrome tour", "chrome soft", "z-star", "zstar",
                          "tour b", "avx", "tour response", "tp5x", "q-star tour")
# Accessory makers that aren't in the main brand list but are the normal,
# sensible choice for a few small items (tees, spike wrenches, mats).
KIT_SPECIALIST_BRANDS = ("masters", "longridge", "puttout", "wellputt", "pride", "skins golf",
                         "zebra", "foremat", "northern golf", "softspikes", "champ", "pro-tekt")


def _kit_words(text):
    return f" {re.sub(r'[^a-z0-9+]+', ' ', (text or '').lower())} "


def _kit_has(text, *words):
    t = _kit_words(text)
    return any(_kit_words(w) in t for w in words)


def _kit_brand_rank(p):
    import seasonal_pages
    return min(seasonal_pages.brand_rank(p.get("brand")), seasonal_pages.brand_rank(p.get("name")))


def _kit_is_specialist(p):
    s = f"{p.get('brand') or ''} {p.get('name') or ''}".lower()
    return any(s.startswith(b) or f" {b} " in f" {s} " for b in KIT_SPECIALIST_BRANDS)


def _kit_ok_listing(p):
    """The checks every single pick has to pass, hero or add-on."""
    if p.get("inStock") is False or not p.get("image") or not p.get("affiliateUrl"):
        return False
    if is_preowned_partner(p) or "/sh-" in (p.get("image") or ""):
        return False
    if p.get("audience") == "Junior" or _kit_has(p.get("name"), *KIT_JUNIOR_WORDS):
        return False
    return (p.get("salePrice") or 0) > 0


def _kit_base(p):
    return (p.get("name") or "").split(" - ")[0].strip().lower()


def _kit_display_name(p):
    """Drops the size off the end of apparel/shoe names ("... - Black / 9")
    and keeps the product name and colour."""
    name = p.get("name") or ""
    parts = name.split(" - ")
    if len(parts) > 1 and "/" in parts[-1]:
        last = parts[-1].split("/")[0].strip()
        parts = parts[:-1] + ([last] if last and last.lower() not in parts[-2].lower() else [])
    # "Umbrella - Black - Black" -> "Umbrella - Black"
    tidy = []
    for part in parts:
        if not tidy or part.strip().lower() != tidy[-1].strip().lower():
            tidy.append(part)
    return " - ".join(tidy)


def _kit_rotate(ranked, key, n=4):
    """Picks one of the top n, the same one all day, a different one most
    days. Nothing random between runs on the same day."""
    if not ranked:
        return None
    top = ranked[:n]
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    h = int(hashlib.md5(f"{day}:{key}".encode()).hexdigest(), 16)
    return top[h % len(top)]


# --- the hero: a real model with a live price page --------------------------
def _kit_live_models():
    models_file = Path(__file__).resolve().parent.parent / "data" / "models.json"
    if not models_file.exists():
        return []
    prices_dir = Path(__file__).resolve().parent.parent / "prices"
    out = []
    for m in json.loads(models_file.read_text()).get("models", []):
        if m.get("preowned"):
            continue
        if not (prices_dir / m["slug"] / "index.html").exists():
            continue
        out.append(m)
    return out


def _kit_iron_set_ok(model, listing):
    """House rule: irons under £120 anywhere, or under £450 in the
    Callaway feed, are single irons, not sets."""
    price = listing["salePrice"]
    if price < 120:
        return False
    if "callaway" in (listing.get("source") or "").lower() and price < 450:
        return False
    return not _kit_has(model["name"], "utility", "driving iron", "single", "crossover", "ut")


def _kit_pick_hero(slot, live_models, by_id, used):
    ranked = []
    for m in live_models:
        if m.get("type") != slot["type"]:
            continue
        if _kit_has(m["name"], *KIT_JUNIOR_WORDS):
            continue
        if slot.get("words") and not _kit_has(m["name"], *slot["words"]):
            continue
        if slot.get("not_words") and _kit_has(m["name"], *slot["not_words"]):
            continue
        brank = _kit_brand_rank({"brand": m.get("brand"), "name": m["name"]})
        if brank >= 99:
            continue
        listings = [by_id[i] for i in m.get("listingIds", []) if i in by_id and _kit_ok_listing(by_id[i])]
        if slot["type"] == "ball":
            listings = [p for p in listings if not _kit_has(p["name"], *KIT_BAD_BALL_WORDS)]
        if not listings:
            continue
        best = min(listings, key=lambda p: p["salePrice"])
        lo, hi = slot["band"]
        if not (lo <= best["salePrice"] <= hi):
            continue
        if slot["type"] == "irons" and not _kit_iron_set_ok(m, best):
            continue
        if best["id"] in used or _kit_base(best) in used:
            continue
        # Score: known brand first, then "at or near its own tracked low",
        # then more retailers, then a verified drop.
        at_low = 1 if m.get("low") and best["salePrice"] <= m["low"] * 1.02 else 0
        retailers = len(m.get("retailers") or {})
        score = (min(brank, 20) // 5, -at_low, -min(retailers, 3), -(m.get("verifiedDrops") or 0), brank)
        ranked.append((score, m, best))
    ranked.sort(key=lambda r: r[0])
    pick = _kit_rotate(ranked, slot["label"])
    if not pick:
        return None
    _, m, best = pick
    return {
        "slotLabel": slot["label"],
        "id": best.get("id"),
        "name": m["name"],
        "image": best.get("image"),
        "salePrice": best["salePrice"],
        "affiliateUrl": best["affiliateUrl"],
        "brand": m.get("brand") or best.get("brand"),
        "pricePage": f"/prices/{m['slug']}/",
        "retailerCount": len(m.get("retailers") or {}),
        "hero": True,
    }


# --- add-ons: matched by type and name, in a sensible price band ------------
def _kit_slot_candidates(slot, products, hero):
    lo, hi = slot["band"]
    out = []
    for p in products:
        if not _kit_ok_listing(p):
            continue
        if slot.get("icons") and p.get("icon") not in slot["icons"]:
            continue
        if slot.get("categories") and p.get("category") not in slot["categories"]:
            continue
        name = p.get("name") or ""
        if slot.get("words") and not _kit_has(name, *slot["words"]):
            continue
        if slot.get("not_words") and _kit_has(name, *slot["not_words"]):
            continue
        if slot.get("audience") and p.get("audience") != slot["audience"]:
            continue
        if not (lo <= p["salePrice"] <= hi):
            continue
        brank = _kit_brand_rank(p)
        if slot.get("brands") == "known" and brank >= 99:
            continue
        if slot.get("brands") == "known+specialist" and brank >= 99 and not _kit_is_specialist(p):
            continue
        out.append(p)
    return out


def _kit_pick_addon(slot, products, hero, used):
    cands = [p for p in _kit_slot_candidates(slot, products, hero)
             if p["id"] not in used and _kit_base(p) not in used]
    if not cands:
        return None
    lo, hi = slot["band"]
    target = slot.get("target", (lo + hi) / 2)
    hero_brand = ((hero or {}).get("brand") or "").lower()
    seen, ranked = set(), []
    for p in cands:
        base = _kit_base(p)
        if base in seen:
            continue
        seen.add(base)
        brank = _kit_brand_rank(p)
        matches_hero = 1 if slot.get("match_hero_brand") and hero_brand and \
            (hero_brand in (p.get("brand") or "").lower() or hero_brand in (p.get("name") or "").lower()) else 0
        score = (-matches_hero, 0 if brank < 99 else 1, abs(p["salePrice"] - target) / max(target, 1), brank)
        ranked.append((score, p))
    ranked.sort(key=lambda r: r[0])
    # Rotate only among equally good picks (same brand-match and brand tier).
    best_tier = ranked[0][0][:2]
    ranked = [r for r in ranked if r[0][:2] == best_tier]
    pick = _kit_rotate([p for _, p in ranked], f"{slot['label']}:{(hero or {}).get('id')}")
    return {
        "slotLabel": slot["label"],
        "id": pick.get("id"),
        "name": _kit_display_name(pick),
        "image": pick.get("image"),
        "salePrice": pick["salePrice"],
        "affiliateUrl": pick["affiliateUrl"],
        "brand": pick.get("brand"),
    }


HEADCOVER_NOT = ("fairway", "hybrid", "putter", "iron", "rescue", "wood cover", "3 wood", "5 wood", "women's",
                 "ladies", "set")

BUNDLE_TEMPLATES = [
    {"id": "driver-headcover-tees", "title": "🏌️ Driver + Headcover + Tees",
     "blurb": "A real driver at its lowest price, a matching headcover to keep it pristine, and tees.",
     "slots": [
         {"label": "Driver", "hero": True, "type": "driver", "band": (150, 600)},
         {"label": "Headcover", "icons": ("headcover",), "words": ("driver",), "not_words": HEADCOVER_NOT,
          "band": (12, 60), "target": 30, "brands": "known", "match_hero_brand": True},
         {"label": "Tees", "icons": ("tee",), "words": ("tees", "tee"),
          "not_words": ("bag", "duffle", "holder", "pencil", "towel", "glove"),
          "band": (2.5, 12), "target": 5, "brands": "known+specialist"},
     ]},
    {"id": "putter-alignment-mat", "title": "🎯 Putter + Alignment Sticks + Putting Mat",
     "blurb": "Everything for holing more putts: a real putter, alignment sticks and a mat for the living room.",
     "slots": [
         {"label": "Putter", "hero": True, "type": "putter", "band": (90, 450)},
         {"label": "Alignment Sticks", "words": ("alignment sticks", "alignment stick", "alignment rods",
                                                  "tour rodz", "drill stix", "drill-stix", "alignment stix"),
          "not_words": ("cover", "headcover", "ball", "balls", "mirror", "trainer aid"),
          "band": (8, 40), "target": 20, "brands": "known+specialist"},
         {"label": "Putting Mat", "words": ("putting mat",), "not_words": ("trainer",),
          "band": (25, 150), "target": 60, "brands": "known+specialist"},
     ]},
    {"id": "rangefinder-battery", "title": "📏 Laser Rangefinder + Spare Battery",
     "blurb": "A real laser rangefinder at its lowest price, plus the spare CR2 battery you'll wish you'd packed.",
     "slots": [
         {"label": "Rangefinder", "hero": True, "type": "rangefinder", "band": (120, 450),
          "words": ("laser",), "not_words": ("gps", "watch", "handheld")},
         {"label": "Spare Battery", "words": ("cr2",), "band": (3, 15), "target": 5,
          "brands": "known+specialist"},
     ]},
    {"id": "winter-warm-up", "title": "❄️ Winter Warm-Up: Mitts + Beanie + Hand Warmers",
     "blurb": "For frosty mornings when the 7am tee time felt like a good idea at the time.",
     "months": (10, 11, 12, 1, 2, 3),
     "slots": [
         {"label": "Winter Mitts", "words": ("mitts", "mittens", "mitt"),
          "not_words": ("trolley", "pushcart", "handle"), "audience": "Male",
          "band": (14, 45), "target": 25, "brands": "known"},
         {"label": "Beanie", "icons": ("cap",), "words": ("beanie", "bobble"),
          "not_words": ("gift set", "neck warmer", "snood", "set"), "audience": "Male",
          "band": (12, 32), "target": 20, "brands": "known"},
         {"label": "Hand Warmers", "words": ("hand warmer", "handwarmer", "hand warmers", "handwarmers"),
          "not_words": ("neck", "body"), "band": (1, 15), "target": 5, "brands": "known+specialist"},
     ]},
    {"id": "premium-balls-marker-towel", "title": "⛳ Premium Balls + Ball Marker + Towel",
     "blurb": "Tour-level balls at today's lowest price, something to mark them with and a towel to keep them clean.",
     "slots": [
         {"label": "Premium Golf Balls", "hero": True, "type": "ball", "band": (30, 65),
          "words": KIT_PREMIUM_BALL_WORDS, "not_words": KIT_BAD_BALL_WORDS},
         {"label": "Ball Marker", "words": ("ball marker", "ball markers"),
          "not_words": ("cap", "hat", "glove", "pen", "pens", "holder", "clip"),
          "band": (4, 20), "target": 10, "brands": "known+specialist"},
         {"label": "Towel", "icons": ("towel",), "band": (10, 30), "target": 18, "brands": "known"},
     ]},
    {"id": "bag-umbrella-towel", "title": "🎒 Bag + Umbrella + Towel",
     "blurb": "A proper bag at its lowest price, plus the umbrella and towel every UK round needs.",
     "slots": [
         {"label": "Golf Bag", "hero": True, "type": "bag", "band": (120, 320),
          "not_words": ("travel", "cover", "tour staff", "staff bag", "pencil", "women's", "ladies")},
         {"label": "Umbrella", "icons": ("umbrella",), "band": (25, 60), "target": 38, "brands": "known"},
         {"label": "Towel", "icons": ("towel",), "band": (10, 30), "target": 18, "brands": "known"},
     ]},
    {"id": "shoes-socks-wrench", "title": "👟 Shoes + Socks + Spike Wrench",
     "blurb": "Proper golf shoes from a big name, socks to go with them and the wrench for swapping spikes.",
     "slots": [
         {"label": "Golf Shoes", "categories": ("shoes",), "icons": (None,), "audience": "Male",
          "words": ("golf shoes", "golf shoe", "spikeless", "spiked", "golf boot"),
          "not_words": ("trainer", "trainers", "sandal", "slide", "wrench", "bag", "spikes only", "laces"),
          "band": (70, 180), "target": 115, "brands": "known"},
         {"label": "Socks", "icons": ("socks",), "audience": "Male", "not_words": ("training", "running"),
          "band": (6, 20), "target": 11, "brands": "known"},
         {"label": "Spike Wrench", "words": ("wrench", "spike tool", "spike key", "cleat tool"),
          "band": (2.5, 15), "target": 9, "brands": "known+specialist"},
     ]},
]


def compute_bundles(products):
    """Rebuilds every kit from scratch each run (see the notes above).
    The hero comes from live price-page models (data/models.json from the
    previous run, at TODAY'S listing prices); add-ons from today's
    catalogue. A kit with any unfillable slot is skipped for the run."""
    by_id = {p.get("id"): p for p in products if p.get("id")}
    live_models = _kit_live_models()
    month = datetime.now(timezone.utc).month
    used = set()
    bundles = []
    for template in BUNDLE_TEMPLATES:
        if template.get("months") and month not in template["months"]:
            continue
        items, hero, picked_keys = [], None, set()
        for slot in template["slots"]:
            taken = used | picked_keys
            item = (_kit_pick_hero(slot, live_models, by_id, taken) if slot.get("hero")
                    else _kit_pick_addon(slot, products, hero, taken))
            if not item:
                print(f"Complete The Kit: skipped '{template['id']}' today (no proper {slot['label']}).")
                items = None
                break
            if slot.get("hero"):
                hero = item
            items.append(item)
            src = by_id.get(item["id"]) or {}
            picked_keys |= {item["id"], _kit_base(src)}
        if not items:
            continue
        used |= picked_keys
        bundles.append({
            "id": template["id"],
            "title": template["title"],
            "blurb": template.get("blurb", ""),
            "items": items,
            "total": round(sum(i["salePrice"] for i in items), 2),
        })
    return bundles


def save_bundles(bundles):
    BUNDLE_FILE.write_text(json.dumps(
        {"bundles": bundles, "lastUpdated": datetime.now(timezone.utc).isoformat()},
    ))


def main():
    catalog = json.loads(DATA_FILE.read_text())

    # One-off (Oct 2026): move both history files from name keys to
    # retailer + name keys, using the catalogue as it was before this run.
    identity.migrate_history_file(PRICE_HISTORY_FILE, catalog["products"], "price")
    identity.migrate_history_file(STOCK_HISTORY_FILE, catalog["products"], "stock")
    identity.clean_mixed_records(catalog["products"])

    fresh = (
        fetch_cj_deals()
        + fetch_awin_deals()
        + fetch_awin_clickgolf_deals()
        + fetch_awin_majorgolf_deals()
        + fetch_awin_callaway_deals()
        + fetch_awin_affordablegolf_deals()
        + fetch_awin_scottsdalegolf_deals()
        + fetch_awin_callawaypreowned_deals()
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

    # Fix misfiled products and drop £0 listings BEFORE anything is
    # enriched or recorded, so a feed glitch never reaches price history.
    category_changes = models.audit_categories(catalog["products"])
    catalog["products"], dropped_unpriced = models.drop_unpriced(catalog["products"])

    catalog["products"] = backfill_catalog(catalog["products"])
    mark_secondhand(catalog["products"])
    type_changes = product_types.fix_types(catalog["products"], classify_audience)
    if type_changes:
        print(f"Product types: corrected {len(type_changes)} clothing/accessory listing(s) from their own names.")
    identity.count_retailers(catalog["products"])
    identity.assign_unique_ids(catalog["products"])

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
    index_history["topMovers"] = compute_category_top_movers(new_stock_only(catalog["products"]))
    index_history["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    save_index_history(index_history)

    bundles = compute_bundles(new_stock_only(catalog["products"]))
    save_bundles(bundles)
    print(f"Complete The Kit: generated {len(bundles)}/{len(BUNDLE_TEMPLATES)} bundle(s) from current lowest prices.")

    outfits = compute_outfits(catalog["products"])
    save_outfits(outfits)
    print(f"Complete The Look: generated {len(outfits)}/{len(OUTFIT_TEMPLATES)} look(s), "
          f"each product used once across the page.")

    existing_category_keys = {c["key"] for c in catalog.get("categories", [])}
    if "sets" not in existing_category_keys:
        catalog.setdefault("categories", []).append({"key": "sets", "label": "Sets"})
        print("Added 'Sets' to the categories list.")

    # One record per real-world model (all lofts, flexes, hands and
    # retailers of e.g. the TaylorMade Qi35 Driver), for the price pages.
    # Wrapped so a problem here can never stop the main catalog refresh.
    try:
        model_list, model_review = models.build_models(catalog["products"], price_history, today_str)
        models.save_models(model_list, model_review, category_changes, dropped_unpriced, today_str)
        models.save_search_suggest(model_list, catalog["products"], today_str)
        # Static price-history pages under /prices/ (see data/price-pages.json).
        price_pages.build(model_list, catalog["products"], today_str)
        # The search page's small per-category index (data/search/).
        live = {d.name for d in price_pages.PRICES_DIR.iterdir() if d.is_dir() and d.name not in price_pages.HUB_TYPES}
        search_index.build(catalog["products"], model_list, live, credible_drop)
        # Used price guide for price-check.html. Its own try, so it can never
        # stop the rest of the model pages.
        try:
            used_prices.build(catalog["products"], model_list, live, today_str)
        except Exception as exc:  # noqa: BLE001
            print(f"WARNING: used price guide skipped this run: {exc!r}")
    except Exception as exc:  # noqa: BLE001 - report and carry on
        print(f"WARNING: model grouping failed this run and was skipped: {exc!r}")

    catalog["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    # Minified (no indent) rather than pretty-printed: this file is never
    # read by a human, only fetched and JSON.parse'd by the browser on
    # every page load. Confirmed via the real live file: indentation alone
    # was adding ~24% pure whitespace (58MB -> 44MB) with zero functional
    # difference in the data.
    DATA_FILE.write_text(json.dumps(catalog))

    # Small precomputed views for the 6 pages that only ever need a
    # curated slice (homepage, Receipts, Back In Stock, Best Time To
    # Buy), plus lighter full-breadth catalogs for the 2 pages that
    # still need live search across a broad slice (Assemble Your
    # Arsenal, Complete The Look) but never needed the heavier insight
    # fields. See the module docstring above compute_homepage_views for
    # the full reasoning and how this was verified.
    save_curated_views(catalog["products"])
    save_lite_catalog(catalog)
    save_apparel_lite_catalog(catalog)

    feed_count = save_deals_feed(new_stock_only(catalog["products"]))
    print(f"Public deals feed: {feed_count} genuinely verified deals published (RSS + JSON Feed).")

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
