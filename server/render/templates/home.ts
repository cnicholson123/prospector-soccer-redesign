import { html, type Html } from '../html';
import { icon } from '../icons';
import { type SnapshotView } from '../snapshot-view';
import { delay, eventCard, calloutCard, resultCard, sponsorCard } from './shared';

export function home(view: SnapshotView): Html {
  const page = view.doc("home", "home");
  return html`<section class="hero" aria-labelledby="hero-title">
  <div class="hero__media">
<img src="${page.image("hero.image")}" alt="${page.text("hero.image.alt")}" width="1920" height="1080" fetchpriority="high"${page.imageStyle("hero.image")}${page.edit("hero.image")}>
</div>
  <div class="rays rays--spin" aria-hidden="true">
</div>
  <div class="container">
    <div class="hero__content">
      <span class="eyebrow eyebrow--light"${page.edit("hero.eyebrow")}>${page.text("hero.eyebrow")}</span>
      <h1 class="hero__title" id="hero-title"${page.edit("hero.title")}>${page.rich("hero.title", true)}</h1>
      <p class="hero__lead"${page.edit("hero.lead")}>${page.text("hero.lead")}</p>
      <div class="btn-row">
        <a class="btn btn--gold" href="${page.url("hero.primaryCta.href")}"${page.external("hero.primaryCta")}>${page.text("hero.primaryCta.label")} ${icon('arrow-right')}</a>
        <a class="btn btn--ghost-light" href="${page.url("hero.secondaryCta.href")}"${page.external("hero.secondaryCta")}>${page.text("hero.secondaryCta.label")}</a>
      </div>
      <div class="hero__places">
        ${page.list("hero.pills").map((item, index) => html`<span class="pill pill--dark"${item.edit("text")}>${item.text("text")}</span>`)}

      </div>
    </div>
  </div>
</section>

<div class="container season-wrap">
  <section class="season" data-season aria-labelledby="season-title" data-reveal>
    <div class="season__head">
      <h2 id="season-title"${page.edit("season.title")}>${page.text("season.title")}</h2>
      <p>Right now: <span class="season__now" data-season-label>Fall season is underway</span>
</p>
    </div>
    <div class="season__scroller" tabindex="0" role="region" aria-label="Club year timeline">
      <div class="season__track">
        <div class="season__marks" aria-hidden="true">
          ${page.list("season.marks").map((item, index) => html`<span class="season__mark" style="${"left: " + item.number("position") + "%"}"${item.edit("label")}>${item.text("label")}</span>`)}

        </div>
        <div class="season__bar" aria-hidden="true">
          ${page.list("season.bands").map((item, index) => html`<span class="${"season__band season__band--" + item.text("kind")}" style="${"left: " + item.number("from") + "%; right: " + (100 - item.number("to")) + (item.number("to") === 100 ? "" : "%")}">
</span>`)}

        </div>
        <div class="season__today" data-season-today style="left: 85.5%">
<span>Today</span>
<i>
</i>
</div>
        <div class="season__months" aria-hidden="true">
          <span>Jan</span>
<span>Feb</span>
<span>Mar</span>
<span>Apr</span>
<span>May</span>
<span>Jun</span>
<span>Jul</span>
<span>Aug</span>
<span>Sep</span>
<span>Oct</span>
<span>Nov</span>
<span>Dec</span>
        </div>
      </div>
    </div>
    <p class="season__hint" aria-hidden="true">Swipe to see the whole year →</p>
    <div class="season__legend">
      ${page.list("season.legend").map((item, index) => html`<span>
<i style="${"background: " + item.swatch("swatch")}">
</i>${item.text("label")}</span>`)}

    </div>
    <p class="visually-hidden"${page.edit("season.srSummary")}>${page.text("season.srSummary")}</p>
  </section>
</div>

<section class="section section--tight" aria-labelledby="now-title">
  <div class="container">
    <h2 class="visually-hidden" id="now-title"${page.edit("calloutsSection.title")}>${page.rich("calloutsSection.title", true)}</h2>
    <div class="callout-grid">${view.callouts().map((callout, index) => calloutCard(callout, index))}</div>
  </div>
</section>

<section class="section section--white" id="events" aria-labelledby="events-title">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow"${page.edit("eventsSection.eyebrow")}>${page.text("eventsSection.eyebrow")}</span>
        <h2 id="events-title"${page.edit("eventsSection.title")}>${page.rich("eventsSection.title", true)}</h2>
        <p class="lead"${page.edit("eventsSection.lead")}>${page.text("eventsSection.lead")}</p>
      </div>
      <a class="link-arrow" href="${page.url("eventsSection.newsLink.href")}"${page.external("eventsSection.newsLink")}>${page.text("eventsSection.newsLink.label")} ${icon('arrow-right')}</a>
    </div>
    <ul class="tickets" data-tickets>${view.events().map(event => eventCard(event))}</ul>
    <p class="doc-empty" data-tickets-empty hidden>No upcoming events right now — follow us on social for the next one.</p>
    <details class="tickets-past" data-tickets-past hidden>
      <summary>
<span>Recently passed (<span data-past-count>0</span>)</span>
</summary>
      <ul class="tickets">
</ul>
    </details>
  </div>
</section>

<section class="section" id="programs" aria-labelledby="programs-title">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow"${page.edit("programsSection.eyebrow")}>${page.text("programsSection.eyebrow")}</span>
        <h2 id="programs-title"${page.edit("programsSection.title")}>${page.rich("programsSection.title", true)}</h2>
        <p class="lead"${page.edit("programsSection.lead")}>${page.text("programsSection.lead")}</p>
      </div>
    </div>
    <div class="programs">
      ${page.list("programs").map((program, index) => html`<article class="program" data-reveal>
        <div class="program__media">
          <img src="${program.image("image")}" alt="${program.text("image.alt")}" width="1400" height="933" loading="lazy"${program.imageStyle("image")}${program.edit("image")}>
          <span class="pill pill--gold program__badge"${program.edit("badge")}>${program.text("badge")}</span>
        </div>
        <div class="program__body">
          <span class="eyebrow"${program.edit("kicker")}>${program.text("kicker")}</span>
          <h3${program.edit("title")}>${program.rich("title", true)}</h3>
          <p${program.edit("text")}>${program.text("text")}</p>
          <dl class="facts">
            ${program.list("facts").map((fact, index) => html`<div>
<dt${fact.edit("label")}>${fact.text("label")}</dt>
<dd>${fact.text("value")}<small${fact.edit("note")}>${fact.text("note")}</small>
</dd>
</div>`)}

          </dl>
          <div class="btn-row">
            <a class="btn btn--primary" href="${program.url("cta.href")}"${program.external("cta")}>${program.text("cta.label")} ${icon('arrow-right')}</a>
            <a class="link-arrow" href="${program.url("secondaryLink.href")}"${program.external("secondaryLink")}>${program.text("secondaryLink.label")}</a>
          </div>
        </div>
      </article>`)}

    </div>
  </div>
</section>

<section class="band" aria-labelledby="band-title">
  <div class="band__media">
<img src="${page.image("band.image")}" alt="${page.text("band.image.alt")}" width="1400" height="788" loading="lazy"${page.imageStyle("band.image")}${page.edit("band.image")}>
</div>
  <div class="container">
    <span class="eyebrow eyebrow--light"${page.edit("band.eyebrow")}>${page.text("band.eyebrow")}</span>
    <h2 id="band-title"${page.edit("band.title")}>${page.rich("band.title", true)}</h2>
    <p class="lead"${page.edit("band.lead")}>${page.text("band.lead")}</p>
    <div class="stats">
      ${page.list("band.stats").map((item, index) => html`<div class="stat" data-reveal${delay(index, 80)}>
<span class="stat__num"${item.edit("value")}>${item.text("value")}</span>
<span class="stat__label"${item.edit("label")}>${item.text("label")}</span>
</div>`)}

    </div>
  </div>
</section>

<section class="section section--white" aria-labelledby="results-title">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow"${page.edit("resultsSection.eyebrow")}>${page.text("resultsSection.eyebrow")}</span>
        <h2 id="results-title"${page.edit("resultsSection.title")}>${page.rich("resultsSection.title", true)}</h2>
        <p class="lead"${page.edit("resultsSection.lead")}>${page.text("resultsSection.lead")}</p>
      </div>
      <a class="link-arrow" href="${page.url("resultsSection.link.href")}"${page.external("resultsSection.link")}>${page.text("resultsSection.link.label")} ${icon('arrow-right')}</a>
    </div>
    <ul class="results">${view.references(page, "resultsSection.resultIds", "results").map((result, index) => resultCard(result, index, true))}</ul>
  </div>
</section>

<section class="section" aria-labelledby="explore-title">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow"${page.edit("explore.eyebrow")}>${page.text("explore.eyebrow")}</span>
        <h2 id="explore-title"${page.edit("explore.title")}>${page.rich("explore.title", true)}</h2>
      </div>
    </div>
    <div class="tile-grid">
      ${page.list("explore.tiles").map((item, index) => html`<a class="tile" href="${item.url("href")}" data-reveal${delay(index, 60)}>
        <img src="${item.image("image")}" alt="${item.text("image.alt")}" width="${index === 0 ? 1122 : 1400}" height="${index === 0 ? 1402 : 933}" loading="lazy"${item.imageStyle("image")}${item.edit("image")}>
        <span class="tile__go" aria-hidden="true">${icon("arrow-right", " viewBox=\"0 0 24 24\"")}</span>
        <span class="tile__kicker"${item.edit("kicker")}>${item.text("kicker")}</span>
<h3${item.edit("title")}>${item.text("title")}</h3>
<p${item.edit("text")}>${item.text("text")}</p>
      </a>`)}

    </div>
  </div>
</section>

<section class="section section--white" aria-labelledby="sponsors-title">
  <div class="container">
    <div class="section-head">
      <div>
        <span class="eyebrow"${page.edit("sponsorsSection.eyebrow")}>${page.text("sponsorsSection.eyebrow")}</span>
        <h2 id="sponsors-title"${page.edit("sponsorsSection.title")}>${page.rich("sponsorsSection.title", true)}</h2>
        <p class="lead"${page.edit("sponsorsSection.lead")}>${page.text("sponsorsSection.lead")}</p>
      </div>
      <a class="link-arrow" href="${page.url("sponsorsSection.link.href")}"${page.external("sponsorsSection.link")}>${page.text("sponsorsSection.link.label")} ${icon('arrow-right')}</a>
    </div>
    <ul class="sponsor-gold">${view.sponsors(true).map(sponsor => sponsorCard(sponsor, true))}</ul>
    <div class="marquee" style="margin-top: 22px" aria-label="Team sponsors">
      <ul class="marquee__track">${html`${view.sponsors(false).map(sponsor => html`<li>${sponsor.text("name")}</li>`)}${view.sponsors(false).map(sponsor => html`<li aria-hidden="true">${sponsor.text("name")}</li>`)}`}</ul>
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
      <div class="btn-row">
        ${page.list("cta.buttons").map((item, index) => html`<a class="${index === 0 ? 'btn btn--gold' : 'btn btn--ghost-light'}" href="${item.url("href")}"${item.external("")}>${item.text("label")}${index === 0 ? html` ${icon('arrow-right')}` : html``}</a>`)}

      </div>
    </div>
  </div>
</section>
`;
}
