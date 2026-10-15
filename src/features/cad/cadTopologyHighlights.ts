import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import type { CadTopologyPickSet } from '@/domain/cad/cadTopology';
import type { CadTopologyHit } from './cadTopologyPicking';
import { cadLocalRenderPositions, cadRenderOrigin } from './cadRenderCoordinates';

/** Independent layers keep pointer hover from reallocating the selected geometry. */
export function createCadTopologyHighlights() {
  const objects = new THREE.Group();
  const selectedLayer = new THREE.Group(), hoverLayer = new THREE.Group();
  objects.add(selectedLayer, hoverLayer);
  let selectedIdentity = '', hoverIdentity = '';
  let currentMeshes: readonly CadMesh[] | null = null;
  const resolution = new THREE.Vector2(1, 1);
  function clear(layer: THREE.Group) {
    for (const child of [...layer.children]) {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) material.dispose();
      }
      layer.remove(child);
    }
  }
  function add(layer: THREE.Group, meshes: readonly CadMesh[], hit: CadTopologyHit, hover: boolean) {
    const mesh = meshes.find((entry) => entry.featureId === hit.bodyId);
    const group = (hit.pick.kind === 'face' ? mesh?.faceGroups : mesh?.edgeGroups)?.find((entry) => entry.key === hit.pick.key);
    if (!mesh || !group) return;
    const origin = cadRenderOrigin(mesh.bounds);
    const color = hover ? 0x91edff : 0xffcd78;
    if (hit.pick.kind === 'edge') {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(cadLocalRenderPositions(mesh.edges, origin, group.start * 3, (group.start + group.count) * 3));
      const material = new LineMaterial({ color, linewidth: hover ? 3 : 4, depthTest: true, transparent: true, opacity: 1 });
      material.resolution.copy(resolution);
      const lines = new LineSegments2(geometry, material);
      lines.position.set(...origin); layer.add(lines);
    } else {
      const points = new Float32Array(group.count * 3);
      for (let offset = group.start; offset < group.start + group.count; offset++) {
        const index = mesh.indices[offset] * 3;
        const target = (offset - group.start) * 3;
        for (let axis = 0; axis < 3; axis++) points[target + axis] = mesh.positions[index + axis] - origin[axis];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
      const face = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: hover ? 0.22 : 0.32,
        side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      face.position.set(...origin); layer.add(face);
    }
  }
  return {
    objects,
    resize(width: number, height: number) {
      resolution.set(Math.max(1, width), Math.max(1, height));
      objects.traverse((child) => { if (child instanceof LineSegments2 && child.material instanceof LineMaterial) child.material.resolution.copy(resolution); });
    },
    update({ meshes, selection, hover }: { meshes: readonly CadMesh[]; selection: CadTopologyPickSet | null; hover: CadTopologyHit | null }): boolean {
      if (currentMeshes !== meshes) { currentMeshes = meshes; selectedIdentity = ''; hoverIdentity = ''; }
      const nextSelected = JSON.stringify(selection);
      const hoverIsSelected = hover && selection?.bodyId === hover.bodyId && selection.picks.some((pick) => pick.kind === hover.pick.kind && pick.key === hover.pick.key);
      const nextHover = JSON.stringify([hover, Boolean(hoverIsSelected)]);
      if (nextSelected === selectedIdentity && nextHover === hoverIdentity) return false;
      if (nextSelected !== selectedIdentity) {
        selectedIdentity = nextSelected; clear(selectedLayer);
        if (selection) for (const pick of selection.picks) add(selectedLayer, meshes, { bodyId: selection.bodyId, pick }, false);
      }
      if (nextHover !== hoverIdentity) {
        hoverIdentity = nextHover; clear(hoverLayer);
        if (hover && !hoverIsSelected) add(hoverLayer, meshes, hover, true);
      }
      return true;
    },
    dispose() { clear(selectedLayer); clear(hoverLayer); currentMeshes = null; selectedIdentity = ''; hoverIdentity = ''; },
  };
}
