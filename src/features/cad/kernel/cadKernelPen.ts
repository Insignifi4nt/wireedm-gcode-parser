import { Blueprint, Curve2D, Drawing, getOC } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { CAD_PRECISION } from '../../../domain/precision/cadPrecision';
import { cadKernelScope as scope } from './cadKernelShapes';

/**
 * Owned profile drawing: Replicad 1.1's DrawingPen lines, three-point and sagitta arcs and close, its drawCircle, and its
 * drawRoundedRectangle without corners. Each makes Replicad's native calls with the same arithmetic and orientation checks,
 * so the curves are the same for every curve Replicad can make. A maker given coincident or collinear points is not done,
 * and its Value returns null; Replicad then throws on the null curve before it deletes its points and maker, which stay
 * alive. Here such a line or arc is refused with an invalid-profile error, every point and maker is deleted before a
 * curve is returned or an error is thrown, and a drawing that fails deletes the curves it already made.
 */
export type CadKernelPoint2 = readonly [number, number];

/** Replicad's samePoint. */
const samePoint = ([x0, y0]: CadKernelPoint2, [x1, y1]: CadKernelPoint2) =>
  Math.abs(x0 - x1) <= CAD_PRECISION.kernelProfilePointMm && Math.abs(y0 - y1) <= CAD_PRECISION.kernelProfilePointMm;

const point = ([x, y]: CadKernelPoint2) => new (getOC()).gp_Pnt2d(x, y);

/** Replicad's make2dSegmentCurve: the segment from start to end. The caller owns the curve. */
function segment(start: CadKernelPoint2, end: CadKernelPoint2): Curve2D {
  return scope(own => {
    const maker = own(new (getOC()).GC_MakeSegment2d(own(point(start)), own(point(end))));
    if (!maker.IsDone()) throw new CadError('invalid-profile', 'A profile line has no length: its ends are the same point.');
    const curve = new Curve2D(maker.Value());
    try {
      if (!samePoint(curve.firstPoint, start)) curve.reverse();
      return curve;
    } catch (error) { curve.delete(); throw error; }
  });
}
/** Replicad's make2dThreePointArc: the circular arc from start through middle to end. The caller owns the curve. */
function threePointArc(start: CadKernelPoint2, middle: CadKernelPoint2, end: CadKernelPoint2): Curve2D {
  return scope(own => {
    const maker = own(new (getOC()).GC_MakeArcOfCircle2d(own(point(start)), own(point(middle)), own(point(end))));
    if (!maker.IsDone()) throw new CadError('invalid-profile', 'A profile arc cannot be made: its start, middle and end points are the same or lie on one line.');
    const arc = maker.Value();
    try {
      const first = own(arc.Value(arc.FirstParameter()));
      if (!samePoint([first.X(), first.Y()], start)) arc.SetTrim(arc.LastParameter(), arc.FirstParameter(), true, true);
      return new Curve2D(arc);
    } catch (error) { arc.delete(); throw error; }
  });
}

/** The pen of a drawing in progress, with Replicad's DrawingPen methods and arithmetic. */
export class CadKernelPen {
  readonly #curves: Curve2D[];
  #pointer: CadKernelPoint2;
  constructor(start: CadKernelPoint2, curves: Curve2D[]) { this.#pointer = start; this.#curves = curves; }
  get pointer(): CadKernelPoint2 { return this.#pointer; }
  lineTo(end: CadKernelPoint2): this {
    const curve = segment(this.#pointer, end);
    this.#pointer = end; this.#curves.push(curve);
    return this;
  }
  line(xDistance: number, yDistance: number): this { return this.lineTo([this.#pointer[0] + xDistance, this.#pointer[1] + yDistance]); }
  threePointsArcTo(end: CadKernelPoint2, middle: CadKernelPoint2): this {
    this.#curves.push(threePointArc(this.#pointer, middle, end));
    this.#pointer = end;
    return this;
  }
  /** The arc to end whose middle stands sagitta to the left of the chord. */
  sagittaArcTo(end: CadKernelPoint2, sagitta: number): this {
    const [x0, y0] = this.#pointer, [x1, y1] = end;
    const middle = [(x0 + x1) / 2, (y0 + y1) / 2], direction = [-(y1 - y0), x1 - x0];
    const length = Math.sqrt(direction[0] ** 2 + direction[1] ** 2);
    return this.threePointsArcTo(end, [middle[0] + direction[0] / length * sagitta, middle[1] + direction[1] / length * sagitta]);
  }
  sagittaArc(xDistance: number, yDistance: number, sagitta: number): this {
    return this.sagittaArcTo([xDistance + this.#pointer[0], yDistance + this.#pointer[1]], sagitta);
  }
}

/**
 * Replicad's draw(start), the given steps and close(): a line back to start closes the outline unless the pen is already
 * there. The caller owns the drawing. If a step or the closing line fails, the curves made so far are deleted.
 */
export function cadKernelDraw(start: CadKernelPoint2, steps: (pen: CadKernelPen) => void): Drawing {
  const curves: Curve2D[] = [];
  try {
    const pen = new CadKernelPen(start, curves);
    steps(pen);
    if (!samePoint(pen.pointer, start)) pen.lineTo(start);
    return new Drawing(new Blueprint(curves));
  } catch (error) { for (const curve of curves) curve.delete(); throw error; }
}
/** Replicad's drawCircle: two half circles from (-radius, 0) through (radius, 0) and back. The caller owns the drawing. */
export function cadKernelDrawCircle(radius: number): Drawing {
  return cadKernelDraw([-radius, 0], pen => { pen.sagittaArc(2 * radius, 0, radius).sagittaArc(-2 * radius, 0, radius); });
}
/**
 * Replicad's drawRoundedRectangle(width, height) with no corner radius: centred on the origin, counterclockwise from its
 * lower left corner. A side of zero length is left out, as Replicad leaves it out. The caller owns the drawing.
 */
export function cadKernelDrawRectangle(width: number, height: number): Drawing {
  return cadKernelDraw([Math.min(0, -(width / 2)), -height / 2], pen => {
    if (0 < width / 2) pen.line(width, 0);
    if (0 < height / 2) pen.line(0, height);
    if (0 < width / 2) pen.line(-width, 0);
    if (0 < height / 2) pen.line(0, -height);
  });
}
