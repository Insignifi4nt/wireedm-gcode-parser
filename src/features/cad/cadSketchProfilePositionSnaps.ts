import { Value } from '@sinclair/typebox/value';
import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import { CadNumberSchema } from '@/domain/cad/cadPrimitives';
import { cadProfileToEntities, resolveCadProfile } from '@/domain/cad/cadSketchGeometry';
import { createArcSegment, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { Point2 } from '@/domain/path-intel/types';
import type { CadSketchProfilePositionSnapSource, CadSketchProfileSnapLocation } from './cadSketchGeometrySnaps';

/** Accepted revision positions only. Boundary indices never become saved graph references. */
export function prepareCadSketchProfilePositionSnaps({ profiles, parameters }: {
  readonly profiles: readonly CadSketchProfile[];
  readonly parameters: Readonly<Record<string, number>>;
}): readonly CadSketchProfilePositionSnapSource[] {
  return Object.freeze(profiles.flatMap(profile => {
    const positions: CadSketchProfilePositionSnapSource[] = [], seen = new Set<string>();
    const add = (location: CadSketchProfileSnapLocation, point: Point2) => {
      // A useful hint must remain representable as a fresh numeric sketch point.
      if (!Value.Check(CadNumberSchema, point.x) || !Value.Check(CadNumberSchema, point.y)) return;
      const role = location.kind === 'arc-center' ? 'center' : location.kind, key = `${role}:${point.x}:${point.y}`;
      if (seen.has(key)) return;
      seen.add(key);
      positions.push(Object.freeze({ profileId: profile.id, location: Object.freeze({ ...location }),
        point: Object.freeze([point.x, point.y] satisfies [number, number]) }));
    };
    try {
      const resolved = resolveCadProfile(profile.geometry, parameters), boundaries = cadProfileToEntities(resolved);
      if (profile.geometry.kind !== 'plugin') {
        if (resolved.kind === 'circle' || resolved.kind === 'slot') add({ kind: 'center' }, { x: resolved.x, y: resolved.y });
        else if (resolved.kind === 'rectangle') add({ kind: 'center' }, { x: resolved.x + resolved.width / 2, y: resolved.y + resolved.height / 2 });
      }
      const single = boundaries.length === 1 ? boundaries[0] : undefined;
      if (single?.type === 'circle') add({ kind: 'center' }, single.center);
      boundaries.forEach((boundary, boundaryIndex) => {
        if (boundary.type === 'circle') return; // No endpoint or unique midpoint on a complete circle.
        if (boundary.type !== 'line' && boundary.type !== 'arc') throw new Error('Only analytic profile boundaries supply sketch snap positions.');
        // Closed contour starts own the authored joints; never tolerance-weld both ends.
        add({ kind: 'endpoint', boundaryIndex }, boundary.start);
        if (boundary.type === 'line') {
          add({ kind: 'midpoint', boundaryIndex }, { x: boundary.start.x + (boundary.end.x - boundary.start.x) / 2,
            y: boundary.start.y + (boundary.end.y - boundary.start.y) / 2 });
        } else {
          add({ kind: 'arc-center', boundaryIndex }, boundary.center);
          const arc = createArcSegment({ id: `boundary_${boundaryIndex}`, source: { sourceEntityIndex: boundaryIndex, sourceEntityType: 'arc', layer: null, exact: true },
            center: boundary.center, radius: boundary.radius, start: boundary.start, end: boundary.end, clockwise: boundary.clockwise, sweepRadians: boundary.sweepRadians });
          add({ kind: 'midpoint', boundaryIndex }, pointOnArcAtParameter(arc, { segmentId: arc.id, reversed: false }, .5));
        }
      });
      return positions;
    } catch { return []; } // Unavailable profiles retain their existing property/build diagnostic.
  }));
}
