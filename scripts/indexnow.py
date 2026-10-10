"""Tell Bing (and the other IndexNow search engines: Yandex, Naver, Seznam,
Yep) which price pages changed this run, so they re-read them within hours
instead of weeks. Google doesn't use IndexNow; it reads the sitemap.

Run by the workflow after the new pages are published. Reads the list that
scripts/price_pages.py wrote, and never fails the run: a missed ping just
means the engines find the change on their next visit.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

HOST = "golfpriceai.com"
KEY = "96c04db17214aaff820dbf58d102588a"
LIST = Path("/tmp/indexnow-urls.txt")

def main():
    if not LIST.exists():
        print("IndexNow: nothing to send.")
        return
    urls = [u.strip() for u in LIST.read_text().splitlines() if u.strip()]
    if not urls:
        print("IndexNow: no price changes this run.")
        return
    # Give GitHub Pages a moment to publish the new files first.
    time.sleep(90)
    body = json.dumps({"host": HOST, "key": KEY, "keyLocation": f"https://{HOST}/{KEY}.txt",
                       "urlList": urls[:10000]}).encode()
    req = urllib.request.Request("https://api.indexnow.org/indexnow", data=body,
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f"IndexNow: sent {len(urls)} URL(s), response {r.status}.")
    except Exception as exc:  # noqa: BLE001 - report and carry on
        print(f"IndexNow: send failed ({exc}); search engines will pick the changes up on their next visit.")

if __name__ == "__main__":
    main()
    sys.exit(0)
