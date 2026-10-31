"""The Ace Register (/play/aces/): every UK hole-in-one, on record.

Golfers log an ace against a course from the UK course list (courses.py, from
OpenStreetMap) and get a certificate drawn on their own device. The boards
(latest aces, a course's ace board, the hungriest holes) come live from the
alerts worker (/ace/...). A course's board is the same page with ?c=<id>.

Built with every price run, like the games.
"""
import json

from price_pages import SITE, _write, page_shell

V = "20261031"
CSS = (f'<link rel="stylesheet" href="/css/par-price.css?v=20261038">\n'
       f'<link rel="stylesheet" href="/css/aces.css?v={V}">\n'
       '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@1,600&amp;display=swap" rel="stylesheet">\n')

FAQS = [
    ("How do I register a hole-in-one?",
     "Fill in the form on this page: the course, the hole, the yardage, the club and the date. You get a certificate straight away, and your ace goes on the course's board on the Ace Register. It's free and needs no account."),
    ("Who can see my ace?",
     "The course's ace board and the Ace Register show your nickname, the course, the hole, the yardage, the club and the date. The names of the people who saw it and the ball you used only go on your own certificate. You can also keep an ace off the boards altogether."),
    ("Where does the course list come from?",
     "From OpenStreetMap, the free and open map of the world, refreshed every month. If your course is missing, use the “Can't find your course?” link and we'll add it."),
    ("Is the Ace Register checked?",
     "Aces are logged on the golfer's honour, the way golf has always worked. Anything that doesn't look right is taken off the boards."),
]


