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
import sys
from datetime import date, timedelta
from html import unescape
from io import BytesIO

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, SITE, load, models, http, now)
import agent_video as V

PLAN = OUT / "content-plan.json"
LEARN = OUT / "content-learning.json"
TRENDS = OUT / "trends.json"
SOCIAL = OUT / "social-trends.json"   # live hashtags, sounds and formats (scripts/agent_trends.mjs)
STYLE_FORMATS = {"pov": ["pov", "day in the life"], "countdown": ["tier list", "top 3 / countdown"], "guess": ["guess the price", "challenge"],
                 "expectation": ["expectation v reality", "reaction"], "receipt": ["budget", "tried it"], "stat": ["budget"], "reveal": ["tried it"]}
TOPIC_WORDS = re.compile(r"black ?friday|cyber ?monday|christmas|gift|secret ?santa|boxing ?day|new ?year|fathers? ?day|summer|winter|spring|sale|deals?|sport", re.I)
CARDS = ROOT / "social" / "cards"
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
        s, _, txt = http(f"https://graph.instagram.com/v21.0/{mid}/insights?metric=reach,likes,comments,saved,shares&access_token={tok}")
        if s != 200:
            continue
        vals = {m["name"]: (m.get("values") or [{}])[0].get("value", 0) for m in json.loads(txt).get("data", [])}
        reach = max(1, vals.get("reach", 0))
        score = (vals.get("likes", 0) + 2 * vals.get("comments", 0) + 3 * vals.get("saved", 0) + 3 * vals.get("shares", 0)) / reach
        L["posts"][p["id"]] = {"style": p.get("style"), "palette": p.get("palette"), "score": round(score, 4), "reach": vals.get("reach", 0)}
        st = L["styles"].setdefault(p.get("style"), {"n": 0, "score": 0.0})
        st["score"] = round((st["score"] * st["n"] + score) / (st["n"] + 1), 4)
        st["n"] += 1


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
                       "pov": {**sc}},
            "ig": f"Good time to buy ⛳ The {m['name']} is at the lowest price we've tracked in {m.get('historyDays', 'our')} days: {money(m['minPrice'])}, {money(saving)} under its tracked high. Link in bio.",
            "x": f"The {m['name']} is at the lowest price we've tracked: {money(m['minPrice'])} ⛳\n{link}",
            "tt": f"{m['name']}: lowest price we've ever tracked ⛳"}


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
    line = max(5, round(price * random.Random(m["slug"]).choice([0.8, 1.15, 1.25]) / 5) * 5)
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


