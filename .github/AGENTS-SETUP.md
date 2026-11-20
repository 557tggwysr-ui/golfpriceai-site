GOLFPRICE AI AGENTS: SETUP AND HOW THEY WORK
=============================================

Twenty agents, plus a watchdog that checks on all of them and an editor that
reads everything before it goes out. They find problems, fix them (with your approval) and grow the
site. All run free in GitHub Actions. Nothing changes on the site until you
approve it.

WHAT'S IN THIS FOLDER
  scripts/agent_common.py     shared helpers (private emails go via Brevo)
  scripts/agent_rules.py      applies the fixes you approved, every refresh
  scripts/agent_fixes.py      the daily Fix pack (one pull request to approve)
  scripts/agent_revenue.py    1 revenue guardian
  scripts/agent_catalogue.py  2 catalogue autopilot
  scripts/agent_search.py     3 search-to-page engine
  scripts/agent_content.py    4 content engine  (+ agent_video.py: the videos)
  scripts/agent_shopper.mjs   5 mystery shopper
  scripts/agent_answers.py    6 AI-answer optimiser
  scripts/agent_story.py      7 data stories
  scripts/agent_linker.py     8 internal linker
  scripts/agent_coverage.py   9 coverage hunter (more retailers per page)
  scripts/agent_claims.py    10 claims guardian (every claim stays true)
  scripts/agent_gamemaster.py 11 game master (+ agent_course.mjs: Wild Nine)
  scripts/agent_society.py   12 society connector (Society Day Finder)
  scripts/agent_coursedata.py 13 course data keeper (scorecards from club websites)
  scripts/agent_seasonal.py  14 seasonal planner (occasion pages 8 weeks ahead)
  scripts/agent_email.py     15 email optimiser (Friday subject-line tests, list health)
  scripts/agent_insights.py  16 retailer insights (monthly, private)
  scripts/agent_trends.mjs   17 social trends scout (live hashtags, sounds, formats)
  scripts/agent_performance.py 18 performance analyst (visit > buy click > sale, button tests)
  scripts/agent_editor.py    19 the editor (house-style checks on every change; Claude review)
  20 games scout and games lab: a monthly Claude scheduled task (no file here)
  play/lab/index.html        the hidden Games lab page (betas, not on Google)
  data/games-lab.json        the lab's list of betas and their pass marks
  scripts/agent_watchdog.py  the watchdog: checks every agent every 3 hours
  competitor watch is part of agent_search.py (competitors' public sitemaps, weekly)
  press desk and competitor rank check run as Claude scheduled tasks (no files)
  .github/EDITOR.md          the house style the editor reviews against (edit freely)
  .github/IDEAS.md           the ideas loop: every idea is challenged, scored, approved by you, tested and measured
  data/ideas.json            the ideas board (weekly review runs the loop; the strategy board reviews it monthly)
  data/competitors.json      extra competitors found by the monthly competitor scout (merged by you)
  data/press-optouts.json    writers who said "no thanks" (the press desk skips them)
  plus the "Price look wrong?" link on every price page, read by the claims guardian
  CHANGED: scripts/digest.py (subject test), js/quick-round.js (club scorecards),
           js/site.js (buy-click counts, Awin page tags, button-wording test)
  scripts/update_deals.py     CHANGED: 7 lines that apply approved fixes
  scripts/price_pages.py      CHANGED: the internal-link lift in "Worth comparing"
  .github/workflows/agent-*.yml  the schedules
  .gitignore                  keeps the weekly videos out of the repo (new file)
  scripts/agent_cine.py      the cinematic video styles; scripts/agent_screen.mjs records the site
  assets/fonts/Anton-Regular.ttf  free condensed font for the cinematic styles (SIL Open Font Licence)
  data/social-benchmarks.json, data/content-queue.json  the reels to beat; queued trend tie-ins

STEP 1: UPLOAD
  Upload "scripts", ".github" and ".gitignore" into the root of
  golfpriceai-site, replacing the two changed files.

STEP 2: ONE GITHUB SETTING (so the agents can propose fixes)
  Repo > Settings > Actions > General > Workflow permissions:
    tick "Read and write permissions" and
    tick "Allow GitHub Actions to create and approve pull requests". Save.

STEP 3: SECRETS (Settings > Secrets and variables > Actions)
  Already there:   AWIN_API_TOKEN, AWIN_PUBLISHER_ID, BREVO_API_KEY
  Also used:       ALERTS_SECRET (already there: the game master uses it to
                   read Wild Nine stats from the worker)
  New (optional):  GSC_SERVICE_ACCOUNT_JSON  for the search engine (step 5)
                   IG_USER_ID, IG_ACCESS_TOKEN for Instagram posting (step 6)
                   CH_API_KEY for the society connector (step 7)
                   YOUTUBE_API_KEY for the trends scout (step 9)
                   CLAUDE_CODE_OAUTH_TOKEN for the editor's Claude review (step 11)
                   PSI_API_KEY (optional) lifts Google PageSpeed's free limit; it
                   works without one for the handful of speed checks we run
                   CF_API_TOKEN + CF_ACCOUNT_ID (optional) let the watchdog warn
                   before Cloudflare's free Worker and D1 limits (a token with
                   Account Analytics: Read only)
  Everything else works without them.

