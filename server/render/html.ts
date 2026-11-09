/** Only renderer-owned markup may cross this boundary. Content is always escaped. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string { return this.value; }
}
export function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
export function raw(markup: string): Html { return new Html(markup); }
function interpolate(value: unknown): string {
  if (value instanceof Html) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  return value === undefined || value === null || value === false ? '' : escape(value);
}
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  return raw(strings.reduce((output, part, index) => output + part + (index < values.length ? interpolate(values[index]) : ''), ''));
}
