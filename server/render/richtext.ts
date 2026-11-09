import { escape, raw, type Html } from './html.js';
import { safeUrl } from './links.js';
import { isSafeUrl } from '../content/validate.js';

/** A small bounded parser, with no raw-HTML or image syntax. */
function inline(source: string, depth = 0): string {
  if (depth > 16) return escape(source);
  let output = '';
  let position = 0;
  while (position < source.length) {
    const rest = source.slice(position);
    if (rest[0] === '\\' && rest.length > 1 && /[\\*_[\]()]/.test(rest[1])) {
      output += escape(rest[1]); position += 2; continue;
    }
    const delimiter = rest.startsWith('**') ? '**' : rest.startsWith('*') ? '*' : '';
    if (delimiter) {
      let end = source.indexOf(delimiter, position + delimiter.length);
      if (delimiter === '**' && end >= 0 && source.startsWith('***', end)) {
        const inside = source.slice(position + 2, end);
        const singleStars = (inside.match(/(?<!\*)\*(?!\*)/g) ?? []).length;
        if (singleStars % 2 === 1) end++;
      }
      if (end > position + delimiter.length) {
        const tag = delimiter === '**' ? 'strong' : 'em';
        output += `<${tag}>${inline(source.slice(position + delimiter.length, end), depth + 1)}</${tag}>`;
        position = end + delimiter.length; continue;
      }
    }
    if (rest[0] === '[') {
      const labelEnd = source.indexOf('](', position + 1);
      if (labelEnd !== -1) {
        let cursor = labelEnd + 2;
        let balance = 1;
        for (; cursor < source.length && balance; cursor++) {
          if (source[cursor] === '(') balance++;
          if (source[cursor] === ')') balance--;
        }
        if (!balance) {
          const target = source.slice(labelEnd + 2, cursor - 1);
          const label = inline(source.slice(position + 1, labelEnd), depth + 1);
          output += isSafeUrl(safeUrl(target), { allowRelative: true, allowMailto: true }) && safeUrl(target) !== '#'
            ? `<a href="${escape(safeUrl(target))}">${label}</a>` : label;
          position = cursor; continue;
        }
      }
    }
    if (rest[0] === '\n') { output += '<br>'; position++; continue; }
    output += escape(rest[0]); position++;
  }
  return output;
}
export function richtext(source: string, inlineOnly = false): Html {
  const normalized = source.replace(/\r\n?/g, '\n');
  if (inlineOnly) return raw(inline(normalized));
  const blocks = normalized.trim().split(/\n[ \t]*\n/).filter(Boolean);
  return raw(blocks.map(block => {
    const lines = block.split('\n');
    if (lines.every(line => /^[-*] /.test(line))) return `<ul>${lines.map(line => `<li>${inline(line.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${inline(block)}</p>`;
  }).join(''));
}
