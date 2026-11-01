"""Buying guides on the price pages Google already shows us for (Nov 2026):
launch monitors, golf gloves, Black Friday, golf gifts, Odyssey putters and
Motocaddy.

Each page gets a guide written around what golfers search for, a "best for…"
table worked out from today's live prices, and more questions answered (added
to the page's FAQ markup). Run at the end of every price build, after the pages
are written: the guide sits between <!--guide--> markers, so it's replaced,
never stacked, and if a page's layout changes the guide is simply skipped.

Every number comes from our own tracked prices; the advice is general, with no
claims about any one product that we haven't checked.
"""
import json
import re
from datetime import date, timedelta
from html import escape as e
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
START, END = "<!--guide-->", "<!--/guide-->"


def money(n):
    return f"£{n:,.2f}".replace(".00", "") if n < 100 else f"£{n:,.0f}"


def link(m, built):
    return f"/prices/{m['slug']}/" if m["slug"] in built else None


def name_html(m, built):
    u = link(m, built)
    return f'<a href="{u}">{e(m["name"])}</a>' if u else e(m["name"])


def saving(m):
    hi = m.get("high") or 0
    return hi - m["minPrice"] if hi and hi > m["minPrice"] else 0


def label(m):
    return (m.get("verdict") or {}).get("label") or "tracking"


def picks(ms, built, extra=()):
    """'Best for…' rows from live prices: [(what, model, why)]."""
    if not ms:
        return []
    rows = []
    cheap = min(ms, key=lambda m: m["minPrice"])
    rows.append(("Lowest price today", cheap, f"{money(cheap['minPrice'])}, the cheapest we track"))
    good = sorted([m for m in ms if label(m) == "good" and saving(m) > 0], key=saving, reverse=True)
    if good:
        g = good[0]
        rows.append(("Best time to buy", g, f"at its lowest tracked price, {money(saving(g))} under its high"))
    wide = max(ms, key=lambda m: (len(m.get("retailers") or {}), -m["minPrice"]))
    if len(wide.get("retailers") or {}) > 1 and wide is not cheap:
        rows.append(("Most widely stocked", wide, f"at {len(wide['retailers'])} UK retailers, from {money(wide['minPrice'])}"))
    for what, test, why in extra:
        hit = [m for m in ms if test(m) and all(m is not r[1] for r in rows)]
        if hit:
            m = min(hit, key=lambda m: m["minPrice"])
            rows.append((what, m, why(m)))
    top = max(ms, key=lambda m: m["minPrice"])
    if top is not cheap and all(top is not r[1] for r in rows):
        rows.append(("If money’s no object", top, f"{money(top['minPrice'])}, the top of the range we track"))
    return rows


def picks_table(rows, built, title):
    if not rows:
        return ""
    items = "".join(f'<li class="bg-pick"><span class="bg-w">{e(w)}</span><b>{name_html(m, built)}</b><small>{e(why)}</small></li>' for w, m, why in rows)
    return (f'<h3>{e(title)}</h3><ul class="bg-picks">{items}</ul>'
            '<p class="pp-small">Worked out from today’s lowest new UK prices; it changes as prices move. We never rank for payment.</p>')


def bands(ms, edges, built, unit=""):
    """Price bands: [(label, count, cheapest model)]."""
    out = []
    for lo, hi in edges:
        inb = [m for m in ms if m["minPrice"] >= lo and (hi is None or m["minPrice"] < hi)]
        if inb:
            lab = f"Under {money(hi)}" if lo == 0 else (f"{money(lo)} to {money(hi)}" if hi else f"{money(lo)} and up")
            out.append((lab, len(inb), min(inb, key=lambda m: m["minPrice"])))
    if not out:
        return ""
    lis = "".join(f'<li><b>{e(l)}</b>: {n} model{"" if n == 1 else "s"}, from {name_html(c, built)} at {money(c["minPrice"])}{unit}</li>' for l, n, c in out)
    return f'<ul class="bg-bands">{lis}</ul>'


