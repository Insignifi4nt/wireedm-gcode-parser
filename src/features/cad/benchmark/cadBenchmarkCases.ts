import type { CadDocument, CadFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';

/** Kernel-neutral expectation for one visible body; volumes are analytic, never read back from a kernel. */
export interface CadBenchmarkBodyExpectation { readonly featureId: string; readonly volume: number; readonly solidCount?: number }
export interface CadBenchmarkStep {
  readonly label: string;
  readonly document: CadDocument;
  readonly bodies: readonly CadBenchmarkBodyExpectation[];
  /**
   * Only the bodies this step's edit changes, with every input they need, including unchanged
   * ones. A rebuild that reuses unaffected bodies should take no longer than this document.
   */
  readonly affectedBodies?: { readonly document: CadDocument; readonly bodies: readonly CadBenchmarkBodyExpectation[] };
}
/** The first step is the cold build; later steps are edits rebuilt through the shipped whole-document cache. */
export interface CadKernelBenchmarkCase { readonly id: string; readonly description: string; readonly steps: readonly [CadBenchmarkStep, ...CadBenchmarkStep[]] }

const RELATIVE_VOLUME_TOLERANCE = 1e-6;
export const cadBenchmarkVolumeMatches = (actual: number, expected: number) => Math.abs(actual - expected) <= RELATIVE_VOLUME_TOLERANCE * Math.abs(expected);

const base = (id: string, name = id) => ({ id, name, suppressed: false });
const document = (id: string, features: readonly CadFeature[]): CadDocument =>
  parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id, name: id, units: 'mm', parameters: {}, features });
const sketch = (id: string, geometry: CadSketchFeature['profiles'][number]['geometry']): CadSketchFeature =>
  ({ ...base(id), kind: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: `${id}_profile`, name: 'Profile', construction: false, geometry }] });
const pad = (id: string, sketchId: string, distance: number): CadFeature =>
  ({ ...base(id), kind: 'extrude', sketchId, distance, symmetric: false, operation: 'new', targetId: null });

const HOLE_RADIUS = 3, HOLE_COUNT = 6, THICKNESS = 10;
/** A plate at x=origin with six through holes cut by a patterned tool body. */
function holedPlate(originX: number, width: number): CadFeature[] {
  return [
    sketch('plate_sketch', { kind: 'rectangle', x: originX, y: 0, width, height: 60, cornerRadius: 0 }), pad('plate', 'plate_sketch', THICKNESS),
    sketch('hole_sketch', { kind: 'circle', x: originX + 10, y: 10, radius: HOLE_RADIUS }), pad('hole', 'hole_sketch', THICKNESS),
    { ...base('holes'), kind: 'linear-pattern', sourceId: 'hole', count: HOLE_COUNT, spacing: [12, 0, 0] },
    { ...base('cut'), kind: 'boolean', targetId: 'plate', toolId: 'holes', operation: 'cut' }
  ];
}
const holedPlateVolume = (width: number) => width * 60 * THICKNESS - HOLE_COUNT * Math.PI * HOLE_RADIUS ** 2 * THICKNESS;

function gearFeatures(): CadFeature[] {
  return [sketch('gear_sketch', createCadPluginProfile(CAD_GEAR_V3_PLUGIN)), pad('gear', 'gear_sketch', THICKNESS)];
}
/** The gear profile is lines and arcs, so its analytic sketch area times thickness is exact. */
function gearVolume(): number {
  return measureCadSketch(document('gear_area', gearFeatures()), 'gear_sketch').materialAreaMm2 * THICKNESS;
}

/** Minkowski sum of the inner box with a sphere: every edge and corner rounded by radius. */
function filletedBoxVolume(a: number, b: number, c: number, radius: number) {
  const [x, y, z] = [a - 2 * radius, b - 2 * radius, c - 2 * radius];
  return x * y * z + 2 * radius * (x * y + y * z + x * z) + Math.PI * radius ** 2 * (x + y + z) + 4 / 3 * Math.PI * radius ** 3;
}
function filletedBox(radius: number): CadDocument {
  return document('box_fillet', [sketch('box_sketch', { kind: 'rectangle', x: 0, y: 0, width: 40, height: 30, cornerRadius: 0 }), pad('box', 'box_sketch', 20),
    { ...base('rounded'), kind: 'fillet', targetId: 'box', radius }]);
}

