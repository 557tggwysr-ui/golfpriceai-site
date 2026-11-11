"""Society HQ pages (built with every price run, like the games).

/societies/awards/  The Society Awards Night Kit: an organiser types their
                    season's awards and winners and gets award cards for the
                    WhatsApp group, a presentation-night slideshow and, for
                    awards with a budget, Prize Picker links (js/society-awards.js).
/societies/prize/   Prize Picker: a winner opens their private link and picks a
                    prize within budget from today's real prices (js/prize-picker.js).

Both are filled by the browser from the alerts worker (/soc/...). Nothing about
money passes through the site. Live since 24 October 2026 (LAUNCHED = True lets the public pages be indexed;
the prize page always stays out of search).
"""
from price_pages import SITE, _write, breadcrumb, page_shell

LAUNCHED = True
PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/society-hq-wide.jpg"><img src="/assets/photos/tools/society-hq-banner.jpg" alt="A golf society gathered by the first tee on a misty morning with coffees and bacon rolls, the organiser smiling at his phone" width="1536" height="512"></picture>'
FIND_PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/find-a-society-wide.jpg"><img src="/assets/photos/tools/find-a-society-banner.jpg" alt="Golfers shaking hands on the first tee, meeting new playing partners" width="1536" height="512"></picture>'
CSS = '<link rel="stylesheet" href="/css/society.css?v=20261111a">\n'
REAL = ('<p class="gp-real">Every prize price is real: the lowest new UK price we found today, across multiple UK '
        'retailers. No money is taken or held by GolfPrice AI. <a href="/legal/privacy-policy.html">Privacy</a> · '
        '<a href="/play/">Play</a> · <a href="/shop.html">Browse the shop</a></p>')

import os
API = os.environ.get("SOC_API", "https://golfpriceai-alerts.golfpriceai.workers.dev")
APP_FEATURES = [
    "Golf society fixtures calendar shared from one WhatsApp link",
    "In, out or maybe sign-ups for every golf society day",
    "Automatic waiting list when a golf day is full",
    "Organiser's paid ticks: only paid players are confirmed",
    "Money Sorted: a payment reference and an \"I've paid\" button for every member, one-tap confirmation, a chase-the-unpaid WhatsApp message, a drop-out rule and a season kitty",
    "Pay the organiser button using the organiser's own PayPal, Monzo or Revolut link",
    "Final numbers message for the golf club",
    "Golf society prize fund calculator",
    "Find a Society: UK golf societies open to new members",
    "The Form Guide: a preview of every society day with each golfer's form and players to watch",
    "Match reports written from the stableford scores, with countback, awards and a winner's card",
    "A season Order of Merit for every golf society",
    "Golf society Awards Night Kit: award cards and a presentation slideshow",
    "Prize Picker: winners choose their own golf prize at today's lowest UK price",
    "The National Society League: regional divisions with promotion and relegation, scored from your society days",
    "Polls for the WhatsApp group: pick the course, the trip or the format, or find the date that suits most members; the winner becomes a fixture",
    "Live scoring: one phone per group, stableford points from handicaps, and a live leaderboard for the WhatsApp group",
]


def app_schema(url):
    return {"@context": "https://schema.org", "@type": "WebApplication", "name": "Society HQ",
            "alternateName": ["GolfPrice AI Society HQ", "Society HQ golf society organiser"],
            "url": url, "applicationCategory": "SportsApplication", "operatingSystem": "Any web browser",
            "description": "A free golf society organiser for UK golf societies: fixtures, sign-ups, who's paid, waiting lists, "
                           "awards night and prizes, run from one link in the WhatsApp group. No sign-up and no fees.",
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
            "featureList": APP_FEATURES, "inLanguage": "en-GB",
            "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}


def listings(root):
    """Societies whose organiser ticked "Open to new members", fetched from the
    worker at build time so the page carries them as plain HTML (AI crawlers
    don't run JavaScript). Falls back to the last good copy if the worker is
    unreachable, so a failed fetch never empties the page."""
    import json, urllib.request
    cache = root / "data" / "societies" / "find.json"
    try:
        req = urllib.request.Request(API + "/soc/find", headers={"User-Agent": "golfpriceai-build"})
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read()).get("societies") or []
        rows = sorted(({"id": x["id"], "name": x["name"], "area": x.get("area") or "", "about": x.get("about") or "",
                        "members": int(x.get("members") or 0), "founding": int(x.get("founding") or 0), "county": x.get("county") or "",
                        "course": x.get("course") or "", "town": x.get("town") or "", "lat": x.get("lat"), "lon": x.get("lon"),
                        "days": x.get("days") or "", "ability": x.get("ability") or "", "cost": x.get("cost") or "",
                        "spare": x.get("spare") or [], "league": x.get("league")} for x in rows), key=lambda x: (x["area"].lower(), x["name"].lower()))
        _write(cache, json.dumps({"societies": rows}, ensure_ascii=False, indent=0) + "\n")
        return rows
    except Exception as e:  # never stop the build
        print(f"Find a Society: using cached listings ({e})")
        try:
            return json.loads(cache.read_text()).get("societies") or []
        except Exception:
            return []


def awards_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Awards Night Kit", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Free · Society HQ</span>
  <h1>Golf Society Awards Night Kit</h1>
  <p>Free end-of-season awards for your golf society: award cards for the WhatsApp group, a slideshow for the presentation night, and golf prizes the winners pick themselves. Ready in five minutes, no sign-up.</p>
</section>
<div id="aw" aria-live="polite"><p class="soc-loading">Polishing the trophies…</p></div>
<noscript><p>The Awards Night Kit needs JavaScript switched on.</p></noscript>
<section class="soc-faq">
  <h2>Questions organisers ask</h2>
  <div class="soc-faq-grid">
    <div><h3>Is it really free?</h3><p>Yes. No sign-up, no fees. We earn a small commission if a winner’s prize is bought through one of our links, at no extra cost to you.</p></div>
    <div><h3>How do prizes work?</h3><p>Give an award a budget and its winner gets a private link to pick their own prize at today’s lowest UK price. You get one shopping list with the links. You buy the prizes as normal; we never take or hold money.</p></div>
    <div><h3>Who can see our awards?</h3><p>Anyone you send the link to. Only your browser can edit them, and only you see the prize links. Use nicknames if you prefer. Awards nobody looks at for 400 days are tidied away.</p></div>
    <div><h3>Can I change things later?</h3><p>Yes, from the same phone or computer you made them on. If you change a winner, their prize pick starts again.</p></div>
  </div>
