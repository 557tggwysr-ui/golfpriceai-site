"""Fix pack: turns what the agents find into fixes the owner approves.

Daily (.github/workflows/agent-fixes.yml):
  propose  reads the catalogue findings and the revenue report, works out a
           fix for each problem it is confident about, and writes them into
           data/agent-rules.json on a branch, then opens (or refreshes) ONE
           pull request: "Fix pack: <date>". Nothing changes on the site yet.
  approve  runs when the owner merges that pull request. Any fix ticked
           "skip" in the description is taken back out, the fix log is
           updated, and a deal refresh starts so the fixes go live within
           minutes.

The improvement loop:
  * Every fix is logged (data/agents/fix-log.json) with when it was approved.
  * Hidden listings come back when their rule expires, so the agents check
    them again. If the same problem returns, the next hide lasts longer
    (3 days, then 14, then 60).
  * Rules for products that left every feed 30+ days ago are proposed for
    removal, so the rules file never fills up with dead entries.
  * The catalogue check runs after every refresh. Its report shows whether
    each approved fix actually cleared the problem.

Confidence: only clear-cut problems are proposed. A suspect price must fail
both checks (way below the same model elsewhere AND way below its own price
history), and must currently set a page's "from" price. Misfiled products
are only re-filed where the right category is obvious from the name.
"""
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (ROOT, OUT, PACK_FILES, products, http, now)

RULES = ROOT / "data" / "agent-rules.json"
LOG = OUT / "fix-log.json"
BRANCH = "agent/fix-pack"
MAX_PER_PACK = 60
HIDE_STEPS = [3, 14, 60]

APPAREL = re.compile(r"\b(neck warmer|snood|cap|hat|beanie|glove|jacket|gilet|socks?)\b", re.I)
ACCESSORY = re.compile(r"\b(pencils?|gripper|grips?|tape|mirror|practice aid|training aid|headcover|towel|umbrella|tees?|"
                       r"marker|butler|brush|alignment|gymsack|gym sack)\b", re.I)


