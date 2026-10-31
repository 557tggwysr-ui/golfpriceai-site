"""Live crowd numbers for the 6-hourly build, so they appear as plain text
(for Google, Bing and AI answer engines, which often don't run JavaScript):

  data/crowd.json             the Crowd Caddie: open calls per product (3 or
                              more golfers) and how often the crowd is right
  data/peoples-bag-live.json  the People's Bag: picks per slot

Both come from the alerts worker's public summaries (counts only, no player
ids or nicknames). If the worker can't be reached, the last copy is used.
"""
import json
import urllib.request

from price_pages import ROOT, _write

API = "https://golfpriceai-alerts.golfpriceai.workers.dev"
DATA = ROOT / "data"
CROWD = {"products": {}, "crowd": {}}
BAG = {"slots": {}, "pickers": 0}


def _get(path, file, label):
    try:
        with urllib.request.urlopen(urllib.request.Request(API + path, headers={"User-Agent": "GolfPriceAI build"}), timeout=20) as r:
            d = json.loads(r.read().decode("utf-8"))
        if d.get("ok"):
            _write(file, json.dumps(d, separators=(",", ":")))
            return d
    except Exception as e:
        print(f"{label}: live numbers unavailable ({e}); using the last copy.")
    try:
        return json.loads(file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load():
    c = _get("/cc/summary", DATA / "crowd.json", "Crowd Caddie")
    CROWD.clear()
    CROWD.update({"products": c.get("products") or {}, "crowd": c.get("crowd") or {}, "month": c.get("month")})
    b = _get("/pb/summary", DATA / "peoples-bag-live.json", "People's Bag")
    BAG.clear()
    BAG.update({"slots": b.get("slots") or {}, "pickers": b.get("pickers") or 0})
    print(f"Crowd data: {len(CROWD['products'])} product(s) with crowd calls; People's Bag pickers {BAG['pickers']}.")


def forecast(slug):
    """The crowd's open call on one product, as percentages, or None."""
    x = CROWD["products"].get(slug)
    if not x or x.get("n", 0) < 3:
        return None
    n = x["n"]
    pct = lambda k: round(100 * x.get(k, 0) / n)
    return {"calls": n, "cheaper": pct("down"), "holds": pct("same"), "pricier": pct("up")}
