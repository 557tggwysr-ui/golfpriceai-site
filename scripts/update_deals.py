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
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "products.json"

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
ACCESSORY_OVERRIDE_WORDS = [
    "cover", "protector", "headcover", "divot", "tee", "towel",
    "marker", "brush", "groove",
]

CLUB_SHAPE_KEYWORDS = [
    ("putter", "putter"), ("driver", "driver"), ("hybrid", "hybrid"),
    ("fairway", "wood"), ("wood", "wood"), ("wedge", "wedge"),
    ("iron", "irons"),
]
GENERAL_KEYWORDS = [
    ("ball", "ball"), ("bag", "bag"),
    ("shoe", "shoes"), ("trouser", "apparel"), ("short", "apparel"),
    ("skort", "apparel"), ("polo", "apparel"), ("jacket", "apparel"),
    ("hoodie", "apparel"), ("cap", "apparel"), ("hat", "apparel"),
    ("glove", "accessories"), ("sock", "apparel"), ("belt", "apparel"),
    ("sunglass", "apparel"), ("rangefinder", "accessories"),
    ("gps", "accessories"), ("watch", "accessories"),
    ("cart", "accessories"), ("umbrella", "accessories"),
    ("headcover", "accessories"),
    ("pullover", "apparel"), ("gilet", "apparel"), ("vest", "apparel"),
    ("quarterzip", "apparel"), ("quarter-zip", "apparel"), ("quarter zip", "apparel"),
    ("1/4 zip", "apparel"), ("1/2 zip", "apparel"),
    ("midlayer", "apparel"), ("mid-layer", "apparel"), ("mid layer", "apparel"),
    ("sweater", "apparel"), ("shirt", "apparel"), ("zip top", "apparel"),
    ("golf top", "apparel"),
]


def guess_category(category_name, merchant_category, name):
    """Category guess in priority order:

    0. If the product name itself contains a strong "this is a small
       accessory" signal (cover, protector, tee, etc.), trust that over
       everything else — retailers sometimes file headcovers/tees under
       their matching club type, which would otherwise fool step 1.
    1. Retailer's own taxonomy text (category_name / merchant_category),
       checked against the full keyword list including club shapes.
    2. The product name, checked against GENERAL_KEYWORDS (apparel/
       accessory nouns) first — an unambiguous word like "cap" or "polo"
       wins even if a club-shape word like "driver" also appears.
    3. Only then does it check the name against CLUB_SHAPE_KEYWORDS.

    All matching is whole-word (see _has_word) to avoid substring false
    positives like "wood" inside "Woodmark" or "Wooden".
    """
    name_text = (name or "").lower()

    for word in ACCESSORY_OVERRIDE_WORDS:
        if _has_word(name_text, word):
            return "accessories"

    cat_text = " ".join(f for f in (category_name, merchant_category) if f).lower()
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

    return "accessories"


# Sub-type "icon" keywords — these match the exact values used in
# js/groups-config.js's "types" arrays for the Apparel/Accessories hub
# pages. Without one of these set, an apparel/accessories product is
# correctly categorized but invisible on every hub sub-page, since those
# pages filter by icon, not just by the broad category.
ICON_KEYWORDS = [
    ("polo", "polo"), ("shirt", "polo"),
    ("trouser", "trousers"), ("pant", "trousers"),
    ("skort", "skort"),
    ("short", "shorts"),
    ("jacket", "jacket"),
    ("hoodie", "hoodie"),
    ("pullover", "jacket"), ("gilet", "jacket"), ("vest", "jacket"),
    ("quarterzip", "jacket"), ("quarter-zip", "jacket"), ("quarter zip", "jacket"),
    ("1/4 zip", "jacket"), ("1/2 zip", "jacket"), ("sweater", "jacket"), ("zip top", "jacket"),
    ("golf top", "jacket"),
    ("midlayer", "jacket"), ("mid-layer", "jacket"), ("mid layer", "jacket"),
    ("base layer", "base-layer"), ("baselayer", "base-layer"), ("thermal", "base-layer"),
    ("cap", "cap"), ("visor", "cap"), ("hat", "cap"),
    ("sunglass", "sunglasses"),
    ("belt", "belt"),
    ("sock", "socks"),
    ("gps watch", "gps-watch"), ("golf watch", "gps-watch"),
    ("rangefinder", "rangefinder"), ("range finder", "rangefinder"),
    ("shot tracker", "sensor"), ("arccos", "sensor"),
    ("push cart", "pushcart"), ("pushcart", "pushcart"), ("trolley", "pushcart"),
    ("headcover", "headcover"), ("head cover", "headcover"),
    ("umbrella", "umbrella"),
    ("divot", "divot-tool"),
    ("alignment stick", "alignment-sticks"),
    ("glove", "accessories"),
]


def guess_icon(category_name, merchant_category, name, category):
    """Best-effort sub-type icon, only relevant for apparel/accessories
    products. Returns None (no icon set) if nothing matches — the product
    still shows up fine everywhere except a specific hub sub-page filter,
    which is a much smaller miss than not showing up on the site at all."""
    if category not in ("apparel", "accessories"):
        return None
    text = " ".join(f for f in (category_name, merchant_category, name) if f).lower()
    for keyword, icon in ICON_KEYWORDS:
        if _has_word(text, keyword):
            return icon
    if category == "accessories":
        return "accessories"  # generic catch-all bucket, matches groups-config.js
    return None


