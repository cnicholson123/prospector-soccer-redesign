import { html, type Html } from '../html';
export function notfound(): Html {
  return html`<section class="section"><div class="container"><span class="eyebrow">Page not found</span><h1>We couldn’t find that page</h1><p class="lead">Head back to the club to find your next step.</p><a class="btn btn--primary" href="/">Back to home</a></div></section>`;
}
