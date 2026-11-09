import html, pathlib

OUT = pathlib.Path(__file__).parent / "book" / "lookbook.html"

P = [
  dict(id="hoodie", n="01", name="Crest Hoodie", tag="The flagship", cat="Apparel",
       desc="A heavyweight pullover in deep navy with the full-color Prospector crest on the chest, the club name arched in gold above it, and a small gold pickaxe on the left cuff. Gold drawcords finish it.",
       details=[("Material", "8–10 oz cotton/poly fleece, brushed interior"), ("Decoration", "Screen print chest; embroidered cuff pickaxe"), ("Sizes", "Youth XS–XL · Adult S–3XL"), ("Colors", "Navy (gold cords)")],
       retail="$50", youth="$45 youth", cost="$18–24", margin="52–64%", moq="24", lead="2–3 weeks"),
  dict(id="fan-tee", n="02", name="Gold Country Fan Tee", tag="For everyone", cat="Apparel",
       desc="A soft royal-blue tee with a distressed vintage print: GOLD COUNTRY over a crossed pickaxe and starburst soccer ball, with EST. EL DORADO COUNTY below. Easy to wear for siblings, grandparents and fans who wouldn't wear a crest.",
       details=[("Material", "Ring-spun cotton or tri-blend, 4.2–5 oz"), ("Decoration", "Two-color water-based screen print, distressed"), ("Sizes", "Youth XS–XL · Adult XS–3XL"), ("Colors", "Royal blue; optional navy")],
       retail="$24", youth="$20 youth", cost="$7–10", margin="58–71%", moq="24", lead="2 weeks"),
  dict(id="scarf", n="03", name="Supporter Scarf", tag="Sideline classic", cat="Accessories",
       desc="A double-knit jacquard scarf in navy, gold and royal blue with PROSPECTOR SOCCER CLUB knitted through the center and a crest on each end. Made for cold-weather all-star games and the December Annual General Meeting.",
       details=[("Material", "Acrylic double-knit jacquard, fringed ends"), ("Size", "~60 × 7 in"), ("Decoration", "Knitted-in design (not printed)"), ("Colors", "Navy / gold / royal")],
       retail="$25", youth=None, cost="$7–10", margin="60–72%", moq="100", lead="6–8 weeks (custom knit)"),
  dict(id="cap", n="04", name="Crest Trucker Cap", tag="Coaches & parents", cat="Headwear",
       desc="A structured navy trucker with a cream mesh back, a woven crest patch with a gold stitched border, and a gold undervisor.",
       details=[("Style", "Mid-profile, snapback closure"), ("Decoration", "Woven patch, merrowed gold border"), ("Sizes", "Adult one size · Youth one size"), ("Colors", "Navy / cream mesh")],
       retail="$25", youth=None, cost="$8–11", margin="56–68%", moq="24", lead="3–4 weeks"),
  dict(id="beanie", n="05", name="Pom Beanie", tag="Winter season", cat="Headwear",
       desc="A chunky cuffed knit in navy with a royal-blue stripe, a gold pom-pom and a woven crest label on the cuff.",
       details=[("Material", "Acrylic rib knit"), ("Decoration", "Woven label (stock beanie) or knitted stripe (custom)"), ("Sizes", "One size; youth size available"), ("Colors", "Navy / royal / gold pom")],
       retail="$22", youth=None, cost="$7–10", margin="55–68%", moq="48", lead="3–4 weeks (stock + label)"),
  dict(id="bottle", n="06", name="Engraved Insulated Bottle", tag="Every practice", cat="Gear",
       desc="A 32 oz matte navy double-wall stainless bottle with a bamboo-and-steel cap. The crest is laser-engraved as a single gold-tone mark, so it never peels or fades.",
       details=[("Capacity", "32 oz (also 20 oz youth option)"), ("Decoration", "Laser engraving, single tone"), ("Features", "Keeps cold 24 h · carry handle"), ("Colors", "Matte navy")],
       retail="$30", youth="$24 (20 oz)", cost="$11–15", margin="50–63%", moq="24", lead="2–3 weeks"),
  dict(id="pins", n="07", name="Enamel Pin Set", tag="Collect them", cat="Collectibles",
       desc="Four hard-enamel pins on a backing card: the full crest, a gold pickaxe, a starburst soccer ball and a PSC shield. Cheap to produce, collectible, and good as end-of-season awards or team-milestone rewards.",
       details=[("Set", "4 pins on a printed backer card"), ("Finish", "Hard enamel, polished gold metal"), ("Size", "~1–1.5 in each"), ("Backing", "Rubber clutch")],
       retail="$15", youth=None, cost="$3.50–5 / set", margin="67–77%", moq="100 per design", lead="3–4 weeks"),
  dict(id="blanket", n="08", name="Sherpa Sideline Blanket", tag="Chilly mornings", cat="Gear",
       desc="A plush navy sherpa-fleece stadium blanket with a large embroidered crest and gold blanket-stitch edging. It rolls up with a carry strap that clips onto a camp chair.",
       details=[("Material", "Sherpa / micro-plush fleece"), ("Size", "~50 × 60 in"), ("Decoration", "Embroidered crest, gold edge stitch"), ("Includes", "Carry strap")],
       retail="$40", youth=None, cost="$16–22", margin="45–60%", moq="24", lead="3–4 weeks"),
  dict(id="backpack", n="09", name="Cleat Backpack", tag="Ready for practice", cat="Gear",
       desc="A youth soccer backpack in navy with royal accents, a ventilated bottom cleat compartment, a side ball net, gold zipper pulls and an embroidered crest patch.",
       details=[("Capacity", "~25 L, ball net + cleat pocket"), ("Decoration", "Embroidered crest patch"), ("Sizes", "Youth / adult"), ("Colors", "Navy / royal / gold pulls")],
       retail="$45", youth=None, cost="$18–24", margin="47–60%", moq="24", lead="3–4 weeks"),
  dict(id="decal", n="10", name="Car Decal + PSC Magnet", tag="Show it around town", cat="Collectibles",
       desc="A die-cut shield decal and a navy oval PSC magnet with a gold pickaxe. The lowest-priced item, and free club advertising around Cameron Park, Shingle Springs and Rescue.",
       details=[("Decal", "Die-cut weatherproof vinyl, ~5 in"), ("Magnet", "Oval car magnet, ~6 × 4 in"), ("Finish", "UV laminated"), ("Pack", "Sold as a set")],
       retail="$10", youth=None, cost="$2–3", margin="70–80%", moq="100", lead="1–2 weeks"),
]

