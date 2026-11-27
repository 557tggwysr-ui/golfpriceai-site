"""Black Friday 2026 hero film: "Black Friday, honestly." (one-off, 27 Nov 2026)

Renders social-videos/2026-11-27-hero.mp4 (1080x1920, ~19s, cut on a 0.6s beat), its cover
(social/thumbs/2026-11-27-hero.jpg) and feed card (social/cards/2026-11-27-hero.jpg).
Every number comes from data/models.json at render time, so the claims are checkable:
  - prices we have tracked since early September (history starting on or before 4 Sept)
  - how many are within 1% of their 4 Sept price ("the same as in September")
  - how many are 20%+ cheaper than on 4 Sept
  - five picks, each at its lowest tracked price today (men's, right-handed listings checked by hand)
No product photos (retailer images can't be fetched from a Claude session): a type-led film on black.
Run: python scripts/hero_bf2026.py
"""
import json, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
import agent_brush as BR
import agent_audio as AU

ROOT = Path(__file__).resolve().parent.parent
PID = "2026-11-27-hero"
W, H, FPS = 1080, 1920, 30
BEAT = AU.BEAT  # 0.6s
INK = (10, 12, 10)
GRN = (63, 174, 41)
YEL = BR.YELLOW
WHT = BR.WHITE
SOFT = (170, 184, 172)
SHAFTS = ("True Temper", "Fujikura", "Aldila", "Project X", "Mitsubishi", "KBS", "UST Mamiya", "Graphite Design", "Nippon", "Dynamic Gold")
PICKS = [  # (model name in models.json, label, category); order: smallest saving first, biggest last
    ("Garmin Approach S44 GPS Watch", "Garmin Approach S44", "GPS watch"),
    ("Wilson DYNAPWR Irons", "Wilson DYNAPWR Irons 5-PW", "Iron set"),
    ("Ogio Shadow Stand Bag Golf Bag", "Ogio Shadow Stand Bag", "Stand bag"),
    ("Mizuno Pro Fli-Hi Utility Irons", "Mizuno Pro Fli-Hi Utility Iron", "Utility iron"),
    ("Cobra KING Tec Hybrid", "Cobra KING Tec Hybrid", "Hybrid"),
]


def facts():
    models = json.load(open(ROOT / "data" / "models.json"))["models"]
    tot = same = d20 = 0
    for x in models:
        h = x.get("history") or []
        if not x.get("gate", {}).get("passes") or len(h) < 2 or h[0][0] > "2026-09-04":
            continue
        if "shaft" in x["name"].lower() or x.get("brand") in SHAFTS:
            continue
        sept = [p for d, p in h if d <= "2026-09-04"][-1]
        cur = x["minPrice"]
        tot += 1
        same += abs(cur - sept) <= sept * 0.01
        d20 += cur <= sept * 0.8
    by = {x["name"]: x for x in models}
    items = []
    for name, label, cat in PICKS:
        x = by[name]
        sept = [p for d, p in x["history"] if d <= "2026-09-04"][-1]
        assert x["minPrice"] <= x["low"] + 0.01, f"{name} is no longer at its lowest tracked price"
        assert x["history"][0][0] <= "2026-09-04", f"{name}: under 12 weeks of tracking"
        items.append({"label": label, "cat": cat, "now": x["minPrice"], "sept": sept, "less": sept - x["minPrice"], "slug": x["slug"]})
    items.sort(key=lambda i: i["less"] / i["sept"])
    return {"tracked": tot, "same": same, "pct_same": round(same / tot * 100), "d20": d20, "items": items}


def money(v):
    return f"£{v:,.2f}" if v % 1 else f"£{v:,.0f}"


def base(t, glow=GRN):
    im = Image.new("RGBA", (W, H), INK + (255,))
    g = Image.new("L", (W, H), 0)
    ImageDraw.Draw(g).ellipse([-300, 300, W + 300, 1500], fill=70)
    col = Image.new("RGBA", (W, H), glow + (0,))
    col.putalpha(g.filter(ImageFilter.GaussianBlur(180)))
    im.alpha_composite(col)
    return im


