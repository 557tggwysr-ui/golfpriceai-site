"""Cinematic video styles for the content engine (added 20 Nov 2026).

John asked for videos that push the boundaries, learning from how the best golf
accounts put reels together (benchmarks in data/social-benchmarks.json):
  * spec     - a product "launch film": dark, cinematic, huge condensed type,
               hard cuts every ~1.6s, a neon light streak, stat by stat
               (lowest price, saving, days tracked). Like a brand launch reel,
               but every number is a real, checked price.
  * thennow  - split screen, then vs now: the same product at the highest price
               we tracked (top, faded) and today (bottom, full colour), then the
               saving slams in. Honest "before and after", no RRP games.
  * story    - a trend tie-in: up to six punchy text beats with cinematic
               cuts, then a payoff card with a real product and price. Used for
               moments everyone's talking about (a big game launch, the Ryder
               Cup, the first frost), always with original design: never another
               brand's logo, artwork or typeface.
  * truth    - "golfer truths": a relatable line, then the joke plays out on
               screen (a bucket's worth of balls pours in and piles up), a
               deadpan beat, then the real ball deal. Skit humour, no people.
  * sitedemo - a real screen recording of golfpriceai.com in a phone, with taps,
               made by scripts/agent_screen.mjs: "here's how you check".

All styles are 1080x1920, 30fps, designed for the sound to be added in the app.
"""
import math
import re
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
W, H = 1080, 1920
CINE_FONT = ROOT / "assets" / "fonts" / "Anton-Regular.ttf"
BODY_FONT = ROOT / "assets" / "fonts" / "Poppins-Bold.ttf"
NEON = (150, 255, 90)          # light-streak green: our brand green, turned up
INK = (245, 247, 244)
DIM = (150, 160, 152)
_f = {}
_cache = {}


def cfont(size, body=False):
    key = (int(size), body)
    if key not in _f:
        _f[key] = ImageFont.truetype(str(BODY_FONT if body else CINE_FONT), max(8, int(size)))
    return _f[key]


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_in(t):
    t = max(0.0, min(1.0, t))
    return t ** 3


def money(n):
    n = float(n)
    return f"£{n:,.0f}" if n >= 100 or n == int(n) else f"£{n:,.2f}"


# ---------------- building blocks ----------------

def dark_bg(t, tint=(18, 24, 20)):
    """Near-black with a soft spotlight and moving film grain: reads 'premium' on a phone."""
    key = ("bg", tint)
    if key not in _cache:
        base = Image.new("RGB", (W, H), (8, 10, 9))
        glow = Image.new("L", (W, H), 0)
        ImageDraw.Draw(glow).ellipse([-300, 250, W + 300, H - 250], fill=255)
        glow = glow.filter(ImageFilter.GaussianBlur(260))
        base = Image.composite(Image.new("RGB", (W, H), tint), base, glow)
        rnd = random.Random(7)
        grain = Image.new("L", (W // 2, H // 2))
        grain.putdata([rnd.randint(0, 255) for _ in range(grain.width * grain.height)])
        _cache[key] = (base.convert("RGBA"), grain.resize((W + 64, H + 64)))
    base, grain = _cache[key]
    im = base.copy()
    ox, oy = int(t * 997) % 64, int(t * 613) % 64
    g = grain.crop((ox, oy, ox + W, oy + H)).point(lambda v: 10 if v > 200 else 0)
    im.alpha_composite(Image.merge("RGBA", (g, g, g, g)))
    return im


def kinetic(im, text, cy, size, t, colour=INK, body=False, spacing_from=0.35, maxw=W - 110):
    """Type that slams in: starts wide-spaced, blurred and low, tightens and settles in 0.35s."""
    if t <= 0:
        return
    text = str(text)
    f = cfont(size, body)
    while f.getlength(text) > maxw and size > 30:
        size *= 0.94
        f = cfont(size, body)
    k = ease(t / 0.35)
    track = (1 - k) * spacing_from * size
    widths = [f.getlength(c) for c in text]
    total = sum(widths) + track * (len(text) - 1)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x = (W - total) / 2
    y = cy - size * 0.62 + (1 - k) * 60
    for c, w in zip(text, widths):
        d.text((x, y), c, font=f, fill=colour + (int(255 * min(1, t / 0.2)),))
        x += w + track
    if k < 1:
        layer = layer.filter(ImageFilter.GaussianBlur((1 - k) * 10))
    im.alpha_composite(layer)


def kinetic_lines(im, text, cy, size, t, colour=INK, maxw=W - 120, stagger=0.08):
    """Big type wrapped onto up to 3 lines (instead of shrinking), each line slamming in just after the last."""
    f = cfont(size)
    words, lines, cur = str(text).split(), [], ""
    for w in words:
        if f.getlength((cur + " " + w).strip()) > maxw and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    while len(lines) > 3 and size > 60:
        return kinetic_lines(im, text, cy, size * 0.85, t, colour, maxw, stagger)
    gap = size * 1.02
    top = cy - gap * (len(lines) - 1) / 2
    for i, ln in enumerate(lines):
        kinetic(im, ln, top + i * gap, size, t - i * stagger, colour=colour, maxw=maxw)
    return top + gap * (len(lines) - 1) + size * 0.6


def ghost(im, text, t, size=520):
    """A huge, faint outline word behind the beat (a year, a number): depth without clutter."""
    if not text:
        return
    f = cfont(size)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    tw = f.getlength(text)
    drift = t * 30
    d.text(((W - tw) / 2 - drift, H / 2 - size * 0.75), text, font=f, fill=(0, 0, 0, 0), stroke_width=3, stroke_fill=(255, 255, 255, int(38 * ease(t / 0.5))))
    im.alpha_composite(layer)


def label(im, text, cy, t, size=40, colour=DIM):
    """Small all-caps label above a big number, with a short rule."""
    if t <= 0:
        return
    a = int(255 * ease(t / 0.3))
    d = ImageDraw.Draw(im)
    f = cfont(size)
    tw = f.getlength(text.upper())
    d.text(((W - tw) / 2, cy - size * 0.6), text.upper(), font=f, fill=colour + (a,))
    rw = 90 * ease(t / 0.4)
    d.rectangle([W / 2 - rw / 2, cy + size * 0.75, W / 2 + rw / 2, cy + size * 0.75 + 5], fill=NEON + (a,))


def streak(im, t, start, dur=0.7, y=980, colour=NEON):
    """A neon light trail sweeping across the frame (like a ball flight trace)."""
    if not start <= t <= start + dur:
        return
    k = (t - start) / dur
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    head = -200 + k * (W + 600)
    for i in range(26):
        x0 = head - i * 26
        yy = y - (head - i * 26) * 0.35
        d.ellipse([x0 - 46 + i, yy - 46 + i, x0 + 46 - i, yy + 46 - i], fill=colour + (int(200 * (1 - i / 26)),))
    glow = layer.filter(ImageFilter.GaussianBlur(28))
    im.alpha_composite(glow)
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(4)))


