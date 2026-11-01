import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CadProfile } from '@/domain/cad/cadDocument';
import { cadSketchToCam } from '@/domain/cad/cadCam';
import { createCadDocument, createCadSketchProfile, parseCadDocument } from '@/domain/cad/cadSchema';
import { cadSketchToEntities } from '@/domain/cad/cadSketchGeometry';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import {
  CAD_PRECISION as P,
  CAD_PRECISION_VERSION,
  cadClosureTolerance,
  cadOutputDerivedRoundoff,
  cadOutputFitting,
  cadOutputPointRoundoff,
  cadRoundoff,
  cadSupportedLength,
  type CadPrecisionRole
} from '../cadPrecision';

/**
 * The values this version shipped with. Changing one means bumping `CAD_PRECISION_VERSION`. Version 2 replaced the output
 * audit's fixed guard (`outputRoundingGuardMm`, one ulp of 1 mm) with ulp counts that scale with the compared values.
 */
const VERSION_2: Readonly<Record<CadPrecisionRole, number>> = {
  solverResidualMm: 1e-10, solverDragReachedMm: 1e-8, angularAccuracyRad: 1e-12, angularRoundoffCapRad: 1e-9,
  closureFloorMm: 1e-12, closureUlps: 8, solverCollapsedStartRelative: 1e-12, solverAlongSupportStartRelative: 1e-12, parallelCrossFloorMm2: 1e-14, pointerMinimumSizeMm: 0.001,
  snapLineSpanSlack: 1e-9, snapArcSweepSlackRad: 1e-9, snapParallelRelative: 1e-12, snapTangentRelative: 1e-12,
  annotationReadingTie: 1e-12, annotationParallelRelative: 1e-12, annotationFullTurnSlackRad: 1e-9, annotationMinimumRadiusMm: 1e-6,
  kernelConfusionMm: 1e-7, minimumLengthMm: 1e-7, minimumAngleDeg: 1e-7, modelExtentMm: 1e6, sweepTopologyMm: 2e-7,
  kernelMinimumVolumeMm3: 1e-9, kernelBoundsSlackMm: 1e-6, pocketCapMarginFloorMm: 1e-6, kernelDirection: 1e-10, kernelBooleanSimplifyMm: 0.001,
  frameOrthonormalResidual: 64 * Number.EPSILON, tessellationMm: 0.05, tessellationAngleRad: 0.15,
  gearAngleMarginRad: 1e-6, gearParameterSlackRad: 1e-10, gearJoinPerModule: 1e-8, gearUndercutShiftSlack: 1e-12, gearBoundReserveRelative: 1e-12,
  camHandoffEndpointMm: 1e-7, camHandoffCoincidenceMm: 1e-9, camDefaultEndpointMm: 0.001, camDefaultCoincidenceMm: 1e-5,
  dxfCamCoincidenceMm: 0.000002, camDegenerateAreaMm2: 1e-9, camClosingDuplicateMm: 1e-9, camTieMm: 1e-12,
  camRankRelative: 1e-9, camRankAbsoluteMm: 1e-12, zeroLengthMm: 1e-12, pathInsideSlackMm: 1e-9,
  upidRecordedValueFloorMm: 1e-9, outputPointRoundoffUlps: 4, outputDerivedRoundoffUlps: 32, approximationChordMm: 0.001,
  dxfPlanarNormal: 1e-12, dxfPlanarZMm: 1e-9, gcodePositionMm: 1e-9, gcodeLineMatchMm: 1e-6, gcodeStructureMatchMm: 1e-4, gcodeArcChordMm: 1e-12,
  simulationContactMm: 1e-8, simulationDegenerateAreaMm2: 1e-12, simulationObstructionMm: 1e-7, simulationMachineGeometryMm: 1e-7
};

/** Largest sketch coordinate magnitude the graph accepts (`cadSketchGraph` and the construction schemas). */
const COORDINATE_BUDGET_MM = 1e9;

/** Coordinate magnitudes the output audit compares: below its 1 mm floor, at it, and up to the model extent. */
const OUTPUT_MAGNITUDES_MM = [0, 0.5, 1, 8, 1000, 1e6];

interface Order {
  readonly name: string;
  readonly holds: () => boolean;
  /** A relation that ought to hold but does not today. The finding is recorded, not fixed here. */
  readonly known?: string;
}

