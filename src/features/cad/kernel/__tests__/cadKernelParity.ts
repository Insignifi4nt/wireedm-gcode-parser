import type { CadBuildResult, CadDocument, CadFeature, CadSketchFeature } from '../../../../domain/cad/cadDocument';
import { parseCadDocument } from '../../../../domain/cad/cadSchema';
import { createCadKernelBenchmarkCases } from '../../benchmark/cadBenchmarkCases';

/**
 * Differential parity for kernel changes that must not change geometry. A build's fingerprint
 * holds each visible body's measured values and a hash of the exact bytes of its preview buffers,
 * so two kernels agree only if every triangle, normal and edge is bit-for-bit the same.
 */
export interface CadKernelBodyFingerprint {
  readonly featureId: string;
  readonly volume: number;
  /** The mesh's solid count, given only for a body of more than one solid. */
  readonly solids: number | undefined;
  readonly faces: number;
  readonly edges: number;
  readonly bounds: readonly number[];
  readonly hash: string;
}

/** FNV-1a over the exact bytes of the values. */
function hashNumbers(hash: number, values: readonly number[], float: boolean): number {
  const bytes = new Uint8Array((float ? new Float64Array(values) : new Uint32Array(values)).buffer);
  for (const byte of bytes) { hash ^= byte; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash;
}

export function cadKernelBuildFingerprint(result: CadBuildResult): { readonly diagnostics: readonly string[]; readonly bodies: readonly CadKernelBodyFingerprint[] } {
  return {
    diagnostics: result.diagnostics.map(item => item.code),
    bodies: result.meshes.map(mesh => {
      let hash = 0x811c9dc5;
      hash = hashNumbers(hash, mesh.positions, true); hash = hashNumbers(hash, mesh.normals, true); hash = hashNumbers(hash, mesh.indices, false);
      hash = hashNumbers(hash, mesh.edges, true);
      hash = hashNumbers(hash, mesh.faceGroups.flatMap(group => [group.start, group.count]), false);
      hash = hashNumbers(hash, mesh.edgeGroups.flatMap(group => [group.start, group.count]), false);
      return { featureId: mesh.featureId, volume: mesh.volume, solids: mesh.solidCount, faces: mesh.faceGroups.length, edges: mesh.edgeGroups.length,
        bounds: [...mesh.bounds.min, ...mesh.bounds.max], hash: hash.toString(16).padStart(8, '0') };
    })
  };
}

const base = (id: string) => ({ id, name: id, suppressed: false });
const document = (id: string, features: readonly CadFeature[]): CadDocument =>
  parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id, name: id, units: 'mm', parameters: {}, features });
type Geometry = CadSketchFeature['profiles'][number]['geometry'];
const sketch = (id: string, geometries: readonly Geometry[], offset = 0, plane: CadSketchFeature['plane'] = 'XY'): CadSketchFeature =>
  ({ ...base(id), kind: 'sketch', plane, offset, profiles: geometries.map((geometry, index) => ({ id: `${id}_p${index}`, name: 'Profile', construction: false, geometry })) });
const pad = (id: string, sketchId: string, distance: number, operation: 'new' | 'join' | 'cut' = 'new', targetId: string | null = null): CadFeature =>
  ({ ...base(id), kind: 'extrude', sketchId, distance, symmetric: false, operation, targetId });
const rectangle = (x: number, y: number, width: number, height: number): Geometry => ({ kind: 'rectangle', x, y, width, height, cornerRadius: 0 });
const circle = (x: number, y: number, radius: number): Geometry => ({ kind: 'circle', x, y, radius });
const grid = (columns: number, rows: number) => Array.from({ length: columns * rows }, (_, index) => circle(10 + 20 * (index % columns), 12.5 + 25 * Math.floor(index / columns), 3));
const onDatum = { kind: 'datum-plane', featureId: 'datum' } as const;
const topFace = (offset: number) => ({ kind: 'faces' as const, expectedCount: 1, predicates: [{ kind: 'plane' as const, normal: [0, 0, 1] as [number, number, number], offset }] });

