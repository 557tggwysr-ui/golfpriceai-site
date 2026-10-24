"""Society HQ pages (built with every price run, like the games).

/societies/awards/  The Society Awards Night Kit: an organiser types their
                    season's awards and winners and gets award cards for the
                    WhatsApp group, a presentation-night slideshow and, for
                    awards with a budget, Prize Picker links (js/society-awards.js).
/societies/prize/   Prize Picker: a winner opens their private link and picks a
                    prize within budget from today's real prices (js/prize-picker.js).

Both are filled by the browser from the alerts worker (/soc/...). Nothing about
money passes through the site. Kept out of search until the December launch:
flip LAUNCHED to True to let the awards page be indexed.
"""
from price_pages import SITE, _write, breadcrumb, page_shell

LAUNCHED = False
PHOTO = '<picture class="soc-photo"><source media="(max-width: 700px)" srcset="/assets/photos/tools/society-hq-wide.jpg"><img src="/assets/photos/tools/society-hq-banner.jpg" alt="A golf society gathered by the first tee on a misty morning with coffees and bacon rolls, the organiser smiling at his phone" width="1536" height="512"></picture>'
CSS = '<link rel="stylesheet" href="/css/society.css?v=20261024d">\n'
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
                      canonical=f"{SITE}/societies/awards/", body=body, section="play", schema=[crumbs_schema],
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
                      canonical=f"{SITE}/societies/prize/", body=body, section="play", schema=[crumbs_schema],
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
    return page_shell(title="Your society | Society HQ | GolfPrice AI",
                      description="Run your golf society for free: fixtures, sign-ups, who’s paid, a waiting list and the prize fund, all from one link in the WhatsApp group.",
                      canonical=f"{SITE}/societies/hq/", body=body, section="play", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def find_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Find a Society", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
{PHOTO}
  <span class="soc-kick">Free · Society HQ</span>
  <h1>Find a golf society</h1>
  <p>Fancy regular golf without a full club membership, or a new crowd to play with? These UK societies are open to new members.</p>
</section>
<div class="soc-card"><label>Search by name or area<input id="fd-q" placeholder="e.g. Leeds, Surrey, Sunday" autocomplete="off"></label></div>
<div id="fd" aria-live="polite"><p class="soc-loading">Rounding up the societies…</p></div>
<section class="soc-card soc-next"><span class="soc-kick">Run a society?</span><h2>List yours here, free</h2><p>Start your society in Society HQ and tick “Open to new members”. Only its name, area and description are shown.</p><a class="soc-btn" href="/societies/hq/">Start your society</a></section>
{REAL}
</div>
<script src="/js/society-find.js?v=20261024" defer></script>"""
    return page_shell(title="Find a golf society near you | Society HQ | GolfPrice AI",
                      description="UK golf societies open to new members: regular golf without a full club membership. Free to list your society.",
                      canonical=f"{SITE}/societies/find/", body=body, section="play", schema=[crumbs_schema],
                      noindex=not LAUNCHED, og_image="/assets/cards/society-hq.jpg", extra_head=CSS)


def hub_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
{PHOTO}
  <span class="soc-kick">Free · for golf societies</span>
  <h1>Society HQ</h1>
  <p>Everything a golf society needs, in one free place: fixtures, sign-ups, who’s paid, awards and prizes. Results and the Society Report arrive in early 2027.</p>
</section>
<section class="soc-card soc-next">
  <span class="soc-kick">Run your society</span>
  <h2>Fixtures, sign-ups and who’s paid</h2>
  <p>One link in the WhatsApp group: members say in, out or maybe, you tick who’s paid, and the waiting list sorts itself. A “Pay the organiser” button opens your own payment link.</p>
  <a class="soc-btn" href="/societies/hq/">Start your society</a>
</section>
<section class="soc-card">
  <span class="soc-kick" style="color:var(--gp-green-dark)">Looking for a society?</span>
  <h2>Find a Society</h2>
  <p class="soc-help">UK societies open to new members.</p>
  <a class="soc-btn2" href="/societies/find/" style="align-self:flex-start">Find a society near you</a>
</section>
<section class="soc-card soc-next">
  <span class="soc-kick">Available now</span>
  <h2>Society Awards Night Kit</h2>
  <p>Award cards for the WhatsApp group, a slideshow for the big night, and prizes your winners pick themselves at today’s lowest UK prices.</p>
  <a class="soc-btn" href="/societies/awards/">Make your awards</a>
</section>
{REAL}
</div>"""
    return page_shell(title="Society HQ: free tools for golf societies | GolfPrice AI",
                      description="Free tools for UK golf societies: award cards, presentation-night slideshow and winners' prizes. Fixtures, sign-ups and results coming in 2027.",
                      canonical=f"{SITE}/societies/", body=body, section="play", schema=[crumbs_schema],
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
