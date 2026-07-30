"""
GolfPrice AI — raw feed row inspector.

WHAT THIS DOES
--------------
Downloads the Clickgolf AWIN feed fresh and prints EVERY raw row whose
product name contains a given search term — completely unprocessed, before
any of our category/price logic touches it. Use this to check whether
multiple feed rows (e.g. different sizes of the same sock) are sharing an
identical product_name, which would explain a product landing on the wrong
price: data/products.json merges by name, so if two rows share a name,
only one of them can "win" and the other's price is effectively lost.

This never touches data/products.json — read-only, diagnostic only.

HOW TO RUN
----------
Via the "Diagnose Feed" GitHub Action (Actions tab > Diagnose Feed > Run
workflow), entering the product name (or part of it) to search for.
"""

import csv
import gzip
import io
import os
import sys
import urllib.request

# Columns worth showing side by side for this kind of investigation.
COLUMNS_TO_SHOW = [
    "aw_product_id",
    "merchant_product_id",
    "product_name",
    "search_price",
    "store_price",
    "display_price",
    "rrp_price",
    "product_price_old",
    "savings_percent",
    "in_stock",
    "aw_deep_link",
]


def main():
    search_term = os.environ.get("SEARCH_TERM") or (sys.argv[1] if len(sys.argv) > 1 else "")
    search_term = search_term.strip()
    if not search_term:
        print("No search term given — set SEARCH_TERM env var or pass as an argument.")
        return

    feed_url = os.environ.get("AWIN_CLICKGOLF_FEED_URL")
    if not feed_url:
        print("AWIN_CLICKGOLF_FEED_URL secret not set — cannot download the feed.")
        return

    print(f"Downloading feed and searching for product names containing: {search_term!r}\n")

    with urllib.request.urlopen(feed_url, timeout=60) as resp:
        raw = resp.read()

    try:
        raw = gzip.decompress(raw)
    except OSError:
        pass  # wasn't gzipped

    text = raw.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))

    print(f"Feed columns available: {reader.fieldnames}\n")
    print("=" * 90)

    matches = 0
    seen_names = {}
    for row in reader:
        name = (row.get("product_name") or "").strip()
        if search_term.lower() not in name.lower():
            continue
        matches += 1
        seen_names[name] = seen_names.get(name, 0) + 1

        print(f"\nMatch #{matches}")
        for col in COLUMNS_TO_SHOW:
            print(f"  {col:22s} = {row.get(col)!r}")

    print("\n" + "=" * 90)
    print(f"Total matching rows: {matches}")

    duplicated_names = {n: c for n, c in seen_names.items() if c > 1}
    if duplicated_names:
        print(f"\n⚠ {len(duplicated_names)} product name(s) appear on MULTIPLE separate rows:")
        for name, count in duplicated_names.items():
            print(f"  - {count}x  {name}")
        print(
            "\nThis confirms a name collision: data/products.json merges by "
            "product name only, so when multiple rows (e.g. different sizes) "
            "share an identical name, only one row's price survives — the "
            "others are effectively discarded. This is very likely the cause "
            "of the still-wrong price."
        )
    else:
        print("\nNo duplicate names found among the matches above — a name "
              "collision is NOT the explanation here. Look at the individual "
              "row's price columns above instead; the wrong figure is likely "
              "coming from one specific column being trusted incorrectly for "
              "this particular row.")


if __name__ == "__main__":
    main()
