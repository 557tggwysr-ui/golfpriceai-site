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
CSS = '<link rel="stylesheet" href="/css/society.css?v=20261024">\n'
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
<script src="/js/society-awards.js?v=20261024" defer></script>"""
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


def hub_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", None)])
    body = f"""<div class="soc-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Free · for golf societies</span>
  <h1>Society HQ</h1>
  <p>Everything a golf society needs, in one free place. First up: the Awards Night Kit. Fixtures, sign-ups, results and the Society Report arrive in early 2027.</p>
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
                      noindex=not LAUNCHED, og_image="/assets/cards/society-awards.jpg", extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "societies" / "index.html", hub_page()):
        changed.append("/societies/")
    if _write(root / "societies" / "awards" / "index.html", awards_page()):
        changed.append("/societies/awards/")
    if _write(root / "societies" / "prize" / "index.html", prize_page()):
        changed.append("/societies/prize/")
    return changed


if __name__ == "__main__":
    print(build())
