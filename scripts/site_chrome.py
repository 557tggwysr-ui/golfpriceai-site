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
        ("Par Price", "New: the daily golf price game.", "/play/",
         '<path d="M6 21V4M6 4l11 4-11 4M3 21h8"></path>'),
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
    }


POPULAR = [
    ("Pro V1", "/shop.html?q=pro+v1"),
    ("Drivers under £300", "/shop.html?category=driver&pricemax=300"),
    ("Left-handed clubs", "/shop.html?group=clubs&q=left+hand"),
    ("Putters", "/shop.html?category=putter"),
    ("Rangefinders", "/shop.html?category=accessories&types=rangefinder&label=Rangefinders"),
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


def header_html():
    m = menu()
    items = []
    for key in ("clubs", "apparel", "accessories"):
        sec = m[key]
        links = "".join(f'<a href="{_esc(u)}">{_esc(t)}</a>' for t, u in sec["items"])
        extra = ""
        if sec["extra"]:
            extra = '<div class="gp-drop-sep"></div>' + "".join(f'<a href="{_esc(u)}">{_esc(t)}</a>' for t, u in sec["extra"])
        cols = " gp-drop-cols" if len(sec["items"]) > 9 else ""
        items.append(f"""
    <div class="gp-nav-item" data-section="{key}">
      <a href="{sec['hub']}" class="gp-nav-link" aria-haspopup="true" aria-expanded="false">{sec['label']}{_svg(ICON_CHEVRON, 12, 'currentColor', 2.6)}</a>
      <div class="gp-drop{cols}">
        <div class="gp-drop-links">{links}</div>{extra}
        <a class="gp-drop-all" href="{sec['hub']}">{sec['all']} &rarr;</a>
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

    return f"""<header class="gp-header" id="gp-header">
  <div class="gp-header-inner">
    <a href="/" class="gp-logo">Golf<span>Price</span> AI</a>
    <nav class="gp-nav" aria-label="Main">{''.join(items)}
    </nav>
    <div class="gp-actions">
      <button type="button" class="gp-icon-btn gp-search-btn" aria-label="Search" aria-expanded="false" aria-controls="gp-search-panel">{_svg(ICON_SEARCH, 20)}</button>
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
    for key in ("clubs", "apparel", "accessories"):
        sec = m[key]
        links = "".join(f'<a href="{_esc(u)}">{_esc(t)}</a>' for t, u in sec["items"] + sec["extra"])
        sections.append(f"""
      <div class="gp-acc">
        <button type="button" class="gp-acc-btn" aria-expanded="false">{sec['label']}{_svg(ICON_PLUS, 18, 'currentColor', 2.4)}</button>
        <div class="gp-acc-body" hidden>{links}<a class="gp-acc-all" href="{sec['hub']}">{sec['all']} &rarr;</a></div>
      </div>""")
    tools = "".join(f'<a href="{u}"><span>{_esc(n)}</span><small>{_esc(line)}</small></a>' for n, line, u, _ in m["tools"])
    sections.append(f"""
      <div class="gp-acc">
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
      <a class="gp-menu-top" href="/shop.html">Shop all deals</a>{''.join(sections)}
      <a class="gp-menu-top" href="/about.html">About GolfPrice AI</a>
  </nav>
  <div class="gp-menu-foot"><a href="/#alerts" class="gp-alerts gp-alerts-wide">{_svg(ICON_BELL, 17)}<span>Get deal alerts</span></a></div>
</div>"""


# ---------------------------------------------------------------- footer
def footer_html():
    m = menu()
    cols = [
        ("Shop", [("All deals", "/shop.html"), ("Clubs", "/clubs.html"), ("Apparel", "/apparel.html"),
                  ("Accessories", "/accessories.html"), ("Preowned and trade-ins", "/shop.html?source=awin-callawaypreowned"),
                  ("Find Your Fit", "/find-your-fit.html")]),
        ("Deal Tools", [("All deal tools", "/deal-tools.html")] + [(n, u) for n, _, u, _ in m["tools"] if u != "/find-your-fit.html"]),
        ("Price guides", [("Drivers", "/prices/drivers/"), ("Irons", "/prices/irons/"),
                          ("Putters", "/prices/putters/"), ("Golf balls", "/prices/golf-balls/"),
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
PAGES = ["index.html", "search.html", "shop.html", "clubs.html", "apparel.html", "accessories.html", "deal-tools.html", "about.html", "faq.html",
         "back-in-stock.html", "best-time-to-buy.html", "build-your-bag.html", "complete-the-kit.html",
         "complete-the-look.html", "fairway-index.html", "find-your-fit.html", "receipts.html",
         "404.html", "price-check.html", "ai.html", "alerts-confirmed.html", "alerts-unsubscribed.html",
         "legal/cookies.html", "legal/privacy-policy.html"]

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
