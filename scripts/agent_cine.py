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
    im = dark_bg(t, tint=(20, 20, 30))
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


CINE_STYLES = {"spec": (style_spec, 10.5), "thennow": (style_thennow, 10.0), "story": (style_story, 12.6),
               "sitedemo": (style_sitedemo, 11.0), "truth": (style_truth, 10.5)}
