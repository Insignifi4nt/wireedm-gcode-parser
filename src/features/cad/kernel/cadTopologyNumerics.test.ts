// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { makeCompound, makeLine, makeThreePointArc, setOC } from 'replicad';
import type { CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { isCadTopologyInspectResult, type CadEdgeQuery, type CadEdgeSelection, type CadFaceQuery, type CadVector3 } from '@/domain/cad/cadTopology';
import { buildCadKernelModel } from './cadKernelModel';
import { CadKernelTopology } from './cadKernelTopology';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)), print: () => undefined, printErr: () => undefined }));
}, 60_000);
const base = (id: string) => ({ id, name: id, suppressed: false });
function document(extra: readonly CadFeature[] = []): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'cad_topology_numeric', name: 'Exact topology', units: 'mm', parameters: {}, features: [
    { ...base('profile'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: 'rectangle', name: 'Rectangle', role: 'outer', construction: false,
      geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }] },
    { ...base('pad'), kind: 'extrude', sketchId: 'profile', distance: 5, symmetric: false, operation: 'new', targetId: null }, ...extra
  ] });
}
function selection(query: CadEdgeQuery): CadEdgeSelection { return { queries: [query], expectedCount: query.expectedCount }; }
const dot = (a: CadVector3, b: CadVector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

describe('independent topology numerical review', () => {
  it('distinguishes complementary arcs only by their interior point and treats axes/endpoints as unoriented', () => {
    const upper = makeThreePointArc([5, 0, 0], [0, 5, 0], [-5, 0, 0]);
    const lower = makeThreePointArc([5, 0, 0], [0, -5, 0], [-5, 0, 0]);
    const upperIdentity = upper.clone();
    const compound = makeCompound([upper, lower]).asShape3D(); const topology = new CadKernelTopology(compound);
    try {
      const page = topology.inspect({ bodyId: 'arcs', expectedBuildId: 'build', selection: { kind: 'page', topology: 'edge', offset: 0, limit: 10 } }, 'build');
      expect(isCadTopologyInspectResult(page)).toBe(true); expect(page.descriptors).toHaveLength(2);
      const descriptor = page.descriptors.find(value => value.kind === 'edge' && value.curveType === 'circle' && value.midpoint[1] > 0);
      if (!descriptor || descriptor.kind !== 'edge' || descriptor.curveType !== 'circle') throw new Error('Missing upper semicircle');
      const axis: CadVector3 = [-descriptor.axis[0], -descriptor.axis[1], -descriptor.axis[2]];
      const ambiguous: CadEdgeQuery = { kind: 'edges', expectedCount: 1, predicates: [
        { kind: 'circle', center: descriptor.center, axis, radius: descriptor.radius }, { kind: 'length', value: descriptor.length }
      ] };
      expect(() => topology.selectedEdges(selection(ambiguous), {})).toThrow('matched 2 element');
      const precise: CadEdgeQuery = { ...ambiguous, predicates: [...ambiguous.predicates,
        { kind: 'arc-points', start: descriptor.end, end: descriptor.start, midpoint: descriptor.midpoint }
      ] };
      const edges = topology.selectedEdges(selection(precise), {});
      expect(edges).toHaveLength(1); expect(edges[0].wrapped.IsSame(upperIdentity.wrapped)).toBe(true);
      const converted = topology.resolvePicks({ bodyId: 'arcs', expectedBuildId: 'build', purpose: 'fillet', picks: [{ kind: 'edge', key: descriptor.key }] }, 'build', {});
      if (converted.purpose === 'shell') throw new Error('Unexpected face selector');
      expect(topology.selectedEdges(converted.selection, {})[0].wrapped.IsSame(upperIdentity.wrapped)).toBe(true);
    } finally { topology.dispose(); compound.delete(); upperIdentity.delete(); upper.delete(); lower.delete(); }
  });
  it.each([{ separation: 1e-6, ambiguous: false }, { separation: 5e-8, ambiguous: true }])('handles far-origin edge separation $separation without guessing a match', ({ separation, ambiguous }) => {
    const first = makeLine([1e8, 0, 0], [1e8 + 10, 0, 0]);
    const second = makeLine([1e8, separation, 0], [1e8 + 10, separation, 0]);
    const firstIdentity = first.clone();
    const compound = makeCompound([first, second]).asShape3D(); const topology = new CadKernelTopology(compound);
    try {
      const query: CadEdgeQuery = { kind: 'edges', expectedCount: 1, predicates: [{ kind: 'line-endpoints', start: [1e8 + 10, 0, 0], end: [1e8, 0, 0] }] };
      if (ambiguous) expect(() => topology.selectedEdges(selection(query), {})).toThrow('matched 2 element');
      else {
        const edges = topology.selectedEdges(selection(query), {});
        expect(edges).toHaveLength(1); expect(edges[0].wrapped.IsSame(firstIdentity.wrapped)).toBe(true);
      }
    } finally { topology.dispose(); compound.delete(); firstIdentity.delete(); first.delete(); second.delete(); }
  });
  it('retains world-frame outward planar normals through rotation and large translation', () => {
    const transformed: CadFeature = { ...base('moved'), kind: 'transform', sourceId: 'pad', rotation: [0, 0, 37], translation: [1e8, -1e8, 50] };
    const model = buildCadKernelModel(document([transformed])); let opening: CadFaceQuery | undefined;
    try {
      expect(model.result.diagnostics).toEqual([]);
      const inspected = model.inspectTopology({ bodyId: 'moved', expectedBuildId: model.result.buildId, selection: { kind: 'page', topology: 'face', offset: 0, limit: 100 } });
      expect(isCadTopologyInspectResult(inspected)).toBe(true);
      expect(inspected.descriptors).toHaveLength(6);
      const center: CadVector3 = [1e8 + 10 * Math.cos(37 * Math.PI / 180) - 5 * Math.sin(37 * Math.PI / 180),
        -1e8 + 10 * Math.sin(37 * Math.PI / 180) + 5 * Math.cos(37 * Math.PI / 180), 52.5];
      for (const descriptor of inspected.descriptors) {
        if (descriptor.kind !== 'face' || descriptor.surfaceType !== 'plane') throw new Error('Expected planar face');
        expect(Math.abs(dot(descriptor.normal, descriptor.centroid) - descriptor.offset)).toBeLessThan(2e-7);
        const outward: CadVector3 = [descriptor.centroid[0] - center[0], descriptor.centroid[1] - center[1], descriptor.centroid[2] - center[2]];
        expect(dot(descriptor.normal, outward)).toBeGreaterThan(0);
      }
      const top = inspected.descriptors.find(descriptor => descriptor.kind === 'face' && descriptor.surfaceType === 'plane' && descriptor.normal[2] > .99);
      if (!top) throw new Error('Missing top');
      const resolved = model.resolveTopologyPicks({ bodyId: 'moved', expectedBuildId: model.result.buildId, purpose: 'shell', picks: [{ kind: 'face', key: top.key }] });
      if (resolved.purpose !== 'shell') throw new Error('Expected opening query'); opening = resolved.opening;
    } finally { model.dispose(); }
    const hollow = buildCadKernelModel(document([transformed, { ...base('shell'), kind: 'shell', targetId: 'moved', thickness: 1, opening }]));
    try { expect(hollow.result.diagnostics).toEqual([]); expect(hollow.result.meshes[0].volume).toBeCloseTo(424, 4); }
    finally { hollow.dispose(); }
  });
  it('keeps reflected face orientation and opens an inward shell through the mirrored bottom', () => {
    const reflected: CadFeature = { ...base('mirrored'), kind: 'mirror', sourceId: 'pad', plane: 'XY' };
    const model = buildCadKernelModel(document([reflected])); let opening: CadFaceQuery | undefined;
    try {
      expect(model.result.diagnostics).toEqual([]);
      const faces = model.inspectTopology({ bodyId: 'mirrored', expectedBuildId: model.result.buildId, selection: { kind: 'page', topology: 'face', offset: 0, limit: 100 } }).descriptors;
      for (const face of faces) {
        if (face.kind !== 'face' || face.surfaceType !== 'plane') throw new Error('Expected planar face');
        const outward: CadVector3 = [face.centroid[0] - 10, face.centroid[1] - 5, face.centroid[2] + 2.5];
        expect(dot(face.normal, outward)).toBeGreaterThan(0);
      }
      const bottom = faces.find(face => face.kind === 'face' && face.surfaceType === 'plane' && face.normal[2] < -.99);
      if (!bottom || bottom.kind !== 'face' || bottom.surfaceType !== 'plane') throw new Error('Missing outward mirrored bottom');
      expect(bottom.offset).toBeCloseTo(5, 8); expect(bottom.centroid[2]).toBeCloseTo(-5, 8);
      const resolved = model.resolveTopologyPicks({ bodyId: 'mirrored', expectedBuildId: model.result.buildId, purpose: 'shell', picks: [{ kind: 'face', key: bottom.key }] });
      if (resolved.purpose !== 'shell') throw new Error('Expected opening query'); opening = resolved.opening;
    } finally { model.dispose(); }
    const hollow = buildCadKernelModel(document([reflected, { ...base('shell'), kind: 'shell', targetId: 'mirrored', thickness: 1, opening }]));
    try {
      expect(hollow.result.diagnostics).toEqual([]);
      expect(hollow.result.meshes.find(mesh => mesh.featureId === 'shell')?.volume).toBeCloseTo(424, 6);
      expect(hollow.result.meshes.find(mesh => mesh.featureId === 'pad')?.volume).toBeCloseTo(1000, 6);
    } finally { hollow.dispose(); }
  });
});
