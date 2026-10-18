"""Budget guides and price comparisons, rebuilt every 6 hours from our own
price tracking (called from price_pages.build).

  /prices/best/<hub>-under-<N>/   "Best drivers under £300 (UK)": every model of
                                  that type under the budget, today's price,
                                  how far below its own tracked high it is,
                                  "Lowest we've tracked" badges, the near
                                  misses just over budget and a budget alert.
  /prices/compare/<a>-vs-<b>/     Two similarly priced models from different
                                  brands, side by side: today's price, tracked
                                  low/high/average, retailers, a price chart
                                  and "Watch both".
  /prices/best/, /prices/compare/ Index pages listing them all.

Fairness: picks are ordered by how far each price sits below its own highest
tracked price (value, not brand), with no brand twice in the top six; women's
models after men's; junior sets never included. Pairs are chosen by how many
listings each model has and how close their prices are, with a cap per brand.
Retailers are never named on these pages.

Which pages exist is kept in data/compare-pages.json, so a page doesn't flick
in and out of Google from one run to the next."""
import json
import re
from collections import defaultdict
from datetime import date, timedelta

from price_pages import (PRICES_DIR, SITE, TYPES, HUB_TYPES, NOT_IN_PICKS, _write, breadcrumb, esc, long_date,
                         method_note, money, page_shell)

ROOT = PRICES_DIR.parent
STATE = ROOT / "data" / "compare-pages.json"
BEST_DIR = PRICES_DIR / "best"
COMPARE_DIR = PRICES_DIR / "compare"
WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)
CLUBS = {"driver", "wood", "hybrid", "irons", "wedge", "putter"}

# Budgets per type (per dozen for balls). A page is made when at least 4
# models are under it and it adds at least 2 over the budget below.
BUDGETS = {
    "driver": [200, 300, 400, 500],
    "wood": [150, 200, 300],
    "hybrid": [100, 150, 200],
    "irons": [400, 600, 800, 1000],
    "wedge": [80, 100, 150],
    "putter": [100, 150, 200, 300],
    "ball": [20, 30, 40],
    "bag": [100, 150, 250],
    "rangefinder": [150, 200, 300],
    "gps-watch": [150, 250, 400],
    "electric-trolley": [400, 600, 800],
    "launch-monitor": [300, 500, 1000],
}
# How many comparisons per type (about 60 in all).
PAIRS = {"driver": 10, "irons": 8, "ball": 8, "putter": 6, "wood": 5, "wedge": 4, "hybrid": 4,
         "rangefinder": 4, "gps-watch": 4, "electric-trolley": 4, "bag": 3}

# Filled by plan(); read by price_pages when it builds model and hub pages.
COMPARE_FOR = {}   # model slug -> [(other model, url)]
BUDGET_CHIPS = {}  # hub slug -> [(label, url)]


# ---------------------------------------------------------------- facts
def daily(m, today):
    pts = [(date.fromisoformat(d), p) for d, p in m.get("history") or []]
    out = []
    for i, (d, p) in enumerate(pts):
        end = pts[i + 1][0] if i + 1 < len(pts) else today + timedelta(days=1)
        while d < end:
            out.append((d, p))
            d += timedelta(days=1)
    return out


def facts(m, today):
    ds = daily(m, today)
    now = float(m["minPrice"])
    prices = [p for _, p in ds] or [now]
    prev = [p for d, p in ds if d < today]
    high = max(prices)
    return {
        "now": now, "days": len(ds), "low": min(prices), "high": high, "avg": round(sum(prices) / len(prices), 2),
        "changes": sum(1 for a, b in zip(prices, prices[1:]) if a != b), "retailers": len(m.get("retailers") or []),
        # Lowest we've tracked: no lower price before today, and it has been higher.
        "lowest": bool(prev) and now <= min(prev) + 0.005 and high >= now + max(1, now * 0.01),
        "below": round(high - now, 2), "series": ds,
    }


VERDICT = {"good": "Good time to buy", "wait": "Wait if you can", "typical": "Typical price", "tracking": "Tracking"}


def verdict(m):
    return VERDICT.get((m.get("verdict") or {}).get("label"), "Tracking")


