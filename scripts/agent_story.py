"""Data stories: one headline-worthy finding from our own price data each month.

Runs on the 1st of each month (.github/workflows/agent-story.yml). It tests
several story angles against the tracked price history and picks the most
striking one that clears a minimum sample size:

  * The best day of the week to buy: which weekday most price drops land on.
  * How fast clubs lose value: median price change over the time we've
    tracked them, by club type.
  * Which category is cheapest right now: the share of models genuinely
    cheaper than a month ago.
  * Which brand has the most models at their lowest tracked price.

Output: data/agents/story.json (headline, three supporting numbers, method,
draft press note) and a shareable chart at social/stories/<YYYY-MM>.png. The
first-Tuesday press task and the content engine both pick it up. Every number
comes from the data; nothing is estimated. Retailers are never named.
"""
import json
import os
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, SITE, load, models, now, email_owner)

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
TYPE_NAMES = {"driver": "Drivers", "wood": "Fairway woods", "hybrid": "Hybrids", "irons": "Iron sets", "wedge": "Wedges", "putter": "Putters"}


def story_weekday(mods):
    c = Counter()
    for m in mods:
        h = m.get("history") or []
        for (d0, p0), (d1, p1) in zip(h, h[1:]):
            if p1 < p0 * 0.97:
                c[date.fromisoformat(d1).weekday()] += 1
    total = sum(c.values())
    if total < 200:
        return None
    day, n = c.most_common(1)[0]
    share = n / total
    strength = share / (1 / 7)
    return {"angle": "best day", "strength": strength,
            "headline": f"{round(share * 100)}% of UK golf price drops land on a {DAYS[day]}",
            "points": [f"{total:,} genuine price drops (3% or more) tracked across multiple UK retailers",
                       f"{DAYS[day]} sees {round(share * 100)}% of them, against {round(100 / 7)}% if drops were spread evenly",
                       f"The quietest day is {DAYS[min(c, key=c.get)]}, with {round(100 * c[min(c, key=c.get)] / total)}%"],
            "chart": [(DAYS[i][:3], c[i]) for i in range(7)], "chartTitle": "Golf price drops by day of the week"}


def story_depreciation(mods):
    by = defaultdict(list)
    for m in mods:
        h = m.get("history") or []
        if m.get("group") != "club" or m.get("type") not in TYPE_NAMES or len(h) < 2:
            continue
        span = (date.fromisoformat(h[-1][0]) - date.fromisoformat(h[0][0])).days
        if span >= 75 and h[0][1] > 0:
            by[m["type"]].append((h[-1][1] - h[0][1]) / h[0][1])
    rows = [(TYPE_NAMES[t], statistics.median(v), len(v)) for t, v in by.items() if len(v) >= 15]
    if len(rows) < 3:
        return None
    rows.sort(key=lambda r: r[1])
    top = rows[0]
    return {"angle": "depreciation", "strength": abs(top[1]) * 20,
            "headline": f"{top[0]} have fallen a typical {abs(round(top[1] * 100))}% since we started tracking them",
            "points": [f"Median change across {top[2]} {top[0].lower()} tracked for at least 75 days",
                       "; ".join(f"{r[0]}: {round(r[1] * 100):+d}%" for r in rows[:4]),
                       "Prices compared like for like: the lowest new UK price on the first and the latest day tracked"],
            "chart": [(r[0], round(-r[1] * 100, 1)) for r in rows], "chartTitle": "Typical fall since first tracked (%)"}


def story_category():
    tiles = [t for t in (load("home-pulse.json") or {}).get("tiles", []) if t.get("compared", 0) >= 15]
    if len(tiles) < 3:
        return None
    tiles.sort(key=lambda t: -t["cheaper"] / t["compared"])
    t = tiles[0]
    share = t["cheaper"] / t["compared"]
    return {"angle": "category", "strength": share * 4,
            "headline": f"{round(share * 100)}% of {t['label'].lower().replace('gps', 'GPS')} are cheaper than a month ago",
            "points": [f"{t['cheaper']} of the {t['compared']} {t['label'].lower()} we track are genuinely cheaper than 30 days ago",
                       f"From {('£%.2f' % t['from']) if t['from'] < 100 else ('£%d' % t['from'])} today",
                       "Next most improved: " + ", ".join(f"{x['label'].lower()} ({round(100 * x['cheaper'] / x['compared'])}%)" for x in tiles[1:3])],
            "chart": [(x["label"][:12], round(100 * x["cheaper"] / x["compared"])) for x in tiles[:7]], "chartTitle": "Share cheaper than a month ago (%)"}


