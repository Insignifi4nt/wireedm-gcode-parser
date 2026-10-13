/** Millimetres and degrees. Strings are arithmetic expressions over named parameters. */
export type CadScalar = number | string;
export type CadPoint2 = readonly [CadScalar, CadScalar];
export type CadPoint3 = readonly [CadScalar, CadScalar, CadScalar];
export type CadPlane = 'XY' | 'XZ' | 'YZ';

export type CadProfile =
  | { readonly kind: 'rectangle'; readonly x: CadScalar; readonly y: CadScalar; readonly width: CadScalar; readonly height: CadScalar; readonly cornerRadius: CadScalar }
  | { readonly kind: 'circle'; readonly x: CadScalar; readonly y: CadScalar; readonly radius: CadScalar }
  | { readonly kind: 'polygon'; readonly points: readonly CadPoint2[] }
  | { readonly kind: 'slot'; readonly x: CadScalar; readonly y: CadScalar; readonly length: CadScalar; readonly width: CadScalar; readonly angle: CadScalar };

export interface CadSketchProfile {
  readonly id: string;
  readonly name: string;
  readonly construction: boolean;
  readonly role: 'outer' | 'hole';
  readonly geometry: CadProfile;
}
export interface CadFeatureBase { readonly id: string; readonly name: string; readonly suppressed: boolean }
export interface CadSketchFeature extends CadFeatureBase {
  readonly kind: 'sketch'; readonly plane: CadPlane; readonly offset: CadScalar; readonly profiles: readonly CadSketchProfile[];
}
export type CadFeature = CadSketchFeature
  | (CadFeatureBase & { readonly kind: 'extrude'; readonly sketchId: string; readonly distance: CadScalar; readonly symmetric: boolean; readonly operation: 'new' | 'join' | 'cut'; readonly targetId: string | null })
  | (CadFeatureBase & { readonly kind: 'revolve'; readonly sketchId: string; readonly angle: CadScalar; readonly axis: 'x' | 'y'; readonly operation: 'new' | 'join' | 'cut'; readonly targetId: string | null })
  | (CadFeatureBase & { readonly kind: 'fillet' | 'chamfer'; readonly targetId: string; readonly radius: CadScalar })
  | (CadFeatureBase & { readonly kind: 'boolean'; readonly targetId: string; readonly toolId: string; readonly operation: 'union' | 'cut' | 'intersect' })
  | (CadFeatureBase & { readonly kind: 'transform'; readonly sourceId: string; readonly translation: CadPoint3; readonly rotation: CadPoint3 })
  | (CadFeatureBase & { readonly kind: 'linear-pattern'; readonly sourceId: string; readonly count: number; readonly spacing: CadPoint3 })
  | (CadFeatureBase & { readonly kind: 'mirror'; readonly sourceId: string; readonly plane: CadPlane });

export interface CadDocument {
  readonly format: 'wireedm-cad';
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly units: 'mm';
  readonly parameters: Readonly<Record<string, number>>;
  readonly features: readonly CadFeature[];
}

export interface CadDiagnostic { readonly code: string; readonly message: string; readonly featureId?: string }
export interface CadMesh {
  readonly featureId: string; readonly name: string;
  readonly positions: readonly number[]; readonly normals: readonly number[]; readonly indices: readonly number[];
  readonly edges: readonly number[];
  readonly volume: number;
  readonly bounds: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
}
export interface CadBuildResult {
  readonly meshes: readonly CadMesh[];
  readonly diagnostics: readonly CadDiagnostic[];
  readonly durationMs: number;
}
