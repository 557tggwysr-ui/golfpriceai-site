"""Retailer insights: turn the site's demand data into leverage with retailers.

The problem it solves: the site knows things retailers want to know (which
models UK golfers are watching right now, and where each retailer's price
sits against the market) but that knowledge earned nothing. Better feeds,
better prices and better commission come from showing retailers you're
worth working with.

Monthly (2nd of the month, .github/workflows/agent-insights.yml), for each
retailer feed:
  * how much of its range appears on the site, and how much is in stock;
  * how often it's the cheapest of the retailers we compare, and how far off
    it usually is when it isn't;
  * the most-watched models this month (the public UK Golf Demand Index) that
    it stocks, is cheapest on, or doesn't sell at all (a gap to fill);
  * popular items it has out of stock.
Each retailer gets a short, ready-to-send summary emailed to the owner only.
It holds no personal data: demand figures are the site's anonymous counts.
Commission and traffic figures are never included.
"""
import json
import os
import statistics
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, load, products, models, save_report, email_owner, table, now)

NAMES = {"awin-clickgolf": "ClickGolf", "awin-majorgolf": "Major Golf Direct", "awin-callaway": "Callaway Golf", "awin-affordablegolf": "Affordable Golf",
         "awin-scottsdalegolf": "Scottsdale Golf", "awin-callawaypreowned": "Callaway Preowned", "awin-payntr": "PAYNTR Golf", "awin-clarkesgolf": "Clarkes Golf"}


def main():
    items, mods = products(), models()
    demand = [(c.get("name") or "") for c in (load("demand/index.json") or {}).get("chart", [])][:50]
    by_src = defaultdict(list)
    for p in items:
        by_src[p["source"]].append(p)
    pid = {p["id"]: p for p in items}
    stats_by = {}
    for src, ps in by_src.items():
        compared = cheapest = 0
        gaps = []
        for m in mods:
            r = m.get("retailers") or {}
            if src not in r or len(r) < 2:
                continue
            compared += 1
            mine = r[src]["min"]
            if abs(mine - float(m["minPrice"])) < 0.01:
                cheapest += 1
            elif m["minPrice"]:
                gaps.append((mine - float(m["minPrice"])) / float(m["minPrice"]))
        stocked = {m["name"] for m in mods if src in (m.get("retailers") or {})}
        cheap_on = {m["name"] for m in mods if src in (m.get("retailers") or {}) and abs((m["retailers"][src]["min"]) - float(m["minPrice"])) < 0.01}
        hot_missing = [d for d in demand if d and d not in stocked][:8]
        hot_cheapest = [d for d in demand if d in cheap_on][:8]
        oos = [m["name"] for m in mods if m["name"] in demand and src in (m.get("retailers") or {})
               and not any(pid.get(i, {}).get("inStock") for i in m.get("listingIds", []) if pid.get(i, {}).get("source") == src)][:6]
        stats_by[src] = {"listings": len(ps), "inStockPct": round(100 * sum(1 for p in ps if p.get("inStock")) / max(1, len(ps))),
                         "compared": compared, "cheapestPct": round(100 * cheapest / max(1, compared)),
                         "typicalGapPct": round(100 * statistics.median(gaps), 1) if gaps else None,
                         "hotCheapest": hot_cheapest, "hotMissing": hot_missing, "hotOutOfStock": oos}
    save_report("insights-report.json", {"about": "Retailer insights: the monthly summaries were emailed to the owner (kept private).",
                                         "retailers": len(stats_by), "month": now().strftime("%Y-%m")})
    parts = ["<h2>Retailer insights</h2><p>One summary per retailer, ready to send to your contact there (adjust the greeting). "
             "No commission or traffic figures are included.</p>"]
    for src, s in sorted(stats_by.items(), key=lambda x: -x[1]["listings"]):
        name = NAMES.get(src, src.replace("awin-", "").title())
        lines = [f"Across the {s['compared']} golf models where we compare you with other UK retailers, you were the cheapest on {s['cheapestPct']}%"
                 + (f", and typically {s['typicalGapPct']}% above the lowest price when you weren't." if s["typicalGapPct"] is not None else ".")]
        if s["hotCheapest"]:
            lines.append("Most-watched models this month where you're the cheapest: " + ", ".join(s["hotCheapest"][:5]) + ".")
        if s["hotMissing"]:
            lines.append("Most-watched models you don't currently list in your feed: " + ", ".join(s["hotMissing"][:5]) + ".")
        if s["hotOutOfStock"]:
            lines.append("Popular models showing out of stock with you: " + ", ".join(s["hotOutOfStock"]) + ".")
        lines.append(f"{s['listings']:,} of your products are live on GolfPrice AI, {s['inStockPct']}% in stock.")
        body = "Hello,\n\nA quick monthly snapshot from GolfPrice AI on how your range compares for UK golfers:\n\n" + "\n".join("• " + l for l in lines) + \
               "\n\nThe demand figures come from the UK Golf Demand Index (golfpriceai.com/demand/), anonymous counts of what golfers are watching. " \
               "Happy to talk about adding the missing models to your feed, or anything else that would help.\n\nBest wishes,\nJohn Willson\nFounder, GolfPrice AI"
        parts.append(f"<hr><h3>{name}</h3><pre style='white-space:pre-wrap;font:14px system-ui'>{body}</pre>")
    email_owner("GolfPrice AI · monthly retailer insights", "".join(parts))
    print(json.dumps({k: {x: v[x] for x in ("compared", "cheapestPct", "typicalGapPct")} for k, v in stats_by.items()}))


if __name__ == "__main__":
    main()
