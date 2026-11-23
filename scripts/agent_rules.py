"""Approved agent fixes, applied on every deal refresh.

data/agent-rules.json holds fixes the agents proposed and the owner
approved (by merging the daily "Fix pack" pull request). update_deals.py
calls apply() right after its own clean-up, before prices are recorded or
any page is built, so an approved fix reaches every page within one refresh.

Each rule is keyed by "<feed>|<product name>" (the same key price history
uses), so it keeps working when ids change. Kinds:

  hide      : {"key": {"reason": "...", "until": "YYYY-MM-DD"}}
              take the listing off the site until the date (a wrong price,
              a dead buy link). Rules expire, so the agents re-check them.
  category  : {"key": {"to": "accessories", "reason": "..."}}
              a product filed in the wrong category (a neck warmer filed
              as a fairway wood).
  condition : {"key": {"to": "Used", "reason": "..."}}
              second-hand stock missing its condition, so it moves into
              Preowned and trade-ins.

Undo any fix by deleting its line from data/agent-rules.json, or by
reverting the pull request that added it. If this file is missing or
broken, nothing happens: the refresh carries on exactly as before.
"""
import json
from datetime import date
from pathlib import Path

RULES = Path(__file__).resolve().parent.parent / "data" / "agent-rules.json"
PAUSE = Path(__file__).resolve().parent.parent / "data" / "agents-paused"


def key(p):
    return f"{p.get('source')}|{p.get('name')}"


def load():
    try:
        return json.loads(RULES.read_text(encoding="utf-8"))
    except Exception:
        return {}


def apply(products, today=None):
    """Returns the product list with approved fixes applied, plus counts."""
    if PAUSE.exists():
        print("Agent rules: paused (data/agents-paused exists), nothing applied.")
        return products, {}
    rules = load()
    if not rules:
        return products, {}
    today = today or date.today().isoformat()
    hide = {k: v for k, v in (rules.get("hide") or {}).items() if (v.get("until") or "9999") >= today}
    cat = rules.get("category") or {}
    cond = rules.get("condition") or {}
    out, n = [], {"hidden": 0, "recategorised": 0, "conditioned": 0}
    for p in products:
        k = key(p)
        if k in hide:
            n["hidden"] += 1
            continue
        if k in cat and cat[k].get("to") and p.get("category") != cat[k]["to"]:
            p["category"] = cat[k]["to"]
            p.pop("icon", None)
            n["recategorised"] += 1
        if k in cond and not p.get("condition"):
            p["condition"] = cond[k].get("to") or "Used"
            n["conditioned"] += 1
        out.append(p)
    if any(n.values()):
        print(f"Agent rules: hid {n['hidden']}, re-filed {n['recategorised']}, marked {n['conditioned']} second-hand.")
    return out, n
