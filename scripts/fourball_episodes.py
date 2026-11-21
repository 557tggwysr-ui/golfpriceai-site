"""The Fourball on the site: an episode page for every aired episode, the series page, and a
"Meet The Fourball" strip on the Fourball Alerts page.

Episodes are made for WhatsApp group chats: each page plays the episode, has a one-tap
"Send to your four-ball" button, and hands over to the matching tool (Fourball Alerts for kit
jokes, the live scorecard for scoring jokes). Runs in the daily Fix pack (agent-fixpack workflow), so every change
waits for John's approval like any other site change.

An episode counts as aired once the content engine has planned it for a date that has passed
(data/agents/content-plan.json posts with series "The Fourball"). --all builds every ready
episode, for previews.
"""
import json
import subprocess
import sys
from datetime import date, timedelta
from html import escape as esc
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from price_pages import page_shell, breadcrumb, SITE  # noqa: E402

OUT = ROOT / "fourball" / "episodes"
MEDIA = ROOT / "assets" / "fourball"
TOOLS = {  # which tool each arc hands over to
    "dave-scorecard": ("/play/scorecard/", "Keep the real score", "The free live scorecard: everyone's score on everyone's phone, no abacus needed."),
    "gaz-driver-count": ("/fourball/", "Before the next new driver", "Fourball Alerts: one link in the group chat, and your whole four-ball hears when the kit you're eyeing genuinely drops."),
}
DEFAULT_TOOL = ("/fourball/", "Your four-ball, one price watch", "Fourball Alerts: one link in the group chat, and everyone hears when the kit you're all eyeing genuinely drops.")
MARK_A, MARK_B = "<!--fourball-episodes-->", "<!--/fourball-episodes-->"


def load(p, d=None):
    try:
        return json.loads((ROOT / p).read_text(encoding="utf-8"))
    except Exception:
        return d


def aired(today, preview=False):
    fb = load("data/fourball.json", {}) or {}
    bank = {(q.get("cover") or {}).get("ep"): q for q in (load("data/social-bank.json", {}) or {}).get("sequences", [])}
    dates = {}
    for p in (load("data/agents/content-plan.json", {}) or {}).get("posts", []):
        # a day early, so Tuesday's Fix pack has the page ready for Wednesday's post
        if p.get("series") == "The Fourball" and p.get("ep") and p.get("date", "9") <= str(today + timedelta(days=1)) and p.get("status") not in ("skipped", "held"):
            dates.setdefault(p["ep"], p["date"])
    out = []
    for e in sorted(fb.get("episodes", []), key=lambda e: e["ep"]):
        when = dates.get(e["ep"]) or (str(today) if preview and e.get("status") == "ready" else None)
        if when and e["ep"] in bank:
            out.append(dict(e, date=when, script=bank[e["ep"]]))
    return out, fb


def render_media(e):
    """The episode's web video (muted, loops) and its cover, made by the same engine as the social post."""
    import random
    sys.path.insert(0, str(ROOT / "scripts"))
    import agent_brush as BR
    import agent_social as S
    import agent_video as V
    MEDIA.mkdir(parents=True, exist_ok=True)
    n = e["ep"]
    mp4, jpg, og = MEDIA / f"ep-{n}.mp4", MEDIA / f"ep-{n}.jpg", MEDIA / f"ep-{n}-share.jpg"
    if mp4.exists() and jpg.exists() and og.exists():
        return True
    r = S.resolve_sequence(e["script"], {"photosUsed": []}, random.Random(n))
    if not r:
        return False
    sc = {k: r[k] for k in ("top", "shots", "lines", "counter", "cover", "end") if k in r}
    cv = r.get("cover") or {}
    sc["outro"] = {"tool": cv.get("tool", "fourball"), "lead": (cv.get("names") or ["Big Dave"])[0]}
    BR.thumbnail(str(jpg), "sequence", sc)
    from PIL import Image
    im = Image.open(jpg).convert("RGB")
    im.resize((720, 1280), Image.LANCZOS).save(jpg, "JPEG", quality=84, optimize=True, progressive=True)
    # the share card (WhatsApp, Facebook, X): the middle of the cover, landscape
    big = Image.open(jpg).convert("RGB").resize((1080, 1920), Image.LANCZOS)
    band = big.crop((0, 700, 1080, 1700)).resize((1200, 1111), Image.LANCZOS)
    card = Image.new("RGB", (1200, 630), (10, 34, 20))
    card.paste(band.crop((0, 240, 1200, 870)), (0, 0))
    card.save(og, "JPEG", quality=84, optimize=True)
    tmp = MEDIA / f"ep-{n}-full.mp4"
    V.render("sequence", sc, "fairway", tmp)
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp), "-vf", "scale=720:-2", "-c:v", "libx264", "-preset", "slow",
                    "-crf", "27", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(mp4)], check=True)
    tmp.unlink(missing_ok=True)
    return True


