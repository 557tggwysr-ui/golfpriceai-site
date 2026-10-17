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

Back-in-stock alerts ("Notify me" on the Back In Stock Radar)
  * The contact's STOCKWATCH attribute holds product ids. Each run, if that
    product (or any size or colour of it at the same retailer) is in stock,
    one email goes out and the id is removed from STOCKWATCH, so it's a
    one-off alert.

"Bought it? We'll keep watching" (price pages)
  * The contact's BOUGHTWATCH attribute holds "slug|price paid|date" entries.
    Each run, if that model's lowest new UK price is at least £1 below what
    they paid, one email goes out and the entry is removed. Entries older
    than 30 days are removed without an email.

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
PRODUCTS_FILE = ROOT / "data" / "products.json"
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
BOUGHT_DAYS = 30             # "Bought it?" watches last this long
BOUGHT_MIN_DROP = 1.0        # pounds below the price paid before we email
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
            stock = [s.strip() for s in str(attrs.get("STOCKWATCH") or "").split(",") if s.strip()]
            bought = [s.strip() for s in str(attrs.get("BOUGHTWATCH") or "").split(",") if s.strip().count("|") == 2]
            out.append({"email": c["email"].lower(), "watch": watch, "stock": stock, "bought": bought,
                        "digest": digest == "yes" or (not digest and not watch and not stock and not bought)})
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
<p style="font-size:22px;font-weight:bold;margin:0 0 4px">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:12px;color:#5b665f;margin:0 0 18px">Full Swing. Not full price.</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px">A price you’re watching has dropped. Your wallet will be pleased; your handicap, sadly, is unaffected. We check every 6 hours, and only email when the lowest new, in-stock price falls by at least £5 (or 3%).</p>
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


# ---------------------------------------------------------------- back in stock
def _base(name):
    return (name or "").split(" - ")[0].strip().lower()


def check_stock(state, wanted):
    """{product id: details} for watched products that are in stock now.
    Remembers each watched product's name and retailer (not who watches
    it), so a size or colour coming back still counts after the original
    listing has left the feed."""
    known = state.setdefault("stock", {})
    if not wanted:
        state["stock"] = {}
        return {}
    products = json.loads(PRODUCTS_FILE.read_text()).get("products", [])
    by_id = {p["id"]: p for p in products if p.get("id")}
    in_stock = defaultdict(list)
    for p in products:
        if p.get("inStock") is not False and p.get("affiliateUrl") and not p.get("condition"):
            in_stock[(p.get("source"), _base(p.get("name")))].append(p)
    models = {}
    for m in json.loads(MODELS_FILE.read_text()).get("models", []):
        if (m.get("gate") or {}).get("passes") and (PRICES_DIR / m["slug"] / "index.html").exists():
            for lid in m.get("listingIds") or []:
                models[lid] = m["slug"]
    back = {}
    for pid in sorted(wanted):
        p = by_id.get(pid)
        if p:
            known[pid] = {"base": _base(p.get("name")), "source": p.get("source"), "name": p["name"].split(" - ")[0].strip()}
        info = known.get(pid)
        if not info:
            continue  # never seen it: nothing to match on yet
        if p and p.get("inStock") is not False:
            hit = p
        else:
            options = in_stock.get((info["source"], info["base"])) or []
            hit = min(options, key=lambda x: x.get("salePrice") or 1e9) if options else None
        if hit:
            back[pid] = {"id": pid, "name": info["name"], "price": float(hit.get("salePrice") or 0),
                         "retailer": retailer_name(hit.get("source") or ""), "link": hit["affiliateUrl"],
                         "image": hit.get("image") or "", "slug": models.get(hit["id"], "")}
    for pid in list(known):
        if pid not in wanted:
            del known[pid]
    return back


