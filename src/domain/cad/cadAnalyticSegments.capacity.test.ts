import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from './cadSchema';
import type { CadCurveFeature } from './cadDocument';
import { resolveCadCurveGeometry } from './cadCurve';
import { cadPathClosureTolerance } from './cadAnalyticSegments';

describe('large analytic chain closure precision', () => {
  it.each([0, 100_000_000])('accepts all 32769 exact Curve segments at world-coordinate scale %s', origin => {
    const feature: CadCurveFeature = { id: 'long_rail', name: 'Long rail', kind: 'curve', plane: 'XY', offset: 0, suppressed: false,
      segments: Array.from({ length: 32769 }, (_, index) => ({ kind: 'line', start: [origin + index, origin], end: [origin + index + 1, origin] })) };
    const source = JSON.stringify(feature);
    const document = parseCadDocument({ ...createCadDocument('Measured chain', 'measured_chain'), features: [feature] });
    const accepted = document.features[0];
    if (accepted.kind !== 'curve') throw new Error('Curve was not retained.');
    const geometry = resolveCadCurveGeometry(accepted, document.parameters);
    expect(geometry.segments).toHaveLength(32769);
    expect(geometry.start).toEqual([origin, origin]);
    expect(geometry.end).toEqual([origin + 32769, origin]);
    expect(geometry.length).toBe(32769);
    expect(JSON.stringify(accepted)).toBe(source);
  }, 30000);

  it('still rejects a closed Curve at far coordinates rather than treating endpoint count as clearance', () => {
    const origin = 100_000_000;
    const feature: CadCurveFeature = { id: 'closed', name: 'Closed chain', kind: 'curve', plane: 'XY', offset: 0, suppressed: false,
      segments: [{ kind: 'line', start: [origin, origin], end: [origin + 20, origin] },
        { kind: 'line', start: [origin + 20, origin], end: [origin + 20, origin + 20] },
        { kind: 'line', start: [origin + 20, origin + 20], end: [origin, origin + 20] },
        { kind: 'line', start: [origin, origin + 20], end: [origin, origin] }] };
    expect(() => parseCadDocument({ ...createCadDocument(), features: [feature] })).toThrow('Reference curves must stay open');
  });

  it('keeps the closure roundoff floor and non-finite propagation unchanged', () => {
    expect(cadPathClosureTolerance([])).toBe(1e-12);
    expect(cadPathClosureTolerance([{ x: 0, y: 0 }])).toBe(1e-12);
    expect(cadPathClosureTolerance([{ x: -100_000_000, y: 0 }])).toBe(8 * Number.EPSILON * 100_000_000);
    expect(cadPathClosureTolerance([{ x: Number.NaN, y: 0 }])).toBeNaN();
    expect(cadPathClosureTolerance([{ x: 0, y: Number.POSITIVE_INFINITY }])).toBe(Number.POSITIVE_INFINITY);
  });
});
