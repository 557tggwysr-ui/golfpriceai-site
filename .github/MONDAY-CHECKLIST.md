GOLFPRICE AI: MONDAY CHECKLIST
==============================
Everything from the last few days, in the order to do it. Tick each box as you go.
About 45 minutes for Parts A to C. Part D is optional and can wait.

Everything is on GitHub as one branch: claude/wild-nine-and-agents
It holds Wild Nine, all the agents, the new homepage, the social engine and The Fourball,
the Clubhouse Journal, the ideas loop and the house rules.
This zip is the backup copy of the same files.


PART A: BEFORE YOU MERGE (about 15 minutes)
-------------------------------------------
[ ] A1. GitHub setting (lets the agents propose fixes as pull requests)
        github.com/557tggwysr-ui/golfpriceai-site > Settings > Actions > General >
        Workflow permissions:
          - tick "Read and write permissions"
          - tick "Allow GitHub Actions to create and approve pull requests"
        Save.

[ ] A2. Cloudflare database: add two columns for Wild Nine
        dash.cloudflare.com > Storage & Databases > D1 > your database > Console.
        Run these two lines, one at a time:
          ALTER TABLE wn_scores ADD COLUMN idx REAL;
          ALTER TABLE wn_scores ADD COLUMN league INTEGER DEFAULT 0;
        (If it says the column already exists, that's fine: skip it.)

[ ] A3. Cloudflare worker: deploy the new version
        Workers & Pages > the alerts worker > Edit code.
        Select everything, delete it, paste in the whole of
        wild-nine/workers/alerts-worker.js from this zip > Deploy.
        It adds the Wild Nine course league, the game stats feed, nickname
        cleaning, the "wrong price" reports, and the counts the performance
        analyst needs (buy clicks, games, AI apps, the alert bar test).

[ ] A4. Cloudflare worker timer (2 minutes)
        Same worker > Settings > Triggers > Cron Triggers > Add:
          40 */6 * * *
        (Every 6 hours. If the agents' watchdog ever goes quiet for 26 hours,
        the worker emails you.)


PART B: MERGE (5 minutes)
-------------------------
[ ] B1. Open:
        https://github.com/557tggwysr-ui/golfpriceai-site/compare/main...claude/wild-nine-and-agents
        Click "Create pull request", then "Merge pull request", then "Confirm merge".
        GitHub Pages publishes it within a few minutes.

        (Prefer uploading by hand instead? Use the folders in this zip in this order:
        wild-nine/ first, then homepage/, then agents/ following agents/AGENTS-SETUP.txt.)


PART C: CHECK IT AND SWITCH THE AGENTS ON (about 20 minutes)
------------------------------------------------------------
[ ] C1. Homepage, on your phone and on your PC: golfpriceai.com
        - "Full swing. Not full price." with Best deal today on the right (PC) or below (phone)
        - Jump straight in: 3 big tiles and the 4 small ones with drop counts
          (the small ones fill in after the next 6-hourly refresh if blank)
        - Tap All / Clubs / Balls / Tech / Bags under Today's genuine drops
        - Scroll to "Only on GolfPrice AI": the Live Scorecard photo, and the game clips play
        - Sign up to the alerts form with your own email
        If anything looks wrong, tell Claude in the chat (screenshot helps).

[ ] C2. Wild Nine: golfpriceai.com/play/wild-nine/
        Play a round, post to the league, open "Today's course league".

[ ] C3. Run each agent once
        GitHub > Actions tab > each workflow starting "Agent: ..." > Run workflow.
        - For "Agent: content engine", choose mode "plan".
        - Skip "Agent: editor (Claude review)" until you've done D1 below (it needs that key).
        - Run "Agent: fix pack" LAST.
        A pull request called "Fix pack: N fixes" appears under Pull requests.
        Read it, and merge it if you're happy (that's your daily approval from now on).

[ ] C4. Check nothing failed
        Actions tab: every run should have a green tick. A red cross = send Claude
        a screenshot of the error.


PART D: OPTIONAL KEYS, MOST USEFUL FIRST (do any time this week)
----------------------------------------------------------------
All of these go in GitHub > Settings > Secrets and variables > Actions > New repository secret.
Full steps for each are in agents/AGENTS-SETUP.txt (step number in brackets).

[ ] D1. CLAUDE_CODE_OAUTH_TOKEN (step 11, 5 minutes, uses your Pro plan)
        Switches on: the Editor's Claude review of every Fix pack and post, the
        newsroom's same-day posts (surprises, trailer drops, big wins).
        On your PC, PowerShell:  irm https://claude.ai/install.ps1 | iex
                                 claude setup-token
        Copy the long token into the secret.

[ ] D2. IG_ACCESS_TOKEN and IG_USER_ID (step 6, 15 minutes)
        Switches on: ticked posts going to Instagram as Reels at 12:30 and 19:30.
        Without it, the Content pack still arrives and you post by hand.
        Also lets the engine post carousels (Myth or Mulligan, tips) and learn
        which formats earn saves and shares, so the mix gets smarter each week.

