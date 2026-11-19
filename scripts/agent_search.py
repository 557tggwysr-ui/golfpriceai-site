"""Search-to-page engine: finds what golfers search for, then tells the weekly
build which pages to make or improve.

Runs weekly (.github/workflows/agent-search.yml). Reads the last 28 days of
Google Search Console (needs GSC_SERVICE_ACCOUNT_JSON: a free Google Cloud
service account added as a user on the Search Console property).

Finds three kinds of opportunity:
  * page two: queries where a page sits in positions 8 to 20. A better title,
    a clearer answer and a few internal links can lift it onto page one.
  * missed clicks: page one but few clicks. The title and description need
    to answer the search better.
  * gaps: queries about a specific model, brand or question that land on the
    homepage or a hub, or on nothing specific. A dedicated page wins these.

Competitor watch (no keys needed): reads the public sitemaps of the sites in
COMPETITORS each week, lists the pages they added since last week and flags
the topics we have no page for. data/agents/competitor-watch.json keeps the
list. A monthly rank check of about 30 keywords is done by the scheduled
Claude task (web search), which writes data/agents/competitor-ranks.json.

Technical health (weekly): checks every price page's structured data (the
Product/Offer markup behind Google's price snippets) and duplicate titles
offline; with Search Console access it also reads the sitemap report and
inspects a rotating sample of pages (indexed or not, rich results valid),
and runs Google PageSpeed on key pages for mobile speed. Writes
data/agents/seo-health.json (problems and fixes only, no traffic numbers).

Public output: data/agents/seo-opportunities.json lists the queries, pages and
a rough position only, never clicks or impressions. Full numbers go
privately to the owner by email.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (SITE, models, save_report, email_owner, table, now)

PROPERTY = os.environ.get("GSC_PROPERTY", "sc-domain:golfpriceai.com")
# Sites to watch (public sitemaps only): host -> (name, what they compete with).
# Add more as you find them.
COMPETITOR_SITES = {
    "caddence.golf": ("Caddence", "price comparison"),
    "caddycompare.com": ("CaddyCompare", "price comparison"),
    "golfpricecompare.com": ("Golf Price Compare", "price comparison"),
    "golfpricecompare.co.uk": ("GolfPriceCompare (.co.uk)", "price comparison"),
    "golfclubprice.com": ("ClubCompass", "used club values and price comparison"),
    "riddygolf.com": ("RiddyGolf", "golf society app (vs Society HQ)"),
}
COMPETITORS = [c.strip() for c in os.environ.get("COMPETITORS", ",".join(COMPETITOR_SITES)).split(",") if c.strip()]
WATCH = os.path.join(os.path.dirname(__file__), "..", "data", "agents", "competitor-watch.json")


def sitemap_urls(host, limit=20000):
    """All page URLs in a site's public sitemaps (robots.txt Sitemap: lines first)."""
    import gzip
    from agent_common import http
    seeds = []
    s, _, t = http(f"https://{host}/robots.txt")
    if s == 200:
        seeds = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", t)
    seeds = seeds or [f"https://{host}/sitemap.xml", f"https://{host}/sitemap_index.xml"]
    seen, urls, todo = set(), set(), list(seeds)
    while todo and len(seen) < 60 and len(urls) < limit:
        u = todo.pop(0)
        if u in seen:
            continue
        seen.add(u)
        s, _, t = http(u, timeout=40)
        if s != 200:
            continue
        if u.endswith(".gz"):
            try:
                t = gzip.decompress(t.encode("latin-1")).decode("utf-8", "replace")
            except Exception:
                continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", t)
        if "<sitemapindex" in t:
            todo += [x for x in locs if x not in seen]
        else:
            urls.update(x.replace("&amp;", "&") for x in locs)
    return urls