</section>
{REAL}
</div>
<script src="/js/society-awards.js?v=20261024c" defer></script>"""
    return page_shell(title="Golf Society Awards: free award cards, slideshow and prizes | GolfPrice AI",
                      description="Free golf society awards: award cards for the WhatsApp group, a presentation-night slideshow, and prizes winners pick themselves at today's lowest UK prices.",
                      canonical=f"{SITE}/societies/awards/", body=body, section="societies", schema=[crumbs_schema, app_schema(f"{SITE}/societies/awards/")],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


def prize_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Pick your prize", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<div id="pz" aria-live="polite"><p class="soc-loading">Unwrapping your prize…</p></div>
<noscript><p>Prize Picker needs JavaScript switched on.</p></noscript>
{REAL}
</div>
<script src="/js/prize-picker.js?v=20261024" defer></script>"""
    return page_shell(title="Pick your prize | Society Awards Night Kit | GolfPrice AI",
                      description="You won! Pick your own prize within budget at today's lowest UK prices.",
                      canonical=f"{SITE}/societies/prize/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


def fg_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("The Form Guide", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<div class="fg" id="fg" aria-live="polite"><p class="soc-loading">Reading the form…</p></div>
<noscript><p>The Form Guide needs JavaScript switched on.</p></noscript>
</div>
<script src="/js/form-guide.js?v=20261101c" defer></script>"""
    return page_shell(title="The Form Guide | Society HQ | GolfPrice AI",
                      description="Your golf society day, treated like a tour event: a preview with everyone's form, then a report with the leaderboard and awards.",
                      canonical=f"{SITE}/societies/form-guide/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=CSS + '<link rel="stylesheet" href="/css/form-guide.css?v=20261101b">\n')


LEAGUE_FAQS = [
    ("How does a society enter the National Society League?",
     "The organiser opens the society in Society HQ and taps “Enter the League”, picks a region and the handicap allowance the society plays off. It’s free. Entries open on 1 February 2027; societies can register early."),
    ("How is a society’s score worked out?",
     "Each month, a society’s team score is the average of its four best stableford scores (one per golfer) from society days with at least four golfers. The best team score in the division that month earns 10 points, then 8, 6, 5, 4, 3, 2 and 1."),
    ("What about different handicap allowances?",
     "The organiser picks 95% or 100% when entering, and it’s fixed once the season starts. Societies on 100% have 1 point taken off their team score, about the difference for a typical golfer, and it’s shown on the table."),
    ("How do divisions, promotion and relegation work?",
     "Divisions hold up to 10 societies, by region, filled in the order societies enter. At the end of the season the top two in each division go up and the bottom two go down."),
    ("Is there a final?",
     "Each division’s winner is crowned in October and goes on the League’s Hall of Fame. Societies can also tick that they’d be up for a Champions’ Day; if there’s enough interest, we’ll look at making one happen."),
    ("Is it checked?",
     "Scores are on the honour system, the way golf has always worked, and come from the Form Guide reports organisers publish. Anything that doesn’t look right is taken off the table."),
]


def league_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("The National Society League", None)])
    faqs = "".join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in LEAGUE_FAQS)
    regions = "".join(f'<li>{r}</li>' for r in ["North East", "North West", "Yorkshire", "Midlands", "East of England", "London and South East", "South West", "Scotland", "Wales and Northern Ireland"])
    body = f"""<div class="or nsl" id="nsl">
<div class="nsl-crumbs">{crumbs_html}</div>
<section class="or-hero">
  <div>
    <span class="cc-kick">SOCIETY HQ · 2027 SEASON</span>
    <h1>The National Society <span>League.</span></h1>
    <p class="or-quip">Your society against every other society in your region. Promotion, relegation and a lot of bragging.</p>
    <p>Free to enter. Your society days count automatically from the Form Guide. The season runs April to October, and each division’s winner is crowned in October.</p>
    <div class="nsl-ctas"><a class="cc-btn" href="/societies/hq/">Enter your society</a><a class="nsl-ghost" href="#how">How scoring works</a></div>
  </div>
  <div class="or-stats" aria-live="polite">
    <div><b class="or-green" data-nsl="open">1 Feb</b><span data-nsl="openl">entries open</span></div>
    <div><b data-nsl="total">–</b><span>societies entered</span></div>
    <div><b>9</b><span>regions</span></div>
  </div>
</section>

<section class="or-steps" id="how" aria-label="How it works">
  <div><b>1</b><h3>Play your society days</h3><p>Run them in Society HQ as usual. Enter the stableford scores and the Form Guide report goes out, same as now.</p></div>
  <div><b>2</b><h3>Your best four count</h3><p>Each month, your team score is the average of your four best stableford scores. Big or small, every society competes fairly.</p></div>
  <div><b>3</b><h3>Monthly points, one table</h3><p>Top team score in your division wins 10 points, then 8, 6, 5, 4, 3, 2 and 1. Top two go up, bottom two go down.</p></div>
</section>

<div class="or-two" id="nsl-main">
  <section class="or-card" aria-labelledby="nsl-h">
    <div class="or-head"><h2 id="nsl-h">Find your division</h2><span class="pb-dim">Divisions of up to 10 societies</span></div>
    <ul class="nsl-regions" id="nsl-regions">{regions}</ul>
  </section>
  <div class="or-col">
    <section class="or-card pb-vs" id="nsl-sotm" hidden></section>
    <section class="or-card">
      <span class="cc-kick">CROWNED IN OCTOBER</span>
      <b class="pb-race-h">Division champions</b>
      <span class="pb-dim">Each division’s winner is crowned at the end of the season, with a champions’ card and a place on the League’s Hall of Fame.</span>
    </section>
    <section class="or-card or-you">
      <b class="pb-race-h">Fair play</b>
      <span class="pb-dim">Scores are on the honour system, the way golf has always worked. At least four golfers must play for a day to count. Anything daft comes off the table.</span>
    </section>
  </div>
</div>

<section class="or-faqs"><h2>League questions</h2>{faqs}</section>
</div>
<noscript><p>The League tables need JavaScript switched on.</p></noscript>
<script src="/js/society-league.js?v=20261101" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in LEAGUE_FAQS]}
    event = {"@context": "https://schema.org", "@type": "SportsEvent", "name": "The National Society League 2027",
             "description": "A free national league for UK golf societies: regional divisions scored from each society's stableford results, with promotion and relegation.",
             "sport": "Golf", "startDate": "2027-04-01", "endDate": "2027-10-31", "eventStatus": "https://schema.org/EventScheduled",
             "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
             "location": {"@type": "Place", "name": "Golf courses across the UK", "address": {"@type": "PostalAddress", "addressCountry": "GB"}},
             "organizer": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
             "isAccessibleForFree": True, "url": f"{SITE}/societies/league/"}
    return page_shell(title="National Society League: Free UK Golf Society League 2027 | GolfPrice AI",
                      description="A free league for UK golf societies: regional divisions, promotion and relegation, scored automatically from your society days. Entries open 1 February 2027.",
                      canonical=f"{SITE}/societies/league/", body=body, section="societies", schema=[crumbs_schema, faq_schema, event],
                      noindex=False, og_image="/assets/cards/society-hq.jpg",
                      extra_head=CSS + '<link rel="stylesheet" href="/css/caddie.css?v=20261101d">\n')


