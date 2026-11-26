"""His & Hers: comic-panel episodes with a hushed golf-commentator voiceover (John, 24-26 Nov 2026).

Him, her, and his kit habit. Golf commentary over everyday home life; she always gets the last word.
Panels are John's ChatGPT illustrations (assets/social/heist/, listed in data/heist-panels.json);
the scripts live in data/heist-episodes.json. Portrait panels fill the screen; landscape and square
ones sit framed on a comic page. Narration boxes and speech bubbles are drawn here (never baked in).

Voice: Piper (free, open-source, runs on GitHub's machines). Voice models are .onnx files in
$HEIST_VOICES (the workflow downloads them). With no voice it still renders: the boxes tell the story.
Music: an original sneaky heist theme (synthesised, nothing borrowed), ducked under the voice.

    python scripts/agent_heist.py --ep 3 --voice en_GB-alan-medium --out out/heist-ep03.mp4
"""
import argparse
import json
import math
import os
import subprocess
import tempfile
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
W, H, FPS = 1080, 1920, 30
BEAT = 0.6  # every cut lands on a beat (100 bpm, like the rest of the engine)
FONTS = ROOT / "assets" / "fonts"
PAGE = (14, 20, 38)
INK = (18, 18, 22)
CREAM = (248, 234, 178)
GOLD = (244, 196, 60)
GREEN = (110, 200, 90)
SITE = "golfpriceai.com"


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def ease_out(t):
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t):
    t = max(0.0, min(1.0, t))
    c = 1.7
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def wrap(d, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        test = (cur + " " + w).strip()
        if d.textlength(test, font=f) <= maxw or not cur:
            cur = test
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


# ---------------------------------------------------------------- voice
_VOICES = {}


def say(text, voice, out_wav):
    """Narration to a wav; returns its length in seconds, or None (no voice model / piper missing)."""
    if not voice:
        return None
    model = Path(os.environ.get("HEIST_VOICES", ROOT / ".voices")) / f"{voice}.onnx"
    if not model.exists():
        print("no voice model:", model)
        return None
    try:
        from piper import PiperVoice, SynthesisConfig
        v = _VOICES.get(voice) or PiperVoice.load(str(model))
        _VOICES[voice] = v
        cfg = SynthesisConfig(length_scale=1.12, noise_scale=0.55, noise_w_scale=0.7)  # unhurried, like a commentator on the 18th
        with wave.open(str(out_wav), "wb") as w:
            v.synthesize_wav(text, w, syn_config=cfg)
        with wave.open(str(out_wav)) as w:
            return w.getnframes() / w.getframerate()
    except Exception as e:
        print("voice failed, carrying on without it:", e)
        return None


# ---------------------------------------------------------------- timeline
def snap(t):
    return math.ceil(t / BEAT - 1e-6) * BEAT


def plan(ep, voice, tmp):
    """[(kind, start, end, data)] with every cut on a beat."""
    segs, t, voices = [], 0.0, []
    segs.append(("intro", 0.0, 1.5, None))
    t = 1.5
    for i, p in enumerate(ep["panels"]):
        narr = p.get("narr", "")
        vd = say(narr, voice, tmp / f"n{i}.wav") if narr else None
        if vd:
            voices.append((t + 0.25, tmp / f"n{i}.wav"))
            n_end = t + 0.25 + vd + 0.25
        else:
            n_end = t + max(1.6, 0.05 * len(narr) + 0.6)
        bubbles, bt = [], (n_end - 0.2 if vd else t + 0.8 * (n_end - t))
        for b in p.get("say", []):
            bubbles.append((bt, b))
            bt += max(1.3, 0.05 * len(b["text"]) + 0.7)
        end = snap(max(n_end, bt) + 0.2)
        segs.append(("panel", t, end, {"i": i, "p": p, "bubbles": bubbles}))
        t = end
    segs.append(("outro", t, t + 3.0, None))
    return segs, t + 3.0, voices


# ---------------------------------------------------------------- drawing
_IMG = {}


def panel_img(path):
    if path not in _IMG:
        _IMG[path] = Image.open(ROOT / path).convert("RGB")
    return _IMG[path]


def page_bg():
    if "page" not in _IMG:
        im = Image.new("RGB", (W, H), PAGE)
        d = ImageDraw.Draw(im)
        for y in range(0, H, 22):  # a faint halftone, like printed comic paper
            for x in range((y // 22) % 2 * 11, W, 22):
                d.ellipse((x - 2, y - 2, x + 2, y + 2), fill=(24, 32, 58))
        _IMG["page"] = im
    return _IMG["page"].copy()


def cover(img, z, fx=0.5, fy=0.5):
    """Fill the 9:16 frame, zoomed by z, keeping (fx, fy) of the picture in view."""
    s = max(W / img.width, H / img.height) * z
    w, h = int(img.width * s), int(img.height * s)
    big = img.resize((w, h), Image.LANCZOS)
    x = int(min(max(fx * w - W / 2, 0), w - W))
    y = int(min(max(fy * h - H / 2, 0), h - H))
    return big.crop((x, y, x + W, y + H)), (lambda px, py: (px * w - x, py * h - y))


def framed(img, z, box_w, top=None):
    """A landscape or square panel framed on the page; returns (page, mapper, panel box)."""
    page = page_bg()
    pw = box_w
    ph = int(pw * img.height / img.width)
    ph = min(ph, 1150)
    pw = int(ph * img.width / img.height) if ph == 1150 else pw
    s = z
    inner = img.resize((int(pw * s), int(ph * s)), Image.LANCZOS)
    ox, oy = (inner.width - pw) // 2, (inner.height - ph) // 2
    inner = inner.crop((ox, oy, ox + pw, oy + ph))
    x0, y0 = (W - pw) // 2, top if top is not None else (330 if ph > 900 else 470)
    sh = Image.new("RGBA", (pw + 60, ph + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 30, pw + 30, ph + 30), fill=(0, 0, 0, 160))
    page.paste(sh.filter(ImageFilter.GaussianBlur(14)), (x0 - 18, y0 - 12), sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(page)
    d.rectangle((x0 - 12, y0 - 12, x0 + pw + 12, y0 + ph + 12), fill=(250, 248, 240))
    d.rectangle((x0 - 12, y0 - 12, x0 + pw + 12, y0 + ph + 12), outline=INK, width=5)
    page.paste(inner, (x0, y0))
    d.rectangle((x0, y0, x0 + pw, y0 + ph), outline=INK, width=4)
    return page, (lambda px, py: (x0 + px * pw, y0 + py * ph)), (x0, y0, x0 + pw, y0 + ph)


def draw_panel(page, img, z, x0, y0, pw, ph, dim=0.0):
    """One framed panel at (x0, y0, pw, ph), its picture pushed in by z; returns the picture mapper."""
    s = max(pw / img.width, ph / img.height) * z
    inner = img.resize((int(img.width * s), int(img.height * s)), Image.LANCZOS)
    ox, oy = (inner.width - pw) // 2, (inner.height - ph) // 2
    inner = inner.crop((ox, oy, ox + pw, oy + ph))
    if dim:
        inner = Image.blend(inner, Image.new("RGB", inner.size, PAGE), dim)
    sh = Image.new("RGBA", (pw + 60, ph + 60), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rectangle((30, 30, pw + 30, ph + 30), fill=(0, 0, 0, 160))
    sh = sh.filter(ImageFilter.GaussianBlur(14))
    page.paste(sh, (x0 - 18, y0 - 12), sh)
    d = ImageDraw.Draw(page)
    d.rectangle((x0 - 12, y0 - 12, x0 + pw + 12, y0 + ph + 12), fill=(250, 248, 240), outline=INK, width=5)
    page.paste(inner, (x0, y0))
    d.rectangle((x0, y0, x0 + pw, y0 + ph), outline=INK, width=4)
    return lambda px, py: (x0 - ox + px * img.width * s, y0 - oy + py * img.height * s)


def caption(im, text, x0, y_bottom, a, right=None):
    """A comic caption box tucked over a panel's bottom-left corner (the commentator's line)."""
    if not text or a <= 0:
        return
    d = ImageDraw.Draw(im)
    f = font("Poppins-Bold.ttf", 44)
    lines = wrap(d, text, f, 760)
    lh = 56
    bw = int(max(d.textlength(l, font=f) for l in lines)) + 56
    bh = lh * len(lines) + 34
    x0 = (right - bw + 20) if right else x0 - 20
    y0 = y_bottom - bh + 30 + int((1 - ease_out(a)) * 30)
    alpha = int(255 * ease_out(a))
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.rectangle((x0 + 9, y0 + 9, x0 + bw + 9, y0 + bh + 9), fill=(0, 0, 0, int(alpha * 0.55)))
    ld.rectangle((x0, y0, x0 + bw, y0 + bh), fill=CREAM + (alpha,), outline=INK + (alpha,), width=5)
    for k, l in enumerate(lines):
        ld.text((x0 + 28, y0 + 15 + k * lh), l, font=f, fill=INK + (alpha,))
    im.paste(layer, (0, 0), layer)


def narration(im, text, where, a):
    """The cream caption box of a comic, the commentator's line."""
    if not text or a <= 0:
        return
    d = ImageDraw.Draw(im)
    f = font("Poppins-Bold.ttf", 46)
    lines = wrap(d, text, f, 860)
    lh = 60
    bw = int(max(d.textlength(l, font=f) for l in lines)) + 60
    bh = lh * len(lines) + 40
    x0 = 50
    y0 = where - bh // 2 if isinstance(where, int) else (130 if where == "top" else H - bh - 230)
    y0 += int((1 - ease_out(a)) * -30)
    layer = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    alpha = int(255 * ease_out(a))
    ld.rectangle((x0 + 10, y0 + 10, x0 + bw + 10, y0 + bh + 10), fill=(0, 0, 0, int(alpha * 0.55)))
    ld.rectangle((x0, y0, x0 + bw, y0 + bh), fill=CREAM + (alpha,), outline=INK + (alpha,), width=5)
    for k, l in enumerate(lines):
        ld.text((x0 + 30, y0 + 18 + k * lh), l, font=f, fill=INK + (alpha,))
    im.paste(layer, (0, 0), layer)


def bubble(im, text, box, target, a):
    """A speech bubble: box centre (bx, by) in frame pixels, tail pointing at target (the speaker's mouth)."""
    if a <= 0:
        return
    k = ease_back(min(1.0, a * 1.0))
    d = ImageDraw.Draw(im)
    f = font("LuckiestGuy-Regular.ttf", 50)
    lines = wrap(d, text.upper(), f, 560)
    lh = 58
    bw = int(max(d.textlength(l, font=f) for l in lines)) + 80
    bh = lh * len(lines) + 46
    bx, by = box
    bx = min(max(bx, bw / 2 + 30), W - bw / 2 - 30)
    by = min(max(by, bh / 2 + 60), H - bh / 2 - 60)
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    x0, y0, x1, y1 = bx - bw / 2, by - bh / 2, bx + bw / 2, by + bh / 2
    tx, ty = target
    # the tail: from the bubble edge towards the speaker, stopping short of them
    ex = min(max(tx, x0 + 50), x1 - 50)
    ey = y1 if ty > by else y0
    dist = math.hypot(tx - ex, ty - ey) or 1
    reach = min(150, dist * 0.6)
    px, py = ex + (tx - ex) / dist * reach, ey + (ty - ey) / dist * reach
    tail = [(ex - 28, ey), (ex + 28, ey), (px, py)]
    ld.polygon(tail, fill=(255, 255, 255, 255), outline=INK + (255,))
    ld.line([tail[0], tail[2], tail[1]], fill=INK + (255,), width=6)
    ld.rounded_rectangle((x0, y0, x1, y1), radius=min(60, bh // 2), fill=(255, 255, 255, 255), outline=INK + (255,), width=6)
    ld.line([(ex - 24, ey), (ex + 24, ey)], fill=(255, 255, 255, 255), width=8)  # open the tail into the bubble
    for i, l in enumerate(lines):
        lw = ld.textlength(l, font=f)
        ld.text((bx - lw / 2, y0 + 24 + i * lh), l, font=f, fill=INK + (255,))
    if k != 1:
        s = max(0.05, k)
        lw_, lh_ = int(W * s), int(H * s)
        small = layer.resize((lw_, lh_), Image.LANCZOS)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        layer.paste(small, (int(bx - bx * s), int(by - by * s)))
    im.paste(layer, (0, 0), layer)


def outline_text(d, xy, text, f, fill, stroke=6):
    d.text(xy, text, font=f, fill=fill, stroke_width=stroke, stroke_fill=INK)


def centre(d, y, text, f, fill, stroke=0):
    w = d.textlength(text, font=f)
    outline_text(d, ((W - w) / 2, y), text, f, fill, stroke) if stroke else d.text(((W - w) / 2, y), text, font=f, fill=fill)


def title_card(ep, t, first):
    im, _ = cover(first, 1.08)
    im = Image.blend(im, Image.new("RGB", (W, H), (8, 10, 22)), 0.62)
    d = ImageDraw.Draw(im)
    a = ease_back(t / 0.5)
    f = font("LuckiestGuy-Regular.ttf", int(150 * max(0.3, a)))
    centre(d, 700, "HIS &", f, GOLD, 8)
    centre(d, 860, "HERS", f, GOLD, 8)
    if t > 0.5:
        centre(d, 1060, f"EPISODE {ep['ep']}", font("Poppins-Bold.ttf", 44), (255, 255, 255))
        centre(d, 1120, ep["title"].upper(), font("LuckiestGuy-Regular.ttf", 66), (255, 255, 255), 5)
    return im


def end_card(ep, t):
    im = page_bg()
    d = ImageDraw.Draw(im)
    e = ep["end"]
    y = 560
    for i, line in enumerate(e["lines"]):
        if t > 0.2 + i * 0.5:
            f = font("Poppins-Bold.ttf", 58)
            for l in wrap(d, line, f, 900):
                centre(d, y, l, f, (255, 255, 255))
                y += 74
            y += 30
    if t > 1.3:
        a = ease_back((t - 1.3) / 0.5)
        fb = font("Anton-Regular.ttf", int(118 * max(0.3, a)))
        w1 = d.textlength("Golf", font=fb)
        w2 = d.textlength("Price", font=fb)
        w3 = d.textlength(" AI", font=fb)
        x = (W - w1 - w2 - w3) / 2
        d.text((x, 1180), "Golf", font=fb, fill=(255, 255, 255))
        d.text((x + w1, 1180), "Price", font=fb, fill=GREEN)
        d.text((x + w1 + w2, 1180), " AI", font=fb, fill=(255, 255, 255))
        centre(d, 1350, "Full Swing. Not full price.", font("Poppins-Bold.ttf", 46), GREEN)
        centre(d, 1430, SITE + e.get("path", ""), font("Poppins-Bold.ttf", 40), (220, 225, 240))
    return im


def frame_at(ep, segs, t):
    for kind, a, b, data in segs:
        if a <= t < b or (kind == "outro" and t >= a):
            break
    if kind == "intro":
        return title_card(ep, t - a, panel_img(ep["panels"][0]["img"]))
    if kind == "outro":
        return end_card(ep, t - a)
    p, lt, dur = data["p"], t - a, b - a
    img = panel_img(p["img"])
    landscape = img.width > img.height * 1.2
    if landscape:  # a comic page of two panels: the new one pops in under the last
        i = data["i"]
        top_i = i - (i % 2)
        im = page_bg()
        d = ImageDraw.Draw(im)
        d.text((50, 110), f"HIS & HERS  ·  {ep['title'].upper()}", font=font("LuckiestGuy-Regular.ttf", 46), fill=GOLD)
        pw = 1000
        ph = int(pw * img.height / img.width)
        slots = [(40, 240), (40, 240 + ph + 80)]
        z = 1.0 + 0.04 * (lt / dur)
        pop = 1.0 + 0.04 * (1 - ease_out(lt / 0.25))
        if i % 2 == 1:  # the panel above stays, a touch dimmed
            draw_panel(im, panel_img(ep["panels"][top_i]["img"]), 1.04, *slots[0], pw, ph, dim=0.25)
        x0, y0 = slots[i % 2]
        mp = draw_panel(im, img, z * pop, x0, y0, pw, ph)
        caption(im, p.get("narr"), x0, y0 + ph, lt / 0.3, right=(x0 + pw) if p.get("cap_right") else None)
        shown = [(bt, b) for bt, b in data["bubbles"] if t >= bt]
        last_swap = max([k for k, (bt, b) in enumerate(shown) if b.get("replace")] or [0])
        for bt, bdef in shown[last_swap:]:  # a "replace" bubble takes the previous one's place
            bubble(im, bdef["text"], mp(*bdef["box"]), mp(*bdef["to"]), (t - bt) / 0.3)
        return im
    z = 1.0 + 0.05 * (lt / dur)  # the slow push-in
    pop = 1.0 + 0.04 * (1 - ease_out(lt / 0.25))  # each cut lands with a little punch
    portrait = img.height > img.width * 1.2
    if portrait:
        im, mp = cover(img, z * pop, *p.get("focus", (0.5, 0.45)))
        where = p.get("narr_at", "top")
    else:
        im, mp, box = framed(img, z * pop, 1010)
        where = box[3] + 120 if p.get("narr_at", "below") == "below" else box[1] - 120
        d = ImageDraw.Draw(im)
        d.text((50, 120 if box[1] > 400 else 60), f"HIS & HERS  ·  {ep['title'].upper()}", font=font("LuckiestGuy-Regular.ttf", 44), fill=GOLD)
    narration(im, p.get("narr"), where, lt / 0.3)
    for bt, bdef in data["bubbles"]:
        if t >= bt:
            bx, by = mp(*bdef["box"])
            tx, ty = mp(*bdef["to"])
            bubble(im, bdef["text"], (bx, by), (tx, ty), (t - bt) / 0.3)
    return im


# ---------------------------------------------------------------- sound
def heist_music(dur, segs, voices, out_wav):
    """A sneaky heist theme in A minor: walking bass, brushed hats, finger-snaps, a vibes stab;
    ducked under the commentator, a 'dun-dun' sting where a panel asks for it, a chime at the end."""
    import numpy as np
    import agent_audio as A
    SR = A.SR
    N = int((dur + 1) * SR)
    music, fx, vox = np.zeros(N), np.zeros(N), np.zeros(N)

    def add(buf, s, at, gain=1.0):
        if s is None or at < 0:
            return
        i = int(at * SR)
        s = s[:len(buf) - i]
        buf[i:i + len(s)] += s * gain

    walk = [110, 131, 147, 165, 110, 131, 165, 156]  # A C D E A C E Eb (a sly chromatic turn)
    chords = [(220, 262, 330), (147 * 2, 175 * 2, 220 * 2), (165 * 2, 208 * 2, 247 * 2), (220, 262, 330)]
    k = 0
    while k * BEAT < dur:
        at = k * BEAT
        add(music, A._tone(walk[k % 8] / 2, BEAT * 0.9, (1, .35, .12), .004, .25, .55), at)
        add(music, A.hat() * .45, at + BEAT / 2)
        if k % 2:
            add(music, A._clap() * .35, at)  # snaps on 2 and 4
        if k % 4 == 0:
            for j, fq in enumerate(chords[(k // 4) % 4]):
                add(music, A._tone(fq * 2, 1.2, (1, .5, .1), .002, .6, .07), at + .02 * j)  # vibes
        k += 1
    for kind, a, b, data in segs:
        if kind == "panel" and data["p"].get("sting"):
            add(fx, A._tone(98, .35, (1, .5, .3), .003, .2, .5), a + .05)
            add(fx, A._tone(92.5, .7, (1, .5, .3), .003, .5, .55), a + .45)
        if kind == "outro":
            add(fx, A.chime(), a + .15, .8)
    duck = np.ones(N)
    for at, path in voices:
        with wave.open(str(path)) as w:
            sr = w.getframerate()
            x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
        if sr != SR:
            x = np.interp(np.linspace(0, len(x) - 1, int(len(x) * SR / sr)), np.arange(len(x)), x)
        add(vox, x, at, 1.0)
        i, j, r = int((at - .1) * SR), int((at + len(x) / SR + .15) * SR), int(.12 * SR)
        duck[max(0, i):j] = np.minimum(duck[max(0, i):j], .32)
    duck = np.convolve(duck, np.ones(int(.1 * SR)) / int(.1 * SR), mode="same")  # smooth the dips
    mix = music * duck * .5 + fx + vox * 1.15
    mix = mix[:int(dur * SR)]
    fade = int(.8 * SR)
    mix[-fade:] *= np.linspace(1, 0, fade)
    mix = mix / (np.max(np.abs(mix)) or 1) * .9
    with wave.open(str(out_wav), "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())


# ---------------------------------------------------------------- episode
def render(ep_no, voice, out_path):
    eps = json.loads((ROOT / "data" / "heist-episodes.json").read_text(encoding="utf-8"))["episodes"]
    ep = next(e for e in eps if e["ep"] == ep_no)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        segs, dur, voices = plan(ep, voice, tmp)
        silent = tmp / "v.mp4"
        cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
               "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", str(silent)]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        still = None
        for i in range(int(dur * FPS)):
            t = i / FPS
            im = frame_at(ep, segs, t)
            proc.stdin.write(im.convert("RGB").tobytes())
            last = [s for s in segs if s[0] == "panel"][-1]
            if still is None and t >= last[2] - 0.4:
                still = im.convert("RGB")
        proc.stdin.close()
        proc.wait(timeout=600)
        wav = tmp / "a.wav"
        try:
            heist_music(dur, segs, voices, wav)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(silent), "-i", str(wav), "-map", "0:v", "-map", "1:a",
                            "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "44100", "-c:a", "aac", "-b:a", "160k",
                            "-shortest", "-movflags", "+faststart", str(out_path)], check=True, timeout=300)
        except Exception as e:  # a silent video beats no video
            print("sound skipped:", e)
            silent.replace(out_path)
    cover_img = thumbnail(ep)
    cover_img.save(out_path.with_suffix(".jpg"), quality=92)
    print(f"EP {ep_no} '{ep['title']}': {dur:.1f}s, voice {voice or 'none'} -> {out_path}")
    return out_path


def thumbnail(ep):
    """The cover: the episode's key panel, HIS & HERS and the episode title, inside the 4:5 grid crop."""
    p = ep["panels"][ep.get("cover_panel", len(ep["panels"]) - 1)]
    img = panel_img(p["img"])
    if img.height > img.width * 1.2:
        im, _ = cover(img, 1.02, *p.get("focus", (0.5, 0.45)))
    else:  # framed under the title, all inside the 4:5 grid crop (y 285 to 1635)
        im, _, _ = framed(img, 1.0, 940 if img.height > img.width * 0.9 else 1010, top=560)
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for y in range(0, 700):
        sd.line([(0, 285 + y - 300), (W, 285 + y - 300)], fill=(8, 10, 22, int(200 * (1 - y / 700))))
    im = im.convert("RGBA")
    im.alpha_composite(shade)
    im = im.convert("RGB")
    d = ImageDraw.Draw(im)
    centre(d, 330, "HIS & HERS", font("LuckiestGuy-Regular.ttf", 120), GOLD, 7)
    centre(d, 470, ep["title"].upper(), font("LuckiestGuy-Regular.ttf", 76), (255, 255, 255), 6)
    return im


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--ep", type=int, required=True)
    ap.add_argument("--voice", default="")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    render(a.ep, a.voice, a.out)