def page():
    faqs = "".join(f'<details class="im-faq ac-faq"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQS)
    body = f"""<div class="ac">
<section class="ac-hero">
  <div class="ac-hero-copy">
    <span class="ac-kick">THE ACE REGISTER</span>
    <h1 id="ac-h1">Every hole-in-one in the UK.<br><span>On record, forever.</span></h1>
    <p class="ac-lede">Log your ace, get a certificate worth framing, and take your place on your course’s board. Free, and nicknames only.</p>
    <div class="ac-ctas"><a class="ac-btn" href="#log">Log my ace</a><a class="ac-btn ac-btn-ghost" href="#boards">Find a course’s board</a></div>
  </div>
  <div class="ac-stats" aria-live="polite">
    <div><b data-ac="total">–</b><span data-ac="totalLabel">aces logged this year</span></div>
    <div><b data-ac="courses">–</b><span>courses with an ace</span></div>
    <div><b data-ac="club">–</b><span>the club that does it most</span></div>
  </div>
</section>

<section class="ac-board" id="board" hidden aria-live="polite"></section>

<section class="ac-log" id="log">
  <div class="ac-log-copy">
    <h2>Had a hole-in-one? Get it on record.</h2>
    <p>Two minutes, and you’ll have a certificate to frame, post and send to the club WhatsApp.</p>
    <ul class="ac-ticks"><li>Your nickname on the course’s board, for good</li><li>Who saw it goes on your certificate only</li><li>Saved to your Milestones in My Clubhouse</li></ul>
  </div>
  <form class="ac-form" id="ac-form" novalidate autocomplete="off">
    <div class="ac-field ac-course">
      <label for="ac-course">Course</label>
      <input id="ac-course" type="text" placeholder="Start typing the course name" role="combobox" aria-expanded="false" aria-controls="ac-list" aria-autocomplete="list">
      <ul class="ac-list" id="ac-list" role="listbox" hidden></ul>
      <button type="button" class="ac-link" id="ac-missing">Can’t find your course?</button>
    </div>
    <div class="ac-missing" id="ac-missing-box" hidden>
      <p>Tell us the course and town. We’ll check it and add it to the list, usually within a few days.</p>
      <div class="ac-grid2">
        <label class="ac-field"><span>Course name</span><input id="ac-sname" type="text" maxlength="80"></label>
        <label class="ac-field"><span>Town</span><input id="ac-stown" type="text" maxlength="40"></label>
      </div>
      <button type="button" class="ac-btn ac-btn-ghost" id="ac-ssend">Suggest this course</button>
      <p class="ac-msg" id="ac-smsg" role="status"></p>
    </div>
    <div class="ac-grid2">
      <label class="ac-field"><span>Hole</span><input id="ac-hole" type="number" inputmode="numeric" min="1" max="27" placeholder="7"></label>
      <label class="ac-field"><span>Yards</span><input id="ac-yards" type="number" inputmode="numeric" min="40" max="650" placeholder="152"></label>
    </div>
    <fieldset class="ac-par"><legend>Par</legend>
      <label><input type="radio" name="ac-par" value="3" checked><span>Par 3</span></label>
      <label><input type="radio" name="ac-par" value="4"><span>Par 4 (an albatross!)</span></label>
      <label><input type="radio" name="ac-par" value="5"><span>Par 5</span></label>
    </fieldset>
    <div class="ac-grid2">
      <label class="ac-field"><span>Club</span><input id="ac-club" type="text" maxlength="24" placeholder="7 iron"></label>
      <label class="ac-field"><span>Date</span><input id="ac-date" type="date"></label>
    </div>
    <label class="ac-field"><span>Ball (optional)</span><input id="ac-ball" type="text" maxlength="30" placeholder="The one you’ll never play again"></label>
    <label class="ac-field"><span>Who saw it?</span><input id="ac-wit" type="text" maxlength="60" placeholder="Dave, Mo and Big Steve"><small>First names or nicknames. They go on your certificate only, never on the board.</small></label>
    <label class="ac-field" id="ac-nick-row"><span>Your nickname</span><input id="ac-nick" type="text" maxlength="20" placeholder="How the board will show you"></label>
    <label class="ac-check"><input id="ac-public" type="checkbox" checked><span><b>Add it to the course’s ace board.</b> Shows your nickname, the hole, the yardage, the club and the date. Nothing else.</span></label>
    <button type="submit" class="ac-btn ac-go">Get my certificate</button>
    <p class="ac-msg" id="ac-msg" role="status"></p>
  </form>
</section>

<section class="ac-two" id="boards">
  <div class="ac-card">
    <div class="ac-card-head"><h2>Latest aces</h2><span>Nicknames only</span></div>
    <div id="ac-latest"><p class="ac-empty">Loading the register…</p></div>
  </div>
  <div class="ac-card">
    <h2>Find a course’s ace board</h2>
    <label class="ac-field ac-course"><span class="ac-vh">Course</span><input id="ac-find" type="text" placeholder="Start typing a course name" role="combobox" aria-expanded="false" aria-controls="ac-flist" aria-autocomplete="list"><ul class="ac-list" id="ac-flist" role="listbox" hidden></ul></label>
    <h3 class="ac-h3">Hungriest holes in the UK</h3>
    <div id="ac-holes"><p class="ac-empty">Every hole with two or more aces shows up here.</p></div>
  </div>
</section>

<section class="ac-faqs"><h2>Hole-in-one questions</h2>{faqs}</section>
<p class="ac-attr">Course list © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL). Aces are logged on each golfer’s honour.</p>
</div>
<noscript><p class="ac-attr">The Ace Register needs JavaScript switched on.</p></noscript>
<script src="/js/milestones.js?v=20261101" defer></script>
<script src="/js/aces.js?v={V}" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "The Clubhouse", "item": SITE + "/play/"},
        {"@type": "ListItem", "position": 3, "name": "The Ace Register", "item": SITE + "/play/aces/"}]}
    return page_shell(title="Hole-in-One Register UK: Log Your Ace, Get a Certificate | GolfPrice AI",
                      description="Had a hole-in-one? Log it free on the UK Ace Register: get a certificate to frame and share, and your nickname on your course’s ace board for good.",
                      canonical=f"{SITE}/play/aces/", body=body, section="play", schema=[crumbs, faq_schema],
                      noindex=False, extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "play" / "aces" / "index.html", page()):
        changed.append("/play/aces/")
    return changed


if __name__ == "__main__":
    print(build())
