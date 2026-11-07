"""Bluesky: post GolfPrice AI's genuine price drops automatically.

Reads data/social-feed.xml (already chosen by social_feed.py: at most 3
genuine drops a day, biggest first, one per brand, each linking to a price
page that backs it up) and posts ONE new item per run, so three runs a day
spread the posts out. Bluesky posts are public and indexed by search
engines, so every post is another place GolfPrice AI is mentioned.

Needs two GitHub secrets: BLUESKY_HANDLE (e.g. golfpriceai.bsky.social) and
BLUESKY_APP_PASSWORD (Bluesky > Settings > Privacy and security > App
passwords; never the main password). Without them it does nothing.

State: data/bluesky-state.json remembers which items went out (ids only).
"""
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "data" / "social-feed.xml"
STATE = ROOT / "data" / "bluesky-state.json"
API = "https://bsky.social/xrpc/"
MAX_AGE = timedelta(days=2)       # don't post stale drops


def call(method, body=None, token=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + method, data=data, method="POST" if data is not None else "GET")
    req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def items():
    x = FEED.read_text(encoding="utf-8")
    out = []
    for it in re.findall(r"<item>(.*?)</item>", x, re.S):
        g = lambda tag: unescape((re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", it, re.S) or [None, ""])[1].strip())
        img = re.search(r'<enclosure url="([^"]+)"', it)
        out.append({"id": g("guid"), "title": g("title"), "link": g("link").replace("utm_source=social-feed", "utm_source=bluesky"),
                    "desc": g("description"), "img": unescape(img.group(1)) if img else None,
                    "date": parsedate_to_datetime(g("pubDate"))})
    return out


def post_text(it):
    name_line = it["title"]
    text = f"📉 {name_line}\n\nGenuine UK price drop, checked against our own price history, not a “was” price.\n\n#golf #golfdeals #ukgolf"
    return text[:290]


def facets(text):
    """Make the hashtags tappable (Bluesky needs byte offsets)."""
    out = []
    b = text.encode("utf-8")
    for m in re.finditer(rb"#(\w+)", b):
        out.append({"index": {"byteStart": m.start(), "byteEnd": m.end()},
                    "features": [{"$type": "app.bsky.richtext.facet#tag", "tag": m.group(1).decode()}]})
    return out


def main():
    handle, pw = os.environ.get("BLUESKY_HANDLE"), os.environ.get("BLUESKY_APP_PASSWORD")
    if not handle or not pw:
        print("Bluesky: no BLUESKY_HANDLE / BLUESKY_APP_PASSWORD secret yet, skipping.")
        return
    state = json.loads(STATE.read_text()) if STATE.exists() else {"posted": []}
    done = set(state["posted"])
    now = datetime.now(timezone.utc)
    fresh = [i for i in items() if i["id"] not in done and now - i["date"] <= MAX_AGE]
    if not fresh:
        print("Bluesky: nothing new to post.")
        return
    it = sorted(fresh, key=lambda i: i["date"])[0]           # oldest unposted first
    s = call("com.atproto.server.createSession", {"identifier": handle, "password": pw})
    tok, did = s["accessJwt"], s["did"]
    external = {"uri": it["link"], "title": it["title"][:300], "description": it["desc"][:300]}
    if it["img"]:
        try:   # the product photo as the link card's picture; fine without it
            req = urllib.request.Request(it["img"], headers={"User-Agent": "GolfPriceAI-bot"})
            with urllib.request.urlopen(req, timeout=20) as r:
                blob, ctype = r.read(), r.headers.get("Content-Type", "image/jpeg")
            if len(blob) < 950_000 and ctype.startswith("image/"):
                external["thumb"] = call("com.atproto.repo.uploadBlob", token=tok, raw=blob, ctype=ctype)["blob"]
        except Exception as e:
            print(f"Bluesky: no picture ({e}).")
    text = post_text(it)
    record = {"$type": "app.bsky.feed.post", "text": text, "facets": facets(text), "langs": ["en-GB"],
              "createdAt": now.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
              "embed": {"$type": "app.bsky.embed.external", "external": external}}
    call("com.atproto.repo.createRecord", {"repo": did, "collection": "app.bsky.feed.post", "record": record}, token=tok)
    state["posted"] = (state["posted"] + [it["id"]])[-200:]
    STATE.write_text(json.dumps(state, indent=1))
    print(f"Bluesky: posted {it['id']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:     # a failed post never fails the workflow loudly
        print(f"Bluesky: failed ({e})")
        sys.exit(0)
