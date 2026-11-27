"""Sale-day hero film, "<Sale>, honestly." (reusable; first used for Cyber Monday 2026).

Like scripts/hero_bf2026.py, but the picks and the hook are chosen from the data on the day,
so a scheduled Claude session can run it the morning of a sale and open a "merge now" PR.

  python scripts/hero_sale.py --sale "Cyber Monday" --date 2026-11-30 --since 2026-11-27 --slot 12:30

Writes:
  assets/social/launch/<sale-slug>-honestly.mp4   (the film, ~19s, 0.6s beat, original music)
  social/thumbs/<date>-hero.jpg, social/cards/<date>-hero.jpg
  data/agents/content-plan.json                  (adds or replaces the post <date>-hero, with #Ad captions)
  prints the facts used, so the PR can quote them

Honesty rules built in (refuses to render otherwise):
  - every pick is at its lowest tracked price today, with 12+ weeks of history
  - the cheapest listing behind each pick is men's, right-handed and in stock; no shafts
  - no product used in a post in the last 14 days
  - the "since" hook is only used if at least 25 prices fell since that date; otherwise the
    hook is how many prices are at their lowest we've tracked
"""
import argparse, json, re, subprocess, sys, wave
from datetime import date, timedelta
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import agent_brush as BR
import agent_audio as AU
import hero_bf2026 as H  # drawing helpers (base, text, pill, money)

ROOT = Path(__file__).resolve().parent.parent
W, HGT, FPS = 1080, 1920, 30
BEAT = AU.BEAT
SHAFTS = H.SHAFTS + ("Mitsubishi Chemical", "ACCRA", "Accra")
SITE = "https://golfpriceai.com"


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def price_on(h, d):
    pts = [p for dd, p in h if dd <= d]
    return pts[-1] if pts else None


def recent_products(day):
    """Model slugs and names in posts from the last 14 days (the no-repeat rule)."""
    plan = json.load(open(ROOT / "data/agents/content-plan.json"))
    seen = set()
    for p in plan["posts"]:
        if str(day - timedelta(days=14)) <= p["date"] <= str(day):
            seen.add(json.dumps(p, ensure_ascii=False).lower())
    return " ".join(seen)


def facts(day, since):
    models = json.load(open(ROOT / "data/models.json"))["models"]
    P = json.load(open(ROOT / "data/products.json"))
    P = P.get("products", P) if isinstance(P, dict) else P
    byid = {p["id"]: p for p in P}
    start = str(day - timedelta(days=84))
    used = recent_products(day)
    tracked = at_low = fell = 0
    cands = []
    for x in models:
        h = x.get("history") or []
        if not x.get("gate", {}).get("passes") or len(h) < 2 or h[0][0] > start:
            continue
        if "shaft" in x["name"].lower() or x.get("brand") in SHAFTS or x.get("group") not in ("club", "bag", "accessory", "ball"):
            continue
        cur = x["minPrice"]
        tracked += 1
        is_low = cur <= x["low"] + 0.01 and x["low"] < x["high"] - 0.01
        at_low += is_low
        then = price_on(h, since)
        fell += bool(then and cur < then - 0.5)
        if not is_low or cur < 60 or x["slug"] in used or " ".join(x["name"].lower().split()[:3]) in used:
            continue
        ls = sorted([byid[i] for i in x.get("listingIds", []) if i in byid], key=lambda l: l.get("salePrice") or 9e9)
        if not ls:
            continue
        best = ls[0]
        if best.get("audience") not in ("Male", "Unisex", None) or re.search(r"left[- ]hand|ladies|women", best["name"], re.I) or not best.get("inStock", True):
            continue
        ref = price_on(h, start) or h[0][1]
        drop = (ref - cur) / ref
        if drop < 0.2 or len(x.get("retailers", {})) < 2:
            continue
        cands.append({"model": x, "drop": drop, "now": cur, "type": x.get("type"), "brand": x.get("brand")})
    cands.sort(key=lambda c: -c["drop"])
    picks, types, brands = [], set(), set()
    for c in cands:  # one per type, at most two per brand
        if c["type"] in types or list(brands).count(c["brand"]) >= 2:
            continue
        picks.append(c); types.add(c["type"]); brands.add(c["brand"])
        if len(picks) == 5:
            break
    if len(picks) < 5:
        raise SystemExit(f"only {len(picks)} honest picks today: not rendering")
    picks.sort(key=lambda c: c["drop"])  # biggest last
    items = [{"label": short_name(c["model"]["name"]), "cat": (c["type"] or "").replace("-", " "), "now": c["now"], "slug": c["model"]["slug"]} for c in picks]
    return {"tracked": tracked, "at_low": at_low, "fell": fell, "since": since, "items": items}


def short_name(n):
    n = re.sub(r"\s+Golf Bag$", "", n)
    n = re.sub(r"\bIrons Single Iron\b", "Iron", n)
    return n


def long_date(d):
    d = date.fromisoformat(d)
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"


