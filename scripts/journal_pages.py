"""The Clubhouse Journal: a few data-led articles built only from GolfPrice AI's own price data.

John asked (21 Nov 2026) for blogs that help search and AI-app traffic. Google's guidance is that AI-made
pages without real added value can break its scaled content abuse policy, so the Journal stays small:
one article a fortnight at most, every figure computed here from data/models.json, a method note on each,
and John reviews before it goes live (merging the branch is his sign-off).

    python3 scripts/journal_pages.py        # (re)build /journal/ and every article listed in ARTICLES

The figures are computed once and frozen into data/journal.json the first time an article is built,
so a dated article never quietly changes its numbers later.
"""
import json
import statistics as st
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import price_pages as P  # noqa: E402  (page_shell, breadcrumb, esc, SITE)

SITE = P.SITE
esc = P.esc
AUTHOR = "John Willson"
AUTHOR_ROLE = "Founder, GolfPrice AI"
SHAFT_BRANDS = {"Aldila", "Fujikura", "True Temper", "Project X", "Mitsubishi", "KBS", "Graphite Design", "UST",
                "Nippon", "Accra", "LA Golf", "Oban"}  # shafts sold on their own, not clubs
NAMES = {"driver": "Drivers", "wood": "Fairway woods", "hybrid": "Hybrids", "irons": "Iron sets", "wedge": "Wedges",
         "putter": "Putters", "ball": "Golf balls", "bag": "Golf bags", "electric-trolley": "Electric trolleys",
         "rangefinder": "Rangefinders", "gps-watch": "GPS watches", "launch-monitor": "Launch monitors"}

CSS = """<style>
.jr{max-width:760px;margin:0 auto;padding:8px 18px 40px;font:400 17px/1.65 Inter,system-ui,sans-serif;color:#14251a}
.jr h1{font:800 clamp(28px,6vw,42px)/1.12 Poppins,system-ui,sans-serif;margin:10px 0 12px;color:#103420}
.jr h2{font:800 23px/1.25 Poppins,system-ui,sans-serif;margin:34px 0 10px;color:#103420}
.jr .by{font-size:14px;color:#4b5e52;margin:0 0 18px}
.jr .kick{display:inline-block;background:#103420;color:#ffd600;font:800 12px/1 Poppins,sans-serif;letter-spacing:.08em;padding:7px 10px;border-radius:6px;margin-top:8px}
.jr .answer{background:#fffbe0;border-left:5px solid #ffd600;border-radius:10px;padding:14px 16px;margin:14px 0 22px;font-weight:500}
.jr .bars{display:grid;gap:9px;margin:12px 0 8px}
.jr .bar{display:grid;grid-template-columns:132px 1fr 52px;gap:10px;align-items:center;font-size:15px}
.jr .bar i{display:block;height:16px;border-radius:8px;background:#2f8a1f}
.jr .bar span{text-align:right;font-weight:700}
.jr table{width:100%;border-collapse:collapse;font-size:15px;margin:10px 0}
.jr th,.jr td{text-align:left;padding:9px 8px;border-bottom:1px solid #e2e8e3}
.jr th{font:700 13px Poppins,sans-serif;color:#4b5e52;text-transform:uppercase;letter-spacing:.04em}
.jr td.n{text-align:right;font-variant-numeric:tabular-nums}
.jr .note{font-size:14px;color:#4b5e52;background:#f3f6f3;border-radius:10px;padding:12px 14px;margin-top:26px}
.jr .cta{display:inline-block;background:#2f8a1f;color:#fff;font:700 16px Poppins,sans-serif;padding:13px 18px;border-radius:12px;text-decoration:none;margin:6px 8px 6px 0}
.jr .cards{display:grid;gap:14px;margin-top:16px}
.jr .card{display:block;border:1px solid #e2e8e3;border-radius:14px;padding:16px;text-decoration:none;color:inherit}
.jr .card b{font:800 19px/1.3 Poppins,sans-serif;color:#103420;display:block;margin-bottom:6px}
.jr .sign{margin-top:34px;border-top:3px solid #ffd600;padding-top:22px;text-align:center}
.jr .sign img{width:220px;height:auto;display:block;margin:0 auto 10px}
.jr .sign .tl{font:800 22px/1.2 Poppins,sans-serif;color:#103420;margin:4px 0 8px}
.jr .sign .tl em{font-style:normal;color:#2f8a1f}
.jr .sign p{font-size:15px;color:#4b5e52;margin:6px auto;max-width:520px}
.jr .sign .who{font-size:14px;color:#14251a}
</style>"""