def e(s): return html.escape(s)

pages = []
# Cover
pages.append(f"""
<section class="page cover">
  <div class="cover__bg"><img src="pitch-sunrise.webp" alt=""></div>
  <div class="rays"></div>
  <div class="cover__top"><img class="crest" src="crest.png" alt=""><div class="wordmark"><b>Prospector</b><span>Soccer Club</span></div></div>
  <div class="cover__body">
    <p class="eyebrow light">Merch collection concept · 2026–27</p>
    <h1>Wear the<br><em>gold</em>.</h1>
    <p class="lead">Ten club products for players, families, coaches and fans, designed around the Prospector crest and the club's Gold Country roots.</p>
  </div>
  <div class="cover__strip">
    <img src="hoodie.jpg" alt=""><img src="scarf.jpg" alt=""><img src="cap.jpg" alt=""><img src="bottle.jpg" alt="">
  </div>
  <p class="cover__note">Concept lookbook · Product images are AI-generated mockups · Pricing is a planning estimate</p>
</section>""")

# Overview
cards = "".join(f"""<div class="ov"><img src="{p['id']}.jpg" alt=""><div><span class="ov__n">{p['n']}</span><b>{e(p['name'])}</b><span class="ov__p">{p['retail']}</span></div></div>""" for p in P)
pages.append(f"""
<section class="page">
  <header class="ph"><img class="crest sm" src="crest.png" alt=""><span>Prospector Soccer Club · Merch concept</span></header>
  <p class="eyebrow">The collection</p>
  <h2>Ten pieces, one club</h2>
  <p class="lead dark">One consistent visual language across apparel, headwear, gear and collectibles: navy and gold, the pickaxe, and the starburst from the crest. Prices are suggested retail.</p>
  <div class="ovgrid">{cards}</div>
  <footer class="pf"><span>Concept — not for production</span><span>2</span></footer>
</section>""")

