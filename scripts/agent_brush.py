"""Brush styles for everyday posts (John approved 21 Nov 2026), from the creative brief in .github/SOCIAL.md.

  * humour   (Style A, golf humour): full-screen golf photo with a slow push-in, a dark green
               brush-stroke banner with the set-up at the top, then the punchline lands in a yellow
               brush banner with a comic arrow and burst marks; a quiet brand frame to close.
  * headline (Style B, big headline): full-screen photo, one oversized central headline in white
               and yellow, an underline swoosh, a dark green banner with the supporting line, an
               optional price pill (real prices only); quiet brand frame to close.
  * carousel slides (1080x1350): a cover in Style B, then numbered slides on deep green, and a
               "save this" closing slide. For educational, myth-buster and data posts.

Brand colours for everyday posts: deep golf green, white, bright yellow, natural greens. Big moments
keep their own colours (LOOKS in agent_cine.py). All words are drawn here, never baked into a photo.
Mark the word to highlight in yellow with *stars*: "Every golfer *knows* this".
"""
import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
W, H = 1080, 1920
GREEN = (16, 52, 32)        # deep golf green (banners)
GREEN2 = (10, 34, 20)
YELLOW = (255, 214, 0)
WHITE = (255, 255, 255)
INKD = (14, 28, 18)
HEAD_FONT = ROOT / "assets" / "fonts" / "LuckiestGuy-Regular.ttf"
HAND_FONT = ROOT / "assets" / "fonts" / "PermanentMarker-Regular.ttf"
BODY_FONT = ROOT / "assets" / "fonts" / "Poppins-Bold.ttf"
_f, _img, _big = {}, {}, {}


def font(size, kind="head"):
    key = (kind, size)
    if key not in _f:
        path = {"head": HEAD_FONT, "hand": HAND_FONT, "body": BODY_FONT}[kind]
        try:
            _f[key] = ImageFont.truetype(str(path), size)
        except OSError:
            _f[key] = ImageFont.load_default()
    return _f[key]


