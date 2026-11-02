"""Used-only price pages: older golf clubs that are no longer sold new.

/prices/used/<slug>/   one page per older model with used stock: "Used TaylorMade
                       M4 driver price UK". The typical (middle) used price, the
                       cheapest and dearest, every used one on sale with a hand /
                       loft / flex filter, the used value over time, today's new
                       models from the same brand, and FAQ answers.
/prices/used/<type>/   a hub per club type ("Used drivers UK"), by brand.

The model pages only cover models that are sold new somewhere, so a used
listing whose model has no new stock never had a page. Here those listings are
grouped with the same rules as data/models.json (scripts/models.py), and a
model gets a page once it has MIN_LISTINGS used clubs on sale at the same time.

data/used-models.json remembers every page: the typical price each day (the
"value over time" line) and the last listings seen. A page stays up, with its
last known prices, for KEEP_DAYS after its last used club sells, so rankings
don't vanish whenever stock does. A model that comes back new moves to its
normal price page.

Used stock only: never counts towards new prices, verdicts or alerts. Junior
clubs are left out.
"""
import json
import re
import shutil
import statistics
from collections import Counter, defaultdict
from datetime import date, timedelta

import models as M
import used_specs
from price_pages import (PRICES_DIR, ROOT, SITE, breadcrumb, esc, long_date, method_note, money,
                         page_shell, plural, _write)

STATE = ROOT / "data" / "used-models.json"
MIN_LISTINGS = 3
KEEP_DAYS = 180
CSS = '<link rel="stylesheet" href="/css/used-models.css?v=20261102a">\n'
# type key: (hub slug, plural label, noun)
KINDS = {
    "driver": ("drivers", "Drivers", "driver"),
    "wood": ("fairway-woods", "Fairway woods", "fairway wood"),
    "hybrid": ("hybrids", "Hybrids", "hybrid"),
    "irons": ("irons", "Iron sets", "iron set"),
    "wedge": ("wedges", "Wedges", "wedge"),
    "putter": ("putters", "Putters", "putter"),
}
HUB_SLUGS = {v[0] for v in KINDS.values()}
JUNIOR_RX = re.compile(r"\b(junior|juniors|kids?|youth)\b", re.I)
# Shaft makers: a listing filed under one of these is a shaft or a club whose
# real brand wasn't found, never a model of its own.
SHAFT_BRANDS = {"aldila", "fujikura", "project x", "mitsubishi", "mitsubishi chemical", "kbs", "true temper", "graphite design",
                "ust", "ust mamiya", "nippon", "accra", "oban", "lamkin", "golf pride", "winn", "superstroke"}
FLEX_ORDER = ["Ladies", "Senior", "Regular", "Stiff/Regular", "Stiff", "Extra stiff"]


# ---------------------------------------------------------------- grouping
def group_used_only(products, model_slugs):
    """{slug: {"name", "type", "brand", "listings"}} for every model with used
    stock and no new stock, grouped exactly as models.py groups them."""
    aliases = M.load_aliases()
    groups, meta = defaultdict(list), {}
    for p in products:
        if p.get("salePrice") is None:
            continue
        t = M._model_type(p)
        if not t or t[1] not in KINDS:
            continue
        group, type_key, type_label = t
        tokens = M._core_tokens(p, type_key, aliases)
        brand = M._brand_of(p)
        key = f"{brand.lower()}|{type_key}|{' '.join(tokens)}"
        groups[key].append(p)
        meta[key] = (type_key, type_label, brand, tokens)
    out = {}
    for key, listings in groups.items():
        type_key, type_label, brand, tokens = meta[key]
        if not tokens or not brand or brand.lower() in ("unknown", "other") or brand.lower() in SHAFT_BRANDS:
            continue
        if any(M._is_new(p) and p.get("inStock", True) for p in listings):
            continue
        used = [p for p in listings if not M._is_new(p) and p.get("inStock", True)
                and p.get("salePrice") and not JUNIOR_RX.search(p.get("name", ""))]
        if not used:
            continue
        words = [brand] + M._display_tokens(tokens, listings) + [type_label]
        name = []
        for w in " ".join(words).split():
            if not name or name[-1].lower() != w.lower():
                name.append(w)
        name = " ".join(name).strip()
        slug = M._slugify(name.replace("+", " plus"))
        if not slug or slug in model_slugs or slug in HUB_SLUGS:
            continue
        g = out.setdefault(slug, {"name": name, "type": type_key, "brand": brand, "listings": []})
        g["listings"].extend(used)
    # A listing far below the rest of its model is usually a different
    # product sharing the name (a head only, a shaft): leave it out.
    for g in out.values():
        ls = g["listings"]
        if len(ls) >= 4:
            med = statistics.median(p["salePrice"] for p in ls)
            g["listings"] = [p for p in ls if p["salePrice"] >= med * 0.35]
    return out


