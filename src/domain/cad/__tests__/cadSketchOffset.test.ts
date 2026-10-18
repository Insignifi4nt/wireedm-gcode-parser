import { describe, expect, it } from 'vitest';
import type { CadProfile, CadSketchFeature } from '../cadDocument';
import { prepareCadSketchOffset, type CadSketchOffsetSource } from '../cadSketchOffset';
import { compileCadSketchGeometry } from '../compileCadSketchGeometry';
import { measureCadResolvedProfile } from '../cadMeasurements';
import { resolveCadProfile } from '../cadSketchGeometry';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';

function legacy(geometry: CadProfile): CadSketchFeature {
  return { id: 'sketch', kind: 'sketch', name: 'Source', plane: 'XY', offset: 0, suppressed: false,
    profiles: [{ id: 'outline', name: 'Outline', construction: false, geometry }] };
}
function rectangle() { return legacy({ kind: 'rectangle', x: ' 0 ', y: 0, width: ' width ', height: 20, cornerRadius: 0 }); }
function copiedArea(sketch: CadSketchFeature, prefix = 'copy') {
  const profile = compileCadSketchGeometry(sketch, { width: 40 }).profiles.find(profile => profile.graphSourceRefs?.some(ref => ref.entityId === `${prefix}_e0`));
  if (!profile) throw new Error('Missing copied contour.');
  return measureCadResolvedProfile(resolveCadProfile(profile.geometry, {}));
}
function graphSource(sketch: CadSketchFeature): CadSketchOffsetSource {
  const refs = compileCadSketchGeometry(sketch, {}).profiles[0]?.graphSourceRefs;
  if (!refs) throw new Error('Missing graph source cycle.');
  return { kind: 'graph-cycle', sourceRefs: refs };
}

