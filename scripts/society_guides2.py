"""Golf society guides, part two: how to run a golf society, prize ideas,
handicap systems, what a society day costs (with the day cost calculator),
a rules template and golf society apps compared.

Same rules as society_guides.py: a short quotable answer first, "golf
society" in the title, first line and headings, the date it was updated, a
tool built in, and nothing invented. Venue prices are from published 2026
society rates at English golf clubs; app facts are from each app's own pages
or launch coverage, checked on the date shown.
"""
from html import escape as e

from price_pages import SITE, breadcrumb, page_shell
import society_guides as sg

CHECKED = "24 October 2026"


def guide(today, slug, title, h1, answer, desc, sections, faqs, ctas="", scripts="", extra_schema=None):
    url = f"{SITE}/societies/guides/{slug}/"
    crumbs_html, crumbs_schema = breadcrumb([("Home", "/"), ("Society HQ", "/societies/"), ("Golf society guides", "/societies/guides/"),
                                             (title, None)])
    faq_html, faq_schema = sg.faq_block(faqs)
    toc = " · ".join(f'<a href="#{sid}">{e(h)}</a>' for sid, h, _ in sections) + ' · <a href="#faq">Questions</a>'
    body_sections = "\n".join(f'<section class="soc-card gd-sec" id="{sid}"><h2>{e(h)}</h2>{html}</section>' for sid, h, html in sections)
    body = f"""<div class="soc-wrap gd-wrap">
{crumbs_html}
<section class="soc-hero">
  <span class="soc-kick">Golf society guide · Updated {sg.nice_date(today)}</span>
  <h1>{e(h1)}</h1>
  <p class="gd-answer">{answer}</p>
  {ctas}
</section>
<nav class="soc-card gd-toc" aria-label="On this page"><b>On this page</b>{toc}</nav>
{body_sections}
<section class="soc-card sh-faq" id="faq">
  <h2>{e(title)}: questions organisers ask</h2>
  {faq_html}
</section>
<section class="soc-card soc-next">
  <span class="soc-kick">Free for every UK golf society</span>
  <h2>Society HQ: the free golf society organiser</h2>
  <p>Fixtures, in, out or maybe sign-ups, a waiting list, who’s paid and awards night, from one link in your golf society’s WhatsApp group.</p>
  <a class="soc-btn" href="/societies/hq/">Start your golf society free</a>
</section>
<p class="gd-more"><b>More for golf societies:</b> {sg.more_links(f"/societies/guides/{slug}/")}</p>
</div>
{scripts}"""
    schema = [crumbs_schema, sg.article_schema(url, h1, desc, today), faq_schema] + (extra_schema or [])
    return page_shell(title=f"{title} | GolfPrice AI" if len(title) < 52 else title + " | GolfPrice AI", description=desc, canonical=url, body=body,
                      section="societies", schema=schema, noindex=False, og_image="/assets/cards/society-hq.jpg", extra_head=sg.CSS)


def steps(items):
    return '<ol class="gd-steps">' + "".join(f"<li><b>{t}</b> {d}</li>" for t, d in items) + "</ol>"


def table(head, rows, cls="gd-table"):
    return (f'<div class="gd-tw"><table class="{cls}"><thead><tr>' + "".join(f"<th scope=\"col\">{h}</th>" for h in head) + "</tr></thead><tbody>" +
            "".join("<tr>" + "".join((f'<th scope="row">{c}</th>' if i == 0 else f"<td>{c}</td>") for i, c in enumerate(r)) + "</tr>" for r in rows) +
            "</tbody></table></div>")


