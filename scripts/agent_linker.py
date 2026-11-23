"""Internal linker: lifts the pages that are close to ranking.

Runs inside the daily Fix pack. It picks the price pages that most need a lift:
  * search opportunities on page two or that should own a query
    (data/agents/seo-opportunities.json),
  * brand-new price pages (new launches) with no links pointing at them yet.

For each, it chooses up to six strong related pages (same type of club,
widely stocked, similar price) to link to it from their "Worth comparing"
box. The plan goes in data/agent-links.json, which scripts/price_pages.py
reads on the next build. Each lift lasts 60 days, then the search engine
report shows whether it worked and the weekly review decides what's next.

Changes reach the site only when the owner approves the Fix pack.
"""
import json
import os
import re
import sys
from datetime import timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, models, now, pack_note)

LINKS = ROOT / "data" / "agent-links.json"
MAX_NEW = 8
SOURCES = 6
DAYS = 60


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def main():
    mods = [m for m in models() if (m.get("gate") or {}).get("passes")]
    by = {m["slug"]: m for m in mods}
    links = load_json(LINKS, {"boost": {}})
    today = now().date()
    boost = {k: v for k, v in (links.get("boost") or {}).items() if v.get("until", "9999") >= str(today)}
    expired = len(links.get("boost") or {}) - len(boost)

    targets = []
    for o in load_json(OUT / "seo-opportunities.json", {}).get("opportunities", []):
        m = re.match(r"^/prices/([^/]+)/", o.get("page", ""))
        slug = m.group(1) if m else None
        if o.get("type") == "gap":
            hit = re.search(r"/prices/([^/]+)/", o.get("idea", ""))
            slug = hit.group(1) if hit else slug
        if slug in by and slug not in boost:
            targets.append((slug, f"search: '{o['query']}' ({o['type']})"))
    state = load_json(OUT / "linker-state.json", {})
    seen = set(state.get("seen", []))
    if seen:
        for m in mods:
            if m["slug"] not in seen and m.get("group") == "club" and m["slug"] not in boost:
                targets.append((m["slug"], "new price page"))
    added = []
    for slug, why in targets:
        if len(added) >= MAX_NEW or slug in {a[0] for a in added}:
            continue
        t = by[slug]
        price = float(t.get("minPrice") or 0)
        pool = [x for x in mods if x["type"] == t["type"] and x["slug"] != slug]
        pool.sort(key=lambda x: (-len(x.get("retailers") or {}), abs(float(x.get("minPrice") or 0) - price)))
        src = [x["slug"] for x in pool[:SOURCES]]
        if not src:
            continue
        boost[slug] = {"from": src, "why": why, "added": str(today), "until": str(today + timedelta(days=DAYS))}
        added.append((slug, why, len(src)))
    state["seen"] = sorted(by)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "linker-state.json").write_text(json.dumps(state), encoding="utf-8")
    if not added and not expired:
        print("no new links"); return
    LINKS.write_text(json.dumps({"about": "Internal links added by the linker agent, approved through the Fix pack. "
                                          "Each target page is linked from its strongest related pages until the date shown.",
                                 "boost": boost}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if added:
        names = ", ".join(f"{by[s]['name']} ({w})" for s, w, _ in added[:4]) + ("…" if len(added) > 4 else "")
        pack_note("data/agent-links.json", f"Add internal links to **{len(added)} pages** that are close to ranking or brand new, "
                                           f"each from up to {SOURCES} related pages: {names}.")
    elif expired:
        pack_note("data/agent-links.json", f"Retire {expired} internal-link lifts that have run their {DAYS} days.")
    print(f"linker: {len(added)} new, {expired} expired")


if __name__ == "__main__":
    main()