const ORDERING: readonly Order[] = [
  { name: 'closure floor < solver residual < drag reached < kernel confusion',
    holds: () => P.closureFloorMm < P.solverResidualMm && P.solverResidualMm < P.solverDragReachedMm && P.solverDragReachedMm < P.kernelConfusionMm },
  { name: 'minimum length is kernel confusion', holds: () => P.minimumLengthMm === P.kernelConfusionMm },
  { name: 'kernel confusion < sweep topology band', holds: () => P.kernelConfusionMm < P.sweepTopologyMm },
  { name: 'sweep topology band < pocket cap margin and shell bounds slack',
    holds: () => P.sweepTopologyMm < P.pocketCapMarginFloorMm && P.sweepTopologyMm < P.kernelBoundsSlackMm },
  { name: 'minimum length < model extent', holds: () => P.minimumLengthMm < P.modelExtentMm },
  { name: 'pointer shapes are valid model lengths', holds: () => cadSupportedLength(P.pointerMinimumSizeMm) },
  { name: 'CAD handoff coincidence < CAD handoff endpoint <= kernel confusion',
    holds: () => P.camHandoffCoincidenceMm < P.camHandoffEndpointMm && P.camHandoffEndpointMm <= P.kernelConfusionMm },
  { name: 'imported CAM coincidence < imported CAM endpoint',
    holds: () => P.camDefaultCoincidenceMm < P.camDefaultEndpointMm && P.dxfCamCoincidenceMm < P.camDefaultEndpointMm },
  { name: 'CAD handoff endpoint < imported CAM endpoint', holds: () => P.camHandoffEndpointMm < P.camDefaultEndpointMm },
  { name: 'kernel confusion < boolean simplify tolerance < tessellation',
    holds: () => P.kernelConfusionMm < P.kernelBooleanSimplifyMm && P.kernelBooleanSimplifyMm < P.tessellationMm },
  { name: 'kernel confusion < approximation chord < tessellation',
    holds: () => P.kernelConfusionMm < P.approximationChordMm && P.approximationChordMm < P.tessellationMm },
  { name: 'angular accuracy <= kernel direction, and < roundoff cap < tessellation angle',
    holds: () => P.angularAccuracyRad <= P.kernelDirection && P.angularAccuracyRad < P.angularRoundoffCapRad
      && P.angularRoundoffCapRad < P.tessellationAngleRad },
  { name: 'closure across the model extent stays within the CAD handoff endpoint and kernel confusion',
    holds: () => cadClosureTolerance(P.modelExtentMm) <= P.camHandoffEndpointMm && cadClosureTolerance(P.modelExtentMm) <= P.kernelConfusionMm },
  { name: 'output fitting never narrows the plan tolerance and grows point <= length <= arc sweep',
    holds: () => [0, 1e-4, 1e-3].every(quantum => OUTPUT_MAGNITUDES_MM.every(magnitude => {
      const fit = cadOutputFitting(P.camHandoffEndpointMm, quantum, cadOutputPointRoundoff(magnitude));
      return fit.pointMm >= P.camHandoffEndpointMm && fit.pointMm <= fit.lengthMm && fit.lengthMm <= fit.arcSweepMm;
    })) },
  { name: 'output point roundoff <= output derived roundoff per term',
    holds: () => P.outputPointRoundoffUlps <= P.outputDerivedRoundoffUlps
      && OUTPUT_MAGNITUDES_MM.every(magnitude => cadOutputPointRoundoff(magnitude) <= cadOutputDerivedRoundoff(magnitude)) },
  { name: 'output roundoff covers an ulp of every compared magnitude and never falls below the fixed guard it replaced',
    holds: () => OUTPUT_MAGNITUDES_MM.every(magnitude => cadOutputPointRoundoff(magnitude) >= cadRoundoff(1, magnitude)
      && cadOutputPointRoundoff(magnitude) >= Number.EPSILON) },
  { name: 'one emitted motion’s output roundoff across the model extent stays below half a 6-decimal quantum',
    // The largest single-motion comparison is a sweep: two terms over coordinates and a full turn of a model-extent radius.
    holds: () => cadOutputDerivedRoundoff(P.modelExtentMm * (1 + 2 * Math.PI), 2) < 1e-6 / 2
      && cadOutputPointRoundoff(P.modelExtentMm) < 1e-6 / 2 },
  { name: 'output point roundoff across the model extent stays below half the finest quantum a post may declare (12 decimals)',
    holds: () => cadOutputPointRoundoff(P.modelExtentMm) < 1e-12 / 2,
    known: 'Post packages may emit up to 12 decimals, but a 1e-12 mm quantum is below the output point roundoff above about 563 mm, '
      + 'and below one ulp of the coordinate itself from 8,192 mm. There a wrong last digit near half-way passes the audit.' },
  { name: 'every converged solver residual passes structural closure at sketch scales',
    holds: () => [1, 100, 10_000].every(scale => cadClosureTolerance(scale) >= P.solverResidualMm),
    known: 'Closure stays at its 1e-12 floor up to about 563 mm and reaches the solver’s 1e-10 only at about 56,295 mm. '
      + 'An arc of radius 10 whose end radius is off by 5e-11 is converged for the solver but reported as arc-radius-mismatch '
      + 'by checkCadSketchGraph.' },
  { name: 'closure across the model extent stays within the CAD handoff coincidence',
    holds: () => cadClosureTolerance(P.modelExtentMm) <= P.camHandoffCoincidenceMm,
    known: 'Closure passes the CAD handoff coincidence (1e-9) above about 562,950 mm, inside the 1e6 mm model extent. '
      + 'A square near x = 999,000 mm whose closing end lies on its first edge 1.5134e-9 mm from its start is closed for CAD, '
      + 'but the CAD handoff reports intersecting-topology and refuses it with cam-geometry.' },
  { name: 'closure at the coordinate budget stays within kernel confusion and the CAD handoff endpoint',
    holds: () => cadClosureTolerance(COORDINATE_BUDGET_MM) <= P.kernelConfusionMm,
    known: 'Sketch coordinates are accepted up to 1e9 mm, but closure passes kernel confusion above about 5.6e7 mm. '
      + 'At x = 1e8 mm, endpoints 1.5e-7 mm apart count as joined (closure 1.8e-7) but the CAD handoff joins only within 1e-7.' }
];

