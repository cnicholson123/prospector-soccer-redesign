import { useEffect, useRef, useState } from 'preact/hooks';
import { collections, iconNames, type Field } from '../../../../shared/schema.js';
import type { ValidationIssue } from '../../../../shared/types.js';
import { richtext } from '../../../../server/render/richtext.js';
import { api, message } from '../../api.js';
import { defaults, docTitle, duplicateItem, freshKey, moveItem, record, type ContentDoc } from '../../state/content.js';
import { MediaField } from '../MediaPicker.js';
import { DragList } from '../DragList.js';
export const fieldLabel = (name: string, field: Field) => field.label ?? ({ showOnHome: 'Show on home page', calendarTitle: 'Calendar title', locationDetail: 'Location details', endTime: 'End time', notes: 'Notes', link: 'Link', meta: 'Page details', cta: 'Call to action', headerCta: 'Header call to action', seo: 'Search engines', srSummary: 'Screen reader summary', resultIds: 'Results', documentIds: 'Documents', boardMemberId: 'Board member', startsAt: 'Starts at', endsAt: 'Ends at' }[name] ?? name.replace(/([A-Z])/g, ' $1').replace(/^./, x => x.toUpperCase()));
function RichText({ id, label, value, change, disabled, describedBy, invalid, inline }: { id: string; label: string; value: string; change: (value: string) => void; disabled: boolean; describedBy?: string; invalid: boolean; inline?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function format(before: string, after = before) {
    const input = ref.current!, start = input.selectionStart, end = input.selectionEnd;
    change(value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, end + before.length); });
  }
  return <div class="richtext-control"><div class="format-toolbar" role="group" aria-label={`${label} formatting`}>
    <button type="button" disabled={disabled} onClick={() => format('**')} aria-label="Bold"><strong>B</strong></button><button type="button" disabled={disabled} onClick={() => format('*')} aria-label="Italic"><em>I</em></button>
    <button type="button" disabled={disabled} onClick={() => format('[', '](https://example.com)')}>Link</button>{!inline && <button type="button" disabled={disabled} onClick={() => format('\n\n- ', '')}>List</button>}
  </div><textarea ref={ref} id={id} rows={inline ? 2 : 5} value={value} disabled={disabled} maxLength={20000} aria-describedby={describedBy} aria-invalid={invalid} onInput={event => change(event.currentTarget.value)} />
    <details class="richtext-preview"><summary>Preview {label.toLowerCase()}</summary><div dangerouslySetInnerHTML={{ __html: richtext(value, inline).toString() }} /></details></div>;
}
function Reference({ field, id, value, change, disabled }: { field: Extract<Field, { type: 'reference' }>; id: string; value: unknown; change: (value: unknown) => void; disabled: boolean }) {
  const [docs, setDocs] = useState<ContentDoc[]>([]), [query, setQuery] = useState(''), [error, setError] = useState('');
  useEffect(() => { api<{ docs: ContentDoc[] }>(`/docs/${field.to}`).then(result => setDocs(result.docs)).catch(e => setError(message(e))); }, [field.to]);
  const selected: string[] = field.many ? Array.isArray(value) ? value as string[] : [] : typeof value === 'string' && value ? [value] : [];
  const matches = docs.filter(doc => docTitle(doc).toLowerCase().includes(query.toLowerCase()));
  const title = (key: string) => { const doc = docs.find(d => d.id === key); return doc ? docTitle(doc) : `Unavailable item (${key})`; };
  return <div class="reference-picker"><input id={id} type="search" placeholder={`Search ${collections[field.to].labelPlural.toLowerCase()}…`} value={query} disabled={disabled} onInput={e => setQuery(e.currentTarget.value)} />
    {error && <p role="alert" class="error-box">{error}</p>}
    <div class="reference-options" role="group" aria-label="Available references">{matches.map(doc => <label key={doc.id}><input type="checkbox" checked={selected.includes(doc.id)} disabled={disabled} onChange={e => change(field.many ? e.currentTarget.checked ? [...selected, doc.id] : selected.filter(x => x !== doc.id) : e.currentTarget.checked ? doc.id : undefined)} /><span>{docTitle(doc)}</span><span class={`badge status-${doc.status}`}>{doc.status}</span></label>)}{!matches.length && <p class="muted">No matching items.</p>}</div>
    {field.many && selected.length > 0 && <DragList ids={selected} label={i => title(selected[i])} disabled={disabled} move={(from, to) => change(moveItem(selected, from, to))}>{i => <div class="selected-reference"><span>{title(selected[i])}</span><button type="button" class="text-button" disabled={disabled} onClick={() => change(selected.filter(x => x !== selected[i]))}>Remove</button></div>}</DragList>}
    {!field.many && selected.some(key => !docs.some(doc => doc.id === key)) && <p class="error-box">{title(selected[0])} <button type="button" disabled={disabled} onClick={() => change(undefined)}>Clear reference</button></p>}
  </div>;
}
export function localDateTime(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return value;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '';
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
  return parts.replace(' ', 'T');
}
export function pacificDateTime(value: string): string | undefined {
  if (!value) return undefined;
  let date = new Date(`${value}:00Z`);
  for (let i = 0; i < 3; i++) date = new Date(date.getTime() + (Date.parse(`${value}:00Z`) - Date.parse(`${localDateTime(date.toISOString())}:00Z`)));
  // Preserve an impossible spring-forward wall time as invalid input rather
  // than silently shifting the editor's schedule by an hour.
  return localDateTime(date.toISOString()) === value ? date.toISOString() : value;
}
interface Props { fields: Record<string, Field>; value: Record<string, unknown>; change: (name: string, value: unknown) => void; errors?: ValidationIssue[]; disabled?: boolean; blur?: () => void; prefix?: string; sections?: boolean; }
export function Form({ fields, value, change, errors = [], disabled = false, blur, prefix = '', sections = false }: Props) {
  const renderField = ([name, field]: [string, Field]) => {
    const path = prefix ? `${prefix}.${name}` : name, label = fieldLabel(name, field), id = `field-${path}`, data = value[name];
    const error = field.type === 'datetime' && typeof data === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(data) ? 'This Pacific time does not exist. Choose a different time.' : errors.find(issue => issue.path === path)?.message;
    const help = field.help ?? (field.type === 'datetime' ? 'Pacific time. Leave blank for no limit.' : field.type === 'text' && field.pattern === 'slug' ? 'Use lowercase letters, numbers and single hyphens. Maximum 60 characters.' : name === 'date' ? 'Dates and times are Pacific time.' : field.type === 'richtext' ? 'Supports bold, italic and links.' : undefined);
    const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;
    const common = { id, disabled, 'aria-invalid': !!error, 'aria-describedby': describedBy, required: !!field.required };
    const update = (v: unknown) => change(name, v);
    const nested = (defs: Record<string, Field>) => <Form fields={defs} value={record(data)} change={(key, v) => update(path === 'source' && key === 'mode' ? { mode: v } : { ...record(data), [key]: v })} errors={errors} disabled={disabled} prefix={path} />;
    let control;
    if (field.type === 'object') control = nested(field.fields);
    else if (field.type === 'list') {
      const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
      const title = (i: number) => String(rows[i][field.itemLabel] || `Item ${i + 1}`);
      control = <div class="list-editor"><p class="muted">{rows.length} items · Drag a handle or use Alt + ↑ / ↓ to reorder.</p><DragList ids={rows.map(row => String(row._key))} label={title} disabled={disabled} move={(from, to) => update(moveItem(rows, from, to))}>{i => <details class="list-item"><summary>{title(i)}</summary><Form fields={field.of} value={rows[i]} change={(key, v) => update(rows.map((row, index) => index === i ? { ...row, [key]: v } : row))} errors={errors} disabled={disabled} prefix={`${path}[${i}]`} /><div class="list-actions"><button type="button" class="text-button" disabled={disabled || field.maxItems !== undefined && rows.length >= field.maxItems} onClick={() => update([...rows.slice(0, i + 1), duplicateItem(rows[i]), ...rows.slice(i + 1)])}>Duplicate item</button><button type="button" class="text-button danger-text" disabled={disabled || rows.length <= (field.minItems ?? 0)} onClick={() => update(rows.filter((_, index) => index !== i))}>Remove item</button></div></details>}</DragList><button type="button" class="button secondary" disabled={disabled || field.maxItems !== undefined && rows.length >= field.maxItems} onClick={() => update([...rows, { _key: freshKey(), ...defaults(field.of) }])}>Add item</button></div>;
    } else if (field.type === 'reference') control = <Reference field={field} id={id} value={data} change={update} disabled={disabled} />;
    else if (field.type === 'image' || field.type === 'file') control = <MediaField id={id} type={field.type} value={data} change={update} disabled={disabled} />;
    else if (field.type === 'link') control = nested({ label: { type: 'text', label: 'Link label' }, href: { type: 'url', label: 'Link URL', allowRelative: true, allowMailto: true }, external: { type: 'boolean', label: 'Open in a new tab' } });
    else if (field.type === 'money') control = nested({ amount: { type: 'number', min: 0, decimals: field.exact ? 2 : undefined, label: 'Amount ($)' }, ...(!field.exact ? { max: { type: 'number' as const, min: 0, label: 'Maximum ($, optional)' } } : {}) });
    else if (field.type === 'boolean') control = <input {...common} type="checkbox" checked={data === true} onChange={e => update(e.currentTarget.checked)} />;
    else if (field.type === 'select' || field.type === 'icon') control = <select {...common} value={String(data ?? '')} onChange={e => update(e.currentTarget.value || undefined)}><option value="">Choose {label.toLowerCase()}</option>{(field.type === 'select' ? field.options : iconNames.map(icon => ({ value: icon, label: icon.replaceAll('-', ' ') }))).map(option => <option value={option.value}>{option.label}</option>)}</select>;
    else if (field.type === 'richtext') control = <RichText id={id} label={label} inline={field.inline} disabled={disabled} value={String(data ?? '')} change={update} describedBy={describedBy} invalid={!!error} />;
    else if (field.type === 'datetime') control = <input {...common} type="datetime-local" value={localDateTime(data)} onInput={e => update(pacificDateTime(e.currentTarget.value))} />;
    else if (field.type === 'number' || field.type === 'percent' || field.type === 'month') control = <input {...common} type="number" min={field.type === 'number' ? field.min : field.type === 'month' ? 1 : 0} max={field.type === 'number' ? field.max : field.type === 'month' ? 12 : 100} step={field.type === 'number' && field.decimals !== undefined ? 10 ** -field.decimals : field.type === 'number' && !field.integer || field.type === 'percent' ? 'any' : 1} value={data === undefined ? '' : Number(data)} onInput={e => update(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))} />;
    else if (field.type === 'text' && field.multiline) control = <textarea {...common} value={String(data ?? '')} maxLength={field.maxLength ?? 5000} onInput={e => update(e.currentTarget.value)} />;
    else control = <input {...common} pattern={field.type === 'text' && field.pattern === 'slug' ? '[a-z0-9]+(-[a-z0-9]+)*' : undefined} type={['date', 'time', 'email'].includes(field.type) ? field.type : 'text'} inputMode={field.type === 'url' ? 'url' : undefined} value={String(data ?? '')} maxLength={field.type === 'text' ? field.maxLength ?? 500 : 2000} onInput={e => update(e.currentTarget.value)} />;
    const complex = ['object', 'list', 'link', 'money', 'image', 'file'].includes(field.type);
    const clearable = !field.required && ['money', 'link', 'image', 'file'].includes(field.type) && data !== undefined;
    const content = <>{field.type === 'boolean' ? <label for={id}>{control}<span>{label}</span></label> : complex ? <fieldset><legend>{label}{field.required ? ' *' : ''}</legend>{control}{clearable && <button type="button" class="text-button" disabled={disabled} onClick={() => update(undefined)}>Clear {label.toLowerCase()}</button>}</fieldset> : <><label for={id}>{label}{field.required && <span aria-hidden="true"> *</span>}</label>{control}</>}{help && <small id={`${id}-help`}>{help}</small>}{error && <small class="field-error" id={`${id}-error`}>{error}</small>}</>;
    const full = complex || ['richtext', 'reference'].includes(field.type) || field.width === 'full' || name === 'title';
    return sections && complex ? <details key={path} class="section-accordion field-full" open={errors.some(issue => issue.path.startsWith(path)) || undefined} id={`section-${name}`}><summary>{label}{errors.some(issue => issue.path.startsWith(path)) && <span class="badge">Needs attention</span>}</summary><div class="section-body">{control}{error && <p class="field-error">{error}</p>}</div></details> : <div key={path} data-field-path={path} class={`field ${full ? 'field-full' : ''} ${field.type === 'boolean' ? 'field-check' : ''}`}>{content}</div>;
  };
  return <div class="form-grid" onFocusOut={blur}>{Object.entries(fields).filter(([name]) => !(prefix === 'source' && (name === 'fileId' && value.mode !== 'upload' || name === 'url' && value.mode === 'upload'))).map(renderField)}</div>;
}
