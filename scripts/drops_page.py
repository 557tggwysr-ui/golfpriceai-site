"""/prices/drops/ — "Golf price drops today": every genuine drop in the last
week on a model we have a price page for, newest first, rebuilt every 6 hours.

A drop counts when the model's lowest new, in-stock price fell by at least
£5 and 3% (the same bar as price alerts), it's still at that price now, and
the fall is under 60% (bigger is more likely a feed error). Measured against
our own price history, never a retailer's "was" price.
"""
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from price_pages import PRICES_DIR, SITE, TYPES, breadcrumb, esc, long_date, method_note, money, page_shell, plural, _write

MIN_POUNDS, MIN_PCT, MAX_PCT = 5.0, 0.03, 0.60
UK = ZoneInfo("Europe/London")


def recent_drops(models, built, today, days=7):
    out = []
    for m in models:
        if m["slug"] not in built:
            continue
        for e in reversed(m.get("events") or []):
            d = date.fromisoformat(e["date"])
            if (today - d).days > days:
                break
            if e["kind"] not in ("price_cut", "new_listing") or e["to"] >= e["from"]:
                continue
            fall = e["from"] - e["to"]
            if fall < max(MIN_POUNDS, e["from"] * MIN_PCT) or fall > e["from"] * MAX_PCT:
                continue
            if float(m["minPrice"]) > e["to"] + 0.005:
                continue  # it has gone back up since
            out.append({"m": m, "date": d, "from": e["from"], "to": e["to"], "fall": fall,
                        "pct": round(fall / e["from"] * 100)})
            break  # one row per model: its latest qualifying drop
    out.sort(key=lambda r: (r["date"], r["pct"]), reverse=True)
    return out


def when(d, today):
    n = (today - d).days
    return "Today" if n == 0 else "Yesterday" if n == 1 else f"{d.day} {d.strftime('%b')}"


def table(rows, today):
    trs = "".join(f"""<tr>
  <th scope="row"><a href="/prices/{r['m']['slug']}/">{esc(r['m']['name'])}</a><span class="pp-sub sb-type">{esc(TYPES[r['m']['type']][2])}{' · <span class="sb-down">lowest we’ve tracked</span>' if (r['m'].get('verdict') or {}).get('label') == 'good' else ''}</span><a class="sb-alert" href="/prices/{r['m']['slug']}/#price-alert">Email me if it drops again</a></th>
  <td><s>{money(r['from'])}</s></td>
  <td class="pp-price">{money(r['to'])}{' per dozen' if r['m']['type'] == 'ball' else ''}</td>
  <td><span class="sb-down">−{money(r['fall'])} ({r['pct']}%)</span></td>
  <td>{when(r['date'], today)}</td>
</tr>""" for r in rows)
    return f"""<div class="pp-card pp-table-wrap"><table class="pp-table sb-table">
<thead><tr><th scope="col">Model</th><th scope="col">Was</th><th scope="col">Now</th><th scope="col">Drop</th><th scope="col">When</th></tr></thead>
<tbody>{trs}</tbody></table></div>"""


def build(models, built, today):
    rows = recent_drops(models, built, today)
    fresh = [r for r in rows if (today - r["date"]).days <= 1]
    older = [r for r in rows if (today - r["date"]).days > 1]
    now_uk = datetime.now(timezone.utc).astimezone(UK)
    stamp = f"{now_uk.strftime('%H:00')} on {long_date(today)}"
    if fresh:
        top = max(fresh, key=lambda r: r["pct"])
        answer = (f"<strong>{plural(len(fresh), 'genuine price drop')}</strong> in the last 48 hours on the golf gear we "
                  f"track, the biggest on the {esc(top['m']['name'])}: down {money(top['fall'])} to {money(top['to'])}. "
                  f"Checked against our own price history, updated every 6 hours (last at {stamp}).")
    else:
        answer = (f"No genuine price drops in the last 48 hours on the golf gear we track (last checked at {stamp}). "
                  f"{plural(len(older), 'drop')} from earlier this week {'is' if len(older) == 1 else 'are'} still live below.")
    fresh_html = table(fresh, today) if fresh else '<p class="pp-card sb-empty">Nothing new in the last 48 hours. Prices are checked every 6 hours, so check back later.</p>'
    older_html = f"""<section class="pp-block">
  <h2>Earlier this week, still at the lower price</h2>
  {table(older[:60], today)}
</section>""" if older else ""
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Prices", "/prices/"), ("Price drops today", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Updated every 6 hours</span>
  <h1>Golf price drops today (UK)</h1>
  <p class="pp-answer">{answer}</p>
  <p class="pp-disclose">We may earn a commission if you buy through links on these pages. It never changes what’s listed or the order.</p>
</section>
<section class="pp-block">
  <h2>In the last 48 hours</h2>
  <p class="pp-small">A drop counts when the lowest new, in-stock price falls by at least £5 and 3% and stays there. Was: the price just before the drop. Want to hear about the next one? Tap “Email me if it drops again” under any model.</p>
  {fresh_html}
</section>
{older_html}
<section class="pp-block"><div class="pp-chips"><a class="pp-chip" href="/receipts.html">Biggest genuine drops on everything</a><a class="pp-chip" href="/prices/black-friday/">Black Friday tracker</a><a class="pp-chip" href="/prices/">All price guides</a></div></section>
{method_note(today)}
</div>"""
    item_list = {"@context": "https://schema.org", "@type": "ItemList", "name": "Golf price drops today (UK)",
                 "numberOfItems": len(rows),
                 "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": r["m"]["name"],
                                      "url": f"{SITE}/prices/{r['m']['slug']}/"} for i, r in enumerate(rows[:50])]}
    page = page_shell(title="Golf Price Drops Today UK: Genuine Drops Only | GolfPrice AI",
                      description="Every genuine UK golf price drop in the last week on drivers, irons, putters, balls, rangefinders and more, checked against our own price history every 6 hours.",
                      canonical=f"{SITE}/prices/drops/", body=body, section="", schema=[item_list, crumbs_schema], noindex=False)
    changed = ["/prices/drops/"] if _write(PRICES_DIR / "drops" / "index.html", page) else []
    # The same list as data, for the AI-assistant connector and anyone else.
    import json
    _write(PRICES_DIR / "drops" / "data.json", json.dumps({
        "checked": now_uk.isoformat(timespec="minutes"), "currency": "GBP",
        "rule": "Lowest new, in-stock price fell by at least £5 and 3% and is still at that price",
        "drops": [{"model": r["m"]["name"], "model_id": r["m"]["slug"], "date": r["date"].isoformat(),
                   "was": r["from"], "now": r["to"], "unit": "per dozen" if r["m"]["type"] == "ball" else "each",
                   "lowest_tracked": (r["m"].get("verdict") or {}).get("label") == "good",
                   "url": f"{SITE}/prices/{r['m']['slug']}/"} for r in rows]}, indent=1))
    print(f"Price drops page: {len(fresh)} in the last 48 hours, {len(older)} earlier this week.")
    return changed, [("prices/drops/", today.isoformat())], len(fresh)