STEP 4: RUN EACH ONCE BY HAND
  Actions tab > each "Agent: ..." > Run workflow (content engine: mode
  "plan"). Run "Agent: fix pack" last. A pull request "Fix pack: N fixes"
  appears in Pull requests.

STEP 5: SEARCH CONSOLE ACCESS (free, about 10 minutes)
  1. console.cloud.google.com > new project "golfpriceai-agents".
  2. APIs & Services > Enable APIs > "Google Search Console API" > Enable.
  3. IAM & Admin > Service accounts > Create "search-agent" > Keys >
     Add key > JSON (a .json file downloads).
  4. Search Console > Settings > Users and permissions > Add user: the
     service account's email (ends iam.gserviceaccount.com), "Restricted".
  5. Secret GSC_SERVICE_ACCOUNT_JSON = the whole .json file. Delete the file.

STEP 6: INSTAGRAM AUTO-POSTING (optional, about 15 minutes, free)
  Instagram must be a Business or Creator account. No Facebook Page needed.
  1. developers.facebook.com > Create app > "Manage messaging & content on
     Instagram".
  2. Instagram > API setup with Instagram login > Generate access token >
     log in as golfpriceai, allow content publishing.
  3. Secrets: IG_ACCESS_TOKEN = the token, IG_USER_ID = the id beside it.
  Tokens last about 60 days; when one expires you get an email and the post
  waits in the pack.

STEP 7: COMPANIES HOUSE KEY (free, 5 minutes, for club partnership emails)
  developer.company-information.service.gov.uk > register > Your applications >
  Create an application (live, REST) > Create new key (REST). Copy the key
  into the secret CH_API_KEY. Without it the Society Day Finder still builds
  its pages; it just won't draft club emails.

