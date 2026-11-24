"""Builds the new homepage (John approved the design on 21 Nov 2026) into index.html.

Keeps the page's <head> (title, description, structured data), the site header and footer and
the shared scripts, and replaces everything inside <main> with the new layout. Today's deal,
the drops row and the tile counts are written in from the data files, so the page has real
content for search engines and AI apps; js/home-v2.js and js/app.js refresh them every visit
from the 6-hourly data. Run again any time:  python3 scripts/home_v2_build.py
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "index.html"
esc = html.escape


def gbp(n):
    n = float(n)
    return f"£{n:,.2f}" if n % 1 else f"£{n:,.0f}"


TICK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'


def ico(path):
    return f'<svg class="hm-ico" viewBox="0 0 24 24" aria-hidden="true">{path}</svg>'


def spark(series):
    v = [float(p[1]) for p in series or [] if p[1]]
    if len(v) < 2:
        return ""
    hi, lo = max(v), min(v)
    span = (hi - lo) or 1
    pts = " ".join(f"{i / (len(v) - 1) * 200:.1f},{4 + (hi - x) / span * 20:.1f}" for i, x in enumerate(v))
    return (f'<svg class="hm-spark" viewBox="0 0 200 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="{pts}" '
            'fill="none" stroke="#3cb43c" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>')


def badge(d):
    return f'<span class="hm-badge">{TICK}Lowest in {d["days"]} days</span>' if d.get("lowest") and d.get("days") else ""


def shops(n):
    return f"Compared across {n} UK retailers" if (n or 0) > 1 else "Lowest UK price we track"


def card(d):
    name = re.sub(r"^" + re.escape(d.get("brand") or "") + r"\s+", "", d["name"], flags=re.I) if d.get("brand") else d["name"]
    save = f'<span class="hm-pc-d">{gbp(round(d["save"]))} under its high</span>' if d.get("save") else ""
    return (f'<a class="hm-pc" href="/prices/{esc(d["slug"])}/" data-group="{esc(d["group"])}" data-type="{esc(d["type"])}">'
            f'<span class="hm-pc-im"><img src="{esc(d["image"])}" alt="{esc(d["name"])}" loading="lazy" width="232" height="140">{badge(d)}</span>'
            f'<span class="hm-pc-bd"><span class="hm-pc-br">{esc(d.get("brand") or "")}</span><h3>{esc(name)}</h3>'
            f'<span class="hm-pc-row"><span class="hm-pc-p">{gbp(d["now"])}</span>{save}</span>{spark(d.get("series"))}'
            f'<span class="hm-pc-r">{shops(d.get("retailers"))}</span></span></a>')


def section_between(s, start, end_tag="</section>"):
    i = s.index(start)
    j = s.index(end_tag, i) + len(end_tag)
    return s[i:j]


def build():
    s = INDEX.read_text(encoding="utf-8")
    if 'class="hm"' in s and "hm-hero" in s:
        old_main = s[s.index('<main id="main-content"'):s.index("</main>") + len("</main>")]
        pulse = section_between(old_main, '<section class="section gp-pulse"')
        form = old_main[old_main.index('<form class="gp-alert-form"'):old_main.index("</form>", old_main.index('<form class="gp-alert-form"')) + 7]
    else:
        old_main = s[s.index('<main id="main-content"'):s.index("</main>") + len("</main>")]
        pulse = section_between(old_main, '<section class="section gp-pulse"')
        form = old_main[old_main.index('<form class="gp-alert-form"'):old_main.index("</form>", old_main.index('<form class="gp-alert-form"')) + 7]

    deals = json.loads((ROOT / "data" / "home-deals.json").read_text(encoding="utf-8"))
    stats = json.loads((ROOT / "data" / "curated-views.json").read_text(encoding="utf-8"))["home"]["stats"]
    drops = dict(stats.get("genuineDrops", {}))
    if not all(k in drops for k in ("balls", "bags", "trolleys", "tech")):
        # the refresh adds these (hook_home_stats); until it has run once, count them here the same way
        try:
            prods = json.loads((ROOT / "data" / "products.json").read_text(encoding="utf-8"))
            prods = prods if isinstance(prods, list) else prods.get("products", [])
            trx = re.compile(r"trolley|push ?cart|buggy", re.I)
            tex = re.compile(r"rangefinder|\bgps\b|golf watch|launch monitor|swing analy[sz]er|golf speaker", re.I)
            ok = [q for q in prods if (q.get("priceInsight") or {}).get("verifiedDiscount") and q.get("inStock") is not False]
            drops.setdefault("balls", sum(q.get("category") == "ball" for q in ok))
            drops.setdefault("bags", sum(q.get("category") == "bag" for q in ok))
            drops.setdefault("trolleys", sum(q.get("category") == "accessories" and bool(trx.search(q.get("name") or "")) for q in ok))
            drops.setdefault("tech", sum(q.get("category") == "accessories" and bool(tex.search(q.get("name") or "")) for q in ok))
        except (OSError, ValueError):
            pass
    feat = next((d for d in deals["deals"] if d["slug"] == deals.get("featured")), deals["deals"][0])
    rest = [d for d in deals["deals"] if d is not feat]
    cnt = lambda k: (f'{drops[k]:,} drops' if drops.get(k) else "")
    products = f'{stats.get("products", 0):,}' if stats.get("products") else "70,000+"

    def tile(href, img, pos, name, key, alt, small=False):
        return (f'<a class="hm-tile{" is-sm" if small else ""}" href="{href}"><img src="{img}" alt="{esc(alt)}" loading="lazy" '
                f'width="{300 if small else 600}" height="{300 if small else 600}" style="object-position:{pos}">'
                f'<span><b>{name}</b><small data-drops-short="{key}">{cnt(key)}</small></span></a>')

    chip_tag = ico('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>')
    FC = {"all": '<path d="M4 6h16M4 12h16M4 18h10"/>', "clubs": '<path d="M7 21 17 4"/><path d="M17 4c2 0 3 1 3 3l-3 1"/>',
          "balls": '<circle cx="12" cy="12" r="8"/><circle cx="10" cy="10" r=".6"/><circle cx="13" cy="9" r=".6"/><circle cx="11" cy="13" r=".6"/><circle cx="14.5" cy="12.5" r=".6"/>',
          "tech": '<rect x="7" y="3" width="10" height="18" rx="3"/><path d="M11 17h2"/>', "bags": '<rect x="7" y="7" width="10" height="14" rx="3"/><path d="M10 7V4h4v3"/>'}
    filters = "".join(f'<button type="button" class="hm-fc" data-f="{k}" aria-pressed="{"true" if k == "all" else "false"}"><svg viewBox="0 0 24 24" aria-hidden="true">{p}</svg>{k.title()}</button>' for k, p in FC.items())

    def game(slug, name, line, tag):
        return (f'<a class="hm-game" href="/play/{slug}/" style="background-image:url(/assets/videos/home-{slug}.jpg);background-size:cover">'
                f'<video src="/assets/videos/home-{slug}.mp4" poster="/assets/videos/home-{slug}.jpg" muted loop playsinline preload="none" aria-hidden="true"></video>'
                f'<span><span class="hm-tag">{tag}</span><b>{name}</b><small>{line}</small></span></a>')

    I = {"club": '<path d="M7 21 17 4"/><path d="M17 4c2 0 3 1 3 3l-3 1"/>', "shirt": '<path d="M8 3 4 6l2 4 2-1v12h8V9l2 1 2-4-4-3c-1 2-2.5 3-4 3S9 5 8 3z"/>',
         "bag": '<rect x="5" y="7" width="14" height="14" rx="3"/><path d="M9 7V5a3 3 0 0 1 6 0v2"/>', "book": '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
         "down": '<path d="M3 7l6 6 4-4 8 8"/><path d="M21 11v6h-6"/>', "tool": '<path d="M14.7 6.3a4 4 0 0 0 5 5L12 19l-4 1 1-4 7.7-7.7z"/>',
         "users": '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M16 4a3 3 0 0 1 0 6M21 20c0-2-1-4-3-5"/>',
         "chat": '<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z"/>', "flag": '<path d="M5 21V4"/><path d="M5 4h12l-3 4 3 4H5"/>',
         "pound": '<path d="M17 20H7c2-2 2-4 1-7h6"/><path d="M8 13C6 8 9 4 13 4c2 0 3 1 4 2"/>',
         "pin": '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
         "card": '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
         "star": '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'}
    groups = [("Compare prices", [("club", "/clubs.html", "Golf club prices", "Drivers, irons, wedges, putters"),
                                  ("shirt", "/apparel.html", "Golf clothing prices", "Polos, jackets, shoes"),
                                  ("bag", "/accessories.html", "Accessories prices", "Bags, trolleys, tech, balls"),
                                  ("book", "/prices/", "All UK golf price guides", "Every model, with price history")]),
              ("Find a deal", [("down", "/prices/drops/", "Golf price drops today", "Genuine drops, checked against our history"),
                               ("tool", "/deal-tools.html", "All deal tools", "Price check, best time to buy, fit finder")]),
              ("Beyond prices", [("card", "/play/scorecard/", "Live golf scorecard", "Stableford, better-ball and skins, live"),
                                 ("users", "/societies/", "Society HQ", "Free golf society organiser"),
                                 ("chat", "/play/oracle/", "Crowd Caddie", "Will this price drop? Golfers call it"),
                                 ("star", "/play/peoples-bag/", "The People's Bag", "The bag UK golfers would build"),
                                 ("pound", "/prices/start-golf/", "What golf costs", "Starting golf, priced today"),
                                 ("pin", "/courses/", "UK golf courses", "Every course, and courses near you"),
                                 ("flag", "/play/aces/", "The Ace Register", "Log a hole-in-one, get a certificate")])]
    lgroups = "".join(f'<div><h3 class="hm-gh">{g}</h3><div class="hm-rows">' + "".join(
        f'<a class="hm-rw" href="{h}"><span class="hm-ri">{ico(I[i])}</span><span class="hm-rt"><b>{t}</b><small>{d}</small></span><span class="hm-rc" aria-hidden="true">›</span></a>'
        for i, h, t, d in items) + "</div></div>" for g, items in groups)

    faqs = re.findall(r'<details class="gp-guide-q"><summary>(.*?)</summary><p>(.*?)</p></details>', old_main, re.S)
    if not faqs:
        faqs = re.findall(r'<details class="hm-faq"><summary>(.*?)</summary><p>(.*?)</p></details>', old_main, re.S)
    faq_html = "".join(f'<details class="hm-faq"><summary>{q}</summary><p>{a}</p></details>' for q, a in faqs)

    partners = [("shop.html?source=awin-clickgolf", "Clickgolf", "Clubs and kit"), ("shop.html?source=awin-affordablegolf", "Affordable Golf", "Clubs and kit"),
                ("shop.html?source=awin-majorgolf", "Major Golf Direct", "Clubs and kit"), ("shop.html?source=awin-scottsdalegolf", "Scottsdale Golf", "Clubs and kit"),
                ("shop.html?source=awin-clarkesgolf", "Clarkes Golf", "Clubs and kit"), ("https://tidd.ly/4gfqeMx", "Discount Golf Store", "Clubs and kit"),
                ("shop.html?source=awin-callaway", "Callaway Golf", "Brand store and preowned"), ("shop.html?source=awin-payntr", "PAYNTR Golf", "Golf shoes")]
    ext = ' rel="sponsored noopener" target="_blank"'
    phtml = "".join(f'<a href="{h}"{ext if h.startswith("http") else ""}><b>{n}</b><small>{d}</small></a>' for h, n, d in partners)

    main = f'''<main id="main-content" class="hm">

  <section class="hm-hero" aria-label="Search UK golf prices">
    <div class="hm-hin"><div class="hm-hl">
      <h1><span class="hm-kicker">UK golf price comparison</span>Full swing.<br><em>Not full price.</em></h1>
      <p class="hm-lead">We check <span id="proof-products">{products}</span> golf products across multiple UK retailers every 6 hours, so you never pay more than you need to.</p>
      <form class="hm-search" action="/search.html" method="get" role="search" data-suggest>
        {ico('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}
        <label for="search-input" class="sr-only">Search golf gear</label>
        <input id="search-input" name="q" type="search" placeholder="Clubs, balls, brands…" autocomplete="off" enterkeyhint="search">
        <button type="submit">Search</button>
        <div class="gp-suggest" role="listbox" aria-label="Suggestions" hidden></div>
      </form>
      <div class="hm-chips"><a class="hm-chip is-hot" href="/prices/black-friday/">{chip_tag}Black Friday</a><a class="hm-chip" href="/prices/drivers/">Drivers</a><a class="hm-chip" href="/prices/irons/">Irons</a><a class="hm-chip" href="/prices/golf-balls/">Balls</a><a class="hm-chip" href="/prices/golf-gifts/">Gifts</a></div>
      <ul class="hm-ticks">{"".join(f"<li><i>{TICK}</i>{t}</li>" for t in ["Checked every 6 hours", "No fake countdowns", "Free price-drop alerts", "No sign-up needed"])}</ul>
    </div><div class="hm-hr">
      <div class="hm-deal" id="hm-deal">
        <div class="hm-deal-t"><span class="hm-live" aria-hidden="true"></span>Best deal today<small data-deal="date"></small></div>
        <div class="hm-deal-ph" data-deal="img"><img src="{esc(feat["image"])}" alt="{esc(feat["name"])}" width="300" height="300" fetchpriority="high"></div>
        <div>
          <span data-deal="badge">{badge(feat)}</span>
          <h3 data-deal="name">{esc(feat["name"])}</h3>
          <div class="hm-deal-pr" data-deal="price">{gbp(feat["now"])}</div>
          <div class="hm-deal-sub" data-deal="sub">{shops(feat.get("retailers")).replace("Compared", "compared")}</div>
        </div>
        <a class="hm-deal-btn" href="/prices/{esc(feat["slug"])}/">Compare prices →</a>
      </div>
    </div></div>
  </section>

  <a class="hm-season" id="hm-season" href="/prices/black-friday/" style="background-image:url(/assets/photos/black-friday.jpg)" hidden><span><b>Black Friday: real deals only</b><small>Checked against October prices, so the real ones stand out.</small><em>See what’s really cheaper →</em></span></a>

  <div class="hm-wrap">
  <section class="hm-sec" aria-labelledby="hm-jump">
    <div class="hm-sec-h"><h2 id="hm-jump">Jump straight in</h2></div>
    <div class="hm-tiles">
      {tile("/clubs.html", "/tile-photos/tile-clubs.jpg", "50% 55%", "Clubs", "clubs", "Golf ball on a tee with a driver behind it")}
      {tile("/apparel.html", "/tile-photos/tile-apparel.jpg", "50% 25%", "Apparel", "apparel", "Golfer in a polo shirt on the course")}
      {tile("/accessories.html", "/tile-photos/tile-accessories.jpg", "40% 62%", "Accessories", "accessories", "Golf gloves, balls and a rangefinder")}
    </div>
    <div class="hm-tiles2">
      {tile("/prices/golf-balls/", "/assets/photos/golf-ball-branded.jpg", "50% 50%", "Balls", "balls", "Golf ball on the fairway", True)}
      {tile("/prices/golf-bags/", "/assets/photos/golfbag-with-clubs.jpg", "50% 40%", "Bags", "bags", "Golf bag full of clubs", True)}
      {tile("/prices/electric-trolleys/", "/assets/photos/pushcart-loaded.jpg", "50% 50%", "Trolleys", "trolleys", "Golf trolley on the course", True)}
      {tile("/prices/rangefinders/", "/assets/photos/rangefinder-real.jpg", "40% 50%", "Tech", "tech", "Golfer using a rangefinder", True)}
    </div>
  </section>

  <section class="hm-sec" aria-labelledby="hm-drops">
    <div class="hm-sec-h"><h2 id="hm-drops">Today's genuine drops</h2><a href="/prices/drops/">See all →</a></div>
    <div class="hm-filters" role="group" aria-label="Filter the drops">{filters}</div>
    <div class="hm-rail" id="hm-rail">{"".join(card(d) for d in rest)}</div>
    <p class="hm-note">Every drop is checked against our own price history. No RRP games.</p>
  </section>

  <section class="hm-sec" aria-labelledby="hm-only">
    <div class="hm-kicker" style="margin-bottom:6px">Only on GolfPrice AI</div>
    <div class="hm-sec-h"><h2 id="hm-only">Free games and tools you won't find anywhere else</h2><a href="/play/">All →</a></div>
    <div class="hm-tools">
      <a class="hm-tool is-wide" href="/deal-tools.html"><img src="/assets/photos/tools/deal-tools-banner-wide.jpg" alt="" loading="lazy"><span><span class="hm-tag">DEAL TOOLS</span><b>Check a price, spot a real drop, build a priced bag</b></span></a>
      <a class="hm-tool is-score" href="/play/scorecard/"><img src="/assets/photos/tools/live-scorecard.jpg" alt="" loading="lazy" style="object-position:55% 28%"><span><span class="hm-tag">LIVE SCORECARD</span><b>Your round, live in the group chat</b><small>Stableford, better-ball or skins, worked out from handicaps. No app, no sign-up.</small></span></a>
      <a class="hm-tool" href="/fourball/"><img src="/assets/photos/tools/fourball-square.jpg" alt="" loading="lazy"><span><span class="hm-tag">FOURBALL ALERTS</span><b>Your four-ball, one price watch</b><small>One link in the group chat.</small></span></a>
      <a class="hm-tool" href="/societies/"><img src="/assets/photos/tools/society-hq-square.jpg" alt="" loading="lazy"><span><span class="hm-tag">SOCIETY HQ</span><b>Run your society</b><small>Fixtures, who's in, who's paid.</small></span></a>
    </div>
    <div class="hm-games">
      {game("wild-nine", "Wild Nine", "A new golf course every day", "PLAY DAILY")}
      {game("par-price", "Par Price", "Guess five real prices", "PLAY DAILY")}
      {game("higher-or-lower", "Higher or Lower", "How long can your streak go?", "PLAY NOW")}
    </div>
  </section>

  {pulse}

  <section class="hm-sec" id="alerts">
    <div class="hm-signup">
      <div>
        <h2>Never miss a deal worth hitting.</h2>
        <p>One short Friday email with the week's genuine UK price drops.</p>
        <ul><li>✓ One email a week, zero spam.</li><li>✓ Deals sharper than your short game.</li><li>✓ Unsubscribe faster than a 3-putt.</li></ul>
      </div>
      {form}
    </div>
  </section>

  <section class="hm-sec" id="about-comparison" aria-labelledby="hm-honest">
    <h2 class="hm-h2" id="hm-honest">UK golf price comparison, done honestly</h2>
    <p class="hm-intro">We compare prices across multiple UK retailers so you don't need ten tabs open. Every price is recorded, so we can tell a genuine drop from a made-up "was" price.</p>
    <div class="hm-lgroups">{lgroups}</div>
    <div class="hm-faqs">{faq_html}</div>
  </section>

  <section class="hm-sec" aria-labelledby="hm-partners">
    <h2 class="hm-h2" id="hm-partners">Where our prices come from</h2>
    <p class="hm-note" style="font-size:14px">Every price comes from a real UK golf retailer. Tap a shop to browse it.</p>
    <div class="hm-partners">{phtml}</div>
    <a class="hm-allr" href="/about.html">How we choose retailers →</a>
  </section>
  </div>
  <div class="hm-end"></div>
</main>'''

    i, j = s.index('<main id="main-content"'), s.index("</main>") + len("</main>")
    s = s[:i] + main + s[j:]
    if "home-v2.css" not in s:
        s = s.replace('<link rel="stylesheet" href="/css/fourball.css', '<link rel="stylesheet" href="/css/home-v2.css?v=20261121">\n<link rel="stylesheet" href="/css/fourball.css', 1)
    if "home-v2.js" not in s:
        s = s.replace('<script src="js/home-sections.js"></script>', '<script src="js/home-sections.js"></script>\n<script src="js/home-v2.js?v=20261121" defer></script>', 1)
    INDEX.write_text(s, encoding="utf-8")
    print(f"index.html rebuilt: deal {feat['slug']}, {len(rest)} drops, {len(faqs)} FAQs")


if __name__ == "__main__":
    build()
