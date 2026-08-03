"""
GolfPrice AI — one-time placeholder cleanup.

WHAT THIS DOES
--------------
Removes the original hand-curated "starter" products from before real
affiliate feeds existed. These were always meant as temporary illustrative
data, but since the main pipeline (merge_products) correctly never deletes
anything a fresh feed run doesn't mention, all of them have been quietly
sitting in the live catalog this whole time — mixed in with genuinely
tracked AWIN data, with fabricated retailerCount values and non-functional
generic Amazon search links (not real product pages) instead of real
tracked prices.

SAFETY — exactly what gets removed, and why this can never touch a real
future Amazon product once PA-API access is live:
A product is only removed if BOTH are true:
  1. "source" == "amazon"
  2. affiliateUrl matches the OLD placeholder pattern specifically:
     https://www.amazon.co.uk/s?k=...&tag=golfpriceai-21
     (a generic Amazon SEARCH link — no product ID, doesn't even point
     at a specific real item)
A real Amazon product added later via the actual Product Advertising API
will use a genuine product-page link (amazon.co.uk/dp/{ASIN}?tag=...),
which does NOT match this pattern — so this script is inherently
incapable of ever removing real, live Amazon data, only the old
placeholders.

This is a ONE-TIME cleanup, not part of the regular pipeline — run it
once via the Actions tab, review what it removed in the log, done.
"""

import json
import re
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "products.json"

PLACEHOLDER_URL_PATTERN = re.compile(r"amazon\.co\.uk/s\?k=.*tag=golfpriceai-21")


def is_placeholder(product):
    if product.get("source") != "amazon":
        return False
    url = product.get("affiliateUrl", "")
    return bool(PLACEHOLDER_URL_PATTERN.search(url))


def main():
    catalog = json.loads(DATA_FILE.read_text())
    products = catalog.get("products", [])

    to_remove = [p for p in products if is_placeholder(p)]
    kept = [p for p in products if not is_placeholder(p)]

    print(f"Total products before cleanup: {len(products)}")
    print(f"Placeholder products found (source=amazon, generic search link): {len(to_remove)}")

    if not to_remove:
        print("Nothing to remove — the catalog is already clean of old placeholders.")
        return

    print("\nRemoving:")
    for p in to_remove:
        print(f"  - {p.get('name')} (£{p.get('salePrice')}, retailerCount={p.get('retailerCount')})")

    catalog["products"] = kept
    DATA_FILE.write_text(json.dumps(catalog, indent=2))

    print(f"\nDone. Total products after cleanup: {len(kept)}")
    print("data/products.json has been updated and written directly by this run.")


if __name__ == "__main__":
    main()