# ---------------------------------------------------------------- 1. how to run a golf society
def run_guide(today):
    sections = [
        ("start", "Start a golf society in five steps", steps([
            ("Decide who it’s for.", "Mates from work, the pub or the school gate? Fix how often you’ll play (monthly from April to September suits most golf societies), whether you need an official handicap to join, and roughly how many golfers you’re aiming for. Sixteen to 24 is a comfortable number for booking society rates."),
            ("Write a short set of rules.", "Fees, how payment works, what happens if someone drops out, how handicaps work and how ties are settled. Our <a href=\"/societies/guides/golf-society-rules-template/\">golf society rules template</a> is ready to copy into your WhatsApp group."),
            ("Set the society fee.", "Most golf societies charge the green fee and food at cost, plus a small society entry (often £5 to £15) for prizes, the trophy fund and the odd drop-out. The <a href=\"/societies/guides/how-much-to-charge-for-a-golf-society-day/\">society day cost guide</a> has a calculator."),
            ("Book the venues early.", "Golf clubs take society bookings months ahead, and the best spring and summer dates go first. Most want a minimum group size (we’ve seen 8, 12 and 16 in published 2026 society rates), a deposit and final numbers before the day."),
            ("Put it all in one link.", "Use <a href=\"/societies/hq/\">Society HQ</a> to list the fixtures and send one link to the group: members tap in, out or maybe, the waiting list sorts itself and you tick who’s paid."),
        ])),
        ("season", "A golf society season, month by month", table(["When", "What the organiser does"], [
            ["October to December", "End-of-season awards night (see <a href=\"/societies/guides/golf-society-awards-ideas/\">golf society awards ideas</a>), agree next year’s rules and fee."],
            ["November to January", "Pick dates, ask clubs for society packages, pay deposits, publish the fixture list."],
            ["February to March", "Open sign-ups for the first golf days, chase payments, confirm the format for each day."],
            ["April to September", "The golf: send final numbers to each club, run the day, post results and the Order of Merit."],
            ["Every society day", "Final numbers to the club, tee times out the day before, scores in, prizes handed out, photos in the group."],
        ])),
        ("day", "Running a golf society day", steps([
            ("Final numbers to the club.", "Most clubs ask for final numbers and any food choices a week or two before. Only count players who have paid; in Society HQ the “final numbers” message lists who still owes."),
            ("Tee times and groups.", "Mix the groups so new members play with regulars. Send the tee sheet the night before."),
            ("Scorecards and the format.", "Stableford is the society favourite: a bad hole only costs you that hole. Agree handicap allowances in advance (see <a href=\"/societies/guides/golf-society-handicap-systems/\">golf society handicap systems</a>)."),
            ("Side prizes.", "Nearest the pin on a par 3 and longest drive on a straight par 4 or 5 keep every group interested. Mark them before the first group tees off."),
            ("Results and prizes.", "Announce the winners at the meal, settle ties by countback (last 9, 6, 3, then 1) and post the results in the group. The <a href=\"/societies/prize-fund-calculator/\">prize fund calculator</a> works out the split."),
        ])),
        ("money", "Handling golf society money", "<p>Keep it simple and visible. Collect from members before the day (“not paid, not playing”), pay the club from one account, and keep a running note of the prize fund and any kitty. Members can pay the organiser directly with Society HQ’s <b>Pay the organiser</b> button, which opens your own PayPal.me, Monzo.me or Revolut.me link; GolfPrice AI never touches the money.</p>"),
    ]
    faqs = [
        ("How many people do you need to start a golf society?", "You can start with a single four-ball, but most golf clubs’ society rates need a minimum group, commonly between 8 and 16 golfers, so aim for 12 to 24 members if you want society prices."),
        ("Do golf society members need an official handicap?", "Not usually. Many golf societies use official handicap indexes for members who have one and a society handicap for those who don’t. Our guide to <a href=\"/societies/guides/golf-society-handicap-systems/\">golf society handicap systems</a> explains the options."),
        ("How much does it cost to run a golf society?", "Running it can be free. Members pay the green fee and food for each day, usually £45 to £75 a head with food, plus a small society entry for prizes. Society HQ is free and needs no sign-up."),
        ("What format do golf societies play?", "Individual Stableford is by far the most common golf society format, with nearest the pin and longest drive as side prizes. Pairs or team formats like a Texas scramble make a good change for one day a year."),
    ]
    ctas = '<div class="soc-btns"><a class="soc-btn" href="/societies/hq/">Start your golf society free</a><a class="soc-btn2 sh-btn-dark" href="/societies/guides/golf-society-rules-template/">Get the rules template</a></div>'
    return guide(today, "how-to-run-a-golf-society", "How to run a golf society",
                 "How to run a golf society: the organiser’s complete guide",
                 "To run a golf society, agree a few simple rules, book venues months ahead at society rates, collect money before each day and keep sign-ups, payments and results in one place. Most golf societies play monthly Stableford from April to September and finish with an awards night.",
                 "How to run a golf society in the UK: starting one, booking golf clubs, collecting money, running a society day, results and the awards night. Free tools included.",
                 sections, faqs, ctas)


