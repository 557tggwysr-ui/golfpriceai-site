"""Shared helpers for the GolfPrice AI agents (scripts/agent_*.py).

The agents follow three rules:
  1. Public reports only. Anything committed to this (public) repo is safe to
     show anyone: link health, catalogue checks, search queries. Money and
     traffic numbers (Awin, Search Console clicks and impressions) never touch
     the repo; they go to the owner by email through Brevo.
  2. Draft first. Agents flag and propose. Anything that changes what
     shoppers see goes through a check the owner can see first, until the
     agent has earned automatic approval.
  3. House rules. Never name retailers in public copy ("multiple UK
     retailers"), no fake urgency, positive framing (what IS cheaper).
"""
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "agents"
SITE = "https://golfpriceai.com"
OWNER = os.environ.get("OWNER_EMAIL", "GolfPriceAI@outlook.com")
UA = "Mozilla/5.0 (compatible; GolfPriceAI-agent/1.0; +https://golfpriceai.com/about.html)"


def now():
    return datetime.now(timezone.utc)


def load(name, default=None):
    p = DATA / name
    if not p.exists():
        return default
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def products():
    return (load("products.json") or {}).get("products", [])


def models():
    return (load("models.json") or {}).get("models", [])


def save_report(name, report):
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"generated": now().strftime("%Y-%m-%dT%H:%MZ"), **report}
    with open(OUT / name, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1, ensure_ascii=False)
        f.write("\n")
    return report


def http(url, method="GET", body=None, headers=None, timeout=25):
    """Small urllib wrapper: returns (status, final_url, text)."""
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("User-Agent", UA)
    req.add_header("Accept-Language", "en-GB,en;q=0.9")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if body is not None and not (headers or {}).get("Content-Type"):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.geturl(), r.read(400_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            txt = e.read(100_000).decode("utf-8", "replace")
        except Exception:
            txt = ""
        return e.code, url, txt
    except Exception as e:  # timeouts, DNS, TLS
        return 0, url, str(e)


def email_owner(subject, html):
    """Private report to the owner via Brevo. Quietly skipped without a key."""
    key = os.environ.get("BREVO_API_KEY")
    if not key:
        print("(no BREVO_API_KEY: private email skipped)")
        return False
    try:
        import alerts  # scripts/alerts.py: sender + Brevo helper
        status, _ = alerts.brevo(key, "POST", "/smtp/email", {
            "sender": alerts.SENDER, "to": [{"email": OWNER}],
            "subject": subject, "htmlContent": html,
        })
        print("owner email:", status)
        return 200 <= int(status) < 300
    except Exception as e:
        print("owner email failed:", e)
        return False


def table(rows, heads):
    """Tiny HTML table for the owner emails."""
    th = "".join(f"<th style='text-align:left;padding:4px 8px'>{h}</th>" for h in heads)
    tr = "".join("<tr>" + "".join(f"<td style='padding:4px 8px;border-top:1px solid #ddd'>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table style='border-collapse:collapse;font:14px system-ui'>{'<tr>' + th + '</tr>'}{tr}</table>"


# ---------------- the daily Fix pack ----------------
# Agents that want to change a file (llms.txt, data/agent-links.json, ...)
# write the change into the working tree during the fix-pack run and leave a
# note here. scripts/agent_fixes.py commits every allowed file that changed,
# lists the notes in the pull request, and the owner approves by merging.
PACK_FILES = ["data/agent-rules.json", "data/agent-links.json", "llms.txt"]


def pack_note(path, text):
    """Add one line to today's Fix pack for a changed file (skippable as a whole file)."""
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "pack-notes.json"
    try:
        notes = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        notes = []
    notes.append({"path": path, "text": text})
    p.write_text(json.dumps(notes, indent=1, ensure_ascii=False), encoding="utf-8")
