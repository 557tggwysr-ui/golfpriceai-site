"""The Friday "Genuine Drops" email.

Sent once a week at about 4pm UK time on Friday (the friday-email workflow
runs at 15:00 and 16:00 UTC so it's 4pm in both summer and winter time; a
later Friday run is the fallback), to everyone on the Brevo alerts list
who asked for it: people who signed up on the homepage or search page.
People who only asked to watch one model were promised no newsletter, so
they don't get it.

What counts as a genuine drop (all of these, from our own price history):
  * the model's page is live and passes the quality checks;
  * we've tracked it for at least 21 days;
  * its lowest new, in-stock price is down at least £5 and 5% on a week ago;
  * that price is the lowest, or equal lowest, of the previous 60 days
    (including the past week), so it isn't just undoing a recent rise;
  * the price hasn't been bouncing: at most 4 price changes in 60 days;
  * the fall is under 60%, otherwise it's more likely a feed error.
Up to 8 drops, biggest percentage first. A week with none sends nothing.

Personal data stays in Brevo; alerts-state.json only records which week was
sent and how many emails went out.

Preview without sending: python scripts/digest.py --preview out.html
"""
import html
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path

import alerts
from alerts import SITE, brevo, money, unsubscribe_link
from price_pages import retailer_name

ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_FILE = ROOT / "data" / "products.json"

MIN_DAYS_TRACKED = 21
MIN_DROP_POUNDS = 5.0
MIN_DROP_PCT = 0.05
LOOKBACK_DAYS = 60
MAX_CHANGES = 4
MAX_DROP_PCT = 0.60
MAX_ITEMS = 8
SEND_FROM_HOUR_UK = 16
UK = ZoneInfo("Europe/London")
DIGEST_SLUG = "friday-email"  # must match DIGEST_SLUG in workers/alerts-worker.js


# ---------------------------------------------------------------- choosing
def daily_prices(history, today):
    pts = [(date.fromisoformat(d), p) for d, p in history or []]
    out = {}
    for i, (d, p) in enumerate(pts):
        end = pts[i + 1][0] if i + 1 < len(pts) else today + timedelta(days=1)
        while d < end:
            out[d] = p
            d += timedelta(days=1)
    return out


def genuine_drops(models, today, images=None):
    images = images or {}
    picks = []
    for m in models.values():
        days = daily_prices(m.get("history"), today)
        if len(days) < MIN_DAYS_TRACKED:
            continue
        now = float(m["minPrice"])
        week_ago = days.get(today - timedelta(days=7))
        if week_ago is None:
            continue
        drop = week_ago - now
        if drop < max(MIN_DROP_POUNDS, week_ago * MIN_DROP_PCT) or drop > week_ago * MAX_DROP_PCT:
            continue
        start = today - timedelta(days=LOOKBACK_DAYS)
        before = [p for d, p in days.items() if start <= d < today]
        if not before or now > min(before) + 0.005:
            continue
        recent = sorted((d, p) for d, p in days.items() if d >= start)
        changes = sum(1 for a, b in zip(recent, recent[1:]) if a[1] != b[1])
        if changes > MAX_CHANGES:
            continue
        # Compare with everything before the past week (the drop itself
        # may be a few days old, so it's in the past week).
        older = [p for d, p in days.items() if d <= today - timedelta(days=7)]
        tracked_low = min(older)
        if now < tracked_low - 0.005:
            note = f"Lowest price in {len(days)} days of tracking"
        elif now <= tracked_low + 0.005:
            note = f"Back to its lowest in {len(days)} days of tracking"
        else:
            note = f"Lowest price in {LOOKBACK_DAYS} days"
        picks.append({
            "slug": m["slug"], "name": m["name"], "now": now, "was": week_ago, "drop": drop,
            "pct": round(drop / week_ago * 100), "ball": m.get("type") == "ball",
            "retailer": retailer_name(m["minRetailer"]) if m.get("minRetailer") else "a UK retailer",
            "retailers": len(m.get("retailers") or {}), "note": note,
            "image": next((images[i] for i in m.get("listingIds", []) if images.get(i)), None),
        })
    picks.sort(key=lambda x: (-x["pct"], -x["drop"]))
    return picks[:MAX_ITEMS]


def listing_images():
    if not PRODUCTS_FILE.exists():
        return {}
    data = json.loads(PRODUCTS_FILE.read_text())
    products = data["products"] if isinstance(data, dict) else data
    return {p["id"]: p.get("image") for p in products if p.get("image")}


