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

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "deals.json"


def fetch_cj_deals():
    """Placeholder: pull products from CJ Affiliate's Product Search API."""
    api_key = os.environ.get("CJ_API_KEY")
    if not api_key:
        return []
    # TODO: real CJ Product Search API call goes here once you have a key.
    # Docs: https://developers.cj.com/docs/rest-apis/product-search
    return []


def fetch_awin_deals():
    """Placeholder: pull products from AWIN's Product Feed / Datafeed API."""
    api_key = os.environ.get("AWIN_API_KEY")
    if not api_key:
        return []
    # TODO: real AWIN datafeed call goes here once you have a key.
    # Docs: https://wiki.awin.com/index.php/Product_Data_Feed
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
        # No live feed credentials configured yet — leave the file alone,
        # just bump the timestamp so you can see the job is running.
        current["lastUpdated"] = datetime.now(timezone.utc).isoformat()
        DATA_FILE.write_text(json.dumps(current, indent=2))
        print("No affiliate credentials configured yet — deals.json left as-is.")
        return

    current["bestDeals"] = rank_best_deals(products)
    current["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    DATA_FILE.write_text(json.dumps(current, indent=2))
    print(f"Updated deals.json with {len(products)} products.")


if __name__ == "__main__":
    main()
