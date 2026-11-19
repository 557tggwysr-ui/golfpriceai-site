"""Short vertical videos (1080x1920, 30fps) and matching feed cards for the
content engine. Drawn frame by frame with Pillow, encoded with ffmpeg.

Every video follows the same shape, because that's what holds attention:
  0.0-1.2s  HOOK      big words that stop the scroll, popping in with a jolt
  1.2-~8s   PAYOFF    the reveal: a price falls, a countdown, a punchline
  last 2s   CTA       where to look: golfpriceai.com

Styles (each looks different, so the feed never looks samey):
  reveal       a price ticking down from its high to today's price, then a stamp
  guess        "higher or lower?", a 3-2-1 countdown, then the answer
  countdown    three products, #3 to #1, each with its saving
  stat         a big number counting up with a bar filling
  pov          a two-beat meme: "POV: ..." then the twist
  expectation  a meme split screen: what you think it costs v what it costs today
  receipt      a till receipt printing the kit, line by line, then the total

Four colour schemes rotate on top of the styles. Words are original jokes in a
friendly golf-club voice: no real people, no photos of anyone, nothing political.
"""
import math
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "assets" / "fonts" / "Poppins-Bold.ttf"
W, H, FPS = 1080, 1920, 30

PALETTES = {
    "fairway": {"bg": (20, 33, 26), "bg2": (31, 58, 40), "ink": (255, 255, 255), "soft": (196, 208, 200), "accent": (63, 174, 41), "pop": (227, 178, 60)},
    "clubhouse": {"bg": (244, 238, 224), "bg2": (228, 219, 196), "ink": (20, 33, 26), "soft": (88, 98, 90), "accent": (31, 120, 52), "pop": (196, 64, 48)},
    "gold": {"bg": (16, 18, 16), "bg2": (40, 36, 22), "ink": (255, 247, 225), "soft": (210, 196, 160), "accent": (227, 178, 60), "pop": (255, 255, 255)},
    "sky": {"bg": (232, 243, 250), "bg2": (204, 228, 242), "ink": (14, 40, 60), "soft": (70, 96, 116), "accent": (21, 118, 196), "pop": (28, 112, 38)}  # pop darkened for contrast (was 2.5:1),
}

_fonts = {}
_blur = {}


def font(size):
    size = max(8, int(size))
    if size not in _fonts:
        _fonts[size] = ImageFont.truetype(str(FONT), size)
    return _fonts[size]


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t):  # overshoot then settle: the "pop"
    t = max(0.0, min(1.0, t))
    c1, c3 = 1.70158, 2.70158
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2


def wrap(d, text, f, maxw):
    words, lines, cur = str(text).split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if d.textlength(t, font=f) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w_
    return lines + ([cur] if cur else [])


def fit_lines(d, text, maxw, start, minimum, max_lines):
    size = start
    while size > minimum:
        lines = wrap(d, text, font(size), maxw)
        if len(lines) <= max_lines and all(d.textlength(l, font=font(size)) <= maxw for l in lines):
            return lines, size
        size -= 4
    return wrap(d, text, font(minimum), maxw)[:max_lines], minimum


def text_block(im, text, cy, size, colour, scale=1.0, alpha=1.0, maxw=W - 140, max_lines=3, align="center", x=None, cx=None):
    """Draw centred multi-line text with optional pop scale and fade."""
    if alpha <= 0.01:
        return
    d = ImageDraw.Draw(im)
    lines, s = fit_lines(d, text, maxw, size, 28, max_lines)
    s2 = max(10, s * scale)
    f = font(s2)
    lh = s2 * 1.12
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    y = cy - lh * len(lines) / 2
    for line in lines:
        tw = ld.textlength(line, font=f)
        tx = ((cx if cx is not None else W / 2) - tw / 2) if align == "center" else (x or 70)
        ld.text((tx, y), line, font=f, fill=colour + (int(255 * alpha),))
        y += lh
    im.alpha_composite(layer)


