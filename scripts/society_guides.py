"""Golf society guides and free tools (built with every price run).

/societies/guides/                              the guides index
/societies/guides/golf-society-awards-ideas/    40 award ideas with the card maker built in
/societies/prize-fund-calculator/               a free golf society prize fund calculator

Written for the searches golf society organisers actually make: every page
opens with a short answer Google and AI assistants can quote, says "golf
society" in its title, first line and headings, shows when it was updated,
and has the tool built in. Prize examples are real products at today's lowest
UK price, read from the site's own search shards.
"""
import json
import re
from datetime import date
from html import escape as e
from urllib.parse import quote
from pathlib import Path

from price_pages import SITE, _write, breadcrumb, page_shell

ROOT = Path(__file__).resolve().parent.parent
CSS = '<link rel="stylesheet" href="/css/society.css?v=20261024i">\n'
PUBLISHED = "2026-10-24"
F_IN_STOCK, F_USED = 2, 8
SKIP = re.compile(r"\b(junior|juniors|kids|youth|boys|girls|ladies|lady|women'?s?|womens|personali[sz]ed|logo|practice|foam|recycled|lake|refurb|used|grade [abc]|pearl)\b", re.I)
NOT_DOZEN = re.compile(r"sleeve|\b3[ -]?ball|half dozen|\b6[ -]?(ball|pack)|pack of [36]\b|\b(15|24|30|36|48|50|100)[ -]?(ball|pack)|double|4 for 3|3 for 2|2 dozen|3 dozen", re.I)
KIT = re.compile(r"towel|umbrella|headcover|divot|pitch ?mark|marker|alignment|brush|valuables|pouch", re.I)

# ---------------------------------------------------------------- the awards (original wording)
AWARDS = [
    ("The proper trophies", "proper", [
        ("Player of the Year", "Most points across the whole season. Insufferable, frankly."),
        ("Order of Merit Champion", "Best total from the counting rounds on the Order of Merit."),
        ("Major Winner", "Most society days won this season."),
        ("Most Improved", "Biggest handicap cut, or the biggest jump in average points."),
        ("Best Gross Round", "Lowest score before handicap. Pure golf, no strokes."),
        ("Round of the Season", "Highest Stableford total on a single day."),
        ("Captain’s Prize", "The captain’s own pick. No appeals."),
        ("Society Spirit Award", "Turned up, paid on time, bought a round. The backbone."),
    ]),
    ("Funny golf society awards", "funny", [
        ("Bandit of the Year", "Played off 20, scored like a 6. The committee has questions."),
        ("Ball Donor of the Year", "Most golf balls returned to nature."),
        ("Lost in the Trees Award", "Saw more woodland than fairway."),
        ("The Excuses Cup", "Best reason for a bad round, judged in the bar."),
        ("Sand Dweller of the Year", "Spent more time in bunkers than the greenkeeper."),
        ("Three-Putt Trophy", "For services to the lip-out."),
        ("Snowman of the Year", "The finest 8 on a single hole."),
        ("Air Shot of the Year", "Swung, missed, blamed the wind."),
        ("Fashion Crime of the Year", "Trousers the group chat is still talking about."),
        ("All the Gear Award", "Newest kit in the society, same old scores."),
        ("The Gimme Grabber", "Picked up putts nobody offered."),
        ("The Shank Redemption", "Shanked one, still made par."),
        ("So Nearly a Hole in One", "Closest anyone came to buying the whole bar a drink."),
        ("The Mulligan Merchant", "Most “that one doesn’t count”."),
        ("The Longest Search", "Five minutes in the rough. Ball in his pocket all along."),
        ("Slow Play Sloth", "Ready golf? Not today."),
        ("Halfway Hut Hero", "Most bacon rolls eaten in a single season."),
        ("The Comeback Kid", "Worst front nine, best back nine."),
        ("The Rules Official", "Knows every rule and isn’t afraid to quote it."),
        ("Water Magnet", "Found every pond on every course."),
        ("The Phantom Handicap", "Nobody knows where it came from."),
        ("Best Celebration", "The most over-the-top celebration of a par."),
        ("Tee Box Philosopher", "Longest pre-shot routine in the society."),
        ("Club Thrower of the Year", "Clubs damaged this season, accidentally or otherwise."),
    ]),
    ("Wooden spoon and booby prizes", "booby", [
        ("Wooden Spoon", "Last on the Order of Merit. Character building."),
        ("Booby Prize", "Second from last on the day. So close to the spoon."),
        ("The Nearly Man", "Most second places. Always the bridesmaid."),
        ("The Golden Divot", "Biggest divot of the season. Still being replaced."),
        ("Highest Single Hole", "The biggest number on one hole this year."),
        ("Fewest Points on the Day", "A Stableford total best kept quiet."),
        ("Penalty Drop King", "Most penalty drops in a season."),
        ("Last Off the Course", "Finished after the kitchen closed."),
    ]),
]
ALL_AWARDS = [a for _, _, group in AWARDS for a in group]

