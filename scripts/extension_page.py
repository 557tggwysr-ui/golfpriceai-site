"""The browser extension's page: /extension/

The extension itself lives in browser-extension/ (zipped for the Chrome Web Store and
Edge Add-ons). When a store listing goes live, put its address in
data/extension.json ({"chrome": "...", "edge": "..."}) and the next run shows
the "Add to" buttons here and the desktop-only line on model pages.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://golfpriceai.com"
CONFIG = ROOT / "data" / "extension.json"

FAQS = [
    ("Is the GolfPrice AI browser extension free?",
     "Yes. It’s free, with no account and no ads. It shows GolfPrice AI’s own price tracking on the golf product page you’re already looking at."),
    ("Which shops does it work on?",
     "Major UK golf retailers, plus eBay UK and Amazon UK. It wakes up on golf product pages and stays out of the way everywhere else."),
    ("What is the “was price” check?",
     "Many shops show a “was” or RRP price next to today’s price. The extension compares that figure with what we’ve actually tracked for the same model across multiple UK retailers, so you can see the real saving at a glance."),
    ("How does it work out a fair pre-owned price?",
     "On pre-owned listings, such as on eBay, it shows the range pre-owned UK golf retailers are asking for the same model, and the typical price, alongside the lowest new price today."),
    ("Does it change prices, links or cookies on the shop’s page?",
     "No. It only reads the product name and price on the page to look them up. It never changes the shop’s links, codes, basket or cookies."),
    ("Does it work on my phone?",
     "Not yet. It’s for Chrome and Microsoft Edge on a computer. On your phone, use “Is This A Good Price?” on golfpriceai.com, or set a free price alert on any price page."),
]


def config():
    try:
        return json.loads(CONFIG.read_text())
    except Exception:
        return {}


def store_urls():
    c = config()
    return (c.get("chrome") or "").strip(), (c.get("edge") or "").strip()


def page():
    from price_pages import page_shell, breadcrumb
    chrome, edge = store_urls()
    crumbs_html, crumbs = breadcrumb([("Home", "/"), ("Deal Tools", "/deal-tools.html"), ("Browser extension", None)])
    faqs = "".join(f"<details><summary>{q}</summary><p>{a}</p></details>" for q, a in FAQS)
    faq_schema = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQS]}
    app = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "GolfPrice AI: UK Golf Price Checker",
           "applicationCategory": "BrowserApplication", "operatingSystem": "Chrome, Microsoft Edge",
           "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"},
           "url": f"{SITE}/extension/", "publisher": {"@type": "Organization", "name": "GolfPrice AI", "url": SITE}}
    if chrome or edge:
        btns = "".join(f'<a class="ex-btn" href="{u}" target="_blank" rel="noopener">{t}</a>'
                       for t, u in (("Add to Chrome, it’s free", chrome), ("Add to Edge, it’s free", edge)) if u)
        cta = f'<div class="ex-btns">{btns}</div><p class="ex-note">For Chrome and Microsoft Edge on a computer.</p>'
    else:
        cta = ('<p class="ex-soon"><b>Arriving in the Chrome Web Store and Edge Add-ons very soon.</b> '
               'The buttons will appear right here. Until then, <a href="/price-check.html">Is This A Good Price?</a> '
               'checks any price against our history.</p>')
    feats = [
        ("Lowest new UK price today", "The cheapest new price for the same model across multiple UK retailers, checked every 6 hours, with our verdict: good time to buy, typical price or wait if you can."),
        ("The “was price” check", "See a “was” or RRP price? We show what the model has actually sold for over the months we’ve tracked it, so you know the real saving."),
        ("A fair pre-owned price", "On pre-owned listings, see what pre-owned UK golf retailers are asking for the same model, and whether that listing looks good value."),
        ("One-tap watch", "Not ready to buy? Tap Watch and we’ll email you once when the price drops."),
    ]
    feat_html = "".join(f'<div class="pp-card ex-feat"><h3>{t}</h3><p>{d}</p></div>' for t, d in feats)
    body = f"""<div class="pp-wrap ex">
{crumbs_html}
<section class="pp-hub-top">
  <span class="sb-kicker">Free · Chrome &amp; Edge</span>
  <h1>The golf price checker for your browser</h1>
  <p class="pp-answer">Shopping for golf kit online? The free GolfPrice AI extension shows the lowest new UK price, the price history and a fair pre-owned price right on the product page, so you know if it’s a good price before you buy.</p>
  {cta}
