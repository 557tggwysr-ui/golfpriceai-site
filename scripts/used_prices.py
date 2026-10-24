"""Used price guide for the "Is this a good price?" checker (price-check.html).

  data/used-prices.json   {"lastUpdated": ..., "m": {slug: [count, inStock, low, p25, median, p75, high]}}

One entry per model with a price page and at least one priced pre-owned,
used or ex-demo listing (the model's preownedIds). These listings are left
out of data/search/ on purpose (the search page is new stock only), so the
checker reads this small file instead. Prices are the listings' own sale
prices; balls are skipped because used balls (lake balls) are a different
product. Run on its own with: python3 scripts/used_prices.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "used-prices.json"


def _pct(xs, q):
    # Linear interpolation between the closest ranks (xs sorted).
    if len(xs) == 1:
        return xs[0]
    k = (len(xs) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def build(products, models_list, live_slugs, today_str):
    by_id = {p["id"]: p for p in products}
    out = {}
    for m in models_list:
        if m["slug"] not in live_slugs or m.get("type") == "ball":
            continue
        rows = [by_id[i] for i in m.get("preownedIds", []) if i in by_id and by_id[i].get("salePrice")]
        if not rows:
            continue
        prices = sorted(round(float(p["salePrice"]), 2) for p in rows)
        in_stock = sum(1 for p in rows if p.get("inStock") is not False)
        out[m["slug"]] = [len(prices), in_stock, prices[0], round(_pct(prices, .25), 2),
                          round(_pct(prices, .5), 2), round(_pct(prices, .75), 2), prices[-1]]
    OUT.write_text(json.dumps({"lastUpdated": today_str, "m": out}, separators=(",", ":")))
    print(f"Used price guide: {len(out)} model(s) with pre-owned listings, "
          f"{sum(1 for v in out.values() if v[0] >= 3)} with 3 or more.")
    return len(out)


if __name__ == "__main__":
    data = json.loads((ROOT / "data" / "models.json").read_text())
    cat = json.loads((ROOT / "data" / "products.json").read_text())
    prods = cat if isinstance(cat, list) else cat.get("products", [])
    live = {d.name for d in (ROOT / "prices").iterdir() if (d / "data.json").exists()}
    build(prods, data["models"], live, data.get("lastUpdated", ""))