describe('CAD precision policy', () => {
  it('pins this version’s values so a change must bump CAD_PRECISION_VERSION', () => {
    expect(CAD_PRECISION_VERSION).toBe(2);
    expect(P).toEqual(VERSION_2);
    expect(Object.isFrozen(P)).toBe(true);
  });

  it.each(ORDERING.filter(order => !order.known))('holds: $name', order => {
    expect(order.holds()).toBe(true);
  });

  it.each(ORDERING.filter(order => order.known))('records the known violation: $name', order => {
    // When this starts holding, remove the `known` marker so the relation is enforced.
    expect(order.holds(), order.known).toBe(false);
  });

  it('computes policy functions exactly as the expressions they replace', () => {
    for (const magnitude of [0, 1, Math.PI, 2 * Math.PI, 123.456, 1e6, 9e8]) {
      for (const ulps of [1, 2, 8, 16, 32, 64, 128]) expect(cadRoundoff(ulps, magnitude)).toBe(ulps * Number.EPSILON * magnitude);
      expect(cadClosureTolerance(magnitude)).toBe(Math.max(1e-12, 8 * Number.EPSILON * magnitude));
    }
    expect(cadRoundoff(4, Math.PI)).toBe(Number.EPSILON * Math.PI * 4);
    expect(cadRoundoff(64, 2 * Math.PI)).toBe(64 * Number.EPSILON * 2 * Math.PI);
    for (const value of [Number.NaN, -1, 0, 1e-7, 1.0000001e-7, 1, 1e6, 1.000001e6, Infinity]) {
      expect(cadSupportedLength(value)).toBe(value > 1e-7 && value <= 1e6);
    }
    for (const [source, quantum, roundoff] of [[1e-7, 0, Number.EPSILON], [1e-7, 1e-4, 4 * Number.EPSILON * 1000],
      [0.001, 0.001, 64 * Number.EPSILON * 8], [0, 0.0005, 4 * Number.EPSILON]]) {
      expect(cadOutputFitting(source, quantum, roundoff)).toEqual({
        pointMm: Math.max(source, quantum / Math.SQRT2 + roundoff),
        lengthMm: Math.max(source, quantum * Math.SQRT2 + roundoff),
        arcSweepMm: Math.max(source, quantum * 4 + roundoff)
      });
    }
    // The output audit's scaled roundoff, as the audit wrote it before it moved here.
    for (const magnitude of [0, 0.25, 1, 8.0015, 1000, 1e6, 2 * Math.PI * 1e6]) {
      expect(cadOutputPointRoundoff(magnitude)).toBe(4 * Number.EPSILON * Math.max(1, magnitude));
      for (const terms of [1, 2, 3, 5]) {
        expect(cadOutputDerivedRoundoff(magnitude, terms)).toBe(32 * terms * Number.EPSILON * Math.max(1, magnitude));
      }
      expect(cadOutputDerivedRoundoff(magnitude)).toBe(cadOutputDerivedRoundoff(magnitude, 1));
    }
  });

  it('agrees with the Rust sketch solver’s acceptance and drag constants', () => {
    const read = (file: string) => readFileSync(new URL(`../../../../packages/sketch-solver/src/${file}`, import.meta.url), 'utf8');
    const newton = read('newton.rs'), drag = read('newton/drag.rs');
    const constant = (name: string) => Number(new RegExp(`pub const ${name}: f64 = ([0-9.e-]+);`).exec(newton)?.[1]);
    expect(constant('ACCEPT_MM')).toBe(P.solverResidualMm);
    expect(constant('ACCEPT_RADIANS')).toBe(P.angularAccuracyRad);
    expect(constant('CLOSURE_ULPS')).toBe(P.closureUlps);
    // Both acceptance sites, the row tolerances and the repeated-equation witness, read the constant.
    expect(newton).toContain('        let roundoff = CLOSURE_ULPS * f64::EPSILON * self.scale;\n'
      + '        (ACCEPT_MM.max(roundoff), if self.reach > 0.0 { ACCEPT_RADIANS.max(roundoff / self.reach) } else { ACCEPT_RADIANS })\n');
    expect(newton).toContain('        ACCEPT_MM.max(CLOSURE_ULPS * f64::EPSILON * scale)\n');
    expect(newton).not.toMatch(/\b\d+(\.\d*)? \* f64::EPSILON \* (self\.)?scale\b/);
    expect(Number(/let reached = ([0-9.e-]+)_f64\.max\(32\.0 \* f64::EPSILON \* scale\);/.exec(drag)?.[1])).toBe(P.solverDragReachedMm);
  });
});

