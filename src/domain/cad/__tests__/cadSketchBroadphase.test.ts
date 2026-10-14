import { describe, expect, it } from 'vitest';
import { CadError } from '../cadError';
import { cadBoundaryCandidatePairs, cadBoundariesIntersect, cadProfileToEntities, validateCadSketchGeometry, type CadAnalyticBoundary, type ResolvedCadProfile } from '../cadSketchGeometry';
import type { CadSketchFeature } from '../cadDocument';
import { DEFAULT_CAD_GEAR } from '../cadGear';
import { resolveConfiguredCadGear, resolveGeneratedCadGear } from '../cadGearGenerated';
import { cadOrderedCurveEntities } from '../cadAnalyticSegments';

const intersectingPairs = (edges: readonly CadAnalyticBoundary[], pairs: Iterable<readonly [number, number]>) => [...pairs]
  .filter(([i, j]) => cadBoundariesIntersect(edges[i], edges[j])).map(([i, j]) => `${i}:${j}`).sort();
function* everyPair(count: number): Generator<readonly [number, number]> {
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) yield [i, j];
}
const analytic = (profiles: readonly ResolvedCadProfile[]): CadAnalyticBoundary[] => profiles.flatMap(profile => cadProfileToEntities(profile))
  .filter((entity): entity is CadAnalyticBoundary => entity.type === 'line' || entity.type === 'arc' || entity.type === 'circle');
