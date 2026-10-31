"""Course pages (/courses/): a page for every UK golf course.

From the UK course list (courses.py, OpenStreetMap) and the Ace Register.

  /courses/                    the hub: search, courses near me, most aces, nations
  /courses/<slug>/             a full page for every course with real content
                               (an ace on its board): indexed by Google
  /courses/course/?c=<id>      the same page for any other course, drawn in the
                               browser by js/course.js: kept out of search

So golfers can open any of the 2,800+ courses, but Google only sees pages with
something on them, and the indexed set grows as golfers log aces.

Writes data/courses/pages.json (course id -> page) for the links, and
data/courses/aces.json (the last ace summary, used if the worker can't be
reached). Built with every price run.
"""
import json
import math
import re
import urllib.request
from pathlib import Path

from price_pages import SITE, _write, esc, page_shell

ROOT = Path(__file__).resolve().parent.parent
DIR = ROOT / "courses"
DATA = ROOT / "data" / "courses"
API = "https://golfpriceai-alerts.golfpriceai.workers.dev"
V = "20261031"
CSS = f'<link rel="stylesheet" href="/css/courses.css?v={V}">\n'
NATIONS = ["England", "Scotland", "Wales", "Northern Ireland"]
ATTR = 'Course location © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL).'


def slugify(s):
    s = s.lower().replace("&", " and ").replace("’", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:70]


def assign_slugs(courses):
    """Stable, unique slugs: the name, then name + town, then + the id."""
    seen, out = {}, {}
    by = {}
    for c in courses:
        by.setdefault(slugify(c["n"]), []).append(c)
    for base, cs in sorted(by.items()):
        for c in sorted(cs, key=lambda x: x["id"]):
            s = base if len(cs) == 1 else slugify(f'{c["n"]} {c.get("t", "")}')
            if not s or s in seen:
                s = f'{s or "course"}-{c["id"]}'
            seen[s] = 1
            out[c["id"]] = s
    return out