STEP 8: DEPLOY THE NEW WORKER BEFORE MERGING
  The worker (workers/alerts-worker.js) now includes: the course league (a bug
  had put it in the wrong place, so it's fixed), the game master's stats feed,
  approved moderation and instant cleaning of offensive nicknames.

STEP 9: YOUTUBE KEY (free, 5 minutes, optional)
  In the same Google Cloud project as step 5: APIs & Services > Enable APIs >
  "YouTube Data API v3" > Enable > Credentials > Create credentials > API key.
  Restrict it to the YouTube Data API. Secret YOUTUBE_API_KEY = the key.
  Without it, the trends scout still reads TikTok's trend pages and r/golf.

STEP 10: SWITCH ON THE WORKER'S TIMER (2 minutes, free)
  Cloudflare > Workers & Pages > the alerts worker > Settings > Triggers >
  Cron Triggers > Add: 40 */6 * * *  (every 6 hours). This is the watchdog's
  own watcher: if the agents' watchdog goes quiet for 26 hours, the worker
  emails you, even if GitHub itself has stopped running things.

STEP 11: THE EDITOR'S CLAUDE REVIEW (5 minutes, uses your Pro plan)
  On your PC, open PowerShell and run these two lines (the first installs
  Claude Code, the second makes a long-lived token for GitHub):
    irm https://claude.ai/install.ps1 | iex
    claude setup-token
  (If "claude" isn't found, close and reopen PowerShell first.)
  Sign in when the browser opens. It prints a long token: copy it, and add it
  in GitHub as the secret CLAUDE_CODE_OAUTH_TOKEN. From then on, Claude reads
  each Fix pack and each week's social posts against .github/EDITOR.md, leaves
  a comment on the pull request, and labels it "do-not-merge" if something
  breaks a house rule. Posts it holds won't auto-post. It uses your Pro plan's
  allowance (a few short reviews a day). Without the token, the free rule
  checks still run inside every Fix pack.

THE EDITOR
  Before the Fix pack opens, the editor checks every changed file: no retailer
  names in marketing copy, no urgency or "was" prices, nothing political or
  tragic, no broken placeholders ({name}, None, £0), UK spelling, one H1,
  sensible title and description lengths, image alt text. A file that breaks a
  house rule is held back and listed at the bottom of the pull request; small
  style points are listed as notes. Every social caption is checked the same
  way, and a post that fails is marked "Held by the Editor" and never posts.

THE PERFORMANCE ANALYST
  Every price-page buy button now tags the Awin link with the page it came
  from (clickref), and counts buy clicks per page (anonymous, no cookies;
  these counts stay private). Each Monday you get an email: visitors, buy
  clicks, click rate, sales and commission per page, plus ideas for pages
  that underperform. It also runs ONE button-wording test at a time (e.g.
  "Shop from £49.99" vs "See it from £49.99"), proposed in the Fix pack; when
  one wording clearly wins (or after 6 weeks) it proposes keeping it. It
  never changes prices, their order or which shop is shown.

GAMES SCOUT AND GAMES LAB
  Every game visit is remembered for that visit only, so the performance
  analyst can see which games lead to price pages, buy clicks and sales (your
  Monday email has a "Games" table; Awin tags carry the game name too).
  On the 5th of each month, Claude researches what's working in casual games,
  golf games and gamified shopping, then builds ONE beta game on its own branch
  (you merge it) at golfpriceai.com/play/lab/. It's hidden from Google: share
  it with a golf WhatsApp group. After 4 weeks the performance analyst judges
  it against its pass mark (enough players coming back) AND the best beta
  before it: each new game has to beat the last best, not just the pass mark.
  Every beta's lessons are written down, and each new one must say which
  lessons it builds on. (The scores are scrambled in the public file, so no
  usage numbers show.) "Passed" goes into
  the Fix pack, and the next lab run graduates it into the Clubhouse.
  A beta is NEVER retired without you: if it misses its pass mark you get an
  email with its numbers week by week, the improvements made during the beta
  and a recommendation, plus a GitHub issue "Games lab decision: ..." with two
  boxes: Retire it, or Give it 4 more weeks. Tick one and your choice goes into
  the next Fix pack. Until you decide, it keeps running. One beta at a time.

SEO: HEALTH CHECK AND SEO NEWS
  Mondays, with the search engine: every price page's Product markup (what
  powers Google's price snippets) and duplicate titles are checked; with
  Search Console access it also reads your sitemap report, asks Google
  whether a rotating sample of ~45 pages is indexed (and why not), and runs
  Google PageSpeed for mobile speed on key pages. Results: data/agents/
  seo-health.json, read by the weekly review, which gives you the fixes.
  First run here: all 1,697 price pages have valid markup; 36 have no
  product photo because their feed doesn't supply one.
  2nd of the month: the Claude check also reads Google's own announcements
  and reputable SEO news, and tells you only what affects GolfPrice AI and
  the change to make.

AI APPS (LLMs): COVERED THE SAME WAY AS GOOGLE
  Daily, the AI-answer optimiser also checks that ChatGPT, Perplexity, Claude,
  Gemini, Copilot, Apple, Meta and DuckDuckGo's AI crawlers are all allowed in
  by robots.txt, that the site really serves them pages (a live test as each
  bot, so a Cloudflare setting can't silently block them), that every price
  page shows its name and price without JavaScript (AI crawlers don't run it),
  that llms.txt is fresh, and that IndexNow is set up (Bing feeds Copilot and
  ChatGPT search). Results: answers-report.json "llmHealth".
  The site now counts which AI app sent each visitor (anonymous), and your
  Monday email has an "AI apps" table next to Google. ChatGPT visits tagged
  utm_source=chatgpt.com were being counted as direct; that's fixed.
  2nd of the month: the Claude check covers AI-app news too: changes to
  ChatGPT search and shopping, Perplexity, Gemini and AI Mode, Copilot and
  Claude, new AI crawlers to allow, and llms.txt practice.

THUMBNAILS
  Every Reel and Short gets its own designed thumbnail (cover), not a frame
  from the video: 2 to 4 huge words, the product big with a soft shadow, a
  price badge and the brand, all inside Instagram's grid crop. It's used as the
  Reel cover automatically and is on the pack page to download for TikTok and
  YouTube Shorts. Claude's review (step 11) checks every thumbnail too. For the
  fortnightly hero video, the OpenMontage brief includes an AI-made thumbnail
  within the $10.

PREMIUM QUALITY FOR POSTS, VIDEOS AND GRAPHICS
  Videos are now encoded at a much higher quality setting and feed cards are
  saved at near-lossless quality. Every video and card passes a quality gate
  before it can post: exact size and frame rate, length, text contrast on
  every colour, product photos sharp enough (at least 600 pixels), no blank
  frames, and feed cards that never cut through text (they're framed around
  the content). One colour (green on light blue) failed the contrast test and
  has been darkened. Then, with the Claude token (step 11), Claude looks at
  every card and three frames of every video against the "Premium visual
  standard" in .github/EDITOR.md and holds anything that falls short, saying
  what to fix. A held post shows as "Held by the Editor" and never posts.

THE NEWSROOM (same-day posts) AND THE MOMENTS PLANNER
  Twice a day (08:15 and 17:45 UK) the newsroom reads BBC golf, sport,
  entertainment and tech headlines, Google Trends UK and YouTube's most popular
  in the UK, plus what's breaking on TikTok that day (rising hashtags, top
  videos, business-approved sounds). Claude also checks the day's Instagram
  Reels and TikTok trend round-ups on the web, since Instagram itself can't be
  read automatically. It catches two things: build-up beats for the big moments we're
  riding (each Avengers: Doomsday teaser, trailer or ticket release, matched by
  the "watch" words in data/moments.json) and surprises nobody planned for.
  Political, tragic and private-life stories are dropped automatically. With
  the Claude token (step 11), Claude picks at most one story worth riding,
  writes the post in whatever format suits it, tying the news of the day back
  to something real on the site (a price drop, alerts, a game, Society HQ),
  and it lands in that day's
  content pack; you get an email, tick it, and it posts at 12:30 or 19:30.
  Nothing posts without your tick. Without the token, the stories still show
  on the pack page under "In the news".
  On the 1st and 15th, the moments planner (Claude) plans 90 days ahead: dates,
  the look of each event, a format chosen for each, known build-up beats, and a
  hero video brief for OpenMontage (up to $10 a fortnight, run on your PC).

NEW VIDEO STYLES (learned from the reels you picked, 19 Nov)
  The content engine now has five more ways to make a video, on top of the seven:
    spec      a cinematic product film: dark, huge condensed type, a neon light
              streak, one real price stat per cut (like a brand launch reel)
    thennow   split screen: the same club at its highest tracked price v today,
              then the saving slams in
    truth     "golfer truths": a relatable line, then hundreds of balls pour in
              and pile up, a deadpan punchline, then the real ball deal
    sitedemo  a real phone recording of golfpriceai.com with taps (shop names
              hidden in the recording), our price history as the hero
    story     trend tie-ins (a big launch everyone's talking about) written by
              Claude into data/content-queue.json, rendered on their date
  Every week the content pack also suggests two 10-second skits you could film
  on your phone (optional). data/social-benchmarks.json lists the reels you
  picked; the Editor's Claude review judges every video against them.
  Optional: a free Pexels key (pexels.com/api, secret PEXELS_API_KEY) would let
  a future style use real golf-course footage with no people in it, like the
  "day in your golf ball's life" reel. Not built yet: say the word.

COMPETITOR WATCH AND PRESS DESK
  Mondays: the search engine reads competitors' public sitemaps (Caddence,
  CaddyCompare, Golf Price Compare, ClubCompass and RiddyGolf; add others in
  COMPETITOR_SITES in scripts/agent_search.py) and lists
  their new pages and topics we have no page for (data/agents/competitor-watch.json).
  2nd of the month: the Claude check also ranks you against them on ~30 keywords.
  First Tuesday: the press desk drafts your regular pitch AND up to 5 tailored
  emails to writers who recently covered golf prices, using only addresses
  their outlet publishes, each with "why you're getting this" and an opt-out.
  If someone says no thanks, add them to data/press-optouts.json.

THE WATCHDOG
  Every 3 hours it checks that every agent ran successfully and on time,
  that each report is fresh and its numbers haven't swung wildly, and that
  the open Fix pack only touches the files agents are allowed to change. A
  pack that breaks the rules is labelled "do-not-merge" with the reason.
  You'll see one GitHub issue, "Agent health": it's open while something's
  wrong and closes itself when all's well. You get an email for each NEW
  problem, never repeats.

YOUR DAILY 2 MINUTES: THE FIX PACK
  Each morning (07:30) one pull request lists today's fixes, for example:
    Hide a wrong price · Re-file a neck warmer that's listed as a fairway
    wood · Move ex-display stock into Preowned · Add internal links to pages
    close to ranking · Refresh llms.txt's live prices
  Also: clubs merged under one name (Mondays), Wild Nine tuning for future
  days and moderation, and the Society Day Finder (3rd of each month).
  Approve = Merge (the GitHub phone app works well). The fixes are live within
  minutes. To leave one out, tick its "skip" box before merging. Reject
  the lot = close the pull request.
  Undo later: delete the fix's line in data/agent-rules.json, or revert.
  Pause every agent: create an empty file called data/agents-paused.

HOW THE IMPROVEMENT LOOP WORKS
  * The catalogue check runs after every 6-hourly price refresh and confirms
    each approved fix took effect.
  * Hidden listings come back when their fix expires and are checked again.
    If a problem returns, the next fix lasts longer (3, then 14, then 60 days).
  * Old fixes for products that have left every feed are tidied away.
  * Internal-link lifts run 60 days, then the search report shows whether
    they worked.
  * The content engine reads Instagram results and makes more of what works.
  * Every Monday the weekly review checks all of the above, tells you what
    worked and what didn't, and lists the fixes that need code. If you link
    GitHub to Claude, it can also propose those code fixes as a pull request
    for you to approve.

YOUR SUNDAY 15 MINUTES: THE CONTENT PACK
  Sunday 17:00: a trend scan (golf news, UK trends, the golf calendar,
  filtered so nothing political, tragic or about real people gets through),
  then next week's 7 posts. Each is a short vertical video with a hook in the
  first second, in a different style each day (price reveal, guess the
  price, top three, big stat, POV meme, expectation v reality, receipt) and
  rotating colours. Captions are in a friendly golf-club banter voice for
  Instagram, TikTok, YouTube Shorts, X, Pinterest and Bluesky.
  Tick the posts you want in the "Content pack" issue. Ticked posts go to
  Instagram at 12:30 on their day. For TikTok, Reels and Shorts, open
  golfpriceai.com/social/pack/, download the video, add a trending sound from
  the app's commercial library, and schedule it.

THE SCHEDULE (UK time in winter)
  02:10 daily    mystery shopper
  06:20 daily    revenue guardian (money email on Mondays)
  every 6 hours  catalogue autopilot (after each price refresh)
  07:30 daily    fix pack
  08:15 daily    content "moments"
  12:30 daily    Instagram posting (ticked posts only)
  Mon 05:10      search engine;  Mon 09:13 weekly review (Claude)
  Sun 17:00      content pack
  06:55 daily    claims guardian
  1st of month   data story (chart and press angle; feeds the press pitch)
  3rd of month   society connector (inside the fix pack; drafts emailed to you)
  Mondays        coverage hunter (inside the fix pack; retailers to apply to
                 emailed to you), seasonal planner, email optimiser
  3rd of month   course data keeper (inside the fix pack)
  2nd of month   retailer insights (emailed to you)
  Sun + Wed      social trends scout (before the content plan)
  daily          game master (inside the fix pack, once Wild Nine is live)
  2nd of month   AI-answer, competitor rank and SEO news check (Claude)
  Mondays        SEO health check (with the search engine)
  daily          performance analyst + editor (inside the fix pack; email Mondays)
  after packs    editor's Claude review (needs step 11)
  Mondays        competitor watch (with the search engine)
  1st Tuesday    press desk (Claude): pitch + tailored writer emails
  5th of month   games scout and games lab (Claude): research + one beta

PRIVACY
  Reports in the repo are public, so they never hold traffic, usage or money
  numbers. Those come to GolfPriceAI@outlook.com only.
