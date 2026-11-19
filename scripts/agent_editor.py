"""Editor: the quality gate for everything the agents put in front of people.

Two layers:
  1. Rule checks (this file, free, every run). Called by the Fix pack before the
     pull request opens, by the content planner before a post can be approved,
     by the performance analyst for button wording, and by the press desk.
  2. Claude's judgement (.github/workflows/agent-editor.yml): reads each Fix pack
     pull request and the weekly content pack against .github/EDITOR.md, comments,
     and adds the "do-not-merge" label if something would make the site look silly.
     Needs CLAUDE_CODE_OAUTH_TOKEN; skipped quietly without it.

House rules checked here
  * No retailer names in marketing copy (captions, emails, press, buttons):
    "multiple UK retailers" instead.
  * No fake urgency, countdowns, scarcity or "was" prices.
  * Nothing political or tragic.
  * No broken placeholders: {name}, None, nan, undefined, £0.
  * UK spelling.
  * Pages: one H1, title and description lengths, image alt text.

Usage
  python3 scripts/agent_editor.py               # check files changed in the working tree (Fix pack)
  python3 scripts/agent_editor.py --text "..."  # check one piece of copy
"""
import html
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import ROOT, OUT, save_report

# Shop names that are not also golf brands (Callaway, Payntr etc. are brands, so allowed).
RETAILERS = re.compile(r"\b(affordable ?golf|clarkes(?: ?golf)?|click ?golf|major ?golf|scottsdale(?: ?golf)?|american ?golf|"
                       r"direct ?golf|golf ?support|golfonline|county ?golf|foremost ?golf|amazon|ebay|callaway ?pre-?owned|"
                       r"golfgear ?direct|uk ?golf ?gear|function18|onlinegolf|online ?golf)\b", re.I)
URGENCY = re.compile(r"\b(hurry|last chance|ends? (?:soon|tonight|today|midnight)|today only|limited time|act now|don'?t miss|"
                     r"only \d+ left|selling fast|before (?:it'?s|they'?re) gone|countdown|while stocks? last|once in a lifetime|"
                     r"flash sale|never been cheaper|lowest ever)\b|\bwas £[\d,.]+\s*(?:,|/|→|->|-|–)?\s*(?:now\s*)?£|\brrp £?\d[^.]*\bnow £", re.I)
UNSAFE = re.compile(r"\b(died|dies|death|killed|tragic|tragedy|funeral|war|terror\w*|attack|election|vote|voting|minister|"
                    r"government|brexit|tory|tories|labour party|reform uk|trump|biden|starmer|immigra\w*|refugee\w*)\b", re.I)
PLACEHOLDER = re.compile(r"\{[a-z_][a-z0-9_]*\}|\bNone\b(?! (?:of|at|in|for|this|that|yet|so)\b)(?! [a-z])|\bnan\b|\bNaN\b|\bundefined\b|\bnull\b|£0(?:\.00)?\b(?![.\d])|\[object Object\]|\bTODO\b|\bXXX\b|lorem ipsum")
NEGATED = re.compile(r"\b(no|not|never|without|nor|zero|avoid|won'?t|don'?t use)\b[^.!?]*$", re.I)
US_UK = {"color": "colour", "colors": "colours", "favorite": "favourite", "favorites": "favourites", "center": "centre",
         "gray": "grey", "organize": "organise", "organized": "organised", "personalized": "personalised", "realize": "realise",
         "analyze": "analyse", "catalog": "catalogue", "jewelry": "jewellery", "mom": "mum", "vacation": "holiday",
         "pants": "trousers", "sneakers": "trainers", "fall season": "autumn", "license": "licence (noun)", "practise": None}


def _visible(s):
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def check_text(text, where="copy", marketing=True):
    """Problems in one piece of copy, as short sentences. Empty list = fine."""
    t = text or ""
    probs = []
    if marketing:
        m = RETAILERS.search(t)
        if m:
            probs.append(f"{where}: names a retailer (\"{m.group(0)}\"). Say \"multiple UK retailers\".")
    for m in URGENCY.finditer(t):
        if NEGATED.search(t[max(0, m.start() - 30):m.start()]):
            continue  # "no countdown timers", "never fake urgency"
        probs.append(f"{where}: urgency or \"was\" wording (\"{m.group(0)}\").")
        break
    m = UNSAFE.search(t)
    if m:
        probs.append(f"{where}: political or tragic subject (\"{m.group(0)}\").")
    for m in PLACEHOLDER.finditer(t.replace("{price}", "£49.99")):
        if m.group(0).startswith("{") and t[max(0, m.start() - 1):m.start()] == "/":
            continue  # a URL pattern such as /prices/{model_id}/
        probs.append(f"{where}: broken placeholder (\"{m.group(0)}\").")
        break
    for us, uk in (US_UK.items() if marketing else ()):
        if uk and re.search(rf"\b{re.escape(us)}\b", t, re.I):
            probs.append(f"{where}: US spelling \"{us}\" (use \"{uk}\").")
            break
    if re.search(r"!{2,}|\?{2,}", t):
        probs.append(f"{where}: doubled punctuation.")
    return probs


