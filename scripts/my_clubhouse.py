"""My Clubhouse (/play/my-clubhouse/): one personal page per golfer, with no login.

It gathers what this browser already keeps for the games, Society HQ and the
deal tools (the random player id, nickname, streaks, shortlist, fit and bag) and
asks the alerts worker for the live parts (leagues, societies, Bag Draft). The
page itself is the same for everyone; js/my-clubhouse.js fills it in. Nothing
new about the golfer is collected. Built with every price run, like the games.
"""
from price_pages import SITE, _write, page_shell

CSS = '<link rel="stylesheet" href="/css/par-price.css?v=20261037">\n<link rel="stylesheet" href="/css/my-clubhouse.css?v=20261024c">\n'

MOVE = """<details class="ch-move mc-move" id="move">
    <summary><span class="mv-sum"><b>On a phone and a laptop?</b> <span class="mv-long">Bring your Clubhouse with you. One code, works once.</span><span class="mv-short">Bring your Clubhouse with you</span></span><span class="mv-go"><span class="mv-go-open">Move my Clubhouse</span><span class="mv-go-close">Close</span></span></summary>
    <div class="mv-body">
      <p class="mv-intro">There’s no login, so each phone or browser keeps its own Clubhouse. Get a code on the device you already use, then type it (or open the link) on the other one. Your nickname, leagues, societies, streaks, shortlist, fit and bag come with you.</p>
      <div class="mv-grid">
        <div class="mv-give">
          <h3>1. On the device you already use</h3>
          <button type="button" class="ch-btn" id="mv-make">Get a code</button>
          <div id="mv-out" hidden></div>
        </div>
        <form class="mv-take" id="mv-form" novalidate>
          <h3>2. On your other device</h3>
          <div class="mv-row"><label><span class="mv-vh">Your code</span><input name="code" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD-2345"></label>
          <button type="submit" class="ch-btn">Use code</button></div>
          <p class="pr-msg" role="status"></p>
        </form>
      </div>
      <p class="mv-small">The code works once and runs out after 30 minutes. No email, name or password.</p>
    </div>
  </details>"""


def page():
    body = f"""<div class="mc-wrap">
<section class="mc-hero">
  <span class="mc-kick">My Clubhouse</span>
  <h1 id="mc-hello">Your golf, all in one place.</h1>
  <p id="mc-sub">Your games, golf society, leagues and the kit you’re watching. Saved on this device. No sign-up, no password.</p>
  <a class="ch-btn mc-hero-btn" id="mc-play" href="/play/par-price/" hidden>Play today’s Par Price</a>
</section>
<div id="mc" aria-live="polite"><p class="mc-loading">Opening your locker…</p></div>
{MOVE}
<p class="mc-small">What’s kept: a random player number and the things you chose, in this browser only. No name, no email, no password. Price alerts stay in your email: every alert email has a link to change or stop it. <a href="/legal/privacy-policy.html">Privacy policy</a></p>
</div>
<noscript><p class="mc-small">My Clubhouse needs JavaScript switched on.</p></noscript>
<script src="/js/my-clubhouse.js?v=20261024c" defer></script>
<script src="/js/move.js?v=20261024a" defer></script>"""
    return page_shell(title="My Clubhouse | GolfPrice AI",
                      description="Your golf on GolfPrice AI in one place: today’s games, your golf society, your leagues and the kit you’re watching. No sign-up.",
                      canonical=f"{SITE}/play/my-clubhouse/", body=body, section="play", schema=[],
                      noindex=True, extra_head=CSS)


def build(root=None):
    from pathlib import Path
    root = root or Path(__file__).resolve().parent.parent
    _write(root / "play" / "my-clubhouse" / "index.html", page())
    return []  # a personal page: kept out of search, so nothing to ping


if __name__ == "__main__":
    print(build())
