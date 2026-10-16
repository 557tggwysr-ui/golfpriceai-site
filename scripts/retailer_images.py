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

If none of them has a usable photo, the old address is kept and the site
shows its clean placeholder for that product, as before.
"""
import re

OTHER_IMAGE_COLUMNS = ("large_image", "alternate_image", "aw_image_url")


def needs_fixing(url):
    """Old-style Scottsdale addresses whose file name had spaces or brackets."""
    return bool(url and "scottsdalegolf.co.uk/uploads/" in url and re.search(r"%[0-9A-Fa-f]{2}", url))


def choose_image(row):
    """The photo address to use for one feed row."""
    main = (row.get("merchant_image_url") or "").strip()
    if not needs_fixing(main):
        return main
    others = [(row.get(c) or "").strip() for c in OTHER_IMAGE_COLUMNS]
    others = [u for u in others if u.startswith("http") and not needs_fixing(u)]
    # Scottsdale's new image server first, then anything else that works.
    for u in others:
        if "b-cdn.net" in u:
            return u
    return others[0] if others else main


def report(products):
    """One run-log line: how many Scottsdale photos are still the broken kind."""
    s = [p for p in products if p.get("source") == "awin-scottsdalegolf"]
    broken = sum(1 for p in s if needs_fixing(p.get("image")))
    return (f"Scottsdale photos: {len(s) - broken} of {len(s)} listings have a working photo address; "
            f"{broken} still use the old broken kind.")
