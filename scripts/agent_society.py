"""Society connector: reach golf societies through the clubs they book.

The problem it solves: society organisers are private individuals, so the
site can't cold-email them (UK email rules need their consent), and Society
HQ has grown slowly. But every society books a golf club, and clubs want
society bookings. So the way in is through the clubs.

Monthly (.github/workflows/agent-society.yml), for a rotating batch of the UK
courses that list a website (data/courses/uk.json):
  1. Society Day Finder data: visits the club's own website (politely: it
     respects robots.txt, waits between requests and identifies itself), finds
     its society, golf days or group bookings page, and reads the published
     package: price per person, minimum group size and what's included
     (breakfast, meal, buggies...). Only public business information is kept;
     no personal details. Saved to data/society-days.json.
  2. Pages: "Golf society days" pages, one for the UK and one per county
     with at least three clubs listed (societies/days/), aimed at searches like
     "golf society days near me". Every price links back to the club's own page.
  3. Club partnerships: for clubs with a published package, it checks
     Companies House (free API key: CH_API_KEY) that the club is a company,
     so a business email is allowed (with an opt-out). It then drafts a short
     email to the club's published general address (info@, office@,
     secretary@..., never a named person's address). The offer: a free
     listing, a free "Book a society day" button for their website, and free
     Society HQ for their visiting societies, which arrive organised and paid
     up. Drafts go to the owner privately; nothing is sent automatically.
  4. Data and pages reach the site through the Fix pack, so the owner approves
     them first.

Measured by: clubs listed, booking buttons live, and societies created from
club pages (data/agents/society-report.json).
"""
import json
import os
import re
import sys
import time
import urllib.robotparser
from datetime import date
from html import escape as e, unescape
from urllib.parse import urljoin, urlparse

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, SITE, save_report, http, now, email_owner, pack_note)

COURSES = ROOT / "data" / "courses" / "uk.json"
COUNTIES = ROOT / "data" / "courses" / "counties.json"
DATA = ROOT / "data" / "society-days.json"
PAGES = ROOT / "societies" / "days"
BATCH = int(os.environ.get("SOCIETY_BATCH", "200"))
LINK_WORDS = re.compile(r"societ(y|ies)|golf days?|group (bookings?|golf)|visiting (parties|groups)|corporate (days|golf)", re.I)
PRICE = re.compile(r"£\s?(\d{2,3}(?:\.\d{2})?)\s*(?:pp\b|p\.p\.|per (?:person|head|golfer|player)|/\s?(?:person|head)|each)", re.I)
MINGRP = re.compile(r"(?:minimum|min\.?)\s*(?:of\s*)?(\d{1,2})\s*(?:players|golfers|people|persons|guests)", re.I)
INCLUDES = [("Coffee and bacon roll", r"bacon roll|bacon bap|coffee (?:&|and) (?:a )?(?:bacon|roll|breakfast)"),
            ("Breakfast", r"\bbreakfast\b"), ("Two-course meal", r"\b(2|two)[- ]course"), ("Three-course meal", r"\b(3|three)[- ]course"),
            ("Carvery", r"\bcarvery\b"), ("36 holes", r"\b36 holes\b"), ("Range balls", r"range balls|practice balls"),
            ("Buggies available", r"\bbugg(y|ies)\b"), ("Prizes", r"\bprizes?\b")]
ROLE_EMAIL = re.compile(r"\b((?:info|office|secretary|bookings?|golf|enquiries|reception|admin|manager|proshop|events|societies|society|clubhouse)"
                        r"@[a-z0-9.-]+\.[a-z]{2,})\b", re.I)


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def allowed(url, cache):
    host = urlparse(url).scheme + "://" + urlparse(url).netloc
    if host not in cache:
        rp = urllib.robotparser.RobotFileParser()
        s, _, txt = http(host + "/robots.txt", timeout=15)
        rp.parse(txt.splitlines() if s == 200 else [])
        cache[host] = rp
    return cache[host].can_fetch("GolfPriceAI-agent", url)


def text_of(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S | re.I)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", h)))


def society_page(home_url, robots):
    if not allowed(home_url, robots):
        return None, None
    s, final, h = http(home_url, timeout=20)
    if s != 200:
        return None, None
    links = re.findall(r'<a[^>]+href="([^"#]+)"[^>]*>(.*?)</a>', h, re.S | re.I)
    best = None
    for href, label in links:
        lab = text_of(label)
        if LINK_WORDS.search(lab) or LINK_WORDS.search(href.replace("-", " ")):
            score = 2 if re.search(r"societ", lab + href, re.I) else 1
            if not best or score > best[0]:
                best = (score, urljoin(final, href))
    if not best or urlparse(best[1]).netloc != urlparse(final).netloc or not allowed(best[1], robots):
        return None, text_of(h)
    time.sleep(1.5)
    s, _, h2 = http(best[1], timeout=20)
    return (best[1], text_of(h2)) if s == 200 else (None, text_of(h))


