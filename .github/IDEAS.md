# The ideas loop (John, 20 Nov 2026)

Every idea or suggestion from any agent, or from Claude, goes through this loop
before it reaches the site. It has to be well thought through, add value and
achieve a clear objective. The board lives in `data/ideas.json`.

## The objectives (every idea must serve at least one)

1. **Traffic**: more of the right visitors from search, AI apps, social, email and word of mouth.
2. **Revenue**: more visits become buy clicks, and buy clicks become sales; more retailers per page.
3. **Retention**: more visitors come back (games, price alerts, email, Society HQ).
4. **Trust**: every price, claim and page stays true, fair and within the rules (ASA/CAP, CMA, Google, AI apps).
5. **Efficiency**: stays free or within the Pro plan and the approved budgets, and saves John's time.

Usage, traffic and money numbers stay private: on the board, targets are written as
"which number, which direction and by roughly how much" and the analyst keeps the
actual figures in John's private email.

## The stages

`proposed` → `challenged` → `shortlisted` → `approved` → `testing` → `measured` →
`kept` | `iterated` | `reverted`. Side exits: `parked` (good idea, wrong time or
not enough evidence yet, with what would bring it back) and `rejected` (with the reason).

1. **Propose**. Fill in every field: owner (which agent does it), objective,
   problem, evidence, hypothesis ("if we do X, then Y moves, because Z"),
   the smallest test, metric, target, window (days), effort (S/M/L), risks.
   No field may be blank. An idea without evidence can still be proposed, but scores low.
2. **Challenge** (the red team). Answer each question in writing:
   - Which objective, and which number moves? How will we know it worked?
   - What evidence says it will work: our own data, a competitor or benchmark, or a hunch?
   - What is the smallest version we could test in a week?
   - How could it fail or backfire (trust, house rules, Google or AI-app spam policies, annoying visitors, John's time)?
   - Does it duplicate or clash with something we already do or test?
   - What does it cost (money, free-tier limits, John's time)?
   - If it fails, what do we undo?
3. **Score**: Impact (1–5) × Confidence (1–5: our data 5, a benchmark or
   competitor 3, a hunch 1) × Ease (1–5). Maximum 125.
   An idea is shortlisted at 36 or more AND only if it passes the rules gate
   (EDITOR.md: no retailer names in public copy, no fake urgency or "was" prices,
   no copying, never ranking prices by commission, positive framing).
   Below 36: park it, saying what evidence would raise its confidence, or reject it.
4. **Approve**: John decides. The weekly review puts at most 3 shortlisted
   ideas in front of him, highest score first, each as its own small branch
   (the smallest test). Merging the branch is approval.
5. **Test**: at most 3 ideas of kind "test" (changes visitors see) running at once (ideas of kind "duty", such as a new check an agent runs behind the scenes, don't count), and only one change per page
   area at a time, so we know what caused what. Minimum window 14 days, or
   until the performance analyst says there's enough data.
6. **Measure**: the performance analyst compares the metric with the period
   before (and with the control, for a split test). "No clear effect" is a
   valid, honest result.
7. **Decide and learn**: keep, iterate (one more round with a named change) or
   revert. Every outcome writes a `lesson` (what worked, what didn't, what next).
   Lessons raise or lower the confidence of similar ideas in future.

## Stop doing (monthly)

The strategy board also asks, every month, what we should STOP: an agent,
report, email or post type that no longer earns its keep (no objective moved
in 3 months, or it costs John time for little value). Stopping is proposed on
the board the same way and John decides.
