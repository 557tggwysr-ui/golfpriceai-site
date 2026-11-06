"""The monthly UK Golf Price Report email.

Everyone who signed up on a report or press note page ("Get the UK Golf Price
Report each month", Brevo attribute PRESS = yes, double opt-in through the
alerts worker) gets one email when a new edition is out: the headline figures,
John's quote if there is one, and links to the report and the press note.

Run by .github/workflows/press-email.yml every morning; it sends once per
edition (data/alerts-state.json remembers the last month sent) and only for
an edition published in the last 10 days, so a late first run never sends an
old one. Names no retailers. One-click unsubscribe in every email.

  python scripts/press_email.py               send if due
  python scripts/press_email.py --preview f   write the latest email to file f
"""
import html
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import alerts
from alerts import SITE, brevo, unsubscribe_link

ROOT = Path(__file__).resolve().parent.parent
WATCH = ROOT / "prices" / "watch"
QUOTES = ROOT / "data" / "press-quotes.json"
SLUG = "press-report"  # must match the unsubscribe handler in workers/alerts-worker.js
FRESH_DAYS = 10


def latest():
    eds = sorted((d for d in WATCH.iterdir() if (d / "facts.json").exists()), reverse=True) if WATCH.exists() else []
    return json.loads((eds[0] / "facts.json").read_text()) if eds else None


def subject(f):
    return f"The UK Golf Price Report, {f['name']}: {f['fell']} of {f['models']:,} golf models got cheaper"


def email_html(f, stop_press, stop_all):
    e = html.escape
    try:
        q = json.loads(QUOTES.read_text()).get(f["month"])
    except Exception:
        q = None
    share = round(f["fell"] / f["models"] * 100)
    url = f"{SITE}/prices/watch/{f['month']}/?utm_source=press-email&utm_medium=email&utm_campaign=price-report"
    press = f"{SITE}/prices/watch/{f['month']}/press/?utm_source=press-email&utm_medium=email&utm_campaign=price-report"
    figs = [f"{f['fell']} of {f['models']:,} models cheaper at month end ({share}%)", f"{f['rose']} models dearer"]
    if f.get("at_low"):
        figs.append(f"{f['at_low']} models at their lowest tracked price")
    quote = (f'<p style="margin:16px 0;padding:12px 16px;background:#f4f7f3;border-radius:10px;font-style:italic">“{e(q["text"])}”'
             f'<br><span style="font-style:normal;font-size:13px;color:#4a554e">{e(q.get("who", ""))}</span></p>') if q else ""
    return f"""<!doctype html><html><body style="margin:0;background:#f4f7f3;font-family:Arial,sans-serif;color:#14211a">
<div style="max-width:560px;margin:0 auto;padding:24px 18px">
<p style="font-size:13px;font-weight:bold;letter-spacing:.08em;color:#2f6f22;margin:0 0 6px">THE UK GOLF PRICE REPORT · {e(f['name']).upper()}</p>
<h1 style="font-size:24px;line-height:1.25;margin:0 0 12px">{f['fell']} of {f['models']:,} golf models got cheaper in {e(f['name'])}</h1>
<p style="font-size:15px;line-height:1.55;margin:0 0 12px">The new edition is out. Every figure comes from prices checked every six hours across multiple UK retailers, measured against what each model actually sold for, not a “was” price.</p>
<ul style="font-size:15px;line-height:1.7;margin:0 0 4px;padding-left:20px">{''.join(f'<li>{e(x)}</li>' for x in figs)}</ul>
{quote}
<p style="margin:18px 0 8px"><a href="{press}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:13px 20px;border-radius:10px">Read the press note</a></p>
<p style="font-size:14px;margin:0 0 16px"><a href="{url}" style="color:#2f6f22">Full report, charts and data</a> · Any figure for any category on request: reply to this email or write to hello@golfpriceai.com.</p>
<p style="font-size:12px;color:#5b665f;line-height:1.55;margin:20px 0 0">You’re getting this because you signed up for The UK Golf Price Report at golfpriceai.com.
<a href="{stop_press}" style="color:#5b665f">Stop these report emails</a> · <a href="{stop_all}" style="color:#5b665f">Unsubscribe from everything</a></p>
</div></body></html>"""


def main(argv):
    f = latest()
    if len(argv) > 2 and argv[1] == "--preview":
        if not f:
            print("Press email: no edition yet.")
            return 0
        Path(argv[2]).write_text(email_html(f, "#stop-press", "#unsubscribe"))
        print(f"Press email preview: {subject(f)} -> {argv[2]}")
        return 0
    if not f:
        return 0
    today = date.today()
    state = alerts.load_state()
    if (state.get("press") or {}).get("month") == f["month"]:
        return 0
    if date.fromisoformat(f["published"]) < today - timedelta(days=FRESH_DAYS):
        return 0
    key, secret = os.environ.get("BREVO_API_KEY"), os.environ.get("ALERTS_SECRET")
    if not key or not secret:
        print("Press email: Brevo secrets not set, skipping.")
        return 0
    try:
        people = [s["email"] for s in alerts.subscribers(key) if s.get("press")]
    except Exception as e:
        print(f"Press email: couldn't read subscribers ({e}); will try on the next run.")
        return 0
    today_s = today.isoformat()
    sent_today = state.get("sent", {}).get(today_s, 0)
    sent = failed = 0
    for email in people:
        if sent_today + sent >= alerts.DAILY_CAP:
            break
        stop_press, stop_all = unsubscribe_link(secret, email, SLUG), unsubscribe_link(secret, email)
        status, data = brevo(key, "POST", "/smtp/email", {
            "sender": alerts.SENDER, "replyTo": {"email": "hello@golfpriceai.com", "name": "GolfPrice AI"},
            "to": [{"email": email}], "subject": subject(f), "htmlContent": email_html(f, stop_press, stop_all),
            "headers": {"List-Unsubscribe": f"<{stop_all}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
            "tags": ["press-report"],
        })
        if status in (200, 201, 202):
            sent += 1
        else:
            failed += 1
            print(f"Press email: a send failed ({status}): {data.get('message', '')}")
    if sent + failed >= len(people):
        state["press"] = {"month": f["month"], "sent": sent}
    state["sent"] = {today_s: sent_today + sent}
    alerts.save_state(state)
    print(f"Press email: {f['name']} sent to {sent} of {len(people)} subscriber(s)" + (f", {failed} failed" if failed else "") + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
