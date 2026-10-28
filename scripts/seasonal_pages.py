"""Seasonal price pages: Black Friday, Christmas, Boxing Day and gift guides.

Built every run alongside the other price pages (called from
price_pages.build), from the same data, so they never go stale:

  /prices/black-friday/          Black Friday tracker. Compares today's lowest
                                 new price with the model's October price
                                 (the median of what we recorded in October),
                                 which is the honest test of a Black Friday
                                 "deal". Changes what it says by date: before,
                                 during and after the Black Friday fortnight.
  /prices/christmas/             Gift ideas at the lowest price we've tracked,
                                 plus what's still cheaper than before Black
                                 Friday (from the day after Black Friday).
  /prices/boxing-day-sales/      Same idea as Black Friday: sale prices
                                 compared with what each model cost from 1 to
                                 20 December. Live 26 Dec to 15 Jan.
  /prices/golf-gifts/            Gift guide overview.
  /prices/golf-gifts-under-25/   Gift ideas by budget. Big-ticket items link
  /prices/golf-gifts-under-50/   to their price pages; small things (gloves,
  /prices/golf-gifts-under-100/  towels, tees...) link to the cheapest
  /prices/golf-gifts-over-100/   in-stock new listing at a retailer.

Nothing is invented: every price is a live retailer price from this run, and
every "cheaper than October" figure comes from our own price history.
Pre-owned listings are never included.
"""
import json
import statistics
from collections import defaultdict
from datetime import date, timedelta

from price_pages import (THUMB_HEAD, thumb_td, PRICES_DIR, SITE, TYPES, breadcrumb, esc, long_date, method_note, money, page_shell,
                         plural, retailer_name, _write)

TOP_BRANDS = ["Titleist", "TaylorMade", "Callaway", "Ping", "FootJoy", "Srixon", "Cobra", "Mizuno", "Odyssey",
              "Scotty Cameron", "Cleveland", "Bushnell", "Garmin", "Shot Scope", "SkyCaddie", "Motocaddy",
              "Under Armour", "Nike", "adidas", "Puma", "Galvin Green", "ProQuip", "Ecco", "Oakley", "Wilson",
              "Big Max", "Sun Mountain", "Ogio", "Vessel", "Bridgestone", "PXG", "Benross", "Stewart Golf"]
BRAND_RANK = {b.lower(): i for i, b in enumerate(TOP_BRANDS)}


# ---------------------------------------------------------------- shared bits
def daily_prices(history, until):
    pts = [(date.fromisoformat(d), p) for d, p in history or []]
    out = {}
    for i, (d, p) in enumerate(pts):
        end = pts[i + 1][0] if i + 1 < len(pts) else until + timedelta(days=1)
        while d < end:
            out[d] = p
            d += timedelta(days=1)
    return out


def brand_rank(name_or_brand):
    s = (name_or_brand or "").lower()
    for b, i in BRAND_RANK.items():
        if s.startswith(b) or f" {b} " in f" {s} ":
            return i
    return 99


def signup_box(title, text):
    return f"""<section class="pp-block pp-alert">
  <div class="pp-alert-copy"><h2>{esc(title)}</h2><p>{text}</p></div>
  <form class="gp-alert-form" novalidate>
    <label class="gp-af-label" for="season-alert-email">Your email</label>
    <div class="gp-af-row">
      <input id="season-alert-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
      <button type="submit" class="gp-af-btn">Sign me up</button>
    </div>
    <div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="gp-af-small">We’ll email you once to confirm first. Unsubscribe in one click. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
    <p class="gp-af-msg" role="status" aria-live="polite"></p>
  </form>
</section>"""


def faq_block(qas):
    items = "".join(f'<div class="pp-card pp-q"><h3>{esc(q)}</h3><p>{a}</p></div>' for q, a in qas)
    schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": _plain(a)}} for q, a in qas]}
    return f'<section class="pp-block"><h2>Questions</h2><div class="pp-q-grid">{items}</div></section>', schema


def _plain(s):
    import re
    return re.sub(r"<[^>]+>", "", s)


def per(m):
    return " per dozen" if m["type"] == "ball" else ""


# ---------------------------------------------------------------- Black Friday
def black_friday_date(year):
    nov1 = date(year, 11, 1)
    first_thu = nov1 + timedelta(days=(3 - nov1.weekday()) % 7)
    return first_thu + timedelta(days=21, hours=0) + timedelta(days=1)


def baseline_price(m, start, end, today):
    """Median of the model's daily lowest price between two dates (inclusive),
    using only days before today. None if fewer than 7 days are known."""
    days = daily_prices(m.get("history"), today)
    window = [p for d, p in days.items() if start <= d <= end and d < today]
    if len(window) < 7:
        return None
    return round(statistics.median(window), 2)


def compare_rows(models, built, today, start, end):
    rows = []
    for m in models:
        if m["slug"] not in built:
            continue
        base = baseline_price(m, start, end, today)
        if not base:
            continue
        now = float(m["minPrice"])
        # A price that has more than halved or jumped 50%+ since the baseline
        # is far more likely a feed change (e.g. one iron vs a full set) than
        # a real price move: leave it out rather than show a false story.
        if not 0.5 <= now / base <= 1.5:
            continue
        rows.append({"m": m, "base": base, "now": now, "diff": now - base, "pct": round((base - now) / base * 100)})
    deals = sorted([r for r in rows if r["base"] - r["now"] >= max(5, r["base"] * 0.05)],
                   key=lambda r: (-r["pct"], -(r["base"] - r["now"])))
    raised = sorted([r for r in rows if r["now"] - r["base"] >= max(5, r["base"] * 0.05)],
                    key=lambda r: -(r["now"] - r["base"]))
    return rows, deals, raised


def watch_list(rows, per_type=3):
    """The models people most often look for: lots of retailers, big brands."""
    by_type = defaultdict(list)
    for r in rows:
        by_type[r["m"]["type"]].append(r)
    watch = []
    for t, rs in by_type.items():
        rs.sort(key=lambda r: (-len(r["m"]["retailers"]), brand_rank(r["m"]["name"]), r["now"]))
        picked, per_brand = [], defaultdict(int)
        for r in rs:
            b = brand_rank(r["m"]["name"])
            if per_brand[b] >= 2:
                continue
            per_brand[b] += 1
            picked.append(r)
            if len(picked) == per_type:
                break
        watch += picked
    watch.sort(key=lambda r: (list(TYPES).index(r["m"]["type"]), r["now"]))
    return watch


