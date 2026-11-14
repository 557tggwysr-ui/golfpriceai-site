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


def build_black_friday(models, built, today, images=None, cyber_page=False):
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
        answer = (f"Black Friday {year} is <strong>{bf_txt}</strong>. We record UK golf prices "
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
    if cyber_page:
        cm_txt = f"Monday {cyber.day} November {year}"
        answer = (f"Cyber Monday {year} is <strong>{cm_txt}</strong>, the last day of the Black Friday sales. "
                  + (f"Right now {n_txt}, checked against the prices we recorded ourselves every 6 hours. A retailer’s “was” price never counts."
                     if deals else "We’re checking every 6 hours: genuine deals appear here as soon as prices drop."))
        if phase == "after":
            answer = (f"Cyber Monday {year} ({cm_txt}) is over, but some savings stuck. "
                      + (f"Today {n_txt}." if deals else "Nothing we track is still meaningfully cheaper than in October."))
        deals_h = "Cyber Monday golf deals: cheaper than in October" if phase != "after" else "Still cheaper than in October"
        faq_html, faq_schema = faq_block([
            (f"When is Cyber Monday {year} in the UK?",
             f"{cm_txt}, three days after Black Friday ({bf_txt}). Most UK golf retailers run their Black Friday prices through to Cyber Monday night."),
            ("Are Cyber Monday golf deals better than Black Friday?",
             "Usually they’re the same deals, and some sell out over the weekend. A few retailers add last-chance offers on the Monday. "
             "This list shows what’s genuinely cheaper than in October right now, whichever day it is."),
            ("How do you know a Cyber Monday golf deal is real?",
             "We compare today’s lowest UK price with the typical lowest price we recorded for the same model in October, checking every 6 hours. "
             "It has to be at least £5 and 5% cheaper. A retailer’s own “was” or RRP price is never used."),
        ])
    sub_html = BF_SUB_LINKS.get("html", "")
    ev = "Cyber Monday" if cyber_page else "Black Friday"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), (ev, None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">{ev} {year} · {f"Monday {cyber.day} November {year}" if cyber_page else bf_txt}</span>
  <h1>{f"Cyber Monday golf deals {year} (UK): genuinely cheaper, checked" if cyber_page else f"Black Friday golf deals {year} (UK): genuinely cheaper, checked"}</h1>
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
{sub_html}
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
<script src="/js/gift-finder.js?v=20261111b" defer></script>"""
    title = f"Black Friday Golf Deals {year} UK: Genuinely Cheaper, Checked | GolfPrice AI"
    desc = (f"Black Friday golf deals {year} in the UK that are genuinely cheaper than in October, with the saving on each. "
            f"Drivers, putters, golf balls, bags, rangefinders and launch monitors, checked every 6 hours.")
    canon = f"{SITE}/prices/black-friday/"
    if cyber_page:
        title = f"Cyber Monday Golf Deals {year} UK: Genuinely Cheaper, Checked | GolfPrice AI"
        desc = (f"Cyber Monday golf deals {year} in the UK that are genuinely cheaper than in October: "
                f"{len(deals)} golf models with the real saving on each, from drivers and golf balls to rangefinders. Checked every 6 hours.")
        canon = f"{SITE}/prices/cyber-monday/"
    build_black_friday.last = dict(deals=deals, rows=rows, phase=phase, bf=bf, cyber=cyber)
    return page_shell(title=title, description=desc, canonical=canon, body=body,
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
        answer = (f"<strong>{plural(len(lowest), 'golf gift idea')}</strong> "
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
{cheat_box()}
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
        "lo": 0, "hi": 25, "label": "under £25", "h1": "Golf stocking fillers & Secret Santa gifts under £25",
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
  <a class="gf-bar-cs" href="/cheat-sheet/">Add your glove, ball and sizes</a>
</div>"""


GLOVE_SIZES = ["S", "M", "M/L", "L", "XL", "XXL", "Cadet S", "Cadet M", "Cadet M/L", "Cadet L", "Cadet XL"]
SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"]


def _opts(values, blank="Not sure"):
    return f'<option value="">{blank}</option>' + "".join(f'<option value="{esc(v)}">{esc(v)}</option>' for v in values)


ASK_TEXT = "Sorting a golf present for you (no peeking). Can you fill this in so I get your glove, ball and size right? It takes a minute:"


def cheat_ask_href():
    from urllib.parse import quote
    return "https://wa.me/?text=" + quote(ASK_TEXT + " " + SITE + "/cheat-sheet/?ask=1")


def cheat_box(context="gift"):
    """The Cheat Sheet box on gift, Christmas and glove/ball/shoe pages: the buyer
    asks the golfer for their sizes (WhatsApp, or the share menu via
    js/gift-finder.js), or the golfer makes their own. Plain links, so it works
    and is crawlable without JavaScript."""
    lead = {
        "glove": "Buying a glove as a present? You need their hand and their size, and most people guess both.",
        "ball": "Golf balls are the safest golf gift, but only in the model they actually play.",
        "shoes": "Buying golf shoes as a present? Sizes vary by brand, so get theirs first.",
    }.get(context, "Not a golfer yourself? Get their glove hand and size, their ball and their sizes straight from them.")
    return f"""<section class="pp-block cs-box" id="cheat-sheet">
  <div class="cs-box-copy"><span class="sb-kicker">The golf gift Cheat Sheet</span>
  <h2>Buying for a golfer? Ask for their Cheat Sheet</h2>
  <p>{esc(lead)} One tap sends them a message; they fill in their glove, ball and sizes and send it back. It fits first time, and the surprise stays a surprise.</p></div>
  <div class="cs-box-btns"><a class="gp-af-btn cs-ask" href="{esc(cheat_ask_href())}" target="_blank" rel="noopener">Ask for their Cheat Sheet</a>
  <a class="cs-own" href="/cheat-sheet/">I’m the golfer: make mine</a></div>
</section>"""


def build_cheat_page(today):
    """The Cheat Sheet (/cheat-sheet/): a golfer saves their glove, ball and
    sizes once and sends one link to whoever is buying their present, or a
    buyer asks the golfer for it (?ask=1). Everything stays in the browser and
    in the link itself (js/gift-finder.js); nothing is sent to us. Written
    around what gift-buyers search for (Nov 2026 research): what to buy a
    golfer, which hand a golf glove goes on, what size, which ball."""
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Golf gifts", "/prices/golf-gifts/"),
                                             ("Cheat Sheet", None)])
    shoes = [f"{n:g}" for n in [x / 2 for x in range(10, 30)]]
    waists = [str(n) for n in range(28, 48, 2)]
    faq_html, faq_schema = faq_block([
        ("What should I buy a golfer if I don’t play golf?",
         "Something they use up or always need: a dozen of the golf ball they already play, a glove in their hand and size, tees, a towel, "
         "or a rangefinder or GPS watch for a bigger present. The catch is knowing their ball, glove and sizes, which is what the Cheat Sheet is for."),
        ("Which hand does a golf glove go on?",
         "Right-handed golfers wear their glove on the left hand, and left-handed golfers wear it on the right. So a right-handed golfer needs a left-hand glove."),
        ("What size golf glove should I buy?",
         "Golf gloves come in sizes like S, M, M/L, L and XL, and the size is usually printed inside the glove near the wrist. Check a glove in their bag, "
         "or ask them to fill in the Cheat Sheet. Sizes vary a little between brands."),
        ("What is a Cadet golf glove?",
         "A Cadet size has shorter fingers and a wider palm than the standard size with the same letter. If a normal glove leaves spare material at the fingertips, try Cadet."),
        ("Are golf balls a good present?",
         "Yes, they’re the safest golf gift, as long as you buy the model they play: golfers stick to one ball. The model name is printed on every ball, so check their bag or ask."),
        ("What do you buy a golfer who has everything?",
         "Something they wouldn’t buy themselves: an upgrade to a rangefinder or GPS watch, a launch monitor for practice at home, or a dozen of their usual premium balls."),
        ("What are good golf stocking fillers or Secret Santa gifts?",
         "Golf balls, tees, ball markers, a towel, a cap or a beanie: see golf stocking fillers and Secret Santa gifts under £25 at golfpriceai.com/prices/golf-gifts-under-25/."),
        ("Is my information stored anywhere?",
         "No. Your sizes are kept in this browser and written into the link you send. We don’t store them, and there’s no sign-up."),
    ])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">The golf gift Cheat Sheet · free, no sign-up</span>
  <h1>Golf gifts that fit first time: glove hand, size and ball, sorted</h1>
  <p class="pp-answer">Buying for a golfer? The three things to know are which hand their glove goes on, what size it is and which golf ball they play. Ask them to fill in their Cheat Sheet, or if you’re the golfer, fill it in below and send it to whoever’s buying.</p>
  <div class="cs-ask-note" hidden><b>Someone’s buying you a golf present.</b> Fill this in, then tap “Send it back” so they get it right. No peeking at what it is.</div>
  <div class="cs-box-btns"><a class="gp-af-btn cs-ask" href="{esc(cheat_ask_href())}" target="_blank" rel="noopener">I’m buying: ask them for theirs</a>
  <a class="cs-own" href="#cs-form">I’m the golfer: fill mine in</a></div>
