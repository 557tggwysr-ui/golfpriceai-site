"""Fourball Alerts pages (built every 6 hours by price_pages.build, so the
header and footer always match the rest of the site).

  /fourball/        The tool page: what Fourball Alerts are and how to start one.
  /fourball/list/   A shared four-ball shortlist (?for=Name&i=slug,slug&c=code),
                    or your own shortlist when there's no ?i=. Filled in by
                    js/fourball.js from each model's /prices/<slug>/data.json.

Fourball Alerts: one golfer sends a price page (or a shortlist) to the group
chat, each mate adds their own email, and everyone gets one email when the
price genuinely drops. We never see the mates' details; the alerts worker only
counts how many joined through each invite (see workers/alerts-worker.js)."""
import json

from price_pages import (FOURBALL_CSS, ICON_GROUP, PRICES_DIR, SITE, _write, breadcrumb, esc, page_shell)
import site_chrome

ROOT = PRICES_DIR.parent
PHOTO = "/assets/photos/tools/fourball-wide.jpg"
CARD = "/assets/cards/fourball.jpg"

FAQ = [
    ("What is a Fourball Alert?",
     "A price alert you share with the people you play with. Send one link to your four-ball or golf society "
     "WhatsApp group; each person who wants it adds their own email, and everyone gets one email when the price "
     "genuinely drops (by at least £5 or 3%, whichever is bigger)."),
    ("Do my mates need an account or an app?",
     "No. They tap the link, add their email and confirm it once. That's it. Every alert email has a one-click "
     "link to stop it."),
    ("Do you see who I send it to?",
     "No. The link goes through your own WhatsApp or share menu, so we never see or store your mates' names or "
     "numbers. We only count how many people joined through your invite, so you can see it's working, and we "
     "don't tell you who."),
    ("Can I send more than one item?",
     "Yes. Tap the heart on any price page to add it to your four-ball shortlist (up to six items), then send the "
     "whole list. Your mates can watch everything on it with one email."),
    ("Does it work for a golf society?",
     "That's what it's best at. Before the club trip or the winter kit-up, send a shortlist to the society group "
     "and let everyone watch the prices together."),
    ("What does it cost?",
     "Nothing. GolfPrice AI is reader-supported: if you buy through our links we may earn a commission, at no "
     "extra cost to you. It never changes the price or the alerts."),
]