def compare_table(rs, base_label):
    trs = "".join(f"""<tr>
  <th scope="row"><a href="/prices/{r['m']['slug']}/">{esc(r['m']['name'])}</a><span class="pp-sub sb-type">{esc(TYPES[r['m']['type']][2])}</span></th>
  {thumb_td(r['m'].get('_image'), f"/prices/{r['m']['slug']}/")}
  <td>{money(r['base'])}{per(r['m'])}</td>
  <td class="pp-price">{money(r['now'])}{per(r['m'])}</td>
  <td>{_change(r)}</td>
</tr>""" for r in rs)
    return f"""<div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
<thead><tr><th scope="col">Model</th>{THUMB_HEAD}<th scope="col">{esc(base_label)}</th><th scope="col">Today</th><th scope="col">Change</th></tr></thead>
<tbody>{trs}</tbody></table></div>"""


WOMEN_RX = r"\b(ladies|lady|women'?s?|womens)\b"


def _lead_order(deals):
    """Biggest saving first, but men's and unisex lead, and the top rows mix
    brands, so no brand or the women's range dominates the first screen."""
    import re
    women = re.compile(WOMEN_RX, re.I)
    by_saving = sorted(deals, key=lambda r: (-(r["base"] - r["now"]), -r["pct"]))
    top = _spread([r for r in by_saving if not women.search(r["m"]["name"])], lambda r: _brand_key(r["m"]["name"]), 8)
    return top + [r for r in by_saving if r not in top]


def _mark_lows(rows, today):
    """True when today's price is the lowest we've recorded for that model."""
    for r in rows:
        prev = [p for d, p in daily_prices(r["m"].get("history"), today).items() if d < today]
        r["low"] = bool(prev) and r["now"] <= min(prev) + 0.005


def deals_table(rs):
    trs = "".join(f"""<tr class="cg-item" data-tags="{TYPES[r['m']['type']][0]}">
  <th scope="row"><a href="/prices/{r['m']['slug']}/">{esc(r['m']['name'])}</a>{'<span class="bf-low">Lowest we’ve tracked</span>' if r.get('low') else ''}<span class="pp-sub sb-type">{esc(TYPES[r['m']['type']][2])}</span></th>
  {thumb_td(r['m'].get('_image'), f"/prices/{r['m']['slug']}/")}
  <td>{money(r['base'])}{per(r['m'])}</td>
  <td class="pp-price">{money(r['now'])}{per(r['m'])}</td>
  <td class="bf-save">{money(r['base'] - r['now'])} ({r['pct']}%)</td>
</tr>""" for r in rs)
    return f"""<div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
<thead><tr><th scope="col">Model</th>{THUMB_HEAD}<th scope="col">October price</th><th scope="col">Today</th><th scope="col">You save</th></tr></thead>
<tbody class="cg-list" data-show="40">{trs}</tbody></table></div>"""


def build_black_friday(models, built, today, images=None):
    year = today.year
    bf = black_friday_date(year)
    cyber = bf + timedelta(days=3)
    live_from, live_to = bf - timedelta(days=14), cyber + timedelta(days=1)
    phase = "before" if today < live_from else ("live" if today <= live_to else "after")

    rows, deals, _ = compare_rows(models, built, today, date(year, 10, 1), date(year, 10, 31))
    _mark_lows(deals, today)
    for r in deals:
        r["m"]["_image"] = r["m"].get("_image") or next(
            (images[i] for i in r["m"].get("listingIds", []) if (images or {}).get(i)), None)
    deals = _lead_order(deals)
    lows = sum(1 for r in deals if r["low"])
    watch = watch_list(rows)

    bf_txt = f"Friday {bf.day} November {year}"
    n_txt = (f"<strong>{plural(len(deals), 'golf model')}</strong> {'is' if len(deals) == 1 else 'are'} genuinely cheaper "
             f"than in October" + (f", {lows} of them at the lowest price we’ve tracked" if lows else ""))
    if phase == "before":
        days_to = (bf - today).days
        answer = (f"Black Friday {year} is <strong>{bf_txt}</strong>, {plural(days_to, 'day')} away. We record UK golf prices "
                  f"every 6 hours across multiple UK retailers, so we know what everything costs in October. This page "
                  f"lists every golf model that’s genuinely cheaper, with the saving. "
                  + (f"Already, {n_txt}." if deals else ""))
        deals_h = ("Already cheaper than earlier this month" if today.month == 10
                   else "Early Black Friday deals: cheaper than in October")
        deals_empty = "Nothing yet. As soon as a model we track is genuinely cheaper than in October, it appears here."
    elif phase == "live":
        answer = (f"Black Friday {year} is <strong>{bf_txt}</strong> and Cyber Monday is {cyber.day} November. "
                  + (f"Right now {n_txt}, checked against the prices we recorded ourselves." if deals else
                     "We’re checking every 6 hours: genuine deals appear here as soon as prices drop."))
        deals_h = "The real Black Friday golf deals"
        deals_empty = "None yet. We’re checking every 6 hours, and genuine deals appear here as soon as prices drop."
    else:
        answer = (f"Black Friday {year} ({bf_txt}) is over, but some savings stuck. "
                  + (f"Today {n_txt}." if deals else "Nothing we track is still meaningfully cheaper than in October."))
        deals_h = "Still cheaper than in October"
        deals_empty = "No model we track is meaningfully cheaper than its October price any more."

    stats_html = chips_html = ""
    if deals:
        best = deals[0]
        stats_html = f"""<section class="pp-block bf-stats" aria-label="Black Friday at a glance">
  <div class="pp-card bf-stat"><b>{len(deals)}</b><span>golf {'model' if len(deals) == 1 else 'models'} genuinely cheaper than in October</span></div>
  <div class="pp-card bf-stat"><b>{lows}</b><span>at the lowest price we’ve ever tracked</span></div>
  <div class="pp-card bf-stat"><b>{money(best['base'] - best['now']).replace('.00', '')}</b><span>biggest saving: {esc(best['m']['name'])}</span></div>
</section>"""
        counts = defaultdict(int)
        for r in deals:
            counts[r["m"]["type"]] += 1
        chips_html = ('<div class="pp-chips cg-chips" role="group" aria-label="Filter by category">'
                      f'<button type="button" class="pp-chip cg-chip sg-on" data-f="all" aria-pressed="true">All ({len(deals)})</button>'
                      + "".join(f'<button type="button" class="pp-chip cg-chip" data-f="{TYPES[t][0]}" aria-pressed="false">'
                                f'{esc(TYPES[t][1])} ({n})</button>'
                                for t, n in sorted(counts.items(), key=lambda kv: -kv[1]))
                      + "</div>")
    deals_html = deals_table(deals) if deals else f'<p class="pp-card sb-empty">{deals_empty}</p>'
    share_html = """<section class="pp-block bf-share">
  <div><h2>Know someone hunting for a golf deal?</h2><p>Send them the list. Every saving on it is checked against prices we recorded ourselves.</p></div>
  <button type="button" class="gp-af-btn gp-share" data-text="Genuine golf Black Friday deals, checked against real price history:">Share the deals</button>
</section>""" if deals else ""
    faq_html, faq_schema = faq_block([
        (f"When is Black Friday {year} in the UK?",
         f"{bf_txt}. Cyber Monday is Monday {cyber.day} November. Many golf retailers start their offers a week or two earlier."),
        ("How do you know a Black Friday golf deal is real?",
         "We compare the Black Friday price with the model’s October price: the typical lowest new, in-stock price we "
         "recorded in October, checking every 6 hours. A retailer’s own “was” or RRP price is not used."),
        ("What counts as cheaper on this page?",
         "At least £5 and 5% below the October price. Smaller wobbles happen every week and aren’t worth a special trip."),
        ("What does “Lowest we’ve tracked” mean?",
         "Today’s price is the lowest we’ve recorded for that model since we started tracking it. Each model’s page shows "
         "its full price history so you can see for yourself."),
    ])
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Black Friday", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Black Friday {year} · {bf_txt}</span>
  <h1>Golf Black Friday deals {year} (UK): genuinely cheaper, checked</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes what’s listed or the order.</p>