def qa_html(qas):
    return "".join(f'<details class="pp-faq"><summary>{e(q)}</summary><p>{a}</p></details>' for q, a in qas)


def plain(html):
    return re.sub(r"<[^>]+>", "", html)


def section(title, intro, parts, qas):
    return (f'{START}<section class="pp-block bg-guide"><h2>{e(title)}</h2>' + (f'<p class="bg-lead">{intro}</p>' if intro else "") +
            "".join(parts) + (f'<h3>More questions</h3>{qa_html(qas)}' if qas else "") + f'</section>{END}')


# ---------------------------------------------------------------- the six guides
def launch_monitors(passing, built, today, **_):
    ms = [m for m in passing if m["type"] == "launch-monitor"]
    if not ms:
        return None
    good = sum(1 for m in ms if label(m) == "good")
    rows = picks(ms, built, extra=[("Under £300", lambda m: m["minPrice"] < 300, lambda m: f"{money(m['minPrice'])}: a first launch monitor for the range or a net")])
    parts = [
        f'<h3>Radar or camera?</h3><p>Radar launch monitors (Doppler) track the ball in flight, so they like room: outdoors, at the range, or a long indoor bay. '
        'Camera (photometric) units sit beside the ball and read launch and spin from high-speed images, so they cope better in a garage or spare room. '
        'Many golfers start with a portable radar unit for the range and move to a camera unit for a home simulator.</p>',
        '<h3>What it measures</h3><p>Every launch monitor gives carry distance, ball speed and launch angle. Dearer ones measure spin properly rather than estimating it, '
        'and add club data (club speed, path, face angle and smash factor) that tells you why a shot went where it did. For gapping your irons, carry and spin matter most.</p>',
        '<h3>Room and subscriptions</h3><p>Indoors you need space for a full swing plus a safe distance to the net or screen: check each maker’s minimum distances before you buy. '
        'Some launch monitors need a paid app subscription to unlock simulator courses or full data, which can add a fair amount over a year, so it’s worth checking what’s included.</p>',
        f'<h3>Prices, by budget</h3>{bands(ms, [(0, 300), (300, 1000), (1000, 3000), (3000, None)], built)}',
        picks_table(rows, built, "The best launch monitor for…"),
    ]
    cheap = sorted(ms, key=lambda m: m["minPrice"])[:3]
    qas = [
        ("What’s the best cheap launch monitor?", "On today’s prices the cheapest we track are " + ", ".join(f"{name_html(m, built)} ({money(m['minPrice'])})" for m in cheap) +
         ". Cheaper units are usually radar-based and best outdoors; check whether spin is measured or estimated."),
        ("Do launch monitors work indoors?", "Yes, with enough room. Camera-based units work best in small spaces; radar units need room to see the ball fly, so check the maker’s minimum distance behind the ball and to the net."),
        ("Is now a good time to buy a launch monitor?", f"{good} of the {len(ms)} launch monitors we track {'is' if good == 1 else 'are'} at the lowest price we’ve seen. "
         "Each model page shows its price history and a buy-or-wait verdict."),
    ]
    return section("How to choose a launch monitor", f"We track {len(ms)} launch monitors at UK retailers, from {money(min(m['minPrice'] for m in ms))}. Here’s how to pick one.", parts, qas), qas


