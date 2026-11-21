"""The creative director's toolkit for the content engine (John's brief, 21 Nov 2026, .github/SOCIAL.md).

  * the 14 content formats and the 14-post mix (data/social-formats.json): which format comes next
  * themes for posts that aren't built from a live price: memes (Style A), questions and hot takes
    (Style B), educational and myth-buster carousels, budget vs premium (real prices)
  * the photo library (data/social-library.json): the right photo for a joke, never reused within 20 posts
  * format learning: which formats earn saves, shares and clicks
"""
import json
import random
import re
from datetime import timedelta

from agent_common import ROOT, SITE, load, models, now

FORMATS_FILE = ROOT / "data" / "social-formats.json"
NO_REPEAT_PHOTOS = 20
NO_REPEAT_LINES_DAYS = 60
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# existing price-led themes -> their content format
THEME_FORMAT = {"Biggest drop": "pricedrop", "Lowest tracked": "pricedrop", "Moment": "pricedrop", "Category check": "data",
                "Week in prices": "data", "Start golf": "data", "Par Price": "challenge", "Golfer truths": "meme"}


def formats():
    try:
        return json.loads(FORMATS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"formats": [], "mix": {}, "series": []}


def bank():
    return load("social-bank.json") or {}


def fmt_of(theme):
    if theme.get("format"):
        return theme["format"]
    name = theme.get("theme", "")
    for k, v in THEME_FORMAT.items():
        if name.startswith(k):
            return v
    return "remix" if name.startswith(("Trend tie-in", "Reactive")) else "pricedrop"


def strip_marks(s):
    return re.sub(r"\*", "", str(s or ""))


# ---------------- photo library ----------------

MIN_SIDE = 900  # full-screen 1080x1920 needs a big photo; smaller ones look soft


def _big_enough(p):
    try:
        from PIL import Image
        with Image.open(ROOT / p["file"]) as im:
            return min(im.size) >= MIN_SIDE
    except Exception:
        return False


def library(fit=None):
    return [p for p in (load("social-library.json") or {}).get("photos", [])
            if (ROOT / p["file"]).exists() and _big_enough(p) and (fit is None or fit in p.get("fit", ["A", "B"]))]


def pick_photo(tags, L, rnd, fit="A", need_match=False):
    lib = library()
    recent = L.setdefault("photosUsed", [])[-NO_REPEAT_PHOTOS:]
    ok = [p for p in lib if (ROOT / p["file"]).exists() and fit in p.get("fit", ["A", "B"]) and p["file"] not in recent]
    if not ok:
        ok = [p for p in lib if (ROOT / p["file"]).exists() and p["file"] not in recent] or [p for p in lib if (ROOT / p["file"]).exists()]
    if not ok:
        return None
    scored = sorted(ok, key=lambda p: (-len(set(p.get("tags", [])) & set(tags or [])), rnd.random()))
    if need_match and not set(scored[0].get("tags", [])) & set(tags or []):
        return None  # a joke needs a photo that shows it
    pick = scored[0]["file"]
    L["photosUsed"] = (L.get("photosUsed", []) + [pick])[-60:]
    return pick


def fresh_lines(items, key, L):
    """Bank lines not used in the last 60 days."""
    cut = str(now().date() - timedelta(days=NO_REPEAT_LINES_DAYS))
    used = L.setdefault("linesUsed", {})
    return [x for x in items if used.get(strip_marks(x[key]), "0") < cut]


def mark_used(L, text):
    L.setdefault("linesUsed", {})[strip_marks(text)] = str(now().date())


# ---------------- themes for the new formats ----------------

