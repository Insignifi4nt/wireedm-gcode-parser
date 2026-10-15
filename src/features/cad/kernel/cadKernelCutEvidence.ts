import { getOC, measureArea, measureVolume, type Shape3D } from 'replicad';
import { CadError } from '../../../domain/cad/cadError';
import { cadKernelDisposeOwned, cadKernelDisposeShape, cadKernelIsValid, cadKernelSolids } from './cadKernelShapes';

type MaterialOperation = 'Pocket' | 'Cut';
type MaterialContext = 'target' | 'tool' | 'common' | 'result';

/** Read actual native tolerances; geometric bounds do not include them. */
export function cadKernelShapeTolerance(shape: Shape3D, operation: MaterialOperation = 'Pocket'): number {
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
            if (!Number.isFinite(tolerance) || tolerance < 0) throw new CadError(`unsupported-${operation.toLowerCase()}-precision`, 'The target has invalid native topology tolerances.');
            maximum = Math.max(maximum, tolerance);
          } finally { cadKernelDisposeOwned(item); }
        } finally { cadKernelDisposeOwned(raw); }
        explorer.Next();
      }
    } finally { explorer.delete(); }
  }
  return maximum;
}

/** Borrow the shape and measure each closed solid at its own native precision. */
export function cadKernelSolidEvidence(shape: Shape3D, context: MaterialContext, operation: MaterialOperation = 'Pocket') {
  const prefix = operation.toLowerCase(), oc = getOC(), solids = cadKernelSolids(shape);
  let volume = 0, surfaceArea = 0, tolerance = 0;
  try {
    if (!solids.length) throw new CadError(context === 'common' ? `${prefix}-no-material` : context === 'result' ? `${prefix}-erased` : `${prefix}-tool`,
      context === 'common' ? operation === 'Pocket'
        ? 'No positive intersected target material was confirmed in this Pocket direction. Revise the profile or direction.'
        : 'No positive intersected target material was confirmed for this Cut. Check the cutting sketch or tool body, direction, extent and target.'
        : context === 'result' ? `${operation} removed the entire target. Revise the profile or choose another body.` : `${operation} could not form a closed cutting solid.`);
    if (!cadKernelIsValid(shape)) throw new CadError(`${prefix}-invalid`, `OpenCascade rejected the ${operation} topology. Revise the profile or direction.`);
    if (context !== 'common') {
      // Contact faces may coexist with Common material. Tools and committed
      // results must contain only solids; no loose geometry is discarded.
      for (const kind of [oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_VERTEX]) {
        const explorer = new oc.TopExp_Explorer(shape.wrapped, kind, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
        try { if (explorer.More()) throw new CadError(`${prefix}-invalid`, `${operation} produced loose surfaces or curves. No geometry was discarded.`); }
        finally { explorer.delete(); }
      }
    }
    for (const solid of solids) {
      const componentVolume = measureVolume(solid);
      if (!Number.isFinite(componentVolume) || componentVolume <= (context === 'common' ? 0 : 1e-9)) {
        throw new CadError(`unsupported-${prefix}-precision`, `${operation} material volume cannot be confirmed at the supported precision.`);
      }
      const shells = new oc.TopExp_Explorer(solid.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        while (shells.More()) {
          const shell = shells.Current();
          try { if (!oc.BRep_Tool.IsClosed(shell)) throw new CadError(`${prefix}-open`, `${operation} produced an open solid. Revise the profile.`); }
          finally { cadKernelDisposeOwned(shell); }
          shells.Next();
        }
      } finally { shells.delete(); }
      volume += componentVolume;
      const componentTolerance = cadKernelShapeTolerance(solid, operation); tolerance = Math.max(tolerance, componentTolerance);
      if (context !== 'result') {
        const componentArea = measureArea(solid); surfaceArea += componentArea;
        if (!Number.isFinite(componentArea)) throw new CadError(`unsupported-${prefix}-precision`, `${operation} material area exceeds supported precision.`);
        // Reuse Pocket's existing safety evidence and solid-volume floor.
        // Check every cutting component before Common can omit it.
        if ((context === 'common' || context === 'target' || context === 'tool' && operation === 'Cut')
          && componentVolume <= Math.max(1e-9, 4 * componentTolerance * componentArea)) {
          throw new CadError(context === 'target' ? `unsupported-${prefix}-target` : `unsupported-${prefix}-removal`, context === 'target'
            ? 'A target component is too thin to resolve reliably at native precision. Repair the target or choose another body.'
            : context === 'tool' ? 'A cutting component is too thin to resolve at native precision. Enlarge its material width or revise its holes.'
              : 'An intersected target component is too small to confirm at native precision. Revise the profile, direction or target.');
        }
      }
    }
    if (!Number.isFinite(volume) || !Number.isFinite(surfaceArea)) throw new CadError(`unsupported-${prefix}-precision`, `${operation} material measurements exceed supported precision.`);
    return { volume, surfaceArea, tolerance };
  } finally { solids.forEach(cadKernelDisposeOwned); }
}

/** Every solid Cut borrows both inputs; only a validated result leaves. */
export function cutCadKernelConfirmedMaterial(target: Shape3D, tool: Shape3D): Shape3D {
  cadKernelSolidEvidence(target, 'target', 'Cut'); cadKernelSolidEvidence(tool, 'tool', 'Cut');
  const common = target.intersect(tool);
  try { cadKernelSolidEvidence(common, 'common', 'Cut'); }
  finally { cadKernelDisposeShape(common); }
  const result = target.cut(tool);
  try { cadKernelSolidEvidence(result, 'result', 'Cut'); return result; }
  catch (error) { cadKernelDisposeShape(result); throw error; }
}