</section>
{stats_html}
<section class="pp-block">
  <h2>{deals_h}</h2>
  {chips_html}
  {deals_html}
  <p class="pp-small">October price: the typical lowest new, in-stock price we recorded in October. Today: the lowest now, checked every 6 hours. “Lowest we’ve tracked”: the lowest price we’ve recorded for that model.</p>
</section>
{share_html}
<section class="pp-block">
  <h2>Prices we’re watching</h2>
  <p class="pp-small">The most widely stocked models in each category, with the October price we’ll measure Black Friday against.</p>
  {compare_table(watch, "October price")}
</section>
{signup_box("Get the real deals by email", "Our Friday email lists the week’s genuine price drops, checked against our own price history. Through Black Friday it’s the quickest way to see what’s actually cheaper.")}
{faq_html}
{method_note(today)}
</div>
<script src="/js/clothing-guide.js?v=20261018" defer></script>
<script src="/js/gift-finder.js?v=20261018d" defer></script>"""
    title = f"Black Friday Golf Deals {year} UK: Genuinely Cheaper, Checked | GolfPrice AI"
    desc = (f"Black Friday {year} golf deals that are genuinely cheaper than in October, with the saving on each. "
            f"Drivers, putters, bags, rangefinders and more, checked every 6 hours.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/black-friday/", body=body,
                      section="", schema=[crumbs_schema, faq_schema], noindex=False), len(deals)


def _change(r):
    if r["base"] - r["now"] >= 0.005:
        return f'<span class="sb-down">−{money(r["base"] - r["now"])} ({r["pct"]}%)</span>'
    if r["now"] - r["base"] >= 0.005:
        return f'<span class="sb-up">+{money(r["now"] - r["base"])}</span>'
    return '<span class="pp-sub">Same</span>'


# ---------------------------------------------------------------- Boxing Day and January sales
def build_boxing_day(models, built, today):
    year = today.year - 1 if today.month == 1 else today.year
    boxing = date(year, 12, 26)
    base_start, base_end = date(year, 12, 1), date(year, 12, 20)
    live_to = date(year + 1, 1, 15)
    phase = "before" if today < boxing else ("live" if today <= live_to else "after")
    rows, deals, raised = compare_rows(models, built, today, base_start, base_end)
    if phase == "before":
        raised = []
    watch = watch_list(rows)
    day = boxing.strftime("%A")
    if phase == "before":
        answer = (f"Boxing Day {year} is <strong>{day} 26 December</strong>. We’ll compare every Boxing Day and January sale "
                  f"price with what it cost from 1 to 20 December, which we record every 6 hours, so you can see which "
                  f"“sale” prices are genuinely lower.")
        deals_h, deals_empty = "Already cheaper than early December", (
            "We start recording December prices on 1 December." if today < base_start + timedelta(days=7)
            else "Nothing yet. No model we track is meaningfully cheaper than its early-December price.")
    elif phase == "live":
        answer = (f"The Boxing Day and January sales are on. "
                  + (f"Right now <strong>{plural(len(deals), 'model')}</strong> we track "
                     f"{'is' if len(deals) == 1 else 'are'} genuinely cheaper than in early December." if deals else
                     "So far none of the models we track is meaningfully cheaper than its early-December price."))
        deals_h, deals_empty = "Real sale prices: cheaper than early December", "None yet."
    else:
        answer = (f"The {year} Boxing Day and January sales are over. "
                  + (f"{plural(len(deals), 'model')} we track {'is' if len(deals) == 1 else 'are'} still cheaper than in "
                     f"early December." if deals else "None of the models we track is still cheaper than in early December."))
        deals_h, deals_empty = "Still cheaper than early December", "Nothing is meaningfully cheaper any more."
    deals_html = compare_table(deals[:40], "Early December") if deals else f'<p class="pp-card sb-empty">{deals_empty}</p>'
    raised_html = f"""<section class="pp-block">
  <h2>Watch out: dearer than in early December</h2>
  <p class="pp-small">These cost more now than they did in early December. A sale that brings them back down isn’t a saving.</p>
  {compare_table(raised[:15], "Early December")}
</section>""" if raised else ""
    watch_html = f"""<section class="pp-block">
  <h2>Prices we’re watching</h2>
  <p class="pp-small">The most widely stocked models in each category, with the early-December price we measure the sales against.</p>
  {compare_table(watch, "Early December")}