def ease(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def pop(t):  # overshoot then settle
    t = max(0.0, min(1.0, t))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def load_photo(path):
    """A library photo (path relative to the site root, or absolute)."""
    if not path:
        return None
    if path not in _img:
        p = Path(path)
        p = p if p.is_absolute() else ROOT / str(path).lstrip("/")
        try:
            _img[path] = Image.open(p).convert("RGB")
        except Exception:
            _img[path] = None
    return _img[path]


def cover(img, w, h, zoom=1.0, focus=(0.5, 0.45)):
    """Fill w x h with the photo (crop to fit), pushed in by `zoom` around the focus point."""
    if img is None:
        g = Image.new("RGB", (w, h), GREEN2)
        return g
    s = max(w / img.width, h / img.height) * zoom
    rw, rh = int(img.width * s + 1), int(img.height * s + 1)
    key = (id(img), rw, rh)
    big = _big.get(key)
    if big is None:
        big = img.resize((rw, rh), Image.LANCZOS)
        if len(_big) > 12:
            _big.clear()
        _big[key] = big
    x = int((rw - w) * focus[0])
    y = int((rh - h) * focus[1])
    return big.crop((x, y, x + w, y + h))


def parse_marked(text):
    """'Every golfer *knows* this' -> [('Every', False), ('golfer', False), ('knows', True), ('this', False)]"""
    out = []
    for part in re.split(r"(\*[^*]+\*)", str(text)):
        hi = part.startswith("*") and part.endswith("*")
        for w in part.strip("*").split():
            if out and re.fullmatch(r"[,.!?;:\u2026]+", w):  # "*shaft*, mate": keep the comma on its word
                out[-1] = (out[-1][0] + w, out[-1][1])
            else:
                out.append((w, hi))
    return out


def layout(words, f, maxw):
    lines, cur = [], []
    for w, hi in words:
        trial = " ".join(x for x, _ in cur + [(w, hi)])
        if cur and f.getlength(trial) > maxw:
            lines.append(cur)
            cur = [(w, hi)]
        else:
            cur.append((w, hi))
    if cur:
        lines.append(cur)
    return lines


def fit(text, maxw, size, minimum, max_lines, kind="head", upper=True):
    words = [(w.upper() if upper else w, hi) for w, hi in parse_marked(text)]
    while True:
        f = font(size, kind)
        lines = layout(words, f, maxw)
        if (len(lines) <= max_lines and all(f.getlength(" ".join(w for w, _ in ln)) <= maxw for ln in lines)) or size <= minimum:
            return f, lines, size
        size -= 6


def draw_words(d, lines, f, size, cx, top, base=WHITE, hi=YELLOW, stroke=0, stroke_fill=INKD, lh=1.02, shadow=False, align="center", x0=None):
    y = top
    for ln in lines:
        txt = " ".join(w for w, _ in ln)
        wdt = f.getlength(txt)
        x = cx - wdt / 2 if align == "center" else x0
        for w, is_hi in ln:
            if shadow:
                d.text((x + 6, y + 8), w, font=f, fill=(0, 0, 0, 110))
            d.text((x, y), w, font=f, fill=(hi if is_hi else base) + (255,), stroke_width=stroke, stroke_fill=stroke_fill + (255,))
            x += f.getlength(w + " ")
        y += size * lh
    return y


def brush_mask(w, h, seed, rough=14):
    """A brush-stroke shape: ragged left/right ends, slightly wobbly top and bottom, dry-brush streaks."""
    rnd = random.Random(seed)
    pad = rough * 3
    m = Image.new("L", (w + pad * 2, h + pad * 2), 0)
    d = ImageDraw.Draw(m)
    pts = []
    steps = 26
    for i in range(steps + 1):  # top edge
        x = pad + w * i / steps
        pts.append((x, pad + rnd.uniform(-rough * 0.35, rough * 0.35)))
    for i in range(1, 9):  # ragged right end
        y = pad + h * i / 9
        pts.append((pad + w + rnd.uniform(-rough * 2.2, rough * 0.8), y))
    for i in range(steps, -1, -1):  # bottom edge
        x = pad + w * i / steps
        pts.append((x, pad + h + rnd.uniform(-rough * 0.35, rough * 0.35)))
    for i in range(8, 0, -1):  # ragged left end
        y = pad + h * i / 9
        pts.append((pad + rnd.uniform(-rough * 0.8, rough * 2.2), y))
    d.polygon(pts, fill=255)
    for _ in range(9):  # dry-brush streaks off each end
        y = pad + rnd.uniform(0.1, 0.9) * h
        ln = rnd.uniform(0.04, 0.12) * w
        th = rnd.randint(2, 6)
        if rnd.random() < 0.5:
            d.line([(pad + w - rough, y), (pad + w - rough + ln, y + rnd.uniform(-4, 4))], fill=255, width=th)
        else:
            d.line([(pad + rough, y), (pad + rough - ln, y + rnd.uniform(-4, 4))], fill=255, width=th)
    for _ in range(5):  # a few gaps inside, like a real brush
        y = pad + rnd.uniform(0.15, 0.85) * h
        x = pad + rnd.uniform(0.7, 0.95) * w
        d.line([(x, y), (x + rnd.uniform(20, 70), y)], fill=0, width=rnd.randint(1, 3))
    return m.filter(ImageFilter.GaussianBlur(0.8)), pad


def banner(im, text, cx, cy, maxw, colour=GREEN, ink=WHITE, hi=YELLOW, size=96, max_lines=2, seed="b", t=1.0, rot=-2.0, upper=True):
    """A brush-stroke banner with text, popping in as t goes 0 -> 1. Returns its box (x0, y0, x1, y1)."""
    if t <= 0:
        return None
    f, lines, sz = fit(text, maxw, size, 52, max_lines, upper=upper)
    tw = max(f.getlength(" ".join(w for w, _ in ln)) for ln in lines)
    th = sz * 1.02 * len(lines)
    bw, bh = int(tw + 110), int(th + 70)
    mask, pad = brush_mask(bw, bh, seed + text)
    layer = Image.new("RGBA", mask.size, colour + (0,))
    layer.putalpha(mask)
    d = ImageDraw.Draw(layer)
    draw_words(d, lines, f, sz, layer.width / 2, pad + 38, base=ink, hi=hi, lh=1.02)
    s = 0.86 + 0.14 * pop(t)
    layer = layer.rotate(rot, expand=True, resample=Image.BICUBIC)
    if abs(s - 1) > 0.002:
        layer = layer.resize((max(1, int(layer.width * s)), max(1, int(layer.height * s))), Image.BICUBIC)
    a = min(1.0, t * 3)
    if a < 1:
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * a)))
    x, y = int(cx - layer.width / 2), int(cy - layer.height / 2)
    sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    sh.putalpha(layer.getchannel("A").point(lambda v: int(v * 0.35)))
    im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(10)), (x + 6, y + 12))
    im.alpha_composite(layer, (x, y))
    return (x, y, x + layer.width, y + layer.height)