GUIDES = [
    ("how-to-run-a-golf-society", "How to run a golf society",
     "Starting a golf society, booking golf clubs, collecting money, running a society day and the season, month by month."),
    ("golf-society-awards-ideas", "Golf society awards ideas",
     "40 golf society awards for your end-of-season night: proper trophies, funny awards and booby prizes, with a free card maker."),
    ("golf-society-prize-ideas", "Golf society prize ideas",
     "Golf society prizes by budget, with real examples at today’s lowest UK prices, and how to fund the prize pot."),
    ("how-much-to-charge-for-a-golf-society-day", "How much to charge for a golf society day",
     "What a golf society day costs in 2026 and what to charge members, with a free day cost calculator."),
    ("golf-society-handicap-systems", "Golf society handicap systems",
     "Official handicaps, winner cuts, Stableford points bands and averages, and the rules that stop arguments."),
    ("golf-society-rules-template", "Golf society rules template",
     "Copy-and-paste golf society rules: fees, drop-outs, handicaps, ties and prizes, ready for WhatsApp."),
    ("golf-society-apps-compared", "Golf society apps compared",
     "RiddyGolf, ParUp, Golfify, Quick9, The Social Golfer and Society HQ: cost, payments, scoring and features."),
]
TOOLS = [
    ("/societies/prize-fund-calculator/", "Golf society prize fund calculator",
     "How much prize money to put up and how to split it: 1st, 2nd, 3rd, nearest the pin and longest drive."),
    ("/societies/awards/", "Golf Society Awards Night Kit",
     "Award cards for the WhatsApp group, a presentation slideshow and prizes winners pick themselves."),
    ("/societies/hq/", "Run your golf society free",
     "Fixtures, in, out or maybe sign-ups, a waiting list and who’s paid, from one WhatsApp link."),
    ("/societies/find/", "Find a golf society",
     "UK golf societies open to new members, by town or county."),
]


# ---------------------------------------------------------------- prize examples from the shards
def _clean(n):
    base, _, rest = n.partition(" - ")
    pack = re.search(r"\b(\d+) ?pack\b", rest, re.I) or re.search(r"\(pair\)", n, re.I)
    if pack and pack.group(0).lower() != "12 pack" and not pack.group(0).startswith("12"):
        base = re.sub(r"\s*\(pair\)", "", base, flags=re.I) + (" (pair)" if "pair" in pack.group(0).lower() else f" ({pack.group(1)} pack)")
    n = base
    n = re.sub(r"\s*\(dozen\)", "", n, flags=re.I)
    n = re.sub(r"\s*-?\s*12 pack\b", "", n, flags=re.I)
    n = re.sub(r"\b20(2[3-9])\b\s*", "", n)
    return re.sub(r"\s{2,}", " ", re.sub(r"\s+-\s*$", "", n)).strip()


