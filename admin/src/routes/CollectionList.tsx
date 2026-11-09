import { useEffect, useState } from 'preact/hooks';
import { collections, type CollectionName } from '../../../shared/schema';
import { api, allowed } from '../api';
import { changed, docTitle, editorPath, getPath, moveItem, record, type ContentDoc } from '../state/content';
import { notify } from '../state/toasts';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/ConfirmDialog';
import { DragList } from '../components/DragList';
import { Preview } from '../components/Preview';
import { Failure, actionFailure, trashDoc, type ActionFailure } from '../components/ContentActions';
export function CollectionList({ collection = 'events', refresh, publish }: { collection?: CollectionName; refresh: number; publish: (ids?: string[]) => void }) {
  const definition = collections[collection];
  const [mediaDocs, setMediaDocs] = useState<ContentDoc[]>([]), [docs, setDocs] = useState<ContentDoc[]>([]), [query, setQuery] = useState(''), [status, setStatus] = useState(''), [filter, setFilter] = useState(''), [sort, setSort] = useState(definition.orderable ? 'order' : 'date'), [trash, setTrash] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [selected, setSelected] = useState<string[]>([]), [confirm, setConfirm] = useState<ContentDoc[] | null>(null), [preview, setPreview] = useState<ContentDoc | null>(null);
  async function load() { try { setDocs((await api<{ docs: ContentDoc[] }>(`/docs/${collection}?trashed=1`)).docs); } catch (e) { setFailure(actionFailure(e)); } finally { setLoading(false); } }
  useEffect(() => { if (collection === 'sponsors') void api<{ docs: ContentDoc[] }>('/docs/media').then(r => setMediaDocs(r.docs)).catch(e => setFailure(actionFailure(e))); }, [collection]);
  useEffect(() => { void load(); }, [collection, refresh]);
  const active = docs.filter(d => !d.trashedAt), trashed = docs.filter(d => d.trashedAt), base = trash ? trashed : active;
  const filterEntry = Object.entries(definition.fields).find(([key, field]) => field.type === 'select' && ['type', 'category', 'page', 'level', 'program'].includes(key));
  const filterField = filterEntry?.[1];
  const visible = base.filter(doc => JSON.stringify(doc.draft).toLowerCase().includes(query.toLowerCase()) && (!status || doc.status === status) && (!filter || doc.draft[filterEntry![0]] === filter)).sort((a, b) => sort === 'order' ? (a.order ?? 0) - (b.order ?? 0) : sort === 'updatedAt' ? b.updatedAt.localeCompare(a.updatedAt) : sort === 'title' ? docTitle(a).localeCompare(docTitle(b)) : String(getPath(a.draft, sort) ?? '').localeCompare(String(getPath(b.draft, sort) ?? '')));
  const checked = visible.filter(doc => selected.includes(doc.id));
  const reorderEnabled = !!definition.orderable && allowed('content.manage') && !trash && !query && !status && !filter && sort === 'order';
  async function reorder(from: number, to: number) {
    if (busy) return;
    const previous = visible, ordered = moveItem(visible, from, to); setBusy(true); setFailure(null);
    try {
      const result = await api<{ docs: ContentDoc[] }>(`/docs/${collection}/reorder`, 'POST', { items: ordered.map(d => ({ id: d.id, baseVersion: d.version })) });
      setDocs([...result.docs, ...trashed]); changed();
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-drag-id="${CSS.escape(previous[from].id)}"] .drag-handle`)?.focus());
      notify('Order saved to draft', undefined, async () => { try { await api(`/docs/${collection}/reorder`, 'POST', { items: previous.map(d => ({ id: d.id, baseVersion: result.docs.find(n => n.id === d.id)!.version })) }); changed(); await load(); } catch (e) { setFailure(actionFailure(e)); } });
    } catch (e) { setFailure(actionFailure(e)); await load(); } finally { setBusy(false); }
  }
  async function duplicate(doc: ContentDoc) { setBusy(true); setFailure(null); try { await api(`/docs/${collection}/${doc.id}/duplicate`, 'POST'); changed(); await load(); notify('Duplicate created as a draft'); } catch (e) { setFailure(actionFailure(e)); } finally { setBusy(false); } }
  async function moveToTrash(items: ContentDoc[], restore = false) {
    setBusy(true); setFailure(null); const completed: ContentDoc[] = [];
    try { for (const doc of items) completed.push(await trashDoc(doc, restore)); }
    catch (e) { const error = actionFailure(e); setFailure({ ...error, message: `${completed.length ? `${completed.length} completed. ` : ''}${error.message}` }); }
    finally { setConfirm(null); setSelected([]); setBusy(false); changed(); await load(); }
    if (completed.length) notify(`${completed.length} ${restore ? 'restored' : 'moved to trash'}`, undefined, async () => { try { for (const doc of completed) await trashDoc(doc, !restore); changed(); await load(); } catch (e) { setFailure(actionFailure(e)); } });
  }
  function row(doc: ContentDoc) {
    const logo = record(doc.draft.logo), media = record(logo.mediaId && mediaDocs.find(d => d.id === logo.mediaId)?.draft);
    return <article class="content-row"><input type="checkbox" aria-label={`Select ${docTitle(doc)}`} checked={selected.includes(doc.id)} disabled={busy} onChange={e => setSelected(e.currentTarget.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id))} />
      {collection === 'events' && <div class="date-tile"><span>{String(doc.draft.date ?? '').slice(5, 7)}</span><strong>{String(doc.draft.date ?? '').slice(8, 10)}</strong></div>}
      {collection === 'sponsors' && <div class="sponsor-monogram" aria-hidden="true">{String(record(media.variants).web || '') ? <img src={String(record(media.variants).web)} alt="" /> : docTitle(doc).slice(0, 1)}</div>}
      <a class="content-title" href={editorPath(collection, doc.id)}><h2>{docTitle(doc)}</h2><small>{[doc.draft.name !== docTitle(doc) ? doc.draft.name : '', doc.draft.date, doc.draft.type, doc.draft.category, doc.draft.ageGroup, doc.draft.gender, doc.draft.competition].filter(Boolean).join(' · ') || definition.label}</small></a><span class={`badge status-${doc.status}`}>{doc.status}</span>
      <details class="row-menu"><summary aria-label={`Actions for ${docTitle(doc)}`}>Actions</summary><div><button class="text-button" onClick={() => setPreview(doc)}>Preview</button><a href={`${editorPath(collection, doc.id)}?panel=history`}>History</a>{allowed('content.create') && !trash && <button class="text-button" disabled={busy} onClick={() => void duplicate(doc)}>Duplicate</button>}{allowed('content.publish') && <button class="text-button" onClick={() => publish([doc.id])}>{trash ? 'Publish removal' : 'Publish'}</button>}{allowed('content.manage') && <button class="text-button" disabled={busy} onClick={() => trash ? void moveToTrash([doc], true) : setConfirm([doc])}>{trash ? 'Restore' : 'Move to trash'}</button>}</div></details>
    </article>;
  }
  return <><header class="page-heading"><div><span class="eyebrow">Club content</span><h1>{definition.labelPlural}</h1><p>{collection === 'callouts' ? 'Announcements with an optional start and end window.' : collection === 'teams' ? 'Keep your teams and coaching lineups current.' : collection === 'documents' ? 'Manage library links. File uploads arrive in Phase 10.' : `Manage the ${definition.labelPlural.toLowerCase()} your community sees.`}</p></div>{allowed('content.create') && <a class="button" href={editorPath(collection, 'new')}><Icon name="plus" /> New {definition.label.toLowerCase()}</a>}</header>
    <Failure failure={failure} /><section class="card collection-card" aria-busy={busy} aria-label={`${definition.labelPlural} collection`}><nav class="collection-tabs" aria-label="Collection views"><button aria-pressed={!trash} onClick={() => { setTrash(false); setSelected([]); setStatus(''); }}>All {definition.labelPlural.toLowerCase()} <span>{active.length}</span></button><button aria-pressed={trash} onClick={() => { setTrash(true); setSelected([]); setStatus(''); }}>Trash <span>{trashed.length}</span></button></nav>
    <div class="collection-filters"><div class="search-field"><label for="collection-search">Search {definition.labelPlural.toLowerCase()}</label><input id="collection-search" type="search" placeholder="Search content…" value={query} onInput={e => setQuery(e.currentTarget.value)} /></div><div><label for="collection-status">Status</label><select id="collection-status" value={status} onChange={e => setStatus(e.currentTarget.value)}><option value="">All statuses</option>{['draft', 'changed', 'published', 'review', 'scheduled', ...(trash ? ['trashed'] : [])].map(s => <option value={s}>{s}</option>)}</select></div>
    {filterEntry && filterField?.type === 'select' && <div><label for="collection-filter">{filterEntry[0].replace(/^./, c => c.toUpperCase())}</label><select id="collection-filter" value={filter} onChange={e => setFilter(e.currentTarget.value)}><option value="">All</option>{filterField.options.map(o => <option value={o.value}>{o.label}</option>)}</select></div>}
    <div><label for="collection-sort">Sort by</label><select id="collection-sort" value={sort} onChange={e => setSort(e.currentTarget.value)}>{definition.orderable && <option value="order">Display order</option>}{collection === 'events' && <option value="date">Date</option>}<option value="title">Title</option><option value="updatedAt">Recently edited</option></select></div></div>
    <div class="bulk-toolbar"><label><input type="checkbox" aria-label="Select all visible items" checked={!!visible.length && checked.length === visible.length} onChange={e => setSelected(e.currentTarget.checked ? visible.map(d => d.id) : [])} />{checked.length ? `${checked.length} selected` : `${visible.length} items`}</label>{checked.length > 0 && <>{allowed('content.publish') && <button class="text-button" onClick={() => publish(checked.map(d => d.id))}>{trash ? 'Publish removals' : 'Publish selected'}</button>}{allowed('content.manage') && <button class="text-button" disabled={busy} onClick={() => trash ? void moveToTrash(checked, true) : setConfirm(checked)}>{trash ? 'Restore selected' : 'Trash selected'}</button>}</>}</div>
    {definition.orderable && !trash && <p class="reorder-hint">{reorderEnabled ? 'Drag a handle or use Alt + ↑ / ↓. Publish to update the live order.' : 'Choose Display order and clear filters to reorder.'}</p>}
    {loading ? <p class="empty-state" role="status">Loading…</p> : !visible.length ? <div class="empty-state"><Icon name="calendar" size={36} /><h2>{trash ? 'Trash is empty' : base.length ? 'No matching items' : 'Ready for your first entry'}</h2><p>{base.length ? 'Try another search or clear the filters.' : trash ? 'Items moved to trash stay here until restored.' : 'Create a draft, preview it, then publish when ready.'}</p>{!trash && allowed('content.create') && <a class="button" href={editorPath(collection, 'new')}>New {definition.label.toLowerCase()}</a>}</div> : <DragList ids={visible.map(d => d.id)} label={i => docTitle(visible[i])} disabled={!reorderEnabled} move={(from, to) => void reorder(from, to)}>{i => row(visible[i])}</DragList>}
    </section>
    {confirm && <Dialog title="Move to trash?" close={() => !busy && setConfirm(null)}><p>{confirm.length} {confirm.length === 1 ? 'item will' : 'items will'} move to trash. Published items stay live until you publish their removal. Items still in use cannot be trashed.</p><ul>{confirm.map(doc => <li>{docTitle(doc)}</li>)}</ul><div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button><button class="button" disabled={busy} onClick={() => void moveToTrash(confirm)}>{busy ? 'Moving…' : 'Move to trash'}</button></div></Dialog>}
    {preview && <Dialog title={`Preview ${docTitle(preview)}`} close={() => setPreview(null)} wide><Preview id={preview.id} version={preview.version} collection={collection} draft={preview.draft} /></Dialog>}
  </>;
}
