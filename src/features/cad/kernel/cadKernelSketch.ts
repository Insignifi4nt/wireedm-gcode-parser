import { Blueprint, Curve2D, DEG2RAD, draw, drawCircle, drawRoundedRectangle, Drawing, Edge, Face, getOC, Sketch, Wire } from 'replicad';
import type { gp_Trsf2d } from 'replicad-opencascadejs';
import { CadError } from '../../../domain/cad/cadError';
import { cadProfileToEntities, type ResolvedCadProfile } from '../../../domain/cad/cadSketchGeometry';
import type { CadKernelPlane } from './cadKernelPlane';
import { cadKernelDisposeOwned, cadKernelDisposeShape } from './cadKernelShapes';

/** Exact Blueprint plane conversion with deterministic native ownership.
 * Replicad 1.1's sketchOnPlane leaves its raw edge builders/3D handles alive. The axis and the
 * sketch's default vectors are made from the plane's coordinates, with the values Replicad's
 * makeAx2 and Sketch copy from its vectors, without the copies' leaked temporaries. */
export function cadKernelSketchOnPlane(drawing: Drawing, plane: CadKernelPlane): Sketch {
  const oc = getOC(), origin = plane.origin.toTuple(), normal = plane.zDir.toTuple(), xDirection = plane.xDir.toTuple();
  const axis = cadKernelAx2(origin, normal, xDirection);
  const edges: Edge[] = [];
  try {
    for (const curve of drawing.blueprint.curves) {
      const curve3d = oc.GeomLib.To3d(axis, curve.wrapped);
      try {
        const builder = new oc.BRepBuilderAPI_MakeEdge(curve3d);
        try { edges.push(new Edge(builder.Edge())); } finally { builder.delete(); }
      } finally { curve3d.delete(); }
    }
    const builder = new oc.BRepBuilderAPI_MakeWire();
    try {
      for (const edge of edges) builder.Add(edge.wrapped);
      builder.Build();
      if (builder.Error() !== oc.BRepBuilderAPI_WireError.BRepBuilderAPI_WireDone) throw new CadError('invalid-profile', 'The exact profile edges could not form a connected wire.');
      const wire = new Wire(builder.Wire());
      try { return new Sketch(wire, { defaultOrigin: origin, defaultDirection: normal }); }
      catch (error) { cadKernelDisposeShape(wire); throw error; }
    } finally { builder.delete(); }
  } finally {
    for (const edge of edges) cadKernelDisposeShape(edge);
    axis.delete();
  }
}

function cadKernelAx2(origin: readonly [number, number, number], normal: readonly [number, number, number], xDirection: readonly [number, number, number]) {
  const oc = getOC(); const point = new oc.gp_Pnt(...origin);
  try {
    const direction = new oc.gp_Dir(...normal);
    try {
      const x = new oc.gp_Dir(...xDirection);
      try { return new oc.gp_Ax2(point, direction, x); } finally { x.delete(); }
    } finally { direction.delete(); }
  } finally { point.delete(); }
}

/**
 * The planar face of an outer wire and its holes, built as Replicad's Sketch.face and
 * CompoundSketch.face build it. The caller owns the face; the sketches stay the caller's.
 * Replicad leaves CompoundSketch's intermediate outer face to garbage collection.
 */
export function cadKernelSketchFace(sketches: readonly Sketch[]): Face {
  const [outer, ...holes] = sketches;
  if (!outer) throw new CadError('empty-sketch', 'A solid feature needs a closed non-construction profile.');
  const oc = getOC(); const faceBuilder = new oc.BRepBuilderAPI_MakeFace(outer.wire.wrapped, false);
  let face: Face;
  try {
    if (!faceBuilder.IsDone()) throw new Error('Failed to build the face. Your wire might be non planar.');
    face = new Face(faceBuilder.Face());
  } finally { faceBuilder.delete(); }
  if (!holes.length) return face;
  const owned: { delete(): void }[] = [face];
  const own = <T extends { delete(): void }>(value: T): T => { owned.push(value); return value; };
  try {
    const maker = own(new oc.BRepBuilderAPI_MakeFace(face.wrapped));
    for (const hole of holes) maker.Add(hole.wire.wrapped);
    const built = own(maker.Face());
    const fixer = own(new oc.ShapeFix_Face(built));
    fixer.FixOrientation();
    return new Face(fixer.Face());
  } finally { for (const value of owned) cadKernelDisposeOwned(value); }
}

/**
 * Replicad's Drawing.translate and rotate for a one-blueprint drawing: the same gp_Trsf2d, gp_GTrsf2d and
 * GeomLib.GTransform of each curve, so the curves are the same. Replicad never deletes its gp_Trsf2d and
 * leaves the gp_Trsf2d's general form to garbage collection; both are deleted here. The caller owns the
 * new drawing, and the given one stays the caller's.
 */
