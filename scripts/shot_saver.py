"""Shot Saver (/improve/shot-saver/): where do your shots go?

A golfer adds five numbers from a scorecard (score, fairways, greens in
regulation, putts, penalty shots) and picks the level they're chasing. The page
compares their last five rounds with a golfer at that level, using Shot Scope's
published averages by handicap (via Golf Monthly), shows where the shots leak,
gives the free fix first, then practice kit at today's lowest UK prices.

The maths lives in js/shot-saver-core.js and runs in the visitor's browser.
Rounds stay on their device (and in My Clubhouse). Nothing personal is sent.
This script rebuilds the page on every run so the kit prices stay current.
"""
import json
import re
from datetime import datetime, timezone

from price_pages import ROOT, SITE, _write, esc, page_shell

V = "20261101"
try:
    from improve_pages import V as IM_V
except Exception:  # never stop the page over a stylesheet version
    IM_V = "20261030b"
OUT = ROOT / "improve" / "shot-saver" / "index.html"
SLUG = "shot-saver"
NOT_MENS = re.compile(r"\b(ladies|lady|women'?s?|womens|junior|kids?|youth|girls?|boys?)\b", re.I)

SOURCES = [
    ("Scratch vs 10 vs 20 handicap: how the stats compare", "https://www.golfmonthly.com/features/scratch-vs-10-vs-20-handicap-how-the-stats-compare",
     "fairways, putts and up-and-downs"),
    ("How many greens in regulation do 5, 10 and 15-handicap golfers hit?", "https://www.golfmonthly.com/features/how-many-greens-in-regulation-5-10-and-15-handicap-golfers",
     "greens in regulation"),
    ("What qualifies as a good round of golf for your handicap?", "https://www.golfmonthly.com/features/what-qualifies-as-a-good-round-of-golf",
     "average scores"),
]

# The same benchmark figures as js/shot-saver-core.js, for the page's table.
AIMS = [
    ("Break 100", "20", 95, 45, 14, 33.4, 31),
    ("Break 90", "10", 85, 48, 32, 31.2, 39),
    ("Break 80", "5", 79, 49, 41, 30.6, 46),
    ("Scratch", "0", 74, 50, 59, 29.9, 54),
]

# Practice kit for each leak. Only training aids, never clubs: the free fix
# always comes first. (what, regex on the name, minimum price, what it's for)
KIT = {
    "putt": [("Putting mat", r"putting mat", 10, "practise on the living room carpet"),
             ("Putting gate or arch", r"putting (arch|arches|gate|hoops?|mirror)", 5, "for the start line"),
             ("Alignment sticks", r"alignment (sticks?|rods?)", 5, "they keep your stroke honest")],
    "app": [("Alignment sticks", r"alignment (sticks?|rods?)", 5, "aim where you think you're aiming"),
            ("Hitting mat", r"(hitting|practice|chip and drive) (golf )?mat", 8, "for swings in the garden"),
            ("Practice net", r"(driving|practice) net", 40, "full swings at home")],
    "rest": [("Chipping net", r"chipping (net|target)", 8, "the back garden short game"),
             ("Practice balls", r"(airflow|foam).*practice|practice (foam )?(golf )?balls", 1, "won't break a window"),
             ("Hitting mat", r"(hitting|practice|chip and drive) (golf )?mat", 8, "chip off it all winter")],
}
SKIP = re.compile(r"cover|headcover|carry bag|\bbag\b|holder|case|winter", re.I)


def _short(name):
    return re.split(r"\s+-\s+|\s+/\s+", name)[0].strip()


def _cheapest(products, rx, lo):
    rows = [p for p in products if p.get("inStock") and not p.get("condition") and (p.get("salePrice") or 0) >= lo
            and re.search(rx, p.get("name", ""), re.I) and not SKIP.search(p.get("name", ""))
            and not NOT_MENS.search(p.get("name", "")) and p.get("affiliateUrl")]
    return min(rows, key=lambda p: p["salePrice"], default=None)


def kit(passing, built, products):
    out = {}
    for cat, items in KIT.items():
        out[cat] = []
        for what, rx, lo, note in items:
            p = _cheapest(products, rx, lo)
            if p:
                out[cat].append({"what": what, "name": _short(p["name"]), "price": round(p["salePrice"], 2),
                                 "url": p["affiliateUrl"], "note": note, "out": True})
    # Penalties: no gadget fixes those. Balls, because until then you'll need them.
    try:
        from start_golf import _balls
        b = _balls(passing, built, better=False)
    except Exception:  # never stop the page over a ball
        b = None
    out["pen"] = ([{"what": "Golf balls, per dozen", "name": b["name"], "price": round(b["minPrice"], 2), "url": f"/prices/{b['slug']}/",
                    "note": "until the fix kicks in, you'll need them"}] if b else [])
    return out


