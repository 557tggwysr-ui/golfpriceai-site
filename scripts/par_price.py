"""Par Price: the daily golf price game (golfpriceai.com/play/par-price/).

Also writes The Clubhouse (/play/, the games hub) and the league page (/play/league/).

Every day, five real products. Players guess each one's lowest new UK price
today and score it like golf: within 2% is an eagle, 5% a birdie, 10% par,
20% a bogey, anything further a double bogey.

Built by price_pages.build every 6 hours. The first run of each day picks
that day's five and freezes their prices, so everyone plays the same round
all day; later runs that day leave it alone.

Picking is fair and repeatable: seeded by the date, five different product
types, five different brands, men's models first, never junior sets, only
models with a photo, at least two retailers and two weeks of history, and
nothing used in the last 30 days.

Writes
  data/par-price/today.json   the round (no personal data; guesses stay in
                              each player's own browser)
  data/par-price-state.json   which models were used on which day
  play/index.html             the game page
"""
import json
import random
import re
from datetime import date, timedelta

from price_pages import PRICES_DIR, SITE, TYPES, NOT_IN_PICKS, _write, breadcrumb, esc, page_shell

ROOT = PRICES_DIR.parent
TODAY_FILE = ROOT / "data" / "par-price" / "today.json"
STATE = ROOT / "data" / "par-price-state.json"
LAUNCH = date(2026, 10, 18)  # puzzle #1
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
HOLES = 5
CARD = "/assets/cards/par-price.jpg"


def number(day):
    return (day - LAUNCH).days + 1