</section>""" if watch else ""
    faq_html, faq_schema = faq_block([
        (f"When are the Boxing Day golf sales in {year}?",
         f"Boxing Day is {day} 26 December {year}. Many UK retailers start their sales online on Boxing Day or a day or two "
         f"before, and some run well into January. We check prices every 6 hours throughout."),
        ("How do you know a Boxing Day golf deal is real?",
         "We compare the sale price with the model’s early-December price: the median of the lowest new, in-stock price we "
         "recorded from 1 to 20 December. A retailer’s own “was” price is not used."),
        ("What counts as cheaper on this page?",
         "At least £5 and 5% below the early-December price."),
    ])
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Boxing Day sales", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Boxing Day {year}</span>
  <h1>Golf Boxing Day and January sales {year} (UK): what’s really cheaper</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes what’s listed or the order.</p>
</section>
<section class="pp-block">
  <h2>{deals_h}</h2>
  <p class="pp-small">Early December: the median lowest new, in-stock price we recorded from 1 to 20 December. Today: the lowest now, checked every 6 hours.</p>
  {deals_html}
</section>
{raised_html}
{watch_html}
<section class="pp-block"><div class="pp-chips"><a class="pp-chip" href="/prices/black-friday/">Black Friday tracker</a><a class="pp-chip" href="/prices/christmas/">Christmas gift deals</a><a class="pp-chip" href="/prices/golf-gifts/">Gift ideas by budget</a></div></section>
{signup_box("Get the real deals by email", "Our Friday email lists the week’s genuine price drops, checked against our own price history.")}
{faq_html}
{method_note(today)}
</div>"""
    title = f"Golf Boxing Day Sales {year} UK: What's Really Cheaper | GolfPrice AI"
    desc = (f"Boxing Day and January {year + 1} golf sales checked against the prices we recorded in early December. "
            f"See what's genuinely cheaper on clubs, balls, rangefinders and more.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/boxing-day-sales/", body=body,
                      section="", schema=[crumbs_schema, faq_schema], noindex=False), len(deals)


# ---------------------------------------------------------------- Christmas
GIFT_MODEL_TYPES = {"ball", "gps-watch", "rangefinder", "launch-monitor", "putter", "wedge", "hybrid", "driver", "bag"}


def build_christmas(models, built, today, gift_slugs):
    year = today.year
    xmas = date(year, 12, 25)
    lowest = [m for m in models if m["slug"] in built and m["type"] in GIFT_MODEL_TYPES
              and (m.get("verdict") or {}).get("label") == "good"]
    lowest.sort(key=lambda m: (-len(m["retailers"]), m["minPrice"]))
    picks = _spread(lowest, lambda m: _brand_key(m["name"]), 12)
    cards = "".join(model_card(m) for m in picks)

    bf = black_friday_date(year)
    bf_html = ""
    if today > bf:
        _, deals, _ = compare_rows(models, built, today, date(year, 10, 1), date(year, 10, 31))
        if deals:
            bf_html = f"""<section class="pp-block">
  <h2>Still cheaper than before Black Friday</h2>
  <p class="pp-small">Compared with what each one cost in October. <a href="/prices/black-friday/">See the full Black Friday tracker</a>.</p>
  {compare_table(deals[:10], "October price")}
</section>"""
    if today > xmas:
        answer = (f"Christmas {year} is over, but these are still at the lowest prices we’ve tracked, handy if you’ve "
                  f"got money or vouchers to spend. The <a href=\"/prices/boxing-day-sales/\">Boxing Day sales tracker</a> "
                  f"shows which sale prices are real.")
    else:
        days_to = (xmas - today).days
        countdown = f"{plural(days_to, 'day')} to Christmas. " if days_to <= 100 else ""
        answer = (f"{countdown}<strong>{plural(len(lowest), 'golf gift idea')}</strong> "
                  f"{'is' if len(lowest) == 1 else 'are'} at the lowest price we’ve tracked right now, checked against our own "
                  f"price history, not a retailer’s “was” price.")
    balls = sorted(float(m["minPrice"]) for m in models if m["type"] == "ball" and m["slug"] in built)
    budget_cards = "".join(f"""<a class="pp-card pp-rel" href="/prices/{s}/"><span class="pp-rel-name">{esc(GIFT_PAGES[s]['h1'])}</span>
<span class="pp-sub">{esc(GIFT_PAGES[s]['intro'])}</span></a>""" for s in gift_slugs)
    faq_html, faq_schema = faq_block([
        ("What golf gifts can I get for under £25?",
         (f"A dozen golf balls start at {money(balls[0])}, and gloves, towels, tees and socks are all well under £25. "
          if balls else "Gloves, towels, tees and socks are all well under £25. ")
         + "See our golf gifts under £25 for live prices."),
        (f"Should I wait for Black Friday to buy golf Christmas presents?",
         f"Black Friday {year} is Friday {bf.day} November. Some prices do drop then, but not all of them. Our Black Friday "
         f"tracker compares those prices with October, so you can see whether waiting paid off for the gift you want."),
        ("When do I need to order for Christmas delivery?",
         "Each retailer sets its own last order dates, so check their delivery page before you order. Popular gifts can "
         "sell out in December even when the price is right."),
        ("Are any of these second-hand?", "No. Everything on this page is new stock from UK retailers."),
    ])
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Christmas", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Christmas {year}</span>
  <h1>Golf Christmas gifts {year} (UK): at their lowest price right now</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes the price or what we pick.</p>
</section>
<section class="pp-block">
  <h2>At the lowest price we’ve tracked</h2>
  {'<div class="sg-grid">' + cards + '</div>' if cards else '<p class="pp-card sb-empty">Nothing is at its lowest tracked price today. Try the budget guides below.</p>'}