# ---------------------------------------------------------------- 2. prize ideas
def prizes_guide(today, bands):
    if bands:
        live = '<div class="gd-bands">' + "".join(
            f'<div class="gd-band"><b>Around {sg.money(b)}</b><ul>' + "".join(
                f'<li><span>{e(p["cat"])}: ' + (f'<a href="{e(p["url"])}" rel="sponsored nofollow noopener" target="_blank">{e(p["name"])}</a>' if p["url"] else e(p["name"])) +
                f'</span><b>{sg.money(p["price"])}</b></li>' for p in picks) + '</ul></div>' for b, picks in bands) + "</div>"
        live = f'<p class="soc-help">Real examples at today’s lowest UK price, checked {sg.nice_date(today)} across multiple UK retailers. Prices can change on the retailer’s site.</p>' + live
    else:
        live = ""
    sections = [
        ("budget", "Golf society prizes by budget", live + table(["Budget", "Good golf society prizes"], [
            ["Under £10", "A sleeve of premium balls, ball markers, a pitch-mark tool, a towel, a novelty headcover"],
            ["£10 to £25", "A dozen golf balls, a good glove, a magnetic towel, a golf umbrella"],
            ["£25 to £50", "A dozen tour balls, a premium glove pack, a quality umbrella or headcover set"],
            ["£50 and over", "A rangefinder or GPS voucher fund, a golf lesson, a round at a better course"],
        ])),
        ("ideas", "Golf society prize ideas that people actually want", '<ul class="gd-ul">' + "".join(f"<li><b>{t}</b> {d}</li>" for t, d in [
            ("Golf balls.", "The safest golf society prize: everyone loses them. A dozen of a ball the winner already plays beats a random brand."),
            ("Gloves.", "Most golfers get through several a season. Ask sizes when people sign up."),
            ("Let the winner choose.", "Give each place a budget and let the winner pick their own prize. Society HQ’s Prize Picker does this at today’s lowest UK price, and you get one shopping list."),
            ("Experiences.", "A lesson with the pro, a range card or a round somewhere special works well for the season’s big trophy."),
            ("Trophies that travel.", "A perpetual trophy, engraved each year, matters more to most golf societies than the prize money."),
            ("Booby prizes.", "A wooden spoon, a box of “found” balls, or a rule book for the bandit. Keep it kind."),
        ]) + "</ul>"),
        ("fund", "How to pay for golf society prizes", "<p>Most golf societies put 30% to 40% of the society entry into prizes on the day, and keep a little back for the end-of-season trophies. Our <a href=\"/societies/prize-fund-calculator/\">golf society prize fund calculator</a> works out the pot and the split for 1st, 2nd, 3rd, nearest the pin and longest drive. For the season’s awards, see <a href=\"/societies/guides/golf-society-awards-ideas/\">golf society awards ideas</a>.</p>"),
    ]
    faqs = [
        ("What is a good prize for a golf society day?", "A dozen golf balls or a good glove for the winner, with smaller prizes for second, third, nearest the pin and longest drive. Most golf societies spend £15 to £50 on the winner’s prize."),
        ("Should golf society prizes be cash or vouchers?", "Many golf societies avoid cash and give golf kit or vouchers instead. Letting each winner choose their own kit within a budget is popular and avoids a cupboard of unwanted headcovers."),
        ("How much should a golf society spend on prizes?", "A common rule is 30% to 40% of the society entry money on each day’s prizes, with a separate small fund for the end-of-season trophies."),
    ]
    ctas = '<div class="soc-btns"><a class="soc-btn" href="/societies/awards/">Let winners pick their prize</a><a class="soc-btn2 sh-btn-dark" href="/societies/prize-fund-calculator/">Prize fund calculator</a></div>'
    return guide(today, "golf-society-prize-ideas", "Golf society prize ideas",
                 "Golf society prize ideas and budgets",
                 "The best golf society prizes are things golfers use up: golf balls, gloves and towels, at £10 to £50 a place, with a trophy for the season. Most golf societies spend 30% to 40% of the entry money on prizes, and many now let the winner choose.",
                 "Golf society prize ideas by budget, with real examples at today’s lowest UK prices, how much to spend and how to fund the prize pot. Free prize fund calculator.",
                 sections, faqs, ctas)


