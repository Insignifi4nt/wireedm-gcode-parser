import { describe, expect, it } from 'vitest';
import type { CadFeature } from '../cadDocument';
import { CadError } from '../cadError';
import { applyCadEdits } from '../cadOperations';
import { cadConsumedBodyIds, cadFeatureDependencies, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';
import {
  isCadTopologyInspectResult, isCadTopologyResolvePicksResult, parseCadEdgeQuery, parseCadEdgeSelection, parseCadFaceQuery,
  parseCadTopologyInspectRequest, parseCadTopologyPickSet, parseCadTopologyResolvePicksRequest, resolveCadEdgeSelection,
  resolveCadFaceQuery, validateCadShellOpening, type CadEdgeQuery, type CadEdgeSelection, type CadFaceQuery,
  type CadTopologyInspectResult
} from '../cadTopology';

const edgeQuery: CadEdgeQuery = { kind: 'edges', expectedCount: 4, predicates: [
  { kind: 'curve-type', value: 'line' }, { kind: 'parallel', direction: [0, 0, 1] }, { kind: 'length', value: 'height' }
] };
const edgeSelection: CadEdgeSelection = { queries: [edgeQuery], expectedCount: 4 };
const opening: CadFaceQuery = { kind: 'faces', expectedCount: 1, predicates: [
  { kind: 'plane', normal: [0, 0, 1], offset: 'height' }, { kind: 'centroid', point: [0, 0, 'height'] }, { kind: 'area', value: 100 }
] };
const baseFeatures: readonly CadFeature[] = [
  { kind: 'sketch', id: 'profile', name: 'Profile', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'rectangle', name: 'Rectangle', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: -5, y: -5, width: 10, height: 10, cornerRadius: 0 } }
  ] },
  { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'profile', distance: 'height', symmetric: false, operation: 'new', targetId: null }
];
function part(features: readonly CadFeature[] = baseFeatures) {
  return parseCadDocument({ ...createCadDocument('Topology', 'cad_topology'), parameters: { height: 10, thickness: 1 }, features });
}
const edgeFeature: CadFeature = { kind: 'fillet', id: 'round', name: 'Round edges', suppressed: false, targetId: 'pad', radius: 1, selection: edgeSelection };
const shellFeature: CadFeature = { kind: 'shell', id: 'shell', name: 'Inward shell', suppressed: false, targetId: 'pad', thickness: 'thickness', opening };