def _shaft_name(name):
    if " - " not in name:
        return ""
    tail = name.split(" - ", 1)[1].strip()
    return "" if re.fullmatch(r"used", tail, re.I) else tail[:40]


def summarise(g):
    ls = sorted(g["listings"], key=lambda p: p["salePrice"])
    prices = [round(p["salePrice"], 2) for p in ls]
    items = []
    for p in ls:
        sp = used_specs.specs(p["name"], g["type"])
        items.append({"p": round(p["salePrice"], 2), "h": sp.get("hand") or "", "l": sp.get("loft") or "",
                      "f": sp.get("flex") or "", "s": " · ".join(x for x in (sp.get("shaft"), _shaft_name(p["name"])) if x),
                      "g": used_specs.grade(p), "u": p.get("affiliateUrl") or "", "i": p.get("image") or "", "n": p.get("name", "")[:120]})
    return {"count": len(prices), "min": prices[0], "max": prices[-1], "median": round(statistics.median(prices), 2), "items": items}


# ---------------------------------------------------------------- state
def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {"v": 1, "m": {}}


def update_state(state, groups, today):
    t = today.isoformat()
    ms = state.setdefault("m", {})
    for slug, g in groups.items():
        s = summarise(g)
        rec = ms.get(slug)
        if not rec and s["count"] < MIN_LISTINGS:
            continue
        rec = rec or {"first": t}
        rec.update({"n": g["name"], "t": g["type"], "b": g["brand"], "last": t, "snap": s})
        h = rec.setdefault("h", [])
        point = [t, s["median"], s["min"], s["count"]]
        if h and h[-1][0] == t:
            h[-1] = point
        else:
            h.append(point)
        rec["h"] = h[-400:]
        ms[slug] = rec
    for slug, rec in ms.items():
        if slug not in groups and rec.get("last") != t:
            rec["gone"] = True
        else:
            rec.pop("gone", None)
    return state


# ---------------------------------------------------------------- pages
def _spec_counts(items, key):
    c = Counter(it[key] for it in items if it[key])
    if key == "l":
        order = sorted(c, key=lambda v: float(v.rstrip("°")))
    elif key == "f":
        order = sorted(c, key=lambda v: FLEX_ORDER.index(v) if v in FLEX_ORDER else 99)
    else:
        order = sorted(c, key=lambda v: (v != "Right", v))
    return [(v, c[v]) for v in order]


def _chart(h, noun):
    pts = [(date.fromisoformat(d), med) for d, med, _, _ in h]
    if len(pts) < 2:
        return (f'<p class="um-note">We started tracking used {esc(noun)} prices for this model on {long_date(pts[0][0])}. '
                f'The line fills in as prices change: check back to see whether it’s holding its value.</p>')
    d0, d1 = pts[0][0], pts[-1][0]
    days = max((d1 - d0).days, 1)
    vals = [v for _, v in pts]
    lo, hi = min(vals), max(vals)
    pad = max((hi - lo) * 0.15, 5)
    lo, hi = lo - pad, hi + pad
    xy = [(round((d - d0).days / days * 1000, 1), round(150 - (v - lo) / (hi - lo) * 130, 1)) for d, v in pts]
    line = " ".join(f"{x},{y}" for x, y in xy)
    first, last = vals[0], vals[-1]
    move = ("holding steady" if abs(last - first) < 1 else
            f"down {money(first - last)}" if last < first else f"up {money(last - first)}")
    return f"""<svg class="um-chart" viewBox="0 0 1000 160" preserveAspectRatio="none" role="img" aria-label="Typical used price from {money(first)} on {long_date(d0)} to {money(last)} on {long_date(d1)}">
<line x1="0" y1="150" x2="1000" y2="150" stroke="#e3ebe1"></line><polyline points="{line}" fill="none" stroke="#2f8a1f" stroke-width="3" vector-effect="non-scaling-stroke"></polyline></svg>
<div class="um-axis"><span>{long_date(d0)}: {money(first)}</span><span>Typical used price, {move}</span><span>{long_date(d1)}: {money(last)}</span></div>"""