def backdrop(pal, t, photo=None):
    im = Image.new("RGBA", (W, H), pal["bg"] + (255,))
    d = ImageDraw.Draw(im)
    # slow diagonal stripes like a mown fairway: movement without distraction
    off = int(t * 40) % 240
    for i in range(-2, 12):
        x = i * 240 + off
        d.polygon([(x, 0), (x + 120, 0), (x + 120 - 600, H), (x - 600, H)], fill=pal["bg2"] + (255,))
    if photo is not None:
        key = id(photo)
        if key not in _blur:
            ph = ImageOps.fit(photo, (W, H)).filter(ImageFilter.GaussianBlur(18)).convert("RGBA")
            ph.putalpha(70)
            _blur.clear()
            _blur[key] = ph
        im.alpha_composite(_blur[key])
    return im


def product_tile(img, size, pal):
    tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    if img is not None:
        a = ImageOps.contain(img.convert("RGB"), (int(size * 0.88), int(size * 0.88)))
        tile.paste(a, ((size - a.width) // 2, (size - a.height) // 2))
    else:
        d = ImageDraw.Draw(tile)
        d.ellipse([size * 0.3, size * 0.3, size * 0.7, size * 0.7], fill=(235, 235, 235))
        for k in range(14):
            ang = k / 14 * 6.283
            cx, cy = size / 2 + math.cos(ang) * size * 0.12, size / 2 + math.sin(ang) * size * 0.12
            d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(210, 210, 210))
    mask = Image.new("L", tile.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size, size], int(size * 0.07), fill=255)
    tile.putalpha(mask)
    return tile


def paste_center(im, tile, cx, cy, scale=1.0, alpha=1.0):
    if scale <= 0.02 or alpha <= 0.01:
        return
    t = tile.resize((max(1, int(tile.width * scale)), max(1, int(tile.height * scale))))
    if alpha < 1:
        a = t.getchannel("A").point(lambda v: int(v * alpha))
        t.putalpha(a)
    im.alpha_composite(t, (int(cx - t.width / 2), int(cy - t.height / 2)))


def pill(im, text, cy, pal, alpha=1.0, size=40, colour=None):
    if alpha <= 0.01:
        return
    d = ImageDraw.Draw(im)
    f = font(size)
    tw = d.textlength(text, font=f)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    c = (colour or pal["accent"]) + (int(255 * alpha),)
    ld.rounded_rectangle([(W - tw) / 2 - 34, cy - size * 0.85, (W + tw) / 2 + 34, cy + size * 0.85], int(size * 0.85), fill=c)
    ld.text(((W - tw) / 2, cy - size * 0.68), text, font=f, fill=(255, 255, 255, int(255 * alpha)))
    im.alpha_composite(layer)


def stamp(im, text, cx, cy, pal, t):
    """A rubber stamp slamming down: big, rotated, then settles."""
    if t <= 0:
        return
    s = 1.8 - 0.8 * ease_out(t * 3)
    d0 = ImageDraw.Draw(im)
    f = font(64)
    tw = d0.textlength(text, font=f)
    box = Image.new("RGBA", (int(tw + 80), 130), (0, 0, 0, 0))
    bd = ImageDraw.Draw(box)
    bd.rounded_rectangle([4, 4, box.width - 4, box.height - 4], 18, outline=pal["pop"] + (255,), width=8)
    bd.text((40, 22), text, font=f, fill=pal["pop"] + (255,))
    box = box.rotate(-8, expand=True, resample=Image.BICUBIC)
    paste_center(im, box, cx, cy, scale=s, alpha=min(1, t * 4))


def footer(im, pal, alpha=1.0):
    text_block(im, "golfpriceai.com", H - 150, 54, pal["ink"], alpha=alpha)
    text_block(im, "Full Swing. Not full price.", H - 88, 34, pal["accent"], alpha=alpha)


def shake(t, start, dur=0.25, amp=14):
    if start <= t < start + dur:
        k = 1 - (t - start) / dur
        return int(math.sin(t * 90) * amp * k)
    return 0


def money(n):
    n = float(n)
    return f"£{n:,.0f}" if n >= 100 or n == int(n) else f"£{n:,.2f}"


# ---------------- the styles ----------------
# Each takes (t, s) where s is the post's script dict and returns a frame.

def hook_frame(im, s, pal, t):
    """0 to 1.2s: the hook pops in with a jolt, then floats up out of the way."""
    k = ease_back(t / 0.45)
    lift = ease_out((t - 1.0) / 0.35) if t > 1.0 else 0
    text_block(im, s["hook"], 760 - 420 * lift, 104 - 30 * lift, pal["ink"], scale=max(0.3, k), maxw=W - 120,
               max_lines=4, alpha=1.0)


