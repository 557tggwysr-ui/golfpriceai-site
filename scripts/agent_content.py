"""Content engine: a constant, varied flow of social posts built from live
prices, tied to what golfers are talking about, and learning what works.

.github/workflows/agent-content.yml runs it in three modes:

  plan   (Sundays 17:00 UK) scans trends, builds next week's seven posts
         and renders each as a hooked vertical video (Reels, TikTok,
         Shorts) plus a feed card. Then it writes the Sunday pack page
         (/social/pack/, not indexed) and opens a GitHub issue
         "Content pack: w/c <date>" with a tick box per post.
  moment (daily) adds a same-day post when a popular model hits its lowest
         tracked price.
  post   (daily 12:30 UK) posts today's ticked items to Instagram (needs
         IG_USER_ID + IG_ACCESS_TOKEN) and records the post id, so the
         learning step can read how it did.

How it stays fresh:
  * Trends: BBC golf headlines, Google's UK daily trends and a golf calendar
    (majors, Black Friday, Christmas, the new season...). A tie-in is only
    used if the headline passes a safety filter: nothing political, tragic,
    criminal or about anyone's health, and no real people are named or shown.
  * Seven video styles (reveal, guess, countdown, stat, POV meme,
    expectation v reality meme, receipt) and four colour schemes. No style
    repeats within a week and no hook repeats within 30 days.
  * Every video opens on a hook in its first second.
  * Learning: each Sunday it reads Instagram insights for last week's posts
    (reach, likes, comments, saves, shares) and leans next week's mix
    towards the styles that earned the most.

Nothing posts without the owner's tick. House rules in every caption: never
name retailers ("multiple UK retailers"), no countdowns or fake urgency,
positive framing, prices checked against our own history.
"""
import json
import os
import random
import re
import subprocess
import sys
from datetime import date, timedelta
from html import unescape
from io import BytesIO

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, SITE, load, models, http, now)
import agent_video as V
import agent_social as S   # the 14 formats, the mix, the bank, the photo library (John's brief, 21 Nov 2026)
import copy

PLAN = OUT / "content-plan.json"
LEARN = OUT / "content-learning.json"
TRENDS = OUT / "trends.json"
SOCIAL = OUT / "social-trends.json"   # live hashtags, sounds and formats (scripts/agent_trends.mjs)
STYLE_FORMATS = {"pov": ["pov", "day in the life"], "countdown": ["tier list", "top 3 / countdown"], "guess": ["guess the price", "challenge"],
                 "expectation": ["expectation v reality", "reaction"], "receipt": ["budget", "tried it"], "stat": ["budget"], "reveal": ["tried it"],
                 "spec": ["product launch", "cinematic"], "thennow": ["before and after", "then vs now"], "truth": ["relatable", "skit", "pov"],
                 "sitedemo": ["tutorial", "how to", "tried it"], "story": ["trend", "meme"]}
TOPIC_WORDS = re.compile(r"black ?friday|cyber ?monday|christmas|gift|secret ?santa|boxing ?day|new ?year|fathers? ?day|summer|winter|spring|sale|deals?|sport", re.I)
CARDS = ROOT / "social" / "cards"
THUMBS = ROOT / "social" / "thumbs"
# Thumbnail headlines must read in a second: 2 to 4 words. Long hooks fall back to these.
STYLE_THUMB = {"thennow": "Then v now", "truth": "We've all been there", "spec": "New lowest price", "story": "Golf, but make it news",
               "collage": "Your move", "sitedemo": "Check before you buy", "reveal": "Today's price", "guess": "Guess the price",
               "countdown": "Top drops this week", "stat": "The numbers", "pov": "POV: you checked first", "expectation": "Expectation v reality",
               "receipt": "The receipt"}


def thumb_text(sc, style):
    t = str(sc.get("thumb") or sc.get("hook") or "")
    if 0 < len(t.split()) <= 5:
        return t
    first = re.split(r"[.:!?]", t)[0].strip()
    if 0 < len(first.split()) <= 4:
        return first
    return STYLE_THUMB.get(style, "Full Swing. Not full price.")
PACK = ROOT / "social" / "pack" / "index.html"
VIDEOS = ROOT / "social-videos"   # build output: uploaded to a GitHub release (pack-<monday>), never committed
REPO = os.environ.get("GITHUB_REPOSITORY", "557tggwysr-ui/golfpriceai-site")
TAGS = "#golf #golfuk #golfdeals #golfgear #golfer"
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
KEEP_CARDS_DAYS = 21
BRANDS = ["TaylorMade", "Callaway", "Titleist", "Ping", "Cobra", "Mizuno", "Srixon", "Cleveland", "Wilson", "Odyssey", "PXG", "FootJoy", "Motocaddy"]

# ---------------- the voice: friendly golf-club banter ----------------
BANTER = {
    "price": ["Your swing's not getting cheaper. Your driver just did.", "Blame the clubs by all means. Just blame cheaper ones.",
              "The only thing dropping faster is your putt from 3 feet.", "Fore! (That's money off, not a warning.)",
              "Cheaper than a sleeve of balls lost in the lake. Almost.", "Tell the other half it was on offer. Because it was."],
    "guess": ["Closer than your last chip, at least.", "Get it right and the first round's on you.", "Guessed it? Handicap: zero. Allegedly.",
              "Wrong? Don't worry, so is your alignment."],
    "stat": ["Your handicap won't drop this fast.", "More drops than a frosty Sunday medal.", "Prices: dropping. Scores: we'll see."],
    "start": ["Cheaper than a year of lost balls.", "Less than a fancy golf day. And you keep the clubs.", "Golf: the hobby that starts cheap and ends in a buggy."],
    "meme": ["Still slicing it, mind.", "Spend the difference on lessons. Or don't.", "The clubs were never the problem. But still.",
             "Card wrecked by the 3rd. Bank balance? Fine."],
}

POV = [("POV", "You paid full price for a new {kind} last week", "It's {fall} cheaper today", "Still slicing it, mind."),
       ("POV", "You told the club you'd 'upgrade in spring'", "It just dropped {fall}", "Spring's come early, lads."),
       ("NOBODY:", "Golfers at 6am on a Saturday", "Checking if it dropped again", "It did. {now}."),
       ("POV", "Your mate swears he got a bargain", "You check: it's {fall} cheaper now", "Say nothing. Enjoy the round.")]

TIE_INS = [  # (trigger words, hook, caption opener)
    (r"\b(masters|the open|open championship|ryder cup|pga championship|us open)\b", "Big golf weekend. Big savings?", "Big golf weekend on the telly ⛳ Meanwhile, in prices:"),
    (r"\bblack friday\b", "Black Friday, minus the nonsense", "Black Friday, minus the nonsense ⛳"),
    (r"\bcyber monday\b", "Cyber Monday: what's really cheaper?", "Cyber Monday check ⛳"),
    (r"\b(christmas|secret santa|stocking filler)\b", "Sorted: the golfer who has everything", "Christmas sorted for the golfer in your life ⛳"),
    (r"\b(new year|resolution)\b", "New year. New driver. Same slice?", "New year, new bag? ⛳"),
    (r"\b(snow|frost|frozen|storm|heavy rain|waterlogged)\b", "Course shut? Do some window shopping", "Course shut this weekend? ⛳ Here's what's cheaper while you wait:"),
    (r"\b(heatwave|sunshine|hottest)\b", "Sun's out. Clubs out.", "Sun's out, clubs out ⛳"),
    (r"\bfather'?s day\b", "Father's Day sorted", "Father's Day sorted ⛳"),
]
UNSAFE = re.compile(r"\b(dies|died|death|dead|killed|kill|tragic|tragedy|crash|war|attack|election|vote|minister|government|"
                    r"parliament|police|court|arrest|charged|victims?|injur\w*|cancer|funeral|abuse|racis\w*|scandal|"
                    r"shooting|stabb\w*|missing|trump|starmer|labour|tory|conservative|reform uk|israel|gaza|ukraine|russia)\b", re.I)
MAJORS_LIVE = {4: "masters", 5: "pga championship", 6: "us open", 7: "the open", 9: "ryder cup"}
CALENDAR = {11: ["black friday"], 12: ["christmas"], 1: ["new year"], 4: ["masters"], 6: ["father's day"], 7: ["the open"]}


def money(n):
    return V.money(n)


# ---------------- trends ----------------

def rss_titles(url, limit=40):
    s, _, txt = http(url, timeout=20)
    if s != 200:
        return []
    return [unescape(re.sub(r"<!\[CDATA\[|\]\]>", "", t)).strip() for t in re.findall(r"<title>(.*?)</title>", txt, re.S)[1:limit]]


def scan_trends():
    heads = []
    for src, url in (("golf news", "https://feeds.bbci.co.uk/sport/golf/rss.xml"),
                     ("UK trends", "https://trends.google.com/trending/rss?geo=GB")):
        for t in rss_titles(url):
            heads.append({"source": src, "title": t})
    safe = [h for h in heads if not UNSAFE.search(h["title"])]
    ties, brands = [], []
    words = " ".join(h["title"] for h in safe).lower() + " " + " ".join(CALENDAR.get(now().month, []))
    for pat, hook, opener in TIE_INS:
        hit = re.search(pat, words, re.I)
        if hit and pat == TIE_INS[0][0] and not MAJORS_LIVE.get(now().month):
            continue  # a major in the news (venue, preview) isn't a golf weekend on the telly: only tie in during its month
        if hit:
            ties.append({"match": hit.group(0), "hook": hook, "opener": opener})
    for b in BRANDS:
        if any(re.search(rf"\b{re.escape(b)}\b", h["title"], re.I) for h in safe if h["source"] == "golf news"):
            brands.append(b)
    out = {"generated": now().strftime("%Y-%m-%dT%H:%MZ"), "tieIns": ties[:4], "brandsInNews": brands,
           "headlines": [h["title"] for h in safe if h["source"] == "golf news"][:12],
           "about": "Trend scan for the content engine. Only headlines that pass the safety filter are kept."}
    OUT.mkdir(parents=True, exist_ok=True)
    TRENDS.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


# ---------------- learning ----------------

def load_learning():
    try:
        return json.loads(LEARN.read_text(encoding="utf-8"))
    except Exception:
        return {"styles": {}, "hooksUsed": {}, "posts": {}}