def stock_email_html(email, items, secret):
    blocks = []
    for d in items:
        img = (f'<img src="{html.escape(d["image"])}" alt="" width="120" style="display:block;width:120px;max-width:40%;height:auto;'
               f'border-radius:10px;background:#fff;margin:0 auto 12px">') if d["image"] else ""
        compare = (f'<p style="margin:10px 0 0;font-size:13px"><a href="{SITE}/prices/{d["slug"]}/?utm_source=stock-alert&amp;utm_medium=email" '
                   f'style="color:#2f8a1f">Compare every retailer’s price</a></p>') if d["slug"] else ""
        blocks.append(f"""<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:20px;margin:0 0 14px;text-align:center">
{img}<p style="margin:0 0 6px;font-size:18px;font-weight:bold;color:#16241c">{html.escape(d['name'])}</p>
<p style="margin:0 0 16px;font-size:15px;color:#16241c">Back in stock at {html.escape(d['retailer'])}, from <strong style="font-size:20px">{money(d['price'])}</strong></p>
<a href="{html.escape(d['link'])}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">See it at {html.escape(d['retailer'])}</a>
{compare}</div>""")
    everything = unsubscribe_link(secret, email)
    intro = ("Good news: something you asked us to watch is back on the shelf. Less good news: you’ve officially run out of excuses."
             if len(items) == 1 else
             f"Good news: {len(items)} things you asked us to watch are back on the shelf. Your bag may want a word.")
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:22px;font-weight:bold;margin:0 0 4px">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:12px;color:#5b665f;margin:0 0 18px">Full Swing. Not full price.</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 16px">{intro}</p>
{''.join(blocks)}
<p style="font-size:13px;line-height:1.5;color:#4a554e;margin:0">Sizes and colours vary, so check yours on the retailer’s page. This was a one-off alert: we won’t email you about {'this product' if len(items) == 1 else 'these'} again.</p>
<p style="font-size:12px;color:#5b665f;line-height:1.55;margin:18px 0 0">Prices and stock change on retailers’ sites, so check before you buy. We may earn a commission if you buy through our links; it never changes the price.<br>
No countdown timers. No fake discounts. <a href="{everything}" style="color:#5b665f">Unsubscribe from all GolfPrice AI emails</a>.</p>
</div></body></html>"""


def send_stock(key, secret, email, items):
    subject = (f"Back in stock: {items[0]['name']}" if len(items) == 1
               else f"{len(items)} things on your wish list are back in stock")
    status, data = brevo(key, "POST", "/smtp/email", {
        "sender": SENDER, "to": [{"email": email}], "subject": subject,
        "htmlContent": stock_email_html(email, items, secret),
        "headers": {"List-Unsubscribe": f"<{unsubscribe_link(secret, email)}>",
                    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
        "tags": ["back-in-stock"],
    })
    if status not in (200, 201, 202):
        print(f"Stock alerts: send failed ({status}): {data.get('message', '')}")
        return False
    return True


def run_stock_alerts(key, secret, state, subs, room):
    """Sends back-in-stock emails (at most `room`). Returns emails sent."""
    wanted = {pid for s in subs for pid in s["stock"]}
    back = check_stock(state, wanted)
    sent = failed = held = 0
    for s in subs:
        items = [back[pid] for pid in s["stock"] if pid in back]
        if not items:
            continue
        if sent >= room:
            held += 1
            continue
        if send_stock(key, secret, s["email"], items):
            sent += 1
            left = ",".join(pid for pid in s["stock"] if pid not in back)
            brevo(key, "PUT", f"/contacts/{urllib.parse.quote(s['email'])}", {"attributes": {"STOCKWATCH": left}})
        else:
            failed += 1
    print(f"Stock alerts: {len(wanted)} product(s) watched, {len(back)} back in stock; {sent} email(s) sent"
          + (f", {failed} failed (retrying next run)" if failed else "")
          + (f", {held} held back by the daily limit" if held else "") + ".")
    return sent


# ---------------------------------------------------------------- bought it? we'll keep watching
def bought_email_html(email, d, secret):
    per = " per dozen" if d["ball"] else ""
    link = f"{SITE}/prices/{d['slug']}/?utm_source=bought-alert&utm_medium=email"
    img = (f'<img src="{html.escape(d["image"])}" alt="" width="96" style="display:block;width:96px;height:auto;border-radius:10px;'
           f'background:#fff;border:1px solid #e7e9e5">') if d["image"] else ""
    everything = unsubscribe_link(secret, email)
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f7f8f6;font-family:Arial,Helvetica,sans-serif;color:#16241c">
<div style="max-width:560px;margin:0 auto;padding:28px 16px">
<p style="font-size:22px;font-weight:bold;margin:0 0 4px">Golf<span style="color:#3fae29">Price</span> AI</p>
<p style="font-size:12px;color:#5b665f;margin:0 0 18px">Full Swing. Not full price.</p>
<div style="background:#fff;border:1px solid #e7e9e5;border-radius:14px;padding:22px">
<p style="font-size:20px;font-weight:bold;margin:0 0 10px">Good news, of the slightly annoying kind</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 14px">The <strong>{html.escape(d['name'])}</strong> you bought for <strong>{money(d['paid'])}</strong>{per} is now <strong style="color:#2f8a1f">{money(d['now'])}</strong>{per} at {html.escape(d['retailer'])}. That’s {money(d['paid'] - d['now'])} less than you paid.</p>
<table role="presentation" style="width:100%;background:#f2f7ef;border-radius:12px;margin:0 0 16px"><tr>
<td style="padding:12px;width:96px">{img}</td>
<td style="padding:12px;font-size:14px;line-height:1.5;color:#4a554e"><strong style="color:#16241c">{html.escape(d['name'])}</strong><br>You paid {money(d['paid'])} on {short_date(d['date'])} · Today from {money(d['now'])}<br>Checked across multiple UK retailers</td>
</tr></table>
<p style="font-size:16px;font-weight:bold;margin:0 0 6px">How to ask for the difference</p>
<ol style="font-size:15px;line-height:1.55;margin:0 0 14px;padding-left:20px">
<li>Find your order confirmation.</li>
<li>Contact the retailer you bought from and ask if they’ll refund the difference or match today’s price.</li>
<li>Send them today’s prices as proof: <a href="{link}" style="color:#2f8a1f">golfpriceai.com/prices/{d['slug']}/</a></li>
</ol>
<p style="font-size:14px;line-height:1.5;color:#4a554e;margin:0 0 18px">Every retailer has its own price-match and refund rules, and some only match their own price. It’s worth a two-minute email either way. Worst case, you’ve still got the kit.</p>
<a href="{link}" style="display:inline-block;background:#3fae29;color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:10px">See today’s prices</a>
<p style="font-size:13px;line-height:1.5;color:#5b665f;margin:18px 0 0">This was your one email for this price watch, and we’ve now deleted it. Want the week’s genuine drops every Friday? <a href="{SITE}/#alerts" style="color:#2f8a1f">Sign up here</a>.</p>
</div>
<p style="font-size:12px;color:#5b665f;line-height:1.55;margin:18px 0 0">Prices change on retailers’ sites, so check before you buy. We may earn a commission if you buy through our links; it never changes the price.<br>
No countdown timers. No fake discounts. <a href="{everything}" style="color:#5b665f">Unsubscribe from all GolfPrice AI emails</a>.</p>
</div></body></html>"""


