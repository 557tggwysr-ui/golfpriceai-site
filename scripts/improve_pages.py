"""Improve: free handicap calculators (World Handicap System).

    /improve/                                 hub: every calculator + allowances
    /improve/handicap-index-calculator/       best 8 of your last 20
    /improve/course-handicap-calculator/      shots on a course and tee
    /improve/playing-handicap-calculator/     allowance by format
    /improve/what-do-i-need-to-shoot/         the score that cuts your index

Static pages: run  python scripts/improve_pages.py  after changing this file.
All the maths runs in the visitor's browser (js/improve.js). Nothing is
saved or sent anywhere. The header and footer are refreshed with the other
static pages by site_chrome.py.
"""
import json

from price_pages import ROOT, SITE, page_shell

OUT = ROOT / "improve"
V = "20261030b"
EXTRA = (f'<link rel="stylesheet" href="/css/improve.css?v={V}">\n'
         f'<script src="/js/improve.js?v={V}" defer></script>\n')

# Recommended allowances under the World Handicap System (Appendix C).
ALLOWANCES = [
    ("stableford", "Singles stroke play and stableford", "Stableford or medal", 95),
    ("fourball", "Fourball better ball (stroke play and stableford)", "Fourball better ball", 85),
    ("match", "Singles matchplay", "Singles matchplay", 100),
    ("fbmatch", "Fourball matchplay", "Fourball matchplay", 90),
    ("foursomes", "Foursomes (of the pair's combined course handicaps)", "Foursomes", 50),
]

CALCS = [
    ("handicap-index-calculator", "Handicap index calculator", "HANDICAP INDEX",
     "Enter your recent scores, or paste your score differentials. We average your best ones, the way WHS does."),
    ("course-handicap-calculator", "Course handicap calculator", "COURSE HANDICAP",
     "How many shots you get on a particular course and tee, from your index, the slope rating and the course rating."),
    ("playing-handicap-calculator", "Playing handicap calculator", "PLAYING HANDICAP",
     "Stableford, medal, fourball, matchplay or foursomes. Pick the format and we apply the recommended allowance."),
    ("what-do-i-need-to-shoot", "What do I need to shoot?", "GETTING CUT",
     "Paste your last 20 differentials and the course you're playing next. See the score that brings your index down."),
]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def crumbs(name, slug):
    items = [{"@type": "ListItem", "position": 1, "name": "Home", "item": SITE + "/"},
             {"@type": "ListItem", "position": 2, "name": "Improve", "item": SITE + "/improve/"}]
    if slug:
        items.append({"@type": "ListItem", "position": 3, "name": name, "item": f"{SITE}/improve/{slug}/"})
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}


def faq_schema(faqs):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}


