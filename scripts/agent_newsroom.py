"""Newsroom: catches what the world is talking about, twice a day, so we can react the same day.

John (20 Nov 2026): the agents must make the most of unplanned and surprising moments too, and
ride every step of a big moment's build-up (for Avengers: Doomsday: each teaser, trailer, poster
or ticket release), not just the day itself.

Twice a day (08:15 and 17:45 UK, inside the content engine workflow) this script:
  1. reads UK news and trends: BBC golf, sport, entertainment and technology headlines, Google
     Trends GB, and YouTube's most popular in the UK (gaming, film and entertainment);
  2. flags two kinds of candidate:
       * build-up beats: a new headline about a moment we're watching (data/moments.json "watch"
         keywords), for example "Avengers: Doomsday final trailer";
       * surprises: big, safe, fresh stories nobody planned for (a viral golf moment, a surprise
         release, the first snow);
  3. drops anything political, tragic or about someone's private life, and anything already seen;
  4. writes the candidates to /tmp/newsroom-candidates.json and data/agents/newsroom.json.
Then, if CLAUDE_CODE_OAUTH_TOKEN is set, Claude (in the workflow) picks at most one worth a post,
writes it into data/content-queue.json for today in a format that suits it, and the content engine
renders it straight into the content pack. John ticks it like any other post; nothing posts
without his tick. Without the token, the candidates still appear on the pack page and in the
weekly review.
"""
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import DATA, OUT, http, now, save_report

FEEDS = [
    ("golf", "https://feeds.bbci.co.uk/sport/golf/rss.xml"),
    ("sport", "https://feeds.bbci.co.uk/sport/rss.xml"),
    ("entertainment", "https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml"),
    ("technology", "https://feeds.bbci.co.uk/news/technology/rss.xml"),
    ("trends", "https://trends.google.com/trending/rss?geo=GB"),
]
YT_CATEGORIES = {"20": "gaming", "1": "film", "24": "entertainment", "17": "sport"}
UNSAFE = re.compile(
    r"\b(dies|died|death|dead|killed|kill|murder|stab|shot|shooting|tragic|tragedy|crash|war|attack|terror\w*|"
    r"election|vote|minister|government|parliament|police|court|trial|jail|prison|charged|arrest\w*|abuse|"
    r"assault|scandal|divorce|split|pregnan\w*|hospital|cancer|illness|injur\w*|funeral|tribute|missing|"
    r"strike|protest|refugee|immigra\w*|tax|budget|recession|layoff\w*|redundan\w*|flood|wildfire|earthquake)\b", re.I)
STATE = OUT / "newsroom.json"


def rss(url, limit=40):
    s, _, t = http(url, timeout=30)
    if s != 200 or not t:
        return []
    try:
        root = ET.fromstring(t.encode("utf-8", "replace"))
    except ET.ParseError:
        return []
    out = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        traffic = it.findtext("{https://trends.google.com/trending/rss}approx_traffic") or ""
        if title:
            out.append({"title": title, "link": link, "traffic": traffic.replace("+", "").replace(",", "")})
        if len(out) >= limit:
            break
    return out


def youtube():
    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        return []
    out = []
    for cat, label in YT_CATEGORIES.items():
        s, _, t = http("https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular"
                       f"&regionCode=GB&videoCategoryId={cat}&maxResults=15&key={key}", timeout=30)
        if s != 200:
            continue
        for v in json.loads(t).get("items", []):
            sn, st = v.get("snippet", {}), v.get("statistics", {})
            out.append({"source": f"youtube {label}", "title": sn.get("title", ""), "channel": sn.get("channelTitle", ""),
                        "link": f"https://www.youtube.com/watch?v={v.get('id')}", "views": int(st.get("viewCount") or 0),
                        "published": sn.get("publishedAt", "")[:10]})
    return out


def watch_list():
    """Keywords for the moments we're riding, from data/moments.json (the planner adds 'watch' lists)."""
    try:
        d = json.loads((DATA / "moments.json").read_text(encoding="utf-8"))
    except Exception:
        return []
    today = now().date()
    out = []
    for m in d.get("moments", []):
        if m.get("status") in ("posted", "missed") and m.get("date", "") < str(today - timedelta(days=7)):
            continue
        words = m.get("watch") or [re.sub(r"\s*\(.*?\)", "", m["name"]).strip()]
        out.append((m["name"], [w.lower() for w in words if len(w) >= 4]))
    return out


def main():
    try:
        state = json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        state = {}
    seen = set(state.get("seen", []))
    items = []
    for src, url in FEEDS:
        for it in rss(url):
            items.append({"source": src, **it})
    items += youtube()
    watches = watch_list()
    cands, new_seen = [], []
    for it in items:
        title = it["title"]
        h = hashlib.sha1(re.sub(r"\W+", " ", title.lower()).strip().encode()).hexdigest()[:12]
        new_seen.append(h)
        if h in seen or UNSAFE.search(title):
            continue
        low = title.lower()
        hit = next((name for name, words in watches if any(w in low for w in words)), None)
        score = 0
        if hit:
            score += 50                                      # a build-up beat for a moment we're riding
        if it["source"] == "golf":
            score += 20
        if it["source"] == "trends":
            score += min(30, int(re.sub(r"\D", "", it.get("traffic") or "0") or 0) // 20000)
        if it["source"].startswith("youtube"):
            score += min(30, it.get("views", 0) // 500000)
        if re.search(r"\b(trailer|teaser|first look|release date|tickets?|launch|announced|revealed|out now|premiere)\b", low):
            score += 10
        if score >= 15:
            cands.append({**it, "watch": hit, "score": score, "kind": "build-up beat" if hit else "surprise"})
    cands.sort(key=lambda c: -c["score"])
    state = {"about": "Newsroom: fresh, safe stories worth a same-day post (build-up beats for moments we're riding, and surprises). "
                      "Political, tragic and private-life stories are dropped.",
             "lastScan": now().strftime("%Y-%m-%dT%H:%MZ"), "candidates": cands[:12],
             "seen": (list(seen) + new_seen)[-1500:]}
    save_report("newsroom.json", state)
    with open("/tmp/newsroom-candidates.json", "w", encoding="utf-8") as f:
        json.dump(cands[:12], f, indent=1, ensure_ascii=False)
    print(f"newsroom: {len(items)} items, {len(cands)} candidates" + (f"; top: {cands[0]['title']}" if cands else ""))
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"candidates={len(cands)}\n")


if __name__ == "__main__":
    main()
