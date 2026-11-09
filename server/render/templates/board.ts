import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { type SnapshotView } from '../snapshot-view.js';
import { boardCard } from './shared.js';

export function board(view: SnapshotView): Html {
  const page = view.doc("board", "board");
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

<section class="section " id="members">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("members.eyebrow")}>${page.text("members.eyebrow")}</span>
<h2${page.edit("members.title")}>${page.rich("members.title", true)}</h2>
</div>
</div>
<ul class="board-grid">${view.collection("boardMembers").map(member => boardCard(member))}</ul>
</div>
</section>

<section class="section section--white" id="meetings">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("meetings.eyebrow")}>${page.text("meetings.eyebrow")}</span>
<h2${page.edit("meetings.title")}>${page.rich("meetings.title", true)}</h2>
</div>
</div>
<div class="note">${icon("book", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}<div${page.edit("meetings.note")}>${page.rich("meetings.note", true)}</div>
</div>
<div class="card" style="margin-top:24px">
<h3${page.edit("meetings.agmCard.title")}>${page.text("meetings.agmCard.title")}</h3>
<p${page.edit("meetings.agmCard.text")}>${page.text("meetings.agmCard.text")}</p>
</div>
</div>
</section>

`;
}