def per(m):
    return " per dozen" if m["type"] == "ball" else ""


def women(m):
    return bool(WOMEN_RX.search(m["name"]))


def short_money(n):
    return money(n).replace(".00", "")


def image_for(m, by_id):
    """A product photo, preferring men's listings and JPG/PNG."""
    pics = []
    for i in m.get("listingIds") or []:
        p = by_id.get(i)
        if p and p.get("image"):
            pics.append((bool(WOMEN_RX.search(p.get("name", ""))), p["image"].lower().split("?")[0].endswith(".webp"), p["image"]))
    pics.sort(key=lambda x: (x[0], x[1]))
    return pics[0][2] if pics else m.get("_image")


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {"budget": [], "pairs": []}


# ---------------------------------------------------------------- planning
def hub_of(t):
    return TYPES[t][0]


def budget_slug(t, n):
    return f"{hub_of(t)}-under-{n}"


def budget_label(t, n):
    noun = TYPES[t][1].lower()
    return f"{noun} under £{n}" + (" a dozen" if t == "ball" else "")


def pair_slug(a, b):
    ta, tb = a.split("-"), b.split("-")
    k = 0
    while k < min(len(ta), len(tb)) - 1 and ta[-1 - k] == tb[-1 - k]:
        k += 1
    left = "-".join(ta[:len(ta) - k]) if k else a
    return f"{left}-vs-{b}"


def short_names(ma, mb):
    wa, wb = ma["name"].split(), mb["name"].split()
    k = 0
    while k < min(len(wa), len(wb)) - 1 and wa[-1 - k].lower() == wb[-1 - k].lower():
        k += 1
    return (" ".join(wa[:len(wa) - k]) if k else ma["name"]), (" ".join(wb[:len(wb) - k]) if k else mb["name"])


def plan(passing, built, today):
    """Decide which budget and comparison pages exist this run."""
    state = load_state()
    ok = [m for m in passing if m["slug"] in built and m["type"] in TYPES and m["type"] not in NOT_IN_PICKS]
    by_type = defaultdict(list)
    for m in ok:
        by_type[m["type"]].append(m)

    budgets = []
    kept = set(state.get("budget") or [])
    for t, levels in BUDGETS.items():
        ms = by_type.get(t, [])
        prev = 0
        for n in levels:
            cnt = sum(1 for m in ms if m["minPrice"] <= n)
            slug = budget_slug(t, n)
            if (cnt >= 4 and cnt - prev >= 2) or (slug in kept and cnt >= 1):
                budgets.append((t, n, slug))
            prev = cnt

    by_slug = {m["slug"]: m for m in ok}
    pairs, used = [], defaultdict(int)
    for a, b in state.get("pairs") or []:  # keep last run's pairs while both are still on sale
        if a in by_slug and b in by_slug:
            pairs.append((a, b))
            used[a] += 1
            used[b] += 1
    for t, quota in PAIRS.items():
        have = [p for p in pairs if by_slug[p[0]]["type"] == t]
        brands = defaultdict(int)
        for a, b in have:
            brands[by_slug[a]["brand"]] += 1
            brands[by_slug[b]["brand"]] += 1
        cands = [m for m in by_type.get(t, []) if not women(m) and len(m.get("retailers") or []) >= 2
                 and (m.get("historyDays") or 0) >= 21]
        options = []
        for i, x in enumerate(cands):
            for y in cands[i + 1:]:
                if x["brand"] == y["brand"]:
                    continue
                gap = abs(x["minPrice"] - y["minPrice"]) / max(x["minPrice"], y["minPrice"])
                if gap > 0.2:
                    continue
                score = (x.get("listingCount") or 0) + (y.get("listingCount") or 0) - gap * 40
                options.append((score, x["slug"], y["slug"]))
        options.sort(key=lambda o: (-o[0], o[1], o[2]))
        for _, a, b in options:
            if len(have) >= quota:
                break
            a, b = sorted((a, b))
            if (a, b) in pairs or used[a] >= 2 or used[b] >= 2:
                continue
            if brands[by_slug[a]["brand"]] >= 3 or brands[by_slug[b]["brand"]] >= 3:
                continue
            pairs.append((a, b))
            have.append((a, b))
            used[a] += 1
            used[b] += 1
            brands[by_slug[a]["brand"]] += 1
            brands[by_slug[b]["brand"]] += 1

    COMPARE_FOR.clear()
    BUDGET_CHIPS.clear()
    for a, b in pairs:
        url = f"/prices/compare/{pair_slug(a, b)}/"
        COMPARE_FOR.setdefault(a, []).append((by_slug[b], url))
        COMPARE_FOR.setdefault(b, []).append((by_slug[a], url))
    for t, n, slug in budgets:
        BUDGET_CHIPS.setdefault(hub_of(t), []).append((f"Under £{n}", f"/prices/best/{slug}/"))
    return {"budgets": budgets, "pairs": pairs, "by_slug": by_slug, "by_type": by_type}


