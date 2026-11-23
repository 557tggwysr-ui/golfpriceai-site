"""Catalogue autopilot: keeps the price data trustworthy and growing.

Runs daily after the deal refresh (.github/workflows/agent-catalogue.yml).

Checks:
  * Suspect prices: a listing far below the same model at other retailers,
    or far below anything the model has ever cost (the "£9.99 driver"). These
    go in data/agents/price-quarantine.json. For now it only reports them.
    Once a week of reports shows it only catches real mistakes, the next
    step is for update_deals.py to hide quarantined listings automatically.
  * Feed health: a retailer feed that suddenly shrinks by 20%+ usually means
    the feed or our parser broke, not that the shop emptied overnight.
  * Second-hand rule: anything that looks used, ex-demo or refurbished must
    carry a condition, so it lives only in Preowned and trade-ins.
  * Duplicates: the same product listed twice by one retailer.
  * Dead listings: out of stock for 45+ days.
  * New launches: product names (2026/2027 models, "new") that aren't matched
    to any model yet, grouped by brand, so new clubs get price pages fast.

Output (public, no traffic or money): data/agents/catalogue-report.json and
data/agents/price-quarantine.json. State: data/agents/catalogue-state.json.
"""
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (OUT, products, models, save_report, now)

USED = re.compile(r"\b(pre[- ]?owned|used|ex[- ]?demo|ex[- ]?display|refurbished|second[- ]?hand)\b", re.I)
RECYCLED = re.compile(r"\b(recycled|refinished|lake balls?|grade [a-c])\b", re.I)
# ball listings that aren't a dozen (sleeves, multi-buys, personalised) can't be compared per dozen
NOT_DOZEN = re.compile(r"\b(sleeve|3[- ]?ball|4 for 3|personal|\d+\s*(pack|balls)\b|x\s?\d+)", re.I)
NEWISH = re.compile(r"\b(2026|2027|new for|launch)\b", re.I)
# a listing below this share of the model's normal price is "too good to be true"
TOO_LOW_VS_PEERS = 0.45
TOO_LOW_VS_HISTORY = 0.55
# single clubs, shafts and junior kit are priced differently from the model's main listing
SINGLE = re.compile(r"\b(\d|[pagsl]w)\s*iron\b|driving iron|utility|single|shaft|junior|kids|us kids|ladies|\bjnr\b", re.I)
# words that mean "this is not a club", for catching kit filed as a driver, wood, iron or putter
NOT_A_CLUB = re.compile(r"\b(neck warmer|snood|pencils?|gripper|grips?|tape|mirror|gymsack|gym sack|practice aid|training aid|"
                        r"headcover|head cover|towel|umbrella|tees?|marker|glove|shaft|bag|trolley|rangefinder|watch|cap|hat|"
                        r"butler|brush|alignment sticks?)\b", re.I)
CLUB_WORDS = re.compile(r"pistol grip|cent(re|er)[- ]shaft|plumber.?s neck|stick ?em", re.I)
FLOORS = {"driver": 40, "wood": 30, "hybrid": 25, "irons": 99, "putter": 15, "wedge": 15, "bag": 20}


