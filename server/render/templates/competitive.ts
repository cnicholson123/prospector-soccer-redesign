import { html, type Html } from '../html';
import { icon } from '../icons';
import { type SnapshotView } from '../snapshot-view';
import { resultCard, documentCard, teamCard } from './shared';

export function competitive(view: SnapshotView): Html {
  const page = view.doc("competitive", "competitive");
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
<nav class="subnav" aria-label="On this page">
<div class="container">
<ul>
${page.list("subnav").map((item, index) => html`<li>
<a href="${item.url("anchor")}"${item.edit("label")}>${item.text("label")}</a>
</li>`)}

</ul>
</div>
</nav>
<section class="section " id="overview">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("overview.eyebrow")}>${page.text("overview.eyebrow")}</span>
<h2${page.edit("overview.title")}>${page.rich("overview.title", true)}</h2>
</div>
</div>
<div class="info-grid">
${page.list("overview.cards").map((item, index) => html`<article class="info">
<span class="info__icon">${icon(item.text("icon"))}</span>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
</article>`)}

</div>
<div class="cols-2" style="margin-top:24px">${page.list("overview.columns").map((column, index) => html`<div class="card">
<h3${column.edit("title")}>${column.text("title")}</h3>
<ul class="checklist">
${column.list("bullets").map((bullet, index) => html`<li${bullet.edit("text")}>${bullet.text("text")}</li>`)}

</ul>
</div>`)}</div>
</div>
</section>

<section class="section section--white" id="results">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("resultsSection.eyebrow")}>${page.text("resultsSection.eyebrow")}</span>
<h2${page.edit("resultsSection.title")}>${page.rich("resultsSection.title", true)}</h2>
</div>
</div>
<ul class="results">${view.references(page, "resultsSection.resultIds", "results").map(result => resultCard(result))}</ul>
</div>
</section>

<section class="section " id="teams">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("teamsSection.seasonLabel")}>${page.text("teamsSection.seasonLabel")}</span>
<h2${page.edit("teamsSection.title")}>${page.rich("teamsSection.title", true)}</h2>
<p class="lead"${page.edit("teamsSection.lead")}>${page.text("teamsSection.lead")}</p>
</div>
</div>
<div class="chip-row" data-team-filters aria-label="Filter teams">
<button class="chip" type="button" data-filter="all" aria-pressed="true">All</button>
<button class="chip" type="button" data-filter="girls" aria-pressed="false">Girls</button>
<button class="chip" type="button" data-filter="boys" aria-pressed="false">Boys</button>
</div>
<ul class="team-grid">${view.collection("teams").map(team => teamCard(team))}</ul>
</div>
</section>

<section class="section section--sand" id="costs">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("costs.eyebrow")}>${page.text("costs.eyebrow")}</span>
<h2${page.edit("costs.title")}>${page.rich("costs.title", true)}</h2>
</div>
</div>
<div class="cost-stack">
<div class="cost-stack__total">
<strong${page.edit("costs.total.label")}>${page.text("costs.total.label")}</strong>
<span${page.edit("costs.total.note")}>${page.text("costs.total.note")}</span>
</div>
<div class="cost-stack__bar" aria-hidden="true">${page.list("costs.items").map(item => html`<span class="${item.color("color")}" style="--w:${item.average("price")}">
</span>`)}</div>
<ul class="cost-stack__legend">
${page.list("costs.items").map((item, index) => html`<li>
<i class="${item.color("color")}">
</i>
<b>${item.money("price") + " · " + item.text("label")}</b>
<small${item.edit("note")}>${item.text("note")}</small>
</li>`)}

</ul>
</div>
<p class="small muted"${page.edit("costs.estimateNote")}>${page.text("costs.estimateNote")}</p>
<ul class="doc-list">${view.references(page, "costs.documentIds", "documents").map(document => documentCard(document))}</ul>
</div>
</section>

<section class="section " id="coaches-wanted">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("coaches.eyebrow")}>${page.text("coaches.eyebrow")}</span>
<h2${page.edit("coaches.title")}>${page.rich("coaches.title", true)}</h2>
</div>
</div>
<div class="split">
<figure class="media-frame cut-br">
<img src="${page.image("coaches.image")}" alt="${page.text("coaches.image.alt")}" width="1400" height="934" loading="lazy"${page.imageStyle("coaches.image")}${page.edit("coaches.image")}>
</figure>
<div>
<h3${page.edit("coaches.benefitsTitle")}>${page.text("coaches.benefitsTitle")}</h3>
<ul class="checklist">
${page.list("coaches.benefits").map((item, index) => html`<li${item.edit("text")}>${item.text("text")}</li>`)}

</ul>
<h3 style="margin-top:24px"${page.edit("coaches.newTitle")}>${page.text("coaches.newTitle")}</h3>
<ul class="checklist">
${page.list("coaches.newItems").map((item, index) => html`<li${item.edit("text")}>${item.text("text")}</li>`)}

</ul>
</div>
</div>
<div class="card" style="margin-top:32px">
<h3${page.edit("coaches.applyCard.title")}>${page.text("coaches.applyCard.title")}</h3>${page.rich("coaches.applyCard.body", false)}<div class="btn-row page-actions">${page.list("coaches.applyCard.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--primary' : 'btn btn--ghost'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}${index === 0 ? icon('arrow-right') : html``}</a>`)}</div>
</div>
</div>
</section>

<section class="section section--white" id="faq">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("faqSection.eyebrow")}>${page.text("faqSection.eyebrow")}</span>
<h2${page.edit("faqSection.title")}>${page.rich("faqSection.title", true)}</h2>
</div>
</div>
<div class="faq">${view.collection("faqs").filter(faq => faq.text("page") === "competitive").map(faq => html`<details>
<summary${faq.edit("question")}>${faq.text("question")}</summary>
<div class="faq__a"${faq.edit("answer")}>${faq.rich("answer")}</div>
</details>`)}</div>
</div>
</section>

<div class="action-bar" data-action-bar>${page.list("actionBar.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--gold' : 'btn btn--ghost-light'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}</a>`)}</div>
`;
}