def golf_gloves(products, built, today, **_):
    import clothing_pages
    g = clothing_pages.GUIDES["golf-gloves"]
    ss = clothing_pages.styles(products, g)
    if not ss:
        return None
    ps = sorted(s["price"] for s in ss)
    cheap = min(ss, key=lambda s: s["price"])
    def cnt(lo, hi):
        return sum(1 for p in ps if p >= lo and (hi is None or p < hi))
    parts = [
        '<h3>Leather, synthetic or hybrid?</h3><p>Cabretta leather gloves give the best feel and grip but wear faster. Synthetic gloves last longer and cope better with sweat and rain; '
        'hybrids put leather on the palm for feel and synthetic on the back for fit. Most golfers keep one leather glove for good days and a couple of cheaper ones in the bag.</p>',
        '<h3>Winter and rain gloves</h3><p>Rain gloves come in pairs and actually grip better when they’re wet, so they live in the bag all year. Winter gloves and mitts are also sold in pairs: '
        'thicker for warmth, with a grippy palm. They’re worth it from November to March.</p>',
        '<h3>Getting the size right</h3><p>A glove should be snug with no loose material at the fingertips or across the palm. Cadet sizes suit golfers with shorter fingers and a wider palm. '
        'If you’re between sizes, the smaller one usually stretches to fit.</p>',
        f'<h3>Prices, by budget</h3><ul class="bg-bands"><li><b>Under £10</b>: {cnt(0, 10)} styles</li><li><b>£10 to £20</b>: {cnt(10, 20)} styles</li>'
        f'<li><b>£20 and up</b>: {cnt(20, None)} styles</li></ul><p class="pp-small">Lowest today: {e(cheap["name"])} at {money(cheap["price"])}. Multi-packs bring the price per glove down.</p>',
    ]
    qas = [
        ("Which hand do you wear a golf glove on?", "On your top hand on the grip: the left hand for a right-handed golfer, the right hand for a left-hander. Some golfers wear a pair in the cold or wet."),
        ("How should a golf glove fit?", "Snug, like a second skin, with no loose material at the fingertips or across the palm. Try cadet sizes if your fingers are shorter than the standard size."),
        ("Are leather golf gloves better?", "They give the best feel, but wear out faster and don’t like rain. Synthetic and hybrid gloves last longer, and rain gloves grip better when wet."),
    ]
    return section("How to choose a golf glove", f"We track {len(ss)} golf glove styles at UK retailers, from {money(ps[0])}.", parts, qas), qas


def odyssey(passing, built, today, **_):
    ms = [m for m in passing if m["type"] == "putter" and (m.get("brand") or "").lower() == "odyssey"]
    if not ms:
        return None
    rows = picks(ms, built, extra=[("Under £150", lambda m: m["minPrice"] < 150, lambda m: f"{money(m['minPrice'])}: an Odyssey for under £150")])
    good = sum(1 for m in ms if label(m) == "good")
    parts = [
        '<h3>Blade or mallet?</h3><p>Blades suit golfers with an arcing stroke who like feel and control; mallets are more forgiving on off-centre hits and help golfers who want to keep the face square. '
        'If you miss putts short and left or right from mis-hits, a mallet is a good place to start.</p>',
        '<h3>Inserts and feel</h3><p>Much of Odyssey’s range is about the insert in the face. The White Hot insert has a soft feel many golfers have used for years; newer ranges use different face technology for a firmer, faster roll. '
        'It’s worth trying a few in a shop for feel before you buy online at the best price.</p>',
        '<h3>Length</h3><p>Most putters come in 33, 34 or 35 inches. Your eyes should sit over or just inside the ball at address with your arms hanging naturally; if you’re hunched or standing tall, the length is wrong.</p>',
        f'<h3>Prices, by budget</h3>{bands(ms, [(0, 150), (150, 250), (250, None)], built)}',
        picks_table(rows, built, "The best Odyssey putter for…"),
    ]
    qas = [
        ("Which Odyssey putter is best for beginners?", "A forgiving mallet usually helps most: it keeps the face straighter on mis-hits. The budget list above shows the cheapest Odyssey mallets and blades we track today."),
        ("Are older Odyssey putter models good value?", "Often, yes. When a new range comes out, the previous one tends to drop in price while still being a very good putter. The price history on each model page shows how far it has fallen."),
        ("Is now a good time to buy an Odyssey putter?", f"{good} of the {len(ms)} Odyssey putters we track {'is' if good == 1 else 'are'} at the lowest price we’ve seen. Each model page has a buy-or-wait verdict."),
    ]
    return section("How to choose an Odyssey putter", f"We track {len(ms)} Odyssey putters at UK retailers, from {money(min(m['minPrice'] for m in ms))}.", parts, qas), qas