</section>
<section class="pp-block cs-quick">
  <h2>Quick answers for gift-buyers</h2>
  <dl class="cs-dl">
    <div><dt>Which hand does the glove go on?</dt><dd>Right-handed golfers wear a <b>left-hand</b> glove. Left-handed golfers wear a <b>right-hand</b> glove.</dd></div>
    <div><dt>What size glove?</dt><dd>It’s usually printed inside the glove, near the wrist. Check one in their bag: S, M, M/L, L, XL, or “Cadet” for shorter fingers.</dd></div>
    <div><dt>Which golf ball?</dt><dd>The model name is printed on every ball. A dozen of the one they already play is the safest golf gift there is.</dd></div>
    <div><dt>Golf shoes?</dt><dd>Most match their normal shoe size, but some brands run large or small. The size is inside the tongue of their current pair.</dd></div>
  </dl>
</section>
<form class="pp-block cs-form" id="cs-form" novalidate>
  <h2>Fill in your Cheat Sheet</h2>
  <div class="cs-grid">
    <label>Your first name (optional)<input name="for" maxlength="20" autocomplete="given-name" placeholder="e.g. Sam"></label>
    <label>Glove goes on my<select name="gh"><option value="">Not sure</option><option value="L">Left hand (most right-handed golfers)</option><option value="R">Right hand (most left-handed golfers)</option></select></label>
    <label>Glove size<select name="gs">{_opts(GLOVE_SIZES)}</select></label>
    <label>My golf ball<input name="b" maxlength="40" placeholder="e.g. Titleist Pro V1, white"></label>
    <label>Shirt size<select name="sh">{_opts(SHIRT_SIZES)}</select></label>
    <label>Trouser waist (inches)<select name="w">{_opts(waists)}</select></label>
    <label>Trouser leg<select name="lg"><option value="">Not sure</option><option value="S">Short</option><option value="R">Regular</option><option value="L">Long</option></select></label>
    <label>Shoe size (UK)<select name="sz">{_opts(shoes)}</select></label>
  </div>
  <label class="cs-wide">Please don’t buy me (optional)<input name="no" maxlength="60" placeholder="e.g. novelty balls, another umbrella"></label>
  <p class="cs-wish"></p>
  <div class="cs-btns"><button type="submit" class="gp-af-btn cs-send">Send my Cheat Sheet</button><a class="cs-preview" href="/wishlist/">See what they’ll see</a></div>
  <p class="pp-small">Saved in this browser and written into the link you send. We never store your sizes, and there’s no sign-up.</p>
