import * as THREE from 'three';
import type { CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import type { CadPreparedSketchCell } from '@/domain/cad/cadSketchRegionInspection';
import type { CadSketchCellReference } from '@/domain/cad/cadSketchRegionSelection';
import { cadProfileToEntities, type CadAnalyticBoundary, type CadResolvedSketchContour } from '@/domain/cad/cadSketchGeometry';
import { cadFramePointToWorld } from '@/domain/cad/cadDatumPlanes';
import { cadFrameEntityBounds } from '@/domain/cad/cadFrameBounds';

/** View-only triangles and analytic picking share one immutable cell preparation. */
export function createCadRegionSelectionOverlay() {
  const group = new THREE.Group(); group.name = 'Closed sketch cells';
  let current: CadFeatureRegionPickCommand | null = null, placementKey = '', hovered: string | null = null;
  let selected = new Set<string>();
  const entries = new Map<string, { mesh: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>; outline: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> }>();
  const bounds = new THREE.Box3();
  const normal = new THREE.Vector3(), planeOrigin = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), relative = new THREE.Vector3();
  const clear = () => {
    for (const { mesh, outline } of entries.values()) { mesh.geometry.dispose(); mesh.material.dispose(); outline.geometry.dispose(); outline.material.dispose(); }
    entries.clear(); group.clear(); bounds.makeEmpty(); hovered = null;
  };
  const paint = (id: string) => {
    const entry = entries.get(id); if (!entry) return false;
    const { mesh, outline } = entry;
    const opacity = id === hovered ? .45 : selected.has(id) ? .25 : .09;
    const color = id === hovered ? 0xa6440e : 0xb84f18;
    const changed = mesh.material.opacity !== opacity || outline.material.color.getHex() !== color;
    mesh.material.opacity = opacity; outline.material.color.setHex(color); return changed;
  };
  const pick = (ray: THREE.Ray): CadPreparedSketchCell | null => {
    if (!current) return null;
    const denominator = ray.direction.dot(normal);
    // At an edge-on plane the pointer cannot identify a bounded area reliably.
    if (Math.abs(denominator) <= 1e-8) return null;
    relative.copy(ray.origin).sub(planeOrigin);
    const distance = -relative.dot(normal) / denominator;
    if (!Number.isFinite(distance) || distance < 0) return null;
    relative.addScaledVector(ray.direction, distance);
    return current.cells.pick({ x: relative.dot(u), y: relative.dot(v) });
  };
  return { group, pick, getBounds: () => bounds.isEmpty() ? null : bounds.clone(),
    update(command: CadFeatureRegionPickCommand | null) {
      const nextPlacement = command ? JSON.stringify(command.placement) : '';
      const rebuild = command?.owner !== current?.owner || command?.expectedVersion !== current?.expectedVersion
        || command?.sketchId !== current?.sketchId || command?.cells !== current?.cells || nextPlacement !== placementKey;
      if (rebuild) {
        clear();
        if (command) {
          const frame = command.placement.frame;
          normal.set(...frame.normal); u.set(...frame.u); v.set(...frame.v);
          planeOrigin.set(...cadFramePointToWorld(frame, command.placement.offsetMm, [0, 0]));
          const entities = new Map<CadResolvedSketchContour, CadAnalyticBoundary[]>();
          const boundaryEntities = (contour: CadResolvedSketchContour) => {
            let edges = entities.get(contour);
            if (!edges) {
              edges = cadProfileToEntities(contour.geometry).filter((edge): edge is CadAnalyticBoundary => edge.type === 'line' || edge.type === 'arc' || edge.type === 'circle');
              entities.set(contour, edges);
            }
            return edges;
          };
          const points = (contour: CadResolvedSketchContour, x: number, y: number) => {
            const result: THREE.Vector2[] = [];
            for (const edge of boundaryEntities(contour)) {
              if (edge.type === 'line') result.push(new THREE.Vector2(edge.start.x - x, edge.start.y - y));
              else if (edge.type === 'arc' || edge.type === 'circle') {
                const start = edge.type === 'circle' ? 0 : edge.startAngle;
                const sweep = edge.type === 'circle' ? 2 * Math.PI : edge.sweepRadians ?? edge.endAngle - edge.startAngle;
                const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 60)));
                for (let index = 0; index < steps; index++) {
                  const angle = start + sweep * index / steps;
                  result.push(index === 0 && edge.type === 'arc' ? new THREE.Vector2(edge.start.x - x, edge.start.y - y)
                    : new THREE.Vector2(edge.center.x - x + edge.radius * Math.cos(angle), edge.center.y - y + edge.radius * Math.sin(angle)));
                }
              }
            }
            return result;
          };
          try {
            for (const cell of command.cells.cells) {
              const x = cell.boundsMm.minX / 2 + cell.boundsMm.maxX / 2, y = cell.boundsMm.minY / 2 + cell.boundsMm.maxY / 2;
              const boundary = points(cell.boundary, x, y), shape = new THREE.Shape(boundary);
              shape.holes = cell.voids.map(hole => new THREE.Path(points(hole, x, y)));
              const world = cadFrameEntityBounds(boundaryEntities(cell.boundary), frame, command.placement.offsetMm);
              bounds.union(new THREE.Box3(new THREE.Vector3(...world.min), new THREE.Vector3(...world.max)));
              const geometry = new THREE.ShapeGeometry(shape, 1);
              let material: THREE.MeshBasicMaterial | undefined;
              let outlineGeometry: THREE.BufferGeometry | undefined, outlineMaterial: THREE.LineBasicMaterial | undefined;
              try {
                material = new THREE.MeshBasicMaterial({ color: 0xc87230, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.matrixAutoUpdate = false;
                mesh.matrix.makeBasis(u, v, normal);
                mesh.matrix.setPosition(new THREE.Vector3(...cadFramePointToWorld(frame, command.placement.offsetMm, [x, y])));
                mesh.renderOrder = 2; mesh.userData.boundaryProfileId = cell.reference.boundaryProfileId;
                outlineGeometry = new THREE.BufferGeometry().setFromPoints(boundary);
                outlineMaterial = new THREE.LineBasicMaterial({ color: 0xb84f18, transparent: true, depthTest: false, depthWrite: false });
                const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
                outline.matrixAutoUpdate = false; outline.matrix.copy(mesh.matrix); outline.renderOrder = 3;
                outline.userData.cadRegionBoundaryId = cell.reference.boundaryProfileId;
                group.add(mesh, outline); entries.set(cell.reference.boundaryProfileId, { mesh, outline });
              } catch (error) { geometry.dispose(); material?.dispose(); outlineGeometry?.dispose(); outlineMaterial?.dispose(); throw error; }
            }
            group.updateMatrixWorld(true);
          } catch (error) { clear(); current = null; selected.clear(); placementKey = ''; throw error; }
        }
      }
      current = command; placementKey = nextPlacement;
      selected = new Set(command ? (command.selection ?? command.cells.cells.filter(cell => cell.defaultMaterial).map(cell => cell.reference)).map(cell => cell.boundaryProfileId) : []);
      let changed = rebuild;
      for (const id of entries.keys()) changed = paint(id) || changed;
      return changed;
    },
    selectionForRay(ray: THREE.Ray, additive: boolean): readonly CadSketchCellReference[] | null {
      const cell = pick(ray); if (!cell || !current) return null;
      if (!additive) return [cell.reference];
      const next = new Set(selected);
      if (next.has(cell.reference.boundaryProfileId)) next.delete(cell.reference.boundaryProfileId); else next.add(cell.reference.boundaryProfileId);
      return current.cells.cells.filter(entry => next.has(entry.reference.boundaryProfileId)).map(entry => entry.reference);
    },
    hover(ray: THREE.Ray | null) {
      const next = ray ? pick(ray)?.reference.boundaryProfileId ?? null : null;
      if (hovered === next) return false;
      const previous = hovered; hovered = next;
      if (previous) paint(previous); if (hovered) paint(hovered); return true;
    },
    dispose() { clear(); current = null; selected.clear(); placementKey = ''; }
  };
}