for i, p in enumerate(P):
    det = "".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in p["details"])
    youth = f'<span class="youth">{e(p["youth"])}</span>' if p["youth"] else ""
    pages.append(f"""
<section class="page product">
  <header class="ph"><img class="crest sm" src="crest.png" alt=""><span>Prospector Soccer Club · Merch concept</span><span class="cat">{e(p['cat'])}</span></header>
  <div class="hero"><img src="{p['id']}.jpg" alt="{e(p['name'])}"><span class="num">{p['n']}</span></div>
  <div class="pbody">
    <div class="pmain">
      <p class="eyebrow">{e(p['tag'])}</p>
      <h2>{e(p['name'])}</h2>
      <p class="desc">{e(p['desc'])}</p>
      <dl class="det">{det}</dl>
    </div>
    <aside class="price">
      <p class="price__label">Suggested retail</p>
      <p class="price__big">{p['retail']}</p>{youth}
      <dl>
        <div><dt>Est. unit cost</dt><dd>{p['cost']}</dd></div>
        <div><dt>Est. margin</dt><dd>{p['margin']}</dd></div>
        <div><dt>Typical minimum</dt><dd>{p['moq']} units</dd></div>
        <div><dt>Lead time</dt><dd>{e(p['lead'])}</dd></div>
      </dl>
    </aside>
  </div>
  <footer class="pf"><span>Estimates assume ~25–100 units; confirm with supplier quotes</span><span>{i + 3}</span></footer>
</section>""")

rows = "".join(f"<tr><td>{p['n']}</td><td><b>{e(p['name'])}</b></td><td>{p['retail']}{(' / ' + e(p['youth'])) if p['youth'] else ''}</td><td>{p['cost']}</td><td>{p['margin']}</td><td>{p['moq']}</td><td>{e(p['lead'])}</td></tr>" for p in P)
pages.append(f"""
<section class="page">
  <header class="ph"><img class="crest sm" src="crest.png" alt=""><span>Prospector Soccer Club · Merch concept</span></header>
  <p class="eyebrow">At a glance</p>
  <h2>Pricing summary</h2>
  <table class="pt"><thead><tr><th>#</th><th>Item</th><th>Retail</th><th>Est. cost</th><th>Est. margin</th><th>Min. qty</th><th>Lead time</th></tr></thead><tbody>{rows}</tbody></table>
  <p class="eyebrow" style="margin-top:26px">Suggested bundles</p>
  <div class="bundles">
    <div class="bundle"><b>New Family Pack</b><span class="bp">$40</span><p>Gold Country fan tee, car decal + magnet and enamel pin set. Saves $9.</p></div>
    <div class="bundle gold"><b>Sideline Pack</b><span class="bp">$79</span><p>Pom beanie, supporter scarf and sherpa blanket. Saves $8. Built for November games.</p></div>
    <div class="bundle"><b>Coach Kit</b><span class="bp">$95</span><p>Crest hoodie, trucker cap and engraved bottle. Saves $10.</p></div>
  </div>
  <footer class="pf"><span>All figures are planning estimates (Nov 2026) and need supplier quotes</span><span>13</span></footer>
</section>""")

pages.append(f"""
<section class="page notes">
  <header class="ph"><img class="crest sm" src="crest.png" alt=""><span>Prospector Soccer Club · Merch concept</span></header>
  <p class="eyebrow">Notes &amp; next steps</p>
  <h2>How this could launch</h2>
  <div class="cols">
    <div>
      <h3>About this concept</h3>
      <ul>
        <li>Product images are AI-generated mockups (GPT Image) built from the club crest. They show the direction, not exact production results.</li>
        <li>Costs, margins, minimums and lead times are planning estimates for small runs (about 25–100 units), based on typical US decorators and promo suppliers in 2026. They are not quotes.</li>
        <li>Production needs the club's vector crest artwork (AI/EPS/SVG) and supplier proofs before ordering.</li>
      </ul>
      <h3>Pricing logic</h3>
      <ul>
        <li>Retail is set near typical youth-club prices so families see fair value.</li>
        <li>Margins at the planned costs are roughly 45–80%. Proceeds could support club priorities such as scholarships or equipment, if the board chooses.</li>
        <li>Youth sizes are priced a few dollars lower where noted.</li>
      </ul>
    </div>
    <div>
      <h3>Suggested next steps</h3>
      <ol>
        <li>Board picks a launch set (suggested: hoodie, fan tee, cap, scarf, decal).</li>
        <li>Request quotes and samples from 2–3 local or online decorators.</li>
        <li>Choose a model: pre-order windows (low risk, no inventory), print-on-demand, or a small stocked run for events.</li>
        <li>Open the online shop on the club website, run from the new admin (products, sizes, inventory, orders).</li>
        <li>Launch with a pre-order window before the winter all-star games, with pickup at the AGM or practices.</li>
      </ol>
      <div class="contact"><b>Questions</b><span>communicationsdirector@prospector.org</span></div>
    </div>
  </div>
  <footer class="pf"><span>Prospector Soccer Club · Cameron Park · Shingle Springs · Rescue</span><span>14</span></footer>
</section>""")

