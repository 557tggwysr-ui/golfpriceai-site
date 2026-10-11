"""Homepage "Most compared this week".

The models GolfPrice AI visitors looked at most in the last 7 days, ranked by
views of each model's price page in Google Analytics. Two parts:

  python scripts/most_compared.py fetch
      Run once a day by .github/workflows/most-compared.yml. Asks Google
      Analytics for price-page views over the last 7 days and the 7 before,
      and saves only the ranking (model slugs and positions, no visitor
      counts and nothing about any visitor) to data/most-compared-ranks.json.
      Needs two GitHub secrets: GA4_PROPERTY_ID and GA4_SA_KEY (a read-only
      service account key). Without them it does nothing.

  build(...)
      Called by price_pages.build every 6 hours. Joins that ranking with
      today's prices into data/home-popular.json, so the homepage always
      shows current prices. If there's no ranking yet, or too few models
      have been viewed to make a fair top 8, it writes an empty list and the
      homepage section stays hidden.

Analytics only loads for visitors who accept cookies, so this counts those
visits only.
"""
import json
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKS = ROOT / "data" / "most-compared-ranks.json"
OUT = ROOT / "data" / "home-popular.json"
MIN_VIEWS = 3      # a model needs at least this many views in the week to rank
MIN_MODELS = 8     # and at least this many models must qualify, or we show nothing
KEEP = 40          # ranked models saved (enough for every category chip)


def fetch():
    prop, key = os.environ.get("GA4_PROPERTY_ID", "").strip(), os.environ.get("GA4_SA_KEY", "").strip()
    if not prop or not key:
        print("Most compared: GA4_PROPERTY_ID / GA4_SA_KEY not set, skipping.")
        return
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession

    creds = service_account.Credentials.from_service_account_info(
        json.loads(key), scopes=["https://www.googleapis.com/auth/analytics.readonly"])
    body = {
        "dateRanges": [{"startDate": "7daysAgo", "endDate": "yesterday", "name": "this"},
                       {"startDate": "14daysAgo", "endDate": "8daysAgo", "name": "last"}],
        "dimensions": [{"name": "pagePath"}],
        "metrics": [{"name": "screenPageViews"}],
        "dimensionFilter": {"filter": {"fieldName": "pagePath", "stringFilter": {"matchType": "BEGINS_WITH", "value": "/prices/"}}},
        "limit": 5000,
    }
    r = AuthorizedSession(creds).post(
        f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport", json=body, timeout=60)
    if r.status_code != 200:
        sys.exit(f"Most compared: Google Analytics said {r.status_code}: {r.text[:300]}")
    views = {"this": {}, "last": {}}
    for row in r.json().get("rows", []):
        dims = [d["value"] for d in row["dimensionValues"]]
        path, period = dims[0], dims[1] if len(dims) > 1 else "this"
        parts = path.split("?")[0].strip("/").split("/")
        if len(parts) != 2 or parts[0] != "prices":
            continue  # only /prices/<model>/; hubs and brand pages are filtered out later
        slug = parts[1]
        views[period][slug] = views[period].get(slug, 0) + int(row["metricValues"][0]["value"])

    def ranked(v):
        return [s for s, n in sorted(v.items(), key=lambda kv: (-kv[1], kv[0])) if n >= MIN_VIEWS]

    data = {"fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "this": ranked(views["this"])[:KEEP * 2], "last": ranked(views["last"])[:KEEP * 2]}
    RANKS.write_text(json.dumps(data, indent=0))
    print(f"Most compared: {len(data['this'])} pages ranked this week, {len(data['last'])} last week.")


def build(passing, built, products, today):
    from home_deals import GROUP, _image
    items = []
    try:
        ranks = json.loads(RANKS.read_text())
        fresh = (today - date.fromisoformat(ranks["fetched"])).days <= 3
    except (OSError, ValueError, KeyError):
        ranks, fresh = None, False
    if ranks and fresh:
        by_slug = {m["slug"]: m for m in passing if m["slug"] in built and m["type"] in GROUP}
        by_id = {p["id"]: p for p in products}
        last = [s for s in ranks["last"] if s in by_slug]
        for slug in ranks["this"]:
            m = by_slug.get(slug)
            img = m and _image(m, by_id)
            if not img:
                continue
            prev = last.index(slug) + 1 if slug in last else None
            items.append({"slug": slug, "name": m["name"], "brand": m.get("brand") or "", "group": GROUP[m["type"]],
                          "now": float(m["minPrice"]), "unit": " per dozen" if m["type"] == "ball" else "",
                          "retailers": len(m["retailers"]), "image": img, "rank": len(items) + 1, "prev": prev})
            if len(items) == KEEP:
                break
        if len(items) < MIN_MODELS:
            items = []
    OUT.write_text(json.dumps({"date": today.isoformat(), "items": items}, separators=(",", ":")))
    print(f"Most compared: {len(items)} models on the homepage" + ("" if ranks else " (no Analytics ranking yet)") + ".")
    return items


if __name__ == "__main__" and sys.argv[1:] == ["fetch"]:
    fetch()
