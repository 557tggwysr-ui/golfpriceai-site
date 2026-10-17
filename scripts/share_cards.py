"""Share cards: assets/cards/<model>.jpg

A 1200x630 picture used when someone shares a price page (WhatsApp, X,
Pinterest...). Only made for models with something worth sharing: today's
price is the lowest we've tracked AND it's well below the highest we've
tracked (at least £5 and 3%). Every other page shares its plain product
photo, so the repo doesn't fill up with hundreds of images.

Style "A": the product photo on a white panel on the left, a dark panel on
the right with the badge, name, price and saving, and the brand line.

A card is only redrawn when what it says changes (state in
data/share-cards.json), and removed when the model no longer qualifies.
Nothing personal is involved: it's product names and prices only.
"""
import hashlib
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARD_DIR = ROOT / "assets" / "cards"
STATE = ROOT / "data" / "share-cards.json"
FONTS = ROOT / "assets" / "fonts"
W, H, SPLIT = 1200, 630, 560
INK, GREEN, WHITE, GREY = (20, 33, 26), (63, 174, 41), (255, 255, 255), (196, 208, 200)
BADGE = "LOWEST PRICE WE’VE TRACKED"


def qualifies(m):
    if (m.get("verdict") or {}).get("label") != "good":
        return None
    hist = [p for _, p in m.get("history") or []]
    if not hist:
        return None
    high, now = max(hist), float(m["minPrice"])
    saving = high - now
    return saving if saving >= max(5, high * 0.03) else None


def _money(n, whole=False):
    if whole and abs(n - round(n)) < 0.005:
        return f"£{round(n):,}"
    return f"£{n:,.2f}"


def _font(name, size):
    from PIL import ImageFont
    return ImageFont.truetype(str(FONTS / name), size)


def _wrap(d, text, font, maxw):
    lines, cur = [], ""
    for w in text.split():
        t = (cur + " " + w).strip()
        if d.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    return lines


def _photo(url):
    from PIL import Image
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (GolfPriceAI share cards)"})
    with urllib.request.urlopen(req, timeout=15) as r:
        data = r.read(6_000_000)
    im = Image.open(io.BytesIO(data))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        bg.alpha_composite(im)
        im = bg
    return im.convert("RGB")


def draw(photo, name, price, per, saving):
    from PIL import Image, ImageDraw, ImageOps
    if name.endswith(" Golf Bag") and " Bag " in name[:-9] + " ":
        name = name[:-9]  # "Stand Bag Golf Bag" reads oddly on a card
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    d.rectangle((SPLIT, 0, W, H), fill=INK)
    p = ImageOps.contain(photo, (SPLIT - 70, H - 70))
    im.paste(p, ((SPLIT - p.width) // 2, (H - p.height) // 2))

    x, y, maxw = SPLIT + 50, 58, W - SPLIT - 90
    f = _font("Inter-SemiBold.otf", 22)
    bw = d.textlength(BADGE, font=f)
    d.rounded_rectangle((x, y, x + bw + 36, y + 44), radius=22, fill=GREEN)
    d.text((x + 18, y + 9), BADGE, font=f, fill=WHITE)
    y += 72
    size = 48
    lines = _wrap(d, name, _font("Poppins-Bold.ttf", size), maxw)
    while len(lines) > 2 and size > 34:
        size -= 4
        lines = _wrap(d, name, _font("Poppins-Bold.ttf", size), maxw)
    if len(lines) > 2:
        lines = lines[:2]
        lines[1] = lines[1].rstrip(".,") + "…"
    nf = _font("Poppins-Bold.ttf", size)
    for line in lines:
        d.text((x, y), line, font=nf, fill=WHITE)
        y += int(size * 1.3)
    y += 10
    pf = _font("Poppins-Bold.ttf", 84)
    d.text((x, y), price, font=pf, fill=GREEN)
    if per:
        d.text((x + d.textlength(price, font=pf) + 14, y + 52), per, font=_font("Inter-Regular.otf", 24), fill=GREY)
    y += 110
    sf = _font("Inter-Regular.otf", 26)
    for line in _wrap(d, f"{saving} below the highest price we’ve tracked", sf, maxw):
        d.text((x, y), line, font=sf, fill=GREY)
        y += 36
    small = _font("Inter-Regular.otf", 20)
    d.text((x, H - 118), "Lowest new UK price today, checked across", font=small, fill=GREY)
    d.text((x, H - 92), "multiple UK retailers every 6 hours.", font=small, fill=GREY)
    lf = _font("Poppins-Bold.ttf", 30)
    d.text((x, H - 60), "Golf", font=lf, fill=WHITE)
    x2 = x + d.textlength("Golf", font=lf)
    d.text((x2, H - 60), "Price", font=lf, fill=GREEN)
    d.text((x2 + d.textlength("Price", font=lf), H - 60), " AI", font=lf, fill=WHITE)
    d.text((x + 250, H - 52), "Full Swing. Not full price.", font=_font("Inter-SemiBold.otf", 20), fill=GREY)
    out = io.BytesIO()
    im.save(out, "JPEG", quality=84, optimize=True, progressive=True)
    return out.getvalue()


def build(models, built, site):
    """Sets m["_card"] (full URL) on models that have a card. Returns changed paths."""
    try:
        import PIL  # noqa: F401
    except ImportError:
        print("Share cards: Pillow not installed, skipped.")
        return []
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    CARD_DIR.mkdir(parents=True, exist_ok=True)
    keep, changed, made, failed = {}, [], 0, 0
    for m in models:
        if m["slug"] not in built or not m.get("_image"):
            continue
        saving = qualifies(m)
        if saving is None:
            continue
        price = _money(float(m["minPrice"]))
        per = "per dozen" if m["type"] == "ball" else ""
        text = [m["name"], price, per, _money(saving, whole=True), m["_image"], "A1"]
        sig = hashlib.sha1(json.dumps(text).encode()).hexdigest()[:10]
        path = CARD_DIR / f"{m['slug']}.jpg"
        if state.get(m["slug"]) != sig or not path.exists():
            try:
                jpg = draw(_photo(m["_image"]), m["name"], price, per, _money(saving, whole=True))
            except Exception as e:  # a photo that won't download: keep the plain photo for this page
                failed += 1
                print(f"Share cards: skipped {m['slug']} ({type(e).__name__})")
                continue
            path.write_bytes(jpg)
            changed.append(f"/assets/cards/{m['slug']}.jpg")
            made += 1
        keep[m["slug"]] = sig
        m["_card"] = f"{site}/assets/cards/{m['slug']}.jpg?v={sig}"
    for slug in set(state) - set(keep):
        (CARD_DIR / f"{slug}.jpg").unlink(missing_ok=True)
    STATE.write_text(json.dumps(keep, indent=0, sort_keys=True) + "\n")
    print(f"Share cards: {len(keep)} live, {made} drawn, {len(set(state) - set(keep))} removed, {failed} skipped.")
    return changed
