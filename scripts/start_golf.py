"""Start golf for £X (/prices/start-golf/): the beginner's kit, priced live.

Every run picks a first-round kit at today's lowest UK prices, from what we
track, and adds it up: a package set, golf shoes, a dozen balls, a glove and
tees. Two tiers: "Just trying it" (the cheapest sensible kit) and "I'm
hooked" (a full 13/14-piece set and better balls). Men's first, never junior
sets, new stock only.

Shoes are priced honestly: the cheapest men's style that's in stock in most
common sizes (8 to 10), not one odd size that happens to be cheap.
"""
import json
import math
import re
from datetime import datetime, timezone

from price_pages import PRICES_DIR, SITE, _write, esc, page_shell

V = "20261031"
NOT_MENS = re.compile(r"\b(ladies|lady|women'?s?|womens|female|junior|kids?|youth|girls?|boys?|ages?\s*\d)\b", re.I)
SIZES = ("8", "8.5", "9", "9.5", "10")
SIZE_RX = re.compile(r"(?:(?<=[\s/-])|^)(?:UK\s?)?(\d{1,2}(?:\.5)?)(?=\s|/|$)")
BALL_SKIP = re.compile(r"practice|foam|lake|refurb|recycled|used|pearl|grade|mint|\baaa\b|personalised|yellow|pink|orange", re.I)
BALL_BRANDS = re.compile(r"^(wilson|srixon|callaway|titleist|taylormade|bridgestone|masters|longridge|pinnacle|top flite|volvik|vice|cobra|mizuno|ping|honma)\b", re.I)
BIG_BRANDS = re.compile(r"\b(titleist|callaway|srixon|taylormade|bridgestone|wilson)\b", re.I)


def _set(passing, built, full):
    rows = [m for m in passing if m["type"] == "set" and m["slug"] in built and not NOT_MENS.search(m["name"])]
    if full:
        rows = [m for m in rows if re.search(r"\b1[34]-?\s?piece\b|\b1[34]pc\b", m["name"], re.I)]
    return min(rows, key=lambda m: m["minPrice"], default=None)


def _balls(passing, built, better):
    rows = [m for m in passing if m["type"] == "ball" and m["slug"] in built and "dozen" in (m.get("unit") or "")
            and m["minPrice"] >= 8 and not BALL_SKIP.search(m["name"]) and BALL_BRANDS.search(m["name"])
            and re.search(r"golf balls?$", m["name"], re.I)]
    if better:
        rows = [m for m in rows if 18 <= m["minPrice"] <= 32 and BIG_BRANDS.search(m["name"])]
    return min(rows, key=lambda m: m["minPrice"], default=None)


def _clean(p):
    return p.get("inStock") and not p.get("condition") and not NOT_MENS.search(p.get("name", "")) and p.get("audience") != "Female"


def _shoes(products):
    styles = {}
    for p in products:
        if p.get("category") != "shoes" or not _clean(p) or not re.search(r"\bshoes?\b", p["name"], re.I) \
                or re.search(r"spike|wrench|cleat|polo|shirt|bag|sock", p["name"], re.I):
            continue
        sizes = set(SIZE_RX.findall(p["name"]))
        size = next((s for s in SIZES if s in sizes), None)
        if not size:
            continue
        style = SIZE_RX.sub("", p["name"]).replace(" / ", " ").strip(" -/")
        style = re.sub(r"\s{2,}", " ", style)
        s = styles.setdefault((p.get("source"), style), {"sizes": set(), "best": None})
        s["sizes"].add(size)
        if not s["best"] or p["salePrice"] < s["best"]["salePrice"]:
            s["best"] = p
    ok = [(v["best"], k[1]) for k, v in styles.items() if len(v["sizes"]) >= 3 and v["best"]["salePrice"] >= 25]
    return min(ok, key=lambda x: x[0]["salePrice"], default=(None, None))


def _cheapest(products, icon, min_price, rx=None):
    rows = [p for p in products if p.get("icon") == icon and _clean(p) and p["salePrice"] >= min_price
            and (not rx or re.search(rx, p["name"], re.I))]
    return min(rows, key=lambda p: p["salePrice"], default=None)


def _short(name):
    """'Ben Sayers All Weather Glove - White/Black / Right Handed Golfer / L' -> 'Ben Sayers All Weather Glove'"""
    return re.split(r"\s+-\s+|\s+/\s+", name)[0].strip()


