"""
GolfPrice AI — pricing verification / diff tool.

WHAT THIS DOES
--------------
Read-only dry run: pulls a fresh copy of the Clickgolf AWIN feed, re-parses
it with the SAME logic scripts/update_deals.py uses (imported directly, not
duplicated — so this can never silently drift out of sync with the real
pricing logic), and compares the result against whatever is currently
stored in data/products.json. Nothing is written back to products.json.

Use it to answer "if I ran the real update right now, what prices or
discounts would change?" — either as a preview before deploying a fix, or
as a confirmation check after deploying one.

HOW TO RUN
----------
Via the "Verify Pricing" GitHub Action (Actions tab > Verify Pricing > Run
workflow). The full diff prints straight into that run's log — no local
Python setup needed. It reads the same AWIN_CLICKGOLF_FEED_URL secret the
main update workflow already uses.
"""

import json
from pathlib import Path

from update_deals import fetch_awin_clickgolf_deals

DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "products.json"

# Ignore sub-penny rounding noise; only report differences that actually
# matter to a shopper.
PRICE_TOLERANCE = 0.02


def fmt_money(value):
    return f"£{value:,.2f}" if value is not None else "—"


def main():
    catalog = json.loads(DATA_FILE.read_text())
    existing_by_name = {p["name"]: p for p in catalog.get("products", [])}

    fresh = fetch_awin_clickgolf_deals()
    if not fresh:
        print("No feed data returned — check the AWIN_CLICKGOLF_FEED_URL secret "
              "is set correctly. Nothing to compare.")
        return

    changed = []
    new_discounts = []
    removed_discounts = []
    unchanged = 0
    new_products = 0

    for item in fresh:
        existing = existing_by_name.get(item["name"])
        if existing is None:
            new_products += 1
            continue

        old_sale = existing.get("salePrice")
        old_retail = existing.get("retailPrice")
        old_pct = existing.get("savePct", 0)
        new_sale = item["salePrice"]
        new_retail = item["retailPrice"]
        new_pct = item["savePct"]

        sale_diff = old_sale is None or abs(old_sale - new_sale) > PRICE_TOLERANCE
        retail_diff = old_retail is None or abs(old_retail - new_retail) > PRICE_TOLERANCE

        if not sale_diff and not retail_diff and old_pct == new_pct:
            unchanged += 1
            continue

        row = {
            "name": item["name"],
            "old_sale": old_sale, "new_sale": new_sale,
            "old_retail": old_retail, "new_retail": new_retail,
            "old_pct": old_pct, "new_pct": new_pct,
        }
        changed.append(row)

        if old_pct == 0 and new_pct > 0:
            new_discounts.append(row)
        elif old_pct > 0 and new_pct == 0:
            removed_discounts.append(row)

    print("=" * 70)
    print("GolfPrice AI — Pricing Verification (read-only, nothing was changed)")
    print("=" * 70)
    print(f"Products in fresh feed:            {len(fresh)}")
    print(f"Matched against existing catalog:  {len(fresh) - new_products}")
    print(f"New products not yet in catalog:   {new_products}")
    print(f"Unchanged:                         {unchanged}")
    print(f"Changed price and/or discount:     {len(changed)}")
    print(f"  - discount newly appeared:       {len(new_discounts)}")
    print(f"  - discount disappeared:          {len(removed_discounts)}")
    print()

    if changed:
        print("-" * 70)
        print("FULL DIFF — every product whose price or discount changed")
        print("(sorted by biggest sale-price change first)")
        print("-" * 70)
        for row in sorted(
            changed,
            key=lambda r: abs((r["old_sale"] or 0) - r["new_sale"]),
            reverse=True,
        ):
            print(f"\n{row['name']}")
            print(f"  Sale price:   {fmt_money(row['old_sale'])} -> {fmt_money(row['new_sale'])}")
            print(f"  Retail price: {fmt_money(row['old_retail'])} -> {fmt_money(row['new_retail'])}")
            print(f"  Discount:     {row['old_pct']}% -> {row['new_pct']}%")

    if removed_discounts:
        print()
        print("-" * 70)
        print(f"NOTE: {len(removed_discounts)} product(s) previously showed a discount "
              f"that no longer holds up under the corrected price logic")
        print("(most likely explained by the store_price/search_price mix-up bug)")
        print("-" * 70)
        for row in removed_discounts:
            print(f"  - {row['name']}: was {row['old_pct']}% off, now {row['new_pct']}%")

    print()
    print("This was a read-only check. data/products.json was NOT modified.")
    print("To actually apply these changes, run the normal 'Update Deals' "
          "workflow (or wait for its next scheduled run).")


if __name__ == "__main__":
    main()
