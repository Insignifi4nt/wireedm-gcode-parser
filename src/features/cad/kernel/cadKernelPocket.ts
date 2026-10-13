import { cast, getOC, isShape3D, measureArea, measureVolume, Plane, Vector, type Drawing, type Shape3D, type SimplePoint, type Sketch } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { resolveCadPocketExtent, type CadResolvedPocketInputs } from '../../../domain/cad/cadPocket';
import { cadKernelPlaneBasis } from './cadKernelPlane';
import { cadKernelProfileDrawing } from './cadKernelSketch';

/** Read all native topology tolerances; AddOptimal's bounds exclude them. */
function pocketShapeTolerance(shape: Shape3D): number {
  const oc = getOC(); let maximum = 0;
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
            if (!Number.isFinite(tolerance) || tolerance < 0) throw new CadError('unsupported-pocket-precision', 'The target has invalid native topology tolerances.');
            maximum = Math.max(maximum, tolerance);
          } finally { item.delete(); }
        } finally { raw.delete(); }
        explorer.Next();
      }
    } finally { explorer.delete(); }
  }
  return maximum;
}

export function prepareCadPocketExtent(target: Shape3D, inputs: CadResolvedPocketInputs): ReturnType<typeof resolveCadPocketExtent> {
  // A Boolean may omit an unresolved target component completely. Its absence
  // from Common cannot be certified by inspecting only the returned material.
  solidEvidence(target, 'target');
  const box = target.boundingBox;
  try {
    const [min, max] = box.bounds;
    return resolveCadPocketExtent({ plane: inputs.plane, offsetMm: inputs.offset,
      direction: inputs.direction, sectionScaleMm: inputs.sectionScaleMm, targetBounds: { min, max }, nativeToleranceMm: pocketShapeTolerance(target) });
  } finally { box.delete(); }
}

