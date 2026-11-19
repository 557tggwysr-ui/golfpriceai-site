"""Claims guardian: every claim the site makes stays true.

The problem it solves: the site and its agents now make thousands of
automatic claims ("At the lowest price we've tracked", "Good time to buy",
"Retailer X, from £P today", "£N cheaper"). UK consumer law now lets the CMA
fine directly for misleading pricing, so one stale claim repeated across
pages is a real risk, and the risk grows with automation.

Daily (.github/workflows/agent-claims.yml):
  1. Price pages: each page's "lowest we've tracked" badge, "Good time to buy"
     verdict and "from £P today" answer must match the live data. A mismatch
     means the page is stale or the claim is wrong.
  2. Disclosure: every page carrying buy links must say we may earn a commission.
  3. Urgency and wording: no countdowns, "hurry", "ends soon", "last chance",
     "only X left", "fake", "was £" anywhere on the site, in llms.txt, or in the
     content engine's captions and video hooks. This is the safety net for the
     other agents' writing.
  4. Live price match (in Actions): opens a sample of buy links, reads the price
     on the retailer's own product page and compares it with ours. Listings more
     than 5% (and £1) out are proposed for hiding in the Fix pack until the feed
     catches up (data/agents/claims-findings.json).

Public output: data/agents/claims-report.json, with an accuracy score.
"""
import json
import os
import random
import re
import sys
import time
from html import unescape
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, SITE, products, models, save_report, http, now)

URGENCY = re.compile(r"\b(hurry|ends soon|ending soon|last chance|only \d+ left|selling fast|don'?t miss out|today only|"
                     r"limited time|act now|while stocks last|countdown|fake|was £[\d,.]+\s*(?:now|→|-)\s*£)(?![a-z])", re.I)
NEGATED = re.compile(r"(n.?t|\bnot\b|\bno\b|\bzero\b|\bnever\b|\bwithout\b|instead of|\bwhy\b)[^.?!]{0,60}$", re.I)
DISCLOSE = re.compile(r"(commission|affiliate)", re.I)
PRICE_RX = [re.compile(r'"price"\s*:\s*"?(\d+(?:\.\d{1,2})?)"?'),
            re.compile(r'property="product:price:amount"\s+content="(\d+(?:\.\d{1,2})?)"'),
            re.compile(r'itemprop="price"\s+content="(\d+(?:\.\d{1,2})?)"')]
SAMPLE = 30


def text_of(h):
    h = re.sub(r"<script(?![^>]*ld\+json).*?</script>|<style.*?</style>", " ", h, flags=re.S)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", h)))


def money_in(s):
    return float(s.replace(",", ""))


def check_price_pages(mods):
    wrong, checked = [], 0
    for m in mods:
        f = ROOT / "prices" / m["slug"] / "index.html"
        if not f.exists():
            continue
        checked += 1
        t = text_of(f.read_text(encoding="utf-8", errors="replace"))
        good = (m.get("verdict") or {}).get("label") == "good"
        says_low = bool(re.search(r"lowest price we.?ve tracked", t, re.I))
        says_good = "Good time to buy" in t
        if (says_low or says_good) and not good:
            wrong.append({"page": f"/prices/{m['slug']}/", "claim": "lowest tracked / good time to buy", "live": m["verdict"]["label"]})
        hit = re.search(r"from £([\d,]+(?:\.\d{2})?) today", t)
        if hit and abs(money_in(hit.group(1)) - float(m["minPrice"])) > 0.011:
            wrong.append({"page": f"/prices/{m['slug']}/", "claim": f"from £{hit.group(1)} today", "live": m["minPrice"]})
    return checked, wrong


def pages_with_buy_links():
    out = []
    for f in list(ROOT.glob("*.html")) + list(ROOT.glob("prices/*/index.html"))[:400] + list(ROOT.glob("prices/*/*/index.html"))[:200]:
        h = f.read_text(encoding="utf-8", errors="replace")
        if "awin1.com" in h or 'data-buy' in h or "/go/" in h:
            out.append((f, h))
    return out


def check_disclosure(pages):
    missing = []
    for f, h in pages:
        if "noindex" in h[:3000] and "social/pack" in str(f):
            continue
        if not DISCLOSE.search(text_of(h)):
            missing.append("/" + str(f.relative_to(ROOT)).replace("index.html", ""))
    return missing