/** A disk with 24 patterned bosses joined and 12 patterned holes cut. */
export function cadKernelPatternHeavyFeatures(): CadFeature[] {
  return [sketch('disk_sketch', [circle(0, 0, 50)]), pad('disk', 'disk_sketch', 10),
    sketch('boss_sketch', [circle(40, 0, 3)], 10), pad('boss', 'boss_sketch', 8),
    { ...base('bosses'), kind: 'circular-pattern', sourceId: 'boss', count: 24, axis: 'z', center: [0, 0, 0], angle: 360 },
    { ...base('joined'), kind: 'boolean', operation: 'union', targetId: 'disk', toolId: 'bosses' },
    sketch('hole_sketch', [circle(20, 0, 2)]), pad('hole', 'hole_sketch', 10),
    { ...base('holes'), kind: 'circular-pattern', sourceId: 'hole', count: 12, axis: 'z', center: [0, 0, 0], angle: 360 },
    { ...base('part'), kind: 'boolean', operation: 'cut', targetId: 'joined', toolId: 'holes' }];
}

export interface CadKernelParityModel { readonly id: string; readonly document: CadDocument }

/**
 * Parts that exercise every owned builder: sketch faces with holes, prisms, revolves, booleans,
 * linear and circular patterns, mirror through each principal plane, transform, shell, all-edge
 * fillet and chamfer, loft, segment sweep, Pocket and datum-plane sketches, then every step of the
 * shipped kernel benchmark cases. The 359.9999° pattern unites copies that nearly meet: its faces
 * and volume change if a boolean skips Replicad's second build.
 */