def tool_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Deal Tools", "/deal-tools.html"), ("Fourball Alerts", None)])
    steps = [
        ("Pick it", "Search a driver, ball, trolley or anything else we track, or tap the heart on a few to make a shortlist."),
        ("Send it", "Tap “Send to my four-ball”. It opens WhatsApp (or your share menu) with the link and photo ready to go."),
        ("Everyone’s watching", "Each mate adds their own email. When the price genuinely drops, everyone gets one email."),
    ]
    steps_html = "".join(f'<li><span class="fb-step-n">{i}</span><span><b>{esc(t)}</b><span>{esc(d)}</span></span></li>'
                         for i, (t, d) in enumerate(steps, 1))
    faq_html = "".join(f'<details class="pp-card fb-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in FAQ)
    search = site_chrome._search_form("fb-search", placeholder="e.g. Pro V1, Qi35 driver, trolley", extra_class="fb-search")
    body = f"""<div class="pp-wrap" id="fb-tool">
{crumbs_html}
<section class="fb-hero">
  <div class="fb-hero-copy">
    <span class="fb-kicker">Deal Tools · Only on GolfPrice AI</span>
    <h1>Fourball Alerts</h1>
    <p class="fb-lede">Price alerts for your whole four-ball. One link in the group chat, and everyone hears when the kit you’re all eyeing genuinely drops.</p>
    <ol class="fb-steps">{steps_html}</ol>
  </div>
  <div class="fb-hero-photo"><img src="{PHOTO}" alt="Four golfers laughing at a phone on an autumn course at sunset" width="1200" height="800"></div>
</section>
<section class="fb-start" aria-labelledby="fb-start-h">
  <h2 id="fb-start-h">Start a four-ball alert</h2>
  <p>Find the item, then tap “Send to my four-ball” on its price page.</p>
  {search}
  <p class="fb-my-list" hidden>You have <b></b> on your shortlist. <a href="/fourball/list/">See it and send it →</a></p>
</section>
<section class="fb-stats" aria-label="At a glance">
  <div class="fb-stat fb-total" hidden><b></b><span>golfers joined through a mate’s invite</span></div>
  <div class="fb-stat"><b>Free</b><span>no app, no account</span></div>
  <div class="fb-stat"><b>6 hours</b><span>how often we check prices across multiple UK retailers</span></div>
  <div class="fb-stat"><b>0</b><span>of your mates’ details we see or store</span></div>
</section>
<section class="pp-block fb-society">
  <div class="pp-card fb-society-card">
    <div class="fb-invite-top">{ICON_GROUP}<h2>Running a golf society?</h2></div>
    <p>Before the club trip or the winter kit-up, heart a few bits on their price pages, send the shortlist to the group, and let everyone watch the prices together. Nobody has to chase anybody.</p>
    <a class="pp-btn pp-btn-alt" href="/fourball/list/">Your shortlist</a>
  </div>
</section>
<section class="pp-block">
  <h2>Questions</h2>
  <div class="fb-faqs">{faq_html}</div>
</section>
<section class="pp-block"><p class="pp-small">Fourball Alerts run on the same price tracking as every GolfPrice AI tool: our own record of every price, checked every 6 hours. No hype. No fake discounts. <a href="/deal-tools.html">See all deal tools</a>.</p></section>
</div>
<script src="/js/fourball.js?v=20261020" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage",
                  "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]}
    app_schema = {"@context": "https://schema.org", "@type": "WebApplication", "name": "Fourball Alerts",
                  "url": f"{SITE}/fourball/", "applicationCategory": "ShoppingApplication", "operatingSystem": "Any",
                  "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
                  "description": "Shared UK golf price alerts for a four-ball or golf society: send one link, everyone gets an email when the price drops."}
    return page_shell(title="Fourball Alerts: golf price alerts for your whole four-ball | GolfPrice AI",
                      description="Send one link to your four-ball or golf society group chat. Everyone adds their own email and gets one alert when the price genuinely drops. Free, no app.",
                      canonical=f"{SITE}/fourball/", body=body, section="tools", schema=[app_schema, faq_schema, crumbs_schema],
                      noindex=False, og_image=CARD,
                      extra_head=FOURBALL_CSS + '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def list_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Fourball Alerts", "/fourball/"), ("Shortlist", None)])
    body = f"""<div class="pp-wrap">
{crumbs_html}
<section class="fb-list" id="fb-list">
  <span class="fb-kicker">Four-ball shortlist</span>
  <h1 class="fb-list-title">A four-ball shortlist</h1>
  <span class="fb-chip" hidden></span>
  <p class="fb-lede">Today’s lowest UK prices, checked every 6 hours across multiple UK retailers.</p>
  <ol class="fb-items"></ol>
  <p class="pp-card fb-empty" hidden>Nothing on this shortlist yet. Tap the heart (“Add to four-ball shortlist”) on any <a href="/prices/">price page</a>, then come back here to send it to the group.</p>
  <div class="fb-watch" hidden>
    <form class="gp-alert-form fb-watch-form" novalidate>
      <b class="fb-watch-head">Watch <span class="fb-count-word">all 3</span> with one email</b>
      <span class="fb-watch-sub">We’ll email you when any of them genuinely drops. Confirm once, stop any time.</span>
      <label class="gp-af-label" for="fb-watch-email">Your email</label>
      <div class="gp-af-row">
        <input id="fb-watch-email" type="email" name="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required>
        <button type="submit" class="gp-af-btn fb-watch-btn">Watch all 3</button>
      </div>
      <div class="gp-hp" aria-hidden="true"><label>Leave this empty <input name="website" tabindex="-1" autocomplete="off"></label></div>
      <p class="gp-af-small">New to alerts? We’ll email you once to confirm first. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
      <p class="gp-af-msg" role="status" aria-live="polite"></p>
    </form>
  </div>
  <div class="fb-invite fb-mine" hidden>
    <div class="fb-invite-top">{ICON_GROUP}<h2 class="fb-head">Send it to your four-ball</h2></div>
    <p>Each mate can watch the whole list with their own email. We never see who you send it to.</p>
    <div class="fb-invite-row">
      <label>Your first name (optional)<input type="text" maxlength="20" autocomplete="given-name"></label>
      <button type="button" class="gp-af-btn fb-send">Send to my four-ball</button>
    </div>
    <button type="button" class="fb-link fb-clear">Clear shortlist</button>
  </div>
  <p class="pp-small">Build your own: tap the heart on any price page, then “Send to my four-ball”. <a href="/fourball/">How Fourball Alerts work</a>.</p>
  <p class="pp-disclose">We may earn a commission if you buy through our links. It never changes the price or what we show.</p>
</section>
</div>
<script src="/js/fourball.js?v=20261020" defer></script>"""
    return page_shell(title="Four-ball shortlist | GolfPrice AI",
                      description="A golf kit shortlist from your four-ball, with today’s lowest UK prices. Watch them all with one email.",
                      canonical=f"{SITE}/fourball/list/", body=body, section="tools", schema=[crumbs_schema],
                      noindex=True, og_image=CARD,
                      extra_head=FOURBALL_CSS + '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n')


def build():
    changed = []
    if _write(ROOT / "fourball" / "index.html", tool_page()):
        changed.append("/fourball/")
    if _write(ROOT / "fourball" / "list" / "index.html", list_page()):
        changed.append("/fourball/list/")
    return changed, [("fourball/", None)]


if __name__ == "__main__":
    print(build())