def kit(passing, built, products, hooked=False):
    items = []
    s = _set(passing, built, full=hooked)
    if s:
        items.append({"what": "Package set with bag", "name": s["name"], "price": s["minPrice"], "url": f"/prices/{s['slug']}/",
                      "note": "a good price right now" if (s.get("verdict") or {}).get("label") == "good" else
                      ("everything a beginner needs" if not hooked else "a full set, driver to putter")})
    sh, style = _shoes(products)
    if sh:
        items.append({"what": "Golf shoes", "name": _short(style), "price": sh["salePrice"], "url": sh.get("affiliateUrl"),
                      "note": "in stock in sizes 8 to 10", "out": True})
    b = _balls(passing, built, better=hooked)
    if b:
        items.append({"what": "A dozen balls", "name": b["name"], "price": b["minPrice"], "url": f"/prices/{b['slug']}/",
                      "note": "you will lose some" if not hooked else "softer feel, still sensible money"})
    g = _cheapest(products, "glove", 3, r"glove")
    if g:
        items.append({"what": "A glove", "name": _short(g["name"]), "price": g["salePrice"], "url": g.get("affiliateUrl"),
                      "note": "for your top hand", "out": True})
    t = _cheapest(products, "tee", 0.5, r"\btees?\b")
    if t:
        items.append({"what": "Tees", "name": _short(t["name"]), "price": t["salePrice"], "url": t.get("affiliateUrl"),
                      "note": "a bag of them", "out": True})
    return items


def money(x):
    return f"£{x:,.2f}"


def rows_html(items):
    out = []
    for it in items:
        attrs = ' rel="sponsored nofollow noopener" target="_blank"' if it.get("out") else ""
        name = f'<a href="{esc(it["url"])}"{attrs}>{esc(it["name"])}</a>' if it.get("url") else esc(it["name"])
        out.append(f'<li><span><b>{esc(it["what"])}</b><small>{name} · {esc(it["note"])}</small></span><b class="sg-price">{money(it["price"])}</b></li>')
    return "".join(out)


FAQS = [
    ("How much does it cost to start golf in the UK?",
     "The kit for your first round costs around {total} at today's lowest UK prices: a package set with a bag, golf shoes, a dozen balls, a glove and tees. On top of that, a bucket of balls at a driving range and a few lessons with a PGA professional are the best money a beginner spends."),
    ("Do I need a full set of clubs?",
     "No. A 7-piece package set covers everything a beginner needs: a driver, a wood or hybrid, a few irons, a wedge and a putter. Fewer clubs means fewer decisions on the course. Move up to a full set once you're playing regularly."),
    ("Can I play golf without joining a golf club?",
     "Yes. Driving ranges, par 3 courses and pay-and-play courses welcome beginners, and many golf societies play regularly without anyone being a club member. A society is also the easiest way to make golfing friends."),
    ("What should a beginner look for in golf balls?",
     "Cheap, durable balls in quantity. Expensive tour balls won't help while you're learning, and you'll lose a few. Save the premium balls for when you're keeping them on the fairway."),
]