export function cadKernelParityModels(): CadKernelParityModel[] {
  return [
    { id: 'plate-40-voids', document: document('plate_voids', [sketch('plate_sketch', [rectangle(0, 0, 200, 100), ...grid(10, 4)]), pad('plate', 'plate_sketch', 10)]) },
    { id: 'plate-40-cut-sketch', document: document('plate_cut', [sketch('plate_sketch', [rectangle(0, 0, 200, 100)]), pad('plate', 'plate_sketch', 10),
      sketch('holes_sketch', grid(10, 4)), pad('cut', 'holes_sketch', 10, 'cut', 'plate')]) },
    { id: 'plate-40-pattern', document: document('plate_pattern', [sketch('plate_sketch', [rectangle(0, 0, 200, 100)]), pad('plate', 'plate_sketch', 10),
      sketch('hole_sketch', [circle(10, 12.5, 3)]), pad('hole', 'hole_sketch', 10),
      { ...base('row'), kind: 'linear-pattern', sourceId: 'hole', count: 10, spacing: [20, 0, 0] },
      { ...base('rows'), kind: 'linear-pattern', sourceId: 'row', count: 4, spacing: [0, 25, 0] },
      { ...base('cut'), kind: 'boolean', operation: 'cut', targetId: 'plate', toolId: 'rows' }]) },
    { id: 'shell-fillet', document: document('shell_fillet', [sketch('box_sketch', [rectangle(0, 0, 40, 30)]), pad('box', 'box_sketch', 20),
      { ...base('shell'), kind: 'shell', targetId: 'box', thickness: 2, opening: topFace(20) },
      { ...base('rounded'), kind: 'fillet', targetId: 'shell', radius: 0.5 }]) },
    { id: 'box-chamfer-all', document: document('box_chamfer', [sketch('box_sketch', [rectangle(0, 0, 40, 30)]), pad('box', 'box_sketch', 20),
      { ...base('beveled'), kind: 'chamfer', targetId: 'box', radius: 1 }]) },
    { id: 'pattern-heavy', document: document('pattern_heavy', cadKernelPatternHeavyFeatures()) },
    { id: 'near-full-turn-pattern', document: document('near_full_turn', [sketch('seed_sketch', [circle(10, 0, 1)]), pad('seed', 'seed_sketch', 2),
      { ...base('pattern'), kind: 'circular-pattern', sourceId: 'seed', count: 3, axis: 'z', center: [0, 0, 0], angle: 359.9999 }]) },
    { id: 'revolve-mirror-transform', document: document('revolve', [sketch('ring_sketch', [rectangle(10, 0, 10, 20)], 0, 'XZ'),
      { ...base('ring'), kind: 'revolve', sketchId: 'ring_sketch', angle: 270, axis: 'y', operation: 'new', targetId: null },
      { ...base('mirrored'), kind: 'mirror', sourceId: 'ring', plane: 'XY' },
      { ...base('placed'), kind: 'transform', sourceId: 'mirrored', translation: [5, 0, 0], rotation: [0, 0, 30] },
      { ...base('mirrored_xz'), kind: 'mirror', sourceId: 'placed', plane: 'XZ' },
      { ...base('mirrored_yz'), kind: 'mirror', sourceId: 'mirrored_xz', plane: 'YZ' },
      sketch('full_sketch', [rectangle(30, 0, 5, 5)], 0, 'XZ'),
      { ...base('full'), kind: 'revolve', sketchId: 'full_sketch', angle: 360, axis: 'y', operation: 'new', targetId: null },
      sketch('boss_sketch', [circle(0, 0, 4)], 20), pad('boss', 'boss_sketch', 6),
      sketch('cap_sketch', [rectangle(-2, -10, 20, 20)], 20), pad('cap', 'cap_sketch', 3),
      { ...base('common'), kind: 'boolean', operation: 'intersect', targetId: 'boss', toolId: 'cap' },
      { ...base('tilted'), kind: 'transform', sourceId: 'common', translation: [1, 2, 3], rotation: [15, -20, 35] }]) },
    { id: 'loft-sweep-pocket', document: document('loft_sweep_pocket', [sketch('stock_sketch', [rectangle(-30, -30, 60, 60)]), pad('stock', 'stock_sketch', 20),
      sketch('lower', [circle(-15, -15, 4)]), sketch('upper', [circle(-15, -15, 6)], 20),
      { ...base('lofted'), kind: 'loft', sketchIds: ['lower', 'upper'], ruled: false, operation: 'cut', targetId: 'stock' },
      sketch('section', [circle(10, 10, 2)], -40, 'YZ'),
      { ...base('rail'), kind: 'curve', plane: 'XY', offset: 10, segments: [{ kind: 'line', start: [-40, 10], end: [40, 10] }] },
      { ...base('swept'), kind: 'sweep', sketchId: 'section', curveId: 'rail', operation: 'cut', targetId: 'lofted' },
      sketch('bore', [circle(15, -15, 3)]),
      { ...base('bored'), kind: 'pocket', sketchId: 'bore', targetId: 'swept', extent: { kind: 'through-all', direction: 'both' } }]) },
    { id: 'datum-pad-revolve', document: document('datum_parts', [
      { ...base('datum'), kind: 'datum-plane', definition: { kind: 'world', basePlane: 'XY', origin: [37, -24, 11], rotation: [23, -37, 61] } },
      sketch('outline', [{ kind: 'rectangle', x: -2, y: 3, width: 20, height: 12, cornerRadius: 2 }, circle(8, 9, 3), circle(8, 9, 1)], 7, onDatum),
      pad('plate', 'outline', 6),
      sketch('ring_sketch', [rectangle(30, 0, 5, 5)], 0, onDatum),
      { ...base('ring'), kind: 'revolve', sketchId: 'ring_sketch', angle: 180, axis: 'y', operation: 'new', targetId: null }]) },
    ...createCadKernelBenchmarkCases().flatMap(item => item.steps.map((step, index) => ({ id: `bench-${item.id}-${index}`, document: step.document })))
  ];
}