def bursts(im, x, y, t, scale=1.0, flip=False, colour=YELLOW):
    """Three comic emphasis strokes radiating from a corner."""
    if t <= 0:
        return
    d = ImageDraw.Draw(im)
    k = ease(t)
    for i, ang in enumerate((-160, -125, -90) if not flip else (-20, -55, -90)):
        a = math.radians(ang)
        r0, r1 = 20 * scale, (20 + 95 * k) * scale
        x0, y0 = x + math.cos(a) * r0, y + math.sin(a) * r0
        x1, y1 = x + math.cos(a) * r1, y + math.sin(a) * r1
        w = int(22 * scale)
        d.line([(x0, y0), (x1, y1)], fill=INKD + (255,), width=w + 10)
        d.line([(x0, y0), (x1, y1)], fill=colour + (255,), width=w)
        for px, py in ((x0, y0), (x1, y1)):
            d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=colour + (255,))


def arrow(im, p0, p1, t, bend=0.35, colour=WHITE, width=11):
    """A hand-drawn curved arrow from p0 to p1, drawn on as t goes 0 -> 1."""
    if t <= 0:
        return
    k = ease(t)
    (x0, y0), (x1, y1) = p0, p1
    mx, my = (x0 + x1) / 2, (y0 + y1) / 2
    nx, ny = -(y1 - y0), (x1 - x0)
    cx, cy = mx + nx * bend, my + ny * bend
    pts = []
    n = 40
    for i in range(int(n * k) + 1):
        u = i / n
        pts.append(((1 - u) ** 2 * x0 + 2 * (1 - u) * u * cx + u * u * x1, (1 - u) ** 2 * y0 + 2 * (1 - u) * u * cy + u * u * y1))
    d = ImageDraw.Draw(im)
    if len(pts) > 1:
        d.line(pts, fill=(0, 0, 0, 120), width=width + 8, joint="curve")
        d.line(pts, fill=colour + (255,), width=width, joint="curve")
    if k > 0.92 and len(pts) > 2:
        (ax, ay), (bx, by) = pts[-3], pts[-1]
        ang = math.atan2(by - ay, bx - ax)
        for s in (2.5, -2.5):
            hx, hy = bx - math.cos(ang + s * 0.25) * 48, by - math.sin(ang + s * 0.25) * 48
            d.line([(bx, by), (hx, hy)], fill=(0, 0, 0, 120), width=width + 8)
            d.line([(bx, by), (hx, hy)], fill=colour + (255,), width=width)


def underline(im, cx, y, w, t, colour=YELLOW, seed="u"):
    if t <= 0:
        return
    m, pad = brush_mask(int(w * ease(t)) + 2, 26, seed, rough=6)
    layer = Image.new("RGBA", m.size, colour + (0,))
    layer.putalpha(m)
    layer = layer.rotate(-1.5, expand=True, resample=Image.BICUBIC)
    im.alpha_composite(layer, (int(cx - w / 2 - pad), int(y - pad)))


def scrim(im, top=0.0, bottom=0.0):
    """Darken the top and bottom of the photo a little so text stays readable on any photo."""
    g = Image.new("L", (1, 256))
    for i in range(256):
        u = i / 255
        v = top * max(0, 1 - u / 0.32) + bottom * max(0, (u - 0.62) / 0.38)
        g.putpixel((0, i), int(255 * min(1, v)))
    m = g.resize((W, H), Image.BILINEAR)
    im.alpha_composite(Image.merge("RGBA", (*[Image.new("L", (W, H), 0)] * 3, m)))


def closing(im, t, line="Full Swing. Not full price."):
    """The quiet brand frame: the photo dims, the line and the address fade up."""
    if t <= 0:
        return
    k = ease(t)
    ov = Image.new("RGBA", (W, H), GREEN2 + (int(200 * k),))
    im.alpha_composite(ov)
    d = ImageDraw.Draw(im)
    f, lines, sz = fit(line, W - 200, 92, 60, 2)
    draw_words(d, lines, f, sz, W / 2, 800, base=WHITE, hi=YELLOW, shadow=False)
    fa = font(46, "body")
    txt = "golfpriceai.com"
    d.text(((W - fa.getlength(txt)) / 2, 800 + sz * 1.02 * len(lines) + 40), txt, font=fa, fill=YELLOW + (int(255 * k),))


