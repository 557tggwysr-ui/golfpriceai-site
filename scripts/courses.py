"""The UK golf course list (data/courses/uk.json), from OpenStreetMap.

Every UK golf course mapped on OpenStreetMap (leisure=golf_course), with its
name, nearest town and map position. Refreshed once a month by the 6-hourly
pipeline; any other run leaves the file alone. If OpenStreetMap can't be
reached, the old list stays as it is.

The Ace Register and (later) the course pages pick courses from this list.
Licence: OpenStreetMap data is © OpenStreetMap contributors, under the Open
Database Licence (ODbL). Every page that uses the list says so.
"""
import json
import math
import re
import urllib.parse
import urllib.request
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "courses" / "uk.json"
REFRESH_DAYS = 30
ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.kumi.systems/api/interpreter",
             "https://overpass.private.coffee/api/interpreter"]
QUERY = """[out:json][timeout:240];
area["ISO3166-1"="GB"][admin_level=2]->.gb;
nwr["leisure"="golf_course"]["name"](area.gb);
out tags center;
node["place"~"^(city|town)$"]["name"](area.gb);
out body;"""
NOT_A_COURSE = re.compile(r"pitch\W*(and|&|n)\W*putt|foot\s*golf|crazy\s*golf|adventure\s*golf|mini(ature)?\s*golf|"
                          r"driving\s*range|disc\s*golf|putting\s*green|golf\s*simulator|\btopgolf\b|"
                          r"\bcrazy\b|\bmini\b|frisbee", re.I)
ATTRIBUTION = "Course list © OpenStreetMap contributors (ODbL)"


def _fetch():
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    last = None
    for url in ENDPOINTS:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "GolfPriceAI/1.0 (golfpriceai.com; course list)"})
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # try the next mirror
            last = e
    raise RuntimeError(f"OpenStreetMap unreachable: {last}")


def _km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def tidy_name(n):
    n = re.sub(r"\s+", " ", n).strip()
    return n[:1].upper() + n[1:] if n else n


def parse(osm):
    """OpenStreetMap's answer -> a clean, de-duplicated course list."""
    places, raw = [], []
    for el in osm.get("elements", []):
        t = el.get("tags", {})
        if t.get("place") in ("city", "town") and "lat" in el:
            places.append((el["lat"], el["lon"], t.get("name", "")))
        elif t.get("leisure") == "golf_course":
            name = tidy_name(t.get("name", ""))
            c = el.get("center") or ({"lat": el["lat"], "lon": el["lon"]} if "lat" in el else None)
            if not name or not c or NOT_A_COURSE.search(name) or t.get("golf:course") in ("pitch_and_putt", "minigolf"):
                continue
            town = t.get("addr:city") or t.get("addr:town") or ""
            raw.append({"id": el["type"][0] + str(el["id"]), "n": name, "t": town,
                        "lat": round(c["lat"], 4), "lon": round(c["lon"], 4)})
    # Nearest town or city (within 25 km) when the course doesn't give one.
    # A coarse grid keeps this quick for a few thousand courses.
    grid = {}
    for p in places:
        grid.setdefault((int(p[0] * 4), int(p[1] * 4)), []).append(p)
    for c in raw:
        if c["t"]:
            continue
        gx, gy = int(c["lat"] * 4), int(c["lon"] * 4)
        best, bd = "", 25.0
        for dx in (-1, 0, 1):
            for dy in (-2, -1, 0, 1, 2):
                for p in grid.get((gx + dx, gy + dy), []):
                    d = _km((c["lat"], c["lon"]), p)
                    if d < bd:
                        best, bd = p[2], d
        c["t"] = best
    # One entry per course: the same name within 2 km is the same course
    # mapped twice (a way and a relation, say). Keep the first.
    out = []
    for c in sorted(raw, key=lambda c: (c["n"].lower(), c["id"])):
        if any(o["n"].lower() == c["n"].lower() and _km((o["lat"], o["lon"]), (c["lat"], c["lon"])) < 2 for o in out[-5:]):
            continue
        out.append(c)
    return out


def refresh(today=None, force=False):
    today = today or date.today()
    if OUT.exists() and not force:
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            if date.fromisoformat(old.get("updated", "2000-01-01")) > today - timedelta(days=REFRESH_DAYS):
                print(f"Course list: {len(old.get('courses', []))} courses, refreshed {old['updated']} (next in under {REFRESH_DAYS} days).")
                return False
        except (ValueError, OSError):
            pass
    try:
        courses = parse(_fetch())
    except Exception as e:
        print(f"Course list: not refreshed ({e}); keeping the old one.")
        return False
    if len(courses) < 1000:  # something went wrong upstream: never shrink the list
        print(f"Course list: only {len(courses)} came back, keeping the old one.")
        return False
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"updated": today.isoformat(), "attribution": ATTRIBUTION, "courses": courses},
                              ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Course list: {len(courses)} UK golf courses from OpenStreetMap.")
    return True


if __name__ == "__main__":
    refresh(force=True)
