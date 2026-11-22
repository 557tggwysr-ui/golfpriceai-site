"""The UK Golf Price Index: one number for whether golf kit is getting cheaper or dearer.

Ideas board "golf-price-index" (John, 22 Nov 2026: what would an extraordinary mind do?). Like a
consumer price index, it follows a fixed basket: every golf model we've tracked since the base date,
the same models every time, using each one's lowest price across multiple UK retailers. 100 = the
base date. Built from data/models.json only; rebuilt with the price pages.

    python3 scripts/price_index.py
"""
import json
import statistics as st
from datetime import date, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import price_pages as P  # noqa: E402

BASE = "2026-09-15"  # the first date with broad coverage across categories
SHAFTS = {"Aldila", "Fujikura", "True Temper", "Project X", "Mitsubishi", "KBS", "Graphite Design", "UST", "Nippon", "Accra", "LA Golf", "Oban"}
NAMES = {"driver": "Drivers", "wood": "Fairway woods", "hybrid": "Hybrids", "irons": "Iron sets", "wedge": "Wedges", "putter": "Putters",
         "ball": "Golf balls", "bag": "Golf bags", "electric-trolley": "Electric trolleys", "rangefinder": "Rangefinders", "gps-watch": "GPS watches"}
esc = P.esc


def at(h, d):
    p = None
    for x, v in h:
        if x <= d:
            p = v
    return p


def nice(d):
    x = date.fromisoformat(d)
    return f"{x.day} {x.strftime('%B %Y')}"


def points(latest):
    d, out = date.fromisoformat(BASE), [BASE]
    m = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    while str(m) < latest:
        out.append(str(m))
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return out + [latest]


def compute():
    data = json.loads((ROOT / "data/models.json").read_text())
    latest = (data.get("lastUpdated") or str(date.today()))[:10]
    basket = [m for m in data["models"] if m.get("gate", {}).get("passes") and m.get("type") in NAMES and m.get("brand") not in SHAFTS
              and m.get("history") and m["history"][0][0] <= BASE]
    pts = points(latest)
    def series(sel):
        return [round(st.mean(at(m["history"], d) / at(m["history"], BASE) for m in sel) * 100, 1) for d in pts]
    cats = []
    for t, name in NAMES.items():
        sel = [m for m in basket if m["type"] == t]
        if len(sel) >= 20:
            s = series(sel)
            cats.append({"type": t, "name": name, "n": len(sel), "series": s, "now": s[-1]})
    return {"base": BASE, "latest": latest, "points": pts, "basket": len(basket), "series": series(basket), "cats": sorted(cats, key=lambda c: c["now"])}


def chart(f):
    w, h, pad = 640, 260, 36
    s, pts = f["series"], f["points"]
    lo, hi = min(s) - 2, max(max(s), 100) + 1.5
    x = lambda i: pad + i * (w - 2 * pad) / max(1, len(s) - 1)
    y = lambda v: h - pad - (v - lo) / (hi - lo) * (h - 2 * pad)
    path = " ".join(f"{'M' if i == 0 else 'L'}{x(i):.1f},{y(v):.1f}" for i, v in enumerate(s))
    base_y = y(100)
    labels = "".join(f'<text x="{x(i):.1f}" y="{h - 10}" text-anchor="middle" font-size="15" fill="#4b5e52">{esc(nice(d)[:-5])}</text>' for i, d in enumerate(pts))
    dots = "".join(f'<circle cx="{x(i):.1f}" cy="{y(v):.1f}" r="4" fill="#2f8a1f"/>' for i, v in enumerate(s))
    return (f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="UK Golf Price Index since {esc(nice(f["base"]))}" style="width:100%;height:auto">'
            f'<line x1="{pad}" x2="{w - pad}" y1="{base_y:.1f}" y2="{base_y:.1f}" stroke="#c9d3cb" stroke-dasharray="4 4"/>'
            f'<text x="{w - pad}" y="{base_y - 6:.1f}" text-anchor="end" font-size="12" fill="#4b5e52">100 = {esc(nice(f["base"]))}</text>'
            f'<path d="{path}" fill="none" stroke="#2f8a1f" stroke-width="4" stroke-linejoin="round"/>{dots}{labels}</svg>')


