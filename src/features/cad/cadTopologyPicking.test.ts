// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { mergeTopologySelection, orthographicPixelSize, pickTopology, topologyGroupAt, validateTopologySelection } from './cadTopologyPicking';

function scene(edgeHeight = 5) {
  const camera = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
  camera.position.set(0, 0, 100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const mesh: CadMesh = { featureId: 'body', name: 'Body', positions: [-20, -20, 5, 20, -20, 5, 20, 20, 5, -20, 20, 5],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2, 0, 2, 3], edges: [0, -10, edgeHeight, 0, 10, edgeHeight],
    faceGroups: [{ start: 0, count: 6, key: 'face' }], edgeGroups: [{ start: 0, count: 2, key: 'edge' }], volume: 0,
    bounds: { min: [-20, -20, 0], max: [20, 20, 5] } };
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3)); geometry.setIndex([...mesh.indices]);
  const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); body.updateMatrixWorld();
  const lineGeometry = new THREE.BufferGeometry(); lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.edges, 3));
  const lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial()); lines.updateMatrixWorld();
  const raycaster = new THREE.Raycaster();
  const pick = (mode: 'edge' | 'face', x: number, y = 0) => {
    const projected = new THREE.Vector3(x, y, edgeHeight).project(camera);
    raycaster.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    return pickTopology({ mode, raycaster, bodies: [body], edges: [lines], meshByObject: new Map<THREE.Object3D, CadMesh>([[body, mesh], [lines, mesh]]), camera, viewportHeight: 1000 });
  };
  return { camera, mesh, pick, dispose: () => { geometry.dispose(); lineGeometry.dispose(); body.material.dispose(); lines.material.dispose(); } };
}

describe('CAD topology picking', () => {
  it('maps triangle-index and line-vertex group boundaries without mixing XYZ offsets', () => {
    const groups = [{ start: 0, count: 6, key: 'first' }, { start: 6, count: 3, key: 'second' }];
    expect(topologyGroupAt(groups, 5)?.key).toBe('first'); expect(topologyGroupAt(groups, 6)?.key).toBe('second');
    for (const offset of [-1, .5, 9]) expect(topologyGroupAt(groups, offset)).toBeNull();
    const data = scene();
    try { expect(data.pick('face', 5, -5)).toEqual({ bodyId: 'body', pick: { kind: 'face', key: 'face' } }); }
    finally { data.dispose(); }
  });
  it('keeps edge hit tolerance at six screen pixels across orthographic zoom', () => {
    const data = scene();
    try {
      for (const zoom of [.2, 1, 10]) {
        data.camera.zoom = zoom; data.camera.updateProjectionMatrix();
        const size = orthographicPixelSize(data.camera, 1000);
        expect(data.pick('edge', size * 5)).toEqual({ bodyId: 'body', pick: { kind: 'edge', key: 'edge' } });
        expect(data.pick('edge', size * 7)).toBeNull();
      }
    } finally { data.dispose(); }
  });
  it('rejects hidden edges behind a surface, including pointers near the projected edge', () => {
    const data = scene(0);
    try { expect(data.pick('edge', 0)).toBeNull(); expect(data.pick('edge', .4)).toBeNull(); }
    finally { data.dispose(); }
    const shallow = scene(4.99);
    try { expect(shallow.pick('edge', 0)).toBeNull(); }
    finally { shallow.dispose(); }
  });
  it('toggles same-body edges, rejects cross-body addition and enforces the selection limit', () => {
    const first = { documentVersion: 'v1', buildId: 'build1', bodyId: 'body', picks: [{ kind: 'edge', key: 'a' }] } satisfies Parameters<typeof mergeTopologySelection>[1];
    const second = { ...first, picks: [{ kind: 'edge', key: 'b' }] } satisfies typeof first;
    const selected = mergeTopologySelection(first, second, true);
    expect(selected.picks.map((pick) => pick.key)).toEqual(['a', 'b']);
    expect(mergeTopologySelection(selected, first, true).picks.map((pick) => pick.key)).toEqual(['b']);
    expect(() => mergeTopologySelection(first, { ...second, bodyId: 'other' }, true)).toThrow('one body');
    expect(() => mergeTopologySelection(first, { ...second, buildId: 'new' }, true)).toThrow('stale');
    const maximum = { ...first, picks: Array.from({ length: 64 }, (_, index) => ({ kind: 'edge', key: String(index) } satisfies typeof first.picks[number])) };
    expect(() => mergeTopologySelection(maximum, first, true)).toThrow('at most 64');
    expect(Object.isFrozen(selected.picks)).toBe(true);
  });
  it('rejects a key from another build or body even when the document version is unchanged', () => {
    const data = scene();
    try {
      const picked = { documentVersion: 'v1', buildId: 'build1', bodyId: 'body', picks: [{ kind: 'edge', key: 'edge' }] } satisfies Parameters<typeof validateTopologySelection>[0];
      const source = { documentVersion: 'v1', buildId: 'build1', meshes: [data.mesh], ready: true };
      expect(() => validateTopologySelection(picked, source)).not.toThrow();
      expect(() => validateTopologySelection(picked, { ...source, buildId: 'rebuilt' })).toThrow('solid build changed');
      expect(() => validateTopologySelection({ ...picked, picks: [{ kind: 'edge', key: 'elsewhere' }] }, source)).toThrow('does not belong');
      expect(() => validateTopologySelection(picked, { ...source, ready: false })).toThrow('solid build changed');
    } finally { data.dispose(); }
  });
});