def model_page(slug, rec, state, new_models, today):
    name, kind = rec["n"], rec["t"]
    hub, hub_label, noun = KINDS[kind]
    s = rec["snap"]
    gone = rec.get("gone")
    items = s["items"]
    brand = rec["b"]
    short = re.sub(rf"^{re.escape(brand)}\s+", "", name)
    short = re.sub(rf"\s+{re.escape(noun)}$", "", short, flags=re.I) or short
    newer = sorted([m for m in new_models if m["brand"] == brand and m["type"] == kind], key=lambda m: m["minPrice"])[:3]
    new_from = newer[0]["minPrice"] if newer else None
    ms = state["m"]
    others = sorted([(k, r) for k, r in ms.items() if k != slug and r["t"] == kind and r["b"] == brand],
                    key=lambda kr: (kr[1].get("gone", False), -kr[1]["snap"]["count"]))[:8]
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Used golf clubs", "/prices/used/"),
                                             (f"Used {hub_label.lower()}", f"/prices/used/{hub}/"), (name, None)])
    checked = long_date(today)
    if gone:
        last_seen = long_date(rec["last"])
        answer = (f"There’s no used {esc(name)} on sale at the UK retailers we check right now. When we last saw them, on "
                  f"{last_seen}, a used one cost about <b>{money(s['median'])}</b> ({plural(s['count'], 'for sale', 'for sale')}, "
                  f"from {money(s['min'])} to {money(s['max'])}). We check every 6 hours, so this page updates as soon as one turns up.")
    else:
        answer = (f"A used {esc(name)} costs about <b>{money(s['median'])}</b> today. <b>{s['count']} {'is' if s['count'] == 1 else 'are'} for sale</b> "
                  f"across multiple UK retailers" + (f", from {money(s['min'])} to {money(s['max'])}" if s['count'] > 1 else f", at {money(s['min'])}") + ". "
                  f"The {esc(short)} isn’t sold new any more" + (f": today’s {esc(brand)} {esc(hub_label.lower())} start at {money(new_from)}." if new_from else "."))
    tiles = [("Typical used", money(s["median"]), True), ("Cheapest", money(s["min"]), False), ("Dearest", money(s["max"]), False),
             ("For sale" if not gone else "Last seen", str(s["count"]) if not gone else long_date(rec["last"]).rsplit(" ", 1)[0], False)]
    tiles_html = "".join(f'<div{" class=\"um-hi\"" if hi else ""}><small>{a}</small><b>{v}</b></div>' for a, v, hi in tiles)

    listing_html = ""
    if not gone:
        lo, hi = s["min"], s["max"]
        bot, top = lo * 0.95, hi * 1.05
        span = (top - bot) or 1
        dots = "".join(f'<i style="left:{round((it["p"] - bot) / span * 100, 1)}%;top:{8 + (k % 3) * 10}px"></i>' for k, it in enumerate(items))
        def chips(key, label):
            vals = _spec_counts(items, key)
            if not vals or (len(vals) == 1 and len(items) < 2):
                return ""
            b = "".join(f'<button type="button" class="um-chip" data-k="{key}" data-v="{esc(v)}" aria-pressed="false">{esc(v)}{" hand" if key == "h" else ""} <small>({n})</small></button>' for v, n in vals)
            return f'<div class="um-row"><span>{label}</span><div>{b}</div></div>'
        finder = chips("h", "Hand") + chips("l", "Loft") + chips("f", "Flex")
        rows = "".join(
            f'<tr data-h="{esc(it["h"])}" data-l="{esc(it["l"])}" data-f="{esc(it["f"])}"><td><b>{money(it["p"])}</b></td><td>{esc(it["h"] or "–")}</td>'
            + (f'<td>{esc(it["l"] or "–")}</td>' if kind not in ("putter", "irons") else "")
            + (f'<td>{esc(it["f"] or "–")}</td>' if kind != "putter" else "")
            + f'<td class="um-shaft">{esc(it["s"] or "–")}</td><td class="um-cond">{esc(it["g"])}</td>'
            f'<td class="um-go">' + (f'<a href="{esc(it["u"])}" rel="sponsored nofollow noopener" target="_blank">See it</a>' if it["u"] else "") + "</td></tr>"
            for it in items)
        head = ("<th scope=\"col\">Price</th><th scope=\"col\">Hand</th>" + ("<th scope=\"col\">Loft</th>" if kind not in ("putter", "irons") else "")
                + ("<th scope=\"col\">Flex</th>" if kind != "putter" else "") + "<th scope=\"col\" class=\"um-shaft\">Shaft</th><th scope=\"col\" class=\"um-cond\">Condition</th><th scope=\"col\"><span class=\"um-sr\">Link</span></th>")
        img = next((it["i"] for it in items if it["i"]), "")
        listing_html = f"""<section class="pp-block um-card" id="for-sale">
  <h2>Every used {esc(short)} on sale today</h2>
  <div class="um-strip" role="img" aria-label="{plural(s['count'], 'used price')} from {money(lo)} to {money(hi)}">{dots}</div>
  <div class="um-axis"><span>{money(bot).split('.')[0]}</span><span>Each dot is one used {esc(noun)} for sale today</span><span>{money(top).split('.')[0]}</span></div>
  {f'<div class="um-fit"><h3>Find one that fits you</h3>{finder}</div>' if finder else ''}
  <div class="um-tw"><table class="um-table"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table></div>
  <p class="um-showing" id="um-showing" aria-live="polite">Showing all {s['count']}, cheapest first.</p>
</section>"""
    else:
        img = ""

    new_html = ""
    if newer:
        new_html = (f'<div class="um-side"><h2>Rather have one new?</h2><p class="um-note">Today’s {esc(brand)} {esc(KINDS[newer[0]["type"]][1].lower() if newer[0]["type"] in KINDS else hub_label.lower())}, at their lowest UK price</p>'
                    + "".join(f'<a class="um-new" href="/prices/{m["slug"]}/"><span>{esc(m["name"])}</span><b>from {money(m["minPrice"])}</b></a>' for m in newer) + "</div>")
    other_html = ""
    if others:
        other_html = (f'<div class="um-side"><h2>Other used {esc(brand)} {esc(hub_label.lower())}</h2><div class="um-others">'
                      + "".join(f'<a class="pp-chip" href="/prices/used/{k}/">{esc(re.sub(rf"^{re.escape(brand)}\s+", "", r["n"]))} '
                                f'<small>{"last seen " + money(r["snap"]["median"]) if r.get("gone") else "from " + money(r["snap"]["min"])}</small></a>' for k, r in others)
                      + f'</div><a class="um-all" href="/prices/used/{hub}/">All used {esc(hub_label.lower())} →</a></div>')
    else:
        other_html = f'<div class="um-side"><h2>More used {esc(hub_label.lower())}</h2><a class="um-all" href="/prices/used/{hub}/">All used {esc(hub_label.lower())} →</a></div>'

    # Questions people search for, answered from today's data.
    faqs = []
    if gone:
        faqs.append((f"How much is a used {name} worth?",
                     f"About {money(s['median'])}, the typical price when we last saw one for sale, on {long_date(rec['last'])}. "
                     f"Used ones then ranged from {money(s['min'])} to {money(s['max'])}, depending on spec and condition."))
    else:
        faqs.append((f"How much is a used {name} worth?",
                     f"About {money(s['median'])} today: that’s the typical price of the {plural(s['count'], 'used ' + short + ' ' + noun)} on sale across multiple UK retailers."
                     + (f" The cheapest is {money(s['min'])} and the dearest {money(s['max'])}, depending on spec, shaft and condition." if s['count'] > 1 else "")))
    faqs.append((f"Can you still buy a {name} new?",
                 f"Not from the UK retailers we check: the {short} is only on sale used." + (f" {brand}’s current {hub_label.lower()} start at {money(new_from)} new." if new_from else "")))
    if not gone and s["count"] >= 3 and kind != "putter":
        hands = Counter(it["h"] for it in items if it["h"])
        lofts = Counter(it["l"] for it in items if it["l"])
        flexes = Counter(it["f"] for it in items if it["f"])
        bits = [v.most_common(1)[0][0] + (" hand" if k == "h" else (" flex" if k == "f" else "")) for k, v in (("h", hands), ("l", lofts), ("f", flexes)) if v]
        if bits:
            left = hands.get("Left", 0)
            faqs.append((f"Which used {short} {noun}s are easiest to find?",
                         f"{', '.join(b[0].upper() + b[1:] if i == 0 else b for i, b in enumerate(bits))}: most of the used ones on sale today are one or more of those."
                         + (f" Left-handed ones are rarer, with {left} on sale." if 0 < left < hands.get("Right", 0) else
                            " There are no left-handed ones on sale today." if not left and hands else "")))
    faq_html = "".join(f'<div class="um-q"><h3>{esc(q)}</h3><p>{esc(a)}</p></div>' for q, a in faqs)

    body = f"""<div class="pp-wrap um">
{crumbs_html}
<section class="um-hero">
  <div class="um-hero-txt">
    <span class="um-kick">Used price guide · updated every 6 hours</span>
    <h1>Used {esc(name)} price UK</h1>
    <p class="pp-answer">{answer}</p>
    <span class="um-checked">Checked {checked} · Used stock only · Condition is each retailer’s own grading</span>
  </div>
  <div class="um-tiles">{tiles_html}</div>
</section>
{listing_html}
<section class="pp-block um-card">
  <h2>Used {esc(short)} value over time</h2>
  <p class="um-note">The typical used price, every day we check.</p>
  {_chart(rec["h"], noun)}
</section>
<section class="pp-block um-two">{new_html}{other_html}</section>
<section class="pp-block um-card">
  <h2>Used {esc(name)}: questions</h2>
  {faq_html}
</section>
<p class="pp-small um-small">Used prices from multiple UK retailers, checked every 6 hours. Condition is the retailer’s own grading. Used clubs never count towards new prices, verdicts or price alerts.</p>
{method_note(today)}
</div>
{'<script src="/js/used-models.js?v=20261102a" defer></script>' if not gone else ''}"""
    product = {"@context": "https://schema.org", "@type": "Product", "name": f"{name} (used)", "brand": {"@type": "Brand", "name": brand},
               "category": f"Golf clubs > {hub_label}", "url": f"{SITE}/prices/used/{slug}/"}
    if img:
        product["image"] = img
    if not gone:
        product["offers"] = {"@type": "AggregateOffer", "priceCurrency": "GBP", "lowPrice": f"{s['min']:.2f}", "highPrice": f"{s['max']:.2f}",
                             "offerCount": s["count"], "itemCondition": "https://schema.org/UsedCondition", "availability": "https://schema.org/InStock"}
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}
    desc = (f"A used {name} costs about {money(s['median'])}: {s['count']} on sale from {money(s['min'])} across multiple UK retailers, "
            f"by hand, loft and flex. Updated every 6 hours." if not gone else
            f"What a used {name} is worth: about {money(s['median'])} when last seen for sale in the UK. We check every 6 hours.")
    return page_shell(title=f"Used {name} Price UK: What’s It Worth? | GolfPrice AI", description=desc,
                      canonical=f"{SITE}/prices/used/{slug}/", body=body, section="", schema=[product] + ([faq_schema] if faqs else []) + [crumbs_schema],
                      noindex=False, extra_head=CSS, og_image=None)