# ---------------------------------------------------------------- pieces
def thumb(src, cls="cp-pic"):
    if not src:
        return f'<span class="{cls} sg-noimg"></span>'
    return (f'<span class="{cls}"><img src="{esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" '
            f'onerror="this.parentNode.classList.add(\'sg-noimg\');this.remove()"></span>')


def alert_box(key, title, line, button, models=None):
    data = f'data-models="{esc(",".join(models))}" data-list="compare"' if models else f'data-budget="{esc(key)}"'
    fid = "cp-" + re.sub(r"[^a-z0-9]+", "-", (key or "watch").lower())[:40]
    return f"""<form class="gp-alert-form cp-alert" {data} novalidate>
    <b class="cp-alert-h">{esc(title)}</b>
    <span class="cp-alert-line">{esc(line)}</span>
    <label class="gp-af-label" for="{fid}">Your email</label>
    <div class="gp-af-row"><input id="{fid}" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required><button type="submit" class="gp-af-btn">{esc(button)}</button></div>
    <div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="gp-af-small">New to alerts? We’ll email you once to confirm first. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
    <p class="gp-af-msg" role="status" aria-live="polite"></p>
  </form>"""


def faq_schema(qs):
    return {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)}} for q, a in qs]}


# ---------------------------------------------------------------- budget page
def budget_page(t, n, slug, plan_, by_id, today, all_budgets):
    hub, label, noun, _ = TYPES[t]
    ms = plan_["by_type"].get(t, [])
    under = [m for m in ms if m["minPrice"] <= n]
    rows = [(m, facts(m, today)) for m in under]
    rows.sort(key=lambda r: (women(r[0]), not r[1]["lowest"], -r[1]["below"], -r[1]["retailers"], r[1]["now"]))
    # No brand twice in the top six.
    top, seen = [], set()
    for r in rows:
        if len(top) < 6 and r[0]["brand"] not in seen:
            top.append(r)
            seen.add(r[0]["brand"])
    rows = top + [r for r in rows if r not in top]
    lows = sum(1 for _, f in rows if f["lowest"])
    big = max(rows, key=lambda r: r[1]["below"], default=None)
    over, ob = [], set()
    for m in sorted((m for m in ms if n < m["minPrice"] <= n * 1.15 and not women(m)), key=lambda m: m["minPrice"]):
        if m["brand"] not in ob and len(over) < 3:
            over.append(m)
            ob.add(m["brand"])
    unit = per({"type": t})
    title_noun = budget_label(t, n)
    h1 = f"Best {title_noun} (UK)"
    when = long_date(today)
    if rows:
        lead = (f"On {when}, {len(rows)} {label.lower() if len(rows) != 1 else noun} {'are' if len(rows) != 1 else 'is'} under £{n}{unit} new "
                f"across multiple UK retailers.")
        if lows:
            lead += (f" {lows} of them {'are' if lows != 1 else 'is'} at the lowest price we’ve tracked, so this is a good week to buy at this budget."
                     if lows > 1 else " One is at the lowest price we’ve tracked.")
    else:
        lead = f"On {when}, nothing we track is under £{n}{unit} new. The nearest prices are below."

    cards = []
    for i, (m, f) in enumerate(rows, 1):
        note = (f"{short_money(f['below'])} below its highest tracked ({short_money(f['high'])})" if f["below"] >= 1
                else f"Steady at this price for {f['days']} days" if f["changes"] == 0 else f"Tracked for {f['days']} days")
        note += f" · {f['retailers']} retailer{'s' if f['retailers'] != 1 else ''}"
        badge = '<span class="cp-low">Lowest we’ve tracked</span>' if f["lowest"] else ""
        cards.append(f"""<li class="cp-card">
  <a class="cp-card-link" href="/prices/{m['slug']}/">{thumb(image_for(m, by_id))}
  <span class="cp-mid"><span class="cp-rank">{i}</span><b>{esc(m['name'])}</b>{badge}<span class="cp-note">{esc(note)}</span></span>
  <span class="cp-end"><b class="cp-price">{money(f['now'])}</b><span class="cp-btn">Compare prices</span></span></a>
</li>""")
    over_html = ""
    if over:
        items = "".join(f"""<li><a href="/prices/{m['slug']}/"><span><b>{esc(m['name'])}</b><span class="cp-note">{short_money(m['minPrice'] - n)} over</span></span><b>{money(m['minPrice'])}</b></a></li>""" for m in over)
        over_html = f"""<div class="cp-over pp-card"><h2>Just over £{n}</h2><p>Close enough to watch. The budget alert tells you if one drops under.</p><ul>{items}</ul></div>"""
    chips = "".join(f'<a class="pp-chip{" cp-on" if s == slug else ""}" href="/prices/best/{s}/"{" aria-current=\"page\"" if s == slug else ""}>Under £{nn}</a>'
                    for tt, nn, s in all_budgets if tt == t)
    stats = ""
    if rows:
        stats = f"""<section class="cp-stats" aria-label="At a glance">
  <div class="pp-card"><b>{len(rows)}</b><span>{esc(label.lower())} under £{n}{unit} today</span></div>
  <div class="pp-card"><b class="cp-green">{lows}</b><span>at the lowest price we’ve tracked</span></div>
  {f'<div class="pp-card"><b>{short_money(big[1]["below"])}</b><span>biggest drop: {esc(big[0]["name"])}, now {money(big[1]["now"])} (was {short_money(big[1]["high"])})</span></div>' if big and big[1]["below"] >= 1 else ''}
</section>"""
    cheapest = min(rows, key=lambda r: r[1]["now"]) if rows else None
    qs = []
    if cheapest:
        qs.append((f"What’s the cheapest new {noun} in the UK right now?",
                   f"The {esc(cheapest[0]['name'])}, from {money(cheapest[1]['now'])}{unit} today."))
        qs.append((f"Is now a good time to buy a {noun} under £{n}?",
                   f"{lows} of the {len(rows)} are at the lowest price we’ve tracked, so yes for those." if lows
                   else "None is at its lowest tracked price today. Set a budget alert and we’ll email you when one drops under."))
    if t in CLUBS:
        qs.append(("Which one suits me?", 'We compare prices, not swings. <a href="/find-your-fit.html">Find Your Fit</a> suggests a loft and flex in eight taps; a fitting at your club tells you the rest.'))
    else:
        qs.append(("How do you choose the order?", "By how far each price is below its own highest tracked price, then how many retailers stock it. No brand appears twice in the top six."))
    q_html = "".join(f'<div class="pp-card pp-q"><h3>{q}</h3><p>{a}</p></div>' for q, a in qs)
    compares = [(x, u) for m, _ in rows[:8] for x, u in COMPARE_FOR.get(m["slug"], [])]
    seen_u, comp_links = set(), []
    for x, u in compares:
        if u not in seen_u:
            seen_u.add(u)
            comp_links.append(u)
    comp_html = ""
    if comp_links:
        def cname(u):
            return COMPARE_TITLES.get(u, u)
        comp_html = '<section class="pp-block"><h2>Compare side by side</h2><div class="pp-chips">' + "".join(
            f'<a class="pp-chip" href="{u}">{esc(cname(u))}</a>' for u in comp_links[:6]) + "</div></section>"

    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (label, f"/prices/{hub}/"), (f"Under £{n}", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="cp-kicker">Budget guide · updated every 6 hours</span>
  <h1>{esc(h1)}</h1>
  <p class="pp-answer">{esc(lead)}</p>
  <div class="pp-chips cp-budgets" aria-label="Budget">{chips}</div>
</section>
{stats}
<section class="pp-block">
  <div class="cp-head"><h2>Our picks under £{n}</h2><span class="pp-small">Ordered by how far each price is below its own highest tracked price. Men’s first; no brand twice in the top six.</span></div>
  <ol class="cp-list">{''.join(cards)}</ol>
</section>
<section class="pp-block cp-two">
  {over_html}
  {alert_box(f"{t}-{n}", "Budget alert", f"Email me when a {noun} drops under £{n}{unit}. One email per drop, nothing else.", f"Watch under £{n}")}
</section>
<section class="pp-block"><h2>Questions</h2><div class="pp-q-grid">{q_html}</div></section>
{comp_html}
<p class="pp-disclose">We may earn a commission if you buy through our links. It never changes the order.</p>
{method_note(today)}
</div>"""
    desc = (f"{len(rows)} {label.lower()} under £{n}{unit} in the UK today, from {money(cheapest[1]['now'])}. "
            f"{lows} at the lowest price we’ve tracked. Checked every 6 hours." if cheapest else
            f"{label} under £{n}{unit} in the UK, checked every 6 hours.")
    title = (f"Best {title_noun.capitalize()} (UK): {len(rows)} from {short_money(cheapest[1]['now'])}" if cheapest
             else f"Best {title_noun.capitalize()} (UK)")
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": h1, "numberOfItems": len(rows),
                 "itemListElement": [{"@type": "ListItem", "position": i, "url": f"{SITE}/prices/{m['slug']}/", "name": m["name"]}
                                     for i, (m, _) in enumerate(rows[:20], 1)]}
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/best/{slug}/", body=body, section=TYPES[t][3],
                      schema=[item_list, faq_schema(qs), crumbs_schema], noindex=False,
                      og_image=(image_for(rows[0][0], by_id) if rows else None))


# ---------------------------------------------------------------- comparison page
COMPARE_TITLES = {}


def chart(ma, fa, mb, fb, today):
    days = min(fa["days"], fb["days"], 120)
    if days < 2:
        return ""
    start = today - timedelta(days=days - 1)
    sa = [(d, p) for d, p in fa["series"] if d >= start]
    sb = [(d, p) for d, p in fb["series"] if d >= start]
    vals = [p for _, p in sa + sb]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * 0.15, hi * 0.02, 1)
    lo, hi = lo - pad, hi + pad
    W, H, L, R, T, B = 520, 230, 52, 128, 14, 32

    def x(d):
        return L + (W - L - R) * ((d - start).days / max(days - 1, 1))

    def y(p):
        return T + (H - T - B) * (1 - (p - lo) / (hi - lo))

    def line(s, colour, width=3):
        pts = []
        for i, (d, p) in enumerate(s):
            if i and p != s[i - 1][1]:
                pts.append(f"{x(d):.1f},{y(s[i - 1][1]):.1f}")
            pts.append(f"{x(d):.1f},{y(p):.1f}")
        return f'<polyline points="{" ".join(pts)}" fill="none" stroke="{colour}" stroke-width="{width}" stroke-linejoin="round"></polyline>'

    na, nb = short_names(ma, mb)
    # Short line labels: the model words without the brand, cut to fit.
    ka = (" ".join(na.split()[1:]) or na)[:12]
    kb = (" ".join(nb.split()[1:]) or nb)[:12]
    ticks = [lo + pad, (lo + hi) / 2, hi - pad]
    grid = "".join(f'<line x1="{L}" y1="{y(v):.1f}" x2="{W - R}" y2="{y(v):.1f}" stroke="#eef0ec"></line>'
                   f'<text x="{L - 8}" y="{y(v) + 4:.1f}" font-size="13" text-anchor="end" fill="#5b665f">{short_money(round(v))}</text>' for v in ticks)
    ya, yb = y(fa["now"]), y(fb["now"])
    if abs(ya - yb) < 16:
        ya, yb = (ya - 9, yb + 9) if ya <= yb else (ya + 9, yb - 9)
    label = (f"{na} went from {short_money(sa[0][1])} to {short_money(sa[-1][1])}; "
             f"{nb} went from {short_money(sb[0][1])} to {short_money(sb[-1][1])}, over the last {days} days")
    return f"""<svg class="cp-chart" viewBox="0 0 {W} {H}" role="img" aria-label="{esc(label)}">
{grid}
{line(sa, '#16241c', 5)}
{line(sb, '#3fae29', 2.5)}
<text x="{W - R + 8}" y="{ya + 4:.1f}" font-size="13" font-weight="700" fill="#16241c">{esc(ka)} {short_money(fa['now'])}</text>
<text x="{W - R + 8}" y="{yb + 4:.1f}" font-size="13" font-weight="700" fill="#2f8a1f">{esc(kb)} {short_money(fb['now'])}</text>
<text x="{L}" y="{H - 10}" font-size="12" fill="#5b665f">{start.day} {start.strftime('%b')}</text>
<text x="{W - R}" y="{H - 10}" font-size="12" text-anchor="end" fill="#5b665f">{today.day} {today.strftime('%b')}</text>
</svg>"""


def compare_page(a, b, plan_, by_id, today):
    from price_pages import Model
    ma, mb = plan_["by_slug"][a], plan_["by_slug"][b]
    fa, fb = facts(ma, today), facts(mb, today)
    na, nb = short_names(ma, mb)
    t = ma["type"]
    hub, label, noun, section = TYPES[t]
    unit = per(ma)
    if abs(fa["now"] - fb["now"]) < 0.005:
        lead = f"The {ma['name']} and the {mb['name']} are both {money(fa['now'])}{unit} today."
        cheaper = None
    else:
        c, fc, d, fd = (ma, fa, mb, fb) if fa["now"] < fb["now"] else (mb, fb, ma, fa)
        gap = fd["now"] - fc["now"]
        lead = f"Today the <b>{esc(c['name'])} is {money(gap).replace('.00', '')} cheaper</b>: {money(fc['now'])} against {money(fd['now'])}{unit}."
        cheaper = c["slug"]
    days = min(fa["days"], fb["days"])
    if days >= 14:
        lead += f" Over the {days} days we’ve tracked both, the {esc(na)} has averaged {money(fa['avg'])} and the {esc(nb)} {money(fb['avg'])}."
        avg_gap, now_gap = abs(fa["avg"] - fb["avg"]), abs(fa["now"] - fb["now"])
        if avg_gap > now_gap + 5:
            lead += " The gap is usually wider than it is now."
        elif now_gap > avg_gap + 5:
            lead += " The gap is wider than usual today."
    if not cheaper:
        lead = esc(lead)

    def card(m, f):
        tag = ("Cheaper today" if cheaper == m["slug"] else
               "Lowest we’ve tracked" if f["lowest"] else verdict(m))
        good = cheaper == m["slug"] or f["lowest"]
        return f"""<div class="pp-card cp-side">
  {thumb(image_for(m, by_id), 'cp-pic cp-pic-big')}
  <div class="cp-side-body">
    <b class="cp-side-name">{esc(m['name'])}</b>
    <div class="cp-from"><span class="pp-sub">from</span><b>{money(f['now'])}</b>{f'<span class="pp-sub">per dozen</span>' if unit else ''}</div>
    <span class="cp-tag{' cp-tag-good' if good else ''}">{esc(tag)}</span>
    <div class="cp-side-ctas"><a class="pp-btn" href="/prices/{m['slug']}/">All prices</a></div>
  </div>
</div>"""

    def row(lbl, va, vb, better=None):
        ca = ' class="cp-better"' if better == "a" else ""
        cb = ' class="cp-better"' if better == "b" else ""
        return f'<tr><th scope="row">{esc(lbl)}</th><td{ca}>{va}</td><td{cb}>{vb}</td></tr>'

    def lower(x, y):
        return "a" if x < y - 0.005 else "b" if y < x - 0.005 else None

    rows = [
        row(f"Lowest new price today{unit}", money(fa["now"]), money(fb["now"]), lower(fa["now"], fb["now"])),
        row("UK retailers stocking it", fa["retailers"], fb["retailers"],
            "a" if fa["retailers"] > fb["retailers"] else "b" if fb["retailers"] > fa["retailers"] else None),
        row("Lowest we’ve tracked", money(fa["low"]), money(fb["low"]), lower(fa["low"], fb["low"])),
        row("Highest we’ve tracked", money(fa["high"]), money(fb["high"])),
        row(f"Average over {days} days" if days == min(fa["days"], fb["days"]) else "Average", money(fa["avg"]), money(fb["avg"]), lower(fa["avg"], fb["avg"])),
        row("Price changes", fa["changes"], fb["changes"]),
        row("Our verdict", verdict(ma), verdict(mb)),
    ]
    if t in CLUBS:
        la, lb = Model(ma, by_id, today).left_handed(), Model(mb, by_id, today).left_handed()
        rows.append(row("Left-handed", f"From {money(la['from'])}" if la else "Not in stock", f"From {money(lb['from'])}" if lb else "Not in stock"))
    others = []
    for s in (a, b):
        for x, u in COMPARE_FOR.get(s, []):
            if u != f"/prices/compare/{pair_slug(a, b)}/" and u not in [o for o in others]:
                others.append(u)
    other_html = ""
    if others:
        other_html = '<b class="cp-more-h">Other comparisons</b><div class="pp-chips">' + "".join(
            f'<a class="pp-chip" href="{u}">{esc(COMPARE_TITLES.get(u, u))}</a>' for u in others[:4]) + "</div>"
    fit = ('Which suits you depends on your swing, not our spreadsheet. <a href="/find-your-fit.html">Find Your Fit</a> suggests a loft and flex in eight taps; a fitting at your club tells you the rest.'
           if t in CLUBS else "We compare prices, not performance. Reviews and a try-out tell you the rest.")
    h1 = f"{na} vs {nb}: UK price comparison"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (label, f"/prices/{hub}/"), (f"{na} vs {nb}", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="cp-kicker">Price comparison · updated every 6 hours</span>
  <h1>{esc(h1)}</h1>
  <p class="pp-answer">{lead}</p>
</section>
<section class="cp-pair" aria-label="The two {esc(label.lower())}">{card(ma, fa)}{card(mb, fb)}</section>
<section class="pp-block cp-facts">
  <div class="pp-card pp-table-wrap"><table class="pp-table cp-table">
    <thead><tr><th scope="col">Price facts</th><th scope="col">{esc(na)}</th><th scope="col">{esc(nb)}</th></tr></thead>
    <tbody>{''.join(rows)}</tbody>
  </table><p class="pp-small cp-table-note">Bold = better for your wallet. Prices checked across multiple UK retailers.</p></div>
  <div class="pp-card cp-chart-box"><b>Lowest price, last {min(days, 120)} days</b>{chart(ma, fa, mb, fb, today)}</div>
</section>
<section class="pp-block cp-two">
  <div>{alert_box(pair_slug(a, b), "Can’t decide? Watch both", "One email when either genuinely drops. Buy whichever gets there first.", "Watch both", [a, b])}
  <p class="cp-fb">Arguing about it with your mates? <button type="button" class="fb-link fb-share-list" data-slugs="{a},{b}">Send it to your four-ball</button></p></div>
  <div class="pp-card cp-fit"><b>We compare prices, not swings</b><p>{fit}</p>{other_html}</div>
</section>
<p class="pp-disclose">We may earn a commission if you buy through our links. It never changes the comparison.</p>
{method_note(today)}
</div>
<script src="/js/fourball.js?v=20261018b" defer></script>"""
    title = f"{na} vs {nb}: UK Price Comparison ({money(fa['now']).replace('.00', '')} vs {money(fb['now']).replace('.00', '')})"
    desc = re.sub(r"<[^>]+>", "", lead)[:300]
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/compare/{pair_slug(a, b)}/", body=body,
                      section=section, schema=[crumbs_schema], noindex=False, og_image=image_for(ma, by_id))