# A sample round, so the page reads properly before anyone adds one.
SAMPLE = {"s": 94, "f": 7, "g": 3, "p": 35, "n": 3}


def sample_rows():
    b = AIMS[1]
    gap = (SAMPLE["s"] - 72) - (b[2] - 72)
    putt = SAMPLE["p"] - b[5]
    pen = SAMPLE["n"]
    app = (b[4] / 100 * 18 - SAMPLE["g"]) * (1 - b[6] / 100)
    rest = gap - putt - pen - app
    rows = sorted([("Putting", putt), ("Penalties", pen), ("Approach shots", app), ("Short game and the rest", rest)],
                  key=lambda r: -r[1])
    total = sum(max(0, v) for _, v in rows)
    return rows, total


def bars_html(rows):
    top = max(v for _, v in rows) or 1
    out = []
    for i, (label, v) in enumerate(rows):
        if v < 0.05:
            continue
        out.append(f'<div class="ss-bar"><b>{esc(label)}</b><span class="ss-track"><span class="ss-fill{" ss-top" if i == 0 else ""}" '
                   f'style="width:{max(4, round(v / top * 100))}%"></span></span><b class="ss-v">{v:.1f}</b></div>')
    return "".join(out)


def money(x):
    return f"£{x:,.2f}"


def kit_html(items):
    out = ' rel="sponsored nofollow noopener" target="_blank"'
    return "".join(
        f'<a class="ss-kit-row" href="{esc(i["url"])}"{out if i.get("out") else ""}>'
        f'<span><b>{esc(i["what"])}</b><small>{esc(i["note"])}</small></span><b class="ss-price">from {money(i["price"])}</b></a>'
        for i in items)


def stepper(fid, label, hint, lo, hi, value):
    return (f'<div class="ss-step"><label for="ss-{fid}"><b>{esc(label)}</b><small>{esc(hint)}</small></label>'
            f'<button type="button" class="ss-pm" data-step="-1" data-for="{fid}" aria-label="{esc(label)}: one less">&minus;</button>'
            f'<input id="ss-{fid}" name="{fid}" type="number" inputmode="numeric" min="{lo}" max="{hi}" step="1" placeholder="{value}" autocomplete="off">'
            f'<button type="button" class="ss-pm" data-step="1" data-for="{fid}" aria-label="{esc(label)}: one more">+</button></div>')


FAQS = [
    ("Where do most amateur golfers lose shots?",
     "For most club golfers it isn't the driver. Shot Scope's data shows a 20-handicapper hits almost as many fairways as a scratch golfer (45% against 50%), "
     "but far fewer greens (14% against 59%) and takes three or four more putts. Penalties, approach shots and putting are where most shots go."),
    ("How does Shot Saver work out where my shots go?",
     "You add five numbers from your scorecard. We compare them with the published Shot Scope averages for the level you're chasing. "
     "Putts and penalty shots count one for one. Greens you miss beyond theirs cost a shot unless you get up and down, at the rate they do. "
     "Whatever's left of the gap in score goes to short game and the rest. We average your last five rounds."),
    ("Do I need a shot tracker or an app?",
     "No. Everything comes off a normal scorecard, as long as you jot down fairways, greens, putts and penalties as you go. Skip any number you didn't keep."),
    ("Is my data saved anywhere?",
     "Your rounds are kept in this browser and shown in your My Clubhouse. Nothing personal is sent to us: we only count, anonymously, how many rounds get added."),
    ("Why do penalty shots count in full?",
     "We couldn't find a reliable published average for penalty shots by handicap, so rather than guess one, every penalty shot counts. Good golfers have fewer, but none of them are compulsory."),
]


