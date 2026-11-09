import { html, type Html } from '../html';
import { icon } from '../icons';
import { type SnapshotView, type DocumentView } from '../snapshot-view';
import type { PageName } from '../../../shared/schema';

function navigation(site: DocumentView, pageName: string): Html[] {
  return site.list('nav').filter(item => item.boolean('visible', true)).map(item => html`<li><a href="${item.text('href') ? item.url('href') : item.text('page') === 'home' ? '/' : '/' + item.text('page')}"${item.text('page') === pageName ? html` aria-current="page"` : html``}>${item.text('label')}</a></li>`);
}
function announcement(site: DocumentView): Html {
  if (!site.boolean('banner.enabled')) return html``;
  return html`<div class="note"><div class="container">${site.text('banner.text')}${site.text('banner.link.href') ? html` <a href="${site.url('banner.link.href')}"${site.external('banner.link')}>${site.text('banner.link.label')}</a>` : html``}</div></div>`;
}
export function layout(view: SnapshotView, pageName: PageName, content: Html, meta?: { title: string; description: string }): Html {
  const site = view.doc('site', 'site');
  const page = view.doc(pageName === 'sponsors' ? 'sponsorsPage' : pageName, pageName === 'sponsors' ? 'sponsorsPage' : pageName);
  return html`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${meta?.title ?? page.text("meta.title")}</title>
  <meta name="description" content="${meta?.description ?? page.text("meta.description")}">
  <meta name="robots" content="${site.boolean("seo.indexable") ? "index, follow" : "noindex"}">
  <meta name="theme-color" content="#0B2A5B">
  <meta property="og:title" content="${meta?.title ?? page.text("meta.title")}">
  <meta property="og:description" content="${meta?.description ?? page.text("meta.description")}">
  <meta property="og:image" content="${page.text("meta.ogImage.mediaId") ? page.image("meta.ogImage") : site.image("seo.defaultOgImage")}">
  <meta property="og:type" content="website">
  <link rel="icon" href="/assets/img/favicon.png" type="image/png">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,500;0,600;0,700;0,800;1,600&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/css/styles.css">
  <script src="/assets/js/main.js" defer></script>
</head>
<body class="${"page-" + (pageName === "home" ? "index" : pageName)}">
  <a class="skip-link" href="#main">Skip to content</a>

  ${site.boolean("utilityBar.enabled") ? html`<div class="utility-bar">
    <div class="container utility-bar__inner">
      <p class="utility-bar__note"><span class="pill pill--gold"${site.edit("utilityBar.pillText")}>${site.text("utilityBar.pillText")}</span> <span class="hide-sm"${site.edit("utilityBar.messageLong")}>${site.text("utilityBar.messageLong")} </span>${site.text("utilityBar.message")}</p>
      <ul class="utility-bar__links" aria-label="Social media">
        <li><a href="${site.url("socials.facebook")}" target="_blank" rel="noopener" aria-label="Facebook">${icon("facebook", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}</a></li>
        <li><a href="${site.url("socials.instagram")}" target="_blank" rel="noopener" aria-label="Instagram">${icon("instagram", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}</a></li>
        <li><a href="${site.url("socials.tiktok")}" target="_blank" rel="noopener" aria-label="TikTok">${icon("tiktok", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}</a></li>
      </ul>
    </div>
  </div>` : html``}

  ${announcement(site)}
  <header class="site-header" data-header>
    <div class="container site-header__inner">
      <a class="brand" href="/" aria-label="Prospector Soccer Club home">
        <img class="brand__crest" src="/assets/img/crest-sm.png" alt="" width="44" height="54">
        <span class="brand__text"><span class="brand__name">${site.text("name").replace(/ Soccer Club$/, "")}</span><span class="brand__sub">${site.text("tagline")}</span></span>
      </a>
      <nav class="primary-nav" aria-label="Main">
        <ul>
${navigation(site, pageName)}
        </ul>
      </nav>
      <a class="btn btn--gold btn--sm site-header__cta" href="${site.url("headerCta.href")}"${site.external("headerCta")}>${site.text("headerCta.label")}</a>
      <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" data-menu-toggle>
        <span class="menu-toggle__label">Menu</span>
        <span class="menu-toggle__icon" aria-hidden="true"><span></span><span></span></span>
      </button>
    </div>
  </header>

  <div class="mobile-menu" id="mobile-menu" data-mobile-menu hidden>
    <div class="mobile-menu__scrim" data-menu-close></div>
    <div class="mobile-menu__panel" role="dialog" aria-modal="true" aria-label="Site menu">
      <div class="mobile-menu__head">
        <span class="eyebrow">Menu</span>
        <button class="icon-btn" type="button" data-menu-close aria-label="Close menu">${icon("close", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}</button>
      </div>
      <nav aria-label="Mobile">
        <ul class="mobile-menu__list">
          <li><a href="/">Home</a></li>
${navigation(site, pageName)}
        </ul>
      </nav>
      <div class="mobile-menu__foot">
        <a class="btn btn--gold btn--block" href="${site.url("headerCta.href")}">${site.text("headerCta.label")}</a>
        <a class="btn btn--ghost-light btn--block" href="${site.email("contact.email")}">Email the club</a>
      </div>
    </div>
  </div>

  <main id="main">
${content}
  </main>

  <footer class="site-footer">
    ${icon("contours", " class=\"site-footer__contours\" viewBox=\"0 0 1440 320\" preserveAspectRatio=\"none\" aria-hidden=\"true\"")}
    <div class="container site-footer__grid">
      <div class="site-footer__brand">
        <a class="brand brand--light" href="/">
          <img class="brand__crest" src="/assets/img/crest-sm.png" alt="" width="52" height="64">
          <span class="brand__text"><span class="brand__name">${site.text("name").replace(/ Soccer Club$/, "")}</span><span class="brand__sub">${site.text("tagline")}</span></span>
        </a>
        <p${site.edit("footer.blurb")}>${site.text("footer.blurb")}</p>
        <a class="site-footer__mail" href="${site.email("contact.email")}">${site.text("contact.email")}</a>
      </div>
      ${site.list("footer.columns").map((column, index) => html`<div>
        <h2 class="site-footer__h"${column.edit("heading")}>${column.text("heading")}</h2>
        <ul>
          ${column.list("links").map((link, index) => html`<li><a href="${link.url("href")}"${link.external("")}>${link.text("label")}</a></li>`)}

        </ul>
      </div>`)}

    </div>
    <div class="container site-footer__base">
      <p>${site.text("copyright") + " ·"} <a href="${site.url("links.privacyPolicy")}" target="_blank" rel="noopener">Privacy policy</a></p>
      <p>Redesign concept · imagery generated with GPT Image, illustrative only</p>
      <a class="to-top" href="#main">Back to top ${icon("arrow-up", " viewBox=\"0 0 24 24\" aria-hidden=\"true\"")}</a>
    </div>
  </footer>
</body>
</html>
`;
}
