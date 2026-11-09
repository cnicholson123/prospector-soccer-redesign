import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { type SnapshotView } from '../snapshot-view.js';
import { sponsorCard, tierCard } from './shared.js';

export function sponsors(view: SnapshotView): Html {
  const page = view.doc("sponsorsPage", "sponsorsPage");
  return html`<section class="page-hero" aria-labelledby="hero-title">
<div class="page-hero__media">
<img src="${page.image("hero.image")}" alt="${page.text("hero.image.alt")}" width="1400" height="934" fetchpriority="high"${page.imageStyle("hero.image")}${page.edit("hero.image")}>
</div>
<div class="container">
<nav class="crumbs" aria-label="Breadcrumb">
<a href="/">Home</a>
<span aria-hidden="true">›</span>
<span aria-current="page">${page.rich("hero.title", true)}</span>
</nav>
<span class="eyebrow eyebrow--light"${page.edit("hero.eyebrow")}>${page.text("hero.eyebrow")}</span>
<h1 id="hero-title"${page.edit("hero.title")}>${page.rich("hero.title", true)}</h1>
<p class="lead"${page.edit("hero.lead")}>${page.text("hero.lead")}</p>
<div class="page-hero__chips">${page.list("hero.chips").map((item, index) => html`<span class="pill pill--dark"${item.edit("text")}>${item.text("text")}</span>`)}</div>
</div>
</section>

<section class="section section--white" id="gold-sponsors">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("goldSection.eyebrow")}>${page.text("goldSection.eyebrow")}</span>
<h2${page.edit("goldSection.title")}>${page.rich("goldSection.title", true)}</h2>
</div>
</div>
<ul class="sponsor-gold">${view.sponsors(true).map(sponsor => sponsorCard(sponsor))}</ul>
</div>
</section>

<section class="section " id="team-sponsors">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("teamSection.eyebrow")}>${page.text("teamSection.eyebrow")}</span>
<h2${page.edit("teamSection.title")}>${page.rich("teamSection.title", true)}</h2>
</div>
</div>
<ul class="chip-row" style="list-style:none">${view.sponsors(false).map(sponsor => html`<li class="pill"${sponsor.edit("name")}>${sponsor.text("name")}</li>`)}</ul>
</div>
</section>

<section class="section section--sand" id="tiers">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("tiersSection.eyebrow")}>${page.text("tiersSection.eyebrow")}</span>
<h2${page.edit("tiersSection.title")}>${page.rich("tiersSection.title", true)}</h2>
</div>
</div>
<div class="tier-grid">${view.collection("sponsorTiers").filter(tier => tier.boolean("showOnSponsorsPage")).map(tier => tierCard(tier))}</div>
</div>
</section>

<section class="section " id="how">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("how.eyebrow")}>${page.text("how.eyebrow")}</span>
<h2${page.edit("how.title")}>${page.rich("how.title", true)}</h2>
</div>
</div>
<ol class="steps">
${page.list("how.steps").map((item, index) => html`<li>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
</li>`)}
</ol>
<div class="btn-row page-actions">${page.list("how.buttons").map((item, index) => html`<a class="btn ${index < 2 ? 'btn--ghost' : 'btn--gold'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}${index < 2 ? html`` : icon('arrow-right')}</a>`)}</div>
</div>
</section>

<section class="section section--white" id="scholarships">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("scholarship.eyebrow")}>${page.text("scholarship.eyebrow")}</span>
<h2${page.edit("scholarship.title")}>${page.rich("scholarship.title", true)}</h2>
</div>
</div>
<div class="card">
<h3${page.edit("scholarship.card.title")}>${page.text("scholarship.card.title")}</h3>
<p${page.edit("scholarship.card.text")}>${page.text("scholarship.card.text")}</p>
<a class="btn btn--primary" href="${page.url("scholarship.card.button.href")}"${page.external("scholarship.card.button")}>${page.text("scholarship.card.button.label")}${icon('arrow-right')}</a>
</div>
</div>
</section>

`;
}