# ---------------------------------------------------------------- 3. handicap systems
def handicap_guide(today):
    sections = [
        ("options", "The four golf society handicap systems", table(["System", "How it works", "Good for", "Watch out for"], [
            ["Official handicap index", "Members use their World Handicap System index and the course’s playing handicap. The WHS recommends a 95% allowance for individual Stableford and stroke play.", "Societies where most members have an official handicap", "Players without one need a society handicap anyway"],
            ["Winner cut", "The winner is cut 2 shots, everyone else goes up 1 (or stays put).", "Spreading the wins around", "Can feel harsh on a genuinely improving player"],
            ["Points bands", "Adjust after each day by Stableford points, for example under 20 points +2, 21 to 29 +1, 30 to 36 no change, 37 to 38 −1, 39 and over −2.", "Fairness without maths", "Needs a cap, say 36, and clear records"],
            ["Average of recent scores", "Handicap set from a player’s recent society scores, for example par minus the average of their best and most recent rounds on the same course.", "Societies that play one home course", "Harder to run across different courses"],
        ])),
        ("rules", "Golf society handicap rules that stop the arguments", steps([
            ("New players play one round first.", "Unless they have an official index, a new member’s first round sets their society handicap and they can’t win on debut."),
            ("Set a maximum.", "Many golf societies cap society handicaps at 36 (men) so nobody runs away with it."),
            ("Write everything down.", "Keep a record of every handicap change and why. Memories are, let’s say, generous."),
            ("Review once a year.", "Look at anyone who hasn’t won in two seasons or has won three times; adjust before the first fixture."),
            ("Publish the rules.", "Put the handicap rules in your <a href=\"/societies/guides/golf-society-rules-template/\">golf society rules</a> before the season starts, never after a contentious result."),
        ])),
        ("official", "Do golf society rounds count for an official handicap?", "<p>Sometimes. In Great Britain and Ireland, a player with an official handicap index can usually submit a society round as a general play score through their home club’s app, if they register it before they tee off and play with a marker. A golf society can’t issue official handicaps itself. Check your home club’s rules and your national golf union’s guidance before relying on it.</p>"),
    ]
    faqs = [
        ("What handicap system do golf societies use?", "Most UK golf societies use members’ official handicap indexes where they have them, plus a simple society handicap such as a winner cut (winner −2, others +1) or Stableford points bands for everyone else."),
        ("What is a winner cut in a golf society?", "After each society day the winner’s society handicap is cut, typically by 2 shots, and sometimes everyone else goes up by 1. It stops the same player winning every month."),
        ("What handicap allowance should a golf society use?", "For individual Stableford, the World Handicap System recommends 95% of each player’s course handicap. Many golf societies simply use 100% to keep it easy; the important thing is to agree it before the season."),
        ("Can a golf society give official handicaps?", "No. Official handicap indexes come from affiliated golf clubs. A golf society can run its own society handicap for its competitions."),
    ]
    return guide(today, "golf-society-handicap-systems", "Golf society handicap systems",
                 "Golf society handicap systems explained",
                 "Most golf societies use members’ official handicaps where they have them, with a simple society system for everyone else: a winner cut (winner −2, others +1), Stableford points bands, or an average of recent scores. Write the rules down before the season and keep a record of every change.",
                 "Golf society handicap systems compared: official WHS index, winner cut, Stableford points bands and averages, with the rules that stop arguments.",
                 sections, faqs)


