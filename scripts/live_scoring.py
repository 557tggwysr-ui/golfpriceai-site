"""Live scoring for golf society days (built with every price run, called from society.build).

/societies/live-scoring/   the public page: what it is, how it works, a stableford
                           calculator and the questions organisers ask. Indexed,
                           with WebApplication, HowTo and FAQ schema.
/societies/live/           the live leaderboard (?c=<code>, ?tv=1 for the clubhouse TV).
/societies/live/score/     a group's scorecard (?t=<token>, the marker's link).

The two app pages are filled by js/live.js from the alerts worker (/lv/...) and
stay out of search: they only make sense with a society's own link.
"""
from price_pages import SITE, _write, breadcrumb, page_shell

LIVE_CSS = '<link rel="stylesheet" href="/css/live.css?v=20261101c">\n'
LIVE_JS = '<script src="/js/live.js?v=20261101d" defer></script>'
URL = f"{SITE}/societies/live-scoring/"

FEATURES = [
    "Live stableford scoring for golf society days, one phone per group",
    "Stableford points worked out from each golfer's playing handicap and the hole's stroke index",
    "A live leaderboard anyone can follow from one link, with ties, holes played and movers",
    "Birdies, eagles and lead changes in an 'On the course' feed",
    "Nearest the pin and longest drive entered on the course",
    "Works with no signal: scores save on the phone and send when back in range",
    "One-tap leaderboard picture and message for the society's WhatsApp group",
    "A clubhouse TV view with a QR code for the 19th hole",
    "Handicap allowance of 85%, 90%, 95% or 100%, with plus handicaps handled",
    "Course cards (par and stroke index) shared between societies, typed in once",
    "Publishes the Form Guide match report, the Order of Merit and National Society League points",
]

FAQS = [
    ("Is the live scoring free?",
     "Yes. Live scoring is part of Society HQ, GolfPrice AI’s free golf society organiser. No sign-up, no app to download and no fees for the society or its golfers."),
    ("Does everyone need the app?",
     "No app at all. One golfer in each group, the marker, opens their group’s scorecard link on their phone. Everyone else follows the leaderboard from one link in the WhatsApp group."),
    ("How are the stableford points worked out?",
     "From each golfer’s playing handicap and the stroke index of each hole. A golfer gets one shot on every hole whose stroke index is at or below their playing handicap, two shots on those holes once it’s over 18. Then it’s 2 points for a net par, 3 for a net birdie, 1 for a net bogey and none for worse or a pick-up."),
    ("What handicap allowance should a golf society use?",
     "England Golf and the World Handicap System recommend 95% of course handicap for individual stableford, and that’s the default. Societies can pick 85%, 90%, 95% or 100% when they set the day up."),
    ("What happens if there’s no signal on the course?",
     "The scorecard keeps working. Every score is saved on the marker’s phone first and sent as soon as there’s signal again, so a dead spot on the 7th doesn’t lose anything."),
    ("Where does the course card come from?",
     "The organiser checks the par and stroke index for each hole once. If another society has already typed in the same course, it’s filled in for them to check. The card is on the back of any scorecard from the club."),
    ("How do ties work on the leaderboard?",
     "Golfers on the same points share the position, shown as “=4” for example. When the results are published, the Form Guide report settles ties on countback over the back nine."),
    ("What happens when everyone’s finished?",
     "The organiser taps “Publish the results”. The scores lock, and the Form Guide writes the match report with the winner, the leaderboard, nearest the pin and longest drive. The day counts towards the society’s Order of Merit and, if the society has entered, the National Society League."),
    ("Who can see the scores?",
     "Anyone the society sends the leaderboard link to. It shows nicknames and points only: no names, emails or phone numbers. The scorecard links are for each group’s marker."),
]