def app_schema(name, slug, desc):
    return {"@context": "https://schema.org", "@type": "WebApplication", "name": name,
            "url": f"{SITE}/improve/{slug}/", "applicationCategory": "SportsApplication",
            "operatingSystem": "Any", "description": desc,
            "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}}


def faq_html(faqs):
    return "".join(f'<details class="im-faq"><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in faqs)


def field(fid, label, value, step="0.1", hint="", mode="decimal"):
    hint_html = f'<small>{esc(hint)}</small>' if hint else ""
    return (f'<label class="im-field" for="{fid}"><span>{esc(label)}</span>'
            f'<input id="{fid}" type="number" inputmode="{mode}" step="{step}" value="{value}" autocomplete="off">{hint_html}</label>')


def format_pills(name="fmt", short=True):
    out = []
    for i, (fid, _, label, pct) in enumerate(ALLOWANCES):
        chk = " checked" if i == 0 else ""
        out.append(f'<label class="im-pill"><input type="radio" name="{name}" value="{fid}" data-pct="{pct}"{chk}>'
                   f'<span>{esc(label)} {pct}%</span></label>')
    return '<div class="im-pills" role="radiogroup" aria-label="Format">' + "".join(out) + "</div>"


def more_calcs(skip):
    links = "".join(f'<a href="/improve/{s}/">{esc(n)}<span aria-hidden="true">&rarr;</span></a>'
                    for s, n, _, _ in CALCS if s != skip)
    return f'<section class="im-more"><h2>More calculators</h2><div class="im-more-links">{links}</div></section>'


def kit_strip():
    return ('<section class="im-kit"><div><b>Shots sorted. Now the kit.</b>'
            '<span>Drivers and irons at the lowest prices we’ve tracked, checked every 6 hours across multiple UK retailers.</span></div>'
            '<div class="im-kit-links"><a href="/prices/drivers/">Driver prices</a><a href="/prices/irons/">Iron prices</a>'
            '<a class="im-kit-dark" href="/find-your-fit.html">Find Your Fit &rarr;</a></div></section>')


def head(crumb_name, h1, lede):
    return (f'<div class="im-top"><nav class="im-crumbs" aria-label="Breadcrumb"><a href="/improve/">Improve</a> &rsaquo; {esc(crumb_name)}</nav>'
            f'<h1>{esc(h1)}</h1><p class="im-lede">{lede}</p></div>')


NOTE = '<p class="im-note">Nothing you type is saved or sent anywhere. Your official handicap is the one your club or national body holds.</p>'
SHARE = '<button type="button" class="im-share" data-share>Share with my four-ball</button>'


# ---------------------------------------------------------------- pages
def hub():
    cards = []
    samples = {
        "handicap-index-calculator": '<div class="im-bars" aria-hidden="true">' + "".join(
            f'<span class="{"on" if i % 2 else ""}" style="height:{h}%"></span>'
            for i, h in enumerate([60, 38, 72, 44, 88, 35, 64, 41, 79, 47, 58, 39])) + "</div>",
        "course-handicap-calculator": '<div class="im-eg"><span class="im-chip">Index 14.2</span><span>at slope 131</span><span>=</span><b>17 shots</b></div>',
        "playing-handicap-calculator": '<div class="im-eg im-eg-wrap"><span class="im-chip im-chip-dark">Stableford 95% &middot; 16</span><span class="im-chip">Fourball 85% &middot; 14</span><span class="im-chip">Matchplay 100% &middot; 17</span></div>',
        "what-do-i-need-to-shoot": '<div class="im-eg"><span>The score that cuts your index, and what every score from 65 to 115 would do</span></div>',
    }
    for slug, name, kick, line in CALCS:
        cards.append(f'<a class="im-card" href="/improve/{slug}/"><span class="im-kick">{kick}</span><b>{esc(name)}</b>'
                     f'<span class="im-card-line">{esc(line)}</span>{samples[slug]}<span class="im-go">Open the calculator &rarr;</span></a>')
    rows = "".join(f'<div><span>{esc(long)}</span><b>{pct}%</b></div>' for _, long, _, pct in ALLOWANCES)
    faqs = [
        ("How is a handicap index worked out?", "Under the World Handicap System your handicap index is the average of the best 8 score differentials from your most recent 20 rounds. A score differential is (113 ÷ slope rating) × (adjusted gross score − course rating − any playing conditions adjustment)."),
        ("What is the difference between a handicap index and a course handicap?", "Your handicap index travels with you. Your course handicap is how many shots that index is worth on a particular course and set of tees, using that tee’s slope rating and course rating."),
        ("Are these calculators free?", "Yes. They’re free, need no account and run entirely on your phone or computer, so nothing you type is saved or sent anywhere."),
    ]
    body = f"""<div class="im">
  <section class="im-hero">
    <div class="im-hero-copy">
      <span class="im-kick">IMPROVE</span>
      <h1>Know your numbers.<br><span>Then lower them.</span></h1>
      <p class="im-lede">Free handicap calculators that follow the World Handicap System. Work out your index, your shots on any course, and what you need to shoot to get cut. No sign-up, nothing saved.</p>
    </div>
    <form class="im-quick" data-calc="quick" onsubmit="return false">
      <span class="im-kick im-kick-light">QUICK CHECK</span>
      <div class="im-quick-grid">
        {field("q-index", "Handicap index", "14.2")}
        {field("q-slope", "Slope rating", "131", step="1", mode="numeric")}
        {field("q-diff", "Course rating − par", "0.6")}
      </div>
      <div class="im-quick-out"><b data-out="ch">17</b><span>shots on this course</span><a href="/improve/course-handicap-calculator/">Full calculator &rarr;</a></div>
    </form>
  </section>
  <section><h2 class="im-h2">The calculators</h2><div class="im-cards">{''.join(cards)}</div></section>
  <section class="im-split">
    <div class="im-box"><h2>Handicap allowances at a glance</h2><div class="im-table">{rows}</div>
      <p class="im-small">The recommended allowances under the World Handicap System. Your club or society can set its own.</p></div>
    <div class="im-dark"><span class="im-kick im-kick-light">ANOTHER HANDICAP WORTH HAVING</span><b>Your Price Handicap</b>
      <span class="im-dark-line">Play Par Price, guess real UK golf prices, and get a handicap for knowing a bargain when you see one.</span>
      <div class="im-dark-links"><a href="/play/par-price/">Play Par Price<span>&rarr;</span></a><a href="/societies/">Society HQ: run your society day<span>&rarr;</span></a><a href="/find-your-fit.html">Kit that suits your game, at today’s prices<span>&rarr;</span></a></div></div>
  </section>
  <section class="im-faqs"><h2 class="im-h2">Handicap questions</h2>{faq_html(faqs)}</section>
</div>"""
    title = "Golf Handicap Calculators UK: Index, Course & Playing Handicap | GolfPrice AI"
    desc = "Free UK golf handicap calculators that follow the World Handicap System: handicap index, course handicap, playing handicap and the score you need to get cut."
    coll = {"@context": "https://schema.org", "@type": "CollectionPage", "name": "Golf handicap calculators",
            "url": SITE + "/improve/", "description": desc,
            "hasPart": [{"@type": "WebApplication", "name": n, "url": f"{SITE}/improve/{s}/"} for s, n, _, _ in CALCS]}
    return "", page_shell(title=title, description=desc, canonical=SITE + "/improve/", body=body, section="improve",
                          schema=[crumbs("", ""), coll, faq_schema(faqs)], noindex=False, extra_head=EXTRA)


def course():
    slug, name = "course-handicap-calculator", "Course handicap calculator"
    faqs = [
        ("How do you work out a course handicap?", "Course handicap = handicap index × (slope rating ÷ 113) + (course rating − par), rounded to the nearest whole number. For example, an index of 14.2 on a tee with slope 131, course rating 72.6 and par 72 gives 14.2 × 1.159 + 0.6 = 17.06, so 17 shots."),
        ("Where do I find the slope rating and course rating?", "On the scorecard, the board by the first tee, or your club’s app. Every set of tees has its own ratings, and the men’s and women’s ratings for the same tees are different."),
        ("What is a slope rating?", "Slope measures how much harder a course plays for a higher handicapper than for a scratch golfer. It runs from 55 to 155, and 113 is a course of average difficulty."),
        ("What is the difference between course handicap and playing handicap?", "Your course handicap is your full allowance of shots on that course. Your playing handicap is what you actually play off in a competition, after the format’s allowance, such as 95% for individual stableford."),
    ]
    body = f"""<div class="im">
  {head(name, name, "How many shots you get on any course and tee in the UK. Put in your handicap index and the tee’s slope and course rating: you’ll find them on the scorecard or at the club.")}
  <form class="im-calc" data-calc="course" onsubmit="return false">
    <div class="im-inputs">
      <div class="im-grid2">
        {field("c-index", "Handicap index", "14.2", hint="Plus handicaps: put a minus, e.g. -1.5")}
        {field("c-slope", "Slope rating", "131", step="1", mode="numeric", hint="55 to 155. 113 is average.")}
        {field("c-rating", "Course rating", "72.6")}
        {field("c-par", "Par", "72", step="1", mode="numeric")}
      </div>
      <fieldset class="im-fs"><legend>What are you playing?</legend>{format_pills()}</fieldset>
      {NOTE}
    </div>
    <div class="im-result" aria-live="polite">
      <span class="im-kick im-kick-light">YOUR COURSE HANDICAP</span>
      <div class="im-big"><b data-out="ch">17</b><span>shots on this course</span></div>
      <div class="im-sub"><span class="im-kick im-kick-light">PLAYING HANDICAP &middot; <span data-out="fmt">STABLEFORD OR MEDAL</span></span>
        <div class="im-mid"><b data-out="ph">16</b><span><span data-out="pct">95</span>% allowance</span></div></div>
      <p class="im-working" data-out="working">14.2 &times; (131 &divide; 113) + (72.6 &minus; 72) = 17.06, rounded to 17</p>
      <div class="im-actions">{SHARE}<a class="im-ghost" href="/improve/handicap-index-calculator/">Work out my index</a></div>
    </div>
  </form>
  <section class="im-explain">
    <div><h2>How it’s worked out</h2><p>Your index is scaled by the slope (how much harder the course is for a higher handicapper), then the gap between course rating and par is added. Round to the nearest whole number.</p></div>
    <div><h2>Where do I find slope?</h2><p>On the scorecard, the board by the first tee, or your club’s app. Each set of tees has its own, and men’s and women’s ratings differ.</p></div>
    <div><h2>Running a society day?</h2><p>Society HQ handles fixtures, sign-ups and who’s paid for your whole group. <a href="/societies/">Try Society HQ &rarr;</a></p></div>
  </section>
  {kit_strip()}
  <section class="im-faqs"><h2 class="im-h2">Course handicap questions</h2>{faq_html(faqs)}</section>
  {more_calcs(slug)}
</div>"""
    title = "Course Handicap Calculator UK (WHS): Shots for Any Course | GolfPrice AI"
    desc = "Free WHS course handicap calculator: enter your handicap index, slope rating, course rating and par to see your shots and playing handicap for any UK course."
    return slug, page_shell(title=title, description=desc, canonical=f"{SITE}/improve/{slug}/", body=body, section="improve",
                            schema=[crumbs(name, slug), app_schema(name, slug, desc), faq_schema(faqs)], noindex=False, extra_head=EXTRA)


def playing():
    slug, name = "playing-handicap-calculator", "Playing handicap calculator"
    rows = "".join(f'<div><span>{esc(long)}</span><b>{pct}%</b></div>' for _, long, _, pct in ALLOWANCES)
    faqs = [
        ("How do you work out a playing handicap?", "Playing handicap = course handicap × handicap allowance, rounded to the nearest whole number. The allowance depends on the format: 95% for individual stroke play and stableford, 85% for fourball better ball, 100% for singles matchplay, 90% for fourball matchplay and 50% of the combined course handicaps for foursomes."),
        ("How many shots do I get in matchplay?", "In singles matchplay each player’s playing handicap is 100% of their course handicap, and the higher handicap receives the difference between the two on the stroke index holes."),
        ("Can my society use different allowances?", "Yes. These are the recommended allowances under the World Handicap System. A club or society can set its own for its competitions, so check the terms of the day."),
    ]
    body = f"""<div class="im">
  {head(name, name, "Your course handicap, adjusted for the format you’re playing. Add a partner or opponent to see the shots between you.")}
  <form class="im-calc" data-calc="playing" onsubmit="return false">
    <div class="im-inputs">
      <div class="im-grid2">
        {field("p-ch", "Your course handicap", "17", step="1", mode="numeric", hint="Not sure? Use the course handicap calculator.")}
        {field("p-ch2", "Partner or opponent (optional)", "", step="1", mode="numeric")}
      </div>
      <fieldset class="im-fs"><legend>What are you playing?</legend>{format_pills()}</fieldset>
      {NOTE}
    </div>
    <div class="im-result" aria-live="polite">
      <span class="im-kick im-kick-light">YOUR PLAYING HANDICAP &middot; <span data-out="fmt">STABLEFORD OR MEDAL</span></span>
      <div class="im-big"><b data-out="ph">16</b><span><span data-out="pct">95</span>% of <span data-out="ch">17</span></span></div>
      <div class="im-sub" data-out="pairbox" hidden><span class="im-kick im-kick-light" data-out="pairlabel">BETWEEN YOU</span>
        <div class="im-mid"><b data-out="pair">0</b><span data-out="pairline"></span></div></div>
      <p class="im-working" data-out="working">17 &times; 95% = 16.15, rounded to 16</p>
      <div class="im-actions">{SHARE}<a class="im-ghost" href="/improve/course-handicap-calculator/">Course handicap</a></div>
    </div>
  </form>
  <section class="im-box"><h2>Recommended handicap allowances</h2><div class="im-table">{rows}</div>
    <p class="im-small">Stableford uses the same allowances as stroke play. In foursomes the pair plays off 50% of their combined course handicaps.</p></section>
  {kit_strip()}
  <section class="im-faqs"><h2 class="im-h2">Playing handicap questions</h2>{faq_html(faqs)}</section>
  {more_calcs(slug)}
</div>"""
    title = "Playing Handicap Calculator UK: Stableford, Fourball & Matchplay | GolfPrice AI"
    desc = "Free playing handicap calculator with the WHS allowances: 95% stableford and medal, 85% fourball, 100% singles matchplay, 90% fourball matchplay, 50% foursomes."
    return slug, page_shell(title=title, description=desc, canonical=f"{SITE}/improve/{slug}/", body=body, section="improve",
                            schema=[crumbs(name, slug), app_schema(name, slug, desc), faq_schema(faqs)], noindex=False, extra_head=EXTRA)


def index_calc():
    slug, name = "handicap-index-calculator", "Handicap index calculator"
    rows = "".join(
        f'<div class="im-row" data-row><span class="im-rn">{i + 1}</span>'
        f'<input type="number" inputmode="numeric" aria-label="Round {i + 1} adjusted gross score" placeholder="Score">'
        f'<input type="number" inputmode="decimal" step="0.1" aria-label="Round {i + 1} course rating" placeholder="Rating">'
        f'<input type="number" inputmode="numeric" aria-label="Round {i + 1} slope rating" placeholder="Slope"></div>'
        for i in range(20))
    faqs = [
        ("How is my handicap index calculated?", "Each round gives a score differential: (113 ÷ slope rating) × (adjusted gross score − course rating − playing conditions adjustment). Your handicap index is the average of the best 8 differentials from your most recent 20 rounds, rounded to one decimal place."),
        ("What if I have fewer than 20 scores?", "You need at least 3. With 3 scores your index is the lowest differential minus 2.0; with 4, the lowest minus 1.0; 5, the lowest; 6, the average of the best 2 minus 1.0; 7 or 8, the best 2; 9 to 11, the best 3; 12 to 14, the best 4; 15 or 16, the best 5; 17 or 18, the best 6; 19, the best 7; and 20, the best 8."),
        ("What is an adjusted gross score?", "Your score after net double bogey: on any hole, the most you count is par + 2 + any shots you receive on that hole. Your club’s system does this for you, and the differential it shows already includes it."),
        ("Why might my official index be different?", "Your official index can also include a playing conditions adjustment, the soft and hard caps that limit how fast an index rises, and exceptional score reductions. This calculator gives the core figure, not those adjustments."),
    ]
    body = f"""<div class="im">
  {head(name, name, "Work out your handicap index the World Handicap System way. Enter up to 20 recent rounds, or paste the score differentials from your club app.")}
  <form class="im-calc" data-calc="index" onsubmit="return false">
    <div class="im-inputs">
      <div class="im-tabs" role="tablist">
        <button type="button" role="tab" aria-selected="true" data-tab="diffs">I have my differentials</button>
        <button type="button" role="tab" aria-selected="false" data-tab="scores">Enter scores</button>
      </div>
      <div data-panel="diffs">
        <label class="im-field" for="i-diffs"><span>Score differentials, newest first</span>
          <textarea id="i-diffs" rows="4" placeholder="e.g. 15.2, 18.7, 13.1, 16.4, 21.0 ...">15.2, 18.7, 13.1, 16.4, 21.0, 14.8, 17.3, 12.9, 19.5, 16.1, 14.2, 20.4, 15.9, 13.6, 18.1, 17.7, 14.5, 22.3, 16.8, 15.0</textarea>
          <small>Your club app or national body’s app lists one differential for each round. Separate them with commas or spaces.</small></label>
      </div>
      <div data-panel="scores" hidden>
        <div class="im-rows-head"><span></span><span>Adjusted score</span><span>Course rating</span><span>Slope</span></div>
        <div class="im-rows">{rows}</div>
      </div>
      {NOTE}
    </div>
    <div class="im-result" aria-live="polite">
      <span class="im-kick im-kick-light">YOUR HANDICAP INDEX</span>
      <div class="im-big"><b data-out="hi">14.2</b><span data-out="basis">best 8 of 20</span></div>
      <div class="im-chart" data-out="chart" aria-hidden="true"></div>
      <p class="im-working" data-out="working"></p>
      <div class="im-actions">{SHARE}<a class="im-ghost" href="/improve/course-handicap-calculator/">Shots on a course</a></div>
    </div>
  </form>
  {kit_strip()}
  <section class="im-faqs"><h2 class="im-h2">Handicap index questions</h2>{faq_html(faqs)}</section>
  {more_calcs(slug)}
</div>"""
    title = "Handicap Index Calculator UK (WHS): Best 8 of Your Last 20 | GolfPrice AI"
    desc = "Free WHS handicap index calculator: enter your scores, course and slope ratings, or paste your differentials, and see your index from your best 8 of the last 20."
    return slug, page_shell(title=title, description=desc, canonical=f"{SITE}/improve/{slug}/", body=body, section="improve",
                            schema=[crumbs(name, slug), app_schema(name, slug, desc), faq_schema(faqs)], noindex=False, extra_head=EXTRA)


def shoot():
    slug, name = "what-do-i-need-to-shoot", "What do I need to shoot?"
    faqs = [
        ("What score do I need to lower my handicap?", "When you post a new score, your oldest of the 20 drops off and the new one joins. Your index falls if the new set’s best 8 average is lower. That depends on which round drops off as well as your new score, which is why the target changes from round to round."),
        ("Why didn’t a good score cut my handicap?", "If the round dropping off was one of your best 8, a good new score may only replace it, leaving your index the same. The table on this page shows exactly what each score would do."),
        ("Does this include caps and playing conditions?", "No. It shows the core WHS calculation. Your official index can also be moved by a playing conditions adjustment on the day, the soft and hard caps, or an exceptional score reduction."),
    ]
    body = f"""<div class="im">
  {head(name, name, "Paste your last 20 score differentials and the tee you’re playing next. We show the score that brings your index down, and what every score from 65 to 115 would do.")}
  <form class="im-calc" data-calc="shoot" onsubmit="return false">
    <div class="im-inputs">
      <label class="im-field" for="s-diffs"><span>Your last 20 score differentials, newest first</span>
        <textarea id="s-diffs" rows="4">15.2, 18.7, 13.1, 16.4, 21.0, 14.8, 17.3, 12.9, 19.5, 16.1, 14.2, 20.4, 15.9, 13.6, 18.1, 17.7, 14.5, 22.3, 16.8, 15.0</textarea>
        <small>Your club app lists them. The last one in the list is the round that drops off next.</small></label>
      <div class="im-grid2">
        {field("s-rating", "Next round: course rating", "71.4")}
        {field("s-slope", "Next round: slope rating", "128", step="1", mode="numeric")}
      </div>
      {NOTE}
    </div>
    <div class="im-result" aria-live="polite">
      <span class="im-kick im-kick-light">TO CUT YOUR INDEX FROM <span data-out="now">14.2</span></span>
      <div class="im-big"><span class="im-pre">Shoot</span><b data-out="target">85</b><span>or better</span></div>
      <p class="im-working" data-out="working"></p>
      <div class="im-actions">{SHARE}<a class="im-ghost" href="/improve/handicap-index-calculator/">Index calculator</a></div>
    </div>
  </form>
  <section class="im-box"><h2>What each score would do</h2><p class="im-small">Adjusted gross score on that tee, and your new index if you post it.</p>
    <div class="im-scores" data-out="table"></div></section>
  {kit_strip()}
  <section class="im-faqs"><h2 class="im-h2">Getting cut: questions</h2>{faq_html(faqs)}</section>
  {more_calcs(slug)}
</div>"""
    title = "What Do I Need to Shoot to Lower My Handicap? WHS Calculator | GolfPrice AI"
    desc = "Free calculator: paste your last 20 score differentials and your next tee to see the score that lowers your WHS handicap index, and what every score would do."
    return slug, page_shell(title=title, description=desc, canonical=f"{SITE}/improve/{slug}/", body=body, section="improve",
                            schema=[crumbs(name, slug), app_schema(name, slug, desc), faq_schema(faqs)], noindex=False, extra_head=EXTRA)


def build():
    for fn in (hub, course, playing, index_calc, shoot):
        slug, html = fn()
        d = OUT / slug if slug else OUT
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(html, encoding="utf-8")
    print("improve: 5 pages written")


if __name__ == "__main__":
    build()
