import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import { cadProfileToEntities, resolveCadProfile } from '@/domain/cad/cadSketchGeometry';
import { closedPathContainsPoint } from '@/domain/path-intel/pathContainment';
import { createArcSegment, createCircleSegment, createLineSegment, signedAreaOfPath } from '@/domain/path-intel/segments';
import type { PathSegment, Point2 } from '@/domain/path-intel/types';
import type { SketchPoint } from './cadSketchInteraction';
import { inspectCadSketchHandles, type CadSketchHandleDescriptor } from '@/domain/cad/cadSketchHandles';

export interface CadSketchHandlePick extends CadSketchHandleDescriptor { readonly profileId: string }

/** Grip eligibility precedes contour picking, so a vertex never falls through to a whole-profile move. */
export function createCadSketchHandlePicker(profiles: readonly CadSketchProfile[], parameters: Readonly<Record<string, number>>) {
  const handles = profiles.flatMap(profile => {
    try { return inspectCadSketchHandles(profile, parameters).map(handle => ({ ...handle, profileId: profile.id })); }
    catch { return []; }
  });
  return {
    handles,
    pick(point: SketchPoint, millimetersPerPixel: number, preferredProfileId?: string | null): CadSketchHandlePick | null {
      if (!point.every(Number.isFinite) || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return null;
      const tolerance = CAD_SKETCH_PICK_RADIUS_PX * millimetersPerPixel;
      let selected: CadSketchHandlePick | null = null, closest = tolerance, selectedPreferred = false;
      for (const handle of handles) {
        const distance = Math.hypot(point[0] - handle.point[0], point[1] - handle.point[1]);
        if (distance > tolerance) continue;
        const preferred = handle.profileId === preferredProfileId;
        // Visible owned grips precede hidden ones. Equal-distance ties retain
        // prepared profile/handle order, including locked grips.
        if (!selected || preferred && !selectedPreferred || preferred === selectedPreferred && distance < closest) {
          selected = handle; closest = distance; selectedPreferred = preferred;
        }
      }
      return selected;
    }
  };
}

export const CAD_SKETCH_PICK_RADIUS_PX = 6;
const tau = 2 * Math.PI;
function boundaryDistance(point: Point2, segment: PathSegment): number {
  if (segment.kind === 'circle') return Math.abs(Math.hypot(point.x - segment.center.x, point.y - segment.center.y) - segment.radius);
  if (segment.kind === 'line') {
    const dx = segment.end.x - segment.start.x; const dy = segment.end.y - segment.start.y;
    const square = dx * dx + dy * dy;
    const fraction = square === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / square));
    return Math.hypot(point.x - segment.start.x - fraction * dx, point.y - segment.start.y - fraction * dy);
  }
  const endpoint = Math.min(Math.hypot(point.x - segment.start.x, point.y - segment.start.y), Math.hypot(point.x - segment.end.x, point.y - segment.end.y));
  const angle = Math.atan2(point.y - segment.center.y, point.x - segment.center.x);
  const travelled = ((segment.clockwise ? segment.startAngleRadians - angle : angle - segment.startAngleRadians) % tau + tau) % tau;
  return travelled <= Math.abs(segment.sweepRadians) + 16 * Number.EPSILON || tau - travelled <= 16 * Number.EPSILON
    ? Math.min(endpoint, Math.abs(Math.hypot(point.x - segment.center.x, point.y - segment.center.y) - segment.radius)) : endpoint;
}

/** Prepare once per immutable geometry snapshot, not on every pointer movement. */
export function createCadSketchProfilePicker(profiles: readonly CadSketchProfile[], parameters: Readonly<Record<string, number>>) {
  const prepared = profiles.flatMap(profile => {
    try {
      const segments = cadProfileToEntities(resolveCadProfile(profile.geometry, parameters)).map((entity, index): PathSegment => {
        const common = { id: `pick_${index}`, source: { sourceEntityIndex: index, sourceEntityType: entity.type, layer: null, exact: true } };
        if (entity.type === 'line') return createLineSegment({ ...common, start: entity.start, end: entity.end });
        if (entity.type === 'circle') return createCircleSegment({ ...common, center: entity.center, radius: entity.radius });
        if (entity.type === 'arc') return createArcSegment({ ...common, center: entity.center, radius: entity.radius,
          start: entity.start, end: entity.end, clockwise: entity.clockwise, sweepRadians: entity.sweepRadians });
        throw new Error('Only exact CAD line, circle and arc boundaries are pickable.');
      });
      const refs = segments.map(segment => ({ segmentId: segment.id, reversed: false }));
      const byId = new Map(segments.map(segment => [segment.id, segment]));
      return [{ id: profile.id, construction: profile.construction, segments, area: Math.abs(signedAreaOfPath(refs, byId)),
        contains: (point: Point2) => closedPathContainsPoint(refs, point, byId) }];
    } catch { return []; } // Invalid geometry keeps its existing property/build diagnostic.
  });
  return {
    hasProfile(id: string): boolean { return prepared.some(profile => profile.id === id); },
    pick(point: SketchPoint, millimetersPerPixel: number): string | null {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || !Number.isFinite(millimetersPerPixel) || millimetersPerPixel <= 0) return null;
      const location = { x: point[0], y: point[1] };
      const tolerance = CAD_SKETCH_PICK_RADIUS_PX * millimetersPerPixel;
      let boundary: { id: string; distance: number } | null = null;
      let interior: { id: string; area: number } | null = null;
      for (const profile of prepared) {
        const distance = profile.segments.reduce((closest, segment) => Math.min(closest, boundaryDistance(location, segment)), Infinity);
        if (distance <= tolerance && (!boundary || distance < boundary.distance)) boundary = { id: profile.id, distance };
        if (!profile.construction && profile.area > 0 && (!interior || profile.area < interior.area) && profile.contains(location)) interior = { id: profile.id, area: profile.area };
      }
      return boundary?.id ?? interior?.id ?? null;
    }
  };
}
