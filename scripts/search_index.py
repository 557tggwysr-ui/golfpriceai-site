"""The search page's index: small files the browser downloads instead of the
full 50 MB catalogue.

  data/search/terms.json   which categories each word appears in, the
                           vocabulary for typo correction, retailer names
  data/search/<cat>.json   one file per category: every new-stock listing
                           (compact rows) plus the models they group into

A search for "lefty drivers under 300" downloads only driver.json; a free
search like "pro v1" uses terms.json to fetch just the categories that
contain those words. Callaway Preowned stock is left out: it lives only in
the shop's Preowned & Trade Ins section.
"""
import json
import re
from collections import defaultdict
from pathlib import Path

from price_pages import listing_options, RETAILERS

OUT = Path(__file__).resolve().parent.parent / "data" / "search"
PREOWNED_SOURCES = {"awin-callawaypreowned"}
USED_GRADES = {"Preowned", "Used", "Like New", "Very Good", "Good", "Average"}
LEFT_RX = re.compile(r"\b(left hand|left-hand|lh|left handed)\b", re.I)
IMG_PREFIXES = ["https://cdn.shopify.com/s/files/1/", "https://www.clickgolf.co.uk/images/product/main/",
                "https://www.scottsdalegolf.co.uk/uploads/", "https://aadh-prd.my.commercecloud.salesforce.com/dw/image/v2/", ""]
URL_PREFIX = "https://www.awin1.com/"
CLUB_CATS = {"driver", "wood", "hybrid", "irons", "wedge", "putter"}
# Flags packed into one number per listing.
F_LEFT, F_IN_STOCK, F_DROP, F_USED = 1, 2, 4, 8
AUDIENCE = {"Male": "M", "Female": "F", "Junior": "J"}


def _is_preowned_partner(p):
    # Any second-hand listing (see is_preowned_partner in update_deals.py).
    return p.get("source") in PREOWNED_SOURCES or bool(p.get("condition"))


def _words(text):
    return re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", text.lower())


def _img(url):
    url = url or ""
    for i, pre in enumerate(IMG_PREFIXES):
        if pre and url.startswith(pre):
            return [i, url[len(pre):]]
    return [len(IMG_PREFIXES) - 1, url]


def build(products, models_list, live_slugs, credible_drop=None):
    OUT.mkdir(parents=True, exist_ok=True)
    sources = sorted({p["source"] for p in products if p.get("source")})
    src_idx = {s: i for i, s in enumerate(sources)}

    # listing id -> model, for the categories the models cover
    model_of = {}
    for m in models_list:
        for lid in m.get("listingIds", []):
            model_of[lid] = m

    shards = defaultdict(lambda: {"models": [], "rows": []})
    model_index = defaultdict(dict)
    word_cats = defaultdict(set)
    vocab = defaultdict(int)

    for p in products:
        if p.get("salePrice") is None or _is_preowned_partner(p):
            continue
        cat = p.get("category") or "accessories"
        shard = shards[cat]
        flags = 0
        if LEFT_RX.search(p["name"]):
            flags |= F_LEFT
        if p.get("inStock") is not False:
            flags |= F_IN_STOCK
        insight = p.get("priceInsight") or {}
        was = 0
        if insight.get("verifiedDiscount") and (credible_drop is None or credible_drop(p)):
            flags |= F_DROP
            was = insight.get("historicalHigh") or 0
        if p.get("condition"):
            flags |= F_USED
        opts = listing_options(p, cat) if cat in CLUB_CATS else {}
        m = model_of.get(p["id"])
        midx = -1
        if m:
            if m["slug"] not in model_index[cat]:
                model_index[cat][m["slug"]] = len(shard["models"])
                shard["models"].append([m["slug"], m["name"], 1 if m["slug"] in live_slugs else 0,
                                        m.get("brand", ""), m["type"]])
            midx = model_index[cat][m["slug"]]
        url = p.get("affiliateUrl", "")
        shard["rows"].append([
            p["id"], p["name"], round(p["salePrice"], 2), round(was, 2), src_idx[p["source"]], flags,
            AUDIENCE.get(p.get("audience"), "M"), p.get("brand") or "",
            opts.get("Loft", ""), p.get("flex") or opts.get("Flex", ""), opts.get("Set makeup", ""),
            p.get("colour") or "", midx,
            url[len(URL_PREFIX):] if url.startswith(URL_PREFIX) else url, _img(p.get("image")),
        ])
        for w in set(_words(p["name"]) + _words(p.get("brand") or "")):
            word_cats[w].add(cat)
            vocab[w] += 1

    cats = sorted(shards)
    cat_idx = {c: i for i, c in enumerate(cats)}
    for cat, shard in shards.items():
        (OUT / f"{cat}.json").write_text(json.dumps(shard, separators=(",", ":"), ensure_ascii=False))
    terms = {
        "cats": cats,
        "counts": {c: len(shards[c]["rows"]) for c in cats},
        "retailers": [RETAILERS.get(s, s) for s in sources],
        "urlPrefix": URL_PREFIX,
        "imgPrefixes": IMG_PREFIXES,
        # word -> categories it appears in (as indexes); words seen 2+ times
        # double as the vocabulary for "did you mean".
        "words": {w: [cat_idx[c] for c in sorted(cs)] for w, cs in word_cats.items() if vocab[w] >= 2 or len(w) >= 4},
    }
    (OUT / "terms.json").write_text(json.dumps(terms, separators=(",", ":"), ensure_ascii=False))
    total = sum(len(s["rows"]) for s in shards.values())
    print(f"Search index: {total} listings in {len(cats)} category files, {len(terms['words'])} words.")
    return total