def miles(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def nearby(c, courses, grid, n=5, within=30):
    gx, gy = int(c["lat"] * 2), int(c["lon"] * 2)
    near = []
    for dx in (-1, 0, 1):
        for dy in (-2, -1, 0, 1, 2):
            for o in grid.get((gx + dx, gy + dy), []):
                if o["id"] != c["id"]:
                    d = miles(c, o)
                    if d <= within:
                        near.append((d, o))
    near.sort(key=lambda x: x[0])
    return near[:n], sum(1 for d, _ in near if d <= 10)


def ace_summary():
    path = DATA / "aces.json"
    try:
        with urllib.request.urlopen(urllib.request.Request(API + "/ace/summary", headers={"User-Agent": "GolfPriceAI build"}), timeout=20) as r:
            d = json.loads(r.read().decode("utf-8"))
        if d.get("ok"):
            _write(path, json.dumps(d["courses"], separators=(",", ":")))
            return d["courses"]
    except Exception as e:
        print(f"Course pages: ace summary unavailable ({e}); using the last one.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def board(cid):
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{API}/ace/board?c={cid}", headers={"User-Agent": "GolfPriceAI build"}), timeout=20) as r:
            return (json.loads(r.read().decode("utf-8")) or {}).get("aces") or []
    except Exception:
        return []


def ordinal(n):
    n = int(n)
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def short_date(d):
    m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    y, mo, da = d.split("-")
    return f"{int(da)} {m[int(mo) - 1]} {y}"


def link(c, pages):
    return f"/courses/{pages[c['id']]}/" if c["id"] in pages else f"/courses/course/?c={c['id']}"


def course_body(c, near, within10, summ, aces, pages):
    """The page body. js/course.js draws the same markup for /courses/course/."""
    town = c.get("t") or ""
    nation = c.get("c") or ""
    count = summ.get("aces", 0)
    hole = summ.get("hole")
    nearest = f"{near[0][0]:.1f} mi" if near else "–"
    hole_txt = ("The " + ordinal(hole)) if hole else "–"
    ace_word = "ace" if count == 1 else "aces"
    near_town = (" near " + esc(town)) if town else ""
    in_nation = (", " + esc(nation)) if nation else ""
    soc_where = esc(town or "here")
    rows = "".join(
        f'<li><span><b>{ordinal(a["hole"])}</b> · {esc(a["nick"])} · {esc(a["club"])} · {a["yards"]} yds</span><span class="cs-date">{short_date(a["day"])}</span></li>'
        for a in aces)
    board_html = f'<ul class="cs-rows" id="cs-rows">{rows}</ul>' if rows else \
        '<p class="cs-empty" id="cs-rows">No aces on this board yet. The first one gets the top line forever.</p>'
    near_html = "".join(f'<a href="{link(o, pages)}"><span>{esc(o["n"])}</span><span class="cs-date">{d:.1f} mi</span></a>' for d, o in near) \
        or '<p class="cs-empty">No other courses within 30 miles.</p>'
    web = f' <span aria-hidden="true">·</span> <a href="{esc(c["w"])}" rel="nofollow noopener" target="_blank">Club website</a>' if c.get("w") else ""
    crumb_town = f' › {esc(town)}' if town else ""
    return f"""<div class="cs" data-course="{esc(c['id'])}" data-lat="{c['lat']}" data-lon="{c['lon']}">
<section class="cs-top">
  <nav class="cs-crumbs" aria-label="Breadcrumb"><a href="/courses/">Courses</a>{crumb_town}</nav>
  <h1>{esc(c['n'])}</h1>
  <p class="cs-meta">Golf course{near_town}{in_nation} <span aria-hidden="true">·</span> <a href="https://www.google.com/maps/dir/?api=1&amp;destination={c['lat']},{c['lon']}" rel="nofollow noopener" target="_blank">Directions</a>{web}</p>
</section>
<section class="cs-tiles">
  <div class="cs-tile cs-dark"><b id="cs-count">{count}</b><span>{ace_word} on record</span></div>
  <div class="cs-tile"><b id="cs-hole">{('The ' + ordinal(hole)) if hole else '–'}</b><span>the hungriest hole</span></div>
  <div class="cs-tile"><b>{within10}</b><span>other courses within 10 miles</span></div>
  <div class="cs-tile"><b>{nearest}</b><span>to the nearest other course</span></div>
</section>
<section class="cs-grid">
  <div class="cs-main">
    <div class="cs-card cs-board">
      <div class="cs-head"><h2>The ace board</h2><a href="/play/aces/">From the Ace Register</a></div>
      {board_html}
      <div class="cs-ctas"><a class="cs-btn" href="/play/aces/?c={esc(c['id'])}#log">Log an ace here</a><button type="button" class="cs-btn cs-ghost" id="cs-share">Share the board with the club</button></div>
    </div>
    <form class="cs-card cs-calc" id="cs-calc" onsubmit="return false">
      <div class="cs-calc-copy"><span class="cs-kick">YOUR SHOTS HERE</span><b>How many shots do you get at {esc(c['n'])}?</b>
        <span>Pop in your handicap index and the slope rating from the scorecard.</span></div>
      <div class="cs-calc-box">
        <div class="cs-calc-in"><label>Your index<input id="cs-i" type="number" inputmode="decimal" step="0.1" value="14.2"></label>
          <label>Slope<input id="cs-s" type="number" inputmode="numeric" value="125"></label></div>
        <div class="cs-calc-out"><b id="cs-ch">16</b><span>shots, before the course rating and par adjustment</span></div>
        <a href="/improve/course-handicap-calculator/">The exact figure, with course rating and par &rarr;</a>
      </div>
    </form>
  </div>
  <div class="cs-side">
    <div class="cs-card">
      <h2>Golf societies near {soc_where}</h2>
      <p class="cs-text">Looking for regular golf without a club membership? Find a society open to new members, or start your own free with Society HQ.</p>
      <div class="cs-links"><a href="/societies/find/">Find a Society &rarr;</a><a href="/societies/">Run your own society free &rarr;</a></div>
    </div>
    <div class="cs-card">
      <h2>Nearby courses</h2>
      <div class="cs-near">{near_html}</div>
    </div>
  </div>
</section>
<section class="cs-kit">
  <div><b>Playing {esc(c['n'])} soon?</b><span>Balls, gloves and waterproofs at the lowest prices we’ve tracked, checked every 6 hours across multiple UK retailers.</span></div>
  <div class="cs-kit-links"><a href="/prices/golf-balls/">Golf balls</a><a href="/prices/golf-gloves/">Gloves</a><a href="/prices/golf-jackets/">Waterproofs</a></div>
</section>
<p class="cs-attr">{ATTR} Not affiliated with {esc(c['n'])}. Spotted something wrong? <a href="mailto:GolfPriceAI@outlook.com?subject=Course%20page%3A%20{esc(c['id'])}">Tell us</a>.</p>
</div>"""


SCRIPTS = f'<script src="/js/course.js?v={V}" defer></script>'


def course_page(c, near, within10, summ, aces, pages):
    town = c.get("t") or ""
    count = summ.get("aces", 0)
    desc = (f"{c['n']}{' near ' + town if town else ''}: {count} hole-in-one{'s' if count != 1 else ''} on its ace board, "
            f"nearby golf courses and golf societies, and how many shots you get. Free on GolfPrice AI.")
    schema = [{"@context": "https://schema.org", "@type": "GolfCourse", "name": c["n"],
               "geo": {"@type": "GeoCoordinates", "latitude": c["lat"], "longitude": c["lon"]},
               **({"address": {"@type": "PostalAddress", "addressLocality": town, "addressCountry": "GB"}} if town else {}),
               **({"url": c["w"]} if c.get("w") else {})},
              {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                  {"@type": "ListItem", "position": 1, "name": "Courses", "item": SITE + "/courses/"},
                  {"@type": "ListItem", "position": 2, "name": c["n"], "item": f"{SITE}/courses/{pages[c['id']]}/"}]}]
    return page_shell(title=f"{c['n']}{' (' + town + ')' if town else ''}: Hole-in-One Board & Nearby Courses | GolfPrice AI",
                      description=desc, canonical=f"{SITE}/courses/{pages[c['id']]}/",
                      body=course_body(c, near, within10, summ, aces, pages) + SCRIPTS,
                      section="courses", schema=schema, noindex=False, extra_head=CSS)


def any_course_page():
    body = ('<div class="cs" id="cs-any"><p class="cs-empty cs-loading">Finding the course…</p></div>'
            '<noscript><p class="cs-attr">This page needs JavaScript switched on.</p></noscript>' + SCRIPTS)
    return page_shell(title="Golf course | GolfPrice AI", description="A UK golf course on GolfPrice AI: its ace board, nearby courses and golf societies.",
                      canonical=f"{SITE}/courses/course/", body=body, section="courses", schema=[], noindex=True, extra_head=CSS)


def hub(courses, summ, pages):
    by_nation = {n: sum(1 for c in courses if c.get("c") == n) for n in NATIONS}
    ids = {c["id"]: c for c in courses}
    top = sorted(((v.get("aces", 0), k) for k, v in summ.items() if k in ids), reverse=True)[:8]
    top_html = "".join(f'<a href="{link(ids[k], pages)}"><span>{esc(ids[k]["n"])}</span><b>{n}</b></a>' for n, k in top) \
        or '<p class="cs-empty">The first ace logged on the Ace Register puts its course here.</p>'
    nations = "".join(f'<a class="cs-nation" href="/courses/?nation={n.replace(" ", "+")}" data-nation="{esc(n)}"><b>{n}</b><span>{by_nation[n]:,} courses</span></a>'
                      for n in NATIONS if by_nation[n])
    total = len(courses)
    body = f"""<div class="cs cs-hub">
<section class="cs-hero">
  <span class="cs-kick">COURSES</span>
  <h1>All {total:,} UK golf courses.<br><span>Find yours.</span></h1>
  <p class="cs-lede">Every course’s ace board, the courses around it and how many shots you get. Free, and growing with every ace golfers log.</p>
  <div class="cs-search">
    <label class="cs-find"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5b665f" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg>
      <span class="cs-vh">Course name or town</span><input id="cs-q" type="text" placeholder="Course name or town" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="cs-list" aria-autocomplete="list"></label>
    <button type="button" class="cs-near-btn" id="cs-me"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8fd97c" stroke-width="2.4" aria-hidden="true"><path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>Courses near me</button>
    <ul class="cs-list" id="cs-list" role="listbox" hidden></ul>
  </div>
  <p class="cs-small">“Near me” uses your location once, on your phone or computer. It’s never sent to us.</p>
</section>
<section class="cs-results" id="cs-results" hidden aria-live="polite"></section>
<section class="cs-three">
  <div class="cs-card"><h2>Courses with the most aces</h2><div class="cs-near">{top_html}</div></div>
  <div class="cs-card"><h2>Latest aces</h2><div class="cs-near" id="cs-latest"><p class="cs-empty">Loading the register…</p></div></div>
  <div class="cs-card cs-dark-card"><span class="cs-kick cs-kick-light">THE ACE REGISTER</span><b>Had a hole-in-one?</b>
    <span>Put it on your course’s page for good, and get a certificate worth framing.</span><a class="cs-btn" href="/play/aces/#log">Log my ace</a></div>
</section>
<section class="cs-nations-sec"><h2>Browse by nation</h2><div class="cs-nations">{nations}</div></section>
<p class="cs-attr">Course list © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL), refreshed monthly. Missing a course? <a href="/play/aces/#log">Tell us</a>.</p>
</div>{SCRIPTS}"""
    faq = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "UK golf courses", "url": SITE + "/courses/",
           "description": f"All {total:,} UK golf courses with hole-in-one boards and nearby courses."}
    return page_shell(title=f"UK Golf Courses: All {total:,}, With Hole-in-One Boards | GolfPrice AI",
                      description=f"Find any of the UK’s {total:,} golf courses: its hole-in-one board, the courses nearby and how many shots you get. Search by name, town or near you.",
                      canonical=SITE + "/courses/", body=body, section="courses", schema=[faq], noindex=False, extra_head=CSS)


