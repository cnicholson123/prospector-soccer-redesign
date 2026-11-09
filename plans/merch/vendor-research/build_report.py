import json, html, pathlib, sys

HERE = pathlib.Path(__file__).parent
d = json.load(open(HERE / "vendors.json"))
BOOK = pathlib.Path(sys.argv[1])  # dir with crest.png + fonts css reuse
e = lambda s: html.escape(str(s)) if s is not None else ""
src = {s["id"]: s for s in d["sources"]}
prov = {p["id"]: p for p in d["providers"]}
PRODUCTS = {p["id"]: p["description"] for p in d["products"]}
SHORT = {1: "Crest hoodie", 2: "Fan tee", 3: "Supporter scarf", 4: "Trucker cap", 5: "Pom beanie", 6: "Engraved bottle", 7: "Enamel pin set", 8: "Sherpa blanket", 9: "Cleat backpack", 10: "Decal + magnet"}
# Lookbook planning numbers (Prospector-Merch-Concept.pdf) for comparison
LOOK = {1: ("$50", "$18–24"), 2: ("$24", "$7–10"), 3: ("$25", "$7–10"), 4: ("$25", "$8–11"), 5: ("$22", "$7–10"), 6: ("$30", "$11–15"), 7: ("$15", "$3.50–5"), 8: ("$40", "$16–22"), 9: ("$45", "$18–24"), 10: ("$10", "$2–3")}
# Claude's synthesis of the public evidence at 48 units (see comparison page notes)
REAL48 = {
  1: ("≈ $37–50", "RCD 8.3 oz pullover blank $24.82 + 4-color print $7.10 + sleeve embroidery ≈ $5; a true heavyweight blank pushes toward the $50 national-blank hybrid.", "bad"),
  2: ("≈ $12", "RCD estimator, dark cotton tee, 2-color, all-in.", "ok"),
  3: ("≈ $16", "No local price; national custom-knit benchmark (Pinpops).", "warn"),
  4: ("≈ $19", "Conquer embroidery $7.40 + RCD C920 trucker blank $11.98; patch hats benchmark $19.25.", "warn"),
  5: ("≈ $14–15", "Conquer embroidery $7.50 + RCD SP02 beanie blank $6.98 (pom style to confirm).", "warn"),
  6: ("not priced locally", "Only national benchmark is brand-name Hydro Flask ($62); a generic 32 oz bottle needs a quote.", "warn"),
  7: ("≈ $13 / set", "No local price; national hard-enamel benchmark (VeperPins), tooling unclear.", "bad"),
  8: ("≈ $31–32", "Sherpa blank + Conquer embroidery hybrid; NorthEast Fleece benchmark $30.97.", "warn"),
  9: ("≈ $48", "Athletico youth blank reference + Conquer embroidery; above the $45 planned retail.", "bad"),
  10: ("≈ $10 / pair", "No local price for this spec. National benchmark (Bagmasters decal + 4AllPromos magnet) ≈ $10.03 per pair, equal to the planned retail. Local signal: a Peak Printz sticker-widget total of $29.25 (25-sticker minimum).", "bad"),
}

def money(v):
    return "—" if v is None else f"${v:,.2f}"

pages = []
def page(body, num, cls=""):
    num = len(pages) + 1
    pages.append(f"""<section class="page {cls}"><header class="ph"><img class="crest sm" src="crest.png" alt=""><span>Prospector Soccer Club · Local merch supplier research</span></header>{body}<footer class="pf"><span>Public web pricing only · researched {e(d['research_date'])} · no vendors contacted</span><span>{num}</span></footer></section>""")

# Cover
el = sum(1 for p in d["providers"] if p["county"] == "El Dorado")
sa = sum(1 for p in d["providers"] if p["county"] == "Sacramento")
pages.append(f"""<section class="page cover"><div class="rays"></div>
<div class="cover__top"><img class="crest" src="crest.png" alt=""><div class="wordmark"><b>Prospector</b><span>Soccer Club</span></div></div>
<div class="cover__body"><p class="eyebrow light">Merch store · supplier research</p><h1>Local<br><em>makers</em>.</h1>
<p class="lead">Screen printers, embroiderers and specialty shops in El Dorado and Sacramento counties, with every price taken from their public websites.</p>
<div class="stats"><div><b>{len(d['providers'])}</b><span>local providers</span></div><div><b>{el}</b><span>El Dorado County</span></div><div><b>{sa}</b><span>Sacramento County</span></div><div><b>{len(d['sources'])}</b><span>cited sources</span></div></div></div>
<p class="cover__note">Researched {e(d['research_date'])} from public websites only. No business was contacted, no forms were submitted and no quotes were requested. Figures are estimates, not quotes.</p></section>""")

