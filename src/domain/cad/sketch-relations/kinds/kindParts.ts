import type { CadSketchOperandSignature, CadSketchOperandSlot, CadSketchRefusal } from '../cadSketchRelationTypes';

// Parts several kinds share. Like the signatures, this module imports nothing that imports the sketch graph.

/** The ids in one fixed order, so a group stored in any order gives one key. Ids never hold a space. */
export const sortedIds = (ids: readonly string[]) => [...ids].sort().join(' ');
export const refusal = (code: string, message: string): CadSketchRefusal => ({ code, message });

export const POINT_SLOT = { role: 'Point', accepts: ['point'] } as const satisfies CadSketchOperandSlot;
export const LINE_SLOT = { role: 'Line', accepts: ['line'] } as const satisfies CadSketchOperandSlot;
export const ROUND_SLOT = { role: 'Arc or circle', accepts: ['round'] } as const satisfies CadSketchOperandSlot;
/** Two points, in either order. */
export const CAD_SKETCH_POINT_PAIR_OPERANDS = {
  slots: [{ role: 'First point', accepts: ['point'] }, { role: 'Second point', accepts: ['point'] }], unordered: [[0, 1]]
} as const satisfies CadSketchOperandSignature;
/** One point. */
export const CAD_SKETCH_POINT_OPERANDS = { slots: [POINT_SLOT] } as const satisfies CadSketchOperandSignature;

/** Picks of two of one type: the first with each later one. */
export const chainedPair = (slot: CadSketchOperandSlot): CadSketchOperandSignature => ({ slots: [slot, slot], unordered: [[0, 1]], expand: 'chain-from-first' });