def text(im, s, cy, size, minimum=60, lines=3, base_col=WHT, hi=YEL, k=1.0, kind="head", stroke=0, upper=True, width=W - 140):
    """Centred text block around cy, popping in as k goes 0 -> 1."""
    if k <= 0:
        return cy
    f, ls, sz = BR.fit(s, width, size, minimum, lines, kind=kind, upper=upper)
    total = sz * 1.0 * len(ls)
    layer = Image.new("RGBA", (W, int(total + 60)), (0, 0, 0, 0))
    BR.draw_words(ImageDraw.Draw(layer), ls, f, sz, W / 2, 20, base=base_col, hi=hi, lh=1.0, stroke=stroke, stroke_fill=INK)
    sc = 0.82 + 0.18 * BR.pop(min(1, k))
    if abs(sc - 1) > 0.003:
        layer = layer.resize((max(1, int(W * sc)), max(1, int(layer.height * sc))), Image.BICUBIC)
    if k < 1:
        layer.putalpha(layer.getchannel("A").point(lambda v: int(v * min(1, k * 2.5))))
    im.alpha_composite(layer, (int((W - layer.width) / 2), int(cy - layer.height / 2)))
    return cy + layer.height / 2


def pill(im, s, cy, fill=GRN, ink=WHT, size=40, k=1.0):
    if k <= 0:
        return
    f = BR.font(size, "head")
    tw = f.getlength(s)
    w, h = int(tw + 70), int(size * 1.7)
    lay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(lay)
    d.rounded_rectangle([0, 0, w - 1, h - 1], h // 2, fill=fill + (255,))
    d.text((35, (h - size) / 2 - size * 0.12), s, font=f, fill=ink + (255,))
    sc = 0.8 + 0.2 * BR.pop(min(1, k))
    lay = lay.resize((int(w * sc), int(h * sc)), Image.BICUBIC)
    im.alpha_composite(lay, (int((W - lay.width) / 2), int(cy - lay.height / 2)))


def frame(t, F):
    b = int(t / BEAT + 1e-6)  # beat number: every scene change lands on one
    if b < 4:  # HOOK, big from frame one
        im = base(t)
        text(im, "*HALF*", 640, 330, k=min(1, 0.55 + t / 0.25), stroke=0)
        text(im, "of golf prices are the *same* as in September.", 1040, 96, lines=3, k=min(1, (t - 0.15) / 0.25))
        if b >= 2:
            text(im, f"{F['same']:,} of the {F['tracked']:,} we track", 1420, 46, kind="body", upper=False, base_col=SOFT, k=(t - 2 * BEAT) / 0.25, lines=1)
        return im
    if b < 8:  # the side-eye
        im = BR.cover(BR.load_photo(str(ROOT / "assets/social/library/meme-steve-sideeye.jpg")), W, H, zoom=1.04 + 0.02 * (t - 2.4)).convert("RGBA")
        BR.scrim(im, top=0.25, bottom=0.7)
        BR.banner(im, "Black Friday, *honestly.*", W / 2, 1480, W - 160, colour=BR.GREEN, size=104, t=(t - 4 * BEAT) / 0.3, seed="bf-h")
        return im
    if b < 12:  # the numbers
        im = base(t)
        text(im, f"We track *{F['tracked']:,}* golf prices.", 620, 110, lines=3, k=(t - 8 * BEAT) / 0.25)
        if b >= 10:
            text(im, f"*{F['d20']}* are genuinely *20%+ cheaper* than in early September.", 1080, 96, lines=4, k=(t - 10 * BEAT) / 0.25)
        if b >= 11:
            pill(im, "HERE ARE 5", 1460, fill=YEL, ink=INK, size=54, k=(t - 11 * BEAT) / 0.25)
        return im
    if b < 27:  # five picks, three beats each, the biggest saving last
        i = (b - 12) // 3
        it = F["items"][i]
        t0 = (12 + i * 3) * BEAT
        u = t - t0
        im = base(t, glow=(40, 120, 30) if i < 4 else (150, 120, 0))
        pill(im, f"#{5 - i}  ·  {it['cat'].upper()}", 430, fill=(30, 40, 32), ink=SOFT, size=38, k=u / 0.2)
        text(im, it["label"], 640, 104, minimum=70, lines=2, k=u / 0.2)
        text(im, money(it["now"]), 960, 260, minimum=160, lines=1, base_col=YEL, k=(u - 0.15) / 0.2)
        if b - 12 - i * 3 >= 1:  # second beat of the pick
            pill(im, "LOWEST WE'VE TRACKED", 1220, size=46, k=(u - BEAT) / 0.2)
            text(im, "Lowest in 12 weeks of tracking", 1380, 50, kind="body", upper=False, base_col=WHT, lines=1, k=(u - BEAT) / 0.25)
        text(im, "Today's lowest price across multiple UK retailers", 1720, 34, kind="body", upper=False, base_col=SOFT, lines=1, k=u / 0.3)
        return im
    im = base(t)  # end card
    u = t - 27 * BEAT
    text(im, "Check the *real* price before you buy.", 760, 112, lines=3, k=u / 0.25)
    text(im, "golfpriceai.com", 1120, 76, kind="body", upper=False, base_col=YEL, lines=1, k=(u - BEAT) / 0.25)
    text(im, "Full Swing. Not full price.", 1260, 52, kind="body", upper=False, base_col=SOFT, lines=1, k=(u - 2 * BEAT) / 0.25)
    return im


DUR = 32 * BEAT  # 19.2s


def soundtrack(out_wav):
    import numpy as np
    SR = AU.SR
    N = int(DUR * SR)
    music, fx = np.zeros(N + 2 * SR), np.zeros(N + 2 * SR)

    def add(buf, s, at, gain=1.0):
        if s is None or at < 0:
            return
        i = int(at * SR); s = s[:len(buf) - i]; buf[i:i + len(s)] += s * gain

    AU.band(music, DUR, ("funk", 1.0), add)
    add(fx, AU.rimshot(), 4 * BEAT + 0.35, 0.8)     # the side-eye
    add(fx, AU.tada(), 10 * BEAT + 0.05, 0.6)       # 156 genuinely cheaper
    add(fx, AU.thwack(big=True), 24 * BEAT + 0.15, 0.8)  # #1 lands
    add(fx, AU.chime(), 27 * BEAT + 0.1, 0.7)       # end card
    x = (music * .45 + fx)[:N]
    fade = int(.6 * SR); x[-fade:] *= np.linspace(1, 0, fade)
    x = x / (np.max(np.abs(x)) or 1) * .85
    with wave.open(str(out_wav), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def cover(F):
    im = base(0)
    text(im, "*HALF*", 600, 360)
    text(im, "of golf prices are the *same* as in September", 1000, 96, lines=3)
    pill(im, "#BLACKFRIDAY, HONESTLY", 1380, fill=GRN, size=50)
    return im.convert("RGB")


def main():
    F = facts()
    print(json.dumps({k: v for k, v in F.items() if k != "items"}), [(i["label"], i["now"], i["sept"]) for i in F["items"]])
    out = ROOT / "social-videos" / f"{PID}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)
    silent = out.with_suffix(".silent.mp4")
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(silent)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(int(DUR * FPS)):
        p.stdin.write(frame(n / FPS, F).convert("RGB").tobytes())
    p.stdin.close(); p.wait()
    wav = out.with_suffix(".wav")
    soundtrack(wav)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(silent), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                    "-shortest", "-movflags", "+faststart", str(out)], check=True)
    silent.unlink(); wav.unlink()
    c = cover(F)
    (ROOT / "social" / "thumbs").mkdir(parents=True, exist_ok=True)
    c.save(ROOT / "social" / "thumbs" / f"{PID}.jpg", quality=90)
    c.crop((0, 285, 1080, 1635)).save(ROOT / "social" / "cards" / f"{PID}.jpg", quality=90)
    json.dump(F, open(ROOT / "social-videos" / f"{PID}.facts.json", "w"), indent=1)
    print("wrote", out)


if __name__ == "__main__":
    main()
