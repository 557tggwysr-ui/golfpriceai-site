"""Course data keeper: fills in scorecards so every round is quick to start.

The problem it solves: the live scorecard and Society HQ rounds need each
course's par and stroke index. OpenStreetMap gives complete cards for only a
few hundred of the 2,800+ UK courses (data/courses/cards.json), so most rounds
start with a blank card to type in.

Monthly (inside the Fix pack, on the 3rd), for a rotating batch of courses
with a website and no card yet:
  1. Visits the club's own website politely (robots.txt respected, a pause
     between requests, identifies itself), finds its scorecard or course-card
     page, and reads the card when it's published as a table (PDFs and images
     are skipped).
  2. Keeps only complete, sensible cards, by the same rules as the map cards:
     18 holes, every par 3 to 6, total par 54 to 80, stroke indexes 1 to 18
     each used once. Red-tee par and stroke index too, when published.
  3. Saves them to data/courses/cards-clubs.json, with the page each came from.
     The scorecard uses the map's card first, then these. Golfers' own checked
     cards (in the worker) still come first of all.
  4. Cards older than a year are re-checked; a card that no longer reads
     cleanly is dropped rather than kept stale.

Reaches the site only when the owner approves the Fix pack.
"""
import json
import os
import re
import sys
import time
from datetime import date, timedelta
from html import unescape
from urllib.parse import urljoin, urlparse

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, save_report, http, now, pack_note)
from agent_society import allowed

UK = ROOT / "data" / "courses" / "uk.json"
MAP = ROOT / "data" / "courses" / "cards.json"
CLUBS = ROOT / "data" / "courses" / "cards-clubs.json"
BATCH = int(os.environ.get("CARD_BATCH", "200"))
LINK = re.compile(r"score\s?card|course\s?card|card of the course|the course|course guide|hole[- ]by[- ]hole", re.I)
PAR_LABEL = re.compile(r"^\s*par\b", re.I)
SI_LABEL = re.compile(r"^\s*(s\.?\s?i\.?|stroke\s*index|index|hcp|handicap)\b", re.I)
RED = re.compile(r"\b(red|ladies|women)\b", re.I)


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def cell_text(c):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", c))).strip()


def rows_of(html):
    for table in re.findall(r"<table.*?</table>", html, re.S | re.I):
        for tr in re.findall(r"<tr.*?</tr>", table, re.S | re.I):
            cells = [cell_text(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
            if cells:
                yield cells


def numbers(cells, lo, hi):
    """The hole values from a row: whole numbers in range, dropping totals (Out/In/Total)."""
    vals = []
    for c in cells[1:]:
        if re.fullmatch(r"\d{1,2}", c) and lo <= int(c) <= hi:
            vals.append(int(c))
    return vals


def read_card(html):
    """Par and stroke index rows; front and back nine can be separate rows or tables."""
    pars, sis, rpars, rsis = [], [], [], []
    for cells in rows_of(html):
        label = cells[0]
        if PAR_LABEL.match(label):
            (rpars if RED.search(label) else pars).extend(numbers(cells, 3, 6))
        elif SI_LABEL.match(label):
            (rsis if RED.search(label) else sis).extend(numbers(cells, 1, 18))
    card = {}
    if valid(pars, sis):
        card = {"p": pars[:18], "s": sis[:18]}
        if valid(rpars or pars, rsis) and rsis:
            card["rs"] = rsis[:18]
            if rpars:
                card["rp"] = rpars[:18]
    return card or None


def valid(p, s):
    return (len(p) == 18 and len(s) == 18 and all(3 <= x <= 6 for x in p) and 54 <= sum(p) <= 80
            and sorted(s) == list(range(1, 19)))


def find_card(site, robots):
    if not allowed(site, robots):
        return None, None
    st, final, h = http(site, timeout=20)
    if st != 200:
        return None, None
    card = read_card(h)
    if card:
        return card, final
    links = re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', h, re.S | re.I)
    seen = set()
    for href, label in links:
        url = urljoin(final, href)
        if url in seen or urlparse(url).netloc != urlparse(final).netloc or url.lower().endswith((".pdf", ".jpg", ".png")):
            continue
        if LINK.search(cell_text(label)) or LINK.search(href.replace("-", " ")):
            seen.add(url)
            if len(seen) > 3 or not allowed(url, robots):
                break
            time.sleep(1.5)
            st, _, h2 = http(url, timeout=20)
            card = read_card(h2) if st == 200 else None
            if card:
                return card, url
    return None, None


def main():
    uk = load_json(UK, {}).get("courses", [])
    mapped = set(load_json(MAP, {}).get("cards", {}))
    clubs = load_json(CLUBS, {"cards": {}})
    stale = str(date.today() - timedelta(days=365))
    todo = [c for c in uk if c.get("w") and c["id"] not in mapped
            and (c["id"] not in clubs["cards"] or clubs["cards"][c["id"]].get("checked", "0") < stale)]
    state = load_json(OUT / "coursedata-state.json", {"offset": 0})
    batch = todo[state["offset"] % max(1, len(todo)):][:BATCH] or todo[:BATCH]
    state["offset"] = (state["offset"] + BATCH) % max(1, len(todo))
    robots, added, refreshed, dropped, checked = {}, 0, 0, 0, 0
    for c in ([] if os.environ.get("AGENT_OFFLINE") == "1" else batch):
        site = c["w"] if c["w"].startswith("http") else "https://" + c["w"]
        checked += 1
        try:
            card, src = find_card(site, robots)
        except Exception as ex:
            print("skip", c["n"], ex)
            continue
        time.sleep(1.5)
        if card:
            refreshed += c["id"] in clubs["cards"]
            added += c["id"] not in clubs["cards"]
            clubs["cards"][c["id"]] = {**card, "src": src, "checked": str(now().date())}
        elif c["id"] in clubs["cards"]:
            clubs["cards"].pop(c["id"])
            dropped += 1
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "coursedata-state.json").write_text(json.dumps(state), encoding="utf-8")
    if added or refreshed or dropped:
        clubs.update({"v": 1, "updated": str(now().date()),
                      "about": "Course cards read from each club's own published scorecard. The scorecard uses OpenStreetMap's card first, then these."})
        CLUBS.write_text(json.dumps(clubs, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
        pack_note("data/courses/cards-clubs.json", f"Course cards: add **{added}** new scorecards read from clubs' own websites"
                                                   f"{f', refresh {refreshed}' if refreshed else ''}{f', drop {dropped} that no longer read cleanly' if dropped else ''}. "
                                                   f"Courses with a card: {len(mapped) + len(clubs['cards'])} of {len(uk)}.")
    rep = save_report("coursedata-report.json", {
        "about": "Course data keeper: scorecards read from clubs' own websites, for courses OpenStreetMap doesn't cover.",
        "coursesInUK": len(uk), "mapCards": len(mapped), "clubCards": len(clubs["cards"]),
        "coveragePct": round(100 * (len(mapped) + len(clubs["cards"])) / max(1, len(uk)), 1),
        "checkedThisRun": checked, "added": added, "refreshed": refreshed, "dropped": dropped,
    })
    print(json.dumps({k: rep[k] for k in ("mapCards", "clubCards", "coveragePct", "checkedThisRun", "added")}))


if __name__ == "__main__":
    main()
