import { cast, getOC, isShape3D, measureVolume, Plane, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { CAD_LOFT_NATIVE_PRECISION, type resolveCadLoftSections } from '../../../domain/cad/cadLoft';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { cadKernelProfileDrawing } from './cadKernelSketch';

function validateLoftSolid(shape: Shape3D) {
  const oc = getOC();
  const solids = shape.solids;
  try {
    if (solids.length !== 1) throw new CadError('loft-invalid', 'A loft must produce exactly one closed solid. Revise the section shapes or spacing.');
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    try {
      if (!analyzer.IsValid()) throw new CadError('loft-invalid', 'OpenCascade rejected the loft topology. Revise the section shapes or try ruled mode.');
    } finally { analyzer.delete(); }
    const explorer = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (explorer.More()) {
        const shell = explorer.Current();
        try { if (!oc.BRep_Tool.IsClosed(shell)) throw new CadError('loft-open', 'The loft produced an open shell. Revise its section shapes.'); }
        finally { shell.delete(); }
        explorer.Next();
      }
    } finally { explorer.delete(); }
    const volume = measureVolume(shape);
    if (!Number.isFinite(volume) || volume <= 1e-9) throw new CadError('loft-volume', 'The loft must contain positive volume with outward orientation. Revise the section spacing.');
  } finally { for (const solid of solids) solid.delete(); }
}

/** The caller owns the returned solid, including native fitted surfaces in smooth mode. */
export function buildCadLoftSolid(resolved: ReturnType<typeof resolveCadLoftSections>, ruled: boolean): Shape3D {
  const first = resolved.sections[0]; const last = resolved.sections.at(-1);
  if (!first || !last) throw new CadError('loft-sections', 'A loft needs at least two ordered sketch sections.');
  const oc = getOC();
  const builder = new oc.BRepOffsetAPI_ThruSections(true, ruled, CAD_LOFT_NATIVE_PRECISION);
  const planes: Plane[] = []; const drawings: Drawing[] = []; const sketches: Sketch[] = [];
  let shape: Shape3D | undefined;
  try {
    builder.CheckCompatibility(true);
    // Compatibility may split edges or change wire origins; never mutate source wires.
    builder.SetMutableInput(false);
    for (const section of resolved.sections) {
      const basis = cadKernelPlaneBasis(section.plane);
      const origin: SimplePoint = [basis.normal[0] * section.offset, basis.normal[1] * section.offset, basis.normal[2] * section.offset];
      const plane = new Plane(origin, basis.u, basis.normal); planes.push(plane);
      const drawing = cadKernelProfileDrawing(section.geometry, drawings);
      const sketch = drawing.blueprint.sketchOnPlane(plane); sketches.push(sketch);
      builder.AddWire(sketch.wire.wrapped);
    }
    builder.Build();
    if (!builder.IsDone()) throw new CadError('loft-failed', 'OpenCascade could not connect these sections. Revise their shapes or try ruled mode.');
    const raw = builder.Shape();
    try {
      const built = cast(raw);
      if (!isShape3D(built)) { built.delete(); throw new CadError('loft-invalid', 'The loft did not produce a native solid.'); }
      shape = built;
    } finally { raw.delete(); }
    validateLoftSolid(shape);
    // Native validity alone can accept a fitted surface outside its end planes.
    // Optimal native bounds include native precision padding even for an exact cylinder.
    const box = shape.boundingBox;
    try {
      const [min, max] = box.bounds; const normal = cadKernelPlaneBasis(first.plane).normal;
      const lower = normal.reduce((sum, value, axis) => sum + value * (value < 0 ? max[axis] : min[axis]), 0);
      const upper = normal.reduce((sum, value, axis) => sum + value * (value < 0 ? min[axis] : max[axis]), 0);
      const tolerance = CAD_LOFT_NATIVE_PRECISION + resolved.offsetTolerance;
      if (!Number.isFinite(lower) || !Number.isFinite(upper)
        || lower < Math.min(first.offset, last.offset) - tolerance || upper > Math.max(first.offset, last.offset) + tolerance) {
        throw new CadError('loft-overshoot', 'The loft extends beyond its end-section planes. Try ruled mode or adjust the section spacing.');
      }
    } finally { box.delete(); }
    return shape;
  } catch (error) { shape?.delete(); throw error; }
  finally {
    builder.delete();
    for (const sketch of sketches) sketch.delete();
    for (const plane of planes) plane.delete();
    for (const drawing of drawings) drawing.blueprint.delete();
  }
}
