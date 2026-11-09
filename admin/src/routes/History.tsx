import { useEffect, useRef, useState } from 'preact/hooks';
import { collections, type CollectionName } from '../../../shared/schema.js';
import type { PublishRecord, Revision } from '../../../shared/types.js';
import type { SiteComparison } from '../../../shared/history.js';
import { allowed, api, ApiError, message, publicOrigin } from '../api.js';
import { changed, editorPath, getPath } from '../state/content.js';
import { notify } from '../state/toasts.js';
import { historyTime, revisionAction, useHistoryPages, type ActorOption } from '../state/history.js';
import { DiffView } from '../components/DiffView.js';
import { Dialog } from '../components/ConfirmDialog.js';
import { HistoryPager } from '../components/HistoryPager.js';
function SiteChanges({ comparison }: { comparison: SiteComparison }) {
  return <><p>{comparison.changes.length} documents reviewed. Current site version {comparison.currentSiteVersion} → a new publication using version {comparison.publish.siteVersion}.</p><p>Every document below will receive a new revision. Later documents are removed from the live site and their drafts kept. Scheduled publications are cancelled.</p><ol class="site-changes">{comparison.changes.map(change => <li key={`${change.collection}/${change.id}`}><details><summary><strong>{change.title}</strong><span>{collections[change.collection].label} · {change.operation === 'unpublish' ? 'Remove from live site' : change.operation === 'keep' ? 'Keep unpublished draft' : change.draftDiff.length || change.liveDiff.length || change.effects.length ? 'Restore content' : 'Republish unchanged content'}</span></summary>
      {change.effects.length > 0 && <ul>{change.effects.map(effect => <li key={effect}>{effect}</li>)}</ul>}
      {change.operation === 'restore' && <><h4>Draft changes</h4><DiffView changes={change.draftDiff} beforeLabel="Current draft" afterLabel="Restored draft" /></>}
      <h4>Live changes</h4><DiffView changes={change.liveDiff} beforeLabel="Current live" afterLabel="Restored live" /></details></li>)}</ol></>;
}
function SiteVersions({ refresh }: { refresh: number }) {
  const pages = useHistoryPages<PublishRecord>('/publishes?refresh=' + refresh, 'publishes');
  const [comparison, setComparison] = useState<SiteComparison | null>(null), [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const [actors, setActors] = useState<ActorOption[]>([]);
  const request = useRef(0);
  useEffect(() => { api<{ actors: ActorOption[] }>('/audit/actors').then(data => setActors(data.actors)).catch(() => {}); return () => { request.current++; }; }, []);
  async function compare(version: number) {
    const run = ++request.current; setBusy(true); setError(''); setComparison(null);
    try { const result = await api<SiteComparison>(`/publishes/${version}?diff=1`); if (request.current === run) setComparison(result); }
    catch (error) { if (request.current === run) setError(message(error)); }
    finally { if (request.current === run) setBusy(false); }
  }
  async function restore() {
    if (!comparison) return;
    setBusy(true); setError('');
    try {
      const result = await api<{ siteVersion: number; message: string }>(`/publishes/${comparison.publish.siteVersion}/restore`, 'POST', { summary: note || undefined, token: comparison.token });
      setConfirm(false); setComparison(null); changed(); void pages.load();
      notify(result.message, `${publicOrigin}/?v=${result.siteVersion}`);
    } catch (error) { setError(message(error)); if (error instanceof ApiError && error.status === 409) { setConfirm(false); setComparison(null); } }
    finally { setBusy(false); }
  }
  return <><section class="card history-card"><div class="section-heading"><div><h2>Site versions</h2><p class="muted">A record of every publication. Restores always create a new version.</p></div></div>
    {error && <p class="error-box" role="alert">{error}</p>}{busy && !comparison && <p role="status">Loading comparison…</p>}
    <ol class="version-list">{pages.rows.map(version => <li key={version.siteVersion}><div class="version-heading"><span class="version-number">{version.siteVersion}</span><div><h3>Site version {version.siteVersion}</h3><p>{historyTime(version.at)} · {actors.find(actor => actor.id === version.actorId)?.name ?? version.actorId}</p></div><span class="badge">{version.kind}</span></div><p>{version.summary || (version.restoredFrom ? `Restored from site version ${version.restoredFrom}` : 'No publication note.')}</p><details><summary>{version.manifest.length} published documents</summary><ul class="manifest-list">{version.manifest.map(entry => <li key={entry.id}>{entry.title} <span class="muted">· {collections[entry.collection].label} · revision {entry.version} · order {entry.order}</span></li>)}</ul></details><button class="button secondary" disabled={busy} onClick={() => void compare(version.siteVersion)}>Compare with current<span class="sr-only"> site version {version.siteVersion}</span></button></li>)}</ol>
    {!pages.loading && !pages.error && !pages.rows.length && <p class="empty-state">No site versions yet. Publish content to start the history.</p>}
    <HistoryPager {...pages} more={pages.cursor} load={() => void pages.load(pages.cursor)} />
  </section>
  {comparison && <Dialog title={confirm ? `Restore site version ${comparison.publish.siteVersion}?` : `Compare site version ${comparison.publish.siteVersion}`} close={() => { if (!busy) { setComparison(null); setConfirm(false); } }} wide dismissible={!busy}>
    {confirm && <p class="notice">This publishes the restored content and replaces the listed drafts. Your current revisions remain in history.</p>}
    <SiteChanges comparison={comparison} />
    {confirm && <><label class="note-label" for="restore-note">Restore note (optional)</label><textarea id="restore-note" maxLength={1000} value={note} disabled={busy} onInput={e => setNote(e.currentTarget.value)} /></>}
    {error && <p class="error-box" role="alert">{error}</p>}
    <div class="dialog-actions"><button class="button secondary" disabled={busy} onClick={() => { setComparison(null); setConfirm(false); }}>Cancel</button>{allowed('site.restore') && <button class="button" disabled={busy} onClick={() => confirm ? void restore() : setConfirm(true)}>{busy ? 'Restoring…' : confirm ? 'Confirm site restore' : 'Restore site to this version'}</button>}</div>
  </Dialog>}</>;
}
function AllRevisions() {
  const [collection, setCollection] = useState(''), [author, setAuthor] = useState(''), [actors, setActors] = useState<ActorOption[]>([]);
  const [selected, setSelected] = useState<{ revision: Revision; diff: import('../components/DiffView.js').Change[] } | null>(null), [error, setError] = useState('');
  async function openRevision(rev: Revision) { try { setError(''); setSelected(await api(`/revisions/${rev.id}?docId=${rev.docId}`)); } catch (error) { setError(message(error)); } }
  const pages = useHistoryPages<Revision>('/revisions?' + new URLSearchParams({ ...(collection ? { collection } : {}), ...(author ? { author } : {}) }));
  useEffect(() => { api<{ actors: ActorOption[] }>('/audit/actors').then(data => setActors(data.actors)).catch(() => {}); }, []);
  return <section class="card history-card"><h2>All revisions</h2><div class="history-filters"><label>Collection<select aria-label="Collection" value={collection} onChange={e => setCollection(e.currentTarget.value)}><option value="">All collections</option>{Object.values(collections).map(c => <option key={c.name} value={c.name}>{c.labelPlural}</option>)}</select></label><label>Author<select aria-label="Author" value={author} onChange={e => setAuthor(e.currentTarget.value)}><option value="">All authors</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}<option value="seed">Seed migration</option><option value="system">System</option></select></label></div>
    {error && <p class="error-box" role="alert">{error}</p>}<ol class="revision-list">{pages.rows.map(rev => <li key={rev.id}><div><h3>{String(getPath(rev.data, collections[rev.collection].titleField) || collections[rev.collection].label)}</h3><strong>{revisionAction(rev)}</strong><p>{rev.authorName} · <time dateTime={rev.at}>{historyTime(rev.at)}</time></p><p>{collections[rev.collection].label} · Revision {rev.docVersion} · {rev.sealedAt ? 'Sealed' : 'Working draft'}</p>{rev.summary && <p>{rev.summary}</p>}</div>{rev.collection !== 'media' ? <a class="button secondary" href={`${editorPath(rev.collection as CollectionName, rev.docId)}?panel=history&revision=${encodeURIComponent(rev.id)}`}>View revision</a> : <button class="button secondary" onClick={() => void openRevision(rev)}>View revision</button>}</li>)}</ol>
    {!pages.loading && !pages.error && !pages.rows.length && <p class="empty-state">No revisions match these filters.</p>}<HistoryPager {...pages} more={pages.cursor} load={() => void pages.load(pages.cursor)} />{selected && <Dialog title={`Revision ${selected.revision.docVersion}`} close={() => setSelected(null)} wide><p>{selected.revision.authorName} · {historyTime(selected.revision.at)} · {revisionAction(selected.revision)}</p><p>{selected.revision.summary}</p><DiffView changes={selected.diff} /></Dialog>}</section>;
}
export function History({ refresh = 0 }: { refresh?: number }) {
  const [tab, setTab] = useState('versions');
  return <><header class="page-heading"><div><span class="eyebrow">Every chapter, kept</span><h1>History</h1><p>Review past changes and bring earlier content forward.</p></div></header><div class="editor-tabs" aria-label="History views"><button aria-pressed={tab === 'versions'} onClick={() => setTab('versions')}>Site versions</button><button aria-pressed={tab === 'revisions'} onClick={() => setTab('revisions')}>All revisions</button></div>{tab === 'versions' ? <SiteVersions refresh={refresh} /> : <AllRevisions />}</>;
}