def nice(d):
    from datetime import date as _d
    try:
        x = _d.fromisoformat(d)
        return f"{x.day} {x.strftime('%B %Y')}"
    except Exception:
        return d


def low(name):
    return name if name.startswith("GPS") else name.lower()


def at(hist, day):
    p = None
    for d, v in hist:
        if d <= day:
            p = v
    return p


def models():
    return [m for m in json.loads((ROOT / "data/models.json").read_text())["models"]
            if m.get("gate", {}).get("passes") and m.get("type") in NAMES and m.get("brand") not in SHAFT_BRANDS]


# ---------------------------------------------------------------- the figures

def figures_black_friday(then="2026-10-15", now="2026-11-19"):
    rows = defaultdict(lambda: {"n": 0, "cheaper": 0, "dearer": 0, "drops": []})
    examples = []
    rose_then_fell = 0
    for m in models():
        h = m.get("history") or []
        if not h or h[0][0] > then:
            continue
        o, n = at(h, then), at(h, now)
        if not o or not n:
            continue
        r = rows[m["type"]]
        r["n"] += 1
        ch = (n - o) / o * 100
        if ch < -1:
            r["cheaper"] += 1
            r["drops"].append(-ch)
            examples.append({"name": m["name"], "slug": m["slug"], "type": m["type"], "then": o, "now": n, "pct": round(-ch)})
        elif ch > 1:
            r["dearer"] += 1
        peak = max([v for d, v in h if then < d <= now] or [0])
        if peak > o * 1.02 and n < peak * 0.98:
            rose_then_fell += 1
    cats = sorted(({"type": t, "name": NAMES[t], "n": r["n"], "cheaper": r["cheaper"], "dearer": r["dearer"],
                    "pct": round(r["cheaper"] / r["n"] * 100), "median_drop": round(st.median(r["drops"]), 1) if r["drops"] else None}
                   for t, r in rows.items() if r["n"] >= 20), key=lambda c: -c["pct"])
    tot = {k: sum(c[k] for c in cats) for k in ("n", "cheaper", "dearer")}
    big = [e for e in sorted(examples, key=lambda e: -e["pct"]) if e["type"] in ("driver", "irons", "ball", "rangefinder", "putter", "wood")]
    seen, ex = set(), []
    for e in big:  # one example per category, the biggest genuine drop
        if e["type"] not in seen:
            seen.add(e["type"])
            ex.append(e)
    return {"then": then, "now": now, "total": tot, "pct": round(tot["cheaper"] / tot["n"] * 100), "cats": cats,
            "examples": ex[:5], "rose_then_fell": rose_then_fell}


def figures_spread(min_retailers=3):
    sp = defaultdict(list)
    for m in models():
        R = m.get("retailers") or {}
        if len(R) < min_retailers:
            continue
        mins = sorted(v["min"] for v in R.values() if v.get("min"))
        if len(mins) < min_retailers or mins[0] <= 0:
            continue
        s = (mins[-1] - mins[0]) / mins[0] * 100
        if s > 100:  # more than double usually means a pack-size or edition mismatch: leave it out
            continue
        sp[m["type"]].append({"pct": s, "gbp": mins[-1] - mins[0], "name": m["name"], "slug": m["slug"], "lo": mins[0], "hi": mins[-1], "k": len(mins)})
    allp = [x["pct"] for v in sp.values() for x in v]
    cats = sorted(({"type": t, "name": NAMES[t], "n": len(v), "median_pct": round(st.median([x["pct"] for x in v])),
                    "median_gbp": round(st.median([x["gbp"] for x in v]))} for t, v in sp.items() if len(v) >= 8),
                  key=lambda c: -c["median_gbp"])
    return {"models": len(allp), "median_pct": round(st.median(allp)), "over20": round(sum(1 for x in allp if x > 20) / len(allp) * 100),
            "over10": round(sum(1 for x in allp if x > 10) / len(allp) * 100), "cats": cats, "min_retailers": min_retailers}


