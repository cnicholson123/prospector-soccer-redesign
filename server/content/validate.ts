import { collections, iconNames, type CollectionName, type Field } from '../../shared/schema';
import type { ValidationIssue, ValidationResult } from '../../shared/types';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const email = (value: unknown): boolean => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
export function isSafeUrl(value: unknown, options: { allowRelative?: boolean; allowMailto?: boolean } = {}): boolean {
  if (typeof value !== 'string' || !value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  // Decode for obfuscated protocols and network-path URLs, even though the
  // unmodified URL is what a renderer will use.
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return false; }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//')) return false;
  if (options.allowRelative && (/^\/(?!\/)/.test(decoded) || decoded.startsWith('#'))) return true;
  if (options.allowMailto && value.startsWith('mailto:')) return email(value.slice(7));
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password; }
  catch { return false; }
}
function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validDatetime(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return validDate(value.slice(0, 10)) && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d/.test(value.slice(11)) && /(Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);

export function validateFields(fields: Record<string, Field>, data: unknown, prefix = ''): ValidationResult {
  const errors: ValidationIssue[] = [];
  const error = (path: string, message: string) => errors.push({ path, message });
  function checkObject(defs: Record<string, Field>, value: unknown, path: string, listItem = false) {
    if (!record(value)) { error(path, 'Must be an object'); return; }
    for (const key of Object.keys(value)) if (!Object.hasOwn(defs, key) && !(listItem && key === '_key')) error(path ? `${path}.${key}` : key, 'Unknown field');
    for (const [key, field] of Object.entries(defs)) check(field, value[key], path ? `${path}.${key}` : key);
  }
  function check(field: Field, value: unknown, path: string): void {
    if (value === undefined || (value === '' && ['text', 'richtext', 'url', 'email', 'date', 'time', 'datetime', 'select', 'icon', 'reference'].includes(field.type))) {
      if (field.required) error(path, 'Required'); return;
    }
    switch (field.type) {
      case 'text': case 'richtext': {
        if (typeof value !== 'string') { error(path, 'Must be text'); break; }
        if (field.required && !value.trim()) error(path, 'Required');
        if (field.type === 'text' && field.maxLength !== undefined && value.length > field.maxLength) error(path, `Must be at most ${field.maxLength} characters`);
        if (field.type === 'richtext') {
          // Grammar rendering belongs to Phase 2; reject unsafe Markdown links now.
          for (const match of value.matchAll(/\]\(\s*([^\s)]*)/g)) if (!isSafeUrl(match[1], { allowRelative: true, allowMailto: true })) error(path, 'Link URL is not allowed');
        }
        break;
      }
      case 'url': if (!isSafeUrl(value, field)) error(path, 'Must be an allowed HTTP(S), mailto, or site-relative URL'); break;
      case 'email': if (!email(value)) error(path, 'Must be a valid email address'); break;
      case 'date': if (!validDate(value)) error(path, 'Must be a real date in YYYY-MM-DD format'); break;
      case 'time': if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) error(path, 'Must be a time in HH:MM format'); break;
      case 'datetime': if (!validDatetime(value)) error(path, 'Must be an ISO datetime with timezone'); break;
      case 'number': case 'percent': case 'month': {
        const min = field.type === 'percent' ? 0 : field.type === 'month' ? 1 : field.type === 'number' ? field.min : undefined;
        const max = field.type === 'percent' ? 100 : field.type === 'month' ? 12 : field.type === 'number' ? field.max : undefined;
        const integer = field.type === 'month' || (field.type === 'number' && field.integer);
        if (!finite(value) || (integer && !Number.isSafeInteger(value)) || (min !== undefined && value < min) || (max !== undefined && value > max)) error(path, 'Number is outside the allowed range or precision');
        break;
      }
      case 'money':
        if (!record(value) || !finite(value.amount) || value.amount < 0 || (value.max !== undefined && (!finite(value.max) || value.max < value.amount)) || Object.keys(value).some(key => !['amount', 'max'].includes(key))) error(path, 'Must have a nonnegative amount and an optional max at least that amount');
        break;
      case 'boolean': if (typeof value !== 'boolean') error(path, 'Must be true or false'); break;
      case 'select': if (!field.options.some(option => option.value === value)) error(path, 'Must be one of the listed options'); break;
      case 'icon': if (!(iconNames as readonly unknown[]).includes(value)) error(path, 'Must be a registered icon'); break;
      case 'image': case 'file':
        if (!record(value) || !id(value.mediaId) || (field.type === 'image' && typeof value.alt !== 'string') || Object.keys(value).some(key => !(field.type === 'image' ? ['mediaId', 'alt'] : ['mediaId']).includes(key))) error(path, field.type === 'image' ? 'Must have mediaId and alt text' : 'Must have mediaId');
        break;
      case 'reference':
        if (field.many ? !Array.isArray(value) || !value.every(id) || new Set(value).size !== value.length || (field.required && !value.length) : !id(value)) error(path, field.many ? 'Must be a list of unique document IDs' : 'Must be a document ID');
        break;
      case 'link':
        checkObject({ label: { type: 'text', required: true }, href: { type: 'url', allowRelative: true, allowMailto: true, required: true }, external: { type: 'boolean' } }, value, path);
        break;
      case 'object': checkObject(field.fields, value, path); break;
      case 'list': {
        if (!Array.isArray(value)) { error(path, 'Must be a list'); break; }
        if ((field.minItems !== undefined && value.length < field.minItems) || (field.maxItems !== undefined && value.length > field.maxItems)) error(path, 'List length is outside the allowed range');
        const keys = new Set<string>();
        value.forEach((item: unknown, index) => {
          const itemPath = `${path}[${index}]`;
          if (!record(item) || typeof item._key !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(item._key)) error(`${itemPath}._key`, 'Must be a stable eight-character key');
          else if (keys.has(item._key)) error(`${itemPath}._key`, 'Duplicate list key');
          else keys.add(item._key);
          checkObject(field.of, item, itemPath, true);
        });
        break;
      }
    }
  }
  checkObject(fields, data, prefix);
  return { valid: errors.length === 0, errors };
}
export function validate(collection: CollectionName, data: unknown): ValidationResult {
  const schema = Object.hasOwn(collections, collection) ? collections[collection] : undefined;
  if (!schema) return { valid: false, errors: [{ path: '', message: 'Unknown collection' }] };
  const result = validateFields(schema.fields, data);
  const add = (path: string, message: string) => { result.errors.push({ path, message }); result.valid = false; };
  if (record(data)) {
    if (collection === 'documents' && record(data.source)) {
      if (data.source.mode === 'url' && !nonempty(data.source.url)) add('source.url', 'Required for URL documents');
      if (data.source.mode === 'upload' && (!record(data.source.fileId) || !id(data.source.fileId.mediaId))) add('source.fileId', 'Required for uploaded documents');
    }
    if (collection === 'site' && Array.isArray(data.nav)) data.nav.forEach((item: unknown, i) => {
      if (record(item) && !nonempty(item.page) && !nonempty(item.href)) add(`nav[${i}].href`, 'Choose a page or enter a URL');
    });
    if (collection === 'callouts' && typeof data.startsAt === 'string' && typeof data.endsAt === 'string' && Date.parse(data.startsAt) >= Date.parse(data.endsAt)) add('endsAt', 'Must be after startsAt');
    if (collection === 'events' && typeof data.time === 'string' && typeof data.endTime === 'string' && data.endTime <= data.time) add('endTime', 'Must be after time');
  }
  return result;
}