# ---------------------------------------------------------------- index pages
def index_page(kind, groups, today):
    if kind == "best":
        h1, lead, url = "Best golf gear by budget (UK)", "What you can get for your money today, by category and budget. Every list is rebuilt every 6 hours from our own price tracking.", "/prices/best/"
    else:
        h1, lead, url = "Golf price comparisons (UK)", "Two similar models from different brands, side by side: today’s price, tracked lows and highs, and a price chart. Rebuilt every 6 hours.", "/prices/compare/"
    secs = "".join(f'<section class="pp-block"><h2>{esc(g)}</h2><div class="pp-chips">' +
                   "".join(f'<a class="pp-chip" href="{u}">{esc(t)}</a>' for t, u in items) + "</div></section>"
                   for g, items in groups)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (h1.split(" (")[0], None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top"><h1>{esc(h1)}</h1><p class="pp-answer">{esc(lead)}</p></section>
{secs}
{method_note(today)}
</div>"""
    return page_shell(title=f"{h1} | GolfPrice AI", description=lead, canonical=SITE + url, body=body, section="",
                      schema=[crumbs_schema], noindex=False)


# ---------------------------------------------------------------- build
def build(plan_, by_id, today):
    """Write every page in the plan. Returns (changed urls, sitemap entries)."""
    changed, sitemap = [], []
    COMPARE_TITLES.clear()
    for a, b in plan_["pairs"]:
        na, nb = short_names(plan_["by_slug"][a], plan_["by_slug"][b])
        COMPARE_TITLES[f"/prices/compare/{pair_slug(a, b)}/"] = f"{na} vs {nb}"
    wanted_best, wanted_cmp = set(), set()
    for t, n, slug in plan_["budgets"]:
        try:
            page = budget_page(t, n, slug, plan_, by_id, today, plan_["budgets"])
        except Exception as e:  # one bad page never stops the rest
            print(f"Budget page {slug} skipped: {e}")
            continue
        wanted_best.add(slug)
        if _write(BEST_DIR / slug / "index.html", page):
            changed.append(f"/prices/best/{slug}/")
        sitemap.append((f"prices/best/{slug}/", today.isoformat()))
    for a, b in plan_["pairs"]:
        slug = pair_slug(a, b)
        try:
            page = compare_page(a, b, plan_, by_id, today)
        except Exception as e:
            print(f"Comparison {slug} skipped: {e}")
            continue
        wanted_cmp.add(slug)
        if _write(COMPARE_DIR / slug / "index.html", page):
            changed.append(f"/prices/compare/{slug}/")
        sitemap.append((f"prices/compare/{slug}/", today.isoformat()))
    # Index pages.
    groups = defaultdict(list)
    for t, n, slug in plan_["budgets"]:
        if slug in wanted_best:
            groups[TYPES[t][1]].append((f"Under £{n}" + (" a dozen" if t == "ball" else ""), f"/prices/best/{slug}/"))
    if groups:
        _write(BEST_DIR / "index.html", index_page("best", list(groups.items()), today))
        sitemap.append(("prices/best/", today.isoformat()))
    groups = defaultdict(list)
    for a, b in plan_["pairs"]:
        slug = pair_slug(a, b)
        if slug in wanted_cmp:
            groups[TYPES[plan_["by_slug"][a]["type"]][1]].append((COMPARE_TITLES[f"/prices/compare/{slug}/"], f"/prices/compare/{slug}/"))
    if groups:
        _write(COMPARE_DIR / "index.html", index_page("compare", list(groups.items()), today))
        sitemap.append(("prices/compare/", today.isoformat()))
    STATE.write_text(json.dumps({"about": "Which budget and comparison pages exist (no personal data).",
                                 "budget": sorted(wanted_best), "pairs": [list(p) for p in plan_["pairs"] if pair_slug(*p) in wanted_cmp]},
                                indent=1) + "\n")
    print(f"Budget guides: {len(wanted_best)} page(s). Comparisons: {len(wanted_cmp)} page(s).")
    return changed, sitemap