# ---------------------------------------------------------------- tool spotlight
# One deal tool at the bottom of each Friday email, a different one each
# week, in this order (starting the week of 19 Oct 2026, then round again).
TOOL_SPOTLIGHT = [
    ("Is this a good price?", "/price-check.html", "good-price-wide.jpg",
     "Seen a price somewhere? Type it in and we’ll tell you if it’s good, fair or high, against every price we’ve recorded."),
    ("Back In Stock Radar", "/back-in-stock.html", "back-in-stock-wide.jpg",
     "See what’s just come back in stock, what’s sold out, and which gear sells out fastest."),
    ("Assemble Your Arsenal", "/build-your-bag.html", "../arsenal-banner-bag.jpg",
     "Pick your clubs, watch your bag fill up, and see the cheapest total across multiple UK retailers."),
    ("Find Your Fit", "/find-your-fit.html", "find-your-fit-wide.jpg",
     "Eight quick questions about your game, then the specs to look for and three models that fit."),
    ("Best Time To Buy", "/best-time-to-buy.html", "best-time-to-buy-wide.jpg",
     "Which gear barely moves in price, and which swings enough to be worth waiting for."),
    ("Complete the Kit", "/complete-the-kit.html", "complete-the-kit-wide.jpg",
     "Ready-made kits, like a driver with a headcover and tees, at the best prices we can find."),
    ("GolfPrice AI in ChatGPT & Claude", "/ai.html", "ai-assistant-wide.jpg",
     "Ask ChatGPT or Claude for live UK golf prices, straight from our data."),
]
SPOTLIGHT_START = date(2026, 10, 19)


