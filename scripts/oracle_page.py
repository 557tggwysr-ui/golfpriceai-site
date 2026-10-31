"""The Oracle board (/play/oracle/): Crowd Caddie's leaderboard.

Every price page asks "Where's this price heading in the next two weeks?"
(price_pages.crowd_caddie). The alerts worker settles each call against the
real price 14 days later; this page shows the crowd's record, the golfers who
read UK golf prices best (nicknames only, five settled calls to get on), the
biggest open calls and the visitor's own calls. All live from /cc/board.

Built with every price run, like the games.
"""
from price_pages import SITE, _write, page_shell, CADDIE_V

CSS = (f'<link rel="stylesheet" href="/css/caddie.css?v={CADDIE_V}">\n')

FAQS = [
    ("How does the Crowd Caddie work?",
     "On every GolfPrice AI price page you can call where the lowest UK price is heading in the next two weeks: cheaper, holds or pricier. We lock in that day’s price and check the real price 14 days later. A drop of 2% or more counts as cheaper, a rise of 2% or more as pricier, and anything in between holds."),
    ("How do I get on the Oracle board?",
     "Make calls on any price pages and add a nickname. Once five of your calls have been settled, you’re on the board, ranked by the share you got right. There’s a new board every month, plus an all-time table."),
    ("Do I need an account?",
     "No. Your calls are kept against a random player number made by your browser, with no email and no name. The nickname is optional and is the only thing anyone else sees."),
    ("Are golf prices cheaper on Black Friday?",
     "Often, but not on everything. That’s the point of the Crowd Caddie: see which way UK golfers think a price is heading, and check what really happened against our own price history."),
    ("Is this betting?",
     "No. There’s no money, no stakes and no prizes. It’s for glory and bragging rights only."),
]


def page():
    faqs = "".join(f'<details><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQS)
    body = f"""<div class="or">
<section class="or-hero">
  <div>
    <span class="cc-kick">CROWD CADDIE · <span id="or-month">THIS MONTH</span></span>
    <h1>The Oracle <span>board.</span></h1>
    <p class="or-quip">Everyone at the 19th hole reckons they know when the price will drop. Now we can check.</p>
    <p>The golfers who read UK golf prices best. Call where a price is heading on any price page; we check the real price 14 days later. Five settled calls to get on the board.</p>
  </div>
  <div class="or-stats" aria-live="polite">
    <div><b class="or-green" data-or="acc">–</b><span>of the crowd’s calls right this month</span></div>
    <div><b data-or="settled">–</b><span>calls settled this month</span></div>
    <div><b data-or="open">–</b><span>calls waiting on the price</span></div>
  </div>
</section>

<div class="or-two">
  <div class="or-col">
    <section class="or-card" aria-labelledby="or-board-h">
      <div class="or-head"><h2 id="or-board-h">Top callers</h2>
        <div class="or-tabs" role="group" aria-label="Which table"><button type="button" data-tab="top" aria-pressed="true">This month</button><button type="button" data-tab="ever" aria-pressed="false">All time</button></div>
      </div>
      <div id="or-board" aria-live="polite"><p class="or-empty">Loading the board…</p></div>
    </section>
    <section class="or-card">
      <h2>The crowd’s biggest calls right now</h2>
      <div class="or-hot" id="or-hot"><p class="or-empty">The busiest calls show here once a few golfers have made them.</p></div>
    </section>
  </div>
  <div class="or-col">
    <section class="or-card or-you" id="or-you" aria-live="polite">
      <div class="or-you-top"><b>Your calls</b></div>
      <p class="or-empty">Make your first call on any <a href="/prices/">price page</a>. It takes one tap.</p>
    </section>
  </div>
</div>

<section class="or-steps" aria-label="How it works">
  <div><b>1</b><h3>Make your call</h3><p>On any price page: cheaper, holds or pricier in the next two weeks.</p></div>
  <div><b>2</b><h3>We lock the price</h3><p>Today’s lowest UK price, from our own tracking. Nothing to fill in.</p></div>
  <div><b>3</b><h3>14 days later</h3><p>We check the real price and mark your call right or wrong.</p></div>
</section>

<section class="or-faqs"><h2>Crowd Caddie questions</h2>{faqs}</section>
</div>
<noscript><p class="or-empty">The Oracle board needs JavaScript switched on.</p></noscript>
<script src="/js/oracle.js?v={CADDIE_V}" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "The Clubhouse", "item": SITE + "/play/"},
        {"@type": "ListItem", "position": 3, "name": "The Oracle board", "item": SITE + "/play/oracle/"}]}
    return page_shell(title="Will Golf Prices Drop? The Crowd Caddie Oracle Board | GolfPrice AI",
                      description="UK golfers call where golf prices are heading in the next two weeks, and we check what really happened. See the crowd’s record and the best callers.",
                      canonical=f"{SITE}/play/oracle/", body=body, section="play", schema=[crumbs, faq_schema],
                      noindex=False, extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "play" / "oracle" / "index.html", page()):
        changed.append("/play/oracle/")
    return changed


if __name__ == "__main__":
    print(build())
