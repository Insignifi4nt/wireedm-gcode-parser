import { getOC, type Shape3D } from 'replicad';
import type { CadBodySolidOrigin } from '../../../domain/cad/cadBodies';
import { cadKernelDisposeShape, cadKernelSolids } from './cadKernelShapes';

/**
 * Where each solid of `result` came from in `previous`: the first face of `previous`, in its face order, that the solid keeps unchanged
 * (the same native face, wherever its orientation), and the solid of `previous` that face bounds. `null` for a solid that keeps no
 * face. Solids are numbered as `cadKernelSolids` lists them, which is how `CadMesh.faceSolids` numbers them. Costs O(faces).
 */
export function cadKernelSolidOrigins(previous: Shape3D, result: Shape3D): (CadBodySolidOrigin | null)[] {
  const oc = getOC(), face = oc.TopAbs_ShapeEnum.TopAbs_FACE, any = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const faces = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  try {
    const explorer = new oc.TopExp_Explorer(previous.wrapped, face, any);
    try {
      for (; explorer.More(); explorer.Next()) { const element = explorer.Current(); try { faces.Add(element); } finally { element.Nullify(); element.delete(); } }
      const solidOf = new Int32Array(faces.Extent() + 1).fill(-1);
      const before = cadKernelSolids(previous);
      try {
        for (const [index, solid] of before.entries()) {
          for (explorer.Init(solid.wrapped, face, any); explorer.More(); explorer.Next()) {
            const element = explorer.Current();
            try { const id = faces.FindIndex(element); if (id && solidOf[id] < 0) solidOf[id] = index; } finally { element.Nullify(); element.delete(); }
          }
        }
      } finally { for (const solid of before) cadKernelDisposeShape(solid); }
      const after = cadKernelSolids(result);
      try {
        return after.map(solid => {
          let rank = 0;
          for (explorer.Init(solid.wrapped, face, any); explorer.More(); explorer.Next()) {
            const element = explorer.Current();
            try { const id = faces.FindIndex(element); if (id && solidOf[id] >= 0 && (!rank || id < rank)) rank = id; } finally { element.Nullify(); element.delete(); }
          }
          return rank ? { solid: solidOf[rank], rank } : null;
        });
      } finally { for (const solid of after) cadKernelDisposeShape(solid); }
    } finally { explorer.delete(); }
  } finally { faces.delete(); }
}
