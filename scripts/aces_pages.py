"""The Ace Register (/play/aces/): every UK hole-in-one, on record.

Golfers log an ace against a course from the UK course list (courses.py, from
OpenStreetMap) and get a certificate drawn on their own device. The boards
(latest aces, a course's ace board, the hungriest holes) come live from the
alerts worker (/ace/...). A course's board is the same page with ?c=<id>.

Built with every price run, like the games.
"""
import json

from price_pages import SITE, _write, page_shell

V = "20261107a"
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
      <button type="button" class="ac-link" id="ac-missing">Can’t find your course?</button> · <a class="ac-link" href="/courses/widget/">Free ace board for your club’s website</a>
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
<script src="/js/milestones.js?v=20261106a" defer></script>
<script src="/js/aces.js?v={V}" defer></script>"""
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
        {"@type": "ListItem", "position": 2, "name": "The Clubhouse", "item": SITE + "/play/"},
        {"@type": "ListItem", "position": 3, "name": "The Ace Register", "item": SITE + "/play/aces/"}]}
    return page_shell(title="Hole-in-One Register UK: Log Your Ace, Get a Certificate | GolfPrice AI",
                      description="Had a hole-in-one? Log it free on the UK Ace Register: get a certificate to frame and share, and your nickname on your course’s ace board for good.",
                      canonical=f"{SITE}/play/aces/", body=body, section="play", schema=[crumbs, faq_schema, {"@context": "https://schema.org", "@type": "WebApplication", "name": 'The Ace Register', "url": f"{SITE}/play/aces/", "applicationCategory": "SportsApplication", "operatingSystem": "Any web browser", "description": "A free UK hole-in-one register: log an ace against any UK golf course, get a certificate to share and a place on the course's ace board.", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}, "featureList": ['Every UK golf course listed', 'Hole-in-one certificate', 'Course ace boards', 'Nicknames only'], "inLanguage": "en-GB", "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}],
                      noindex=False, extra_head=CSS)


WIDGET_FAQS = [
    ("Is the Ace Board really free?", "Yes. No fee, no account, no ads and no tracking cookies on the board. It simply shows the holes-in-one your members have logged on the UK Ace Register, with a link for members to add theirs."),
    ("What does it show?", "Your course's holes-in-one from the UK Ace Register: the hole, the golfer's nickname, the club they used and the date. Golfers choose their own nickname and can keep an ace off the boards altogether."),
    ("How do members add an ace?", "With the button on the board, or at golfpriceai.com/play/aces/. They get a certificate to frame or share straight away, and the board on your site updates itself."),
    ("Will it slow our website down?", "No. It's a small, self-contained box that loads after the rest of your page, and works on any website builder that lets you paste HTML (WordPress, Wix, Squarespace, club systems and so on)."),
    ("Can an ace be taken off the board?", "Yes. Email GolfPriceAI@outlook.com and we'll remove it, no questions asked."),
]


def widget_page():
    from price_pages import breadcrumb
    crumbs_html, crumbs = breadcrumb([("Home", "/"), ("Golf courses", "/courses/"), ("Ace Board for clubs", None)])
    faqs = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in WIDGET_FAQS)
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in WIDGET_FAQS]}
    body = f"""<div class="pp-wrap aw">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">For golf clubs · free</span>
  <h1>A free hole-in-one board for your golf club’s website</h1>
  <p class="pp-answer">Celebrate your members’ holes-in-one on your own website. The Ace Board lists every ace logged at your course on the UK Ace Register, updates itself, and lets members add theirs in a minute. Free, no account, no ads. Find your course, copy the code, paste it on your site.</p>
</section>
<section class="pp-block aw-grid">
  <div class="pp-card aw-box">
    <h2>1. Find your course</h2>
    <label for="aw-q" class="aw-lab">Club or course name, or town</label>
    <input id="aw-q" class="aw-in" type="search" autocomplete="off" placeholder="e.g. Royal Lytham, or Harrogate">
    <ul id="aw-res" class="aw-res" aria-live="polite"></ul>
    <div id="aw-opts" class="aw-opts" hidden>
      <h2>2. Choose a style</h2>
      <label class="aw-lab"><input type="radio" name="aw-n" value="5" checked> Latest 5 aces</label>
      <label class="aw-lab"><input type="radio" name="aw-n" value="10"> Latest 10 aces</label>
      <label class="aw-lab"><input type="checkbox" id="aw-dark"> Dark version</label>
      <h2>3. Copy the code</h2>
      <textarea id="aw-code" class="aw-code" rows="6" readonly aria-label="Code to paste on your website"></textarea>
      <div class="aw-btns"><button type="button" class="soc-btn aw-copy" id="aw-copy">Copy the code</button><button type="button" class="aw-send" id="aw-send">Not the webmaster? Send it to your club</button></div>
      <p class="pp-small" id="aw-msg" role="status"></p>
    </div>
  </div>
  <div class="aw-prev"><p class="pp-small" id="aw-hint">Your board’s preview appears here.</p><iframe id="aw-frame" title="Ace Board preview" hidden></iframe></div>
