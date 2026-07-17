"""
GolfPrice AI — automated deal refresh script.

WHAT THIS DOES
--------------
Runs on a schedule (see .github/workflows/update-deals.yml), pulls current
product prices from your affiliate networks, picks the best deals, and
overwrites data/deals.json. The website itself never changes — it just
reads whatever is in that file. This is the "hands-off" pipeline.

WHY IT USES AFFILIATE NETWORK FEEDS INSTEAD OF SCRAPING RETAILERS DIRECTLY
---------------------------------------------------------------------------
Scraping golf retailer websites directly usually violates their Terms of
Service and gets your server's IP address blocked. The networks below give
you legitimate, ToS-compliant product + price data because you're a
registered affiliate with them — this is the same data feed real deal
sites (Slickdeals, honey, etc.) are built on.

This also solves the "wrong photo, dead link" problem for good: every
product a network's feed returns already comes with (a) the retailer's own
licensed product photo and (b) a working, trackable affiliate link baked in.
Once fetch_cj_deals() etc. below are wired to real API calls, every product
written into deals.json will include real "image" and "affiliateUrl" fields
automatically — the front-end (js/app.js) already prefers a real photo over
the placeholder icon whenever one is present, so nothing else needs to
change on the site itself.

SETUP YOU NEED TO DO ONCE (see README.md for full steps):
1. Get accepted into CJ Affiliate, AWIN, and/or Impact Radius as a publisher.
2. Find each network's "Product/Content Feed" or "Advertiser API" section
   and grab an API key + your unique affiliate/tracking ID.
3. Add those as GitHub repo secrets: CJ_API_KEY, AWIN_API_KEY, IMPACT_API_KEY,
   plus your tracking IDs (CJ_PID, AWIN_PUBLISHER_ID, IMPACT_ACCOUNT_SID).
4. Replace the placeholder fetch_* functions below with real calls once you
   have credentials — the network docs give you the exact endpoint. This is
   the one piece of real coding this project still needs; happy to write
   the exact integration with you once you've got a key from any one network.

Until you plug in real credentials, this script safely no-ops and leaves
your current deals.json untouched, so the live site never breaks.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "deals.json"

# Your Amazon Associates tracking tag. This is safe to keep in code (not a
# secret) — it's the public tag that appears in every affiliate link anyway.
AMAZON_ASSOCIATE_TAG = "golfpriceai-21"


def amazon_search_link(product_name):
    """Builds a real, working, commission-earning Amazon link for a product
    name. This works today even without Amazon's Product Advertising API
    (which unlocks after 3 tracked sales) — it just won't auto-update prices
    until the API is available, so treat it as the fallback link whenever a
    CJ/AWIN price isn't available for that product yet."""
    return f"https://www.amazon.co.uk/s?k={quote_plus(product_name)}&tag={AMAZON_ASSOCIATE_TAG}"


def fetch_cj_deals():
    """Pull products from CJ Affiliate's GraphQL Product Search API.

    Needs CJ_API_TOKEN and CJ_CID as repo secrets (already set up).
    IMPORTANT: CJ only returns products from advertisers you've actually
    joined — having API credentials isn't enough on its own. Until at least
    one golf retailer shows as "joined" in your CJ account, this safely
    returns nothing and the site falls back to Amazon links.
    """
    token = os.environ.get("CJ_API_TOKEN")
    cid = os.environ.get("CJ_CID")
    if not token or not cid:
        return []
    # TODO: once you've joined a CJ advertiser, real query looks like:
    #   POST https://ads.api.cj.com/query
    #   Header: Authorization: Bearer <CJ_API_TOKEN>
    #   Body: { "query": "{ products(companyId: \"<CJ_CID>\", keywords: \"golf driver\", limit: 5) { ... } }" }
    # Exact field names should be checked in CJ's GraphQL explorer at
    # developers.cj.com — come back to a Claude chat once you're joined to
    # a retailer and this gets finished off in a few minutes.
    return []


def fetch_awin_deals():
    """Pull products from AWIN's product data feed.

    Needs AWIN_API_TOKEN and AWIN_PUBLISHER_ID as repo secrets (already set
    up). AWIN's data comes as a per-advertiser feed download, so this also
    needs an AWIN_ADVERTISER_ID for each retailer you're approved with —
    add one once your pending applications (e.g. TGW) are approved.
    """
    token = os.environ.get("AWIN_API_TOKEN")
    if not token:
        return []
    advertiser_id = os.environ.get("AWIN_ADVERTISER_ID")
    if not advertiser_id:
        # No approved retailer yet — nothing to pull. This will stop
        # returning empty the moment an application is approved and its
        # advertiser ID is added as a secret.
        return []
    # TODO: once approved, real feed download looks like:
    #   GET https://productdata.awin.com/datafeed/download/apikey/<AWIN_API_TOKEN>
    #       /language/en/cid/<advertiser_id>/format/csv
    # Parse the returned CSV (columns include product name, price, image
    # URL, and aw_deep_link — a working affiliate link already built in).
    return []


def fetch_impact_deals():
    """Placeholder: pull products from Impact's Catalog API."""
    api_key = os.environ.get("IMPACT_API_KEY")
    if not api_key:
        return []
    # TODO: real Impact Catalog API call goes here once you have a key.
    # Docs: https://developer.impact.com/
    return []


def rank_best_deals(all_products, top_n=3):
    """Pick the biggest % discounts to feature as 'Today's Best Golf Deals'."""
    ranked = sorted(all_products, key=lambda p: p.get("savePct", 0), reverse=True)
    return ranked[:top_n]


def main():
    current = json.loads(DATA_FILE.read_text())

    products = fetch_cj_deals() + fetch_awin_deals() + fetch_impact_deals()

    if not products:
        # No approved CJ/AWIN retailer feed yet — this is expected right now
        # (applications pending). The existing Amazon links already in
        # deals.json keep working regardless, so we just bump the timestamp
        # and leave everything else as-is.
        current["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        DATA_FILE.write_text(json.dumps(current, indent=2))
        print("No approved CJ/AWIN retailer feed yet — deals.json left as-is (Amazon links still active).")
        return

    current["bestDeals"] = rank_best_deals(products)
    current["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.write_text(json.dumps(current, indent=2))
    print(f"Updated deals.json with {len(products)} products.")


if __name__ == "__main__":
    main()