def fetch_awin_clickgolf_deals():
    """Pull real, live products + prices from the Clickgolf AWIN datafeed.

    Needs AWIN_CLICKGOLF_FEED_URL as a repo secret — the manual download URL
    generated in Awin's Toolbox > Create-a-Feed (CSV, gzip, comma-delimited),
    configured with these columns: aw_deep_link, product_name, aw_product_id,
    merchant_product_id, merchant_image_url, description, merchant_category,
    search_price, store_price, merchant_deep_link, last_updated,
    display_price, category_name, brand_name, rrp_price, savings_percent,
    product_price_old, in_stock.

    A genuine "deal" only counts here if the feed itself reports a real
    saving (rrp_price/product_price_old higher than the current price) —
    nothing is invented or estimated.
    """
    feed_url = os.environ.get("AWIN_CLICKGOLF_FEED_URL")
    if not feed_url:
        return []

    try:
        with urllib.request.urlopen(feed_url, timeout=60) as resp:
            raw = resp.read()
    except Exception as exc:
        print(f"Clickgolf feed download failed, leaving catalog untouched: {exc}")
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

    print(f"Clickgolf feed: columns found = {reader.fieldnames}")

    products = []
    total_rows = 0
    skipped_no_name = 0
    skipped_out_of_stock = 0
    skipped_no_price = 0
    skipped_no_link = 0

    for row in reader:
        total_rows += 1
        name = (row.get("product_name") or "").strip()
        if not name:
            skipped_no_name += 1
            continue

        # Skip anything explicitly marked out of stock rather than showing
        # a "deal" nobody can actually buy.
        in_stock = (row.get("in_stock") or "").strip().lower()
        if in_stock in ("0", "false", "no"):
            skipped_out_of_stock += 1
            continue

        def to_float(key):
            val = (row.get(key) or "").strip()
            if not val:
                return None
            try:
                return float(val)
            except ValueError:
                return None

        sp = to_float("store_price")
        if sp is None:
            sp = to_float("display_price")
        if sp is None:
            sp = to_float("search_price")
        sale_price = sp
        if sale_price is None:
            skipped_no_price += 1
            continue

        old_price = to_float("rrp_price")
        if old_price is None:
            old_price = to_float("product_price_old")
        save_pct_raw = to_float("savings_percent")

        if old_price and old_price > sale_price:
            retail_price = old_price
            save_pct = round((1 - sale_price / retail_price) * 100)
        elif save_pct_raw and save_pct_raw > 0:
            retail_price = round(sale_price / (1 - save_pct_raw / 100), 2)
            save_pct = round(save_pct_raw)
        else:
            # No genuine discount reported by the feed — list at face value,
            # no invented "was" price.
            retail_price = sale_price
            save_pct = 0

        affiliate_url = (row.get("aw_deep_link") or row.get("merchant_deep_link") or "").strip()
        if not affiliate_url:
            skipped_no_link += 1
            continue

        image = (row.get("merchant_image_url") or "").strip()
        category = guess_category(row.get("category_name"), row.get("merchant_category"), name)
        icon = guess_icon(row.get("category_name"), row.get("merchant_category"), name, category)
        product_id = f"{category}-{slugify(name)}-clickgolf"

        product = {
            "id": product_id,
            "name": name,
            "category": category,
            "retailPrice": retail_price,
            "salePrice": sale_price,
            "savePct": max(save_pct, 0),
            "retailerCount": 1,
            "affiliateUrl": affiliate_url,
            "source": "awin-clickgolf",
        }
        if image:
            product["image"] = image
        if icon:
            product["icon"] = icon
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
        f"Clickgolf feed: {total_rows} rows read, {len(products)} usable. "
        f"Skipped — no name: {skipped_no_name}, out of stock: {skipped_out_of_stock}, "
        f"no price: {skipped_no_price}, no link: {skipped_no_link}."
    )
    print(f"Clickgolf feed: category breakdown = {category_counts}")
    print(
        f"Clickgolf feed: {with_icon}/{len(apparel_accessories)} apparel/accessories "
        f"products got a hub-page icon assigned. Icon breakdown = {icon_counts}"
    )
    return products


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


def merge_products(catalog_products, fresh_products):
    """Merge freshly-fetched products into the existing catalog: update
    matching items by name, add new ones, and never delete anything that
    isn't in the fresh batch (so a temporary feed hiccup can't wipe the
    catalog)."""
    by_name = {p["name"]: p for p in catalog_products}
    for item in fresh_products:
        if item["name"] in by_name:
            by_name[item["name"]].update(item)
        else:
            by_name[item["name"]] = item
    return list(by_name.values())


def main():
    catalog = json.loads(DATA_FILE.read_text())

    fresh = (
        fetch_cj_deals()
        + fetch_awin_deals()
        + fetch_awin_clickgolf_deals()
        + fetch_impact_deals()
    )

    if fresh:
        catalog["products"] = merge_products(catalog["products"], fresh)
        print(f"Merged {len(fresh)} products from live feeds into the catalog "
              f"({len(catalog['products'])} products total).")
    else:
        print("No live feed data returned this run — catalog left as-is "
              f"({len(catalog['products'])} products, Amazon links still active).")

    catalog["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.write_text(json.dumps(catalog, indent=2))


if __name__ == "__main__":
    main()
