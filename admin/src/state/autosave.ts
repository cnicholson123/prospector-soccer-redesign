import { signal, computed } from '@preact/signals';
import type { Doc, ValidationIssue } from '../../../shared/types.js';
import { collections, type CollectionName } from '../../../shared/schema.js';
import { validate } from '../../../server/content/validate.js';
import { defaults, changed } from './content.js';
import { api, cachedApi, ApiError, message, session } from '../api.js';
export type EventDoc = Doc<Record<string, unknown>>;
export class EditorState {
  doc = signal<EventDoc | null>(null);
  draft = signal<Record<string, unknown>>({ title: '', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), showOnHome: true });
  status = signal('Unsaved event');
  errors = signal<ValidationIssue[]>([]);
  conflict = signal<EventDoc | null>(null);
  recovery = signal<Record<string, unknown> | null>(null);
  recoveryVersion = signal<number | null>(null);
  recoveryWarning = computed(() => this.recoveryVersion.value === null ? 'The saved version for this local draft is unknown. Compare it with the current content before saving.' : this.recoveryVersion.value !== (this.doc.value?.version ?? 0) ? 'The server has changed since this local draft was saved. Recovering it may replace newer changes. Review it before saving.' : '');
  readonly isNew: boolean;
  loading = signal(true);
  saving = signal(false);
  dirty = computed(() => !this.loading.value && JSON.stringify(this.doc.value?.draft ?? this.initialDraft) !== JSON.stringify(this.draft.value));
  private initialDraft: Record<string, unknown> = {};
  private inFlight?: Promise<boolean>;
  private retry?: ReturnType<typeof setTimeout>;
  private retryDelay = 2000;
  private retryCount = 0;
  private disposed = false;
  private key: string;
  constructor(readonly id: string, readonly collection: CollectionName = 'events') {
    this.isNew = id === 'new';
    this.loading.value = !this.isNew;
    this.key = `psc_draft_${session.value?.user.id}_${collection}_${id}`;
    this.draft.value = { ...defaults(collections[collection].fields), ...(collection === 'events' ? this.draft.value : {}), ...(collection === 'documents' ? { source: { mode: 'url' } } : {}) };
    this.initialDraft = structuredClone(this.draft.value);
    this.status.value = `Unsaved ${collections[collection].label.toLowerCase()}`;
  }
  async load() {
    this.loading.value = true;
    let saved: { draft?: unknown; format?: unknown; baseVersion?: unknown; docId?: unknown } | null = null;
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) saved = value;
    } catch { /* Invalid or inaccessible local storage does not block editing. */ }
    // A creation may have succeeded before a later autosave failed. Reopen that
    // document instead of posting the recovered content as a duplicate.
    const savedId = this.isNew && saved?.format === 1 && typeof saved.docId === 'string' && /^[\w-]{1,64}$/.test(saved.docId) ? saved.docId : undefined;
    try {
      if (!this.isNew || savedId) {
        const { doc } = await cachedApi<{ doc: EventDoc }>(`/docs/${this.collection}/${savedId ?? this.id}`, ({ doc: fresh }) => {
          if (!this.disposed && !this.loading.value && !this.saving.value && !this.dirty.value && !this.recovery.value && !this.conflict.value && fresh.version > (this.doc.value?.version ?? 0)) this.accept(fresh);
        });
        if (this.disposed) return;
        this.doc.value = doc; this.draft.value = doc.draft; this.status.value = 'Saved';
      }
      if (this.disposed) return;
      if (saved?.draft && typeof saved.draft === 'object' && !Array.isArray(saved.draft)) {
        const draft = Object.fromEntries(Object.entries(saved.draft).filter(([key]) => key in collections[this.collection].fields));
        if (JSON.stringify(draft) !== JSON.stringify(this.draft.value)) {
          this.recovery.value = draft;
          this.recoveryVersion.value = saved.format === 1 && Number.isSafeInteger(saved.baseVersion) && Number(saved.baseVersion) >= 0 ? Number(saved.baseVersion) : null;
        }
      }
    } finally { if (!this.disposed) this.loading.value = false; }
  }
  async refresh(): Promise<'updated' | 'changed' | false> {
    const before = this.doc.value, draft = this.draft.value;
    if (!before || this.disposed || this.saving.value || this.recovery.value) return false;
    const { doc } = await api<{ doc: EventDoc }>(`/docs/${this.collection}/${before.id}`);
    // A read started before a save or keystroke must never replace newer state.
    if (this.disposed || this.saving.value || this.doc.value !== before || this.draft.value !== draft || doc.version <= before.version) return false;
    if (this.dirty.value || this.conflict.value) return 'changed';
    this.accept(doc);
    return 'updated';
  }
  update(name: string, value: unknown) {
    clearTimeout(this.retry); this.retryCount = 0; this.retryDelay = 2000;
    this.draft.value = { ...this.draft.value, [name]: value };
    this.status.value = 'Unsaved changes'; this.persist();
  }
  persist() {
    try { localStorage.setItem(this.key, JSON.stringify({ format: 1, baseVersion: this.doc.value?.version ?? 0, docId: this.doc.value?.id, draft: this.draft.value })); }
    catch { this.status.value = 'Unsaved changes · local recovery unavailable'; }
  }
  clearRecovery() { this.recovery.value = null; this.recoveryVersion.value = null; try { localStorage.removeItem(this.key); } catch { /* unavailable */ } }
  recover() { const draft = this.recovery.value; this.clearRecovery(); if (draft) { this.draft.value = draft; this.persist(); this.status.value = 'Recovered changes · waiting to save'; } }
  validate() { const result = validate(this.collection, this.draft.value, { mode: 'draft' }); this.errors.value = result.errors; return result.valid; }
  async save(checkpoint = false): Promise<boolean> {
    if (this.inFlight) { if (!await this.inFlight) return false; return this.save(checkpoint); }
    if (this.disposed || this.loading.value || !this.isNew && !this.doc.value || this.conflict.value || this.recovery.value) return false;
    clearTimeout(this.retry);
    if (!this.dirty.value && !checkpoint) return true;
    if (!this.validate()) { this.status.value = 'Check the highlighted fields'; return false; }
    this.inFlight = this.write(checkpoint);
    const result = await this.inFlight;
    this.inFlight = undefined;
    return result;
  }
  private async write(checkpoint: boolean): Promise<boolean> {
    const draft = structuredClone(this.draft.value), doc = this.doc.value;
    this.saving.value = true; this.status.value = 'Saving…';
    try {
      const result = await api<{ doc: EventDoc }>(doc ? `/docs/${this.collection}/${doc.id}` : `/docs/${this.collection}`, doc ? 'PUT' : 'POST', doc ? { draft, baseVersion: doc.version, checkpoint } : { draft });
      this.doc.value = result.doc; changed();
      // A later keystroke must survive the response to an earlier save.
      if (JSON.stringify(draft) === JSON.stringify(this.draft.value)) { this.draft.value = result.doc.draft; this.clearRecovery(); }
      else this.persist();
      clearTimeout(this.retry); this.retryCount = 0; this.retryDelay = 2000;
      this.status.value = this.dirty.value ? 'Unsaved changes' : `Saved · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.details as { current?: EventDoc })?.current;
        // A publish/schedule by someone else bumps the version without touching
        // the draft content we edited from: rebase silently instead of conflicting.
        if (current && doc && current.version > doc.version && JSON.stringify(current.draft) === JSON.stringify(doc.draft)) {
          this.doc.value = current;
          this.saving.value = false;
          return this.write(checkpoint);
        }
        if (current) this.conflict.value = current;
        this.status.value = 'Someone else saved this. Reload and compare';
      } else if (error instanceof ApiError && error.status === 422) {
        this.errors.value = Array.isArray(error.details) ? error.details : [];
        this.status.value = message(error);
      } else {
        this.status.value = error instanceof ApiError ? message(error) : 'Offline — changes kept locally';
        if (this.retryCount < 3 && (!(error instanceof ApiError) || error.status >= 500 || error.status === 429)) {
          this.retryCount++;
          this.retry = setTimeout(() => { if (!this.disposed) void this.save(); }, error instanceof ApiError && error.retryAfter ? error.retryAfter * 1000 : this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        }
      }
      this.persist(); return false;
    } finally { this.saving.value = false; }
  }
  async flush() {
    // Loading an existing record and untouched new forms have no work to save.
    if (!this.saving.value && !this.dirty.value && !this.recovery.value && !this.conflict.value) return true;
    do {
      if (!await this.save()) return false;
    } while (this.dirty.value || this.saving.value);
    return true;
  }
  accept(doc: EventDoc) { this.loading.value = false; this.doc.value = doc; this.draft.value = doc.draft; this.conflict.value = null; this.clearRecovery(); this.status.value = 'Saved'; this.errors.value = []; }
  async keepMine() { const current = this.conflict.value; if (!current) return; this.doc.value = current; this.conflict.value = null; await this.save(true); }
  dispose() { this.disposed = true; clearTimeout(this.retry); }
}
export const navigationGuard = signal<(() => Promise<boolean>) | null>(null);
export const editorFlush = signal<(() => Promise<boolean>) | null>(null);

// Form, inline and media editors can coexist. Cleanup removes only its own
// registration, so closing a nested editor cannot disconnect another editor.
const openEditors = new Set<() => Promise<boolean>>();
async function flushEditors() {
  let saved = true;
  for (const flush of openEditors) if (!await flush()) saved = false;
  return saved;
}
export function registerEditorFlush(flush: () => Promise<boolean>) {
  openEditors.add(flush);
  editorFlush.value = flushEditors;
  navigationGuard.value = flushEditors;
  return () => {
    openEditors.delete(flush);
    editorFlush.value = openEditors.size ? flushEditors : null;
    navigationGuard.value = editorFlush.value;
  };
}
