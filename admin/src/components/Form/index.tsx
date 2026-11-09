import { useRef } from 'preact/hooks';
import type { Field } from '../../../../shared/schema';
import type { ValidationIssue } from '../../../../shared/types';
import { richtext } from '../../../../server/render/richtext';
export const fieldLabel = (name: string, field: Field) => field.label ?? ({ showOnHome: 'Show on home page', calendarTitle: 'Calendar title', locationDetail: 'Location details', endTime: 'End time', notes: 'Notes', link: 'Event link' }[name] ?? name.replace(/([A-Z])/g, ' $1').replace(/^./, x => x.toUpperCase()));
function RichText({ id, value, change, disabled, describedBy, invalid }: { id: string; value: string; change: (value: string) => void; disabled: boolean; describedBy?: string; invalid: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function format(before: string, after = before) {
    const input = ref.current!;
    const start = input.selectionStart, end = input.selectionEnd;
    change(value.slice(0, start) + before + value.slice(start, end) + after + value.slice(end));
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + before.length, end + before.length); });
  }
  return <div class="richtext-control"><div class="format-toolbar" role="group" aria-label="Notes formatting">
    <button type="button" disabled={disabled} onClick={() => format('**')} aria-label="Bold"><strong>B</strong></button>
    <button type="button" disabled={disabled} onClick={() => format('*')} aria-label="Italic"><em>I</em></button>
    <button type="button" disabled={disabled} onClick={() => format('[', '](https://)')}>Link</button>
    <button type="button" disabled={disabled} onClick={() => format('\n- ', '')}>List</button>
  </div><textarea ref={ref} id={id} rows={5} value={value} disabled={disabled} maxLength={20000} aria-describedby={describedBy} aria-invalid={invalid} onInput={event => change(event.currentTarget.value)} />
    <details class="richtext-preview"><summary>Preview notes</summary><div dangerouslySetInnerHTML={{ __html: richtext(value).toString() }} /></details>
  </div>;
}
export function Form({ fields, value, change, errors = [], disabled = false, blur }: { fields: Record<string, Field>; value: Record<string, unknown>; change: (name: string, value: unknown) => void; errors?: ValidationIssue[]; disabled?: boolean; blur?: () => void }) {
  return <div class="form-grid" onFocusOut={blur}>{Object.entries(fields).map(([name, field]) => {
    const label = fieldLabel(name, field), id = `field-${name}`, error = errors.find(issue => issue.path === name)?.message;
    const help = field.help ?? (name === 'date' ? 'Dates and times are Pacific time.' : name === 'calendarTitle' ? 'Optional title for calendar downloads.' : name === 'showOnHome' ? 'Include this event in the public home page calendar.' : name === 'notes' ? 'Supports bold, italic, links and bullet lists.' : undefined);
    const describedBy = [error && `${id}-error`, help && `${id}-help`].filter(Boolean).join(' ') || undefined;
    const common = { id, disabled, 'aria-invalid': !!error, 'aria-describedby': describedBy, required: !!field.required };
    const control = field.type === 'boolean' ? <input {...common} type="checkbox" checked={value[name] === true} onChange={e => change(name, e.currentTarget.checked)} />
      : field.type === 'select' ? <select {...common} value={String(value[name] ?? '')} onChange={e => change(name, e.currentTarget.value || undefined)}><option value="">Choose a type</option>{field.options.map(option => <option value={option.value}>{option.label}</option>)}</select>
      : field.type === 'richtext' ? <RichText id={id} disabled={disabled} value={String(value[name] ?? '')} change={v => change(name, v)} describedBy={describedBy} invalid={!!error} />
      : field.type === 'text' && field.multiline ? <textarea {...common} value={String(value[name] ?? '')} maxLength={field.maxLength ?? 5000} onInput={e => change(name, e.currentTarget.value)} />
      : <input {...common} type={['date', 'time', 'email'].includes(field.type) ? field.type : 'text'} inputMode={field.type === 'url' ? 'url' : undefined} value={String(value[name] ?? '')} maxLength={field.type === 'text' ? field.maxLength ?? 500 : 2000} onInput={e => change(name, e.currentTarget.value)} />;
    return <div key={name} class={`field ${['title', 'notes', 'showOnHome'].includes(name) || field.width === 'full' ? 'field-full' : ''} ${field.type === 'boolean' ? 'field-check' : ''}`}>
      {field.type === 'boolean' ? <label for={id}>{control}<span>{label}</span></label> : <><label for={id}>{label}{field.required && <span aria-hidden="true"> *</span>}</label>{control}</>}
      {help && <small id={`${id}-help`}>{help}</small>}{error && <small class="field-error" id={`${id}-error`}>{error}</small>}
    </div>;
  })}</div>;
}
