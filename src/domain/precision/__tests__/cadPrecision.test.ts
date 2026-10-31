import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAD_PRECISION as P,
  CAD_PRECISION_VERSION,
  cadClosureTolerance,
  cadOutputFitting,
  cadRoundoff,
  cadSupportedLength,
  type CadPrecisionRole
} from '../cadPrecision';

/** The values this version shipped with. Changing one means bumping `CAD_PRECISION_VERSION`. */
const VERSION_1: Readonly<Record<CadPrecisionRole, number>> = {
  solverResidualMm: 1e-10, solverDragReachedMm: 1e-8, angularAccuracyRad: 1e-12, angularRoundoffCapRad: 1e-9,
  closureFloorMm: 1e-12, closureUlps: 8, relativeZero: 1e-12, parallelCrossFloorMm2: 1e-14, pointerMinimumSizeMm: 0.001,
  kernelConfusionMm: 1e-7, minimumLengthMm: 1e-7, minimumAngleDeg: 1e-7, modelExtentMm: 1e6, sweepTopologyMm: 2e-7,
  kernelMinimumVolumeMm3: 1e-9, kernelBoundsSlackMm: 1e-6, pocketCapMarginFloorMm: 1e-6, kernelDirection: 1e-10,
  frameOrthonormalResidual: 64 * Number.EPSILON, tessellationMm: 0.05, tessellationAngleRad: 0.15,
  gearAngleMarginRad: 1e-6, gearParameterSlackRad: 1e-10, gearJoinPerModule: 1e-8,
  camHandoffEndpointMm: 1e-7, camHandoffCoincidenceMm: 1e-9, camDefaultEndpointMm: 0.001, camDefaultCoincidenceMm: 1e-5,
  dxfCamCoincidenceMm: 0.000002, camDegenerateAreaMm2: 1e-9, camClosingDuplicateMm: 1e-9, camTieMm: 1e-12,
  camRankRelative: 1e-9, camRankAbsoluteMm: 1e-12, zeroLengthMm: 1e-12, pathInsideSlackMm: 1e-9,
  upidRecordedValueFloorMm: 1e-9, outputRoundingGuardMm: Number.EPSILON, approximationChordMm: 0.001,
  dxfPlanarNormal: 1e-12, dxfPlanarZMm: 1e-9, gcodePositionMm: 1e-9, gcodeLineMatchMm: 1e-6, gcodeStructureMatchMm: 1e-4,
  simulationContactMm: 1e-8, simulationDegenerateAreaMm2: 1e-12, simulationObstructionMm: 1e-7, simulationMachineGeometryMm: 1e-7
};

/** Largest sketch coordinate magnitude the graph accepts (`cadSketchGraph` and the construction schemas). */
const COORDINATE_BUDGET_MM = 1e9;

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
  { name: 'kernel confusion < approximation chord < tessellation',
    holds: () => P.kernelConfusionMm < P.approximationChordMm && P.approximationChordMm < P.tessellationMm },
  { name: 'angular accuracy <= kernel direction, and < roundoff cap < tessellation angle',
    holds: () => P.angularAccuracyRad <= P.kernelDirection && P.angularAccuracyRad < P.angularRoundoffCapRad
      && P.angularRoundoffCapRad < P.tessellationAngleRad },
  { name: 'closure across the model extent stays within the CAD handoff endpoint and kernel confusion',
    holds: () => cadClosureTolerance(P.modelExtentMm) <= P.camHandoffEndpointMm && cadClosureTolerance(P.modelExtentMm) <= P.kernelConfusionMm },
  { name: 'output fitting never narrows the plan tolerance and grows point <= length <= arc sweep',
    holds: () => [0, 1e-4, 1e-3].every(quantum => {
      const fit = cadOutputFitting(P.camHandoffEndpointMm, quantum);
      return fit.pointMm >= P.camHandoffEndpointMm && fit.pointMm <= fit.lengthMm && fit.lengthMm <= fit.arcSweepMm;
    }) },
  { name: 'every converged solver residual passes structural closure at sketch scales',
    holds: () => [1, 100, 10_000].every(scale => cadClosureTolerance(scale) >= P.solverResidualMm),
    known: 'Closure is 1e-12 below about 56,000 mm while the solver accepts 1e-10. An arc of radius 10 whose end '
      + 'radius is off by 5e-11 is converged for the solver but reported as arc-radius-mismatch by checkCadSketchGraph.' },
  { name: 'closure at the coordinate budget stays within kernel confusion and the CAD handoff endpoint',
    holds: () => cadClosureTolerance(COORDINATE_BUDGET_MM) <= P.kernelConfusionMm,
    known: 'Sketch coordinates are accepted up to 1e9 mm, but closure passes kernel confusion above about 5.6e7 mm. '
      + 'At x = 1e8 mm, endpoints 1.5e-7 mm apart count as joined (closure 1.8e-7) but the CAD handoff joins only within 1e-7.' }
];

describe('CAD precision policy', () => {
  it('pins this version’s values so a change must bump CAD_PRECISION_VERSION', () => {
    expect(CAD_PRECISION_VERSION).toBe(1);
    expect(P).toEqual(VERSION_1);
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
    for (const [source, quantum] of [[1e-7, 0], [1e-7, 1e-4], [0.001, 0.001], [0, 0.0005]]) {
      expect(cadOutputFitting(source, quantum)).toEqual({
        pointMm: Math.max(source, quantum / Math.SQRT2 + Number.EPSILON),
        lengthMm: Math.max(source, quantum * Math.SQRT2 + Number.EPSILON),
        arcSweepMm: Math.max(source, quantum * 4 + Number.EPSILON)
      });
    }
  });

  it('agrees with the Rust sketch solver’s acceptance and drag constants', () => {
    const read = (file: string) => readFileSync(new URL(`../../../../packages/sketch-solver/src/${file}`, import.meta.url), 'utf8');
    const newton = read('newton.rs'), drag = read('newton/drag.rs');
    const constant = (name: string) => Number(new RegExp(`pub const ${name}: f64 = ([0-9.e-]+);`).exec(newton)?.[1]);
    expect(constant('ACCEPT_MM')).toBe(P.solverResidualMm);
    expect(constant('ACCEPT_RADIANS')).toBe(P.angularAccuracyRad);
    expect(newton).toContain(`ACCEPT_MM.max(${P.closureUlps}.0 * f64::EPSILON * scale)`);
    expect(Number(/let reached = ([0-9.e-]+)_f64\.max\(32\.0 \* f64::EPSILON \* scale\);/.exec(drag)?.[1])).toBe(P.solverDragReachedMm);
  });
});
