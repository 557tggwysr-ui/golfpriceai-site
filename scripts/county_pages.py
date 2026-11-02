"""County pages: /societies/find/<county>/ ("Golf societies in Yorkshire").

A page for every county with real things on it: the golf societies there that
are open to new members (and their spare places), the county's golf courses
(how many, the towns with the most, every one A to Z), holes-in-one on the Ace
Register, the county's National Society League region, and questions answered
from those same numbers. Built with every price run (called from society.build).

A county gets a page once it has a listed society or at least MIN_COURSES
courses placed in it (course_counties.py), so there are no empty pages.
"""
import json
import math
from html import escape as e
from urllib.parse import quote
from pathlib import Path

from price_pages import SITE, _write, breadcrumb, page_shell

ROOT = Path(__file__).resolve().parent.parent
MIN_COURSES = 3
LEAGUE = {
    "North East": ["Northumberland", "Tyne and Wear", "Durham"],
    "North West": ["Cumbria", "Lancashire", "Greater Manchester", "Merseyside", "Cheshire", "Isle of Man"],
    "Yorkshire": ["Yorkshire"],
    "Midlands": ["Derbyshire", "Nottinghamshire", "Lincolnshire", "Leicestershire", "Rutland", "Northamptonshire", "Staffordshire",
                 "Shropshire", "Herefordshire", "Worcestershire", "Warwickshire", "West Midlands"],
    "East of England": ["Norfolk", "Suffolk", "Essex", "Cambridgeshire", "Bedfordshire", "Hertfordshire"],
    "London and South East": ["Greater London", "Kent", "Surrey", "East Sussex", "West Sussex", "Hampshire", "Isle of Wight",
                              "Berkshire", "Buckinghamshire", "Oxfordshire"],
    "South West": ["Cornwall", "Devon", "Somerset", "Dorset", "Wiltshire", "Gloucestershire", "Bristol", "Channel Islands"],
    "Scotland": ["Aberdeenshire", "Angus and Dundee", "Ayrshire and Arran", "Dumfries and Galloway", "Edinburgh and the Lothians", "Fife",
                 "Glasgow and Clyde", "Highlands and Islands", "Perth and Kinross", "Scottish Borders", "Stirling and Central Scotland"],
    "Wales and Northern Ireland": ["North Wales", "Mid Wales", "South Wales", "West Wales", "Northern Ireland"],
}
REGION_OF = {c: r for r, cs in LEAGUE.items() for c in cs}


def _load(name, default):
    try:
        return json.loads((ROOT / "data" / "courses" / name).read_text())
    except (OSError, ValueError):
        return default


def _num(n):
    return f"{n:,}"


def course_url(c, pages):
    p = pages.get(c["id"])
    if isinstance(p, dict):
        p = p.get("url") or p.get("path")
    return p if isinstance(p, str) and p.startswith("/") else f"/courses/course/?c={c['id']}"


def county_data(counties_map=None):
    """{county: {"courses": [...], "aces": n, "lat": .., "lon": ..}} from the course list."""
    courses = _load("uk.json", {}).get("courses") or []
    cmap = counties_map if counties_map is not None else {k: v.lstrip("~") for k, v in _load("counties.json", {}).items() if v}
    summ = _load("aces.json", {})
    out = {}
    for c in courses:
        k = cmap.get(c["id"])
        if not k:
            continue
        d = out.setdefault(k, {"courses": [], "aces": 0})
        d["courses"].append(c)
        s = summ.get(c["id"]) if isinstance(summ, dict) else None
        if isinstance(s, dict):
            d["aces"] += int(s.get("aces") or 0)
    for d in out.values():
        d["lat"] = sum(c["lat"] for c in d["courses"]) / len(d["courses"])
        d["lon"] = sum(c["lon"] for c in d["courses"]) / len(d["courses"])
    return out


