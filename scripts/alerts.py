"""Price-drop alert emails ("Email me when it drops").

Run by the workflow after each 6-hourly refresh has been published, so the
price page a subscriber clicks through to already shows the new price.

How it works
  * People sign up on a price page. The Cloudflare worker
    (workers/alerts-worker.js) adds them to Brevo list 3 after they confirm,
    with the models they watch in the contact's WATCHLIST attribute.
  * Each run, this reads that list from Brevo, looks up each watched model's
    lowest new, in-stock price in data/models.json, and compares it with the
    model's reference price in data/alerts-state.json.
  * A drop of at least £5 or 3% (whichever is bigger) below the reference
    sends one email to each person watching it, then the reference moves
    down to the new price. So a price that creeps down £2 at a time still
    triggers an alert once it has fallen £5 in total, and a price that
    bounces around doesn't send an email every time.
  * If the price instead sits clearly above the reference for 7 days, that
    becomes the new normal and the reference moves up to it.

What is stored where
  * Emails and watch lists live only in Brevo. Nothing personal is written to
    this public repository: alerts-state.json holds model slugs, prices and
    dates, plus a daily count of emails sent.

Never fails the run: if Brevo is down or the keys aren't set, it says so in
the log and tries again in 6 hours. References only move once an alert has
actually gone out, so a failed send is retried next run.
"""
import base64
import hashlib
import hmac
import html
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

from price_pages import retailer_name

ROOT = Path(__file__).resolve().parent.parent
MODELS_FILE = ROOT / "data" / "models.json"
STATE_FILE = ROOT / "data" / "alerts-state.json"
PRICES_DIR = ROOT / "prices"

BREVO = "https://api.brevo.com/v3"
SITE = "https://golfpriceai.com"
# The Cloudflare worker's address (not secret). The workflow can override it.
WORKER_URL = os.environ.get("ALERTS_WORKER_URL") or "https://golfpriceai-alerts.golfpriceai.workers.dev"
LIST_ID = int(os.environ.get("ALERTS_LIST_ID") or 3)
SENDER = {"name": "GolfPrice AI", "email": "alerts@golfpriceai.com"}

MIN_DROP_POUNDS = 5.0
MIN_DROP_PCT = 0.03
MAX_BELIEVABLE_DROP = 0.60   # a bigger one-step fall is more likely a feed error: logged, not emailed
REFERENCE_RESET_DAYS = 7     # price clearly above the reference this long = new normal
DAILY_CAP = int(os.environ.get("ALERTS_DAILY_CAP") or 250)  # Brevo free plan: 300 a day, incl. confirmations



# ---------------------------------------------------------------- small helpers
def money(n):
    return f"£{n:,.2f}".replace(".00", "")


def threshold(ref):
    return max(MIN_DROP_POUNDS, round(ref * MIN_DROP_PCT, 2))


