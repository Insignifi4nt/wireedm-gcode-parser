import { cast, getOC, isShape3D, type Shape3D } from 'replicad';
import type { BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse, BRepBuilderAPI_Transform, BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet,
  gp_Trsf, TopoDS_Shape } from 'replicad-opencascadejs';
import type { CadPlane } from '../../../domain/cad/cadDocument';
import { CAD_PRECISION } from '../../../domain/precision/cadPrecision';
import { cadKernelDisposeOwned, cadKernelEdges } from './cadKernelShapes';

/**
 * Owned native builders for the operations Replicad 1.1 runs with a builder it never deletes.
 *
 * Replicad's fuse, cut and intersect leave their builder to garbage collection and never delete the
 * raw result handle, which keeps a reference to the result's topology for the life of the module.
 * Its transforms leak both the builder and the raw handle. Each adapter here repeats Replicad's
 * native call sequence exactly, so results are the same bytes, but borrows its inputs, returns a
 * new shape the caller owns, and deletes its builder and every native temporary before returning
 * or throwing.
 */
export type CadKernelBooleanKind = 'fuse' | 'cut' | 'common';
export type CadKernelPoint = readonly [number, number, number];
export type CadKernelBooleanBuilder = BRepAlgoAPI_Fuse | BRepAlgoAPI_Cut | BRepAlgoAPI_Common;

/**
 * How the adapters construct their native builders. Production code never replaces it; tests spy
 * on it to see every builder the adapters create and to make one fail inside its adapter.
 */
export const cadKernelBuilderFactory = {
  boolean(kind: CadKernelBooleanKind, left: TopoDS_Shape, right: TopoDS_Shape): CadKernelBooleanBuilder {
    const oc = getOC();
    // The two-shape constructors already run the operation.
    return kind === 'fuse' ? new oc.BRepAlgoAPI_Fuse(left, right) : kind === 'cut' ? new oc.BRepAlgoAPI_Cut(left, right) : new oc.BRepAlgoAPI_Common(left, right);
  },
  /** Copies the geometry, as Replicad's Transformation.transform does. */
  transform(shape: TopoDS_Shape, transformation: gp_Trsf): BRepBuilderAPI_Transform {
    return new (getOC()).BRepBuilderAPI_Transform(shape, transformation, true, false);
  },
  fillet(shape: TopoDS_Shape): BRepFilletAPI_MakeFillet {
    const oc = getOC(); return new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  },
  chamfer(shape: TopoDS_Shape): BRepFilletAPI_MakeChamfer {
    return new (getOC()).BRepFilletAPI_MakeChamfer(shape);
  }
};

const verbs: Readonly<Record<CadKernelBooleanKind, string>> = { fuse: 'fuse', cut: 'cut', common: 'intersect' };
// Replicad's constant, so angles convert with the same rounding.
const DEG2RAD = Math.PI / 180;
// Replicad's named planes: mirrors use the normal exactly as Replicad's createNamedPlane gives it.
const mirrorNormals: Readonly<Record<CadPlane, CadKernelPoint>> = { XY: [0, 0, 1], XZ: [0, -1, 0], YZ: [1, 0, 0] };

/** The axis through center along direction, with the values Replicad's makeAx1 gives it. The caller owns it. */
export function cadKernelAx1(center: CadKernelPoint, direction: CadKernelPoint) {
  const oc = getOC(); const origin = new oc.gp_Pnt(center[0], center[1], center[2]);
  try {
    const axisDirection = new oc.gp_Dir(direction[0], direction[1], direction[2]);
    try { return new oc.gp_Ax1(origin, axisDirection); } finally { axisDirection.delete(); }
  } finally { origin.delete(); }
}

/** The extrusion vector of Replicad's `new Vector(direction).normalized().multiply(distance)`. The caller owns it. */
export function cadKernelScaledUnitVector(direction: CadKernelPoint, distance: number) {
  const oc = getOC(); const vector = new oc.gp_Vec(direction[0], direction[1], direction[2]);
  try {
    const unit = vector.Normalized();
    try { return unit.Multiplied(distance); } finally { unit.delete(); }
  } finally { vector.delete(); }
}

/** Wraps a raw builder result and releases the raw handle, whatever happens. */
function owned3D(raw: TopoDS_Shape, accept: (shape: ReturnType<typeof cast>) => boolean, message: string): Shape3D {
  try {
    const shape = cast(raw);
    if (!isShape3D(shape) || !accept(shape)) { cadKernelDisposeOwned(shape); throw new Error(message); }
    return shape;
  } finally { raw.Nullify(); raw.delete(); }
}

