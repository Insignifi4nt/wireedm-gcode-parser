import { cast, getOC, isShape3D, measureVolume, Plane, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { CAD_LOFT_NATIVE_PRECISION, type resolveCadLoftSections } from '../../../domain/cad/cadLoft';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { cadKernelProfileDrawing } from './cadKernelSketch';
import type { CadResolvedFrame } from '../../../domain/cad/cadDatumPlanes';

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

/** The fitted solid is constructed in canonical XY, then placed rigidly once. */
function placeLoftSolid(shape: Shape3D, frame: CadResolvedFrame): Shape3D {
  const oc = getOC();
  const owned: { delete(): void }[] = [];
  const own = <T extends { delete(): void }>(value: T): T => { owned.push(value); return value; };
  let builder: InstanceType<typeof oc.BRepBuilderAPI_Transform> | undefined;
  let result: Shape3D | undefined;
  try {
    const transform = own(new oc.gp_Trsf());
    const reference = own(new oc.gp_Ax3());
    const origin = own(new oc.gp_Pnt(...frame.origin));
    const normal = own(new oc.gp_Dir(...frame.normal));
    const u = own(new oc.gp_Dir(...frame.u));
    const target = own(new oc.gp_Ax3(origin, normal, u));
    transform.SetDisplacement(reference, target);
    // Own the native builder explicitly; the convenience transform hides it.
    builder = new oc.BRepBuilderAPI_Transform(shape.wrapped, transform, true, false);
    if (!builder.IsDone()) throw new CadError('loft-placement', 'OpenCascade could not place the fitted loft in its datum frame.');
    const raw = builder.Shape();
    try {
      const placed = cast(raw);
      if (!isShape3D(placed)) { placed.delete(); throw new CadError('loft-placement', 'Datum placement did not preserve the native loft solid.'); }
      result = placed;
    } finally { raw.delete(); }
    validateLoftSolid(result);
    return result;
  } catch (error) { result?.delete(); throw error; }
  finally { builder?.delete(); for (const value of owned.reverse()) value.delete(); }
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
      const basis = resolved.legacyPrincipalPlane === null ? cadKernelPlaneBasis('XY') : cadKernelPlaneBasis(resolved.legacyPrincipalPlane);
      const origin: SimplePoint = resolved.legacyPrincipalPlane === null
        ? [section.tangentialOffsetMm[0], section.tangentialOffsetMm[1], section.stationMm]
        : [basis.normal[0] * section.offset, basis.normal[1] * section.offset, basis.normal[2] * section.offset];
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
      const [min, max] = box.bounds; const normal = cadKernelPlaneBasis(resolved.legacyPrincipalPlane ?? 'XY').normal;
      const lower = normal.reduce((sum, value, axis) => sum + value * (value < 0 ? max[axis] : min[axis]), 0);
      const upper = normal.reduce((sum, value, axis) => sum + value * (value < 0 ? min[axis] : max[axis]), 0);
      const tolerance = CAD_LOFT_NATIVE_PRECISION + resolved.offsetTolerance;
      const firstStation = resolved.legacyPrincipalPlane === null ? first.stationMm : first.offset;
      const lastStation = resolved.legacyPrincipalPlane === null ? last.stationMm : last.offset;
      if (!Number.isFinite(lower) || !Number.isFinite(upper)
        || lower < Math.min(firstStation, lastStation) - tolerance || upper > Math.max(firstStation, lastStation) + tolerance) {
        throw new CadError('loft-overshoot', 'The loft extends beyond its end-section planes. Try ruled mode or adjust the section spacing.');
      }
    } finally { box.delete(); }
    if (resolved.legacyPrincipalPlane === null) {
      const local = shape;
      shape = placeLoftSolid(local, resolved.commonFrame);
      local.delete();
    }
    return shape;
  } catch (error) { shape?.delete(); throw error; }
  finally {
    builder.delete();
    for (const sketch of sketches) sketch.delete();
    for (const plane of planes) plane.delete();
    for (const drawing of drawings) drawing.blueprint.delete();
  }
}