</form>
<section class="pp-block"><p>Want to add gifts too? Save them with the heart on our <a href="/prices/golf-gifts/">golf gift ideas</a>, and they’re added to your Cheat Sheet automatically. Small budget? See <a href="/prices/golf-gifts-under-25/">golf stocking fillers and Secret Santa gifts under £25</a>, or the guides to <a href="/prices/golf-gloves/">golf gloves</a>, <a href="/prices/golf-balls/">golf balls</a> and <a href="/prices/golf-shoes/">golf shoes</a>.</p></section>
{faq_html}
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261111b" defer></script>"""
    return page_shell(title="What to Buy a Golfer: Glove Hand, Size & Ball | Cheat Sheet",
                      description="Buying golf gifts when you don’t play? Which hand a golf glove goes on, what size, which ball: ask the golfer for their free Cheat Sheet, or fill in yours.",
                      canonical=f"{SITE}/cheat-sheet/", body=body, section="", schema=[crumbs_schema, faq_schema],
                      noindex=False, og_image="/assets/cards/cheat-sheet.jpg",
                      extra_head='<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
                                 '<meta property="og:image:alt" content="The golf gift Cheat Sheet: glove hand and size, golf ball and sizes">\n')


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
<section class="pp-block cs-sheet" hidden>
  <h2 class="cs-sheet-h">The Cheat Sheet</h2>
  <p class="pp-sub">Their sizes, so it fits first time. Tap a line to see today’s lowest UK prices.</p>
  <ul class="cs-rows"></ul>
  <p class="cs-no" hidden></p>
</section>
<section class="pp-block">
  <ol class="gf-wl-list"></ol>
  <p class="pp-card sb-empty gf-wl-empty" hidden>This list is empty or has expired. Have a look at our <a href="/prices/golf-gifts/">golf gift ideas</a> instead.</p>