describe('declarative exact topology selectors', () => {
  it('preserves expressions while resolving every dimensional predicate in the world frame', () => {
    const parsed = parseCadEdgeSelection(edgeSelection, { height: 10 });
    expect(parsed).toEqual(edgeSelection);
    expect(resolveCadEdgeSelection(parsed, { height: 20 })).toMatchObject({ expectedCount: 4, queries: [{ predicates: [
      { kind: 'curve-type', value: 'line' }, { kind: 'parallel', direction: [0, 0, 1] }, { kind: 'length', value: 20 }
    ] }] });
    expect(resolveCadFaceQuery(parseCadFaceQuery(opening, { height: 10 }), { height: 12 })).toMatchObject({ predicates: [
      { kind: 'plane', offset: 12 }, { kind: 'centroid', point: [0, 0, 12] }, { kind: 'area', value: 100 }
    ] });
  });
  it('supports endpoint, circular-axis and complementary arc geometry without persisting a topology key', () => {
    const query = parseCadEdgeQuery({ kind: 'edges', expectedCount: 1, predicates: [
      { kind: 'circle', center: ['x', 0, 0], axis: [0, 0, -1], radius: 'r' },
      { kind: 'arc-points', start: ['x+r', 0, 0], end: ['x-r', 0, 0], midpoint: ['x', 'r', 0] }
    ] }, { x: 4, r: 3 });
    expect(resolveCadEdgeSelection({ queries: [query], expectedCount: 1 }, { x: 4, r: 3 })).toMatchObject({ queries: [{ predicates: [
      { kind: 'circle', center: [4, 0, 0], axis: [0, 0, -1], radius: 3 },
      { kind: 'arc-points', start: [7, 0, 0], end: [1, 0, 0], midpoint: [4, 3, 0] }
    ] }] });
    expect(parseCadEdgeQuery({ kind: 'edges', expectedCount: 1, predicates: [
      { kind: 'line-endpoints', start: [0, 0, 0], end: ['x', 0, 0] }, { kind: 'on-plane', normal: [0, 0, 1], offset: 0 }
    ] }, { x: 4 }).predicates).toHaveLength(2);
  });
  it('allows numeric area above the linear scalar limit without broadening dimensional expressions', () => {
    expect(parseCadFaceQuery({ kind: 'faces', expectedCount: 1, predicates: [{ kind: 'area', value: 1e12 }] })).toMatchObject({ predicates: [{ value: 1e12 }] });
    expect(() => parseCadFaceQuery({ kind: 'faces', expectedCount: 1, predicates: [{ kind: 'area', value: '1e12' }] })).toThrow(CadError);
  });
  it.each([0, 65, 1.5, Infinity])('rejects invalid exact expected count %s', expectedCount => {
    expect(() => parseCadEdgeSelection({ queries: [{ ...edgeQuery, expectedCount }], expectedCount: 4 }, { height: 10 })).toThrow(CadError);
    expect(() => parseCadEdgeSelection({ ...edgeSelection, expectedCount }, { height: 10 })).toThrow(CadError);
  });
  it('bounds query count and conjunction size and refuses nearest/tolerance/index escape hatches', () => {
    for (const input of [
      { queries: [], expectedCount: 1 },
      { queries: Array.from({ length: 65 }, () => edgeQuery), expectedCount: 1 },
      { queries: [{ ...edgeQuery, predicates: [] }], expectedCount: 1 },
      { queries: [{ ...edgeQuery, predicates: Array.from({ length: 9 }, () => ({ kind: 'curve-type', value: 'line' })) }], expectedCount: 1 },
      { queries: [{ ...edgeQuery, key: 'edge_1' }], expectedCount: 1 },
      { queries: [{ ...edgeQuery, tolerance: 1 }], expectedCount: 1 },
      { queries: [{ kind: 'edges', predicates: [{ kind: 'nearest', point: [0, 0, 0] }], expectedCount: 1 }], expectedCount: 1 },
      { ...edgeSelection, index: 1 }
    ]) expect(() => parseCadEdgeSelection(input, { height: 10 })).toThrow(CadError);
    expect(parseCadEdgeSelection({ queries: Array.from({ length: 64 }, () => edgeQuery), expectedCount: 64 }, { height: 10 }).queries).toHaveLength(64);
  });
  it.each([{ direction: [0, 0, 0] }, { direction: [0, 0, 0.5] }, { direction: [1, 1, 0] }, { direction: [NaN, 0, 1] }, { direction: ['x', 0, 0] }])('rejects nonnormalized or nonnumeric directions $direction', ({ direction }) => {
    expect(() => parseCadEdgeQuery({ kind: 'edges', expectedCount: 1, predicates: [{ kind: 'parallel', direction }] })).toThrow(CadError);
    expect(() => parseCadFaceQuery({ kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: direction, offset: 0 }] })).toThrow(CadError);
  });
  it('rejects changed parameter values, executable expressions and nonpositive lengths/radii', () => {
    expect(() => parseCadEdgeSelection(edgeSelection, { height: 0 })).toThrow('greater than kernel precision');
    expect(() => parseCadEdgeSelection(edgeSelection, {})).toThrow('Unknown parameter');
    expect(() => parseCadEdgeQuery({ kind: 'edges', expectedCount: 1, predicates: [{ kind: 'length', value: 'globalThis.x()' }] })).toThrow(CadError);
    expect(() => parseCadFaceQuery({ kind: 'faces', expectedCount: 1, predicates: [{ kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: -1 }] })).toThrow(CadError);
  });
  it('detaches and freezes accepted selectors and rejects inherited schema fields', () => {
    const input = { kind: 'edges', predicates: [{ kind: 'length', value: 10 }], expectedCount: 1 };
    const parsed = parseCadEdgeQuery(input);
    input.predicates[0].value = 20;
    expect(parsed.predicates[0]).toEqual({ kind: 'length', value: 10 });
    expect(Object.isFrozen(parsed.predicates)).toBe(true); expect(Object.isFrozen(parsed.predicates[0])).toBe(true);
    expect(() => parseCadEdgeQuery(Object.create(input))).toThrow(CadError);
  });
});

