import type { CadProfile } from '@/domain/cad/cadDocument';
import type { CadSketchDimensionQuantity } from '@/domain/cad/cadSketchConstraints';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';

export interface CadAnnotationPoint { readonly x: number; readonly y: number }
type Line = readonly [CadAnnotationPoint, CadAnnotationPoint];
type Point = readonly [number, number];
export interface CadDimensionAnnotation {
  readonly measured: Line;
  readonly extensions: readonly Line[];
  readonly line: Line;
  readonly label: CadAnnotationPoint;
  readonly arc?: string;
}

/** Analytic support points use model units; extension offsets and text use screen pixels. */
export function cadSketchDimensionAnnotation(geometry: CadProfile, parameters: Readonly<Record<string, number>>, quantity: CadSketchDimensionQuantity,
  project: (point: Point) => CadAnnotationPoint): CadDimensionAnnotation | null {
  const value = (scalar: number | string) => evaluateCadScalar(scalar, parameters);
  const linear = (a: Point, b: Point, offset = 26): CadDimensionAnnotation => {
    const start = project(a), end = project(b), length = Math.hypot(end.x - start.x, end.y - start.y);
    const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
    const shift = (point: CadAnnotationPoint, distance: number) => ({ x: point.x + normal.x * distance, y: point.y + normal.y * distance });
    const first = shift(start, offset), last = shift(end, offset);
    return { measured: [start, end], extensions: [[shift(start, 4), shift(start, offset + 6)], [shift(end, 4), shift(end, offset + 6)]],
      line: [first, last], label: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 } };
  };
  switch (geometry.kind) {
    case 'rectangle': {
      const x = value(geometry.x), y = value(geometry.y), w = value(geometry.width), h = value(geometry.height);
      if (quantity === 'width') return linear([x, y], [x + w, y]);
      if (quantity === 'height') return linear([x + w, y], [x + w, y + h]);
      return null;
    }
    case 'circle': {
      const x = value(geometry.x), y = value(geometry.y), r = value(geometry.radius), diagonal = r / Math.SQRT2;
      const center = project([x, y]), end = project([x + diagonal, y + diagonal]);
      if (quantity === 'diameter') {
        const start = project([x - diagonal, y - diagonal]);
        return { measured: [start, end], extensions: [], line: [start, end], label: center };
      }
      if (quantity === 'radius') {
        const length = Math.hypot(end.x - center.x, end.y - center.y), label = { x: end.x + (end.x - center.x) / length * 22, y: end.y + (end.y - center.y) / length * 22 };
        return { measured: [center, end], extensions: [[end, label]], line: [center, end], label };
      }
      return null;
    }
    case 'slot': {
      const x = value(geometry.x), y = value(geometry.y), length = value(geometry.length), width = value(geometry.width), angle = value(geometry.angle) * Math.PI / 180;
      const local = (u: number, v: number): Point => [x + u * Math.cos(angle) - v * Math.sin(angle), y + u * Math.sin(angle) + v * Math.cos(angle)];
      const center = project([x, y]), side = project(local(0, width / 2));
      const radiusPx = Math.hypot(side.x - center.x, side.y - center.y);
      if (quantity === 'length') return linear(local(-length / 2, 0), local(length / 2, 0), radiusPx + 26);
      if (quantity === 'width') return linear(local((length - width) / 2, -width / 2), local((length - width) / 2, width / 2), radiusPx + 26);
      if (quantity === 'angle') {
        // Orientation is periodic; the displayed value stays exact in the editor.
        const degrees = ((value(geometry.angle) + 180) % 360 + 360) % 360 - 180, radians = degrees * Math.PI / 180, radius = Math.max(42, radiusPx + 20);
        const at = (a: number, r: number) => ({ x: center.x + Math.cos(a) * r, y: center.y - Math.sin(a) * r });
        const start = at(0, radius), end = at(radians, radius);
        return { measured: [center, end], extensions: [[center, at(0, radius + 6)], [center, at(radians, radius + 6)]], line: [start, end],
          arc: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${degrees < 0 ? 1 : 0} ${end.x} ${end.y}`, label: at(radians / 2, radius + 14) };
      }
      return null;
    }
    case 'polygon': case 'path': case 'plugin': return null;
  }
}