def sign(secret, text):
    """Must match sign() in workers/alerts-worker.js."""
    mac = hmac.new(secret.encode(), text.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")[:32]


def unsubscribe_link(secret, email, slug=None):
    q = {"e": email, "s": sign(secret, email)}
    if slug:
        q["m"] = slug
    return f"{WORKER_URL}/unsubscribe?{urllib.parse.urlencode(q)}"


def brevo(key, method, path, body=None):
    req = urllib.request.Request(BREVO + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"api-key": key, "accept": "application/json",
                                          "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"about": "Price-drop alert reference prices per model. No personal data.", "models": {}, "sent": {}}


def save_state(state):
    STATE_FILE.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n")


# ---------------------------------------------------------------- reading
def subscribers(key):
    """Confirmed contacts on the alerts list, with the models they watch."""
    out, offset = [], 0
    while True:
        status, data = brevo(key, "GET", f"/contacts/lists/{LIST_ID}/contacts?limit=500&offset={offset}")
        if status != 200:
            raise RuntimeError(f"Brevo list read failed ({status}): {data.get('message', '')}")
        batch = data.get("contacts") or []
        for c in batch:
            if c.get("emailBlacklisted"):
                continue
            attrs = c.get("attributes") or {}
            watch = [s.strip() for s in str(attrs.get("WATCHLIST") or "").split(",") if s.strip()]
            digest = str(attrs.get("DIGEST") or "").lower()
            # The Friday email: anyone who asked for it (DIGEST yes), plus
            # early sign-ups from before that attribute existed who signed
            # up for general alerts rather than one model.
            out.append({"email": c["email"].lower(), "watch": watch,
                        "digest": digest == "yes" or (not digest and not watch)})
        offset += len(batch)
        if len(batch) < 500 or offset >= (data.get("count") or 0):
            return out


def live_models():
    data = json.loads(MODELS_FILE.read_text())
    out = {}
    for m in data.get("models", []):
        if not (m.get("gate") or {}).get("passes"):
            continue
        if not (PRICES_DIR / m["slug"] / "index.html").exists():
            continue
        out[m["slug"]] = m
    return out


# ---------------------------------------------------------------- deciding
def check_prices(state, watched, models, today):
    """Returns {slug: drop-details} for models that genuinely dropped, and
    updates references for everything else. References for dropped models
    are only moved later, once the emails have gone."""
    drops = {}
    refs = state.setdefault("models", {})
    for slug in sorted(watched):
        m = models.get(slug)
        if not m:
            continue  # page retired or held back this run: keep the reference, check again next time
        cur = float(m["minPrice"])
        r = refs.get(slug)
        if not r:
            refs[slug] = {"ref": cur, "refDate": today}
            print(f"Alerts: started watching {slug} at {money(cur)}.")
            continue
        ref = float(r["ref"])
        t = threshold(ref)
        if cur <= ref - t:
            if cur < ref * (1 - MAX_BELIEVABLE_DROP):
                print(f"Alerts: {slug} fell from {money(ref)} to {money(cur)} in one step: too big to trust, not emailing.")
                continue
            low_days = None
            if m.get("historyDays") and m.get("low") is not None and cur <= float(m["low"]) + 0.005:
                low_days = m["historyDays"]
            drops[slug] = {"slug": slug, "name": m["name"], "now": cur, "was": ref, "wasDate": r.get("refDate"),
                           "retailer": retailer_name(m["minRetailer"]) if m.get("minRetailer") else "a UK retailer",
                           "ball": m.get("type") == "ball", "lowDays": low_days}
            r.pop("aboveSince", None)
        elif cur > ref + t:
            since = r.get("aboveSince")
            if not since:
                r["aboveSince"] = today
            elif (date.fromisoformat(today) - date.fromisoformat(since)).days >= REFERENCE_RESET_DAYS:
                print(f"Alerts: {slug} has been above {money(ref)} for {REFERENCE_RESET_DAYS}+ days; reference now {money(cur)}.")
                refs[slug] = {"ref": cur, "refDate": today}
        else:
            r.pop("aboveSince", None)
    # Forget models nobody watches any more.
    for slug in list(refs):
        if slug not in watched:
            del refs[slug]
    return drops


# ---------------------------------------------------------------- writing
def short_date(iso):
    if not iso:
        return ""
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b')}"


def email_html(email, items, secret):
    blocks = []
    for d in items:
        per = " per dozen" if d["ball"] else ""
        saving = d["was"] - d["now"]
        link = f"{SITE}/prices/{d['slug']}/?utm_source=alerts&utm_medium=email&utm_campaign=price-drop"
        low = (f"<p style=\"margin:8px 0 0;font-size:14px;color:#2f8a1f;font-weight:bold\">"
               f"The lowest price in the {d['lowDays']} days we’ve tracked it.</p>") if d["lowDays"] else ""
        stop = unsubscribe_link(secret, email, d["slug"])
        blocks.append(f"""<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:20px;margin:0 0 14px">
<p style="margin:0 0 6px;font-size:18px;font-weight:bold;color:#16241c">{html.escape(d['name'])}</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#16241c">Now <strong style="font-size:20px">{money(d['now'])}</strong>{per} at {html.escape(d['retailer'])}, down {money(saving)} from {money(d['was'])}{' on ' + short_date(d['wasDate']) if d['wasDate'] else ''}.</p>
{low}
<p style="margin:16px 0 0"><a href="{link}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">Compare every price</a></p>
<p style="margin:12px 0 0;font-size:12px"><a href="{stop}" style="color:#5b665f">Stop alerts for this model</a></p>
</div>""")
    everything = unsubscribe_link(secret, email)
    return f"""<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:22px;font-weight:bold;margin:0 0 18px">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px">A price you’re watching has dropped. We check every 6 hours, and only email when the lowest new, in-stock price falls by at least £5 (or 3%).</p>
{''.join(blocks)}
<p style="font-size:12px;color:#5b665f;line-height:1.5;margin:18px 0 0">Prices change on retailers’ sites, so check before you buy. We may earn a commission if you buy through our links; it never changes the price.<br>
No countdown timers. No fake discounts. <a href="{everything}" style="color:#5b665f">Unsubscribe from all GolfPrice AI emails</a>.</p>
</div></body></html>"""


def subject_for(items):
    if len(items) == 1:
        d = items[0]
        return f"Price drop: {d['name']} now {money(d['now'])} (was {money(d['was'])})"
    return f"{len(items)} price drops on your GolfPrice AI watch list"


def send(key, secret, email, items):
    status, data = brevo(key, "POST", "/smtp/email", {
        "sender": SENDER,
        "to": [{"email": email}],
        "subject": subject_for(items),
        "htmlContent": email_html(email, items, secret),
        "headers": {"List-Unsubscribe": f"<{unsubscribe_link(secret, email)}>",
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
        "tags": ["price-drop"],
    })
    if status not in (200, 201, 202):
        print(f"Alerts: send failed ({status}): {data.get('message', '')}")
        return False
    return True


# ---------------------------------------------------------------- main
def main():
    key, secret = os.environ.get("BREVO_API_KEY"), os.environ.get("ALERTS_SECRET")
    if not key or not secret:
        print("Alerts: BREVO_API_KEY / ALERTS_SECRET not set, skipping.")
        return 0
    if "REPLACE-ME" in WORKER_URL:
        print("Alerts: worker address not set yet, skipping.")
        return 0
    today = date.today().isoformat()
    state = load_state()
    try:
        subs = subscribers(key)
    except Exception as e:  # Brevo down, key wrong, etc.: try again next run
        print(f"Alerts: couldn't read subscribers ({e}); will try again next run.")
        return 0
    watchers = defaultdict(list)
    for s in subs:
        for slug in s["watch"]:
            watchers[slug].append(s["email"])
    print(f"Alerts: {len(subs)} confirmed subscriber(s), {len(watchers)} model(s) watched.")

    drops = check_prices(state, set(watchers), live_models(), today)

    # One email per person, covering every model of theirs that dropped.
    per_person = defaultdict(list)
    for slug, d in drops.items():
        for e in watchers[slug]:
            per_person[e].append(d)
    sent_today = state.get("sent", {}).get(today, 0)
    sent, failed, capped = 0, 0, 0
    delivered = defaultdict(int)
    for email, items in sorted(per_person.items()):
        if sent_today + sent >= DAILY_CAP:
            capped += 1
            continue
        if send(key, secret, email, items):
            sent += 1
            for d in items:
                delivered[d["slug"]] += 1
        else:
            failed += 1

    # Move references only for drops that reached at least one person; the
    # rest are tried again next run.
    for slug, d in drops.items():
        if delivered[slug] or not watchers[slug]:
            state["models"][slug] = {"ref": d["now"], "refDate": today}
    state["sent"] = {today: sent_today + sent}  # keep only today's count
    save_state(state)
    print(f"Alerts: {len(drops)} model(s) dropped; {sent} email(s) sent"
          + (f", {failed} failed (retrying next run)" if failed else "")
          + (f", {capped} held back by the daily limit of {DAILY_CAP}" if capped else "") + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