def style_reveal(t, s, pal, img, photo):
    im = backdrop(pal, t, photo)
    hook_frame(im, s, pal, min(t, 1.35))
    if t > 1.2:
        tile = product_tile(img, 620, pal)
        paste_center(im, tile, W / 2, 900 + 120 * (1 - ease_out((t - 1.2) / 0.5)), scale=ease_out((t - 1.2) / 0.5))
    if t > 1.6:
        text_block(im, s["name"], 1290, 46, pal["soft"], alpha=ease_out((t - 1.6) / 0.4), max_lines=2)
    if t > 2.2:
        # the price falls from its high to today's
        k = ease_out((t - 2.2) / 2.6)
        hi, lo = s.get("from", s["price"]), s["price"]
        shown = hi - (hi - lo) * k
        col = pal["pop"] if k >= 1 else pal["ink"]
        text_block(im, money(round(shown, 2) if lo < 100 else round(shown)), 1470, 150, col)
    if t > 5.0:
        stamp(im, s.get("stamp", "LOWEST WE'VE TRACKED"), W / 2, 1640, pal, (t - 5.0))
    if t > 7.2:
        footer(im, pal, ease_out((t - 7.2) / 0.5))
    return im, shake(t, 5.0)


def style_guess(t, s, pal, img, photo):
    im = backdrop(pal, t, photo)
    hook_frame(im, s, pal, min(t, 1.35))
    if t > 1.2:
        paste_center(im, product_tile(img, 520, pal), W / 2, 800, scale=ease_back((t - 1.2) / 0.5))
        text_block(im, s["name"], 1110, 44, pal["soft"], alpha=ease_out((t - 1.4) / 0.4), max_lines=2)
    if t > 1.9:
        text_block(im, s.get("question", f"Over or under {money(s['line'])}?"), 1250, 70, pal["ink"], alpha=ease_out((t - 1.9) / 0.3))
    for i, n in enumerate(("3", "2", "1")):
        st = 2.6 + i * 0.8
        if st <= t < st + 0.8:
            k = (t - st) / 0.8
            text_block(im, n, 1480, 220 * (1.4 - 0.4 * ease_out(k * 2)), pal["accent"], alpha=1 - max(0, k - 0.7) / 0.3)
    if t > 5.0:
        pill(im, "TODAY'S PRICE", 1390, pal, alpha=ease_out((t - 5.0) / 0.3), size=36)
        text_block(im, money(s["price"]), 1510, 150 * ease_back((t - 5.0) / 0.4), pal["pop"])
    if t > 6.2:
        text_block(im, s.get("banter", "Get it right? Your round's on you."), 1650, 40, pal["soft"], alpha=ease_out((t - 6.2) / 0.4), max_lines=2)
    if t > 7.6:
        footer(im, pal, ease_out((t - 7.6) / 0.4))
    return im, shake(t, 5.0)


def style_countdown(t, s, pal, imgs, photo):
    im = backdrop(pal, t, photo)
    hook_frame(im, s, pal, min(t, 1.35))
    # build up to the biggest: #3 (smallest drop) first, #1 last
    order = sorted(range(min(3, len(s["items"]))), key=lambda j: s["items"][j]["fall"])
    items = [s["items"][j] for j in order]
    imgs = [imgs[j] if imgs and j < len(imgs) else None for j in order]
    for i, it in enumerate(items):
        st = 1.3 + i * 2.1
        if t < st:
            continue
        rank = len(items) - i
        k = ease_out((t - st) / 0.45)
        y = 520 + i * 400
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        im.alpha_composite(layer)
        d = ImageDraw.Draw(im)
        x0 = 70 + int((1 - k) * 900)
        d.rounded_rectangle([x0, y, x0 + W - 140, y + 360], 30, fill=pal["bg2"] + (255,))
        d.text((x0 + 30, y + 20), f"#{rank}", font=font(110), fill=pal["accent"] + (255,))
        tile = product_tile(imgs[i] if i < len(imgs) else None, 250, pal)
        im.alpha_composite(tile, (x0 + W - 140 - 280, y + 55))
        nm = wrap(d, it["name"], font(38), W - 140 - 520)[:2]
        for j, line in enumerate(nm):
            d.text((x0 + 200, y + 50 + j * 48), line, font=font(38), fill=pal["ink"] + (255,))
        d.text((x0 + 200, y + 175), money(it["now"]), font=font(76), fill=pal["pop"] + (255,))
        d.text((x0 + 200, y + 270), f"{money(it['fall'])} cheaper", font=font(40), fill=pal["accent"] + (255,))
    if t > 8.0:
        footer(im, pal, ease_out((t - 8.0) / 0.4))
    return im, shake(t, 1.3 + 2 * 2.1)


