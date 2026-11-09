import { signal, computed } from '@preact/signals';
import type { Doc, ValidationIssue } from '../../../shared/types';
import { collections } from '../../../shared/schema';
import { validate } from '../../../server/content/validate';
import { api, ApiError, message, session } from '../api';
export type EventDoc = Doc<Record<string, unknown>>;
export class EditorState {
  doc = signal<EventDoc | null>(null);
  draft = signal<Record<string, unknown>>({ title: '', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), showOnHome: true });
  status = signal('Unsaved event');
  errors = signal<ValidationIssue[]>([]);
  conflict = signal<EventDoc | null>(null);
  recovery = signal<Record<string, unknown> | null>(null);
  saving = signal(false);
  dirty = computed(() => !this.doc.value || JSON.stringify(this.doc.value.draft) !== JSON.stringify(this.draft.value));
  private inFlight?: Promise<boolean>;
  private retry?: ReturnType<typeof setTimeout>;
  private retryDelay = 2000;
  private disposed = false;
  private key: string;
  constructor(readonly id: string) { this.key = `psc_draft_${session.value?.user.id}_events_${id}`; }
  async load() {
    if (this.id !== 'new') {
      const { doc } = await api<{ doc: EventDoc }>(`/docs/events/${this.id}`);
      this.doc.value = doc; this.draft.value = doc.draft; this.status.value = 'Saved';
    }
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (saved && typeof saved === 'object' && saved.draft && typeof saved.draft === 'object' && !Array.isArray(saved.draft)) {
        const draft = Object.fromEntries(Object.entries(saved.draft).filter(([key]) => key in collections.events.fields));
        if (JSON.stringify(draft) !== JSON.stringify(this.draft.value)) this.recovery.value = draft;
      }
    } catch { /* Invalid or inaccessible local storage does not block editing. */ }
  }
  update(name: string, value: unknown) {
    this.draft.value = { ...this.draft.value, [name]: value };
    this.status.value = 'Unsaved changes'; this.persist();
  }
  persist() {
    try { localStorage.setItem(this.key, JSON.stringify({ draft: this.draft.value })); }
    catch { this.status.value = 'Unsaved changes · local recovery unavailable'; }
  }
  clearRecovery() { this.recovery.value = null; try { localStorage.removeItem(this.key); } catch { /* unavailable */ } }
  recover() { const draft = this.recovery.value; this.clearRecovery(); if (draft) { this.draft.value = draft; this.persist(); this.status.value = 'Recovered changes · waiting to save'; } }
  validate() { const result = validate('events', this.draft.value, { mode: 'draft' }); this.errors.value = result.errors; return result.valid; }
  async save(checkpoint = false): Promise<boolean> {
    if (this.inFlight) { await this.inFlight; return this.save(checkpoint); }
    if (this.disposed || this.conflict.value || this.recovery.value) return false;
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
      const result = await api<{ doc: EventDoc }>(doc ? `/docs/events/${doc.id}` : '/docs/events', doc ? 'PUT' : 'POST', doc ? { draft, baseVersion: doc.version, checkpoint } : { draft });
      this.doc.value = result.doc;
      // A later keystroke must survive the response to an earlier save.
      if (JSON.stringify(draft) === JSON.stringify(this.draft.value)) { this.draft.value = result.doc.draft; this.clearRecovery(); }
      else this.persist();
      this.retryDelay = 2000;
      this.status.value = this.dirty.value ? 'Unsaved changes' : `Saved · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const current = (error.details as { current?: EventDoc })?.current;
        if (current) this.conflict.value = current;
        this.status.value = 'Someone else saved this. Reload and compare';
      } else if (error instanceof ApiError && error.status === 422) {
        this.errors.value = Array.isArray(error.details) ? error.details : [];
        this.status.value = message(error);
      } else {
        this.status.value = error instanceof ApiError ? message(error) : 'Offline — changes kept locally';
        if (!(error instanceof ApiError) || error.status >= 500 || error.status === 429) {
          this.retry = setTimeout(() => { if (!this.disposed) void this.save(); }, error instanceof ApiError && error.retryAfter ? error.retryAfter * 1000 : this.retryDelay);
          this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        }
      }
      this.persist(); return false;
    } finally { this.saving.value = false; }
  }
  async flush() {
    if (!await this.save()) return false;
    return !this.dirty.value || this.save();
  }
  accept(doc: EventDoc) { this.doc.value = doc; this.draft.value = doc.draft; this.conflict.value = null; this.clearRecovery(); this.status.value = 'Saved'; this.errors.value = []; }
  async keepMine() { const current = this.conflict.value; if (!current) return; this.doc.value = current; this.conflict.value = null; await this.save(true); }
  dispose() { this.disposed = true; clearTimeout(this.retry); }
}
export const navigationGuard = signal<(() => Promise<boolean>) | null>(null);
export const editorFlush = signal<(() => Promise<boolean>) | null>(null);
