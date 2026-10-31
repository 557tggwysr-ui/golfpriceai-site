"""The People's Bag (/play/peoples-bag/): the bag UK golfers would build.

Golfers pick their favourite model in eight slots. The most-picked model in
each slot makes the People's Bag, priced at today's lowest UK prices. Picks
live in the alerts worker (/pb/...); this builder writes the models on offer
(data/peoples-bag.json: every model with a price page, men's and adult only,
most-viewed first from the Demand Index's anonymous counts, so no brand is
pushed) and the page itself. Built with every price run.
"""
import json
import re
from collections import Counter

from price_pages import ROOT, SITE, _write, page_shell, esc, CADDIE_V

V = "20261101"
SLOTS = [("driver", "Driver", "driver"), ("wood", "Fairway wood", "fairway wood"), ("hybrid", "Hybrid", "hybrid"),
         ("irons", "Irons", "iron set"), ("wedge", "Wedge", "wedge"), ("putter", "Putter", "putter"),
         ("ball", "Ball", "golf ball"), ("bag", "Bag", "golf bag")]
NOT_MENS = re.compile(r"\b(women'?s?|womens|ladies|lady|junior|juniors|kids?|youth|girls?|boys?)\b", re.I)

FAQS = [
    ("What is the People's Bag?",
     "The golf bag UK golfers would build together. Pick your favourite driver, fairway wood, hybrid, irons, wedge, putter, ball and bag; the most-picked model in each slot makes the People's Bag, priced at today's lowest UK prices across multiple retailers."),
    ("How are the models chosen?",
     "Every model with a GolfPrice AI price page can be picked. The lists start with the models golfers look at most on the site, and you can search for any of them. No brand pays to be here."),
    ("Can I change my picks?",
     "Yes, any time. Your picks are kept against a random player number made by your browser, with no email or name, and only count towards the totals."),
    ("Are the prices live?",
     "Yes. Prices are checked every 6 hours, so the cost of the People's Bag moves as the market does."),
]


def popularity():
    """Price-page views and shortlist hearts over the last 14 days."""
    c = Counter()
    try:
        d = json.loads((ROOT / "data" / "demand" / "signals.json").read_text())
        for day in (d.get("days") or {}).values():
            for k, v in (day.get("view") or {}).items():
                c[k] += v if isinstance(v, (int, float)) else (v[0] if v else 0)
            for k, v in (day.get("heart") or {}).items():
                c[k] += 3 * (v if isinstance(v, (int, float)) else (v[0] if v else 0))
    except (OSError, ValueError, AttributeError):
        pass
    return c


