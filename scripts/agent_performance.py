"""Performance analyst: follows each price page from visit to buy click to sale,
spots pages that underperform, and runs one small, honest button-wording test
at a time.

Runs in the daily Fix pack (scripts/agent_fixes.py); the private email goes on
Mondays only.

Sources
  * Worker counts (/demand-counts, ALERTS_SECRET): unique daily visitors per
    price page ("view"), buy clicks ("out") and the button test ("ctaa"/"ctab").
    Buy-click counts never go into a public file.
  * Awin transactions (AWIN_API_TOKEN): js/site.js tags every Awin link with
    clickref=<page slug>[~a|b], so each sale can be traced to the page (and
    button wording) it came from.
  * Search Console (GSC_SERVICE_ACCOUNT_JSON, optional): impressions and
    position per page, to tell "few visitors" apart from "visitors who don't click".

House rules this agent keeps
  * It never touches price ordering, prices, retailers shown or the cheapest
    pick. Only button wording, and only from the approved list below.
  * No urgency, scarcity or "was" wording, ever. The Editor checks every
    wording too.
  * Every change is a Fix pack item (data/experiments.json), approved by merge.

Outputs
  * data/agents/performance.json: page slugs and ideas only, no numbers.
  * data/experiments.json: the running button test (through the Fix pack).
  * Private email to the owner with the numbers.
"""
import json
import math
import os
import re
import sys
from collections import defaultdict
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(__file__))
from agent_common import (DATA, ROOT, models, save_report, email_owner, table, now, http, pack_note)

PUB = os.environ.get("AWIN_PUBLISHER_ID", "2990893")
EXP = DATA / "experiments.json"
WINDOW = 28

# Honest button wordings. {price} is the live lowest price as already shown.
# Add new ones here; the Editor rejects anything with urgency or hype.
CTA_WORDINGS = [
    "Shop from {price}",
    "See it from {price}",
    "Buy from {price}",
    "Go to the shop: {price}",
    "View the {price} offer",
]
MIN_VIEWS_PER_ARM = 300   # unique daily visitors per wording before calling a winner
MIN_DAYS = 14
MAX_DAYS = 42


def worker_rows():
    secret = os.environ.get("ALERTS_SECRET")
    if not secret:
        print("(no ALERTS_SECRET: page counts skipped)")
        return []
    try:
        import alerts
        s, _, t = http(alerts.WORKER_URL + "/demand-counts", headers={"x-demand-key": alerts.sign(secret, "demand-counts")}, timeout=40)
        return json.loads(t).get("rows", []) if s == 200 else []
    except Exception as e:
        print("worker counts failed:", e)
        return []


def awin_sales(start, end):
    """Sales per clickref over the window. Returns {clickref: [sales, commission]} or None."""
    tok = os.environ.get("AWIN_API_TOKEN")
    if not tok:
        print("(no AWIN_API_TOKEN: sales by page skipped)")
        return None
    url = (f"https://api.awin.com/publishers/{PUB}/transactions/?startDate={start}T00:00:00"
           f"&endDate={end}T23:59:59&timezone=Europe/London&dateType=transaction")
    s, _, t = http(url, headers={"Authorization": "Bearer " + tok}, timeout=60)
    if s != 200:
        print("awin transactions:", s)
        return None
    out = defaultdict(lambda: [0, 0.0])
    try:
        for tr in json.loads(t):
            if (tr.get("commissionStatus") or "") == "declined":
                continue
            ref = ((tr.get("clickRefs") or {}).get("clickRef") or "").strip().lower()
            if not ref:
                continue
            out[ref][0] += 1
            out[ref][1] += float((tr.get("commissionAmount") or {}).get("amount") or 0)
    except ValueError:
        return None
    return out


