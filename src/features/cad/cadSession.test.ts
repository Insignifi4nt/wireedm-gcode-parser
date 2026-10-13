import { describe, expect, it } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';

describe('shared CAD editing session', () => {
  it('keeps public snapshots immutable and rejects foreign save receipts before changing state or history', () => {
    const session = new CadSession();
    session.edit([{ kind: 'rename-document', name: 'Reviewed' }]);
    const before = session.getSnapshot();
    expect(Object.isFrozen(before)).toBe(true);
    expect(() => Object.assign(before, { version: 'forged', dirty: false })).toThrow();
    const foreign = { document: createCadDocument('Foreign'), savedVersion: 'foreign-save', updatedAt: '2026-10-13T12:00:00.000Z' };
    expect(() => session.markSaved(foreign, before.version)).toThrow('reviewed draft');
    expect(() => session.replace(before.document, foreign)).toThrow('document being opened');
    expect(session.getSnapshot()).toBe(before);
    expect(before.canUndo).toBe(true); expect(before.dirty).toBe(true); expect(before.savedVersion).toBeNull();
    session.undo(); expect(session.getSnapshot().document.name).toBe('Untitled part');
  });
  it('retains independent dialog and editor guards until both workflows finish', () => {
    const session = new CadSession();
    session.setWorkflowOpen(true, 'section');
    session.setWorkflowOpen(false);
    expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(() => session.assertWorkflowClosed()).toThrow('Finish or cancel');
    expect(() => session.assertWorkflowClosed('section')).not.toThrow();
    session.setWorkflowOpen(true);
    expect(() => session.assertWorkflowClosed('section')).toThrow('Finish or cancel');
    expect(() => session.assertWorkflowClosed('editor')).toThrow('Finish or cancel');
    session.setWorkflowOpen(false, 'section');
    expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(() => session.assertWorkflowClosed('editor')).not.toThrow();
    expect(() => session.assertWorkflowClosed()).toThrow('Finish or cancel');
    session.setWorkflowOpen(false);
    expect(session.getSnapshot().workflowOpen).toBe(false);
  });
  it('makes an edit batch atomic and undoable with nonreusable versions', () => {
    const session = new CadSession(createCadDocument());
    const initial = session.getSnapshot();
    session.edit([{ kind: 'set-parameter', name: 'width', value: 40 }, { kind: 'rename-document', name: 'Plate' }], initial.version);
    const edited = session.getSnapshot();
    expect(edited.document.parameters.width).toBe(40);
    expect(() => session.edit([{ kind: 'rename-document', name: 'Stale' }], initial.version)).toThrow('changed');
    session.undo(edited.version);
    expect(session.getSnapshot().document).toEqual(initial.document);
    expect(session.getSnapshot().version).not.toBe(initial.version);
    session.redo();
    expect(session.getSnapshot().document.name).toBe('Plate');
  });
  it('rejects a batch without touching history or applying an earlier successful edit', () => {
    const session = new CadSession();
    const before = session.getSnapshot();
    expect(() => session.edit([{ kind: 'rename-document', name: 'Changed' }, { kind: 'delete-feature', featureId: 'missing', cascade: false }])).toThrow();
    expect(session.getSnapshot()).toBe(before);
  });
  it('tracks dirtiness against the saved snapshot across undo and blocks history during drawing', () => {
    const session = new CadSession();
    const state = session.getSnapshot();
    session.markSaved({ document: state.document, savedVersion: 'saved-1', updatedAt: '2026-10-13T12:00:00.000Z' }, state.version);
    expect(session.getSnapshot().dirty).toBe(false);
    session.edit([{ kind: 'rename-document', name: 'Changed' }]);
    session.setWorkflowOpen(true);
    expect(() => session.undo()).toThrow('Finish or cancel');
    session.setWorkflowOpen(false); session.undo();
    expect(session.getSnapshot().dirty).toBe(false);
    expect(session.getSnapshot().savedVersion).toBe('saved-1');
  });
  it('protects a hidden parameter-only or renamed CAD draft from storage switching', () => {
    const session = new CadSession();
    expect(() => session.assertStorageSwitchAllowed()).not.toThrow();
    session.edit([{ kind: 'set-parameter', name: 'width', value: 10 }]);
    expect(() => session.assertStorageSwitchAllowed()).toThrow('Save the CAD draft');
    session.undo(); session.edit([{ kind: 'rename-document', name: 'Bracket' }]);
    expect(() => session.assertStorageSwitchAllowed()).toThrow('Save the CAD draft');
    const current = session.getSnapshot();
    session.markSaved({ document: current.document, savedVersion: 'saved', updatedAt: '2026-10-13T12:00:00.000Z' }, current.version);
    expect(() => session.assertStorageSwitchAllowed()).not.toThrow();
    session.setWorkflowOpen(true);
    expect(() => session.assertStorageSwitchAllowed()).toThrow('Finish or cancel');
  });
});