def style_stat(t, s, pal, img, photo):
    im = backdrop(pal, t, photo)
    hook_frame(im, s, pal, min(t, 1.35))
    if t > 1.3:
        k = ease_out((t - 1.3) / 2.2)
        n, of = s["n"], s["of"]
        text_block(im, f"{round(n * k)}", 900, 330, pal["pop"])
        text_block(im, f"of {of} {s['what']}", 1120, 64, pal["ink"])
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([110, 1240, W - 110, 1300], 30, fill=pal["bg2"] + (255,))
        d.rounded_rectangle([110, 1240, 110 + (W - 220) * (n / max(1, of)) * k, 1300], 30, fill=pal["accent"] + (255,))
    if t > 3.8:
        text_block(im, s["line"], 1450, 52, pal["soft"], alpha=ease_out((t - 3.8) / 0.5), max_lines=3)
    if t > 5.6:
        text_block(im, s.get("banter", "Your handicap won't drop this fast."), 1640, 46, pal["ink"], alpha=ease_out((t - 5.6) / 0.5), max_lines=2)
    if t > 7.2:
        footer(im, pal, ease_out((t - 7.2) / 0.4))
    return im, shake(t, 3.5)


def style_pov(t, s, pal, img, photo):
    im = backdrop(pal, t, photo)
    if t < 3.4:
        a = ease_out(t / 0.35) * (1 - ease_out((t - 3.0) / 0.4))
        pill(im, s.get("label", "POV"), 520, pal, alpha=a, size=46)
        text_block(im, s["setup"], 860, 92 * ease_back(t / 0.45), pal["ink"], alpha=a, max_lines=4)
    if t > 3.2:
        k = ease_out((t - 3.2) / 0.4)
        paste_center(im, product_tile(img, 520, pal), W / 2, 760, scale=ease_back((t - 3.2) / 0.5))
        text_block(im, s["twist"], 1240, 80, pal["pop"], alpha=k, max_lines=3)
    if t > 5.2:
        text_block(im, s["punch"], 1530, 50, pal["soft"], alpha=ease_out((t - 5.2) / 0.5), max_lines=3)
    if t > 7.2:
        footer(im, pal, ease_out((t - 7.2) / 0.4))
    return im, shake(t, 3.2)


def style_expectation(t, s, pal, img, photo):
    im = backdrop(pal, t, None)
    d = ImageDraw.Draw(im)
    hook_frame(im, s, pal, min(t, 1.35))
    if t > 1.3:
        k = ease_out((t - 1.3) / 0.5)
        d.rounded_rectangle([60, 560, W / 2 - 15, 1500], 34, fill=pal["bg2"] + (255,))
        text_block(im, "What you think it costs", 660, 40, pal["soft"], maxw=W / 2 - 140, alpha=k, cx=W / 4 + 22)
        text_block(im, money(s["from"]), 1000, 104, pal["ink"], alpha=k, maxw=W / 2 - 120, cx=W / 4 + 22)
    if t > 2.6:
        # strike through the "expectation"
        k = ease_out((t - 2.6) / 0.4)
        d.line([110, 1050, 110 + (W / 2 - 180) * k, 950], fill=pal["pop"], width=14)
    if t > 3.2:
        k = ease_back((t - 3.2) / 0.5)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle([W / 2 + 15, 560, W - 60, 1500], 34, fill=pal["accent"] + (255,))
        im.alpha_composite(layer)
        text_block(im, "What it costs today", 660, 40, (255, 255, 255), maxw=W / 2 - 140, cx=3 * W / 4 - 22)
        text_block(im, money(s["price"]), 1000, 112 * max(0.3, k), (255, 255, 255), maxw=W / 2 - 120, cx=3 * W / 4 - 22)
    if t > 4.2:
        text_block(im, s["name"], 1570, 44, pal["ink"], alpha=ease_out((t - 4.2) / 0.4), max_lines=2)
    if t > 5.4:
        text_block(im, s.get("banter", "Spend the difference on lessons. Or don't."), 1655, 38, pal["soft"], alpha=ease_out((t - 5.4) / 0.4), max_lines=2)
    if t > 7.4:
        footer(im, pal, ease_out((t - 7.4) / 0.4))
    return im, shake(t, 3.2)