def norm(name):
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def main():
    items = products()
    mods = models()
    if not items:
        print("no products; nothing to check"); return
    by_id = {p["id"]: p for p in items}
    matched = set()
    quarantine = []
    misfiled = []
    for m in mods:
        if m.get("group") == "club" and NOT_A_CLUB.search(m.get("name") or "") and not CLUB_WORDS.search(m.get("name") or ""):
            misfiled.append({"page": f"/prices/{m['slug']}/", "name": m["name"], "filedAs": m.get("type"),
                             "_ids": [i for i in m.get("listingIds", []) if i in by_id]})
        if m.get("group") == "club" and re.search(r"single-iron|individual", m.get("slug", "")):
            m = {**m, "_single": True}
        ids = [i for i in m.get("listingIds", []) if i in by_id]
        matched.update(ids)
        def comparable(q):
            return not (q.get("category") == "ball" and NOT_DOZEN.search(q["name"]) and not re.search(r"\b(12|dozen)\b", q["name"], re.I))
        prices = [by_id[i]["salePrice"] for i in ids if by_id[i].get("salePrice") and not by_id[i].get("condition") and comparable(by_id[i])]
        hist = [p for _, p in (m.get("history") or [])]
        for i in ids:
            p = by_id[i]
            price = p.get("salePrice") or 0
            if not price or p.get("condition"):
                continue
            if not comparable(p) or SINGLE.search(p["name"]):
                continue
            peers = [x for x in prices if x != price]
            why = None
            if len(peers) >= 2 and price < TOO_LOW_VS_PEERS * statistics.median(peers):
                why = f"under {int(TOO_LOW_VS_PEERS*100)}% of the same model elsewhere (median £{statistics.median(peers):.2f})"
            elif len(hist) >= 5 and price < TOO_LOW_VS_HISTORY * statistics.median(hist):
                why = f"under {int(TOO_LOW_VS_HISTORY*100)}% of its usual price (median £{statistics.median(hist):.2f})"
            elif not m.get("_single") and price < FLOORS.get(p.get("category"), 0) and "junior" not in norm(p["name"]) and "set" not in norm(p["name"]):
                why = f"below a sensible floor for a new {p['category']}"
            if why:
                kind = "peers" if "same model" in why else "history" if "usual price" in why else "floor"
                shown = abs(price - float(m.get("minPrice") or 0)) < 0.01
                quarantine.append({"id": i, "name": p["name"], "model": m["slug"], "price": price, "reason": why,
                                   "shownAsLowest": shown, "kind": kind,
                                   "both": bool(len(hist) >= 5 and price < TOO_LOW_VS_HISTORY * statistics.median(hist))})

    # the ones shoppers actually see (they set the model's "from" price) come first
    quarantine.sort(key=lambda q: (not q["shownAsLowest"], q["model"]))
    seen_models = set()
    priority = []
    for q in quarantine:
        if q["shownAsLowest"] and q["model"] not in seen_models:
            seen_models.add(q["model"]); priority.append(q)
    # second-hand rule
    used = [p for p in items if not p.get("condition") and USED.search(p.get("name") or "")
            and not re.search(r"\bused by\b|\bunused\b", p.get("name") or "", re.I)]
    recycled = [p for p in items if not p.get("condition") and RECYCLED.search(p.get("name") or "")]
    # duplicates within one retailer
    seen = defaultdict(list)
    for p in items:
        seen[(p["source"], norm(p["name"]), p.get("colour"), p.get("flex"), p.get("loft"))].append(p["id"])
    dupes = [{"feed": k[0], "name": by_id[v[0]]["name"], "ids": v} for k, v in seen.items() if len(v) > 1]
    # dead listings
    dead = 0
    for p in items:
        si = p.get("stockInsight") or {}
        if p.get("inStock") is False and si.get("lastChange"):
            try:
                days = (now().date() - datetime.fromisoformat(str(si["lastChange"])[:10]).date()).days
                if days >= 45:
                    dead += 1
            except ValueError:
                pass
    # feed health v the last run
    counts = Counter(p["source"] for p in items)
    state_p = OUT / "catalogue-state.json"
    state = json.load(open(state_p)) if state_p.exists() else {}
    prev = state.get("counts", {})
    shrunk = [{"feed": s, "before": prev[s], "now": counts.get(s, 0)} for s in prev
              if prev[s] >= 200 and counts.get(s, 0) < 0.8 * prev[s]]
    # new launches not yet matched to a model
    unmatched = [p for p in items if p["id"] not in matched and not p.get("condition")
                 and p.get("category") in ("driver", "wood", "hybrid", "irons", "wedge", "putter", "ball")]
    fresh = defaultdict(Counter)
    for p in unmatched:
        if NEWISH.search(p["name"]) or (p["id"] not in state.get("knownUnmatched", [])):
            base = re.sub(r"\s+-\s+.*$", "", p["name"])[:70]
            fresh[p.get("brand") or "Other"][base] += 1
    launches = [{"brand": b, "names": [n for n, _ in c.most_common(8)]} for b, c in
                sorted(fresh.items(), key=lambda kv: -sum(kv[1].values()))[:12]] if prev else []

    OUT.mkdir(parents=True, exist_ok=True)
    # full detail for the fix-pack agent (ids, not just examples)
    with open(OUT / "catalogue-findings.json", "w", encoding="utf-8") as f:
        json.dump({"generated": now().strftime("%Y-%m-%dT%H:%MZ"),
                   "suspect": quarantine, "misfiled": misfiled,
                   "used": [{"id": p["id"], "name": p["name"]} for p in used]}, f, ensure_ascii=False)
    for m in misfiled:
        m.pop("_ids", None)
    with open(OUT / "price-quarantine.json", "w", encoding="utf-8") as f:
        json.dump({"about": "Listings whose price looks wrong. Reported only for now; auto-hiding comes once the checks have proved themselves.",
                   "ids": [q["id"] for q in quarantine], "items": quarantine}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    with open(state_p, "w") as f:
        json.dump({"counts": counts, "knownUnmatched": sorted(p["id"] for p in unmatched)[:20000]}, f)
    # did approved fixes actually take? (the improvement loop checks its own work)
    try:
        rules = json.load(open(OUT.parent / "agent-rules.json"))
    except Exception:
        rules = {}
    keyed = {f"{p['source']}|{p['name']}": p for p in items}
    today = now().date().isoformat()
    not_applied = [k for k, v in (rules.get("hide") or {}).items() if k in keyed and v.get("until", "9999") >= today]
    not_applied += [k for k, v in (rules.get("category") or {}).items() if k in keyed and keyed[k].get("category") != v.get("to")]
    not_applied += [k for k, v in (rules.get("condition") or {}).items() if k in keyed and not keyed[k].get("condition")]
    fix_check = {"rulesActive": sum(len(v) for v in rules.values() if isinstance(v, dict)),
                 "notApplied": not_applied[:30]}
    problems = len(quarantine) + len(used) + len(shrunk) + len(misfiled) + len(not_applied)
    rep = save_report("catalogue-report.json", {
        "about": "Catalogue autopilot: price sanity, feed health, second-hand rule, duplicates, dead listings and new launches.",
        "listings": len(items), "models": len(mods),
        "feeds": dict(counts.most_common()),
        "feedsShrunk": shrunk,
        "misfiledModels": len(misfiled), "misfiled": misfiled[:60],
        "suspectPrices": len(quarantine),
        "pagesShowingSuspectPrice": len(priority), "pagesToCheck": [{"page": f"/prices/{q['model']}/", "price": q["price"], "listing": q["name"], "reason": q["reason"]} for q in priority[:40]],
        "suspectExamples": quarantine[:25],
        "usedOutsidePreowned": len(used), "usedExamples": [p["name"] for p in used[:25]],
        "recycledBallsOutsidePreowned": len(recycled), "recycledExamples": [p["name"] for p in recycled[:10]],
        "duplicates": len(dupes), "duplicateExamples": dupes[:15],
        "deadListings45d": dead,
        "unmatchedClubs": len(unmatched),
        "newLaunchCandidates": launches,
        "fixCheck": fix_check,
        "status": "ok" if problems == 0 else "attention",
    })
    print(json.dumps({k: rep[k] for k in ("misfiledModels", "suspectPrices", "pagesShowingSuspectPrice", "usedOutsidePreowned", "duplicates", "deadListings45d", "unmatchedClubs", "status")}))


if __name__ == "__main__":
    main()