def prize_examples(root=ROOT):
    """For each budget (£10, £20, £35, £50): the dearest new, in-stock, men's or
    unisex item at or under it in each of balls (dozens only), gloves and bits
    for the bag. Real products, today's lowest UK price."""
    try:
        terms = json.loads((root / "data" / "search" / "terms.json").read_text())
        shards = {n: json.loads((root / "data" / "search" / f"{n}.json").read_text())["rows"] for n in ("ball", "accessories")}
    except Exception as exc:  # never stop the build
        print(f"Society guides: no prize examples ({exc})")
        return []
    def dozen(n, price):
        return (re.search(r"\bballs\b", n, re.I) and not NOT_DOZEN.search(n) and price <= 45
                and not re.search(r"retriev|marker|clip|pouch|holder|tube|30%|limited flight|range|chocolate|novelty|gift|practi[cs]e|airflow|foam", n, re.I))
    cats = [("Golf balls", "ball", dozen),
            ("Golf glove", "accessories", lambda n, p: re.search(r"\bglove", n, re.I)),
            ("For the bag", "accessories", lambda n, p: KIT.search(n))]
    bands = []
    for budget in (10, 20, 35, 50):
        picks = []
        for label, shard, ok in cats:
            best = None
            for r in shards[shard]:
                price, flags, gender = r[2], r[5], r[6]
                if not (flags & F_IN_STOCK) or (flags & F_USED) or price > budget or price < budget * 0.55:
                    continue
                if gender and gender not in ("M", "U"):
                    continue
                if SKIP.search(r[1]) or not ok(r[1], price):
                    continue
                if best is None or price > best[2] or (price == best[2] and r[1] < best[1]):
                    best = r
            if best:
                picks.append({"cat": label, "name": _clean(best[1]), "price": best[2],
                              "url": terms["urlPrefix"] + best[13] if best[13] else ""})
        if picks:
            bands.append((budget, picks))
    return bands


def money(p):
    return f"£{p:,.2f}".replace(".00", "")


# ---------------------------------------------------------------- shared bits
def article_schema(url, headline, description, today):
    return {"@context": "https://schema.org", "@type": "Article", "headline": headline, "description": description,
            "url": url, "mainEntityOfPage": url, "inLanguage": "en-GB", "datePublished": PUBLISHED,
            "dateModified": today.isoformat(), "image": f"{SITE}/assets/cards/society-awards.jpg",
            "author": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
            "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
            "about": {"@type": "Thing", "name": "Golf society"}}


def faq_block(faqs):
    html = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in faqs)
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)}} for q, a in faqs]}
    return html, schema


def more_links(skip):
    items = [(f"/societies/guides/{s}/", t) for s, t, _ in GUIDES] + [(u, t) for u, t, _ in TOOLS]
    return " · ".join(f'<a href="{u}">{e(t)}</a>' for u, t in items if u != skip)


def nice_date(d):
    return f"{d.day} {d.strftime('%B %Y')}"


