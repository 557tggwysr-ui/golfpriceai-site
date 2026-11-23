"""Coverage hunter: more retailers on every price page.

The problem it solves: most models on the site have only ONE retailer to
compare (77% of models, 79% of clubs, on 19 Nov 2026). A comparison with
one price in it is the site's biggest weakness: lower trust, lower clicks,
weaker rankings.

Weekly (.github/workflows/agent-coverage.yml), it works two ways:

  1. Merges: the same club listed under two names by different retailers
     (for example "2026 Elyte Driver" and "Elyte Driver") ends up as two
     single-retailer pages instead of one compared page. It finds those pairs,
     writes a naming rule for data/model-aliases.json, and PROVES each rule by
     re-running the site's own grouping code (scripts/models.py): the rule
     must merge exactly that pair and change nothing else. Proven merges go
     into the Fix pack for approval. Only safe differences are used (a year,
     "new", "mens", a plural like "putters"), never words that can name a
     different club ("max", "ls", "forged", "tour").
  2. Retailers: it ranks the single-retailer models by how much they matter
     (clubs first, price, brand) and, with the Awin API, lists the UK golf
     retailers you haven't joined yet, with a ready-to-paste application
     note for each. You apply (Awin needs your login); once approved, the
     feed is wired in as usual and the next run shows coverage going up.

Measured by: the share of models with 2+ retailers (data/agents/coverage-report.json,
trend kept in coverage-state.json). Retailer counts and Awin details go to the
owner by email only.
"""
import json
import os
import re
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, products, models, save_report, email_owner, http, table, now, pack_note)

ALIASES = ROOT / "data" / "model-aliases.json"
SAFE_EXTRA = re.compile(r"^(20[12]\d|new|mens|men's|gents|putters|drivers|irons|wedges|hybrids|woods|golf|club|clubs)$")
MAX_MERGES = 25
BRAND_WEIGHT = {"taylormade": 3, "callaway": 3, "titleist": 3, "ping": 3, "cobra": 2, "mizuno": 2, "srixon": 2, "cleveland": 2,
                "odyssey": 2, "scotty cameron": 2, "wilson": 1.5, "pxg": 1.5}


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def coverage(mods):
    n = len(mods) or 1
    multi = sum(1 for m in mods if len(m.get("retailers") or {}) >= 2)
    clubs = [m for m in mods if m.get("group") == "club"]
    cmulti = sum(1 for m in clubs if len(m.get("retailers") or {}) >= 2)
    return {"models": len(mods), "multiRetailerPct": round(100 * multi / n, 1),
            "clubs": len(clubs), "clubsMultiRetailerPct": round(100 * cmulti / (len(clubs) or 1), 1)}


def find_merges(items):
    """Pairs of club groupings that differ by one safe word and share no retailer."""
    import models as M
    aliases = M.load_aliases()
    groups = defaultdict(list)
    for p in items:
        if p.get("salePrice") is None or p.get("condition"):
            continue
        t = M._model_type(p)
        if not t or t[0] != "club":
            continue
        groups[(M._brand_of(p).lower(), t[1], tuple(M._core_tokens(p, t[1], aliases)))].append(p)
    by_bt = defaultdict(list)
    for k, ps in groups.items():
        by_bt[k[:2]].append((k[2], ps))
    found = []
    for (brand, tkey), entries in by_bt.items():
        for ta, pa in entries:
            for tb, pb in entries:
                if not ta or ta == tb or not set(ta) < set(tb) or len(set(tb) - set(ta)) != 1:
                    continue
                extra = (set(tb) - set(ta)).pop()
                if not SAFE_EXTRA.match(extra):
                    continue
                ra, rb = {p["source"] for p in pa}, {p["source"] for p in pb}
                if ra & rb:
                    continue
                ma, mb = min(p["salePrice"] for p in pa), min(p["salePrice"] for p in pb)
                if not 0.7 <= ma / mb <= 1.43:
                    continue
                found.append({"brand": brand, "type": tkey, "keep": ta, "drop": extra, "variant": tb, "listings": [p["id"] for p in pb],
                              "names": [pb[0]["name"], pa[0]["name"]]})
    return found, groups


def rule_for(merge):
    """A narrow rule: remove the extra word only where it sits next to a model word."""
    words = [w for w in merge["variant"] if w != merge["drop"]]
    anchor = re.escape(words[0]) if words else None
    if not anchor:
        return None
    d = re.escape(merge["drop"])
    return [rf"\b{d}\s+(?={anchor}\b)|(?<=\b{anchor})\s+{d}\b", ""]


def prove(rule, merge, items, groups):
    """Re-run the site's grouping with the rule: the pair must merge and nothing else may change."""
    import models as M
    rx = re.compile(rule[0])
    base = M.load_aliases()
    test = base + [(rx, rule[1])]
    brand, tkey = merge["brand"], merge["type"]
    target = (brand, tkey, tuple(merge["keep"]))
    before, after = {}, {}
    for p in items:
        if p.get("salePrice") is None or p.get("condition") or M._brand_of(p).lower() != brand:
            continue
        t = M._model_type(p)
        if not t or t[1] != tkey:
            continue
        before[p["id"]] = (brand, tkey, tuple(M._core_tokens(p, tkey, base)))
        after[p["id"]] = (brand, tkey, tuple(M._core_tokens(p, tkey, test)))
    changed = {i for i in before if before[i] != after[i]}
    if changed != set(merge["listings"]):
        return False  # touches something else, or misses part of the pair
    return all(after[i] == target for i in changed)


