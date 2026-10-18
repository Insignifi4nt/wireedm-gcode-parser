// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import { prepareCadSketchGeometrySnaps, type CadSketchProfilePositionSnapSource } from './cadSketchGeometrySnaps';

describe('prepared sketch geometry snaps', () => {
  it('retains profile position intent beside exact graph points and only suppresses graph midpoints', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'owned', position: [10, 0] }],
      entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] });
    const prepared = prepareCadSketchGraphInteraction(graph, {}), profileSources: readonly CadSketchProfilePositionSnapSource[] = [
      { profileId: 'second', location: { kind: 'center' }, point: [10, 0] },
      { profileId: 'first', location: { kind: 'midpoint', boundaryIndex: 4 }, point: [10, 0] }
    ];
    for (const sources of [profileSources, [...profileSources].reverse()]) {
      const snap = prepareCadSketchGeometrySnaps({ graph, points: prepared.points, segments: prepared.geometry.segments }, sources);
      const result = snap({ cursor: [10, 0], mmPerPixel: [1, 1] });
      if (result.kind !== 'ambiguous') throw new Error('Distinct topology and numeric profile intents must remain selectable.');
      expect(result.candidates.map(candidate => candidate.target)).toEqual([
        { kind: 'point', pointId: 'owned' },
        { kind: 'profile-position', profileId: 'first', location: { kind: 'midpoint', boundaryIndex: 4 } },
        { kind: 'profile-position', profileId: 'second', location: { kind: 'center' } }
      ]);
      expect(result.candidates.slice(1).every(candidate => candidate.entityIds.length === 0)).toBe(true);
      expect(snap({ cursor: [10, 0], mmPerPixel: [1, 1], kinds: ['point'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'point', pointId: 'owned' } } });
    }
  });

  it('ranks detached legacy-only sources by screen metric without creating graph identities', () => {
    const firstPoint: [number, number] = [.4, 0], firstLocation = { kind: 'endpoint' as const, boundaryIndex: 2 };
    const sources = [{ profileId: 'near-world', location: firstLocation, point: firstPoint },
      { profileId: 'near-screen', location: { kind: 'center' as const }, point: [0, 2.125] as const }];
    const snap = prepareCadSketchGeometrySnaps(undefined, sources);
    firstPoint[0] = 999; firstLocation.boundaryIndex = 99; sources.reverse();
    expect(snap({ cursor: [0, 0], mmPerPixel: [.1, 1] })).toEqual({ kind: 'hit', candidate: {
      target: { kind: 'profile-position', profileId: 'near-screen', location: { kind: 'center' } }, point: [0, 2.125], distancePx: 2.125, entityIds: []
    } });
    const result = snap({ cursor: [.4, 0], mmPerPixel: [.01, .01], kinds: ['profile-position'], excludePointIds: ['near-world'], excludeEntityIds: ['near-world'] });
    expect(result).toMatchObject({ kind: 'hit', candidate: { target: {
      kind: 'profile-position', profileId: 'near-world', location: { kind: 'endpoint', boundaryIndex: 2 }
    }, point: [.4, 0], entityIds: [] } });
    if (result.kind !== 'hit' || result.candidate.target.kind !== 'profile-position') throw new Error('Expected a detached numeric profile target.');
    expect('pointId' in result.candidate.target).toBe(false); expect('entityId' in result.candidate.target).toBe(false);
    expect(Reflect.set(result.candidate.target.location, 'boundaryIndex', 7)).toBe(false);
    expect(Reflect.set(result.candidate.point, '0', 7)).toBe(false);
  });

  it('ranks actual X/Y screen distance independently of source order and retains exact off-grid coordinates', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'near-world', position: [.4, 0] }, { id: 'near-screen', position: [0, 2.125] }], entities: [], relations: [] });
    for (const points of [graph.points, [...graph.points].reverse()]) {
      const prepared = prepareCadSketchGraphInteraction({ ...graph, points }, {});
      expect(prepared.snap({ cursor: [0, 0], mmPerPixel: [.1, 1] })).toEqual({ kind: 'hit', candidate: {
        target: { kind: 'point', pointId: 'near-screen' }, point: [0, 2.125], distancePx: 2.125, entityIds: []
      } });
    }
  });

  it('distinguishes endpoints, circle centers and reference points, with one identity for shared roles and an analytic line midpoint', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] },
      { id: 'center', position: [40, 0] }, { id: 'reference', position: [60, 0] }], entities: [
      { id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      { id: 'circle-at-a', kind: 'circle', construction: false, centerPointId: 'a', radius: 4 },
      { id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 2 }
    ], relations: [] }), before = JSON.stringify(graph);
    const prepared = prepareCadSketchGraphInteraction(graph, {});
    expect(prepared.snap({ cursor: [0, 0], mmPerPixel: [1, 1], tolerancePx: 0 })).toEqual({ kind: 'hit', candidate: {
      target: { kind: 'endpoint', pointId: 'a' }, point: [0, 0], distancePx: 0, entityIds: ['circle-at-a', 'line']
    } });
    expect(prepared.snap({ cursor: [10, 0], mmPerPixel: [1, 1], tolerancePx: 0 })).toEqual({ kind: 'hit', candidate: {
      target: { kind: 'midpoint', entityId: 'line' }, point: [10, 0], distancePx: 0, entityIds: ['line']
    } });
    expect(prepared.snap({ cursor: [40, 0], mmPerPixel: [1, 1], tolerancePx: 0 })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'center', pointId: 'center' }, entityIds: ['circle'] } });
    expect(prepared.snap({ cursor: [60, 0], mmPerPixel: [1, 1], tolerancePx: 0 })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'point', pointId: 'reference' } } });
    expect(prepared.snap({ cursor: [42, 0], mmPerPixel: [.01, .01] })).toEqual({ kind: 'none' });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('refuses ambiguous identities within screen-distance roundoff, while a uniquely nearer target still wins', () => {
    const graph = parseCadSketchGraph({ points: [0, 4, 9].map((ulps, index) => ({ id: `p${index}`, position: [1 + ulps * Number.EPSILON, 0] })), entities: [], relations: [] });
    const query = { cursor: [0, 0] as const, mmPerPixel: [1, 1] as const };
    for (const points of [graph.points, [...graph.points].reverse()]) {
      const result = prepareCadSketchGraphInteraction({ ...graph, points }, {}).snap(query);
      expect(result.kind).toBe('ambiguous');
      if (result.kind !== 'ambiguous') throw new Error('Expected identity ambiguity.');
      expect(result.candidates.map(candidate => candidate.target)).toEqual([{ kind: 'point', pointId: 'p0' }, { kind: 'point', pointId: 'p1' }]);
      expect(prepareCadSketchGraphInteraction({ ...graph, points: [...points, { id: 'unique', position: [.5, 0] }] }, {}).snap(query))
        .toMatchObject({ kind: 'hit', candidate: { target: { kind: 'point', pointId: 'unique' } } });
    }
    const coincidentCoordinates = parseCadSketchGraph({ points: [{ id: 'different-a', position: [0, 0] }, { id: 'different-b', position: [0, 0] }], entities: [], relations: [] });
    expect(prepareCadSketchGraphInteraction(coincidentCoordinates, {}).snap(query).kind).toBe('ambiguous');
  });

  it('prefers an eligible exact point identity over a coincident midpoint without merging point IDs or nearby positions', () => {
    const source = (role: 'endpoint' | 'center' | 'point') => parseCadSketchGraph({ points: [
      { id: 'cut', position: [10, 0] }, { id: 'far', position: [20, 0] },
      { id: 'bottom', position: [10, -5] }, { id: 'top', position: [10, 5] }
    ], entities: [{ id: 'fence', kind: 'line', startPointId: 'bottom', endPointId: 'top', construction: true },
      ...(role === 'endpoint' ? [{ id: 'edge', kind: 'line', startPointId: 'cut', endPointId: 'far', construction: false }]
        : role === 'center' ? [{ id: 'circle', kind: 'circle', centerPointId: 'cut', radius: 2, construction: false }] : [])], relations: [] });
    const query = { cursor: [10.01, .01] as const, mmPerPixel: [.01, .01] as const };
    for (const role of ['endpoint', 'center', 'point'] as const) {
      const graph = source(role), before = JSON.stringify(graph), snap = prepareCadSketchGraphInteraction(graph, {}).snap;
      expect(snap(query)).toMatchObject({ kind: 'hit', candidate: { target: { kind: role, pointId: 'cut' }, point: [10, 0] } });
      expect(snap({ ...query, excludePointIds: ['cut'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'fence' } } });
      expect(snap({ ...query, kinds: ['midpoint'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'fence' } } });
      expect(JSON.stringify(graph)).toBe(before);
    }
    const graph = source('point');
    const duplicate = prepareCadSketchGraphInteraction(parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'other', position: [10, 0] }] }), {}).snap(query);
    expect(duplicate.kind).toBe('ambiguous');
    if (duplicate.kind !== 'ambiguous') throw new Error('Distinct point identities must remain ambiguous.');
    expect(duplicate.candidates.map(candidate => candidate.target)).toEqual([{ kind: 'point', pointId: 'cut' }, { kind: 'point', pointId: 'other' }]);
    const nearby = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'cut' ? { ...point, position: [10, .001] } : point) });
    expect(prepareCadSketchGraphInteraction(nearby, {}).snap({ cursor: [10, 0], mmPerPixel: [.01, .01] }))
      .toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'fence' } } });
    const roundoff = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'cut' ? { ...point, position: [10, Number.EPSILON] } : point) });
    expect(prepareCadSketchGraphInteraction(roundoff, {}).snap({ cursor: [10, 0], mmPerPixel: [1, 1] }).kind).toBe('ambiguous');
  });

  it('follows minor and major signed arc supports, invariant under reversed traversal and without chord midpoint snaps', () => {
    for (const reverse of [false, true]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 10] }], entities: [
        { id: 'major', kind: 'arc', construction: false, centerPointId: 'center', startPointId: reverse ? 'end' : 'start', endPointId: reverse ? 'start' : 'end', direction: reverse ? 'ccw' : 'cw' },
        { id: 'minor', kind: 'arc', construction: true, centerPointId: 'center', startPointId: reverse ? 'end' : 'start', endPointId: reverse ? 'start' : 'end', direction: reverse ? 'cw' : 'ccw' }
      ], relations: [] }), before = JSON.stringify(graph), prepared = prepareCadSketchGraphInteraction(graph, {});
      for (const [id, coordinate] of [['major', -7.0710678118654755], ['minor', 7.0710678118654755]] as const) {
        const result = prepared.snap({ cursor: [coordinate, coordinate], mmPerPixel: [.01, .01] });
        expect(result).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: id }, entityIds: [id] } });
        if (result.kind !== 'hit') throw new Error('Expected analytic midpoint.');
        expect(result.candidate.point[0]).toBeCloseTo(coordinate, 13); expect(result.candidate.point[1]).toBeCloseTo(coordinate, 13);
      }
      expect(prepared.snap({ cursor: [5, 5], mmPerPixel: [.01, .01] })).toEqual({ kind: 'none' });
      expect(JSON.stringify(graph)).toBe(before);
    }
  });

  it('excludes dragged point aliases and their dependent midpoint targets without excluding unrelated geometry', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'alias', position: [0, 0] },
      { id: 'b', position: [20, 0] }, { id: 'c', position: [0, 20] }, { id: 'other', position: [40, 0] }], entities: [
      { id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'alias-line', kind: 'line', construction: true, startPointId: 'alias', endPointId: 'c' }
    ], relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'alias'] }] });
    const snap = prepareCadSketchGraphInteraction(graph, {}).snap;
    for (const pointId of ['a', 'alias']) for (const cursor of [[0, 0], [10, 0], [0, 10]] as const)
      expect(snap({ cursor, mmPerPixel: [.01, .01], excludePointIds: [pointId] })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [20, 0], mmPerPixel: [.01, .01], excludePointIds: ['a'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'endpoint', pointId: 'b' } } });
    expect(snap({ cursor: [40, 0], mmPerPixel: [.01, .01], excludePointIds: ['a'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'point', pointId: 'other' } } });
  });

  it('excludes a dragged midpoint owner and its declared alias from their own guide midpoint magnet', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] },
      { id: 'middle', position: [10, 0] }, { id: 'alias', position: [10, 0] }, { id: 'c', position: [0, 20] }, { id: 'd', position: [20, 20] }],
      entities: [{ id: 'guide', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'other', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'join', kind: 'coincident', pointIds: ['middle', 'alias'] }, { id: 'centered', kind: 'midpoint', pointId: 'middle', lineId: 'guide' }] });
    const snap = prepareCadSketchGraphInteraction(graph, {}).snap;
    for (const pointId of ['middle', 'alias']) {
      expect(snap({ cursor: [10, 0], mmPerPixel: [.01, .01], excludePointIds: [pointId] })).toEqual({ kind: 'none' });
      expect(snap({ cursor: [10, 20], mmPerPixel: [.01, .01], excludePointIds: [pointId] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'other' } } });
      expect(snap({ cursor: [0, 0], mmPerPixel: [.01, .01], excludePointIds: [pointId] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'endpoint', pointId: 'a' } } });
    }
  });

  it('filters source memberships and target roles before distance ranking, retaining a shared point through an eligible owner', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }], entities: [
      { id: 'line', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      { id: 'circle', kind: 'circle', construction: false, centerPointId: 'a', radius: 4 }
    ], relations: [] }), snap = prepareCadSketchGraphInteraction(graph, {}).snap;
    expect(snap({ cursor: [0, 0], mmPerPixel: [.01, .01], excludeEntityIds: ['line'] })).toEqual({ kind: 'hit', candidate: {
      target: { kind: 'center', pointId: 'a' }, point: [0, 0], distancePx: 0, entityIds: ['circle']
    } });
    for (const cursor of [[10, 0], [20, 0]] as const)
      expect(snap({ cursor, mmPerPixel: [.01, .01], excludeEntityIds: ['line'] })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [10, 0], mmPerPixel: [2, 2], kinds: ['center'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'center', pointId: 'a' } } });
    expect(snap({ cursor: [10, 0], mmPerPixel: [2, 2], kinds: [] })).toEqual({ kind: 'none' });
  });

  it('resolves an owned draft start without a graph, competes by distance and rejects stale borrowed identities', () => {
    const empty = prepareCadSketchGeometrySnaps();
    expect(empty({ cursor: [4.25, .75], mmPerPixel: [.5, .5], draftStart: { point: [1.25, .75] } })).toEqual({ kind: 'hit', candidate: {
      target: { kind: 'draft-start' }, point: [1.25, .75], distancePx: 6, entityIds: []
    } });
    const graph = parseCadSketchGraph({ points: [{ id: 'existing', position: [1, 0] }], entities: [], relations: [] }), snap = prepareCadSketchGraphInteraction(graph, {}).snap;
    expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1], draftStart: { point: [.5, 0] } })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'draft-start' } } });
    expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1], draftStart: { point: [1, 0], pointId: 'existing' } })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'point', pointId: 'existing' } } });
    expect(snap({ cursor: [2, 0], mmPerPixel: [.01, .01], draftStart: { point: [2, 0], pointId: 'existing' } })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [1, 0], mmPerPixel: [1, 1], draftStart: { point: [1.001, 0], pointId: 'existing' } })).toEqual({ kind: 'none' });
    expect(empty({ cursor: [0, 0], mmPerPixel: [1, 1], draftStart: { point: [0, 0], pointId: 'missing' } })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1], draftStart: { point: [1, 0] } }).kind).toBe('ambiguous');
  });

  it('retains analytic midpoint precision for tiny geometry, distant origins and a tiny signed sweep', () => {
    for (const parameters of [{ x: 0, y: 0, r: .00001 }, { x: 1e8, y: -2e8, r: 10 }]) {
      const graph = parseCadSketchGraph({ points: [{ id: 'center', position: [' x ', ' y '] },
        { id: 'start', position: ['x + r', 'y'] }, { id: 'end', position: ['x', 'y + r'] }], entities: [
        { id: 'major', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw' }
      ], relations: [] }), before = JSON.stringify(graph), expected = [parameters.x - parameters.r / Math.SQRT2, parameters.y - parameters.r / Math.SQRT2] as const;
      const result = prepareCadSketchGraphInteraction(graph, parameters).snap({ cursor: expected, mmPerPixel: [parameters.r / 100, parameters.r / 100] });
      expect(result).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'major' } } });
      if (result.kind !== 'hit') throw new Error('Expected exact arc support.');
      expect(Math.hypot(result.candidate.point[0] - expected[0], result.candidate.point[1] - expected[1]))
        .toBeLessThanOrEqual(cadPathClosureTolerance([{ x: expected[0], y: expected[1] }]));
      expect(JSON.stringify(graph)).toBe(before);
    }
    const smallSweep = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [1, 0] },
      { id: 'end', position: [Math.cos(.000001), Math.sin(.000001)] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw' }
    ], relations: [] });
    const result = prepareCadSketchGraphInteraction(smallSweep, {}).snap({ cursor: [.999999999999875, .0000004999999999999791], mmPerPixel: [1e-9, 1e-9] });
    expect(result).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'arc' } } });
    if (result.kind !== 'hit') throw new Error('Expected small-sweep midpoint.');
    expect(result.candidate.point[0]).toBeCloseTo(.999999999999875, 15);
    expect(result.candidate.point[1]).toBeCloseTo(.0000004999999999999791, 15);
  });

  it('freezes detached candidates from source and query arrays, preserving exact expression ownership', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [' offset ', 0] }, { id: 'b', position: ['offset + 20', 0] }], entities: [
      { id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }
    ], relations: [] }), before = JSON.stringify(graph), prepared = prepareCadSketchGraphInteraction(graph, { offset: 1.25 });
    const points = prepared.points.map(point => ({ id: point.id, position: [point.position[0], point.position[1]] satisfies [number, number] }));
    const segments = structuredClone(prepared.geometry.segments), snap = prepareCadSketchGeometrySnaps({ graph, points, segments });
    const result = snap({ cursor: [1.25, 0], mmPerPixel: [.01, .01] });
    points[0].position[0] = 999; segments[0].start.x = 999;
    expect(result).toEqual({ kind: 'hit', candidate: { target: { kind: 'endpoint', pointId: 'a' }, point: [1.25, 0], distancePx: 0, entityIds: ['line'] } });
    expect(snap({ cursor: [11.25, 0], mmPerPixel: [.01, .01] })).toMatchObject({ kind: 'hit', candidate: { point: [11.25, 0] } });
    if (result.kind !== 'hit') throw new Error('Expected point target.');
    expect(Reflect.set(result.candidate.target, 'pointId', 'poisoned')).toBe(false);
    expect(Reflect.set(result.candidate.point, '0', 100)).toBe(false);
    expect(Reflect.set(result.candidate.entityIds, '0', 'poisoned')).toBe(false);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.candidate)).toBe(true);
    const draftPoint: [number, number] = [.125, .75], draftResult = prepareCadSketchGeometrySnaps()({ cursor: draftPoint, mmPerPixel: [1, 1], draftStart: { point: draftPoint } });
    draftPoint[0] = 99;
    expect(draftResult).toMatchObject({ kind: 'hit', candidate: { point: [.125, .75] } });
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('uses an inclusive radial pixel boundary and fails safely for invalid cursor, scales and radius', () => {
    const snap = prepareCadSketchGeometrySnaps(), draftStart = { point: [0, 0] as const };
    expect(snap({ cursor: [6, 0], mmPerPixel: [1, 1], draftStart }).kind).toBe('hit');
    expect(snap({ cursor: [6.000001, 0], mmPerPixel: [1, 1], draftStart })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [6, 6], mmPerPixel: [1, 1], draftStart })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [3, 4], mmPerPixel: [1, 1], tolerancePx: 5, draftStart }).kind).toBe('hit');
    for (const scale of [0, -1, Infinity, NaN]) for (const mmPerPixel of [[scale, 1], [1, scale]] as const)
      expect(snap({ cursor: [0, 0], mmPerPixel, draftStart })).toEqual({ kind: 'none' });
    for (const tolerancePx of [-1, Infinity, NaN]) expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1], tolerancePx, draftStart })).toEqual({ kind: 'none' });
    for (const cursor of [[NaN, 0], [0, Infinity]] as const) expect(snap({ cursor, mmPerPixel: [1, 1], draftStart })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1], draftStart: { point: [NaN, 0] } })).toEqual({ kind: 'none' });
    expect(snap({ cursor: [0, 0], mmPerPixel: [1, 1] })).toEqual({ kind: 'none' });
  });

  describe('plane and edge references', () => {
    // A 20 mm square from (10, 10), an arc centred at (40, 0) through the X axis and a vertical line along the Y axis.
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [10, 10] }, { id: 'b', position: [30, 10] }, { id: 'c', position: [30, 30] },
      { id: 'o', position: [40, 0] }, { id: 's', position: [50, 0] }, { id: 'e', position: [30, 0] }, { id: 'y0', position: [0, 5] }, { id: 'y1', position: [0, 40] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
      { id: 'arc', kind: 'arc', construction: true, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' },
      { id: 'onY', kind: 'line', construction: false, startPointId: 'y0', endPointId: 'y1' }], relations: [] });
    const prepared = prepareCadSketchGraphInteraction(graph, {});
    const snap = prepareCadSketchGeometrySnaps({ graph, points: prepared.points, segments: prepared.geometry.segments });
    const at = (cursor: readonly [number, number], extra: Partial<Parameters<typeof snap>[0]> = {}) => snap({ cursor, mmPerPixel: [.1, .1], references: true, ...extra });

    it('stay off unless the query asks for them', () => {
      expect(snap({ cursor: [15, 10.2], mmPerPixel: [.1, .1] })).toEqual({ kind: 'none' });
      expect(snap({ cursor: [.1, .1], mmPerPixel: [.1, .1] })).toEqual({ kind: 'none' });
    });

    it('catch the origin, positions on edges, arcs and axes, and their crossings', () => {
      expect(at([.2, -.1])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'origin' }, point: [0, 0] } });
      expect(at([15, 10.3])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-entity', entityId: 'ab', entityKind: 'line' }, point: [15, 10], entityIds: ['ab'] } });
      const onArc = at([47.2, 7.2]);
      if (onArc.kind !== 'hit') throw new Error('Arc position missing.');
      expect(onArc.candidate.target).toEqual({ kind: 'on-entity', entityId: 'arc', entityKind: 'arc' });
      expect(Math.hypot(onArc.candidate.point[0] - 40, onArc.candidate.point[1])).toBeCloseTo(10, 12);
      // The arc runs counter-clockwise from (50, 0) to (30, 0) over the top; below the axis is off the arc.
      expect(at([40, -10.2])).toEqual({ kind: 'none' });
      expect(at([70, .3])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-axis', axis: 'x' }, point: [70, 0] } });
      expect(at([-.3, -20])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-axis', axis: 'y' }, point: [0, -20] } });
      // An edge lying along an axis is the more specific target.
      expect(at([.2, 20])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-entity', entityId: 'onY' } } });
      expect(at([20, -.3])).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-axis', axis: 'x' } } });
    });

    it('resolve a crossing only where no point target is in reach', () => {
      const square = parseCadSketchGraph({ points: [{ id: 'p', position: [-10, 5] }, { id: 'q', position: [10, 5] }, { id: 'r', position: [5, -6] }, { id: 't', position: [5, 10] }],
        entities: [{ id: 'pq', kind: 'line', construction: false, startPointId: 'p', endPointId: 'q' }, { id: 'rt', kind: 'line', construction: false, startPointId: 'r', endPointId: 't' }], relations: [] });
      const crossing = prepareCadSketchGraphInteraction(square, {});
      const query = prepareCadSketchGeometrySnaps({ graph: square, points: crossing.points, segments: crossing.geometry.segments });
      expect(query({ cursor: [5.2, 5.3], mmPerPixel: [.1, .1], references: true })).toEqual({ kind: 'hit', candidate: {
        target: { kind: 'intersection', axes: [] }, point: [5, 5], distancePx: expect.closeTo(Math.hypot(2, 3), 9), entityIds: ['pq', 'rt'] } });
      expect(query({ cursor: [5.2, .3], mmPerPixel: [.1, .1], references: true })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'intersection', axes: ['x'] }, point: [5, 0], entityIds: ['rt'] } });
      // The midpoint of pq is (0, 5) on the Y axis: the midpoint wins over the crossing at the same place.
      expect(query({ cursor: [.1, 5.1], mmPerPixel: [.1, .1], references: true })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'midpoint', entityId: 'pq' } } });
      // A moving edge never attracts its own pointer.
      expect(query({ cursor: [5.2, 5.3], mmPerPixel: [.1, .1], references: true, excludePointIds: ['r'] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-entity', entityId: 'pq' } } });
    });

    it('align with acquired points after every geometric target, by the nearest guide', () => {
      const alignTo = [[100, 100], [120, 80], [100, 60]] as const;
      expect(at([100.2, 150], { alignTo })).toEqual({ kind: 'hit', candidate: { target: { kind: 'aligned', vertical: [100, 100] }, point: [100, 150], distancePx: expect.closeTo(2, 9), entityIds: [] } });
      expect(at([150, 79.7], { alignTo })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'aligned', horizontal: [120, 80] }, point: [150, 80] } });
      expect(at([119.8, 99.6], { alignTo })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'aligned', horizontal: [100, 100], vertical: [120, 80] }, point: [120, 100] } });
      expect(at([150, 150], { alignTo })).toEqual({ kind: 'none' });
      expect(at([100.2, 150], { alignTo, kinds: ['on-entity'] })).toEqual({ kind: 'none' });
      // Geometry within reach beats a guide.
      expect(at([15, 10.2], { alignTo: [[15.3, 50]] })).toMatchObject({ kind: 'hit', candidate: { target: { kind: 'on-entity', entityId: 'ab' } } });
    });
  });
});