def run_bought_alerts(key, secret, subs, models, today, room):
    """One email per entry whose model now costs at least £1 less than paid;
    entries are removed after the email or after 30 days. Returns emails sent."""
    products = {p["id"]: p for p in json.loads(PRODUCTS_FILE.read_text()).get("products", []) if p.get("id")}
    sent = failed = expired = held = 0
    for s in subs:
        if not s["bought"]:
            continue
        keep, changed = [], False
        for entry in s["bought"]:
            slug, paid, when = entry.split("|")
            try:
                paid, age = float(paid), (date.fromisoformat(today) - date.fromisoformat(when)).days
            except ValueError:
                changed = True
                continue
            if age > BOUGHT_DAYS:
                expired += 1
                changed = True
                continue
            m = models.get(slug)
            cur = float(m["minPrice"]) if m else None
            if cur is None or not (paid * (1 - MAX_BELIEVABLE_DROP) <= cur <= paid - BOUGHT_MIN_DROP):
                keep.append(entry)
                continue
            if sent >= room:
                held += 1
                keep.append(entry)
                continue
            image = next((products[i].get("image") for i in m.get("listingIds") or [] if i in products and products[i].get("image")), "")
            d = {"slug": slug, "name": m["name"], "paid": paid, "now": cur, "date": when, "image": image or "",
                 "retailer": retailer_name(m["minRetailer"]) if m.get("minRetailer") else "a UK retailer",
                 "ball": m.get("type") == "ball"}
            status, data = brevo(key, "POST", "/smtp/email", {
                "sender": SENDER, "to": [{"email": s["email"]}],
                "subject": f"The {m['name']} you bought is now {money(paid - cur)} cheaper",
                "htmlContent": bought_email_html(s["email"], d, secret),
                "headers": {"List-Unsubscribe": f"<{unsubscribe_link(secret, s['email'])}>",
                            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
                "tags": ["bought-watch"],
            })
            if status in (200, 201, 202):
                sent += 1
                changed = True
            else:
                failed += 1
                keep.append(entry)
        if changed:
            brevo(key, "PUT", f"/contacts/{urllib.parse.quote(s['email'])}", {"attributes": {"BOUGHTWATCH": ",".join(keep)}})
    total = sum(len(s["bought"]) for s in subs)
    print(f"Bought-it watches: {total} active, {sent} email(s) sent, {expired} expired"
          + (f", {failed} failed (retrying next run)" if failed else "")
          + (f", {held} held back by the daily limit" if held else "") + ".")
    return sent


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
    stock_sent = 0
    try:
        stock_sent = run_stock_alerts(key, secret, state, subs, max(0, DAILY_CAP - sent_today - sent))
    except Exception as e:  # never stop the price alerts over this
        print(f"Stock alerts: skipped this run ({e}).")
    bought_sent = 0
    try:
        bought_sent = run_bought_alerts(key, secret, subs, live_models(), today,
                                        max(0, DAILY_CAP - sent_today - sent - stock_sent))
    except Exception as e:  # never stop the other alerts over this
        print(f"Bought-it watches: skipped this run ({e}).")
    state["sent"] = {today: sent_today + sent + stock_sent + bought_sent}  # keep only today's count
    save_state(state)
    print(f"Alerts: {len(drops)} model(s) dropped; {sent} email(s) sent"
          + (f", {failed} failed (retrying next run)" if failed else "")
          + (f", {capped} held back by the daily limit of {DAILY_CAP}" if capped else "") + ".")
    return 0


if __name__ == "__main__":
    sys.exit(main())
