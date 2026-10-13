// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { createCadTopologyHighlights } from './cadTopologyHighlights';

const mesh: CadMesh = { featureId: 'body', name: 'Body', positions: [0, 0, 0, 10, 0, 0, 10, 10, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
  edges: [0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0], edgeGroups: [{ start: 0, count: 2, key: 'first' }, { start: 2, count: 2, key: 'second' }], faceGroups: [{ start: 0, count: 3, key: 'face' }],
  volume: 0, bounds: { min: [0, 0, 0], max: [10, 10, 0] } };

describe('CAD rendered topology highlights', () => {
  it('retains distinct face and edge highlight vertices at large world coordinates without mutating native arrays', () => {
    const positions = [100000000, -100000000, 200000000, 100000002, -100000000, 200000000, 100000002, -99999998, 200000000];
    // This accepted 2 mm triangle collapses when world coordinates reach Float32 first.
    expect(new Float32Array(positions)[0]).toBe(new Float32Array(positions)[3]);
    const far: CadMesh = { ...mesh, positions: Object.freeze(positions),
      edges: Object.freeze([...positions.slice(0, 6), ...positions.slice(3, 9)]),
      bounds: { min: [100000000, -100000000, 200000000], max: [100000002, -99999998, 200000000] } };
    const original = JSON.stringify(far); const highlights = createCadTopologyHighlights();
    const meshes = [far];
    const selection = { bodyId: 'body', documentVersion: 'far', buildId: 'far-build', picks: [{ kind: 'edge', key: 'second' }] } satisfies Parameters<typeof highlights.update>[0]['selection'];
    highlights.update({ meshes, selection, hover: { bodyId: 'body', pick: { kind: 'face', key: 'face' } } });
    try {
      const edge = highlights.objects.children[0]?.children[0];
      const face = highlights.objects.children[1]?.children[0];
      if (!(edge instanceof LineSegments2) || !(face instanceof THREE.Mesh)) throw new Error('Far-origin highlight missing');
      expect(edge.position.toArray()).toEqual([100000001, -99999999, 200000000]);
      expect(face.position.toArray()).toEqual(edge.position.toArray());
      expect(Array.from(face.geometry.getAttribute('position').array)).toEqual([-1, -1, 0, 1, -1, 0, 1, 1, 0]);
      const start = edge.geometry.getAttribute('instanceStart'), end = edge.geometry.getAttribute('instanceEnd');
      expect(new THREE.Vector3().fromBufferAttribute(start, 0).toArray()).toEqual([1, -1, 0]);
      expect(new THREE.Vector3().fromBufferAttribute(end, 0).toArray()).toEqual([1, 1, 0]);
      face.updateMatrixWorld(true); edge.updateMatrixWorld(true);
      expect(new THREE.Vector3().fromBufferAttribute(face.geometry.getAttribute('position'), 2).applyMatrix4(face.matrixWorld).toArray()).toEqual(positions.slice(6, 9));
      expect(new THREE.Vector3().fromBufferAttribute(end, 0).applyMatrix4(edge.matrixWorld).toArray()).toEqual(positions.slice(6, 9));
      expect(JSON.stringify(far)).toBe(original);
    } finally { highlights.dispose(); }
  });
  it('retains selected geometry while hovering other edges, resizes line widths and disposes every layer', () => {
    const highlights = createCadTopologyHighlights();
    const meshes = [mesh];
    const selection = { bodyId: 'body', documentVersion: 'v1', buildId: 'build1', picks: [{ kind: 'edge', key: 'first' }] } satisfies Parameters<typeof highlights.update>[0]['selection'];
    highlights.resize(800, 600); highlights.update({ meshes, selection, hover: null });
    const selected = highlights.objects.children[0]?.children[0];
    if (!(selected instanceof THREE.Mesh) || !(selected.material instanceof LineMaterial)) throw new Error('Selected edge overlay missing.');
    const disposed = vi.fn(); selected.geometry.addEventListener('dispose', disposed);
    try {
      expect(highlights.update({ meshes, selection, hover: { bodyId: 'body', pick: { kind: 'edge', key: 'second' } } })).toBe(true);
      expect(highlights.objects.children[0]?.children[0]).toBe(selected); expect(disposed).not.toHaveBeenCalled();
      expect(highlights.objects.children[1]?.children).toHaveLength(1);
      expect(highlights.update({ meshes, selection, hover: { bodyId: 'body', pick: { kind: 'edge', key: 'second' } } })).toBe(false);
      highlights.resize(1600, 900); expect(selected.material.resolution.toArray()).toEqual([1600, 900]);
      highlights.update({ meshes, selection, hover: { bodyId: 'body', pick: { kind: 'edge', key: 'first' } } });
      expect(highlights.objects.children[1]?.children).toHaveLength(0);
    } finally { highlights.dispose(); }
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(highlights.objects.children.every((layer) => layer.children.length === 0)).toBe(true);
  });
  it('builds only the chosen face and removes an obsolete key after mesh replacement', () => {
    const highlights = createCadTopologyHighlights();
    const selection = { bodyId: 'body', documentVersion: 'v1', buildId: 'build1', picks: [{ kind: 'face', key: 'face' }] } satisfies Parameters<typeof highlights.update>[0]['selection'];
    highlights.update({ meshes: [mesh], selection, hover: null });
    const face = highlights.objects.children[0]?.children[0];
    if (!(face instanceof THREE.Mesh)) throw new Error('Selected face overlay missing.');
    expect(face.geometry.getAttribute('position').count).toBe(3);
    const disposed = vi.fn(); face.geometry.addEventListener('dispose', disposed);
    try {
      highlights.update({ meshes: [{ ...mesh, faceGroups: [{ start: 0, count: 3, key: 'new-face' }] }], selection, hover: null });
      expect(highlights.objects.children[0]?.children).toHaveLength(0); expect(disposed).toHaveBeenCalledTimes(1);
    } finally { highlights.dispose(); }
  });
});