# ---------------------------------------------------------------- the awards ideas guide
def awards_guide(today, bands):
    url = f"{SITE}/societies/guides/golf-society-awards-ideas/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society guides", "/societies/guides/"),
                                             ("Golf society awards ideas", None)])
    groups = ""
    for title, key, items in AWARDS:
        rows = "".join(
            f'<li class="gd-aw"><span><b>{e(t)}</b><span>{e(d)}</span></span>'
            f'<a class="gd-make" href="/societies/awards/?add={quote(t)}" data-award="{e(t)}">Make the card <span aria-hidden="true">&rarr;</span></a></li>'
            for t, d in items)
        groups += f'<section class="soc-card gd-group" id="{key}"><h2>{e(title)} ({len(items)})</h2><ul class="gd-list">{rows}</ul></section>\n'
    if bands:
        prize_rows = "".join(
            f'<div class="gd-band"><b>Around {money(b)}</b><ul>' + "".join(
                f'<li><span>{e(p["cat"])}: ' + (f'<a href="{e(p["url"])}" rel="sponsored nofollow noopener" target="_blank">{e(p["name"])}</a>' if p["url"] else e(p["name"])) +
                f'</span><b>{money(p["price"])}</b></li>' for p in picks) + '</ul></div>' for b, picks in bands)
        prizes = (f'<p class="soc-help">Real examples at today’s lowest UK price, checked {nice_date(today)} across multiple UK retailers. '
                  f'Prices can change on the retailer’s site.</p><div class="gd-bands">{prize_rows}</div>')
    else:
        prizes = ''
    faqs = [
        ("How many awards should a golf society give?",
         "Most golf societies give between 6 and 10 at the end-of-season night: two or three proper trophies (Player of the Year, the Order of Merit, Most Improved), four to six funny awards, and a wooden spoon. More than about 12 and the presentation drags."),
        ("Who decides the funny golf society awards?",
         "Usually the organiser or the committee, but a vote in the WhatsApp group works brilliantly: put up a poll a week before the night and announce the winners on the night. Keep the proper trophies on the numbers, so nobody can argue."),
        ("What prizes do golf societies give?",
         "A trophy or engraved glass for Player of the Year, then golf kit for the rest: a dozen balls, a glove, a towel or a headcover. Many societies set a budget per award and let the winner choose. The <a href=\"/societies/awards/\">Awards Night Kit</a>’s Prize Picker does exactly that, at today’s lowest UK prices."),
        ("How much should a golf society spend on end-of-season prizes?",
         "A common pattern is £40 to £75 for Player of the Year, £20 to £35 for the other proper trophies and £10 to £20 for each funny award, paid from a season prize fund or a few pounds added to each society day’s entry."),
        ("Is the Awards Night Kit free?",
         "Yes. No sign-up and no fees. GolfPrice AI earns a small commission if a prize is bought through one of our links, at no extra cost to you, and never takes or holds any money."),
    ]
    faq_html, faq_schema = faq_block(faqs)
    data = json.dumps([[t, d] for t, d in ALL_AWARDS], ensure_ascii=False)
    body = f"""<div class="soc-wrap gd-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Golf society guide · Updated {nice_date(today)}</span>
  <h1>Golf society awards ideas: 40 awards for your end-of-season night</h1>
  <p class="gd-answer">The best golf society awards mix a few proper trophies (Player of the Year, the Order of Merit, Most Improved) with funny awards everyone remembers (Bandit of the Year, Ball Donor of the Year) and a wooden spoon. Most golf societies give 6 to 10 awards, with £10 to £50 of prizes each.</p>
  <div class="soc-btns"><a class="soc-btn" href="#maker">Make an award card free</a><a class="soc-btn2 sh-btn-dark" href="/societies/awards/">Do the full set</a></div>
</section>
<nav class="soc-card gd-toc" aria-label="On this page"><b>On this page</b>
  <a href="#proper">The proper trophies</a> · <a href="#funny">Funny golf society awards</a> · <a href="#booby">Wooden spoon and booby prizes</a> · <a href="#maker">Make an award card</a> · <a href="#prizes">What to spend on golf society prizes</a> · <a href="#night">Running the awards night</a> · <a href="#faq">Questions</a>
</nav>
{groups}
<section class="soc-card gd-maker" id="maker" aria-labelledby="maker-h">
  <span class="soc-kick">Try it here · free</span>
  <h2 id="maker-h">Make a golf society award card</h2>
  <div class="gd-maker-g">
    <div class="gd-maker-f">
      <label>Award<select id="gm-award"></select></label>
      <label>Winner’s name or nickname<input id="gm-w" maxlength="30" placeholder="e.g. Dave"></label>
      <label>Your golf society (optional)<input id="gm-n" maxlength="40" placeholder="e.g. The Sunday Slicers"></label>
      <div class="soc-btns"><button type="button" class="soc-btn" id="gm-save">Save the card</button><a class="soc-btn2 sh-btn-dark" id="gm-full" href="/societies/awards/">Do the full set <span aria-hidden="true">&rarr;</span></a></div>
      <p class="gd-small">The full Awards Night Kit makes every card at once, a slideshow for the night, and private prize links for the winners.</p>
    </div>
    <canvas id="gm-cv" width="1080" height="1350" class="gd-cv" role="img" aria-label="Award card preview"></canvas>
  </div>
</section>
<section class="soc-card" id="prizes">
  <h2>What to spend on golf society prizes</h2>
  <div class="gd-spend">
    <span>Player of the Year</span><b>£40–£75</b>
    <span>Other proper trophies</span><b>£20–£35</b>
    <span>Each funny award</span><b>£10–£20</b>
    <span>Wooden spoon</span><b>£5, or an actual spoon</b>
  </div>
  {prizes}
  <p class="soc-help">Rather let winners choose? Give each award a budget in the <a href="/societies/awards/">Awards Night Kit</a> and each winner gets a private link to pick their own prize. You get one shopping list.</p>
</section>
<section class="soc-card" id="night">
  <h2>Running the golf society awards night</h2>
  <ol class="gd-steps">
    <li><b>Lock the numbers first.</b> Settle the Order of Merit and Player of the Year from the season’s results before anyone has a drink.</li>
    <li><b>Poll the funny awards.</b> A WhatsApp poll a week before keeps it fair and builds the suspense.</li>
    <li><b>Funny first, trophies last.</b> Start with the booby prizes, build through the funny awards and finish on Player of the Year.</li>
    <li><b>One line per winner.</b> A short, kind roast beats a long speech. Each card above has one ready.</li>
    <li><b>Put it on the big screen.</b> The kit’s slideshow runs from a phone or laptop, one award at a time.</li>
    <li><b>Share the cards after.</b> Drop them in the group chat so everyone has the proof.</li>
  </ol>
</section>
<section class="soc-card sh-faq" id="faq">
  <h2>Golf society awards: questions organisers ask</h2>
  {faq_html}
</section>
<section class="soc-card soc-next">
  <span class="soc-kick">Run the whole season</span>
  <h2>Society HQ: the free golf society organiser</h2>
  <p>Fixtures, sign-ups, who’s paid and a waiting list, from one link in your golf society’s WhatsApp group.</p>
  <a class="soc-btn" href="/societies/hq/">Start your golf society free</a>
</section>
<p class="gd-more"><b>More for golf societies:</b> {more_links("/societies/guides/golf-society-awards-ideas/")}</p>
</div>
<script type="application/json" id="gm-data">{data}</script>
<script src="/js/society-guide.js?v=20261024" defer></script>"""
    title = "Golf society awards ideas: 40 funny and proper awards | GolfPrice AI"
    desc = "40 golf society awards ideas for your end-of-season night: proper trophies, funny awards like Bandit of the Year, booby prizes and what to spend, with a free award card maker."
    return page_shell(title=title, description=desc, canonical=url, body=body, section="societies",
                      schema=[crumbs_schema, article_schema(url, "Golf society awards ideas: 40 awards for your end-of-season night", desc, today), faq_schema,
                              {"@context": "https://schema.org", "@type": "ItemList", "name": "Golf society awards ideas", "numberOfItems": len(ALL_AWARDS),
                               "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": t, "description": d} for i, (t, d) in enumerate(ALL_AWARDS)]}],
                      noindex=False, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