def theme_meme(d, L, rnd):
    b = bank()
    have = {t for p in library() if p["file"] not in L.get("photosUsed", [])[-NO_REPEAT_PHOTOS:] for t in p.get("tags", [])}
    pool = fresh_lines(b.get("memes", []), "top", L) + [dict(h, style="headline") for h in fresh_lines([h for h in b.get("headlines", []) if h.get("format") == "meme"], "big", L)]
    pool = [m for m in pool if set(m.get("tags", [])) & have]  # only jokes we have a matching photo for
    if not pool:
        return None
    m = rnd.choice(pool)
    if m.get("style") == "headline":
        photo = pick_photo(m.get("tags"), L, rnd, "B", need_match=True)
        if not photo:
            return None
        sc = {"bg": photo, "big": m["big"], "sub": m.get("sub"), "hook": strip_marks(m["big"]), "thumb": strip_marks(m["big"])}
        text = f"{strip_marks(m['big'])} {m.get('sub', '')}".strip()
        style = "headline"
    else:
        photo = pick_photo(m.get("tags"), L, rnd, "A", need_match=True)
        if not photo:
            return None
        sc = {"bg": photo, "top": m["top"], "punch": m["punch"], "arrow": m.get("arrow", "left"), "top_y": m.get("top_y", 330), "hook": strip_marks(m["top"]),
              "thumb": strip_marks(m["top"])}
        if m.get("reaction"):  # two-photo joke: the set-up, then the mate's reaction cuts in on the punchline
            photo2 = pick_photo(m["reaction"], L, rnd, "A", need_match=True)
            if not photo2:
                return None
            sc["bg2"] = photo2
        foc = {p["file"]: p.get("focus") for p in library()}
        if foc.get(sc["bg"]):
            sc["focus"] = foc[sc["bg"]]
        if sc.get("bg2") and foc.get(sc["bg2"]):
            sc["focus2"] = foc[sc["bg2"]]
        top = strip_marks(m["top"]).rstrip()
        text = f"{top}{'' if top[-1:] in '.?!:' else '...'} {strip_marks(m['punch'])}"
        style = "humour"
    mark_used(L, m.get("top") or m.get("big"))
    return {"theme": "Golf humour", "format": "meme", "link": SITE + "/", "image": None, "name": "", "headline": strip_marks(m.get("top") or m.get("big")),
            "sub": strip_marks(m.get("punch") or m.get("sub") or ""), "styles": {style: sc},
            "ig": f"{text} ⛳ Tag the mate who needs to see this.", "x": f"{text} ⛳", "tt": f"{text} ⛳ #golfhumour",
            "keywords": "golf humour, golf memes, relatable golf"}


def theme_question(d, L, rnd):
    pool = fresh_lines(bank().get("questions", []), "big", L)
    if not pool:
        return None
    q = rnd.choice(pool)
    photo = pick_photo(q.get("tags"), L, rnd, "B")
    if not photo:
        return None
    mark_used(L, q["big"])
    big = strip_marks(q["big"])
    return {"theme": "Community question", "format": "community", "link": SITE + "/", "image": None, "name": "", "headline": big, "sub": q.get("sub", ""),
            "styles": {"headline": {"bg": photo, "big": q["big"], "sub": q.get("sub"), "hook": big, "thumb": big}},
            "ig": f"{big} ⛳ {q.get('sub', '')} Answers in the comments, we're reading every one.", "x": f"{big} ⛳ {q.get('sub', '')}",
            "tt": f"{big} ⛳ answer in the comments", "keywords": "golf question, golfers, golf community"}


def _carousel_theme(item, kind, L, rnd, series=None):
    photo = pick_photo(item.get("tags"), L, rnd, "B")
    slides = [{"title": item["title"], "body": item.get("cover_sub", "")}]
    for s in item["slides"]:
        if kind == "myth":
            slides.append({"kicker": s[0], "title": s[1], "body": s[2]})
        else:
            slides.append({"title": s[0], "body": s[1]})
    slides.append({"title": item["close"][0], "body": item["close"][1]})
    mark_used(L, item["title"])
    t = strip_marks(item["title"])
    fmt = "myth" if kind == "myth" else "carousel"
    return {"theme": "Myth or Mulligan" if kind == "myth" else "Tips carousel", "format": fmt, "link": SITE + "/", "image": None, "name": "",
            "headline": t, "sub": item.get("cover_sub", ""),
            "styles": {"carousel": {"bg": photo, "slides": slides, "series": series, "hook": t, "thumb": t}},
            "ig": f"{t} ⛳ Swipe through, and save it for later.", "x": f"{t} ⛳", "tt": f"{t} ⛳",
            "keywords": "golf tips, golf advice, golf equipment"}


def theme_tips(d, L, rnd):
    pool = fresh_lines(bank().get("carousels", []), "title", L)
    return _carousel_theme(rnd.choice(pool), "tips", L, rnd) if pool else None


def theme_myth(d, L, rnd):
    pool = fresh_lines(bank().get("myths", []), "title", L)
    return _carousel_theme(rnd.choice(pool), "myth", L, rnd, "Myth or Mulligan") if pool else None


