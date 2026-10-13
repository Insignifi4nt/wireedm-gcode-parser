import { cast, Face, getOC, isShape3D, makeAx1, measureVolume, Plane, Vector, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { CAD_SWEEP_TOPOLOGY_TOLERANCE, type CadResolvedSweepInputs } from '../../../domain/cad/cadSweep';
import { cadPlanePointToWorld } from '../../../domain/cad/cadPlanes';
import { requireCadPrincipalPlane } from '../../../domain/cad/cadDatumPlanes';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { cadKernelProfileDrawing } from './cadKernelSketch';

function validateSweepSolid(shape: Shape3D) {
  const oc = getOC(); const solids = shape.solids;
  try {
    if (solids.length !== 1) throw new CadError('sweep-invalid', 'Sweep must produce one closed solid. Revise the section or curve.');
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    try { if (!analyzer.IsValid()) throw new CadError('sweep-invalid', 'OpenCascade rejected the exact Sweep topology. Revise the section or curve.'); }
    finally { analyzer.delete(); }
    const volume = measureVolume(shape);
    if (!Number.isFinite(volume) || volume <= 1e-9) throw new CadError('sweep-volume', 'Sweep must produce positive volume with outward orientation.');
    const shells = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (shells.More()) {
        const shell = shells.Current();
        try { if (!oc.BRep_Tool.IsClosed(shell)) throw new CadError('sweep-open', 'Sweep produced an open shell. Revise the section or curve.'); }
        finally { shell.delete(); }
        shells.Next();
      }
    } finally { shells.delete(); }
    // The pure clearance certificate reserves this native tolerance separately
    // from its rigid-transform roundoff allowance. Never enlarge it to heal joins.
    for (const kind of [oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_VERTEX]) {
      const explorer = new oc.TopExp_Explorer(shape.wrapped, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        while (explorer.More()) {
          const raw = explorer.Current();
          try {
            const item = kind === oc.TopAbs_ShapeEnum.TopAbs_FACE ? oc.TopoDS.Face(raw)
              : kind === oc.TopAbs_ShapeEnum.TopAbs_EDGE ? oc.TopoDS.Edge(raw) : oc.TopoDS.Vertex(raw);
            try {
              const tolerance = oc.BRep_Tool.Tolerance(item);
              if (!Number.isFinite(tolerance) || tolerance > CAD_SWEEP_TOPOLOGY_TOLERANCE) {
                throw new CadError('unsupported-sweep-precision', 'Native Sweep topology exceeds the reserved precision. Simplify the curve or move the geometry closer to the origin.');
              }
            } finally { item.delete(); }
          } finally { raw.delete(); }
          explorer.Next();
        }
      } finally { explorer.delete(); }
    }
  } finally { solids.forEach(solid => solid.delete()); }
}

/** Exact line extrusions and signed circular revolutions, never a fitted pipe frame. */
export function buildCadSweepSolid(resolved: CadResolvedSweepInputs): Shape3D {
  const curvePlane = requireCadPrincipalPlane(resolved.curve.plane, 'Sweep');
  const sectionPlane = requireCadPrincipalPlane(resolved.section.plane, 'Sweep');
  const oc = getOC(); const basis = cadKernelPlaneBasis(sectionPlane);
  const offset = resolved.section.offset;
  const origin: SimplePoint = [basis.normal[0] * offset, basis.normal[1] * offset, basis.normal[2] * offset];
  const planes: Plane[] = []; const drawings: Drawing[] = []; const sketches: Sketch[] = [];
  const owned = new Set<{ delete(): void }>();
  const own = <T extends { delete(): void }>(value: T): T => { owned.add(value); return value; };
  const release = (value: { delete(): void }) => { value.delete(); owned.delete(value); };
  let result: Shape3D | undefined;
  try {
    const plane = new Plane(origin, basis.u, basis.normal); planes.push(plane);
    const drawing = cadKernelProfileDrawing(resolved.section.geometry, drawings);
    const sketch = drawing.blueprint.sketchOnPlane(plane); sketches.push(sketch);
    const faceBuilder = own(new oc.BRepBuilderAPI_MakeFace(sketch.wire.wrapped, true));
    if (!faceBuilder.IsDone()) throw new CadError('sweep-section', 'Sweep section did not form a planar closed face.');
    const rawFace = faceBuilder.Face(); let face: Face;
    try { face = own(new Face(oc.TopoDS.Face(rawFace))); } finally { rawFace.delete(); }
    release(faceBuilder);
    for (let index = 0; index < resolved.curve.segments.length; ++index) {
      const segment = resolved.curve.segments[index]; const entity = resolved.curve.entities[index];
      if (!entity) throw new CadError('sweep-curve', 'Sweep curve is missing an analytic edge.');
      // Each line uses its authored displacement, not the seed tangent or a
      // reconstructed normalized length. Subsequent sections are native caps.
      let displacement: Vector | undefined;
      if (segment.kind === 'line') {
        const start = cadPlanePointToWorld(curvePlane, resolved.curve.offset, segment.start);
        const end = cadPlanePointToWorld(curvePlane, resolved.curve.offset, segment.end);
        displacement = own(new Vector([end[0] - start[0], end[1] - start[1], end[2] - start[2]]));
      }
      const center = segment.kind === 'arc' ? cadPlanePointToWorld(curvePlane, resolved.curve.offset, segment.center) : null;
      const axis = center ? own(makeAx1([center[0], center[1], center[2]], [resolved.frame.binormal[0], resolved.frame.binormal[1], resolved.frame.binormal[2]])) : null;
      const builder = segment.kind === 'line' && displacement ? own(new oc.BRepPrimAPI_MakePrism(face.wrapped, displacement.wrapped, false, true))
        : segment.kind === 'arc' && axis ? own(new oc.BRepPrimAPI_MakeRevol(face.wrapped, axis, segment.sweep * Math.PI / 180, false)) : null;
      if (!builder || !builder.IsDone()) throw new CadError('sweep-failed', `OpenCascade could not construct curve segment ${index + 1}.`);
      const raw = builder.Shape(); let piece: Shape3D;
      try {
        const shape = cast(raw);
        if (!isShape3D(shape)) { shape.delete(); throw new CadError('sweep-invalid', 'Sweep segment did not produce a native solid.'); }
        piece = own(shape);
      } finally { raw.delete(); }
      validateSweepSolid(piece);
      const rawCap = builder.LastShape(); let terminal: Face;
      try {
        const cap = cast(rawCap);
        if (!(cap instanceof Face)) { cap.delete(); throw new CadError('sweep-section', 'Sweep segment did not retain its terminal section face.'); }
        terminal = own(cap);
      } finally { rawCap.delete(); }
      // Reusing the actual terminal cap makes the next primitive share the
      // same native section, rather than independently rounding another pose.
      release(face); face = terminal; release(builder);
      if (axis) release(axis); if (displacement) release(displacement);
      if (result) {
        const previous = result; const fused = own(previous.fuse(piece)); validateSweepSolid(fused);
        result = fused; release(previous); release(piece);
      } else result = piece;
    }
    if (!result) throw new CadError('sweep-empty', 'Sweep requires an open analytic curve.');
    owned.delete(result); return result;
  } finally {
    for (const value of owned) value.delete();
    sketches.forEach(sketch => sketch.delete()); planes.forEach(plane => plane.delete()); drawings.forEach(drawing => drawing.blueprint.delete());
  }
}