def motocaddy(passing, built, today, **_):
    ms = [m for m in passing if (m.get("brand") or "").lower() == "motocaddy"]
    if not ms:
        return None
    tro = [m for m in ms if m["type"] == "electric-trolley"]
    bags = [m for m in ms if m["type"] == "bag"]
    parts = [
        '<h3>Choosing a Motocaddy electric trolley</h3><p>Motocaddy’s range runs from simple, reliable trolleys up to models with a digital screen, downhill control, built-in GPS and remote control. '
        'Ask yourself which you’d really use: downhill control earns its keep on a hilly course, GPS saves carrying a separate device, and remote control is a luxury most golfers love once they’ve tried it.</p>',
        '<h3>Batteries</h3><p>Motocaddy trolleys run on lithium batteries. A standard battery covers 18 holes; extended-range batteries are worth it if you play 36 holes or a very hilly course. '
        'Check whether the battery is included in the price, as some deals are for the trolley only.</p>',
        '<h3>Bags that fit the trolley</h3><p>Cart bags are made to sit on a trolley, with every pocket facing you and a base that locks in place. Motocaddy’s waterproof Dry-Series bags are popular with trolley users who play all year.</p>',
    ]
    if tro:
        parts.append(f'<h3>Electric trolley prices</h3>{bands(tro, [(0, 500), (500, 800), (800, None)], built)}')
    if bags:
        parts.append(f'<h3>Golf bag prices</h3>{bands(bags, [(0, 150), (150, 250), (250, None)], built)}')
    rows = picks(tro or ms, built)
    parts.append(picks_table(rows, built, "The best Motocaddy trolley for…" if tro else "The best Motocaddy for…"))
    qas = []
    if tro:
        qas.append(("How much do Motocaddy electric trolleys cost?", f"From {money(min(m['minPrice'] for m in tro))} up to {money(max(m['minPrice'] for m in tro))} today, across the {len(tro)} Motocaddy electric trolleys we track. The top models add GPS, downhill control or remote control."))
    qas += [
        ("Is a lithium battery included with a Motocaddy trolley?", "Usually, but not always: some deals are for the trolley only, or let you choose the battery size. Check the listing before you buy."),
        ("Do I need a cart bag for an electric trolley?", "It helps. Cart bags sit securely on a trolley with every pocket facing you; stand bags work too but are designed to be carried."),
    ]
    return section("How to choose a Motocaddy", f"We track {len(ms)} Motocaddy models at UK retailers: " + ", ".join(x for x in [f"{len(tro)} electric trolleys" if tro else "", f"{len(bags)} golf bags" if bags else ""] if x) + ".", parts, qas), qas


TYPE_WORDS = {"driver": "drivers", "wood": "fairway woods", "hybrid": "hybrids", "irons": "iron sets", "wedge": "wedges", "putter": "putters", "ball": "golf balls",
              "bag": "golf bags", "gps-watch": "GPS watches", "rangefinder": "rangefinders", "electric-trolley": "electric trolleys", "launch-monitor": "launch monitors",
              "set": "package sets"}
HUBS = {"driver": "drivers", "wood": "fairway-woods", "hybrid": "hybrids", "irons": "irons", "wedge": "wedges", "putter": "putters", "ball": "golf-balls", "bag": "golf-bags",
        "gps-watch": "gps-watches", "rangefinder": "rangefinders", "electric-trolley": "electric-trolleys", "launch-monitor": "launch-monitors", "set": "golf-package-sets"}


