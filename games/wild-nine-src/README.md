# Wild Nine: source

The game at `play/wild-nine/index.html` is **built** from these files. Edit here, never the built page.

| File | What it is |
|---|---|
| `engine.js` | Course generator (daily seed), shot physics, wind, terrain, caddie cards (`CARDS`), scoring. Exposes `window.WildNine`. |
| `ui.js` | Everything on screen: title, holes, Pro Shop (`ITEMS`, monthly `DROPS`), Birdies wallet, seasons, challenges, leagues, share card (`roundCardSvg`), tutorial. Test hook: `window.__wn`. |
| `template.html` | The page shell and CSS; `build.py` inlines everything into it. |
| `quips.js` | Caddie and commentary lines. |
| `kit.json`, `shopprices.json` | Pro Shop items linked to real site products and their live prices (`kit.mjs` refreshes them). |
| `promo.json` | `WN_PROMO`: deal of the day and the monthly season names (`majors`, shared with the Bag Draft). |

## Build and ship
```
python3 build.py                 # writes index.html (and index-test.html with test mode on)
cp index.html ../../play/wild-nine/index.html
```
Then open a pull request (John merges).

## Test (headless Chrome + puppeteer-core: `npm install`)
- `node play.mjs solo|match|scramble` plays a full round and prints the log and any page errors.
- `node test-cards.mjs` taps every caddie card for real and checks its effect.
- `node test-birdies.mjs` plays an official round and 4 practice rounds and checks the Birdies wallet.
- `node bot.mjs` / `node cardsim.mjs '{"drafts":[2,5],"hand":2}'` simulate hundreds of rounds to check difficulty (target average +2 to +4 for a human; the bot averages about level par with no cards).

## Close putts (28 Nov 2026)
Within 10 feet on the green the camera zooms in on the ball and the cup, and a full drag reaches about three times the distance to the hole (the bar shows feet of roll). The physics don't change: the same break, lip-outs and capture speed. Ball and flag sizes are capped in close-ups.

## Rules that must never break
- Everyone playing a day gets the same course (the daily seed). Never change past days' courses.
- No paid items, no loot boxes, no countdowns, no guilt-trip notifications. Cosmetics only.
- Never change how scores are checked for fair play. `js/site.js` counts plays; add no tracking of your own.
- Caddie cards (since 24 Nov 2026): a start card, one locker card, and the caddie offers one after holes 3 and 6 only; hand of 2. Laser Line lands exactly where its line shows (since 28 Nov 2026 the line shows the flight to where it lands, not the roll; a laser shot onto the cup hits the flag and stops beside the hole instead of dropping; and it can't be used for putts). Big Stick and Tailwind can't be played on the green.