describe('feature compatibility and inward shell history', () => {
  it.each(['fillet', 'chamfer'] as const)('keeps absent/null %s selection as legacy all-edge behavior', kind => {
    const legacy = { kind, id: 'round', name: 'Legacy', suppressed: false, targetId: 'pad', radius: 1 };
    expect(part([...baseFeatures, legacy]).features.at(-1)).toEqual(legacy);
    expect(part([...baseFeatures, { ...legacy, selection: null }]).features.at(-1)).toEqual({ ...legacy, selection: null });
    expect(part([...baseFeatures, { ...legacy, selection: edgeSelection }]).features.at(-1)).toMatchObject({ selection: edgeSelection });
  });
  it('encodes shell as a consumed-body successor and supports safe cascade and undoable atom edits', () => {
    const document = part([...baseFeatures, shellFeature]);
    expect(cadFeatureDependencies(shellFeature)).toEqual(['pad']);
    expect(cadConsumedBodyIds(shellFeature)).toEqual(['pad']);
    expect(cadVisibleBodyIds(document.features)).toEqual(['shell']);
    expect(() => applyCadEdits(document, [{ kind: 'delete-feature', featureId: 'pad', cascade: false }])).toThrow('depends');
    expect(applyCadEdits(document, [{ kind: 'delete-feature', featureId: 'pad', cascade: true }]).features.map(feature => feature.id)).toEqual(['profile']);
    expect(() => applyCadEdits(document, [{ kind: 'move-feature', featureId: 'shell', beforeId: 'pad' }])).toThrow('missing or later');
  });
  it('requires a unique explicitly planar opening and positive inward thickness', () => {
    validateCadShellOpening(opening, { height: 10 });
    for (const query of [
      { ...opening, expectedCount: 2 },
      { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'area', value: 100 }] },
      { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'surface-type', value: 'cylinder' }] },
      { ...opening, predicates: [...opening.predicates, { kind: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 5 }] }
    ]) expect(() => parseCadDocument({ ...part(), features: [...baseFeatures, { ...shellFeature, opening: query }] })).toThrow(CadError);
    for (const thickness of [-1, 0, 1e-8, 1e6 + 1]) expect(() => part([...baseFeatures, { ...shellFeature, thickness }])).toThrow('thickness must be positive');
  });
  it('rejects missing, consumed, sketch, curve and suppressed-body shell references', () => {
    expect(() => part([...baseFeatures, { ...shellFeature, targetId: 'missing' }])).toThrow('missing or later');
    expect(() => part([...baseFeatures, { ...shellFeature, targetId: 'profile' }])).toThrow('cannot target a sketch');
    expect(() => part([...baseFeatures, { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 0,
      segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }] }, { ...shellFeature, targetId: 'rail' }])).toThrow('cannot target a reference curve');
    expect(() => part([...baseFeatures, edgeFeature, shellFeature])).toThrow('already consumed');
    expect(() => part([baseFeatures[0], { ...baseFeatures[1], suppressed: true }, shellFeature])).toThrow('suppressed');
  });
  it('rejects parameter propagation atomically if it invalidates a shell or selected edge query', () => {
    const document = part([...baseFeatures, shellFeature]);
    expect(() => applyCadEdits(document, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-parameter', name: 'thickness', value: 0 }])).toThrow(CadError);
    expect(document.name).toBe('Topology'); expect(document.parameters.thickness).toBe(1);
    const selected = part([...baseFeatures, edgeFeature]);
    expect(() => applyCadEdits(selected, [{ kind: 'set-parameter', name: 'height', value: -10 }])).toThrow('greater than kernel precision');
    expect(selected.parameters.height).toBe(10);
  });
});