def flash(im, t, at, dur=0.08):
    """A two-frame white flash on a cut."""
    if at <= t < at + dur:
        a = int(70 * (1 - (t - at) / dur))
        im.alpha_composite(Image.new("RGBA", (W, H), (255, 255, 255, a)))


def product(im, img, cx, cy, size, t, push=0.06, grey=False):
    """The product on a soft white card with a shadow, slowly pushing in (Ken Burns)."""
    if img is None or t <= 0:
        return
    key = ("prod", id(img), size, grey)
    if key not in _cache:
        card = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        ph = ImageOps.contain(img.convert("RGB"), (int(size * 0.86), int(size * 0.86)), Image.LANCZOS)
        if grey:
            ph = ImageOps.grayscale(ph).convert("RGB")
        card.paste(ph, ((size - ph.width) // 2, (size - ph.height) // 2))
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size, size], int(size * 0.06), fill=255)
        card.putalpha(m)
        sh = Image.new("RGBA", (size + 160, size + 160), (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle([80, 110, size + 80, size + 110], int(size * 0.06), fill=(0, 0, 0, 170))
        sh = sh.filter(ImageFilter.GaussianBlur(36))
        _cache[key] = (card, sh)
    card, sh = _cache[key]
    s = (1 + push * min(1, t / 6)) * (0.92 + 0.08 * ease(t / 0.5))
    a = ease(t / 0.4)
    for src, dy in ((sh, 0), (card, 0)):
        r = src.resize((int(src.width * s), int(src.height * s)), Image.LANCZOS)
        if a < 1:
            r.putalpha(r.getchannel("A").point(lambda v: int(v * a)))
        im.alpha_composite(r, (int(cx - r.width / 2), int(cy - r.height / 2 + dy)))


def end_card(im, t, line="Compared across multiple UK retailers"):
    a = ease(t / 0.4)
    if a <= 0:
        return
    kinetic(im, "GOLFPRICEAI.COM", H - 300, 112, t)
    d = ImageDraw.Draw(im)
    f = cfont(36, body=True)
    for i, txt in enumerate((line, "Full Swing. Not full price.")):
        tw = f.getlength(txt)
        d.text(((W - tw) / 2, H - 205 + i * 56), txt, font=f, fill=((NEON if i else DIM) + (int(255 * a),)))


# ---------------- styles ----------------

def style_spec(t, s, pal, img, photo):
    """Product launch film: hook, reveal, three stats, end card. 10.5s."""
    im = dark_bg(t)
    name = s.get("name", "")
    brand, _, model = name.partition(" ")
    if t < 1.5:
        kinetic(im, brand.upper(), 760, 120, t, colour=DIM)
        kinetic(im, (model or name).upper(), 900, 200, t - 0.25)
        streak(im, t, 0.9, 0.6, y=1250)
    elif t < 3.3:
        product(im, img, W / 2, 900, 760, t - 1.5)
        streak(im, t, 2.4, 0.7, y=1500)
        kinetic(im, s.get("hook", "Worth a look").upper(), 1540, 84, t - 1.9, maxw=W - 140)
    else:
        beats = [("Lowest UK price today", money(s.get("price", 0))),
                 ("Below its highest we've tracked", "-" + money(s.get("fall", 0))) if s.get("fall") else None,
                 ("Price tracked for", f"{int(s['days'])} DAYS") if s.get("days") else ("Prices checked", "EVERY 6 HRS")]
        beats = [b for b in beats if b]
        span = 1.75
        i = int((t - 3.3) // span)
        if i < len(beats):
            bt = t - 3.3 - i * span
            product(im, img, W / 2, 640, 640, 6 + bt, push=0.0)
            label(im, beats[i][0], 1150, bt, size=48)
            kinetic(im, beats[i][1], 1400, 280, bt - 0.1, colour=NEON if i == 0 else INK)
            flash(im, t, 3.3 + i * span)
        else:
            et = t - 3.3 - len(beats) * span
            product(im, img, W / 2, 760, 640, 6 + et, push=0.03)
            kinetic(im, money(s.get("price", 0)), 1290, 150, et, colour=NEON)
            end_card(im, et - 0.3)
            flash(im, t, 3.3 + len(beats) * span)
    return im, 0


def style_thennow(t, s, pal, img, photo):
    """Split screen: highest we've tracked (top, faded) vs today (bottom). 10s."""
    im = dark_bg(t, tint=(22, 22, 26))
    d = ImageDraw.Draw(im)
    if t < 1.3:
        kinetic(im, s.get("hook", "Same club. Different price.").upper(), 900, 120, t, maxw=W - 120)
        return im, 0
    tt = t - 1.3
    split = H / 2
    wipe = ease(tt / 0.5)
    d.rectangle([0, 0, W, split * wipe], fill=(30, 30, 34, 255))
    d.rectangle([0, H - (H - split) * wipe, W, H], fill=(14, 26, 18, 255))
    product(im, img, W * 0.68, split * 0.52, 520, tt, grey=True, push=0.02)
    product(im, img, W * 0.68, split + (H - split) * 0.48, 520, tt - 0.6, push=0.04)
    for (lab, price, cy, col, delay) in ((s.get("then_label", "Highest we've tracked"), s.get("from"), split * 0.45, DIM, 0.2),
                                         ("Today", s.get("price"), split + (H - split) * 0.42, NEON, 0.8)):
        if price:
            f = cfont(54)
            d2 = ImageDraw.Draw(im)
            a = int(255 * ease((tt - delay) / 0.3))
            d2.text((70, cy - 140), lab.upper(), font=f, fill=DIM + (a,))
            if tt > delay:
                layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
                ImageDraw.Draw(layer).text((64, cy - 60), money(price), font=cfont(170), fill=col + (a,))
                im.alpha_composite(layer)
    d.rectangle([0, split - 3, W * wipe, split + 3], fill=NEON + (255,))
    if tt > 2.6 and s.get("fall"):
        k = ease((tt - 2.6) / 0.25)
        badge = Image.new("RGBA", (620, 180), (0, 0, 0, 0))
        bd = ImageDraw.Draw(badge)
        bd.rounded_rectangle([0, 0, 620, 180], 30, fill=NEON + (255,))
        txt = f"{money(s['fall'])} LESS"
        f = cfont(110)
        bd.text(((620 - f.getlength(txt)) / 2, 18), txt, font=f, fill=(10, 20, 10, 255))
        badge = badge.rotate(-4, expand=True, resample=Image.BICUBIC)
        sc = 1.6 - 0.6 * k
        b = badge.resize((int(badge.width * sc), int(badge.height * sc)), Image.LANCZOS)
        b.putalpha(b.getchannel("A").point(lambda v: int(v * min(1, k * 2))))
        im.alpha_composite(b, (int(W / 2 - b.width / 2), int(split - b.height / 2)))
        flash(im, tt, 2.6)
    if tt > 5.6:
        veil = Image.new("RGBA", (W, H), (8, 10, 9, int(250 * ease((tt - 5.6) / 0.3))))
        im.alpha_composite(veil)
        product(im, img, W / 2, 720, 600, tt - 5.7, push=0.03)
        kinetic(im, s.get("name", "").upper(), 1150, 80, tt - 5.9, maxw=W - 120)
        if s.get("price"):
            kinetic(im, money(s["price"]), 1330, 170, tt - 6.0, colour=NEON)
        end_card(im, tt - 6.3)
    return im, 0


def style_story(t, s, pal, img, photo):
    """Trend tie-in: up to six text beats (9.6s shared), then a payoff card. 12.6s."""
    im = sunset_bg(t, look_of(s)) if s.get("look") else dark_bg(t, tint=(20, 20, 30))
    beats = (s.get("beats") or [{"big": s.get("hook", "")}])[:6]
    span = 9.6 / len(beats)
    if t < 9.6:
        i = int(t // span)
        bt = t - i * span
        b = beats[i]
        ghost(im, b.get("ghost") or (b.get("small_top") if str(b.get("small_top", "")).isdigit() else ""), bt)
        size = b.get("size", 200)
        f = cfont(size)
        n_lines = 1 + int(f.getlength(b.get("big", "").upper()) // (W - 120))
        if b.get("small_top"):
            label(im, b["small_top"], 900 - size * 1.02 * (min(3, n_lines) - 1) / 2 - size * 1.3, bt, size=64, colour=NEON)
        bottom = kinetic_lines(im, b.get("big", "").upper(), 900, size, bt, colour=NEON if b.get("accent") else INK)
        if b.get("small"):
            f = cfont(52, body=True)
            d = ImageDraw.Draw(im)
            a = int(255 * ease((bt - 0.3) / 0.3))
            words, lines, cur = b["small"].split(), [], ""
            for w in words:
                if f.getlength(cur + " " + w) > W - 160 and cur:
                    lines.append(cur)
                    cur = w
                else:
                    cur = (cur + " " + w).strip()
            lines.append(cur)
            for j, ln in enumerate(lines[:3]):
                d.text(((W - f.getlength(ln)) / 2, bottom + 70 + j * 70), ln, font=f, fill=(200, 206, 201) + (a,))
        if i > 0:
            flash(im, t, i * span)
        if b.get("streak"):
            streak(im, bt, 0.15, 0.6, y=1320)
    else:
        et = t - 9.6
        flash(im, t, 9.6)
        if img is not None:
            product(im, img, W / 2, 700, 620, et)
            if s.get("price"):
                label(im, s.get("payoff_label", "Lowest UK price today"), 1130, et - 0.2)
                kinetic(im, money(s["price"]), 1300, 190, et - 0.3, colour=NEON)
            kinetic(im, s.get("name", "").upper(), 1470, 64, et - 0.5, maxw=W - 140)
        else:
            kinetic_lines(im, s.get("payoff", "").upper(), 860, 190, et, colour=NEON)
        end_card(im, et - 0.8)
    return im, 0


def style_sitedemo(t, s, pal, img, photo):
    """A real recording of golfpriceai.com in a phone frame, with a headline and taps. 11s.
    s["frames"] is a folder of PNGs at 15fps from scripts/agent_screen.mjs; s["taps"] a list of
    (time, x, y) in screen pixels for the tap rings."""
    im = dark_bg(t, tint=(16, 26, 20))
    head = s.get("hook", "Before you buy, check this").upper()
    kinetic(im, head, 230, 96, t, maxw=W - 100)
    if s.get("sub"):
        label(im, s["sub"], 360, t - 0.3, size=38)
    frames = s.get("_frames")
    if frames is None:
        folder = Path(s.get("frames", ""))
        files = sorted(folder.glob("*.png")) if folder.exists() else []
        s["_frames"] = frames = files
    sw, sh = 600, 1300
    px, py = (W - sw) // 2, 470
    phone = Image.new("RGBA", (sw + 44, sh + 44), (0, 0, 0, 0))
    ImageDraw.Draw(phone).rounded_rectangle([0, 0, sw + 43, sh + 43], 74, fill=(34, 36, 35, 255), outline=(80, 84, 82, 255), width=3)
    rise = (1 - ease(t / 0.6)) * 400
    im.alpha_composite(phone, (px - 22, int(py - 22 + rise)))
    if frames:
        idx = min(len(frames) - 1, int(max(0, t - 0.6) * 15))
        key = ("frame", str(frames[idx]))
        if key not in _cache:
            _cache.clear() if len(_cache) > 40 else None
            fr = Image.open(frames[idx]).convert("RGB")
            fr = ImageOps.fit(fr, (sw, sh), Image.LANCZOS, centering=(0.5, 0.0))
            m = Image.new("L", (sw, sh), 0)
            ImageDraw.Draw(m).rounded_rectangle([0, 0, sw, sh], 56, fill=255)
            fr = fr.convert("RGBA")
            fr.putalpha(m)
            _cache[key] = fr
        im.alpha_composite(_cache[key], (px, int(py + rise)))
    for (tt, x, y) in s.get("taps", []):
        if tt <= t <= tt + 0.6:
            k = (t - tt) / 0.6
            r = 30 + 60 * k
            cx, cy = px + x * sw, py + y * sh
            layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(layer).ellipse([cx - r, cy - r, cx + r, cy + r], outline=NEON + (int(255 * (1 - k)),), width=8)
            im.alpha_composite(layer)
    if t > 9.2:
        veil = Image.new("RGBA", (W, H), (8, 10, 9, int(200 * ease((t - 9.2) / 0.4))))
        im.alpha_composite(veil)
        end_card(im, t - 9.4)
    return im, 0


def _ball_sprite(r, colour):
    key = ("ball", r, colour)
    if key not in _cache:
        sz = r * 2 + 8
        b = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
        d = ImageDraw.Draw(b)
        d.ellipse([4, 8, sz - 4, sz], fill=(0, 0, 0, 70))                       # soft contact shadow
        d.ellipse([4, 4, sz - 4, sz - 4], fill=colour + (255,))
        shade = Image.new("L", (sz, sz), 0)
        ImageDraw.Draw(shade).ellipse([sz * 0.38, sz * 0.38, sz + sz * 0.3, sz + sz * 0.3], fill=110)
        shade = shade.filter(ImageFilter.GaussianBlur(r * 0.35))
        dark = Image.new("RGBA", (sz, sz), (60, 70, 70, 255))
        mask = Image.new("L", (sz, sz), 0)
        ImageDraw.Draw(mask).ellipse([4, 4, sz - 4, sz - 4], fill=255)
        b.paste(dark, (0, 0), Image.composite(shade, Image.new("L", (sz, sz), 0), mask))
        d = ImageDraw.Draw(b)
        for k in range(9):                                                        # dimples
            a = k * 0.7
            cx, cy = sz / 2 + math.cos(a) * r * 0.5, sz / 2 + math.sin(a) * r * 0.5
            d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(0, 0, 0, 28))
        d.ellipse([sz * 0.28, sz * 0.24, sz * 0.42, sz * 0.36], fill=(255, 255, 255, 200))  # highlight
        _cache[key] = b
    return _cache[key]


def _rain_plan(seed, n=1150):
    """Where each ball lands: a simple heap that builds column by column, so it piles up naturally."""
    key = ("rain", seed, n)
    if key not in _cache:
        rnd = random.Random(seed)
        cols = [0.0] * 36
        balls = []
        colours = [(250, 250, 248)] * 7 + [(240, 230, 60), (255, 120, 150), (255, 150, 40)]
        for i in range(n):
            r = rnd.randint(26, 34)
            c = min(35, max(0, int(rnd.gauss(18, 10))))
            # roll off a tall column onto a lower neighbour, like a real pile
            for _ in range(3):
                nb = c + rnd.choice((-1, 1))
                if 0 <= nb < 36 and cols[nb] + 40 < cols[c]:
                    c = nb
            x = c * 30 + rnd.uniform(-8, 8) + 15
            y = H - 120 - cols[c] - r
            cols[c] += r * 0.95
            t0 = 0.6 + 5.6 * (i / n) ** 0.7                                       # starts slow, then pours
            balls.append((t0, x, y, r, rnd.choice(colours), rnd.uniform(-0.15, 0.15)))
        _cache[key] = balls
    return _cache[key]


def style_truth(t, s, pal, img, photo):
    """'Golfer truths': one relatable line, then the joke happens on screen (hundreds of balls pour in
    and pile up), a deadpan beat, then the real deal. 10.5s. Inspired by the skit reels golfers share,
    with no people in it."""
    im = dark_bg(t, tint=(20, 46, 26))
    d = ImageDraw.Draw(im)
    grass = Image.new("RGBA", (W, 260), (36, 92, 40, 255))
    im.alpha_composite(grass, (0, H - 260))
    plan = _rain_plan(len(s.get("setup", "")) + 3)
    # balls that have landed are drawn once onto a cached layer (fast, even with 1,000+ balls)
    sk = ("settled", id(plan))
    done, layer0 = _cache.get(sk, (0, None))
    if layer0 is None or t < _cache.get(("settled_t", id(plan)), 0):
        done, layer0 = 0, Image.new("RGBA", (W, H), (0, 0, 0, 0))
    while done < len(plan) and plan[done][0] + 0.75 <= t:
        t0, x, y, r, col, wob = plan[done]
        sp = _ball_sprite(r, col)
        layer0.alpha_composite(sp, (int(x - sp.width / 2), int(y - sp.height / 2)))
        done += 1
    _cache[sk] = (done, layer0)
    _cache[("settled_t", id(plan))] = t
    im.alpha_composite(layer0)
    for (t0, x, y, r, col, wob) in plan[done:]:
        if t < t0:
            break
        k = min(1.0, (t - t0) / 0.45)
        yy = -80 + (y + 80) * (k * k)                                             # falls with gravity
        if k >= 1:
            bounce = max(0.0, 1 - (t - t0 - 0.45) / 0.25)
            yy = y - math.sin(min(1, (t - t0 - 0.45) / 0.25) * math.pi) * 18 * bounce
        sp = _ball_sprite(r, col)
        im.alpha_composite(sp, (int(x - sp.width / 2 + wob * (1 - k) * 200), int(yy - sp.height / 2)))
    layer = Image.new("RGBA", (W, 520), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rectangle([0, 0, W, 520], fill=(8, 10, 9, 150))
    im.alpha_composite(layer.filter(ImageFilter.GaussianBlur(40)), (0, 0))
    f = cfont(70, body=True)
    words, lines, cur = s.get("setup", "Me preparing for my first round back...").split(), [], ""
    for w in words:
        if f.getlength(cur + " " + w) > W - 140 and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    a = int(255 * ease(t / 0.3))
    for j, ln in enumerate(lines[:3]):
        d.text(((W - f.getlength(ln)) / 2 + 3, 200 + j * 92 + 3), ln, font=f, fill=(0, 0, 0, a // 2))
        d.text(((W - f.getlength(ln)) / 2, 200 + j * 92), ln, font=f, fill=(255, 255, 255, a))
    if 6.7 <= t < 8.2:
        box = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ImageDraw.Draw(box).rounded_rectangle([60, 760, W - 60, 1060], 36, fill=(8, 10, 9, int(225 * ease((t - 6.7) / 0.2))))
        im.alpha_composite(box)
        dp = s.get("deadpan", "Every single one is going in the water.").upper().split()
        half = (len(dp) + 1) // 2
        kinetic(im, " ".join(dp[:half]), 860, 120, t - 6.7, maxw=W - 160)
        kinetic(im, " ".join(dp[half:]), 980, 120, t - 6.85, maxw=W - 160, colour=NEON)
    if t >= 8.2:
        veil = Image.new("RGBA", (W, H), (8, 10, 9, int(230 * ease((t - 8.2) / 0.25))))
        im.alpha_composite(veil)
        flash(im, t, 8.2)
        if img is not None:
            product(im, img, W / 2, 740, 520, t - 8.2)
        label(im, s.get("payoff_label", "Replacements, from"), 1130, t - 8.3, size=48)
        kinetic(im, money(s.get("price", 0)) + (" A DOZEN" if s.get("per_dozen") else ""), 1300, 170, t - 8.4, colour=NEON)
        end_card(im, t - 8.7)
    return im, 0


# ---------------- collage: the "loading screen" comic-panel look ----------------
# Tilted panels with thick dark borders on a sunset gradient, one dropping in per beat until the
# frame is a full collage (the look of a big game's cover art, as golf brands used for GTA VI).
# Always our own content: never a game's logo, lettering, characters or artwork.
SUNSET = [(255, 94, 160), (255, 160, 90), (120, 60, 170), (40, 190, 200)]
PANELS = [  # x, y, w, h, angle  (a 2-column, irregular grid like a cover-art collage)
    (40, 210, 560, 520, -2.0), (620, 170, 420, 640, 1.5),
    (40, 760, 430, 560, 1.2), (490, 840, 550, 470, -1.4),
    (40, 1350, 560, 400, -1.0), (620, 1340, 420, 420, 2.0),
]


# A "look" lets the moments planner match a moment's visual language with our own original art:
#   {"stops": [[0.0, [r,g,b]], ...], "motif": "palms" | "snow" | "grid" | "stars" | "fairway" | "none",
#    "sun": true/false, "accent": [r,g,b], "panel_colours": [[[r,g,b],[r,g,b]], ...], "ink": [r,g,b], "stroke": [r,g,b]}
LOOKS = {
    "vice": {"stops": [[0, [34, 18, 64]], [0.45, [130, 48, 140]], [0.7, [255, 94, 140]], [0.85, [255, 165, 90]], [1, [40, 30, 70]]],
             "motif": "palms", "sun": True, "accent": [150, 255, 90]},
    "christmas": {"stops": [[0, [10, 30, 22]], [0.6, [20, 70, 45]], [1, [120, 20, 30]]], "motif": "snow", "sun": False,
                  "accent": [255, 214, 120], "panel_colours": [[[180, 30, 40], [110, 15, 25]], [[20, 90, 55], [10, 45, 30]], [[200, 150, 60], [120, 80, 30]]],
                  "duo": [[30, 10, 14], [170, 40, 50], [255, 236, 200]]},
    "hero": {"stops": [[0, [6, 6, 18]], [0.55, [40, 16, 60]], [1, [140, 20, 30]]], "motif": "grid", "sun": False,
             "accent": [255, 200, 60], "panel_colours": [[[40, 50, 120], [12, 14, 40]], [[150, 20, 30], [50, 6, 12]], [[60, 60, 70], [20, 20, 26]]],
             "duo": [[8, 8, 24], [60, 70, 160], [255, 210, 120]]},
    "major": {"stops": [[0, [12, 50, 30]], [0.7, [30, 100, 55]], [1, [235, 215, 140]]], "motif": "fairway", "sun": False,
              "accent": [255, 214, 90], "panel_colours": [[[24, 90, 50], [10, 50, 28]], [[200, 80, 140], [130, 40, 90]], [[170, 140, 60], [100, 80, 30]]],
              "duo": [[10, 40, 22], [60, 140, 80], [255, 240, 200]]},
    "night": {"stops": [[0, [4, 6, 20]], [1, [30, 40, 90]]], "motif": "stars", "sun": False, "accent": [150, 255, 90]},
    # Colours ARE the recognition: research each moment's own palette (John, 20 Nov 2026).
    "doom": {"stops": [[0, [4, 8, 6]], [0.6, [8, 40, 22]], [1, [20, 90, 45]]], "motif": "grid", "sun": False,
             "accent": [110, 255, 140], "panel_colours": [[[14, 70, 38], [4, 20, 10]], [[30, 30, 34], [6, 6, 8]], [[60, 140, 80], [14, 50, 26]]],
             "duo": [[2, 10, 6], [30, 120, 60], [190, 255, 200]]},
    "versus": {"stops": [[0, [0, 40, 120]], [1, [0, 30, 90]]], "stops2": [[0, [170, 20, 40]], [1, [40, 40, 100]]],
               "motif": "versus", "sun": False, "accent": [255, 204, 0],
               "panel_colours": [[[0, 51, 153], [0, 30, 90]], [[178, 34, 52], [90, 10, 25]], [[255, 204, 0], [200, 150, 0]]],
               "duo": [[10, 20, 60], [120, 120, 200], [255, 240, 220]]},
}


def look_of(s):
    lk = s.get("look") or "vice"
    return dict(LOOKS.get(lk, LOOKS["vice"])) if isinstance(lk, str) else {**LOOKS["vice"], **lk}


def sunset_bg(t, look=None):
    look = look or LOOKS["vice"]
    key = ("sunset", repr(look.get("stops")), look.get("motif"), look.get("sun"))
    if key not in _cache:
        g = Image.new("RGB", (1, H))
        stops = [(a, tuple(c)) for a, c in look["stops"]]
        for y in range(H):
            k = y / H
            for (a, ca), (b, cb) in zip(stops, stops[1:]):
                if a <= k <= b:
                    f = (k - a) / (b - a)
                    g.putpixel((0, y), tuple(int(ca[i] + (cb[i] - ca[i]) * f) for i in range(3)))
                    break
        bg = g.resize((W, H)).convert("RGBA")
        d = ImageDraw.Draw(bg)
        motif = look.get("motif", "palms")
        rnd = random.Random(11)
        if look.get("sun"):
            sun = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            sd = ImageDraw.Draw(sun)
            sd.ellipse([W / 2 - 330, 1100, W / 2 + 330, 1760], fill=(255, 190, 110, 255))
            for i in range(9):                                                  # retro sun stripes
                y = 1450 + i * 34
                sd.rectangle([0, y, W, y + 6 + i * 2], fill=(0, 0, 0, 0))
            bg.alpha_composite(sun.filter(ImageFilter.GaussianBlur(1)))
        if motif == "versus" and look.get("stops2"):                            # two sides, split on a diagonal (e.g. Europe v USA)
            g2 = Image.new("RGB", (1, 2))
            g2.putpixel((0, 0), tuple(look["stops2"][0][1]))
            g2.putpixel((0, 1), tuple(look["stops2"][-1][1]))
            right = g2.resize((W, H), Image.BILINEAR).convert("RGBA")
            m = Image.new("L", (W, H), 0)
            ImageDraw.Draw(m).polygon([(W * 0.62, 0), (W, 0), (W, H), (W * 0.38, H)], fill=255)
            bg.paste(right, (0, 0), m)
            ImageDraw.Draw(bg).line([(W * 0.62, 0), (W * 0.38, H)], fill=tuple(look.get("accent", (255, 204, 0))) + (255,), width=10)
        if motif == "grid":                                                     # neon perspective grid
            gl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
            gd = ImageDraw.Draw(gl)
            col = tuple(look.get("accent", (255, 200, 60))) + (120,)
            for i in range(-12, 13):
                gd.line([(W / 2 + i * 40, 1200), (W / 2 + i * 260, H)], fill=col, width=3)
            for j in range(12):
                y = 1200 + (j / 12) ** 2 * (H - 1200)
                gd.line([(0, y), (W, y)], fill=col, width=3)
            bg.alpha_composite(gl.filter(ImageFilter.GaussianBlur(1.2)))
        if motif in ("stars", "grid"):
            for _ in range(160):
                x, y, r = rnd.uniform(0, W), rnd.uniform(0, 1150), rnd.choice((1, 1, 2, 3))
                d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rnd.randint(90, 230)))
        if motif == "fairway":                                                  # mown stripes and a flag
            for i in range(8):
                y = 1250 + i * 85
                d.rectangle([0, y, W, y + 42], fill=(255, 255, 255, 22))
            d.line([(W - 200, 1200), (W - 200, 900)], fill=(250, 250, 250, 255), width=8)
            d.polygon([(W - 196, 900), (W - 80, 940), (W - 196, 980)], fill=tuple(look.get("accent", (255, 214, 90))) + (255,))
        if motif == "snow":                                                     # fairy lights along the top
            for i in range(14):
                x = 40 + i * 76
                y = 70 + math.sin(i * 0.9) * 26
                c = rnd.choice([(255, 214, 120), (255, 90, 90), (140, 230, 140), (255, 255, 255)])
                glow = Image.new("RGBA", (80, 80), (0, 0, 0, 0))
                ImageDraw.Draw(glow).ellipse([28, 28, 52, 52], fill=c + (255,))
                bg.alpha_composite(glow.filter(ImageFilter.GaussianBlur(6)), (int(x - 40), int(y - 40)))
                d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=c + (255,))
        for x0, h0, flip in (((60, 900, 1), (W - 80, 1050, -1), (W - 230, 760, -1)) if motif == "palms" else ()):  # palm silhouettes
            pc = (20, 12, 36, 255)
            d.line([(x0, H), (x0 + flip * 40, H - h0)], fill=pc, width=26)
            tx, ty = x0 + flip * 40, H - h0
            for a in range(0, 360, 40):
                r = math.radians(a)
                d.polygon([(tx, ty), (tx + math.cos(r) * 230, ty + math.sin(r) * 90 + 40), (tx + math.cos(r + 0.25) * 200, ty + math.sin(r + 0.25) * 70 + 50)], fill=pc)
        _cache[key] = bg
    return _cache[key].copy()


def _panel_img(p, w, h, t):
    """One panel's picture: text on a gradient block, or a photo with a sunset duotone."""
    key = ("panel", p.get("text"), p.get("sub"), p.get("tag"), id(p.get("img")), repr(p.get("colours")), repr(p.get("duo")), w, h)
    if key not in _cache:
        if p.get("img") is not None:
            ph = ImageOps.fit(p["img"].convert("RGB"), (int(w * 1.12), int(h * 1.12)), Image.LANCZOS)
            lum = ImageOps.grayscale(ph)
            dk, md, lt = p.get("duo") or ((40, 16, 70), (240, 90, 140), (255, 214, 160))
            duo = ImageOps.colorize(lum, black=dk, white=lt, mid=md)
            base = Image.blend(ph, duo, 0.45).convert("RGBA")
        else:
            c1, c2 = p.get("colours", (SUNSET[2], SUNSET[0]))
            g = Image.new("RGB", (1, 2))
            g.putpixel((0, 0), c1)
            g.putpixel((0, 1), c2)
            base = g.resize((int(w * 1.12), int(h * 1.12)), Image.BILINEAR).convert("RGBA")
        _cache[key] = base
    base = _cache[key]
    z = 1 + 0.06 * min(1, t / 8)                                                # slow push-in inside the frame
    cw, ch = int(w * 1.12 / z), int(h * 1.12 / z)
    ox, oy = (base.width - cw) // 2, (base.height - ch) // 2
    im = base.crop((ox, oy, ox + cw, oy + ch)).resize((w, h), Image.LANCZOS)
    if p.get("text"):
        d = ImageDraw.Draw(im)
        size = p.get("size", 150)
        f = cfont(size)
        words, lines, cur = p["text"].upper().split(), [], ""
        for wd in words:
            if f.getlength((cur + " " + wd).strip()) > w - 60 and cur:
                lines.append(cur)
                cur = wd
            else:
                cur = (cur + " " + wd).strip()
        lines.append(cur)
        while (len(lines) * size * 1.02 > h * (0.5 if p.get("sub") else 0.72) or max(f.getlength(x) for x in lines) > w - 50) and size > 40:
            size = int(size * 0.88)
            f = cfont(size)
            words, lines, cur = p["text"].upper().split(), [], ""
            for wd in words:
                if f.getlength((cur + " " + wd).strip()) > w - 60 and cur:
                    lines.append(cur)
                    cur = wd
                else:
                    cur = (cur + " " + wd).strip()
            lines.append(cur)
        y0 = (h - len(lines) * size * 1.02) / 2 - (24 if p.get("sub") else 0)
        for i, ln in enumerate(lines):
            x = (w - f.getlength(ln)) / 2
            d.text((x, y0 + i * size * 1.02), ln, font=f, fill=(255, 255, 255, 255), stroke_width=max(4, size // 22), stroke_fill=(24, 12, 40, 255))
        if p.get("sub"):
            fs = cfont(34, body=True)
            sub_lines, cur = [], ""
            for wd in p["sub"].split():
                if fs.getlength((cur + " " + wd).strip()) > w - 70 and cur:
                    sub_lines.append(cur)
                    cur = wd
                else:
                    cur = (cur + " " + wd).strip()
            sub_lines.append(cur)
            yy = y0 + len(lines) * size * 1.02 + 14
            for ln in sub_lines[:4]:
                d.text(((w - fs.getlength(ln)) / 2, yy), ln, font=fs, fill=(255, 245, 230, 255), stroke_width=3, stroke_fill=(24, 12, 40, 255))
                yy += 44
    if p.get("tag"):
        d = ImageDraw.Draw(im)
        ft = cfont(44)
        tw = ft.getlength(p["tag"])
        d.rectangle([18, 18, 18 + tw + 28, 82], fill=(20, 12, 36, 255))
        d.text((32, 22), p["tag"], font=ft, fill=NEON + (255,))
    return im


def style_collage(t, s, pal, img, photo):
    """Panels drop in one per beat until the frame is a full collage; then the brand banner. 12.6s."""
    look = look_of(s)
    im = sunset_bg(t, look)
    if look.get("motif") == "snow":                                             # gently falling snow
        rnd = random.Random(5)
        sd = ImageDraw.Draw(im)
        for _ in range(120):
            x0, sp, r = rnd.uniform(0, W), rnd.uniform(40, 120), rnd.choice((2, 3, 4, 5))
            y = (rnd.uniform(0, H) + t * sp) % H
            x = x0 + math.sin(t * 1.3 + x0) * 18
            sd.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 200))
    panels = (s.get("panels") or [])[:6]
    pcols = look.get("panel_colours")
    span = 9.0 / max(1, len(panels))
    for i, p in enumerate(panels):
        st = 0.3 + i * span
        if t < st:
            break
        x, y, w, h, ang = PANELS[i]
        k = ease((t - st) / 0.45)
        if pcols and "colours" not in p and p.get("img") is None:
            p = {**p, "colours": tuple(tuple(c) for c in pcols[i % len(pcols)])}
            s["panels"][i] = p
        if look.get("duo") and p.get("img") is not None and "duo" not in p:
            p = {**p, "duo": tuple(tuple(c) for c in look["duo"])}
            s["panels"][i] = p
        pim = _panel_img(p, w, h, t - st)
        frame = Image.new("RGBA", (w + 24, h + 24), (18, 10, 30, 255))
        frame.alpha_composite(pim, (12, 12))
        rot = frame.rotate(ang + (1 - k) * 14 * (-1 if i % 2 else 1), expand=True, resample=Image.BICUBIC)
        sc = 1.35 - 0.35 * k
        rot = rot.resize((max(1, int(rot.width * sc)), max(1, int(rot.height * sc))), Image.LANCZOS)
        if k < 1:
            rot.putalpha(rot.getchannel("A").point(lambda v: int(v * min(1, k * 2.2))))
        shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        shadow.putalpha(rot.getchannel("A").point(lambda v: int(v * 0.45)))
        cx, cy = x + w / 2, y + h / 2
        im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)), (int(cx - rot.width / 2 + 10), int(cy - rot.height / 2 + 16)))
        im.alpha_composite(rot, (int(cx - rot.width / 2), int(cy - rot.height / 2)))
        flash(im, t, st, 0.06)
    if t >= 9.6:
        et = t - 9.6
        k = ease(et / 0.4)
        bar = Image.new("RGBA", (W, 300), (18, 10, 30, int(235 * k)))
        im.alpha_composite(bar, (0, int(H - 300 * k)))
        kinetic(im, s.get("banner", "GOLFPRICEAI.COM"), H - 190, 120, et - 0.1, colour=(255, 255, 255))
        look_acc = tuple(look.get("accent", NEON))
        f = cfont(36, body=True)
        d = ImageDraw.Draw(im)
        for i, (txt, col) in enumerate(((s.get("banner_sub", "Every UK golf price, checked every 6 hours"), (255, 215, 170)),
                                        ("Full Swing. Not full price.", look_acc))):
            d.text(((W - f.getlength(txt)) / 2, H - 112 + i * 46), txt, font=f, fill=col + (int(255 * ease((et - 0.4) / 0.3)),))
    return im, 0


CINE_STYLES = {"spec": (style_spec, 10.5), "thennow": (style_thennow, 10.0), "story": (style_story, 12.6),
               "sitedemo": (style_sitedemo, 11.0), "truth": (style_truth, 10.5), "collage": (style_collage, 12.6)}


# ---------------- thumbnails (covers) for every Reel and Short ----------------
# John (20 Nov 2026): every reel and short gets a polished, professional thumbnail. Designed for the
# phone grid: one huge 2-4 word hook, the product big with a soft shadow, a price badge, brand corner;
# everything important inside the middle 4:5 so Instagram's grid crop never cuts it.
THUMB_STYLES = {
    "punch": {"bg": [[0, [10, 14, 12]], [1, [30, 60, 40]]], "ink": (255, 255, 255), "hi": (150, 255, 90), "badge": (150, 255, 90), "badge_ink": (10, 20, 10)},
    "sunrise": {"bg": [[0, [255, 120, 70]], [1, [140, 30, 90]]], "ink": (255, 255, 255), "hi": (255, 230, 120), "badge": (255, 255, 255), "badge_ink": (140, 30, 90)},
    "clean": {"bg": [[0, [245, 247, 244]], [1, [214, 228, 214]]], "ink": (16, 28, 20), "hi": (28, 140, 50), "badge": (16, 28, 20), "badge_ink": (255, 255, 255)},
    "night": {"bg": [[0, [8, 10, 30]], [1, [60, 30, 110]]], "ink": (255, 255, 255), "hi": (255, 200, 60), "badge": (255, 200, 60), "badge_ink": (20, 10, 30)},
}


def _short_hook(text, n=5):
    words = [w for w in re.sub(r"[^\w£'.,!? -]", "", str(text)).split() if w]
    return " ".join(words[:n]).rstrip(",.") if len(words) > n else " ".join(words)


def thumbnail(path, hook, img=None, price=None, kind="punch", tag=None, look=None, pal=None):
    """A 1080x1920 cover. Returns the problems found (empty list = good).
    pal: the video's own palette (agent_video.PALETTES), so the cover matches the video (John, 23 Nov 2026)."""
    st = dict(THUMB_STYLES.get(kind, THUMB_STYLES["punch"]))
    if pal and not look:
        st.update({"bg": [[0, list(pal["bg"])], [1, list(pal["bg2"])]], "ink": tuple(pal["ink"]), "hi": tuple(pal["accent"]),
                   "badge": tuple(pal["accent"]), "badge_ink": tuple(pal["bg"])})
    stops = (look or {}).get("stops") or st["bg"]
    if look and look.get("accent"):  # the moment's own colours carry through to the thumbnail
        acc = tuple(look["accent"])
        st.update({"hi": acc, "badge": acc, "badge_ink": (10, 12, 10), "ink": (255, 255, 255)})
    g = Image.new("RGB", (1, 2))
    g.putpixel((0, 0), tuple(stops[0][1]))
    g.putpixel((0, 1), tuple(stops[-1][1]))
    im = g.resize((W, H), Image.BILINEAR).convert("RGBA")
    if look and look.get("motif") == "versus" and look.get("stops2"):
        im = sunset_bg(0, look)
    glow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(glow).ellipse([-200, 520, W + 200, 1500], fill=110)
    im.alpha_composite(Image.merge("RGBA", (*[Image.new("L", (W, H), 255)] * 3, glow.filter(ImageFilter.GaussianBlur(160)))))
    d = ImageDraw.Draw(im)
    if img is not None:
        card = ImageOps.contain(img.convert("RGB"), (700, 700), Image.LANCZOS)
        tile = Image.new("RGBA", (card.width + 60, card.height + 60), (255, 255, 255, 255))
        tile.paste(card, (30, 30))
        m = Image.new("L", tile.size, 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, tile.width, tile.height], 44, fill=255)
        tile.putalpha(m)
        tile = tile.rotate(-4, expand=True, resample=Image.BICUBIC)
        sh = Image.new("RGBA", (tile.width + 120, tile.height + 120), (0, 0, 0, 0))
        sh.paste((0, 0, 0, 150), (60, 90), tile.getchannel("A"))
        sh = sh.filter(ImageFilter.GaussianBlur(34))
        cx, cy = W // 2, 1080
        im.alpha_composite(sh, (cx - sh.width // 2 + 10, cy - sh.height // 2 + 20))
        im.alpha_composite(tile, (cx - tile.width // 2, cy - tile.height // 2))
    words = _short_hook(hook).upper().split()
    lines, cur, f = [], "", cfont(190)
    for w in words:
        if f.getlength((cur + " " + w).strip()) > W - 120 and cur:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    lines.append(cur)
    size = 190
    while (len(lines) > 2 or max(f.getlength(x) for x in lines) > W - 110) and size > 90:
        size -= 10
        f = cfont(size)
        lines, cur = [], ""
        for w in words:
            if f.getlength((cur + " " + w).strip()) > W - 120 and cur:
                lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        lines.append(cur)
    top = 330 if img is not None else 760
    for i, ln in enumerate(lines):
        col = st["hi"] if i == len(lines) - 1 and len(lines) > 1 else st["ink"]
        x = (W - f.getlength(ln)) / 2
        d.text((x + 6, top + i * size * 1.0 + 8), ln, font=f, fill=(0, 0, 0, 90))
        d.text((x, top + i * size * 1.0), ln, font=f, fill=col + (255,), stroke_width=max(4, size // 28),
               stroke_fill=(0, 0, 0, 255) if st["ink"] == (255, 255, 255) else (255, 255, 255, 255))
    if price:
        fb = cfont(120)
        txt = money(price)
        bw = int(fb.getlength(txt)) + 90
        badge = Image.new("RGBA", (bw, 190), (0, 0, 0, 0))
        bd = ImageDraw.Draw(badge)
        bd.rounded_rectangle([0, 0, bw - 1, 189], 40, fill=st["badge"] + (255,))
        bd.text((45, 18), txt, font=fb, fill=st["badge_ink"] + (255,))
        badge = badge.rotate(5, expand=True, resample=Image.BICUBIC)
        im.alpha_composite(badge, (W - badge.width - 70, 1380 if img is not None else 1150))
    if tag:
        ft = cfont(54)
        tw = ft.getlength(tag.upper())
        d.rounded_rectangle([60, 250, 60 + tw + 50, 330], 18, fill=(0, 0, 0, 170))
        d.text((85, 258), tag.upper(), font=ft, fill=st["hi"] + (255,))
    fl = cfont(46)
    brand = "GOLFPRICEAI.COM"
    d.text(((W - fl.getlength(brand)) / 2, 1560), brand, font=fl, fill=st["ink"] + (230,))
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(path, "JPEG", quality=94, optimize=True, progressive=True, subsampling=0)
    probs = []
    if img is not None and min(img.size) < 600:
        probs.append("thumbnail photo is low resolution")
    if size < 110:
        probs.append("thumbnail headline is too long to read at a glance")
    return probs