def load_json(p, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def key(p):
    return f"{p.get('source')}|{p.get('name')}"


def target_category(name):
    if APPAREL.search(name):
        return "apparel"
    if ACCESSORY.search(name):
        return "accessories"
    return None  # not obvious (e.g. "shaft irons"): left for the owner


REPORTS = ["data/agents/answers-report.json", "data/agents/linker-state.json"]


def save_reports_to_main():
    """Reports and state from this run go straight to main (they don't change the site)."""
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    git("config", "user.name", "golfpriceai-bot")
    git("config", "user.email", "bot@users.noreply.github.com")
    for f in REPORTS:
        if (ROOT / f).exists():
            git("add", f)
    if git("diff", "--cached", "--quiet", check=False).returncode != 0:
        git("commit", "-m", "Agent: answers and linker reports")
        git("pull", "--rebase", "--autostash", check=False)
        git("push", "origin", "HEAD:main", check=False)


def propose():
    save_reports_to_main()
    findings = load_json(OUT / "catalogue-findings.json", {})
    revenue = load_json(OUT / "revenue-report.json", {})
    rules = load_json(RULES, {})
    log = load_json(LOG, {"fixes": []})
    by_id = {p["id"]: p for p in products()}
    today = now().date()
    new = {"hide": {}, "category": {}, "condition": {}}
    lines = []

    def times_hidden(k):
        return sum(1 for f in log["fixes"] if f["kind"] == "hide" and f["key"] == k)

    # 1. wrong prices showing on a page
    for q in findings.get("suspect", []):
        p = by_id.get(q["id"])
        if not p or not q.get("shownAsLowest") or not q.get("both"):
            continue
        k = key(p)
        if k in (rules.get("hide") or {}):
            continue
        days = HIDE_STEPS[min(times_hidden(k), len(HIDE_STEPS) - 1)]
        new["hide"][k] = {"reason": f"price looks wrong: £{q['price']:.2f}, {q['reason']}", "until": str(today + timedelta(days=days)),
                          "page": f"/prices/{q['model']}/"}
        lines.append(("hide", k, f"Hide **{p['name']}** at £{q['price']:.2f} for {days} days. It's setting the price on /prices/{q['model']}/ but {q['reason']}."))
    # 2. buy links that don't land on the product
    for f in revenue.get("landingProblems", []):
        p = by_id.get(f.get("id"))
        if not p or f.get("problem") in ("could not connect",):
            continue  # a blip, not a broken link
        k = key(p)
        if k in (rules.get("hide") or {}) or k in new["hide"]:
            continue
        days = HIDE_STEPS[min(times_hidden(k), len(HIDE_STEPS) - 1)]
        new["hide"][k] = {"reason": f"buy link {f['problem']}", "until": str(today + timedelta(days=days))}
        lines.append(("hide", k, f"Hide **{p['name']}** for {days} days: its buy link {f['problem']}."))
    # 3. products filed in the wrong category
    for m in findings.get("misfiled", []):
        to = target_category(m["name"])
        if not to:
            continue
        for i in m.get("_ids", []):
            p = by_id.get(i)
            if not p or p.get("category") == to:
                continue
            k = key(p)
            if k in (rules.get("category") or {}):
                continue
            new["category"][k] = {"to": to, "reason": f"filed as {m['filedAs']}: it's not a club", "page": m["page"]}
        if any(by_id.get(i) and key(by_id[i]) in new["category"] for i in m.get("_ids", [])):
            lines.append(("category", m["page"], f"Re-file **{m['name']}** as {to} (it's filed as a {m['filedAs']}). Its club page {m['page']} goes."))
    # 4. second-hand stock outside Preowned
    for u in findings.get("used", []):
        p = by_id.get(u["id"])
        if not p:
            continue
        k = key(p)
        if k in (rules.get("condition") or {}):
            continue
        new["condition"][k] = {"to": "Used", "reason": "second-hand listing missing its condition"}
        lines.append(("condition", k, f"Move **{p['name']}** into Preowned and trade-ins (it's second-hand)."))
    # 5. housekeeping: rules for products gone from every feed
    live = {key(p) for p in by_id.values()}
    stale = []
    for kind in ("category", "condition"):
        for k, v in (rules.get(kind) or {}).items():
            first = v.get("approved") or str(today)
            if k not in live and date.fromisoformat(first) < today - timedelta(days=30):
                stale.append((kind, k))
    for kind, k in stale:
        lines.append(("remove", k, f"Tidy up: remove the old {kind} fix for **{k.split('|', 1)[1]}** (no longer in any feed)."))

    # notes from the other agents for files they changed (internal links, llms.txt...)
    for n in load_json(OUT / "pack-notes.json", []):
        lines.append(("file", n["path"], n["text"]))
    lines = lines[:MAX_PER_PACK]
    if not lines:
        print("nothing to fix today")
        close_open_pack("Nothing needs fixing today.")
        return
    # write the proposal on the fix-pack branch
    merged = {kind: dict(rules.get(kind) or {}) for kind in ("hide", "category", "condition")}
    keep = {(kind, k) for kind, k, _ in lines}
    for kind in ("hide", "category", "condition"):
        for k, v in new[kind].items():
            if (kind, k) in keep or (kind == "category" and ("category", v.get("page")) in keep):
                merged[kind][k] = {**v, "proposed": str(today)}
    for kind, k in stale:
        merged[kind].pop(k, None)
    # drop expired hides so the file stays small
    merged["hide"] = {k: v for k, v in merged["hide"].items() if v.get("until", "9999") >= str(today)}
    merged["_about"] = "Fixes approved through the daily Fix pack. See scripts/agent_rules.py. Delete a line to undo it."
    body = pack_body(lines, today)
    open_pack(merged, body, today, len(lines))


def pack_body(lines, today):
    out = [f"**{len(lines)} fixes** found by the agents. **Merge this pull request to approve them.** "
           "They go live within minutes. Nothing changes until you merge.\n",
           "To leave one out, tick its *skip* box before merging. To undo a fix later, delete its line in "
           "`data/agent-rules.json` (or revert this pull request).\n"]
    labels = {"hide": "Hide a listing", "category": "Re-file a product", "condition": "Move to Preowned", "remove": "Tidy up",
              "file": "Site improvements"}
    for kind in ("hide", "category", "condition", "remove", "file"):
        group = [l for l in lines if l[0] == kind]
        if not group:
            continue
        out.append(f"\n### {labels[kind]} ({len(group)})")
        for n, (_, k, text) in enumerate(group, 1):
            ref = f"{ {'hide': 'H', 'category': 'R', 'condition': 'P', 'remove': 'T', 'file': 'S'}[kind] }{n}"
            out.append(f"- [ ] skip {ref} · {text}  <!-- key: {kind}::{k} -->")
    out.append("\n_Made by the GolfPrice AI agents. Close this pull request without merging to reject the whole pack._")
    return "\n".join(out)


def git(*args, check=True):
    return subprocess.run(["git", *args], cwd=ROOT, check=check, capture_output=True, text=True)


def gh(method, path, body=None):
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if os.environ.get("GITHUB_ACTIONS") != "true" or not tok or not repo:
        print("(not in GitHub Actions: pull request step skipped)")
        return None
    s, _, txt = http(f"https://api.github.com/repos/{repo}{path}", method=method, body=body,
                     headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
    if s >= 300:
        print("github", method, path, s, txt[:300])
    try:
        return json.loads(txt) if txt else None
    except ValueError:
        return None


def open_pack(merged, body, today, n):
    if os.environ.get("GITHUB_ACTIONS") != "true":  # local dry run: never touch git
        RULES.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(body)
        return
    git("config", "user.name", "golfpriceai-bot")
    git("config", "user.email", "bot@users.noreply.github.com")
    git("checkout", "-B", BRANCH)
    RULES.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    for f in PACK_FILES:
        if (ROOT / f).exists():
            git("add", f)
    if git("diff", "--cached", "--quiet", check=False).returncode == 0:
        print("no changes to propose"); return
    git("commit", "-m", f"Fix pack: {n} fixes ({today})")
    git("push", "--force", "origin", BRANCH)
    repo_owner = os.environ["GITHUB_REPOSITORY"].split("/")[0]
    found = gh("GET", f"/pulls?state=open&head={repo_owner}:{BRANCH}") or []
    title = f"Fix pack: {n} fixes ({today.day} {today.strftime('%b')})"
    if found:
        gh("PATCH", f"/pulls/{found[0]['number']}", {"title": title, "body": body})
    else:
        gh("POST", "/labels", {"name": "fix-pack", "color": "e3b23c", "description": "Agent fixes awaiting approval"})
        pr = gh("POST", "/pulls", {"title": title, "head": BRANCH, "base": "main", "body": body})
        if pr and pr.get("number"):
            gh("POST", f"/issues/{pr['number']}/labels", {"labels": ["fix-pack"]})


def close_open_pack(note):
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    owner = os.environ["GITHUB_REPOSITORY"].split("/")[0]
    for pr in gh("GET", f"/pulls?state=open&head={owner}:{BRANCH}") or []:
        gh("POST", f"/issues/{pr['number']}/comments", {"body": note + " Closing this pack."})
        gh("PATCH", f"/pulls/{pr['number']}", {"state": "closed"})


def approve():
    """After the owner merges a fix pack: take out skipped fixes, log the rest."""
    body = os.environ.get("PR_BODY", "")
    skipped = re.findall(r"- \[[xX]\] skip [A-Z]\d+ .*?<!-- key: (\w+)::(.+?) -->", body)
    rules = load_json(RULES, {})
    for kind, k in skipped:
        if kind == "file":  # put the whole file back as it was before this pack
            prev = git("show", f"HEAD~1:{k}", check=False)
            if prev.returncode == 0:
                (ROOT / k).write_text(prev.stdout, encoding="utf-8")
            elif (ROOT / k).exists():
                (ROOT / k).unlink()
            continue
        if kind == "category":  # one line per product page: drop every listing on that page
            rules["category"] = {x: v for x, v in (rules.get("category") or {}).items() if v.get("page") != k}
        elif kind in rules:
            rules[kind].pop(k, None)
    log = load_json(LOG, {"fixes": []})
    today = str(now().date())
    approved = re.findall(r"- \[ \] skip [A-Z]\d+ .*?<!-- key: (\w+)::(.+?) -->", body)
    for kind, k in approved:
        for x, v in (rules.get(kind) or {}).items() if kind in ("hide", "category", "condition") else []:
            if x == k or v.get("page") == k:
                v.setdefault("approved", today)
        log["fixes"].append({"kind": kind, "key": k, "approved": today})
    log["fixes"] = log["fixes"][-3000:]
    RULES.write_text(json.dumps(rules, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    LOG.write_text(json.dumps(log, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"approved {len(approved)}, skipped {len(skipped)}")


if __name__ == "__main__":
    {"propose": propose, "approve": approve}[(sys.argv[1] if len(sys.argv) > 1 else "propose")]()
