import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CadCurveFeature, CadPathSegment } from '@/domain/cad/cadDocument';
import { MAX_CAD_REFERENCE_DISPLAY_SEGMENTS, pickCadCurveReference, prepareCadCurveReferences } from './cadCurveRendering';

const line = (plane: CadCurveFeature['plane'] = 'XY', offset = 0): CadCurveFeature => ({ id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane, offset,
  segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }] });
function reference(curve = line()) {
  const prepared = prepareCadCurveReferences([curve], {});
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(prepared[0].positions, 3));
  const lines = new THREE.LineSegments(geometry); lines.userData.featureId = curve.id; return lines;
}

describe('curve display geometry', () => {
  it('maps exact local geometry to the shared signed world basis without changing source expressions', () => {
    const curve = { ...line('XZ', 4), segments: [{ kind: 'line' as const, start: [0, 'rise'] as const, end: [10, 'rise'] as const }] };
    expect(prepareCadCurveReferences([curve], { rise: 3 })[0]).toMatchObject({ positions: [0, -4, 3, 10, -4, 3], bounds: { min: [0, -4, 3], max: [10, -4, 3] } });
    expect(curve.segments[0].start[1]).toBe('rise');
    expect(prepareCadCurveReferences([{ ...curve, suppressed: true }], { rise: 3 })).toEqual([]);
  });

  it('keeps clockwise major-arc traversal and endpoints in display samples', () => {
    const curve: CadCurveFeature = { ...line(), segments: [{ kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: -270 }] };
    const result = prepareCadCurveReferences([curve], {})[0];
    expect(result.positions.slice(0, 3)).toEqual([5, 0, 0]); expect(result.positions[4]).toBeLessThan(0);
    expect(result.positions.at(-3)).toBeCloseTo(0); expect(result.positions.at(-2)).toBeCloseTo(5);
    expect(curve.segments[0]).toMatchObject({ sweep: -270 });
  });

  it('bounds aggregate display sampling at the document edge budget', () => {
    const segments: readonly CadPathSegment[] = Array.from({ length: 256 }, (_, index) => ({ kind: 'arc', center: [index * 2 + 1, 0], radius: 1, startAngle: 180, sweep: index % 2 ? 180 : -180 }));
    const curves: CadCurveFeature[] = Array.from({ length: 32 }, (_, index) => ({ ...line(), id: `rail_${index}`, offset: index * 5, segments }));
    const result = prepareCadCurveReferences(curves, {});
    expect(result).toHaveLength(32); expect(result.reduce((sum, curve) => sum + curve.positions.length / 6, 0)).toBe(MAX_CAD_REFERENCE_DISPLAY_SEGMENTS);
  });
});

describe('reference feature picking', () => {
  it.each([1, 2])('uses six pixels at zoom %s without relying on body topology', zoom => {
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 1000); camera.position.set(5, 0, 100); camera.zoom = zoom;
    camera.lookAt(5, 0, 0); camera.updateProjectionMatrix(); camera.updateMatrixWorld(); const raycaster = new THREE.Raycaster(); const lines = reference();
    const pick = (pixels: number) => { raycaster.setFromCamera(new THREE.Vector2(0, pixels * 2 / 400), camera); return pickCadCurveReference({ raycaster, references: [lines], bodies: [], camera, viewportHeight: 400 }); };
    expect(pick(5)).toBe('rail'); expect(pick(7)).toBeNull(); lines.geometry.dispose();
  });

  it('rejects hidden references behind a solid and selects a visible reference in front', () => {
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.01, 1000); camera.position.set(5, 0, 100); camera.lookAt(5, 0, 0); camera.updateMatrixWorld();
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(), camera);
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 2, 2)); body.position.set(5, 0, 1); body.updateMatrixWorld();
    const hidden = reference(), visible = reference(line('XY', 3));
    expect(pickCadCurveReference({ raycaster, references: [hidden], bodies: [body], camera, viewportHeight: 400 })).toBeNull();
    expect(pickCadCurveReference({ raycaster, references: [visible], bodies: [body], camera, viewportHeight: 400 })).toBe('rail');
    hidden.geometry.dispose(); visible.geometry.dispose(); body.geometry.dispose();
  });
});