def read_package(t):
    prices = sorted({float(p) for p in PRICE.findall(t) if 15 <= float(p) <= 300})
    if not prices:
        return None
    mg = MINGRP.search(t)
    inc = [name for name, rx in INCLUDES if re.search(rx, t, re.I)]
    return {"from": prices[0], "to": prices[-1] if len(prices) > 1 else None, "minGroup": int(mg.group(1)) if mg else None, "includes": inc}


def companies_house(name):
    key = os.environ.get("CH_API_KEY")
    if not key:
        return None
    import base64
    q = re.sub(r"\b(the|golf|club|course|links|ltd|limited)\b", " ", name, flags=re.I)
    q = re.sub(r"\s+", " ", q).strip()
    auth = base64.b64encode((key + ":").encode()).decode()
    s, _, txt = http(f"https://api.company-information.service.gov.uk/search/companies?q={q.replace(' ', '+')}+golf&items_per_page=10",
                     headers={"Authorization": "Basic " + auth})
    if s != 200:
        return None
    for it in json.loads(txt).get("items", []):
        title = it.get("title", "").lower()
        if all(w.lower() in title for w in q.split()[:2]) and "golf" in title and it.get("company_status") == "active":
            return {"number": it.get("company_number"), "title": it.get("title"), "type": it.get("company_type")}
    return None


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def money(n):
    return f"£{n:,.0f}" if float(n).is_integer() else f"£{n:,.2f}"


def build_pages(rows, today):
    from price_pages import page_shell, breadcrumb
    css = '<link rel="stylesheet" href="/css/society.css?v=20261102b">\n'
    by_county = {}
    for r in rows:
        by_county.setdefault(r.get("county") or "Other", []).append(r)
    files = {}

    def table_html(items):
        cards = "".join(
            f"<div class=\"soc-card\" style=\"margin:10px 0\"><div style=\"display:flex;justify-content:space-between;gap:12px;align-items:baseline\">"
            f"<a href=\"{e(r['source'])}\" rel=\"nofollow noopener\" target=\"_blank\" style=\"font-weight:700\">{e(r['name'])}</a>"
            f"<span style=\"font-weight:800;font-size:1.15em;white-space:nowrap\">{money(r['from'])}{('–' + money(r['to'])) if r.get('to') else ''}"
            f"<small style=\"font-weight:400\"> pp</small></span></div>"
            f"<p class=\"soc-help\" style=\"margin:4px 0 0\">{e(r.get('town') or '')}"
            f"{(' · min ' + str(r['minGroup']) + ' golfers') if r.get('minGroup') else ''}"
            f"{(' · ' + ', '.join(e(x) for x in r.get('includes', []))) if r.get('includes') else ''}</p></div>"
            for r in sorted(items, key=lambda r: r["from"]))
        return cards

    note = ("<p class=\"soc-help\">Prices are as published on each club's own website when we last checked "
            f"({today.strftime('%d %B %Y')}). Always confirm with the club before booking. Organising a society day? "
            "<a href=\"/societies/\">Society HQ</a> handles sign-ups, who's paid and the scores, free.</p>")
    counties = {c: v for c, v in by_county.items() if len(v) >= 3 and c != "Other"}
    links = "".join(f"<a class=\"soc-chip\" href=\"/societies/days/{slug(c)}/\">{e(c)} ({len(v)})</a> " for c, v in sorted(counties.items()))
    crumbs, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society days", None)])
    cheapest = sorted(rows, key=lambda r: r["from"])[:30]
    body = (f"<div class=\"soc-wrap\">{crumbs}<section class=\"soc-hero\"><span class=\"soc-kick\">Society HQ · Updated {today.strftime('%d %B %Y')}</span>"
            f"<h1>Golf society days: packages and prices</h1><p class=\"gd-answer\">Society day packages published by {len(rows)} UK golf clubs, "
            f"from {money(min(r['from'] for r in rows))} per person. Compare what's included and the minimum group size, then book with the club.</p></section>"
            f"<p>{links}</p><h2>Best-value society days</h2>{table_html(cheapest)}{note}</div>")
    files["index.html"] = page_shell(title="Golf society days: packages and prices from UK clubs | GolfPrice AI",
                                     description=f"Compare golf society day packages from {len(rows)} UK golf clubs: price per person, what's included and minimum group size.",
                                     canonical=f"{SITE}/societies/days/", body=body, section="societies", schema=[crumbs_schema],
                                     noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=css)
    for c, items in counties.items():
        crumbs, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society days", "/societies/days/"), (c, None)])
        body = (f"<div class=\"soc-wrap\">{crumbs}<section class=\"soc-hero\"><span class=\"soc-kick\">Society HQ · Updated {today.strftime('%d %B %Y')}</span>"
                f"<h1>Golf society days in {e(c)}</h1><p class=\"gd-answer\">{len(items)} golf clubs in {e(c)} publish society day packages, "
                f"from {money(min(r['from'] for r in items))} per person.</p></section>{table_html(items)}{note}</div>")
        files[f"{slug(c)}/index.html"] = page_shell(title=f"Golf society days in {c}: packages and prices | GolfPrice AI",
                                                    description=f"Compare golf society day packages at {len(items)} clubs in {c}: price per person, what's included and minimum group size.",
                                                    canonical=f"{SITE}/societies/days/{slug(c)}/", body=body, section="societies", schema=[crumbs_schema],
                                                    noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=css)
    for rel, html in files.items():
        p = PAGES / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(html, encoding="utf-8")
    return len(files)