function solidEvidence(shape: Shape3D, context: 'target' | 'tool' | 'common' | 'result') {
  const oc = getOC(); const solids = shape.solids; let volume = 0; let surfaceArea = 0; let tolerance = 0;
  try {
    if (!solids.length) throw new CadError(context === 'common' ? 'pocket-no-material' : context === 'result' ? 'pocket-erased' : 'pocket-tool',
      context === 'common' ? 'No positive intersected target material was confirmed in this Pocket direction. Revise the profile or direction.'
        : context === 'result' ? 'Pocket removed the entire target. Revise the profile or choose another body.' : 'Pocket could not form a closed cutting solid.');
    const analyzer = new oc.BRepCheck_Analyzer(shape.wrapped, true, false, false);
    try { if (!analyzer.IsValid()) throw new CadError('pocket-invalid', 'OpenCascade rejected the Pocket topology. Revise the profile or direction.'); }
    finally { analyzer.delete(); }
    if (context !== 'common') {
      // A Common can legitimately contain contact faces alongside removed
      // material. A cutting tool or committed result must contain only solids.
      for (const kind of [oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_VERTEX]) {
        const explorer = new oc.TopExp_Explorer(shape.wrapped, kind, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
        try { if (explorer.More()) throw new CadError('pocket-invalid', 'Pocket produced loose surfaces or curves. No geometry was discarded.'); }
        finally { explorer.delete(); }
      }
    }
    for (const solid of solids) {
      const componentVolume = measureVolume(solid);
      if (!Number.isFinite(componentVolume) || componentVolume <= (context === 'common' ? 0 : 1e-9)) {
        throw new CadError('unsupported-pocket-precision', 'Pocket material volume cannot be confirmed at the supported precision.');
      }
      const shells = new oc.TopExp_Explorer(solid.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        while (shells.More()) {
          const shell = shells.Current();
          try { if (!oc.BRep_Tool.IsClosed(shell)) throw new CadError('pocket-open', 'Pocket produced an open solid. Revise the profile.'); }
          finally { shell.delete(); }
          shells.Next();
        }
      } finally { shells.delete(); }
      volume += componentVolume;
      const componentTolerance = pocketShapeTolerance(solid);
      tolerance = Math.max(tolerance, componentTolerance);
      if (context !== 'result') {
        const componentArea = measureArea(solid); surfaceArea += componentArea;
        if (!Number.isFinite(componentArea)) throw new CadError('unsupported-pocket-precision', 'Pocket material area exceeds supported precision.');
        if ((context === 'common' || context === 'target') && componentVolume <= Math.max(1e-9, 4 * componentTolerance * componentArea)) {
          throw new CadError(context === 'target' ? 'unsupported-pocket-target' : 'unsupported-pocket-removal', context === 'target'
            ? 'A target component is too thin to resolve reliably at native precision. Repair the target or choose another body.'
            : 'An intersected target component is too small to confirm at native precision. Revise the profile, direction or target.');
        }
      }
    }
    if (!Number.isFinite(volume) || !Number.isFinite(surfaceArea)) throw new CadError('unsupported-pocket-precision', 'Pocket material measurements exceed supported precision.');
    return { volume, surfaceArea, tolerance };
  } finally { solids.forEach(solid => solid.delete()); }
}

function extrudePocketRegion(wires: readonly Sketch[], span: number, normal: SimplePoint): Shape3D {
  const first = wires[0];
  if (!first) throw new CadError('empty-sketch', 'Pocket needs a closed non-construction material profile.');
  const oc = getOC(); const owned = new Set<{ delete(): void }>();
  const own = <T extends { delete(): void }>(value: T): T => { owned.add(value); return value; };
  try {
    const maker = own(new oc.BRepBuilderAPI_MakeFace(first.wire.wrapped, true));
    for (const hole of wires.slice(1)) maker.Add(hole.wire.wrapped);
    if (!maker.IsDone()) throw new CadError('pocket-tool', 'Pocket profiles could not form a planar cutting face.');
    const face = own(maker.Face());
    // All nested loops have explicit material meaning. As in Replicad's
    // CompoundSketch, fix traversal orientation only; no geometric healing.
    const fixer = own(new oc.ShapeFix_Face(face)); fixer.FixOrientation();
    const oriented = own(fixer.Face());
    const vector = own(new Vector([normal[0] * span, normal[1] * span, normal[2] * span]));
    const builder = own(new oc.BRepPrimAPI_MakePrism(oriented, vector.wrapped, false, true));
    if (!builder.IsDone()) throw new CadError('pocket-tool', 'OpenCascade could not extrude the through-all cutting face.');
    const raw = own(builder.Shape()); const shape = cast(raw);
    if (!isShape3D(shape)) { shape.delete(); throw new CadError('pocket-tool', 'Pocket profiles did not produce a solid cutting tool.'); }
    return shape;
  } finally { for (const value of owned) value.delete(); }
}

/** Borrow the exact prefix target. The caller owns the returned committed cut. */
export function buildCadPocketCut(target: Shape3D, inputs: CadResolvedPocketInputs): Shape3D {
  const extent = prepareCadPocketExtent(target, inputs); const basis = cadKernelPlaneBasis(inputs.plane);
  const origin: SimplePoint = [basis.normal[0] * extent.startStationMm, basis.normal[1] * extent.startStationMm, basis.normal[2] * extent.startStationMm];
  const plane = new Plane(origin, basis.u, basis.normal); const drawings: Drawing[] = []; const sketches: Sketch[] = [];
  const shapes = new Set<Shape3D>(); const own = (shape: Shape3D) => { shapes.add(shape); return shape; };
  const release = (shape: Shape3D) => { shape.delete(); shapes.delete(shape); };
  let tool: Shape3D | undefined;
  try {
    for (const region of inputs.regions) {
      const wires = [region.boundary, ...region.voids].map(contour => {
        const drawing = cadKernelProfileDrawing(contour.geometry, drawings); const wire = drawing.blueprint.sketchOnPlane(plane); sketches.push(wire); return wire;
      });
      const piece = own(extrudePocketRegion(wires, extent.spanMm, basis.normal)); const regionEvidence = solidEvidence(piece, 'tool');
      // Refuse each unresolved region separately: a larger cutting region must
      // not hide a thin annulus that native Common may omit at its tolerance.
      if (regionEvidence.volume <= Math.max(1e-9, 4 * regionEvidence.tolerance * regionEvidence.surfaceArea)) {
        throw new CadError('unsupported-pocket-removal', 'A cutting region is too thin to resolve at native precision. Enlarge its material width or revise its holes.');
      }
      if (tool) {
        const previous = tool; tool = own(previous.fuse(piece)); solidEvidence(tool, 'tool'); release(previous); release(piece);
      } else tool = piece;
    }
    if (!tool) throw new CadError('empty-sketch', 'Pocket needs a closed non-construction material profile.');
    const common = own(target.intersect(tool)); const evidence = solidEvidence(common, 'common');
    // Evidence is checked per Common solid at its own precision scale.
    // Whole-target subtraction can lose a small bore or even become negative;
    // a broad removed component must not hide a second unresolved component.
    if (evidence.tolerance * 4 > extent.capMarginMm) throw new CadError('unsupported-pocket-precision', 'Pocket intersection exceeds the reserved cap precision. Revise the target or profile.');
    release(common);
    const result = own(target.cut(tool)); const final = solidEvidence(result, 'result');
    if (final.tolerance * 4 > extent.capMarginMm) throw new CadError('unsupported-pocket-precision', 'Pocket result exceeds the reserved cap precision. Revise the target or profile.');
    shapes.delete(result); return result;
  } finally {
    for (const shape of shapes) shape.delete(); sketches.forEach(sketch => sketch.delete()); plane.delete(); drawings.forEach(drawing => drawing.blueprint.delete());
  }
}
