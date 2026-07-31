"""
GolfPrice AI — raw feed row inspector.

WHAT THIS DOES
--------------
Downloads the AWIN feed fresh and prints EVERY raw column for every row
whose product name contains a given search term — completely unprocessed,
before any of our category/price logic touches it.

UPDATED THIS SESSION: previously only printed a fixed subset of 11 columns
(price fields, IDs, the deep link). That subset never included
`description` — which turned out to matter, because a real incident
showed 54 separate Clickgolf listings sharing one identical, under-specific
product_name ("Callaway Apex Ti Fusion Golf Irons - Steel", with prices
ranging £289–£2,339, almost certainly different configurations like a
single replacement iron vs. several full-set shaft/spec options). If the
`description` field (or any other column not previously shown) actually
distinguishes these listings, that's a real fix: append the distinguishing
detail to the product name so these stop colliding entirely, instead of
merging them into one median-price approximation. Now prints every column
present in the feed, so nothing gets missed a second time.

This never touches data/products.json — read-only, diagnostic only.

HOW TO RUN
----------
Via the "Diagnose Feed" GitHub Action (Actions tab > Diagnose Feed > Run
workflow). Two inputs: which retailer's feed to check, and the product
name (or part of it) to search for.
"""

import csv
import gzip
import io
import os
import sys
import urllib.request

FEED_URL_ENV_VARS = {
    "clickgolf": "AWIN_CLICKGOLF_FEED_URL",
    "majorgolf": "AWIN_MAJORGOLF_FEED_URL",
}


def main():
    search_term = os.environ.get("SEARCH_TERM") or (sys.argv[1] if len(sys.argv) > 1 else "")
    search_term = search_term.strip()
    if not search_term:
        print("No search term given — set SEARCH_TERM env var or pass as an argument.")
        return

    retailer = (os.environ.get("RETAILER") or "clickgolf").strip().lower()
    env_var_name = FEED_URL_ENV_VARS.get(retailer)
    if not env_var_name:
        print(f"Unknown retailer {retailer!r} — expected one of: {list(FEED_URL_ENV_VARS)}")
        return

    feed_url = os.environ.get(env_var_name)
    if not feed_url:
        print(f"{env_var_name} secret not set — cannot download the {retailer} feed.")
        return

    print(f"Downloading {retailer} feed and searching for product names containing: {search_term!r}\n")

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
    seen_names = {}  # name -> list of prices, to summarise the spread at the end
    for row in reader:
        name = (row.get("product_name") or "").strip()
        if search_term.lower() not in name.lower():
            continue
        matches += 1
        price = row.get("search_price") or row.get("display_price") or ""
        seen_names.setdefault(name, []).append(price)

        print(f"\nMatch #{matches}")
        # Every column, not a fixed subset — so nothing gets missed the
        # way `description` was missed last time.
        for col in sorted(row.keys()):
            print(f"  {col:22s} = {row.get(col)!r}")

    print("\n" + "=" * 90)
    print(f"Total matching rows: {matches}")

    duplicated_names = {n: prices for n, prices in seen_names.items() if len(prices) > 1}
    if duplicated_names:
        print(f"\n⚠ {len(duplicated_names)} product name(s) appear on MULTIPLE separate rows:")
        for name, prices in duplicated_names.items():
            numeric = sorted(float(p) for p in prices if p)
            spread = f" (£{numeric[0]:.2f} \u2013 £{numeric[-1]:.2f})" if numeric else ""
            print(f"  - {len(prices)}x  {name}{spread}")
        print(
            "\nThis confirms a name collision. IMPORTANT: check the `description` field "
            "(and any other column) above for each matching row — if it contains real "
            "distinguishing detail (e.g. a specific iron count, single-vs-set, shaft spec) "
            "that the product_name itself lacks, that's the fix: append it to the name so "
            "these listings stop colliding at all, instead of merging into one approximate "
            "price."
        )
    else:
        print("\nNo duplicate names found among the matches above — a name "
              "collision is NOT the explanation here.")


if __name__ == "__main__":
    main()
