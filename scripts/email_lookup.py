"""Small product lookup files for the email worker: data/lookup/<xx>.json

"Email me this list" (Assemble Your Arsenal) sends the visitor's bag by
email from the Cloudflare worker. The page only tells the worker which
product ids are in the bag; the worker reads each product's name, price,
retailer and link from these files, so nothing typed into the page ever
ends up in an email (no one can use the button to send their own message).

The Back In Stock Radar's "Notify me" uses them too (the worker checks the
product exists and takes its name from here).

Products are split across 256 files by the first two hex characters of the
SHA-1 of their id (the worker does the same sum), so each file is small and
the worker only fetches the few it needs. Rebuilt every 6 hours; a file is
only rewritten when its contents change.

Each entry: id -> [name, price, retailer, link, image, price page slug or "", in stock (1/0)]
"""
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from price_pages import retailer_name

ROOT = Path(__file__).resolve().parent.parent
LOOKUP_DIR = ROOT / "data" / "lookup"
CLOTHING = {"apparel", "shoes"}


def shard(pid):
    return hashlib.sha1(pid.encode("utf-8")).hexdigest()[:2]


def build(products, passing, built):
    model_of = {}
    for m in passing:
        if m["slug"] in built:
            for lid in m.get("listingIds") or []:
                model_of[lid] = m["slug"]
    shards = defaultdict(dict)
    for p in products:
        if not p.get("id") or not p.get("affiliateUrl") or p.get("salePrice") is None:
            continue
        # Clothing and shoes aren't in Assemble Your Arsenal, so only the
        # sold-out ones are needed (for back-in-stock alerts). Keeps the
        # files small.
        if p.get("category") in CLOTHING and p.get("inStock") is not False:
            continue
        shards[shard(p["id"])][p["id"]] = [
            p.get("name", "")[:160], round(float(p["salePrice"]), 2), retailer_name(p.get("source") or ""),
            p["affiliateUrl"], p.get("image") or "", model_of.get(p["id"], ""), 0 if p.get("inStock") is False else 1]
    LOOKUP_DIR.mkdir(parents=True, exist_ok=True)
    changed = 0
    for i in range(256):
        key = f"{i:02x}"
        path = LOOKUP_DIR / f"{key}.json"
        text = json.dumps(shards.get(key, {}), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
            changed += 1
    print(f"Email lookup: {sum(len(s) for s in shards.values())} products in 256 files ({changed} changed).")


def load(ids):
    """{id: entry} for the given ids, from the files on disk."""
    out, by_shard = {}, defaultdict(list)
    for pid in ids:
        by_shard[shard(pid)].append(pid)
    for key, pids in by_shard.items():
        path = LOOKUP_DIR / f"{key}.json"
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        for pid in pids:
            if pid in data:
                out[pid] = data[pid]
    return out