</section>
{signup_box("Not buying today?", "Our Friday email lists the week’s genuine price drops, checked against our own price history. For one item, use “Email me if it drops” on its price page.")}
<section class="pp-block"><p>Buying for a golfer and want more ideas? <a href="/prices/golf-gifts/">Try the gift finder</a>. A golfer yourself? <a href="/cheat-sheet/">Make your own Cheat Sheet</a>.</p></section>
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261111b" defer></script>"""
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
{cheat_box()}
<section class="pp-block"><p class="pp-small">“Gift-safe” means no sizes, hand or club specs to guess. Save anything with the heart, then send your list to whoever’s buying with “Send it as a hint”.</p></section>
<section class="pp-block"><p class="pp-small">How we pick: well-known brands, in stock and new, one per brand where we can so you get a real choice, ordered by price and value, never by brand. Clubs, balls and gadgets link to our price pages so you can compare every retailer; smaller items link straight to the cheapest retailer we found.</p></section>
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261111b" defer></script>"""
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
    low = money(min(it["price"] for it in uniq)) if uniq else "£5"
    faq_html, faq_schema = faq_block([
        ("What are good inexpensive golf gifts?",
         f"Golf balls, gloves, tees, ball markers, towels and caps: golfers get through them, and they start from {low} here. "
         "See golf gifts under £25 for the full list, each at today’s lowest UK price."),
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
  <h1>Golf gifts UK: ideas from {low}, with a gift finder</h1>
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
{cheat_box()}
<section class="pp-block"><h2>Or browse by budget</h2><div class="pp-rel-grid">{cards}</div></section>
{signup_box("Buying for Christmas?", "Our Friday email lists the week’s genuine price drops, so you can catch the right moment to buy.")}
{faq_html}
{method_note(today)}
</div>
<script src="/js/gift-finder.js?v=20261111b" defer></script>"""
    return page_shell(title=f"Golf Gifts UK {today.year}: Gift Finder & Ideas from {low} | GolfPrice AI",
                      description=f"Golf gifts for every budget, from inexpensive gifts under £25 to gadgets: a 3-question golf gift finder, gift-safe picks that need no sizes, and live UK prices from {low}.",
                      canonical=f"{SITE}/prices/golf-gifts/", body=body, section="", schema=[crumbs_schema, faq_schema], noindex=False)


# ---------------------------------------------------------------- the Black Friday report
# "How many Black Friday golf deals were real?", worked out from our own price
# history: each model's typical October price against its lowest price from the
# Monday of Black Friday week to Cyber Monday. Appears on Black Friday ("so far"),
# final from the day after Cyber Monday, and stays up as that year's record.
# Told the positive way: what WAS genuinely cheaper, and by how much.
def bf_report_data(models, built, today):
    year = today.year
    bf = black_friday_date(year)
    start, end = bf - timedelta(days=4), bf + timedelta(days=3)
    upto = min(end, today)
    out = []
    tracked = 0
    for m in models:
        if m["slug"] not in built:
            continue
        base = baseline_price(m, date(year, 10, 1), date(year, 10, 31), today)
        if not base:
            continue
        days = daily_prices(m.get("history"), today)
        if start <= today <= end:
            days[today] = float(m["minPrice"])
        win = {d: p for d, p in days.items() if start <= d <= upto}
        if not win:
            continue
        low = min(win.values())
        if not 0.5 <= low / base <= 1.5:
            continue
        tracked += 1
        if base - low < max(5, base * 0.05):
            continue
        when = min(d for d, p in win.items() if p == low)
        before = [p for d, p in days.items() if d < start]
        out.append({"m": m, "base": base, "low": low, "save": base - low, "pct": round((base - low) / base * 100),
                    "when": when, "ever": not before or low <= min(before)})
    out.sort(key=lambda r: -r["save"])
    return {"year": year, "bf": bf, "start": start, "end": end, "final": today > end, "tracked": tracked, "deals": out}


def build_bf_report(models, built, today):
    D = bf_report_data(models, built, today)
    year, bf, start, end, deals = D["year"], D["bf"], D["start"], D["end"], D["deals"]
    if today < bf or not D["tracked"]:
        return None
    n, tr = len(deals), D["tracked"]
    share = round(n / tr * 100) if tr else 0
    saves = [r["save"] for r in deals]
    avg = statistics.mean(saves) if saves else 0
    med_pct = statistics.median([r["pct"] for r in deals]) if deals else 0
    ever = sum(1 for r in deals if r["ever"])
    # by category
    cats = {}
    for r in deals:
        c = cats.setdefault(r["m"]["type"], [])
        c.append(r)
    cat_rows = sorted(cats.items(), key=lambda kv: -len(kv[1]))
    # the day each deal was at its lowest
    day_count = {}
    for r in deals:
        day_count[r["when"]] = day_count.get(r["when"], 0) + 1
    best_day = max(day_count.items(), key=lambda kv: kv[1]) if day_count else None
    on_bf = day_count.get(bf, 0)
    on_cm = day_count.get(end, 0)
    early = sum(v for d, v in day_count.items() if d < bf)
    status = "Final figures" if D["final"] else f"So far (updated every 6 hours until Cyber Monday, {end.day} November)"
    window = f"Monday {start.day} November and Cyber Monday {end.day} November {year}"
    def dname(d):
        return "Black Friday" if d == bf else "Cyber Monday" if d == end else d.strftime("%A") + f" {d.day} November"
    headline = (f"{n} golf models were genuinely cheaper than in October this Black Friday"
                if D["final"] else f"So far, {n} golf models are genuinely cheaper than in October this Black Friday")
    big = deals[0] if deals else None
    stats = [
        (f"{n:,}", f"golf models genuinely cheaper than their own October price ({share}% of the {tr:,} we tracked)"),
        (money(avg), f"average real saving; the typical deal was {med_pct:.0f}% off"),
        (f"{ever:,}", "of them hit the lowest price we've ever tracked"),
    ]
    if big:
        stats.append((money(big["save"]), f"biggest saving: the {big['m']['name']}"))
    stat_html = "".join(f'<div class="pp-card bfr-stat"><b>{esc(a)}</b><span>{esc(b)}</span></div>' for a, b in stats)
    cat_html = "".join(
        f"<tr><th scope=\"row\"><a href=\"/prices/black-friday/{TYPES[t][0]}/\">{esc(TYPES[t][1])}</a></th><td>{len(rs)}</td>"
        f"<td>{money(statistics.mean(r['save'] for r in rs))}</td><td>{esc(max(rs, key=lambda r: r['save'])['m']['name'])} ({money(max(r['save'] for r in rs))})</td></tr>"
        for t, rs in cat_rows)
    top_html = "".join(
        f"<tr><th scope=\"row\"><a href=\"/prices/{r['m']['slug']}/\">{esc(r['m']['name'])}</a></th><td>{money(r['base'])}{per(r['m'])}</td>"
        f"<td class=\"pp-price\">{money(r['low'])}{per(r['m'])}</td><td class=\"bf-save\">{money(r['save'])} ({r['pct']}%)</td><td>{esc(dname(r['when']))}</td></tr>"
        for r in deals[:25])
    when_line = ""
    if best_day:
        when_line = (f"Most deals first hit their lowest price on <strong>{dname(best_day[0])}</strong> ({best_day[1]} of {n}). "
                     f"{early} were there before Black Friday, {on_bf} on Black Friday itself and {on_cm} on Cyber Monday.")
    cite = f"GolfPrice AI, Black Friday {year} golf price report (golfpriceai.com/prices/black-friday/report-{year}/)"
    faqs = [
        (f"Were Black Friday {year} golf deals genuine?",
         f"Many were. Measured against each model's own October price, {n:,} of the {tr:,} golf models we tracked ({share}%) were genuinely cheaper at some point between {window}, by {money(avg)} on average."),
        (f"What was the best day to buy golf equipment on Black Friday {year}?",
         (f"{dname(best_day[0])}: {best_day[1]} of the {n} genuine deals first hit their lowest price that day. "
          + (f"{early} were already there before Black Friday, so waiting for the day itself often wasn't necessary." if early >= max(1, on_bf) else
             f"{on_bf} first hit their lowest price on Black Friday itself.") if best_day else "We're still counting.")),
        ("How did you measure it?",
         "We record the lowest new, in-stock UK price for every golf model at the UK retailers we track, every 6 hours. A deal counts when the lowest price "
         f"during {window} was at least £5 and 5% below the model's typical October price. We never use a retailer's own “was” or RRP price."),
        ("Can I use these figures?",
         f"Yes, please do. Credit “{cite}”. The full data is free to use under our open data licence."),
    ]
    faq_html, faq_schema = faq_block(faqs)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Black Friday", "/prices/black-friday/"), (f"{year} report", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Black Friday {year} report · {esc(status)}</span>
  <h1>Black Friday {year} golf deals: how many were real?</h1>
  <p class="pp-answer"><strong>{esc(headline)}.</strong> We compared every golf model's lowest UK price between {window} with its typical October price. {n:,} of the {tr:,} models we tracked ({share}%) were at least £5 and 5% cheaper, saving {money(avg)} on average. {when_line}</p>
</section>
<section class="pp-block"><div class="bfr-stats">{stat_html}</div></section>
<section class="pp-block">
  <h2>Where the real savings were</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table">
  <thead><tr><th scope="col">Category</th><th scope="col">Genuine deals</th><th scope="col">Average saving</th><th scope="col">Biggest saving</th></tr></thead>
  <tbody>{cat_html}</tbody></table></div>
</section>
<section class="pp-block">
  <h2>The biggest genuine Black Friday golf savings</h2>
  <div class="pp-card pp-table-wrap"><table class="pp-table">
  <thead><tr><th scope="col">Model</th><th scope="col">October price</th><th scope="col">Black Friday low</th><th scope="col">Saving</th><th scope="col">First at that price</th></tr></thead>
  <tbody>{top_html}</tbody></table></div>
  <p class="pp-small">Lowest new, in-stock UK price across the retailers we track, {window}. October price: the model's typical lowest price that month.</p>
</section>
<section class="pp-block pp-card bfr-press">
  <h2>For journalists</h2>
  <p>Free to quote, with credit: <em>{esc(cite)}</em>. For more figures or a comment, email <a href="mailto:GolfPriceAI@outlook.com">GolfPriceAI@outlook.com</a>. Each month's figures are in <a href="/prices/watch/">The UK Golf Price Report</a>.</p>
</section>
{faq_html}
{method_note(today)}
</div>"""
    article = {"@context": "https://schema.org", "@type": "Article", "headline": f"Black Friday {year} golf deals: how many were real?",
               "datePublished": bf.isoformat(), "dateModified": today.isoformat(), "author": {"@type": "Organization", "name": "GolfPrice AI"},
               "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}, "description": headline + "."}
    dataset = {"@context": "https://schema.org", "@type": "Dataset", "name": f"Black Friday {year} UK golf price report",
               "description": f"Lowest UK prices for {tr} golf models during Black Friday {year}, compared with their October prices.",
               "creator": {"@type": "Organization", "name": "GolfPrice AI"}, "temporalCoverage": f"{year}-10-01/{end.isoformat()}",
               "license": f"{SITE}/legal/", "url": f"{SITE}/prices/black-friday/report-{year}/"}
    return page_shell(title=f"Black Friday {year} Golf Deals: How Many Were Real? The Data | GolfPrice AI",
                      description=f"{headline}: {share}% of the {tr:,} we tracked, saving {money(avg)} on average. Category by category, the biggest savings and the best day to buy.",
                      canonical=f"{SITE}/prices/black-friday/report-{year}/", body=body, section="",
                      schema=[crumbs_schema, faq_schema, article, dataset], noindex=False,
                      extra_head='<style>.bfr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}.bfr-stat{padding:18px 20px;display:flex;flex-direction:column;gap:6px}.bfr-stat b{font-family:Poppins,sans-serif;font-size:34px;color:#2b7a1e}.bfr-stat span{font-size:14px;color:var(--gp-text-3)}.bfr-press{padding:20px 24px}</style>')


# ---------------------------------------------------------------- Black Friday by category, brand and retailer
# Each page is the main Black Friday list cut one way, with the same honest rule
# (at least £5 and 5% below the model's own October price). The set of pages is
# fixed, so addresses stay put; a page with no deals yet shows the prices we're
# watching for it instead. Tech comes first: it's where the biggest savings are.
BF_SUB_LINKS = {}
BF_CATEGORIES = ["rangefinder", "gps-watch", "launch-monitor", "electric-trolley", "driver", "ball", "putter",
                 "irons", "wedge", "hybrid", "wood", "bag", "set"]
BF_TECH = {"rangefinder", "gps-watch", "launch-monitor", "electric-trolley"}
BF_BRANDS = ["TaylorMade", "Callaway", "Titleist", "Ping", "Cobra", "Odyssey", "Mizuno", "Srixon", "Cleveland", "Wilson"]
BF_RETAILERS = ["awin-scottsdalegolf", "awin-clickgolf", "awin-clarkesgolf", "awin-affordablegolf", "awin-majorgolf"]


def _slug(t):
    import re
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def bf_sub_plan():
    from price_pages import retailer_name
    plan = []
    for t in BF_CATEGORIES:
        plan.append(("cat", TYPES[t][0], TYPES[t][1], lambda m, t=t: m["type"] == t))
    for b in BF_BRANDS:
        plan.append(("brand", _slug(b), b, lambda m, b=b: (m.get("brand") or "").lower() == b.lower()))
    for r in BF_RETAILERS:
        plan.append(("shop", _slug(retailer_name(r)), retailer_name(r), lambda m, r=r: m.get("minRetailer") == r))
    return plan


def bf_sub_links(counts):
    """The 'Black Friday by…' chips for the main page, with live deal counts."""
    def chips(kind):
        return "".join(f'<a class="pp-chip" href="/prices/black-friday/{slug}/">{esc(label)} ({counts.get(slug, 0)})</a>'
                       for k, slug, label, _ in bf_sub_plan() if k == kind and slug in counts)
    return f"""<section class="pp-block bf-subs">
  <h2>Black Friday golf deals by category, brand and shop</h2>
  <p class="pp-small">The same genuine deals, cut the way you shop. The number is how many are cheaper than in October today.</p>
  <h3 class="bf-sub-h">Golf tech and clubs</h3><div class="pp-chips">{chips("cat")}<a class="pp-chip" href="/prices/black-friday/golf-clothing/">Golf clothing and shoes</a></div>
  <h3 class="bf-sub-h">Brands</h3><div class="pp-chips">{chips("brand")}</div>
  <h3 class="bf-sub-h">UK golf shops</h3><div class="pp-chips">{chips("shop")}</div>
</section>"""


def bf_sub_page(kind, slug, label, deals, watch, info, today):
    year, bf, cyber, phase = today.year, info["bf"], info["cyber"], info["phase"]
    bf_txt = f"Friday {bf.day} November {year}"
    n = len(deals)
    lows = sum(1 for r in deals if r.get("low"))
    noun = (label if label.startswith("GPS") else label.lower()) if kind == "cat" else label
    if kind == "cat":
        one = next(v[2] for v in TYPES.values() if v[1] == label)   # "rangefinder", "golf ball"
        one = one if one.startswith("GPS") else one.lower()
        h1 = f"Black Friday {one} deals {year} (UK)"
        title = f"Black Friday {' '.join(w if w.isupper() else w.capitalize() for w in one.split())} Deals {year} UK: Genuinely Cheaper, Checked | GolfPrice AI"
        what = f"{noun}"
    elif kind == "brand":
        h1 = f"{label} Black Friday golf deals {year} (UK)"
        title = f"{label} Black Friday Golf Deals {year} UK: Real Savings Only | GolfPrice AI"
        what = f"{label} golf models"
    else:
        h1 = f"{label} Black Friday deals {year}: genuinely cheaper, checked"
        title = f"{label} Black Friday Deals {year}: Which Are Genuinely Cheaper? | GolfPrice AI"
        what = f"golf models where {label} has the lowest UK price we track"
    count_txt = (f"<strong>{n}</strong> {what} {'is' if n == 1 else 'are'} genuinely cheaper than in October"
                 + (f", {lows} at the lowest price we’ve ever tracked" if lows else "")) if n else ""
    if phase == "after":
        answer = f"Black Friday {year} ({bf_txt}) is over. " + (f"Today {count_txt}." if n else f"No {what} are still meaningfully cheaper than in October.")
    else:
        answer = (f"Black Friday {year} is <strong>{bf_txt}</strong> and Cyber Monday is {cyber.day} November. "
                  + (f"Right now {count_txt}." if n else f"No {what} are genuinely cheaper than in October yet: the ones we’re watching are below, with the October price we’ll measure them against.")
                  + " We check prices every 6 hours, and a retailer’s own “was” price never counts.")
    if kind == "shop":
        answer += f" Prices are {label}’s own, and we only list a deal here when {label} is the cheapest of the UK retailers we track."
    best = max(deals, key=lambda r: r["base"] - r["now"]) if deals else None
    faqs = [(f"Are there real Black Friday {noun if kind == 'cat' else label} deals?" if kind != "shop" else f"Does {label} do Black Friday?",
             (f"Yes. Today {n} {what} {'is' if n == 1 else 'are'} at least £5 and 5% cheaper than their own October price"
              + (f". The biggest saving is {money(best['base'] - best['now'])} on the {best['m']['name']}." if best else ".")) if n else
             f"Not yet against our October prices. Most UK golf retailers start their Black Friday offers in the two weeks before {bf_txt}, so check back."),
            ("How do you check the saving is genuine?",
             "We record the lowest new, in-stock UK price for every model every 6 hours. The October price is the typical lowest price we "
             "recorded in October; a deal needs to be at least £5 and 5% below it. We never use a retailer’s RRP or “was” price.")]
    if kind == "cat" and slug in ("rangefinders", "gps-watches", "launch-monitors", "electric-trolleys"):
        faqs.append((f"Is Black Friday a good time to buy {noun}?",
                     f"Often, yes: golf tech gets some of the biggest cash discounts of the year in November, and it makes a popular Christmas present. "
                     f"Each model’s page shows its full price history, so you can see whether today’s price really is low."))
    faq_html, faq_schema = faq_block(faqs)
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Black Friday", "/prices/black-friday/"), (label, None)])
    others = "".join(f'<a class="pp-chip" href="/prices/black-friday/{sl}/">{esc(lb)}</a>' for k, sl, lb, _ in bf_sub_plan() if k == kind and sl != slug)
    deals_html = deals_table(deals) if deals else ""
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Black Friday {year} · {bf_txt}</span>
  <h1>{esc(h1)}</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes what’s listed or the order.</p>
</section>
{f'<section class="pp-block"><h2>Cheaper than in October</h2>{deals_html}<p class="pp-small">October price: the typical lowest new, in-stock UK price we recorded in October. Today: the lowest now, checked every 6 hours.</p></section>' if deals else ''}
{f'<section class="pp-block"><h2>Prices we’re watching</h2><p class="pp-small">The most widely stocked models, with the October price Black Friday will be measured against.</p>{compare_table(watch, "October price")}</section>' if watch else ''}
<section class="pp-block"><h2>More Black Friday golf deals</h2><div class="pp-chips"><a class="pp-chip" href="/prices/black-friday/">All Black Friday golf deals</a>{others}<a class="pp-chip" href="/prices/cyber-monday/">Cyber Monday</a></div></section>
{signup_box("Get the real deals by email", "Our Friday email lists the week’s genuine price drops, checked against our own price history.")}
{faq_html}
{method_note(today)}
</div>
<script src="/js/clothing-guide.js?v=20261018" defer></script>"""
    desc = (f"{h1}: " + (f"{n} {what} genuinely cheaper than in October, with the real saving on each" if n else f"the {what} we’re watching, with their October prices")
            + ". Checked every 6 hours, never a “was” price.")
    return page_shell(title=title, description=desc[:300], canonical=f"{SITE}/prices/black-friday/{slug}/", body=body,
                      section="", schema=[crumbs_schema, faq_schema], noindex=False)


def build_bf_subpages(today, changed, sitemap):
    info = build_black_friday.last
    deals, rows = info["deals"], info["rows"]
    counts, made = {}, 0
    for kind, slug, label, keep in bf_sub_plan():
        ds = [r for r in deals if keep(r["m"])]
        ws = watch_list([r for r in rows if keep(r["m"])], per_type=4 if kind == "cat" else 2)[:16]
        if not ds and not ws:
            continue
        counts[slug] = len(ds)
        if _write(PRICES_DIR / "black-friday" / slug / "index.html", bf_sub_page(kind, slug, label, ds, ws, info, today)):
            changed.append(f"/prices/black-friday/{slug}/")
        sitemap.append((f"prices/black-friday/{slug}/", today.isoformat()))
        made += 1
    return counts, made


# ---------------------------------------------------------------- entry point
SEASONAL_SLUGS = ["black-friday", "cyber-monday", "boxing-day-sales", "christmas", "golf-gifts"] + list(GIFT_PAGES)


def build(passing, built, products, today):
    """Returns (changed urls, sitemap entries, seasonal hub links for the /prices/ page)."""
    changed, sitemap, links = [], [], []
    images = {p["id"]: p.get("image") for p in products if p.get("image")}
    build_black_friday(passing, built, today, images)            # first pass: the deals
    counts, n_sub = build_bf_subpages(today, changed, sitemap)    # by category, brand and shop
    BF_SUB_LINKS["html"] = bf_sub_links(counts)
    page, n_deals = build_black_friday(passing, built, today, images)
    if _write(PRICES_DIR / "black-friday" / "index.html", page):
        changed.append("/prices/black-friday/")
    sitemap.append(("prices/black-friday/", today.isoformat()))
    links.append(("/prices/black-friday/", f"Black Friday {today.year}", "Real deals only, checked against October prices"))
    try:
        rep_page = build_bf_report(passing, built, today)
        if rep_page:
            rp = f"black-friday/report-{today.year}"
            if _write(PRICES_DIR / rp / "index.html", rep_page):
                changed.append(f"/prices/{rp}/")
            sitemap.append((f"prices/{rp}/", today.isoformat()))
            links.append((f"/prices/{rp}/", f"Black Friday {today.year}: how many deals were real?", "The data, category by category"))
    except Exception as e:
        print(f"Black Friday report: skipped ({e}).")
    page, _ = build_black_friday(passing, built, today, images, cyber_page=True)
    if _write(PRICES_DIR / "cyber-monday" / "index.html", page):
        changed.append("/prices/cyber-monday/")
    sitemap.append(("prices/cyber-monday/", today.isoformat()))
    links.append(("/prices/cyber-monday/", f"Cyber Monday {today.year}", "The last day of the sales, checked"))
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
        if _write(PRICES_DIR.parent / "cheat-sheet" / "index.html", build_cheat_page(today)):
            changed.append("/cheat-sheet/")
        sitemap.append(("cheat-sheet/", today.isoformat()))
        wl = build_wishlist_page(today)
        _write(PRICES_DIR.parent / "wishlist" / "index.html", wl)
        _write(PRICES_DIR / "golf-gifts" / "wishlist" / "index.html", wl)
        # Data for shared wishlists (/prices/golf-gifts/wishlist/?i=...): product details only, no personal data.
        gifts = {it["key"]: {k: it[k] for k in ("name", "price", "per", "href", "ext", "img", "check", "verdict", "sub")}
                 for it in gift_items}
        _write(GIFTS_FILE, json.dumps(gifts, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
        sitemap.append(("prices/golf-gifts/", today.isoformat()))
        links.append(("/prices/golf-gifts/", "Golf gift ideas", "By budget, from under £25 to £100 and up"))
    print(f"Seasonal pages: Black Friday ({n_deals} model(s) cheaper than October, {n_sub} category/brand/shop pages), Cyber Monday, Christmas ({n_xmas} gift(s) at "
          f"their lowest), Boxing Day ({n_box} cheaper than early December), {len(made)} gift page(s).")
    return changed, sitemap, links