def towns(courses, n=6):
    count = {}
    for c in courses:
        t = (c.get("t") or "").strip()
        if t:
            count[t] = count.get(t, 0) + 1
    return sorted(count.items(), key=lambda t: (-t[1], t[0]))[:n]


def nearby(county, data, n=5):
    me = data.get(county)
    if not me:
        return []
    dist = lambda d: math.hypot(d["lat"] - me["lat"], (d["lon"] - me["lon"]) * math.cos(math.radians(me["lat"])))
    return [k for k, _ in sorted(((k, dist(d)) for k, d in data.items() if k != county), key=lambda t: t[1])[:n]]


def faqs(county, rows, d):
    n = len(d["courses"]) if d else 0
    top = towns(d["courses"], 3) if d else []
    k = len(rows)
    out = []
    if n:
        out.append((f"How many golf courses are there in {county}?",
                    f"There are {_num(n)} golf courses in {county} on our UK course list (from OpenStreetMap)" +
                    (f", with the most around {', '.join(f'{t} ({c})' for t, c in top)}." if top else ".") +
                    " Every one has its own page with the courses nearby and its ace board."))
    out.append((f"How do I join a golf society in {county}?",
                (f"{k} {county} golf {'society is' if k == 1 else 'societies are'} taking new members on GolfPrice AI right now. " if k else
                 f"No {county} golf societies are listed yet. ") +
                "Open a society’s page, tap “Ask to join”, and the organiser answers you there. Some also list spare places on their next golf day, so you can try a day before you join."))
    out.append(("Do I need a handicap to join a golf society?",
                "Usually not. Most golf societies welcome golfers without an official handicap and give you one after a few rounds; some ask for an official handicap. Each society’s listing says which, and whether beginners are welcome."))
    out.append(("How much does a golf society day cost?",
                "Society green fees are typically about £30 to £55 a golfer, or roughly £67 to £75 with a bacon roll and a two-course meal, from published club society rates. Our guide to "
                "golf society day costs has a free calculator."))
    if county in REGION_OF:
        out.append((f"Is there a golf society league in {county}?",
                    f"Yes. {county} golf societies can enter the free National Society League in the {REGION_OF[county]} region for the 2027 season (April to October), scored from their society days, with promotion and relegation."))
    return out