def _photo_frame(s, t, dur):
    # a second "reaction" photo (bg2) cuts in hard on the punchline beat
    key = "bg2" if (s.get("bg2") and t >= s.get("cut", 3.0)) else "bg"
    img = load_photo(s.get(key))
    z = 1.0 + 0.08 * (t / dur)  # a slow push-in, the "subtle zoom" from the brief
    fx, fy = s.get("focus2" if key == "bg2" else "focus") or (0.5, 0.42)
    return cover(img, W, H, zoom=z, focus=(fx, fy)).convert("RGBA")


# ---------------- Style A: golf humour ----------------

def style_humour(t, s, pal, img, photo, dur=8.4):
    im = _photo_frame(s, t, dur)
    scrim(im, top=0.45, bottom=0.55)
    # set-up: on screen from the first frame (the first frame must grab attention)
    ty_ = s.get("top_y", 330)  # lower it or raise it to keep faces clear
    banner(im, s.get("top") or s.get("hook", ""), W / 2, ty_, W - 170, colour=GREEN, seed="a-top", t=min(1, 0.55 + t / 0.35), size=104)
    bursts(im, 120, ty_ - 30, min(1, 0.4 + t / 0.4), 0.9)
    bursts(im, W - 120, ty_ - 30, min(1, 0.4 + t / 0.4), 0.9, flip=True)
    # punchline lands on the beat at 3.0s, with the arrow pointing at the joke
    tp = (t - 3.0) / 0.35
    if tp > 0:
        side = s.get("arrow", "left")
        box = banner(im, s.get("punch", ""), W * (0.6 if side == "left" else 0.4), 1460, W - 330, colour=YELLOW, ink=INKD, hi=GREEN,
                     seed="a-punch", t=min(1, tp), size=96, rot=-3)
        if box and s.get("arrow", "left") != "none":
            tx, ty = s.get("target", (0.24, 0.6) if side == "left" else (0.76, 0.6))
            start = (box[0] - 6, (box[1] + box[3]) / 2) if side == "left" else (box[2] + 6, (box[1] + box[3]) / 2)
            if math.hypot(W * tx - start[0], H * ty - start[1]) < 240:  # always a proper, readable arrow
                ty = max(0.3, (start[1] - 300) / H)
            arrow(im, start, (W * tx, H * ty), (t - 3.25) / 0.45, bend=-0.35 if side == "left" else 0.35)
    closing(im, (t - (dur - 1.8)) / 0.5, s.get("end") or "Full Swing. Not full price.")
    return im, 0


# ---------------- Sequence: a quick-cut mini sketch ----------------
# A character's shots cut on every beat while a shot counter ticks up, then the
# punchline lines, each on its own photo (the character, his mate's reaction,
# the prop). Missing photos render as labelled storyboard panels, so the timing
# can be checked before the photos exist (the quality gate holds those posts).

BEAT = 0.6  # 100 bpm: every cut lands on a beat


def _seq_plan(s):
    plan, t = [], 0.0
    for i, sh in enumerate(s.get("shots", [])):
        b = sh.get("beats", 1)
        plan.append(("shot", i, t, t + b * BEAT, sh))
        t += b * BEAT
    for j, ln in enumerate(s.get("lines", [])):
        b = ln.get("beats", 2)
        plan.append(("line", j, t, t + b * BEAT, ln))
        t += b * BEAT
    return plan, t


def seq_duration(s):
    return round(_seq_plan(s)[1] + 1.8, 2)


