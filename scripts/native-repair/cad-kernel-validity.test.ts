// @vitest-environment node
import { beforeAll, expect, it, vi } from 'vitest';
import initializeCandidate from './candidate-factory';
import { getOC, makeBox, measureVolume, setOC } from 'replicad';
import { cadKernelDisposeShape, cadKernelIsValid } from '../../src/features/cad/kernel/cadKernelShapes';

beforeAll(async () => { setOC(await initializeCandidate()); }, 60_000);

it('uses the repaired full native validity lifecycle without resetting its result onto unrelated geometry', () => {
  const box = makeBox([0, 0, 0], [10, 10, 10]), oc = getOC();
  // The old destructor workaround calls Init(emptyCompound) in finally.
  // A real destructor must need neither a retained empty shape nor a reset.
  const reset = vi.spyOn(oc.BRepCheck_Analyzer.prototype, 'Init').mockImplementation(() => {
    throw new Error('Validity must dispose its own results without a neutral-shape reset.');
  });
  const validation = vi.spyOn(oc.BRepCheck_Analyzer.prototype, 'IsValid');
  try {
    expect(cadKernelIsValid(box)).toBe(true);
    expect(validation).toHaveBeenCalledOnce();
    expect(measureVolume(box)).toBeCloseTo(1000, 10);
  } finally { reset.mockRestore(); validation.mockRestore(); cadKernelDisposeShape(box); }
});
