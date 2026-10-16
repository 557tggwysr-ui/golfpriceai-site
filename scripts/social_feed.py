"""Social feed: data/social-feed.xml

A small RSS feed made for auto-posting: Pinterest's "auto-publish from RSS"
and a free IFTTT applet for a Facebook page (or similar) read it and post
each new item on their own, so socials stay busy with no daily effort.

What goes in
  * Genuine price drops from the last 48 hours on models with a price page
    (the same rule as /prices/drops/: at least £5 and 3%, under 60%, still
    at the lower price), so every post links to a page that backs it up.
  * At most 3 new items a day, biggest drop first, one per brand per day,
    no junior items. Men's and unisex first, at most 1 women's a day.
  * Each item keeps the date it first went in, so readers see it as new
    once, and it can come back later only if that model drops again.
  * The feed holds the last 40 items.

Nothing personal is stored: data/social-feed-state.json only remembers
which drops have been posted and when.
"""
import json
import re
from datetime import datetime, time, timezone
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

from price_pages import SITE, money, retailer_name

ROOT = Path(__file__).resolve().parent.parent
FEED_FILE = ROOT / "data" / "social-feed.xml"
STATE_FILE = ROOT / "data" / "social-feed-state.json"
PER_DAY = 3
WOMEN_PER_DAY = 1
KEEP = 40
JUNIOR = re.compile(r"\b(jr|junior|kids?|youth|boys|girls)\b", re.I)
WOMEN = re.compile(r"\b(ladies|lady|women'?s?|womens)\b", re.I)


def _mime(url):
    u = (url or "").lower().split("?")[0]
    return "image/png" if u.endswith(".png") else "image/webp" if u.endswith(".webp") else "image/jpeg"


def build(passing, built, products, today):
    import drops_page
    state = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {"items": []}
    items = state.get("items", [])
    have = {i["guid"] for i in items}
    images = {p["id"]: p.get("image") for p in products if p.get("image")}

    rows = [r for r in drops_page.recent_drops(passing, built, today, days=2)
            if not JUNIOR.search(r["m"]["name"]) and not r["m"].get("preowned")]
    rows.sort(key=lambda r: -r["pct"])
    added_today = [i for i in items if i["added"] == today.isoformat()]
    brands = {i.get("brand", "").lower() for i in added_today}
    women = sum(1 for i in added_today if i.get("women"))
    new = []
    for r in rows:
        if len(added_today) + len(new) >= PER_DAY:
            break
        m = r["m"]
        guid = f"{m['slug']}-{r['date'].isoformat()}"
        if guid in have:
            continue
        # Pinterest is happiest with JPG or PNG, so prefer those.
        pics = [images[i] for i in m.get("listingIds", []) if images.get(i)]
        image = next((u for u in pics if _mime(u) != "image/webp"), pics[0] if pics else None)
        if not image:
            continue
        brand = (m.get("brand") or m["name"].split()[0]).strip()
        if brand.lower() in brands:
            continue
        is_women = bool(WOMEN.search(m["name"]))
        if is_women and women >= WOMEN_PER_DAY:
            continue
        per = " per dozen" if m["type"] == "ball" else ""
        where = retailer_name(m["minRetailer"]) if m.get("minRetailer") else "a UK retailer"
        new.append({
            "guid": guid, "added": today.isoformat(), "brand": brand, "women": is_women,
            "title": f"{m['name']}: now {money(r['to'])}{per}, down {money(r['fall'])} ({r['pct']}%)",
            "text": (f"Genuine UK price drop on the {m['name']}: now {money(r['to'])}{per} at {where}, "
                     f"down from {money(r['from'])}. Checked against our own price history, not a retailer's "
                     f"“was” price. Compare every UK price at GolfPrice AI. #golf #golfdeals #ukgolf"),
            "link": f"{SITE}/prices/{m['slug']}/?utm_source=social-feed&utm_medium=social",
            "image": image,
        })
        brands.add(brand.lower())
        women += is_women
    items = (new + items)[:KEEP]
    STATE_FILE.write_text(json.dumps({"about": "Which genuine drops the social feed has posted, and when. No personal data.",
                                      "items": items}, indent=1, ensure_ascii=False) + "\n")

    now = format_datetime(datetime.now(timezone.utc))
    parts = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<rss version="2.0"><channel>',
             '<title>GolfPrice AI: genuine UK golf price drops</title>',
             f'<link>{SITE}/prices/drops/</link>',
             '<description>Up to three genuine UK golf price drops a day, checked against our own price history. '
             'No hype. No fake discounts.</description>',
             '<language>en-gb</language>',
             f'<lastBuildDate>{now}</lastBuildDate>']
    for i in items:
        d = datetime.combine(datetime.fromisoformat(i["added"]).date(), time(12, 0), tzinfo=timezone.utc)
        parts += ["<item>",
                  f"<title>{escape(i['title'])}</title>",
                  f"<link>{escape(i['link'])}</link>",
                  f'<guid isPermaLink="false">{escape(i["guid"])}</guid>',
                  f"<description>{escape(i['text'])}</description>",
                  f'<enclosure url="{escape(i["image"])}" length="0" type="{_mime(i["image"])}"/>',
                  f"<pubDate>{format_datetime(d)}</pubDate>",
                  "</item>"]
    parts.append("</channel></rss>")
    FEED_FILE.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(f"Social feed: {len(new)} new item(s) today, {len(items)} in the feed.")