def page(county, rows, d, data, chips_html, spare_html, cards_html, list_schema, pages):
    import society_counties as sc
    slug = sc.slug(county)
    url = f"{SITE}/societies/find/{slug}/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", "/societies/find/"), (county, None)])
    courses = sorted(d["courses"], key=lambda c: c["n"].lower()) if d else []
    n, k, aces = len(courses), len(rows), (d["aces"] if d else 0)
    region = REGION_OF.get(county)
    tops = towns(courses)
    qa = faqs(county, rows, d)
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]}
    place = {"@context": "https://schema.org", "@type": "CollectionPage", "name": f"Golf societies and golf courses in {county}", "url": url,
             "about": {"@type": "AdministrativeArea", "name": county, "containedInPlace": {"@type": "Country", "name": "United Kingdom"}},
             "mainEntity": {"@type": "ItemList", "name": f"Golf courses in {county}", "numberOfItems": n,
                            "itemListElement": [{"@type": "ListItem", "position": i + 1, "item": {"@type": "GolfCourse", "name": c["n"],
                                                 "address": {"@type": "PostalAddress", "addressLocality": c.get("t") or "", "addressRegion": county, "addressCountry": "GB"},
                                                 "url": SITE + course_url(c, pages)}} for i, c in enumerate(courses[:100])]}}
    stats = "".join(f'<div><b>{v}</b><small>{l}</small></div>' for v, l in [
        (k, ("society" if k == 1 else "societies") + " taking members"), (_num(n), "golf course" + ("" if n == 1 else "s")),
        (aces, "hole" + ("" if aces == 1 else "s") + "-in-one logged"), (e(region) if region else "–", "League region")])
    intro = (f"Regular golf without a full club membership. Golf societies in {e(county)} open to new members"
             + (f", the county’s {_num(n)} golf courses" if n else "") + ", and everything you need to start your own.")
    socs = (f'<div class="cp-h"><h2>Societies looking for members</h2></div>{cards_html}' if k else
            f'<section class="soc-card cp-first"><span class="soc-kick">Be the first</span><h2>No {e(county)} golf societies listed yet</h2>'
            f'<p class="soc-help">Run a golf society in {e(county)}? List it free and golfers nearby can find you, ask to join, and take a spare place on your next day.</p>'
            f'<a class="soc-btn" href="/societies/hq/">List your golf society</a></section>')
    town_chips = "".join(f'<span class="cp-town">{e(t)} <b>{c}</b></span>' for t, c in tops)
    az = "".join(f'<li><a href="{course_url(c, pages)}">{e(c["n"])}</a>{(" <small>" + e(c["t"]) + "</small>") if c.get("t") else ""}</li>' for c in courses)
    courses_html = (f'<section class="soc-card cp-courses"><h2>Golf courses in {e(county)}</h2>'
                    f'<p class="soc-help">{_num(n)} course{"" if n == 1 else "s"}' + (f". The most in one place: {e(', '.join(f'{t} ({c})' for t, c in tops[:4]))}." if tops else ".") + '</p>'
                    + (f'<div class="cp-towns">{town_chips}</div>' if tops else "") +
                    f'<details class="cp-az"><summary>All {_num(n)} courses, A to Z</summary><ul>{az}</ul></details></section>') if n else ""
    aces_html = (f'<section class="soc-card"><h2>The Ace Register in {e(county)}</h2><p class="soc-help">' +
                 (f'{aces} hole{"" if aces == 1 else "s"}-in-one logged at {e(county)} courses so far.' if aces else f'No holes-in-one logged at {e(county)} courses yet. The first one goes on the board for good.') +
                 '</p><a class="soc-link-a" href="/play/aces/">Log an ace &rarr;</a></section>')
    league_html = (f'<section class="soc-card"><h2>The National Society League</h2><p class="soc-help">{e(county)} golf societies play in the <b>{e(region)}</b> region: '
                   'regional divisions of up to 10 societies, scored from your society days, with promotion and relegation. Free, 2027 season.</p>'
                   f'<a class="soc-link-a" href="/societies/league/?r={quote(region)}">See the {e(region)} table &rarr;</a></section>') if region else ""
    near = nearby(county, data)
    near_html = ('<p class="cp-near">Nearby: ' + " · ".join(f'<a href="/societies/find/{sc.slug(c)}/">{e(c)}</a>' for c in near) + '</p>') if near else ""
    faq_html = "".join(f'<details class="sh-q"><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in qa).replace(
        "Our guide to golf society day costs", 'Our guide to <a href="/societies/guides/how-much-to-charge-for-a-golf-society-day/">golf society day costs</a>')
    body = f"""<div class="soc-wrap cp-wrap">
{crumbs_html}
<section class="cp-hero">
  <span class="soc-kick">Find a Society · {e(county)}</span>
  <h1>Golf societies in {e(county)}</h1>
  <p>{intro}</p>
  <div class="cp-stats">{stats}</div>
</section>
<div class="cp-grid">
  <div class="cp-col">{socs}{spare_html}</div>
  <div class="cp-col">{courses_html}{aces_html}{league_html}</div>
</div>
<section class="soc-card soc-next cp-start"><span class="soc-kick">Run one? Start one?</span><h2>Start a golf society in {e(county)}</h2>
<p>{"With " + _num(n) + " courses to choose from, the hard part is agreeing where. " if n > 5 else ""}Society HQ does the fixtures, sign-ups, who’s paid, polls and live scoring, free. Pick {e(county)} and tick “Open to new members”, and golfers nearby can find you here.</p>
<div class="soc-btns"><a class="soc-btn" href="/societies/hq/">Start your golf society</a><a class="soc-btn2" href="/societies/guides/how-to-start-a-golf-society/">How to start one</a></div></section>
<section class="soc-card sh-faq"><h2>Questions golfers in {e(county)} ask</h2>{faq_html}</section>
{near_html}
<div class="soc-card"><h2>Golf societies in other counties</h2>{chips_html}<a class="soc-link-a" href="/societies/find/">All golf societies &rarr;</a></div>
<p class="gp-real">Course list from OpenStreetMap (ODbL); counties from postcodes.io (Office for National Statistics, Open Government Licence). Society details are written by their organisers. <a href="/legal/privacy-policy.html">Privacy</a></p>
</div>"""
    title = f"Golf Societies in {county}: Join One Near You" + (f" ({_num(n)} Courses)" if n else "") + " | GolfPrice AI"
    desc = (f"{k} golf societ{'y' if k == 1 else 'ies'} in {county} open to new members" if k else f"Golf societies in {county}") + \
           (f", the county’s {_num(n)} golf courses" if n else "") + ", spare places, the League and how to start your own. Free."
    schema = [crumbs_schema, place, faq_schema] + ([list_schema] if k else [])
    return page_shell(title=title, description=desc, canonical=url, body=body, section="societies", schema=schema, noindex=False,
                      og_image="/assets/cards/society-hq.jpg",
                      extra_head='<link rel="stylesheet" href="/css/society.css?v=20261102a">\n')


