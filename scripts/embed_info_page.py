"""For bloggers and writers: /embed/ explains the free live price charts.

Every price guide has an "Embed this chart on your site" box; this page is the
front door to them, linked from the footer's "Work with us" column.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://golfpriceai.com"
EXAMPLE = "srixon-zxi-driver"

FAQS = [
    ("Can I put GolfPrice AI price charts on my golf blog?",
     "Yes, free. Every price guide has an “Embed this chart on your site” box with a short piece of code. Paste it into your post and the chart updates itself every 6 hours."),
    ("Do I need an account or an API key?",
     "No. Copy the code and paste it. There’s no sign-up, no key and no cost."),
    ("Can I quote your prices in an article?",
     "Please do. Credit “GolfPrice AI” and link to the model’s price guide, so readers can see today’s figure. Our prices are the lowest new UK price across multiple UK retailers, checked every 6 hours."),
    ("Is there something for golf clubs and societies?",
     "Yes. Golf clubs can add a free hole-in-one board to their website, and societies can run fixtures, scoring and leagues with Society HQ, all free."),
]


def page():
    from price_pages import page_shell, breadcrumb
    crumbs_html, crumbs = breadcrumb([("Home", "/"), ("Price charts for your site", None)])
    faqs = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in FAQS)
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    body = f"""<div class="pp-wrap em">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">For bloggers &amp; writers · free</span>
  <h1>Free live golf price charts for your blog or website</h1>
  <p class="pp-answer">Writing about a driver, a putter or a box of balls? Add a live UK price history chart to your post. It shows the lowest new UK price today and how it has moved, and it updates itself every 6 hours. Free, no sign-up.</p>
</section>
<section class="pp-block">
  <h2>Here’s one, live</h2>
  <iframe src="/embed/price/{EXAMPLE}/" title="Example: Srixon ZXi Driver UK price history" width="100%" height="370" style="border:1px solid var(--gp-line);border-radius:14px;max-width:760px;background:#fff" loading="lazy"></iframe>
</section>
<section class="pp-block">
  <h2>Add one in three steps</h2>
  <ol class="em-steps">
    <li><b>Find the model.</b> Search above, or browse the <a href="/prices/">price guides</a>. There are charts for over 1,400 models.</li>
    <li><b>Open “Embed this chart on your site”.</b> It’s just under the price chart on every price guide.</li>
    <li><b>Copy the code and paste it into your post.</b> Use your editor’s HTML or “custom code” block. That’s it.</li>
  </ol>
</section>
<section class="pp-block em-more">
  <a class="pp-card" href="/prices/watch/"><b>For journalists</b><span>The monthly UK Golf Price Watch, with quotes and the numbers behind them.</span></a>
  <a class="pp-card" href="/courses/widget/"><b>For golf clubs</b><span>A free hole-in-one board for your club’s website.</span></a>
  <a class="pp-card" href="/ai.html"><b>For AI assistants</b><span>Live UK golf prices in ChatGPT, Claude and your own tools.</span></a>
</section>
<section class="pp-block em-faq">
  <h2>Price chart questions</h2>
  {faqs}
</section>
</div>"""
    css = ('<style>.em-steps{padding-left:20px;margin:0;display:grid;gap:8px;font-size:16px}'
           '.em-more{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.em-more a{padding:18px 20px;text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:4px}'
           '.em-more b{font-size:17px}.em-more span{color:var(--gp-text-2);font-size:14px}.em-more a:hover{border-color:var(--gp-green)}'
           '.em-faq{display:flex;flex-direction:column;gap:10px}.em-faq details{background:#fff;border:1px solid #e4e6e0;border-radius:14px;padding:14px 16px}'
           '.em-faq summary{font-weight:700;font-size:16px;cursor:pointer}.em-faq details p{margin:10px 0 0;color:#4a554e}'
           '@media(max-width:760px){.em-more{grid-template-columns:1fr}}</style>')
    return page_shell(title="Free Live Golf Price Charts for Your Blog or Website | GolfPrice AI",
                      description="Add a free, self-updating UK golf price history chart to your blog or website. Over 1,400 models, the lowest new UK price checked every 6 hours. No sign-up.",
                      canonical=f"{SITE}/embed/", body=body, section="", schema=[crumbs, faq_schema], noindex=False, extra_head=css)


def build(root=None):
    from price_pages import _write
    root = root or ROOT
    return ["/embed/"] if _write(root / "embed" / "index.html", page()) else []


if __name__ == "__main__":
    print(build())