def check_page(path, s):
    """Structural checks for an HTML page an agent built or changed."""
    probs = []
    title = re.search(r"(?is)<title>(.*?)</title>", s)
    desc = re.search(r'(?is)<meta\s+name="description"\s+content="([^"]*)"', s)
    h1 = re.findall(r"(?is)<h1\b", s)
    if not title or not title.group(1).strip():
        probs.append(f"{path}: no title.")
    elif not 15 <= len(html.unescape(title.group(1).strip())) <= 70:
        probs.append(f"{path}: title is {len(title.group(1).strip())} characters (aim for 15 to 70).")
    if not desc:
        probs.append(f"{path}: no meta description.")
    elif not 50 <= len(html.unescape(desc.group(1))) <= 165:
        probs.append(f"{path}: description is {len(desc.group(1))} characters (aim for 50 to 165).")
    if len(h1) != 1:
        probs.append(f"{path}: {len(h1)} H1 headings (should be exactly one).")
    for img in re.findall(r"(?is)<img\b[^>]*>", s):
        if not re.search(r'\balt=', img) and 'aria-hidden="true"' not in img and 'role="presentation"' not in img:
            probs.append(f"{path}: an image has no alt text.")
            break
    probs += check_text(_visible(s), where=path, marketing=False)
    return probs


def check_json_copy(path, s):
    """Copy inside agent JSON files (moderation, experiments, tuning...): text values only."""
    probs = []
    try:
        d = json.loads(s)
    except ValueError as e:
        return [f"{path}: not valid JSON ({e})."]

    def walk(x, k=""):
        if isinstance(x, dict):
            for kk, v in x.items():
                if not kk.startswith("_") and kk not in ("about", "history", "_scores"):
                    walk(v, kk)
        elif isinstance(x, list):
            for v in x:
                walk(v, k)
        elif isinstance(x, str) and k in ("default", "b", "text", "title", "subject", "line", "headline", "sub", "caption", "pitch", "verdict"):
            probs.extend(check_text(x, where=f"{path} ({k})"))
    walk(d)
    return probs


def changed_files():
    r = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all"], cwd=ROOT, capture_output=True, text=True)
    return [line[3:].strip().strip('"') for line in r.stdout.splitlines() if line[3:].strip()]


def check_files(paths):
    out = {}
    for p in paths:
        f = ROOT / p
        if not f.is_file():
            continue
        s = f.read_text(encoding="utf-8", errors="replace")
        if p.endswith(".html") and "/wild-nine/" not in p:
            probs = check_page(p, s)
        elif p.endswith(".json") and not p.startswith("data/agents/"):
            probs = check_json_copy(p, s)
        elif p.endswith((".txt", ".md")):
            probs = check_text(s, where=p, marketing=False)
        else:
            probs = []
        if probs:
            out[p] = probs
    return out


def gate(paths):
    """Fix pack gate: returns (blocked {path: problems}, notes). Blocked files are put back as they were."""
    found = check_files(paths)
    blocked = {}
    for p, probs in found.items():
        serious = [x for x in probs if "names a retailer" in x or "urgency" in x or "political" in x or "placeholder" in x or "not valid JSON" in x]
        if serious:
            blocked[p] = serious + [x for x in probs if x not in serious]
    save_report("editor-findings.json", {
        "about": "Editor: rule checks on everything the agents changed today. Serious problems hold the file back; the rest are notes.",
        "held": blocked, "notes": {p: v for p, v in found.items() if p not in blocked},
    })
    return blocked, {p: v for p, v in found.items() if p not in blocked}


def dump_posts():
    """The coming week's social posts, for Claude's review."""
    from agent_common import now
    try:
        plan = json.loads((OUT / "content-plan.json").read_text(encoding="utf-8"))
    except Exception:
        plan = {"posts": []}
    today = str(now().date())
    keep = ("id", "date", "theme", "style", "hook", "headline", "sub", "captions", "sound", "editor")
    txt = json.dumps([{k: p.get(k) for k in keep} for p in plan.get("posts", []) if p.get("date", "") >= today],
                     indent=1, ensure_ascii=False)
    print(txt)
    # tell the workflow whether these posts were already reviewed (saves Claude runs)
    import hashlib
    h = hashlib.sha1(txt.encode()).hexdigest()
    try:
        last = json.loads((OUT / "editor-review.json").read_text(encoding="utf-8")).get("postsHash")
    except Exception:
        last = None
    open("/tmp/posts.hash", "w").write(h)
    open("/tmp/posts.same", "w").write("1" if h == last else "0")