def write_data(passing, built, today):
    pop = popularity()
    slots = []
    for key, label, noun in SLOTS:
        ms = [m for m in passing if m["type"] == key and m["slug"] in built and not NOT_MENS.search(m["name"])]
        ms.sort(key=lambda m: (-pop.get(m["slug"], 0), -len(m.get("retailers") or []), m["name"].lower()))
        slots.append({"key": key, "label": label, "noun": noun, "unit": "per dozen" if key == "ball" else "",
                      "items": [{"s": m["slug"], "n": m["name"], "p": round(float(m["minPrice"]), 2)} for m in ms]})
    data = {"updated": today.isoformat(), "slots": slots}
    _write(ROOT / "data" / "peoples-bag.json", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    return slots


def page(slots):
    rows = "".join(f"""<div class="pb-slot" data-slot="{k}">
        <span class="pb-slot-k">{label.upper()}</span>
        <span class="pb-slot-who"><b data-pb="name">Loading the crowd’s pick…</b><small data-pb="sub"></small></span>
        <b class="pb-slot-p" data-pb="price"></b>
        <button type="button" class="pb-pick" data-pick="{k}">Pick yours</button>
      </div>""" for k, label, _ in SLOTS)
    faqs = "".join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQS)
    n_models = sum(len(s["items"]) for s in slots)
    body = f"""<div class="or pb">
<section class="or-hero">
  <div>
    <span class="cc-kick">THE PEOPLE’S BAG · UPDATED LIVE</span>
    <h1>The People’s <span>Bag.</span></h1>
    <p class="or-quip">If a nation of golfers built one bag together, this is it. Probably. Until someone changes their mind.</p>
    <p>Pick your favourite in each slot. The most-picked wins its place, priced at today’s lowest UK prices across multiple retailers.</p>
  </div>
  <div class="or-stats" aria-live="polite">
    <div><b class="or-green" data-pb="total">–</b><span>the whole bag today</span></div>
    <div><b data-pb="pickers">–</b><span>golfers have picked</span></div>
    <div><b>8</b><span>slots to fill</span></div>
  </div>
</section>

<div class="or-two pb-two">
  <section class="or-card" aria-labelledby="pb-h">
    <div class="or-head"><h2 id="pb-h">The bag, slot by slot</h2><span class="pb-dim">Tap a slot to pick yours</span></div>
    <div class="pb-slots">{rows}</div>
    <div class="pb-total"><b>The People’s Bag today</b><b class="pb-total-p" data-pb="total2">–</b></div>
  </section>
  <div class="or-col">
    <section class="or-card or-you" id="pb-you" aria-live="polite">
      <b class="pb-you-h" data-pb="progress">Your bag: 0 of 8 slots picked</b>
      <div class="pb-bar"><span data-pb="bar" style="width:0%"></span></div>
      <p class="or-empty" data-pb="youline">Fill all eight and you’ll see how your bag stacks up against the nation’s, to the penny.</p>
      <button type="button" class="cc-btn cc-btn-dark pb-next" data-pb="next">Pick my driver</button>
    </section>
    <section class="or-card pb-vs" id="pb-vs" hidden>
      <span class="cc-kick cc-kick-dark">YOUR BAG VS THE PEOPLE’S</span>
      <b class="pb-vs-h" data-pb="vs"></b>
      <span class="pb-vs-p" data-pb="vsline"></span>
      <button type="button" class="pb-share" data-pb="share">Share my bag →</button>
    </section>
    <section class="or-card" id="pb-race" hidden>
      <span class="cc-kick">CLOSEST RACE</span>
      <b class="pb-race-h" data-pb="race"></b>
      <span class="pb-dim" data-pb="raceline"></span>
    </section>
  </div>
</div>

<section class="or-steps" aria-label="How it works">
  <div><b>1</b><h3>Pick each slot</h3><p>Any of the {n_models:,} models we track, from drivers to the bag itself.</p></div>
  <div><b>2</b><h3>The crowd decides</h3><p>The most-picked model in each slot makes the People’s Bag.</p></div>
  <div><b>3</b><h3>Priced live</h3><p>Today’s lowest UK price for every slot, checked every 6 hours.</p></div>
</section>

<section class="or-faqs"><h2>People’s Bag questions</h2>{faqs}</section>
</div>
<noscript><p class="or-empty">The People’s Bag needs JavaScript switched on.</p></noscript>
<script src="/js/peoples-bag.js?v={V}" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "The Clubhouse", "item": SITE + "/play/"},
        {"@type": "ListItem", "position": 3, "name": "The People's Bag", "item": SITE + "/play/peoples-bag/"}]}
    return page_shell(title="The People's Bag: The Golf Bag UK Golfers Would Build | GolfPrice AI",
                      description="Pick your favourite driver, irons, putter, ball and more. The most-picked model in each slot makes the People's Bag, priced live at today's lowest UK prices.",
                      canonical=f"{SITE}/play/peoples-bag/", body=body, section="play", schema=[crumbs, faq_schema],
                      noindex=False, extra_head=f'<link rel="stylesheet" href="/css/caddie.css?v={CADDIE_V}">\n')


def build(passing, built, today):
    slots = write_data(passing, built, today)
    changed = []
    if _write(ROOT / "play" / "peoples-bag" / "index.html", page(slots)):
        changed.append("/play/peoples-bag/")
    print("People's Bag: " + ", ".join(f"{s['label']} {len(s['items'])}" for s in slots) + ".")
    return changed