# ---------------------------------------------------------------- the articles

def bars(cats, key, label):
    top = max(c[key] for c in cats) or 1
    return '<div class="bars">' + "".join(
        f'<div class="bar"><b>{esc(c["name"])}</b><i style="width:{max(4, round(c[key] / top * 100))}%"></i><span>{label(c)}</span></div>'
        for c in cats) + "</div>"


SIGN_OFF = """<footer class="sign">
<img src="/assets/journal/logo-signoff.png" alt="GolfPrice AI" width="220" height="145" loading="lazy">
<div class="tl">Full Swing. <em>Not full price.</em></div>
<p>GolfPrice AI compares golf prices across multiple UK retailers every six hours, shows you the price history, and tells you plainly when a deal is genuinely good. Free, independent, and never ranked by commission.</p>
<p class="who">Written by <b>John Willson</b>, founder of GolfPrice AI. Every figure comes from our own price data.</p>
<p><a class="cta" href="/">Compare golf prices</a><a class="cta" href="/journal/" style="background:#103420">More from the Journal</a></p>
</footer>"""


def article_black_friday(f):
    t, c = f["total"], f["cats"]
    best = c[0]
    rows = "".join(f'<tr><td>{esc(x["name"])}</td><td class="n">{x["n"]}</td><td class="n">{x["pct"]}%</td>'
                   f'<td class="n">{(str(x["median_drop"]) + "%") if x["median_drop"] else "–"}</td></tr>' for x in c)
    ex = "".join(f'<li><a href="/prices/{esc(e["slug"])}/">{esc(e["name"])}</a>: £{e["then"]:,.2f} in mid-October, £{e["now"]:,.2f} on {nice(f["now"])} ({e["pct"]}% less)</li>' for e in f["examples"])
    body = f"""<article class="jr">
<span class="kick">THE CLUBHOUSE JOURNAL</span>
<h1>Is Black Friday golf genuinely cheaper? What our prices show</h1>
<p class="by">By {AUTHOR}, {AUTHOR_ROLE} · Data to {nice(f["now"])}</p>
<p class="answer">Short answer: some of it. Of {t["n"]:,} golf models we've tracked since mid-October, {t["cheaper"]} ({f["pct"]}%) were genuinely cheaper a week before Black Friday than they were in mid-October, {t["dearer"]} cost more, and the rest hadn't moved. {esc(c[0]["name"])} were the most likely to have dropped ({c[0]["pct"]}%), followed by {esc(low(c[1]["name"]))} and {esc(low(c[2]["name"]))}; {esc(low(c[-2]["name"]))} and {esc(low(c[-1]["name"]))} the least.</p>
<p>Every November the same question comes up in golf group chats: is the Black Friday price a real saving, or the normal price with a red sticker on it? We track the prices of golf kit across multiple UK retailers every six hours, so instead of guessing, we checked. We compared each model's lowest price on {nice(f["then"])} with its lowest price on {nice(f["now"])}, a week before Black Friday.</p>
<h2>Which golf kit is genuinely cheaper?</h2>
<p>The share of models in each category that cost less on {nice(f["now"])} than in mid-October:</p>
{bars(c, "pct", lambda x: f'{x["pct"]}%')}
<table><thead><tr><th>Category</th><th>Models</th><th>Cheaper</th><th>Typical drop</th></tr></thead><tbody>{rows}</tbody></table>
<p>"Typical drop" is the median saving among the models that did get cheaper. {esc(best["name"])} led the way, with {best["pct"]}% of models down on mid-October.</p>
<h2>Some of the biggest genuine drops</h2>
<ul>{ex}</ul>
<p>Each of these is the lowest price we found for that model across the retailers we track, on that date. Prices change all the time, so check the live page before you buy.</p>
<h2>What about prices going up before the sales?</h2>
<p>A common worry is that prices are nudged up in early November so the Black Friday "saving" looks bigger. In our data that was rare: we found {f["rose_then_fell"]} model{"s" if f["rose_then_fell"] != 1 else ""} whose price rose after mid-October and then came back down by {nice(f["now"])}. Most prices either fell or stayed put. That's one reason we compare against a fixed earlier date rather than a "was" price.</p>
<h2>How to check a deal yourself</h2>
<p>Compare against what the same model cost a few weeks ago, not against the price on the sticker. Every price page on GolfPrice AI shows the price history and a plain verdict, and our Black Friday page lists only the models that are genuinely cheaper than in October, updated every six hours.</p>
<p><a class="cta" href="/prices/black-friday/">See what's genuinely cheaper now</a><a class="cta" href="/fourball/" style="background:#103420">Price alerts for your four-ball</a></p>
<p class="note"><b>How we worked this out.</b> {t["n"]:,} golf models with prices tracked since at least {nice(f["then"])} across multiple UK retailers, using the lowest price on each date. Junior sets and shafts sold on their own are left out, and a change of 1% or less counts as no change. Categories with fewer than 20 models are not shown. GolfPrice AI earns a commission from some retailers when you buy through our links; it never changes which price we show or the order we show them in.</p>
{SIGN_OFF}</article>"""
    return {"slug": "is-black-friday-golf-genuinely-cheaper",
            "title": "Is Black Friday Golf Genuinely Cheaper? Our Price Data",
            "description": f"We tracked {t['n']:,} golf models since mid-October: {f['pct']}% were genuinely cheaper a week before Black Friday. See which kit dropped most.",
            "h1": "Is Black Friday golf genuinely cheaper? What our prices show", "date": f["now"], "body": body,
            "faq": [("Is Black Friday golf genuinely cheaper?", f"Some of it. Of {t['n']:,} golf models tracked since mid-October, {t['cheaper']} ({f['pct']}%) were cheaper a week before Black Friday than in mid-October; most others hadn't moved.")]}