CSS = """<style>
.fbx-hero{display:grid;gap:18px;align-items:center}
.fbx-kicker{display:inline-block;margin:10px 0 6px;background:#103420;color:#ffd600;font:800 13px Poppins,sans-serif;letter-spacing:.06em;padding:6px 12px;border-radius:999px}
.fbx-cast{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:14px 0}
.fbx-who{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.fbx-who img{width:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.fbx-who b{display:block;font:800 15px Poppins,sans-serif;padding:8px 10px 0}.fbx-who span{display:block;font-size:13px;color:#5b665f;padding:2px 10px 10px}
.fbx-eps{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.fbx-ep{display:block;border-radius:14px;overflow:hidden;background:#103420;color:#fff;text-decoration:none}
.fbx-ep img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block}.fbx-ep span{display:block;padding:8px 10px;font:700 14px Poppins,sans-serif}
.fbx-player{max-width:420px;margin:0 auto}.fbx-player video{width:100%;border-radius:18px;background:#0a2214;display:block}
.fbx-share{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin:14px 0}
.fbx-wa{background:#1f9d55;color:#fff;border:0;border-radius:999px;padding:13px 20px;font:800 16px Poppins,sans-serif;cursor:pointer;text-decoration:none}
.fbx-tool{background:#fff8d6;border:2px solid #ffd600;border-radius:16px;padding:16px;margin:16px 0}
.fbx-tool h2{margin:0 0 6px;font-size:20px}.fbx-nav{display:flex;justify-content:space-between;gap:10px;margin:12px 0}
.fb-meet{margin:18px 0}.fb-meet .fbx-eps{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}
</style>"""

SHARE_JS = """<script>
document.querySelectorAll('[data-fbx-share]').forEach(function (b) {
  b.addEventListener('click', function (ev) {
    var t = b.getAttribute('data-text'), u = b.getAttribute('data-url');
    if (navigator.share) { ev.preventDefault(); navigator.share({ text: t, url: u }).catch(function () {}); }
    if (window.gtag) window.gtag('event', 'fourball_episode_share', { ep: b.getAttribute('data-ep') });
  });
});
</script>"""


def cast_cards(bank):
    faces = {"big-dave": "seq-dave-07-proud.jpg", "phil": "seq-dave-08-mate.jpg", "gaz": "gaz-01-unbox.jpg",
             "kev": "kev-05-pointing.jpg", "steve": None}
    out = []
    for c in bank.get("characters", []):
        f = faces.get(c.get("id"))
        if not f or not (ROOT / "assets/social/library" / f).exists():
            continue
        out.append(f'<div class="fbx-who"><img src="/assets/social/library/{f}" alt="{esc(c["name"])}, a fictional character" loading="lazy"><b>{esc(c["name"])}</b><span>{esc(c.get("role", ""))}</span></div>')
    return "".join(out)


def ep_card(e):
    return (f'<a class="fbx-ep" href="/fourball/episodes/{e["ep"]}/"><img src="/assets/fourball/ep-{e["ep"]}.jpg" alt="" loading="lazy">'
            f'<span>EP {e["ep"]} · {esc(e["title"])}</span></a>')


