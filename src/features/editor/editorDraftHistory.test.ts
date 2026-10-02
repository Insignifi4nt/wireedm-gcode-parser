import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import {
  createEditorDraftHistory, EDITOR_HISTORY_LIMITS, estimateEditorSnapshotBytes,
  moveEditorDraftHistory, recordEditorDraftSnapshot
} from './editorDraftHistory';

describe('bounded editor draft history', () => {
  it('keeps the latest 50 edits and transfers them between undo and redo without growing the shared budget', () => {
    let history = createEditorDraftHistory<{ text: string }>();
    let current = { text: 'edit 0' };
    for (let index = 1; index <= 65; index++) {
      history = recordEditorDraftSnapshot(history, current);
      current = { text: `edit ${index}` };
    }
    expect(history.undo).toHaveLength(50);
    expect(history.pruned).toBe(true);
    for (let index = 64; index >= 15; index--) {
      const moved = moveEditorDraftHistory(history, 'undo', current)!;
      history = moved.history;
      current = moved.snapshot;
      expect(current.text).toBe(`edit ${index}`);
      expect(history.undo.length + history.redo.length).toBe(50);
      expect(history.estimatedBytes).toBeLessThanOrEqual(EDITOR_HISTORY_LIMITS.maxEstimatedBytes);
    }
    expect(moveEditorDraftHistory(history, 'undo', current)).toBeNull();
    for (let index = 16; index <= 65; index++) {
      const moved = moveEditorDraftHistory(history, 'redo', current)!;
      history = moved.history;
      current = moved.snapshot;
      expect(current.text).toBe(`edit ${index}`);
    }
    expect(moveEditorDraftHistory(history, 'redo', current)).toBeNull();
  });

  it('clears redo on a new edit while preserving all preceding snapshots and their selection metadata', () => {
    const first = { draft: { text: 'first' }, selection: 'line-1' };
    const second = { draft: { text: 'second' }, selection: 'line-2' };
    let history = recordEditorDraftSnapshot(createEditorDraftHistory<typeof first>(), first);
    const moved = moveEditorDraftHistory(history, 'undo', second)!;
    history = recordEditorDraftSnapshot(moved.history, moved.snapshot);
    expect(history.redo).toEqual([]);
    expect(history.undo.at(-1)?.snapshot).toEqual(first);
    expect(second.selection).toBe('line-2');
  });

  it('bounds retained realistic UPID geometry by bytes before the step limit', () => {
    const pathDocument = createUpidFromDxfEntities(Array.from({ length: 4_000 }, (_, index) => ({
      type: 'line' as const, layer: 'CUT', start: { x: index, y: 0 }, end: { x: index + 1, y: 0 }
    })));
    const snapshot = { draft: { model: 'upid-document', pathDocument }, selectedPathOperationId: pathDocument.plan.operations[0].id };
    const size = estimateEditorSnapshotBytes(snapshot);
    expect(size).toBeGreaterThan(1_000_000);
    expect(size).toBeLessThan(EDITOR_HISTORY_LIMITS.maxEstimatedBytes);
    let history = createEditorDraftHistory<typeof snapshot>();
    for (let index = 0; index < 12; index++) history = recordEditorDraftSnapshot(history, structuredClone(snapshot));
    expect(history.undo.length).toBe(Math.min(12, Math.floor(EDITOR_HISTORY_LIMITS.maxEstimatedBytes / size)));
    expect(history.pruned).toBe(true);
    expect(history.estimatedBytes).toBeLessThanOrEqual(EDITOR_HISTORY_LIMITS.maxEstimatedBytes);
    const moved = moveEditorDraftHistory(history, 'undo', structuredClone(snapshot))!;
    expect(moved.snapshot.draft.pathDocument.segments).toHaveLength(4_000);
    expect(moved.history.estimatedBytes).toBeLessThanOrEqual(EDITOR_HISTORY_LIMITS.maxEstimatedBytes);
  });

  it('accounts for UTF-16 G-code text and prunes distant entries when a larger current draft moves to redo', () => {
    const limits = { maxSnapshots: 50, maxEstimatedBytes: 1_000 };
    let history = createEditorDraftHistory<{ text: string }>();
    for (let index = 0; index < 4; index++) history = recordEditorDraftSnapshot(history, { text: `${index}`.repeat(60) }, limits);
    const large = { text: '日本'.repeat(140) };
    const moved = moveEditorDraftHistory(history, 'undo', large, limits)!;
    expect(moved.history.redo[0].snapshot).toEqual(large);
    expect(moved.history.pruned).toBe(true);
    expect(moved.history.estimatedBytes).toBeLessThanOrEqual(limits.maxEstimatedBytes);
    expect(moveEditorDraftHistory(moved.history, 'redo', moved.snapshot, limits)?.snapshot).toEqual(large);
  });

  it('treats oversized edits as a boundary instead of silently skipping an unrecorded state', () => {
    const limits = { maxSnapshots: 50, maxEstimatedBytes: 1_000 };
    const small = { text: 'small' };
    const huge = { text: 'X'.repeat(1_000) };
    let history = recordEditorDraftSnapshot(createEditorDraftHistory<typeof small>(), small, limits);
    history = recordEditorDraftSnapshot(history, huge, limits);
    expect(history).toMatchObject({ undo: [], redo: [], estimatedBytes: 0, oversized: true });
    expect(moveEditorDraftHistory(history, 'undo', small, limits)).toBeNull();
    history = recordEditorDraftSnapshot(history, small, limits);
    expect(moveEditorDraftHistory(history, 'undo', { text: 'later' }, limits)?.snapshot).toEqual(small);
  });

  it('still allows undo out of an oversized current draft without retaining a redo jump across it', () => {
    const limits = { maxSnapshots: 50, maxEstimatedBytes: 1_000 };
    const history = recordEditorDraftSnapshot(createEditorDraftHistory<{ text: string }>(), { text: 'before' }, limits);
    const moved = moveEditorDraftHistory(history, 'undo', { text: 'X'.repeat(1_000) }, limits)!;
    expect(moved.snapshot.text).toBe('before');
    expect(moved.history).toMatchObject({ redo: [], estimatedBytes: 0, oversized: true });
  });
});
