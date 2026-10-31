"""The site-wide header, phone menu and footer, in one place.

Every page carries the same header and footer as plain HTML (not drawn by
JavaScript), so search engines and AI crawlers see every link. This file is
the single source for that HTML:

  * Run it by hand after changing the menu, and it rewrites the header and
    footer on every page listed in PAGES:  python scripts/site_chrome.py
  * Page generators (model pages, price guides) import header_html() and
    footer_html() so new pages always match.

All links start with "/" so the same HTML works in sub-folders (legal/,
and later models/, guides/).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- icons
def _svg(path, size=20, stroke="currentColor", width=2.2):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="{stroke}" '
            f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{path}</svg>')

ICON_SEARCH = '<circle cx="11" cy="11" r="7"></circle><path d="M20 20l-4-4"></path>'
ICON_BELL = '<path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 003.4 0"></path>'
ICON_MENU = '<path d="M4 7h16M4 12h16M4 17h16"></path>'
ICON_CLOSE = '<path d="M6 6l12 12M18 6L6 18"></path>'
ICON_CHEVRON = '<path d="M6 9l6 6 6-6"></path>'
ICON_PLUS = '<path d="M12 5v14M5 12h14"></path>'
ICON_LOCKER = '<path d="M5 3h14v18H5z"></path><path d="M12 3v18M9 8h.01M15 8h.01M8 12h2M14 12h2"></path>'

# ---------------------------------------------------------------- menu data
def _shop(category, label=None, types=None):
    url = f"/shop.html?category={category}"
    if types:
        url += "&types=" + ",".join(types)
    if label:
        url += "&label=" + label.replace("&", "%26").replace(" ", "+")
    return url


def _groups():
    """Apparel / accessories sub-groups come from js/groups-config.js, so the
    header always matches the hub pages."""
    text = (ROOT / "js" / "groups-config.js").read_text(encoding="utf-8")
    groups = {}
    for hub in ("apparel", "accessories"):
        block = re.search(hub + r":\s*\[(.*?)\n  \]", text, re.S).group(1)
        items = []
        for obj in re.finditer(r"\{(.*?)\n    \}", block, re.S):
            body = obj.group(1)
            label = re.search(r'label:\s*"([^"]+)"', body).group(1)
            cat = re.search(r'category:\s*"([^"]+)"', body)
            types = re.search(r"types:\s*\[([^\]]*)\]", body)
            types = [t.strip().strip('"') for t in types.group(1).split(",") if t.strip()] if types else []
            items.append((label, _shop(cat.group(1) if cat else hub, label, types)))
        groups[hub] = items
    return groups


def menu():
    g = _groups()
    clubs = [
        ("Drivers", _shop("driver", "Drivers")),
        ("Fairway woods", _shop("wood", "Fairway Woods")),
        ("Hybrids", _shop("hybrid", "Hybrids")),
        ("Irons", _shop("irons", "Irons")),
        ("Wedges", _shop("wedge", "Wedges")),
        ("Putters", _shop("putter", "Putters")),
        ("Package sets", "/prices/golf-package-sets/"),
        ("Junior golf sets", "/prices/junior-golf-sets/"),
    ]
    clubs_extra = [
        ("Find Your Fit", "/find-your-fit.html"),
        ("Preowned and trade-ins", "/shop.html?source=awin-callawaypreowned"),
    ]
    apparel = g["apparel"] + [("Golf shoes", "/shop.html?category=shoes")]
    acc = g["accessories"]
    # Most-wanted first; the long tail follows in config order.
    first = ["Golf Balls", "GPS Watches", "Rangefinders", "Push Carts", "Gloves", "Launch Monitors & Simulators"]
    acc_sorted = [a for f in first for a in acc if a[0] == f]
    acc_sorted.insert(1, ("Golf bags", "/shop.html?category=bag"))
    acc_sorted += [a for a in acc if a[0] not in first]
    tools = [
        ("Assemble Your Arsenal", "Build a bag and get a priced shopping list.", "/build-your-bag.html",
         '<path d="M6 7h12l-1 14H7L6 7zM9 7V5a3 3 0 016 0v2"></path>'),
        ("Show Us The Receipts", "This week's biggest genuine price drops, with proof.", "/receipts.html",
         '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6"></path>'),
        ("Is This A Good Price?", "Check any price against our own history.", "/price-check.html",
         '<path d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'),
        ("Price Drops Today", "Genuine drops only, updated every 6 hours.", "/prices/drops/",
         '<path d="M3 7l6 6 4-4 8 8M21 11v6h-6"></path>'),
        ("UK Golf Demand Index", "What UK golfers want right now.", "/demand/",
         '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>'),
        ("Fourball Alerts", "Price alerts for your whole four-ball.", "/fourball/",
         '<path d="M8 8m-3 0a3 3 0 106 0 3 3 0 10-6 0M16 8m-3 0a3 3 0 106 0 3 3 0 10-6 0M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 14.5c1-.3 2-.5 4-.5 3.3 0 6 2.7 6 6"></path>'),
        ("GolfPrice AI In ChatGPT & Claude", "Ask your AI assistant for live UK prices.", "/ai.html",
         '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9L18 15z"></path>'),
        ("Complete The Look", "Outfits matched by colour, priced piece by piece.", "/complete-the-look.html",
         '<path d="M8.5 3L4 5.5l1.8 4.2L8 8.8V21h8V8.8l2.2.9L20 5.5 15.5 3c-.7 1.6-2 2.4-3.5 2.4S9.2 4.6 8.5 3z"></path>'),
        ("Best Time To Buy", "Which prices hold steady and which ones swing.", "/best-time-to-buy.html",
         '<path d="M12 7v5l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'),
        ("Find Your Fit", "Eight quick taps to the flex and clubs that suit you.", "/find-your-fit.html",
         '<path d="M12 3v18M3 12h18M12 12m-5 0a5 5 0 1010 0 5 5 0 10-10 0"></path>'),
        ("Complete The Kit", "Gear that goes together, at today's lowest prices.", "/complete-the-kit.html",
         '<path d="M4 7h16v13H4zM9 7V4h6v3M4 12h16"></path>'),
        ("Back In Stock Radar", "What's sold out, and what sells out fast.", "/back-in-stock.html",
         '<path d="M12 12m-2 0a2 2 0 104 0 2 2 0 10-4 0M5 12a7 7 0 0114 0M2 12a10 10 0 0120 0"></path>'),
        ("The Fairway Index", "Are golf prices rising or falling, by category.", "/fairway-index.html",
         '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"></path>'),
        ("Price guides", "Every model's lowest UK price, with its history.", "/prices/",
         '<path d="M4 19V5M4 19h16M8 15l3-4 3 2 5-6"></path>'),
    ]
    return {
        "clubs": {"label": "Clubs", "hub": "/clubs.html", "all": "All clubs", "items": clubs, "extra": clubs_extra},
        "apparel": {"label": "Apparel", "hub": "/apparel.html", "all": "All apparel", "items": apparel, "extra": []},
        "accessories": {"label": "Accessories", "hub": "/accessories.html", "all": "All accessories", "items": acc_sorted, "extra": []},
        "tools": tools,
        # Play: the games area (its hub is /play/, "The Clubhouse").
        "play": [
            ("The Clubhouse", "All the games, your leagues and the Hall of Fame.", "/play/",
             '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5"></path>'),
            ("Par Price", "Today’s golf price game. New round every morning.", "/play/par-price/",
             '<path d="M6 21V4M6 4l11 4-11 4M3 21h8"></path>'),
            ("Higher or Lower", "Is this putter dearer than that driver? Daily run, then free play.", "/play/higher-or-lower/",
             '<path d="M7 14l5-5 5 5M7 20l5-5 5 5M7 8l5-5 5 5"></path>'),
            ("Leagues", "Take on your mates. One link for the group chat.", "/play/leagues/",
             '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM7 6H4a3 3 0 003 4M17 6h3a3 3 0 01-3 4"></path>'),
            ("The Bag Draft", "Fantasy golf kit. The Black Friday Open starts 1 November.", "/play/draft/",
             '<path d="M8 7h8l-1 14H9L8 7zM10 7V4h4v3M8 11h8"></path>'),
            ("The Ace Register", "Had a hole-in-one? Get it on record, with a certificate.", "/play/aces/",
             '<path d="M12 21V5M12 5l7 3-7 3M8 21h8M12 21a4 1.2 0 100-.1"></path>'),
            ("The Oracle board", "Crowd Caddie: call where golf prices go next.", "/play/oracle/",
             '<path d="M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 7v5l3 3"></path>'),
            ("Locker Room", "Your champion bags, bag tags and record.", "/play/locker/",
             '<path d="M6 3h12v18H6zM12 3v18M9 7h1M9 10h1M14 7h1M14 10h1M10 15v2M14 15v2"></path>'),
        ],
        # Improve: handicap calculators (hub /improve/).
        "improve": [
            ("Improve", "Every calculator, plus handicap allowances at a glance.", "/improve/",
             '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"></path>'),
            ("Handicap index calculator", "Your best 8 of your last 20, the WHS way.", "/improve/handicap-index-calculator/",
             '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"></path>'),
            ("Course handicap calculator", "How many shots you get on any course and tee.", "/improve/course-handicap-calculator/",
             '<path d="M6 21V4M6 4l11 4-11 4M3 21h8"></path>'),
            ("Playing handicap calculator", "Stableford, fourball, matchplay or foursomes.", "/improve/playing-handicap-calculator/",
             '<path d="M8 8m-3 0a3 3 0 106 0 3 3 0 10-6 0M16 8m-3 0a3 3 0 106 0 3 3 0 10-6 0M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M12 14.5c1-.3 2-.5 4-.5 3.3 0 6 2.7 6 6"></path>'),
            ("What do I need to shoot?", "The score that brings your handicap down.", "/improve/what-do-i-need-to-shoot/",
             '<path d="M12 12m-9 0a9 9 0 1018 0 9 9 0 10-18 0M12 12m-5 0a5 5 0 1010 0 5 5 0 10-10 0M12 12m-1 0a1 1 0 102 0 1 1 0 10-2 0"></path>'),
        ],
        # Courses: every UK golf course (hub /courses/).
        "courses": [
            ("All UK golf courses", "Search 2,800+ courses by name or town.", "/courses/",
             '<path d="M11 11m-7 0a7 7 0 1014 0 7 7 0 10-14 0M21 21l-5-5"></path>'),
            ("Courses near me", "The courses closest to you, in miles.", "/courses/#near",
             '<path d="M12 22s7-6.5 7-12a7 7 0 10-14 0c0 5.5 7 12 7 12zM12 10m-2.5 0a2.5 2.5 0 105 0 2.5 2.5 0 10-5 0"></path>'),
            ("The Ace Register", "Every UK hole-in-one, course by course.", "/play/aces/",
             '<path d="M6 21V4M6 4l11 4-11 4M3 21h8"></path>'),
        ],
        # Societies: Society HQ, free tools for golf societies (hub /societies/).
        "societies": [
            ("Society HQ", "The free golf society organiser.", "/societies/",
             '<path d="M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5"></path>'),
            ("Run your golf society", "Fixtures, sign-ups, who’s paid and a waiting list.", "/societies/hq/",
             '<path d="M4 5h16v15H4zM4 10h16M9 3v4M15 3v4M8 14h3M8 17h6"></path>'),
            ("Find a Society", "Golf societies open to new members near you.", "/societies/find/",
             '<path d="M11 11m-7 0a7 7 0 1014 0 7 7 0 10-14 0M21 21l-5-5"></path>'),
            ("Golf Society Awards", "Award cards, a slideshow and prizes winners pick.", "/societies/awards/",
             '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4z"></path>'),
        ],
    }


POPULAR = [
    ("Golf gifts", "/prices/golf-gifts/"),
    ("Black Friday", "/prices/black-friday/"),
    ("Pro V1", "/shop.html?q=pro+v1"),
    ("Drivers under £300", "/shop.html?category=driver&pricemax=300"),
    ("Left-handed clubs", "/shop.html?group=clubs&q=left+hand"),
    ("Starting golf", "/prices/start-golf/"),
]


def _esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


# ---------------------------------------------------------------- header
def _search_form(form_id, placeholder="Search clubs, balls, brands...", button=True, extra_class=""):
    btn = '<button type="submit" class="gp-search-go">Find Deals</button>' if button else ""
    return f"""<form class="gp-search {extra_class}" action="/search.html" method="get" role="search" data-suggest>
      {_svg(ICON_SEARCH, 20, "#5b665f")}
      <label for="{form_id}" class="sr-only">Search golf gear</label>
      <input id="{form_id}" name="q" type="search" placeholder="{placeholder}" autocomplete="off" enterkeyhint="search">
      {btn}
      <div class="gp-suggest" role="listbox" aria-label="Suggestions" hidden></div>
    </form>"""


def popular_chips_html(label=True):
    chips = "".join(f'<a href="{_esc(u)}" class="gp-chip">{_esc(t)}</a>' for t, u in POPULAR)
    lead = '<span class="gp-chips-label">Popular:</span>' if label else ""
    return f'<div class="gp-chips">{lead}{chips}</div>'


SHOP_PHOTOS = {"clubs": ("/tile-photos/tile-clubs.jpg", "50% 55%", "Drivers, irons, putters, sets"),
               "apparel": ("/tile-photos/tile-apparel.jpg", "50% 25%", "Polos, layers, waterproofs, shoes"),
               "accessories": ("/tile-photos/tile-accessories.jpg", "40% 62%", "Balls, bags, GPS, rangefinders")}
# The Shop side panel: quick ways in that aren't a category.
SHOP_QUICK = [("Starting golf? Your first kit", "/prices/start-golf/"), ("Price drops today", "/prices/drops/"), ("Price guides", "/prices/"), ("Brands A to Z", "/prices/brands/"),
              ("Black Friday golf deals", "/prices/black-friday/"), ("Golf gift finder", "/prices/golf-gifts/")]


def shop_short(m=None):
    """The eight links each Shop column shows (the hub has the rest)."""
    m = m or menu()
    def pick(key, labels):
        have = dict(m[key]["items"] + m[key]["extra"])
        return [(new, have[old]) if old in have else (new, old) for old, new in labels]
    return {
        "clubs": pick("clubs", [("Drivers", "Drivers"), ("Irons", "Irons"), ("Fairway woods", "Fairway woods"),
                                ("Wedges", "Wedges"), ("Hybrids", "Hybrids"), ("Putters", "Putters"),
                                ("Package sets", "Package sets"), ("Preowned and trade-ins", "Preowned")]),
        "apparel": pick("apparel", [("Polo Tees", "Polos and tops"), ("Bottoms", "Trousers"), ("Outerwear", "Outerwear"),
                                    ("Shorts & Skorts", "Shorts"), ("Golf shoes", "Shoes"), ("Headwear & Extras", "Headwear"),
                                    ("Golf Suits", "Waterproof suits"), ("/complete-the-look.html", "Outfit builder")]),
        "accessories": pick("accessories", [("Golf Balls", "Golf balls"), ("Rangefinders", "Rangefinders"),
                                            ("Golf bags", "Golf bags"), ("GPS Watches", "GPS watches"), ("Gloves", "Gloves"),
                                            ("Push Carts", "Trolleys"), ("Launch Monitors & Simulators", "Launch monitors"),
                                            ("Headcovers", "Headcovers")]),
    }


def header_html():
    m = menu()
    items = []
    short = shop_short(m)
    cols = []
    for key in ("clubs", "apparel", "accessories"):
        sec = m[key]
        img, pos, _ = SHOP_PHOTOS[key]
        links = "".join(f'<a href="{_esc(u)}">{_esc(t)}</a>' for t, u in short[key])
        cols.append(f"""
        <div class="gp-shop-col">
          <a class="gp-shop-photo" href="{sec['hub']}"><img src="{img}" alt="" width="1000" height="1000" loading="lazy" style="object-position:{pos}"><span class="gp-shop-pill" data-drops="{key}" hidden></span><b>{sec['label']}</b></a>
          <div class="gp-shop-links">{links}</div>
          <a class="gp-shop-all" href="{sec['hub']}">{sec['all']} &rarr;</a>
        </div>""")
    quick = "".join(f'<a href="{u}">{_esc(t)}<span aria-hidden="true">&rarr;</span></a>' for t, u in SHOP_QUICK)
    items.append(f"""
    <div class="gp-nav-item" data-section="shop">
      <a href="/shop/" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Shop{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-shop-drop">{''.join(cols)}
        <div class="gp-shop-side">
          <span class="gp-shop-kick">QUICK WAYS IN</span>
          <p>Every price checked every 6 hours across multiple UK retailers. Only genuine drops get flagged.</p>
          <div class="gp-shop-quick">{quick}</div>
          <a class="gp-shop-cta" href="/shop/">Explore the whole shop</a>
        </div>
      </div>
    </div>""")
    tools = "".join(f"""
          <a href="{u}" class="gp-tool"><span class="gp-tool-icon">{_svg(icon, 20, '#2f8a1f', 2)}</span><span class="gp-tool-text"><strong>{_esc(n)}</strong><span>{_esc(line)}</span></span></a>"""
                    for n, line, u, icon in m["tools"])
    items.append(f"""
    <div class="gp-nav-item" data-section="tools">
      <a href="/deal-tools.html" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Deal Tools{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-mega">
        <div class="gp-tools">{tools}
        </div>
        <div class="gp-mega-foot"><span>Every tool runs on prices we track ourselves, every 6 hours.</span><a href="/deal-tools.html">All deal tools &rarr;</a></div>
      </div>
    </div>""")

    play = "".join(f"""
          <a href="{u}" class="gp-tool"><span class="gp-tool-icon">{_svg(icon, 20, '#2f8a1f', 2)}</span><span class="gp-tool-text"><strong>{_esc(n)}</strong><span>{_esc(line)}</span></span></a>"""
                   for n, line, u, icon in m["play"])
    items.append(f"""
    <div class="gp-nav-item" data-section="play">
      <a href="/play/" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Play{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-mega gp-play-drop">
        <div class="gp-tools gp-tools-1">{play}
        </div>
        <div class="gp-mega-foot"><span>Free games on real UK prices.</span><a href="/play/">The Clubhouse &rarr;</a></div>
      </div>
    </div>""")

    imp = "".join(f"""
          <a href="{u}" class="gp-tool"><span class="gp-tool-icon">{_svg(icon, 20, '#2f8a1f', 2)}</span><span class="gp-tool-text"><strong>{_esc(n)}</strong><span>{_esc(line)}</span></span></a>"""
                  for n, line, u, icon in m["improve"])
    items.append(f"""
    <div class="gp-nav-item" data-section="improve">
      <a href="/improve/" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Improve{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-mega gp-play-drop">
        <div class="gp-tools gp-tools-1">{imp}
        </div>
        <div class="gp-mega-foot"><span>Free, WHS-based, nothing saved.</span><a href="/improve/">All calculators &rarr;</a></div>
      </div>
    </div>""")

    socs = "".join(f"""
          <a href="{u}" class="gp-tool"><span class="gp-tool-icon">{_svg(icon, 20, '#2f8a1f', 2)}</span><span class="gp-tool-text"><strong>{_esc(n)}</strong><span>{_esc(line)}</span></span></a>"""
                   for n, line, u, icon in m["societies"])
    items.append(f"""
    <div class="gp-nav-item" data-section="societies">
      <a href="/societies/" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Societies{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-mega gp-play-drop">
        <div class="gp-tools gp-tools-1">{socs}
        </div>
        <div class="gp-mega-foot"><span>Free for every UK golf society. No sign-up.</span><a href="/societies/">Society HQ &rarr;</a></div>
      </div>
    </div>""")

    crs = "".join(f"""
          <a href="{u}" class="gp-tool"><span class="gp-tool-icon">{_svg(icon, 20, '#2f8a1f', 2)}</span><span class="gp-tool-text"><strong>{_esc(n)}</strong><span>{_esc(line)}</span></span></a>"""
                  for n, line, u, icon in m["courses"])
    items.append(f"""
    <div class="gp-nav-item" data-section="courses">
      <a href="/courses/" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">Courses<span class="gp-nav-new">New</span>{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop gp-mega gp-play-drop">
        <div class="gp-tools gp-tools-1">{crs}
        </div>
        <div class="gp-mega-foot"><span>Course list from OpenStreetMap.</span><a href="/courses/">All courses &rarr;</a></div>
      </div>
    </div>""")

    return f"""<header class="gp-header" id="gp-header">
  <div class="gp-header-inner">
    <a href="/" class="gp-logo">Golf<span>Price</span> AI</a>
    <nav class="gp-nav" aria-label="Main">{''.join(items)}
    </nav>
    <div class="gp-actions">
      <button type="button" class="gp-icon-btn gp-search-btn" aria-label="Search" aria-expanded="false" aria-controls="gp-search-panel">{_svg(ICON_SEARCH, 20)}</button>
      <a href="/play/my-clubhouse/" class="gp-mine" aria-label="My Clubhouse">{_svg(ICON_LOCKER, 18)}<span>My Clubhouse</span></a>
      <a href="/#alerts" class="gp-alerts" aria-label="Deal alerts">{_svg(ICON_BELL, 16)}<span>Deal alerts</span></a>
      <button type="button" class="gp-icon-btn gp-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="gp-menu">{_svg(ICON_MENU, 22)}</button>
    </div>
  </div>
  <div class="gp-search-panel" id="gp-search-panel" hidden>
    <div class="gp-search-panel-inner">
    {_search_form("gp-header-q")}
    {popular_chips_html()}
    </div>
  </div>
</header>
{menu_html(m)}"""


def menu_html(m=None):
    m = m or menu()
    sections = []
    rows = "".join(f"""<a class="gp-shop-row" href="{m[k]['hub']}"><img src="{SHOP_PHOTOS[k][0]}" alt="" width="56" height="56" loading="lazy" style="object-position:{SHOP_PHOTOS[k][1]}"><span><b>{m[k]['label']}</b><small>{SHOP_PHOTOS[k][2]}</small></span><em data-drops-short="{k}" hidden></em></a>"""
                   for k in ("clubs", "apparel", "accessories"))
    chips = "".join(f'<a href="{u}">{_esc(t)}</a>' for t, u in SHOP_QUICK[:4])
    sections.append(f"""
      <div class="gp-acc" data-section="shop">
        <button type="button" class="gp-acc-btn" aria-expanded="false">Shop{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-shop" hidden>{rows}<div class="gp-shop-chips">{chips}</div><a class="gp-acc-all" href="/shop/">Explore the whole shop &rarr;</a></div>
      </div>""")
    tools = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["tools"])
    play = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["play"])
    sections.append(f"""
      <div class="gp-acc" data-section="play">
        <button type="button" class="gp-acc-btn" aria-expanded="false">Play{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-tools" hidden>{play}<a class="gp-acc-all" href="/play/">The Clubhouse &rarr;</a></div>
      </div>""")
    imp = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["improve"][1:])
    sections.append(f"""
      <div class="gp-acc" data-section="improve">
        <button type="button" class="gp-acc-btn" aria-expanded="false">Improve{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-tools" hidden>{imp}<a class="gp-acc-all" href="/improve/">All calculators &rarr;</a></div>
      </div>""")
    socs = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["societies"])
    sections.append(f"""
      <div class="gp-acc" data-section="societies">
        <button type="button" class="gp-acc-btn" aria-expanded="false">Societies{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-tools" hidden>{socs}<a class="gp-acc-all" href="/societies/">Society HQ &rarr;</a></div>
      </div>""")
    crs = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["courses"])
    sections.append(f"""
      <div class="gp-acc" data-section="courses">
        <button type="button" class="gp-acc-btn" aria-expanded="false"><span>Courses <span class="gp-nav-new">New</span></span>{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-tools" hidden>{crs}<a class="gp-acc-all" href="/courses/">All courses &rarr;</a></div>
      </div>""")
    sections.append(f"""
      <div class="gp-acc" data-section="tools">
        <button type="button" class="gp-acc-btn" aria-expanded="false">Deal Tools{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body gp-acc-tools" hidden>{tools}<a class="gp-acc-all" href="/deal-tools.html">All deal tools &rarr;</a></div>
      </div>""")
    return f"""<div class="gp-menu" id="gp-menu" role="dialog" aria-modal="true" aria-label="Menu" hidden>
  <div class="gp-menu-head">
    <a href="/" class="gp-logo">Golf<span>Price</span> AI</a>
    <button type="button" class="gp-icon-btn gp-menu-close" aria-label="Close menu">{_svg(ICON_CLOSE, 22)}</button>
  </div>
  <div class="gp-menu-search">{_search_form("gp-menu-q", button=False)}</div>
  <nav class="gp-menu-nav" aria-label="Main">
      <a class="gp-menu-top" href="/play/my-clubhouse/">My Clubhouse</a>
      <a class="gp-menu-top" href="/shop.html">All deals</a>{''.join(sections)}
      <a class="gp-menu-top" href="/about.html">About GolfPrice AI</a>
  </nav>
  <div class="gp-menu-foot"><a href="/#alerts" class="gp-alerts gp-alerts-wide">{_svg(ICON_BELL, 17)}<span>Get deal alerts</span></a></div>
</div>"""


# ---------------------------------------------------------------- footer
def footer_html():
    m = menu()
    cols = [
        ("Shop", [("The Shop", "/shop/"), ("All deals", "/shop.html"), ("Clubs", "/clubs.html"), ("Apparel", "/apparel.html"),
                  ("Accessories", "/accessories.html"), ("Preowned and trade-ins", "/shop.html?source=awin-callawaypreowned"),
                  ("Find Your Fit", "/find-your-fit.html"), ("Golf gift finder", "/prices/golf-gifts/"),
                  ("Christmas golf gifts", "/prices/christmas/"), ("Black Friday golf deals", "/prices/black-friday/")]),
        ("Deal Tools", [("All deal tools", "/deal-tools.html")] + [(n, u) for n, _, u, _ in m["tools"] if u != "/find-your-fit.html"]),
        ("Play", [("My Clubhouse", "/play/my-clubhouse/")] + [(n, u) for n, _, u, _ in m["play"]] + [("UK Golf Demand Index", "/demand/")]),
        ("Societies", [(n, u) for n, _, u, _ in m["societies"]] + [("Handicap calculators", "/improve/"), ("Course handicap calculator", "/improve/course-handicap-calculator/"), ("UK golf courses", "/courses/")]),
        ("Price guides", [("Drivers", "/prices/drivers/"), ("Irons", "/prices/irons/"),
                          ("Putters", "/prices/putters/"), ("Golf balls", "/prices/golf-balls/"), ("Golf gloves", "/prices/golf-gloves/"),
                          ("GPS watches", "/prices/gps-watches/"), ("Electric trolleys", "/prices/electric-trolleys/"),
                          ("Package sets", "/prices/golf-package-sets/"), ("Golf shoes", "/prices/golf-shoes/"),
                          ("All price guides", "/prices/")]),
        ("About", [("About us", "/about.html"), ("How we track prices", "/about.html"), ("FAQ", "/faq.html"), ("RSS feed", "/data/deals-feed.xml"),
                   ("Privacy policy", "/legal/privacy-policy.html"), ("Cookie policy", "/legal/cookies.html")]),
    ]
    col_html = "".join(f"""
      <div class="gp-foot-col">
        <button type="button" class="gp-foot-head" aria-expanded="false">{t}{_svg(ICON_PLUS, 16, 'currentColor', 2.4)}</button>
        <div class="gp-foot-links">{''.join(f'<a href="{_esc(u)}">{_esc(n)}</a>' for n, u in links)}</div>
      </div>""" for t, links in cols)
    return f"""<footer class="gp-footer">
  <div class="gp-footer-inner">
    <div class="gp-foot-grid">
      <div class="gp-foot-brand">
        <a href="/" class="gp-logo">Golf<span>Price</span> AI</a>
        <p>Real UK golf prices, checked every 6 hours. No fake discounts, no countdown timers.</p>
        <a href="/#alerts" class="gp-alerts">{_svg(ICON_BELL, 16)}<span>Get deal alerts</span></a>
      </div>{col_html}
    </div>
    <div class="gp-foot-legal">
      <span>GolfPrice AI is reader-supported. When you buy through our links we may earn a commission at no extra cost to you. As an Amazon Associate, we earn from qualifying purchases. Prices are indicative; always check the retailer's page before buying.</span>
      <span class="gp-foot-copy">&copy; <span id="year">2026</span> GolfPrice AI</span>
    </div>
  </div>
</footer>"""


# ---------------------------------------------------------------- page rewriting
PAGES = ["index.html", "search.html", "shop.html", "shop/index.html", "clubs.html", "apparel.html", "accessories.html", "deal-tools.html", "about.html", "faq.html",
         "back-in-stock.html", "best-time-to-buy.html", "build-your-bag.html", "complete-the-kit.html",
         "complete-the-look.html", "fairway-index.html", "find-your-fit.html", "receipts.html",
         "404.html", "price-check.html", "ai.html", "alerts-confirmed.html", "alerts-unsubscribed.html",
         "legal/cookies.html", "legal/privacy-policy.html",
         "improve/index.html", "improve/handicap-index-calculator/index.html", "improve/course-handicap-calculator/index.html",
         "improve/playing-handicap-calculator/index.html", "improve/what-do-i-need-to-shoot/index.html"]

HEADER_RE = re.compile(r"<header class=\"(?:site-header|gp-header)\".*?</header>\s*(?:<div class=\"gp-menu\".*?</nav>\s*<div class=\"gp-menu-foot\">.*?</div>\s*</div>)?", re.S)
FOOTER_RE = re.compile(r"<footer[ >].*?</footer>", re.S)


def apply(page_path):
    html = page_path.read_text(encoding="utf-8")
    depth = "../" * (len(page_path.relative_to(ROOT).parts) - 1)
    new = HEADER_RE.sub(lambda _: header_html(), html, count=1)
    new = FOOTER_RE.sub(lambda _: footer_html(), new, count=1)
    # Shared stylesheet and script, once each.
    if "css/site.css" not in new:
        new = new.replace("</head>", f'<link rel="stylesheet" href="/css/site.css">\n</head>', 1)
    new = re.sub(r'\s*<script src="(?:\.\./)?js/nav-mobile\.js"></script>', "", new)
    if "js/site.js" not in new:
        new = new.replace("</body>", '<script src="/js/site.js" defer></script>\n</body>', 1)
    page_path.write_text(new, encoding="utf-8")
    return new != html


if __name__ == "__main__":
    targets = sys.argv[1:] or PAGES
    for rel in targets:
        changed = apply(ROOT / rel)
        print(("updated " if changed else "unchanged ") + rel)
