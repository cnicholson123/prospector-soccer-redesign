/** Canonical URL/character-reference spelling, with every element and attribute retained. */
export function normalizeHtml(source: string): string {
  return source.replace(/href="(?:\/?)(index|home)\.html(?=["#?])/g, 'href="/')
    .replace(/href="\/?(recreational|competitive|referees|sponsors|board|resources|about)\.html(?=["#?])/g, 'href="/$1')
    .replace(/((?:src|href|content)="|url\()['"]?\/?assets\//g, '$1/assets/')
    .replace(/\?v=[^"'\s>]*/g, '')
    .replace(/<a\b[^>]*class="utility-bar__admin"[^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/&amp;/g, '&').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/>\s+</g, '><').trim();
}