def check_wording():
    hits = []
    files = list(ROOT.glob("*.html")) + list(ROOT.glob("prices/*/index.html"))[:600] + list(ROOT.glob("play/*/index.html")) + list(ROOT.glob("societies/**/index.html"))
    for f in files:
        t = text_of(f.read_text(encoding="utf-8", errors="replace"))
        for m in URGENCY.finditer(t):
            ctx = t[max(0, m.start() - 50): m.end() + 50]
            if NEGATED.search(t[max(0, m.start() - 90): m.start()]):
                continue  # the site saying it DOESN'T do these things is fine
            hits.append({"where": "/" + str(f.relative_to(ROOT)), "words": m.group(0), "context": ctx.strip()[:140]})
    extra = []
    llms = ROOT / "llms.txt"
    if llms.exists():
        extra.append(("llms.txt", llms.read_text(encoding="utf-8")))
    plan = OUT / "content-plan.json"
    if plan.exists():
        for p in json.loads(plan.read_text(encoding="utf-8")).get("posts", [])[-14:]:
            extra.append((f"content post {p['id']}", json.dumps(p.get("captions", {})) + " " + p.get("hook", "")))
    for where, t in extra:
        for m in URGENCY.finditer(t):
            ctx = t[max(0, m.start() - 50): m.end() + 50]
            if NEGATED.search(t[max(0, m.start() - 90): m.start()]):
                continue
            hits.append({"where": where, "words": m.group(0), "context": ctx.strip()[:140]})
    return hits[:60]


def live_price_match(items):
    if os.environ.get("AGENT_OFFLINE") == "1":
        return None
    random.seed(str(now().date()))
    pool = [p for p in items if p.get("inStock") and not p.get("condition") and p.get("salePrice")]
    out = []
    for p in random.sample(pool, min(SAMPLE, len(pool))):
        s, final, h = http(p["affiliateUrl"], timeout=30)
        time.sleep(1.0)
        if s != 200:
            continue
        price = None
        for rx in PRICE_RX:
            vals = [float(v) for v in rx.findall(h[:300_000]) if 0.5 < float(v) < 20000]
            if vals:
                price = min(vals, key=lambda v: abs(v - p["salePrice"]))
                break
        if price is None:
            continue
        diff = price - p["salePrice"]
        out.append({"id": p["id"], "name": p["name"], "ours": p["salePrice"], "theirs": price,
                    "ok": abs(diff) <= max(1.0, 0.05 * p["salePrice"])})
    return out


def main():
    mods = [m for m in models() if (m.get("gate") or {}).get("passes")]
    checked, wrong = check_price_pages(mods)
    buy_pages = pages_with_buy_links()
    no_disclosure = check_disclosure(buy_pages)
    wording = check_wording()
    match = live_price_match(products())
    mism = [m for m in (match or []) if not m["ok"]]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "claims-findings.json").write_text(json.dumps({"generated": now().strftime("%Y-%m-%dT%H:%MZ"), "priceMismatch": mism}, ensure_ascii=False), encoding="utf-8")
    total = checked + len(buy_pages) + (len(match) if match else 0)
    bad = len(wrong) + len(no_disclosure) + len(mism)
    score = round(100 * (1 - bad / max(1, total)), 1)
    rep = save_report("claims-report.json", {
        "about": "Claims guardian: price-page claims match live data, buy pages carry the commission disclosure, no urgency or 'was' wording, and our prices match retailers' own pages.",
        "accuracyPct": score,
        "pricePagesChecked": checked, "wrongClaims": len(wrong), "wrongExamples": wrong[:25],
        "buyPagesChecked": len(buy_pages), "missingDisclosure": no_disclosure[:40],
        "wordingFlags": wording,
        "priceMatchChecked": len(match) if match is not None else None, "priceMismatches": mism,
        "status": "ok" if bad == 0 and not wording else "attention",
    })
    print(json.dumps({k: rep[k] for k in ("accuracyPct", "pricePagesChecked", "wrongClaims", "buyPagesChecked", "priceMatchChecked")}),
          "| no disclosure:", len(no_disclosure), "| wording flags:", len(wording))


if __name__ == "__main__":
    main()