def competitor_watch():
    try:
        old = json.load(open(WATCH, encoding="utf-8"))
    except Exception:
        old = {}
    ours = {m["slug"] for m in models()}
    our_tokens = [tokens(m["name"]) for m in models()]
    out = {"about": "Competitor watch: new public pages on sites we watch, and topics we have no page for. Public sitemaps only.",
           "sites": {}}
    for host in COMPETITORS:
        prev = old.get("sites", {}).get(host, {})
        urls = sitemap_urls(host)
        if not urls:
            name, kind = COMPETITOR_SITES.get(host, (host, "unknown"))
            out["sites"][host] = {**prev, "name": name, "competesWith": kind, "status": "sitemap not reachable this week"}
            continue
        known = set(prev.get("urls", []))
        new = sorted(urls - known) if known else []
        gone = len(known - urls) if known else 0
        ideas = []
        for u in new[:400]:
            path = re.sub(r"^https?://[^/]+", "", u).strip("/")
            slug = path.rsplit("/", 1)[-1]
            words = tokens(slug.replace("-", " "))
            if len(words) < 2 or slug in ours:
                continue
            if any(len(words & t) >= max(2, len(t) - 1) for t in our_tokens if t):
                continue  # we already have a page for this model
            ideas.append({"page": u, "words": " ".join(sorted(words))})
        sections = defaultdict(int)
        for u in urls:
            seg = re.sub(r"^https?://[^/]+", "", u).strip("/").split("/")[0] or "(home)"
            sections[seg] += 1
        name, kind = COMPETITOR_SITES.get(host, (host, "unknown"))
        out["sites"][host] = {"name": name, "competesWith": kind, "checked": str(now().date()), "pages": len(urls), "newThisWeek": new[:200], "goneThisWeek": gone,
                              "sections": dict(sorted(sections.items(), key=lambda x: -x[1])[:15]),
                              "gaps": ideas[:40], "urls": sorted(urls)}
        print(f"competitor {host}: {len(urls)} pages, {len(new)} new, {len(ideas)} gaps")
    with open(WATCH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    return out


def fetch_rows():
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    if not raw:
        print("(no GSC_SERVICE_ACCOUNT_JSON: nothing to read yet)")
        return None
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    creds = service_account.Credentials.from_service_account_info(
        json.loads(raw), scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    s = AuthorizedSession(creds)
    end = now().date() - timedelta(days=2)  # Search Console lags a couple of days
    start = end - timedelta(days=28)
    url = f"https://searchconsole.googleapis.com/webmasters/v3/sites/{PROPERTY.replace(':', '%3A').replace('/', '%2F')}/searchAnalytics/query"
    rows, start_row = [], 0
    while True:
        r = s.post(url, json={"startDate": str(start), "endDate": str(end), "dimensions": ["query", "page"],
                              "rowLimit": 25000, "startRow": start_row, "dataState": "final"}, timeout=60)
        r.raise_for_status()
        got = r.json().get("rows", [])
        rows += got
        if len(got) < 25000:
            break
        start_row += 25000
    return rows


def tokens(s):
    return set(re.findall(r"[a-z0-9]+", s.lower())) - {"golf", "the", "a", "best", "uk", "for", "price", "prices", "cheap", "cheapest", "buy", "deals", "deal", "sale"}


HEALTH = os.path.join(os.path.dirname(__file__), "..", "data", "agents", "seo-health.json")
KEY_PAGES = ["/", "/prices/", "/shop.html", "/play/", "/prices/black-friday/"]


def schema_problems(root):
    """Offline: Product / AggregateOffer markup on every price page, plus duplicate titles."""
    import glob
    import html as H
    probs, titles = [], defaultdict(list)
    files = sorted(glob.glob(os.path.join(root, "prices", "*", "index.html")))
    for f in files:
        slug = f.split(os.sep)[-2]
        s = open(f, encoding="utf-8", errors="replace").read()
        if re.search(r'name="robots" content="noindex', s):
            continue  # deliberately kept out of Google
        t = re.search(r"(?is)<title>(.*?)</title>", s)
        if t:
            titles[H.unescape(t.group(1).strip())].append(slug)
        blocks = re.findall(r'(?s)<script type="application/ld\+json">(.*?)</script>', s)
        prod = None
        for b in blocks:
            try:
                d = json.loads(b)
            except ValueError:
                probs.append((slug, "structured data that doesn't parse"))
                continue
            if isinstance(d, dict) and d.get("@type") == "Product":
                prod = d
        if prod is None:
            if re.search(r'class="pp-btn"', s):
                probs.append((slug, "no Product markup on a page with prices"))
            continue
        off = prod.get("offers") or {}
        need = [k for k in ("name",) if not prod.get(k)] + [k for k in ("priceCurrency", "lowPrice") if not off.get(k)]
        if need:
            probs.append((slug, "Product markup missing " + ", ".join(need)))
        elif not prod.get("image"):
            probs.append((slug, "no product photo (recommended for Google's product results; usually a feed without an image)"))
        try:
            if float(off.get("lowPrice") or 0) <= 0:
                probs.append((slug, "Product markup price is £0"))
        except (TypeError, ValueError):
            probs.append((slug, "Product markup price isn't a number"))
    dups = {t: v for t, v in titles.items() if len(v) > 1}
    return probs, dups, len(files)


def technical_health():
    root = os.path.join(os.path.dirname(__file__), "..")
    probs, dups, n = schema_problems(root)
    out = {"about": "Technical SEO health: problems and fixes only. Index and speed checks need Search Console access.",
           "pagesChecked": n, "structuredData": [{"page": f"/prices/{a}/", "problem": b} for a, b in probs[:80]],
           "structuredDataProblems": len(probs),
           "duplicateTitles": [{"title": t, "pages": [f"/prices/{x}/" for x in v[:5]]} for t, v in list(dups.items())[:30]],
           "sitemaps": [], "inspected": [], "notIndexed": [], "speed": []}
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            from google.oauth2 import service_account
            from google.auth.transport.requests import AuthorizedSession
            creds = service_account.Credentials.from_service_account_info(
                json.loads(raw), scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
            ses = AuthorizedSession(creds)
            site = PROPERTY.replace(":", "%3A").replace("/", "%2F")
            r = ses.get(f"https://www.googleapis.com/webmasters/v3/sites/{site}/sitemaps", timeout=60)
            for sm in (r.json().get("sitemap", []) if r.ok else []):
                out["sitemaps"].append({"path": sm.get("path"), "lastDownloaded": sm.get("lastDownloaded"),
                                        "errors": int(sm.get("errors") or 0), "warnings": int(sm.get("warnings") or 0)})
            # rotating sample: key pages + 40 price pages, a different slice each week (quota is 2,000 a day)
            slugs = sorted(m["slug"] for m in models())
            wk = int(now().strftime("%U"))
            sample = KEY_PAGES + [f"/prices/{x}/" for x in (slugs[(wk * 40) % max(1, len(slugs)):][:40] if slugs else [])]
            for path in sample:
                rr = ses.post("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
                              json={"inspectionUrl": SITE + path, "siteUrl": PROPERTY}, timeout=60)
                if not rr.ok:
                    continue
                res = rr.json().get("inspectionResult", {})
                idx = res.get("indexStatusResult", {})
                rich = res.get("richResultsResult", {})
                row = {"page": path, "verdict": idx.get("verdict"), "coverage": idx.get("coverageState"),
                       "googleCanonical": idx.get("googleCanonical"), "rich": rich.get("verdict")}
                out["inspected"].append(row)
                if idx.get("verdict") not in (None, "PASS"):
                    fix = "check it isn't a thin or duplicate page; add internal links to it from related pages"
                    if "canonical" in str(idx.get("coverageState", "")).lower():
                        fix = "Google chose a different canonical page: make this page clearly different or point its canonical at the main one"
                    out["notIndexed"].append({"page": path, "why": idx.get("coverageState"), "fix": fix})
                if rich.get("verdict") == "FAIL":
                    out["notIndexed"].append({"page": path, "why": "rich result errors", "fix": "fix the Product markup on this page"})
        except Exception as e:
            out["gscError"] = str(e)[:200]
    # mobile speed: Google PageSpeed Insights (works without a key at low volume; PSI_API_KEY lifts the limit)
    from agent_common import http
    key = os.environ.get("PSI_API_KEY")
    for path in KEY_PAGES[:4] + ["/prices/" + (sorted(m["slug"] for m in models()) or ["x"])[0] + "/"]:
        q = f"https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url={SITE + path}&strategy=mobile&category=performance" + (f"&key={key}" if key else "")
        s_, _, t = http(q, timeout=90)
        if s_ != 200:
            continue
        try:
            d = json.loads(t)
        except ValueError:
            continue
        le = (d.get("loadingExperience") or {}).get("metrics") or {}
        lh = (d.get("lighthouseResult") or {}).get("categories", {}).get("performance", {}).get("score")
        out["speed"].append({"page": path, "score": round((lh or 0) * 100),
                             "LCP": (le.get("LARGEST_CONTENTFUL_PAINT_MS") or {}).get("category"),
                             "INP": (le.get("INTERACTION_TO_NEXT_PAINT") or {}).get("category"),
                             "CLS": (le.get("CUMULATIVE_LAYOUT_SHIFT_SCORE") or {}).get("category")})
    out["needsAttention"] = (len(out["notIndexed"]) + (1 if probs else 0) + (1 if dups else 0)
                             + sum(1 for x in out["speed"] if x["score"] < 50 or "SLOW" in str(x.values()))
                             + sum(1 for x in out["sitemaps"] if x["errors"]))
    from agent_common import save_report
    save_report("seo-health.json", out)
    print(f"seo health: {len(probs)} markup problems, {len(dups)} duplicate titles, {len(out['notIndexed'])} index problems, "
          f"{len(out['speed'])} speed checks")
    return out


def main():
    try:
        technical_health()
    except Exception as e:  # never stop the search report
        print("technical health failed:", e)
    try:
        competitor_watch()
    except Exception as e:  # never stop the search report
        print("competitor watch failed:", e)
    rows = fetch_rows()
    if rows is None:
        save_report("seo-opportunities.json", {"about": "Waiting for Search Console access (see README).", "opportunities": []})
        return
    mods = models()
    slugs = [(m["slug"], tokens(m["name"])) for m in mods]
    by_query = defaultdict(list)
    for r in rows:
        q, page = r["keys"]
        by_query[q].append({"page": page.replace(SITE, "") or "/", "clicks": r["clicks"], "imp": r["impressions"],
                            "ctr": r["ctr"], "pos": r["position"]})
    opps, private = [], []
    for q, pages in by_query.items():
        best = min(pages, key=lambda p: p["pos"])
        imp = sum(p["imp"] for p in pages)
        clicks = sum(p["clicks"] for p in pages)
        if imp < 15:
            continue
        kind = None
        if 8 <= best["pos"] <= 20:
            kind, idea = "page two", f"Lift {best['page']}: answer '{q}' in the title, first paragraph and an H2; add 3 internal links to it."
        elif best["pos"] < 6 and imp >= 60 and best["ctr"] < 0.02:
            kind, idea = "missed clicks", f"Rewrite the title and description of {best['page']} to match '{q}'."
        if best["page"] in ("/", "/shop.html", "/clubs.html", "/prices/") or best["page"].startswith("/?"):
            qt = tokens(q)
            hit = max(slugs, key=lambda s: len(qt & s[1]) / (len(s[1]) or 1)) if qt else None
            if hit and len(qt & hit[1]) >= max(2, len(hit[1]) - 1):
                kind, idea = "gap", f"'{q}' lands on {best['page']}; point it at /prices/{hit[0]}/ (internal links, title wording)."
            elif best["pos"] > 5:
                kind, idea = "gap", f"No page answers '{q}' directly: a new page or guide section could own it."
        if kind:
            score = imp * (1.6 if kind == "gap" else 1.0) * (1.4 if kind == "page two" and best["pos"] < 12 else 1.0)
            opps.append({"type": kind, "query": q, "page": best["page"], "position": round(best["pos"]), "idea": idea, "_s": score})
            private.append((kind, q, best["page"], round(best["pos"], 1), imp, clicks))
    opps.sort(key=lambda o: -o["_s"])
    for o in opps:
        o.pop("_s")
    save_report("seo-opportunities.json", {
        "about": "Search-to-page engine. Queries and pages only, ranked by opportunity. The weekly build works through the top of this list.",
        "window": "last 28 days", "opportunities": opps[:80],
        "counts": {k: sum(1 for o in opps if o["type"] == k) for k in ("page two", "missed clicks", "gap")},
    })
    private.sort(key=lambda r: -r[4])
    totc = sum(r["clicks"] for r in rows); toti = sum(r["impressions"] for r in rows)
    email_owner("GolfPrice AI · search report",
                f"<h2>Search, last 28 days</h2><p>{totc:,} clicks from {toti:,} impressions.</p>"
                "<h3>Biggest opportunities</h3>" + table(private[:30], ["Type", "Query", "Page", "Position", "Impressions", "Clicks"]))
    print(f"{len(opps)} opportunities")


if __name__ == "__main__":
    main()