def _placeholder(label, scene, k):
    im = Image.new("RGBA", (W, H), GREEN2 + (255,))
    d = ImageDraw.Draw(im)
    for y in range(0, H, 6):  # soft vertical gradient
        d.line([(0, y), (W, y)], fill=(GREEN[0] + int(10 * y / H), GREEN[1] + int(18 * y / H), GREEN[2] + int(10 * y / H), 255))
    m = 70
    for x in range(m, W - m, 44):
        d.line([(x, m), (x + 22, m)], fill=(255, 255, 255, 90), width=4)
        d.line([(x, H - m), (x + 22, H - m)], fill=(255, 255, 255, 90), width=4)
    for y in range(m, H - m, 44):
        d.line([(m, y), (m, y + 22)], fill=(255, 255, 255, 90), width=4)
        d.line([(W - m, y), (W - m, y + 22)], fill=(255, 255, 255, 90), width=4)
    f, lines, sz = fit(label, W - 260, 150, 80, 2)
    draw_words(d, lines, f, sz, W / 2, 760, base=WHITE, hi=YELLOW)
    fb = font(40, "body")
    words, row, rows = scene.split(), "", []
    for w_ in words:
        if fb.getlength(row + " " + w_) > W - 300:
            rows.append(row.strip()); row = ""
        row += " " + w_
    rows.append(row.strip())
    y = 760 + sz * 1.05 * len(lines) + 40
    for r in rows[:5]:
        d.text(((W - fb.getlength(r)) / 2, y), r, font=fb, fill=(255, 255, 255, 170)); y += 56
    tag = f"PHOTO {k}  ·  storyboard"
    d.text(((W - fb.getlength(tag)) / 2, H - 190), tag, font=fb, fill=YELLOW + (200,))
    return im


def _seq_frame(item, t0, t1, t, k):
    bg = item.get("bg")
    img = load_photo(bg) if bg else None
    u = (t - t0) / max(0.01, t1 - t0)
    if img is None:
        return _placeholder(item.get("label", ""), item.get("scene", ""), k)
    z = 1.07 - 0.05 * ease(min(1, u * 1.6))  # each cut punches in, then settles
    fx, fy = item.get("focus", (0.5, 0.42))
    return cover(img, W, H, zoom=z, focus=(fx, fy)).convert("RGBA")