# ---------------------------------------------------------------- prize fund calculator
def calculator_page(today):
    url = f"{SITE}/societies/prize-fund-calculator/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society prize fund calculator", None)])
    faqs = [
        ("How much of the entry money should go on prizes?",
         "Most golf societies put 30% to 40% of the society entry money into prizes, and the rest towards the trophy, the meal or the end-of-season fund. Green fees are usually paid separately, so they’re not part of the prize fund."),
        ("How do golf societies split the prize fund?",
         "A common split is 40% to the winner, 27% second, 13% third, and 10% each for nearest the pin and longest drive. With a big field, some societies add 4th place or a prize for each division."),
        ("What is a twos pot?",
         "Everyone puts in a pound or two; anyone who scores a two on a hole shares the pot. If nobody does, it rolls over to the next society day."),
        ("Should prizes be cash or golf kit?",
         "Many golf societies prefer kit or vouchers to cash. Society HQ’s Prize Picker lets each winner choose their own golf prize within budget, at today’s lowest UK price."),
    ]
    faq_html, faq_schema = faq_block(faqs)
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Free tool · No sign-up</span>
  <h1>Golf society prize fund calculator</h1>
  <p class="gd-answer">Most golf societies put 30% to 40% of the entry money into prizes, split about 40% to the winner, 27% second, 13% third and 10% each for nearest the pin and longest drive. Enter your numbers for your exact split.</p>
</section>
<form class="soc-card pc-form" id="pc" novalidate onsubmit="return false">
  <div class="soc-two pc-two"><label>Players<input id="pc-n" inputmode="numeric" value="24"></label><label>Society entry per player (£)<input id="pc-e" inputmode="decimal" value="15"></label></div>
  <label for="pc-p">Prize fund: <span id="pc-pv">35</span>% of the entry money (the usual is 30–40%)</label>
  <input type="range" id="pc-p" min="10" max="100" step="5" value="35" class="hq-pct pc-range">
  <fieldset class="pc-side"><legend>Side prizes</legend>
    <label class="soc-check"><input type="checkbox" id="pc-ntp" checked> Nearest the pin</label>
    <label class="soc-check"><input type="checkbox" id="pc-ld" checked> Longest drive</label>
    <label class="soc-check"><input type="checkbox" id="pc-4th"> Pay 4th place</label>
  </fieldset>