export function createCadKernelBenchmarkCases(): CadKernelBenchmarkCase[] {
  const gear = gearVolume();
  return [
    { id: 'plate-hole-pattern', description: 'Plate cut by a six-hole linear pattern; the width edit invalidates every feature.', steps: [
      { label: 'build', document: document('plate', holedPlate(0, 100)), bodies: [{ featureId: 'cut', volume: holedPlateVolume(100), solidCount: 1 }] },
      { label: 'plate width 120', document: document('plate', holedPlate(0, 120)), bodies: [{ featureId: 'cut', volume: holedPlateVolume(120), solidCount: 1 }] }
    ] },
    { id: 'gear-and-plate', description: 'Independent gear and holed plate; editing only the plate still rebuilds the gear.', steps: [
      { label: 'build', document: document('gear_plate', [...gearFeatures(), ...holedPlate(200, 100)]),
        bodies: [{ featureId: 'gear', volume: gear, solidCount: 1 }, { featureId: 'cut', volume: holedPlateVolume(100), solidCount: 1 }] },
      { label: 'plate width 110', document: document('gear_plate', [...gearFeatures(), ...holedPlate(200, 110)]),
        bodies: [{ featureId: 'gear', volume: gear, solidCount: 1 }, { featureId: 'cut', volume: holedPlateVolume(110), solidCount: 1 }],
        affectedBodies: { document: document('gear_plate', holedPlate(200, 110)), bodies: [{ featureId: 'cut', volume: holedPlateVolume(110), solidCount: 1 }] } }
    ] },
    { id: 'box-fillet-all-edges', description: 'Box with all twelve edges filleted; the radius edit reruns the rolling-ball fillet.', steps: [
      { label: 'build', document: filletedBox(2), bodies: [{ featureId: 'rounded', volume: filletedBoxVolume(40, 30, 20, 2), solidCount: 1 }] },
      { label: 'radius 3', document: filletedBox(3), bodies: [{ featureId: 'rounded', volume: filletedBoxVolume(40, 30, 20, 3), solidCount: 1 }] }
    ] }
  ];
}

/**
 * Independent fully constrained rectangles: fixed corner, horizontal/vertical sides and two
 * distances each, so every rectangle is its own zero-freedom component. Unsolved corners start
 * deliberately off so the solver has work to do; saved documents need the solved positions.
 */
export function createCadBenchmarkRectangleGraph(count: number, prefix = 'r', solved = false): CadSketchGraph {
  const points: { id: string; position: [number, number] }[] = [], entities: unknown[] = [], relations: unknown[] = [];
  for (let index = 0; index < count; index++) {
    const ox = (index % 10) * 30, oy = Math.floor(index / 10) * 30, id = `${prefix}${index}`;
    const corners = (solved ? [[0, 0], [20, 0], [20, 10], [0, 10]] as const : [[0, 0], [20.3, 0.4], [19.6, 10.2], [0.2, 9.8]] as const).map(([x, y], corner) => {
      points.push({ id: `${id}_p${corner}`, position: [ox + x, oy + y] }); return `${id}_p${corner}`;
    });
    corners.forEach((start, side) => entities.push({ id: `${id}_l${side}`, kind: 'line', construction: false, startPointId: start, endPointId: corners[(side + 1) % 4] }));
    relations.push(
      { id: `${id}_fixed`, kind: 'fixed-point', pointId: corners[0], position: [ox, oy] },
      { id: `${id}_bottom`, kind: 'horizontal', pointIds: [corners[0], corners[1]] }, { id: `${id}_top`, kind: 'horizontal', pointIds: [corners[3], corners[2]] },
      { id: `${id}_right`, kind: 'vertical', pointIds: [corners[1], corners[2]] }, { id: `${id}_left`, kind: 'vertical', pointIds: [corners[0], corners[3]] },
      { id: `${id}_width`, kind: 'distance', pointIds: [corners[0], corners[1]], value: 20 }, { id: `${id}_height`, kind: 'distance', pointIds: [corners[1], corners[2]], value: 10 });
  }
  return parseCadSketchGraph({ points, entities, relations });
}

/**
 * Drag-preview workload: sketchCount independent graph sketches (no external references),
 * dragging the first rectangle of the first sketch, whose fixed corner is released so the drag
 * moves it. Today every sketch is re-solved per preview; an edited-sketch-only preparation
 * should solve one.
 */
export function createCadBenchmarkDragPreview(sketchCount: number, rectanglesPerSketch: number): { document: CadDocument; edit: CadEdit } {
  const features: CadFeature[] = Array.from({ length: sketchCount }, (_, index): CadSketchFeature => {
    const graph = createCadBenchmarkRectangleGraph(rectanglesPerSketch, `s${index}r`, true);
    return { ...base(`sketch_${index}`), kind: 'sketch', plane: 'XY', offset: index * 5, profiles: [],
      graph: index ? graph : { ...graph, relations: graph.relations.filter(relation => relation.id !== 's0r0_fixed') } };
  });
  return { document: parseCadDocument({ format: 'wireedm-cad', schemaVersion: 2, id: 'drag_preview', name: 'drag_preview', units: 'mm', parameters: {}, features }),
    edit: { kind: 'move-sketch-point', sketchId: 'sketch_0', pointId: 's0r0_p2', translation: [0.5, 0.25] } };
}
