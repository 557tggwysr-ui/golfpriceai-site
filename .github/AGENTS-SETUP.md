GOLFPRICE AI AGENTS: SETUP AND HOW THEY WORK
=============================================

Eight agents that find problems, fix them (with your approval) and grow the
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
  scripts/update_deals.py     CHANGED: 7 lines that apply approved fixes
  scripts/price_pages.py      CHANGED: the internal-link lift in "Worth comparing"
  .github/workflows/agent-*.yml  the schedules
  .gitignore                  keeps the weekly videos out of the repo (new file)

STEP 1: UPLOAD
  Upload "scripts", ".github" and ".gitignore" into the root of
  golfpriceai-site, replacing the two changed files.

STEP 2: ONE GITHUB SETTING (so the agents can propose fixes)
  Repo > Settings > Actions > General > Workflow permissions:
    tick "Read and write permissions" and
    tick "Allow GitHub Actions to create and approve pull requests". Save.

STEP 3: SECRETS (Settings > Secrets and variables > Actions)
  Already there:   AWIN_API_TOKEN, AWIN_PUBLISHER_ID, BREVO_API_KEY
  New (optional):  GSC_SERVICE_ACCOUNT_JSON  for the search engine (step 5)
                   IG_USER_ID, IG_ACCESS_TOKEN for Instagram posting (step 6)
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

YOUR DAILY 2 MINUTES: THE FIX PACK
  Each morning (07:30) one pull request lists today's fixes, for example:
    Hide a wrong price · Re-file a neck warmer that's listed as a fairway
    wood · Move ex-display stock into Preowned · Add internal links to pages
    close to ranking · Refresh llms.txt's live prices
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
  1st of month   data story (chart and press angle; feeds the press pitch)
  2nd of month   AI-answer check (Claude): are AI apps finding you?

PRIVACY
  Reports in the repo are public, so they never hold traffic, usage or money
  numbers. Those come to GolfPriceAI@outlook.com only.
