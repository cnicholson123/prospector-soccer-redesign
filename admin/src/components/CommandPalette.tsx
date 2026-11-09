import { useEffect, useRef, useState } from 'preact/hooks';
import { api, message } from '../api.js';
import type { CollectionName } from '../../../shared/schema.js';
import { commands, type Command } from '../state/palette.js';
import { editorPath } from '../state/content.js';
import { Dialog } from './ConfirmDialog.js';
export function CommandPalette({ close, execute }: { close: () => void; execute: (command: Command) => Promise<void> }) {
  const [query, setQuery] = useState(''), [results, setResults] = useState<Command[]>([]), [active, setActive] = useState(0), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    setActive(0); setResults([]); setError('');
    if (!query.trim()) { setLoading(false); return; }
    let current = true;
    setLoading(true);
    const timer = setTimeout(() => { void api<{ results: { collection: CollectionName; id: string; title: string }[] }>(`/search?title=1&q=${encodeURIComponent(query)}`).then(data => { if (current) setResults(data.results.map(d => ({ id: `doc-${d.id}`, title: d.title, detail: 'Document', href: editorPath(d.collection, d.id) }))); }).catch(e => { if (current) setError(message(e)); }).finally(() => { if (current) setLoading(false); }); }, 200);
    return () => { current = false; clearTimeout(timer); };
  }, [query]);
  const matches = [...commands().filter(c => c.title.toLowerCase().includes(query.trim().toLowerCase())), ...results];
  useEffect(() => { if (typeof document !== 'undefined') document.getElementById(`command-${matches[active]?.id}`)?.scrollIntoView({ block: 'nearest' }); }, [active, query, results]);
  async function run(command: Command) { setBusy(true); setError(''); try { await execute(command); close(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }
  return <Dialog title="Command palette" initialFocus="#command-query" close={() => { if (!busy) close(); }} wide><label class="sr-only" for="command-query">Search commands and documents</label><input ref={input} id="command-query" type="text" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="command-results" aria-activedescendant={matches[active] ? `command-${matches[active].id}` : undefined} autoComplete="off" placeholder="Search screens, documents and actions…" value={query} disabled={busy} onInput={e => setQuery(e.currentTarget.value)} onKeyDown={e => {
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) e.preventDefault();
    if (e.key === 'ArrowDown') setActive(index => (index + 1) % Math.max(1, matches.length));
    if (e.key === 'ArrowUp') setActive(index => (index + matches.length - 1) % Math.max(1, matches.length));
    if (e.key === 'Enter') {
      // Typing fast then pressing Enter can beat the re-render; match against the live input value.
      const live = (e.currentTarget?.value ?? query).trim().toLowerCase();
      // Server title results belong to the previous query, so only built-in commands are trusted here.
      const fresh = live === query.trim().toLowerCase() ? matches : commands().filter(c => c.title.toLowerCase().includes(live));
      const pick = live === query.trim().toLowerCase() ? fresh[active] : fresh[0];
      if (pick) void run(pick);
    }
  }} /><p class="muted palette-hint">↑ ↓ to move · Enter to select · Esc to close</p>{error && <p class="error-box" role="alert">{error}</p>}<div class="command-results" id="command-results" role="listbox" aria-label="Commands and documents" aria-busy={loading || busy}>{matches.map((command, index) => <div key={command.id} id={`command-${command.id}`} role="option" aria-selected={index === active} class="command-option" onMouseEnter={() => setActive(index)} onMouseDown={e => e.preventDefault()} onClick={() => { if (!busy) void run(command); }}><span>{command.title}</span><small>{command.detail}</small></div>)}</div>{!matches.length && <p role="status">{loading ? 'Searching documents…' : 'No matching commands or documents.'}</p>}{busy && <p role="status">Running command…</p>}</Dialog>;
}
export function ShortcutHelp({ close }: { close: () => void }) {
  return <Dialog title="Keyboard shortcuts" close={close}><p>Use ⌘ on Mac or Ctrl on Windows and Linux.</p><dl class="shortcut-list">{[['⌘ / Ctrl + K', 'Search commands and documents'], ['⌘ / Ctrl + S', 'Save checkpoint in an editor'], ['⌘ / Ctrl + Shift + P', 'Review changes'], ['[ / ]', 'Previous / next item in a collection'], ['?', 'Show keyboard shortcuts'], ['Esc', 'Close a dialog or drawer']].map(([key, description]) => <div><dt><kbd>{key}</kbd></dt><dd>{description}</dd></div>)}</dl><p class="muted">Single-key shortcuts are paused while you type in a field. Previous / next follows the collection’s stored order and saves your draft first.</p></Dialog>;
}
