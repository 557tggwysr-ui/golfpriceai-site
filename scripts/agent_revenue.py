"""Revenue guardian: makes sure every buy click can earn.

Runs daily (.github/workflows/agent-revenue.yml).

1. Link shape, every listing: each buy link must be an Awin tracking link
   carrying our publisher id and a merchant id. A link that isn't tracked
   earns nothing, silently.
2. Live landing check, a sample of the links shoppers click most (home deals,
   biggest drops, Start Golf) plus a random spread: follow the link and check
   it lands on the retailer's site (not an error, not their homepage, not a
   "no longer available" page).
3. Awin, private (needs AWIN_API_TOKEN): new UK golf programmes to apply to,
   pending or rejected applications, and advertisers getting clicks but no
   sales in 28 days (a sign tracking has broken). Emailed to the owner only.

Public output: data/agents/revenue-report.json (link health only, no money).
"""
import json
import os
import random
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import timedelta
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (load, products, save_report, http, email_owner, table, now)

PUB = os.environ.get("AWIN_PUBLISHER_ID", "2990893")
SAMPLE_TOP = 25
SAMPLE_RANDOM = 25
GONE = re.compile(r"(no longer available|product (is )?unavailable|page (was )?not found|404 error|"
                  r"discontinued|this product is not available|sorry, we couldn)", re.I)


def root(host):
    host = (host or "").lower().split(":")[0]
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] in ("co", "org", "ac") and parts[-1] == "uk":
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


def link_problem(url):
    try:
        u = urlparse(url)
    except Exception:
        return "unreadable link"
    if "awin1.com" not in u.netloc:
        return "not an Awin tracking link"
    q = parse_qs(u.query)
    if (q.get("a") or q.get("awinaffid") or [""])[0] != PUB:
        return "wrong or missing publisher id"
    if not (q.get("m") or q.get("awinmid")):
        return "missing merchant id"
    if not (q.get("p") or q.get("ued")):
        return "no product destination"
    return None


def expected_hosts(items):
    """Each feed's retailer domain, learnt from where its images live."""
    seen = defaultdict(Counter)
    for p in items:
        img = p.get("image") or ""
        h = urlparse(img).netloc
        if h and "shopify" not in h and "cloudinary" not in h and "awin" not in h:
            seen[p["source"]][root(h)] += 1
    return {s: c.most_common(1)[0][0] for s, c in seen.items() if c}


def pick_sample(items):
    """The links shoppers click most: home deals, the week's biggest drops and
    Start Golf (each model's cheapest listing), plus a random spread."""
    by_id = {p["id"]: p for p in items}
    by_name = {p.get("name"): p for p in items}
    mods = {m["slug"]: m for m in (load("models.json") or {}).get("models", [])}

    def cheapest(slug):
        m = mods.get(slug)
        if not m:
            return None
        ls = [by_id[i] for i in m.get("listingIds", []) if i in by_id and by_id[i].get("inStock")]
        return min(ls, key=lambda p: p.get("salePrice") or 1e9) if ls else None

    slugs = [d.get("slug") for d in (load("home-deals.json") or {}).get("deals", [])]
    slugs += [c.get("slug") for c in ((load("biggest-drop.json") or {}).get("cats") or {}).values() if isinstance(c, dict)]
    wanted = [x for x in (cheapest(s) for s in slugs if s) if x]
    sg = load("start-golf.json") or {}
    for tier in ("easy", "hooked"):
        for it in (sg.get(tier) or {}).get("items", []):
            slug = (it.get("url") or "").rstrip("/").split("/prices/")[-1] if "/prices/" in (it.get("url") or "") else None
            hit = cheapest(slug) if slug else by_name.get(it.get("name"))
            if hit:
                wanted.append(hit)
    live = [p for p in items if p.get("inStock") and not p.get("condition")]
    random.seed(now().strftime("%Y-%m-%d"))
    wanted = wanted[:SAMPLE_TOP] + random.sample(live, min(SAMPLE_RANDOM, len(live)))
    out, ids = [], set()
    for p in wanted:
        if p["id"] not in ids:
            ids.add(p["id"]); out.append(p)
    return out


def check_landing(p, hosts):
    status, final, text = http(p["affiliateUrl"], timeout=30)
    host = root(urlparse(final).netloc)
    want = hosts.get(p["source"])
    path = urlparse(final).path.strip("/")
    if status == 0:
        return "could not connect"
    if status >= 400:
        return f"error {status}"
    if host in ("awin1.com", "awin.com"):
        return "stuck on the tracking link"
    if want and host != want:
        return f"landed on {host}"
    if not path:
        return "landed on the retailer homepage"
    if GONE.search(text[:200_000]):
        return "product page says unavailable"
    return None