def hub_page(kind, recs, today):
    hub, label, noun = KINDS[kind]
    live = [(k, r) for k, r in recs if not r.get("gone")]
    total = sum(r["snap"]["count"] for _, r in live)
    by = defaultdict(list)
    for k, r in recs:
        by[r["b"]].append((k, r))
    brands = sorted(by, key=lambda b: (-len(by[b]), b.lower()))
    chips = "".join(f'<a class="pp-chip" href="#{M._slugify(b)}">{esc(b)} ({len(by[b])})</a>' for b in brands)
    secs = []
    for b in sorted(by, key=lambda b: b.lower()):
        rows = "".join(
            f'<tr data-n="{esc(r["n"].lower())}"><th scope="row"><a href="/prices/used/{k}/">{esc(r["n"])}</a></th>'
            + (f'<td><b>{money(r["snap"]["min"])}</b></td><td>{money(r["snap"]["median"])}</td><td>{r["snap"]["count"]}</td>' if not r.get("gone") else
               f'<td colspan="3" class="um-none">None right now · last seen {long_date(r["last"])} at about {money(r["snap"]["median"])}</td>') + "</tr>"
            for k, r in sorted(by[b], key=lambda kr: (kr[1].get("gone", False), -kr[1]["snap"]["count"], kr[1]["n"])))
        secs.append(f"""<section class="pp-block um-sec" id="{M._slugify(b)}"><h2>{esc(b)}</h2>
<div class="um-tw um-card0"><table class="um-table um-hubt"><thead><tr><th scope="col">Model</th><th scope="col">Used from</th><th scope="col">Typical</th><th scope="col">For sale</th></tr></thead><tbody>{rows}</tbody></table></div></section>""")
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Used golf clubs", "/prices/used/"), (f"Used {label.lower()}", None)])
    answer = (f"<b>{plural(total, 'used ' + noun)}</b> on sale today across <b>{plural(len(live), 'model')}</b> no longer sold new, from multiple UK retailers. "
              f"Each has its own price guide: the typical used price, the cheapest, and which specs are about.")
    body = f"""<div class="pp-wrap um">
{crumbs_html}
<section class="pp-hub-top">
  <span class="um-kick um-kick-d">Used price guide · updated every 6 hours</span>
  <h1>Used {esc(label.lower())} UK: what’s an older {esc(noun)} worth?</h1>
  <p class="pp-answer">{answer}</p>
  <label class="um-find"><span>Find a model</span><input type="search" id="um-q" placeholder="Type a model name" autocomplete="off"></label>
  <div class="pp-chips">{chips}</div>
</section>
{''.join(secs)}
<p class="pp-small" id="um-none" hidden>No model matches that search. Try a shorter name.</p>
<section class="pp-block"><div class="um-dark"><b>Still sold new?</b><span>Current clubs with used stock too are in the main used price guide, next to their lowest new price.</span><a href="/prices/used/">Used golf club prices: new vs used →</a></div></section>
{method_note(today)}
</div>
<script src="/js/used-models.js?v=20261102a" defer></script>"""
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": f"Used {label.lower()} UK", "numberOfItems": len(recs),
                 "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": r["n"], "url": f"{SITE}/prices/used/{k}/"}
                                     for i, (k, r) in enumerate(sorted(recs, key=lambda kr: -kr[1]["snap"]["count"])[:50])]}
    return page_shell(title=f"Used {label} UK: Prices for Older Models | GolfPrice AI",
                      description=(f"{total:,} used {noun}s on sale across {len(live)} older models no longer sold new: the typical used price, "
                                   f"the cheapest and the specs, by brand. Updated every 6 hours."),
                      canonical=f"{SITE}/prices/used/{hub}/", body=body, section="", schema=[item_list, crumbs_schema], noindex=False, extra_head=CSS)