def hook(F, sale):
    if F["fell"] >= 25:
        return ("*" + f"{F['fell']:,}" + "*", f"golf prices are even lower than on {long_date(F['since']).split()[0]}.",
                f"of the {F['tracked']:,} we track, since {long_date(F['since'])}")
    return ("*" + f"{F['at_low']:,}" + "*", "golf prices are at the lowest we've tracked.", f"of the {F['tracked']:,} we track")


def frame(t, F, sale, photo):
    big, line, small = hook(F, sale)
    b = int(t / BEAT + 1e-6)
    if b < 4:
        im = H.base(t)
        H.text(im, big, 640, 300, k=min(1, 0.55 + t / 0.25))
        H.text(im, line, 1040, 96, lines=3, k=min(1, (t - 0.15) / 0.25))
        if b >= 2:
            H.text(im, small, 1420, 46, kind="body", upper=False, base_col=H.SOFT, k=(t - 2 * BEAT) / 0.25, lines=1)
        return im
    if b < 8:
        im = BR.cover(BR.load_photo(str(ROOT / photo)), W, HGT, zoom=1.04 + 0.02 * (t - 2.4)).convert("RGBA")
        BR.scrim(im, top=0.25, bottom=0.7)
        BR.banner(im, f"{sale}, *honestly.*", W / 2, 1480, W - 160, colour=BR.GREEN, size=104, t=(t - 4 * BEAT) / 0.3, seed="sale-h")
        return im
    if b < 12:
        im = H.base(t)
        H.text(im, "No countdown clocks. No made-up *was* prices.", 640, 104, lines=3, k=(t - 8 * BEAT) / 0.25)
        if b >= 10:
            H.text(im, "Just 5 at the *lowest price we've tracked.*", 1080, 96, lines=3, k=(t - 10 * BEAT) / 0.25)
        return im
    if b < 27:
        i = (b - 12) // 3
        it = F["items"][i]
        u = t - (12 + i * 3) * BEAT
        im = H.base(t, glow=(40, 120, 30) if i < 4 else (150, 120, 0))
        H.pill(im, f"#{5 - i}  ·  {it['cat'].upper()}", 430, fill=(30, 40, 32), ink=H.SOFT, size=38, k=u / 0.2)
        H.text(im, it["label"], 640, 104, minimum=70, lines=2, k=u / 0.2)
        H.text(im, H.money(it["now"]), 960, 260, minimum=160, lines=1, base_col=H.YEL, k=(u - 0.15) / 0.2)
        if b - 12 - i * 3 >= 1:
            H.pill(im, "LOWEST WE'VE TRACKED", 1220, size=46, k=(u - BEAT) / 0.2)
            H.text(im, "Lowest in 12 weeks of tracking", 1380, 50, kind="body", upper=False, lines=1, k=(u - BEAT) / 0.25)
        H.text(im, "Today's lowest price across multiple UK retailers", 1720, 34, kind="body", upper=False, base_col=H.SOFT, lines=1, k=u / 0.3)
        return im
    im = H.base(t)
    u = t - 27 * BEAT
    H.text(im, "Check the *real* price before you buy.", 760, 112, lines=3, k=u / 0.25)
    H.text(im, "golfpriceai.com", 1120, 76, kind="body", upper=False, base_col=H.YEL, lines=1, k=(u - BEAT) / 0.25)
    H.text(im, "Full Swing. Not full price.", 1260, 52, kind="body", upper=False, base_col=H.SOFT, lines=1, k=(u - 2 * BEAT) / 0.25)
    return im


def soundtrack(out_wav, groove="chip"):
    import numpy as np
    SR, N = AU.SR, int(H.DUR * AU.SR)
    music, fx = np.zeros(N + 2 * SR), np.zeros(N + 2 * SR)

    def add(buf, s, at, gain=1.0):
        if s is None or at < 0:
            return
        i = int(at * SR); s = s[:len(buf) - i]; buf[i:i + len(s)] += s * gain

    AU.band(music, H.DUR, (groove, 1.0), add)
    add(fx, AU.rimshot(), 4 * BEAT + 0.35, 0.8)
    add(fx, AU.thwack(big=True), 24 * BEAT + 0.15, 0.8)
    add(fx, AU.chime(), 27 * BEAT + 0.1, 0.7)
    x = (music * .45 + fx)[:N]
    fade = int(.6 * SR); x[-fade:] *= np.linspace(1, 0, fade)
    x = x / (np.max(np.abs(x)) or 1) * .85
    with wave.open(str(out_wav), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())


def cover(F, sale):
    big, line, _ = hook(F, sale)
    im = H.base(0)
    H.text(im, big, 600, 330)
    H.text(im, line, 1000, 96, lines=3)
    H.pill(im, f"#{sale.replace(' ', '').upper()}, HONESTLY", 1380, fill=H.GRN, size=50)
    return im.convert("RGB")


