"""Par Price share links: one small page and one picture per score.

When a player shares their round, the link is golfpriceai.com/play/s/<score>/
(p10 = 10 over par, e = level, m3 = 3 under). WhatsApp, iMessage, Facebook and
X read that page's preview tags and show a big card with the score on it; a
person who taps the link goes straight to today's round at /play/.

Run once by hand (python scripts/par_price_cards.py); the 21 pages and
pictures never change, so the 6-hourly update doesn't need to touch them.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
CARDS = ROOT / "assets" / "cards" / "par-price"
PAGES = ROOT / "play" / "s"
SITE = "https://golfpriceai.com"
INK, GREEN, LGREEN, AMBER, WHITE, GREY = (20, 33, 26), (63, 174, 41), (143, 215, 126), (243, 196, 126), (255, 255, 255), (196, 208, 200)


def slug(t):
    return "e" if t == 0 else (f"p{t}" if t > 0 else f"m{-t}")


def words(t):
    return "level par" if t == 0 else (f"{t} over par" if t > 0 else f"{-t} under par")


def quip(t):
    """Must match SHARE_QUIPS in js/par-price.js."""
    if t <= -6:
        return "Tour card material. Pro shop nervous."
    if t <= -3:
        return "Under par and insufferable about it."
    if t < 0:
        return "Under par. Drinks are on me."
    if t == 0:
        return "Level par. Sensible. Very committee."
    if t <= 4:
        return "A few over. The prices won a hole or two."
    if t <= 9:
        return "Rough round. The prices won comfortably."
    return "Ten over. Lost balls, lost guesses."


def card(t):
    from PIL import Image, ImageDraw, ImageFont

    def f(name, size):
        return ImageFont.truetype(str(FONTS / name), size)

    W, H = 1200, 630
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)
    d.text((80, 70), "PAR PRICE · THE DAILY GOLF PRICE GAME", font=f("Inter-SemiBold.otf", 26), fill=LGREEN)
    d.text((80, 120), "I went round in", font=f("Inter-Regular.otf", 38), fill=GREY)
    big = "E" if t == 0 else (f"+{t}" if t > 0 else f"−{-t}")
    colour = LGREEN if t < 0 else (WHITE if t == 0 else AMBER)
    bf = f("Poppins-Bold.ttf", 190)
    d.text((72, 150), big, font=bf, fill=colour)
    bw = d.textlength(big, font=bf)
    label = "level par" if t == 0 else ("over par" if t > 0 else "under par")
    d.text((80 + bw + 26, 300), label, font=f("Poppins-Bold.ttf", 52), fill=WHITE)
    qs = 32
    while d.textlength(quip(t), font=f("Inter-Regular.otf", qs)) > 620 and qs > 24:
        qs -= 1
    d.text((80, 410), quip(t), font=f("Inter-Regular.otf", qs), fill=GREY)
    d.text((80, 470), "Five real golf products. Guess today’s prices.", font=f("Inter-Regular.otf", 28), fill=GREY)
    btn = "Can you beat it?  golfpriceai.com/play"
    bfnt = f("Inter-SemiBold.otf", 28)
    w = d.textlength(btn, font=bfnt)
    d.rounded_rectangle((80, 528, 80 + w + 52, 588), radius=12, fill=GREEN)
    d.text((106, 541), btn, font=bfnt, fill=WHITE)
    # The scoring key on the right, so the card explains the game on its own.
    kx, ky = 735, 165
    d.rounded_rectangle((kx, ky, 1120, 588), radius=18, fill=(31, 44, 37))
    d.text((kx + 28, ky + 24), "How it’s scored", font=f("Inter-SemiBold.otf", 24), fill=WHITE)
    rows = [("Eagle", "within 2%", (26, 104, 18), "−2"), ("Birdie", "within 5%", (47, 138, 31), "−1"),
            ("Par", "within 10%", (138, 149, 141), "0"), ("Bogey", "within 20%", (224, 162, 69), "+1"),
            ("Double", "further out", (154, 74, 0), "+2")]
    rf, sf = f("Inter-SemiBold.otf", 24), f("Inter-Regular.otf", 21)
    for i, (name, rule, col, pts) in enumerate(rows):
        y = ky + 80 + i * 64
        d.rounded_rectangle((kx + 28, y, kx + 64, y + 36), radius=8, fill=col)
        d.text((kx + 80, y + 4), name, font=rf, fill=WHITE)
        d.text((kx + 180, y + 7), rule, font=sf, fill=GREY)
        d.text((1120 - 28 - d.textlength(pts, font=rf), y + 4), pts, font=rf, fill=WHITE)
    lf = f("Poppins-Bold.ttf", 30)
    x = W - 80 - d.textlength("GolfPrice AI", font=lf)
    d.text((x, 76), "Golf", font=lf, fill=WHITE)
    x2 = x + d.textlength("Golf", font=lf)
    d.text((x2, 76), "Price", font=lf, fill=GREEN)
    d.text((x2 + d.textlength("Price", font=lf), 76), " AI", font=lf, fill=WHITE)
    return im


def page(t):
    s, title = slug(t), f"I went round Par Price in {words(t)}. Can you beat it?"
    desc = "Five real golf products. Guess each one’s lowest UK price today, scored like a round of golf. Free, new round every morning."
    img = f"{SITE}/assets/cards/par-price/{s}.jpg"
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} | GolfPrice AI</title>
<meta name="description" content="{desc}">
<meta name="robots" content="noindex, follow">
<link rel="canonical" href="{SITE}/play/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="GolfPrice AI">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{SITE}/play/s/{s}/">
<meta property="og:image" content="{img}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{img}">
<meta http-equiv="refresh" content="0; url=/play/?utm_source=parprice&amp;utm_medium=share">
<script>location.replace('/play/?utm_source=parprice&utm_medium=share');</script>
</head>
<body><p><a href="/play/">Play today’s Par Price</a></p></body>
</html>
"""


