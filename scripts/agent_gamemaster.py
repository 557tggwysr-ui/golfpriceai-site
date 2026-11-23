"""Game master: keeps Wild Nine fair, fresh and clean.

The problem it solves: daily games die when courses feel stale, unfair or
overrun by cheats, and keeping one fresh is a full-time job.

Daily (.github/workflows/agent-gamemaster.yml):
  1. Reads anonymous hole-by-hole results for the last 7 days from the worker
     (/wn/stats, protected by the ALERTS_SECRET) and rebuilds each day's
     course from the live game file (scripts/agent_course.mjs), so it knows
     the par and type of every hole.
  2. Difficulty: the fun zone is a typical round of about +2 to +4 over nine.
     It measures the average and each hole type (gale, island, frost...) and
     proposes small, capped tuning for days 2 to 8 ahead: fairway width, wind,
     slope, green size. Future days only, so everyone playing a given day
     always gets the same course. The tuning goes in the game page's
     WN_TUNING block through the Fix pack.
  3. Fair play: scores that look impossible (well under par, or a grid that
     doesn't add up to a real round) are proposed for hiding from the
     leaderboards.
  4. Nicknames: the worker already turns obviously offensive names into
     "Golfer"; anything subtler that slips through is proposed for renaming.
     Moderation goes in data/wild-nine-moderation.json through the Fix pack.
  5. Notes: the hardest and easiest hole types, the week's best round and
     aces go into data/agents/gamemaster-report.json (for the weekly review
     and the content engine).

Nothing changes until the owner approves the Fix pack.
"""
import json
import os
import re
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, save_report, http, now, pack_note)

WORKER = os.environ.get("ALERTS_WORKER_URL") or "https://golfpriceai-alerts.golfpriceai.workers.dev"
GAME = ROOT / "play" / "wild-nine" / "index.html"
MOD = ROOT / "data" / "wild-nine-moderation.json"
EPOCH = date(2026, 11, 1)  # worker day 1
TARGET = (2.0, 4.0)        # a fun nine: a couple over par on average
MIN_ROUNDS = 40            # don't tune on thin data
SUSPECT_WORDS = re.compile(r"(sex|porn|nob|knob|tit|bum|arse|ass\b|cum|jizz|spunk|willy|fanny|bellend|minge|tosser|retard|spaz|gay|homo|paki|n[i1]gg|kike|chink|coon)", re.I)


def seed_for(day):
    d = EPOCH + timedelta(days=day - 1)
    return int(d.strftime("%Y%m%d"))