STEPS = [
    ("Set up the golf day in Society HQ", "Create the society day as usual and members say they’re in."),
    ("Check the course card", "Confirm the par and stroke index for all 18 holes (shared between societies, so it’s often there already)."),
    ("Add handicaps and groups", "Each golfer’s course handicap is remembered from last time. Pick the allowance, then the groups and tee times."),
    ("Send the scorecard links", "Each group’s marker gets a scorecard link; everyone else gets the live leaderboard link in the WhatsApp group."),
    ("Score as you go", "The marker taps each golfer’s score at the end of every hole. Points, the leaderboard and the feed update themselves."),
    ("Publish the results", "When the last card’s in, the organiser publishes and the Form Guide match report writes itself."),
]


def _calc():
    return """<section class="soc-card">
  <h2>Stableford points calculator</h2>
  <p class="soc-help">How many points for a score on one hole. Use the golfer’s playing handicap (course handicap × allowance).</p>
  <div class="lvl-calc" id="lvl-calc">
    <label>Playing handicap<input type="number" inputmode="numeric" id="lvl-ph" value="18" min="-10" max="54"></label>
    <label>Hole par<input type="number" inputmode="numeric" id="lvl-par" value="4" min="3" max="6"></label>
    <label>Stroke index<input type="number" inputmode="numeric" id="lvl-si" value="7" min="1" max="18"></label>
    <label>Strokes taken<input type="number" inputmode="numeric" id="lvl-st" value="5" min="1" max="15"></label>
    <label>Handicap index<input type="number" inputmode="decimal" id="lvl-hi" placeholder="optional" step="0.1"></label>
    <label>Allowance %<input type="number" inputmode="numeric" id="lvl-al" value="95" min="50" max="100"></label>
  </div>
  <div class="lvl-out" id="lvl-out" aria-live="polite">A playing handicap of 18 gets 1 shot on a stroke index 7 hole. 5 on a par 4 is a net par: <b>2 points</b>.</div>
  <p class="soc-help">Got a handicap index instead? Work out the course handicap first with the <a href="/improve/">golf handicap calculator</a>.</p>
</section>
<script>
(function(){var $=function(i){return document.getElementById(i)};function n(i,d){var v=parseFloat($(i).value);return isNaN(v)?d:v}
function shots(ph,si){if(ph>=0)return Math.floor(ph/18)+((ph%18)>=si?1:0);var b=-ph;return-(Math.floor(b/18)+((b%18)>(18-si)?1:0))}
function go(){var hi=parseFloat($('lvl-hi').value),al=n('lvl-al',95);if(!isNaN(hi)){$('lvl-ph').value=Math.round(hi*al/100)}
var ph=Math.round(n('lvl-ph',0)),par=Math.round(n('lvl-par',4)),si=Math.min(18,Math.max(1,Math.round(n('lvl-si',1)))),st=Math.round(n('lvl-st',par));
var sh=shots(ph,si),net=st-sh,p=Math.max(0,par+sh-st+2),w=({'-3':'a net albatross','-2':'a net eagle','-1':'a net birdie','0':'a net par','1':'a net bogey'})[String(net-par)]||(net-par<-3?'a net hole-in-one or better':'a net double bogey or worse');
var s=sh>0?'gets '+sh+(sh===1?' shot':' shots'):sh<0?'gives '+(-sh)+(sh===-1?' shot':' shots')+' back':'gets no shots';
$('lvl-out').innerHTML='A playing handicap of '+ph+' '+s+' on a stroke index '+si+' hole. '+st+' on a par '+par+' is '+w+': <b>'+p+(p===1?' point':' points')+'</b>.'}
['lvl-ph','lvl-par','lvl-si','lvl-st','lvl-hi','lvl-al'].forEach(function(i){$(i).addEventListener('input',go)})})();
</script>"""


