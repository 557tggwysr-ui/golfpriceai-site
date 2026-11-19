"""AI-answer optimiser: keeps GolfPrice AI the source AI apps can trust and cite.

ChatGPT, Claude, Perplexity and Google's AI answers favour sources that are
fresh, structured and consistent. Runs inside the daily Fix pack:

  * Structured data check: every price page's Product markup (the part
    search engines and AI read) must show the same lowest price as the
    live data. Stale or missing markup is reported for fixing.
  * llms.txt links: every link in /llms.txt must point at a page that exists.
  * llms.txt live block: refreshes a short "Prices right now" section in
    /llms.txt (between <!-- live:start --> and <!-- live:end -->) with
    today's figures and the biggest genuine drops, linked to their price
    pages. AI crawlers that read llms.txt get today's facts, not last
    month's. Goes live when the owner approves the Fix pack.

A monthly Claude task asks AI-search-style questions golfers ask and checks
whether GolfPrice AI is cited; its suggestions come in the weekly review.

Public output: data/agents/answers-report.json.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, SITE, load, models, save_report, now, pack_note)

LLMS = ROOT / "llms.txt"
START, END = "<!-- live:start -->", "<!-- live:end -->"


def money(n):
    n = float(n)
    return f"£{n:,.0f}" if n >= 100 or n == int(n) else f"£{n:,.2f}"


def check_markup(mods):
    stale, missing, checked = [], [], 0
    for m in mods:
        f = ROOT / "prices" / m["slug"] / "index.html"
        if not f.exists():
            continue
        checked += 1
        h = f.read_text(encoding="utf-8", errors="replace")
        blocks = re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
        low = None
        for b in blocks:
            try:
                d = json.loads(b)
            except ValueError:
                continue
            if d.get("@type") == "Product":
                low = ((d.get("offers") or {}).get("lowPrice"))
        if low is None:
            missing.append(m["slug"])
        elif abs(float(low) - float(m["minPrice"])) > 0.011:
            stale.append({"page": f"/prices/{m['slug']}/", "markup": low, "live": m["minPrice"]})
    return checked, stale, missing


def exists(url_path):
    p = url_path.split("#")[0].split("?")[0]
    if p.endswith("/"):
        return (ROOT / p.lstrip("/") / "index.html").exists()
    q = ROOT / p.lstrip("/")
    return q.exists() or (q.with_suffix(".html")).exists() or (q / "index.html").exists()


def live_block():
    mods = models()
    bd = load("biggest-drop.json") or {}
    pulse = load("home-pulse.json") or {}
    good = []
    for m in mods:
        hist = [p for _, p in m.get("history") or []]
        if (m.get("verdict") or {}).get("label") != "good" or m.get("group") != "club" or len(hist) < 5:
            continue
        if re.search(r"single-iron|individual|junior|kids|youth|shaft", m["slug"]):
            continue
        saving = max(hist) - float(m["minPrice"])
        if 20 <= saving <= 0.5 * max(hist):
            good.append((saving, m))
    good = [m for _, m in sorted(good, key=lambda x: -x[0])]
    lines = [START, f"## Prices right now (updated {now().strftime('%d %B %Y')})", "",
             f"GolfPrice AI tracks {len(mods):,} golf equipment models across multiple UK retailers, updated every 6 hours."]
    if bd.get("week"):
        lines.append(f"This week {bd['week']} models got genuinely cheaper (checked against our own price history, never a 'was' price).")
    tiles = [t for t in pulse.get("tiles", []) if t.get("compared")]
    if tiles:
        lines.append("Cheaper than a month ago: " + "; ".join(f"{t['cheaper']} of {t['compared']} {t['label'].lower().replace('gps', 'GPS')}" for t in tiles[:6]) + ".")
    lines += ["", "At the lowest price we've tracked today:"]
    for m in good[:8]:
        lines.append(f"- [{m['name']}]({SITE}/prices/{m['slug']}/): {money(m['minPrice'])}")
    lines.append(END)
    return "\n".join(lines)


def refresh_llms():
    if not LLMS.exists():
        return False
    old = LLMS.read_text(encoding="utf-8")
    block = live_block()
    if START in old and END in old:
        new = re.sub(re.escape(START) + r".*?" + re.escape(END), lambda _: block, old, flags=re.S)
    else:
        marker = "## Price guides"
        new = old.replace(marker, block + "\n\n" + marker, 1) if marker in old else old.rstrip() + "\n\n" + block + "\n"
    strip = lambda t: re.sub(r"\(updated [^)]*\)", "", t)
    if strip(new) == strip(old):
        return False
    LLMS.write_text(new, encoding="utf-8")
    return True


def main():
    mods = [m for m in models() if (m.get("gate") or {}).get("passes")]
    checked, stale, missing = check_markup(mods)
    txt = LLMS.read_text(encoding="utf-8") if LLMS.exists() else ""
    links = sorted(set(re.findall(r"\]\((https://golfpriceai\.com[^)\s]*)\)", txt)))
    dead = [u for u in links if not exists(u[len(SITE):] or "/")]
    changed = refresh_llms()
    if changed:
        pack_note("llms.txt", "Refresh the **'Prices right now'** section of llms.txt with today's figures, so AI apps quote current prices.")
    rep = save_report("answers-report.json", {
        "about": "AI-answer optimiser: structured data matches live prices, llms.txt links work, live facts are fresh.",
        "pricePagesChecked": checked, "staleMarkup": len(stale), "staleExamples": stale[:20],
        "missingMarkup": len(missing), "missingExamples": missing[:20],
        "llmsLinks": len(links), "llmsDeadLinks": dead, "llmsRefreshProposed": changed,
        "status": "ok" if not stale and not missing and not dead else "attention",
    })
    print(json.dumps({k: rep[k] for k in ("pricePagesChecked", "staleMarkup", "missingMarkup", "llmsDeadLinks", "llmsRefreshProposed")}))


if __name__ == "__main__":
    main()