function randomGenerator() {
  let seed = 1729;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
}
describe('CAD analytic validation broadphase', () => {
  it.each([false, true])('recognizes a full-turn arc without optional sweep metadata, clockwise=%s', clockwise => {
    for (const endAngle of [0, (clockwise ? -1 : 1) * 2 * Math.PI]) {
      const circleArc: CadAnalyticBoundary = { type: 'arc', layer: null, center: { x: 0, y: 0 }, radius: 5,
        startAngle: 0, endAngle, clockwise, start: { x: 5, y: 0 }, end: { x: 5, y: 0 } };
      const tangent: CadAnalyticBoundary = { type: 'line', layer: null, start: { x: -5, y: -2 }, end: { x: -5, y: 2 } };
      expect(cadBoundariesIntersect(circleArc, tangent)).toBe(true);
      expect([...cadBoundaryCandidatePairs([circleArc, tangent])]).toEqual([[0, 1]]);
    }
  });
  it('keeps a practical 50-tooth gear sparse instead of treating every tooth arc as its entire support circle', () => {
    const radius = resolveGeneratedCadGear(DEFAULT_CAD_GEAR, {}).cutterTipRadius;
    const segments = resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, teeth: 50, cutterTipRadius: radius }, {}).segments;
    const edges = analytic([{ kind: 'path', segments }]);
    expect(edges).toHaveLength(1900);
    expect([...cadBoundaryCandidatePairs(edges)].length).toBeLessThan(edges.length * 8);
    const sketch: CadSketchFeature = { id: 'gear', kind: 'sketch', name: 'Gear', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'boundary', name: 'Gear', construction: false, geometry: { kind: 'path', segments } }] };
    expect(() => validateCadSketchGeometry(sketch, {})).not.toThrow();
  });
  it.each([0, 999999900])('retains all exact contacts for wrapped, clockwise and major arcs at origin %s', offset => {
    const arcs = cadOrderedCurveEntities([
      { kind: 'arc', center: [offset, offset], radius: 10, startAngle: 350, sweep: 30 },
      { kind: 'arc', center: [offset, offset], radius: 10, startAngle: 20, sweep: -30 },
      { kind: 'arc', center: [offset, offset], radius: 10, startAngle: 120, sweep: 270 },
      { kind: 'arc', center: [offset, offset], radius: 10, startAngle: 20, sweep: -270 },
      { kind: 'arc', center: [offset + 5, offset], radius: 5, startAngle: 300, sweep: 120 }
    ]);
    const lines: CadAnalyticBoundary[] = [
      { type: 'line', layer: null, start: { x: offset + 10 + 5e-8, y: offset - 2 }, end: { x: offset + 10 + 5e-8, y: offset + 2 } },
      { type: 'line', layer: null, start: { x: offset - 15, y: offset + 10 }, end: { x: offset + 15, y: offset + 10 } },
      { type: 'line', layer: null, start: { x: offset - 15, y: offset }, end: { x: offset + 15, y: offset } }
    ];
    const edges = [...arcs, ...lines];
    expect(intersectingPairs(edges, cadBoundaryCandidatePairs(edges))).toEqual(intersectingPairs(edges, everyPair(edges.length)));
  });
  it.each([0, 1e6, 999999900])('matches exhaustive exact predicates for mixed geometry around offset %s', offset => {
    const random = randomGenerator();
    const profiles: ResolvedCadProfile[] = [];
    for (let index = 0; index < 24; index++) {
      const x = offset + random() * 40; const y = offset + random() * 40;
      switch (index % 4) {
        case 0: profiles.push({ kind: 'circle', x, y, radius: 1 + 7 * random() }); break;
        case 1: profiles.push({ kind: 'rectangle', x, y, width: 3 + 10 * random(), height: 3 + 10 * random(), cornerRadius: 1 }); break;
        case 2: profiles.push({ kind: 'slot', x, y, length: 12, width: 4, angle: random() * 360 }); break;
        case 3: profiles.push({ kind: 'polygon', points: [[x, y], [x + 8, y + 2], [x + 5, y + 9], [x - 3, y + 4]] }); break;
      }
    }
    const edges = analytic(profiles);
    expect(intersectingPairs(edges, cadBoundaryCandidatePairs(edges))).toEqual(intersectingPairs(edges, everyPair(edges.length)));
  });

  it('keeps near-tolerance contacts, collinear overlap, coincident arcs and tiny large-coordinate gaps', () => {
    const line = (x1: number, y1: number, x2: number, y2: number): CadAnalyticBoundary => ({ type: 'line', layer: null, start: { x: x1, y: y1 }, end: { x: x2, y: y2 } });
    const edges: CadAnalyticBoundary[] = [
      line(0, 0, 10, 0), line(10 + 5e-8, 0, 15, 0), line(4, 0, 12, 0), line(0, 5e-8, 10, 5e-8),
      line(1e9 - 20, 1e9 - 20, 1e9 - 10, 1e9 - 20), line(1e9 - 10, 1e9 - 20, 1e9 - 5, 1e9 - 20),
      ...analytic([{ kind: 'circle', x: 20, y: 0, radius: 5 }, { kind: 'circle', x: 30 + 5e-8, y: 0, radius: 5 },
        { kind: 'rectangle', x: 18, y: -2, width: 4, height: 4, cornerRadius: 2 }, { kind: 'rectangle', x: 18, y: -2, width: 4, height: 4, cornerRadius: 2 }])
    ];
    expect(intersectingPairs(edges, cadBoundaryCandidatePairs(edges))).toEqual(intersectingPairs(edges, everyPair(edges.length)));
  });

  it('validates a realistic maximum 8192-edge sketch with a bounded sparse candidate set', () => {
    const sketch: CadSketchFeature = { id: 'large', name: 'Four detailed profiles', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
      profiles: Array.from({ length: 4 }, (_, k) => ({ id: `profile_${k}`, name: `Contour ${k}`, role: 'outer', construction: false,
        geometry: { kind: 'polygon', points: Array.from({ length: 2048 }, (_, i) => [k * 100 + 20 * Math.cos(i / 2048 * 2 * Math.PI), 20 * Math.sin(i / 2048 * 2 * Math.PI)] satisfies readonly [number, number]) } })) };
    const profiles = sketch.profiles.flatMap(profile => profile.geometry.kind === 'polygon' ? [{ kind: 'polygon', points: profile.geometry.points.map(([x, y]) => {
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('The benchmark fixture must contain numeric points.');
      return [x, y] satisfies readonly [number, number];
    }) } satisfies ResolvedCadProfile] : []);
    const edges = analytic(profiles);
    expect(edges).toHaveLength(8192);
    const candidates = [...cadBoundaryCandidatePairs(edges)];
    expect(candidates.length).toBeLessThan(edges.length * 16);
    expect(new Set(candidates.map(pair => pair.join(':'))).size).toBe(candidates.length);
    expect(() => validateCadSketchGeometry(sketch, {})).not.toThrow();
    const first = sketch.profiles[0]; const second = sketch.profiles[1];
    if (first.geometry.kind !== 'polygon' || second.geometry.kind !== 'polygon') throw new Error('Expected polygon fixture.');
    const crossing: CadSketchFeature = { ...sketch, profiles: [first, { ...second, geometry: { ...second.geometry, points: second.geometry.points.map(([x, y]) => [typeof x === 'number' ? x - 75 : x, y]) } }] };
    expect(() => validateCadSketchGeometry(crossing, {})).toThrow(CadError);
    try { validateCadSketchGeometry(crossing, {}); } catch (error) { expect(error).toMatchObject({ code: 'profile-intersection' }); }
  });
});
