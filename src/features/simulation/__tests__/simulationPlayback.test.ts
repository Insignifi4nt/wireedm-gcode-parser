import { describe, expect, it } from 'vitest';

import { advanceSimulationProgress } from '../simulationPlayback';

describe('advanceSimulationProgress', () => {
  it('keeps the cursor still while visual playback is paused', () => {
    expect(advanceSimulationProgress(0.42, 1, 0, 120)).toBe(0.42);
  });

  it('stops at the end instead of wrapping to the beginning', () => {
    expect(advanceSimulationProgress(0.96, 1, 1, 100)).toBe(1);
    expect(advanceSimulationProgress(1, 1, 1, 100)).toBe(1);
  });

  it('returns the start for a timeline with no distance', () => {
    expect(advanceSimulationProgress(0.5, 1, 1, 0)).toBe(0);
  });

  it('scales the 25 mm/s visual-only base rate by the playback multiplier', () => {
    expect(advanceSimulationProgress(0.25, 2, 1, 200)).toBeCloseTo(0.5);
    expect(advanceSimulationProgress(0.25, 2, 2, 200)).toBeCloseTo(0.75);
  });
});