def style_receipt(t, s, pal, img, photo):
    im = backdrop(pal, t, photo)
    hook_frame(im, s, pal, min(t, 1.35))
    if t > 1.2:
        lines = s["items"][:6]
        k = ease_out((t - 1.2) / 0.4)
        top = 470
        paper_h = 200 + 110 * len(lines) + 220
        shown = min(len(lines), int((t - 1.6) / 0.55) + 1) if t > 1.6 else 0
        d = ImageDraw.Draw(im)
        x0, x1 = 130, W - 130
        d.rectangle([x0, top, x1, top + paper_h * k], fill=(252, 250, 244, 255))
        d.text((x0 + 40, top + 40), "GOLFPRICE AI · TODAY", font=font(36), fill=(40, 40, 40, 255))
        d.line([x0 + 40, top + 110, x1 - 40, top + 110], fill=(180, 180, 180), width=3)
        for i, it in enumerate(lines[:shown]):
            y = top + 140 + i * 110
            nm = it["item"][:26]
            d.text((x0 + 40, y), nm, font=font(38), fill=(30, 30, 30, 255))
            pr = money(it["price"])
            d.text((x1 - 40 - d.textlength(pr, font=font(42)), y), pr, font=font(42), fill=(30, 30, 30, 255))
        if shown == len(lines) and t > 1.6 + 0.55 * len(lines) + 0.3:
            y = top + 160 + 110 * len(lines)
            d.line([x0 + 40, y, x1 - 40, y], fill=(30, 30, 30), width=4)
            tot = money(s["total"])
            d.text((x0 + 40, y + 30), "TOTAL", font=font(56), fill=(30, 30, 30, 255))
            d.text((x1 - 40 - d.textlength(tot, font=font(72)), y + 20), tot, font=font(72), fill=(31, 120, 52, 255))
    end = 1.6 + 0.55 * len(s["items"][:6]) + 0.3
    if t > end + 0.8:
        text_block(im, s.get("banter", "Cheaper than a year of lost balls."), 1700, 44, pal["ink"], alpha=ease_out((t - end - 0.8) / 0.4), max_lines=2)
    if t > end + 2.2:
        footer(im, pal, ease_out((t - end - 2.2) / 0.4))
    return im, shake(t, end)


STYLES = {"reveal": (style_reveal, 9.5), "guess": (style_guess, 9.5), "countdown": (style_countdown, 10.5),
          "stat": (style_stat, 9.0), "pov": (style_pov, 9.0), "expectation": (style_expectation, 9.5),
          "receipt": (style_receipt, 10.5)}


def render(style, script, palette, out_path, img=None, photo=None, imgs=None):
    """Write the mp4 and return a still (the payoff frame) for the feed card."""
    fn, dur = STYLES[style]
    pal = PALETTES[palette]
    frames = int(dur * FPS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out_path)]
    still = None
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    try:
        for i in range(frames):
            t = i / FPS
            arg = imgs if style == "countdown" else img
            im, dx = fn(t, script, pal, arg, photo)
            frame = im.convert("RGB")
            if dx:
                frame = ImageOps.expand(frame, border=20, fill=pal["bg"]).crop((20 - dx, 20, 20 - dx + W, 20 + H))
            proc.stdin.write(frame.tobytes())
            if abs(t - (dur - 1.0)) < 0.5 / FPS:
                still = frame.copy()
    finally:
        proc.stdin.close()
        proc.wait(timeout=180)
    return still