def _counter(im, n, t_since):
    """The shot tally, scorecard-style, top right; pops each time it ticks."""
    k = pop(min(1, t_since / 0.22))
    f = font(int(64 * (0.85 + 0.15 * k)), "head")
    txt = f"SHOTS: {n}"
    w = f.getlength(txt) + 70
    box = Image.new("RGBA", (int(w), 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle([0, 0, w - 1, 119], 26, fill=YELLOW + (255,))
    d.text((35, 22), txt, font=f, fill=INKD)
    im.alpha_composite(box.rotate(3, expand=True, resample=Image.BICUBIC), (int(W - w - 60), 150))


def style_sequence(t, s, pal, img, photo, dur=None):
    plan, end = _seq_plan(s)
    dur = dur or end + 1.8
    cur = plan[-1]
    for p in plan:
        if p[2] <= t < p[3]:
            cur = p
            break
    kind, i, t0, t1, item = cur
    k = plan.index(cur) + 1
    im = _seq_frame(item, t0, t1, t, k)
    scrim(im, top=0.35, bottom=0.45)
    counting = s.get("counter", True)
    real = [sh for sh in s.get("shots", []) if not sh.get("cutaway")]
    nshots = len(real)
    if kind == "shot":
        n_now = sum(1 for sh in s.get("shots", [])[:i + 1] if not sh.get("cutaway"))  # cutaways (Kev's reactions) don't count
        if s.get("top") and not item.get("hide_top") and not item.get("cutaway"):  # the set-up sits low, so faces near the top of the photos stay clear
            banner(im, s["top"], W / 2, s.get("top_y", 1560), W - 220, colour=GREEN, seed="q-top", t=min(1, 0.55 + t / 0.35), size=92)
        if counting and n_now:
            _counter(im, n_now, (t - t0) if not item.get("cutaway") else 9)
    else:
        if counting and s.get("keep_count", True) and t < end:
            _counter(im, nshots, 9)
        who = item.get("who", "him")
        y = {"top": 420, "bottom": 1500, "low": 1720}.get(item.get("pos"), 1440 if who != "him" else 420)
        col, ink, hi = (YELLOW, INKD, GREEN) if who != "him" else (GREEN, WHITE, YELLOW)
        banner(im, item.get("text", ""), W / 2, y, W - 200, colour=col, ink=ink, hi=hi, seed=f"q-l{i}",
               t=min(1, (t - t0) / 0.3), size=98, rot=-2 if i % 2 else 2)
    closing(im, (t - (dur - 1.8)) / 0.5, s.get("end") or "Full Swing. Not full price.")
    return im, 0


# ---------------- Style B: big headline ----------------

def style_headline(t, s, pal, img, photo, dur=7.8):
    im = _photo_frame(s, t, dur)
    scrim(im, top=0.35, bottom=0.6)
    # a soft vignette behind the middle so a huge headline reads on any photo
    v = Image.new("L", (W, H), 0)
    ImageDraw.Draw(v).ellipse([-260, 560, W + 260, 1300], fill=120)
    im.alpha_composite(Image.merge("RGBA", (*[Image.new("L", (W, H), 0)] * 3, v.filter(ImageFilter.GaussianBlur(140)))))
    d = ImageDraw.Draw(im)
    f, lines, sz = fit(s.get("big") or s.get("hook", ""), W - 130, 230, 120, 3)
    k = pop(min(1, 0.6 + t / 0.3))
    total = sz * 0.98 * len(lines)
    top = 930 - total / 2
    if k < 0.999:
        layer = Image.new("RGBA", (W, int(total + 80)), (0, 0, 0, 0))
        draw_words(ImageDraw.Draw(layer), lines, f, sz, W / 2, 20, stroke=max(6, sz // 18), lh=0.98, shadow=True)
        sc = 0.9 + 0.1 * k
        layer = layer.resize((int(layer.width * sc), int(layer.height * sc)), Image.BICUBIC)
        im.alpha_composite(layer, (int((W - layer.width) / 2), int(top - 20 + (1 - sc) * total / 2)))
    else:
        draw_words(d, lines, f, sz, W / 2, top, stroke=max(6, sz // 18), lh=0.98, shadow=True)
    lw = max(f.getlength(" ".join(w for w, _ in ln)) for ln in lines)
    underline(im, W / 2, top + total + 10, min(W - 160, lw * 0.8), (t - 0.6) / 0.4, seed="b-u")
    if s.get("sub"):
        banner(im, s["sub"], W / 2, 1500, W - 200, colour=GREEN, seed="b-sub", t=(t - 1.8) / 0.35, size=76, max_lines=2)
    if s.get("price"):
        tp = (t - 3.0) / 0.3
        if tp > 0:
            fp = font(110)
            txt = s["price"] if isinstance(s["price"], str) else (f"£{s['price']:,.2f}" if float(s["price"]) % 1 else f"£{float(s['price']):,.0f}")
            bw = int(fp.getlength(txt)) + 90
            pill = Image.new("RGBA", (bw, 170), (0, 0, 0, 0))
            pd = ImageDraw.Draw(pill)
            pd.rounded_rectangle([0, 0, bw - 1, 169], 40, fill=YELLOW + (255,))
            pd.text((45, 22), txt, font=fp, fill=INKD + (255,))
            sc = 0.8 + 0.2 * pop(min(1, tp))
            pill = pill.rotate(4, expand=True, resample=Image.BICUBIC)
            pill = pill.resize((int(pill.width * sc), int(pill.height * sc)), Image.BICUBIC)
            im.alpha_composite(pill, (W - pill.width - 80, 300))
    closing(im, (t - (dur - 1.8)) / 0.5, s.get("end") or "Full Swing. Not full price.")
    return im, 0


BRUSH_STYLES = {"humour": (style_humour, 8.4), "headline": (style_headline, 7.8), "sequence": (style_sequence, 9.6)}


# ---------------- the cast cover (sketch thumbnails) ----------------
SERIES = "THE FOURBALL"  # the recurring cast's series name on every sketch cover


def _name_pill(im, text, cx, cy, colour=WHITE, ink=INKD):
    f = font(46, "head")
    w = f.getlength(text) + 56
    box = Image.new("RGBA", (int(w), 84), (0, 0, 0, 0))
    d = ImageDraw.Draw(box)
    d.rounded_rectangle([0, 0, w - 1, 83], 42, fill=colour + (255,))
    d.text((28, 14), text, font=f, fill=ink)
    im.alpha_composite(box, (int(cx - w / 2), int(cy - 42)))


def cast_cover(s):
    """Split-face cover: the set-up character on the left, the reaction on the right, a yellow slash between,
    the hook big in the middle, name tags and the series badge. Everything important sits inside the
    middle 4:5 (and 3:4 profile-grid) crop."""
    cv = s.get("cover") or {}
    lines = s.get("lines", [])
    shots = s.get("shots", [])
    left = cv.get("left") or next((l for l in lines if l.get("who") == "him"), None) or (shots[0] if shots else {})
    right = cv.get("right") or next((l for l in lines if l.get("who") not in (None, "him")), None) or (lines[-1] if lines else {})
    if isinstance(left, str):
        left = {"bg": left}
    if isinstance(right, str):
        right = {"bg": right}
    im = Image.new("RGBA", (W, H), GREEN2 + (255,))
    lw = 620
    a = cover(load_photo(left.get("bg")), lw, H, zoom=1.0, focus=tuple(cv.get("left_focus") or left.get("focus") or (0.4, 0.4))).convert("RGBA")
    b = cover(load_photo(right.get("bg")), lw, H, zoom=1.0, focus=tuple(cv.get("right_focus") or right.get("focus") or (0.5, 0.4))).convert("RGBA")
    im.alpha_composite(a, (0, 0))
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).polygon([(600, 0), (W, 0), (W, H), (480, H)], fill=255)
    rb = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rb.paste(b, (W - lw, 0))
    im.paste(rb, (0, 0), Image.composite(rb.getchannel("A"), Image.new("L", (W, H), 0), m))
    d = ImageDraw.Draw(im)
    d.line([(600, -10), (480, H + 10)], fill=YELLOW, width=18)
    scrim(im, top=0.25, bottom=0.75)
    # series badge, hook, names: all inside the safe middle
    ep = cv.get("ep") or s.get("ep")
    badge = SERIES + (f"  \u00b7  EP {ep}" if ep else "")
    fb = font(44, "head")
    bw = fb.getlength(badge) + 60
    bx = Image.new("RGBA", (int(bw), 80), (0, 0, 0, 0))
    ImageDraw.Draw(bx).rounded_rectangle([0, 0, bw - 1, 79], 18, fill=GREEN + (255,))
    ImageDraw.Draw(bx).text((30, 14), badge, font=fb, fill=YELLOW)
    im.alpha_composite(bx.rotate(-2, expand=True, resample=Image.BICUBIC), (int(W / 2 - bw / 2), 1575))
    banner(im, cv.get("hook") or s.get("thumb") or s.get("hook", ""), W / 2, 1230, W - 120, colour=YELLOW, ink=INKD, hi=GREEN,
           seed="cover", t=1.0, size=150, max_lines=2, rot=-3)
    names = cv.get("names") or []
    if len(names) >= 1:
        _name_pill(im, names[0].upper(), 270, 1480)
    if len(names) >= 2:
        _name_pill(im, names[1].upper(), W - 270, 1480)
    return im


def thumbnail(path, style, s):
    """The cover: the strongest frame of the video (both lines showing, no closing frame)."""
    fn, dur = BRUSH_STYLES[style]
    s2 = dict(s)
    s2["end"] = None
    if style == "sequence":  # the cast cover: set-up face v reaction face, hook in the middle
        im = cast_cover(s2)
    else:
        im, _ = fn(5.0 if style == "humour" else 4.6, s2, None, None, None, dur=99)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.convert("RGB").save(path, "JPEG", quality=93, optimize=True, progressive=True)
    probs = []
    if style == "sequence":
        for n, it in enumerate(list(s.get("shots", [])) + list(s.get("lines", [])), 1):
            ph = load_photo(it.get("bg"))
            if ph is None:
                probs.append(f"sequence photo {n} is missing (storyboard panel shown)")
            elif min(ph.size) < 900:
                probs.append(f"sequence photo {n} is low resolution")
        return probs
    ph = load_photo(s.get("bg"))
    if ph is None:
        probs.append("thumbnail has no background photo")
    elif min(ph.size) < 900:
        probs.append("background photo is low resolution")
    return probs


# ---------------- carousels ----------------
CW, CH = 1080, 1350


def carousel(out_dir, pid, slides, bg=None, series=None):
    """slides: [{"title": "...", "body": "...", "kicker": "MYTH"}...]. The first is the cover, the last the save slide.
    Writes <out_dir>/<pid>-s1.jpg ... and returns (paths, problems)."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths, probs = [], []
    n = len(slides)
    if not 3 <= n <= 10:
        probs.append(f"carousel has {n} slides (Instagram takes 2 to 10; we aim for 5 to 7)")
    for i, sl in enumerate(slides):
        if i == 0:  # cover: Style B on a photo
            ph = load_photo(bg)
            im = cover(ph, CW, CH, zoom=1.04).convert("RGBA")
            g = Image.new("L", (1, 256))
            for y in range(256):
                g.putpixel((0, y), int(255 * min(1, 0.25 + 0.6 * max(0, (y / 255 - 0.35) / 0.65))))
            im.alpha_composite(Image.merge("RGBA", (*[Image.new("L", (CW, CH), 0)] * 3, g.resize((CW, CH)))))
            d = ImageDraw.Draw(im)
            if series:
                banner(im, series, CW / 2, 150, CW - 300, colour=YELLOW, ink=INKD, hi=GREEN, size=58, seed="c-series", rot=-2)
            f, lines, sz = fit(sl.get("title", ""), CW - 120, 170, 90, 4)
            total = sz * 0.98 * len(lines)
            draw_words(d, lines, f, sz, CW / 2, 700 - total / 2, stroke=max(5, sz // 18), lh=0.98, shadow=True)
            if sl.get("body"):
                banner(im, sl["body"], CW / 2, 1080, CW - 220, colour=GREEN, size=60, seed="c-sub")
            fs = font(40, "body")
            sx = CW - 110 - fs.getlength("Swipe")
            d.text((sx, CH - 92), "Swipe", font=fs, fill=YELLOW + (255,))
            ax = sx + fs.getlength("Swipe") + 14
            d.polygon([(ax, CH - 82), (ax + 22, CH - 70), (ax, CH - 58)], fill=YELLOW + (255,))
        elif i == n - 1:  # the closing slide: save it, in yellow
            im = Image.new("RGBA", (CW, CH), YELLOW + (255,))
            d = ImageDraw.Draw(im)
            bx, by = CW / 2, 360  # a bookmark (save) icon
            d.polygon([(bx - 70, by - 100), (bx + 70, by - 100), (bx + 70, by + 100), (bx, by + 50), (bx - 70, by + 100)], fill=GREEN + (255,))
            f, lines, sz = fit(sl.get("title", "Save this for later"), CW - 160, 130, 70, 3)
            y = draw_words(d, lines, f, sz, CW / 2, 560, base=GREEN, hi=WHITE, lh=1.0)
            if sl.get("body"):
                fb = font(48, "body")
                words, line, by2, rows = sl["body"].split(), "", y + 40, []
                for w in words:
                    if fb.getlength((line + " " + w).strip()) > CW - 200:
                        rows.append(line)
                        line = w
                    else:
                        line = (line + " " + w).strip()
                rows.append(line)
                for r in rows:
                    d.text(((CW - fb.getlength(r)) / 2, by2), r, font=fb, fill=GREEN + (255,))
                    by2 += 66
        else:
            im = Image.new("RGBA", (CW, CH), GREEN + (255,))
            d = ImageDraw.Draw(im)
            # measure first, so the block sits in the middle of the slide
            f, lines, sz = fit(sl.get("title", ""), CW - 160, 120, 64, 4)
            fb = font(52, "body")
            rows, line = [], ""
            for w in (sl.get("body") or "").split():
                if fb.getlength((line + " " + w).strip()) > CW - 160:
                    rows.append(line)
                    line = w
                else:
                    line = (line + " " + w).strip()
            if line:
                rows.append(line)
            block = 190 + sz * 1.0 * len(lines) + 40 + 72 * len(rows)
            top = max(120, (CH - 120 - block) / 2)
            if sl.get("kicker"):
                banner(im, sl["kicker"], 80 + 140, top + 70, 360, colour=YELLOW, ink=INKD, hi=GREEN, size=60, seed="c-k" + str(i), rot=-3)
            else:
                d.text((80, top - 10), str(i), font=font(170), fill=YELLOW + (255,), stroke_width=6, stroke_fill=GREEN2 + (255,))
            y = draw_words(d, lines, f, sz, CW / 2, top + 190, align="left", x0=80, lh=1.0)
            by = y + 40
            for r in rows:
                d.text((80, by), r, font=fb, fill=WHITE + (240,))
                by += 72
            if by > CH - 130:
                probs.append(f"slide {i + 1}: too much text for the slide")
        # progress dots and brand on every slide
        d = ImageDraw.Draw(im)
        for k in range(n):
            x = CW / 2 - (n - 1) * 14 + k * 28
            r = 7 if k == i else 5
            d.ellipse([x - r, CH - 60 - r, x + r, CH - 60 + r], fill=(((GREEN if i == n - 1 else YELLOW) + (255,)) if k == i else (((GREEN + (90,)) if i == n - 1 else (255, 255, 255, 120)))))
        fs = font(30, "body")
        d.text((70, CH - 78), "golfpriceai.com", font=fs, fill=(GREEN + (200,)) if i == n - 1 else (255, 255, 255, 170))
        p = out_dir / f"{pid}-s{i + 1}.jpg"
        im.convert("RGB").save(p, "JPEG", quality=92, optimize=True, progressive=True)
        paths.append(p)
    return paths, probs