def story_brand(mods):
    tot, low = Counter(), Counter()
    for m in mods:
        if m.get("group") != "club":
            continue
        tot[m["brand"]] += 1
        if (m.get("verdict") or {}).get("label") == "good":
            low[m["brand"]] += 1
    rows = [(b, low[b] / tot[b], low[b], tot[b]) for b in tot if tot[b] >= 25]
    if len(rows) < 4:
        return None
    rows.sort(key=lambda r: -r[1])
    b = rows[0]
    return {"angle": "brand", "strength": b[1] * 5,
            "headline": f"{b[0]} has the most clubs at their lowest tracked price",
            "points": [f"{b[2]} of {b[3]} {b[0]} models ({round(b[1] * 100)}%) are at the lowest price we've tracked",
                       "Next: " + ", ".join(f"{r[0]} ({round(r[1] * 100)}%)" for r in rows[1:4]),
                       "Brands with at least 25 club models tracked"],
            "chart": [(r[0][:12], round(r[1] * 100)) for r in rows[:7]], "chartTitle": "Clubs at lowest tracked price (%)"}


def chart(rows, title, path):
    from PIL import Image, ImageDraw, ImageFont
    W, H = 1200, 900
    f = lambda s: ImageFont.truetype(str(ROOT / "assets" / "fonts" / "Poppins-Bold.ttf"), s)
    im = Image.new("RGB", (W, H), (20, 33, 26))
    d = ImageDraw.Draw(im)
    d.text((60, 50), title, font=f(44), fill=(255, 255, 255))
    top = max(v for _, v in rows) or 1
    bw = (W - 160) / len(rows)
    for i, (label, v) in enumerate(rows):
        h = 560 * max(0, v) / top
        x = 80 + i * bw
        d.rounded_rectangle([x + 12, 760 - h, x + bw - 12, 760], 10, fill=(63, 174, 41) if v == top else (90, 120, 100))
        txt = f"{v:g}"
        d.text((x + bw / 2 - d.textlength(txt, font=f(32)) / 2, 760 - h - 46), txt, font=f(32), fill=(255, 255, 255))
        d.text((x + bw / 2 - d.textlength(label, font=f(24)) / 2, 780), label, font=f(24), fill=(196, 208, 200))
    d.text((60, H - 70), "Source: GolfPrice AI price tracking · golfpriceai.com", font=f(26), fill=(63, 174, 41))
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)


def main():
    mods = models()
    cands = [s for s in (story_weekday(mods), story_depreciation(mods), story_category(), story_brand(mods)) if s]
    if not cands:
        print("not enough data for a story"); return
    prev = (json.loads((OUT / "story.json").read_text()) if (OUT / "story.json").exists() else {}).get("angle")
    cands.sort(key=lambda s: -(s["strength"] * (0.6 if s["angle"] == prev else 1)))  # don't run the same angle twice running
    s = cands[0]
    month = now().strftime("%Y-%m")
    img = ROOT / "social" / "stories" / f"{month}.png"
    chart(s["chart"], s["chartTitle"], img)
    note = (f"{s['headline']}\n\n" + "\n".join(f"• {p}" for p in s["points"]) +
            f"\n\nMethod: GolfPrice AI tracks the lowest new UK price of {len(mods):,} golf equipment models across multiple UK retailers "
            "every six hours. Figures are from our own tracked history; no 'was' prices are used. Dates are the day a new price "
            "first appeared in retailers' feeds.\n"
            f"Chart: {SITE}/social/stories/{month}.png")
    out = {"month": month, "angle": s["angle"], "headline": s["headline"], "points": s["points"], "chart": f"/social/stories/{month}.png",
           "pressNote": note, "alternatives": [c["headline"] for c in cands[1:]]}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "story.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    email_owner(f"GolfPrice AI · this month's data story: {s['headline']}",
                "<p>" + note.replace("\n", "<br>") + "</p><p>Other angles: " + "; ".join(out["alternatives"]) + "</p>")
    print(s["headline"])


if __name__ == "__main__":
    main()