def awin_gaps():
    tok, pub = os.environ.get("AWIN_API_TOKEN"), os.environ.get("AWIN_PUBLISHER_ID", "2990893")
    if not tok:
        return None
    s, _, t = http(f"https://api.awin.com/publishers/{pub}/programmes?relationship=notjoined&countryCode=GB",
                   headers={"Authorization": "Bearer " + tok})
    try:
        progs = json.loads(t) if s == 200 else []
    except ValueError:
        progs = []
    golf = [p for p in progs if re.search(r"\bgolf", json.dumps(p), re.I)]
    return [{"name": p.get("name"), "id": p.get("id"), "url": p.get("displayUrl") or p.get("clickThroughUrl")} for p in golf]


APPLY_NOTE = ("GolfPrice AI (golfpriceai.com) is a UK golf price-comparison site tracking {models:,} golf models across multiple UK "
              "retailers, refreshed every six hours. We show genuine price history (never 'was' prices), send price-drop alerts, and run "
              "free golf games and society tools that bring golfers back daily. We'd list your full golf range with deep links to each "
              "product page, so golfers comparing a model see your price alongside others. Traffic is UK golfers in buying mode. "
              "Promotion is organic only: no paid search on your brand, no voucher-code pages, no incentives.")


def main():
    items = products()
    mods = models()
    if not items:
        print("no products"); return
    cov = coverage(mods)
    state = load_json(OUT / "coverage-state.json", {"history": []})
    state["history"] = (state.get("history", []) + [{"date": str(now().date()), **cov}])[-60:]

    # 1. proven merges
    merges, groups = find_merges(items)
    aliases = load_json(ALIASES, {"rename": [], "names": {}})
    have = {r[0] for r in aliases.get("rename", [])}
    proven = []
    for m in merges:
        rule = rule_for(m)
        if not rule or rule[0] in have:
            continue
        try:
            ok = prove(rule, m, items, groups)
        except Exception as e:  # a rule that can't be tested is never proposed
            print("could not prove", m["names"], e)
            ok = False
        if ok:
            proven.append((m, rule))
            have.add(rule[0])
        if len(proven) >= MAX_MERGES:
            break
    if proven:
        aliases.setdefault("rename", []).extend(r for _, r in proven)
        ALIASES.write_text(json.dumps(aliases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        eg = "; ".join(f"“{m['names'][0]}” = “{m['names'][1]}”" for m, _ in proven[:3])
        pack_note("data/model-aliases.json", f"Merge **{len(proven)} clubs listed under two names** by different retailers, so each page "
                                             f"compares both prices (each rule tested against the site's own grouping). e.g. {eg}")

    # 2. single-retailer models that matter most
    singles = []
    for m in mods:
        if len(m.get("retailers") or {}) != 1 or m.get("group") not in ("club", "set", "ball"):
            continue
        w = (2 if m["group"] == "club" else 1) * BRAND_WEIGHT.get(m.get("brand", "").lower(), 1) * (1 + min(float(m.get("minPrice") or 0), 600) / 300)
        singles.append((w, m))
    singles.sort(key=lambda x: -x[0])
    top = [{"page": f"/prices/{m['slug']}/", "name": m["name"]} for _, m in singles[:40]]

    gaps = awin_gaps()
    prev = state["history"][-2] if len(state["history"]) > 1 else None
    rep = save_report("coverage-report.json", {
        "about": "Coverage hunter: how many price pages compare 2+ retailers, merges proposed, and the pages that most need another retailer.",
        **cov, "change": round(cov["multiRetailerPct"] - prev["multiRetailerPct"], 1) if prev else None,
        "mergesProposed": len(proven), "merges": [{"from": m["names"][0], "into": m["names"][1]} for m, _ in proven],
        "mostNeeded": top,
        "status": "ok" if cov["multiRetailerPct"] >= 40 else "attention",
    })
    (OUT / "coverage-state.json").write_text(json.dumps(state, indent=1), encoding="utf-8")
    print(json.dumps({k: rep[k] for k in ("multiRetailerPct", "clubsMultiRetailerPct", "mergesProposed")}))

    if gaps is not None or proven:
        note = APPLY_NOTE.format(models=len(mods))
        html = (f"<h2>Coverage hunter</h2><p>{cov['multiRetailerPct']}% of models compare 2+ retailers "
                f"({cov['clubsMultiRetailerPct']}% of clubs).</p>")
        if gaps:
            html += ("<h3>UK golf retailers on Awin you haven't joined</h3>" + table([(g["name"], g["id"], g.get("url") or "") for g in gaps], ["Programme", "Id", "Site"])
                     + f"<h3>Application note (paste into each application)</h3><p>{note}</p>")
        if proven:
            html += f"<p>{len(proven)} two-name merges are in today's Fix pack.</p>"
        email_owner("GolfPrice AI · coverage hunter", html)


if __name__ == "__main__":
    main()
