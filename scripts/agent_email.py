"""Email optimiser: more opens and clicks from the people already subscribed.

The problem it solves: email (price alerts and the Friday "Genuine Drops"
email) is the one channel the site owns, but it ran on fixed settings.

Weekly (inside the Fix pack, Mondays):
  1. Subject-line test: half the Friday list (fixed per subscriber) gets the
     current subject, half gets a challenger (data/email-tuning.json, read by
     scripts/digest.py). After at least two Fridays and enough sends, the one
     with more unique clicks per delivered email wins by a clear margin (15%+)
     and becomes the default; a new challenger starts. Sales-event weeks
     (Black Friday, Cyber Monday) always use the normal subject. The send day
     and time (Friday 4pm UK) never change.
  2. List health (last 28 days): hard bounces, spam complaints, blocks and
     unsubscribes. It warns early if any rate drifts towards the levels that
     hurt delivery for everyone.
  3. Every challenger is honest: no urgency, no countdowns, no "was" prices,
     and only facts from that week's email.

Rates and numbers go to the owner privately; a tuning change is a Fix pack item.
"""
import json
import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, http, now, save_report, email_owner, table, pack_note)

TUNING = ROOT / "data" / "email-tuning.json"
BANK = [
    "{name} just dropped {drop} (plus {more} more genuine drops)",
    "This week's biggest golf price drop: {name}, {drop} cheaper",
    "{n} genuine golf price drops this week, led by the {name}",
    "Cheaper this Friday: the {name}, down {drop}",
    "Your Friday golf prices: {name} down {drop}",
]
MIN_SENDS = 150
LIFT = 0.15


def show(tpl):
    return tpl.format(name="[biggest drop]", drop="£X", n="N", more="N") if tpl else tpl


def stats(key, tag, start, end):
    s, _, txt = http(f"https://api.brevo.com/v3/smtp/statistics/aggregatedReport?startDate={start}&endDate={end}&tag={tag}",
                     headers={"api-key": key, "accept": "application/json"})
    try:
        return json.loads(txt) if s == 200 else {}
    except ValueError:
        return {}


def rate(d, k):
    return (d.get(k) or 0) / max(1, d.get("delivered") or 0)


def main():
    key = os.environ.get("BREVO_API_KEY")
    t = json.loads(TUNING.read_text()) if TUNING.exists() else {"default": None, "challenger": BANK[0], "started": str(now().date()), "tried": [BANK[0]], "history": []}
    if not TUNING.exists():
        TUNING.write_text(json.dumps(t, indent=1) + "\n", encoding="utf-8")
        pack_note("data/email-tuning.json", f"Start a Friday email subject-line test. Half the list keeps today's subject, half gets: “{show(BANK[0])}”. Same day and time.")
    if not key:
        save_report("email-report.json", {"about": "Email optimiser: waiting for BREVO_API_KEY.", "test": t.get("challenger")})
        print("no Brevo key"); return
    end = now().date()
    start = max(end - timedelta(days=60), __import__("datetime").date.fromisoformat(t.get("started", str(end))))
    a, b = stats(key, "subj-A", start, end), stats(key, "subj-B", start, end)
    health = stats(key, "friday-email", end - timedelta(days=28), end)
    decision = "running"
    if (a.get("delivered") or 0) >= MIN_SENDS and (b.get("delivered") or 0) >= MIN_SENDS and (end - start).days >= 13:
        ra, rb = rate(a, "uniqueClicks"), rate(b, "uniqueClicks")
        winner = "B" if rb > ra * (1 + LIFT) else "A" if ra > rb * (1 + LIFT) else "tie"
        t["history"].append({"from": str(start), "to": str(end), "A": t.get("default") or "current subject", "B": t["challenger"],
                             "clickRateA": round(ra, 4), "clickRateB": round(rb, 4), "winner": winner})
        if winner == "B":
            t["default"] = t["challenger"]
        nxt = next((x for x in BANK if x not in t.get("tried", [])), None)
        t["challenger"] = nxt
        t["tried"] = t.get("tried", []) + ([nxt] if nxt else [])
        t["started"] = str(end)
        TUNING.write_text(json.dumps(t, indent=1) + "\n", encoding="utf-8")
        decision = f"winner {winner}"
        pack_note("data/email-tuning.json", f"Friday email subject test finished: {'the challenger won' if winner == 'B' else 'the current subject held' if winner == 'A' else 'no clear winner'}. "
                                            + (f"Next test: “{show(nxt)}”." if nxt else "No more challengers in the bank for now."))
    hb, spam, unsub = rate(health, "hardBounces"), rate(health, "spamReports"), rate(health, "unsubscribed")
    warn = [w for w, bad in (("hard bounces above 2%", hb > 0.02), ("spam complaints above 0.1%", spam > 0.001), ("unsubscribes above 1% per send", unsub > 0.01)) if bad]
    save_report("email-report.json", {"about": "Email optimiser: Friday subject-line test and list health. Rates are private (emailed to the owner).",
                                      "test": t.get("challenger"), "default": t.get("default"), "decision": decision, "healthWarnings": warn,
                                      "testsRun": len(t.get("history", []))})
    rows = [("A (current)", a.get("delivered", 0), f"{rate(a, 'uniqueOpens'):.1%}", f"{rate(a, 'uniqueClicks'):.1%}"),
            ("B (challenger)", b.get("delivered", 0), f"{rate(b, 'uniqueOpens'):.1%}", f"{rate(b, 'uniqueClicks'):.1%}")]
    email_owner("GolfPrice AI · email optimiser",
                f"<h2>Friday email</h2><p>Testing: “{show(t.get('challenger'))}” against the current subject. Status: {decision}.</p>"
                + table(rows, ["Variant", "Delivered", "Open rate", "Click rate"])
                + f"<p>Last 28 days: hard bounces {hb:.2%}, spam complaints {spam:.2%}, unsubscribes {unsub:.2%}.</p>"
                + ("<p><b>Needs a look:</b> " + ", ".join(warn) + "</p>" if warn else "<p>List health is fine.</p>"))
    print(decision, warn)


if __name__ == "__main__":
    main()