def awin_private():
    tok = os.environ.get("AWIN_API_TOKEN")
    if not tok:
        print("(no AWIN_API_TOKEN: Awin checks skipped)")
        return None
    h = {"Authorization": "Bearer " + tok}
    base = f"https://api.awin.com/publishers/{PUB}"
    out = {}
    s, _, t = http(f"{base}/programmes?relationship=notjoined&countryCode=GB", headers=h)
    try:
        progs = json.loads(t) if s == 200 else []
    except ValueError:
        progs = []
    golf = [p for p in progs if re.search(r"\bgolf", json.dumps(p), re.I)]
    out["new_golf"] = [(p.get("name"), p.get("id"), (p.get("primarySector") or "")) for p in golf][:40]
    for rel in ("pending", "rejected", "suspended"):
        s, _, t = http(f"{base}/programmes?relationship={rel}", headers=h)
        try:
            out[rel] = [p.get("name") for p in (json.loads(t) if s == 200 else [])]
        except ValueError:
            out[rel] = []
    end = now().date()
    start = end - timedelta(days=28)
    s, _, t = http(f"{base}/reports/advertiser?startDate={start}&endDate={end}&region=GB&timezone=Europe/London", headers=h)
    try:
        rep = json.loads(t) if s == 200 else []
    except ValueError:
        rep = []
    rows = []
    for r in rep:
        clicks = r.get("clicks") or 0
        sales = (r.get("totalNo") or 0)
        comm = r.get("totalComm") or 0
        rows.append((r.get("advertiserName"), clicks, sales, round(comm, 2)))
    rows.sort(key=lambda r: -r[1])
    out["advertisers"] = rows
    out["no_sales"] = [r for r in rows if r[1] >= 40 and r[2] == 0]
    out["api_status"] = s
    return out


def main():
    items = products()
    if not items:
        print("no products.json; nothing to check"); return
    bad = Counter(); examples = defaultdict(list)
    for p in items:
        why = link_problem(p.get("affiliateUrl") or "")
        if why:
            bad[(p["source"], why)] += 1
            if len(examples[(p["source"], why)]) < 3:
                examples[(p["source"], why)].append(p["name"])
    hosts = expected_hosts(items)
    sample = pick_sample(items)
    fails = []
    offline = os.environ.get("AGENT_OFFLINE") == "1"  # local dry run: skip live requests
    for p in ([] if offline else sample):
        why = check_landing(p, hosts)
        if why:
            fails.append({"name": p["name"], "id": p["id"], "feed": p["source"], "problem": why})
        time.sleep(1.2)
    rate = round(100 * (1 - len(fails) / max(1, len(sample))))
    report = save_report("revenue-report.json", {
        "about": "Revenue guardian: are buy links tracked and landing on the right page? No money figures here (those go privately to the owner).",
        "listings": len(items),
        "untracked": [{"feed": s, "problem": w, "count": n, "examples": examples[(s, w)]} for (s, w), n in bad.most_common()],
        "untrackedTotal": sum(bad.values()),
        "sampleChecked": len(sample),
        "landingOkPct": rate,
        "landingProblems": fails,
        "status": "ok" if not bad and rate >= 90 else "attention",
    })
    print(json.dumps({k: report[k] for k in ("untrackedTotal", "sampleChecked", "landingOkPct", "status")}))

    aw = awin_private()
    weekly = now().weekday() == 0  # full private email on Mondays, or whenever something needs action
    urgent = report["status"] != "ok" or (aw and aw.get("no_sales"))
    if weekly or urgent:
        parts = [f"<h2>Revenue guardian</h2><p>{report['untrackedTotal']} listings with untracked links. "
                 f"{report['landingOkPct']}% of {report['sampleChecked']} sampled buy links landed correctly.</p>"]
        if fails:
            parts.append("<h3>Links that didn't land right</h3>" + table([(f["name"], f["problem"]) for f in fails], ["Product", "Problem"]))
        if aw:
            if aw.get("no_sales"):
                parts.append("<h3>Clicks but no sales in 28 days (check tracking)</h3>" + table(aw["no_sales"], ["Advertiser", "Clicks", "Sales", "Commission £"]))
            if aw.get("advertisers"):
                parts.append("<h3>Last 28 days by retailer</h3>" + table(aw["advertisers"][:15], ["Advertiser", "Clicks", "Sales", "Commission £"]))
            if aw.get("new_golf"):
                parts.append("<h3>UK golf programmes you haven't joined</h3>" + table(aw["new_golf"], ["Programme", "Id", "Sector"]))
            if aw.get("pending"):
                parts.append("<p><b>Still pending:</b> " + ", ".join(aw["pending"]) + "</p>")
        email_owner("GolfPrice AI · revenue guardian" + (" · needs a look" if urgent else ""), "".join(parts))


if __name__ == "__main__":
    main()