def article_spread(f):
    c = f["cats"]
    rows = "".join(f'<tr><td>{esc(x["name"])}</td><td class="n">{x["n"]}</td><td class="n">{x["median_pct"]}%</td><td class="n">£{x["median_gbp"]}</td></tr>' for x in c)
    body = f"""<article class="jr">
<span class="kick">THE CLUBHOUSE JOURNAL</span>
<h1>Same golf kit, different price: how much UK retailers differ</h1>
<p class="by">By {AUTHOR}, {AUTHOR_ROLE} · Data to {nice(DATE)}</p>
<p class="answer">Short answer: more than most golfers expect. Across {f["models"]} golf models sold by {f["min_retailers"]} or more UK retailers, the gap between the cheapest and the dearest retailer was typically {f["median_pct"]}%, and for {f["over20"]}% of models it was more than a fifth of the price.</p>
<p>Golfers shop around for a new driver, but rarely for a box of balls or a bag. We wanted to know how much it actually matters, so we looked at every model in our data that's sold by at least {f["min_retailers"]} UK retailers, and compared the lowest price with the highest for exactly the same model.</p>
<h2>How big is the gap?</h2>
<p>The typical difference between the cheapest and the dearest retailer for the same model, in pounds:</p>
{bars(c, "median_gbp", lambda x: f'£{x["median_gbp"]}')}
<table><thead><tr><th>Category</th><th>Models</th><th>Typical gap</th><th>In pounds</th></tr></thead><tbody>{rows}</tbody></table>
<p>"Typical" is the median, so half of the models in each category have a bigger gap and half a smaller one. Big-ticket kit has the biggest gaps in pounds; balls and wedges have smaller gaps that add up over a season.</p>
<h2>Why the same kit costs different amounts</h2>
<p>Retailers set their own prices, run their own offers at different times, and clear stock on their own schedules. A model can be on offer at one shop and full price at another on the same day. None of that is a trick: it's just how the market works, and it's why comparing before you buy pays.</p>
<h2>What this means when you're buying</h2>
<p>For anything over about £100, checking a few retailers is worth the minute it takes. For balls, a few pounds a dozen soon adds up over a season. Every price page on GolfPrice AI lists the retailers we track for that model, cheapest first, with the price history and a plain verdict.</p>
<p><a class="cta" href="/price-check.html">Is this a good price? Check it</a><a class="cta" href="/fourball/" style="background:#103420">Price alerts for your four-ball</a></p>
<p class="note"><b>How we worked this out.</b> {f["models"]} golf models sold by {f["min_retailers"]} or more UK retailers in our data on {nice(DATE)}, comparing each retailer's lowest price for the same model. Junior sets and shafts sold on their own are left out, and so are the few models where one price was more than double another (usually a different pack size or edition, not a real gap). Categories with fewer than 8 models are not shown. We never name or rank retailers in our reports. GolfPrice AI earns a commission from some retailers when you buy through our links; it never changes which price we show or the order we show them in.</p>
{SIGN_OFF}</article>"""
    return {"slug": "same-golf-kit-different-price",
            "title": "Same Golf Kit, Different Price: UK Retailer Gaps",
            "description": f"Across {f['models']} golf models sold by {f['min_retailers']}+ UK retailers, the cheapest-to-dearest gap was typically {f['median_pct']}%. Our data, by category.",
            "h1": "Same golf kit, different price: how much UK retailers differ", "date": DATE, "body": body,
            "faq": [("How much do golf prices vary between UK retailers?", f"Typically {f['median_pct']}% between the cheapest and dearest retailer for the same model, and over 20% for {f['over20']}% of models, across {f['models']} models sold by {f['min_retailers']} or more UK retailers.")]}


