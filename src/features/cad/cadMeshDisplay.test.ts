// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { prepareCadMeshDisplay } from './cadMeshDisplay';

/** Two native planar strips share a seam, with duplicated face vertices. */
function foldedDisplayFixture(degrees: number, scale = 1): CadMesh {
  const a = degrees * Math.PI / 180, s = Math.sin(a), c = Math.cos(a);
  return { featureId: 'fold', name: 'Fold',
    positions: [-scale, 0, 0, 0, 0, 0, 0, scale, 0, -scale, scale, 0,
      0, 0, 0, c * scale, 0, -s * scale, c * scale, scale, -s * scale, 0, scale, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
      s, 0, c, s, 0, c, s, 0, c, s, 0, c],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    edges: [0, 0, 0, 0, scale, 0, -scale, 0, 0, -scale, scale, 0],
    faceGroups: [{ key: 'left', start: 0, count: 6 }, { key: 'right', start: 6, count: 6 }],
    edgeGroups: [{ key: 'seam', start: 0, count: 2 }, { key: 'boundary', start: 2, count: 2 }],
    bounds: { min: [-scale, 0, -s * scale], max: [scale, scale, 0] }, volume: 1 };
}

describe('CAD presentation independent from exact topology', () => {
  it('suppresses a near-smooth construction seam, smooths its lighting and retains the open boundary and complete pick source', () => {
    const mesh = foldedDisplayFixture(8), original = structuredClone(mesh), display = prepareCadMeshDisplay(mesh);
    expect(display.edges).toEqual(mesh.edges.slice(6));
    const expected = [Math.sin(4 * Math.PI / 180), 0, Math.cos(4 * Math.PI / 180)];
    for (const vertex of [1, 2, 4, 7]) display.normals.slice(vertex * 3, vertex * 3 + 3).forEach((n, axis) => expect(n).toBeCloseTo(expected[axis], 12));
    expect(display.normals.slice(0, 3)).toEqual([0, 0, 1]);
    expect(mesh).toEqual(original);
  });

  it('retains real sharp corners and their original native normals', () => {
    const mesh = foldedDisplayFixture(45), display = prepareCadMeshDisplay(mesh);
    expect(display.edges).toEqual(mesh.edges);
    display.normals.forEach((n, i) => expect(n).toBeCloseTo(mesh.normals[i], 12));
  });

  it.each([1e-8, 1e8])('does not quantize away geometry at scale %s or change its coordinates', scale => {
    const mesh = foldedDisplayFixture(8, scale), original = structuredClone(mesh), display = prepareCadMeshDisplay(mesh);
    expect(display.edges).toEqual(mesh.edges.slice(6));
    expect(mesh).toEqual(original);
    expect(display.normals[3]).toBeCloseTo(Math.sin(4 * Math.PI / 180), 12);
  });

  it('keeps native segments whose triangulation cannot prove a shared near-smooth boundary', () => {
    const mesh = foldedDisplayFixture(8);
    const unmatched = { ...mesh, edges: [0, 0, .1, 0, 1, .1], edgeGroups: [{ key: 'unmatched', start: 0, count: 2 }] };
    expect(prepareCadMeshDisplay(unmatched).edges).toEqual(unmatched.edges);
  });
});