CSS = r"""
@page { size: Letter; margin: 0; }
:root { --navy:#0B2A5B; --navy-d:#061833; --blue:#1D5BD6; --gold:#F2B705; --gold-l:#F8D36A; --cream:#FBF8F1; --cream-2:#F4EFE3; --ink:#121417; --slate:#5B6472; --oak:#8A6A3D; --line:#E7E1D4; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: Manrope, sans-serif; color: var(--ink); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: 8.5in; height: 11in; overflow: hidden; padding: .6in .65in .7in; background: var(--cream); page-break-after: always; }
h1, h2, h3, .wordmark b { font-family: "Barlow Condensed", sans-serif; text-transform: uppercase; color: var(--navy); }
h2 { font-size: 46px; line-height: .95; font-weight: 800; margin: 2px 0 12px; }
h3 { font-size: 20px; font-weight: 700; margin: 18px 0 8px; letter-spacing: .01em; }
.eyebrow { font-family: "Barlow Condensed"; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; font-size: 13px; color: var(--oak); display: flex; align-items: center; gap: 10px; }
.eyebrow::before { content: ""; width: 26px; height: 2px; background: var(--gold); }
.eyebrow.light { color: var(--gold-l); }
.lead { font-size: 17px; line-height: 1.5; max-width: 5.2in; }
.lead.dark { color: #2B313A; margin-bottom: 22px; }
.crest { width: 58px; filter: drop-shadow(0 4px 8px rgba(0,0,0,.25)); }
.crest.sm { width: 22px; filter: none; }
.ph { display: flex; align-items: center; gap: 10px; font-size: 10.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--slate); margin-bottom: 26px; }
.ph .cat { margin-left: auto; color: var(--navy); background: #E2ECFB; padding: 4px 10px; border-radius: 99px; letter-spacing: .1em; }
.pf { position: absolute; left: .65in; right: .65in; bottom: .35in; display: flex; justify-content: space-between; font-size: 9.5px; color: var(--slate); border-top: 1px solid var(--line); padding-top: 8px; }

/* cover */
.cover { background: var(--navy-d); color: #fff; padding: .6in .65in; }
.cover__bg { position: absolute; inset: 0; }
.cover__bg img { width: 100%; height: 62%; object-fit: cover; opacity: .55; }
.cover::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(6,24,51,.35) 0%, rgba(6,24,51,.7) 40%, var(--navy-d) 62%); z-index: 1; }
.rays { position: absolute; left: -2.5in; top: -2.5in; width: 8in; height: 8in; border-radius: 50%; background: repeating-conic-gradient(from 3deg, rgba(248,211,106,.9) 0deg 1.4deg, transparent 1.4deg 9deg); -webkit-mask: radial-gradient(circle, transparent 0 6%, #000 14%, rgba(0,0,0,.5) 40%, transparent 70%); opacity: .2; z-index: 1; }
.cover > .cover__top, .cover > .cover__body, .cover > .cover__strip { position: relative; z-index: 2; }
.cover > .cover__note { z-index: 2; }
.cover__top { display: flex; align-items: center; gap: 14px; }
.wordmark { display: flex; flex-direction: column; line-height: .9; }
.wordmark b { color: #fff; font-size: 30px; font-weight: 800; }
.wordmark span { font-family: "Barlow Condensed"; font-weight: 700; letter-spacing: .32em; text-transform: uppercase; color: var(--gold-l); font-size: 13px; margin-top: 4px; }
.cover__body { margin-top: 2.1in; }
.cover h1 { color: #fff; font-size: 108px; line-height: .86; font-weight: 800; margin: 10px 0 18px; }
.cover h1 em { font-style: normal; color: var(--gold); }
.cover .lead { color: rgba(255,255,255,.86); }
.cover__strip { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-top: .45in; }
.cover__strip img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 14px; border: 2px solid rgba(242,183,5,.6); }
.cover__note { position: absolute; left: .65in; right: .65in; bottom: .38in; font-size: 10px; color: rgba(255,255,255,.55); letter-spacing: .04em; }

/* overview */
.ovgrid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px 12px; }
.ov { background: #fff; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.ov img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.ov > div { padding: 8px 9px 10px; display: flex; flex-direction: column; gap: 2px; }
.ov__n { font-family: "Barlow Condensed"; font-weight: 800; color: var(--gold); font-size: 13px; }
.ov b { font-family: "Barlow Condensed"; text-transform: uppercase; color: var(--navy); font-size: 15px; line-height: 1; }
.ov__p { font-weight: 800; font-size: 12px; color: var(--ink); margin-top: 3px; }

/* product */
.hero { position: relative; height: 5.15in; border-radius: 18px; overflow: hidden; background: #fff; clip-path: polygon(0 0, 100% 0, 100% calc(100% - 44px), calc(100% - 44px) 100%, 0 100%); }
.hero { background: #FAF3E8; }
.hero img { width: 100%; height: 100%; object-fit: contain; object-position: 50% 50%; }
.num { position: absolute; left: 18px; top: 14px; font-family: "Barlow Condensed"; font-weight: 800; font-size: 54px; color: var(--navy); opacity: .14; }
.pbody { display: grid; grid-template-columns: 1fr 2.35in; gap: 26px; margin-top: 22px; }
.desc { font-size: 13.5px; line-height: 1.6; color: #2B313A; margin-bottom: 14px; }
.det { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.det div { padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
.det dt { font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--slate); }
.det dd { font-size: 12px; font-weight: 600; color: var(--navy); margin-top: 2px; }
.price { background: var(--navy); color: rgba(255,255,255,.85); border-radius: 16px; padding: 18px 18px 14px; position: relative; overflow: hidden; }
.price::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 5px; background: linear-gradient(90deg, var(--blue), var(--gold)); }
.price__label { font-size: 9.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--gold-l); }
.price__big { font-family: "Barlow Condensed"; font-weight: 800; font-size: 60px; line-height: .95; color: #fff; }
.youth { display: inline-block; font-size: 11px; font-weight: 700; color: var(--gold-l); margin-top: 2px; }
.price dl { margin-top: 10px; border-top: 1px solid rgba(255,255,255,.15); }
.price dl div { display: flex; justify-content: space-between; gap: 8px; padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,.1); font-size: 11px; }
.price dt { color: rgba(255,255,255,.7); }
.price dd { font-weight: 800; color: #fff; text-align: right; }

/* summary */
.pt { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; font-size: 11.5px; margin-top: 8px; }
.pt th { background: var(--navy); color: #fff; text-align: left; padding: 9px 10px; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase; }
.pt td { padding: 9px 10px; border-bottom: 1px solid var(--line); }
.pt td:first-child { font-family: "Barlow Condensed"; font-weight: 800; color: var(--gold); }
.pt tr:nth-child(even) td { background: #FCFAF5; }
.bundles { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 10px; }
.bundle { background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 14px; }
.bundle b { font-family: "Barlow Condensed"; text-transform: uppercase; font-size: 19px; color: var(--navy); display: block; }
.bp { font-family: "Barlow Condensed"; font-weight: 800; font-size: 34px; color: var(--navy); }
.bundle p { font-size: 11px; color: var(--slate); line-height: 1.45; margin-top: 4px; }
.bundle.gold { background: var(--navy); border-color: var(--navy); }
.bundle.gold b, .bundle.gold .bp { color: #fff; }
.bundle.gold .bp { color: var(--gold); }
.bundle.gold p { color: rgba(255,255,255,.75); }

/* notes */
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
.notes ul, .notes ol { padding-left: 18px; font-size: 12.5px; line-height: 1.55; color: #2B313A; }
.notes li { margin-bottom: 7px; }
.contact { margin-top: 22px; background: var(--navy); color: #fff; border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.contact b { font-family: "Barlow Condensed"; text-transform: uppercase; font-size: 18px; color: var(--gold); }
"""

doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prospector Soccer Club — Merch Concept</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style></head><body>{''.join(pages)}</body></html>"""
OUT.write_text(doc)
print("wrote", OUT)