def hq_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Run your golf society", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<div id="hq" aria-live="polite"><section class="soc-hero">{PHOTO}<span class="soc-kick">Free · Society HQ</span><h1>Run your golf society free</h1>
<p>Society HQ is a free golf society organiser. Fixtures, in, out or maybe sign-ups, a waiting list, who’s paid and the prize fund, all from one link in your society’s WhatsApp group. No sign-up, no app and no fees.</p></section>
<p class="soc-loading">Opening the clubhouse…</p></div>
<noscript><p>Society HQ needs JavaScript switched on.</p></noscript>
<section class="soc-faq">
  <h2>How Society HQ runs your golf society</h2>
  <div class="soc-faq-grid">
    <div><h3>No sign-up</h3><p>Like our games, your phone remembers you. Members join with a nickname from one link in the WhatsApp group. Play on the same phone each time, not a private tab.</p></div>
    <div><h3>Money sorted</h3><p>Every member gets a payment reference and an “I’ve paid” button, and the organiser confirms with one tap. “Chase the unpaid” writes the WhatsApp message for you, an optional drop-out rule covers late drop-outs, and the season kitty keeps track of credit, refunds and subs. Payments go straight to the organiser: we never take, hold or see any money.</p></div>
    <div><h3>Waiting list</h3><p>Set a maximum and anyone after that goes on the waiting list. When someone drops out, the first in the queue moves up automatically.</p></div>
    <div><h3>Who can see it</h3><p>Only members see the fixtures, who’s playing and who’s paid. The Form Guide preview and report for each day can be read by anyone you send the link to: nicknames and points only. If the organiser lists the society in Find a Society, only its name, area and description are public.</p></div>
    <div><h3>The Form Guide</h3><p>Every society day gets a preview with everyone’s form and the players to watch. Enter the scores afterwards and it becomes a report: the leaderboard, the awards, the Order of Merit and a winner’s card.</p></div>
  </div>