function transformedDrawing(drawing: Drawing, configure: (transformation: gp_Trsf2d) => void): Drawing {
  const oc = getOC(); const { curves } = drawing.blueprint;
  const transformation = new oc.gp_Trsf2d();
  try {
    configure(transformation);
    const general = new oc.gp_GTrsf2d(transformation);
    const transformed: Curve2D[] = [];
    try {
      for (const curve of curves) transformed.push(new Curve2D(oc.GeomLib.GTransform(curve.wrapped, general)));
      return new Drawing(new Blueprint(transformed));
    } catch (error) { for (const curve of transformed) curve.delete(); throw error; }
    finally { general.delete(); }
  } finally { transformation.delete(); }
}
/** Replicad's Drawing.translate(x, y). */
export function cadKernelTranslateDrawing(drawing: Drawing, x: number, y: number): Drawing {
  return transformedDrawing(drawing, transformation => {
    const vector = new (getOC()).gp_Vec2d(x, y);
    try { transformation.SetTranslation(vector); } finally { vector.delete(); }
  });
}
/** Replicad's Drawing.rotate(angle, [0, 0]): degrees about the origin. */
export function cadKernelRotateDrawing(drawing: Drawing, angle: number): Drawing {
  return transformedDrawing(drawing, transformation => {
    const center = new (getOC()).gp_Pnt2d(0, 0);
    try { transformation.SetRotation(center, angle * DEG2RAD); } finally { center.delete(); }
  });
}

export function cadKernelProfileDrawing(profile: ResolvedCadProfile, drawings: Drawing[]): Drawing {
  const own = (drawing: Drawing) => { drawings.push(drawing); return drawing; };
  function analyticBoundary(): Drawing {
    const entities = cadProfileToEntities(profile); const first = entities[0];
    if (entities.length === 1 && first?.type === 'circle') return own(cadKernelTranslateDrawing(own(drawCircle(first.radius)), first.center.x, first.center.y));
    if (entities.length === 1 && first?.type === 'arc' && Math.abs(first.endAngle - first.startAngle) === 2 * Math.PI) {
      return own(cadKernelTranslateDrawing(own(drawCircle(first.radius)), first.center.x, first.center.y));
    }
    if (!first || first.type !== 'line' && first.type !== 'arc') throw new CadError('invalid-profile', 'A profile needs a closed analytic boundary of lines and circular arcs.');
    const pen = draw([first.start.x, first.start.y]);
    for (const entity of entities) {
      if (entity.type === 'line') pen.lineTo([entity.end.x, entity.end.y]);
      else if (entity.type === 'arc') {
        // Signed sweep preserves clockwise as well as major circular arcs.
        const midAngle = (entity.startAngle + entity.endAngle) / 2;
        pen.threePointsArcTo([entity.end.x, entity.end.y], [entity.center.x + entity.radius * Math.cos(midAngle), entity.center.y + entity.radius * Math.sin(midAngle)]);
      } else throw new CadError('invalid-profile', 'This boundary contains an unsupported curve.');
    }
    return own(pen.close());
  }
  switch (profile.kind) {
    case 'rectangle': {
      if (profile.cornerRadius === 0) return own(cadKernelTranslateDrawing(own(drawRoundedRectangle(profile.width, profile.height)), profile.x + profile.width / 2, profile.y + profile.height / 2));
      // Explicit analytic arcs also handle radius exactly half the shorter side.
      // Replicad's tangent-arc primitive fails on the zero-length straight edges.
      return analyticBoundary();
    }
    case 'circle': return own(cadKernelTranslateDrawing(own(drawCircle(profile.radius)), profile.x, profile.y));
    case 'path': return analyticBoundary();
    case 'slot': {
      // The rectangle primitive cannot accept radius equal to half its shorter side.
      const halfStraight = (profile.length - profile.width) / 2;
      const radius = profile.width / 2;
      if (halfStraight === 0) return own(cadKernelTranslateDrawing(own(drawCircle(radius)), profile.x, profile.y));
      const drawing = own(draw([-halfStraight, -radius]).lineTo([halfStraight, -radius])
        .threePointsArcTo([halfStraight, radius], [halfStraight + radius, 0])
        .lineTo([-halfStraight, radius]).threePointsArcTo([-halfStraight, -radius], [-halfStraight - radius, 0]).close());
      return own(cadKernelTranslateDrawing(own(cadKernelRotateDrawing(drawing, profile.angle)), profile.x, profile.y));
    }
    case 'polygon': {
      const first = profile.points[0];
      if (!first) throw new CadError('empty-profile', 'A polygon needs at least three points.');
      const pen = draw([first[0], first[1]]);
      for (const point of profile.points.slice(1)) pen.lineTo([point[0], point[1]]);
      return own(pen.close());
    }
    default: { const exhaustive: never = profile; throw new Error(`Unsupported profile: ${exhaustive}`); }
  }
}

