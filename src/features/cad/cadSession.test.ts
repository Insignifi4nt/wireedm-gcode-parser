import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession, hasCadDraftContent } from './cadSession';

describe('shared CAD editing session', () => {
  it('preserves a dirty parameter-group-only draft through storage switching and its saved baseline', () => {
    const session = new CadSession(), initial = session.getSnapshot();
    session.markSaved({ document: initial.document, savedVersion: 'baseline', updatedAt: '2026-10-13T12:00:00.000Z' }, initial.version);
    session.edit([{ kind: 'set-parameter-group', group: { id: 'settings', name: 'Settings' } }]);
    const before = session.getSnapshot();
    expect(hasCadDraftContent(before.document)).toBe(true);
    expect(() => session.assertStorageSwitchAllowed()).toThrow('Save the CAD draft');
    expect(session.getSnapshot()).toBe(before);
    session.undo();
    expect(hasCadDraftContent(session.getSnapshot().document)).toBe(false);
    expect(() => session.assertStorageSwitchAllowed()).not.toThrow();
  });
  it('preserves redo and the saved baseline after a no-op or rejected accessor payload', () => {
    const session = new CadSession(); const initial = session.getSnapshot();
    session.markSaved({ document: initial.document, savedVersion: 'saved', updatedAt: '2026-10-13T12:00:00.000Z' }, initial.version);
    session.edit([{ kind: 'rename-document', name: 'Changed' }]); session.undo();
    const restored = session.getSnapshot(); expect(restored).toMatchObject({ dirty: false, canRedo: true });
    expect(session.edit([{ kind: 'rename-document', name: 'Untitled part' }])).toBe(restored);
    let reads = 0;
    expect(() => session.edit([{ kind: 'rename-document', get name() { ++reads; return 'Unreviewed'; } }])).toThrow();
    expect(reads).toBe(0); expect(session.getSnapshot()).toBe(restored);
    session.redo(); expect(session.getSnapshot()).toMatchObject({ dirty: true, canRedo: false });
    expect(session.getSnapshot().document.name).toBe('Changed');
    session.undo(); expect(session.getSnapshot()).toMatchObject({ dirty: false, savedVersion: 'saved', canRedo: true });
  });
  it('retains exactly fifty real edit steps, excludes no-ops, and clears redo after branching', () => {
    const session = new CadSession();
    for (let index = 1; index <= 60; index++) session.edit([{ kind: 'set-parameter', name: 'width', value: index }]);
    const current = session.getSnapshot();
    expect(session.edit([{ kind: 'set-parameter', name: 'width', value: 60 }])).toBe(current);
    let undone = 0;
    while (session.getSnapshot().canUndo) { session.undo(); undone++; }
    expect(undone).toBe(50); expect(session.getSnapshot().document.parameters.width).toBe(10);
    while (session.getSnapshot().canRedo) session.redo();
    expect(session.getSnapshot().document.parameters.width).toBe(60);
    session.undo(); session.edit([{ kind: 'set-parameter', name: 'width', value: 100 }]);
    expect(session.getSnapshot().canRedo).toBe(false);
  });
  it.each([{ textLength: 1_048_574, retained: 8 }, { textLength: 1_048_575, retained: 7 }])('preserves the exact serialized-array bound at document length $textLength', ({ textLength, retained }) => {
    // The original is a valid DXF circle with a long, preserved DXF comment.
    const sourceText = '999\n\n0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n2\n0\nENDSEC\n0\nEOF\n';
    const base = { ...createCadDocument('state_000', 'cad_history'), features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }], source: { format: 'dxf', fileName: 'history.dxf', text: sourceText } }] };
    const text = sourceText.replace('999\n\n', `999\n${'x'.repeat(textLength - JSON.stringify(base).length)}\n`);
    const document = parseCadDocument({ ...base, features: [{ ...base.features[0], source: { ...base.features[0].source, text } }] });
    expect(JSON.stringify(document).length).toBe(textLength);
    const session = new CadSession(document);
    for (let index = 1; index <= 12; index++) session.edit([{ kind: 'rename-document', name: `state_${String(index).padStart(3, '0')}` }]);
    let undone = 0;
    while (session.getSnapshot().canUndo) { session.undo(); undone++; }
    expect(undone).toBe(retained);
    expect(session.getSnapshot().document.name).toBe(`state_${String(12 - retained).padStart(3, '0')}`);
    while (session.getSnapshot().canRedo) session.redo();
    const beforeSave = session.getSnapshot();
    session.markSaved({ document: beforeSave.document, savedVersion: 'history-save', updatedAt: '2026-10-13T12:00:00.000Z' }, beforeSave.version);
    session.undo(); expect(session.getSnapshot().dirty).toBe(true);
    session.redo(); expect(session.getSnapshot().dirty).toBe(false);
    session.detachStorage(); session.undo(); session.redo();
    expect(session.getSnapshot()).toMatchObject({ dirty: true, savedVersion: null });
    expect(session.getSnapshot().document.features[0]).toMatchObject({ source: { text } });
    session.replace(createCadDocument());
    expect(session.getSnapshot()).toMatchObject({ canUndo: false, canRedo: false });
    session.edit([{ kind: 'rename-document', name: 'After replacement' }]); session.undo();
    expect(session.getSnapshot().document.name).toBe('Untitled part');
  });
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