def build(today, preview=False):
    eps, fb = aired(today, preview)
    eps = [e for e in eps if render_media(e)]
    bank = load("data/social-bank.json", {}) or {}
    pages = []
    for i, e in enumerate(eps):
        n = e["ep"]
        url = f"{SITE}/fourball/episodes/{n}/"
        tool = next((TOOLS[a] for a in e.get("arcs", []) if a in TOOLS), DEFAULT_TOOL)
        cast = ", ".join(c.get("name", "") for c in bank.get("characters", []) if c.get("id") in e.get("cast", []))
        text = f"The Fourball, EP {n}: {e['title']} 😂 Who's the {('Big Dave' if 'big-dave' in e.get('cast', []) else 'Gaz')} in our group?"
        wa = "https://wa.me/?text=" + __import__("urllib.parse").parse.quote(f"{text} {url}?utm_source=fourball&utm_medium=whatsapp&utm_campaign=episode")
        prev_l = f'<a href="/fourball/episodes/{eps[i - 1]["ep"]}/">&larr; EP {eps[i - 1]["ep"]}</a>' if i > 0 else "<span></span>"
        next_l = f'<a href="/fourball/episodes/{eps[i + 1]["ep"]}/">EP {eps[i + 1]["ep"]} &rarr;</a>' if i + 1 < len(eps) else "<span></span>"
        crumbs, crumb_schema = breadcrumb([("Home", "/"), ("Fourball Alerts", "/fourball/"), ("The Fourball", "/fourball/episodes/"), (f"EP {n}", None)])
        body = f"""{CSS}<div class="pp-wrap">{crumbs}
<span class="fbx-kicker">THE FOURBALL · EP {n}</span>
<h1>{esc(e['title'])}</h1>
<p class="pp-small">Starring {esc(cast)}. A new episode every Wednesday. All characters are fictional.</p>
<div class="fbx-player"><video src="/assets/fourball/ep-{n}.mp4" poster="/assets/fourball/ep-{n}.jpg" controls muted loop playsinline preload="metadata"></video></div>
<div class="fbx-share"><a class="fbx-wa" data-fbx-share data-ep="{n}" data-text="{esc(text)}" data-url="{url}" href="{esc(wa)}" target="_blank" rel="noopener">Send to your four-ball</a></div>
<div class="fbx-tool"><h2>{esc(tool[1])}</h2><p>{esc(tool[2])}</p><a class="pp-btn" href="{tool[0]}">Try it free</a></div>
<div class="fbx-nav">{prev_l}<a href="/fourball/episodes/">All episodes</a>{next_l}</div>
</div>{SHARE_JS}"""
        schema = [{"@context": "https://schema.org", "@type": "VideoObject", "name": f"The Fourball, EP {n}: {e['title']}",
                   "description": f"A short golf comedy sketch starring {cast}.", "thumbnailUrl": f"{SITE}/assets/fourball/ep-{n}.jpg",
                   "uploadDate": e["date"], "contentUrl": f"{SITE}/assets/fourball/ep-{n}.mp4"},
                  {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumb_schema}]
        html = page_shell(title=f"The Fourball EP {n}: {e['title']} | GolfPrice AI",
                          description=f"Golf comedy in ten seconds: {e['title']}. Send it to your four-ball group chat. New episode every Wednesday.",
                          canonical=url, body=body, section="tools", schema=schema, noindex=False,
                          og_image=f"/assets/fourball/ep-{n}-share.jpg")
        d = OUT / str(n)
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(html, encoding="utf-8")
        pages.append(f"/fourball/episodes/{n}/")
    # the series page
    crumbs, crumb_schema = breadcrumb([("Home", "/"), ("Fourball Alerts", "/fourball/"), ("The Fourball", None)])
    grid = "".join(ep_card(e) for e in reversed(eps)) or "<p>Episode 1 lands on Wednesday.</p>"
    body = f"""{CSS}<div class="pp-wrap">{crumbs}
<span class="fbx-kicker">NEW EPISODE EVERY WEDNESDAY</span>
<h1>The Fourball</h1>
<p>Our weekly golf comedy in ten seconds or so. Big Dave counts his own strokes, Phil keeps the real score, Gaz buys another driver and Kev can't keep a straight face. Send one to your four-ball: everyone has a Big Dave.</p>
<h2>The cast</h2><div class="fbx-cast">{cast_cards(bank)}</div>
<h2>Episodes</h2><div class="fbx-eps">{grid}</div>
<div class="fbx-tool"><h2>{DEFAULT_TOOL[1]}</h2><p>{DEFAULT_TOOL[2]}</p><a class="pp-btn" href="/fourball/">Try Fourball Alerts</a></div>
<p class="pp-small">All characters and situations are fictional. Photos are AI-generated.</p></div>"""
    html = page_shell(title="The Fourball: weekly golf comedy | GolfPrice AI",
                      description="A ten-second golf comedy every Wednesday: Big Dave, Phil, Gaz, Kev and Steady Steve. Send an episode to your four-ball.",
                      canonical=f"{SITE}/fourball/episodes/", body=body, section="tools",
                      schema=[{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": crumb_schema}], noindex=False,
                      og_image=(f"/assets/fourball/ep-{eps[-1]['ep']}-share.jpg" if eps else None))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "index.html").write_text(html, encoding="utf-8")
    pages.append("/fourball/episodes/")
    # the strip on the Fourball Alerts page
    fp = ROOT / "fourball" / "index.html"
    s = fp.read_text(encoding="utf-8")
    strip = (f'{MARK_A}<section class="pp-block fb-meet" aria-labelledby="fb-meet-h">{CSS}<h2 id="fb-meet-h">Meet The Fourball</h2>'
             f'<p>Our weekly golf comedy. Send an episode to your group chat, then start a four-ball alert while you\'re there.</p>'
             f'<div class="fbx-eps">{"".join(ep_card(e) for e in list(reversed(eps))[:4])}</div>'
             f'<p><a href="/fourball/episodes/">All episodes &rarr;</a></p></section>{MARK_B}') if eps else ""
    if MARK_A in s:
        a, rest = s.split(MARK_A, 1)
        s2 = a + strip + rest.split(MARK_B, 1)[1]
    else:
        s2 = s.replace('<section class="fb-start"', strip + '\n<section class="fb-start"', 1) if strip else s
    if s2 != s:
        fp.write_text(s2, encoding="utf-8")
    try:
        from agent_common import register_pages, pack_note
        if register_pages(pages):
            pack_note("data/agent-pages.json", "The Fourball episode pages added to the sitemap.")
        if eps:
            pack_note("fourball/episodes", f"The Fourball: {len(eps)} episode page(s), latest EP {eps[-1]['ep']} ({eps[-1]['title']}).")
    except Exception:
        pass
    return pages


if __name__ == "__main__":
    print(build(date.today(), preview="--all" in sys.argv))
