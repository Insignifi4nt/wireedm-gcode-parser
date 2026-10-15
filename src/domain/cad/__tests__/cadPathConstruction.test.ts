import { describe, expect, it } from 'vitest';
import { CadError } from '../cadError';
import { cadAnalyticPathMetrics, resolveCadProfile } from '../cadSketchGeometry';
import { createCadPathProfile, createCadThreePointArc, type CadConstructionPoint, type CadPathConstructionStep } from '../cadPathConstruction';

describe('exact three-point arc construction', () => {
  it.each([
    { end: [0, 5], through: [3, 4], sweep: 90 },
    { end: [0, -5], through: [3, -4], sweep: -90 },
    { end: [0, 5], through: [-5, 0], sweep: -270 },
    { end: [0, -5], through: [-5, 0], sweep: 270 }
  ] satisfies { end: CadConstructionPoint; through: CadConstructionPoint; sweep: number }[])('constructs the signed $sweep degree curve through the third point', ({ end, through, sweep }) => {
    const arc = createCadThreePointArc({ start: [5, 0], end, through });
    expect(arc.kind).toBe('arc'); expect(arc.center[0]).toBeCloseTo(0, 12); expect(arc.center[1]).toBeCloseTo(0, 12);
    expect(arc.radius).toBeCloseTo(5, 12); expect(arc.sweep).toBeCloseTo(sweep, 10);
  });
  it('uses translated coordinates for a small circle near the maximum world coordinate', () => {
    const x = 999999990;
    const arc = createCadThreePointArc({ start: [x, x], end: [x + 2, x], through: [x + 1, x + 1] });
    expect(arc.center).toEqual([x + 1, x]); expect(arc.radius).toBe(1); expect(arc.sweep).toBeCloseTo(-180, 10);
  });
  it('rejects duplicate and collinear inputs without substituting a line', () => {
    for (const input of [
      { start: [0, 0], end: [0, 0], through: [0, 1] },
      { start: [0, 0], end: [1, 0], through: [1, 0] },
      { start: [0, 0], end: [2, 2], through: [1, 1] }
    ] satisfies { start: CadConstructionPoint; end: CadConstructionPoint; through: CadConstructionPoint }[]) expect(() => createCadThreePointArc(input)).toThrow(CadError);
  });
  it('rejects an unstable shallow arc when its saved encoding cannot reproduce its actual joins', () => {
    expect(() => createCadThreePointArc({ start: [0, 0], end: [2, 0], through: [1, 1e-6] })).toThrow(CadError);
    const arc = createCadThreePointArc({ start: [0, 0], end: [2, 0], through: [1, .01] });
    expect(arc.radius).toBeCloseTo(50.005, 10);
  });
  it('rejects uncertain orientation even when the computed radius would be within the saved limits', () => {
    expect(() => createCadThreePointArc({ start: [0, 0], end: [2e-6, 0], through: [1e-6, 1e-13] })).toThrow('orientation is numerically uncertain');
    const x = 999999990;
    expect(() => createCadThreePointArc({ start: [x, x], end: [x + 2, x], through: [x + 1, x + 1e-6] })).toThrow('orientation is numerically uncertain');
  });
  it('rejects out-of-range or executable point values and never reads accessors', () => {
    let reads = 0;
    const input = { end: [1, 0], through: [0, 1], get start() { reads++; return [0, 0]; } };
    expect(() => createCadThreePointArc(input)).toThrow(CadError); expect(reads).toBe(0);
    for (const start of [[Infinity, 0], [1e9 + 1, 0], ['width', 0]]) expect(() => createCadThreePointArc({ start, end: [1, 0], through: [0, 1] })).toThrow(CadError);
  });
});

describe('closed mixed line/arc path construction', () => {
  it('closes a semicircle with one explicit straight edge and preserves its exact area', () => {
    const profile = createCadPathProfile([5, 0], [{ kind: 'arc', end: [-5, 0], through: [0, 5] }]);
    expect(profile.segments).toHaveLength(2); expect(profile.segments[1]).toEqual({ kind: 'line', start: [-5, 0], end: [5, 0] });
    const resolved = resolveCadProfile(profile, {}); if (resolved.kind !== 'path') throw new Error('Expected path');
    expect(Math.abs(cadAnalyticPathMetrics(resolved).signedArea)).toBeCloseTo(25 * Math.PI / 2, 10);
    expect(Object.isFrozen(profile.segments)).toBe(true);
  });
  it('does not append a duplicate closure when an authored arc ends exactly at the start', () => {
    const steps: readonly CadPathConstructionStep[] = [{ kind: 'line', end: [5, 0] }, { kind: 'arc', end: [-5, 0], through: [0, 5] }];
    const original = JSON.stringify(steps); const profile = createCadPathProfile([-5, 0], steps);
    expect(profile.segments).toHaveLength(2); expect(JSON.stringify(steps)).toBe(original);
  });
  it('does not silently drop a different authored endpoint to repair a tiny closing gap', () => {
    expect(() => createCadPathProfile([0, 0], [{ kind: 'line', end: [5, 0] }, { kind: 'line', end: [0, 5] },
      { kind: 'line', end: [0, 1e-9] }])).toThrow('longer than 1e-7');
  });
  it('joins two opposite semicircles into a full circle without duplicate closure or overlap', () => {
    const profile = createCadPathProfile([5, 0], [{ kind: 'arc', end: [-5, 0], through: [0, 5] },
      { kind: 'arc', end: [5, 0], through: [0, -5] }]);
    expect(profile.segments).toHaveLength(2);
    const resolved = resolveCadProfile(profile, {}); if (resolved.kind !== 'path') throw new Error('Expected path');
    expect(cadAnalyticPathMetrics(resolved).signedArea).toBeCloseTo(25 * Math.PI, 10);
  });
  it('rejects open, zero-area, repeated and self-crossing construction while retaining input data', () => {
    expect(() => createCadPathProfile([0, 0], [])).toThrow(CadError);
    expect(() => createCadPathProfile([0, 0], [{ kind: 'line', end: [0, 0] }])).toThrow(CadError);
    expect(() => createCadPathProfile([0, 0], [{ kind: 'line', end: [5, 0] }])).toThrow(CadError);
    const steps: readonly CadPathConstructionStep[] = [{ kind: 'line', end: [5, 5] }, { kind: 'line', end: [0, 5] }, { kind: 'line', end: [5, 0] }];
    const original = JSON.stringify(steps); expect(() => createCadPathProfile([0, 0], steps)).toThrow(CadError); expect(JSON.stringify(steps)).toBe(original);
  });
  it('counts the closing edge within the saved 2048-edge bound', () => {
    const points = Array.from({ length: 2048 }, (_, index): CadConstructionPoint => [10 * Math.cos(index * 2 * Math.PI / 2048), 10 * Math.sin(index * 2 * Math.PI / 2048)]);
    const steps = points.slice(1).map((end): CadPathConstructionStep => ({ kind: 'line', end }));
    expect(createCadPathProfile(points[0], steps).segments).toHaveLength(2048);
    const tooMany = [...steps, { kind: 'line', end: [11, 0] } satisfies CadPathConstructionStep];
    expect(() => createCadPathProfile(points[0], tooMany)).toThrow(CadError);
  });
});