def courses(seeds):
    if not seeds:
        return {}
    try:
        out = subprocess.run(["node", "scripts/agent_course.mjs", *map(str, seeds)], cwd=ROOT, capture_output=True, text=True, timeout=120)
        return json.loads(out.stdout or "{}")
    except Exception as e:
        print("course reader failed:", e)
        return {}


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def main():
    key = os.environ.get("ALERTS_SECRET")
    if not key or not GAME.exists():
        save_report("gamemaster-report.json", {"about": "Game master: waiting for Wild Nine to be live and the ALERTS_SECRET to be available.", "status": "waiting"})
        print("waiting: game not live or no key"); return
    s, _, txt = http(f"{WORKER}/wn/stats?days=7", headers={"x-agent-key": key})
    if s != 200:
        save_report("gamemaster-report.json", {"about": "Game master: the worker's stats feed isn't answering yet (deploy the new worker).", "status": "waiting", "http": s})
        print("stats feed not ready:", s); return
    st = json.loads(txt)
    days = st.get("days", [])
    cs = courses([seed_for(d["day"]) for d in days])
    by_mod, rounds_tp, total = defaultdict(list), [], 0
    best = None
    aces = 0
    for d in days:
        c = cs.get(str(seed_for(d["day"])))
        if not c:
            continue
        pars = [h["par"] for h in c["holes"]]
        for g in d["grids"]:
            if len(g) != 9:
                continue
            sc = [int(ch, 36) for ch in g]
            if any(x < 1 for x in sc):
                continue
            total += 1
            tp = sum(sc) - sum(pars)
            rounds_tp.append(tp)
            if best is None or tp < best[0]:
                best = (tp, d["day"])
            for h, x in zip(c["holes"], sc):
                by_mod[h["mod"]].append(x - h["par"])
                aces += x == 1
    avg = round(statistics.mean(rounds_tp), 2) if rounds_tp else None
    mod_avg = {m: round(statistics.mean(v), 2) for m, v in by_mod.items() if len(v) >= 20}
    overall_hole = statistics.mean([x for v in by_mod.values() for x in v]) if by_mod else 0

    # difficulty tuning for future days (2 to 8 days ahead), small steps, capped
    tuning, why = None, ""
    if total >= MIN_ROUNDS and avg is not None:
        g = {}
        if avg > TARGET[1]:
            g, why = {"hw": 1.06, "wind": -2, "GR": 1.05}, f"rounds are averaging +{avg}, a bit too hard"
        elif avg < TARGET[0]:
            g, why = {"hw": 0.95, "wind": 2, "slope": 1.06}, f"rounds are averaging {avg:+}, a bit too easy"
        mods = {}
        for m, a in mod_avg.items():
            if a - overall_hole > 0.6:
                mods[m] = {"hw": 1.08, "wind": -2, "GR": 1.06}
            elif a - overall_hole < -0.4:
                mods[m] = {"hw": 0.94, "wind": 2}
        if g or mods:
            tuning = {**g, **({"mods": mods} if mods else {})}
    proposed_days = []
    if tuning:
        html = GAME.read_text(encoding="utf-8")
        hit = re.search(r"window\.WN_TUNING=(\{.*?\});</script>", html, re.S)
        if hit:
            cur = json.loads(hit.group(1))
            today = st.get("today") or (now().date() - EPOCH).days + 1
            keep = {k: v for k, v in cur.get("days", {}).items() if int(k) >= seed_for(today)}
            for ahead in range(2, 9):
                sd = str(seed_for(today + ahead))
                if sd not in keep:
                    keep[sd] = tuning
                    proposed_days.append(sd)
            if proposed_days:
                new = html[:hit.start(1)] + json.dumps({"days": keep}, separators=(",", ":")) + html[hit.end(1):]
                GAME.write_text(new, encoding="utf-8")
                hard = ", ".join(f"{m} ({a:+})" for m, a in sorted(mod_avg.items(), key=lambda x: -x[1])[:2])
                pack_note("play/wild-nine/index.html", f"Tune Wild Nine courses for the next {len(proposed_days)} days: {why or 'some hole types are out of line'}. "
                                                      f"Hardest hole types: {hard}. Small, capped changes to fairway width, wind and greens; past and today's courses are untouched.")

    # fair play and nicknames
    mod = load_json(MOD, {"hidePids": [], "renameNicks": []})
    new_hide = [o for o in st.get("outliers", []) if o["pid"] not in mod["hidePids"]]
    new_nicks = [n["nick"] for n in st.get("nicks", []) if n.get("nick") and SUSPECT_WORDS.search(n["nick"].replace("0", "o").replace("1", "i"))
                 and n["nick"].lower() not in {x.lower() for x in mod["renameNicks"]}]
    if new_hide or new_nicks:
        mod["hidePids"] = sorted(set(mod["hidePids"]) | {o["pid"] for o in new_hide})
        mod["renameNicks"] = sorted(set(mod["renameNicks"]) | set(new_nicks))
        mod["about"] = "Approved through the Fix pack. The worker hides these scores and shows these nicknames as 'Golfer'."
        MOD.write_text(json.dumps(mod, indent=1) + "\n", encoding="utf-8")
        parts = []
        if new_hide:
            parts.append(f"hide {len(new_hide)} score(s) that look impossible (e.g. {new_hide[0]['nick']}: {new_hide[0]['tp']:+} on day {new_hide[0]['day']})")
        if new_nicks:
            parts.append(f"rename {len(new_nicks)} nickname(s) to 'Golfer': {', '.join(new_nicks[:5])}")
        pack_note("data/wild-nine-moderation.json", "Wild Nine fair play: " + "; ".join(parts) + ".")

    rep = save_report("gamemaster-report.json", {
        "about": "Game master: Wild Nine difficulty, fair play and nicknames over the last 7 days (anonymous).",
        "roundsAnalysed": total, "averageToPar": avg, "target": f"+{TARGET[0]:g} to +{TARGET[1]:g}",
        "holeTypes": dict(sorted(mod_avg.items(), key=lambda x: -x[1])),
        "aces": aces, "bestRound": {"toPar": best[0], "day": best[1]} if best else None,
        "tuningProposedForDays": proposed_days, "tuning": tuning,
        "scoresToHide": len(new_hide), "nicknamesToRename": len(new_nicks),
        "status": "ok" if not (proposed_days or new_hide or new_nicks) else "attention",
    })
    print(json.dumps({k: rep[k] for k in ("roundsAnalysed", "averageToPar", "aces", "tuningProposedForDays", "scoresToHide", "nicknamesToRename")}))


if __name__ == "__main__":
    main()
