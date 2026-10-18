"""The UK Golf Demand Index (golfpriceai.com/demand/).

What UK golfers want right now, ranked by anonymous signals that GolfPrice AI
features already produce. We count the nods, never the names.

Two parts, like most_compared.py:

  python scripts/demand_index.py fetch
      Run every 6 hours in the alerts step of update-deals.yml (it needs the
      BREVO_API_KEY and ALERTS_SECRET secrets). Collects counts only:
        - how many confirmed alert subscribers watch each model (Brevo)
        - "Bought it?" watches per model (Brevo)
        - budget alerts per product type (Brevo)
        - daily price-page views, shortlist hearts, searches and Par Price
          guesses, counted anonymously by the alerts worker (/signal)
      and saves them to data/demand/signals.json. Search words are kept only
      when every word is a golf brand, model or product word, so nothing a
      visitor typed by mistake (or about themselves) is ever published.

  build(passing, built, today)
      Called by price_pages.build every 6 hours. Turns signals.json plus
      today's prices into /demand/ (the page), data/demand/index.json (open
      data), data/demand/history.json (daily top 60, for "up 3 places") and,
      once a month, a frozen monthly report under /demand/reports/YYYY-MM/.

No email addresses, names, IP addresses or cookies are involved anywhere.
"""
import hashlib
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "demand"
SIGNALS = DATA / "signals.json"
HISTORY = DATA / "history.json"
INDEX_JSON = DATA / "index.json"
REPORTS = DATA / "reports"
PAGE_DIR = ROOT / "demand"
CARD = "/assets/cards/demand.jpg"
CSS = "/css/demand.css?v=20261020"
JS = "/js/demand.js?v=20261020"

KEEP_DAYS = 63          # daily counts kept in signals.json
WEEK = 7
MIN_SCORE = 3           # a model needs this much interest in the week to rank
MIN_MODELS = 8          # fewer than this and the chart is still "warming up"
MIN_GUESSES = 8         # Par Price guesses per category before we quote it
MIN_SEARCHES = 3        # searches of the same words in 30 days before we show them
SHOW = 50               # models on the page (10 visible per filter)
# How much each signal counts towards a model's place in the chart.
WEIGHT = {"view": 1, "heart": 3, "alert": 4, "bought": 2}

GROUPS = [  # chip key, label, types
    ("woods", "Drivers & woods", {"driver", "wood", "hybrid"}),
    ("irons", "Irons & wedges", {"irons", "wedge", "set"}),
    ("putters", "Putters", {"putter"}),
    ("balls", "Balls", {"ball"}),
    ("tech", "Tech", {"gps-watch", "rangefinder", "launch-monitor"}),
    ("kit", "Bags & trolleys", {"bag", "electric-trolley"}),
]
GROUP_OF = {t: g for g, _, ts in GROUPS for t in ts}
# "Where the wanting goes": the honest label, then the other one.
GROUP_JOKE = {"woods": "hope", "irons": "forgiveness", "putters": "someone to blame", "balls": "replacing the ones in the lake",
              "tech": "gadgets", "kit": "knees"}

QUIPS = {
    "driver": ["Promises 20 extra yards. Results may vary.", "Hope, with a 460cc head.",
               "Bought for distance, used for searching the rough.", "The club everyone wants and nobody hits straight."],
    "wood": ["For when the driver is sulking.", "Brilliant off the deck, allegedly.", "The sensible choice. Rarely the one made."],
    "hybrid": ["Makes long irons optional.", "Easier than a 4-iron. Most things are.", "The rescue club, for rescuing rounds."],
    "irons": ["Forgiveness, sold in sets.", "Several clubs, one excuse each.", "Pure strikes not included, but encouraged."],
    "wedge": ["Spin you can show your mates.", "For the shots you’ll practise next week.", "Bunkers fear it. Allegedly."],
    "putter": ["Blame the putter. Buy a new putter.", "The one club that’s never your fault.", "Three-putt insurance (not guaranteed)."],
    "ball": ["Bought by the dozen, lost by the half-dozen.", "The lake’s favourite.", "Fewer go missing if you aim away from water."],
    "bag": ["Somewhere to keep the excuses.", "Fits 14 clubs and a spare scorecard.", "Carries everything except the blame."],
    "gps-watch": ["Know exactly how far you missed by.", "Tells you the distance. Can’t pick the club.", "The yardage book that never gets wet."],
    "rangefinder": ["Settles every “it’s definitely 150” debate.", "Accurate to the yard. The swing, less so.",
                    "Because pacing it out holds up the four-ball."],
    "electric-trolley": ["Winter. Knees. You know the drill.", "Carries the bag so you can carry the round.",
                         "Eighteen holes, zero shoulder ache."],
    "launch-monitor": ["Numbers don’t lie. They just hurt.", "Your garage, now with spin rates.", "Proof, at last, of that slice."],
    "set": ["Everything you need except the lessons.", "A whole bag, one decision.", "Starter kit, finisher ambitions."],
}
WISH_HIGH = ["Golfers think it costs more than it does. Good news, for once.", "Pleasantly cheaper than the nation feared."]
WISH_LOW = ["Optimism: the golfer’s most renewable resource.", "The UK is guessing low. Wallets, brace."]
WISH_SPOT = ["Spot on. Suspiciously spot on.", "Golfers know these prices to the pound. Handicaps, less so."]

