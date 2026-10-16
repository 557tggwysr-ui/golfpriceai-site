"""Pick a working photo for each Scottsdale Golf listing (16 Oct 2026).

Scottsdale moved their photos to a new image server, but the main image
column in their AWIN feed (merchant_image_url) still gives old addresses.
Those still work for plain file names ("callaway-apex21-pro-iron-1.jpg")
but 404 for names that had spaces or brackets
("boss-bexpeditshirt-opengreen-%20%282%29.jpg"); the real photo now lives
at an address like
https://scottsdalegolf.b-cdn.net/storage/56302/boss-bexpeditshirt-opengreen--(2).jpg

Reading Scottsdale's product pages to find the new address isn't an
option: their site answers automated visits with "403 Forbidden", and we
respect that. Instead, when the main column gives one of the broken
addresses, we use another image column from the same AWIN feed if it has
one: large_image, alternate_image, or AWIN's own stored copy
(aw_image_url). Those columns only appear if they're ticked in AWIN's
Create-a-Feed settings for this retailer.

AWIN's stored copy turned out to be no help: it is made from the same
broken address, so it shows AWIN's grey "No Image Available" picture.
Copies like that are ignored. If nothing usable is left, the product gets
no photo at all and the site shows its own clean placeholder (and the
product drops out of features that need a real photo) until Scottsdale
fix their feed; then photos return on their own.
"""
import re
from urllib.parse import unquote

OTHER_IMAGE_COLUMNS = ("large_image", "alternate_image", "aw_image_url")


def needs_fixing(url):
    """Old-style Scottsdale addresses whose file name had spaces or brackets,
    including AWIN copies of them (which carry the address inside, encoded
    once or twice)."""
    if not url:
        return False
    decoded = unquote(unquote(url))
    if "scottsdalegolf.co.uk/uploads/" not in decoded:
        return False
    name = decoded.split("scottsdalegolf.co.uk/uploads/", 1)[1].split("&")[0]
    return bool(re.search(r"[\s()%]", name))


def choose_image(row):
    """The photo address to use for one feed row."""
    main = (row.get("merchant_image_url") or "").strip()
    if not needs_fixing(main):
        return main
    others = [(row.get(c) or "").strip() for c in OTHER_IMAGE_COLUMNS]
    # unquote: AWIN's copies carry the original address inside them, and a
    # copy of a broken address is just AWIN's "No Image Available" picture.
    others = [u for u in others if u.startswith("http") and not needs_fixing(u)]
    # Scottsdale's new image server first, then anything else that works.
    for u in others:
        if "b-cdn.net" in u:
            return u
    return others[0] if others else ""


def report(products):
    """One run-log line: how many Scottsdale photos are still the broken kind."""
    s = [p for p in products if p.get("source") == "awin-scottsdalegolf"]
    without = sum(1 for p in s if not p.get("image"))
    return (f"Scottsdale photos: {len(s) - without} of {len(s)} listings have a photo; "
            f"{without} have none, because Scottsdale's feed has no working photo for them.")
