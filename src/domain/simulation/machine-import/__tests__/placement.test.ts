import { describe, expect, it } from 'vitest';
import { placeMachineModel, transformMachinePoint } from '../placement';
import { triangleModel } from './machineTestModel';

describe('machine placement', () => {
  it('rotates about the authored origin then translates without mutating source geometry', () => {
    const model = triangleModel();
    const placement = { translationMm: [10, 20, 30] as const, rotationZDegrees: 90 };
    const placed = placeMachineModel(model, placement);
    if (!placed.ok) throw new Error(placed.error.message);
    expect(transformMachinePoint([5, 0, 10], placement)).toEqual([10, 25, 40]);
    expect(placed.model.bounds).toEqual({ min: [9, 25, 30], max: [11, 25, 40] });
    expect(placed.model.meshes[0].normals?.[0]).toBeCloseTo(0);
    expect(placed.model.meshes[0].normals?.[1]).toBeCloseTo(1);
    expect(model.bounds).toEqual({ min: [5, -1, 0], max: [5, 1, 10] });
    expect(model.meshes[0].positions[0]).toBe(5);
  });
  it('rejects nonfinite or excessive placements without changing source buffers', () => {
    const model = triangleModel();
    expect(placeMachineModel(model, { translationMm: [Infinity, 0, 0], rotationZDegrees: 0 })).toMatchObject({ ok: false });
    expect(placeMachineModel(model, { translationMm: [10_000_000, 0, 0], rotationZDegrees: 0 })).toMatchObject({ ok: false });
    expect(placeMachineModel(model, { translationMm: [0, 0, 0], rotationZDegrees: NaN })).toMatchObject({ ok: false });
  });
});