def captions(F, sale, link):
    tag = "#" + sale.replace(" ", "")
    big, line, small = hook(F, sale)
    n = big.strip("*")
    lst = "\n".join(f"⛳ {i['label']}: {H.money(i['now'])}" for i in reversed(F["items"]))
    body = (f"#Ad {sale}, honestly 📋\n\n{n} {line[0].lower() + line[1:] if line[0].isupper() else line} ({small}.)\n\n"
            f"No countdown clocks, no made-up \"was\" prices. These 5 are at the lowest price we've tracked:\n\n{lst}\n\n"
            "Compared across multiple UK retailers, checked every 6 hours. Link in bio.")
    short = f"#Ad {sale}, honestly 📋 {n} {line} ({small}.) 5 at their lowest we've tracked: golfpriceai.com {tag}"
    return {
        "instagram": body + f"\n\n{tag} {tag}Golf #golf #golfuk #golfdeals #golfgear #golfer",
        "tiktok": body + f" {tag} {tag}Golf #golf #golftok #golfuk",
        "youtube": {"title": f"{sale}, honestly: 5 genuine lowest golf prices 📋 #shorts",
                    "description": body.replace(" Link in bio.", "") + f"\n{link}\n{tag} #golf #golfuk #shorts"},
        "x": short[:270],
        "pinterest": {"title": f"{sale} golf, honestly: 5 genuine lowest prices", "description": body.replace(" Link in bio.", ""), "link": link},
        "bluesky": short[:295],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sale", required=True)
    ap.add_argument("--date", required=True)
    ap.add_argument("--since", required=True, help="compare with prices on this date (e.g. Black Friday)")
    ap.add_argument("--slot", default="12:30")
    ap.add_argument("--photo", default="assets/social/library/gaz-04-slowclap.jpg")
    ap.add_argument("--groove", default="chip")
    ap.add_argument("--hub", default=None, help="site path for the link, e.g. /prices/cyber-monday/")
    ap.add_argument("--no-plan", action="store_true", help="render only (a preview)")
    a = ap.parse_args()
    day = date.fromisoformat(a.date)
    F = facts(day, a.since)
    print(json.dumps(F, indent=1, ensure_ascii=False))
    name = slug(a.sale) + "-honestly"
    out = ROOT / "assets/social/launch" / f"{name}.mp4"
    silent = Path("/tmp") / f"{name}.silent.mp4"
    cmd = ["ffmpeg", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{HGT}", "-r", str(FPS), "-i", "-",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(silent)]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for n in range(int(H.DUR * FPS)):
        p.stdin.write(frame(n / FPS, F, a.sale, a.photo).convert("RGB").tobytes())
    p.stdin.close(); p.wait()
    wav = Path("/tmp") / f"{name}.wav"
    soundtrack(wav, a.groove)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(silent), "-i", str(wav), "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
                    "-shortest", "-movflags", "+faststart", str(out)], check=True)
    pid = f"{a.date}-hero"
    c = cover(F, a.sale)
    c.save(ROOT / "social/thumbs" / f"{pid}.jpg", quality=90)
    c.crop((0, 285, 1080, 1635)).save(ROOT / "social/cards" / f"{pid}.jpg", quality=90)
    print("wrote", out)
    if a.no_plan:
        return
    hub = a.hub or f"/prices/{slug(a.sale)}/"
    if not (ROOT / hub.strip("/") / "index.html").exists():
        hub = "/prices/"
    link = f"{SITE}{hub}?utm_source=social&utm_medium=hero&utm_campaign={slug(a.sale)}"
    pin = f"{int(a.slot[:2]) + 1:02d}{a.slot[2:]}"
    post = {"id": pid, "date": a.date, "theme": f"{a.sale} hero", "style": "prebuilt", "palette": "brand",
            "hook": f"{a.sale}, honestly", "trend": None, "card": f"/social/cards/{pid}.jpg", "thumb": f"/social/thumbs/{pid}.jpg",
            "video": f"{SITE}/assets/social/launch/{name}.mp4", "link": link, "headline": f"{a.sale}, honestly", "sub": "",
            "captions": captions(F, a.sale, link), "sound": f"original ({a.groove} groove, cut on the 0.6s beat)", "trendingFormats": [],
            "posted": {}, "quality": [], "format": "data", "formatName": "Data nobody noticed", "objective": "conversions",
            "series": None, "ep": None, "tags": ["#" + a.sale.replace(" ", "")], "hasPrices": True, "ad": True,
            "times": {"Instagram": f"{a.slot} (posts itself once ticked)", "TikTok": a.slot, "YouTube Shorts": a.slot, "X": a.slot,
                      "Bluesky": f"{a.slot} (posts itself once ticked)", "Pinterest": pin}, "slot": a.slot}
    pp = ROOT / "data/agents/content-plan.json"
    plan = json.load(open(pp))
    plan["posts"] = [x for x in plan["posts"] if x["id"] != pid] + [post]
    plan["posts"].sort(key=lambda x: (x["date"], x.get("slot", "")))
    open(pp, "w").write(json.dumps(plan, indent=1, ensure_ascii=False) + "\n")
    print("plan: added", pid)


if __name__ == "__main__":
    main()