# ---------------------------------------------------------------- 4. society day cost + calculator
def cost_guide(today):
    calc = """<form class="dc-form" id="dc" novalidate onsubmit="return false">
  <div class="dc-grid">
    <label>Players<input id="dc-n" inputmode="numeric" value="20"></label>
    <label>Green fee per player (£)<input id="dc-g" inputmode="decimal" value="40"></label>
    <label>Food per player (£)<input id="dc-f" inputmode="decimal" value="22"></label>
    <label>Society entry for prizes (£)<input id="dc-e" inputmode="decimal" value="10"></label>
  </div>
  <label class="soc-check"><input type="checkbox" id="dc-r" checked> Round each player’s total up to the nearest pound</label>
</form>
<div class="hq-fund dc-out" id="dc-out" aria-live="polite"><noscript><p>The calculator needs JavaScript: a typical golf society day is green fee + food + society entry per head.</p></noscript></div>"""
    sections = [
        ("calculator", "Golf society day cost calculator", calc),
        ("typical", "What a golf society day costs in 2026", "<p>From published 2026 society rates at English golf clubs we checked:</p>" + table(["What’s included", "Typical price per golfer"], [
            ["18 holes only (society green fee)", "£30 to £55, cheaper in winter and midweek"],
            ["Coffee and bacon roll, 18 holes", "£47 to £55"],
            ["Coffee and bacon roll, 18 holes, two-course meal", "£67 to £75"],
            ["27 or 36 holes, lunch and a meal", "£70 to £99"],
            ["Society entry (prizes and trophies)", "£5 to £15, set by the golf society"],
        ]) + "<p class=\"soc-help\">Most clubs need a minimum group (we saw 8, 12 and 16) for society rates. Prices vary a lot by region, course and season; always confirm with the club.</p>"),
        ("charge", "How much to charge members", steps([
            ("Start from the club’s price.", "Green fee plus food per head, from the club’s society package."),
            ("Add the society entry.", "£5 to £15 per player for prizes on the day and the end-of-season trophies. The <a href=\"/societies/prize-fund-calculator/\">prize fund calculator</a> shows what that buys."),
            ("Round up, don’t pad.", "Round to a tidy figure for easy payments and say where any extra goes. Members trust a society that shows its sums."),
            ("Set a drop-out rule.", "Once final numbers go to the club, the society usually still pays for that place, so the member who drops out pays too unless someone takes their spot."),
        ])),
    ]
    faqs = [
        ("How much does a golf society day cost per person?", "Usually £45 to £75 per golfer for 18 holes with a bacon roll and a meal, plus a society entry of £5 to £15 for prizes. Green fee only society rates are commonly £30 to £55."),
        ("Do golf clubs give discounts to societies?", "Yes. Most golf clubs offer society rates or packages for groups above a minimum size, often 8 to 16 golfers, usually with a deposit and final numbers before the day."),
        ("When do golf societies book their venues?", "Months ahead. Many organisers book the following season between November and January, when clubs release society dates and the popular weekends are still free."),
        ("What if a golf society member drops out?", "Most golf societies say that once final numbers are with the club, a drop-out still pays unless their place is filled from the waiting list. Put it in your rules before the season."),
    ]
    ctas = '<div class="soc-btns"><a class="soc-btn" href="#calculator">Work out your day</a><a class="soc-btn2 sh-btn-dark" href="/societies/hq/">Run the sign-ups free</a></div>'
    return guide(today, "how-much-to-charge-for-a-golf-society-day", "How much to charge for a golf society day",
                 "How much to charge for a golf society day",
                 "A golf society day usually costs £45 to £75 per golfer for 18 holes with a bacon roll and a meal, plus a society entry of £5 to £15 for prizes. Charge the club’s package price plus your society entry, rounded to a tidy figure, and collect it before final numbers go to the club.",
                 "How much a golf society day costs per person in 2026 and how much to charge members, with a free golf society day cost calculator.",
                 sections, faqs, ctas, scripts='<script src="/js/society-tools.js?v=20261024b" defer></script>')


# ---------------------------------------------------------------- 5. rules template
RULES = """[SOCIETY NAME] GOLF SOCIETY RULES

1. Membership
Anyone can join. Members play off their official handicap index if they have one, or a society handicap after their first round.

2. Fees and payment
Each society day costs the club's price plus a [£10] society entry for prizes. Pay the organiser by [date]. Not paid, not playing.

3. Drop-outs
Once final numbers go to the club, a drop-out still pays unless someone from the waiting list takes the place.

4. Format
Individual Stableford off [95%/100%] handicap unless the fixture says otherwise. Nearest the pin and longest drive on every society day.

5. Handicaps
Society handicaps: winner [-2], everyone else [+1], maximum [36]. New members can't win on their first society day. The organiser keeps the record.

6. Ties
Countback on the last 9, then 6, then 3, then the 18th hole.

7. On the day
Arrive 30 minutes before your tee time, follow the club's dress code, keep up with the group in front, repair pitch marks and rake bunkers.

8. Prizes
[35%] of the society entry goes into prizes on the day. Season awards at the end-of-season night.

9. Disputes
The organiser (or committee) has the final say. Settle it in the bar, not the car park."""


