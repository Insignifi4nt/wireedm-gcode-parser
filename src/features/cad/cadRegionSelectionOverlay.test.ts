import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import { createCadRegionSelectionOverlay } from './cadRegionSelectionOverlay';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { cadFramePointToWorld, prepareCadDatumFrames, resolveCadSketchPlacement } from '@/domain/cad/cadDatumPlanes';
import { sketch } from '@/domain/cad/__tests__/cadSketchRegionFixtures';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { cadSketchRegionSelectionCount } from '@/domain/cad/cadSketchRegionSelection';
import { measureCadResolvedProfile } from '@/domain/cad/cadMeasurements';

function command(origin = 0, datum = false) {
  const source = sketch();
  const placed: CadSketchFeature = { ...source, offset: 5,
    ...(datum ? { plane: { kind: 'datum-plane', featureId: 'datum' } } : { profiles: source.profiles.map(profile => {
      if (profile.geometry.kind !== 'circle') throw new Error('Expected circles');
      return { ...profile, geometry: { ...profile.geometry, x: profile.geometry.x as number + origin, y: origin } };
    }) }) };
  const frames = prepareCadDatumFrames([{ id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false,
    definition: { kind: 'world', basePlane: 'XY', origin: [origin, origin, origin], rotation: [30, 40, 20] } }], {});
  return { kind: 'pick-regions', owner: 'editor', expectedVersion: 'accepted', label: 'Areas', sketchId: placed.id,
    cells: prepareCadSketchCells(placed, {}), placement: resolveCadSketchPlacement(placed, {}, frames), selection: undefined,
    onSelect: vi.fn(), onFinish: vi.fn(), onCancel: vi.fn() } satisfies CadFeatureRegionPickCommand;
}
function rayAt(value: CadFeatureRegionPickCommand, x: number, y: number) {
  const point = new THREE.Vector3(...cadFramePointToWorld(value.placement.frame, value.placement.offsetMm, [x, y]));
  const normal = new THREE.Vector3(...value.placement.frame.normal);
  return new THREE.Ray(point.addScaledVector(normal, 100), normal.negate());
}
function meshes(overlay: ReturnType<typeof createCadRegionSelectionOverlay>) {
  return overlay.group.children.filter(child => child instanceof THREE.Mesh).map(child => {
    if (!(child instanceof THREE.Mesh) || !(child.material instanceof THREE.MeshBasicMaterial)) throw new Error('Missing shaded cell');
    return { mesh: child, geometry: child.geometry, material: child.material, id: child.userData.boundaryProfileId as string };
  });
}
const ids = (selection: ReturnType<ReturnType<typeof createCadRegionSelectionOverlay>['selectionForRay']>) => {
  if (selection === null) return undefined;
  if (!Array.isArray(selection)) throw new Error('Expected contour selection in this legacy fixture.');
  return selection.map(cell => cell.boundaryProfileId).sort();
};

