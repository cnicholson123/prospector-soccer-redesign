import { isSafeUrl } from '../content/validate.js';
export function cleanUrl(value: string): string {
  return value.replace(/^(?:\/?)(index|home)\.html(?=[?#]|$)/, '/').replace(/^\/?(recreational|competitive|referees|sponsors|board|resources|about)\.html(?=[?#]|$)/, '/$1');
}
export function safeUrl(value: string): string {
  const clean = cleanUrl(value);
  return isSafeUrl(clean, { allowRelative: true, allowMailto: true }) ? clean : '#';
}
export function displayDomain(value: string): string {
  try { return new URL(safeUrl(value)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
