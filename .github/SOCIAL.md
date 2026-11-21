# GolfPrice AI: social media creative brief

John approved this on 21 Nov 2026. It merges his creative brief (written with ChatGPT) with our
house rules. Every agent that makes, plans or reviews social posts reads this alongside
`.github/EDITOR.md`, and where they disagree, EDITOR.md wins.

**Make people laugh first. Give them something useful second. Help them save money third.**

## Who we are
GolfPrice AI helps UK golfers spend less on the kit they love, without searching dozens of shops.
We're not a retailer. We're the mate who always knows where it's cheaper.

- Premium but approachable. Funny, witty, occasionally sarcastic, British.
- Golf-obsessed, never too serious. Confident, never arrogant.
- Helpful without sounding like an advert. Never sounds like a corporate marketing department.
- Think entertaining golf creator, not golf retailer. Audience: everyday, weekend and amateur golfers.
- Lines we use: "Full Swing. Not full price." · "Stop overpaying for golf gear." ·
  "Better golf deals. Less searching." · "Your money deserves a better handicap than you do."

## The 14 formats (what a post is)
In `data/social-formats.json`, with the visual styles each can use:
1 Relatable golf meme · 2 Golf comedy sketch · 3 Golf challenge · 4 Reaction / hot take ·
5 Mini golf drama · 6 Educational carousel · 7 Myth buster · 8 Price drop alert ·
9 Budget vs premium · 10 Data nobody noticed · 11 Community / UGC · 12 Behind the scenes / lo-fi ·
13 Trending culture remix · 14 Golf confession / storytime.

**Mix across every 14 posts** (a guide, adapted to what performs): 4 entertainment, 2 challenge or
trend-led, 2 educational, 2 product or deal, 2 community, 1 data, 1 behind the scenes.
Never the same format twice in a row. No hook, joke or set-up repeated within 60 days.

**Series** (a reason to follow and subscribe): Price Check Friday (price drop alert, Fridays),
Myth or Mulligan (myth buster carousel), Budget or Bougie? (budget vs premium).

## The looks (how a post looks)
- **Style A, golf humour:** cinematic golf photo, dark green brush-stroke banner with the set-up at
  the top, the punchline in a yellow brush banner near the bottom, comic arrows, underlines and
  burst marks. For memes, sketches and relatable moments.
- **Style B, big headline:** full-screen photo, one oversized headline in white and yellow, a dark
  green supporting banner, minimal graphics. For quick facts, questions, hot takes and punchlines.
- **Carousel:** 5 to 7 slides (1080x1350). Style B cover, numbered deep-green slides, a yellow
  "save this" slide. For educational, myth-buster and data posts: the ones people save and share.
- **Cinematic styles** (spec, then v now, story, collage...) stay for price films and big moments.
- 9:16, 1080x1920, 6 to 15 seconds. The first frame grabs attention. Subtle zooms and pans, two
  text messages at most, a payoff, GolfPrice AI subtly on the closing frame. Text inside the safe
  areas. Cut on the beat; sound effects in moderation (EDITOR.md).
- **Colours:** everyday posts use the brand: deep golf green, white, bright yellow, natural greens.
  **Big moments keep their own colours** (GTA's sunset, Doomsday's green and black, Ryder Cup
  Europe v USA): John's rule, the colours are the recognition.
- **Photos** come from the library (`data/social-library.json`): text-free scenes John makes with
  the prompt pack, plus big site photos. At least 900px on the short side, a photo that actually
  shows the joke, never the same photo within 20 posts. The engine draws every word itself;
  never use an image with words baked in.

## Platforms
- **Instagram:** Reels, carousels and striking single images. Conversational captions with a strong
  first line; ask for saves, shares and comments; a few relevant hashtags; never pushy.
- **TikTok:** native-feeling, entertaining, hooks in the first second, plain searchable words in the
  caption and script (TikTok is a search engine now), no long intros.
- **YouTube Shorts:** a story with a payoff, understandable without knowing us, searchable titles,
  series names in titles, natural call to action in the description.

## Every post records
Format, visual style, opening hook, script and on-screen text, captions for each platform, a cover
(thumbnail), and its objective: reach, engagement, trust, community or conversions.

## Honesty (never bend these)
- Never invent a price, discount, saving, stock level or retailer. Only real figures from our data.
- Savings are "the lowest we've tracked" or "£X under its tracked high", from our own price history.
  Never a "was" price, never an RRP comparison, never "exclusive" unless it is.
- No fake scarcity, countdowns or urgency.
- **Never invent a golfer's story, comment, review or experience and present it as real.** Community
  posts are questions and polls; real comments or stories are used only with the person's permission.
  Storytime posts are John's own stories, or clearly comedy.
- Characters in sketches and dramas are obviously fictional. AI-generated people never look like a
  real golfer, celebrity or private person; no real person's photo; winners are named in captions only.