def dump_frames(dest):
    """Cards and three frames from each coming video, for Claude to look at (premium visual check)."""
    from agent_common import now
    from datetime import date, timedelta
    d = os.path.abspath(dest)
    os.makedirs(d, exist_ok=True)
    try:
        plan = json.loads((OUT / "content-plan.json").read_text(encoding="utf-8"))
    except Exception:
        plan = {"posts": []}
    today = str(now().date())
    for p in [x for x in plan.get("posts", []) if x.get("date", "") >= today][:10]:
        card = ROOT / str(p.get("card", "")).lstrip("/")
        if card.is_file():
            subprocess.run(["cp", str(card), os.path.join(d, f"{p['id']}-card.jpg")])
        day = date.fromisoformat(p["date"])
        monday = day - timedelta(days=day.weekday())
        vid = os.path.join(d, f"{p['id']}.mp4")
        subprocess.run(["gh", "release", "download", f"pack-{monday}", "-p", f"{p['id']}.mp4", "-O", vid, "--clobber"],
                       cwd=ROOT, capture_output=True)
        if os.path.exists(vid):
            for i, t in enumerate(("1.0", "4.5", "8.0")):
                subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", t, "-i", vid, "-frames:v", "1",
                                "-vf", "scale=540:-1", os.path.join(d, f"{p['id']}-frame{i + 1}.jpg")])
            os.remove(vid)
    print("\n".join(sorted(os.listdir(d))))


def gh(method, path, body=None):
    from agent_common import http
    repo, tok = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if not (repo and tok and os.environ.get("GITHUB_ACTIONS") == "true"):
        print("(not in GitHub Actions: would", method, path, ")")
        return None
    s, _, t = http(f"https://api.github.com/repos/{repo}{path}", method=method, body=body,
                   headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
    return s


def act_on_verdict(path):
    """Turn Claude's verdict into a pull request comment, a label and post holds."""
    from agent_common import now
    try:
        v = json.loads(open(path, encoding="utf-8").read())
    except Exception as e:
        print("verdict unreadable:", e)
        return
    verdict = "block" if str(v.get("verdict", "")).lower() == "block" else "ok"
    points = [str(x) for x in (v.get("points") or [])][:15]
    rep = {"about": "The Editor's last Claude review (house style, facts, tone, premium visuals).",
           "verdict": verdict, "summary": str(v.get("summary", ""))[:300], "points": points, "what": os.environ.get("WHAT", "")}
    try:
        old_rep = json.loads((OUT / "editor-review.json").read_text(encoding="utf-8"))
        rep["postsHash"] = old_rep.get("postsHash")
    except Exception:
        pass
    if os.path.exists("/tmp/posts.hash") and "content" in os.environ.get("WHAT", ""):
        rep["postsHash"] = open("/tmp/posts.hash").read().strip()
    save_report("editor-review.json", rep)
    holds = [str(x) for x in (v.get("holdPosts") or [])]
    if holds:
        f = OUT / "editor-holds.json"
        try:
            old = json.loads(f.read_text(encoding="utf-8")).get("posts", [])
        except Exception:
            old = []
        f.write_text(json.dumps({"about": "Social posts the Editor held back; they won't auto-post.",
                                 "updated": str(now().date()), "posts": sorted(set(old + holds))[-80:]}, indent=1) + "\n", encoding="utf-8")
    pr = os.environ.get("PR")
    if pr:
        head = "⛔ **Editor: please don't merge yet.**" if verdict == "block" else "✅ **Editor: reads well.**"
        body = head + " " + str(v.get("summary", "")) + ("\n\n" + "\n".join("- " + p for p in points) if points else "")
        if verdict == "block":
            body += "\n\nTick the *skip* box for the item(s) above, or close the pack; the agents will try again tomorrow."
            gh("POST", "/labels", {"name": "do-not-merge", "color": "b60205", "description": "A check found a problem with this pack"})
            gh("POST", f"/issues/{pr}/labels", {"labels": ["do-not-merge"]})
        gh("POST", f"/issues/{pr}/comments", {"body": body})
    print("editor verdict:", verdict, len(points), "points,", len(holds), "posts held")


def main():
    if "--posts" in sys.argv:
        return dump_posts()
    if "--frames" in sys.argv:
        return dump_frames(sys.argv[sys.argv.index("--frames") + 1])
    if "--verdict" in sys.argv:
        return act_on_verdict(sys.argv[sys.argv.index("--verdict") + 1])
    if "--text" in sys.argv:
        probs = check_text(sys.argv[sys.argv.index("--text") + 1])
        print("\n".join(probs) or "fine")
        sys.exit(1 if probs else 0)
    blocked, notes = gate(changed_files())
    for p, v in {**blocked, **notes}.items():
        print(("HELD " if p in blocked else "note ") + p + ": " + " | ".join(v))
    print(f"editor: {len(blocked)} held, {len(notes)} with notes")


if __name__ == "__main__":
    main()