def build():
    try:
        courses = json.loads((DATA / "uk.json").read_text(encoding="utf-8")).get("courses", [])
    except (OSError, ValueError):
        print("Course pages: no course list yet.")
        return [], []
    if not courses:
        return [], []
    summ = ace_summary()
    slugs = assign_slugs(courses)
    ids = {c["id"]: c for c in courses}
    # A full, indexed page for every course with something on it.
    full = [cid for cid, s in summ.items() if cid in ids and s.get("aces", 0) > 0]
    # Keep pages made on earlier runs (links out there point at them).
    old = {}
    try:
        old = json.loads((DATA / "pages.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    pages = {cid: slugs[cid] for cid in set(full) | {k for k in old if k in ids}}
    grid = {}
    for c in courses:
        grid.setdefault((int(c["lat"] * 2), int(c["lon"] * 2)), []).append(c)
    changed, sitemap = [], [("courses/", None)]
    for cid, slug in sorted(pages.items()):
        c = ids[cid]
        near, within10 = nearby(c, courses, grid)
        s = summ.get(cid, {})
        aces = board(cid) if s.get("aces") else []
        if _write(DIR / slug / "index.html", course_page(c, near, within10, s, aces, pages)):
            changed.append(f"/courses/{slug}/")
        if s.get("aces"):
            sitemap.append((f"courses/{slug}/", None))
    _write(DIR / "course" / "index.html", any_course_page())
    if _write(DIR / "index.html", hub(courses, summ, pages)):
        changed.append("/courses/")
    _write(DATA / "pages.json", json.dumps(pages, separators=(",", ":"), sort_keys=True))
    print(f"Course pages: {len(courses)} courses, {len(pages)} full page(s), {len(sitemap) - 1} indexed.")
    return changed, sitemap


if __name__ == "__main__":
    print(build())