# Summary
page(f"""<p class="eyebrow">Summary</p><h2>What the public prices tell us</h2>
<div class="cols"><div>
<h3>Key findings</h3><ul>
<li><b>Apparel decoration is well covered locally.</b> Conquer Printing (North Highlands), TreeCity Print (Sacramento), RayLay (Sacramento), RCD (Placerville) and Bougie Print (Placerville) all publish rate cards or calculators for screen printing, DTF or embroidery.</li>
<li><b>Tees are the clear first product.</b> A 2-color tee comes to about $12 all-in at 48 units locally, leaving about 50% margin at $24.</li>
<li><b>Real costs run higher than the concept lookbook assumed</b> for most non-tee items. Using a heavyweight hoodie blank, patch caps, sherpa blankets and cleat backpacks pushes unit costs near or above the planned retail prices.</li>
<li><b>Specialty items have no local public pricing:</b> custom-knit scarves, hard-enamel pins, engraved stainless bottles, decals and magnets. These need direct quotes or national suppliers.</li>
</ul></div><div>
<h3>Suggested shortlist to contact later</h3>
<ol>
<li><b>RCD (Placerville)</b>: closest to the club; public estimator, no screen setup fee, online team stores.</li>
<li><b>Bougie Print (Placerville)</b>: DTF + embroidery with clear rates; $50 digitizing; school/team store program.</li>
<li><b>Conquer Printing (North Highlands)</b>: the most complete published price list (screen + embroidery tiers).</li>
<li><b>TreeCity Print (Sacramento)</b>: transparent screen, DTF and embroidery rate cards; 24-piece minimum.</li>
<li><b>Sierra Stitch Factory (Shingle Springs)</b>: local embroidery since 1999; not publicly priced, worth asking for caps/blankets.</li>
</ol>
<div class="callout"><b>Recommendation</b><p>Launch with tees, hoodies (repriced), beanies and decals. Get direct quotes before committing to scarves, pins, bottles, blankets or backpacks.</p></div>
</div></div>""", 2)

# Directory
rows = ""
for p in d["providers"]:
    status = " / ".join({"a": "Published rates", "b": "Starting-at", "c": "Not priced"}[s] for s in p["pricing_status"])
    prods = ", ".join(SHORT[i] for i in p["plausible_product_ids"]) or "—"
    rows += f"<tr><td><b>{e(p['name'])}</b><br><span class='muted'>{e(p.get('street_address') or p['city'])}</span></td><td>{e(p['city'])}<br><span class='muted'>{e(p['county'])} Co.</span></td><td>{e(', '.join(p['services']))}</td><td>{e(prods)}</td><td>{e(status)}</td><td>{e(p.get('phone') or '—')}<br><span class='url'>{e(p['website'].replace('https://','').rstrip('/'))}</span></td></tr>"
page(f"""<p class="eyebrow">Directory</p><h2>Local providers</h2><table class="t small"><thead><tr><th>Provider</th><th>Location</th><th>Services</th><th>Could make</th><th>Public pricing</th><th>Contact</th></tr></thead><tbody>{rows}</tbody></table>""", 3, "dense")

# Price evidence
ev = ""
ev_rows = []
for x in d["price_evidence"]:
    ev = ""
    p = prov.get(x["provider_id"], {})
    vals = x["values"]
    parts = []
    for k, v in vals.items():
        if isinstance(v, list):
            if k == "quantity": continue
            v = " / ".join("—" if a is None else (f"${a:g}" if isinstance(a, (int, float)) else str(a)) for a in v)
            k = k + " (24/48/100)"
        elif isinstance(v, (int, float)) and not k.endswith("percent") and k not in ("minimum", "minimum_stickers", "screen_minimum", "embroidery_minimum", "minimum_hours"):
            v = f"${v:g}"
        parts.append(f"{k.replace('_',' ')}: {v}")
    url = (src.get(x.get("source_ids", [None])[0]) or {}).get("url", "")
    cls = {"a": "Published", "b": "Starting-at", "c": "Not priced"}[x["classification"]]
    ev += f"<tr><td><b>{e(p.get('name','').split(' (')[0].split(' / ')[0])}</b></td><td>{e(x['description'])}<br><span class='muted'>{e('; '.join(parts))}</span>{('<br><i class=muted>'+e(x['caveat'])+'</i>') if x.get('caveat') else ''}</td><td>{cls}</td><td class='url'>{e(url.replace('https://',''))}</td></tr>"
    ev_rows.append(ev)
EVHEAD = "<table class=\"t small\"><thead><tr><th>Provider</th><th>What's published</th><th>Type</th><th>Source</th></tr></thead><tbody>"
half = (len(ev_rows) + 1) // 2
page(f"""<p class="eyebrow">Evidence</p><h2>Published prices found</h2><p class="lead dark">Every figure below appears on the provider's own public page. I spot-checked eight of them against the live pages. Rates are per piece unless noted, and garments are usually extra.</p>{EVHEAD}{''.join(ev_rows[:half])}</tbody></table>""", 0, "dense")
page(f"""<p class="eyebrow">Evidence (continued)</p><h2>Published prices found</h2>{EVHEAD}{''.join(ev_rows[half:])}</tbody></table>""", 0, "dense")