DRAFT = """Subject: Free society day listing for {club}

Hello {club} team,

I run GolfPrice AI (golfpriceai.com), a free UK golf site used by golfers and society organisers. Your society day package ({price} per person) is now listed on our Golf Society Days pages, linking straight to your own page: {page}

Two free things for the club, if useful:
1. A "Book a society day" button for your website that shows your package and sends enquiries straight to you.
2. Free Society HQ for the societies that visit you: sign-ups, who's paid, tee times and live scores. Organisers arrive organised, with the money already collected.

There's no cost and nothing to sign. If you'd rather not be listed, just reply and I'll take it down.

Best wishes,
John Willson
Founder, GolfPrice AI
GolfPriceAI@outlook.com

(You're receiving this because {club} publishes society day packages on its website. Reply "no thanks" and we won't email again.)"""


def main():
    uk = load_json(COURSES, {}).get("courses", [])
    county_of = load_json(COUNTIES, {})
    with_site = [c for c in uk if c.get("w")]
    data = load_json(DATA, {"clubs": {}})
    state = load_json(OUT / "society-state.json", {"offset": 0, "contacted": []})
    offline = os.environ.get("AGENT_OFFLINE") == "1"
    batch = with_site[state["offset"]: state["offset"] + BATCH] or with_site[:BATCH]
    state["offset"] = (state["offset"] + BATCH) % max(1, len(with_site))
    robots, found, checked, drafts = {}, 0, 0, []
    for c in ([] if offline else batch):
        site = c["w"] if c["w"].startswith("http") else "https://" + c["w"]
        checked += 1
        try:
            src, t = society_page(site, robots)
        except Exception as ex:
            print("skip", c["n"], ex)
            continue
        time.sleep(1.5)
        if not t:
            continue
        pkg = read_package(t)
        if not pkg:
            continue
        found += 1
        rec = {"id": c["id"], "name": c["n"], "town": c.get("t"), "county": county_of.get(c["id"]), "country": c.get("c"),
               "source": src or site, "checked": str(now().date()), **pkg}
        emails = sorted({m.lower() for m in ROLE_EMAIL.findall(t)})
        data["clubs"][c["id"]] = rec
        if emails and c["id"] not in state["contacted"] and len(drafts) < 10:
            co = companies_house(c["n"])
            if co:
                page = f"{SITE}/societies/days/{slug(rec['county'])}/" if rec.get("county") else f"{SITE}/societies/days/"
                drafts.append({"to": emails[0], "club": c["n"], "company": co["title"],
                               "text": DRAFT.format(club=c["n"], price=money(pkg["from"]), page=page)})
                state["contacted"].append(c["id"])
    # drop listings not re-confirmed for 6 months: packages and prices change
    cutoff = str(date.fromordinal(now().date().toordinal() - 183))
    data["clubs"] = {k: v for k, v in data["clubs"].items() if v.get("checked", "0") >= cutoff}
    rows = list(data["clubs"].values())
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "society-state.json").write_text(json.dumps(state), encoding="utf-8")
    pages = 0
    if found:
        data["about"] = "Society day packages as published on each club's own website (public business information). Built by the society connector agent."
        data["updated"] = str(now().date())
        DATA.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        if rows:
            pages = build_pages(rows, now().date())
            from agent_common import register_pages
            register_pages(sorted(str(f.parent.relative_to(ROOT)) + "/" for f in PAGES.glob("**/index.html")))
            pack_note("data/society-days.json", f"Society Day Finder: add or refresh **{found} clubs' society day packages** "
                                                f"({len(rows)} clubs listed in all) and rebuild {pages} 'Golf society days' pages.")
            pack_note("societies/days", "The 'Golf society days' pages that go with the data above.")
    if drafts:
        email_owner(f"GolfPrice AI · {len(drafts)} club partnership email drafts",
                    "<p>Each club below publishes society day packages and is a registered company, so a business email is fine "
                    "(each draft includes an opt-out). Send the ones you like from GolfPriceAI@outlook.com.</p>"
                    + "".join(f"<hr><p><b>To:</b> {e(d['to'])} &nbsp; <small>({e(d['company'])})</small></p><pre style='white-space:pre-wrap;font:14px system-ui'>{e(d['text'])}</pre>" for d in drafts))
    rep = save_report("society-report.json", {
        "about": "Society connector: society day packages from UK club websites, the Golf Society Days pages, and club partnership drafts (sent privately).",
        "clubsChecked": checked, "packagesFound": found, "clubsListed": len(rows),
        "countiesWithPages": len({r.get('county') for r in rows if r.get('county')}),
        "draftsSent": len(drafts), "clubsContactedTotal": len(state["contacted"]),
        "nextBatchStartsAt": state["offset"], "coursesWithWebsites": len(with_site),
    })
    print(json.dumps({k: rep[k] for k in ("clubsChecked", "packagesFound", "clubsListed", "draftsSent")}))


if __name__ == "__main__":
    main()