def landing_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Live scoring", None)])
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    howto = {"@context": "https://schema.org", "@type": "HowTo", "name": "How to run live scoring for a golf society day",
             "description": "Live stableford scoring and a live leaderboard for a golf society day, free with Society HQ.",
             "totalTime": "PT10M", "tool": [{"@type": "HowToTool", "name": "One phone per group"}],
             "step": [{"@type": "HowToStep", "position": i + 1, "name": n, "text": t, "url": URL + f"#step-{i + 1}"} for i, (n, t) in enumerate(STEPS)]}
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "Society HQ live scoring",
           "alternateName": ["Golf society live scoring", "Live golf society leaderboard", "GolfPrice AI live scoring"],
           "url": URL, "applicationCategory": "SportsApplication", "applicationSubCategory": "Golf scoring",
           "operatingSystem": "Any web browser",
           "description": "Free live stableford scoring for UK golf society days: one phone per group enters the scores, "
                          "everyone follows a live leaderboard from one WhatsApp link, and the results publish a match report, "
                          "Order of Merit and league points. No sign-up, no app, no fees.",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
           "featureList": FEATURES, "inLanguage": "en-GB", "isAccessibleForFree": True,
           "isPartOf": {"@type": "WebApplication", "name": "Society HQ", "url": f"{SITE}/societies/"},
           "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    steps = "".join(f'<li id="step-{i + 1}"><span><b>{n}.</b> {t}</span></li>' for i, (n, t) in enumerate(STEPS))
    faqs = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in FAQS)
    feats = "".join(f"<li>{f}</li>" for f in FEATURES)
    table = "".join(f"<tr><td>{a}</td><td>{b}</td></tr>" for a, b in [
        ("Net albatross (3 under)", "5 points"), ("Net eagle (2 under)", "4 points"), ("Net birdie (1 under)", "3 points"),
        ("Net par", "2 points"), ("Net bogey (1 over)", "1 point"), ("Net double bogey or worse, or picked up", "0 points")])
    body = f"""<div class="soc-wrap sh-wrap">
{crumbs_html}
<section class="soc-hero sh-hero">
  <span class="soc-kick">Free · Society HQ</span>
  <h1>Golf society live scoring: a free live leaderboard for your society day</h1>
  <p>One phone per group taps in the scores. Stableford points work themselves out, and the whole society follows the leaderboard live from one link in the WhatsApp group. No app, no sign-up, no fees.</p>
  <div class="soc-btns"><a class="soc-btn" href="/societies/hq/">Set up a society day</a><a class="soc-btn2 sh-btn-dark" href="/play/scorecard/">Quick round with mates</a></div>
</section>
<div class="sh-facts">
  <div><b>One phone</b><span>per group</span></div>
  <div><b>Live</b><span>leaderboard link</span></div>
  <div><b>Works offline</b><span>sends when in range</span></div>
</div>
<section class="soc-card" aria-label="What it looks like">
  <h2>What the society sees</h2>
  <div class="lvl-phones" aria-hidden="true">
    <div class="lvl-phone"><small style="color:#8fd97c;font-weight:700;letter-spacing:.12em">GROUP 2 · HOLE 7</small><b>Par 3 · Stroke index 15</b>
      <div class="lvl-r"><span>Big Dave</span><span>3 · 3 pts</span></div><div class="lvl-r"><span>Mo</span><span>3 · 2 pts</span></div><div class="lvl-r"><span>Gaz</span><span>2 · Birdie!</span></div></div>
    <div class="lvl-phone"><small style="color:#f08a24;font-weight:700;letter-spacing:.12em">LIVE · THRU 9</small><b>Autumn Stableford</b>
      <div class="lvl-r"><span>1 Big Dave</span><span>22</span></div><div class="lvl-r"><span>2 Mo</span><span>20</span></div><div class="lvl-r"><span>3 Gaz</span><span>19</span></div></div>
  </div>
  <p class="soc-help">An example society day. Every leaderboard shows nicknames and points only.</p>
</section>
<section class="soc-card" id="how">
  <h2>How to run live scoring for your golf society day</h2>
  <ol class="lvl-steps">{steps}</ol>
  <a class="soc-link-a" href="/societies/hq/">Open Society HQ &rarr;</a>
</section>
<section class="soc-card sh-feat">
  <h2>Everything live scoring does</h2>
  <ul>{feats}</ul>
</section>
<section class="soc-card">
  <h2>How stableford scoring works</h2>
  <p class="soc-help">Stableford is the format most UK golf societies play. Each golfer scores points on every hole against their own handicap, so a 28-handicapper and a 6-handicapper can win on the same day.</p>
  <table class="lvl-sum"><thead><tr><th>SCORE ON THE HOLE (AFTER SHOTS)</th><th>POINTS</th></tr></thead><tbody>{table}</tbody></table>
  <p class="soc-help">Shots come from the playing handicap and the hole’s stroke index: a playing handicap of 18 gets one shot on every hole, 24 gets two on the six hardest (stroke index 1 to 6) and one on the rest. Plus handicaps give shots back on the easiest holes. 36 points is playing to your handicap. Ties are usually settled on countback, starting with the best back nine.</p>
</section>
{_calc()}
<section class="soc-card sh-guides">
  <h2>More for golf society organisers</h2>
  <div class="sh-glinks"><a href="/societies/hq/"><b>Society HQ</b><span>Fixtures, sign-ups, who’s paid and live scoring, free.</span></a><a href="/societies/league/"><b>The National Society League</b><span>Every published day counts towards your division.</span></a><a href="/societies/guides/golf-society-handicap-systems/"><b>Golf society handicap systems</b><span>WHS allowances, winner cuts and points bands.</span></a><a href="/societies/guides/how-to-start-a-golf-society/"><b>How to start a golf society</b><span>Eight steps to your first golf day.</span></a><a href="/societies/guides/golf-society-apps-compared/"><b>Golf society apps compared</b><span>The organiser apps side by side.</span></a><a href="/societies/prize-fund-calculator/"><b>Prize fund calculator</b><span>How much prize money, and how to split it.</span></a></div>
</section>
<section class="soc-card sh-faq">
  <h2>Organisers ask</h2>
  {faqs}
</section>
<p class="gp-real">Live scoring is part of Society HQ, free for every UK golf society. Nicknames and points only; no money is taken or held by GolfPrice AI. <a href="/legal/privacy-policy.html">Privacy</a> · <a href="/societies/">Society HQ</a></p>
</div>"""
    return page_shell(title="Golf Society Live Scoring: Free Live Stableford Leaderboard | GolfPrice AI",
                      description="Free live scoring for golf society days: one phone per group, stableford points worked out from handicaps, and a live leaderboard for the WhatsApp group. Works with no signal. No app, no fees.",
                      canonical=URL, body=body, section="societies", schema=[crumbs_schema, app, howto, faq_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head='<link rel="stylesheet" href="/css/society.css?v=20261101g">\n' + LIVE_CSS)


def board_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Live leaderboard", None)])
    body = f"""<div class="lv" id="lv-board" aria-live="polite"><p class="soc-loading" style="padding:24px 16px">Getting the scores…</p></div>
<noscript><p>The live leaderboard needs JavaScript switched on. <a href="/societies/live-scoring/">About live scoring</a></p></noscript>
{LIVE_JS}"""
    return page_shell(title="Live leaderboard | Society HQ | GolfPrice AI",
                      description="A golf society day's live stableford leaderboard, from Society HQ.",
                      canonical=f"{SITE}/societies/live/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=LIVE_CSS)


def score_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Scorecard", None)])
    body = f"""<div class="lv lv-sc" id="lv-score"><p class="soc-loading" style="padding:24px 16px">Opening the scorecard…</p></div>
<noscript><p>The scorecard needs JavaScript switched on.</p></noscript>
{LIVE_JS}"""
    return page_shell(title="Scorecard | Society HQ | GolfPrice AI",
                      description="A group's live scorecard for a golf society day.",
                      canonical=f"{SITE}/societies/live/score/", body=body, section="societies", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=LIVE_CSS)


QR_FAQS = [
    ("Is the golf scorecard free?",
     "Yes. No sign-up, no app to download and no adverts in the way. GolfPrice AI earns a small commission when someone buys golf kit through its price links, which pays for it."),
    ("Does everyone need to download an app?",
     "No. It runs in the phone’s browser. One golfer starts the round and sends one link to the group chat: anyone in the four-ball can keep score, and anyone else can follow the live leaderboard."),
    ("What games can we play?",
     "Stableford (everyone for themselves), better-ball pairs (2 v 2, the best stableford score of each pair counts on every hole) and skins (the lowest net score wins the hole outright; a tie carries the skin on to the next). Better-ball also shows the individual stableford."),
    ("How are handicaps worked out?",
     "Type each golfer’s course handicap for the tees you’re playing. The scorecard takes the allowance (95% by default, as the World Handicap System suggests for stableford) and gives shots on the holes by stroke index. Plus handicaps give shots back on the easiest holes."),
    ("Does it work with no signal?",
     "Yes. Scores save on the phone first and send when there’s signal again."),
    ("Can I keep my own golf stats?",
     "Yes. Tap your name on the leaderboard (“Which one are you?”) and the round goes into My Game: points per round, par 3s, 4s and 5s, front and back nine, and your best and worst holes on a course you play often. Add fairways and putts on your own phone for sharper stats."),
    ("What if we play every week?",
     "The scorecard remembers your group on your phone, so next time it’s one tap. If your group plays regularly, Society HQ turns it into a free golf society with fixtures, who’s paid, an Order of Merit and the National Society League."),
]


def scorecard_page():
    url = f"{SITE}/play/scorecard/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("The Clubhouse", "/play/"), ("Golf scorecard", None)])
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in QR_FAQS]}
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "GolfPrice AI live golf scorecard",
           "alternateName": ["Free golf scorecard app", "Live golf scorecard for friends", "Stableford scorecard app", "Better-ball and skins scorecard"],
           "url": url, "applicationCategory": "SportsApplication", "applicationSubCategory": "Golf scoring", "operatingSystem": "Any web browser",
           "description": "A free live golf scorecard for a round with friends: stableford, better-ball pairs or skins, points worked out from handicaps, a live leaderboard for the WhatsApp group, and free personal golf stats. No app, no sign-up.",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}, "isAccessibleForFree": True, "inLanguage": "en-GB",
           "featureList": ["Stableford, better-ball pairs and skins", "Shots by stroke index from each golfer's handicap, plus handicaps handled",
                           "One link for the group chat: anyone in the four-ball can score", "Live leaderboard and result picture for WhatsApp",
                           "Works with no signal", "Remembers your four for next time", "Free golf stats in My Game: points trend, par 3s/4s/5s, front v back nine, hole-by-hole map",
                           "Optional fairways and putts"],
           "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    howto = {"@context": "https://schema.org", "@type": "HowTo", "name": "How to keep a live golf scorecard with friends",
             "totalTime": "PT1M", "step": [{"@type": "HowToStep", "position": i + 1, "name": n, "text": t} for i, (n, t) in enumerate([
                 ("Pick the course", "Start typing the course; the par and stroke index fill themselves in if another golfer has played it."),
                 ("Add the golfers", "Nicknames and course handicaps, and tick which one is you."),
                 ("Choose the game", "Stableford, better-ball pairs or skins."),
                 ("Send one link", "Send the scorecard and leaderboard links to the group chat."),
                 ("Score as you go", "Tap each golfer’s score at the end of every hole; the points and leaderboard update themselves."),
             ])]}
    faqs = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in QR_FAQS)
    body = f"""<div class="soc-wrap sh-wrap">
{crumbs_html}
<section class="soc-hero sh-hero">
  <span class="soc-kick">Free · no app · no sign-up</span>
  <h1>Free live golf scorecard for you and your mates</h1>
  <p>Stableford, better-ball pairs or skins. The points work themselves out from your handicaps, the group chat follows a live leaderboard, and your own stats build up round by round.</p>
</section>
<div id="qr" aria-live="polite"><p class="soc-loading">Getting the scorecard…</p></div>
<noscript><p>The scorecard needs JavaScript switched on.</p></noscript>
<section class="soc-card sh-feat">
  <h2>What the scorecard does</h2>
  <ul><li>Stableford, better-ball pairs (2 v 2) and skins, with handicap shots by stroke index</li><li>One link for the WhatsApp group: anyone in the four-ball can score, everyone else follows live</li><li>Works with no signal: saves on the phone, sends when you’re back in range</li><li>A result picture for the group chat when you’re done</li><li>Remembers your four for next time</li><li>Free stats in <a href="/improve/my-game/">My Game</a>: your points trend, par 3s, 4s and 5s, front v back nine, and your nemesis holes</li></ul>
</section>
<section class="soc-card">
  <h2>The games, in a sentence each</h2>
  <p class="soc-help"><b>Stableford:</b> points on every hole against your handicap: 2 for a net par, 3 for a net birdie, 1 for a net bogey. 36 is playing to your handicap.</p>
  <p class="soc-help"><b>Better-ball pairs:</b> two against two; on every hole the better stableford score of each pair counts, so one good hole from either partner is enough.</p>
  <p class="soc-help"><b>Skins:</b> each hole is worth a skin; the lowest net score wins it outright. Tie, and the skin carries over, so the next hole is worth two.</p>
  <p class="soc-help">Working out points by hand? The <a href="/societies/live-scoring/#lvl-calc">stableford points calculator</a> does one hole at a time.</p>
</section>
<section class="soc-card sh-guides">
  <h2>More for golfers who play together</h2>
  <div class="sh-glinks"><a href="/societies/live-scoring/"><b>Society live scoring</b><span>For society days: groups, markers and the match report.</span></a><a href="/play/leagues/"><b>Leagues for your group chat</b><span>Take on your mates at the daily price games.</span></a><a href="/play/poll/"><b>Group poll</b><span>Which Saturday? Which course? One tap to vote.</span></a><a href="/fourball/"><b>Fourball Alerts</b><span>Shared price alerts for your four-ball.</span></a><a href="/improve/shot-saver/"><b>Shot Saver</b><span>Where do your shots really go?</span></a></div>
</section>
<section class="soc-card sh-faq">
  <h2>Golfers ask</h2>
  {faqs}
</section>
<p class="gp-real">Nicknames and points only. Your stats are kept against your phone’s random player number; nobody else sees them. <a href="/legal/privacy-policy.html">Privacy</a></p>
</div>
<script src="/js/quick-round.js?v=20261101c" defer></script>"""
    return page_shell(title="Free Golf Scorecard App: Live Stableford, Better-Ball & Skins | GolfPrice AI",
                      description="A free live golf scorecard for a round with friends: stableford, better-ball pairs or skins, worked out from handicaps, with a live leaderboard for the group chat and your own golf stats. No app, no sign-up.",
                      canonical=url, body=body, section="play", schema=[crumbs_schema, app, howto, faq_schema],
                      noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head='<link rel="stylesheet" href="/css/society.css?v=20261101g">\n' + LIVE_CSS)