def build(models_list, products, built, today):
    """Returns (changed paths, sitemap entries, hub links for /prices/used/)."""
    model_slugs = {m["slug"] for m in models_list} | set(built)
    groups = group_used_only(products, model_slugs)
    state = update_state(load_state(), groups, today)
    cut = (today - timedelta(days=KEEP_DAYS)).isoformat()
    ms = state["m"]
    drop = [k for k, r in ms.items() if r["last"] < cut or k in model_slugs or r["t"] not in KINDS or r["b"].lower() in SHAFT_BRANDS]
    for k in drop:
        ms.pop(k, None)
        d = PRICES_DIR / "used" / k
        if d.is_dir() and k not in HUB_SLUGS:
            shutil.rmtree(d, ignore_errors=True)
    STATE.write_text(json.dumps(state, separators=(",", ":"), ensure_ascii=False))
    new_models = [m for m in models_list if m["slug"] in built and m.get("minPrice")]
    changed, sitemap, links = [], [], []
    for k, r in ms.items():
        if _write(PRICES_DIR / "used" / k / "index.html", model_page(k, r, state, new_models, today)):
            changed.append(f"/prices/used/{k}/")
        sitemap.append((f"prices/used/{k}/", r["last"]))
    by_kind = defaultdict(list)
    for k, r in ms.items():
        by_kind[r["t"]].append((k, r))
    for kind in KINDS:
        recs = by_kind.get(kind)
        hub = KINDS[kind][0]
        if not recs:
            continue
        if _write(PRICES_DIR / "used" / hub / "index.html", hub_page(kind, recs, today)):
            changed.append(f"/prices/used/{hub}/")
        sitemap.append((f"prices/used/{hub}/", today.isoformat()))
        live = [r for _, r in recs if not r.get("gone")]
        links.append((hub, KINDS[kind][1], len(recs), sum(r["snap"]["count"] for r in live)))
    print(f"Used-only pages: {len(ms)} models ({sum(1 for r in ms.values() if not r.get('gone'))} with stock), {len(changed)} page(s) changed.")
    return changed, sitemap, links