def page(easy, hooked, today):
    t1 = sum(i["price"] for i in easy)
    ago = month_ago(history(), today)
    trend = ""
    if ago:
        diff = t1 - ago
        trend = (f'<p class="sg-trend">A month ago the same kind of kit cost <b>{money(ago)}</b>: '
                 + (f'that\u2019s <b>{money(-diff)} cheaper</b> today.' if diff < -0.5 else
                    f'that\u2019s {money(diff)} more today.' if diff > 0.5 else 'about the same as today.') + '</p>')
    t2 = sum(i["price"] for i in hooked)
    head = math.ceil(t1)
    faqs = [(q, a.replace("{total}", f"£{head}")) for q, a in FAQS]
    faq_html = "".join(f'<details class="sg-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faqs)
    checked = datetime.now(timezone.utc).strftime("%-d %B %Y")
    body = f"""<div class="sg">
<section class="sg-hero">
  <div class="sg-copy">
    <span class="sg-kick">NEW TO GOLF</span>
    <h1>Start golf<br>for <span>£{head}.</span></h1>
    <p class="sg-lede">Everything you need for your first round, at today’s lowest UK prices. Plus the five steps from the driving range to a proper round with your mates. No jargon, no £1,000 driver.</p>
    {trend}
    <div class="sg-ctas"><a class="sg-btn" href="#kit">See the kit</a><a class="sg-btn sg-ghost" href="#steps">The five steps</a></div>
    <p class="sg-small">Prices checked every 6 hours across multiple UK retailers. Last updated {checked}. Prices can change on the retailer’s site.</p>
  </div>
  <div class="sg-kit" id="kit">
    <div class="sg-kit-top"><b>Your first-round kit</b>
      <div class="sg-toggle" role="tablist" aria-label="Kit level">
        <button type="button" role="tab" aria-selected="true" data-tier="easy">Just trying it</button>
        <button type="button" role="tab" aria-selected="false" data-tier="hooked">I’m hooked</button>
      </div></div>
    <div data-panel="easy"><ul class="sg-list">{rows_html(easy)}</ul>
      <div class="sg-total"><b>Total</b><b class="sg-sum">{money(t1)}</b></div></div>
    <div data-panel="hooked" hidden><ul class="sg-list">{rows_html(hooked)}</ul>
      <div class="sg-total"><b>Total</b><b class="sg-sum">{money(t2)}</b></div></div>
    <button type="button" class="sg-btn sg-dark" id="sg-list-btn">Get the shopping list</button>
    <p class="sg-small sg-msg" id="sg-msg" role="status"></p>
  </div>
</section>

<section class="sg-steps" id="steps">
  <div class="sg-head"><h2>From the range to your first round: five steps</h2><span>Most beginners get there in a couple of months</span></div>
  <ol class="sg-five">
    <li><b>1</b><h3>Hit the range</h3><p>A bucket of balls at a driving range. Borrow a club or two first: no kit needed yet.</p></li>
    <li><b>2</b><h3>Book a few lessons</h3><p>A handful of lessons with a PGA professional saves years of bad habits. Ask about beginner groups.</p></li>
    <li><b>3</b><h3>Get your kit</h3><p>The list above. A package set does everything a beginner needs. Upgrade once you’re hooked.</p></li>
    <li><b>4</b><h3>Play a par 3 or nine holes</h3><p>Shorter courses are cheaper, quicker and kinder. <a href="/courses/#near">Find courses near you &rarr;</a></p></li>
    <li class="sg-dark-step"><b>5</b><h3>Get a handicap, join a society</h3><p>Regular golf with a friendly crowd, no club membership needed. <a href="/societies/find/">Find a Society &rarr;</a></p></li>
  </ol>
</section>

<section class="sg-three">
  <div class="sg-card"><span class="sg-kick">WORTH KNOWING</span><b>You don’t need 14 clubs</b><p>A 7-piece set covers everything. Fewer clubs means fewer decisions, and that’s half the battle.</p></div>
  <div class="sg-card"><span class="sg-kick">WORTH KNOWING</span><b>Buy cheap balls, lots of them</b><p>Tour balls won’t help yet, and you’ll lose a few. Save the premium ones for when they stay on the fairway.</p></div>
  <div class="sg-card sg-dark-card"><span class="sg-kick sg-kick-light">NOT SURE WHAT FITS?</span><b>Find Your Fit</b><p>Eight quick taps to the flex and clubs that suit you. Free.</p><a href="/find-your-fit.html">Find my fit &rarr;</a></div>
</section>

<section class="sg-faqs"><h2>Starting golf: questions</h2>{faq_html}
<p class="sg-small">Looking for women’s clubs? See <a href="/prices/golf-package-sets/">every package set we track</a>.</p></section>
</div>
<script src="/js/start-golf.js?v={V}" defer></script>"""
    schema = [{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Price guides", "item": SITE + "/prices/"},
            {"@type": "ListItem", "position": 2, "name": "Start golf", "item": SITE + "/prices/start-golf/"}]}]
    return page_shell(title=f"How Much Does It Cost to Start Golf? £{head} for Your First Kit (UK) | GolfPrice AI",
                      description=f"Start golf for £{head}: a package set, shoes, balls, a glove and tees at today’s lowest UK prices, plus the five steps from the driving range to your first round.",
                      canonical=SITE + "/prices/start-golf/", body=body, section="shop", schema=schema, noindex=False,
                      extra_head=f'<link rel="stylesheet" href="/css/start-golf.css?v={V}">\n')


DATA = PRICES_DIR.parent / "data" / "start-golf.json"


def history():
    try:
        return json.loads(DATA.read_text(encoding="utf-8")).get("history", [])
    except (OSError, ValueError):
        return []


def month_ago(hist, today):
    """The total from about a month ago (the closest day 28 to 35 days back)."""
    from datetime import date
    best = None
    for d, t in hist:
        age = (today - date.fromisoformat(d)).days
        if 28 <= age <= 35 and (best is None or abs(age - 30) < abs(best[0] - 30)):
            best = (age, t)
    return best[1] if best else None


def write_data(easy, hooked, today):
    """data/start-golf.json: today's kits and one total per day, for the page,
    the AI connector (start_golf_kit) and anyone quoting the figure."""
    hist = [h for h in history() if h[0] != today.isoformat()]
    hist.append([today.isoformat(), round(sum(i["price"] for i in easy), 2)])
    hist = hist[-800:]
    def plain(items):
        return [{"item": i["what"], "name": i["name"], "price": round(i["price"], 2),
                 "url": (i["url"] if str(i.get("url", "")).startswith("http") else SITE + str(i.get("url", "")))} for i in items]
    _write(DATA, json.dumps({"updated": today.isoformat(), "page": SITE + "/prices/start-golf/",
                             "total": math.ceil(sum(i["price"] for i in easy)),
                             "easy": {"total": round(sum(i["price"] for i in easy), 2), "items": plain(easy)},
                             "hooked": {"total": round(sum(i["price"] for i in hooked), 2), "items": plain(hooked)},
                             "history": hist}, ensure_ascii=False, separators=(",", ":")))


def build(passing, built, products, today):
    easy, hooked = kit(passing, built, products), kit(passing, built, products, hooked=True)
    if len(easy) < 4:
        print(f"Start golf: only {len(easy)} kit items found; page left as it is.")
        return [], None
    path = PRICES_DIR / "start-golf" / "index.html"
    changed = ["/prices/start-golf/"] if _write(path, page(easy, hooked or easy, today)) else []
    total = math.ceil(sum(i["price"] for i in easy))
    write_data(easy, hooked or easy, today)
    print(f"Start golf: £{total} ({', '.join(i['what'] for i in easy)}).")
    return changed, total