def gsc_pages():
    if not os.environ.get("GSC_SERVICE_ACCOUNT_JSON"):
        return {}
    try:
        import agent_search
        rows = agent_search.fetch_rows() or []
    except Exception as e:
        print("search console skipped:", e)
        return {}
    pages = defaultdict(lambda: [0, 0.0])
    for r in rows:
        page = r["keys"][1]
        if "/prices/" in page:
            slug = page.rstrip("/").rsplit("/", 1)[-1]
            pages[slug][0] += r["impressions"]
            pages[slug][1] += r["position"] * r["impressions"]
    return {k: (v[0], v[1] / v[0] if v[0] else 0) for k, v in pages.items()}


def z_test(c1, n1, c2, n2):
    """Two-proportion z score (b minus a)."""
    if not n1 or not n2:
        return 0.0
    p = (c1 + c2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) or 1e-9
    return (c2 / n2 - c1 / n1) / se


def load_exp():
    try:
        return json.loads(EXP.read_text(encoding="utf-8"))
    except Exception:
        return {"about": "Button-wording test run by the performance analyst. Wording only: prices and their order never change.",
                "cta": {"id": "", "default": "", "b": "", "started": ""}, "history": []}


def save_exp(d, note):
    EXP.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    pack_note("data/experiments.json", note)


def editor_ok(text):
    try:
        import agent_editor
        return not agent_editor.check_text(text, where="button wording")
    except Exception:
        return True


def run_test(cta_rows, today):
    """Start, keep or finish the one running button test. Returns a line for the email."""
    d = load_exp()
    t = d.setdefault("cta", {})
    current = t.get("default") or CTA_WORDINGS[0]
    if not t.get("b"):
        tried = {w for h in d.get("history", []) for w in (h.get("a"), h.get("b"))} | {current}
        nxt = next((w for w in CTA_WORDINGS if w not in tried and editor_ok(w)), None)
        if not nxt:
            return "Button test: every approved wording has been tried; add new ones to CTA_WORDINGS to keep testing."
        t.update({"id": today.strftime("%Y%m%d"), "default": current, "b": nxt, "started": str(today)})
        save_exp(d, f"Start a button-wording test: half of visitors see \"{nxt}\" instead of \"{current}\". Prices and order unchanged.")
        return f"Button test proposed: \"{current}\" vs \"{nxt}\" (starts when you merge the Fix pack)."
    started = t.get("started") or str(today)
    va = sum(n for day, kind, key, n, _ in cta_rows if kind == "ctaa" and key == "views" and day >= started)
    vb = sum(n for day, kind, key, n, _ in cta_rows if kind == "ctab" and key == "views" and day >= started)
    ca = sum(n for day, kind, key, n, _ in cta_rows if kind == "ctaa" and key == "clicks" and day >= started)
    cb = sum(n for day, kind, key, n, _ in cta_rows if kind == "ctab" and key == "clicks" and day >= started)
    days = (today - date.fromisoformat(started)).days
    z = z_test(ca, va, cb, vb)
    line = (f"Button test since {started}: \"{t['default']}\" {ca}/{va} clicks, \"{t['b']}\" {cb}/{vb} clicks "
            f"(z = {z:+.2f}; 1.96 or more is a clear result).")
    enough = va >= MIN_VIEWS_PER_ARM and vb >= MIN_VIEWS_PER_ARM and days >= MIN_DAYS
    if (enough and abs(z) >= 1.96) or days >= MAX_DAYS:
        winner = t["b"] if z >= 1.96 else t["default"]
        d.setdefault("history", []).append({"id": t["id"], "a": t["default"], "b": t["b"], "winner": winner,
                                             "ended": str(today), "result": "clear" if abs(z) >= 1.96 else "no clear difference"})
        t.update({"default": winner, "b": "", "id": "", "started": ""})
        save_exp(d, f"Finish the button test: keep \"{winner}\" ({'clearly more buy clicks' if abs(z) >= 1.96 else 'no clear difference, keeping the current wording'}).")
        line += f" Finishing: keep \"{winner}\"."
    return line


LAB = DATA / "games-lab.json"


