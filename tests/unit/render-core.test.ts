import { describe, expect, it } from 'vitest';
import { html, raw } from '../../server/render/html.js';
import { richtext } from '../../server/render/richtext.js';
import { cleanUrl, safeUrl } from '../../server/render/links.js';
import { icon } from '../../server/render/icons.js';
import { iconNames } from '../../shared/schema.js';

describe('escaped HTML and constrained Markdown', () => {
  it('escapes content and attributes; only explicit renderer markup is trusted', () => {
    expect(String(html`<p title="${'" onmouseover="evil'}">${'<script>&'}</p>`)).toBe('<p title="&quot; onmouseover=&quot;evil">&lt;script&gt;&amp;</p>');
    expect(String(html`${[html`<b>${'safe'}</b>`, '<i>unsafe</i>', null, false]}${raw('<hr>')}`)).toBe('<b>safe</b>&lt;i&gt;unsafe&lt;/i&gt;<hr>');
  });
  it('renders paragraphs, emphasis, strong, links, line breaks and bullet lists', () => {
    expect(String(richtext('First **bold** and *italic*.\nNext line.\n\n- One\n- [Two](/resources)'))).toBe('<p>First <strong>bold</strong> and <em>italic</em>.<br>Next line.</p><ul><li>One</li><li><a href="/resources">Two</a></li></ul>');
    expect(String(richtext('**bold *nested***', true))).toBe('<strong>bold <em>nested</em></strong>');
    expect(String(richtext('Title\nSubtitle', true))).toBe('Title<br>Subtitle');
    expect(String(richtext('[Label](https://example.com/a_(b))', true))).toBe('<a href="https://example.com/a_(b)">Label</a>');
  });
  it.each([
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>',
    '[x](javascript:alert(1))', '[x](data:text/html,evil)', '[x](JaVaScRiPt:alert(1))',
    '[x](//evil.example)', '[x](%2f%2fevil.example)', '[x](java%0ascript:evil)',
    '[x](https://user:pass@example.com)', '[x](https://example.com/" onload="evil)',
    '<iframe srcdoc="<script>evil</script>"></iframe>', '&lt;script&gt;evil',
    '[<img onerror=evil>](mailto:safe@example.com)', '![](/x.svg)',
  ])('keeps adversarial rich text inert: %s', input => {
    const output = String(richtext(input));
    expect(output).not.toMatch(/<(?:script|img|svg|iframe)\b/);
    expect(output).not.toMatch(/href="(?:javascript:|data:|\/\/)/i);
    expect(output).not.toMatch(/<a[^>]*\son\w+=/);
  });
  it('retains literal delimiters and supports escaped Markdown punctuation', () => {
    expect(String(richtext('\\*literal\\* and **unfinished', true))).toBe('*literal* and **unfinished');
  });
  it('cleans legacy links and rejects unsafe URLs again at render time', () => {
    expect(cleanUrl('index.html#events')).toBe('/#events');
    expect(cleanUrl('recreational.html#costs')).toBe('/recreational#costs');
    expect(safeUrl('mailto:club@example.com')).toBe('mailto:club@example.com');
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('//example.com')).toBe('#');
  });
  it('has trusted SVG bodies for every selectable icon', () => {
    for (const name of iconNames) expect(String(icon(name))).toMatch(/<(path|circle|rect|line)\b/);
    expect(String(icon('<svg onload=evil>'))).toBe('<svg viewBox="0 0 24 24" aria-hidden="true"></svg>');
  });
});
