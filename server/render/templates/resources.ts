import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { type SnapshotView } from '../snapshot-view.js';
import { documentCard } from './shared.js';

export function resources(view: SnapshotView): Html {
  const page = view.doc("resources", "resources");
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

<section class="section " id="library">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("library.eyebrow")}>${page.text("library.eyebrow")}</span>
<h2${page.edit("library.title")}>${page.rich("library.title", true)}</h2>
<p class="lead"${page.edit("library.lead")}>${page.text("library.lead")}</p>
</div>
</div>
<div class="library-tools">
<label class="search">
<span class="visually-hidden">${page.text("library.searchPlaceholder")}</span>${icon("search", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}<input type="search" data-doc-search placeholder="${page.text("library.searchPlaceholder")}">
</label>
<div class="chip-row" data-doc-filters aria-label="Filter documents">${page.list("library.categories").map((item, index) => html`<button class="chip" type="button" data-filter="${item.text("key")}" aria-pressed="${String(item.text("key") === "all")}"${item.edit("label")}>${item.text("label")}</button>`)}</div>
</div>
<section class="doc-group" data-doc-group="club">
<h3>Club documents<span class="count">${view.documents("club").length}</span>
</h3>
<ul class="doc-list">${view.documents("club").map(document => documentCard(document))}</ul>
</section>

<section class="doc-group" data-doc-group="safety">
<h3>Library<span class="count">${view.documents("safety").length}</span>
</h3>
<ul class="doc-list">${view.documents("safety").map(document => documentCard(document))}</ul>
</section>

<section class="doc-group" data-doc-group="coaching">
<h3>Coaching<span class="count">${view.documents("coaching").length}</span>
</h3>
<ul class="doc-list">${view.documents("coaching").map(document => documentCard(document))}</ul>
</section>

<section class="doc-group" data-doc-group="forms">
<h3>Forms<span class="count">${view.documents("forms").length}</span>
</h3>
<ul class="doc-list">${view.documents("forms").map(document => documentCard(document))}</ul>
<div style="margin-top:16px">
<div class="note">${icon("book", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}<div${page.edit("formsNote")}>${page.rich("formsNote", true)}</div>
</div>
</div>
</section>
<p class="doc-empty" data-doc-empty hidden${page.edit("library.emptyText")}>${page.text("library.emptyText")}</p>
</div>
</section>

`;
}
