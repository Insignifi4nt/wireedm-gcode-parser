/** Shared by undo and redo; estimates retained JavaScript data, not engine heap usage. */
export const EDITOR_HISTORY_LIMITS = Object.freeze({ maxSnapshots: 50, maxEstimatedBytes: 32 * 1024 * 1024 });

interface HistoryEntry<Snapshot> {
  readonly snapshot: Snapshot;
  readonly estimatedBytes: number;
}

export interface EditorDraftHistory<Snapshot> {
  readonly undo: readonly HistoryEntry<Snapshot>[];
  readonly redo: readonly HistoryEntry<Snapshot>[];
  readonly estimatedBytes: number;
  readonly pruned: boolean;
  readonly oversized: boolean;
}

interface HistoryLimits { readonly maxSnapshots: number; readonly maxEstimatedBytes: number }

export function createEditorDraftHistory<Snapshot>(): EditorDraftHistory<Snapshot> {
  return { undo: [], redo: [], estimatedBytes: 0, pruned: false, oversized: false };
}

/** JSON-shaped draft data: include object/array overhead, property keys and UTF-16 strings.
 * Stop once over budget, avoiding a second document-sized serialized allocation.
 */
export function estimateEditorSnapshotBytes(snapshot: unknown, stopAfter = EDITOR_HISTORY_LIMITS.maxEstimatedBytes): number {
  const pending: unknown[] = [snapshot];
  const seen = new WeakSet<object>();
  let bytes = 0;
  while (pending.length && bytes <= stopAfter) {
    const value = pending.pop();
    if (typeof value === 'string') bytes += 24 + value.length * 2;
    else if (value && typeof value === 'object') {
      if (seen.has(value)) continue;
      seen.add(value);
      bytes += Array.isArray(value) ? 32 + value.length * 8 : 48;
      if (bytes > stopAfter) break;
      if (Array.isArray(value)) {
        for (const entry of value) pending.push(entry);
      } else {
        for (const [key, entry] of Object.entries(value)) {
          bytes += 16 + key.length * 2;
          pending.push(entry);
        }
      }
    } else bytes += 8;
  }
  return bytes;
}

export function recordEditorDraftSnapshot<Snapshot>(
  history: EditorDraftHistory<Snapshot>, snapshot: Snapshot, limits: HistoryLimits = EDITOR_HISTORY_LIMITS
): EditorDraftHistory<Snapshot> {
  const estimatedBytes = estimateEditorSnapshotBytes(snapshot, limits.maxEstimatedBytes);
  // Keeping older entries would allow undo to skip this unrecorded boundary.
  if (estimatedBytes > limits.maxEstimatedBytes) return {
    ...createEditorDraftHistory<Snapshot>(), pruned: true, oversized: true
  };
  return trim({ ...history, undo: [...history.undo, { snapshot, estimatedBytes }], redo: [] }, limits);
}

export function moveEditorDraftHistory<Snapshot>(
  history: EditorDraftHistory<Snapshot>, direction: 'undo' | 'redo', current: Snapshot,
  limits: HistoryLimits = EDITOR_HISTORY_LIMITS
): { readonly history: EditorDraftHistory<Snapshot>; readonly snapshot: Snapshot } | null {
  const target = direction === 'undo' ? history.undo.at(-1) : history.redo[0];
  if (!target) return null;
  const estimatedBytes = estimateEditorSnapshotBytes(current, limits.maxEstimatedBytes);
  const oversized = estimatedBytes > limits.maxEstimatedBytes;
  const entry = { snapshot: current, estimatedBytes };
  const next = direction === 'undo'
    ? { ...history, undo: history.undo.slice(0, -1), redo: oversized ? [] : [entry, ...history.redo] }
    : { ...history, undo: oversized ? [] : [...history.undo, entry], redo: history.redo.slice(1) };
  return {
    history: trim({ ...next, pruned: history.pruned || oversized, oversized: history.oversized || oversized }, limits,
      direction === 'undo' ? 'redo' : 'undo'),
    snapshot: target.snapshot
  };
}

function trim<Snapshot>(history: EditorDraftHistory<Snapshot>, limits: HistoryLimits, preserve: 'undo' | 'redo' = 'undo'): EditorDraftHistory<Snapshot> {
  const undo = [...history.undo];
  const redo = [...history.redo];
  let estimatedBytes = [...undo, ...redo].reduce((total, entry) => total + entry.estimatedBytes, 0);
  let pruned = history.pruned;
  while (undo.length + redo.length > limits.maxSnapshots || estimatedBytes > limits.maxEstimatedBytes) {
    // Preserve the state just left so the last action can be reversed. Remove
    // only distant ends, never a middle entry that would introduce a jump.
    const removed = preserve === 'undo'
      ? (redo.length ? redo.pop() : undo.shift())
      : (undo.length ? undo.shift() : redo.pop());
    if (!removed) break;
    estimatedBytes -= removed.estimatedBytes;
    pruned = true;
  }
  return { ...history, undo, redo, estimatedBytes, pruned };
}
