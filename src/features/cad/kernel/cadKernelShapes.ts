import { Edge, Face, getOC, Shape, Sketch, Solid, type Shape3D } from 'replicad';
import type { TopAbs_ShapeEnum, TopoDS_Shape } from 'replicad-opencascadejs';

/** Release the owned native BRep reference before destroying its wrapper.
 * Only pass an owned wrapper; Nullify changes this wrapper, never its TShape. */
export function cadKernelDisposeShape(shape: { readonly wrapped: TopoDS_Shape; delete(): void }): void {
  let raw: TopoDS_Shape;
  try { raw = shape.wrapped; }
  catch (error) {
    // An already deleted wrapper has nothing left to release.
    if (error instanceof Error && error.message === 'This object has been deleted') return;
    throw error;
  }
  try { raw.Nullify(); } finally { shape.delete(); }
}

/** App-owned native temporaries only; borrowed operation inputs stay untouched. */
export function cadKernelDisposeOwned(value: { delete(): void }): void {
  if (value instanceof Shape) cadKernelDisposeShape(value);
  else if (value instanceof getOC().TopoDS_Shape) { try { value.Nullify(); } finally { value.delete(); } }
  else if (value instanceof Sketch) { cadKernelDisposeShape(value.wire); value.delete(); }
  else value.delete();
}

/** Full geometric/topological validation. The repaired pinned binding destroys
 * the analyzer and its result map normally; no neutral geometry is retained. */
export function cadKernelIsValid(shape: Shape3D): boolean {
  const analyzer = new (getOC()).BRepCheck_Analyzer(shape.wrapped, true, false, false);
  try { return analyzer.IsValid(); }
  finally { analyzer.delete(); }
}

/** Caller owns every returned solid. Raw explorer handles must not retain the
 * entire source BRep after its model is disposed (Replicad 1.1 iterTopo does). */
function subshapes<T extends { readonly wrapped: TopoDS_Shape; delete(): void }>(shape: { readonly wrapped: TopoDS_Shape }, kind: TopAbs_ShapeEnum, create: (raw: TopoDS_Shape) => T): T[] {
  const oc = getOC(), shapes: T[] = [];
  const explorer = new oc.TopExp_Explorer(shape.wrapped, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    const indices = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
    try {
      while (explorer.More()) {
        const raw = explorer.Current();
        try {
          // Native indexed maps resolve collisions with IsSame, including location.
          // New entries retain explorer order without a quadratic JS/native scan.
          if (indices.Add(raw) > shapes.length) shapes.push(create(raw));
        } finally { raw.Nullify(); raw.delete(); }
        explorer.Next();
      }
      return shapes;
    } finally { indices.delete(); }
  } catch (error) { for (const shape of shapes) cadKernelDisposeShape(shape); throw error; }
  finally { explorer.delete(); }
}

export function cadKernelSolids(shape: Shape3D): Solid[] {
  const oc = getOC(); return subshapes(shape, oc.TopAbs_ShapeEnum.TopAbs_SOLID, raw => new Solid(oc.TopoDS.Solid(raw)));
}
export function cadKernelFaces(shape: Shape3D): Face[] {
  const oc = getOC(); return subshapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, raw => new Face(oc.TopoDS.Face(raw)));
}
export function cadKernelEdges(shape: { readonly wrapped: TopoDS_Shape }): Edge[] {
  const oc = getOC(); return subshapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, raw => new Edge(oc.TopoDS.Edge(raw)));
}