DATE = json.loads((ROOT / "data/models.json").read_text()).get("lastUpdated", "")[:10]
ARTICLES = [("is-black-friday-golf-genuinely-cheaper", figures_black_friday, article_black_friday),
            ("same-golf-kit-different-price", figures_spread, article_spread)]


def page(a):
    url = f"{SITE}/journal/{a['slug']}/"
    schema = [{"@context": "https://schema.org", "@type": "Article", "headline": a["h1"], "datePublished": a["date"], "dateModified": a["date"],
               "author": {"@type": "Person", "name": AUTHOR, "jobTitle": AUTHOR_ROLE}, "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "mainEntityOfPage": url},
              {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": ans}} for q, ans in a["faq"]]}]
    crumbs, bc = P.breadcrumb([("Home", "/"), ("The Clubhouse Journal", "/journal/"), (a["h1"], None)])
    schema.append(bc)
    return P.page_shell(title=a["title"], description=a["description"], canonical=url, body=CSS + '<div class="jr" style="padding-bottom:0">' + crumbs + '</div>' + a["body"],
                        section="prices", schema=schema, noindex=False)


def index_page(arts):
    cards = "".join(f'<a class="card" href="/journal/{esc(a["slug"])}/"><b>{esc(a["h1"])}</b>{esc(a["description"])}</a>' for a in arts)
    body = CSS + f"""<div class="jr"><span class="kick">THE CLUBHOUSE JOURNAL</span><h1>The Clubhouse Journal</h1>
<p>Short, honest articles built from our own golf price data: what's genuinely cheaper, when, and by how much. No hype, no "was" prices, and a note on how we worked out every figure.</p>
<div class="cards">{cards}</div></div>"""
    return P.page_shell(title="The Clubhouse Journal: Golf Prices, Explained With Data", description="Data-led articles on UK golf prices from GolfPrice AI: what's genuinely cheaper, when to buy and how much retailers differ.",
                        canonical=f"{SITE}/journal/", body=body, section="prices", schema=[], noindex=False)


def build():
    store_p = ROOT / "data/journal.json"
    store = json.loads(store_p.read_text()) if store_p.exists() else {"about": "Frozen figures for each Clubhouse Journal article (computed once, from data/models.json).", "articles": {}}
    arts = []
    for slug, fig, write in ARTICLES:
        f = store["articles"].get(slug) or fig()
        store["articles"][slug] = f
        a = write(f)
        out = ROOT / "journal" / slug / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page(a), encoding="utf-8")
        arts.append(a)
    (ROOT / "journal" / "index.html").write_text(index_page(arts), encoding="utf-8")
    store_p.write_text(json.dumps(store, indent=2, ensure_ascii=False), encoding="utf-8")
    try:  # into the sitemap with the other agent pages
        from agent_common import register_pages
        register_pages(["journal/"] + [f"journal/{a['slug']}/" for a in arts])
    except Exception as e:
        print("sitemap note skipped:", e)
    print("journal:", len(arts), "articles")


if __name__ == "__main__":
    build()