WOMEN_RX = re.compile(r"\b(ladies|lady|women'?s?|womens|female)\b", re.I)


# ---------------------------------------------------------------- fetch
def _vocabulary():
    """Every word that may appear in a published search: brands, model names, product words."""
    words = set("golf club clubs driver drivers wood woods fairway hybrid hybrids rescue iron irons set sets wedge wedges "
                "putter putters ball balls bag bags stand cart trolley trolleys electric push watch watches gps rangefinder "
                "rangefinders laser launch monitor monitors shoes shoe glove gloves waterproof jacket trousers left hand "
                "handed mens men's ladies women's junior senior graphite steel shaft stiff regular flex blade mallet "
                "tour pro max ls hl plus mini lite x xl".split())
    try:
        for m in json.loads((ROOT / "data" / "models.json").read_text()).get("models", []):
            for w in re.split(r"[^a-z0-9.'&+-]+", (m.get("name", "") + " " + (m.get("brand") or "")).lower()):
                if w:
                    words.add(w)
    except (OSError, ValueError):
        pass
    return words


def _clean_search(q, vocab):
    words = q.split()
    return q if words and all(w in vocab for w in words) else None


def _brevo_counts(key):
    sys.path.insert(0, str(ROOT / "scripts"))
    import alerts
    subs = alerts.subscribers(key)
    watch, bought, budget = {}, {}, {}
    for s in subs:
        for slug in s["watch"]:  # non-model entries are ignored later (only live models rank)
            watch[slug] = watch.get(slug, 0) + 1
        for b in s["bought"]:
            slug = b.split("|")[0]
            bought[slug] = bought.get(slug, 0) + 1
        for b in s["budget"]:
            t = b.rsplit("-", 1)[0]
            budget[t] = budget.get(t, 0) + 1
    return {"alert": watch, "bought": bought, "budget": budget}, len(subs)


