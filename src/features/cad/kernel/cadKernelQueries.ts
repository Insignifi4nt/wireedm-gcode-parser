import { getOC, type Face } from 'replicad';
import type { gp_Pln, gp_Pnt, gp_Vec, TopoDS_Shape } from 'replicad-opencascadejs';

/**
 * Owned curve, face and plane queries for the kernel's topology descriptors and sections.
 *
 * Replicad 1.1's Curve.startPoint, endPoint and pointAt wrap the gp_Pnt that `Value` returns in a
 * Vector and never delete it, and every Vector built from a native point, vector or direction
 * copies it through a gp_XYZ it never deletes. Curve.tangentAt, Face.normalAt and makePln leak
 * such a copy too. measureVolume and measureArea leave their GProp_GProps to garbage collection, and
 * lose it if the measurement throws. Each query here makes Replicad's native calls with the same
 * parameters, so it returns the same numbers, and deletes everything it makes before it returns or throws.
 */
export type CadKernelVector = [number, number, number];

/** The native curve queries Replicad's Curve reads: an edge or wire adaptor. */
export interface CadKernelNativeCurve {
  FirstParameter(): number;
  LastParameter(): number;
  Value(parameter: number): gp_Pnt;
  D1(parameter: number, point: gp_Pnt, derivative: gp_Vec): void;
}

function read(value: gp_Pnt | gp_Vec): CadKernelVector {
  try { return [value.X(), value.Y(), value.Z()]; } finally { value.delete(); }
}
/** Replicad's mapCurveParameter: position 0 is the first parameter and 1 the last. */
function parameterAt(curve: CadKernelNativeCurve, position: number): number {
  const first = curve.FirstParameter();
  return first + (curve.LastParameter() - first) * position;
}

/** Replicad's Curve.startPoint. */
export function cadKernelCurveStart(curve: CadKernelNativeCurve): CadKernelVector { return read(curve.Value(curve.FirstParameter())); }
/** Replicad's Curve.endPoint. */
export function cadKernelCurveEnd(curve: CadKernelNativeCurve): CadKernelVector { return read(curve.Value(curve.LastParameter())); }
/** Replicad's Curve.pointAt, with position 0 at the start and 1 at the end. */
export function cadKernelCurvePointAt(curve: CadKernelNativeCurve, position: number): CadKernelVector {
  return read(curve.Value(parameterAt(curve, position)));
}
/** Replicad's Curve.tangentAt: the first derivative, not normalized, with position 0 at the start and 1 at the end. */
export function cadKernelCurveTangentAt(curve: CadKernelNativeCurve, position: number): CadKernelVector {
  const oc = getOC(); const parameter = parameterAt(curve, position);
  const point = new oc.gp_Pnt();
  try {
    const derivative = new oc.gp_Vec();
    try { curve.D1(parameter, point, derivative); return [derivative.X(), derivative.Y(), derivative.Z()]; } finally { derivative.delete(); }
  } finally { point.delete(); }
}
/** Replicad's Face.normalAt with no location: the oriented normal, not normalized, at the middle of the face's parameter bounds. */
export function cadKernelFaceNormal(face: Face): CadKernelVector {
  const oc = getOC();
  const { UMin, UMax, VMin, VMax } = oc.BRepTools.UVBounds(face.wrapped, 0, 0, 0, 0);
  const u = .5 * (UMin + UMax), v = .5 * (VMin + VMax);
  const properties = new oc.BRepGProp_Face(face.wrapped, false);
  try {
    const point = new oc.gp_Pnt();
    try {
      const normal = new oc.gp_Vec();
      try { properties.Normal(u, v, point, normal); return [normal.X(), normal.Y(), normal.Z()]; } finally { normal.delete(); }
    } finally { point.delete(); }
  } finally { properties.delete(); }
}
/** Replicad's makePln: the plane through origin with the given normal. The caller owns it. */
export function cadKernelPlaneThrough(origin: readonly [number, number, number], normal: readonly [number, number, number]): gp_Pln {
  const oc = getOC(); const point = new oc.gp_Pnt(origin[0], origin[1], origin[2]);
  try {
    const direction = new oc.gp_Dir(normal[0], normal[1], normal[2]);
    try { return new oc.gp_Pln(point, direction); } finally { direction.delete(); }
  } finally { point.delete(); }
}
/**
 * Replicad's Shape.boundingBox corners: the optimal axis-aligned box of the shape's exact geometry, from BRepBndLib.AddOptimal
 * with the same flags. Replicad's box is left to garbage collection when AddOptimal throws; this one is deleted.
 */
export function cadKernelBounds(shape: { readonly wrapped: TopoDS_Shape }): [CadKernelVector, CadKernelVector] {
  const oc = getOC(); const box = new oc.Bnd_Box();
  try { oc.BRepBndLib.AddOptimal(shape.wrapped, box, false, false); return [read(box.CornerMin()), read(box.CornerMax())]; } finally { box.delete(); }
}
/** Replicad's measureVolume: the volume of a shape from its exact geometry. */
export function cadKernelVolume(shape: { readonly wrapped: TopoDS_Shape }): number {
  const oc = getOC(); const properties = new oc.GProp_GProps();
  try { oc.BRepGProp.VolumeProperties(shape.wrapped, properties, false, false, false); return properties.Mass(); } finally { properties.delete(); }
}
/** Replicad's measureArea: the area of a shape's faces from their exact geometry. */
export function cadKernelArea(shape: { readonly wrapped: TopoDS_Shape }): number {
  const oc = getOC(); const properties = new oc.GProp_GProps();
  try { oc.BRepGProp.SurfaceProperties(shape.wrapped, properties, false, false); return properties.Mass(); } finally { properties.delete(); }
}
