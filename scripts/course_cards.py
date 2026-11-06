"""Course cards (par and stroke index for every hole), from OpenStreetMap.

data/courses/cards.json gives the quick-round set-up a card to fill in for
every UK course whose holes are mapped on OpenStreetMap with their par and
stroke index (golf=hole ways tagged ref, par and handicap). Course ids are the
same as data/courses/uk.json (w123 = way, r123 = relation).

Only complete, sensible cards are kept: 18 holes numbered 1 to 18, every par
3 to 6, a total par of 54 to 80, and stroke indexes 1 to 18 used once each.
A course whose area holds two sets of holes that disagree (a two-course club
mapped as one area) is left out rather than guessed. Red-tee par and stroke
index are kept when they're mapped (par:red, handicap:red / :women / :ladies).

Refreshed once a month by the 6-hourly pipeline (REFRESH_DAYS); any other run
leaves the file alone, and if OpenStreetMap can't be reached the old file
stays. Golfers' own checks and fixes live in the alerts worker (sc_courses);
this file only seeds courses nobody has typed in yet.
Licence: © OpenStreetMap contributors, Open Database Licence (ODbL).
"""
import json
import re
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "courses" / "cards.json"
REFRESH_DAYS = 30
RETRY_DAYS = 3
VERSION = 1
ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter",
             "https://overpass.private.coffee/api/interpreter"]
# Holes with a stroke index, the golf course areas their nodes sit in, then
# each of those courses followed by its holes.
QUERY = """[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="GB"][admin_level=2]->.gb;
way["golf"="hole"][~"^handicap"~"."](area.gb)->.h;
node(w.h)->.hn;
.hn is_in->.ins;
area.ins["leisure"="golf_course"]->.cs;
foreach.cs->.c(
  .c out ids;
  way["golf"="hole"](area.c);
  out tags;
);
"""
ATTRIBUTION = "Course cards © OpenStreetMap contributors (ODbL)"
SI_KEYS = ("handicap", "handicap:men", "handicap:yellow", "handicap:white", "handicap:male")
RED_SI_KEYS = ("handicap:red", "handicap:women", "handicap:ladies", "handicap:female")


def _fetch():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "GolfPriceAI/1.0 (golfpriceai.com; course cards)"})
            with urllib.request.urlopen(req, timeout=960) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # try the next mirror
            last = e
    raise RuntimeError(f"OpenStreetMap unreachable: {last}")


def _int(v):
    m = re.match(r"^\s*(\d{1,2})\s*$", str(v or ""))
    return int(m.group(1)) if m else None


def _course_id(area_id):
    if area_id >= 3600000000:
        return f"r{area_id - 3600000000}"
    if area_id >= 2400000000:
        return f"w{area_id - 2400000000}"
    return None


def _valid(pars, si):
    return (len(pars) == 18 and all(p is not None and 3 <= p <= 6 for p in pars) and 54 <= sum(pars) <= 80
            and sorted(x for x in si if x is not None) == list(range(1, 19)))


def build_cards(elements):
    """Overpass elements (course area, its holes, next area, ...) → {id: card}."""
    holes, cur = {}, None
    for el in elements:
        if el.get("type") == "area":
            cur = _course_id(el.get("id", 0))
            if cur:
                holes.setdefault(cur, [])
        elif el.get("type") == "way" and cur and (el.get("tags") or {}).get("golf") == "hole":
            holes[cur].append(el["tags"])
    cards = {}
    for cid, tags in holes.items():
        by = {}
        ok = True
        for t in tags:
            ref = _int(t.get("ref"))
            if ref is None or not 1 <= ref <= 18:
                continue
            par = _int(t.get("par")) or _int(t.get("par:men")) or _int(t.get("par:yellow")) or _int(t.get("par:white"))
            si = next((_int(t.get(k)) for k in SI_KEYS if _int(t.get(k))), None)
            rp = _int(t.get("par:red")) or _int(t.get("par:women")) or _int(t.get("par:ladies")) or par
            rs = next((_int(t.get(k)) for k in RED_SI_KEYS if _int(t.get(k))), None)
            row = (par, si, rp, rs)
            if ref in by and by[ref] != row:
                ok = False  # two different holes numbered the same: two courses in one area
                break
            by[ref] = row
        if not ok or sorted(by) != list(range(1, 19)):
            continue
        pars = [by[i][0] for i in range(1, 19)]
        si = [by[i][1] for i in range(1, 19)]
        if not _valid(pars, si):
            continue
        card = {"p": pars, "s": si}
        rpars = [by[i][2] for i in range(1, 19)]
        rsi = [by[i][3] for i in range(1, 19)]
        if _valid(rpars, rsi) and (rsi != si or rpars != pars):
            card["rp"], card["rs"] = rpars, rsi
        cards[cid] = card
    return cards


def refresh(today, force=False):
    """Rewrite data/courses/cards.json if it's REFRESH_DAYS old (or force)."""
    try:
        old = json.loads(OUT.read_text())
    except Exception:
        old = None
    if old and not force and old.get("v") == VERSION:
        try:
            if date.fromisoformat(old.get("updated", "2000-01-01")) > today - timedelta(days=REFRESH_DAYS):
                return False
        except ValueError:
            pass
    # A failed fetch is only retried after RETRY_DAYS, so a slow OpenStreetMap
    # doesn't hold up every 6-hourly run.
    try:
        if not force and old and date.fromisoformat(old.get("tried", "2000-01-01")) > today - timedelta(days=RETRY_DAYS):
            return False
    except ValueError:
        pass
    try:
        cards = build_cards(_fetch().get("elements", []))
    except Exception as e:
        print(f"Course cards: kept the old file ({e})")
        keep = old or {"v": VERSION, "updated": "2000-01-01", "attribution": ATTRIBUTION, "cards": {}}
        keep["tried"] = today.isoformat()
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(keep, separators=(",", ":")))
        return False
    if old and len(cards) < len(old.get("cards", {})) * 0.5:
        print(f"Course cards: only {len(cards)} came back (had {len(old.get('cards', {}))}): kept the old file")
        return False
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"v": VERSION, "updated": today.isoformat(), "attribution": ATTRIBUTION, "cards": cards},
                              separators=(",", ":")))
    print(f"Course cards: {len(cards)} UK courses with a full card from OpenStreetMap.")
    return True


if __name__ == "__main__":
    refresh(date.today(), force=True)
