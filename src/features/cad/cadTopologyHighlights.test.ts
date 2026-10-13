// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { createCadTopologyHighlights } from './cadTopologyHighlights';

const mesh: CadMesh = { featureId: 'body', name: 'Body', positions: [0, 0, 0, 10, 0, 0, 10, 10, 0], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1], indices: [0, 1, 2],
  edges: [0, 0, 0, 10, 0, 0, 10, 0, 0, 10, 10, 0], edgeGroups: [{ start: 0, count: 2, key: 'first' }, { start: 2, count: 2, key: 'second' }], faceGroups: [{ start: 0, count: 3, key: 'face' }],
  volume: 0, bounds: { min: [0, 0, 0], max: [10, 10, 0] } };

describe('CAD rendered topology highlights', () => {
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