def gh(method, path, body=None):
    """GitHub API (only inside GitHub Actions). Returns parsed JSON or None."""
    repo, tok = os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN")
    if not (repo and tok and os.environ.get("GITHUB_ACTIONS") == "true"):
        print("(not in GitHub Actions: would", method, path, ")")
        return None
    s, _, t = http(f"https://api.github.com/repos/{repo}{path}", method=method, body=body,
                   headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
    try:
        return json.loads(t) if 200 <= s < 300 and t else None
    except ValueError:
        return None


def _key():
    import hashlib
    return hashlib.sha256(("lab-scores|" + (os.environ.get("ALERTS_SECRET") or "")).encode()).digest()


def lab_scores(d):
    """Each judged beta's return rate, kept scrambled with ALERTS_SECRET so the public file holds no usage numbers."""
    import base64
    raw = d.get("_scores")
    if not raw or not os.environ.get("ALERTS_SECRET"):
        return {}
    try:
        b = base64.b64decode(raw)
        k = _key()
        return json.loads(bytes(x ^ k[i % len(k)] for i, x in enumerate(b)).decode())
    except Exception:
        return {}


def save_scores(d, scores):
    import base64
    if not os.environ.get("ALERTS_SECRET"):
        return
    b, k = json.dumps(scores).encode(), _key()
    d["_scores"] = base64.b64encode(bytes(x ^ k[i % len(k)] for i, x in enumerate(b))).decode()


def lab_weeks(lab_rows, slug, started, today):
    """Week-by-week player-days, returning player-days and buy clicks since the beta started."""
    out, d0 = [], date.fromisoformat(started)
    w = 0
    while d0 + timedelta(days=7 * w) <= today:
        a, b = str(d0 + timedelta(days=7 * w)), str(d0 + timedelta(days=7 * w + 6))
        sel = [(k, n) for day, k, key, n in lab_rows if key == slug and a <= day <= b]
        p, r, o = (sum(n for k, n in sel if k == kk) for kk in ("gplay", "lret", "gout"))
        out.append((f"Week {w + 1} ({a[5:]})", p, r, f"{r / p:.0%}" if p else "-", o))
        w += 1
    return out


def run_lab(lab_rows, today):
    """Judge each running lab beta. A pass goes into the Fix pack. A beta that misses its pass mark is NEVER
    retired automatically: John gets the data by email and decides in a GitHub issue (retire it, or give it
    4 more weeks), and only then is his choice put into the Fix pack."""
    try:
        d = json.loads(LAB.read_text(encoding="utf-8"))
    except Exception:
        return []
    lines, changed = [], []
    scores = lab_scores(d)  # {slug: return rate} for every beta judged so far (private)
    issues = gh("GET", "/issues?state=open&labels=games-lab&per_page=30") or []
    for g in d.get("games", []):
        if g.get("status") != "running":
            continue
        name, slug, started = g.get("name", g["slug"]), "lab-" + g["slug"], g.get("started") or str(today)
        play = sum(n for day, k, key, n in lab_rows if key == slug and k == "gplay" and day >= started)
        ret = sum(n for day, k, key, n in lab_rows if key == slug and k == "lret" and day >= started)
        out = sum(n for day, k, key, n in lab_rows if key == slug and k == "gout" and day >= started)
        mark = g.get("passMark") or {}
        need, want_ret, want_out = mark.get("minPlayers", 50), mark.get("returnRate", 0.3), mark.get("buyClickRate", 0)
        days = (today - date.fromisoformat(started)).days
        rate, orate = (ret / play if play else 0), (out / play if play else 0)
        lines.append(f"{name}: day {days}, {play} player-days, return rate {rate:.0%} (pass {want_ret:.0%}), "
                     f"buy clicks per player-day {orate:.1%}.")
        issue = next((i for i in issues if f"({g['slug']})" in i.get("title", "")), None)

        # 1) John has an open decision: act on his tick (unless that choice is already live)
        if issue and g.get("extendedUntil") and str(today) < g["extendedUntil"]:
            continue  # extension applied; the issue is closed below
        if issue:
            first = not issue.get("comments")
            body = issue.get("body") or ""
            retire = re.search(r"- \[[xX]\] Retire it", body)
            extend = re.search(r"- \[[xX]\] Give it 4 more weeks", body)
            if retire:
                g.update({"status": "retired", "decided": str(today), "verdict": "Retired by John after reviewing its results."})
                changed.append(f"Games lab: retire {name} (your choice in issue #{issue['number']}).")
                if first:
                    gh("POST", f"/issues/{issue['number']}/comments", {"body": "Got it: retiring it is in today's Fix pack. Merge it to apply."})
                lines[-1] += " You chose: retire (in today's Fix pack)."
            elif extend:
                until = str(today + timedelta(days=28))
                g.update({"extendedUntil": until})
                changed.append(f"Games lab: {name} gets 4 more weeks, until {until} (your choice in issue #{issue['number']}).")
                if first:
                    gh("POST", f"/issues/{issue['number']}/comments", {"body": f"Got it: 4 more weeks, until {until}, is in today's Fix pack. Merge it to apply."})
                lines[-1] += f" You chose: 4 more weeks (until {until})."
            else:
                lines[-1] += f" Waiting for your decision (issue #{issue['number']}). It keeps running meanwhile."
            continue

        # 2) the extension John approved has been applied: close its issue and wait for the new date
        if g.get("extendedUntil") and str(today) < g["extendedUntil"]:
            continue

        # 3) judge it
        ready = (days >= 28 and play >= need) or days >= 56 or (g.get("extendedUntil") and str(today) >= g["extendedUntil"])
        if not ready:
            continue
        # Rule (John, 19 Nov): each beta must beat the best one before it, not just the pass mark.
        others = {k: v for k, v in scores.items() if k != g["slug"]}
        best_before = max(others.values()) if others else 0
        if play >= need:
            scores[g["slug"]] = round(rate, 4)
            g["beatBest"] = rate >= best_before
            g["rankSoFar"] = 1 + sum(1 for v in others.values() if v > rate)
            g["rankOf"] = len(others) + 1
            changed.append(f"Games lab: {name} ranks {g['rankSoFar']} of {g['rankOf']} betas so far"
                           + (" (a new best)." if g["beatBest"] and others else "."))
        if play >= need and rate >= want_ret and orate >= want_out and rate >= best_before:
            g.update({"status": "passed", "decided": str(today),
                      "verdict": "Players came back often enough, and more than for any beta before it: ready to graduate."})
            changed.append(f"Games lab: {name} passed its pass mark and beat every beta before it; ready to graduate.")
            lines[-1] += " Verdict: passed (a new best)."
            save_scores(d, scores)
            continue
        if play >= need and rate >= want_ret and rate < best_before:
            lines[-1] += f" Met its pass mark but didn't beat the best beta so far ({best_before:.0%})."
        why = (f"only {play} player-days in {days} days (it needs {need})" if play < need else
               f"players came back on {rate:.0%} of play days (pass mark {want_ret:.0%}; best beta so far {best_before:.0%})")
        weeks = lab_weeks(lab_rows, slug, started, today)
        fixes = g.get("changes") or []
        email_owner(f"GolfPrice AI · Games lab: your decision on {name}",
                    f"<h2>{name} hasn't beaten the bar yet</h2><p>In beta since {started} ({days} days): {why}. "
                    f"Buy clicks per play day: {orate:.1%}.</p><p><b>Recommendation:</b> "
                    + ("retire it and try the next idea." if play >= need else
                       "it hasn't had enough players to judge fairly. Share golfpriceai.com/play/lab/ with a golf group and give it 4 more weeks.")
                    + "</p><h3>Week by week</h3>" + table(weeks, ["Week", "Player-days", "Came back", "Return rate", "Buy clicks"])
                    + "<h3>Improvements made during the beta</h3>"
                    + ("<ul>" + "".join(f"<li>{c.get('date', '')}: {c.get('what', '')}</li>" for c in fixes) + "</ul>" if fixes else "<p>None yet.</p>")
                    + f"<p>Why we tried it: {g.get('why', '')}</p><p>Decide in the GitHub issue \"Games lab decision: {name}\". "
                      "Nothing is retired until you tick a box; it keeps running meanwhile.</p>")
        gh("POST", "/labels", {"name": "games-lab", "color": "1d76db", "description": "Games lab decisions for John"})
        gh("POST", "/issues", {"title": f"Games lab decision: {name} ({g['slug']})", "labels": ["games-lab"],
                               "body": f"**{name}** has been in beta since {started} and hasn't cleared the bar yet (its pass mark, and beating the best beta before it). "
                                       "The numbers, week by week, and the improvements made are in your email "
                                       "(\"Games lab: your decision\").\n\nTick ONE, and the next daily run puts it in the Fix pack for you to merge:\n\n"
                                       "- [ ] Retire it\n- [ ] Give it 4 more weeks\n\n"
                                       "_Until you decide, it keeps running. Nothing is retired without your tick._"})
        lines[-1] += " Didn't clear the bar: emailed you the data; waiting for your decision."
    # close decision issues whose choice is now live
    for i in issues:
        m = re.search(r"\(([a-z0-9-]+)\)$", i.get("title", ""))
        g = next((x for x in d.get("games", []) if m and x["slug"] == m.group(1)), None)
        if g and (g.get("status") == "retired" or (g.get("extendedUntil") and str(today) < g["extendedUntil"])) \
                and not any(g.get("name", "") in c for c in changed):
            gh("PATCH", f"/issues/{i['number']}", {"state": "closed"})
    if changed:
        save_scores(d, scores)
        LAB.write_text(json.dumps(d, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        pack_note("data/games-lab.json", " ".join(changed))
    return lines


def main():
    today = now().date()
    start = today - timedelta(days=WINDOW)
    rows = worker_rows()
    names = {m["slug"]: m["name"] for m in models()}
    view, out = defaultdict(int), defaultdict(int)
    cta_rows, game_rows = [], []
    ai_apps = defaultdict(int)  # visits sent by each AI app (ChatGPT, Perplexity, Claude...)
    lab_rows = [(d, k, key, n) for d, k, key, n, _ in rows if k in ("gplay", "lret", "gout") and key.startswith("lab-")]
    for day, kind, key, n, s in rows:
        if day < str(start):
            continue
        if kind == "view":
            view[key] += n
        elif kind == "out":
            out[key] += n
        elif kind in ("ctaa", "ctab"):
            cta_rows.append((day, kind, key, n, s))
        if kind == "aisrc":
            ai_apps[key] += n
        if kind in ("gplay", "gview", "gout", "lret"):
            game_rows.append((day, kind, key, n))
    sales_ref = awin_sales(start, today)
    sales = defaultdict(lambda: [0, 0.0])
    game_sales = defaultdict(lambda: [0, 0.0])
    for ref, (n, c) in (sales_ref or {}).items():
        parts = ref.split("~")
        slug = parts[0]
        sales[slug][0] += n
        sales[slug][1] += c
        for part in parts[1:]:
            if part.startswith("g-"):
                game_sales[part[2:]][0] += n
                game_sales[part[2:]][1] += c
    gsc = gsc_pages()

    tot_v, tot_o = sum(view.values()), sum(out.values())
    site_rate = tot_o / tot_v if tot_v else 0
    tot_sales = sum(v[0] for v in sales.values())
    site_conv = tot_sales / tot_o if tot_o else 0  # sales per buy click, site-wide
    ideas, priv = [], []
    for slug in sorted(set(view) | set(out) | set(sales), key=lambda s: -view.get(s, 0)):
        v, o = view.get(slug, 0), out.get(slug, 0)
        sn, comm = sales.get(slug, [0, 0.0])
        rate = o / v if v else 0
        name = names.get(slug, slug)
        idea = None
        if v >= 30 and site_rate and rate < site_rate * 0.5:
            idea = ("few buy clicks", f"Visitors to {name} rarely click through. Check the lowest price is in stock and current, "
                                      "the photo is the right product, and the buy button shows without scrolling on a phone.")
        elif sales_ref is not None and sn == 0 and o >= 20 and o * site_conv >= 3:  # 3+ sales expected, none came
            idea = ("clicks, no sales", f"{name} sends buyers to the shop but none buy. Check the shop page matches (size, "
                                       "condition, price) and that the retailer's programme is live.")
        if idea:
            ideas.append({"type": idea[0], "page": f"/prices/{slug}/", "idea": idea[1]})
        priv.append((name, v, o, f"{rate:.0%}" if v else "-", sn, f"£{comm:,.2f}"))
    # Pages Google shows a lot but that get few visitors: a title or position job for the search engine.
    for slug, (imp, pos) in sorted(gsc.items(), key=lambda x: -x[1][0])[:200]:
        if imp >= 300 and view.get(slug, 0) < imp * 0.01:
            ideas.append({"type": "seen, not visited", "page": f"/prices/{slug}/",
                          "idea": f"Google shows {names.get(slug, slug)} often (around position {round(pos)}) but few people visit: sharpen the title and description."})

    test_line = run_test(cta_rows, today) if rows else "Button test: waiting for page counts (ALERTS_SECRET)."
    games = defaultdict(lambda: {"gplay": 0, "gview": 0, "gout": 0, "lret": 0})
    for day, kind, key, n in game_rows:
        games[key][kind] += n
    game_tab = sorted(((g, v["gplay"], v["gview"], v["gout"], game_sales.get(g, [0, 0.0])[0], f"£{game_sales.get(g, [0, 0.0])[1]:,.2f}")
                       for g, v in games.items()), key=lambda r: (-r[3], -r[1]))
    lab_lines = run_lab(lab_rows, today) if rows else []
    save_report("performance.json", {
        "about": "Performance analyst: pages that could work harder for golfers, ideas only. Never changes prices or their order.",
        "window": f"last {WINDOW} days", "ideas": ideas[:60],
        "counts": {k: sum(1 for i in ideas if i["type"] == k) for k in ("few buy clicks", "clicks, no sales", "seen, not visited")},
        "tracking": "on" if rows else "waiting",
        "gamesBySales": [r[0] for r in game_tab if r[3] or r[4]][:12],
        "aiAppsByVisits": [a for a, _ in sorted(ai_apps.items(), key=lambda x: -x[1])],
    })
    if today.weekday() == 0 or os.environ.get("PERF_EMAIL") == "1":
        sales_note = "" if sales_ref is not None else "<p>(Sales by page start once AWIN_API_TOKEN is set and the new site.js is live.)</p>"
        email_owner("GolfPrice AI · performance report",
                    f"<h2>Price pages, last {WINDOW} days</h2>"
                    f"<p>{tot_v:,} page visits, {tot_o:,} buy clicks ({site_rate:.1%}), {tot_sales:,} tracked sales.</p>{sales_note}"
                    f"<p>{test_line}</p><h3>Top pages</h3>"
                    + table(priv[:30], ["Page", "Visitors", "Buy clicks", "Click rate", "Sales", "Commission"])
                    + "<h3>Visitors sent by AI apps</h3>"
                    + (table(sorted(ai_apps.items(), key=lambda x: -x[1]), ["AI app", "Visits"]) if ai_apps else "<p>None counted yet.</p>")
                    + "<h3>Games: play > price page > buy click</h3>"
                    + (table(game_tab[:15], ["Game", "Players", "Price pages after", "Buy clicks", "Sales", "Commission"]) if game_tab else "<p>No game counts yet.</p>")
                    + ("<h3>Games lab</h3><ul>" + "".join(f"<li>{x}</li>" for x in lab_lines) + "</ul>" if lab_lines else "")
                    + "<h3>Ideas</h3><ul>" + "".join(f"<li><b>{i['type']}</b>: {i['idea']}</li>" for i in ideas[:15]) + "</ul>")
    print(f"performance: {len(ideas)} ideas; {test_line}")


if __name__ == "__main__":
    main()
