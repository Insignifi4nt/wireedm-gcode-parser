import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { SavedCadDocument } from '@/domain/cad/cadStorage';

export interface CadSessionSnapshot {
  readonly document: CadDocument;
  readonly version: string;
  readonly savedVersion: string | null;
  readonly dirty: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly workflowOpen: boolean;
}
export class CadSessionError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function hasCadDraftContent(document: CadDocument): boolean {
  return document.features.length > 0 || Object.keys(document.parameters).length > 0 || document.name !== 'Untitled part';
}

/** The UI and agents edit exactly this draft; every accepted batch is one undo step. */
export class CadSession {
  private listeners = new Set<() => void>();
  private past: CadDocument[] = [];
  private future: CadDocument[] = [];
  private savedText: string | null = null;
  private workflows = new Set<'editor' | 'section' | 'import'>();
  private snapshot: CadSessionSnapshot;
  constructor(document = createCadDocument()) {
    this.snapshot = Object.freeze({ document: parseCadDocument(document), version: crypto.randomUUID(), savedVersion: null,
      dirty: true, canUndo: false, canRedo: false, workflowOpen: false });
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  assertVersion(expected: string) {
    if (this.snapshot.version !== expected) throw new CadSessionError('STALE_STATE', 'The CAD draft changed. Read cad_get_context again.');
  }
  assertWorkflowClosed(except?: 'editor' | 'section' | 'import') {
    if ([...this.workflows].some(scope => scope !== except)) throw new CadSessionError('WORKFLOW_OPEN', 'Finish or cancel the active CAD editor, import or section dialog first.');
  }
  assertStorageSwitchAllowed() {
    this.assertWorkflowClosed();
    if (this.snapshot.dirty && hasCadDraftContent(this.snapshot.document)) throw new CadSessionError('UNSAVED_DRAFT', 'Save the CAD draft before switching workbench storage.');
  }
  setWorkflowOpen = (open: boolean, scope: 'editor' | 'section' | 'import' = 'editor') => {
    if (open) this.workflows.add(scope); else this.workflows.delete(scope);
    const workflowOpen = this.workflows.size > 0;
    if (this.snapshot.workflowOpen === workflowOpen) return;
    this.publish({ ...this.snapshot, workflowOpen });
  };
  edit = (edits: readonly CadEdit[], expectedVersion = this.snapshot.version) => {
    this.assertVersion(expectedVersion);
    const next = applyCadEdits(this.snapshot.document, edits);
    if (JSON.stringify(next) === JSON.stringify(this.snapshot.document)) return this.snapshot;
    this.past.push(this.snapshot.document);
    // History is bounded by both count and bytes, not only feature count.
    while (this.past.length > 50 || this.past.length > 1 && JSON.stringify(this.past).length > 8 * 1024 * 1024) this.past.shift();
    this.future = [];
    this.changed(next);
    return this.snapshot;
  };
  undo = (expectedVersion = this.snapshot.version) => {
    this.assertVersion(expectedVersion); this.assertWorkflowClosed();
    const previous = this.past.pop();
    if (!previous) return;
    this.future.push(this.snapshot.document); this.changed(previous);
  };
  redo = (expectedVersion = this.snapshot.version) => {
    this.assertVersion(expectedVersion); this.assertWorkflowClosed();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.snapshot.document); this.changed(next);
  };
  replace(document: CadDocument, saved: SavedCadDocument | null = null) {
    const parsed = parseCadDocument(document);
    if (saved && JSON.stringify(parseCadDocument(saved.document)) !== JSON.stringify(parsed)) {
      throw new CadSessionError('INVALID_SAVE_RECEIPT', 'The saved CAD receipt does not describe the document being opened.');
    }
    this.workflows.clear();
    this.past = []; this.future = [];
    this.savedText = saved ? JSON.stringify(parsed) : null;
    this.publish({ document: parsed, version: crypto.randomUUID(), savedVersion: saved?.savedVersion ?? null,
      dirty: !saved, canUndo: false, canRedo: false, workflowOpen: false });
  }
  markSaved(saved: SavedCadDocument, expectedVersion: string) {
    this.assertVersion(expectedVersion);
    const savedText = JSON.stringify(parseCadDocument(saved.document));
    if (savedText !== JSON.stringify(this.snapshot.document)) throw new CadSessionError('INVALID_SAVE_RECEIPT', 'The saved CAD receipt does not describe the reviewed draft.');
    this.savedText = savedText;
    this.publish({ ...this.snapshot, savedVersion: saved.savedVersion, dirty: JSON.stringify(this.snapshot.document) !== this.savedText });
  }
  detachStorage() {
    this.savedText = null;
    this.publish({ ...this.snapshot, savedVersion: null, dirty: true });
  }
  private changed(document: CadDocument) {
    this.publish({ ...this.snapshot, document, version: crypto.randomUUID(), dirty: JSON.stringify(document) !== this.savedText,
      canUndo: this.past.length > 0, canRedo: this.future.length > 0 });
  }
  private publish(snapshot: CadSessionSnapshot) {
    this.snapshot = Object.freeze(snapshot);
    for (const listener of this.listeners) listener();
  }
}
