"""Publish a new Zenodo version of the open data (monthly, from GitHub Actions).

Zenodo is the permanent, citable copy (DOI). Every published version is
permanent, so this only publishes when the CSV files have changed since the
latest version. Each version keeps the same description, licence and
keywords; only the files, the version label, the publication date and the
end of the "Collected" date range move on.

Needs the ZENODO_TOKEN secret (a Zenodo personal access token with the
deposit:write and deposit:actions scopes). Without it, it does nothing.
"""
import datetime
import hashlib
import os
import sys
from pathlib import Path

import requests

API = "https://zenodo.org/api"
FIRST_RECORD = "23436242"  # the first version; Zenodo finds the latest from here
ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "prices" / "data" / "golf-prices-uk.csv", ROOT / "prices" / "data" / "golf-price-history-uk.csv"]


def md5(path):
    return hashlib.md5(path.read_bytes()).hexdigest()


def main():
    token = (os.environ.get("ZENODO_TOKEN") or "").strip().strip('"')
    if not token:
        print("No ZENODO_TOKEN secret yet - skipping Zenodo.")
        return
    s = requests.Session()
    s.headers["Authorization"] = f"Bearer {token}"
    today = datetime.date.today().isoformat()

    latest = s.get(f"{API}/records/{FIRST_RECORD}/versions/latest", timeout=60)
    latest.raise_for_status()
    latest = latest.json()
    latest_id = latest["id"]
    print(f"Latest version: {latest_id} ({latest.get('metadata', {}).get('version', '?')}). "
          f"Always-latest DOI: {latest.get('conceptdoi', '?')}")

    have = {f["key"]: (f.get("checksum") or "").replace("md5:", "") for f in latest.get("files", [])}
    if all(have.get(p.name) == md5(p) for p in FILES):
        print("Files unchanged since the latest version - nothing to publish.")
        return

    r = s.post(f"{API}/deposit/depositions/{latest_id}/actions/newversion", timeout=60)
    r.raise_for_status()
    draft_url = r.json()["links"]["latest_draft"]
    draft = s.get(draft_url, timeout=60)
    draft.raise_for_status()
    draft = draft.json()
    try:
        for f in draft.get("files", []):
            s.delete(f["links"]["self"], timeout=60).raise_for_status()
        bucket = draft["links"]["bucket"]
        for p in FILES:
            with p.open("rb") as fh:
                s.put(f"{bucket}/{p.name}", data=fh, timeout=300).raise_for_status()

        meta = dict(draft["metadata"])
        for k in ("doi", "prereserve_doi"):
            meta.pop(k, None)
        meta["publication_date"] = today
        meta["version"] = today
        for d in meta.get("dates") or []:
            if (d.get("type") or "").lower() == "collected":
                start = (d.get("start") or "2026-08")
                d["start"], d["end"] = start, today
        s.put(draft["links"]["self"], json={"metadata": meta}, timeout=60).raise_for_status()

        pub = s.post(draft["links"]["publish"], timeout=120)
        pub.raise_for_status()
        print(f"Published Zenodo version {today}: {pub.json().get('doi_url') or pub.json().get('doi')}")
    except Exception:
        # Don't leave a half-made draft behind (it would block next month's run).
        s.post(draft["links"]["discard"], timeout=60)
        raise


if __name__ == "__main__":
    try:
        main()
    except requests.HTTPError as e:
        print(f"Zenodo said: {e.response.status_code} {e.response.text[:500]}")
        sys.exit(1)