def chips(all_counties, rows, live, current=None):
    """Every county with a page, and how many societies each has listed."""
    import society_counties as sc
    counts = {}
    for x in rows:
        counts[x.get("county")] = counts.get(x.get("county"), 0) + 1
    out = []
    for c in sorted(live):
        label = e(c) + (f" ({counts[c]})" if counts.get(c) else "")
        out.append(f'<span class="fd-chip is-on">{label}</span>' if c == current else f'<a class="fd-chip" href="/societies/find/{sc.slug(c)}/">{label}</a>')
    return '<nav class="fd-chips" aria-label="Golf societies by county">' + "".join(out) + "</nav>"


def build(root, rows, find_cards, spare_panel, list_schema_fn, counties_map=None):
    """Write the county pages. Returns (changed paths, sitemap urls, chips html for the Find a Society hub)."""
    import shutil
    import society_counties as sc
    try:
        import course_counties
        cmap = course_counties.build() if counties_map is None else counties_map
    except Exception as exc:  # never stop the build
        print(f"Course counties skipped: {exc}")
        cmap = None
    data = county_data(cmap)
    pages = _load("pages.json", {})
    by = {}
    for x in rows:
        if sc.known(x.get("county") or ""):
            by.setdefault(x["county"], []).append(x)
    live = sorted(c for c in sc.COUNTIES if by.get(c) or len((data.get(c) or {}).get("courses") or []) >= MIN_COURSES)
    chip_html = lambda cur=None: chips(sc.COUNTIES, rows, live, current=cur)
    changed, urls = [], []
    for c in live:
        rs = by.get(c, [])
        html = page(c, rs, data.get(c), data, chip_html(c), spare_panel(rs), find_cards(rs) if rs else "", list_schema_fn(rs, f"Golf societies in {c}") if rs else None, pages)
        if _write(root / "societies" / "find" / sc.slug(c) / "index.html", html):
            changed.append(f"/societies/find/{sc.slug(c)}/")
        urls.append(f"societies/find/{sc.slug(c)}/")
    keep = {sc.slug(c) for c in live}
    for d in (root / "societies" / "find").iterdir():
        if d.is_dir() and d.name not in keep and d.name in {sc.slug(c) for c in sc.COUNTIES}:
            shutil.rmtree(d)
            changed.append(f"/societies/find/{d.name}/")
    print(f"County pages: {len(live)} counties.")
    return changed, urls, chip_html()