def league_card():
    from PIL import Image, ImageDraw, ImageFont

    def f(name, size):
        return ImageFont.truetype(str(FONTS / name), size)

    im = Image.new("RGB", (1200, 630), INK)
    d = ImageDraw.Draw(im)
    d.text((80, 70), "PAR PRICE · LEAGUES", font=f("Inter-SemiBold.otf", 26), fill=LGREEN)
    d.text((80, 120), "You’ve been invited", font=f("Poppins-Bold.ttf", 76), fill=WHITE)
    d.text((80, 210), "to a golf price league.", font=f("Poppins-Bold.ttf", 76), fill=WHITE)
    d.text((80, 330), "Five real golf products a day. Guess the prices.", font=f("Inter-Regular.otf", 32), fill=GREY)
    d.text((80, 376), "Lowest score wins. Loser buys the first round.", font=f("Inter-Regular.otf", 32), fill=GREY)
    cols = [(26, 104, 18), (63, 174, 41), (185, 194, 187), (224, 162, 69), (154, 74, 0)]
    for i, c in enumerate(cols):
        d.rounded_rectangle((80 + i * 54, 446, 124 + i * 54, 490), radius=9, fill=c)
    btn = "Join and tee off"
    bf = f("Inter-SemiBold.otf", 30)
    w = d.textlength(btn, font=bf)
    d.rounded_rectangle((1120 - w - 56, 440, 1120, 500), radius=12, fill=GREEN)
    d.text((1120 - w - 28, 452), btn, font=bf, fill=WHITE)
    lf = f("Poppins-Bold.ttf", 30)
    x = 1120 - d.textlength("GolfPrice AI", font=lf)
    d.text((x, 76), "Golf", font=lf, fill=WHITE)
    x2 = x + d.textlength("Golf", font=lf)
    d.text((x2, 76), "Price", font=lf, fill=GREEN)
    d.text((x2 + d.textlength("Price", font=lf), 76), " AI", font=lf, fill=WHITE)
    return im


def main():
    CARDS.mkdir(parents=True, exist_ok=True)
    for t in range(-10, 11):
        card(t).save(CARDS / f"{slug(t)}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
        p = PAGES / slug(t) / "index.html"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(page(t), encoding="utf-8")
    league_card().save(CARDS / "league.jpg", "JPEG", quality=84, optimize=True, progressive=True)
    print("Par Price share cards: 21 written, plus the league invite card.")


if __name__ == "__main__":
    main()