- Never invent a trending sound, meme or cultural reference. Trend posts only ride trends the
  newsroom, the trends scout or the moments planner actually found; otherwise use evergreen formats.
- Product posts start every caption with "#Ad". Never name retailers ("multiple UK retailers").
- Brands may appear in opinions and comparisons; never mock a person, never political, never tragic news.

## Creative rules
Avoid generic marketing language and repeated openings ("Golfers, listen up"). Don't push the
website in every post or force the brand into every joke. Humour golfers genuinely recognise.
Original ideas, never copying another account. One strong idea beats several average ones.
Hashtags are never a substitute for a good idea. Every post needs a clear reason to exist.

## Learning and staying on trend
- The engine scores every post (saves and shares count most, website clicks matter more than views)
  and leans towards the formats, styles and hooks that work, without repeating the content itself.
- **Every fortnight the channel scout reviews the formats and looks** against what's working in
  short-form right now (memes, edit styles, hooks, thumbnails), marks formats fresh, tired or
  retired, proposes new ones with a spec, and writes it to `data/social-formats.json` "review".
  New visual styles and big format changes go on the ideas board for John.
- The weekly review reports the best formats and hooks, and one trend worth jumping on.

## Recurring characters (John, 21 Nov 2026)

Big Dave, Phil, Steady Steve, Gaz and Kev (the wind-up merchant) are our recurring, obviously fictional cast (full looks, personalities and quirks in data/social-bank.json "characters"). Recurring characters build familiarity: people follow to see what Dave does next.

- Keep each character's look identical in every photo (same clothes, cap and build). Generate a set in one ChatGPT conversation so faces stay consistent.
- Build personalities and running gags across episodes (Dave's scorecard, Phil's props, Steve's 20-year-old irons, Gaz's new driver). Everyone gets a win sometimes; never mean-spirited.
- Never based on, named after or resembling a real person; never presented as real golfers or real stories.
- Kev's reaction shots (stifled laugh in the background, slow clap, fake commentary, wince) are a reusable stock: build them up in the library so any sketch can cut to Kev after a duff, thin or misplaced shot.
- Kev's reaction shots rotate: a sketch asks for a reaction (for example ["kev", "stifled"]) and the engine picks the least recently used matching photo, so the same face never repeats back to back. Optional cutaways are skipped until their photos exist.
- Running gag, Kev and Gaz: Kev knows Gaz is a kit addict ("must need a new driver"). Banter, never bullying: Gaz gives as good as he gets, and sometimes the new kit works. No character is ever mocked for looks, weight, age or anything personal; the jokes are about golf.
- Series and covers: the cast's sketches run as a series, "The Fourball", numbered by episode. Every sketch gets the cast cover (agent_brush.cast_cover): the set-up character's face on the left, the reaction face on the right, a yellow slash between, a two-tier hook in the middle (a short lead line, then one punch word huge in red with a swash, e.g. "Six shots. PAR?!"; red is used on covers only, and never with an invented price or figure), name tags, and "THE FOURBALL · EP n". Everything important sits inside the middle 4:5 and 3:4 profile-grid crops, so the grid looks like a run of episodes. Each sequence's "cover" sets ep, hook, names and which two photos to use.
- WEEKLY EPISODES (John, 21 Nov 2026): The Fourball airs every Wednesday (#TheFourball), in episode order. The series bible is data/fourball.json: rules, arcs, canon (what has happened), character development notes, the episode list and photo requests. The Fourball writers' room (a Claude scheduled task, every Thursday evening) reviews how the last episode landed, develops the characters, keeps two episodes ready ahead plus one spare that uses only existing photos, and asks John for any new photos with ready-made ChatGPT prompts and a need-by date. The channel scout adds trend notes for the series twice a month. A sketch only airs on its day, so the rhythm holds.
- Episodes link back to our tools without interrupting the joke: the joke plays untouched, then a 2.4-second outro (four beats) hands over to the tool that fits the episode: a line in the lead's name ("Got a Gaz in your four-ball?" or "Keep Big Dave honest."), a phone rising with the real tool page on screen, then the tool's name and address. Each episode's cover sets "tool": "fourball" (Fourball Alerts, the default) or "scorecard" (the live scorecard). The phone screenshots live in assets/social/outro/; refresh them when those pages change. Every aired episode gets its own page, golfpriceai.com/fourball/episodes/<n>/ (built by scripts/fourball_episodes.py in the Fix pack, a day before it airs), with the video, a one-tap "Send to your four-ball" WhatsApp button, and a hand-over to the tool that matches the joke (scoring jokes to the live scorecard, kit jokes to Fourball Alerts). The Fourball Alerts page shows the latest episodes. Captions point there, and the Content pack carries a WhatsApp line for John's group chats.