function boolean(kind: CadKernelBooleanKind, left: Shape3D, right: Shape3D): Shape3D {
  const builder = cadKernelBuilderFactory.boolean(kind, left.wrapped, right.wrapped);
  try {
    // Replicad builds a second time after the constructor. The second build is part of today's
    // geometry (a near-full circular pattern differs without it), so it stays.
    builder.Build();
    builder.SimplifyResult(true, true, CAD_PRECISION.kernelBooleanSimplifyRad);
    return owned3D(builder.Shape(), () => true, `Could not ${verbs[kind]} as a 3d shape`);
  } finally { builder.delete(); }
}

/** Replicad's Shape.translate/rotate/mirror/scale native sequence, without consuming the input. */
function transformed(shape: Shape3D, configure: (transformation: gp_Trsf) => void): Shape3D {
  const transformation = new (getOC()).gp_Trsf();
  try {
    configure(transformation);
    const builder = cadKernelBuilderFactory.transform(shape.wrapped, transformation);
    try {
      return owned3D(builder.ModifiedShape(shape.wrapped), result => result.constructor === shape.constructor, 'unexpected types mismatch');
    } finally { builder.delete(); }
  } finally { transformation.delete(); }
}

/** Every distinct edge in explorer order, as Replicad's all-edge fillet and chamfer select them. */
function allEdges<T extends { Add(radius: number, edge: TopoDS_Shape): void }>(builder: T, shape: Shape3D, radius: number, operation: 'fillet' | 'chamfer'): void {
  const edges = cadKernelEdges(shape);
  try {
    for (const edge of edges) builder.Add(radius, edge.wrapped);
    if (!edges.length) throw new Error(`Could not ${operation}, no edge was selected`);
  } finally { for (const edge of edges) cadKernelDisposeOwned(edge); }
}

/**
 * The kernel's owned operations. Call them through this object: tests spy on its members to watch
 * operands and results, as they once spied on Replicad's shape prototypes.
 */
export const cadKernelBuilders = {
  fuse(left: Shape3D, right: Shape3D): Shape3D { return boolean('fuse', left, right); },
  cut(target: Shape3D, tool: Shape3D): Shape3D { return boolean('cut', target, tool); },
  common(left: Shape3D, right: Shape3D): Shape3D { return boolean('common', left, right); },
  translate(shape: Shape3D, offset: CadKernelPoint): Shape3D {
    return transformed(shape, transformation => {
      const vector = new (getOC()).gp_Vec(offset[0], offset[1], offset[2]);
      try { transformation.SetTranslation(vector); } finally { vector.delete(); }
    });
  },
  /** Degrees about the axis through center, as Replicad's Shape.rotate. */
  rotate(shape: Shape3D, angle: number, center: CadKernelPoint, direction: CadKernelPoint): Shape3D {
    return transformed(shape, transformation => {
      const axis = cadKernelAx1(center, direction);
      try { transformation.SetRotation(axis, angle * DEG2RAD); } finally { axis.delete(); }
    });
  },
  /** Mirrors through a principal plane through the origin, as Replicad's Shape.mirror with a plane name. */
  mirror(shape: Shape3D, plane: CadPlane): Shape3D {
    return transformed(shape, transformation => {
      const oc = getOC(); const normal = mirrorNormals[plane]; const origin = new oc.gp_Pnt(0, 0, 0);
      try {
        const direction = new oc.gp_Dir(normal[0], normal[1], normal[2]);
        try {
          const axis = new oc.gp_Ax2(origin, direction);
          try { transformation.SetMirror(axis); } finally { axis.delete(); }
        } finally { direction.delete(); }
      } finally { origin.delete(); }
    });
  },
  /** Scales about center, as Replicad's Shape.scale. */
  scale(shape: Shape3D, factor: number, center: CadKernelPoint = [0, 0, 0]): Shape3D {
    return transformed(shape, transformation => {
      const origin = new (getOC()).gp_Pnt(center[0], center[1], center[2]);
      try { transformation.SetScale(origin, factor); } finally { origin.delete(); }
    });
  },
  /** Fillets every edge, as Replicad's Shape3D.fillet with one radius. */
  filletAll(shape: Shape3D, radius: number): Shape3D {
    const builder = cadKernelBuilderFactory.fillet(shape.wrapped);
    try {
      allEdges(builder, shape, radius, 'fillet');
      return owned3D(builder.Shape(), () => true, 'Could not fillet as a 3d shape');
    } finally { builder.delete(); }
  },
  /** Chamfers every edge, as Replicad's Shape3D.chamfer with one distance. */
  chamferAll(shape: Shape3D, distance: number): Shape3D {
    const builder = cadKernelBuilderFactory.chamfer(shape.wrapped);
    try {
      allEdges(builder, shape, distance, 'chamfer');
      return owned3D(builder.Shape(), () => true, 'Could not chamfer as a 3d shape');
    } finally { builder.delete(); }
  }
};