def save_learning(L):
    cut = str(now().date() - timedelta(days=60))
    L["hooksUsed"] = {h: d for h, d in L["hooksUsed"].items() if d >= cut}
    OUT.mkdir(parents=True, exist_ok=True)
    LEARN.write_text(json.dumps(L, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def ig_api():
    """Instagram's address depends on the token: Unified login (Meta's newer set-up) gives an "EAA..."
    token that works through graph.facebook.com; the older Instagram login gives "IGAA..." for graph.instagram.com."""
    tok = os.environ.get("IG_ACCESS_TOKEN") or ""
    return "https://graph.facebook.com/v21.0" if tok.startswith("EAA") else "https://graph.instagram.com/v21.0"


def learn(plan, L):
    """Read Instagram insights for posted items and score each style."""
    tok = os.environ.get("IG_ACCESS_TOKEN")
    if not tok:
        return
    for p in plan["posts"]:
        mid = p.get("posted", {}).get("instagram_id")
        if not mid or p["id"] in L["posts"]:
            continue
        if date.fromisoformat(p["date"]) > now().date() - timedelta(days=3):
            continue  # give it a few days to find its audience
        s, _, txt = http(f"{ig_api()}/{mid}/insights?metric=reach,likes,comments,saved,shares&access_token={tok}")
        if s != 200:
            continue
        vals = {m["name"]: (m.get("values") or [{}])[0].get("value", 0) for m in json.loads(txt).get("data", [])}
        reach = max(1, vals.get("reach", 0))
        score = (vals.get("likes", 0) + 2 * vals.get("comments", 0) + 3 * vals.get("saved", 0) + 3 * vals.get("shares", 0)) / reach
        L["posts"][p["id"]] = {"style": p.get("style"), "palette": p.get("palette"), "score": round(score, 4), "reach": vals.get("reach", 0)}
        S.learn_format(L, p.get("format") or "pricedrop", score)
        L["posts"][p["id"]]["format"] = p.get("format")
        st = L["styles"].setdefault(p.get("style"), {"n": 0, "score": 0.0})
        st["score"] = round((st["score"] * st["n"] + score) / (st["n"] + 1), 4)
        st["n"] += 1
        L["posts"][p["id"]]["slot"] = p.get("slot", "12:30")
    slot_test(L)


def slot_test(L):
    """Lunchtime v evening: each post's reach and engagement against its own format's average, then the
    average of that per slot. Decided after four weeks with at least 8 posts in each slot."""
    ps = [v for k, v in L.get("posts", {}).items() if v.get("slot") in SLOTS and k >= str(TEST_START)]
    fmt = {}
    for v in ps:
        f = fmt.setdefault(v.get("format") or "x", [0, 0.0, 0.0]); f[0] += 1; f[1] += v.get("reach", 0); f[2] += v.get("score", 0)
    res = {sl: {"n": 0, "reach": 0.0, "eng": 0.0} for sl in SLOTS}
    for v in ps:
        n, r, e = fmt[v.get("format") or "x"]
        r_avg, e_avg = (r / n) or 1, (e / n) or 1
        x = res[v["slot"]]; x["n"] += 1; x["reach"] += v.get("reach", 0) / r_avg; x["eng"] += v.get("score", 0) / e_avg
    for x in res.values():
        if x["n"]:
            x["reach"], x["eng"] = round(x["reach"] / x["n"], 3), round(x["eng"] / x["n"], 3)
    t = L.setdefault("slotTest", {"started": str(TEST_START)})
    t["slots"] = res
    if not t.get("winner") and now().date() >= TEST_START + timedelta(days=28) and all(res[sl]["n"] >= 8 for sl in SLOTS):
        val = {sl: res[sl]["reach"] * 0.6 + res[sl]["eng"] * 0.4 for sl in SLOTS}
        t["winner"] = max(SLOTS, key=lambda sl: val[sl])
        t["decided"] = str(now().date())
        t["why"] = f"{t['winner']} did better on reach and engagement, each post compared with its own format"


def load_social():
    try:
        return json.loads(SOCIAL.read_text(encoding="utf-8"))
    except Exception:
        return {}


def format_boost(social, style):
    """Hot formats right now (from what golfers are watching) give matching styles a lift."""
    f = social.get("formats") or {}
    hits = sum(f.get(name, 0) for name in STYLE_FORMATS.get(style, []))
    return 1 + min(1.5, hits / 5)


def live_tags(social, text, n_golf=3, n_topic=1):
    """Live hashtags that fit this post: golf ones first, a general trend only if the post is about it."""
    tags = social.get("hashtags") or []
    golf = [t["tag"] for t in tags if t.get("golf")][:n_golf]
    topic = [t["tag"] for t in tags if not t.get("golf") and TOPIC_WORDS.search(t["tag"]) and
             re.sub(r"[^a-z]", "", t["tag"].lower()) in re.sub(r"[^a-z]", "", text.lower())][:n_topic]
    return [t for t in golf + topic if len(t) <= 30]


def weight(L, style):
    st = L["styles"]
    known = [v["score"] for v in st.values() if v["n"] >= 2]
    if style not in st or st[style]["n"] < 2 or not known:
        return 1.2  # untested styles get a fair go
    avg = sum(known) / len(known) or 1
    return max(0.4, min(2.5, st[style]["score"] / avg))


# ---------------- what each day is about ----------------

def model_image(m):
    ids = set(m.get("listingIds") or [])
    for p in (load("products-lite.json") or load("products.json") or {}).get("products", []):
        if p.get("id") in ids and p.get("image"):
            return p["image"]
    return None


SKIP_MODEL = re.compile(r"single-iron|individual|junior|kids|youth|shaft", re.I)


def good_models(group=("club", "set"), brand=None):
    out = []
    for m in models():
        if (m.get("verdict") or {}).get("label") != "good" or m.get("group") not in group or SKIP_MODEL.search(m["slug"]):
            continue
        if brand and m.get("brand", "").lower() != brand.lower():
            continue
        hist = [p for _, p in m.get("history") or []]
        if len(hist) < 5:
            continue
        hi, now_ = max(hist), float(m["minPrice"])
        if 20 <= hi - now_ <= 0.5 * hi:
            out.append((hi - now_, hi, m))
    return sorted(out, key=lambda x: -x[0])


def theme_drop(d, tr):
    bd = load("biggest-drop.json") or {}
    cats = sorted([c for c in (bd.get("cats") or {}).values() if isinstance(c, dict) and c.get("fall")], key=lambda c: -c["fall"])
    if not cats:
        return None
    c = cats[0]
    kind = "driver" if "driver" in c["name"].lower() else "set" if "set" in c["name"].lower() else "golf deal"
    sc = {"name": c["name"], "from": c["was"], "price": c["now"], "fall": c["fall"]}
    styles = {
        "reveal": {**sc, "hooks": [f"This {kind} just dropped {money(c['fall'])}", f"{money(c['fall'])} off. Just like that.", "Biggest golf price drop this week"],
                   "stamp": f"{money(c['fall'])} CHEAPER"},
        "expectation": {**sc, "hooks": ["Expectation v reality", "What you think it costs v today"], "banter": "meme"},
        "pov": {**sc},
        "spec": {**sc, "hooks": [f"{money(c['fall'])} cheaper this week", "Biggest drop of the week"]},
        "thennow": {**sc, "then_label": "Before this drop", "hooks": ["Same club. Different price.", "Then. Now."]},
    }
    if len(cats) >= 3:
        styles["countdown"] = {"hooks": ["3 golf prices that just fell", "This week's three biggest drops"],
                               "items": [{"name": x["name"], "now": x["now"], "fall": x["fall"], "image": x.get("image")} for x in cats[:3]]}
    return {"theme": "Biggest drop", "link": SITE + c["url"], "image": c.get("image"), "name": c["name"],
            "headline": f"{money(c['fall'])} cheaper", "sub": c["name"], "styles": styles,
            "ig": f"Biggest drop of the week ⛳ The {c['name']} is now {money(c['now'])}, that's {money(c['fall'])} cheaper, checked against our own price history across multiple UK retailers. Link in bio.",
            "x": f"Biggest golf price drop this week ⛳\n{c['name']}: now {money(c['now'])}, {money(c['fall'])} cheaper than it was.\n{SITE}{c['url']}",
            "tt": f"Biggest golf price drop this week: {c['name']} ⛳"}


def theme_pulse(d, tr, shift=0):
    tiles = [t for t in (load("home-pulse.json") or {}).get("tiles", []) if t.get("cheaper")]
    if not tiles:
        return None
    t = tiles[(d.isocalendar()[1] + shift) % len(tiles)]
    link = SITE + t["hub"]
    what = t["label"].lower()
    single = what[:-1] if what.endswith("s") else what
    return {"theme": "Category check", "link": link, "image": None, "art": t.get("photo", "").lstrip("/"), "name": t["label"],
            "headline": f"{t['cheaper']} of {t['compared']} cheaper", "sub": f"{t['label']} cheaper than a month ago",
            "styles": {"stat": {"n": t["cheaper"], "of": t["compared"], "what": what,
                                "hooks": [f"How many {what} are actually cheaper this month?", f"{t['label']}: cheaper or not?", f"We checked every {single} price. Here's the truth"],
                                "line": f"Genuinely cheaper than a month ago, from {money(t['from'])}, checked across multiple UK retailers."}},
            "ig": f"{t['label']} check ⛳ {t['cheaper']} of the {t['compared']} models we track are genuinely cheaper than a month ago, from {money(t['from'])}. Every price checked against our own history, never a 'was' price. Link in bio.",
            "x": f"{t['cheaper']} of {t['compared']} {what} are genuinely cheaper than a month ago ⛳\n{link}",
            "tt": f"How many {what} are actually cheaper this month? ⛳"}


def theme_good(d, tr, brand=None, rank=0):
    g = good_models(brand=brand)
    if len(g) <= rank:
        return None
    saving, hi, m = g[rank]
    link = f"{SITE}/prices/{m['slug']}/"
    sc = {"name": m["name"], "from": hi, "price": float(m["minPrice"]), "fall": saving}
    return {"theme": "Lowest tracked" + (f" ({brand} in the news)" if brand else ""), "link": link, "image": model_image(m), "name": m["name"],
            "headline": money(m["minPrice"]), "sub": m["name"],
            "styles": {"reveal": {**sc, "hooks": ["Lowest price we've ever tracked", "Just hit a new low", "Waiting for the right time? This is it."],
                                  "stamp": "LOWEST WE'VE TRACKED"},
                       "expectation": {**sc, "hooks": ["Expectation v reality", "Thought it was dear? Not today"]},
                       "pov": {**sc},
                       "spec": {**sc, "days": m.get("historyDays"), "hooks": ["Lowest we've tracked", "New lowest price"]},
                       "thennow": {**sc, "hooks": ["Same club. Different price.", "Patience pays"]},
                       "sitedemo": {**sc, "url": link, "sub": "Every UK price in one place",
                                    "hooks": ["Before you buy, check this", "How to never overpay for golf kit"]}
                       if (m.get("listingCount") or 0) >= 3 else None},
            "ig": f"Good time to buy ⛳ The {m['name']} is at the lowest price we've tracked in {m.get('historyDays', 'our')} days: {money(m['minPrice'])}, {money(saving)} under the highest price we've tracked. Link in bio.",
            "x": f"The {m['name']} is at the lowest price we've tracked: {money(m['minPrice'])} ⛳\n{link}",
            "tt": f"{m['name']}: lowest price in {m.get('historyDays', 'our')} days ⛳"}


def theme_start(d, tr):
    sg = load("start-golf.json") or {}
    if not sg.get("total"):
        return None
    items = (sg.get("easy") or {}).get("items", [])
    link = sg.get("page") or f"{SITE}/prices/start-golf/"
    lines = "\n".join(f"• {i['item']}: {money(i['price'])}" for i in items[:5])
    return {"theme": "Start golf", "link": link, "image": None, "art": "assets/action-male-putt.jpg", "name": "Start golf",
            "headline": f"{money(sg['total'])} this week", "sub": "Everything to start golf, at today's lowest prices",
            "styles": {"receipt": {"items": items, "total": sg["total"], "hooks": ["How much to start golf? Receipts.", "Starting golf? Here's the bill", "Golf on a budget: the actual receipt"]}},
            "ig": f"How much does it really cost to start golf? {money(sg['total'])} this week ⛳\n\n{lines}\n\nAll at today's lowest prices across multiple UK retailers. Link in bio.",
            "x": f"How much does it really cost to start golf? {money(sg['total'])} this week ⛳\n{link}",
            "tt": f"Starting golf for {money(sg['total'])}? Here's the receipt ⛳"}


def theme_guess(d, tr):
    st = load("par-price-state.json") or {}
    days = sorted((st.get("days") or {}).items())
    mods = {m["slug"]: m for m in models()}
    pool = [mods[s] for _, sl in days[-7:] for s in sl if s in mods and not SKIP_MODEL.search(s)]
    if not pool:
        return None
    m = random.Random(str(d)).choice(pool)
    price = float(m["minPrice"])
    # the guess sits above the real price, so the reveal is the good news: cheaper than you'd think (John, 23 Nov 2026)
    line = max(5, round(price * random.Random(m["slug"]).choice([1.15, 1.2, 1.3]) / 5) * 5)
    link = f"{SITE}/play/par-price/"
    return {"theme": "Par Price", "link": link, "image": model_image(m), "name": m["name"],
            "headline": "Higher or lower?", "sub": m["name"],
            "styles": {"guess": {"name": m["name"], "price": price, "line": line,
                                 "hooks": ["Guess the price. You've got 3 seconds.", "Higher or lower? No googling.", "Bet you can't guess this one"]}},
            "ig": f"Guess the price ⛳ {m['name']}: over or under {money(line)}? Answer in the comments, then play today's Par Price (link in bio).",
            "x": f"Guess the price ⛳ {m['name']}: over or under {money(line)}?\nPlay today's Par Price: {link}",
            "tt": "Golf price guessing game: how close can you get? ⛳"}


def theme_wild_nine(d, tr):
    return None  # switches on once /play/wild-nine/ is live: game clips are the next style to add


def theme_week(d, tr):
    bd = load("biggest-drop.json") or {}
    if not bd.get("week"):
        return None
    cats = sorted([c for c in (bd.get("cats") or {}).values() if isinstance(c, dict) and c.get("fall")], key=lambda c: -c["fall"])[:3]
    link = f"{SITE}/trending.html"
    lines = "\n".join(f"• {c['name']}: now {money(c['now'])} ({money(c['fall'])} less)" for c in cats)
    styles = {}
    if len(cats) >= 3:
        styles["countdown"] = {"hooks": ["This week's three biggest drops", "Top 3 golf price drops this week"],
                               "items": [{"name": x["name"], "now": x["now"], "fall": x["fall"], "image": x.get("image")} for x in cats]}
    if not styles:
        return None
    return {"theme": "Week in prices", "link": link, "image": None, "name": "This week",
            "headline": f"{bd['week']} price drops", "sub": "Golf models genuinely cheaper this week", "styles": styles,
            "ig": f"This week in golf prices ⛳ {bd['week']} models got genuinely cheaper. The biggest:\n\n{lines}\n\nLink in bio.",
            "x": f"{bd['week']} golf models got genuinely cheaper this week ⛳\n{link}",
            "tt": f"{bd['week']} golf price drops this week: the biggest three ⛳"}


TRUTHS = [  # relatable golfer truths for the "truth" style; the joke plays out as balls pour in
    ("Me preparing for my first round back after winter", "Every single one is going in the water."),
    ("Packing for a society day with one par 3 over water", "You'll still borrow one off Dave."),
    ("How many balls I think I need for 18 holes", "Optimistic, but fair."),
    ("Me after one lesson and a YouTube video", "Confidence high. Ball supply higher."),
    ("Buying balls before the course with the big lake", "The lake says thank you."),
]


def theme_truth(d, tr):
    balls = [m for m in models() if "ball" in (m.get("type") or m.get("name", "")).lower() and (m.get("gate") or {}).get("passes")
             and not re.search(r"practice|airflow|foam|range|plastic|training|marker|retriever|tee|sleeve|single", m["name"], re.I)
             and float(m.get("minPrice") or 0) >= 12]
    if not balls:
        return None
    m = sorted(balls, key=lambda x: float(x["minPrice"]))[(d.isocalendar()[1]) % min(5, len(balls))]
    setup, deadpan = TRUTHS[d.isocalendar()[1] % len(TRUTHS)]
    link = f"{SITE}/prices/{m['slug']}/"
    return {"theme": "Golfer truths", "link": link, "image": model_image(m), "name": m["name"],
            "headline": money(m["minPrice"]), "sub": m["name"],
            "styles": {"truth": {"name": m["name"], "price": float(m["minPrice"]), "per_dozen": True, "setup": setup, "deadpan": deadpan,
                                 "hooks": [setup]}},
            "ig": f"{setup} ⛳ {deadpan} When you need to restock, the {m['name']} is {money(m['minPrice'])} a dozen right now, compared across multiple UK retailers. Link in bio.",
            "x": f"{setup} ⛳\n{deadpan}\n{m['name']}: {money(m['minPrice'])} a dozen today.\n{link}",
            "tt": f"{setup} ⛳"}


SCHEDULE = [theme_drop, theme_wild_nine, theme_pulse, theme_good, theme_start, theme_guess, theme_week]
FALLBACKS = [theme_truth, lambda d, tr: theme_good(d, tr, rank=1), lambda d, tr: theme_pulse(d, tr, 3), lambda d, tr: theme_good(d, tr, rank=2),
             theme_drop, lambda d, tr: theme_pulse(d, tr, 5)]


# ---------------- picking a style, a hook and a look ----------------

def choose(theme, used_styles, last_palette, L, rnd, social=None):
    options = [(s, sc) for s, sc in theme["styles"].items() if sc]
    fresh = [(s, sc) for s, sc in options if s not in used_styles] or options
    weights = [weight(L, s) * format_boost(social or {}, s) for s, _ in fresh]
    style, sc = rnd.choices(fresh, weights=weights)[0]
    palette = rnd.choice([p for p in V.PALETTES if p != last_palette])
    return style, dict(sc), palette


def pick_hook(options, L, rnd):
    cut = str(now().date() - timedelta(days=30))
    fresh = [h for h in options if L["hooksUsed"].get(h, "0") < cut] or options
    return rnd.choice(fresh)


def kind_of(name):
    n = name.lower()
    for k, word in (("package set", "golf set"), ("set", "golf set"), ("driver", "driver"), ("iron", "set of irons"), ("putter", "putter"),
                    ("wedge", "wedge"), ("hybrid", "hybrid"), ("fairway", "fairway wood"), ("trolley", "trolley"), ("bag", "golf bag"),
                    ("ball", "box of balls"), ("shoe", "pair of golf shoes"), ("watch", "golf watch"), ("rangefinder", "rangefinder")):
        if k in n:
            return word
    return "bit of golf kit"


def build_script(theme, style, sc, L, rnd, tie):
    sc.pop("pov", None)
    if style in ("humour", "headline", "carousel", "sequence"):  # written from the bank: the hook is the set-up
        sc["hook"] = sc.get("hook") or theme["headline"]
        L["hooksUsed"][sc["hook"]] = str(now().date())
        return sc
    if style == "pov":
        label, setup, twist, punch = rnd.choice(POV)
        f = dict(fall=money(sc.get("fall", 0)), name=sc["name"], now=money(sc["price"]), kind=kind_of(sc["name"]))
        sc = {**sc, "label": label, "setup": setup.format(**f), "twist": twist.format(**f), "punch": punch.format(**f)}
        sc["hook"] = sc["setup"]
        sc.pop("hooks", None)
    else:
        hooks = list(sc.pop("hooks", None) or [theme["headline"]])
        if tie:
            hooks = [tie["hook"]]  # a trend tie-in leads with the trend
        sc["hook"] = pick_hook(hooks, L, rnd)
    fam = {"guess": "guess", "stat": "stat", "receipt": "start", "pov": "meme", "expectation": "meme"}.get(style, "price")
    if sc.get("banter") in (None, "meme"):
        sc["banter"] = rnd.choice(BANTER[fam])
    L["hooksUsed"][sc["hook"]] = str(now().date())
    return sc


def captions(t, tie=None, social=None):
    ig = (tie["opener"] + " " if tie else "") + t["ig"]
    ser = S.series_for(t.get("format") or S.fmt_of(t)) if t.get("series") or t.get("format") in ("myth", "budget") else None
    ser = ser or (S.series_for("pricedrop") if t.get("series") == "Price Check Friday" else None)
    yt_title = ((ser["name"] + ": " if ser else "") + t["tt"].rstrip(" ⛳") + " #golf #shorts")[:95]
    extra = live_tags(social or {}, t["ig"] + " " + t["tt"] + " " + (tie["match"] if tie else ""))
    if ser:
        extra = [ser["tag"]] + extra
    if t.get("keywords"):  # TikTok and YouTube are search engines now: plain searchable words in the caption
        t = dict(t, tt=t["tt"] + " | " + t["keywords"])
    ig_tags = " ".join(dict.fromkeys(TAGS.split() + extra))
    tt_tags = " ".join(dict.fromkeys("#golf #golftok #golfuk".split() + extra))[:150]
    return {"instagram": f"{ig}\n\n{ig_tags}", "tiktok": f"{t['tt']} {tt_tags}",
            "youtube": {"title": yt_title, "description": f"{ig.replace('Link in bio.', '')}\n{t['link']}\n#golf #golfuk #shorts"},
            "x": t["x"], "pinterest": {"title": f"{t['headline']}: {t['sub']}"[:99], "description": ig.replace("Link in bio.", "")[:480], "link": t["link"]},
            "bluesky": t["x"], **({"whatsapp": t["whatsapp"]} if t.get("whatsapp") else {})}


def fetch_image(src):
    from PIL import Image
    if not src:
        return None
    try:
        if src.startswith(SITE):
            src = src[len(SITE):]
        if not src.startswith("http"):
            p = ROOT / src.lstrip("/")
            return Image.open(p).convert("RGB") if p.exists() else None
        import urllib.request
        req = urllib.request.Request(src, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return Image.open(BytesIO(r.read())).convert("RGB")
    except Exception as e:
        print("image skipped:", str(src)[:80], e)
        return None


def record_site(url, pid):
    """A phone-sized screen recording of the real page (scripts/agent_screen.mjs)."""
    import subprocess
    out = VIDEOS / f"screen-{pid}"
    try:
        r = subprocess.run(["node", str(ROOT / "scripts" / "agent_screen.mjs"), url, str(out)], capture_output=True, text=True, timeout=240)
        info = json.loads(r.stdout.strip().splitlines()[-1])
        return {"frames": str(out), "taps": info.get("taps", [])} if info.get("frames", 0) > 60 else None
    except Exception as e:
        print("screen recording skipped:", e)
        return None


def build_post(day, theme, style, sc, palette, pid, tie, social=None, sound=None):
    fid = S.fmt_of(theme)
    fmeta = next((f for f in S.formats().get("formats", []) if f["id"] == fid), {})
    extra = {"format": fid, "formatName": fmeta.get("name", fid), "objective": fmeta.get("objective", "reach"),
             "series": sc.get("series") or theme.get("series"), "ep": theme.get("ep")}
    if style == "carousel":  # a swipeable carousel: slides only, no video
        import agent_brush as BR
        slides = [dict(sl, img=fetch_image(sl["product"]["image"])) if sl.get("product") else sl for sl in sc["slides"]]
        paths, quality = BR.carousel(CARDS, pid, slides, bg=sc.get("bg"), series=sc.get("series"), warmth=sc.get("warmth"))
        monday = day - timedelta(days=day.weekday())
        return edited({"id": pid, "date": str(day), "theme": theme["theme"], "style": "carousel", "palette": "brand", "hook": sc["hook"],
                       "trend": None, "card": f"/social/cards/{pid}-s1.jpg", "thumb": f"/social/cards/{pid}-s1.jpg",
                       "slides": [f"/social/cards/{p.name}" for p in paths], "video": None, "link": theme["link"], "hasPrices": bool(theme.get("hasPrices")),
                       "headline": theme["headline"], "sub": theme["sub"], "captions": captions(theme, None, social), "sound": None,
                       "trendingFormats": [], "posted": {}, "quality": quality, **extra})
    if style == "prebuilt":  # a finished film made by Claude (e.g. a launch video): used as made, with its own cover
        import shutil
        for d_ in (VIDEOS, THUMBS, CARDS):
            d_.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / sc["file"], VIDEOS / f"{pid}.mp4")
        shutil.copy(ROOT / sc["cover"], THUMBS / f"{pid}.jpg")
        from PIL import Image as _I
        _I.open(ROOT / sc["cover"]).convert("RGB").resize((1080, 1920)).crop((0, 285, 1080, 1635)).save(CARDS / f"{pid}.jpg", quality=88)
        monday = day - timedelta(days=day.weekday())
        return edited({"id": pid, "date": str(day), "theme": theme["theme"], "style": "prebuilt", "palette": "brand", "hook": sc.get("hook", theme["headline"]),
                       "trend": None, "card": f"/social/cards/{pid}.jpg", "thumb": f"/social/thumbs/{pid}.jpg",
                       "video": f"https://github.com/{REPO}/releases/download/pack-{monday}/{pid}.mp4",
                       "link": theme["link"], "headline": theme["headline"], "sub": theme["sub"], "captions": captions(theme, None, social),
                       "sound": None, "trendingFormats": [], "posted": {}, "quality": [], **extra})
    img = fetch_image(theme.get("image"))
    photo = fetch_image(theme.get("art") or "assets/action-lake-followthrough.jpg") if style in ("stat", "receipt") else None
    imgs = [fetch_image(x.get("image")) for x in sc.get("items", [])] if style == "countdown" else None
    if style == "sitedemo":
        rec = record_site(sc.get("url") or theme["link"], pid)
        if rec:
            sc.update(rec)
        else:  # no recording: fall back to the cinematic product film
            style = "spec"
    still = V.render(style, sc, palette, VIDEOS / f"{pid}.mp4", img=img, photo=photo, imgs=imgs)
    V.feed_card(still, CARDS / f"{pid}.jpg")
    want = None
    if style == "sequence":
        import agent_brush as _BR
        want = _BR.seq_duration(sc)
    quality = V.qc(style, palette, VIDEOS / f"{pid}.mp4", still, img=img, imgs=imgs, card=CARDS / f"{pid}.jpg", expected=want)
    # the thumbnail (cover) for the Reel / Short: its own design, not a frame from the video
    import agent_cine as CINE
    if style in ("humour", "headline", "sequence"):  # Styles A and B: the cover is their strongest frame
        import agent_brush as BR
        quality += BR.thumbnail(THUMBS / f"{pid}.jpg", style, sc)
        monday = day - timedelta(days=day.weekday())
        return edited({"id": pid, "date": str(day), "theme": theme["theme"], "style": style, "palette": "brand", "hook": sc["hook"],
                "trend": tie["match"] if tie else None, "card": f"/social/cards/{pid}.jpg", "thumb": f"/social/thumbs/{pid}.jpg",
                "video": f"https://github.com/{REPO}/releases/download/pack-{monday}/{pid}.mp4",
                "link": theme["link"], "headline": theme["headline"], "sub": theme["sub"], "captions": captions(theme, tie, social),
                "sound": sound, "trendingFormats": [], "posted": {}, "quality": quality, **extra})
    tkind = {"spec": "punch", "thennow": "sunrise", "truth": "clean", "story": "night", "collage": "sunrise",
             "sitedemo": "punch"}.get(style, ["punch", "sunrise", "clean", "night"][sum(map(ord, pid)) % 4])
    # a guessing game never shows the answer on its cover; the cover takes the video's own colours
    quality += CINE.thumbnail(THUMBS / f"{pid}.jpg", thumb_text(sc, style), img=img or (imgs[0] if imgs else None),
                              price=None if style == "guess" else sc.get("price"), kind=sc.get("thumb_style", tkind),
                              tag=sc.get("thumb_tag") or theme.get("name", "")[:28],
                              look=CINE.look_of(sc) if sc.get("look") else None,
                              pal=None if (sc.get("look") or sc.get("thumb_style")) else V.PALETTES.get(palette))
    monday = day - timedelta(days=day.weekday())
    return edited({"id": pid, "date": str(day), "theme": theme["theme"], "style": style, "palette": palette, "hook": sc["hook"],
            "trend": tie["match"] if tie else None, "card": f"/social/cards/{pid}.jpg", "thumb": f"/social/thumbs/{pid}.jpg",
            "video": f"https://github.com/{REPO}/releases/download/pack-{monday}/{pid}.mp4",
            "link": theme["link"], "headline": theme["headline"], "sub": theme["sub"], "captions": captions(theme, tie, social),
            "sound": sound, "trendingFormats": [f for f in STYLE_FORMATS.get(style, []) if (social or {}).get("formats", {}).get(f)], "posted": {},
            "quality": quality, **extra})


AD_LABEL = "#Ad"
PRICE_RX = re.compile(r"£\s?\d")
AD_RX = re.compile(r"^\s*#?ad\b", re.I)


def ad_label(post):
    """ASA/CAP: affiliate content must be obviously identifiable as advertising, with the label upfront
    (John, 20 Nov 2026: "include #Ad as suggested"). Any post that features a specific product and price
    gets "#Ad" at the start of every caption. Posts about games, banter or big events without a product
    price don't need it."""
    c = post.get("captions") or {}
    text = " ".join([str(post.get(k) or "") for k in ("hook", "headline", "sub")] +
                    [v if isinstance(v, str) else " ".join(map(str, v.values())) for v in c.values()])
    if not (post.get("hasPrices") or PRICE_RX.search(text) or re.search(r"/prices/[a-z0-9-]+/?$", str(post.get("link") or ""))):
        return post
    post["ad"] = True
    for k in ("instagram", "tiktok", "x", "bluesky"):
        if isinstance(c.get(k), str) and not AD_RX.search(c[k]):
            c[k] = f"{AD_LABEL} " + c[k]
    for k in ("youtube", "pinterest"):
        if isinstance(c.get(k), dict) and isinstance(c[k].get("description"), str) and not AD_RX.search(c[k]["description"]):
            c[k]["description"] = f"{AD_LABEL} " + c[k]["description"]
    return post


PLURAL_RX = re.compile(r"\b(Irons|Balls|Wedges|Shoes|Gloves|Tees|Woods|Sets|Trousers|Shorts|Putters|Hybrids|Headcovers) (is|has)\b")
TAG_RX = re.compile(r"(?<!\w)#(?!Ad\b)[A-Za-z][A-Za-z0-9_]*")


def _tags_last(text, limit):
    """Every hashtag once, at the end; #Ad stays where it is (the start)."""
    tags = list(dict.fromkeys(TAG_RX.findall(text)))
    body = re.sub(r"[ \t]*\n?[ \t]*" + r"(?:" + TAG_RX.pattern + r")", "", text)
    body = re.sub(r"[ \t]+", " ", body).strip()
    body = re.sub(r"\n{3,}", "\n\n", body)
    return body, tags[:limit]


def tidy_captions(post):
    """Captions read like a person wrote them, and say the same thing on every platform (John, 23 Nov):
    no keyword lists, each hashtag once, plural products take "are", one claim everywhere, TikTok as full as Instagram."""
    c = post.get("captions") or {}
    fix = lambda t: re.sub(r"⛳ ([a-z])(?!ttps?:)", lambda m: "⛳ " + m.group(1).upper(),
                           PLURAL_RX.sub(lambda m: m.group(1) + (" are" if m.group(2) == "is" else " have"),
                                         t.replace("⛳ Good time to buy ⛳ ", "⛳ Good time to buy: ").replace("under its tracked high", "under the highest price we've tracked")))
    for k, v in list(c.items()):
        if isinstance(v, str):
            c[k] = fix(v)
        elif isinstance(v, dict):
            c[k] = {kk: fix(vv) if isinstance(vv, str) else vv for kk, vv in v.items()}
    ig = c.get("instagram")
    if isinstance(ig, str):
        body, tags = _tags_last(ig, 8)
        c["instagram"] = body + ("\n\n" + " ".join(tags) if tags else "")
    tt = c.get("tiktok")
    if isinstance(tt, str):
        tt = re.sub(r" \| [^#\n]*", " ", tt)  # the old keyword list
        body, tags = _tags_last(tt, 5)
        if isinstance(ig, str):
            ig_body, ig_tags = _tags_last(c["instagram"], 8)
            if len(re.sub(r"^#Ad\s*", "", body)) < 110:  # thin: use the Instagram words, which tell the whole joke or deal
                body = ig_body
            tags = list(dict.fromkeys(tags + [t for t in ig_tags if t in ("#TheFourball", "#wildnine")] + ["#golf", "#golftok", "#golfuk"]))[:5]
        m = re.search(r"lowest price we've tracked in (\d+) days", c.get("instagram") or "")
        if m:
            body = body.replace("lowest price we've ever tracked", f"lowest price in {m.group(1)} days")
        body = re.sub(r"\bon golfpriceai\.com/\S*?(?=[,. ]|$)", "on our site (link in bio)", body)  # TikTok captions can't link
        c["tiktok"] = body + (" " + " ".join(tags) if tags else "")
    yt = c.get("youtube")
    if isinstance(yt, dict) and isinstance(yt.get("title"), str):
        t = re.sub(r"\s+", " ", TAG_RX.sub("", yt["title"])).strip(" ⛳#")
        t = re.sub(r"^(The [A-Z][a-z]+): \1,", r"\1,", t)  # "The Fourball: The Fourball, EP 1" -> once
        m = re.search(r"lowest price we've tracked in (\d+) days", yt.get("description") or "")
        if m:
            t = t.replace("lowest price we've ever tracked", f"lowest price in {m.group(1)} days")
        yt["title"] = (t + " #golf #shorts") if len(t) <= 86 else t[:99]
    pin = c.get("pinterest")
    if isinstance(pin, dict) and isinstance(pin.get("title"), str):
        pt = re.sub(r"\?:\s*", "? ", pin["title"]).rstrip(": ").strip()
        head, sep, rest = pt.partition(": ")
        pin["title"] = head + (sep + rest.replace(": ", " · ") if sep else "")
    return post


# Suggested release times, UK time (John, 23 Nov). A starting point from when UK golfers scroll: lunch on
# weekdays, the evening for TikTok and YouTube, early on weekend mornings before the round. Instagram's time
# is when the engine posts it (the 12:30 run). The weekly review adjusts these once real results come in.
POST_TIMES = {  # weekday: (TikTok, YouTube Shorts, X and Bluesky, Pinterest, WhatsApp)
    0: ("19:00", "18:00", "12:30", "20:30", "19:30"), 1: ("19:00", "18:00", "12:30", "20:30", "19:30"),
    2: ("19:30", "18:00", "12:30", "20:30", "19:30"), 3: ("19:00", "18:00", "12:30", "20:30", "19:30"),
    4: ("17:30", "17:00", "12:30", "20:00", "18:00"), 5: ("08:30", "09:00", "08:30", "20:00", "09:00"),
    6: ("19:00", "10:00", "09:30", "20:30", "19:00"),
}


# Timing test (John, 23 Nov 2026): lunchtime (12:30) v evening (19:30). Posts alternate day by day, flipping
# each week so every weekday gets both; learn() compares reach and engagement per slot (each post against its
# own format's average, so a strong format can't skew it) and, after four weeks with 8+ posts each, picks the winner.
SLOTS = ("12:30", "19:30")
TEST_START = date(2026, 11, 24)


def slot_for(d):
    try:
        w = (load_learning().get("slotTest") or {}).get("winner")
    except Exception:
        w = None
    if w in SLOTS:
        return w
    return SLOTS[(d.isocalendar()[1] + d.weekday()) % 2]


def suggest_times(post):
    d = date.fromisoformat(post["date"])
    wd = d.weekday()
    tt, yt, x, pin, wa = POST_TIMES[wd]
    post.setdefault("slot", slot_for(d))
    if post["slot"] == "12:30":  # the lunchtime side of the test: TikTok and YouTube at lunch too
        tt, yt = "12:30", "12:30"
    else:  # the evening side: TikTok and YouTube in the evening too
        tt = tt if tt >= "17:00" else "19:00"
        yt = yt if yt >= "17:00" else "18:00"
    t = {"Instagram": post["slot"] + " (posts itself once ticked)", "TikTok": tt, "YouTube Shorts": yt, "X": x, "Bluesky": post["slot"] + " (posts itself once ticked)", "Pinterest": pin}
    if (post.get("captions") or {}).get("whatsapp"):
        t["WhatsApp"] = wa
    if post.get("reactive"):  # same-day news: straight away beats the perfect hour
        t = {k: "as soon as it's ready" for k in t}
    return t


def edited(post):
    """The Editor reads every caption and on-screen line. Problems hold the post back from auto-posting."""
    post = ad_label(tidy_captions(post))
    post["times"] = suggest_times(post)
    try:
        import agent_editor
        probs = ["quality: " + q for q in (post.get("quality") or [])]  # premium quality gate (agent_video.qc)
        for k, txt in (post.get("captions") or {}).items():
            if isinstance(txt, dict):  # YouTube and Pinterest captions have a title and a description
                txt = " ".join(str(v) for kk, v in txt.items() if kk != "link")
            probs += agent_editor.check_text(str(txt), where=f"{k} caption")
        for k in ("hook", "headline", "sub"):
            probs += agent_editor.check_text(str(post.get(k) or ""), where=k)
        if probs:
            post["editor"] = probs
            print("editor held", post["id"], probs)
    except Exception as e:
        print("editor unavailable:", e)
    return post


# ---------------- plan, moment, post ----------------

def load_plan():
    return json.load(open(PLAN)) if PLAN.exists() else {"posts": []}


def save_plan(plan):
    OUT.mkdir(parents=True, exist_ok=True)
    plan["posts"] = sorted(plan["posts"], key=lambda p: (p["date"], p["id"]))[-60:]
    PLAN.write_text(json.dumps(plan, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def queued_post(q, day, pid, social=None, sound=None):
    """Render a tie-in from data/content-queue.json (moments planner, newsroom, weekly review) in its own style."""
    theme = {"theme": ("Reactive: " if q.get("reactive") else "Trend tie-in: ") + q.get("trend", ""), "link": q.get("link", SITE),
             "image": q.get("image"), "name": q.get("name", ""), "headline": q.get("headline", ""), "sub": q.get("sub", ""),
             "ig": q["ig"], "x": q.get("x", q["ig"]), "tt": q.get("tt", q.get("headline", "")), "format": q.get("format"),
             "keywords": q.get("keywords")}
    meta = {"date", "trend", "status", "link", "image", "headline", "sub", "ig", "x", "tt", "style", "reactive", "source", "why", "format", "keywords"}
    sc = {k: v for k, v in q.items() if k not in meta}
    for pnl in sc.get("panels") or []:  # panel photos: a product image URL or a site photo path
        if isinstance(pnl.get("img"), str):
            pnl["img"] = fetch_image(pnl["img"])
    qstyle = q.get("style") if (q.get("style") in V.STYLES or q.get("style") == "prebuilt") else ("collage" if sc.get("panels") else "story")
    first = (q.get("beats") or q.get("panels") or [{"big": q.get("headline", "")}])[0]
    sc.setdefault("hook", first.get("big") or first.get("text") or q.get("headline", ""))
    print(f"{pid}: queued {'reactive post' if q.get('reactive') else 'trend tie-in'} ({q.get('trend')}) in {qstyle}")
    return build_post(day, theme, qstyle, sc, "gold", pid, None, social, sound)


def plan_week():
    tr = scan_trends()
    social = load_social()
    songs = [f"{x['title']} – {x['artist']}".strip(" –") for x in social.get("songs", [])]
    plan, L = load_plan(), load_learning()
    learn(plan, L)
    today = now().date()
    start = today + timedelta(days=(7 - today.weekday()) % 7 or 7)  # next Monday
    n_days, issue_start = 7, start
    # catch-up: run mid-week with nothing planned for the rest of this week (e.g. the first run after the
    # agents go live), plan tomorrow to Sunday instead, so the week isn't empty (Sunday's run does next week)
    this_sun = today + timedelta(days=6 - today.weekday())
    if today.weekday() < 6 and not any(str(today + timedelta(days=1)) <= p["date"] <= str(this_sun) for p in plan["posts"]):
        start, n_days = today + timedelta(days=1), (this_sun - today).days
        issue_start = today - timedelta(days=today.weekday())
        print(f"catch-up: planning {start} to {this_sun}")
    rnd = random.Random(str(start))
    have = {p["id"] for p in plan["posts"]}
    used_styles, used_keys, last_pal = set(), set(), None
    ties = list(tr.get("tieIns", []))
    schedule = list(SCHEDULE)
    if tr.get("brandsInNews"):  # a brand in the golf news: Thursday features its best deal
        schedule[3] = lambda d, t, b=tr["brandsInNews"][0]: theme_good(d, t, b) or theme_good(d, t)
    key = lambda x: x["theme"] + x["headline"] + x["sub"]
    for p_ in plan["posts"]:  # the last fortnight's posts count as used, so a deal isn't posted twice in two weeks
        if p_["date"] >= str(now().date() - timedelta(days=14)):
            used_keys.add(p_.get("theme", "") + p_.get("headline", "") + p_.get("sub", ""))
    # trend tie-ins written by Claude (weekly review / on request) wait in data/content-queue.json
    queue = (load("content-queue.json") or {}).get("posts", [])
    qdays = {}
    for q in queue:
        qd = q.get("date") or ""
        if str(start) <= qd <= str(start + timedelta(days=n_days - 1)) and q.get("status", "queued") == "queued":
            qdays[qd] = q
    for k in range(n_days):
        day = start + timedelta(days=k)
        i = day.weekday()  # the weekday decides the day's theme (Friday = Price Check Friday, and so on)
        pid = f"{day}-{DAYS[i].lower()}"
        if pid in have:
            continue
        if str(day) in qdays:
            plan["posts"].append(queued_post(qdays[str(day)], day, pid, social, songs[i % len(songs)] if songs else None))
            continue
        fresh_style = lambda x: any(st not in used_styles for st, sc in x["styles"].items() if sc)
        # candidates for today: the usual price-led theme, its fallbacks, and one of each new format
        cands, scratch = {}, {}
        for f in [schedule[i]] + FALLBACKS:
            try:
                x = f(day, tr)
            except Exception as e:
                print("theme skipped:", e); x = None
            if x and key(x) not in used_keys and fresh_style(x):
                cands.setdefault(S.fmt_of(x), x)
        for fid, fn in S.NEW_THEMES.items():
            L2 = copy.deepcopy(L)
            try:
                x = fn(day, L2, random.Random(f"{day}-{fid}"))
            except Exception as e:
                print("format skipped:", fid, e); x = None
            if x and key(x) not in used_keys:
                cands.setdefault(fid, x)
                scratch[fid] = L2
        history = [p.get("format") or "pricedrop" for p in plan["posts"] if p["date"] < str(day)][-13:]
        fid = S.pick_format(history, list(cands), L, day)
        theme = cands.get(fid)
        if fid in scratch:  # keep the bank lines and photo it used, so they aren't repeated
            L["linesUsed"], L["photosUsed"] = scratch[fid].get("linesUsed", {}), scratch[fid].get("photosUsed", [])
            L["fourballPosted"] = scratch[fid].get("fourballPosted", L.get("fourballPosted", []))
        if theme and fid == "pricedrop" and DAYS[i] == "Fri":
            theme = dict(theme, series="Price Check Friday")
        if not theme:
            continue
        used_keys.add(key(theme))
        style, sc, pal = choose(theme, used_styles, last_pal, L, rnd, social)
        tie = ties.pop(0) if ties and i in (0, 3, 5) and style not in ("pov", "guess", "receipt", "humour", "headline", "carousel", "truth", "sequence") else None
        if tie and ((re.search(r"black friday|cyber monday", tie.get("match", ""), re.I) and (day.month, day.day) > (12, 1))
                    or (re.search(r"christmas|secret santa|stocking", tie.get("match", ""), re.I) and (day.month, day.day) > (12, 25))):
            tie = None  # the event is over by the post's day
        sc = build_script(theme, style, sc, L, rnd, tie)
        sound = songs[i % len(songs)] if songs else None
        plan["posts"].append(build_post(day, theme, style, sc, pal, pid, tie, social, sound))
        used_styles.add(style)
        last_pal = pal
        print(f"{pid}: {theme['theme']} [{S.fmt_of(theme)}] as '{style}' ({pal}) hook: {sc['hook']}")
    save_plan(plan)
    save_learning(L)
    write_pack(plan)
    open_issue(plan, issue_start)
    prune_cards()


def moment():
    plan, L = load_plan(), load_learning()
    today = now().date()
    # same-day reactive posts from the newsroom (and anything else queued for today)
    have = {p["id"] for p in plan["posts"]}
    social = load_social()
    for n, q in enumerate((load("content-queue.json") or {}).get("posts", [])):
        if q.get("date") == str(today) and q.get("status", "queued") == "queued":
            pid = f"{today}-{'reactive' if q.get('reactive') else 'tiein'}{n}"
            tname = ("Reactive: " if q.get("reactive") else "Trend tie-in: ") + q.get("trend", "")
            if pid in have or any(p["date"] == str(today) and p.get("theme") == tname for p in plan["posts"]):
                continue  # already made (the weekly plan picked it up from the queue)
            post = queued_post(q, today, pid, social)
            plan["posts"].append(post)
            save_plan(plan)
            write_pack(plan)
            add_to_issue(post)
            try:
                from agent_common import email_owner
                email_owner(f"GolfPrice AI · same-day post ready: {q.get('trend', '')}",
                            f"<p>The newsroom spotted <b>{esc(q.get('trend', ''))}</b> and made a post for today: "
                            f"\u201c{esc(post.get('hook', ''))}\u201d.</p><p>Tick it in the Content pack issue to post it "
                            f"(posting runs at 12:30 and 19:30 UK). If you don't tick it, nothing happens.</p>"
                            f"<p><a href=\"{SITE}/social/pack/\">See it on the pack page</a></p>")
            except Exception as e:
                print("email skipped:", e)
    if any(p["date"] == str(today) and p["id"].endswith("moment") for p in plan["posts"]):
        return
    hd = (load("home-deals.json") or {}).get("deals", [])
    pick = next((d for d in hd if d.get("lowest") and d.get("group") == "clubs"), None)
    if not pick:
        return
    m = next((x for x in models() if x["slug"] == pick["slug"]), None)
    if not m or any(pick["slug"] in p.get("link", "") for p in plan["posts"][-10:]):
        return
    post = moment_post(today, m, pick.get("image"), f"{today}-moment", L)
    plan["posts"].append(post)
    save_plan(plan)
    save_learning(L)
    write_pack(plan)
    add_to_issue(post)


def low_since(m):
    """The date the current lowest price was first seen (from the price history)."""
    hist, low = m.get("history") or [], float(m["minPrice"])
    since = None
    for d, p in hist:
        if float(p) <= low:
            since = since or d
        else:
            since = None
    return since


def moment_post(day, m, image, pid, L, slot=None):
    """A lowest-price moment. Only says "just now" / "new low" when the low is from the last two days;
    otherwise it says what's true: the lowest price we've tracked (John's rules: no fake urgency, 24 Nov 2026)."""
    since = low_since(m)
    fresh = bool(since) and since >= str(day - timedelta(days=2))
    hist = [p for _, p in m.get("history") or []] or [m["minPrice"]]
    link = f"{SITE}/prices/{m['slug']}/"
    lo = money(m["minPrice"])
    if fresh:
        ig = f"Just now ⛳ The {m['name']} has hit the lowest price we've tracked: {lo} across multiple UK retailers. Link in bio."
        x = f"Just now: the {m['name']} hit the lowest price we've tracked, {lo} ⛳\n{link}"
        tt, hooks, stamp, thumb = f"{m['name']} just hit its lowest price ⛳", ["Just now: a new lowest price", "This one just hit rock bottom"], "NEW LOW", "New lowest price"
    else:
        ig = f"Lowest we've tracked ⛳ The {m['name']} is at {lo} across multiple UK retailers, the lowest price we've tracked for it. Link in bio."
        x = f"The {m['name']} is at {lo}, the lowest price we've tracked for it ⛳\n{link}"
        tt, hooks, stamp, thumb = f"{m['name']}: lowest price we've tracked ⛳", ["The lowest price we've tracked"], "LOWEST WE'VE TRACKED", "Lowest we've tracked"
    theme = {"theme": "Moment", "link": link, "image": image, "name": m["name"], "headline": lo, "sub": m["name"], "ig": ig, "x": x, "tt": tt}
    sc = {"name": m["name"], "from": max(hist), "price": float(m["minPrice"]), "fall": max(hist) - float(m["minPrice"]),
          "hooks": hooks, "stamp": stamp, "thumb": thumb}
    rnd = random.Random(str(day) + m["slug"])
    sc = build_script(theme, "reveal", sc, L, rnd, None)
    post = build_post(day, theme, "reveal", sc, rnd.choice(list(V.PALETTES)), pid, None)
    if slot:
        post["slot"] = slot
        post["times"] = suggest_times(post)
    return post


def gh(method, path, body=None):
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if os.environ.get("GITHUB_ACTIONS") != "true" or not tok or not repo:
        print("(not in GitHub Actions: issue step skipped)")
        return None
    s, _, txt = http(f"https://api.github.com/repos/{repo}{path}", method=method, body=body,
                     headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
    try:
        return json.loads(txt) if txt else None
    except ValueError:
        return None


def issue_line(p):
    d = date.fromisoformat(p["date"])
    tr = f" · tied to {p['trend']}" if p.get("trend") else ""
    tr += f" · sound: {p['sound']}" if p.get("sound") else ""
    kind = f"{p.get('formatName') or p.get('style')} ({p.get('style')}, for {p.get('objective', 'reach')})"
    ser = f" · series: {p['series']}" if p.get("series") else ""
    return f"- [ ] **{p['id']}** · {DAYS[d.weekday()]} {d.day} {d.strftime('%b')} · {kind}: \"{p.get('hook')}\" ({p['theme']}{tr}{ser})"


def open_issue(plan, start):
    title = f"Content pack: w/c {start.day} {start.strftime('%b %Y')}"
    gh("POST", "/labels", {"name": "content-pack", "color": "3fae29", "description": "Weekly social posts to approve"})
    found = gh("GET", "/issues?state=open&labels=content-pack&per_page=20") or []
    if any(i.get("title") == title for i in found):
        return
    for old in found:
        gh("PATCH", f"/issues/{old['number']}", {"state": "closed"})
    week = [p for p in plan["posts"] if start <= date.fromisoformat(p["date"]) < start + timedelta(days=7)]
    body = ("Tick a post to approve it. Ticked posts go to Instagram automatically (as a Reel) at 12:30 or 19:30 UK on their day.\n"
            f"Watch the videos and copy captions for TikTok, YouTube and X in the pack: {SITE}/social/pack/\n\n"
            + "\n".join(issue_line(p) for p in week)
            + "\n\nMoments (new lowest prices) get added here during the week.")
    gh("POST", "/issues", {"title": title, "body": body, "labels": ["content-pack"]})


def add_to_issue(post):
    found = gh("GET", "/issues?state=open&labels=content-pack&per_page=5") or []
    if found:
        i = found[0]
        gh("PATCH", f"/issues/{i['number']}", {"body": (i.get("body") or "") + "\n" + issue_line(post)})
        return
    # No open pack issue (John closes them once ticked): give the post its own issue so there is always a box to tick.
    d = date.fromisoformat(post["date"])
    gh("POST", "/issues", {"title": f"Same-day post: {DAYS[d.weekday()]} {d.day} {d.strftime('%b')}",
                           "body": "Tick to approve. Ticked posts go to Instagram and Bluesky at their time today. "
                                   "If you don't tick it, nothing happens.\n"
                                   f"Watch the video and copy captions in the pack: {SITE}/social/pack/\n\n" + issue_line(post),
                           "labels": ["content-pack"]})


def approved_ids():
    ids = set()
    for i in gh("GET", "/issues?state=all&labels=content-pack&per_page=15") or []:
        ids.update(re.findall(r"- \[[xX]\] \*\*([\w-]+)\*\*", i.get("body") or ""))
    return ids


def token_warning(status, txt):
    if status in (400, 401, 403) and "token" in (txt or "").lower():
        from agent_common import email_owner
        email_owner("GolfPrice AI · Instagram token needs renewing",
                    "<p>The content engine couldn't post to Instagram because the access token has expired or been revoked. "
                    "Generate a new one (Meta developer dashboard > your app > Use cases > Customize > API setup with Unified login > Generate access tokens) and paste it into "
                    "the IG_ACCESS_TOKEN secret on GitHub. Today's post is still in the pack to post by hand.</p>")


def reel_container(uid, tok, p):
    """Upload the post's video as an Instagram Reel (from this week's GitHub release) and wait until it's ready."""
    repo = os.environ.get("GITHUB_REPOSITORY", "557tggwysr-ui/golfpriceai-site")
    d = date.fromisoformat(p["date"])
    monday = d - timedelta(days=d.weekday())
    url = f"https://github.com/{repo}/releases/download/pack-{monday}/{p['id']}.mp4"
    s, _, txt = http(f"{ig_api()}/{uid}/media", method="POST",
                     body={"media_type": "REELS", "video_url": url, "caption": p["captions"]["instagram"],
                           "share_to_feed": "true", "cover_url": SITE + (p.get("thumb") or p["card"]), "access_token": tok})
    cid = (json.loads(txt or "{}") or {}).get("id") if s == 200 else None
    if not cid:
        print("reel upload not accepted, using the image instead:", s, (txt or "")[:200])
        return None
    import time
    for _ in range(30):  # Instagram processes the video first (usually under a minute)
        time.sleep(10)
        s, _, txt = http(f"{ig_api()}/{cid}?fields=status_code&access_token={tok}")
        code = (json.loads(txt or "{}") or {}).get("status_code")
        if code == "FINISHED":
            return cid
        if code in ("ERROR", "EXPIRED"):
            print("reel processing failed:", txt[:200])
            return None
    return None


def carousel_container(uid, tok, p):
    """An Instagram carousel: one container per slide, then the carousel itself."""
    kids = []
    for url in p["slides"][:10]:
        s, _, txt = http(f"{ig_api()}/{uid}/media", method="POST",
                         body={"image_url": SITE + url, "is_carousel_item": "true", "access_token": tok})
        cid = (json.loads(txt or "{}") or {}).get("id") if s == 200 else None
        if not cid:
            print("carousel slide not accepted:", s, (txt or "")[:200])
            return None
        kids.append(cid)
    s, _, txt = http(f"{ig_api()}/{uid}/media", method="POST",
                     body={"media_type": "CAROUSEL", "children": ",".join(kids), "caption": p["captions"]["instagram"], "access_token": tok})
    return (json.loads(txt or "{}") or {}).get("id") if s == 200 else None


BSKY = "https://bsky.social/xrpc/"


def _bsky(method, body=None, token=None, raw=None, ctype="application/json", base=BSKY, get=False):
    import urllib.request
    data = None if get else (raw if raw is not None else json.dumps(body or {}).encode())
    req = urllib.request.Request(base + method, data=data, method="GET" if get else "POST")
    req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b"{}")


def _bsky_facets(text):
    """Tappable hashtags and links (Bluesky counts in bytes)."""
    out, b = [], text.encode("utf-8")
    for m in re.finditer(rb"(?<![\w/])#(\w+)", b):
        out.append({"index": {"byteStart": m.start(), "byteEnd": m.end()}, "features": [{"$type": "app.bsky.richtext.facet#tag", "tag": m.group(1).decode()}]})
    for m in re.finditer(rb"https?://[^\s]+", b):
        out.append({"index": {"byteStart": m.start(), "byteEnd": m.end()}, "features": [{"$type": "app.bsky.richtext.facet#link", "uri": m.group(0).decode()}]})
    return out


def _fetch(url):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "GolfPriceAI-bot"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def bluesky_post(p):
    """The same approved post on Bluesky (John, 23 Nov 2026): the video itself (or up to 4 carousel slides),
    with the Bluesky caption, tappable link and hashtags. Uses the BLUESKY_HANDLE / BLUESKY_APP_PASSWORD
    secrets the price-drop poster already uses. Returns True when posted."""
    import time
    handle, pw = os.environ.get("BLUESKY_HANDLE"), os.environ.get("BLUESKY_APP_PASSWORD")
    if not (handle and pw):
        print("(no Bluesky secrets: skipped)", p["id"]); return False
    s = _bsky("com.atproto.server.createSession", {"identifier": handle, "password": pw})
    tok, did = s["accessJwt"], s["did"]
    text = (p["captions"].get("bluesky") or p["captions"].get("x") or "")
    if len(text) > 295:  # Bluesky's limit is 300 characters: keep the link, trim the words
        link = (re.search(r"https?://\S+", text) or [None])[0]
        words = re.sub(r"\s*https?://\S+", "", text)
        text = (words[: 290 - (len(link) + 1 if link else 0)].rsplit(" ", 1)[0] + "…") + (("\n" + link) if link else "")
    embed = None
    if p.get("slides"):
        imgs = []
        for n, u in enumerate(p["slides"][:4]):
            raw = _fetch(SITE + u)
            if len(raw) > 950_000:
                from PIL import Image
                im = Image.open(BytesIO(raw)).convert("RGB"); im.thumbnail((1350, 1350)); buf = BytesIO(); im.save(buf, "JPEG", quality=82); raw = buf.getvalue()
            blob = _bsky("com.atproto.repo.uploadBlob", token=tok, raw=raw, ctype="image/jpeg")["blob"]
            imgs.append({"image": blob, "alt": f"{p.get('hook', '')}, slide {n + 1}"[:300]})
        embed = {"$type": "app.bsky.embed.images", "images": imgs}
    elif p.get("video"):
        raw = _fetch(p["video"])
        blob = None
        try:  # Bluesky's video service: processes the video so it plays straight away
            pds = next(x["serviceEndpoint"] for x in s.get("didDoc", {}).get("service", []) if x.get("id") == "#atproto_pds")
            host = re.sub(r"^https?://", "", pds).rstrip("/")
            svc = _bsky(f"com.atproto.server.getServiceAuth?aud=did:web:{host}&lxm=com.atproto.repo.uploadBlob&exp={int(time.time()) + 1800}",
                        token=tok, get=True)["token"]
            import urllib.error
            try:
                job = _bsky(f"app.bsky.video.uploadVideo?did={did}&name={p['id']}.mp4", token=svc, raw=raw, ctype="video/mp4", base="https://video.bsky.app/xrpc/")
            except urllib.error.HTTPError as e:  # already uploaded earlier: the reply still names the job
                job = json.loads(e.read() or b"{}")
            jid = job.get("jobId") or (job.get("jobStatus") or {}).get("jobId")
            for _ in range(60):
                st = _bsky(f"app.bsky.video.getJobStatus?jobId={jid}", base="https://video.bsky.app/xrpc/", get=True).get("jobStatus", {})
                if st.get("blob"):
                    blob = st["blob"]; break
                if st.get("state") == "JOB_STATE_FAILED":
                    break
                time.sleep(5)
        except Exception as e:
            print("bluesky video service:", e)
        if not blob:  # fall back to a plain upload
            blob = _bsky("com.atproto.repo.uploadBlob", token=tok, raw=raw, ctype="video/mp4")["blob"]
        embed = {"$type": "app.bsky.embed.video", "video": blob, "aspectRatio": {"width": 1080, "height": 1920},
                 "alt": (p.get("hook") or "")[:300]}
    record = {"$type": "app.bsky.feed.post", "text": text, "facets": _bsky_facets(text), "langs": ["en-GB"],
              "createdAt": now().strftime("%Y-%m-%dT%H:%M:%S.000Z")}
    if embed:
        record["embed"] = embed
    r = _bsky("com.atproto.repo.createRecord", {"repo": did, "collection": "app.bsky.feed.post", "record": record}, token=tok)
    p["posted"]["bluesky"] = now().strftime("%Y-%m-%dT%H:%MZ")
    p["posted"]["bluesky_id"] = r.get("uri")
    print("posted to bluesky:", p["id"])
    return True


def post_today():
    plan = load_plan()
    from zoneinfo import ZoneInfo
    uk = now().astimezone(ZoneInfo("Europe/London"))
    today = str(uk.date())
    run = "12:30" if uk.hour < 16 else "19:30"
    # GitHub sometimes starts a timed run hours late (a 19:30 run arrived at 03:07 on 25 Nov). A late
    # timed run must never post in the middle of the night: only post near the slot. Manual runs always post.
    mins = uk.hour * 60 + uk.minute
    if os.environ.get("GITHUB_EVENT_NAME") == "schedule" and not (11 * 60 + 45 <= mins < 16 * 60 or 18 * 60 + 45 <= mins < 23 * 60):
        print(f"timed run arrived at {uk:%H:%M} UK, outside the posting windows: not posting"); return
    todays = [p for p in plan["posts"] if p["date"] == today
              and not (p["posted"].get("instagram") and p["posted"].get("bluesky"))
              and (run == "19:30" or p.get("slot", "12:30") == "12:30")]
    if not todays:
        print("nothing to post today"); return
    ok = approved_ids()
    held = set((load("agents/editor-holds.json") or {}).get("posts", []))  # Claude's review
    uid, tok = os.environ.get("IG_USER_ID"), os.environ.get("IG_ACCESS_TOKEN")
    for p in todays:
        if p["id"] not in ok:
            print("not approved:", p["id"]); continue
        if p.get("editor") or p["id"] in held:
            print("held by the editor:", p["id"], p.get("editor") or "see editor-holds.json"); continue
        if not p["posted"].get("bluesky"):
            try:
                bluesky_post(p)
            except Exception as e:  # Bluesky trouble never stops Instagram
                print("bluesky failed:", p["id"], str(e)[:300])
        if p["posted"].get("instagram"):
            continue
        if not (uid and tok):
            print("(no Instagram secrets: approved post left for manual posting)", p["id"]); continue
        cid = carousel_container(uid, tok, p) if p.get("slides") else reel_container(uid, tok, p)  # carousel, or the video as a Reel
        if not cid:
            s, _, txt = http(f"{ig_api()}/{uid}/media", method="POST",
                             body={"image_url": SITE + p["card"], "caption": p["captions"]["instagram"], "access_token": tok})
            cid = (json.loads(txt or "{}") or {}).get("id") if s == 200 else None
        else:
            s, txt = 200, ""
        if not cid:
            print("instagram container failed:", s, txt[:300])
            token_warning(s, txt)
            continue
        s, _, txt = http(f"{ig_api()}/{uid}/media_publish", method="POST",
                         body={"creation_id": cid, "access_token": tok})
        if s == 200:
            p["posted"]["instagram"] = now().strftime("%Y-%m-%dT%H:%MZ")
            p["posted"]["instagram_id"] = (json.loads(txt or "{}") or {}).get("id")
            print("posted to instagram:", p["id"])
        else:
            print("instagram publish failed:", s, txt[:300])
            token_warning(s, txt)
    save_plan(plan)
    write_pack(plan)


def prune_cards():
    cut = now().date() - timedelta(days=KEEP_CARDS_DAYS)
    for f in list(CARDS.glob("*.jpg")) + list(THUMBS.glob("*.jpg")):
        try:
            if date.fromisoformat(f.name[:10]) < cut:
                f.unlink()
        except ValueError:
            pass


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


# Skits to film yourself (optional). The funniest golf reels are real people doing relatable things;
# the agents can't film, so each week the pack suggests two 10-second skits John could shoot on a phone.
SKITS = [
    ("Preparing for my first round back after winter", "Tip a bucket of range balls into your golf bag. Keep going. Then a bit more.",
     "One take, phone on a tripod or a mate holding it. The caption does the talking.", "Restock for less: link in bio ⛳"),
    ("Realistic range session", "Hit three balls with a tree branch (or a bin bag) hanging in front of you, completely unbothered.",
     "Deadpan. Don't laugh until the third ball.", "Plan for the inevitable ⛳"),
    ("Me checking the price before I buy", "Hold a driver, look at your phone, slowly put the driver down and pick up a cheaper one.",
     "Close-up of your face for the 'oh' moment, then a screen recording of golfpriceai.com.", "Full Swing. Not full price ⛳"),
    ("The society WhatsApp the night before", "Read out real-sounding group messages in a dramatic voice over shots of your bag.",
     "No real names or numbers on screen.", "Every society has one ⛳"),
    ("How I tell my partner about a new driver", "Hide the head cover behind your back, then reveal the price on your phone first.",
     "Keep it affectionate, never mean.", "It was on offer, honest ⛳"),
    ("First tee nerves v last hole confidence", "Split screen: shaking hands on the first tee, strutting on the 18th.",
     "Two clips, side by side in the editor.", "Every round, every time ⛳"),
]


def news_html():
    """What the newsroom spotted (so John sees same-day chances even without the Claude token)."""
    n = load("agents/newsroom.json") or {}
    c = n.get("candidates") or []
    if not c:
        return ""
    rows = "".join(f"<li><b>{esc(x['kind'])}</b>{(' (' + esc(x['watch']) + ')') if x.get('watch') else ''}: "
                   f"{esc(x['title'])} <span class='tip'>{esc(x['source'])}</span></li>" for x in c[:6])
    return (f"<div class='trends'><h2>In the news ({esc(n.get('lastScan', ''))})</h2><p class='tip'>Fresh, safe stories the newsroom "
            f"spotted. Same-day posts for the best of them appear above when Claude is switched on (setup step 11).</p><ul>{rows}</ul></div>")


def skit_html(today):
    wk = today.isocalendar()[1]
    picks = [SKITS[(wk * 2) % len(SKITS)], SKITS[(wk * 2 + 1) % len(SKITS)]]
    rows = "".join(f"<li><b>{esc(a)}</b>: {esc(b)} <span class='tip'>{esc(c)} Caption ending: \u201c{esc(d)}\u201d</span></li>" for a, b, c, d in picks)
    return ("<div class='trends'><h2>Film it yourself (optional)</h2><p class='tip'>Two 10-second skits for this week, in the style of the "
            "funniest golf reels. Shoot on your phone, add a trending sound, post when you like. Only film people who are happy to be in it.</p>"
            f"<ul>{rows}</ul></div>")


def write_pack(plan):
    today = now().date()
    upcoming = [p for p in plan["posts"] if date.fromisoformat(p["date"]) >= today - timedelta(days=1)]
    try:
        tr = json.loads(TRENDS.read_text(encoding="utf-8"))
    except Exception:
        tr = {}
    cards = []
    for p in upcoming:
        d = date.fromisoformat(p["date"])
        c = p["captions"]
        blocks = [("Instagram", c["instagram"]), ("TikTok", c["tiktok"]), ("YouTube Shorts title", c["youtube"]["title"]),
                  ("YouTube description", c["youtube"]["description"]), ("X", c["x"]),
                  ("Pinterest title", c["pinterest"]["title"]), ("Pinterest description", c["pinterest"]["description"])]
        if c.get("whatsapp"):
            blocks.append(("WhatsApp (send to your group, and Stories with a link sticker)", c["whatsapp"]))
        done = " · ".join(f"{k} ✓" for k in p.get("posted", {}) if not k.endswith("_id"))
        trend = f" · trend: {esc(p['trend'])}" if p.get("trend") else ""
        media = (f"<div class='slides'>" + "".join(f"<img src='{u}' alt='Slide {n + 1}' loading='lazy'>" for n, u in enumerate(p["slides"])) + "</div>"
                 if p.get("slides") else f"<video src=\"{p['video']}\" poster=\"{p['card']}\" controls playsinline preload=\"none\"></video>")
        cards.append(f"""<section class="post">{media}
<div><p class="when">{DAYS[d.weekday()]} {d.day} {d.strftime('%b')} · {esc(p.get('formatName') or p['theme'])} · {esc(p.get('style', ''))} · for {esc(p.get('objective', 'reach'))}{(' · ' + esc(p['series'])) if p.get('series') else ''}{trend} <span class="done">{done}</span></p>
{('<p class="tip" style="background:#fde8e8">⛔ Held by the Editor, won\'t auto-post: ' + esc(' '.join(p['editor'])) + '</p>') if p.get('editor') else ''}<h2>“{esc(p.get('hook', p['headline']))}”</h2><p class="sub">{esc(p['sub'])}</p>
<p class="dl">{('<a href="' + p['video'] + '">Download video</a> · ') if p.get('video') else ('Download slides: ' + ' · '.join(f'<a href="{u}" download>Slide {n + 1}</a>' for n, u in enumerate(p.get('slides') or [])) + ' · ')}<a href="{p.get('thumb') or p['card']}" download>Download thumbnail (cover)</a> · <a href="{p['card']}" download>Download feed image</a></p>
{('<img src="' + p['thumb'] + '" alt="Thumbnail for ' + esc(p.get('hook', '')) + '" style="width:120px;border-radius:10px;margin:6px 0">') if p.get('thumb') else ''}
<p class="times"><b>Suggested release times (UK){(" · timing test: the " + ("lunchtime" if p.get("slot") == "12:30" else "evening") + " side") if p.get("slot") and not (load_learning().get("slotTest") or {}).get("winner") else ""}:</b> {' · '.join(f'{esc(k)} <b>{esc(v)}</b>' for k, v in (p.get('times') or suggest_times(p)).items())}</p>
{''.join(f'<details><summary>{k}{(" · post at " + esc((p.get("times") or suggest_times(p)).get(k.split(" (")[0].replace(" title", "").replace(" description", "").replace("YouTube", "YouTube Shorts").replace("YouTube Shorts Shorts", "YouTube Shorts"), "").split(" (")[0])) if (p.get("times") or suggest_times(p)).get(k.split(" (")[0].replace(" title", "").replace(" description", "").replace("YouTube", "YouTube Shorts").replace("YouTube Shorts Shorts", "YouTube Shorts")) else ""}</summary><textarea readonly>{esc(v)}</textarea><button onclick="copy(this)">Copy</button></details>' for k, v in blocks)}
<p class="tip">{('Trending sound (approved for business): <b>' + esc(p['sound']) + '</b>. Search it in the app when you schedule.') if p.get('sound') else ('Slides: post them as a carousel on Instagram, and in photo mode on TikTok (add a sound from the commercial library there).' if p.get('slides') else 'The video has its own music. Adding a trending sound in TikTok? Turn the original audio down there.')}{(' · Rides the trend: ' + esc(', '.join(p['trendingFormats']))) if p.get('trendingFormats') else ''}</p>
<p class="link">Link: <a href="{p['link']}">{esc(p['link'])}</a></p></div></section>""")
    social = load_social()
    trend_html = ""
    if social:
        fm = sorted((social.get("formats") or {}).items(), key=lambda x: -x[1])
        trend_html += ("<details class='trends' open><summary>Trending right now (UK)</summary><ul>"
                       + (f"<li><b>Hashtags:</b> {esc(' '.join(t['tag'] for t in social.get('hashtags', [])[:15]))}</li>" if social.get("hashtags") else "")
                       + (f"<li><b>Sounds for business:</b> {esc('; '.join(x['title'] + ' – ' + x['artist'] for x in social.get('songs', [])[:8]))}</li>" if social.get("songs") else "")
                       + (f"<li><b>Formats golfers are watching:</b> {esc(', '.join(f'{k} ({v})' for k, v in fm if v)[:300])}</li>" if fm else "")
                       + (f"<li><b>Golf videos doing well:</b> {esc(' | '.join(social.get('golfVideos', [])[:5]))}</li>" if social.get("golfVideos") else "")
                       + (f"<li><b>What the UK is watching:</b> {esc(' | '.join(social.get('watching', [])[:5]))}</li>" if social.get("watching") else "")
                       + (f"<li><b>Golfers are talking about:</b> {esc(' | '.join(social.get('golfTalk', [])[:5]))}</li>" if social.get("golfTalk") else "")
                       + "</ul></details>")
    if tr.get("headlines") or tr.get("tieIns"):
        trend_html += ("<details class='trends'><summary>This week's news and calendar</summary><ul>"
                      + "".join(f"<li><b>Tie-in:</b> {esc(t['hook'])} ({esc(t['match'])})</li>" for t in tr.get("tieIns", []))
                      + "".join(f"<li>{esc(h)}</li>" for h in tr.get("headlines", [])[:8]) + "</ul></details>")
    html = f"""<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Content pack · GolfPrice AI</title>
<style>body{{font:16px system-ui,sans-serif;background:#f4f1ea;color:#14211a;padding:16px;max-width:900px;margin:auto}}
h1{{font-size:22px}}.post{{display:grid;grid-template-columns:220px 1fr;gap:16px;background:#fff;border-radius:14px;padding:14px;margin:12px 0}}
.post video{{width:100%;border-radius:10px;background:#14211a;aspect-ratio:9/16}}h2{{margin:4px 0;font-size:20px}}.when{{color:#3fae29;font-weight:700;margin:0}}
.sub{{color:#555;margin:2px 0 8px}}.times{{background:#eef7ec;border-radius:10px;padding:8px 10px;font-size:14px;line-height:1.6}}.done{{color:#888;font-weight:400}}details{{margin:6px 0}}summary{{cursor:pointer;font-weight:600}}
textarea{{width:100%;min-height:90px;font:14px system-ui;border-radius:8px;border:1px solid #ccc;padding:8px;box-sizing:border-box}}
button{{background:#14211a;color:#fff;border:0;border-radius:8px;padding:6px 14px;font-weight:600}}.dl,.link,.tip{{font-size:14px}}.tip{{color:#777}}
.trends{{background:#fff;border-radius:14px;padding:10px 14px}}.slides{{display:flex;gap:6px;overflow-x:auto}}.slides img{{width:180px;border-radius:8px}}@media(max-width:600px){{.post{{grid-template-columns:1fr}}.post video{{max-width:260px}}}}</style></head><body>
<h1>Content pack</h1><p>Updated {now().strftime('%a %d %b %H:%M')} UTC. Approve posts by ticking them in the "Content pack" GitHub issue; ticked posts go to Instagram on their day. Download the videos for TikTok, Reels and Shorts and schedule them in each app.</p>
{trend_html}
{''.join(cards) or '<p>No posts planned yet.</p>'}
{news_html()}
{skit_html(today)}
<script>function copy(b){{const t=b.previousElementSibling;t.select();navigator.clipboard.writeText(t.value);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)}}</script>
</body></html>"""
    PACK.parent.mkdir(parents=True, exist_ok=True)
    PACK.write_text(html, encoding="utf-8")


def _has_audio(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
                       capture_output=True, text=True)
    return "audio" in (r.stdout or "")


def _episode_script(ep, dur):
    """The episode's script again, for placing its sound effects; picks the version (with or without the
    optional cutaway) whose length matches the video that was made."""
    import agent_brush as BR
    q = next((x for x in S.bank().get("sequences", []) if (x.get("cover") or {}).get("ep") == ep), None)
    if not q:
        return {}
    full = dict(q, outro=True)
    trimmed = dict(full, shots=[sh for sh in q.get("shots", []) if not sh.get("optional")])
    return min((full, trimmed), key=lambda s: abs(BR.seq_duration(s) - dur))


def add_sound_to_week(redo=False):
    """Videos already in this week's pack that were made silent get the soundtrack (scripts/agent_audio.py).
    Only posts not yet posted; the workflow re-uploads them to the week's release afterwards."""
    plan = load_plan()
    today = now().date()
    VIDEOS.mkdir(parents=True, exist_ok=True)
    for p in plan["posts"]:
        if not p.get("video") or p.get("style") in ("carousel", "prebuilt") or p.get("posted", {}).get("instagram"):
            continue
        if date.fromisoformat(p["date"]) < today:
            continue
        d = date.fromisoformat(p["date"]); monday = d - timedelta(days=d.weekday())
        path = VIDEOS / f"{p['id']}.mp4"
        r = subprocess.run(["gh", "release", "download", f"pack-{monday}", "-R", REPO, "-p", path.name, "-D", str(VIDEOS), "--clobber"],
                           capture_output=True, text=True)
        if r.returncode or not path.exists():
            print("couldn't fetch", path.name, (r.stderr or "")[:200]); continue
        if _has_audio(path) and not redo:
            print("already has sound:", path.name); path.unlink(); continue
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                                   capture_output=True, text=True).stdout or 0)
        script = _episode_script(p.get("ep"), dur) if p.get("style") == "sequence" else {}
        V.add_sound(p.get("style"), script, dur, path)
        print("sound added:", path.name, "(" + ("ok" if _has_audio(path) else "still silent") + ")")


def remake_guess():
    """Remakes the unposted "Higher or lower" videos already in the plan with the new reveal (John, 23 Nov 2026):
    the guess above today's price, "UNDER!" in green. Updates their captions' guess figure to match; the
    workflow re-uploads the videos to the week's pack."""
    plan = load_plan()
    by_name = {m["name"]: m for m in models()}
    VIDEOS.mkdir(parents=True, exist_ok=True)
    for p in plan["posts"]:
        if p.get("style") != "guess" or p.get("posted", {}).get("instagram") or p["date"] < str(now().date()):
            continue
        m = by_name.get(p.get("sub"))
        if not m:
            print("model not found for", p["id"], p.get("sub")); continue
        price = float(m["minPrice"])
        line = max(5, round(price * random.Random(m["slug"]).choice([1.15, 1.2, 1.3]) / 5) * 5)
        old = re.search(r"over or under (£[\d,]+(?:\.\d\d)?)", json.dumps(p["captions"], ensure_ascii=False))
        sc = {"name": m["name"], "price": price, "line": line, "hook": p["hook"]}
        V.render("guess", sc, p.get("palette", "clubhouse"), VIDEOS / f"{p['id']}.mp4", img=fetch_image(model_image(m)))
        if old:
            new = money(line)
            for k, v in p["captions"].items():
                if isinstance(v, str):
                    p["captions"][k] = v.replace(old.group(1), new)
                elif isinstance(v, dict):
                    p["captions"][k] = {kk: vv.replace(old.group(1), new) if isinstance(vv, str) else vv for kk, vv in v.items()}
        print("remade:", p["id"], m["name"], money(price), "guess", money(line))
    # price moments: rebuilt with today's price; dropped if it's no longer the lowest we've tracked
    by_slug = {m["slug"]: m for m in models()}
    L = load_learning()
    for n, p in enumerate(plan["posts"]):
        if p.get("theme") != "Moment" or p.get("posted", {}).get("instagram") or p["date"] < str(now().date()):
            continue
        m = by_slug.get(p.get("link", "").rstrip("/").split("/")[-1])
        if not m or money(m["minPrice"]) != p.get("headline"):
            print("moment no longer true, dropped:", p["id"]); plan["posts"][n] = {**p, "date": "2000-01-01", "dropped": True}; continue
        img = next((d.get("image") for d in (load("home-deals.json") or {}).get("deals", []) if d.get("slug") == m["slug"]), None) or model_image(m)
        new = moment_post(date.fromisoformat(p["date"]), m, img, p["id"], L, slot=p.get("slot"))
        plan["posts"][n] = {**new, "posted": p.get("posted", {})}
        print("remade moment:", p["id"], m["name"], new["hook"])
    save_learning(L)
    # tips carousels: rebuilt from the bank, so they pick up products on the slides and the warming colours
    for p in plan["posts"]:
        if p.get("style") != "carousel" or p.get("theme") != "Tips carousel" or p.get("posted", {}).get("instagram") or p["date"] < str(now().date()):
            continue
        item = next((c for c in S.bank().get("carousels", []) if S.strip_marks(c["title"]) == p.get("headline")), None)
        if not item or not (item.get("warmth") or any(len(sl) > 2 for sl in item.get("slides", []))):
            continue
        theme = S._carousel_theme(item, "tips", {"linesUsed": {}, "photosUsed": []}, random.Random(p["id"]))
        sc = theme["styles"]["carousel"]
        new = build_post(date.fromisoformat(p["date"]), theme, "carousel", sc, "brand", p["id"], None, load_social())
        for k in ("slides", "card", "thumb", "captions", "hasPrices", "ad", "editor", "quality", "link", "sub"):
            if k in new:
                p[k] = new[k]
        p["times"] = suggest_times(p)
        print("remade carousel:", p["id"], [sl.get("product", {}).get("name") for sl in sc["slides"] if sl.get("product")])
    save_plan(plan)
    write_pack(plan)


if __name__ == "__main__":
    mode = (sys.argv[1] if len(sys.argv) > 1 else "plan").lower()
    {"plan": plan_week, "moment": moment, "post": post_today, "sound": add_sound_to_week, "resound": lambda: add_sound_to_week(redo=True), "remake": remake_guess}[mode]()