SCHEDULE = [theme_drop, theme_wild_nine, theme_pulse, theme_good, theme_start, theme_guess, theme_week]
FALLBACKS = [lambda d, tr: theme_good(d, tr, rank=1), lambda d, tr: theme_pulse(d, tr, 3), lambda d, tr: theme_good(d, tr, rank=2),
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
    yt_title = (t["tt"].rstrip(" ⛳") + " #golf #shorts")[:95]
    extra = live_tags(social or {}, t["ig"] + " " + t["tt"] + " " + (tie["match"] if tie else ""))
    ig_tags = " ".join(dict.fromkeys(TAGS.split() + extra))
    tt_tags = " ".join(dict.fromkeys("#golf #golftok #golfuk".split() + extra))[:150]
    return {"instagram": f"{ig}\n\n{ig_tags}", "tiktok": f"{t['tt']} {tt_tags}",
            "youtube": {"title": yt_title, "description": f"{ig.replace('Link in bio.', '')}\n{t['link']}\n#golf #golfuk #shorts"},
            "x": t["x"], "pinterest": {"title": f"{t['headline']}: {t['sub']}"[:99], "description": ig.replace("Link in bio.", "")[:480], "link": t["link"]},
            "bluesky": t["x"]}


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


def build_post(day, theme, style, sc, palette, pid, tie, social=None, sound=None):
    img = fetch_image(theme.get("image"))
    photo = fetch_image(theme.get("art") or "assets/action-lake-followthrough.jpg") if style in ("stat", "receipt") else None
    imgs = [fetch_image(x.get("image")) for x in sc.get("items", [])] if style == "countdown" else None
    still = V.render(style, sc, palette, VIDEOS / f"{pid}.mp4", img=img, photo=photo, imgs=imgs)
    V.feed_card(still, CARDS / f"{pid}.jpg")
    monday = day - timedelta(days=day.weekday())
    return {"id": pid, "date": str(day), "theme": theme["theme"], "style": style, "palette": palette, "hook": sc["hook"],
            "trend": tie["match"] if tie else None, "card": f"/social/cards/{pid}.jpg",
            "video": f"https://github.com/{REPO}/releases/download/pack-{monday}/{pid}.mp4",
            "link": theme["link"], "headline": theme["headline"], "sub": theme["sub"], "captions": captions(theme, tie, social),
            "sound": sound, "trendingFormats": [f for f in STYLE_FORMATS.get(style, []) if (social or {}).get("formats", {}).get(f)], "posted": {}}


# ---------------- plan, moment, post ----------------

def load_plan():
    return json.load(open(PLAN)) if PLAN.exists() else {"posts": []}


def save_plan(plan):
    OUT.mkdir(parents=True, exist_ok=True)
    plan["posts"] = sorted(plan["posts"], key=lambda p: (p["date"], p["id"]))[-60:]
    PLAN.write_text(json.dumps(plan, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def plan_week():
    tr = scan_trends()
    social = load_social()
    songs = [f"{x['title']} – {x['artist']}".strip(" –") for x in social.get("songs", [])]
    plan, L = load_plan(), load_learning()
    learn(plan, L)
    today = now().date()
    start = today + timedelta(days=(7 - today.weekday()) % 7 or 7)  # next Monday
    rnd = random.Random(str(start))
    have = {p["id"] for p in plan["posts"]}
    used_styles, used_keys, last_pal = set(), set(), None
    ties = list(tr.get("tieIns", []))
    schedule = list(SCHEDULE)
    if tr.get("brandsInNews"):  # a brand in the golf news: Thursday features its best deal
        schedule[3] = lambda d, t, b=tr["brandsInNews"][0]: theme_good(d, t, b) or theme_good(d, t)
    key = lambda x: x["theme"] + x["headline"] + x["sub"]
    for i in range(7):
        day = start + timedelta(days=i)
        pid = f"{day}-{DAYS[i].lower()}"
        if pid in have:
            continue
        theme = schedule[i](day, tr)
        fresh_style = lambda x: any(st not in used_styles for st, sc in x["styles"].items() if sc)
        if not theme or key(theme) in used_keys or not fresh_style(theme):
            alt = next((x for x in (f(day, tr) for f in FALLBACKS) if x and key(x) not in used_keys and fresh_style(x)), None)
            theme = alt or (theme if theme and key(theme) not in used_keys else None)
        if not theme:
            continue
        used_keys.add(key(theme))
        style, sc, pal = choose(theme, used_styles, last_pal, L, rnd, social)
        tie = ties.pop(0) if ties and i in (0, 3, 5) and style not in ("pov", "guess", "receipt") else None
        sc = build_script(theme, style, sc, L, rnd, tie)
        sound = songs[i % len(songs)] if songs else None
        plan["posts"].append(build_post(day, theme, style, sc, pal, pid, tie, social, sound))
        used_styles.add(style)
        last_pal = pal
        print(f"{pid}: {theme['theme']} as '{style}' ({pal}) hook: {sc['hook']}")
    save_plan(plan)
    save_learning(L)
    write_pack(plan)
    open_issue(plan, start)
    prune_cards()


def moment():
    plan, L = load_plan(), load_learning()
    today = now().date()
    if any(p["date"] == str(today) and p["id"].endswith("moment") for p in plan["posts"]):
        return
    hd = (load("home-deals.json") or {}).get("deals", [])
    pick = next((d for d in hd if d.get("lowest") and d.get("group") == "clubs"), None)
    if not pick:
        return
    m = next((x for x in models() if x["slug"] == pick["slug"]), None)
    if not m or any(pick["slug"] in p.get("link", "") for p in plan["posts"][-10:]):
        return
    hist = [p for _, p in m.get("history") or []] or [m["minPrice"]]
    link = f"{SITE}/prices/{m['slug']}/"
    theme = {"theme": "Moment", "link": link, "image": pick.get("image"), "name": m["name"], "headline": money(m["minPrice"]), "sub": m["name"],
             "ig": f"Just now ⛳ The {m['name']} has hit the lowest price we've tracked: {money(m['minPrice'])} across multiple UK retailers. Link in bio.",
             "x": f"Just now: the {m['name']} hit the lowest price we've tracked, {money(m['minPrice'])} ⛳\n{link}",
             "tt": f"{m['name']} just hit its lowest price ⛳"}
    sc = {"name": m["name"], "from": max(hist), "price": float(m["minPrice"]), "fall": max(hist) - float(m["minPrice"]),
          "hooks": ["Just now: a new lowest price", "This one just hit rock bottom"], "stamp": "NEW LOW"}
    rnd = random.Random(str(today))
    sc = build_script(theme, "reveal", sc, L, rnd, None)
    post = build_post(today, theme, "reveal", sc, rnd.choice(list(V.PALETTES)), f"{today}-moment", None)
    plan["posts"].append(post)
    save_plan(plan)
    save_learning(L)
    write_pack(plan)
    add_to_issue(post)


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
    return f"- [ ] **{p['id']}** · {DAYS[d.weekday()]} {d.day} {d.strftime('%b')} · {p.get('style')}: \"{p.get('hook')}\" ({p['theme']}{tr})"


def open_issue(plan, start):
    title = f"Content pack: w/c {start.day} {start.strftime('%b %Y')}"
    gh("POST", "/labels", {"name": "content-pack", "color": "3fae29", "description": "Weekly social posts to approve"})
    found = gh("GET", "/issues?state=open&labels=content-pack&per_page=20") or []
    if any(i.get("title") == title for i in found):
        return
    for old in found:
        gh("PATCH", f"/issues/{old['number']}", {"state": "closed"})
    week = [p for p in plan["posts"] if start <= date.fromisoformat(p["date"]) < start + timedelta(days=7)]
    body = ("Tick a post to approve it. Ticked posts go to Instagram automatically at 12:30 on their day.\n"
            f"Watch the videos and copy captions for TikTok, YouTube and X in the pack: {SITE}/social/pack/\n\n"
            + "\n".join(issue_line(p) for p in week)
            + "\n\nMoments (new lowest prices) get added here during the week.")
    gh("POST", "/issues", {"title": title, "body": body, "labels": ["content-pack"]})


def add_to_issue(post):
    found = gh("GET", "/issues?state=open&labels=content-pack&per_page=5") or []
    if found:
        i = found[0]
        gh("PATCH", f"/issues/{i['number']}", {"body": (i.get("body") or "") + "\n" + issue_line(post)})


def approved_ids():
    ids = set()
    for i in gh("GET", "/issues?state=all&labels=content-pack&per_page=6") or []:
        ids.update(re.findall(r"- \[[xX]\] \*\*([\w-]+)\*\*", i.get("body") or ""))
    return ids


def token_warning(status, txt):
    if status in (400, 401, 403) and "token" in (txt or "").lower():
        from agent_common import email_owner
        email_owner("GolfPrice AI · Instagram token needs renewing",
                    "<p>The content engine couldn't post to Instagram because the access token has expired or been revoked. "
                    "Generate a new one (Meta developer dashboard, Instagram, API setup with Instagram login) and paste it into "
                    "the IG_ACCESS_TOKEN secret on GitHub. Today's post is still in the pack to post by hand.</p>")


def post_today():
    plan = load_plan()
    today = str(now().date())
    todays = [p for p in plan["posts"] if p["date"] == today and not p["posted"].get("instagram")]
    if not todays:
        print("nothing to post today"); return
    ok = approved_ids()
    uid, tok = os.environ.get("IG_USER_ID"), os.environ.get("IG_ACCESS_TOKEN")
    for p in todays:
        if p["id"] not in ok:
            print("not approved:", p["id"]); continue
        if not (uid and tok):
            print("(no Instagram secrets: approved post left for manual posting)", p["id"]); continue
        s, _, txt = http(f"https://graph.instagram.com/v21.0/{uid}/media", method="POST",
                         body={"image_url": SITE + p["card"], "caption": p["captions"]["instagram"], "access_token": tok})
        cid = (json.loads(txt or "{}") or {}).get("id") if s == 200 else None
        if not cid:
            print("instagram container failed:", s, txt[:300])
            token_warning(s, txt)
            continue
        s, _, txt = http(f"https://graph.instagram.com/v21.0/{uid}/media_publish", method="POST",
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
    for f in CARDS.glob("*.jpg"):
        try:
            if date.fromisoformat(f.name[:10]) < cut:
                f.unlink()
        except ValueError:
            pass


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


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
        done = " · ".join(f"{k} ✓" for k in p.get("posted", {}) if not k.endswith("_id"))
        trend = f" · trend: {esc(p['trend'])}" if p.get("trend") else ""
        cards.append(f"""<section class="post"><video src="{p['video']}" poster="{p['card']}" controls playsinline preload="none"></video>
<div><p class="when">{DAYS[d.weekday()]} {d.day} {d.strftime('%b')} · {esc(p['theme'])} · {esc(p.get('style', ''))}{trend} <span class="done">{done}</span></p>
<h2>“{esc(p.get('hook', p['headline']))}”</h2><p class="sub">{esc(p['sub'])}</p>
<p class="dl"><a href="{p['video']}">Download video</a> · <a href="{p['card']}" download>Download feed image</a></p>
{''.join(f'<details><summary>{k}</summary><textarea readonly>{esc(v)}</textarea><button onclick="copy(this)">Copy</button></details>' for k, v in blocks)}
<p class="tip">{('Trending sound (approved for business): <b>' + esc(p['sound']) + '</b>. Search it in the app when you schedule.') if p.get('sound') else 'TikTok and Reels: add a trending sound from the commercial library when you schedule.'}{(' · Rides the trend: ' + esc(', '.join(p['trendingFormats']))) if p.get('trendingFormats') else ''}</p>
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
.sub{{color:#555;margin:2px 0 8px}}.done{{color:#888;font-weight:400}}details{{margin:6px 0}}summary{{cursor:pointer;font-weight:600}}
textarea{{width:100%;min-height:90px;font:14px system-ui;border-radius:8px;border:1px solid #ccc;padding:8px;box-sizing:border-box}}
button{{background:#14211a;color:#fff;border:0;border-radius:8px;padding:6px 14px;font-weight:600}}.dl,.link,.tip{{font-size:14px}}.tip{{color:#777}}
.trends{{background:#fff;border-radius:14px;padding:10px 14px}}@media(max-width:600px){{.post{{grid-template-columns:1fr}}.post video{{max-width:260px}}}}</style></head><body>
<h1>Content pack</h1><p>Updated {now().strftime('%a %d %b %H:%M')} UTC. Approve posts by ticking them in the "Content pack" GitHub issue; ticked posts go to Instagram on their day. Download the videos for TikTok, Reels and Shorts and schedule them in each app.</p>
{trend_html}
{''.join(cards) or '<p>No posts planned yet.</p>'}
<script>function copy(b){{const t=b.previousElementSibling;t.select();navigator.clipboard.writeText(t.value);b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)}}</script>
</body></html>"""
    PACK.parent.mkdir(parents=True, exist_ok=True)
    PACK.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    mode = (sys.argv[1] if len(sys.argv) > 1 else "plan").lower()
    {"plan": plan_week, "moment": moment, "post": post_today}[mode]()