describe('bounded ephemeral topology boundaries', () => {
  it('requires pinned document/build/body identities and rejects duplicate or oversized picks', () => {
    const set = { documentVersion: 'version', buildId: 'build', bodyId: 'pad', picks: [{ kind: 'edge', key: 'edge_a' }] };
    expect(parseCadTopologyPickSet(set)).toEqual(set);
    expect(() => parseCadTopologyPickSet({ ...set, buildId: '' })).toThrow(CadError);
    expect(() => parseCadTopologyPickSet({ ...set, picks: [set.picks[0], set.picks[0]] })).toThrow('only once');
    expect(() => parseCadTopologyPickSet({ ...set, picks: Array.from({ length: 65 }, (_, index) => ({ kind: 'edge', key: `e_${index}` })) })).toThrow(CadError);
  });
  it('bounds inspection pages and checks purpose-specific pick kinds', () => {
    const identity = { bodyId: 'pad', expectedBuildId: 'build' };
    expect(parseCadTopologyInspectRequest({ ...identity, selection: { kind: 'page', topology: 'edge', offset: 0, limit: 100 } })).toMatchObject(identity);
    expect(() => parseCadTopologyInspectRequest({ ...identity, selection: { kind: 'page', topology: 'edge', offset: -1, limit: 1 } })).toThrow(CadError);
    expect(() => parseCadTopologyInspectRequest({ ...identity, selection: { kind: 'page', topology: 'edge', offset: 0, limit: 101 } })).toThrow(CadError);
    expect(parseCadTopologyResolvePicksRequest({ ...identity, purpose: 'shell', picks: [{ kind: 'face', key: 'face_a' }] }).purpose).toBe('shell');
    expect(() => parseCadTopologyResolvePicksRequest({ ...identity, purpose: 'shell', picks: [{ kind: 'edge', key: 'edge_a' }] })).toThrow('Select edges');
    expect(() => parseCadTopologyResolvePicksRequest({ ...identity, purpose: 'fillet', picks: [{ kind: 'face', key: 'face_a' }] })).toThrow('Select edges');
  });
  const result: CadTopologyInspectResult = { bodyId: 'pad', buildId: 'build', total: 1, nextOffset: null, descriptors: [
    { key: 'edge_a', kind: 'edge', curveType: 'line', length: 0, start: [0, 0, 0], end: [0, 0, 0], centroid: [0, 0, 0], bounds: { min: [0, 0, 0], max: [0, 0, 0] } }
  ] };
  it('validates exact descriptor replies including degenerate inspectable edges without accepting corrupt payloads', () => {
    expect(isCadTopologyInspectResult(result)).toBe(true);
    for (const malformed of [
      { ...result, descriptors: [result.descriptors[0], result.descriptors[0]], total: 2 },
      { ...result, descriptors: [{ ...result.descriptors[0], length: Infinity }] },
      { ...result, descriptors: [{ ...result.descriptors[0], bounds: { min: [1, 0, 0], max: [0, 0, 0] } }] },
      { ...result, nextOffset: 1 }, { ...result, total: 0 }, { ...result, buildId: '' }, { ...result, unexpected: true }
    ]) expect(isCadTopologyInspectResult(malformed)).toBe(false);
  });
  it('rejects inherited reply fields, getters and sparse tuples without throwing from a type guard', () => {
    expect(isCadTopologyInspectResult(Object.create(result))).toBe(false);
    const accessor = Object.defineProperty({ ...result }, 'total', { get() { throw new Error('Unexpected getter'); } });
    expect(() => isCadTopologyInspectResult(accessor)).not.toThrow();
    expect(isCadTopologyInspectResult(accessor)).toBe(false);
    expect(isCadTopologyInspectResult({ ...result, descriptors: [{ ...result.descriptors[0], centroid: new Array(3) }] })).toBe(false);
    const resolved = { bodyId: 'pad', buildId: 'build', purpose: 'shell', opening: { kind: 'faces', expectedCount: 1,
      predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }] } };
    expect(isCadTopologyResolvePicksResult(Object.create(resolved))).toBe(false);
    const nestedAccessor = { ...resolved, opening: Object.defineProperty({ ...resolved.opening }, 'expectedCount', { get() { throw new Error('Unexpected getter'); } }) };
    expect(() => isCadTopologyResolvePicksResult(nestedAccessor)).not.toThrow();
    expect(isCadTopologyResolvePicksResult(nestedAccessor)).toBe(false);
  });
  it('refuses malformed pick-resolution replies and accepts only numeric resolved geometric selectors', () => {
    const selection = { queries: [{ kind: 'edges', expectedCount: 1, predicates: [{ kind: 'length', value: 10 }] }], expectedCount: 1 };
    expect(isCadTopologyResolvePicksResult({ bodyId: 'pad', buildId: 'build', purpose: 'fillet', selection })).toBe(true);
    expect(isCadTopologyResolvePicksResult({ bodyId: 'pad', buildId: 'build', purpose: 'fillet', selection: { ...selection, key: 'edge_a' } })).toBe(false);
    expect(isCadTopologyResolvePicksResult({ bodyId: 'pad', buildId: 'build', purpose: 'shell', opening: { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'surface-type', value: 'cylinder' }] } })).toBe(false);
    expect(isCadTopologyResolvePicksResult({ bodyId: 'pad', buildId: 'build', purpose: 'shell', opening: { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }] } })).toBe(true);
  });
});
