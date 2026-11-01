import { describe, expect, it } from 'vitest';

import { createGCodeInterpreterState, interpretGCodeBlock } from '../gcodeBlockInterpreter';

const REFUSED_CHORD = { line: 1, message: 'R arcs require distinct start and end points.', type: 'error' } as const;

describe('G-code R-arc chord tolerance', () => {
  // Programmed coordinates are rounded to 12 decimals, so a chord shorter than one 1e-12 mm step
  // can only start from an explicit, unrounded initial position.
  it('refuses an R arc whose chord is 4e-13 mm', () => {
    const state = createGCodeInterpreterState('neutral', { initialPosition: { x: 0.0000000000006, y: 0 } });
    const block = interpretGCodeBlock(state, 'G2 X0.000000000001 Y0 R5', 1);

    expect(block.issues).toContainEqual(REFUSED_CHORD);
    expect(block.motion?.center).toBeUndefined();
  });

  it('resolves the centre of an R arc whose chord is 3e-12 mm', () => {
    const state = createGCodeInterpreterState();
    const block = interpretGCodeBlock(state, 'G2 X0.000000000003 Y0 R5', 1);

    expect(block.issues).toEqual([]);
    expect(block.motion).toMatchObject({ command: 'G2', start: { x: 0, y: 0 }, end: { x: 0.000000000003, y: 0 } });
    expect(Math.abs(block.motion?.center?.y ?? 0)).toBeCloseTo(5, 9);
  });
});