def black_friday(passing, built, today, **_):
    ms = [m for m in passing if m["type"] in TYPE_WORDS]
    if not ms:
        return None
    bf = date(today.year, 11, 1)
    while bf.weekday() != 3:  # Thanksgiving: fourth Thursday of November; Black Friday the day after
        bf = bf.replace(day=bf.day + 1)
    bf = bf + timedelta(days=21)  # the fourth Thursday
    friday, cyber = bf + timedelta(days=1), bf + timedelta(days=4)
    good = [m for m in ms if label(m) == "good"]
    by = {}
    for m in good:
        by[m["type"]] = by.get(m["type"], 0) + 1
    tops = sorted(by.items(), key=lambda t: -t[1])[:6]
    lis = "".join(f'<li><a href="/prices/{HUBS[t]}/">{e(TYPE_WORDS[t][0].upper() + TYPE_WORDS[t][1:])}</a>: {n} at their lowest tracked price</li>' for t, n in tops)
    big = sorted([m for m in good if saving(m) > 0], key=saving, reverse=True)[:5]
    big_html = "".join(f'<li>{name_html(m, built)}: {money(m["minPrice"])}, {money(saving(m))} under its tracked high</li>' for m in big)
    fd = f"{friday.strftime('%A')} {friday.day} {friday.strftime('%B %Y')}"
    parts = [
        f'<h3>When is Black Friday {friday.year}?</h3><p>Black Friday is <b>{fd}</b>, and Cyber Monday is {cyber.day} {cyber.strftime("%B")}. Most UK golf retailers start their offers well before, '
        'often running them through the whole of November, so the best price can come early.</p>',
        '<h3>How to spot a real Black Friday golf deal</h3><p>A “was” price only tells you what the retailer says it was. We compare every price with what the same model actually cost in October and with its full tracked history, '
        'so a deal on this page is cheaper than it really was, not just cheaper than a made-up starting price.</p>',
        (f'<h3>Where the genuine deals are right now</h3><p>{len(good)} of the {len(ms)} models we track are at the lowest price we’ve seen.</p><ul class="bg-bands">{lis}</ul>' if lis else ""),
        (f'<h3>Biggest genuine savings today</h3><ul class="bg-bands">{big_html}</ul>' if big_html else ""),
        '<h3>Buy now or wait?</h3><p>If something you want is already at its lowest tracked price, waiting rarely gets you much more. If it isn’t, set a free price alert: you get one email when it genuinely drops, '
        'whether that’s before Black Friday or after it.</p>',
    ]
    qas = [
        (f"When is Black Friday {friday.year} in the UK?", f"Black Friday is {fd}, with Cyber Monday on {cyber.day} {cyber.strftime('%B')}. Many golf retailers start offers earlier in November."),
        ("When do Black Friday golf deals start?", f"Many UK golf retailers start their offers in early or mid November and run them to Cyber Monday ({cyber.day} {cyber.strftime('%B')}). This page is checked every 6 hours, so new genuine deals appear as they start."),
        ("Should I wait for Black Friday to buy golf equipment?", "Only if the price isn’t already low. Each model’s page says whether today’s price is the lowest we’ve tracked; if it is, waiting may not save you anything."),
    ]
    return section(f"Black Friday {friday.year} golf deals: how to buy well", "", parts, qas), qas


