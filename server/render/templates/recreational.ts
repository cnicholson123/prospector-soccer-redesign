import { html, type Html } from '../html';
import { icon } from '../icons';
import { type SnapshotView } from '../snapshot-view';
import { documentCard } from './shared';

export function recreational(view: SnapshotView): Html {
  const page = view.doc("recreational", "recreational");
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
<div class="section">
<div class="container with-aside">
<div class="with-aside__main">
<section id="overview">
<div class="block-head">
<div>
<span class="eyebrow"${page.edit("overview.eyebrow")}>${page.text("overview.eyebrow")}</span>
<h2${page.edit("overview.title")}>${page.rich("overview.title", true)}</h2>
<p class="lead"${page.edit("overview.lead")}>${page.text("overview.lead")}</p>
</div>
</div>${page.rich("overview.body", false)}</section>

<section id="season">
<div class="block-head">
<div>
<span class="eyebrow"${page.edit("season.eyebrow")}>${page.text("season.eyebrow")}</span>
<h2${page.edit("season.title")}>${page.rich("season.title", true)}</h2>
</div>
</div>
<div class="info-grid">
${page.list("season.cards").map((item, index) => html`<article class="info">
<span class="info__icon">${icon(item.text("icon"))}</span>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
</article>`)}
</div>
</section>

<section id="costs">
<div class="block-head">
<div>
<span class="eyebrow"${page.edit("fees.eyebrow")}>${page.text("fees.eyebrow")}</span>
<h2${page.edit("fees.title")}>${page.rich("fees.title", true)}</h2>
<p class="lead"${page.edit("fees.lead")}>${page.text("fees.lead")}</p>
</div>
</div>
<div class="price-grid">
${page.list("fees.windows").map((item, index) => html`<article class="${"price-card" + (item.boolean("featured") ? " price-card--featured" : "")}" data-reveal>
<span class="price-card__ages"${item.edit("ages")}>${item.text("ages")}</span>
<p class="price-card__grade"${item.edit("grades")}>${item.text("grades")}</p>
<p class="price-card__amount">${html`<sup>$</sup>${item.amount("price")}`}</p>
<p class="price-card__window"${item.edit("window")}>${item.text("window")}</p>
<p class="price-card__late">${item.text("lateLabel")} <strong>${item.money("latePrice")}</strong>
</p>
</article>`)}
</div>
<p class="small muted"${page.edit("fees.note")}>${page.text("fees.note")}</p>
</section>

<section id="register">
<div class="block-head">
<div>
<span class="eyebrow"${page.edit("register.eyebrow")}>${page.text("register.eyebrow")}</span>
<h2${page.edit("register.title")}>${page.rich("register.title", true)}</h2>
</div>
</div>
<div class="note">${icon("book", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}<div${page.edit("register.note")}>${page.rich("register.note", true)}</div>
</div>
<div class="btn-row page-actions">${page.list("register.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--primary' : 'btn btn--ghost'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}${index === 0 ? icon('arrow-right') : html``}</a>`)}</div>
</section>
</div>
<aside class="glance" aria-labelledby="glance-title">
<h2 class="glance__title" id="glance-title"${page.edit("glance.title")}>${page.text("glance.title")}</h2>
<dl>${page.list("glance.facts").map((fact, index) => html`<div>
<dt${fact.edit("label")}>${fact.text("label")}</dt>
<dd>${fact.text("value")}</dd>
</div>`)}</dl>${page.list("glance.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--gold btn--block' : 'btn btn--ghost btn--block'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}</a>`)}<p class="glance__note"${page.edit("glance.note")}>${page.text("glance.note")}</p>
</aside>
</div>
</div>
<section class="section section--sand" id="equipment">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("equipment.eyebrow")}>${page.text("equipment.eyebrow")}</span>
<h2${page.edit("equipment.title")}>${page.rich("equipment.title", true)}</h2>
</div>
</div>
<div class="split">
<figure class="media-frame cut-br">
<img src="${page.image("equipment.image")}" alt="${page.text("equipment.image.alt")}" width="1400" height="1050" loading="lazy"${page.imageStyle("equipment.image")}${page.edit("equipment.image")}>
</figure>
<div>
<ul class="equip-grid">
${page.list("equipment.items").map((item, index) => html`<li class="equip">
<span class="equip__icon">${icon(item.text("icon"))}</span>
<strong${item.edit("title")}>${item.text("title")}</strong>
<span${item.edit("text")}>${item.text("text")}</span>
</li>`)}

</ul>
<div class="ball-sizes">${page.list("equipment.ballSizes").map((item, index) => html`<div class="ball-size">
<b>${item.number("size")}</b>
<span>${"Size " + item.number("size")}<small${item.edit("ages")}>${item.text("ages")}</small>
</span>
</div>`)}</div>
</div>
</div>
</div>
</section>

<section class="section " id="coaching">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("coaching.eyebrow")}>${page.text("coaching.eyebrow")}</span>
<h2${page.edit("coaching.title")}>${page.rich("coaching.title", true)}</h2>
<p class="lead"${page.edit("coaching.lead")}>${page.text("coaching.lead")}</p>
</div>
</div>
<ul class="doc-list">${view.references(page, "coaching.documentIds", "documents").map(document => documentCard(document))}</ul>
</div>
</section>

<section class="section section--white" id="policies">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("policies.eyebrow")}>${page.text("policies.eyebrow")}</span>
<h2${page.edit("policies.title")}>${page.rich("policies.title", true)}</h2>
<p class="lead"${page.edit("policies.lead")}>${page.text("policies.lead")}</p>
</div>
</div>
<ul class="doc-list">${view.references(page, "policies.documentIds", "documents").map(document => documentCard(document))}</ul>
</div>
</section>

<div class="action-bar" data-action-bar>${page.list("actionBar.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--gold' : 'btn btn--ghost-light'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}</a>`)}</div>
`;
}