describe('exact detached sketch offset', () => {
  it('creates an outward mitered rectangle with shared new joints and preserves every original source scalar', () => {
    const sketch = rectangle(), before = JSON.stringify(sketch);
    const result = prepareCadSketchOffset({ sketch, parameters: { width: 40, gap: 2 }, source: { kind: 'profile', profileId: 'outline' }, distance: ' gap ', idPrefix: 'copy' });
    expect(result.distanceMm).toBe(2); expect(result.sourceSegments).toHaveLength(4); expect(result.resultSegments).toHaveLength(4);
    expect(copiedArea(result.sketch)).toMatchObject({ areaMm2: 1056, perimeterMm: 136, boundsMm: { minX: -2, minY: -2, maxX: 42, maxY: 22 } });
    expect(result.sketch.graph?.points.map(point => point.id)).toEqual(['copy_p0', 'copy_p1', 'copy_p2', 'copy_p3']);
    expect(result.sketch.graph?.entities).toEqual([0, 1, 2, 3].map(index => ({ id: `copy_e${index}`, kind: 'line', construction: false,
      startPointId: `copy_p${index}`, endPointId: `copy_p${(index + 1) % 4}` })));
    expect(result.sketch.graph?.relations).toEqual([]); expect(result.sketch.profiles).toEqual(sketch.profiles);
    expect(JSON.stringify(sketch)).toBe(before); expect(Object.isFrozen(result.sketch.graph)).toBe(true);
  });

  it('offsets inward and circles without saving a distance association or changing exact source expressions', () => {
    const inner = prepareCadSketchOffset({ sketch: rectangle(), parameters: { width: 40 }, source: { kind: 'profile', profileId: 'outline' }, distance: -2, idPrefix: 'copy' });
    expect(copiedArea(inner.sketch)).toMatchObject({ areaMm2: 576, perimeterMm: 104, boundsMm: { minX: 2, minY: 2, maxX: 38, maxY: 18 } });
    const sketch = legacy({ kind: 'circle', x: ' 3 ', y: 4, radius: ' boreRadius ' }), before = JSON.stringify(sketch);
    const circle = prepareCadSketchOffset({ sketch, parameters: { boreRadius: 10, gap: 2 }, source: { kind: 'profile', profileId: 'outline' }, distance: ' gap ', idPrefix: 'copy' });
    expect(circle.sketch.graph).toEqual(parseCadSketchGraph({ points: [{ id: 'copy_c0', position: [3, 4] }],
      entities: [{ id: 'copy_e0', kind: 'circle', construction: false, centerPointId: 'copy_c0', radius: 12 }], relations: [] }));
    expect(circle.resultSegments).toEqual([{ kind: 'arc', center: [3, 4], radius: 12, startAngle: 0, sweep: 360 }]);
    expect(circle.sketch.profiles[0].geometry).toEqual(sketch.profiles[0].geometry);
    expect(JSON.stringify(circle.sketch.graph)).not.toContain('gap'); expect(JSON.stringify(sketch)).toBe(before);
  });

  it('constructs exact smooth rotated slot and rounded rectangle copies as free analytic graph chains', () => {
    const slot = legacy({ kind: 'slot', x: ' 11 ', y: -7, length: 30, width: 10, angle: 30 });
    const rounded = legacy({ kind: 'rectangle', x: 0, y: 0, width: 40, height: 20, cornerRadius: 4 });
    for (const sketch of [slot, rounded]) {
      const before = JSON.stringify(sketch), result = prepareCadSketchOffset({ sketch, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: 2, idPrefix: 'copy' });
      const area = copiedArea(result.sketch);
      expect(area.areaMm2).toBeCloseTo(sketch === slot ? 280 + 49 * Math.PI : 1056 - (4 - Math.PI) * 36, 9);
      expect(result.resultSegments).toHaveLength(sketch === slot ? 4 : 8);
      if (sketch === slot) expect(result.sourceSegments.filter(segment => segment.kind === 'arc').map(segment => segment.sweep)).toEqual([180, 180]);
      expect(result.sketch.graph?.entities.filter(entity => entity.kind === 'arc')).toHaveLength(sketch === slot ? 2 : 4);
      expect(result.sketch.graph && checkCadSketchGraph(result.sketch.graph, {})).toEqual([]);
      expect(result.sketch.graph?.relations).toEqual([]);
      const entities = result.sketch.graph?.entities ?? [];
      entities.forEach((entity, index) => {
        if (entity.kind === 'circle') throw new Error('Expected a chain.');
        expect(entity.startPointId).toBe(`copy_p${index}`); expect(entity.endPointId).toBe(`copy_p${(index + 1) % entities.length}`);
        if (entity.kind === 'arc') expect(entity.centerPointId).toBe(`copy_c${index}`);
      });
      expect(JSON.stringify(sketch)).toBe(before); expect(Object.isFrozen(sketch)).toBe(false);
    }
  });

  it('offsets the detached graph copy of the rotated slot again without borrowing the original primitive semantics', () => {
    const slot = legacy({ kind: 'slot', x: ' 11 ', y: -7, length: 30, width: 10, angle: 30 });
    const first = prepareCadSketchOffset({ sketch: slot, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: 2, idPrefix: 'copy' });
    const sourceRefs = compileCadSketchGeometry(first.sketch, {}).profiles.find(profile => profile.graphSourceRefs?.some(ref => ref.entityId === 'copy_e0'))?.graphSourceRefs;
    if (!sourceRefs) throw new Error('Missing detached graph source.');
    const before = JSON.stringify(first.sketch), next = prepareCadSketchOffset({ sketch: first.sketch, parameters: {}, source: { kind: 'graph-cycle', sourceRefs }, distance: 1, idPrefix: 'follow' });
    expect(copiedArea(next.sketch, 'follow').areaMm2).toBeCloseTo(320 + 64 * Math.PI, 9);
    expect(next.sketch.graph?.entities.slice(0, 4)).toEqual(first.sketch.graph?.entities);
    expect(next.sketch.graph?.relations).toEqual([]); expect(JSON.stringify(first.sketch)).toBe(before);
  });

  it('uses a current exact graph cycle and stable prefix names independent of array order or source winding', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [40, 0] },
      { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }], entities: [
      { id: 'ab', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' },
      { id: 'bc', kind: 'line', construction: false, startPointId: 'c', endPointId: 'b' },
      { id: 'cd', kind: 'line', construction: false, startPointId: 'd', endPointId: 'c' },
      { id: 'da', kind: 'line', construction: false, startPointId: 'a', endPointId: 'd' }
    ], relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['b', 'a'] }] });
    const sketch = { ...rectangle(), profiles: [], graph }, before = JSON.stringify(sketch), source = graphSource(sketch);
    const result = prepareCadSketchOffset({ sketch, parameters: {}, source, distance: 2, idPrefix: 'copy' });
    expect(copiedArea(result.sketch).areaMm2).toBe(1056);
    expect(result.sketch.graph?.points.slice(0, 4)).toEqual(graph.points);
    expect(result.sketch.graph?.entities.slice(0, 4)).toEqual(graph.entities); expect(result.sketch.graph?.relations).toEqual(graph.relations);
    const reordered = prepareCadSketchOffset({ sketch: { ...sketch, graph: { ...graph, points: [...graph.points].reverse(), entities: [...graph.entities].reverse() } },
      parameters: {}, source, distance: 2, idPrefix: 'copy' });
    expect(reordered.resultSegments).toEqual(result.resultSegments);
    expect(reordered.sketch.graph?.entities.slice(4)).toEqual(result.sketch.graph?.entities.slice(4));
    if (source.kind !== 'graph-cycle') throw new Error('Expected a witnessed graph loop.');
    expect(() => prepareCadSketchOffset({ sketch, parameters: {}, source: { ...source, sourceRefs: source.sourceRefs.slice(1) }, distance: 2, idPrefix: 'copy' })).toThrow('changed');
    expect(JSON.stringify(sketch)).toBe(before);
  });

  it('preserves major circular coverage and offsets a concave clockwise support in the correct radial direction', () => {
    const full = legacy({ kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: -270 },
      { kind: 'arc', center: [0, 0], radius: 10, startAngle: -270, sweep: -90 }] });
    const circle = prepareCadSketchOffset({ sketch: full, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: 2, idPrefix: 'copy' });
    expect(copiedArea(circle.sketch).areaMm2).toBeCloseTo(144 * Math.PI, 10);
    expect(circle.resultSegments.filter(segment => segment.kind === 'arc').map(segment => Math.abs(segment.sweep)).sort((a, b) => a - b)).toEqual([90, 270]);
    const vertices = [[-10, 0], [10, 0], [10, 20], [5, 20], [5, 10], [-5, 10], [-5, 20], [-10, 20]];
    const notch = legacy({ kind: 'path', segments: vertices.map((start, index) => index === 4
      ? { kind: 'arc', center: [0, 10], radius: 5, startAngle: 0, sweep: -180 }
      : { kind: 'line', start: [start[0], start[1]], end: [vertices[(index + 1) % vertices.length][0], vertices[(index + 1) % vertices.length][1]] }) });
    const result = prepareCadSketchOffset({ sketch: notch, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: 2, idPrefix: 'copy' });
    expect(result.resultSegments.find(segment => segment.kind === 'arc')).toMatchObject({ radius: 3, sweep: -180 });
    expect(copiedArea(result.sketch).areaMm2).toBeCloseTo(504 - 4.5 * Math.PI, 10);
    expect(() => prepareCadSketchOffset({ sketch: notch, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: -3, idPrefix: 'copy' })).toThrow();
  });

  it('rejects a near-half-turn legacy arc when endpoint graph encoding would erase its major/minor branch', () => {
    for (const first of [180.000000000001, 179.999999999999]) {
      const sketch = legacy({ kind: 'path', segments: [
        { kind: 'arc', center: [10000, 10000], radius: 10, startAngle: 0, sweep: first },
        { kind: 'arc', center: [10000, 10000], radius: 10, startAngle: first, sweep: 360 - first }
      ] }), before = JSON.stringify(sketch);
      expect(() => prepareCadSketchOffset({ sketch, parameters: {}, source: { kind: 'profile', profileId: 'outline' }, distance: 1, idPrefix: 'copy' })).toThrow('branch');
      expect(JSON.stringify(sketch)).toBe(before);
    }
  });

  it('treats zero as the same source and rejects collapse, sharp curved joints and output contacts without source changes', () => {
    const sketch = rectangle(), before = JSON.stringify(sketch), request = { sketch, parameters: { width: 40 }, source: { kind: 'profile', profileId: 'outline' } as const, idPrefix: 'copy' };
    const zero = prepareCadSketchOffset({ ...request, distance: '0 * width' });
    expect(zero.sketch).toBe(sketch); expect(zero.sketch.graph).toBeUndefined(); expect(zero.resultSegments).toEqual(zero.sourceSegments);
    for (const distance of [-10, -11, 1e-30]) expect(() => prepareCadSketchOffset({ ...request, distance })).toThrow();
    const curved = legacy({ kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: 180 },
      { kind: 'line', start: [-10, 0], end: [10, 0] }] });
    expect(() => prepareCadSketchOffset({ ...request, sketch: curved, distance: 2 })).toThrow('smooth');
    expect(() => prepareCadSketchOffset({ ...request, sketch: legacy({ kind: 'circle', x: 0, y: 0, radius: 10 }), distance: -10 })).toThrow('collapses');
    const contact = { ...sketch, profiles: [...sketch.profiles, { id: 'neighbor', name: 'Neighbor', construction: false,
      geometry: { kind: 'circle' as const, x: 45, y: 10, radius: 2 } }] };
    expect(() => prepareCadSketchOffset({ ...request, sketch: contact, distance: 3 })).toThrow('touch');
    expect(prepareCadSketchOffset({ ...request, sketch: contact, distance: 2 }).sketch.graph?.entities).toHaveLength(4);
    expect(JSON.stringify(sketch)).toBe(before); expect(Object.isFrozen(sketch)).toBe(false);
  });

  it('validates prefix length and the complete existing graph/profile namespace without retrying names or borrowing points', () => {
    const sketch = rectangle(), request = { sketch, parameters: { width: 40 }, source: { kind: 'profile', profileId: 'outline' } as const, distance: 2 };
    for (const idPrefix of ['', 'bad prefix', 'x'.repeat(65)]) expect(() => prepareCadSketchOffset({ ...request, idPrefix })).toThrow('64');
    expect(prepareCadSketchOffset({ ...request, idPrefix: 'x'.repeat(64) }).sketch.graph?.entities[0].id).toBe(`${'x'.repeat(64)}_e0`);
    const occupied = { ...sketch, graph: parseCadSketchGraph({ points: [{ id: 'copy_p0', position: [90, 90] }], entities: [], relations: [] }) };
    expect(() => prepareCadSketchOffset({ ...request, sketch: occupied, idPrefix: 'copy' })).toThrow('Duplicate');
    const profiles = { ...sketch, profiles: [...sketch.profiles, { id: 'copy_e0', name: 'Reserved', construction: true,
      geometry: { kind: 'circle' as const, x: 90, y: 90, radius: 1 } }] };
    expect(() => prepareCadSketchOffset({ ...request, sketch: profiles, idPrefix: 'copy' })).toThrow('legacy profile');
    const created = prepareCadSketchOffset({ ...request, idPrefix: 'copy' });
    expect(() => prepareCadSketchOffset({ ...request, sketch: created.sketch, idPrefix: 'copy' })).toThrow('Duplicate');
  });
});
