import { MACHINE_IMPORT_LIMITS, type MachineModel, type Vec3 } from './model';
import { boundsForPositions, unionBounds } from './validateMachineModel';

/** Rotation about the source origin, followed by translation; dimensions remain millimetres. */
export interface MachinePlacement { readonly translationMm: Vec3; readonly rotationZDegrees: number }
export const IDENTITY_MACHINE_PLACEMENT: MachinePlacement = Object.freeze({ translationMm: [0, 0, 0] as const, rotationZDegrees: 0 });
export type MachinePlacementResult = { readonly ok: true; readonly model: MachineModel }
  | { readonly ok: false; readonly error: { readonly code: 'MACHINE_PLACEMENT_INVALID'; readonly message: string } };

export function validMachinePlacement(placement: MachinePlacement): boolean {
  return placement.translationMm.length === 3 && placement.translationMm.every((value) => Number.isFinite(value)
    && Math.abs(value) <= MACHINE_IMPORT_LIMITS.coordinateMagnitudeMm)
    && Number.isFinite(placement.rotationZDegrees) && Math.abs(placement.rotationZDegrees) <= 360_000;
}

export function transformMachinePoint(point: Vec3, placement: MachinePlacement): Vec3 {
  const radians = (placement.rotationZDegrees % 360) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine * point[0] - sine * point[1] + placement.translationMm[0],
    sine * point[0] + cosine * point[1] + placement.translationMm[1], point[2] + placement.translationMm[2]];
}

export function placeMachineModel(model: MachineModel, placement: MachinePlacement): MachinePlacementResult {
  const failure = (): MachinePlacementResult => ({ ok: false, error: { code: 'MACHINE_PLACEMENT_INVALID',
    message: 'Machine placement requires finite millimetre coordinates within ±10,000,000 mm and a finite Z rotation within ±360,000°.' } });
  if (!validMachinePlacement(placement)) return failure();
  const meshes = model.meshes.map((mesh) => {
    const positions = new Float64Array(mesh.positions.length);
    for (let offset = 0; offset < positions.length; offset += 3) {
      positions.set(transformMachinePoint([mesh.positions[offset], mesh.positions[offset + 1], mesh.positions[offset + 2]], placement), offset);
    }
    const normals = mesh.normals ? new Float32Array(mesh.normals.length) : null;
    if (normals && mesh.normals) {
      const rotation = { ...placement, translationMm: [0, 0, 0] as const };
      for (let offset = 0; offset < normals.length; offset += 3) {
        normals.set(transformMachinePoint([mesh.normals[offset], mesh.normals[offset + 1], mesh.normals[offset + 2]], rotation), offset);
      }
    }
    return { ...mesh, positions, normals, bounds: boundsForPositions(positions) };
  });
  if (meshes.some((mesh) => [...mesh.bounds.min, ...mesh.bounds.max].some((value) => !Number.isFinite(value)
    || Math.abs(value) > MACHINE_IMPORT_LIMITS.coordinateMagnitudeMm))) return failure();
  return { ok: true, model: { ...model, meshes, bounds: unionBounds(meshes.map((mesh) => mesh.bounds)) } };
}