</section>
{bf_html}
<section class="pp-block"><h2>Gift ideas by budget</h2><div class="pp-rel-grid">{budget_cards}</div></section>
{signup_box("Buying for Christmas?", "Our Friday email lists the week’s genuine price drops, so you can catch the right moment to buy.")}
{faq_html}
{method_note(today, gift=True)}
</div>"""
    title = f"Golf Christmas Gifts {year} UK: Best Prices Right Now | GolfPrice AI"
    desc = (f"Golf Christmas gift ideas at the lowest prices we've tracked, from balls and gloves to GPS watches and "
            f"rangefinders. Live UK prices, checked every 6 hours.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/christmas/", body=body, section="",
                      schema=[crumbs_schema, faq_schema], noindex=False), len(lowest)


# ---------------------------------------------------------------- gift guides
# (title, kind, matcher): kind "model" = price-page models of these types,
# kind "listing" = cheapest new in-stock listings of these product types.
GIFT_PAGES = {
    "golf-gifts-under-25": {
        "lo": 0, "hi": 25, "label": "under £25", "h1": "Golf gifts under £25",
        "intro": "Small things golfers actually use up: balls, gloves, tees and towels.",
        "sections": [("Golf balls (a dozen)", "model", {"ball"}),
                     ("Gloves", "listing", {"glove"}),
                     ("Tees, markers and divot tools", "listing", {"tee", "divot-tool"}),
                     ("Towels", "listing", {"towel"}),
                     ("Caps", "listing", {"cap"}),
                     ("Socks", "listing", {"socks"})]},
    "golf-gifts-under-50": {
        "lo": 25, "hi": 50, "label": "£25 to £50", "h1": "Golf gifts under £50",
        "intro": "A step up: premium balls, headcovers, umbrellas and practice kit.",
        "sections": [("Premium golf balls (a dozen)", "model", {"ball"}),
                     ("Headcovers", "listing", {"headcover"}),
                     ("Umbrellas", "listing", {"umbrella"}, {"exclude": r"holder|cover"}),
                     ("Practice kit", "listing", {"alignment-sticks", "mat", "ball-retriever"}, {"exclude": r"cover"}),
                     ("Caps and beanies", "listing", {"cap"}),
                     ("Belts", "listing", {"belt"})]},
    "golf-gifts-under-100": {
        "lo": 50, "hi": 100, "label": "£50 to £100", "h1": "Golf gifts under £100",
        "intro": "Clubs that suit almost anyone, plus trolleys, practice mats and warm layers.",
        "sections": [("Wedges, hybrids and fairway woods", "model", {"wedge", "hybrid", "wood"}),
                     ("Putters", "model", {"putter"}),
                     ("Push trolleys", "listing", {"pushcart"},
                      {"require": r"trolley|\bcart\b", "exclude": r"cover|seat|mitt|wheels\b|holder|\bbag|glove|umbrella|scorecard|accessor|battery"}),
                     ("Practice mats and nets", "listing", {"mat", "enclosure"}),
                     ("Hoodies and mid-layers", "listing", {"hoodie"}),
                     ("Speakers and gadgets", "listing", {"speaker", "sensor"})]},
    "golf-gifts-over-100": {
        "lo": 100, "hi": 600, "label": "£100 and up", "h1": "Big golf gifts: £100 and up",
        "intro": "The ones they won’t buy themselves: GPS watches, rangefinders, launch monitors and new clubs.",
        "sections": [("GPS watches", "model", {"gps-watch"}),
                     ("Rangefinders", "model", {"rangefinder"}),
                     ("Launch monitors", "model", {"launch-monitor"}),
                     ("Drivers", "model", {"driver"}),
                     ("Putters", "model", {"putter"}),
                     ("Golf bags", "model", {"bag"})]},
}
PER_SECTION = 6
MIN_GIFT_PRICE = 5.0  # a £1 bag of tees isn't much of a present


STOP_WORDS = {"golf", "the", "mens", "men", "s", "womens", "ladies", "with", "and", "new", "2025", "2026"}


def display_name(p):
    """Retailer names often carry the size and hand ("- S / Right Hand"),
    which the buyer picks on the retailer's page anyway."""
    n = p["name"].replace("\u200b", "").split(" - ")[0].strip()
    words = n.split()
    if len(words) > 1 and words[0].lower() == words[1].lower():  # "Ping Ping Icon..."
        n = " ".join(words[1:])
    if n.isupper():
        n = n.title()
    brand = (p.get("brand") or "").strip()
    if brand and brand.lower() not in n.lower():
        n = f"{brand} {n}"
    return n


def _tokens(name):
    import re
    return {w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in STOP_WORDS}


def _same_thing(a, b):
    ta, tb = _tokens(a), _tokens(b)
    if not (ta and tb):
        return False
    # A shared model code ("ct1", "tp5", "v6") means the same product.
    if any(any(c.isdigit() for c in w) and any(c.isalpha() for c in w) for w in ta & tb):
        return True
    return len(ta & tb) / len(ta | tb) >= 0.5


def _spread(items, brand_of, n, same=None):
    """Pick up to n items in their given order, one per brand first, then a
    second per brand only if there aren't enough brands. No brand is
    favoured: the order comes from value (price, stock, verdict), not from
    which brand it is."""
    out = []
    for cap in (1, 2):
        counts = defaultdict(int)
        for o in out:
            counts[brand_of(o)] += 1
        for it in items:
            if len(out) == n:
                return out
            if it in out or counts[brand_of(it)] >= cap:
                continue
            if same and any(same(it, o) for o in out):
                continue
            counts[brand_of(it)] += 1
            out.append(it)
    return out


def _brand_key(name_or_brand):
    b = brand_rank(name_or_brand)
    return b if b != 99 else (name_or_brand or "").split(" ")[0].lower()


def gift_models(models, built, types, lo, hi):
    ms = [m for m in models if m["type"] in types and m["slug"] in built and lo < m["minPrice"] <= hi]
    import re
    ms.sort(key=lambda m: (1 if re.search(WOMEN_RX, m["name"], re.I) else 0,
                           0 if (m.get("verdict") or {}).get("label") == "good" else 1,
                           -len(m["retailers"]), m["minPrice"]))
    return _spread(ms, lambda m: _brand_key(m["name"]), PER_SECTION, lambda a, b: _same_thing(a["name"], b["name"]))


def gift_listings(products, icons, lo, hi, rules=None):
    import re
    rules = rules or {}
    need = re.compile(rules["require"], re.I) if rules.get("require") else None
    skip = re.compile(rules["exclude"], re.I) if rules.get("exclude") else None
    cands = [p for p in products
             if p.get("icon") in icons and max(lo, MIN_GIFT_PRICE) < (p.get("salePrice") or 0) <= hi
             and (not need or need.search(p["name"])) and not (skip and skip.search(p["name"])) and p.get("inStock", True)
             and p.get("image") and p.get("affiliateUrl") and p.get("source") != "awin-callawaypreowned"
             and not p.get("condition") and p.get("audience") != "Junior" and (p.get("brand") or "").strip()]
    def score(p):
        ins = p.get("priceInsight") or {}
        at_low = ins.get("historicalLow") is not None and p["salePrice"] <= ins["historicalLow"] + 0.005 \
            and (ins.get("historicalHigh") or 0) > p["salePrice"] + 0.005
        known = 0 if brand_rank(p.get("brand") or p["name"]) != 99 else 1
        women = 1 if re.search(WOMEN_RX, p["name"], re.I) or p.get("audience") == "Female" else 0
        return (women, known, 0 if at_low else 1, -(p.get("retailerCount") or 1), p["salePrice"])
    cands.sort(key=score)
    cands = [dict(p, _display=display_name(p)) for p in cands[:400]]
    return _spread(cands, lambda p: p["brand"].strip().lower(), PER_SECTION,
                   lambda a, b: _same_thing(a["_display"], b["_display"]))