def page(kits, today):
    rows, total = sample_rows()
    top = rows[0][0]
    table = "".join(f'<tr><th scope="row">{esc(a[0])}</th><td>{a[1]}</td><td>{a[2]}</td><td>{a[3]}%</td><td>{a[4]}%</td><td>{a[5]}</td><td>{a[6]}%</td></tr>'
                    for a in AIMS)
    srcs = "".join(f'<li><a href="{esc(u)}" rel="noopener" target="_blank">{esc(t)}</a>, Golf Monthly with Shot Scope data: {esc(w)}.</li>'
                   for t, u, w in SOURCES)
    faq_html = "".join(f'<details class="ss-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in FAQS)
    kit_json = json.dumps(kits, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    checked = datetime.now(timezone.utc).strftime("%-d %B %Y")
    from improve_pages import more_calcs
    body = f"""<div class="ss" id="ss">
<nav class="ss-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/improve/">Improve</a> &rsaquo; Shot Saver</nav>
<section class="ss-hero">
  <div class="ss-hero-copy">
    <span class="ss-kick ss-kick-light">IMPROVE &middot; FREE &middot; NO SIGN-UP</span>
    <h1>Shot <span>Saver.</span></h1>
    <p class="ss-sub">Every golfer blames the driver. Five numbers from your scorecard will tell you who&rsquo;s really guilty.</p>
    <p class="ss-lede">Add a round in 30 seconds. We compare it with a golfer at the score you&rsquo;re chasing, show where the shots leak, and give you the free fix first.</p>
  </div>
  <div class="ss-tiles">
    <div><b class="ss-green">5</b><span>numbers per round</span></div>
    <div><b>30s</b><span>to add a round</span></div>
    <div><b>&pound;0</b><span>the fix comes first</span></div>
  </div>
</section>

<div class="ss-grid">
  <form class="ss-form" id="ss-form" novalidate>
    <div class="ss-form-head"><h2>Add a round</h2><span id="ss-count">Your first one</span></div>
    <div class="ss-two">
      <label class="ss-sel">I&rsquo;m chasing
        <select id="ss-aim" name="aim"><option value="100">Break 100</option><option value="90" selected>Break 90</option><option value="80">Break 80</option><option value="sc">Scratch</option></select></label>
      <label class="ss-sel">Course par
        <select id="ss-par" name="par"><option>70</option><option>71</option><option selected>72</option><option>73</option></select></label>
    </div>
    <div class="ss-steps">
      {stepper("s", "Score", "gross, 18 holes", 50, 160, 92)}
      {stepper("f", "Fairways hit", "out of 14", 0, 14, 7)}
      {stepper("g", "Greens in regulation", "out of 18", 0, 18, 4)}
      {stepper("p", "Putts", "total", 0, 70, 34)}
      {stepper("n", "Penalty shots", "water, OB, lost balls", 0, 30, 2)}
    </div>
    <button type="submit" class="ss-btn ss-go">Show me where they went</button>
    <p class="ss-msg" id="ss-msg" role="status"></p>
    <p class="ss-small">Don&rsquo;t know a number? Skip it, we&rsquo;ll work with the rest. Rounds stay on this device and in your <a href="/play/my-clubhouse/">My Clubhouse</a>. No email, no account.</p>
  </form>

  <div class="ss-out" id="ss-out" aria-live="polite">
    <section class="ss-card ss-res">
      <div class="ss-res-head"><div><span class="ss-kick" id="ss-vs">A SAMPLE ROUND OF 94, AGAINST A 10-HANDICAPPER</span>
        <h2 id="ss-total">{total:.1f} shots to save a round</h2></div><span class="ss-badge" id="ss-badge">Sample</span></div>
      <div class="ss-bars" id="ss-bars">{bars_html(rows)}</div>
      <p class="ss-quip" id="ss-quip">Good news: the driver&rsquo;s innocent. Bad news: the putter&rsquo;s running up a tab.</p>
      <p class="ss-strong" id="ss-strong" hidden></p>
    </section>
    <section class="ss-dark" id="ss-fix">
      <div class="ss-fix-col" id="ss-fix-col">
        <span class="ss-kick ss-orange" id="ss-fix-kick">BIGGEST LEAK &middot; {esc(top.upper())}</span>
        <b class="ss-fix-h">The free fix first</b>
        <div id="ss-drills"><p><b>The 3-foot circle.</b> Eight balls round the hole at three feet. Hole all eight before you leave. Miss one, start again. Ten minutes before each round.</p>
        <p><b>The ladder.</b> Putts from 20, 30 and 40 feet, each one to stop inside a putter length. This is where three-putts go to die.</p></div>
      </div>
      <div class="ss-kit-col">
        <span class="ss-kick ss-kick-light">WANT KIT FOR IT? LIVE UK PRICES</span>
        <div id="ss-kit">{kit_html(kits.get("putt", []))}</div>
        <span class="ss-small ss-small-dark">Checked every 6 hours across multiple UK retailers, last on {checked}. Prices can change on the retailer&rsquo;s site.</span>
      </div>
    </section>
    <section class="ss-card ss-also" id="ss-also" hidden></section>
    <section class="ss-card" id="ss-trend-sec" hidden>
      <div class="ss-trend-head"><b>Shots to save, round by round</b><span class="ss-pill" id="ss-since" hidden></span></div>
      <div class="ss-trend" id="ss-trend"></div>
      <div class="ss-actions"><button type="button" class="ss-btn" id="ss-share">Share where my shots go</button>
        <a class="ss-ghost" href="/improve/what-do-i-need-to-shoot/">What do I need to shoot?</a>
        <button type="button" class="ss-link" id="ss-undo">Remove my last round</button></div>
    </section>
  </div>
</div>

<section class="ss-card ss-how" id="how">
  <h2>How we work it out</h2>
  <p>Your rounds are compared with the average golfer at the level you&rsquo;re chasing. The averages come from Shot Scope&rsquo;s shot-tracking data, published by Golf Monthly. Scores are on a par 72, and we adjust for your course&rsquo;s par.</p>
  <ul class="ss-rules">
    <li><b>Putting:</b> your putts minus theirs.</li>
    <li><b>Penalties:</b> every penalty shot counts in full. There&rsquo;s no reliable published average by handicap, so we don&rsquo;t guess one.</li>
    <li><b>Approach shots:</b> each green you miss beyond theirs costs a shot unless you get up and down, at the rate they do.</li>
    <li><b>Short game and the rest:</b> whatever&rsquo;s left of the gap in score. Chips, bunkers, the odd duff, and any number you skipped.</li>
  </ul>
  <div class="ss-table-wrap"><table class="ss-table"><caption>The golfers you&rsquo;re compared with</caption>
    <thead><tr><th scope="col">Chasing</th><th scope="col">Handicap</th><th scope="col">Average score</th><th scope="col">Fairways</th><th scope="col">Greens</th><th scope="col">Putts</th><th scope="col">Up and down</th></tr></thead>
    <tbody>{table}</tbody></table></div>
  <p class="ss-small">Break 80: the score and greens are published for 5-handicappers; fairways, putts and up-and-downs sit between the published scratch and 10-handicap figures. A rule of thumb, not a lesson: if a PGA professional tells you otherwise, listen to them.</p>
  <ul class="ss-src">{srcs}</ul>
</section>

<section class="ss-faqs"><h2>Shot Saver: questions</h2>{faq_html}</section>
{more_calcs(SLUG)}
</div>
<script type="application/json" id="ss-kit-data">{kit_json}</script>
<script src="/js/shot-saver-core.js?v={V}" defer></script>
<script src="/js/shot-saver.js?v={V}" defer></script>"""
    desc = ("Free golf stats tool: add five numbers from your scorecard and see where your shots go against a golfer who breaks 100, 90 or 80. "
            "The free fix first, then practice kit at live UK prices.")
    schema = [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Improve", "item": SITE + "/improve/"},
            {"@type": "ListItem", "position": 3, "name": "Shot Saver", "item": f"{SITE}/improve/{SLUG}/"}]},
        {"@context": "https://schema.org", "@type": "WebApplication", "name": "Shot Saver", "url": f"{SITE}/improve/{SLUG}/",
         "applicationCategory": "SportsApplication", "operatingSystem": "Any", "description": desc,
         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]},
    ]
    return page_shell(title="Where Do My Golf Shots Go? Free Golf Stats Tool | Shot Saver | GolfPrice AI",
                      description=desc, canonical=f"{SITE}/improve/{SLUG}/", body=body, section="improve", schema=schema,
                      noindex=False, extra_head=f'<link rel="stylesheet" href="/css/improve.css?v={IM_V}">\n'
                                                f'<link rel="stylesheet" href="/css/shot-saver.css?v={V}">\n'
                                                f'<script src="/js/milestones.js?v=20261101c" defer></script>\n')


def build(passing, built, products, today):
    kits = kit(passing, built, products)
    changed = [f"/improve/{SLUG}/"] if _write(OUT, page(kits, today)) else []
    print("Shot Saver: kit " + ", ".join(f"{k} {len(v)}" for k, v in kits.items()))
    return changed
