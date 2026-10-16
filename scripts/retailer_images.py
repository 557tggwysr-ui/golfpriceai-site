"""Correct Scottsdale Golf product photos (added 16 Oct 2026).

Scottsdale moved their photos to a new image server. Their AWIN feed still
gives the old addresses, and the old address only works for photos with
plain file names ("callaway-apex21-pro-iron-1.jpg"). Photos whose names had
spaces or brackets ("boss-bexpeditshirt-opengreen- (2).jpg") now 404; the
real photo lives at an address with a storage number we can't work out:

    feed:  https://www.scottsdalegolf.co.uk/uploads/boss-bexpeditshirt-opengreen-%20%282%29.jpg
    real:  https://scottsdalegolf.b-cdn.net/storage/56302/boss-bexpeditshirt-opengreen--(2).jpg

So for each affected product we read its own product page on Scottsdale's
site once, find the real photo address, and remember it in
data/scottsdale-images.json. Later runs reuse the saved address, so each
page is only ever read once (pages with no photo found are retried after
two weeks). A limited number of pages are read per run, so the first
catch-up is spread over a few runs rather than slowing one run down.
"""
import json
import re
import time
import urllib.request
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import unquote

CACHE_FILE = Path(__file__).resolve().parent.parent / "data" / "scottsdale-images.json"
MAX_PAGE_READS_PER_RUN = 400
RETRY_AFTER_DAYS = 14
STORAGE_RX = re.compile(r"https://scottsdalegolf\.b-cdn\.net/storage/\d+/[^\"'<>]+?\.(?:jpe?g|png|webp|gif)", re.I)
UA = "Mozilla/5.0 (compatible; GolfPriceAI/1.0; +https://golfpriceai.com)"


def needs_fixing(url):
    """Old-style addresses whose file name had spaces or brackets."""
    return bool(url and "scottsdalegolf.co.uk/uploads/" in url and re.search(r"%[0-9A-Fa-f]{2}", url))


def _expected_name(old_url):
    # "boss-bexpeditshirt-opengreen- (2).jpg" -> "boss-bexpeditshirt-opengreen--(2).jpg"
    name = unquote(old_url.rsplit("/", 1)[-1])
    return re.sub(r"\s+", "-", name).lower()


def _find_photo(page_html, old_url):
    found = []
    for m in STORAGE_RX.finditer(page_html):
        u = m.group(0).rstrip("\\")
        if u not in found:
            found.append(u)
    if not found:
        return None
    want = _expected_name(old_url)
    for u in found:
        if unquote(u.rsplit("/", 1)[-1]).lower() == want:
            return u
    return found[0]   # the page's main photo


def _read(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fix_scottsdale_images(products, today=None):
    """Swap broken Scottsdale photo addresses for the real ones. Works on
    freshly fetched Scottsdale listings (they carry their product page
    address as "_mpu"). Returns (fixed, read, still_missing)."""
    today = today or date.today()
    try:
        cache = json.loads(CACHE_FILE.read_text())
    except (OSError, ValueError):
        cache = {}
    reads = fixed = missing = 0
    for p in products:
        old = p.get("image")
        if not needs_fixing(old):
            continue
        hit = cache.get(old)
        if hit and hit.get("url"):
            p["image"] = hit["url"]
            fixed += 1
            continue
        if hit and hit.get("checked") and date.fromisoformat(hit["checked"]) > today - timedelta(days=RETRY_AFTER_DAYS):
            missing += 1
            continue
        page = p.get("_mpu")
        if not page or reads >= MAX_PAGE_READS_PER_RUN:
            missing += 1
            continue
        reads += 1
        try:
            new = _find_photo(_read(page), old)
        except Exception:
            new = None
        cache[old] = {"url": new, "checked": today.isoformat()}
        if new:
            p["image"] = new
            fixed += 1
        else:
            missing += 1
        time.sleep(0.2)   # be polite to their server
    if reads:
        CACHE_FILE.write_text(json.dumps(cache, indent=0, sort_keys=True))
    return fixed, reads, missing