</section>
<section class="pp-block">
  <img class="ex-shot" src="/assets/photos/tools/extension-wide.jpg" width="1280" height="800" alt="The GolfPrice AI panel on a golf driver’s product page, showing the lowest new UK price, the was price check and the price history">
</section>
<section class="pp-block">
  <h2>What it shows you</h2>
  <div class="ex-grid">{feat_html}</div>
</section>
<section class="pp-block pp-card ex-priv" id="privacy">
  <h2>Privacy, in plain English</h2>
  <ul>
    <li><b>What it reads:</b> the product name and price on golf product pages at the shops it works on. Nothing on any other site.</li>
    <li><b>What it sends:</b> it downloads our public price files from golfpriceai.com. If you tap Watch, it sends your email and the product to our alerts service, just like signing up on our site.</li>
    <li><b>What it keeps:</b> your alert email (if you choose to save it) and your settings, on your own computer.</li>
    <li><b>What it never does:</b> no browsing history, no tracking, no ads, and it never changes a shop’s links, codes, basket or cookies.</li>
  </ul>
  <p>Full details are in our <a href="/legal/privacy-policy.html#extension">privacy policy</a>.</p>
</section>
<section class="pp-block ex-faq">
  <h2>Browser extension questions</h2>
  {faqs}
</section>
</div>"""
    css = ('<style>.ex-btns{display:flex;flex-wrap:wrap;gap:10px}.ex-btn{display:inline-flex;align-items:center;min-height:48px;padding:0 22px;border-radius:12px;background:var(--gp-green);color:#fff;font-weight:700;text-decoration:none}.ex-btn:hover{background:var(--gp-green-dark);color:#fff}'
           '.ex-faq{display:flex;flex-direction:column;gap:10px}.ex-faq details{background:#fff;border:1px solid #e4e6e0;border-radius:14px;padding:14px 16px}.ex-faq summary{font-weight:700;font-size:16px;cursor:pointer}.ex-faq details p{margin:10px 0 0;color:#4a554e}'
           '.ex-note{font-size:14px;color:var(--gp-text-3);margin:0}'
           '.ex-soon{background:var(--gp-pale);border-radius:14px;padding:14px 16px;margin:0;font-size:15px}'
           '.ex-shot{width:100%;height:auto;border-radius:16px;border:1px solid var(--gp-line);box-shadow:0 12px 32px rgba(22,36,28,.12)}'
           '.ex-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.ex-feat{padding:18px 20px}'
           '.ex-feat h3{font-size:17px;margin:0 0 6px}.ex-feat p{margin:0;color:var(--gp-text-2)}'
           '.ex-priv{padding:20px 24px;margin-top:10px}.ex-priv ul{padding-left:18px;margin:0 0 10px}.ex-priv li{margin-bottom:6px}'
           '@media(max-width:760px){.ex-grid{grid-template-columns:1fr}}</style>')
    return page_shell(title="Free Golf Price Checker Browser Extension (UK) | GolfPrice AI",
                      description="A free Chrome and Edge extension for UK golfers: see the lowest new UK price, the real saving behind a “was” price and a fair pre-owned price on golf product pages.",
                      canonical=f"{SITE}/extension/", body=body, section="tools", schema=[crumbs, faq_schema, app],
                      noindex=False, extra_head=css, og_image=f"{SITE}/assets/photos/tools/extension-wide.jpg")


def model_line():
    """The desktop-only line on model pages, once the extension is in a store."""
    chrome, edge = store_urls()
    if not (chrome or edge):
        return ""
    return ('<p class="pp-check pp-ext"><a href="/extension/?utm_source=site&amp;utm_medium=model-page&amp;utm_campaign=extension">'
            'Shopping on a computer? Get these prices on every golf shop’s page with our free browser extension.</a></p>')


def build(root=None):
    from price_pages import _write
    root = root or ROOT
    return ["/extension/"] if _write(root / "extension" / "index.html", page()) else []


if __name__ == "__main__":
    print(build())