def pick(passing, built, day, recent, count=HOLES):
    rng = random.Random(f"par-price-{day.isoformat()}")
    pool = [m for m in passing
            if m["slug"] in built and m["type"] in TYPES and m["type"] not in NOT_IN_PICKS
            and m.get("_image") and not WOMEN_RX.search(m["name"]) and m["slug"] not in recent
            and len(m.get("retailers") or []) >= 2 and (m.get("historyDays") or 0) >= 14 and m["minPrice"] >= 10]
    rng.shuffle(pool)
    # Popular models more often: sort the shuffled pool by listings in bands of 10.
    pool.sort(key=lambda m: -(min(m.get("listingCount") or 0, 30) // 10))
    out, types, brands = [], set(), set()
    for m in pool:
        if m["type"] in types or m["brand"] in brands:
            continue
        out.append(m)
        types.add(m["type"])
        brands.add(m["brand"])
        if len(out) == count:
            break
    pin = out[HOLES:]
    out = out[:HOLES]
    rng.shuffle(out)
    return out + pin


def item(m):
    return {"slug": m["slug"], "name": m["name"], "image": m.get("_image"), "price": round(float(m["minPrice"]), 2),
            "unit": "per dozen" if m["type"] == "ball" else "each", "type": TYPES[m["type"]][2],
            "low": (m.get("verdict") or {}).get("label") == "good",
            "url": f"/prices/{m['slug']}/"}


def page(n, today):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", "/play/"), ("Par Price", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pr-game" id="pr-game" data-n="{n}" aria-live="polite">
  <div class="pr-top">
    <div>
      <span class="pr-kicker">Daily · Par Price #{n}</span>
      <h1>Par Price: the daily golf price game</h1>
    </div>
    <span class="pr-total" hidden></span>
  </div>
  <p class="pr-lede">Five real products. Guess each one’s lowest new UK price today and score it like a round of golf. Within 2% is an eagle, 5% a birdie, 10% par.</p>
  <ol class="pr-holes" aria-label="Holes"></ol>
  <div class="pr-stage"><p class="pr-loading">Teeing up today’s round…</p></div>
  <noscript><p>Par Price needs JavaScript to play. Today’s prices are all on our <a href="/prices/">price guides</a>.</p></noscript>
</section>
<section class="pp-block pr-how">
  <h2>How it works</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>Where do the prices come from?</h3><p>Our own tracking: the lowest new, in-stock price across multiple UK retailers, frozen when the round is set each morning so everyone plays the same course.</p></div>
    <div class="pp-card pp-q"><h3>How is it scored?</h3><p>Within 2% of the real price is an eagle (−2), 5% a birdie (−1), 10% par, 20% a bogey (+1), anything further a double bogey (+2). Five holes, par is level.</p></div>
    <div class="pp-card pp-q"><h3>Is anything about me stored?</h3><p>No name or email unless you choose to join a league (a nickname) or get a reminder. Your streak stays in your own browser. Your score goes on the day’s leaderboard under a random code, so we can tell you how you ranked. <a href="/legal/privacy-policy.html">Privacy policy</a></p></div>
    <div class="pp-card pp-q"><h3>Can I play against my mates?</h3><p>Yes. Finish a round and start a league: one link for the group chat, nicknames only, and a table that updates itself. There’s a bonus Closest to the Pin hole every day too.</p></div>
    <div class="pp-card pp-q"><h3>Can I play on my phone and my laptop?</h3><p>Yes. There’s no login, so the game knows you by a code saved in your browser. To bring your leagues, streak and Bag Draft to another device, use <a href="/play/#move">Play on another device</a> in the Clubhouse. Avoid private or incognito tabs: they forget you when they close.</p></div>
    <div class="pp-card pp-q"><h3>When is the next round?</h3><p>A new round every morning, with five different products from five different brands.</p></div>
  </div>
</section>
<p class="gp-real">Every price in our games is real: the lowest new UK price we found this morning, across multiple UK retailers. <a href="/about.html">How we track prices</a> · <a href="/shop.html">Browse the shop</a> · <a href="/deal-tools.html">Free deal tools</a></p>
</div>
<script src="/js/par-price.js?v=20261026" defer></script>"""
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "Par Price", "url": f"{SITE}/play/par-price/",
           "applicationCategory": "GameApplication", "operatingSystem": "Any",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
           "description": "A free daily game: guess the lowest UK price of five real golf products and score it like a round of golf."}
    return page_shell(title=f"Par Price #{n}: the daily golf price game | GolfPrice AI",
                      description="Guess today’s lowest UK price of five real golf products and score it like a round: eagle, birdie, par. A new round every day. Free.",
                      canonical=f"{SITE}/play/par-price/", body=body, section="play", schema=[app, crumbs_schema], noindex=False,
                      og_image=CARD,
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261038">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def league_page():
    """/play/league/?l=<code>: one page for every league, filled in by js/league.js."""
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", "/play/"), ("League", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="cr" id="cr" aria-live="polite" hidden></section>
<section class="lg-wrap" id="lg" aria-live="polite"><p class="pr-loading">Opening the clubhouse doors…</p></section>
<noscript><p>Par Price leagues need JavaScript. You can still <a href="/play/par-price/">play today’s round</a>.</p></noscript>
<p class="gp-real">Every price in our games is real: the lowest new UK price we found this morning, across multiple UK retailers. <a href="/about.html">How we track prices</a> · <a href="/shop.html">Browse the shop</a> · <a href="/deal-tools.html">Free deal tools</a></p>
</div>
<script src="/js/league.js?v=20261030" defer></script>
<script src="/js/report.js?v=20261024b" defer></script>"""
    return page_shell(title="Par Price league | GolfPrice AI",
                      description="You’ve been invited to a Par Price league: five golf prices a day, scored like a round. Lowest score wins.",
                      canonical=f"{SITE}/play/league/", body=body, section="play", schema=[crumbs_schema], noindex=True,
                      og_image="/assets/cards/par-price/league.jpg",
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261038">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def leagues_page():
    """/play/leagues/: start a league in one step, or see yours (js/leagues-home.js)."""
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", "/play/"), ("Leagues", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<div class="lh-wrap">
  <section class="ch-hero lh-hero">
    <span class="pr-kicker">Play · Leagues</span>
    <h1>Take on your mates</h1>
    <p>One league covers both games: Par Price every day and the Bag Draft every month. Nicknames only, no sign-up, and a table that updates itself. Loser buys the first round.</p>
  </section>
  <section class="ch-panel lh-start" id="lh-start">
    <span class="ch-kicker">Step 1 · Start a league</span>
    <h2>Takes about ten seconds</h2>
    <form class="pr-lg-form" id="lh-form" novalidate>
      <label>League name<input name="lname" maxlength="30" placeholder="The Sunday Swingers" autocomplete="off"></label>
      <label>Your nickname<input name="nick" maxlength="20" placeholder="Big Dave" autocomplete="nickname"></label>
      <button type="submit" class="gp-af-btn">Start the league</button>
      <p class="pr-msg" role="status"></p>
      <p class="pr-lg-small">No email, no sign-up. Nicknames only: what happens in the league stays in the league. Quiet leagues tidy themselves away after 90 days. Tip: avoid private tabs, which forget you when they close. Playing on a phone and a laptop? <a href="/play/#move">Bring your player with you</a>. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
    </form>
  </section>
  <section class="ch-panel" id="lh-mine" hidden>
    <span class="ch-kicker">Your leagues</span>
    <ul class="pr-lg-list"></ul>
  </section>
  <section class="lh-steps">
    <div class="ch-panel"><span class="ch-kicker">Step 2</span><h3>Send the link</h3><p>One tap shares it to the group chat. Mates pick a nickname and they’re on the table.</p></div>
    <div class="ch-panel"><span class="ch-kicker">Step 3</span><h3>Play</h3><p>Everyone plays <a href="/play/par-price/">Par Price</a> each day and drafts a bag in the <a href="/play/draft/">Bag Draft</a> each month. The table does the rest.</p></div>
    <div class="ch-panel"><span class="ch-kicker">The good bit</span><h3>Bragging rights</h3><p>Daily winners, a weekly champion, the wooden spoon, Closest to the Pin and a monthly Major. Mike will treasure that spoon.</p></div>
  </section>
  <p class="lh-invited">Been sent an invite? Just tap the link your mate shared and pick a nickname.</p>
  <p class="lh-invited">Run a real golf society too? <a href="/societies/">Society HQ</a> handles the fixtures, sign-ups, who’s paid and awards night, free.</p>
</div>
<p class="gp-real">Every price in our games is real: the lowest new UK price we found this morning, across multiple UK retailers. <a href="/about.html">How we track prices</a> · <a href="/shop.html">Browse the shop</a> · <a href="/deal-tools.html">Free deal tools</a></p>
</div>
<script src="/js/leagues-home.js?v=20261022" defer></script>"""
    return page_shell(title="Golf leagues for your group chat | GolfPrice AI",
                      description="Start a free golf league for your group chat in ten seconds: Par Price every day, the Bag Draft every month, nicknames only. Loser buys the first round.",
                      canonical=f"{SITE}/play/leagues/", body=body, section="play", schema=[crumbs_schema], noindex=False,
                      og_image="/assets/cards/par-price/league.jpg",
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261038">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def hub_page(n, rnd):
    """/play/: The Clubhouse, home of the games. js/clubhouse.js personalises it."""
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Play", None)])
    types = ", ".join(it["type"] for it in (rnd or {}).get("items", [])[:5])
    live = str((rnd or {}).get("date", "")) >= "2026-11-01"
    body = f"""<div class="pp-wrap">
{crumbs_html}
<div class="ch-wrap" id="ch" data-n="{n}">
  <section class="ch-hero ch-hero-photo">
    <picture><source media="(max-width: 760px)" srcset="/assets/photos/tools/clubhouse-square.jpg"><img src="/assets/photos/tools/clubhouse-banner.jpg" alt="Four golfers laughing round a clubhouse table, one holding up his phone in triumph, one with his head in his hands" width="1536" height="512"></picture>
    <div class="ch-hero-text">
      <span class="pr-kicker">Play · The Clubhouse</span>
      <h1>The Clubhouse</h1>
      <p>Free golf games that run on real UK prices. Bragging rights only; handicaps not required.</p>
    </div>
  </section>

  <a class="ch-card ch-today" href="/play/par-price/?utm_source=clubhouse">
    <picture><source media="(max-width: 760px)" srcset="/assets/photos/tools/par-price-square.jpg"><img src="/assets/photos/tools/par-price-banner.jpg" alt="" width="1536" height="512" loading="eager"></picture>
    <span class="ch-body">
      <span class="ch-kicker">Daily · Par Price #{n}</span>
      <b class="ch-title">Today’s round is ready</b>
      <span class="ch-line" id="ch-today-line">Five real golf products{(": " + esc(types)) if types else ""}. Guess the prices and score it like a round.</span>
      <span class="ch-cta" id="ch-today-cta">Play today’s round <span aria-hidden="true">&rarr;</span></span>
    </span>
  </a>

  <a class="ch-card ch-hl" href="/play/higher-or-lower/?utm_source=clubhouse">
    <picture><source media="(max-width: 760px)" srcset="/assets/photos/tools/higher-or-lower-square.jpg"><img src="/assets/photos/tools/higher-or-lower-banner.jpg" alt="" width="1536" height="512" loading="lazy"></picture>
    <span class="ch-body">
      <span class="ch-kicker">Daily · New</span>
      <b class="ch-title">Higher or Lower</b>
      <span class="ch-line">Is this putter dearer than that driver? Thirty seconds, real prices, mild humiliation. Same run for everyone, then unlimited free play.</span>
      <span class="ch-cta">Play today’s run <span aria-hidden="true">&rarr;</span></span>
    </span>
  </a>

  <section class="ch-panel" id="leagues">
    <span class="ch-kicker">Leagues</span>
    <h2>Take on your mates</h2>
    <div id="ch-leagues"><p>One league covers Par Price and the Bag Draft: one link for the group chat, nicknames only, and a table that updates itself. Loser buys the first round.</p></div>
    <p><a class="ch-btn" href="/play/leagues/">Start a league</a></p>
  </section>

  <section class="ch-panel ch-fame" id="fame">
    <span class="ch-kicker">Hall of Fame</span>
    <div id="ch-fame-body">
      <h2>Champions’ bags hang here</h2>
      <p>The first Major champion is crowned on 30 November. Their engraved bag goes on this wall. No pressure.</p>
      <p><a href="/play/locker/">Your Locker Room</a></p>
    </div>
  </section>

  <section class="ch-panel ch-draft" id="draft">
    <img src="/assets/play/bag-nov.svg" alt="The Black Friday Open bag: black with orange trim" width="220" height="344" loading="lazy">
    <div class="ch-draft-text">
      <span class="ch-kicker">{"Now open · The Bag Draft" if live else "Coming 1 November · The Bag Draft"}</span>
      <h2>The Black Friday Open</h2>
      <p>Fantasy football, but for golf kit. Draft six real products within £1,500, then watch real UK prices move every 6 hours. Every £1 your picks drop is a point. Best bag at the end of November wins the Major, and the champion’s name gets engraved on this month’s bag.</p>
      <ul>
        <li>One transfer a week, one lock to bank your points</li>
        <li>Your league’s table, plus a national leaderboard</li>
        <li>A new themed bag every month. Collect the set.</li>
      </ul>
      <p class="ch-small">Free, glory only: no money, no stakes.</p>
      <p><a class="ch-draft-btn" href="/play/draft/">See the Bag Draft</a> <a class="ch-draft-alt" href="/play/draft/?test=1">Try the practice range</a></p>
    </div>
  </section>


  <details class="ch-move" id="move">
    <summary><span class="mv-sum"><b>Playing on a phone and a laptop?</b> <span class="mv-long">Bring your leagues, streak and Bag Draft with you.</span><span class="mv-short">Bring your player with you</span></span><span class="mv-go"><span class="mv-go-open">Move my player</span><span class="mv-go-close">Close</span></span></summary>
    <div class="mv-body">
      <p class="mv-intro">There’s no login, so each phone or browser is its own player. Get a code on the device you already play on, then type it (or open the link) on the other one. Your leagues, nickname, streak and Bag Draft come with you.</p>
      <div class="mv-grid">
        <div class="mv-give">
          <h3>1. On the device you already play on</h3>
          <button type="button" class="ch-btn" id="mv-make">Get a code</button>
          <div id="mv-out" hidden></div>
        </div>
        <form class="mv-take" id="mv-form" novalidate>
          <h3>2. On your other device</h3>
          <div class="mv-row"><label><span class="mv-vh">Your code</span><input name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345"></label>
          <button type="submit" class="ch-btn">Use code</button></div>
          <p class="pr-msg" role="status"></p>
        </form>
      </div>
      <p class="ch-small">Codes last 30 minutes and work once. Using one swaps this device’s own player for yours.</p>
    </div>
  </details>

  <section class="ch-panel ch-shop" id="ch-shop" hidden>
    <div class="ch-shop-head"><span class="ch-kicker">Meanwhile, in the real world</span><h2>Genuine price drops today</h2></div>
    <div class="ch-shop-grid"></div>
    <p class="ch-small"><a href="/prices/drops/?utm_source=clubhouse">All of today’s price drops</a> · <a href="/clubs.html">Clubs</a> · <a href="/apparel.html">Apparel</a> · <a href="/accessories.html">Accessories</a></p>
  </section>

  <a class="ch-also" href="/demand/">Also from the clubhouse: <b>the UK Golf Demand Index</b>, what every golfer’s quietly eyeing up this week <span aria-hidden="true">&rarr;</span></a>
</div>
<p class="gp-real">Every price in our games is real: the lowest new UK price we found this morning, across multiple UK retailers. <a href="/about.html">How we track prices</a> · <a href="/shop.html">Browse the shop</a> · <a href="/deal-tools.html">Free deal tools</a></p>
</div>
<script src="/js/clubhouse.js?v=20261024" defer></script>
<script src="/js/move.js?v=20261024a" defer></script>"""
    return page_shell(title="The Clubhouse: free golf price games | GolfPrice AI",
                      description="Free golf games that run on real UK prices: Par Price, the daily price-guessing game, leagues for your group chat, and The Bag Draft, fantasy golf kit, from 1 November.",
                      canonical=f"{SITE}/play/", body=body, section="play", schema=[crumbs_schema], noindex=False,
                      og_image="/assets/cards/clubhouse.jpg",
                      extra_head='<link rel="stylesheet" href="/css/par-price.css?v=20261038">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def build(passing, built, today):
    """Set today's round if it isn't set yet, and write the page."""
    try:
        state = json.loads(STATE.read_text())
    except (OSError, ValueError):
        state = {"about": "Which models each Par Price round used (no personal data).", "days": {}}
    n = number(today)
    current = None
    try:
        current = json.loads(TODAY_FILE.read_text())
    except (OSError, ValueError):
        pass
    if not current or current.get("date") != today.isoformat():
        cutoff = (today - timedelta(days=30)).isoformat()
        recent = {s for d, slugs in state["days"].items() if d >= cutoff for s in slugs}
        # Five holes plus a sixth product for the Closest to the Pin bonus hole.
        chosen = pick(passing, built, today, recent, HOLES + 1)
        if len(chosen) < HOLES:  # not enough fresh models: allow repeats rather than skip a day
            chosen = pick(passing, built, today, set(), HOLES + 1)
        if len(chosen) >= HOLES:
            current = {"n": n, "date": today.isoformat(), "items": [item(m) for m in chosen[:HOLES]]}
            if len(chosen) > HOLES:
                current["pin"] = item(chosen[HOLES])
            _write(TODAY_FILE, json.dumps(current, ensure_ascii=False, indent=1) + "\n")
            state["days"][today.isoformat()] = [m["slug"] for m in chosen]
            state["days"] = {d: v for d, v in state["days"].items() if d >= cutoff}
            STATE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")
            print(f"Par Price #{n}: " + ", ".join(m["name"] for m in chosen))
    changed = []
    if current and _write(ROOT / "play" / "par-price" / "index.html", page(current.get("n", n), today)):
        changed.append("/play/par-price/")
    if _write(ROOT / "play" / "index.html", hub_page(current.get("n", n) if current else n, current)):
        changed.append("/play/")
    if _write(ROOT / "play" / "leagues" / "index.html", leagues_page()):
        changed.append("/play/leagues/")
    if _write(ROOT / "play" / "league" / "index.html", league_page()):
        changed.append("/play/league/")
    return changed