def model_card(m):
    good = (m.get("verdict") or {}).get("label") == "good"
    badge = '<span class="sg-badge">At its lowest tracked price</span>' if good else ""
    img = m.get("_image")
    pic = (f'<img src="{esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" '
           f'onerror="this.parentNode.classList.add(\'sg-noimg\');this.remove()">') if img else ""
    return f"""<a class="pp-card sg-card" href="/prices/{m['slug']}/">
  <span class="sg-img{'' if img else ' sg-noimg'}">{pic}</span>
  <span class="sg-name">{esc(m['name'])}</span>
  <span class="sg-price">from {money(m['minPrice'])}{per(m)}</span>
  <span class="pp-sub">{plural(len(m['retailers']), 'retailer')} · compare prices</span>{badge}
</a>"""


def listing_card(p):
    return f"""<a class="pp-card sg-card" href="{esc(p['affiliateUrl'])}" target="_blank" rel="sponsored nofollow noopener">
  <span class="sg-img"><img src="{esc(p['image'])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('sg-noimg');this.remove()"></span>
  <span class="sg-name">{esc(p['_display'])}</span>
  <span class="sg-price">{money(p['salePrice'])}</span>
  <span class="pp-sub">at {esc(retailer_name(p['source']))}</span>
</a>"""


# ---------------------------------------------------------------- gift finder
# What kind of gift each product type is (the finder's "What are they into?")
# and whether a non-golfer can buy it without knowing sizes or specs.
GIFT_KIND = {"ball": "round", "glove": "round", "tee": "round", "divot-tool": "round", "towel": "round",
             "headcover": "round", "umbrella": "round", "ball-retriever": "round", "pushcart": "round", "bag": "round",
             "cap": "clothing", "socks": "clothing", "belt": "clothing", "hoodie": "clothing",
             "alignment-sticks": "practice", "mat": "practice", "enclosure": "practice",
             "speaker": "gadget", "sensor": "gadget", "gps-watch": "gadget", "rangefinder": "gadget",
             "launch-monitor": "gadget",
             "wedge": "clubs", "hybrid": "clubs", "wood": "clubs", "putter": "clubs", "driver": "clubs"}
GIFT_CHECK = {"glove": "Check first: glove size and hand", "socks": "Check first: shoe size",
              "belt": "Check first: waist size", "hoodie": "Check first: clothing size",
              "wedge": "Check first: hand, loft and shaft", "hybrid": "Check first: hand, loft and shaft",
              "wood": "Check first: hand, loft and shaft", "driver": "Check first: hand, loft and shaft",
              "putter": "Check first: hand and putter length"}
GIFT_BAND = {"golf-gifts-under-25": "u25", "golf-gifts-under-50": "u50", "golf-gifts-under-100": "u100",
             "golf-gifts-over-100": "o100"}
GIFTS_FILE = PRICES_DIR.parent / "data" / "gifts.json"
HEART = ('<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2'
         'C1.2 8.6 3.3 5 6.8 5c2 0 3.6 1.1 5.2 3 1.6-1.9 3.2-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>')


def _gift_key(raw):
    import hashlib
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def gift_item_model(m, band):
    t = m["type"]
    verdict = (m.get("verdict") or {}).get("label")
    return {"key": _gift_key("m:" + m["slug"]), "name": m["name"], "price": round(float(m["minPrice"]), 2),
            "per": per(m).strip(), "href": f"/prices/{m['slug']}/", "ext": False, "img": m.get("_image") or "",
            "kind": GIFT_KIND.get(t, "round"), "check": GIFT_CHECK.get(t, ""), "band": band,
            "verdict": verdict if verdict in ("good", "wait") else "",
            "sub": f"{plural(len(m['retailers']), 'retailer')} · compare prices"}


def gift_item_listing(p, band):
    icon = p.get("icon")
    return {"key": _gift_key("p:" + p["id"]), "name": p["_display"], "price": round(float(p["salePrice"]), 2),
            "per": "", "href": p["affiliateUrl"], "ext": True, "img": p.get("image") or "",
            "kind": GIFT_KIND.get(icon, "round"), "check": GIFT_CHECK.get(icon, ""), "band": band, "verdict": "",
            "sub": f"at {retailer_name(p['source'])}"}


def gift_card(it):
    link_attrs = ' target="_blank" rel="sponsored nofollow noopener"' if it["ext"] else ""
    pic = (f'<img src="{esc(it["img"])}" alt="" loading="lazy" referrerpolicy="no-referrer" '
           f'onerror="this.parentNode.classList.add(\'sg-noimg\');this.remove()">') if it["img"] else ""
    tag = (f'<span class="gf-tag gf-check">{esc(it["check"])}</span>' if it["check"]
           else '<span class="gf-tag gf-safe">Gift-safe</span>')
    if it["verdict"] == "good":
        tag += '<span class="gf-tag gf-good">Good price today</span>'
    elif it["verdict"] == "wait":
        tag += '<span class="gf-tag gf-wait">Usually cheaper: maybe wait</span>'
    price = money(it["price"]) + (f' <small>{esc(it["per"])}</small>' if it["per"] else "")
    return f"""<article class="pp-card sg-card gf-card" data-key="{it['key']}" data-band="{it['band']}" data-kind="{it['kind']}" data-safe="{0 if it['check'] else 1}" data-name="{esc(it['name'])}" data-price="{money(it['price'])}">
  <a class="gf-link" href="{esc(it['href'])}"{link_attrs}>
    <span class="sg-img{'' if it['img'] else ' sg-noimg'}">{pic}</span>
    <span class="sg-name">{esc(it['name'])}</span>
    <span class="sg-price">{price}</span>
    <span class="pp-sub">{esc(it['sub'])}</span>
  </a>
  <span class="gf-tags">{tag}</span>
  <span class="gf-actions"><button type="button" class="gf-hint">Drop a hint</button><button type="button" class="gf-save" aria-pressed="false" aria-label="Save {esc(it['name'])} to your wishlist">{HEART}</button></span>
</article>"""


