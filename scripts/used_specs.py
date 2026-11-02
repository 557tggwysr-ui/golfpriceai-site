"""Specs for used and ex-demo clubs, read from the listing name.

Used stock comes one club at a time, so its spec is in the name:
"TaylorMade Qi35 Graphite Mens Right Hand Driver 10.5* Stiff - Fujikura Ventus 5-S".
This reads the hand, loft, flex and shaft so golfers can filter to a club
that fits them. Anything not stated in the name is left out, never guessed.
js/shop.js has the same rules (usedSpecs) for the Clubs › Preowned filters.
"""
import re

HAND_RX = re.compile(r"\b(right|left)[ -]?hand(?:ed)?\b", re.I)
LOFT_RX = re.compile(r"\b(\d{1,2}(?:\.\d)?)\s*(?:\*|°|º|\s?deg(?:ree)?s?\b)", re.I)
LOFT2_RX = re.compile(r"\bhand\s+(?:\w+\s+)?(\d{1,2}(?:\.\d)?)(?=\s|$)(?!\s*(?:-|\"|pw|sw))", re.I)  # "Right Hand 10.5 Regular"
SHAFT_RX = re.compile(r"\b(graphite|steel)\b", re.I)
FLEX = [
    ("Extra stiff", re.compile(r"\b(extra[ -]?stiff|x[ -]?stiff|tour x|x flex)\b", re.I)),
    ("Stiff/Regular", re.compile(r"\b(stiff/regular|regular/stiff|firm)\b", re.I)),
    ("Stiff", re.compile(r"\b(stiff|s flex)\b", re.I)),
    ("Regular", re.compile(r"\b(regular|r flex)\b", re.I)),
    ("Senior", re.compile(r"\b(senior|a flex|lite|amateur)\b", re.I)),
    ("Ladies", re.compile(r"\b(ladies|l flex)\b", re.I)),
]
GRADES = {"Like New": "Like new", "Very Good": "Very good", "Good": "Good", "Average": "Average", "Ex-demo": "Ex-demo"}
LOFTED = {"driver", "wood", "hybrid", "wedge", "single-iron"}


def specs(name, type_key=None):
    """{"hand", "loft", "flex", "shaft"}: each a short label, or None."""
    head = (name or "").split(" - ")[0]  # after " - " is the shaft model ("Ventus 5-S"), not the spec
    out = {"hand": None, "loft": None, "flex": None, "shaft": None}
    m = HAND_RX.search(head)
    if m:
        out["hand"] = m.group(1).capitalize()
    if type_key is None or type_key in LOFTED:
        m = LOFT_RX.search(head) or (LOFT2_RX.search(head) if type_key == "driver" else None)
        if m:
            v = float(m.group(1))
            if 5 <= v <= 64:
                out["loft"] = (f"{v:g}") + "°"
    for label, rx in FLEX:
        if rx.search(head):
            out["flex"] = label
            break
    m = SHAFT_RX.search(head)
    if m:
        out["shaft"] = m.group(1).capitalize()
    return out


def grade(p):
    """The retailer's own grading, or "Used" when it gives none."""
    return GRADES.get(p.get("condition") or "", "Used")