def rules_guide(today):
    sections = [
        ("template", "Golf society rules template (copy and paste)",
         f'<p class="soc-help">Change the parts in [brackets], then copy it into your golf society’s WhatsApp group description or pin it as a message.</p>'
         f'<pre class="gd-pre" id="rules-text">{e(RULES)}</pre>'
         '<div class="soc-btns"><button type="button" class="soc-btn" data-copy="rules-text">Copy the rules</button><button type="button" class="soc-btn2" data-share="rules-text">Send to WhatsApp</button></div>'),
        ("why", "Why every golf society needs written rules", "<p>Almost every golf society argument is about money, handicaps or ties. Agreeing the answers before the season, in writing, means the organiser never has to make it up on the 18th green. Keep the rules short enough that people actually read them: one screen on a phone is plenty.</p>"),
        ("extras", "Rules some golf societies add", '<ul class="gd-ul">' + "".join(f"<li>{x}</li>" for x in [
            "A <b>guest rule</b>: guests can play but can’t win the main prize, or can win only after two society days.",
            "A <b>twos pot</b>: £1 or £2 each, shared by anyone who scores a two, rolling over if nobody does.",
            "A <b>major</b> or <b>captain’s day</b> with double Order of Merit points.",
            "A <b>buggy rule</b>: who gets priority for buggies on medical grounds.",
            "A <b>phones rule</b>: no calls on the course, photos encouraged.",
        ]) + "</ul>"),
    ]
    faqs = [
        ("What should be in golf society rules?", "Membership, fees and payment deadlines, what happens with drop-outs, the format and handicap allowance, how society handicaps change, how ties are settled, on-course etiquette, prizes and who settles disputes."),
        ("How do golf societies settle ties?", "Usually by countback: the best score over the last 9 holes, then the last 6, the last 3 and finally the 18th hole. Use the card’s last 9 even if the group started on the 10th."),
        ("Can guests play in a golf society?", "Most golf societies welcome guests, often with a rule that they can’t win the main prize until they’ve played a set number of society days or joined."),
    ]
    return guide(today, "golf-society-rules-template", "Golf society rules template",
                 "Golf society rules template: copy, edit, send",
                 "Good golf society rules cover nine things: membership, fees and payment deadlines, drop-outs, the format, handicaps, ties, behaviour on the day, prizes and who settles disputes. Copy the template below, change the parts in brackets and pin it in your WhatsApp group.",
                 "A free golf society rules template to copy and paste: fees, drop-outs, handicaps, ties, format and prizes, ready for your WhatsApp group.",
                 sections, faqs, scripts='<script src="/js/society-tools.js?v=20261024b" defer></script>')


# ---------------------------------------------------------------- 6. apps compared
APPS = [
    ("Society HQ (GolfPrice AI)", "Free web tool, no download or sign-up", "Free", "Pay-the-organiser link (PayPal, Monzo, Revolut); money never passes through it", "Not yet (2027)", "Fixtures, sign-ups, waiting list, paid ticks, prize fund, awards night, Prize Picker, Find a Society", "/societies/"),
    ("RiddyGolf", "iOS and Android app", "Free to download", "Collects green fees by card (Stripe)", "Yes, live leaderboards", "Events and invites, reminders, many formats", "https://golfbusinessnews.com/news/new-products/riddygolf-app-aims-to-simplify-society-golf-admin/"),
    ("ParUp Golf", "iOS and Android app", "Free", "Tracks attendance and payments", "Yes, live leaderboards", "Event links, multi-round series, side games, optional auto-handicaps", "https://golfbusinessnews.com/news/new-products/parup-golf-app-set-to-spice-up-group-golf-events/"),
    ("Golfify Groups", "Web, iOS and Android", "Free up to 8 players per event; paid plans for bigger fields", "Entry fees by card (Stripe) with a transaction fee", "Yes", "Group page, fixtures, self-service entry, results kept season to season", "https://www.golfify.io/groups"),
    ("Quick9", "App", "Not published", "Not stated", "Score tracking and leaderboards", "Events, invites and RSVPs, finding games, league admin", "https://quicknine.helpkit.so/use-cases/8P8RXArYNR7yebYCdnHXf3/quick9-for%E2%80%A6-golf-societies/5U8akYsr96hXsegAnYwyra"),
    ("The Social Golfer", "Website and community", "Free to register; paid membership options", "Not stated", "Not stated", "A directory of golf groups and societies with vacancies", "https://www.thesocialgolfer.com/find-group"),
]