def wish_bar():
    return """<div class="gf-bar" hidden>
  <span class="gf-bar-count">Your wishlist: <b>0</b></span>
  <label class="gf-bar-name"><span>Your first name (optional)</span><input type="text" maxlength="20" autocomplete="given-name" placeholder="e.g. Sam"></label>
  <button type="button" class="gp-af-btn gf-send">Send it as a hint</button>
  <button type="button" class="gf-clear">Clear list</button>
</div>"""


def build_wishlist_page(today):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Golf gifts", "/prices/golf-gifts/"),
                                             ("Wishlist", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top" id="gf-wishlist">
  <span class="sb-kicker">Hint, hint</span>
  <h1 class="gf-wl-title">A golf wishlist for you</h1>
  <p class="pp-answer">Someone saved these on GolfPrice AI and sent you the list. The prices are today’s lowest across multiple UK retailers, checked every 6 hours, and we’ll tell you whether now is a good time to buy.</p>
  <p class="pp-disclose">We may earn a commission if you buy through these links. It never changes the price or what we show.</p>
</section>
<section class="pp-block">
  <ol class="gf-wl-list"></ol>
  <p class="pp-card sb-empty gf-wl-empty" hidden>This list is empty or has expired. Have a look at our <a href="/prices/golf-gifts/">golf gift ideas</a> instead.</p>
</section>
{signup_box("Not buying today?", "Our Friday email lists the week’s genuine price drops, checked against our own price history. For one item, use “Email me if it drops” on its price page.")}
<section class="pp-block"><p>Buying for a golfer and want more ideas? <a href="/prices/golf-gifts/">Try the gift finder</a>.</p></section>
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261018d" defer></script>"""
    return page_shell(title="A golf wishlist for you | GolfPrice AI",
                      description="Hint, hint: a golfer’s wishlist, with today’s lowest UK prices and whether it’s a good time to buy.",
                      canonical=f"{SITE}/wishlist/", body=body, section="", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/photos/golf-gifts.jpg",
                      extra_head='<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="750">\n'
                                 '<meta property="og:image:alt" content="Golf gifts: balls, tees, a glove and a wrapped present">\n')


def build_gift_page(slug, cfg, models, built, products, images, today, all_slugs):
    sections, total, items = [], 0, []
    band = GIFT_BAND[slug]
    for title, kind, types, *rules in cfg["sections"]:
        if kind == "model":
            found = gift_models(models, built, types, cfg["lo"], cfg["hi"])
            for m in found:
                m["_image"] = next((images[i] for i in m.get("listingIds", []) if images.get(i)), None)
            its = [gift_item_model(m, band) for m in found]
        else:
            found = gift_listings(products, types, cfg["lo"], cfg["hi"], rules[0] if rules else None)
            its = [gift_item_listing(p, band) for p in found]
        if len(its) < 2:
            continue
        total += len(its)
        items += its
        sections.append(f'<section class="pp-block"><h2>{esc(title)}</h2><div class="sg-grid">{"".join(gift_card(i) for i in its)}</div></section>')
    if total < 8:
        return None, []
    nav = "".join(f'<a class="pp-chip{" sg-on" if s == slug else ""}" href="/prices/{s}/">{esc(GIFT_PAGES[s]["label"])}</a>'
                  for s in all_slugs)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Golf gifts", "/prices/golf-gifts/"),
                                             (cfg["h1"], None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Gift guide · updated {long_date(today)}</span>
  <h1>{esc(cfg['h1'])}</h1>
  <p class="pp-answer">{esc(cfg['intro'])} Every price is live from UK retailers, checked every 6 hours, and nothing here is second-hand.</p>
  <div class="pp-chips sg-budgets"><span class="pp-sub">Budget:</span>{nav}</div>
  <p class="pp-disclose">We may earn a commission if you buy through these links. It never changes the price or what we pick.</p>
</section>
{wish_bar()}
{''.join(sections)}
<section class="pp-block"><p class="pp-small">“Gift-safe” means no sizes, hand or club specs to guess. Save anything with the heart, then send your list to whoever’s buying with “Send it as a hint”.</p></section>
<section class="pp-block"><p class="pp-small">How we pick: well-known brands, in stock and new, one per brand where we can so you get a real choice, ordered by price and value, never by brand. Clubs, balls and gadgets link to our price pages so you can compare every retailer; smaller items link straight to the cheapest retailer we found.</p></section>
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261018d" defer></script>"""
    title = f"{cfg['h1']} (UK, {today.year}): {total} Ideas at Today's Prices | GolfPrice AI"
    desc = (f"{cfg['h1']}: {total} ideas from UK retailers, with live prices checked every 6 hours. "
            f"New stock only, from brands golfers actually use.")
    return page_shell(title=title, description=desc, canonical=f"{SITE}/prices/{slug}/", body=body, section="",
                      schema=[crumbs_schema], noindex=False), items


def _finder_chips(group, opts):
    return "".join(f'<button type="button" class="pp-chip gf-chip{" sg-on" if i == 0 else ""}" data-group="{group}" '
                   f'data-v="{v}" aria-pressed="{"true" if i == 0 else "false"}">{esc(label)}</button>'
                   for i, (v, label) in enumerate(opts))


def _interleave(items):
    """Mix the budgets and kinds so the unfiltered list isn't 24 golf balls."""
    groups = defaultdict(list)
    for it in items:
        groups[(it["band"], it["kind"])].append(it)
    out, lists = [], list(groups.values())
    while any(lists):
        for l in lists:
            if l:
                out.append(l.pop(0))
    return out


def build_gift_index(built_slugs, today, items):
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Golf gifts", None)])
    cards = "".join(f"""<a class="pp-card pp-rel" href="/prices/{s}/"><span class="pp-rel-name">{esc(GIFT_PAGES[s]['h1'])}</span>
<span class="pp-sub">{esc(GIFT_PAGES[s]['intro'])}</span></a>""" for s in built_slugs)
    seen, uniq = set(), []
    for it in items:
        if it["key"] not in seen:
            seen.add(it["key"])
            uniq.append(it)
    results = "".join(gift_card(it) for it in _interleave(uniq))
    faq_html, faq_schema = faq_block([
        ("What does “Gift-safe” mean?",
         "You don’t need to know their sizes, which hand they play or their club specs: golf balls, rangefinders, GPS "
         "watches, towels, umbrellas, trolleys and practice kit. Gloves, clothing and clubs say “Check first” and what to find out."),
        ("How does “Drop a hint” work?",
         "Save the gifts you’d like with the heart, then tap “Send it as a hint”. It opens WhatsApp or your phone’s share "
         "menu with a link to your list, showing today’s prices. We never email anyone on your behalf."),
        ("Are the prices up to date?",
         "Yes. We check every listing at the UK retailers we track every 6 hours. Prices can change on the retailer’s site, "
         "so check there before you buy."),
    ])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Gift guide · updated {long_date(today)}</span>
  <h1>Golf gifts for the golfer in your life</h1>
  <p class="pp-answer">Not a golfer yourself? Answer three quick questions and we’ll show gifts golfers actually use, at today’s lowest UK price across multiple UK retailers, and whether now is a good time to buy. New stock only, and no made-up “was” prices.</p>
  <p class="pp-disclose">We may earn a commission if you buy through these links. It never changes the price or what we pick.</p>
</section>
<section class="pp-block gf-finder" aria-labelledby="gf-h">
  <h2 id="gf-h">Gift finder</h2>
  <div class="gf-q"><span class="gf-q-label">1. What would you like to spend?</span><div class="pp-chips">{_finder_chips("band", [("any", "Any budget"), ("u25", "Under £25"), ("u50", "£25 to £50"), ("u100", "£50 to £100"), ("o100", "£100 and up")])}</div></div>
  <div class="gf-q"><span class="gf-q-label">2. What are they into?</span><div class="pp-chips">{_finder_chips("kind", [("any", "Not sure"), ("round", "Every-round kit"), ("gadget", "Gadgets"), ("practice", "Practice at home"), ("clothing", "Clothing"), ("clubs", "Clubs")])}</div></div>
  <div class="gf-q"><span class="gf-q-label">3. Do you know their glove size, clothing size and which hand they play?</span><div class="pp-chips">{_finder_chips("safe", [("1", "No, keep it simple"), ("any", "Yes, I know them")])}</div></div>
</section>
<section class="pp-block" id="gf-results" aria-live="polite">
  <h2 class="gf-count">Gift ideas</h2>
  {wish_bar()}
  <div class="sg-grid gf-grid">{results}</div>
  <p class="pp-card sb-empty gf-none" hidden>Nothing matches all three answers. Try a different budget.</p>
  <button type="button" class="pp-chip gf-more" hidden>Show more</button>
</section>
<section class="pp-block"><h2>Or browse by budget</h2><div class="pp-rel-grid">{cards}</div></section>
{signup_box("Buying for Christmas?", "Our Friday email lists the week’s genuine price drops, so you can catch the right moment to buy.")}
{faq_html}
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261018d" defer></script>"""
    return page_shell(title=f"Golf Gift Ideas UK {today.year}: Gift Finder at Live Prices | GolfPrice AI",
                      description="Golf gift ideas for non-golfers: a 3-question gift finder, “gift-safe” picks that need no sizes, and live UK prices checked every 6 hours.",
                      canonical=f"{SITE}/prices/golf-gifts/", body=body, section="", schema=[crumbs_schema, faq_schema], noindex=False)


# ---------------------------------------------------------------- entry point
SEASONAL_SLUGS = ["black-friday", "boxing-day-sales", "christmas", "golf-gifts"] + list(GIFT_PAGES)


def build(passing, built, products, today):
    """Returns (changed urls, sitemap entries, seasonal hub links for the /prices/ page)."""
    changed, sitemap, links = [], [], []
    images = {p["id"]: p.get("image") for p in products if p.get("image")}
    page, n_deals = build_black_friday(passing, built, today, images)
    if _write(PRICES_DIR / "black-friday" / "index.html", page):
        changed.append("/prices/black-friday/")
    sitemap.append(("prices/black-friday/", today.isoformat()))
    links.append(("/prices/black-friday/", f"Black Friday {today.year}", "Real deals only, checked against October prices"))
    made, gift_items = [], []
    for slug, cfg in GIFT_PAGES.items():
        page, its = build_gift_page(slug, cfg, passing, built, products, images, today, list(GIFT_PAGES))
        gift_items += its
        if page:
            made.append(slug)
            if _write(PRICES_DIR / slug / "index.html", page):
                changed.append(f"/prices/{slug}/")
            sitemap.append((f"prices/{slug}/", today.isoformat()))
    for m in passing:
        if m.get("_image") is None and m["type"] in GIFT_MODEL_TYPES:
            m["_image"] = next((images[i] for i in m.get("listingIds", []) if images.get(i)), None)
    page, n_xmas = build_christmas(passing, built, today, made)
    if _write(PRICES_DIR / "christmas" / "index.html", page):
        changed.append("/prices/christmas/")
    sitemap.append(("prices/christmas/", today.isoformat()))
    links.append(("/prices/christmas/", f"Christmas {today.year}", "Golf gifts at the lowest prices we’ve tracked"))
    page, n_box = build_boxing_day(passing, built, today)
    if _write(PRICES_DIR / "boxing-day-sales" / "index.html", page):
        changed.append("/prices/boxing-day-sales/")
    sitemap.append(("prices/boxing-day-sales/", today.isoformat()))
    links.append(("/prices/boxing-day-sales/", "Boxing Day sales", "Sale prices checked against early December"))
    if made:
        if _write(PRICES_DIR / "golf-gifts" / "index.html", build_gift_index(made, today, gift_items)):
            changed.append("/prices/golf-gifts/")
        # Shared wishlists live at the short address golfpriceai.com/wishlist/ ;
        # the older address keeps working for links already sent.
        wl = build_wishlist_page(today)
        _write(PRICES_DIR.parent / "wishlist" / "index.html", wl)
        _write(PRICES_DIR / "golf-gifts" / "wishlist" / "index.html", wl)
        # Data for shared wishlists (/prices/golf-gifts/wishlist/?i=...): product details only, no personal data.
        gifts = {it["key"]: {k: it[k] for k in ("name", "price", "per", "href", "ext", "img", "check", "verdict", "sub")}
                 for it in gift_items}
        _write(GIFTS_FILE, json.dumps(gifts, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
        sitemap.append(("prices/golf-gifts/", today.isoformat()))
        links.append(("/prices/golf-gifts/", "Golf gift ideas", "By budget, from under £25 to £100 and up"))
    print(f"Seasonal pages: Black Friday ({n_deals} model(s) cheaper than October), Christmas ({n_xmas} gift(s) at "
          f"their lowest), Boxing Day ({n_box} cheaper than early December), {len(made)} gift page(s).")
    return changed, sitemap, links