def _edge_busy(im, y):
    """How much text or graphics a horizontal line at y cuts through (0 = clean background)."""
    row = im.crop((0, max(0, y - 2), im.width, min(im.height, y + 2))).convert("L").resize((270, 1))
    px = list(row.getdata())
    med = sorted(px)[len(px) // 2]
    return sum(1 for v in px if abs(v - med) > 60)


def feed_card(still, path):
    """Instagram feed card (1080x1350) from the payoff frame. Never cuts through text: it finds the band
    of the frame that holds text and graphics; if that fits in 1350 pixels it crops around it, otherwise
    it shows the whole band, scaled down, on a soft blurred backdrop of the same frame."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if still.size != (W, H):
        card = ImageOps.fit(still, (1080, 1350))
    else:
        busy = [y for y in range(0, H, 10) if _edge_busy(still, y) > 0] or [285, 1635]
        top, bot = max(0, busy[0] - 40), min(H, busy[-1] + 50)
        if bot - top <= 1350:
            y0 = max(0, min(H - 1350, (top + bot) // 2 - 675))
            card = still.crop((0, y0, W, y0 + 1350))
        else:
            band = still.crop((0, top, W, bot))
            fw = int(W * 1350 / (bot - top))
            from PIL import ImageStat
            edge = ImageStat.Stat(band.crop((0, 0, 24, band.height))).mean[:3]
            back = Image.new("RGB", (1080, 1350), tuple(int(v) for v in edge))  # calm, flat side margins
            back.paste(band.resize((fw, 1350), Image.LANCZOS), ((1080 - fw) // 2, 0))
            card = back
    card.convert("RGB").save(path, "JPEG", quality=93, optimize=True, progressive=True, subsampling=0)
    return card


def card_cuts_text(card_path):
    from PIL import Image as _I
    with _I.open(card_path) as c:
        c = c.convert("RGB")
        return _edge_busy(c, 1) + _edge_busy(c, c.height - 2) > 0


# ---------------- premium quality gate ----------------
# John (19 Nov 2026): every post, video and graphic must be premium quality.
# qc() checks each finished video and card; any problem holds the post (it
# won't auto-post) and is listed on the content pack page.
MIN_PHOTO = 600      # shortest side of a product photo, in pixels, before it looks soft at 1080 wide
MIN_CONTRAST = 3.0   # WCAG large-text contrast for every text colour on its background


def _lum(c):
    def ch(x):
        x /= 255
        return x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4
    r, g, b = c[:3]
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def contrast(a, b):
    la, lb = _lum(a), _lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def qc(style, palette, out_path, still, img=None, imgs=None, card=None):
    """Premium-quality checks. Returns a list of plain problems (empty = good to go)."""
    import json as _json
    probs = []
    pal = PALETTES[palette]
    for k in ("ink", "soft", "accent", "pop"):
        if contrast(pal[k], pal["bg"]) < MIN_CONTRAST:
            probs.append(f"{palette} palette: {k} text is hard to read ({contrast(pal[k], pal['bg']):.1f}:1)")
    for im in [img] + list(imgs or []):
        if im is not None and min(im.size) < MIN_PHOTO:
            probs.append(f"product photo is only {im.size[0]}x{im.size[1]}: it would look soft")
            break
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                            "stream=width,height,r_frame_rate:format=duration,size", "-of", "json", str(out_path)],
                           capture_output=True, text=True, timeout=60)
        info = _json.loads(r.stdout or "{}")
        st = (info.get("streams") or [{}])[0]
        fmt = info.get("format") or {}
        if (st.get("width"), st.get("height")) != (W, H):
            probs.append(f"video is {st.get('width')}x{st.get('height')}, not {W}x{H}")
        num, _, den = str(st.get("r_frame_rate", "0/1")).partition("/")
        if abs(float(num or 0) / float(den or 1) - FPS) > 0.5:
            probs.append(f"video frame rate is {st.get('r_frame_rate')}, not {FPS}")
        dur = float(fmt.get("duration") or 0)
        if abs(dur - STYLES[style][1]) > 0.6:
            probs.append(f"video is {dur:.1f}s, expected {STYLES[style][1]}s")
        if int(fmt.get("size") or 0) < 250_000:
            probs.append("video file is suspiciously small (blank or broken frames?)")
    except Exception as e:
        probs.append(f"couldn't check the video ({e})")
    if still is not None:
        from PIL import ImageStat
        sd = ImageStat.Stat(still.convert("L")).stddev[0]
        if sd < 12:
            probs.append("payoff frame is nearly blank")
    if card is not None and card.exists():
        from PIL import Image as _I
        with _I.open(card) as c:
            if c.size != (1080, 1350):
                probs.append(f"feed card is {c.size[0]}x{c.size[1]}, not 1080x1350")
        if card_cuts_text(card):
            probs.append("feed card cuts through text or graphics at its edge")
    return probs