def apps_guide(today):
    rows = [[e(n), e(p), e(c), e(pay), e(sc), e(f)] for n, p, c, pay, sc, f, _ in APPS]
    srcs = '<ul class="gd-ul gd-src">' + "".join(
        f'<li>{e(n)}: <a href="{e(u)}" rel="nofollow noopener" target="_blank">{e(u.split("/")[2])}</a></li>' if u.startswith("http") else f'<li>{e(n)}: <a href="{u}">golfpriceai.com{u}</a></li>'
        for n, *_, u in APPS) + "</ul>"
    sections = [
        ("table", "Golf society apps at a glance",
         f'<p class="soc-help">Checked {CHECKED} from each app’s own pages or launch coverage. Features and prices change, so check before you choose.</p><p class="gd-swipe">Swipe the table sideways to see every column.</p>' +
         table(["App", "Platform", "Cost", "Payments", "Live scoring", "Best bits"], rows, "gd-table gd-apps")),
        ("choose", "Which golf society app is best for you?", '<ul class="gd-ul">' + "".join(f"<li><b>{t}</b> {d}</li>" for t, d in [
            ("You want live scoring on the day:", "RiddyGolf, ParUp or Golfify all score on phones with live leaderboards."),
            ("You want the app to collect the money:", "RiddyGolf and Golfify take card payments through Stripe (Golfify adds a transaction fee)."),
            ("You want nothing to download and no fees:", "Society HQ runs from one WhatsApp link with nicknames, and members pay you directly with your own payment link."),
            ("You want to find new members or a society to join:", "Society HQ’s Find a Society and The Social Golfer both list golf societies open to new members."),
            ("You run a big society with results going back years:", "Golfify Groups keeps results on a shared group page; plans depend on field size."),
        ]) + "</ul><p>Plenty of golf societies mix and match: one app for scoring on the day, and Society HQ for sign-ups, who’s paid and awards night.</p>"),
        ("honest", "Where Society HQ fits, honestly", "<p>Society HQ is ours, so here’s the honest version. It’s free, needs no app or account and handles the organiser’s admin: fixtures, in, out or maybe, the waiting list, who’s paid, the prize fund and the awards night. It doesn’t do live scoring or handicaps yet (both are planned for 2027) and it never handles payments: members pay the organiser directly.</p>"),
        ("sources", "Sources", srcs),
    ]
    faqs = [
        ("What is the best free golf society app?", "It depends on the job. For live scoring, ParUp and RiddyGolf are free to download. For sign-ups, payments to the organiser and awards with nothing to download, Society HQ is free and runs from a WhatsApp link."),
        ("Do golf society apps take payments?", "Some do: RiddyGolf and Golfify Groups take card payments through Stripe. Society HQ never handles money; members pay the organiser directly through the organiser’s own PayPal, Monzo or Revolut link."),
        ("Can I run a golf society on WhatsApp alone?", "You can, but sign-ups, drop-outs and who’s paid get lost in the chat. A tool like Society HQ keeps them in one link you share in the group."),
    ]
    items = {"@context": "https://schema.org", "@type": "ItemList", "name": "Golf society apps compared", "numberOfItems": len(APPS),
             "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": n} for i, (n, *_r) in enumerate(APPS)]}
    return guide(today, "golf-society-apps-compared", "Golf society apps compared",
                 "Golf society apps compared (2026)",
                 "The main golf society apps in the UK are RiddyGolf, ParUp and Golfify for live scoring, The Social Golfer for finding groups, and Society HQ for free sign-ups, who’s paid and awards night from a WhatsApp link. The best choice depends on whether you need scoring, payments or simple admin.",
                 "Golf society apps compared for UK organisers: RiddyGolf, ParUp, Golfify Groups, Quick9, The Social Golfer and Society HQ. Cost, payments, scoring and features.",
                 sections, faqs, extra_schema=[items])


def pages(today, bands):
    return [
        ("how-to-run-a-golf-society", run_guide(today)),
        ("golf-society-prize-ideas", prizes_guide(today, bands)),
        ("golf-society-handicap-systems", handicap_guide(today)),
        ("how-much-to-charge-for-a-golf-society-day", cost_guide(today)),
        ("golf-society-rules-template", rules_guide(today)),
        ("golf-society-apps-compared", apps_guide(today)),
    ]
