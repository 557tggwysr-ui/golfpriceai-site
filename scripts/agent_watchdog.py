"""Watchdog: makes sure every other agent is doing what it should.

Runs every 3 hours (.github/workflows/agent-watchdog.yml), separately from
all the agents it watches. Four checks:

  1. Did it run? Each agent's workflow must have a recent, successful run
     (the deal refresh too, since most agents depend on it). A failed or
     overdue run is a problem.
  2. Is its output fresh and sane? Each report must be recent, and the
     numbers must not swing wildly between runs: listings suddenly collapsing,
     a fix pack far bigger than usual, a week with no posts planned, claims
     accuracy dropping. Sudden swings usually mean something upstream broke.
  3. Is it staying in its lane? An open Fix pack may only change the files
     agents are allowed to change. Anything else, or a pack that's suspiciously
     big, gets a "do-not-merge" label and a comment saying why, so a broken
     agent can never slip a bad change into your approvals.
  4. Who watches the watchdog? Each run checks in with the alerts worker
     (/wd/beat). If the watchdog itself goes quiet for 26 hours, the worker's
     own timer emails the owner. Two independent systems, so one failing
     can't hide the other.

What you see: one GitHub issue, "Agent health", kept up to date (open while
something's wrong, closed when all is well, so the GitHub app notifies you),
plus an email when a NEW problem appears. No repeat emails for the same problem.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (OUT, PACK_FILES, http, now, email_owner, save_report)

WORKER = os.environ.get("ALERTS_WORKER_URL") or "https://golfpriceai-alerts.golfpriceai.workers.dev"
# workflow file: (plain name, hours before a run counts as overdue)
WORKFLOWS = {
    "update-deals.yml": ("Deal refresh", 8),
    "agent-revenue.yml": ("Revenue guardian", 27),
    "agent-catalogue.yml": ("Catalogue autopilot", 27),
    "agent-claims.yml": ("Claims guardian", 27),
    "agent-shopper.yml": ("Mystery shopper", 27),
    "agent-fixes.yml": ("Fix pack (with linker, AI answers, game master, coverage, society, course data, seasonal, email)", 27),
    "agent-content.yml": ("Content engine and trends scout", 27),
    "agent-search.yml": ("Search engine", 8 * 24 + 3),
    "agent-story.yml": ("Data story", 32 * 24),
    "agent-insights.yml": ("Retailer insights", 32 * 24),
}
# report file: (plain name, hours before it counts as stale)
REPORTS = {
    "revenue-report.json": ("Revenue guardian", 30), "catalogue-report.json": ("Catalogue autopilot", 30),
    "claims-report.json": ("Claims guardian", 30), "shopper-report.json": ("Mystery shopper", 30),
    "answers-report.json": ("AI-answer optimiser", 30), "content-plan.json": ("Content engine", 8 * 24),
    "seo-opportunities.json": ("Search engine", 8 * 24 + 6),
    "performance.json": ("Performance analyst", 30), "editor-findings.json": ("Editor", 30),
    "competitor-watch.json": ("Competitor watch", 8 * 24 + 6),
}
MAX_PACK_FILES = 12
MAX_PACK_LINES = 80


def gh(method, path, body=None):
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if os.environ.get("GITHUB_ACTIONS") != "true" or not tok or not repo:
        return None
    s, _, txt = http(f"https://api.github.com/repos/{repo}{path}", method=method, body=body,
                     headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
    try:
        return json.loads(txt) if txt else None
    except ValueError:
        return None


def hours_since(ts):
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return (now() - t).total_seconds() / 3600
    except Exception:
        return None


def load(name):
    try:
        return json.loads((OUT / name).read_text(encoding="utf-8"))
    except Exception:
        return None


def check_runs(problems):
    for wf, (name, max_h) in WORKFLOWS.items():
        runs = (gh("GET", f"/actions/workflows/{wf}/runs?per_page=5&status=completed") or {}).get("workflow_runs")
        if runs is None:
            continue  # not uploaded yet, or the API isn't reachable
        if not runs:
            problems.append(("never-ran:" + wf, f"{name} has never run. Run it once from the Actions tab."))
            continue
        last = runs[0]
        age = hours_since(last.get("updated_at") or last.get("created_at") or "")
        if last.get("conclusion") not in ("success", "skipped"):
            how = {"failure": "failed", "cancelled": "was cancelled", "timed_out": "timed out"}.get(last.get("conclusion"), "didn't finish")
            problems.append(("failed:" + wf, f"{name}: the last run {how} ({last.get('html_url')})."))
        if age is not None and age > max_h:
            problems.append(("overdue:" + wf, f"{name} hasn't run for {int(age)} hours (expected every {max_h if max_h < 48 else max_h // 24} {'hours' if max_h < 48 else 'days'})."))


def check_reports(problems, state):
    for f, (name, max_h) in REPORTS.items():
        r = load(f)
        if r is None:
            continue
        ts = r.get("generated") or max([p.get("date", "") for p in r.get("posts", [])] or [""])
        age = hours_since(ts) if ts and "T" in ts else None
        if age is not None and age > max_h:
            problems.append(("stale:" + f, f"{name}'s report is {int(age)} hours old."))
    # sanity: sudden swings
    cat = load("catalogue-report.json") or {}
    prev = state.get("listings")
    if cat.get("listings"):
        if prev and cat["listings"] < 0.7 * prev:
            problems.append(("collapse:listings", f"Listings fell from {prev:,} to {cat['listings']:,} since the last check: a feed or the deal refresh may have broken."))
        state["listings"] = cat["listings"]
    claims = load("claims-report.json") or {}
    if claims.get("accuracyPct") is not None and claims["accuracyPct"] < 95:
        problems.append(("claims:accuracy", f"Claims accuracy is down to {claims['accuracyPct']}%: check the claims report before approving anything."))
    plan = load("content-plan.json") or {}
    if now().weekday() == 0 and now().hour >= 6:
        monday = now().date().isoformat()
        week = [p for p in plan.get("posts", []) if p.get("date", "") >= monday][:7]
        if plan and len(week) < 5:
            problems.append(("content:thin", f"Only {len(week)} posts are planned for this week (usually 7)."))


def check_pack(problems):
    owner = (os.environ.get("GITHUB_REPOSITORY") or "/").split("/")[0]
    for pr in gh("GET", f"/pulls?state=open&head={owner}:agent/fix-pack") or []:
        files = [f["filename"] for f in gh("GET", f"/pulls/{pr['number']}/files?per_page=100") or []]
        allowed = lambda f: any(f == a or f.startswith(a.rstrip("/") + "/") for a in PACK_FILES)
        outside = [f for f in files if not allowed(f)]
        lines = (pr.get("body") or "").count("- [ ] skip") + (pr.get("body") or "").count("- [x] skip")
        why = []
        if outside:
            why.append("it changes files the agents aren't allowed to touch: " + ", ".join(outside[:8]))
        if len(files) > MAX_PACK_FILES and not all(f.startswith(("societies/days/", "prices/occasions/")) for f in files[MAX_PACK_FILES:]):
            why.append(f"it changes {len(files)} files, far more than usual")
        if lines > MAX_PACK_LINES:
            why.append(f"it has {lines} fixes, far more than usual")
        if why:
            gh("POST", "/labels", {"name": "do-not-merge", "color": "b60205", "description": "The watchdog found a problem with this pack"})
            gh("POST", f"/issues/{pr['number']}/labels", {"labels": ["do-not-merge"]})
            gh("POST", f"/issues/{pr['number']}/comments", {"body": "⚠️ **Watchdog: please don't merge this pack yet.** " + "; ".join(why)
                                                            + ". An agent may have misbehaved. Close this pull request; tomorrow's pack starts fresh."})
            problems.append(("pack:" + str(pr["number"]), f"Today's Fix pack was blocked: {'; '.join(why)}."))


def heartbeat(n):
    key = os.environ.get("ALERTS_SECRET")
    if key:
        s, _, _ = http(f"{WORKER}/wd/beat", method="POST", body={"note": f"{n} problem(s)"}, headers={"x-agent-key": key})
        return s == 200
    return False


def update_issue(problems):
    title = "Agent health"
    gh("POST", "/labels", {"name": "agent-health", "color": "0e8a16", "description": "The watchdog's live status"})
    found = gh("GET", "/issues?state=all&labels=agent-health&per_page=5") or []
    issue = found[0] if found else None
    stamp = now().strftime("%a %d %b %H:%M UTC")
    if problems:
        body = f"**{len(problems)} thing(s) need a look** (checked {stamp}):\n\n" + "\n".join(f"- {t}" for _, t in problems) + \
               "\n\nThis issue closes itself once everything is healthy again."
        if issue:
            gh("PATCH", f"/issues/{issue['number']}", {"body": body, "state": "open", "title": title})
        else:
            gh("POST", "/issues", {"title": title, "body": body, "labels": ["agent-health"]})
    elif issue and issue.get("state") == "open":
        gh("PATCH", f"/issues/{issue['number']}", {"body": f"All agents healthy (checked {stamp}).", "state": "closed"})


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    state = load("watchdog-state.json") or {"known": [], "listings": None}
    problems = []
    check_runs(problems)
    check_reports(problems, state)
    check_pack(problems)
    beat = heartbeat(len(problems))
    keys = [k for k, _ in problems]
    new = [t for k, t in problems if k not in state.get("known", [])]
    if new:
        email_owner(f"GolfPrice AI · watchdog: {len(new)} new problem(s)",
                    "<ul>" + "".join(f"<li>{t}</li>" for t in new) + "</ul><p>Live status: the \"Agent health\" issue on GitHub.</p>")
    changed = sorted(keys) != sorted(state.get("known", [])) or not (OUT / "watchdog-state.json").exists()
    state["known"] = keys
    (OUT / "watchdog-state.json").write_text(json.dumps(state), encoding="utf-8")
    if changed:  # the workflow only commits when the list of problems changes, not every 3 hours
        open("/tmp/watchdog-changed", "w").write("1")
    update_issue(problems)
    save_report("watchdog-report.json", {"about": "Watchdog: did every agent run, is its output fresh and sane, and is the Fix pack within bounds.",
                                         "problems": [t for _, t in problems], "heartbeatSent": beat,
                                         "status": "ok" if not problems else "attention"})
    print(json.dumps({"problems": len(problems), "new": len(new), "heartbeat": beat}))


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    main()
