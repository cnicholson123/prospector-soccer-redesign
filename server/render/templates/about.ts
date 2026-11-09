import { html, type Html } from '../html.js';
import { icon } from '../icons.js';
import { type SnapshotView } from '../snapshot-view.js';

export function about(view: SnapshotView): Html {
  const page = view.doc("about", "about");
  return html`<section class="page-hero" aria-labelledby="hero-title">
<div class="page-hero__media">
<img src="${page.image("hero.image")}" alt="${page.text("hero.image.alt")}" width="1400" height="788" fetchpriority="high"${page.imageStyle("hero.image")}${page.edit("hero.image")}>
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

<section class="section " id="purpose">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("purpose.eyebrow")}>${page.text("purpose.eyebrow")}</span>
<h2${page.edit("purpose.title")}>${page.rich("purpose.title", true)}</h2>
</div>
</div>
<p class="lead"${page.edit("purpose.lead")}>${page.text("purpose.lead")}</p>
<blockquote class="statement"${page.edit("purpose.statement")}>${page.rich("purpose.statement", false)}</blockquote>
</div>
</section>

<section class="section section--white" id="vision">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("vision.eyebrow")}>${page.text("vision.eyebrow")}</span>
<h2${page.edit("vision.title")}>${page.rich("vision.title", true)}</h2>
</div>
</div>
<div class="split">
<figure class="media-frame cut-br">
<img src="${page.image("vision.image")}" alt="${page.text("vision.image.alt")}" width="2172" height="724" loading="lazy"${page.imageStyle("vision.image")}${page.edit("vision.image")}>
</figure>
<div>
<h3${page.edit("vision.heading")}>${page.text("vision.heading")}</h3>
<p class="lead"${page.edit("vision.lead")}>${page.text("vision.lead")}</p>
<p${page.edit("vision.body")}>${page.text("vision.body")}</p>
</div>
</div>
</div>
</section>

<section class="section " id="mission">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow"${page.edit("mission.eyebrow")}>${page.text("mission.eyebrow")}</span>
<h2${page.edit("mission.title")}>${page.rich("mission.title", true)}</h2>
</div>
</div>
<div class="split split--reverse">
<figure class="media-frame cut-bl">
<img src="${page.image("mission.image")}" alt="${page.text("mission.image.alt")}" width="1400" height="788" loading="lazy"${page.imageStyle("mission.image")}${page.edit("mission.image")}>
</figure>
<div>
<h3${page.edit("mission.heading")}>${page.text("mission.heading")}</h3>
<ul class="checklist">
${page.list("mission.bullets").map((item, index) => html`<li${item.edit("text")}>${item.text("text")}</li>`)}

</ul>
</div>
</div>
</div>
</section>

<section class="section section--navy" id="values">
<div class="container">
<div class="section-head">
<div>
<span class="eyebrow eyebrow--light"${page.edit("values.eyebrow")}>${page.text("values.eyebrow")}</span>
<h2${page.edit("values.title")}>${page.rich("values.title", true)}</h2>
</div>
</div>
<ol class="values">
${page.list("values.items").map((item, index) => html`<li>
<span class="values__n">${String(index + 1).padStart(2, "0")}</span>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
</li>`)}

</ol>
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
<div class="btn-row page-actions">${page.list("cta.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--gold' : 'btn btn--ghost-light'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}${index === 0 ? icon('arrow-right') : html``}</a>`)}</div>
</div>
</div>
</section>

`;
}
