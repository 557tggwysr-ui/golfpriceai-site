"""Polls (built with every price run, called from society.build).

/play/poll/       start a quick poll for any golf group, and vote on one (?p=<id>).
                  The page is public and indexed; a poll itself only shows with its link.
/societies/poll/  a society's poll (?p=<id>), or start one (?new=1&s=<society>). Not indexed.

Both are filled by js/poll.js from the alerts worker (/pl/...). Nicknames only.
"""
from price_pages import SITE, _write, breadcrumb, page_shell

CSS = '<link rel="stylesheet" href="/css/society.css?v=20261101f">\n<link rel="stylesheet" href="/css/poll.css?v=20261101a">\n'
JS = '<script src="/js/poll.js?v=20261101b" defer></script>'
FAQS = [
    ("Is it free?", "Yes. No sign-up, no app and no fees. Start a poll, send one link to the group chat, and everyone answers in one tap."),
    ("What can we vote on?", "Anything with options: where to play next, the trip, the format, the end-of-season do. Or use “Find a date” and everyone ticks yes, maybe or no for each day, so you can see which day works for most of the group."),
    ("Who can see the answers?", "Anyone with the link. You choose whether it shows who voted for what, or just the totals. Nicknames only."),
    ("Can people add their own option?", "Yes, if you allow it when you start the poll. Course options can be picked from every UK golf course."),
    ("Run a golf society?", "Society HQ has polls built in: members vote with their society nickname, you see who still has to answer and can nudge them, and the winning course or date becomes a fixture in one tap."),
]


def quick_page():
    url = f"{SITE}/play/poll/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("The Clubhouse", "/play/"), ("Golf group poll", None)])
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "GolfPrice AI group poll",
           "alternateName": ["Golf society poll", "Golf group date poll", "Which course next poll"], "url": url,
           "applicationCategory": "SportsApplication", "operatingSystem": "Any web browser",
           "description": "A free poll for golf groups and societies: vote on the course, the trip or the format, or find the date that works for most of the four-ball. One link for WhatsApp, one tap to answer, no sign-up.",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}, "isAccessibleForFree": True, "inLanguage": "en-GB",
           "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    faqs = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQS)
    body = f"""<div class="soc-wrap sh-wrap">
{crumbs_html}
<div id="pl" aria-live="polite"><p class="soc-loading">Getting the poll…</p></div>
<noscript><p>Polls need JavaScript switched on.</p></noscript>
<section class="soc-card sh-faq">
  <h2>Free polls for golf groups</h2>
  <p class="soc-help">Where next, which Saturday, what format? Ask the group chat properly: one link, one tap to answer, and a clear result instead of forty messages. Running a society? <a href="/societies/hq/">Society HQ</a> has polls built in, and the winner becomes a fixture.</p>
  {faqs}
</section>
<p class="gp-real">Nicknames only; no money is taken or held by GolfPrice AI. <a href="/legal/privacy-policy.html">Privacy</a> · <a href="/play/scorecard/">Free golf scorecard</a></p>
</div>
{JS}"""
    return page_shell(title="Free Golf Group Poll: Pick a Course or Find a Date | GolfPrice AI",
                      description="A free poll for your golf group or society: vote on the course, trip or format, or find the date that suits most of the four-ball. One WhatsApp link, one tap to answer, no sign-up.",
                      canonical=url, body=body, section="play", schema=[crumbs_schema, app, faq_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def society_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Poll", None)])
    body = f"""<div id="pl" aria-live="polite"><p class="soc-loading" style="padding:24px 16px">Getting the poll…</p></div>
<noscript><p>Polls need JavaScript switched on.</p></noscript>
{JS}"""
    return page_shell(title="Your society’s poll: vote in one tap | Society HQ", description="Your golf society wants your answer. One tap to vote, results live, nicknames only.",
                      canonical=f"{SITE}/societies/poll/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build(root):
    changed = []
    for path, html in [("play/poll/index.html", quick_page()), ("societies/poll/index.html", society_page())]:
        if _write(root / path, html):
            changed.append("/" + path.replace("index.html", ""))
    return changed
