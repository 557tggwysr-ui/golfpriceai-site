"""How a listing is identified, and the one-off move of the history files to
that identity.

A listing is one retailer's product: "retailer + product name". Before
Oct 2026 the catalogue and both history files were keyed by product name
alone, so two retailers selling an identically named product, or Callaway's
new and pre-owned versions of the same club, were squashed into one record
and shared one price history. That produced fake "90% off" drops (a used
iron's price following a new set's price).

Product ids had a related problem: they were built from the first 60
characters of the name, so ~19,900 listings shared an id with another
listing (for example "Opus SP Chrome Wedge" and "Opus SP+ Chrome Wedge").
"""
import hashlib
import json
from collections import defaultdict

HISTORY_FORMAT = "listing-v1"
USED_GRADES = {"Preowned", "Used", "Like New", "Very Good", "Good", "Average"}


def listing_key(p):
    """The identity of one retailer's listing."""
    return f"{p.get('source', '')}|{p['name']}"


def _fingerprint(p):
    return hashlib.sha1(listing_key(p).encode("utf-8")).hexdigest()[:6]


def assign_unique_ids(products):
    """Keeps every existing id that is already unique; where several
    listings share one, each gets a short fingerprint of its own retailer +
    name added, so the id stays the same run after run."""
    groups = defaultdict(list)
    for p in products:
        base = p.get("id") or ""
        # Strip a fingerprint added on an earlier run before regrouping.
        if len(base) > 7 and base[-7] == "-" and all(c in "0123456789abcdef" for c in base[-6:]) \
                and base.endswith(_fingerprint(p)):
            base = base[:-7]
        p["id"] = base
        groups[base].append(p)
    changed = 0
    for base, members in groups.items():
        if len(members) > 1:
            for p in members:
                p["id"] = f"{base}-{_fingerprint(p)}"
                changed += 1
    if changed:
        print(f"Ids: {changed} listing(s) shared an id with another listing; each now has its own.")
    return products


def migrate_history_file(path, old_catalog_products, label):
    """Moves a name-keyed history file to retailer + name keys, once.

    Each old name had exactly one catalogue record, so its history moves to
    that record's retailer. Histories from records that had absorbed a
    pre-owned listing (a Callaway club carrying a used grade) are dropped
    rather than carried over, because they mix new and used prices."""
    if not path.exists():
        return False
    data = json.loads(path.read_text())
    if data.get("format") == HISTORY_FORMAT:
        return False
    old = data.get("products", {})
    by_name = {p["name"]: p for p in old_catalog_products}
    new, moved, dropped = {}, 0, 0
    for name, entries in old.items():
        p = by_name.get(name)
        if not p:
            continue
        if p.get("source") == "awin-callaway" and p.get("condition") in USED_GRADES:
            dropped += 1
            continue
        new[listing_key(p)] = entries
        moved += 1
    data["products"] = new
    data["format"] = HISTORY_FORMAT
    path.write_text(json.dumps(data, indent=2))
    print(f"{label.title()} history: moved {moved} listing histories to retailer + name keys"
          + (f"; restarted {dropped} that mixed new and pre-owned prices." if dropped else "."))
    return True


def clean_mixed_records(catalog_products):
    """A new-stock Callaway record that picked up a pre-owned grade from a
    name clash loses that grade; the pre-owned listing gets its own record
    from the pre-owned feed on this run."""
    cleaned = 0
    for p in catalog_products:
        if p.get("source") == "awin-callaway" and p.get("condition") in USED_GRADES:
            p.pop("condition", None)
            cleaned += 1
    if cleaned:
        print(f"Catalogue: {cleaned} new Callaway listing(s) had a pre-owned grade from a name clash; removed.")
    return catalog_products


def count_retailers(products):
    """retailerCount = how many different retailers list this exact name."""
    sources = defaultdict(set)
    for p in products:
        sources[p["name"]].add(p.get("source"))
    for p in products:
        p["retailerCount"] = len(sources[p["name"]]) or 1
    return products