</section>
{REAL}
</div>
<script src="/js/clubhouse-key.js?v=20261101b" defer></script>
<script src="/js/milestones.js?v=20261106a" defer></script>
<script src="/js/society-hq.js?v=20261111a" defer></script>"""
    return page_shell(title="Run your golf society free | Society HQ | GolfPrice AI",
                      description="Run your golf society for free: fixtures, sign-ups, who’s paid, a waiting list and the prize fund, all from one link in the WhatsApp group.",
                      canonical=f"{SITE}/societies/hq/", body=body, section="societies", schema=[crumbs_schema, app_schema(f"{SITE}/societies/hq/")],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


DAYS = {"sat": "Saturdays", "sun": "Sundays", "wkend": "Weekends", "wkday": "Weekdays", "mix": "Weekdays and weekends"}
ABILITY = {"all": "All abilities", "beg": "Beginners welcome", "hcp": "Official handicap needed"}


def soc_slug(x):
    import re
    return (re.sub(r"[^a-z0-9]+", "-", x["name"].lower()).strip("-")[:48] or "golf-society") + "-" + x["id"]


def soc_url(x):
    return f"/societies/find/{soc_slug(x)}/"


def nice_day(iso, long=False):
    from datetime import date
    d = date.fromisoformat(iso)
    return d.strftime("%a %-d %b") if not long else d.strftime("%A %-d %B")


def spare_line(x):
    if not x.get("spare"):
        return ""
    ev = x["spare"][0]
    n = int(ev.get("spare") or 0)
    return f'<span class="fd-spare">{n} spare place{"" if n == 1 else "s"} · {nice_day(ev["day"])}</span>'


def find_cards(rows):
    from html import escape as e
    if not rows:
        return '<div class="soc-card"><p class="soc-help">No golf societies are listed yet. Run one? Be the first: it’s free.</p></div>'
    out = []
    for x in rows:
        n = x["members"]
        where = x.get("course") and f'Home course {x["course"]}' or ", ".join(v for v in (x["area"], x.get("county") if x.get("county") != x["area"] else "") if v) or "UK"
        bits = [where, f'{n} member{"" if n == 1 else "s"}'] + ([DAYS[x["days"]]] if x.get("days") in DAYS else [])
        badges = (f'<span class="fd-badge fd-b-found">Founding No. {x["founding"]}</span>' if x.get("founding") else "") + \
                 (f'<span class="fd-badge fd-b-lg">League: {e(x["league"]["region"])} Div {x["league"]["division"]}</span>' if x.get("league") else "") + \
                 (f'<span class="fd-badge fd-b-beg">Beginners welcome</span>' if x.get("ability") == "beg" else "")
        out.append(f'<a class="soc-card fd-card" href="{soc_url(x)}" data-id="{e(x["id"])}"><div class="fd-card-top"><h2>{e(x["name"])}</h2><span class="fd-dist" hidden></span></div>'
                   f'<span class="fd-meta">{e(" · ".join(bits))}</span>' + (f'<span class="fd-badges">{badges}</span>' if badges else "") +
                   (f'<p>{e(x["about"])}</p>' if x["about"] else "") + (f'<span class="fd-cost">Usually {e(x["cost"])} a golf day</span>' if x.get("cost") else "") +
                   spare_line(x) + '<span class="fd-go">Have a look &rarr;</span></a>')
    return '<div class="fd-list">' + "".join(out) + '</div>'


def spare_panel(rows, limit=6):
    from html import escape as e
    evs = sorted(((ev, x) for x in rows for ev in (x.get("spare") or [])), key=lambda t: t[0]["day"])[:limit]
    if not evs:
        return ""
    items = "".join(f'<a class="fd-sp" href="{soc_url(x)}#spare" data-id="{e(x["id"])}"><span><b>{nice_day(ev["day"])}</b> · {e(x["name"])}<small>{e(ev.get("venue") or ev.get("title") or "")}'
                    f'{" · £" + format(ev["entry"], "g") if ev.get("entry") else ""}</small></span><b class="fd-sp-n">{ev["spare"]} place{"" if ev["spare"] == 1 else "s"}</b></a>' for ev, x in evs)
    return (f'<section class="soc-card fd-spare-box" id="fd-spare"><span class="soc-kick fd-kick-o">Spare places</span><h2>Fancy a game this month?</h2>'
            f'<p class="soc-help">Societies with a gap in the four-ball. Ask, and the organiser says yes or no.</p><div class="fd-sps">{items}</div></section>')


def find_data(rows):
    import json
    keep = ("id", "name", "area", "county", "members", "founding", "course", "town", "lat", "lon", "days", "ability", "cost", "spare", "league", "about")
    data = [dict({k: x.get(k) for k in keep}, url=soc_url(x)) for x in rows]
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def society_page(x, rows):
    """A public page for each listed society: what it's like, where and when it
    plays, spare places, and Ask to join. Society names and nicknames only:
    members are never listed."""
    import math
    import society_counties as sc
    from html import escape as e
    url = SITE + soc_url(x)
    place = x.get("town") or x["area"] or x.get("county") or "the UK"
    trail = [("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", "/societies/find/")]
    if x.get("county") and sc.known(x["county"]) and county_counts(rows).get(x["county"], 0) >= sc.MIN_LISTED:
        trail.append((x["county"], f"/societies/find/{sc.slug(x['county'])}/"))
    crumbs_html, crumbs_schema = breadcrumb(trail + [(x["name"], None)])

    def dist(a, b):
        if a.get("lat") is None or b.get("lat") is None:
            return 9999 if a.get("county") != b.get("county") or not a.get("county") else 50
        r = math.radians
        h = math.sin(r(b["lat"] - a["lat"]) / 2) ** 2 + math.cos(r(a["lat"])) * math.cos(r(b["lat"])) * math.sin(r(b["lon"] - a["lon"]) / 2) ** 2
        return 3959 * 2 * math.asin(math.sqrt(h))
    near = sorted((y for y in rows if y["id"] != x["id"]), key=lambda y: dist(x, y))[:3]
    near = [y for y in near if dist(x, y) < 60]
    facts = [("Home course", x.get("course") or x["area"] or "Ask the organiser"), ("Plays", DAYS.get(x.get("days"), "Ask the organiser")),
             ("Handicaps", ABILITY.get(x.get("ability"), "All welcome")), ("A golf day costs", x.get("cost") or "Ask the organiser")]
    spare = "".join(f'<div class="fd-sp-row"><span><b>{nice_day(ev["day"], True)}</b>{" · " + e(ev["venue"]) if ev.get("venue") else ""}<small>{e(ev.get("title") or "")}'
                    f'{" · £" + format(ev["entry"], "g") if ev.get("entry") else ""}{" · tee off " + e(ev["tee"]) if ev.get("tee") else ""}</small></span>'
                    f'<b class="fd-sp-n">{ev["spare"]} place{"" if ev["spare"] == 1 else "s"}</b>'
                    f'<button type="button" class="soc-btn2 fd-ask" data-e="{e(ev["id"])}" data-day="{nice_day(ev["day"])}">Ask for a place</button></div>' for ev in (x.get("spare") or []))
    lg = x.get("league")
    body = f"""<div class="soc-wrap fd-soc" data-s="{e(x['id'])}" data-name="{e(x['name'])}">
{crumbs_html}
<section class="soc-hero fd-hero">
  <div class="fd-badges">{f'<span class="fd-badge fd-b-found">Founding Society No. {x["founding"]}</span>' if x.get("founding") else ""}<span class="fd-badge fd-b-open">Open to new members</span></div>
  <h1>{e(x['name'])}</h1>
  <p class="fd-where">A golf society in {e(place)} · {x['members']} member{"" if x['members'] == 1 else "s"}</p>
  {f'<p>{e(x["about"])}</p>' if x["about"] else ""}
  <div class="soc-btns"><button type="button" class="soc-btn fd-ask">Ask to join</button></div>
  <p class="fd-status" id="fd-status" hidden></p>