def build():
    f = compute()
    now = f["series"][-1]
    chg = round(100 - now, 1)
    word = "cheaper" if now < 100 else "dearer"
    rows = "".join(f'<tr><td>{esc(c["name"])}</td><td class="n">{c["n"]}</td><td class="n"><b>{c["now"]}</b></td>'
                   f'<td class="n">{abs(round(100 - c["now"], 1))}% {"cheaper" if c["now"] < 100 else "dearer"}</td></tr>' for c in f["cats"])
    css = """<style>.ix{max-width:760px;margin:0 auto;padding:8px 18px 40px;font:400 17px/1.65 Inter,system-ui,sans-serif;color:#14251a}
.ix h1{font:800 clamp(28px,6vw,42px)/1.12 Poppins,system-ui,sans-serif;margin:10px 0 8px;color:#103420}
.ix h2{font:800 23px/1.25 Poppins,system-ui,sans-serif;margin:30px 0 10px;color:#103420}
.ix .big{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;background:#103420;color:#fff;border-radius:18px;padding:18px 20px;margin:14px 0}
.ix .big b{font:800 64px/1 Poppins,sans-serif;color:#ffd600}.ix .big span{font-size:17px}
.ix table{width:100%;border-collapse:collapse;font-size:15px}.ix th,.ix td{text-align:left;padding:9px 8px;border-bottom:1px solid #e2e8e3}
.ix th{font:700 13px Poppins,sans-serif;color:#4b5e52;text-transform:uppercase}.ix td.n{text-align:right}
.ix .note{font-size:14px;color:#4b5e52;background:#f3f6f3;border-radius:10px;padding:12px 14px;margin-top:24px}
.ix .kick{display:inline-block;background:#103420;color:#ffd600;font:800 12px Poppins,sans-serif;letter-spacing:.08em;padding:7px 10px;border-radius:6px;margin-top:10px}</style>"""
    body = f"""{css}<div class="ix"><span class="kick">THE UK GOLF PRICE INDEX</span>
<h1>Is golf kit getting cheaper? The UK Golf Price Index</h1>
<div class="big"><b>{now}</b><span>on {esc(nice(f["latest"]))}. Golf kit is {abs(chg)}% {word} than on {esc(nice(f["base"]))} (= 100).</span></div>
<p>One number for the question every golfer asks. We follow the same {f["basket"]:,} golf models every time, at their lowest price across multiple UK retailers, and compare with {esc(nice(f["base"]))}. Below 100 means golf kit costs less than it did then; above 100, more.</p>
{chart(f)}
<h2>By category</h2>
<table><thead><tr><th>Category</th><th>Models</th><th>Index</th><th>Since {esc(nice(f["base"])[:-5])}</th></tr></thead><tbody>{rows}</tbody></table>
<p><a href="/journal/is-black-friday-golf-genuinely-cheaper/">Read: is Black Friday golf genuinely cheaper?</a> · <a href="/prices/black-friday/">What's genuinely cheaper right now</a></p>
<p class="note"><b>How the index works.</b> A fixed basket of {f["basket"]:,} golf models tracked since {esc(nice(f["base"]))}, each at its lowest price across multiple UK retailers, averaged as price relatives (100 = {esc(nice(f["base"]))}). The same models every time, so new launches don't skew it. Junior sets and shafts sold on their own are left out; categories with fewer than 20 models aren't shown. Updated with our prices. Free to quote with a link to golfpriceai.com/golf-price-index/. GolfPrice AI earns a commission from some retailers when you buy through our links; it never changes the prices we show or the index.</p></div>"""
    crumbs, bc = P.breadcrumb([("Home", "/"), ("The UK Golf Price Index", None)])
    schema = [{"@context": "https://schema.org", "@type": "Dataset", "name": "The UK Golf Price Index", "description": f"Fixed-basket index of {f['basket']} golf models' lowest UK prices; 100 = {f['base']}.",
               "creator": {"@type": "Organization", "name": "GolfPrice AI", "url": P.SITE}, "dateModified": f["latest"], "url": f"{P.SITE}/golf-price-index/",
               "license": "https://creativecommons.org/licenses/by/4.0/"}, bc]
    html = P.page_shell(title="UK Golf Price Index: Is Golf Kit Getting Cheaper?", description=f"The UK Golf Price Index is {now} ({abs(chg)}% {word} than {nice(f['base'])}): one number for UK golf kit prices, by category, from GolfPrice AI.",
                        canonical=f"{P.SITE}/golf-price-index/", body='<div class="ix" style="padding-bottom:0">' + crumbs + "</div>" + body, section="prices", schema=schema, noindex=False)
    out = ROOT / "golf-price-index" / "index.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    (ROOT / "data/price-index.json").write_text(json.dumps(f, indent=2), encoding="utf-8")
    try:
        from agent_common import register_pages
        register_pages(["golf-price-index/"])
    except Exception as e:
        print("sitemap note skipped:", e)
    print(f"UK Golf Price Index: {now} ({f['basket']} models)")


if __name__ == "__main__":
    build()