</form>
<section class="hq-fund pc-out" id="pc-out" aria-live="polite"><noscript><p>The calculator needs JavaScript. As a rule of thumb: 24 players at £15 is £360, and 35% is £126 of prizes.</p></noscript></section>
<section class="soc-card soc-next">
  <span class="soc-kick">Worked out from who’s actually in</span>
  <h2>Run the whole golf day in Society HQ</h2>
  <p>Sign-ups, a waiting list, who’s paid and this prize fund, worked out from the players who are actually in. Free, from one WhatsApp link.</p>
  <a class="soc-btn" href="/societies/hq/">Start your golf society free</a>
</section>
<section class="soc-card sh-faq">
  <h2>Golf society prize money: questions organisers ask</h2>
  {faq_html}
</section>
<p class="gd-more"><b>More for golf societies:</b> {more_links("/societies/prize-fund-calculator/")}</p>
</div>
<script src="/js/prize-calc.js?v=20261024b" defer></script>"""
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "Golf society prize fund calculator", "url": url,
           "applicationCategory": "SportsApplication", "operatingSystem": "Any web browser", "inLanguage": "en-GB",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
           "description": "Free calculator for golf society prize money: the prize fund from players and entry fee, split for 1st, 2nd, 3rd, nearest the pin and longest drive.",
           "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    return page_shell(title="Golf society prize fund calculator: free prize money split | GolfPrice AI",
                      description="Free golf society prize fund calculator: how much prize money to put up and how to split it for 1st, 2nd, 3rd, nearest the pin and longest drive.",
                      canonical=url, body=body, section="societies", schema=[crumbs_schema, app, faq_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


# ---------------------------------------------------------------- guides index
def index_page(today):
    url = f"{SITE}/societies/guides/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society guides", None)])
    cards = "".join(f'<a class="soc-card gd-card" href="/societies/guides/{s}/"><span class="soc-kick" style="color:var(--gp-green-dark)">Guide</span><h2>{e(t)}</h2><p class="soc-help">{e(d)}</p></a>' for s, t, d in GUIDES)
    cards += "".join(f'<a class="soc-card gd-card" href="{u}"><span class="soc-kick" style="color:var(--gp-green-dark)">Free tool</span><h2>{e(t)}</h2><p class="soc-help">{e(d)}</p></a>' for u, t, d in TOOLS)
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Society HQ · Updated {nice_date(today)}</span>
  <h1>Golf society guides and free tools</h1>
  <p class="gd-answer">Practical guides for running a golf society, written for UK organisers: starting a society, awards, prizes, money, handicaps and rules, each with a free tool built in.</p>
</section>
<div class="gd-cards">{cards}</div>
</div>"""
    return page_shell(title="Golf society guides: awards, prizes and running a society | GolfPrice AI",
                      description="Free guides and tools for golf society organisers: golf society awards ideas, a prize fund calculator, an awards night kit and a free golf society organiser.",
                      canonical=url, body=body, section="societies", schema=[crumbs_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build(root=ROOT, today=None):
    today = today or date.today()
    bands = prize_examples(root)
    changed = []
    pages = [("societies/guides/index.html", index_page(today), "/societies/guides/"),
             ("societies/guides/golf-society-awards-ideas/index.html", awards_guide(today, bands), "/societies/guides/golf-society-awards-ideas/"),
             ("societies/prize-fund-calculator/index.html", calculator_page(today), "/societies/prize-fund-calculator/")]
    import society_guides2
    for slug, html in society_guides2.pages(today, bands):
        pages.append((f"societies/guides/{slug}/index.html", html, f"/societies/guides/{slug}/"))
    for path, html, u in pages:
        if _write(root / path, html):
            changed.append(u)
    return changed


SITEMAP = ["societies/guides/", "societies/prize-fund-calculator/"] + [f"societies/guides/{s}/" for s, _, _ in GUIDES]

if __name__ == "__main__":
    print(build())