describe('closure crossovers', () => {
  it('stays at its floor up to about 563 mm and reaches the solver residual, handoff coincidence and kernel confusion further out', () => {
    expect(cadClosureTolerance(562)).toBe(P.closureFloorMm);
    expect(cadClosureTolerance(563)).toBeGreaterThan(P.closureFloorMm);
    for (const [below, above, value] of [[56_294, 56_296, P.solverResidualMm], [562_949, 562_951, P.camHandoffCoincidenceMm],
      [56_294_994, 56_294_996, P.kernelConfusionMm]] as const) {
      expect(cadClosureTolerance(below)).toBeLessThan(value);
      expect(cadClosureTolerance(above)).toBeGreaterThan(value);
    }
  });
});

describe('output roundoff crossovers', () => {
  it('passes half a 12-decimal quantum from about 563 mm, where that quantum is still about 9 ulps of the coordinate', () => {
    expect(cadOutputPointRoundoff(562)).toBeLessThan(1e-12 / 2);
    expect(cadOutputPointRoundoff(563)).toBeGreaterThan(1e-12 / 2);
    // One ulp of a coordinate in [4096, 8192) mm is 2^-40 (9.1e-13); from 8192 mm it is 2^-39 (1.8e-12), above the quantum.
    expect(2 ** -40).toBeLessThan(1e-12);
    expect(2 ** -39).toBeGreaterThan(1e-12);
  });
});

describe('known violation reproducers', () => {
  const square = (x: number, closingEnd: readonly [number, number]) => parseCadDocument({ ...createCadDocument('Far square', 'cad_far'),
    features: [{ kind: 'sketch', id: 'far', name: 'Far', suppressed: false, plane: 'XY', offset: 0,
      profiles: [createCadSketchProfile({ id: 'square', geometry: { kind: 'path', segments: [
        { kind: 'line', start: [x, 0], end: [x + 1, 0] }, { kind: 'line', start: [x + 1, 0], end: [x + 1, 1] },
        { kind: 'line', start: [x + 1, 1], end: [x, 1] }, { kind: 'line', start: [x, 1], end: [...closingEnd] }] } as CadProfile })] }] });
  const handoff = (document: ReturnType<typeof square>) => {
    const sketch = document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('expected a sketch');
    return createPathPlanningDocumentFromDxfEntities(cadSketchToEntities(sketch, document.parameters),
      { endpointTolerance: P.camHandoffEndpointMm, coincidenceEpsilon: P.camHandoffCoincidenceMm });
  };

  it('closure above the CAD handoff coincidence: CAD closes a far square that the handoff refuses as intersecting', () => {
    const document = square(999_000, [999_000 + 1.5134e-9, 0]);
    expect(handoff(document).diagnostics).toContainEqual(expect.objectContaining({ severity: 'error', code: 'intersecting-topology' }));
    expect(() => cadSketchToCam(document, 'far')).toThrow(expect.objectContaining({ code: 'cam-geometry' }));
    // Near the origin the same gap is a physical gap for CAD too.
    expect(() => square(10, [10 + 1.5134e-9, 0])).toThrow('must be continuous and closed');
  });

  it('closure above kernel confusion: CAD closes a square at 1e8 mm that the handoff leaves open', () => {
    const document = square(1e8, [1e8, 1.5e-7]);
    expect(handoff(document).contours.some(contour => !contour.closed)).toBe(true);
    expect(() => cadSketchToCam(document, 'far')).toThrow(expect.objectContaining({ code: 'cam-geometry' }));
  });
});