# Quotes
qr = ""
for q in sorted(d["quotes"], key=lambda q: (q["product_id"], q["scope"] != "local_partial")):
    r = {x["requested_quantity"]: x for x in q["rows"]}
    scope = {"local_partial": "Local (partial)", "local_proxy": "Local (proxy)", "local_unpriced": "Local", "hybrid_benchmark": "Hybrid", "national_benchmark": "National benchmark"}.get(q["scope"], q["scope"])
    tag = "nat" if "national" in q["scope"] or "hybrid" in q["scope"] else ""
    qual = r.get(48, {}).get("qualifications", "")
    qr += f"<tr class='{tag}'><td><b>{e(SHORT[q['product_id']])}</b></td><td>{scope}</td><td>{e(q['label'])}{('<br><span class=muted>'+e(qual)+'</span>') if qual else ''}</td><td class='n'>{money(r.get(24,{}).get('estimated_unit_usd'))}</td><td class='n'>{money(r.get(48,{}).get('estimated_unit_usd'))}</td><td class='n'>{money(r.get(100,{}).get('estimated_unit_usd'))}</td></tr>"
page(f"""<p class="eyebrow">Estimates</p><h2>Unit cost by quantity</h2><p class="lead dark">Per-unit estimates built only from public prices. "Partial" rows cover decoration only, because the local blank isn't publicly priced. Shaded rows are national or hybrid benchmarks, shown only for context.</p><table class="t small q"><thead><tr><th>Product</th><th>Basis</th><th>Detail</th><th>24 units</th><th>48 units</th><th>100 units</th></tr></thead><tbody>{qr}</tbody></table>""", 5, "dense")

# Comparison vs lookbook
cr = ""
for i in range(1, 11):
    real, note, lvl = REAL48[i]
    cr += f"<tr class='{lvl}'><td><b>{e(SHORT[i])}</b></td><td class='n'>{LOOK[i][0]}</td><td class='n'>{LOOK[i][1]}</td><td class='n'><b>{e(real)}</b></td><td>{e(note)}</td></tr>"
page(f"""<p class="eyebrow">Reality check</p><h2>Lookbook vs. public prices</h2><p class="lead dark">The concept lookbook used planning estimates. This table compares them with what the public prices imply at 48 units. Red rows would sell near or below cost at the planned retail price.</p>
<table class="t cmp"><thead><tr><th>Item</th><th>Planned retail</th><th>Lookbook cost est.</th><th>Public-price est. (48)</th><th>Basis</th></tr></thead><tbody>{cr}</tbody></table>
<div class="cols" style="margin-top:18px"><div class="callout"><b>Pricing adjustments to consider</b><p>Hoodie $60–65 (or a midweight blank and no sleeve embroidery); cap $28–30; blanket $45–50. Swap the cleat backpack for an embroidered drawstring cinch bag; use a generic bottle instead of a brand name.</p></div>
<div class="callout light"><b>Why the gap</b><p>The lookbook assumed bulk promo-blank costs. Real local pricing adds per-piece decoration, setup and digitizing, and premium blanks at small quantities.</p></div></div>""", 6)

# Gaps + questions
gaps = "".join(f"<li>{e(g)}</li>" for g in d["gaps"])
assum = "".join(f"<li>{e(a)}</li>" for a in d["assumptions"])
page(f"""<p class="eyebrow">Next steps</p><h2>Gaps &amp; questions for later</h2><div class="cols"><div>
<h3>Not verified from public sources</h3><ul>{gaps}</ul>
<h3>Assumptions used</h3><ul>{assum}<li>No sales tax, freight, artwork, packaging or bundle-assembly costs included.</li></ul></div><div>
<h3>Questions to ask when the club contacts them</h3><ol>
<li>Full quote at 24/48/100 for the exact blank (brand, weight, colors), youth and adult sizes, with setup, screens and digitizing itemized.</li>
<li>Can you run a club web store or pre-order window, and do you bag and sort by player for pickup?</li>
<li>Non-profit or youth-sports discounts? Reorder pricing that reuses screens and digitizing?</li>
<li>Turnaround for a pre-order run, and rush fees for all-star or AGM deadlines.</li>
<li>Will you decorate customer-supplied items (scarves, bottles, blankets) bought elsewhere?</li>
<li>Patch options for caps (woven vs. embroidered vs. PVC) and their minimums.</li>
<li>Sales tax on club merch (to confirm with the club's treasurer and accountant).</li>
</ol></div></div>""", 7)

# Sources
sl = "".join(f"<li><b>{e(s['title'])}</b> <span class='url'>{e(s['url'])}</span></li>" for s in d["sources"])
page(f"""<p class="eyebrow">Sources</p><h2>Cited pages</h2><p class="muted" style="margin-bottom:10px">All accessed {e(d['research_date'])}.</p><ol class="src">{sl}</ol>""", 8, "dense")

CSS = (HERE / "report.css").read_text()
doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prospector Soccer Club — Local Merch Supplier Research</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>{CSS}</style></head><body>{''.join(pages)}</body></html>"""
(BOOK / "vendors.html").write_text(doc)
print("ok", len(pages), "pages")