</section>
<section class="pp-block pp-faq or-faqs"><h2>Ace Board questions</h2>{faqs}</section>
</div>
<script>
(function () {{
  var q = document.getElementById('aw-q'), res = document.getElementById('aw-res'), all = [], pick = null;
  function esc(s) {{ return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'); }}
  fetch('/data/courses/uk.json').then(function (r) {{ return r.json(); }}).then(function (d) {{ all = d.courses || []; var pre = new URLSearchParams(location.search).get('c'); if (pre) {{ var c = all.filter(function (x) {{ return x.id === pre; }})[0]; if (c) choose(c); }} }});
  q.addEventListener('input', function () {{
    var t = q.value.trim().toLowerCase(); if (t.length < 2) {{ res.innerHTML = ''; return; }}
    var hits = all.filter(function (c) {{ return (c.n + ' ' + (c.t || '')).toLowerCase().indexOf(t) >= 0; }}).slice(0, 8);
    res.innerHTML = hits.length ? hits.map(function (c, i) {{ return '<li><button type="button" data-i="' + all.indexOf(c) + '">' + esc(c.n) + (c.t ? ' <span>' + esc(c.t) + '</span>' : '') + '</button></li>'; }}).join('') : '<li class="aw-none">No match. Try the town, or a shorter name.</li>';
  }});
  res.addEventListener('click', function (e) {{ var b = e.target.closest('button'); if (b) choose(all[+b.getAttribute('data-i')]); }});
  document.querySelectorAll('input[name=aw-n], #aw-dark').forEach(function (i) {{ i.addEventListener('change', draw); }});
  function choose(c) {{ pick = c; q.value = c.n + (c.t ? ', ' + c.t : ''); res.innerHTML = ''; document.getElementById('aw-opts').hidden = false; draw(); if (window.gtag) gtag('event', 'ace_widget_course', {{ course: c.id }}); }}
  function draw() {{
    if (!pick) return;
    var n = document.querySelector('input[name=aw-n]:checked').value, dark = document.getElementById('aw-dark').checked;
    var src = 'https://golfpriceai.com/embed/aces/?c=' + pick.id + (n !== '5' ? '&n=' + n : '') + (dark ? '&theme=dark' : '');
    var h = n === '10' ? 620 : 420;
    document.getElementById('aw-code').value = '<iframe src="' + src + '" title="Holes-in-one at ' + pick.n.replace(/"/g, '') + '" width="100%" height="' + h + '" style="border:0;max-width:520px" loading="lazy"></iframe>\\n<p style="font-size:12px">Had a hole-in-one here? Log it on the <a href="https://golfpriceai.com/play/aces/">UK Ace Register</a>.</p>';
    var f = document.getElementById('aw-frame'); f.hidden = false; f.style.height = h + 'px'; f.src = src.replace('https://golfpriceai.com', ''); document.getElementById('aw-hint').hidden = true;
  }}
  document.getElementById('aw-copy').addEventListener('click', function () {{
    var t = document.getElementById('aw-code'); t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(function () {{ document.execCommand('copy'); }});
    document.getElementById('aw-msg').textContent = 'Copied. Paste it into an HTML or embed block on your website.';
    if (window.gtag) gtag('event', 'ace_widget_copy', {{ course: pick && pick.id }});
  }});
  document.getElementById('aw-send').addEventListener('click', function () {{
    var url = 'https://golfpriceai.com/courses/widget/?c=' + (pick ? pick.id : '');
    var text = 'Could we add a free hole-in-one board to the club website? It lists members’ aces from the UK Ace Register and updates itself. No cost, no ads: ' + url;
    if (navigator.share) navigator.share({{ text: text }}).catch(function () {{}});
    else location.href = 'mailto:?subject=' + encodeURIComponent('A free hole-in-one board for our website') + '&body=' + encodeURIComponent(text);
    if (window.gtag) gtag('event', 'ace_widget_send', {{ course: pick && pick.id }});
  }});
}})();
</script>"""
    css = ('<style>.aw-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}'
           '.aw-box{padding:22px 24px}.aw-box h2{font-size:18px;margin:6px 0 10px}.aw-lab{display:flex;gap:8px;align-items:center;font-size:14px;margin:6px 0}'
           '.aw-in{width:100%;min-height:48px;border:2px solid #14211a;border-radius:12px;padding:0 14px;font-size:16px}'
           '.aw-res{list-style:none;margin:8px 0 0;padding:0}.aw-res button{width:100%;text-align:left;min-height:44px;border:1px solid #e4e6e0;background:#fff;border-radius:10px;margin-bottom:6px;padding:8px 12px;font-size:15px;cursor:pointer}'
           '.aw-res button span{color:var(--gp-text-3);font-size:13px}.aw-none{font-size:14px;color:var(--gp-text-3)}.aw-opts{margin-top:14px}'
           '.aw-code{width:100%;font:12px/1.4 ui-monospace,Menlo,monospace;border:1px solid #e4e6e0;border-radius:10px;padding:10px}'
           '.aw-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.aw-send{min-height:44px;border:2px solid #2b7a1e;background:#fff;border-radius:12px;padding:0 16px;font-weight:600;cursor:pointer}'
           '.aw-prev iframe{width:100%;max-width:520px;border:0}@media(max-width:860px){.aw-grid{grid-template-columns:1fr}}</style>'
           '<link rel="stylesheet" href="/css/society.css?v=20261106a">')
    return page_shell(title="Free Hole-in-One Board for Your Golf Club’s Website | GolfPrice AI",
                      description="A free, self-updating hole-in-one board for your golf club’s website: members’ aces from the UK Ace Register, with a button to log new ones. No cost, no ads, copy and paste.",
                      canonical=f"{SITE}/courses/widget/", body=body, section="play", schema=[crumbs, faq_schema], noindex=False, extra_head=css)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    changed = []
    if _write(root / "play" / "aces" / "index.html", page()):
        changed.append("/play/aces/")
    if _write(root / "courses" / "widget" / "index.html", widget_page()):
        changed.append("/courses/widget/")
    return changed


if __name__ == "__main__":
    print(build())