</section>
<section class="soc-card fd-facts">{"".join(f'<div><small>{e(k)}</small><b>{e(v)}</b></div>' for k, v in facts)}</section>
{f'<section class="soc-card fd-spare-box" id="spare"><span class="soc-kick fd-kick-o">Spare places</span>{spare}</section>' if spare else ""}
{f'<section class="soc-card"><h2>The season so far</h2><p class="soc-help">In the National Society League: <a href="/societies/league/?r={e(lg["region"])}&amp;d={lg["division"]}">{e(lg["region"])} Division {lg["division"]}</a>.</p></section>' if lg else ""}
<section class="soc-card fd-private"><b>Nicknames only</b><p class="soc-help">Members aren’t listed here. If you ask to join, the organiser sees your nickname and your note, and says yes or no in Society HQ.</p></section>
{('<section class="soc-card"><h2>More golf societies near ' + e(place) + '</h2><div class="fd-near">' + "".join(f'<a href="{soc_url(y)}"><b>{e(y["name"])}</b><span>{e(y.get("town") or y["area"] or y.get("county") or "")}</span></a>' for y in near) + '</div><a class="soc-link-a" href="/societies/find/">All golf societies &rarr;</a></section>') if near else '<p class="soc-small"><a href="/societies/find/">More golf societies &rarr;</a></p>'}
<section class="soc-card soc-next"><span class="soc-kick">Run a golf society?</span><h2>List yours here, free</h2><p>Society HQ runs fixtures, sign-ups and who’s paid from one WhatsApp link. Tick “Open to new members” and golfers nearby can ask to join.</p><a class="soc-btn" href="/societies/hq/">Start your golf society</a></section>
</div>
<script src="/js/society-find.js?v=20261101" defer></script>"""
    org = {"@context": "https://schema.org", "@type": "SportsOrganization", "name": x["name"], "sport": "Golf", "url": url,
           "description": x["about"] or f"A golf society in {place}, open to new members.",
           "areaServed": x.get("county") or x["area"] or "United Kingdom", "memberOf": {"@type": "Organization", "name": "Society HQ by GolfPrice AI"}}
    if x.get("lat") is not None:
        org["location"] = {"@type": "Place", "name": x.get("course") or place, "geo": {"@type": "GeoCoordinates", "latitude": x["lat"], "longitude": x["lon"]}}
    desc = f"{x['name']}: a golf society in {place}, open to new members. " + (f"Plays {DAYS[x['days']].lower()}. " if x.get("days") in DAYS else "") + "Ask to join free on Find a Society."
    return page_shell(title=f"{x['name']}: golf society in {place} | Find a Society | GolfPrice AI", description=desc[:300],
                      canonical=url, body=body, section="societies", schema=[crumbs_schema, org], noindex=False,
                      og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build_society_pages(root, rows):
    """One page per listed society; pages for societies no longer listed go."""
    import re
    import shutil
    changed, urls = [], []
    keep = set()
    for x in rows:
        slug = soc_slug(x)
        keep.add(slug)
        if _write(root / "societies" / "find" / slug / "index.html", society_page(x, rows)):
            changed.append(f"/societies/find/{slug}/")
        urls.append(f"societies/find/{slug}/")
    for d in (root / "societies" / "find").iterdir():
        # Society pages end in the society's 8-character id (no i, l, o, 0 or 1), which
        # keeps county pages like /west-midlands/ (ending "-midlands") safe.
        if d.is_dir() and re.search(r"-[a-hj-km-np-z2-9]{8}$", d.name) and d.name not in keep and d.name not in COUNTY_SLUGS:
            shutil.rmtree(d)
            changed.append(f"/societies/find/{d.name}/")
    return changed, urls


def county_counts(rows):
    import society_counties as sc
    counts = {}
    for x in rows:
        if sc.known(x.get("county") or ""):
            counts[x["county"]] = counts.get(x["county"], 0) + 1
    return counts


def county_chips(rows, current=None):
    import society_counties as sc
    counts = county_counts(rows)
    if not counts:
        return ""
    from html import escape as e
    chips = []
    for c in sorted(counts):
        label = f"{e(c)} ({counts[c]})"
        if c == current:
            chips.append(f'<span class="fd-chip is-on">{label}</span>')
        elif counts[c] >= sc.MIN_LISTED:
            chips.append(f'<a class="fd-chip" href="/societies/find/{sc.slug(c)}/">{label}</a>')
        else:
            chips.append(f'<span class="fd-chip">{label}</span>')
    return '<nav class="fd-chips" aria-label="Golf societies by county">' + "".join(chips) + "</nav>"


def list_schema(rows, name):
    return {"@context": "https://schema.org", "@type": "ItemList", "name": name, "numberOfItems": len(rows),
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "item": {"@type": "SportsOrganization", "name": x["name"], "sport": "Golf",
                                 "description": x["about"] or f"Golf society in {x['area'] or x.get('county') or 'the UK'}",
                                 "areaServed": x.get("county") or x["area"] or "United Kingdom", "url": SITE + soc_url(x)}} for i, x in enumerate(rows)]}


def find_page(rows=()):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", None)])
    chips = "".join(f'<button type="button" class="fd-f" data-f="{k}" aria-pressed="false">{v}</button>' for k, v in (
        ("wkend", "Weekends"), ("wkday", "Weekdays"), ("beg", "Beginners welcome"), ("nohcp", "No handicap needed"), ("spare", "Spare places")))
    body = f"""<div class="soc-wrap fd-page">
{crumbs_html}
<section class="fd-search">
  <span class="soc-kick fd-kick-l">Find a Society · Free</span>
  <h1>Golf societies near you.</h1>
  <p class="fd-sub">A regular game, a proper trophy and a group chat that never shuts up. Find yours.</p>
  <form class="fd-form" id="fd-form" novalidate>
    <label for="fd-q">Town or postcode</label>
    <div class="fd-row"><input id="fd-q" placeholder="e.g. Leeds, LS17 or Surrey" autocomplete="off" enterkeyhint="search">
      <button type="button" class="fd-loc" id="fd-loc"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>Use my location</button>
      <button type="submit" class="soc-btn fd-go-btn">Find societies</button></div>
  </form>
  <div class="fd-filters"><select id="fd-r" aria-label="Distance"><option value="10">Within 10 miles</option><option value="25" selected>Within 25 miles</option><option value="50">Within 50 miles</option><option value="999">Anywhere</option></select>{chips}</div>
  <p class="fd-msg" id="fd-msg" role="status"></p>
</section>
<div class="fd-grid">
  <div class="fd-main"><h2 class="fd-h" id="fd-h">Golf societies open to new members{(" (" + str(len(rows)) + ")") if rows else ""}</h2>
    <div id="fd" aria-live="polite">{find_cards(rows)}</div></div>
  <aside class="fd-side">{spare_panel(rows)}
    <section class="soc-card fd-start"><span class="soc-kick">Nothing close enough?</span><h2>Start your own</h2><p>Four mates and a WhatsApp group is all it takes. Society HQ runs the rest, free.</p><a class="soc-link-a" href="/societies/guides/how-to-start-a-golf-society/">How to start a golf society &rarr;</a></section>
  </aside>