def quick_board_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Golf scorecard", "/play/scorecard/"), ("Live leaderboard", None)])
    body = f"""<div class="lv" id="lv-board" aria-live="polite"><p class="soc-loading" style="padding:24px 16px">Getting the scores…</p></div>
<noscript><p>The live leaderboard needs JavaScript switched on.</p></noscript>
{LIVE_JS}"""
    return page_shell(title="Live leaderboard | Golf scorecard | GolfPrice AI", description="A round’s live golf leaderboard.",
                      canonical=f"{SITE}/play/scorecard/live/", body=body, section="play", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=LIVE_CSS)


def quick_card_page():
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Golf scorecard", "/play/scorecard/"), ("Scorecard", None)])
    body = f"""<div class="lv lv-sc" id="lv-score"><p class="soc-loading" style="padding:24px 16px">Opening the scorecard…</p></div>
<noscript><p>The scorecard needs JavaScript switched on.</p></noscript>
{LIVE_JS}"""
    return page_shell(title="Scorecard | GolfPrice AI", description="A live golf scorecard.",
                      canonical=f"{SITE}/play/scorecard/card/", body=body, section="play", schema=[crumbs_schema],
                      noindex=True, og_image="/assets/cards/society-hq.jpg", extra_head=LIVE_CSS)