[ ] D3. GSC_SERVICE_ACCOUNT_JSON (step 5, 10 minutes)
        Switches on: real Google Search Console data for the SEO agents.

[ ] D4. YOUTUBE_API_KEY (step 9, 5 minutes)       trends scout reads YouTube too
[ ] D5. CH_API_KEY (step 7, 5 minutes)            Society Day Finder drafts club emails
[ ] D6. CF_API_TOKEN + CF_ACCOUNT_ID              watchdog warns before Cloudflare's free limits
        (a Cloudflare API token with "Account Analytics: Read" only, plus your account id)


PART E: WHAT ARRIVES AND WHEN (nothing to do except read and approve)
---------------------------------------------------------------------
Every day      Fix pack pull request: merge = yes, close or ignore = no.
               Private emails only if something needs you (sudden drop, a retailer
               programme problem, a free limit nearly used, an agent stopped).
Every week     Content pack issue: tick a post = it posts at the time shown;
               unticked = never posts. Every post that shows a product price starts "#Ad".
Mondays 09:13  Weekly review in the Claude app, with up to 3 ideas for you to decide
               (each a branch: merge = yes). This Monday's may say the agents aren't
               live yet; it runs before you merge. The full one starts next Monday.
29 Nov 18:30   Check the Bag Draft video went live; pin the comment.
30 Nov 08:30   Cyber Monday post reminder. ADD "#Ad" TO THE START of the Instagram,
               TikTok and X captions (that reminder was set up before the #Ad rule).
1 Dec          December Bag Draft opens (story post reminder). Moments planner runs
               (big events for the next 90 days, with the $10 OpenMontage brief).
2 Dec          Monthly search check: AI answers, competitors (including new ones),
               SEO and AI-app news, plus 3 quick answers and 3 new pages on a branch.
5 Dec          Games lab: the first beta game arrives as a branch to merge.
9 Dec          Strategy board: the month by objective, the biggest thing holding us
               back, what to start and what to stop.


THE FOURBALL (our weekly comedy series, from Wed 25 Nov)
  Every Wednesday       a new episode in the Content pack (EP 1 Big Dave's par on 25 Nov, EP 2 Gaz's new
                        driver on 2 Dec, EP 3 Big Dave's receipts on 9 Dec). Tick it in the pack and
                        Instagram posts it itself (needs D2). TikTok and YouTube Shorts: Claude sends
                        you each day's videos, covers and captions at 11:43, ready to post.
                        Episode 1 is only in this week's pack if you ran the content engine in "plan"
                        mode in step C3 (the automatic weekly plan runs on Sundays).
  Every Thursday 19:37  the writers' room: how the last episode landed, the next episodes,
                        and a photo prompts file if new photos are needed (make them in the
                        same ChatGPT chat as the cast and send them back in that same message thread)


THE CLUBHOUSE JOURNAL (golfpriceai.com/journal/)
  Two pilot articles are in this upload: "Is Black Friday golf genuinely cheaper?" and
  "Same golf kit, different price". Read them before you merge: they carry your name.
  Merging is your approval; after that, one new data-led article a fortnight at most,
  each on its own branch for you to read first.

SOCIAL PHOTOS
  PHOTO-PROMPT-PACK.txt (30 scenes for memes and headlines) is still to do when you have
  time (step F5). The Fourball's photos for episodes 1 to 3 are already in.


PART F: DECISIONS WAITING FOR YOU (when you have a minute)
----------------------------------------------------------
[ ] F1. The ideas board: 3 more ideas are shortlisted (clean up categories so junior
        clubs and accessories don't set the "From £" prices, lighter images, more
        retailers per price page). The Monday review will put them to you.
[ ] F2. Retailer names on the homepage ("Where our prices come from"): keep the list,
        or change it to "Prices from multiple UK retailers" with no names?
[ ] F3. GTA VI Reel: before posting, check the "13 years" against GTA VI's real
        launch date, and swap in the full-size driver photo (the content engine can).
[ ] F5. Social photos: make the 30 scenes in PHOTO-PROMPT-PACK.txt with ChatGPT
        (portrait, no words in the picture), name them scene-01.png to scene-30.png
        and send them to Claude. They unlock the meme and big-headline posts fully:
        the quality gate holds any post whose photo is too small, and only 4 site
        photos are big enough today.
[ ] F4. The site-wide banner says "only 2 left!!" as a joke about fake urgency.
        Keep it, or tidy the double "!!"?


IF SOMETHING GOES WRONG
-----------------------
- Undo the whole merge: open the merged pull request on GitHub > "Revert" >
  create and merge the revert pull request. The site goes back to how it was.
- Everything in this zip is a full copy, so nothing can be lost.
- Or just tell Claude what you see; every change is a branch or pull request,
  so it can always be undone.
