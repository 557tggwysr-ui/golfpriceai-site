"""Society HQ pages (built with every price run, like the games).

/societies/awards/  The Society Awards Night Kit: an organiser types their
                    season's awards and winners and gets award cards for the
                    WhatsApp group, a presentation-night slideshow and, for
                    awards with a budget, Prize Picker links (js/society-awards.js).
/societies/prize/   Prize Picker: a winner opens their private link and picks a
                    prize within budget from today's real prices (js/prize-picker.js).

Both are filled by the browser from the alerts worker (/soc/...). Nothing about
money passes through the site. Live since 24 October 2026 (LAUNCHED = True lets the public pages be indexed;
the prize page always stays out of search).
"""
from price_pages import SITE, _write, breadcrumb, page_shell

LAUNCHED = True
PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/society-hq-wide.jpg"><img src="/assets/photos/tools/society-hq-banner.jpg" alt="A golf society gathered by the first tee on a misty morning with coffees and bacon rolls, the organiser smiling at his phone" width="1536" height="512"></picture>'
FIND_PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/find-a-society-wide.jpg"><img src="/assets/photos/tools/find-a-society-banner.jpg" alt="Golfers shaking hands on the first tee, meeting new playing partners" width="1536" height="512"></picture>'
CSS = '<link rel="stylesheet" href="/css/society.css?v=20261024e">\n'
REAL = ('<p class="gp-real">Every prize price is real: the lowest new UK price we found today, across multiple UK '
        'retailers. No money is taken or held by GolfPrice AI. <a href="/legal/privacy-policy.html">Privacy</a> · '
        '<a href="/play/">Play</a> · <a href="/shop.html">Browse the shop</a></p>')


def awards_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Awards Night Kit", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Free · Society HQ</span>
  <h1>Society Awards Night Kit</h1>
  <p>Award cards for the WhatsApp group, a slideshow for the big night, and prizes the winners pick themselves. Ready in five minutes, no sign-up.</p>
</section>
<div id="aw" aria-live="polite"><p class="soc-loading">Polishing the trophies…</p></div>
<noscript><p>The Awards Night Kit needs JavaScript switched on.</p></noscript>
<section class="soc-faq">
  <h2>Questions organisers ask</h2>
  <div class="soc-faq-grid">
    <div><h3>Is it really free?</h3><p>Yes. No sign-up, no fees. We earn a small commission if a winner’s prize is bought through one of our links, at no extra cost to you.</p></div>
    <div><h3>How do prizes work?</h3><p>Give an award a budget and its winner gets a private link to pick their own prize at today’s lowest UK price. You get one shopping list with the links. You buy the prizes as normal; we never take or hold money.</p></div>
    <div><h3>Who can see our awards?</h3><p>Anyone you send the link to. Only your browser can edit them, and only you see the prize links. Use nicknames if you prefer. Awards nobody looks at for 400 days are tidied away.</p></div>
    <div><h3>Can I change things later?</h3><p>Yes, from the same phone or computer you made them on. If you change a winner, their prize pick starts again.</p></div>
  </div>
