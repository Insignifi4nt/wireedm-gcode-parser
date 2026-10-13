import { describe, expect, it } from 'vitest';
import type { CadDocument, CadProfile } from '../cadDocument';
import { createCadDocument, createCadSketchProfile, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { measureCadSketch } from '../cadMeasurements';
import { cadProfileToEntities, resolveCadProfile } from '../cadSketchGeometry';
import { CadError } from '../cadError';

function document(geometry: CadProfile, parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Analytic path', 'cad_path'), parameters,
    features: [{ kind: 'sketch', id: 'path', name: 'Path', suppressed: false, plane: 'XY', offset: 0,
      profiles: [createCadSketchProfile({ id: 'boundary', geometry })] }] });
}

describe('closed analytic CAD paths', () => {
  it.each([-360, 360])('preserves an exact full circle with sweep %s', sweep => {
    const geometry: CadProfile = { kind: 'path', segments: [{ kind: 'arc', center: [3, 4], radius: 5, startAngle: 37, sweep }] };
    expect(measureCadSketch(document(geometry), 'path')).toMatchObject({ materialAreaMm2: 25 * Math.PI, boundaryLengthMm: 10 * Math.PI });
    expect(cadProfileToEntities(resolveCadProfile(geometry, {}))).toMatchObject([{ type: 'circle', center: { x: 3, y: 4 }, radius: 5 }]);
  });
  it('evaluates path expressions together and rejects invalid parameter edits atomically', () => {
    const original = document({ kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 'r', startAngle: 0, sweep: 180 },
      { kind: 'arc', center: [0, 0], radius: 'r', startAngle: 180, sweep: 180 }
    ] }, { r: 3 });
    const edited = applyCadEdits(original, [{ kind: 'set-parameter', name: 'r', value: 5 }]);
    expect(measureCadSketch(edited, 'path').materialAreaMm2).toBeCloseTo(25 * Math.PI, 12);
    expect(() => applyCadEdits(original, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-parameter', name: 'r', value: -1 }])).toThrow(CadError);
    expect(original.name).toBe('Analytic path'); expect(original.parameters.r).toBe(3);
  });
  it('rejects adjacent arcs crossing another endpoint in a three-edge contour', () => {
    expect(() => document({ kind: 'path', segments: [
      { kind: 'line', start: [-2, 0], end: [2, 0] },
      { kind: 'arc', center: [0, 0], radius: 2, startAngle: 0, sweep: 270 },
      { kind: 'line', start: [0, -2], end: [-2, 0] }
    ] })).toThrow('intersects itself');
  });
  it('allows two curved sides to share both intended endpoints without treating the region as overlapping', () => {
    const angle = Math.atan2(4, 3) * 180 / Math.PI;
    const lens: CadProfile = { kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 5, startAngle: angle, sweep: 180 - 2 * angle },
      { kind: 'arc', center: [0, 8], radius: 5, startAngle: 180 + angle, sweep: 180 - 2 * angle }
    ] };
    expect(measureCadSketch(document(lens), 'path').materialAreaMm2).toBeCloseTo(50 * Math.acos(4 / 5) - 24, 12);
  });
  it('preserves a small area at far world coordinates without absolute-coordinate cancellation', () => {
    const a = 999_999_990;
    const geometry: CadProfile = { kind: 'path', segments: [
      { kind: 'line', start: [a, a], end: [a + 1, a] }, { kind: 'line', start: [a + 1, a], end: [a + 1, a + 1] },
      { kind: 'line', start: [a + 1, a + 1], end: [a, a + 1] }, { kind: 'line', start: [a, a + 1], end: [a, a] }
    ] };
    expect(measureCadSketch(document(geometry), 'path')).toMatchObject({ materialAreaMm2: 1, boundaryLengthMm: 4 });
  });
  it.each([0, 361, -361])('rejects an invalid arc sweep %s', sweep => {
    expect(() => document({ kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 2, startAngle: 0, sweep }] })).toThrow(CadError);
  });
  it('rejects physical gaps and segment schema fields that imply approximate geometry', () => {
    expect(() => document({ kind: 'path', segments: [
      { kind: 'line', start: [0, 0], end: [10, 0] }, { kind: 'line', start: [10, 0], end: [0, 10] },
      { kind: 'line', start: [0, 10], end: [0, 1e-8] }
    ] })).toThrow('continuous and closed');
    const base = document({ kind: 'circle', x: 0, y: 0, radius: 2 });
    expect(() => parseCadDocument({ ...base, features: [{ ...base.features[0], profiles: [{ id: 'boundary', name: 'Boundary', construction: false,
      geometry: { kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 2, startAngle: 0, sweep: 360, tolerance: 0.1 }] } }] }] })).toThrow(CadError);
  });
});