def theme_budget(d, L, rnd):
    """Budget or Bougie?: a well-priced model against a premium one of the same type, both real prices."""
    def money(n):
        n = float(n)
        return f"£{n:,.2f}" if n % 1 else f"£{n:,.0f}"
    pool = {}
    for m in models():
        g = m.get("gate") or {}
        if not g.get("passes") or m.get("type") not in ("driver", "putter", "rangefinder", "gps-watch", "ball", "irons", "wedge"):
            continue
        if re.search(r"junior|kids|single|shaft|grip|ladies junior", m["name"], re.I) or len(m.get("retailers") or []) < 2:
            continue
        pool.setdefault(m["type"], []).append(m)
    types = [t for t, ms in pool.items() if len(ms) >= 6]
    if not types:
        return None
    t = types[(d.toordinal() // 7) % len(types)]
    ms = sorted(pool[t], key=lambda m: float(m["minPrice"]))
    lo, hi = ms[len(ms) // 6], ms[-max(1, len(ms) // 10)]
    if float(hi["minPrice"]) < float(lo["minPrice"]) * 2:
        return None
    word = {"gps-watch": "GPS watch", "irons": "set of irons"}.get(t, t)
    big = f"Budget or *bougie?*"
    sub = f"{money(lo['minPrice'])} v {money(hi['minPrice'])}: which {word} would you bag?"
    photo = pick_photo([t, "clubs", "tech"], L, rnd, "B")
    if not photo:
        return None
    return {"theme": "Budget or Bougie?", "format": "budget", "link": f"{SITE}/prices/{lo['slug']}/", "image": None, "name": lo["name"],
            "headline": "Budget or bougie?", "sub": sub,
            "styles": {"headline": {"bg": photo, "big": big, "sub": sub, "hook": "Budget or bougie?", "thumb": "Budget or bougie?"}},
            "ig": f"Budget or bougie? ⛳ The {lo['name']} is {money(lo['minPrice'])}. The {hi['name']} is {money(hi['minPrice'])}. Lowest prices right now across multiple UK retailers. Which one are you bagging? Link in bio.",
            "x": f"Budget or bougie? ⛳\n{lo['name']}: {money(lo['minPrice'])}\n{hi['name']}: {money(hi['minPrice'])}\nWhich would you bag?",
            "tt": f"Budget or bougie golf {word}? {money(lo['minPrice'])} v {money(hi['minPrice'])} ⛳", "series": "Budget or Bougie?",
            "keywords": f"golf {word} prices, budget golf, golf deals UK"}


def theme_bts(d, L, rnd):
    b = (bank().get("bts") or [None])[0]
    if not b:
        return None
    big = strip_marks(b["big"])
    return {"theme": "Behind the scenes", "format": "bts", "link": SITE + "/", "image": None, "name": "", "headline": big, "sub": b.get("sub", ""),
            "styles": {"sitedemo": {"url": SITE + "/", "sub": b.get("sub", ""), "hooks": [big], "name": "GolfPrice AI"}},
            "ig": f"{big} ⛳ {b.get('sub', '')}. No made-up 'was' prices, ever.", "x": f"{big} ⛳", "tt": f"{big} ⛳",
            "keywords": "golf price comparison UK, golf deals"}


def resolve_sequence(q, L, rnd):
    """Fill in rotating reaction shots. An item with "reaction": [tags] (e.g. ["kev", "stifled"]) gets a
    library photo of that character, least recently used first, so Kev's faces rotate across sketches.
    Optional cutaways with no photo yet are dropped; a missing required photo means the sketch waits."""
    lib = library()
    files = {p["file"] for p in lib}
    recent = L.setdefault("photosUsed", [])
    out = dict(q)
    for part in ("shots", "lines"):
        items = []
        for it in q.get(part, []):
            it = dict(it)
            if it.get("reaction"):
                want = it["reaction"]
                cands = [p for p in lib if want[0] in p.get("tags", [])]
                last = {f: n for n, f in enumerate(recent)}  # later = used more recently
                cands.sort(key=lambda p: (-len(set(p.get("tags", [])) & set(want)), last.get(p["file"], -1), rnd.random()))
                if cands:
                    it["bg"] = cands[0]["file"]
                    L["photosUsed"] = (L.get("photosUsed", []) + [it["bg"]])[-60:]
                    if cands[0].get("focus"):
                        it.setdefault("focus", cands[0]["focus"])
            if it.get("screen") and (ROOT / it["screen"]).exists() and (not it.get("bg") or it["bg"] in files):
                items.append(it)  # a real site screen on a phone (the scene behind it is optional)
                continue
            if not it.get("bg") or it["bg"] not in files:
                if it.get("optional"):
                    continue
                return None
            items.append(it)
        out[part] = items
    return out


def theme_sketch(d, L, rnd):
    """A quick-cut mini sketch from the bank (style "sequence"): only when every photo it needs exists."""
    posted = L.setdefault("fourballPosted", [])
    eps = sorted([q for q in bank().get("sequences", []) if (q.get("cover") or {}).get("ep") not in posted],
                 key=lambda q: (q.get("cover") or {}).get("ep", 999))
    q = None
    for cand in eps:  # The Fourball posts in episode order: the first unposted episode whose photos are all here
        r = resolve_sequence(cand, {"photosUsed": list(L.get("photosUsed", []))}, rnd)
        if r:
            q = r
            break
    if not q:
        return None
    ep = (q.get("cover") or {}).get("ep")
    if ep:
        posted.append(ep)
    mark_used(L, q["title"])
    t = strip_marks(q["title"])
    sc = {k: q[k] for k in ("top", "shots", "lines", "end", "counter", "top_y", "cover") if k in q}
    sc.update({"hook": t, "thumb": strip_marks(q.get("thumb", t))})
    cap = q.get("caption", t)
    if ep:
        cap = f"The Fourball, EP {ep}: {cap}"
    return {"theme": "The Fourball", "format": "sketch", "series": "The Fourball", "ep": ep, "link": SITE + (f"/fourball/episodes/{ep}/" if ep else "/fourball/"), "image": None, "name": "", "headline": t, "sub": "",
            "styles": {"sequence": dict(sc, outro={"tool": (q.get("cover") or {}).get("tool", "fourball"),
                                                   "lead": ((q.get("cover") or {}).get("names") or ["Big Dave"])[0],
                                                   "line": (q.get("cover") or {}).get("outro_line")})},
            "ig": f"{cap} ⛳ Send it to your four-ball group chat. Every episode is on golfpriceai.com/fourball/, with Fourball Alerts so your four-ball can watch kit prices together.",
            "x": f"{cap} ⛳ " + SITE + (f"/fourball/episodes/{ep}/" if ep else "/fourball/"), "tt": f"{cap} ⛳ #golfhumour",
            "whatsapp": f"{cap} 😂 Who's the {((q.get('cover') or {}).get('names') or ['Big Dave'])[0]} in our group? " + SITE + (f"/fourball/episodes/{ep}/" if ep else "/fourball/") + "?utm_source=fourball&utm_medium=whatsapp&utm_campaign=episode",
            "keywords": "golf humour, golf sketch, relatable golf"}


NEW_THEMES = {"sketch": theme_sketch, "meme": theme_meme, "community": theme_question, "carousel": theme_tips, "myth": theme_myth, "budget": theme_budget, "bts": theme_bts}


# ---------------- the mix ----------------

def format_weight(L, fid):
    st = L.get("formats", {})
    known = [v["score"] for v in st.values() if v.get("n", 0) >= 2]
    if fid not in st or st[fid].get("n", 0) < 2 or not known:
        return 1.2
    avg = sum(known) / len(known) or 1
    return max(0.5, min(2.2, st[fid]["score"] / avg))


def pick_format(history, candidates, L, day):
    """history: formats of recent posts (newest last). candidates: {format: theme}. Returns the format to use."""
    F = formats()
    by_id = {f["id"]: f for f in F.get("formats", [])}
    mix = F.get("mix", {})
    total = sum(mix.values()) or 14
    last14 = history[-13:]
    def deficit(fid):
        b = by_id.get(fid, {}).get("bucket", "deal")
        have = sum(1 for h in last14 if by_id.get(h, {}).get("bucket") == b)
        return mix.get(b, 1) * (len(last14) + 1) / total - have
    def score(fid):
        f = by_id.get(fid, {})
        if f.get("status") == "retired":
            return -99
        s = deficit(fid) * 2 + format_weight(L, fid)
        s *= {"trial": 1.15, "tired": 0.6}.get(f.get("status"), 1.0)
        if history[-1:] == [fid]:
            s -= 3  # never the same format twice in a row
        if fid in history[-3:]:
            s -= 1
        for ser in F.get("series", []):  # a series on its day (a fixed weekly series always gets its slot)
            if ser.get("format") == fid and ser.get("day") == DAYS[day.weekday()]:
                s += 100 if ser.get("fixed") else 3
            elif ser.get("format") == fid and ser.get("fixed"):
                return -99  # a fixed weekly series only airs on its own day, so episodes keep their rhythm
        return s
    ranked = sorted(candidates, key=lambda f: -score(f))
    return ranked[0] if ranked else None


def series_for(fid):
    for ser in formats().get("series", []):
        if ser.get("format") == fid:
            return ser
    return None


def learn_format(L, fid, score):
    st = L.setdefault("formats", {}).setdefault(fid, {"n": 0, "score": 0.0})
    st["score"] = round((st["score"] * st["n"] + score) / (st["n"] + 1), 4)
    st["n"] += 1