</div>
<div class="soc-card"><h2>Golf societies by county</h2>{COUNTY_CHIPS[0] if COUNTY_CHIPS else county_chips(rows) or '<p class="soc-help">County pages appear once three societies in a county are listed.</p>'}</div>
<section class="soc-card soc-next"><span class="soc-kick">Run a society?</span><h2>List yours here, free</h2><p>Start your society in Society HQ, pick your home course and tick “Open to new members”. Golfers nearby can ask to join; you say yes or no.</p><a class="soc-btn" href="/societies/hq/">Start your society</a></section>
<p class="soc-small">Distances are from each society’s home course. “Use my location” works it out on your phone and is never sent to us; a town or postcode you type is looked up with postcodes.io.</p>
</div>
<script type="application/json" id="fd-data">{find_data(rows)}</script>
<script src="/js/society-find.js?v=20261101" defer></script>"""
    return page_shell(title="Golf societies near me: find one to join | Find a Society | GolfPrice AI",
                      description="Find a golf society near you: UK golf societies open to new members, with spare places this month. Search by town or postcode. Free to list your society.",
                      canonical=f"{SITE}/societies/find/", body=body, section="societies", schema=[crumbs_schema] + ([list_schema(rows, "UK golf societies open to new members")] if rows else []),
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def county_page(county, rows, all_rows):
    import society_counties as sc
    url = f"{SITE}/societies/find/{sc.slug(county)}/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", "/societies/find/"), (county, None)])
    n = len(rows)
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Find a Society · {county}</span>
  <h1>Golf societies in {county}</h1>
  <p>{n} {county} golf societies open to new members: regular golf without a full club membership, with a new crowd to play with. Updated every 6 hours.</p>
</section>
<div id="fd">{find_cards(rows)}</div>
<div class="soc-card"><h2>Golf societies in other counties</h2>{county_chips(all_rows, current=county)}<a class="soc-link-a" href="/societies/find/">All golf societies &rarr;</a></div>
<section class="soc-card soc-next"><span class="soc-kick">Run a {county} golf society?</span><h2>List it here, free</h2><p>Start it in Society HQ, pick {county} and tick “Open to new members”. Fixtures, sign-ups and who’s paid come free too.</p><a class="soc-btn" href="/societies/hq/">Start your golf society</a></section>
{REAL}
</div>"""
    return page_shell(title=f"Golf societies in {county}: join one near you | GolfPrice AI",
                      description=f"{n} golf societies in {county} open to new members. Regular golf without a full club membership. Free to list your own {county} golf society.",
                      canonical=url, body=body, section="societies", schema=[crumbs_schema, list_schema(rows, f"Golf societies in {county}")],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build_counties(root, rows):
    """County pages for counties with at least MIN_LISTED listed societies;
    pages for counties that drop below that are removed."""
    import shutil
    import society_counties as sc
    counts = county_counts(rows)
    live = {c for c, k in counts.items() if k >= sc.MIN_LISTED}
    changed, urls = [], []
    for c in sorted(live):
        path = root / "societies" / "find" / sc.slug(c) / "index.html"
        if _write(path, county_page(c, [x for x in rows if x.get("county") == c], rows)):
            changed.append(f"/societies/find/{sc.slug(c)}/")
        urls.append(f"societies/find/{sc.slug(c)}/")
    keep = {sc.slug(c) for c in live}
    for d in (root / "societies" / "find").iterdir():
        if d.is_dir() and d.name not in keep and d.name in {sc.slug(c) for c in sc.COUNTIES}:
            shutil.rmtree(d)
            changed.append(f"/societies/find/{d.name}/")
    return changed, urls


COUNTY_URLS = []
COUNTY_SLUGS = set()
COUNTY_CHIPS = []


def clubs_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("For golf clubs", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">For golf clubs · Free</span>
  <h1>Give your golf societies an easier day</h1>
  <p>Societies that organise well book again. Put this free card in your society packs: organisers get sign-ups, a waiting list and accurate final numbers for you, from one link in their WhatsApp group.</p>
</section>
<section class="soc-card cl-card">
  <h2>Your free society card (A6)</h2>
  <div class="cl-g">
    <div class="cl-imgs"><img src="/assets/societies/society-card-front.png" alt="The front of the society card: Run your society day the easy way, with a QR code to Society HQ" width="1240" height="1748" loading="lazy"><canvas id="cl-cv" width="1240" height="1748" role="img" aria-label="The back of the card with your club’s name"></canvas></div>
    <div class="cl-f">
      <label>Your club’s name (printed on the back)<input id="cl-name" maxlength="50" placeholder="e.g. Moortown Golf Club" autocomplete="organization"></label>
      <button type="button" class="soc-btn" id="cl-back">Download the back with your club’s name</button>
      <a class="soc-btn2" href="/assets/societies/society-card-front.png" download>Download the front (PNG)</a>
      <a class="soc-btn2" href="/assets/societies/society-card-a6.pdf" download>Print-ready PDF, blank back (A6)</a>
      <a class="soc-btn2" href="/assets/societies/society-poster-a5.png" download>A5 poster for the noticeboard</a>
      <p class="soc-small">A6 is 105 × 148 mm (postcard size). Print at 100%, double-sided, on card if you have it.</p>
    </div>
  </div>
</section>
<section class="soc-card">
  <h2>A line for your society booking emails</h2>
  <p class="soc-help" id="cl-line">Organising the day? Society HQ is a free tool for sign-ups, a waiting list and who’s paid, from one link in your WhatsApp group: golfpriceai.com/societies</p>
  <button type="button" class="soc-btn2" id="cl-copy" style="align-self:flex-start">Copy the line</button>
</section>
<section class="soc-faq">
  <h2>Questions golf clubs ask</h2>
  <div class="soc-faq-grid">
    <div><h3>What does it cost the club?</h3><p>Nothing. Society HQ is free for clubs and societies. We never take bookings or payments; your society bookings stay exactly as they are.</p></div>
    <div><h3>What’s in it for the club?</h3><p>Accurate final numbers on time, fewer drop-outs (only paid players are confirmed) and organisers who aren’t frazzled on the day.</p></div>
    <div><h3>Who is behind it?</h3><p>GolfPrice AI, an independent UK golf site that tracks golf equipment prices across multiple UK retailers. Society HQ is its free golf society organiser.</p></div>
  </div>
</section>
{REAL}
</div>
<script src="/js/society-clubs.js?v=20261024" defer></script>"""
    return page_shell(title="Free society card for golf clubs | Society HQ | GolfPrice AI",
                      description="A free, print-ready card for golf clubs’ society packs: organisers get sign-ups, a waiting list and accurate final numbers from one WhatsApp link.",
                      canonical=f"{SITE}/societies/clubs/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def hub_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", None)])
    faqs = [
        ("Is Society HQ really free?", "Yes. No sign-up, no fees and no adverts in your way. We earn a small commission if someone buys golf kit through one of our links, at no extra cost to them. That’s it."),
        ("Do members need an account or an app?", "No. You share one link in the WhatsApp group, members tap it and pick a nickname. Their phone remembers them, so they should use their usual phone rather than a private tab."),
        ("How do members pay me?", "Add your own PayPal.me, Monzo.me or Revolut.me link and members get a “Pay the organiser” button with the entry fee filled in. The money goes straight to you. We never take, hold or see it. You tick who’s paid."),
        ("What happens when a day is full?", "Set the number of places and anyone after that goes on the waiting list. If someone drops out, the first person waiting moves up automatically."),
        ("Can people outside the society see us?", "Only members see your fixtures and who’s playing. If you tick “Open to new members”, Find a Society shows your society’s name, area, description and member count, nothing else."),
        ("What is a Founding Society?", "The first 50 golf societies on Society HQ to reach four members get a permanent, numbered Founding Society badge on their page and in Find a Society, and a vote on what we build next."),
        ("What’s new?", "Live scoring: one phone per group enters the scores and the whole society follows a live stableford leaderboard. The Form Guide: every society day gets a preview, then a report with the leaderboard, awards and a season Order of Merit once you enter the scores. And the National Society League: enter your society free and every reported day counts towards your division’s table. Entries open on 1 February for the 2027 season, April to October."),
    ]
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}
    faq_html = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in faqs)
    body = f"""<div class="soc-wrap sh-wrap">
{crumbs_html}
<section class="soc-hero sh-hero">
{PHOTO}
  <span class="soc-kick">Free · for golf societies</span>
  <h1>Society HQ: the free golf society organiser</h1>
  <p>Run your golf society from one link in the WhatsApp group. Fixtures, who’s in, who’s paid, awards night and prizes. No sign-up, no fees.</p>
  <div class="soc-btns"><a class="soc-btn" href="/societies/hq/">Start your society</a><a class="soc-btn2 sh-btn-dark" href="/societies/find/">Find a society</a></div>
</section>
<div class="sh-facts">
  <div><b>One link</b><span>in the group chat</span></div>
  <div><b>No sign-up</b><span>nicknames only</span></div>
  <div><b>No fees</b><span>members pay you direct</span></div>
</div>
<div class="sh-cards">
  <a class="sh-card" href="/societies/hq/">
    <img src="/assets/photos/tools/society-organiser.jpg" alt="" width="720" height="900" loading="lazy">
    <span class="sh-body"><span class="sh-kick">Run your society</span><b>Fixtures, sign-ups and who’s paid</b><span class="sh-line">In, out or maybe in one tap. A waiting list that sorts itself, paid ticks and the final numbers message.</span><span class="sh-cta">Start your society <span aria-hidden="true">&rarr;</span></span></span>
  </a>
  <a class="sh-card" href="/societies/find/">
    <picture><source media="(max-width: 700px)" srcset="/assets/photos/tools/find-a-society-wide.jpg"><img src="/assets/photos/tools/find-a-society-square.jpg" alt="" width="1080" height="1080" loading="lazy"></picture>
    <span class="sh-body"><span class="sh-kick">Find a Society</span><b>Regular golf without a full membership</b><span class="sh-line">UK societies open to new members, by town or county. Run one? List it free.</span><span class="sh-cta">Find a society <span aria-hidden="true">&rarr;</span></span></span>
  </a>
  <a class="sh-card sh-gold" href="/societies/awards/">
    <span class="sh-frame" aria-hidden="true"></span>
    <span class="sh-body"><span class="sh-kick">Awards Night Kit</span><b>End of the season? Do it properly</b><span class="sh-line">Award cards for the group chat, a slideshow for the big night, and prizes your winners pick themselves.</span><span class="sh-cta">Make your awards <span aria-hidden="true">&rarr;</span></span></span>
  </a>
</div>
<section class="soc-card sh-feat">
  <h2>Everything Society HQ does for your golf society</h2>
  <ul>{"".join(f"<li>{f}</li>" for f in APP_FEATURES)}</ul>
  <p class="soc-help">Free for every UK golf society. Members join with a nickname, nobody signs up, and money goes straight from members to the organiser, never through GolfPrice AI.</p>
</section>
<section class="soc-card sh-soon">
  <span class="soc-kick" style="color:var(--gp-green-dark)">New · live scoring</span>
  <h2>Live scoring for your society day</h2>
  <p class="soc-help">One phone per group taps in the scores, stableford points work themselves out, and everyone follows a live leaderboard from one link in the WhatsApp group. Works with no signal, and the match report writes itself at the end.</p>
  <a class="soc-link-a" href="/societies/live-scoring/">See how live scoring works &rarr;</a>
</section>
<section class="soc-card sh-soon">
  <span class="soc-kick" style="color:var(--gp-green-dark)">New · 2027 season</span>
  <h2>The National Society League</h2>
  <p class="soc-help">Your society against every other society in your region, with promotion and relegation. Free to enter, and every society day you report in the Form Guide counts automatically. Entries open 1 February; the season runs April to October.</p>
  <a class="soc-link-a" href="/societies/league/">See the League &rarr;</a>
</section>
<section class="soc-card sh-founding">
  <span class="soc-found sh-found-dark">Founding Society</span>
  <h2>Be one of the first 50 Founding Societies</h2>
  <p class="soc-help">The first 50 golf societies on Society HQ to reach four members keep a numbered, gold Founding Society badge for good, on their society page and in Find a Society, and get a vote on what we build next. No catch and no fees.</p>
</section>
<section class="soc-card sh-guides">
  <h2>Golf society guides and free tools</h2>
  <div class="sh-glinks"><a href="/societies/guides/how-to-start-a-golf-society/"><b>How to start a golf society</b><span>Eight steps from your first four-ball to your first golf day.</span></a><a href="/societies/guides/how-to-run-a-golf-society/"><b>How to run a golf society</b><span>Starting one, booking clubs, money and the season, month by month.</span></a><a href="/societies/guides/golf-society-awards-ideas/"><b>Golf society awards ideas</b><span>40 awards for your end-of-season night, with a free card maker.</span></a><a href="/societies/guides/how-much-to-charge-for-a-golf-society-day/"><b>How much to charge for a golf society day</b><span>2026 prices and a free day cost calculator.</span></a><a href="/societies/prize-fund-calculator/"><b>Golf society prize fund calculator</b><span>How much prize money, and how to split it.</span></a><a href="/societies/guides/golf-society-handicap-systems/"><b>Golf society handicap systems</b><span>Winner cuts, points bands and official handicaps.</span></a><a href="/societies/guides/golf-society-rules-template/"><b>Golf society rules template</b><span>Copy, edit and pin it in your WhatsApp group.</span></a></div>
  <a class="soc-link-a" href="/societies/guides/">All golf society guides &rarr;</a>
  <a class="soc-link-a" href="/societies/clubs/">Run a golf club? Get the free society card for your packs &rarr;</a>
</section>
<section class="soc-card sh-faq">
  <h2>Organisers ask</h2>
  {faq_html}
</section>
{REAL}
</div>"""
    return page_shell(title="Society HQ: free golf society organiser | GolfPrice AI",
                      description="Run your golf society free from one WhatsApp link: fixtures, who’s in, who’s paid, a waiting list, awards night and Find a Society. No sign-up, no fees.",
                      canonical=f"{SITE}/societies/", body=body, section="societies", schema=[crumbs_schema, faq_schema, app_schema(f"{SITE}/societies/")],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


PP_FAQS = [
    ("How does Society v Society work?", "Every golf society on Society HQ has its own Par Price league: members play the free daily golf price game and get a weekly table. Each week, a society’s score is the average of its best four members’ weeks, so big and small societies compete fairly."),
    ("How is a member’s week scored?", "Their best five Par Price rounds from Monday to Sunday count, so missing a day or two doesn’t matter. A round they can no longer play that week counts +10, the worst a round can score, so playing always beats not playing."),
    ("How do we get our society on the table?", "Run your golf society on Society HQ (free, no sign-up). Every member is in automatically, and the society appears once four members have played that week. The organiser can switch it off at any time."),
    ("Is there a prize?", "Bragging rights. The top society each week gets the headline here, and every society gets a weekly picture for the WhatsApp group."),
]


def pp_table_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Society v Society", None)])
    faqs = "".join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in PP_FAQS)
    body = f"""<div class="soc-wrap spp">
{crumbs_html}
<section class="soc-hero spp-hero">
  <span class="soc-kick">Par Price · Society v Society</span>
  <h1>Which golf society knows its prices?</h1>
  <p>Every society on Society HQ plays <a href="/play/par-price/">Par Price</a>, the free daily golf price game. Each week, a society’s score is the average of its best four members. Lowest wins.</p>
</section>
<section class="soc-card" aria-live="polite">
  <h2 id="spp-h">This week</h2>
  <p class="soc-small" id="spp-sub">Loading the table…</p>
  <ol class="spp-table" id="spp-table"></ol>
</section>
<section class="soc-card" id="spp-last-card" hidden>
  <h2>Last week</h2>
  <ol class="spp-table" id="spp-last"></ol>
</section>
<section class="soc-card soc-next"><span class="soc-kick">Run a golf society?</span><h2>Get your society on the table</h2><p>Society HQ is free: fixtures, sign-ups, who’s paid, live scoring and a Par Price league for every member. Four members playing in a week puts you on the table.</p><a class="soc-btn" href="/societies/hq/">Start your society free</a></section>
<section class="soc-faq or-faqs"><h2>Society v Society questions</h2>{faqs}</section>
</div>
<noscript><p>The table needs JavaScript switched on.</p></noscript>
<script src="/js/society-pp-table.js?v=20261106a" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in PP_FAQS]}
    return page_shell(title="Society v Society: the golf society Par Price table | GolfPrice AI",
                      description="UK golf societies go head to head at Par Price, the free daily golf price game. Each society’s best four members count. See this week’s table.",
                      canonical=f"{SITE}/societies/par-price/", body=body, section="societies", schema=[crumbs_schema, faq_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "societies" / "index.html", hub_page()):
        changed.append("/societies/")
    if _write(root / "societies" / "hq" / "index.html", hq_page()):
        changed.append("/societies/hq/")
    rows = listings(root)
    try:
        import county_pages
        c_changed, c_urls, chips_html = county_pages.build(root, rows, find_cards, spare_panel, list_schema)
        changed += c_changed
        COUNTY_URLS[:] = c_urls
        COUNTY_SLUGS.update(u.split('/')[2] for u in c_urls)
        COUNTY_CHIPS[:] = [chips_html]
    except Exception as exc:  # never stop the build
        print(f"County pages skipped: {exc}")
    if _write(root / "societies" / "find" / "index.html", find_page(rows)):
        changed.append("/societies/find/")
    try:
        s_changed, s_urls = build_society_pages(root, rows)
        changed += s_changed
        COUNTY_URLS.extend(s_urls)
    except Exception as exc:  # never stop the build
        print(f"Society pages skipped: {exc}")
    if _write(root / "societies" / "awards" / "index.html", awards_page()):
        changed.append("/societies/awards/")
    if _write(root / "societies" / "clubs" / "index.html", clubs_page()):
        changed.append("/societies/clubs/")
    if _write(root / "societies" / "prize" / "index.html", prize_page()):
        changed.append("/societies/prize/")
    if _write(root / "societies" / "league" / "index.html", league_page()):
        changed.append("/societies/league/")
    if _write(root / "societies" / "par-price" / "index.html", pp_table_page()):
        changed.append("/societies/par-price/")
    if _write(root / "societies" / "form-guide" / "index.html", fg_page()):
        changed.append("/societies/form-guide/")
    try:
        import polls_pages
        changed += polls_pages.build(root)
    except Exception as exc:  # never stop the build
        print(f"Poll pages skipped: {exc}")
    try:
        import live_scoring
        changed += live_scoring.build(root)
    except Exception as exc:  # never stop the build
        print(f"Live scoring pages skipped: {exc}")
    try:
        import society_guides
        changed += society_guides.build(root)
    except Exception as exc:  # never stop the build
        print(f"Society guides skipped: {exc}")
    return changed


if __name__ == "__main__":
    print(build())