def _worker_counts(secret):
    sys.path.insert(0, str(ROOT / "scripts"))
    import alerts
    req = urllib.request.Request(alerts.WORKER_URL + "/demand-counts",
                                 headers={"x-demand-key": alerts.sign(secret, "demand-counts"),
                                          "User-Agent": "GolfPriceAI demand index"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def fetch():
    key, secret = os.environ.get("BREVO_API_KEY"), os.environ.get("ALERTS_SECRET")
    if not key or not secret:
        print("Demand Index: BREVO_API_KEY / ALERTS_SECRET not set, skipping.")
        return
    try:
        old = json.loads(SIGNALS.read_text())
    except (OSError, ValueError):
        old = {}
    out = {"about": "UK Golf Demand Index: anonymous daily counts only. No emails, names, IP addresses or cookies.",
           "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "days": old.get("days", {}), "search": {}, "snapshot": old.get("snapshot", {}),
           "fourball": old.get("fourball", 0)}
    try:
        snap, _ = _brevo_counts(key)
        out["snapshot"] = snap
    except Exception as e:  # keep the last good snapshot
        print(f"Demand Index: Brevo counts skipped ({e}).")
    try:
        w = _worker_counts(secret)
        vocab = _vocabulary()
        days, search = {}, {}
        for day, kind, k, n, s in w.get("rows", []):
            if kind == "search":
                q = _clean_search(k, vocab)
                if q and day >= (date.today() - timedelta(days=30)).isoformat():
                    search[q] = search.get(q, 0) + n
                continue
            if kind not in ("view", "heart", "pp"):
                continue
            d = days.setdefault(day, {})
            if kind == "pp":
                d.setdefault("pp", {})[k] = [n, round(s, 4)]
            else:
                d.setdefault(kind, {})[k] = n
        # The worker keeps 70 days; merge so a missed fetch loses nothing.
        out["days"].update(days)
        out["search"] = {q: n for q, n in sorted(search.items(), key=lambda kv: (-kv[1], kv[0]))[:60]}
        out["fourball"] = int(w.get("fourball") or 0)
    except Exception as e:  # worker not updated yet, network, etc.
        print(f"Demand Index: worker counts skipped ({e}).")
    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    out["days"] = {d: v for d, v in sorted(out["days"].items()) if d >= cutoff}
    DATA.mkdir(parents=True, exist_ok=True)
    SIGNALS.write_text(json.dumps(out, indent=0, sort_keys=True, ensure_ascii=False) + "\n")
    total = sum(sum(v.values()) if k != "pp" else sum(x[0] for x in v.values())
                for d in out["days"].values() for k, v in d.items())
    print(f"Demand Index: {len(out['days'])} day(s) of counts ({total} signals), "
          f"{sum(out['snapshot'].get('alert', {}).values())} model alert(s), {len(out['search'])} search phrase(s).")


# ---------------------------------------------------------------- build helpers
def _pick(options, *seed):
    h = int(hashlib.sha1("|".join(str(s) for s in seed).encode()).hexdigest(), 16)
    return options[h % len(options)]


def _money(n, unit=""):
    s = f"£{n:,.2f}"
    s = s[:-3] if s.endswith(".00") else s
    return s + (unit and f" {unit}")


def _window(days, start, end):
    """Sum view/heart counts per model over [start, end] (ISO dates)."""
    tot = {"view": {}, "heart": {}}
    for d, v in days.items():
        if start <= d <= end:
            for kind in tot:
                for slug, n in (v.get(kind) or {}).items():
                    tot[kind][slug] = tot[kind].get(slug, 0) + n
    return tot


def scores(signals, start, end, live):
    win = _window(signals.get("days", {}), start, end)
    snap = signals.get("snapshot", {})
    out = {}
    for slug in live:
        s = (WEIGHT["view"] * win["view"].get(slug, 0) + WEIGHT["heart"] * win["heart"].get(slug, 0)
             + WEIGHT["alert"] * snap.get("alert", {}).get(slug, 0) + WEIGHT["bought"] * snap.get("bought", {}).get(slug, 0))
        if s >= MIN_SCORE:
            out[slug] = s
    return out


def ranked(sc):
    return [s for s, _ in sorted(sc.items(), key=lambda kv: (-kv[1], kv[0]))]


def wishful(signals, live, today):
    """Par Price: average guess against the real price, by category (last 30 days)."""
    start = (today - timedelta(days=30)).isoformat()
    agg = {}
    for d, v in signals.get("days", {}).items():
        if d < start:
            continue
        for slug, (n, s) in (v.get("pp") or {}).items():
            m = live.get(slug)
            if not m:
                continue
            a = agg.setdefault(m["type"], [0, 0.0])
            a[0] += n
            a[1] += s
    rows = []
    for t, (n, s) in agg.items():
        if n < MIN_GUESSES:
            continue
        off = math.exp(s / n) - 1
        rows.append({"type": t, "label": _type_label(t), "guesses": n, "off": round(off * 100)})
    rows.sort(key=lambda r: -abs(r["off"]))
    return rows[:4]


def _type_label(t):
    from price_pages import TYPES
    return TYPES[t][1] if t in TYPES else t


def _hist():
    try:
        return json.loads(HISTORY.read_text())
    except (OSError, ValueError):
        return {"about": "Daily top 60 of the UK Golf Demand Index (model slugs only).", "days": {}}


def _previous(hist, today):
    """The chart from about a week ago (6 to 8 days), else None."""
    for back in (7, 8, 6):
        r = hist["days"].get((today - timedelta(days=back)).isoformat())
        if r:
            return r
    return None


# ---------------------------------------------------------------- monthly report
def _month_report(signals, live, today):
    """Freeze last month's chart once the month is over. Returns the newest report."""
    first = today.replace(day=1)
    prev_end = first - timedelta(days=1)
    key = prev_end.strftime("%Y-%m")
    f = REPORTS / f"{key}.json"
    month_days = [d for d in signals.get("days", {}) if d.startswith(key)]
    if not f.exists() and len(month_days) >= 7:  # a fair month needs at least a week of counts
        sc = scores(signals, prev_end.replace(day=1).isoformat(), prev_end.isoformat(), live)
        order = ranked(sc)
        if len(order) >= MIN_MODELS:
            items = [_row(live[s], i + 1, None) for i, s in enumerate(order[:10])]
            REPORTS.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps({"month": key, "title": prev_end.strftime("%B %Y"), "made": today.isoformat(),
                                     "items": items, "wishful": wishful(signals, live, prev_end)},
                                    ensure_ascii=False, indent=1) + "\n")
            print(f"Demand Index: {prev_end.strftime('%B %Y')} report frozen ({len(items)} models).")
    reports = sorted(REPORTS.glob("*.json")) if REPORTS.exists() else []
    return [json.loads(p.read_text()) for p in reports]


def _row(m, rank, move):
    return {"rank": rank, "slug": m["slug"], "name": m["name"], "brand": m.get("brand") or "", "type": m["type"],
            "group": GROUP_OF.get(m["type"], ""), "price": round(float(m["minPrice"]), 2),
            "unit": "per dozen" if m["type"] == "ball" else "", "image": m.get("_image") or "",
            "url": f"/prices/{m['slug']}/", "move": move, "low": (m.get("verdict") or {}).get("label") == "good"}


# ---------------------------------------------------------------- page
def _move_html(mv):
    if mv is None:
        return '<span class="dm-move dm-flat" title="First week in the chart">–</span>'
    if mv == "new":
        return '<span class="dm-move dm-up">New</span>'
    if mv > 0:
        return f'<span class="dm-move dm-up" title="Up {mv} since last week">▲ {mv}</span>'
    if mv < 0:
        return f'<span class="dm-move dm-down" title="Down {-mv} since last week">▼ {-mv}</span>'
    return '<span class="dm-move dm-flat" title="Same place as last week">=</span>'


def _chart_html(rows, top_score, sc, week_key):
    from price_pages import esc
    seen = {}
    out = []
    for r in rows:
        g = r["group"]
        seen[r["type"]] = seen.get(r["type"], -1) + 1
        hide = ' dm-more' if r["rank"] > 10 else ''
        bar = max(4, round(100 * sc[r["slug"]] / top_score))
        img = (f'<img src="{esc(r["image"])}" alt="" loading="lazy" referrerpolicy="no-referrer" width="56" height="56">'
               if r["image"] else "")
        # Same type, different joke: rotate through the type's quips down the chart.
        options = QUIPS.get(r["type"], ["Wanted. Very wanted."])
        quip = options[(seen[r["type"]] + week_key) % len(options)]
        out.append(f"""<li class="dm-row{hide}" data-g="{g}">
  <b class="dm-rank">{r["rank"]}</b>
  <span class="dm-pic">{img}</span>
  <span class="dm-main"><a href="{r["url"]}?utm_source=demand&amp;utm_medium=chart">{esc(r["name"])}</a>
    <span class="dm-sub">{_money(r["price"], r["unit"])} today{' · <b class="dm-low">lowest we’ve tracked</b>' if r["low"] else ''} · <i>{esc(quip)}</i></span></span>
  {_move_html(r["move"])}
  <span class="dm-bar" aria-hidden="true"><span style="width:{bar}%"></span></span>
</li>""")
    return "\n".join(out)


def page(state, today):
    from price_pages import SITE, breadcrumb, esc, page_shell
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Deal Tools", "/deal-tools.html"), ("Demand Index", None)])
    rows, live = state["rows"], state["live"]
    week_no = today.isocalendar()[1]
    chips = '<button type="button" class="dm-chip is-on" data-g="">All</button>' + "".join(
        f'<button type="button" class="dm-chip" data-g="{g}">{esc(label)}</button>'
        for g, label, _ in GROUPS if any(r["group"] == g for r in rows))
    if live:
        chart = f"""<div class="dm-card dm-chart">
      <div class="dm-chart-head"><h2>Most wanted this week</h2><div class="dm-chips" role="group" aria-label="Filter by category">{chips}</div></div>
      <ol class="dm-list" id="dm-list">
{_chart_html(rows, state["top"], state["scores"], week_no)}
      </ol>
      <p class="dm-empty" hidden>Nothing in this category has made the chart this week. Clearly everyone is saving up.</p>
      <p class="dm-foot">Bars show interest relative to number one; arrows show movement since last week. Watching is not buying, as every golfer’s other half will confirm.</p>
    </div>"""
    else:
        chart = f"""<div class="dm-card dm-warm">
      <span class="dm-kicker">Warming up</span>
      <h2>The first chart is still on the practice ground</h2>
      <p>We started counting {esc(state["since"])}. The chart appears once enough golfers have eyed up enough kit to make a fair top {MIN_MODELS}, usually within a week or two. Like a new driver, it needs a few rounds before it settles.</p>
      <p><b>Want to help it along?</b> Every price alert you set is a vote. Find something you fancy in our <a href="/prices/">price guides</a>, then tap “Email me when it drops”.</p>
      {f'<p class="dm-progress">{state["qualified"]} of {MIN_MODELS} models have qualified so far.</p>' if state["qualified"] else ''}
    </div>"""

    if state["climbers"]:
        climb = "".join(f'<li><a href="{c["url"]}?utm_source=demand&amp;utm_medium=climbers">{esc(c["name"])}</a> <span>{c["what"]}</span></li>'
                        for c in state["climbers"])
        climb_html = f'<div class="dm-card"><h3>Climbing faster than a skied 3-wood</h3><ul class="dm-climb">{climb}</ul></div>'
    else:
        climb_html = ('<div class="dm-card"><h3>Climbing faster than a skied 3-wood</h3>'
                      '<p class="dm-muted">Risers and new entries appear here once we have a week to compare against.</p></div>')

    if state["wish"]:
        wl = "".join(
            f'<li><span>{esc(w["label"])}</span><b class="{"dm-hi" if w["off"] > 3 else "dm-lo" if w["off"] < -3 else ""}">'
            + (f'guessed {w["off"]}% too high' if w["off"] > 3 else f'guessed {-w["off"]}% too low' if w["off"] < -3 else "spot on")
            + "</b></li>" for w in state["wish"])
        w0 = state["wish"][0]["off"]
        wquip = _pick(WISH_HIGH if w0 > 3 else WISH_LOW if w0 < -3 else WISH_SPOT, today.isoformat()[:7])
        wish_body = f'<ul class="dm-wish">{wl}</ul><p class="dm-note">{esc(wquip)} From every finished round of <a href="/play/">Par Price</a> in the last 30 days.</p>'
    else:
        wish_body = ('<p class="dm-note">Warming up. Every finished round of <a href="/play/">Par Price</a> adds to it. '
                     'Golfers are famously accurate about their own handicaps, so this should be fascinating.</p>')
    wish_html = f"""<div class="dm-card dm-dark">
      <span class="dm-kicker">The Wishful Thinking Index</span>
      <h3>What golfers think it costs, against what it actually costs</h3>
      {wish_body}
    </div>"""

    if state["share"]:
        segs = "".join(f'<span class="dm-seg dm-seg-{i}" style="flex:{s["pct"]}" title="{esc(s["label"])}: {s["pct"]}%"></span>'
                       for i, s in enumerate(state["share"]))
        legend = "".join(f'<li><i class="dm-dot dm-seg-{i}"></i>{esc(s["label"])} <span>({esc(s["joke"])})</span> <b>{s["pct"]}%</b></li>'
                         for i, s in enumerate(state["share"]))
        share_html = (f'<div class="dm-card"><h3>Where the wanting goes</h3><div class="dm-split" role="img" '
                      f'aria-label="Share of this week’s interest by category">{segs}</div><ul class="dm-legend">{legend}</ul></div>')
    else:
        share_html = ""

    if state["searches"]:
        chips_s = "".join(f'<a class="dm-chip" href="/search.html?q={urllib_quote(q)}">{esc(q)}</a>' for q in state["searches"])
        search_html = f'<div class="dm-card"><h3>What golfers are typing</h3><div class="dm-chips">{chips_s}</div><p class="dm-muted">Most-searched golf words on GolfPrice AI in the last 30 days.</p></div>'
    else:
        search_html = ""

    report_html = ""
    if state["report"]:
        rp = state["report"]
        top = rp["items"][0]
        rest = "".join(f'<li><b>{r["rank"]}</b> <a href="{r["url"]}">{esc(r["name"])}</a></li>' for r in rp["items"][1:5])
        report_html = f"""<section class="pp-block">
    <div class="dm-card dm-report">
      <span class="dm-kicker">Monthly report · {esc(rp["title"])}</span>
      <h2>The club the UK couldn’t stop staring at: {esc(top["name"])}</h2>
      <ol class="dm-report-list" start="2">{rest}</ol>
      <p><a href="/demand/reports/{rp["month"]}/">Read the full {esc(rp["title"])} report</a> · free to quote with a link to golfpriceai.com/demand/</p>
    </div>
  </section>"""

    updated = esc(state["updated"])
    body = f"""<div class="pp-wrap dm-wrap">
{crumbs_html}
<section class="dm-hero">
  <span class="dm-kicker">UK Golf Demand Index · week {week_no}</span>
  <h1>What UK golfers want right now</h1>
  <p class="dm-lede">The kit the nation is quietly eyeing up, ranked by how many golfers are looking at, shortlisting and setting alerts on each model this week. We count the nods, never the names: your secret new-driver fund is safe with us.</p>
  <p class="dm-meta">Updated {updated} · refreshed every 6 hours</p>
</section>
<section class="dm-grid">
  {chart}
  <div class="dm-side">
    {wish_html}
    {climb_html}
    {share_html}
    {search_html}
  </div>
</section>
{report_html}
<section class="pp-block">
  <div class="dm-three">
    <div class="dm-card"><h3>For golfers</h3><p>See what everyone else is eyeing, and whether it’s a good time to buy it. Peer pressure, but with price history.</p></div>
    <div class="dm-card"><h3>For press</h3><p>A monthly report with one headline figure and a straight face. Free to quote with a link. The data is in <a href="/data/demand/index.json">one open file</a>.</p></div>
    <div class="dm-card"><h3>For the trade</h3><p>Deeper demand data by brand, category and season, minus the guesswork. <a href="mailto:hello@golfpriceai.com?subject=Demand%20Index">Get in touch</a></p></div>
  </div>
</section>
<section class="pp-block">
  <h2>How it works</h2>
  <div class="pp-q-grid">
    <div class="pp-card pp-q"><h3>What gets counted?</h3><p>Anonymous totals from things golfers already do here: viewing a model’s price page, adding it to a <a href="/fourball/">four-ball shortlist</a>, setting a price alert or a “Bought it?” watch, and finishing a round of <a href="/play/">Par Price</a>. Alerts and shortlists count for more than a quick look, because they mean business.</p></div>
    <div class="pp-card pp-q"><h3>Is anything about me stored?</h3><p>No. No cookie, nothing in your browser, no name or email. Each visitor counts once per model per day, and the daily totals are deleted after 70 days. We know a lot of golfers want a new driver; we just never know which ones. <a href="/legal/privacy-policy.html">Privacy policy</a></p></div>
    <div class="pp-card pp-q"><h3>Does anyone pay to be in it?</h3><p>No. Brands and retailers can’t buy a place, and every brand is treated the same. If a putter is number one, it’s because golfers wanted it, not because somebody asked nicely.</p></div>
    <div class="pp-card pp-q"><h3>Can I use the numbers?</h3><p>Yes, free, with a link to golfpriceai.com/demand/. The chart, the Wishful Thinking Index and the category split are all in <a href="/data/demand/index.json">data/demand/index.json</a>, updated every 6 hours.</p></div>
  </div>
</section>
</div>
<script src="{JS}" defer></script>"""
    schema = [{"@context": "https://schema.org", "@type": "Dataset", "name": "UK Golf Demand Index",
               "description": "Weekly ranking of the golf equipment UK golfers are most interested in, from anonymous counts of price-page views, shortlists and price alerts on GolfPrice AI. Includes what golfers guess kit costs against the real UK price.",
               "url": f"{SITE}/demand/", "creator": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE},
               "isAccessibleForFree": True, "license": "https://creativecommons.org/licenses/by/4.0/",
               "dateModified": today.isoformat(), "spatialCoverage": "United Kingdom",
               "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json",
                                 "contentUrl": f"{SITE}/data/demand/index.json"}]}, crumbs_schema]
    lead = f" This week’s number one: {rows[0]['name']}." if live and rows else ""
    return page_shell(title="UK Golf Demand Index: what UK golfers want right now | GolfPrice AI",
                      description="The golf kit UK golfers are most interested in this week, ranked from anonymous counts of views, shortlists and price alerts." + lead,
                      canonical=f"{SITE}/demand/", body=body, section="tools", schema=schema, noindex=not live,
                      og_image=CARD,
                      extra_head=f'<link rel="stylesheet" href="{CSS}">\n'
                                 '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def _since(signals):
    days = sorted(signals.get("days") or {})
    if not days:
        return "the day this page went live"
    return "on " + date.fromisoformat(days[0]).strftime("%-d %B")


def urllib_quote(s):
    import urllib.parse
    return urllib.parse.quote_plus(s)


def report_page(rp):
    from price_pages import SITE, breadcrumb, esc, page_shell
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Demand Index", "/demand/"), (rp["title"] + " report", None)])
    top = rp["items"][0]
    rows = "".join(f'<tr><th scope="row">{r["rank"]}</th><td><a href="{r["url"]}">{esc(r["name"])}</a></td>'
                   f'<td>{esc(_type_label(r["type"]))}</td></tr>' for r in rp["items"])
    wish = ""
    if rp.get("wishful"):
        wish = "<h2>The Wishful Thinking Index</h2><ul>" + "".join(
            f'<li>{esc(w["label"])}: golfers guessed {abs(w["off"])}% too {"high" if w["off"] > 0 else "low"}</li>'
            if abs(w["off"]) > 3 else f'<li>{esc(w["label"])}: golfers were spot on</li>' for w in rp["wishful"]) + "</ul>"
    body = f"""<div class="pp-wrap dm-wrap">
{crumbs_html}
<section class="dm-hero">
  <span class="dm-kicker">UK Golf Demand Index · monthly report</span>
  <h1>{esc(rp["title"])}: the club the UK couldn’t stop staring at was the {esc(top["name"])}</h1>
  <p class="dm-lede">The ten models UK golfers were most interested in during {esc(rp["title"])}, from anonymous counts of price-page views, shortlists and price alerts on GolfPrice AI. Several of them have “just been looking”.</p>
</section>
<section class="pp-block">
  <div class="pp-card pp-table-wrap"><table class="pp-table dm-table"><thead><tr><th scope="col">Rank</th><th scope="col">Model</th><th scope="col">Category</th></tr></thead><tbody>{rows}</tbody></table></div>
  {wish}
  <p>Free to quote with a link to <a href="/demand/">golfpriceai.com/demand/</a>. Today’s live chart is on the <a href="/demand/">Demand Index</a>.</p>
</section>
</div>"""
    return page_shell(title=f"UK Golf Demand Index: {rp['title']} report | GolfPrice AI",
                      description=f"The golf kit UK golfers were most interested in during {rp['title']}. Number one: {top['name']}.",
                      canonical=f"{SITE}/demand/reports/{rp['month']}/", body=body, section="tools",
                      schema=[crumbs_schema], noindex=False, og_image=CARD,
                      extra_head=f'<link rel="stylesheet" href="{CSS}">\n')


# ---------------------------------------------------------------- build
def build(passing, built, today):
    from price_pages import NOT_IN_PICKS, _write
    try:
        signals = json.loads(SIGNALS.read_text())
    except (OSError, ValueError):
        signals = {"days": {}, "snapshot": {}, "search": {}}
    live = {m["slug"]: m for m in passing
            if m["slug"] in built and m["type"] not in NOT_IN_PICKS and m["type"] in GROUP_OF}
    end = today.isoformat()
    start = (today - timedelta(days=WEEK - 1)).isoformat()
    sc = scores(signals, start, end, live)
    order = ranked(sc)
    is_live = len(order) >= MIN_MODELS

    hist = _hist()
    prev = _previous(hist, today)
    rows = []
    for i, slug in enumerate(order[:SHOW]):
        move = None
        if prev is not None:
            move = (prev.index(slug) + 1 - (i + 1)) if slug in prev else "new"
        rows.append(_row(live[slug], i + 1, move))
    if is_live:
        hist["days"][end] = order[:60]
        cutoff = (today - timedelta(days=60)).isoformat()
        hist["days"] = {d: v for d, v in sorted(hist["days"].items()) if d >= cutoff}
        _write(HISTORY, json.dumps(hist, indent=0) + "\n")

    climbers = []
    if prev is not None:
        new = [r for r in rows[:20] if r["move"] == "new"]
        ups = sorted((r for r in rows[:30] if isinstance(r["move"], int) and r["move"] >= 2), key=lambda r: -r["move"])
        for r in (ups[:2] + new[:1] + ups[2:])[:3]:
            climbers.append({"name": r["name"], "url": r["url"],
                             "what": "new entry" if r["move"] == "new" else f"up {r['move']} places to {r['rank']}"})

    share = []
    if is_live:
        by_g = {}
        for slug, s in sc.items():
            g = GROUP_OF[live[slug]["type"]]
            by_g[g] = by_g.get(g, 0) + s
        total = sum(by_g.values())
        labels = {g: label for g, label, _ in GROUPS}
        for g, s in sorted(by_g.items(), key=lambda kv: -kv[1]):
            pct = round(100 * s / total)
            if pct >= 1:
                share.append({"group": g, "label": labels[g], "joke": GROUP_JOKE[g], "pct": pct})

    searches = [q for q, n in (signals.get("search") or {}).items() if n >= MIN_SEARCHES][:10]
    reports = _month_report(signals, live, today)
    wish = wishful(signals, live, today)
    fetched = signals.get("fetched") or ""
    try:
        updated = datetime.strptime(fetched, "%Y-%m-%dT%H:%MZ").strftime("%-d %B %Y")
    except ValueError:
        updated = today.strftime("%-d %B %Y")
    state = {"rows": rows, "live": is_live, "top": sc[order[0]] if order else 1, "scores": sc, "qualified": len(order),
             "climbers": climbers, "wish": wish, "share": share, "searches": searches,
             "report": reports[-1] if reports else None, "updated": updated,
             "since": _since(signals)}

    data = {"name": "UK Golf Demand Index", "source": "https://golfpriceai.com/demand/",
            "about": "What UK golfers are most interested in this week, from anonymous counts of price-page views, "
                     "shortlists and price alerts on GolfPrice AI. Free to use with a link to golfpriceai.com/demand/.",
            "licence": "CC BY 4.0", "date": end, "status": "live" if is_live else "warming up",
            "week": {"from": start, "to": end},
            "chart": [{k: r[k] for k in ("rank", "name", "brand", "type", "price", "unit", "move", "url")}
                      | {"url": "https://golfpriceai.com" + r["url"]} for r in rows[:20]] if is_live else [],
            "wishfulThinking": [{"category": w["label"], "averageGuessVsRealPricePct": w["off"], "guesses": w["guesses"]}
                                for w in wish],
            "categoryShare": [{"category": s["label"], "pct": s["pct"]} for s in share],
            "reports": [f"https://golfpriceai.com/demand/reports/{r['month']}/" for r in reports]}
    _write(INDEX_JSON, json.dumps(data, ensure_ascii=False, indent=1) + "\n")

    changed, sitemap = [], []
    if _write(PAGE_DIR / "index.html", page(state, today)):
        changed.append("/demand/")
    if is_live:
        sitemap.append(("demand/", None))
    for rp in reports:
        if _write(PAGE_DIR / "reports" / rp["month"] / "index.html", report_page(rp)):
            changed.append(f"/demand/reports/{rp['month']}/")
        sitemap.append((f"demand/reports/{rp['month']}/", None))
    print(f"Demand Index: {'live' if is_live else 'warming up'}, {len(order)} model(s) qualify, "
          f"{len(wish)} Wishful Thinking categor{'y' if len(wish) == 1 else 'ies'}.")
    return changed, sitemap


if __name__ == "__main__" and sys.argv[1:] == ["fetch"]:
    fetch()