</section>
{REAL}
</div>
<script src="/js/society-awards.js?v=20261024b" defer></script>"""
    return page_shell(title="Society Awards Night Kit: free golf society awards | GolfPrice AI",
                      description="Free golf society awards: award cards for the WhatsApp group, a presentation-night slideshow, and prizes winners pick themselves at today's lowest UK prices.",
                      canonical=f"{SITE}/societies/awards/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


def prize_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Pick your prize", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<div id="pz" aria-live="polite"><p class="soc-loading">Unwrapping your prize…</p></div>
<noscript><p>Prize Picker needs JavaScript switched on.</p></noscript>
{REAL}
</div>
<script src="/js/prize-picker.js?v=20261024" defer></script>"""
    return page_shell(title="Pick your prize | Society Awards Night Kit | GolfPrice AI",
                      description="You won! Pick your own prize within budget at today's lowest UK prices.",
                      canonical=f"{SITE}/societies/prize/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


def hq_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Your society", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<div id="hq" aria-live="polite"><p class="soc-loading">Opening the clubhouse…</p></div>
<noscript><p>Society HQ needs JavaScript switched on.</p></noscript>
<section class="soc-faq">
  <h2>How Society HQ works</h2>
  <div class="soc-faq-grid">
    <div><h3>No sign-up</h3><p>Like our games, your phone remembers you. Members join with a nickname from one link in the WhatsApp group. Play on the same phone each time, not a private tab.</p></div>
    <div><h3>Who’s paid</h3><p>The organiser ticks who has paid. “Pay the organiser” opens the organiser’s own PayPal, Monzo or Revolut link. We never take, hold or see any money.</p></div>
    <div><h3>Waiting list</h3><p>Set a maximum and anyone after that goes on the waiting list. When someone drops out, the first in the queue moves up automatically.</p></div>
    <div><h3>Who can see it</h3><p>Only members see the fixtures and who’s playing. If the organiser lists the society in Find a Society, only its name, area and description are public.</p></div>
  </div>
</section>
{REAL}
</div>
<script src="/js/society-hq.js?v=20261024b" defer></script>"""
    return page_shell(title="Run your golf society free | Society HQ | GolfPrice AI",
                      description="Run your golf society for free: fixtures, sign-ups, who’s paid, a waiting list and the prize fund, all from one link in the WhatsApp group.",
                      canonical=f"{SITE}/societies/hq/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def find_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
{FIND_PHOTO}
  <span class="soc-kick">Free · Society HQ</span>
  <h1>Find a golf society</h1>
  <p>Fancy regular golf without a full club membership, or a new crowd to play with? These UK societies are open to new members.</p>
</section>
<div class="soc-card"><label>Search by name or area<input id="fd-q" placeholder="e.g. Leeds, Surrey, Sunday" autocomplete="off"></label></div>
<div id="fd" aria-live="polite"><p class="soc-loading">Rounding up the societies…</p></div>
<section class="soc-card soc-next"><span class="soc-kick">Run a society?</span><h2>List yours here, free</h2><p>Start your society in Society HQ and tick “Open to new members”. Only its name, area and description are shown.</p><a class="soc-btn" href="/societies/hq/">Start your society</a></section>
{REAL}
</div>
<script src="/js/society-find.js?v=20261024b" defer></script>"""
    return page_shell(title="Find a golf society near you | Society HQ | GolfPrice AI",
                      description="UK golf societies open to new members: regular golf without a full club membership. Free to list your society.",
                      canonical=f"{SITE}/societies/find/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def hub_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", None)])
    faqs = [
        ("Is Society HQ really free?", "Yes. No sign-up, no fees and no adverts in your way. We earn a small commission if someone buys golf kit through one of our links, at no extra cost to them. That’s it."),
        ("Do members need an account or an app?", "No. You share one link in the WhatsApp group, members tap it and pick a nickname. Their phone remembers them, so they should use their usual phone rather than a private tab."),
        ("How do members pay me?", "Add your own PayPal.me, Monzo.me or Revolut.me link and members get a “Pay the organiser” button with the entry fee filled in. The money goes straight to you. We never take, hold or see it. You tick who’s paid."),
        ("What happens when a day is full?", "Set the number of places and anyone after that goes on the waiting list. If someone drops out, the first person waiting moves up automatically."),
        ("Can people outside the society see us?", "Only members see your fixtures and who’s playing. If you tick “Open to new members”, Find a Society shows your society’s name, area, description and member count, nothing else."),
        ("What’s coming next?", "Results on the day, a season Order of Merit and a Monday Society Report for the group chat arrive in 2027, alongside per-event prizes."),
    ]
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}
    faq_html = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in faqs)
    body = f"""<div class="soc-wrap sh-wrap">
{crumbs_html}
<section class="soc-hero sh-hero">
{PHOTO}
  <span class="soc-kick">Free · for golf societies</span>
  <h1>Society HQ</h1>
  <p>Run your society from one link in the WhatsApp group. Fixtures, who’s in, who’s paid, awards night and prizes. No sign-up, no fees.</p>
  <div class="soc-btns"><a class="soc-btn" href="/societies/hq/">Start your society</a><a class="soc-btn2 sh-btn-dark" href="/societies/find/">Find a society</a></div>
</section>
<div class="sh-facts">
  <div><b>One link</b><span>in the group chat</span></div>
  <div><b>No sign-up</b><span>nicknames only</span></div>
  <div><b>No fees</b><span>members pay you direct</span></div>
</div>
<div class="sh-cards">
  <a class="sh-card" href="/societies/hq/">
    <img src="/assets/photos/tools/society-organiser.jpg" alt="" width="720" height="900" loading="lazy">
    <span class="sh-body"><span class="sh-kick">Run your society</span><b>Fixtures, sign-ups and who’s paid</b><span class="sh-line">In, out or maybe in one tap. A waiting list that sorts itself, paid ticks and the final numbers message.</span><span class="sh-cta">Start your society <span aria-hidden="true">&rarr;</span></span></span>
  </a>
  <a class="sh-card" href="/societies/find/">
    <picture><source media="(max-width: 700px)" srcset="/assets/photos/tools/find-a-society-wide.jpg"><img src="/assets/photos/tools/find-a-society-square.jpg" alt="" width="1080" height="1080" loading="lazy"></picture>
    <span class="sh-body"><span class="sh-kick">Find a Society</span><b>Regular golf without a full membership</b><span class="sh-line">UK societies open to new members, by town or county. Run one? List it free.</span><span class="sh-cta">Find a society <span aria-hidden="true">&rarr;</span></span></span>
  </a>
  <a class="sh-card sh-gold" href="/societies/awards/">
    <span class="sh-frame" aria-hidden="true"></span>
    <span class="sh-body"><span class="sh-kick">Awards Night Kit</span><b>End of the season? Do it properly</b><span class="sh-line">Award cards for the group chat, a slideshow for the big night, and prizes your winners pick themselves.</span><span class="sh-cta">Make your awards <span aria-hidden="true">&rarr;</span></span></span>
  </a>
</div>
<section class="soc-card sh-soon">
  <span class="soc-kick" style="color:var(--gp-green-dark)">Coming in 2027</span>
  <h2>Results, an Order of Merit and the Society Report</h2>
  <p class="soc-help">Enter the scores on the day and the season table keeps itself. Then a Monday report for the group chat with the winners, the wooden spoon and the best excuse.</p>
</section>
<section class="soc-card sh-faq">
  <h2>Organisers ask</h2>
  {faq_html}
</section>
{REAL}
</div>"""
    return page_shell(title="Society HQ: free golf society organiser | GolfPrice AI",
                      description="Run your golf society free from one WhatsApp link: fixtures, who’s in, who’s paid, a waiting list, awards night and Find a Society. No sign-up, no fees.",
                      canonical=f"{SITE}/societies/", body=body, section="societies", schema=[crumbs_schema, faq_schema],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "societies" / "index.html", hub_page()):
        changed.append("/societies/")
    if _write(root / "societies" / "hq" / "index.html", hq_page()):
        changed.append("/societies/hq/")
    if _write(root / "societies" / "find" / "index.html", find_page()):
        changed.append("/societies/find/")
    if _write(root / "societies" / "awards" / "index.html", awards_page()):
        changed.append("/societies/awards/")
    if _write(root / "societies" / "prize" / "index.html", prize_page()):
        changed.append("/societies/prize/")
    return changed


if __name__ == "__main__":
    print(build())
