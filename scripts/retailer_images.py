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
# The photo address can appear as "https://…", "//…" (no https:), with
# escaped slashes inside page data ("https:\/\/…"), or as a path on their
# own site ("/storage/56302/…"). All are read as the same photo.
STORAGE_RX = re.compile(r"(?:https?:)?(?:\\?/\\?/scottsdalegolf\.b-cdn\.net)?\\?/storage\\?/\d+\\?/[^\"'<>\s]+?\.(?:jpe?g|png|webp|gif)", re.I)
CDN = "https://scottsdalegolf.b-cdn.net"
CACHE_VERSION = 2   # entries saved before 16 Oct's fix are ignored and retried
UA = "Mozilla/5.0 (compatible; GolfPriceAI/1.0; +https://golfpriceai.com)"


def needs_fixing(url):
    """Old-style addresses whose file name had spaces or brackets."""
    return bool(url and "scottsdalegolf.co.uk/uploads/" in url and re.search(r"%[0-9A-Fa-f]{2}", url))


def _expected_name(old_url):
    # "boss-bexpeditshirt-opengreen- (2).jpg" -> "boss-bexpeditshirt-opengreen--(2).jpg"
    name = unquote(old_url.rsplit("/", 1)[-1])
    return re.sub(r"\s+", "-", name).lower()


def _clean(u):
    u = u.replace("\\/", "/")
    path = u[u.index("/storage/"):]
    return CDN + path


def _find_photo(page_html, old_url):
    found = []
    for m in STORAGE_RX.finditer(page_html):
        u = _clean(m.group(0))
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
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.status, resp.geturl(), resp.read().decode("utf-8", errors="replace")


def fix_scottsdale_images(products, today=None):
    """Swap broken Scottsdale photo addresses for the real ones. Works on
    freshly fetched Scottsdale listings (they carry their product page
    address as "_mpu"). Returns (fixed, read, still_missing) and prints a
    short diagnosis to the run log if pages can't be read."""
    today = today or date.today()
    try:
        cache = json.loads(CACHE_FILE.read_text())
    except (OSError, ValueError):
        cache = {}
    cache = {k: v for k, v in cache.items() if v.get("v") == CACHE_VERSION}
    reads = fixed = missing = failed_in_a_row = 0
    reasons = {}
    first_problem = None
    done = set()
    for p in products:
        old = p.get("image")
        if not needs_fixing(old):
            continue
        hit = cache.get(old)
        if hit and hit.get("url"):
            p["image"] = hit["url"]
            fixed += 1
            continue
        if hit and date.fromisoformat(hit["checked"]) > today - timedelta(days=RETRY_AFTER_DAYS):
            missing += 1
            continue
        page = p.get("_mpu")
        # Stop early if the first pages all fail: no point reading 400 more.
        if not page or reads >= MAX_PAGE_READS_PER_RUN or (reads >= 8 and failed_in_a_row == reads) or old in done:
            missing += 1
            continue
        reads += 1
        done.add(old)
        new, why = None, ""
        try:
            status, final_url, body = _read(page)
            new = _find_photo(body, old)
            if not new:
                i = body.find("storage")
                why = (f"page read (HTTP {status}, {len(body)} characters, ended at {final_url[:90]}) "
                       f"but no photo found; 'b-cdn' appears {body.count('b-cdn')} times; "
                       f"near 'storage': {body[max(0, i - 60):i + 100]!r}" if i >= 0 else
                       f"page read (HTTP {status}, {len(body)} characters, ended at {final_url[:90]}) "
                       f"but the word 'storage' isn't on it; starts: {body[:160]!r}")
                key = "page read, no photo found"
                # Only remember "no photo" when the page itself was fine.
                cache[old] = {"url": None, "checked": today.isoformat(), "v": CACHE_VERSION}
        except Exception as exc:
            why = f"couldn't read {page[:120]}: {exc}"
            key = str(exc)[:60]
        if new:
            cache[old] = {"url": new, "checked": today.isoformat(), "v": CACHE_VERSION}
            p["image"] = new
            fixed += 1
            failed_in_a_row = 0
        else:
            missing += 1
            failed_in_a_row += 1
            reasons[key] = reasons.get(key, 0) + 1
            first_problem = first_problem or why
        time.sleep(0.2)   # be polite to their server
    CACHE_FILE.write_text(json.dumps(cache, indent=0, sort_keys=True))
    if reasons:
        print("Scottsdale photos, problems this run: " + "; ".join(f"{n} x {k}" for k, n in reasons.items()))
        print(f"Scottsdale photos, first problem in detail: {first_problem}")
    return fixed, reads, missing