def golf_gifts(passing, built, today, **_):
    safe = {"ball", "rangefinder", "gps-watch", "launch-monitor", "bag", "electric-trolley"}
    ms = [m for m in passing if m["type"] in safe]
    if not ms:
        return None
    parts = [
        '<h3>Gift-safe golf gifts</h3><p>Clubs and shoes are personal and need fitting or sizes, so they’re risky to buy for someone else. Golf balls, rangefinders, GPS watches, launch monitors and bags need no sizes, '
        'which makes them the safest golf gifts. For balls, find out which model they play: most golfers stick to one.</p>',
        f'<h3>Golf gifts by budget</h3>{bands(ms, [(0, 50), (50, 100), (100, 250), (250, None)], built)}',
        '<h3>Rangefinder or GPS watch?</h3><p>A laser rangefinder gives an exact distance to the flag; a GPS watch gives front, middle and back of the green with nothing to aim. '
        'Golfers who play competitions should note that slope readings must be switched off in most club competitions.</p>',
        '<h3>Christmas delivery</h3><p>Each retailer sets its own last order dates for Christmas delivery, usually in mid-December. Check on the retailer’s site before you order, especially for bigger items like trolleys.</p>',
    ]
    under50 = sorted([m for m in ms if m["minPrice"] < 50], key=lambda m: m["minPrice"])[:3]
    qas = [
        ("What’s a good golf gift under £50?", ("On today’s prices: " + ", ".join(f"{name_html(m, built)} ({money(m['minPrice'])})" for m in under50) + ". Golf balls are the safest bet: find out which model they play.") if under50 else
         "Golf balls are the safest bet under £50: find out which model they play."),
        ("What do you buy a golfer who has everything?", "Something they wouldn’t buy themselves: a launch monitor for practice at home, an upgrade to a rangefinder or GPS watch, or a dozen of their usual premium balls."),
        ("What golf gifts don’t need a size?", "Golf balls, rangefinders, GPS watches, launch monitors, golf bags and trolleys. Clubs, shoes, gloves and clothing all need sizes or fitting."),
    ]
    return section("Choosing a golf gift", f"Gift-safe golf gifts from {money(min(m['minPrice'] for m in ms))}, at today’s lowest UK prices.", parts, qas), qas


PAGES = [
    ("prices/launch-monitors/index.html", launch_monitors, r'<section class="pp-block"><h2>Launch monitors by brand'),
    ("prices/golf-gloves/index.html", golf_gloves, None),
    ("prices/brands/odyssey-putters/index.html", odyssey, None),
    ("prices/brands/motocaddy/index.html", motocaddy, None),
    ("prices/black-friday/index.html", black_friday, None),
    ("prices/golf-gifts/index.html", golf_gifts, None),
]
QUESTIONS_RX = re.compile(r'<section[^>]*>\s*<h2[^>]*>\s*(?:Common q|Q)uestions\s*</h2>')
FAQ_RX = re.compile(r'<script type="application/ld\+json">(\{[^<]*"@type":\s*"FAQPage".*?)</script>', re.S)


def inject(html, guide, qas, anchor):
    html = re.sub(re.escape(START) + r".*?" + re.escape(END), "", html, flags=re.S)
    m = re.search(anchor, html) if anchor else QUESTIONS_RX.search(html)
    if not m:
        m = re.search(r'<section class="pp-block">\s*<h2>While you’re here', html)
    if not m:
        return None
    html = html[:m.start()] + guide + html[m.start():]
    extra = [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": plain(a)}} for q, a in qas]
    fm = FAQ_RX.search(html)
    if fm:
        try:
            data = json.loads(fm.group(1))
            data["mainEntity"] = [q for q in data.get("mainEntity", []) if q.get("name") not in {x["name"] for x in extra}] + extra
            html = html[:fm.start(1)] + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + html[fm.end(1):]
        except ValueError:
            pass
    elif extra:
        tag = '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": extra}, ensure_ascii=False, separators=(",", ":")) + "</script>\n"
        html = html.replace("</head>", tag + "</head>", 1)
    return html


def apply(passing, built, products, today, root=ROOT):
    """Add the guides; returns the page urls that changed."""
    changed = []
    for rel, fn, anchor in PAGES:
        path = root / rel
        if not path.exists():
            continue
        try:
            out = fn(passing=passing, built=built, products=products, today=today)
            if not out:
                continue
            guide, qas = out
            old = path.read_text()
            new = inject(old, guide, qas, anchor)
            if new and new != old:
                path.write_text(new)
                changed.append("/" + rel.replace("index.html", ""))
        except Exception as exc:  # never stop the build
            print(f"Buying guide skipped for {rel}: {exc}")
    return changed