MG_FAQS = [
    ("Where do the stats come from?", "From every round you score on the free live scorecard, a quick round with friends or a society day, where you’ve tapped your name. Each hole’s score, your playing handicap and the hole’s par and stroke index give your stableford points."),
    ("Do I need an account?", "No. Your rounds are kept against your phone’s random player number. Save a Clubhouse key in My Clubhouse and they come with you to a new phone."),
    ("Can I track fairways and putts?", "Yes. Tick “Extra detail for me” at the bottom of the scorecard and it asks for your fairway and putts on each hole, on your own line only. A full detailed round can go straight into Shot Saver."),
    ("Who can see my stats?", "Only you. The leaderboard your group sees shows nicknames and points for that round; My Game is yours alone."),
]


def my_game_page():
    url = f"{SITE}/improve/my-game/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Improve", "/improve/"), ("My Game", None)])
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in MG_FAQS]}
    app = {"@context": "https://schema.org", "@type": "WebApplication", "name": "My Game: free golf stats",
           "alternateName": ["Free golf stats tracker", "Stableford stats"], "url": url, "applicationCategory": "SportsApplication", "operatingSystem": "Any web browser",
           "description": "Free golf stats from the rounds you score live: stableford points per round, par 3s, 4s and 5s, front v back nine, a hole-by-hole map of your home course, fairways and putts, and your Shot Saver leaks. No sign-up.",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}, "isAccessibleForFree": True, "inLanguage": "en-GB",
           "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    faqs = "".join(f'<details class="sh-q"><summary>{q}</summary><p>{a}</p></details>' for q, a in MG_FAQS)
    body = f"""<div class="mg-wrap">
<div style="padding:0 16px">{crumbs_html}</div>
<div id="mg" aria-live="polite"><section class="mg-hero"><span class="mg-k">MY GAME</span><h1>Free golf stats from the rounds you play</h1><p>Points per round, par 3s, 4s and 5s, front v back nine and your nemesis holes, from the live scorecard. No sign-up.</p></section><p class="soc-loading" style="padding:16px">Adding up your rounds…</p></div>
<noscript><p>My Game needs JavaScript switched on.</p></noscript>
<div class="mg-main"><section class="mg-card"><h2 class="mg-h" style="margin:0">How My Game works</h2>{faqs}</section>
<p class="mg-small" style="text-align:center"><a href="/play/scorecard/">Start a quick round</a> · <a href="/improve/shot-saver/">Shot Saver</a> · <a href="/play/my-clubhouse/">My Clubhouse</a></p></div>
</div>
<script src="/js/shot-saver-core.js?v=20261101" defer></script>
<script src="/js/my-game.js?v=20261101a" defer></script>"""
    return page_shell(title="My Game: Free Golf Stats Tracker | GolfPrice AI",
                      description="Free golf stats from the rounds you score live: your stableford trend, par 3s, 4s and 5s, front v back nine and a hole-by-hole map of your course. No app, no sign-up.",
                      canonical=url, body=body, section="improve", schema=[crumbs_schema, app, faq_schema],
                      noindex=False, extra_head='<link rel="stylesheet" href="/css/society.css?v=20261101g">\n<link rel="stylesheet" href="/css/my-game.css?v=20261101a">\n')


def build(root):
    changed = []
    for path, html in [("societies/live-scoring/index.html", landing_page()), ("societies/live/index.html", board_page()),
                       ("societies/live/score/index.html", score_page()), ("play/scorecard/index.html", scorecard_page()),
                       ("play/scorecard/live/index.html", quick_board_page()), ("play/scorecard/card/index.html", quick_card_page()),
                       ("improve/my-game/index.html", my_game_page())]:
        if _write(root / path, html):
            changed.append("/" + path.replace("index.html", ""))
    return changed
