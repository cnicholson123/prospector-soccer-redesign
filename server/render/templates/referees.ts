import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { type SnapshotView } from '../snapshot-view.js';
import { documentCard, refereeContact } from './shared.js';

export function referees(view: SnapshotView): Html {
  const page = view.doc("referees", "referees");
  return html`<section class="page-hero" aria-labelledby="hero-title">
<div class="page-hero__media">
<img src="${page.image("hero.image")}" alt="${page.text("hero.image.alt")}" width="1400" height="1750" fetchpriority="high"${page.imageStyle("hero.image")}${page.edit("hero.image")}>
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

<section class="section " id="program">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("program.eyebrow")}>${page.text("program.eyebrow")}</span>
<h2${page.edit("program.title")}>${page.rich("program.title", true)}</h2>
</div>
</div>
<div class="prose"${page.edit("program.body")}>${page.rich("program.body", false)}</div>
</div>
</section>

<section class="section section--white" id="why">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("why.eyebrow")}>${page.text("why.eyebrow")}</span>
<h2${page.edit("why.title")}>${page.rich("why.title", true)}</h2>
</div>
</div>
<div class="info-grid">
${page.list("why.cards").map((item, index) => html`<article class="info">
<span class="info__icon">${icon(item.text("icon"))}</span>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
</article>`)}

</div>
</div>
</section>

<section class="section " id="contact">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("contact.eyebrow")}>${page.text("contact.eyebrow")}</span>
<h2${page.edit("contact.title")}>${page.rich("contact.title", true)}</h2>
</div>
</div>
<div class="contact-card">${refereeContact(view.reference(page, "contact.boardMemberId", "boardMembers"), page)}</div>
<div style="margin-top:24px">
<ul class="doc-list">${view.references(page, "contact.documentIds", "documents").map(document => documentCard(document))}</ul>
</div>
</div>
</section>

<section class="section section--tight">
<div class="container">
<div class="cta-band" data-reveal>
<div class="rays" aria-hidden="true">
</div>
<div>
<span class="eyebrow eyebrow--light"${page.edit("cta.eyebrow")}>${page.text("cta.eyebrow")}</span>
<h2${page.edit("cta.title")}>${page.rich("cta.title", true)}</h2>
<p${page.edit("cta.text")}>${page.text("cta.text")}</p>
</div>
<div class="btn-row page-actions">${page.list("cta.buttons").map((item, index) => html`<a class="btn btn--gold" href="${item.url("href")}"${item.external("")}>${item.text("label")}${icon('arrow-right')}</a>`)}</div>
</div>
</div>
</section>

`;
}