describe('analytic closed-area viewport overlay', () => {
  it('picks the true circle lens and unions adjacent graph cells while cancellation keeps the old selection exact', () => {
    const source: CadSketchFeature = { id: 'overlap', kind: 'sketch', name: 'Overlap', suppressed: false, plane: 'XY', offset: 5, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [6, 0] }], entities: [
        { id: 'left', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
        { id: 'right', kind: 'circle', construction: false, centerPointId: 'b', radius: 5 }], relations: []
    } };
    const saved = JSON.stringify(source), cells = prepareCadSketchCells(source, {}, 'graph-cells');
    const baseline = [{ boundaryProfileId: 'old-cycle', voidProfileIds: [], ancestorProfileIds: [] }];
    const current = { ...command(), sketchId: source.id, cells, placement: resolveCadSketchPlacement(source, {}), selection: baseline };
    const overlay = createCadRegionSelectionOverlay(); overlay.update(current);
    try {
      expect(cells.cells).toHaveLength(3);
      const shaded = overlay.group.children.filter(child => child instanceof THREE.Mesh);
      const materials = shaded.map(mesh => { if (!(mesh.material instanceof THREE.MeshBasicMaterial)) throw new Error('Missing cell material'); return mesh.material; });
      expect(materials.every(material => material.opacity === .09)).toBe(true);
      const lens = overlay.pick(rayAt(current, 3, 0)); expect(lens?.areaMm2).toBeCloseTo(50 * Math.acos(.6) - 24, 10);
      const single = overlay.selectionForRay(rayAt(current, 3, 0), false); if (!single) throw new Error('Lens selection missing.');
      expect(cadSketchRegionSelectionCount(single)).toBe(1);
      overlay.update({ ...current, selection: single });
      const joined = overlay.selectionForRay(rayAt(current, -2, 0), true); if (!joined) throw new Error('Disk union missing.');
      const material = cells.resolve(joined); expect(material).toHaveLength(1); expect(material[0].voids).toEqual([]);
      expect(measureCadResolvedProfile(material[0].boundary.geometry).areaMm2).toBeCloseTo(25 * Math.PI, 10);
      overlay.hover(rayAt(current, 3, 0)); overlay.hover(null);
      const empty = overlay.selectionForRay(rayAt(current, 3, 0), true); if (!empty) throw new Error('Empty area choice missing.');
      expect(cadSketchRegionSelectionCount(empty)).toBe(0); overlay.update({ ...current, selection: empty });
      expect(materials.every(material => material.opacity === .09)).toBe(true);
      overlay.update(current);
      expect(materials.every(material => material.opacity === .09)).toBe(true);
      expect(overlay.group.children.filter(child => child instanceof THREE.Mesh)).toEqual(shaded);
      expect(current.selection).toEqual(baseline); expect(JSON.stringify(source)).toBe(saved);
      if (!source.graph) throw new Error('Source graph missing.');
      const changed = prepareCadSketchCells({ ...source, graph: { ...source.graph,
        entities: source.graph.entities.map(entity => entity.id === 'left' ? { ...entity, id: 'replacement' } : entity) } }, {}, 'graph-cells');
      expect(() => changed.resolve(single)).toThrow(expect.objectContaining({ code: 'stale-sketch-region' }));
      expect(() => overlay.update({ ...current, cells: changed, selection: single })).not.toThrow();
      const repaired = overlay.selectionForRay(rayAt(current, 3, 0), false); if (!repaired) throw new Error('Deliberate replacement missing.');
      expect(changed.resolve(repaired)).toHaveLength(1);
    } finally { overlay.dispose(); }
  });

  it.each([[0, false], [100000000, false], [100000000, true]] as const)('picks actual prepared cells in placement at origin %s/datum %s independently of GPU sampling', (origin, datum) => {
    const current = command(origin, datum), before = JSON.stringify(current.cells.cells);
    const overlay = createCadRegionSelectionOverlay(); overlay.update(current);
    const local = datum ? 0 : origin;
    try {
      expect(overlay.pick(rayAt(current, local + 4, local))?.name).toBe('bore');
      expect(overlay.pick(rayAt(current, local, local))?.name).toBe('island');
      expect(overlay.pick(rayAt(current, local + 8, local))?.name).toBe('outer');
      expect(overlay.pick(rayAt(current, local + 50, local))).toBeNull();
      expect(ids(overlay.selectionForRay(rayAt(current, local + 4, local), false))).toEqual(['bore']);
      expect(ids(overlay.selectionForRay(rayAt(current, local + 4, local), true))).toEqual(['bore', 'island', 'outer', 'separate']);
      expect(ids(overlay.selectionForRay(rayAt(current, local + 8, local), true))).toEqual(['island', 'separate']);
      const shaded = meshes(overlay); expect(shaded).toHaveLength(4);
      const outlines = overlay.group.children.filter(child => child instanceof THREE.LineLoop);
      expect(outlines).toHaveLength(4);
      for (const cell of shaded) {
        expect(cell.material.depthTest).toBe(false); expect(cell.material.depthWrite).toBe(false);
        for (const component of cell.geometry.getAttribute('position').array) expect(Math.abs(component)).toBeLessThanOrEqual(10);
      }
      // Destructively alter only an uploaded display mesh: analytic picking must
      // still read the immutable prepared cell, not triangulated ray hits.
      shaded[0].geometry.getAttribute('position').array.fill(0);
      expect(overlay.pick(rayAt(current, local + 4, local))?.name).toBe('bore');
      expect(JSON.stringify(current.cells.cells)).toBe(before);
    } finally { overlay.dispose(); }
  });

  it('shades nested void cells faithfully, reuses resources for selection/hover and disposes them on owner exit', () => {
    const current = command(), overlay = createCadRegionSelectionOverlay(); overlay.update(current);
    const initial = meshes(overlay), byId = new Map(initial.map(cell => [cell.id, cell]));
    const intersect = (id: string, x: number) => {
      const raycaster = new THREE.Raycaster(); raycaster.ray.copy(rayAt(current, x, 0));
      overlay.group.updateMatrixWorld(true); return raycaster.intersectObject(byId.get(id)!.mesh, false);
    };
    try {
      expect(intersect('outer', 4)).toEqual([]); expect(intersect('bore', 4).length).toBeGreaterThan(0);
      expect(intersect('bore', 0)).toEqual([]); expect(intersect('island', 0).length).toBeGreaterThan(0);
      const bore = current.cells.cells.find(cell => cell.reference.boundaryProfileId === 'bore')!;
      const geometryDisposals = initial.map(cell => vi.spyOn(cell.geometry, 'dispose'));
      const materialDisposals = initial.map(cell => vi.spyOn(cell.material, 'dispose'));
      const outlineDisposals = overlay.group.children.filter(child => child instanceof THREE.LineLoop).flatMap(line => {
        if (!(line.material instanceof THREE.LineBasicMaterial)) throw new Error('Missing outline material');
        return [vi.spyOn(line.geometry, 'dispose'), vi.spyOn(line.material, 'dispose')];
      });
      overlay.update({ ...current, placement: { ...current.placement }, selection: [bore.reference] });
      expect(meshes(overlay).map(cell => cell.geometry)).toEqual(initial.map(cell => cell.geometry));
      expect(byId.get('bore')!.material.opacity).toBeGreaterThan(byId.get('outer')!.material.opacity);
      const selectedOpacity = byId.get('bore')!.material.opacity;
      expect(overlay.hover(rayAt(current, 4, 0))).toBe(true);
      expect(byId.get('bore')!.material.opacity).toBeGreaterThan(selectedOpacity);
      expect(overlay.hover(null)).toBe(true); expect(byId.get('bore')!.material.opacity).toBe(selectedOpacity);
      expect(ids(overlay.selectionForRay(rayAt(current, 4, 0), true))).toEqual([]);
      for (const disposal of [...geometryDisposals, ...materialDisposals, ...outlineDisposals]) expect(disposal).not.toHaveBeenCalled();
      overlay.update(null); expect(overlay.group.children).toEqual([]);
      for (const disposal of [...geometryDisposals, ...materialDisposals, ...outlineDisposals]) expect(disposal).toHaveBeenCalledTimes(1);
      overlay.dispose(); for (const disposal of [...geometryDisposals, ...materialDisposals, ...outlineDisposals]) expect(disposal).toHaveBeenCalledTimes(1);
    } finally { overlay.dispose(); }
  });

  it('honors concave analytic boundaries and rejects parallel, edge-on and backwards rays', () => {
    const shape: CadSketchFeature = { ...sketch(), profiles: [{ id: 'concave', name: 'Concave', construction: false,
      geometry: { kind: 'path', segments: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]].map((start, index, points) => ({
        kind: 'line', start: [start[0], start[1]], end: [points[(index + 1) % points.length][0], points[(index + 1) % points.length][1]] })) } }] };
    const current = { ...command(), cells: prepareCadSketchCells(shape, {}), selection: [] }, overlay = createCadRegionSelectionOverlay(); overlay.update(current);
    try {
      expect(overlay.pick(rayAt(current, 8, 8))).toBeNull();
      expect(ids(overlay.selectionForRay(rayAt(current, 2, 8), true))).toEqual(['concave']);
      const mesh = meshes(overlay)[0].mesh, raycaster = new THREE.Raycaster(); overlay.group.updateMatrixWorld(true);
      raycaster.ray.copy(rayAt(current, 8, 8)); expect(raycaster.intersectObject(mesh)).toEqual([]);
      for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(1, 0, -1e-12).normalize(), new THREE.Vector3(0, 0, 1)])
        expect(overlay.pick(new THREE.Ray(new THREE.Vector3(2, 2, 100), direction))).toBeNull();
    } finally { overlay.dispose(); }
  });

  it('retains a clockwise major arc in both faithful boundary shading and independent analytic picking', () => {
    const source: CadSketchFeature = { ...sketch(), profiles: [{ id: 'curved', name: 'Curved', construction: false,
      geometry: { kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: -270 },
        { kind: 'line', start: [0, 10], end: [10, 0] }] } }] };
    const original = JSON.stringify(source), current = { ...command(), cells: prepareCadSketchCells(source, {}) };
    const overlay = createCadRegionSelectionOverlay(); overlay.update(current);
    try {
      expect(current.cells.cells[0].areaMm2).toBeCloseTo(75 * Math.PI + 50, 10);
      expect(overlay.pick(rayAt(current, -5, 0))?.name).toBe('Curved');
      expect(overlay.pick(rayAt(current, 6, 6))).toBeNull();
      const raycaster = new THREE.Raycaster(), mesh = meshes(overlay)[0].mesh; overlay.group.updateMatrixWorld(true);
      raycaster.ray.copy(rayAt(current, -5, 0)); expect(raycaster.intersectObject(mesh).length).toBeGreaterThan(0);
      raycaster.ray.copy(rayAt(current, 6, 6)); expect(raycaster.intersectObject(mesh)).toEqual([]);
      const bounds = overlay.getBounds(); expect(bounds).not.toBeNull();
      // Preserve the shared analytic bounds' conservative arithmetic enclosure.
      for (const axis of ['x', 'y'] as const) {
        expect(bounds!.min[axis]).toBeLessThanOrEqual(-10); expect(bounds!.min[axis]).toBeCloseTo(-10, 12);
        expect(bounds!.max[axis]).toBeGreaterThanOrEqual(10); expect(bounds!.max[axis]).toBeCloseTo(10, 12);
      }
      expect(bounds!.min.z).toBe(5); expect(bounds!.max.z).toBe(5);
      expect(JSON.stringify(source)).toBe(original);
    } finally { overlay.dispose(); }
  });
});