def tool_spotlight(today):
    name, path, photo, text = TOOL_SPOTLIGHT[((today - SPOTLIGHT_START).days // 7) % len(TOOL_SPOTLIGHT)]
    url = (f"{SITE}{path}?utm_source=friday-email&utm_medium=email&utm_campaign=genuine-drops"
           f"&utm_content=tool-spotlight")
    src = f"{SITE}/assets/photos/tools/{photo}".replace("/tools/../", "/")
    return f"""<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;overflow:hidden;margin:24px 0 0">
<a href="{url}"><img src="{src}" alt="" width="528" style="display:block;width:100%;height:auto;border:0"></a>
<div style="padding:18px 20px 20px">
<p style="font-size:12px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:#2f8a1f;margin:0 0 6px">Deal tool of the week</p>
<p style="font-size:18px;font-weight:bold;margin:0 0 6px">{html.escape(name)}</p>
<p style="font-size:14px;line-height:1.5;color:#3d4a42;margin:0 0 14px">{html.escape(text)} Free, no sign-up.</p>
<a href="{url}" style="display:inline-block;background:#16241c;color:#fff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:10px;font-size:14px">Try {html.escape(name)}</a>
</div></div>"""


# ---------------------------------------------------------------- writing
def link(slug, part):
    return f"{SITE}/prices/{slug}/?utm_source=friday-email&utm_medium=email&utm_campaign=genuine-drops&utm_content={part}"


def email_html(picks, today, stop_digest, stop_all):
    top, rest = picks[0], picks[1:]
    per = lambda d: " per dozen" if d["ball"] else ""
    img = (f'<img src="{html.escape(top["image"])}" alt="" width="160" style="display:block;width:160px;max-width:40%;height:auto;'
           f'border-radius:10px;background:#fff;margin:0 auto 14px">') if top.get("image") else ""
    rows = "".join(f"""<tr>
<td style="padding:14px 0;border-top:1px solid #e7e9e5;vertical-align:top">
<a href="{link(d['slug'], 'row')}" style="color:#16241c;text-decoration:none;font-weight:bold;font-size:15px">{html.escape(d['name'])}</a>
<div style="font-size:13px;color:#5b665f;margin-top:3px">{html.escape(d['note'])} · cheapest at {html.escape(d['retailer'])}</div>
</td>
<td style="padding:14px 0 14px 12px;border-top:1px solid #e7e9e5;text-align:right;vertical-align:top;white-space:nowrap">
<div style="font-weight:bold;font-size:16px">{money(d['now'])}</div>
<div style="font-size:12px;color:#5b665f"><s>{money(d['was'])}</s> <span style="color:#2f8a1f;font-weight:bold">−{d['pct']}%</span></div>
</td></tr>""" for d in rest)
    rest_html = f"""<p style="font-size:13px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:#5b665f;margin:26px 0 4px">Also down this week</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">{rows}</table>""" if rest else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="display:none;max-height:0;overflow:hidden">{html.escape(top['name'])} down {money(top['drop'])}, and {len(rest)} more genuine drops this week.</div>
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:22px;font-weight:bold;margin:0">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:13px;color:#5b665f;margin:4px 0 20px">Genuine Drops · Friday {today.day} {today.strftime('%B %Y')}</p>
<p style="font-size:15px;line-height:1.55;margin:0 0 18px">This week’s real UK price falls, measured against the prices we’ve recorded ourselves every 6 hours, not a retailer’s “was” price. Each one is at its lowest price for at least two months, or since we started tracking it.</p>
<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:22px;text-align:center">
<p style="font-size:12px;font-weight:bold;letter-spacing:.04em;text-transform:uppercase;color:#2f8a1f;margin:0 0 12px">Biggest drop this week</p>
{img}
<p style="font-size:19px;font-weight:bold;margin:0 0 6px">{html.escape(top['name'])}</p>
<p style="font-size:15px;line-height:1.5;margin:0">Now <strong style="font-size:22px">{money(top['now'])}</strong>{per(top)} at {html.escape(top['retailer'])}<br>
<span style="color:#5b665f">was {money(top['was'])} a week ago · down {money(top['drop'])} ({top['pct']}%)</span></p>
<p style="font-size:13px;color:#2f8a1f;font-weight:bold;margin:10px 0 0">{html.escape(top['note'])}</p>
<p style="margin:18px 0 0"><a href="{link(top['slug'], 'top')}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:10px">See the price history</a></p>
</div>
{rest_html}
<div style="background:#f2f7ef;border-radius:12px;padding:14px 16px;margin:24px 0 0;font-size:13px;line-height:1.5">
<strong>How we pick these:</strong> down at least £5 and 5% on a week ago, at its lowest price in 60 days (or since we started tracking it), and not a price that keeps bouncing up and down. If nothing qualifies, we don’t send anything.
</div>
{tool_spotlight(today)}
<p style="font-size:12px;color:#5b665f;line-height:1.55;margin:20px 0 0">Prices change on retailers’ sites, so check before you buy. We may earn a commission if you buy through our links; it never changes the price or what we pick.<br>
No countdown timers. No fake discounts.<br>
<a href="{stop_digest}" style="color:#5b665f">Stop the Friday email</a> · <a href="{stop_all}" style="color:#5b665f">Unsubscribe from all GolfPrice AI emails</a></p>
</div></body></html>"""


def subject(picks):
    top = picks[0]
    more = f", plus {len(picks) - 1} more" if len(picks) > 1 else ""
    return f"Genuine Drops: {top['name']} down {money(top['drop'])}{more}"


# ---------------------------------------------------------------- main
def due(state, now):
    week = now.strftime("%G-W%V")
    uk = now.astimezone(UK)
    return uk.weekday() == 4 and uk.hour >= SEND_FROM_HOUR_UK and (state.get("digest") or {}).get("week") != week


def main(argv):
    today = date.today()
    if len(argv) > 2 and argv[1] == "--preview":
        picks = genuine_drops(alerts.live_models(), today, listing_images())
        if not picks:
            print("Friday email: no genuine drops this week.")
            return 0
        page = email_html(picks, today, "#stop-friday-email", "#unsubscribe")
        Path(argv[2]).write_text(page)
        print(f"Friday email preview: {subject(picks)} -> {argv[2]}")
        return 0

    key, secret = os.environ.get("BREVO_API_KEY"), os.environ.get("ALERTS_SECRET")
    now = datetime.now(timezone.utc)
    state = alerts.load_state()
    if not due(state, now):
        return 0
    if not key or not secret:
        print("Friday email: Brevo secrets not set, skipping.")
        return 0
    picks = genuine_drops(alerts.live_models(), today, listing_images())
    if not picks:
        print("Friday email: no genuine drops this week, so nothing sent.")
        state["digest"] = {"week": now.strftime("%G-W%V"), "sent": 0}
        alerts.save_state(state)
        return 0
    try:
        people = [s["email"] for s in alerts.subscribers(key) if s["digest"]]
    except Exception as e:
        print(f"Friday email: couldn't read subscribers ({e}); will try on the next run.")
        return 0

    today_s = today.isoformat()
    sent_today = state.get("sent", {}).get(today_s, 0)
    sent = failed = capped = 0
    for email in people:
        if sent_today + sent >= alerts.DAILY_CAP:
            capped += 1
            continue
        stop_digest = unsubscribe_link(secret, email, DIGEST_SLUG)
        stop_all = unsubscribe_link(secret, email)
        status, data = brevo(key, "POST", "/smtp/email", {
            "sender": alerts.SENDER, "to": [{"email": email}], "subject": subject(picks),
            "htmlContent": email_html(picks, today, stop_digest, stop_all),
            "headers": {"List-Unsubscribe": f"<{stop_all}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
            "tags": ["friday-email"],
        })
        if status in (200, 201, 202):
            sent += 1
        else:
            failed += 1
            print(f"Friday email: a send failed ({status}): {data.get('message', '')}")
    if sent or not people:
        state["digest"] = {"week": now.strftime("%G-W%V"), "sent": sent}
    state["sent"] = {today_s: sent_today + sent}
    alerts.save_state(state)
    print(f"Friday email: {len(picks)} drop(s); sent to {sent} of {len(people)} subscriber(s)"
          + (f", {failed} failed" if failed else "")
          + (f", {capped} held back by the daily limit" if capped else "") + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
