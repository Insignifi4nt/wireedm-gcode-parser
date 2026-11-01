/**
 * One named precision policy for CAD, the sketch solver, the kernel bridge, CAM, output, imports and
 * simulation. Each role states what it compares and in which unit. Roles that share a value keep
 * separate names when they mean different things, so one can change without moving the other.
 *
 * The ordering between roles is enforced by `__tests__/cadPrecision.test.ts`, and the maintainer
 * page `docs/maintainers/precision.md` explains how to add a role. Rebuild caches key on
 * `CAD_PRECISION_VERSION`: bump it whenever a role's value or meaning changes.
 */
export const CAD_PRECISION_VERSION = 2;

/** OpenCascade's `Precision::Confusion()`, the smallest distance the kernel tells apart. */
const KERNEL_CONFUSION_MM = 1e-7;

const roles = {
  // Sketch solver and analytic sketch geometry.
  /** Sketch driver convergence, in each equation's millimetres (radians for angle drivers). The Rust solver's `ACCEPT_MM`. */
  solverResidualMm: 1e-10,
  /** A dragged sketch point counts as reached within this many millimetres, or `32` ulps of the sketch size. Owned by the Rust solver (`newton/drag.rs`). */
  solverDragReachedMm: 1e-8,
  /** Largest angle, or transverse error per unit direction, that sketch relations accept. The Rust solver's `ACCEPT_RADIANS`. */
  angularAccuracyRad: 1e-12,
  /** Upper bound on the angular roundoff allowance that far-origin tangency checks may add to `angularAccuracyRad`. */
  angularRoundoffCapRad: 1e-9,
  /** Floor of the analytic closure tolerance: endpoints that should coincide may differ by this much at unit scale. */
  closureFloorMm: 1e-12,
  /** Ulps of the coordinate magnitude that analytic closure allows above `closureFloorMm`. */
  closureUlps: 8,
  /** A radial point within this fraction of its radius (taken as at least 1 mm) from its centre has collapsed onto it, and the solver offers it fresh starts. */
  solverCollapsedStartRelative: 1e-12,
  /** An arm held square to a support starts along it when the sine between them is below this, and the solver offers it quarter-turn starts. */
  solverAlongSupportStartRelative: 1e-12,
  /** Cross product of two line directions, in square millimetres, at or below which legacy profile checks treat lines as parallel. */
  parallelCrossFloorMm2: 1e-14,
  /** Smallest size a pointer-drawn sketch shape accepts: circle radius, rectangle side, slot width or distinct arc centre. */
  pointerMinimumSizeMm: 0.001,

  // Sketch snaps and dimension placement. Both write sketch coordinates or saved annotation placements.
  /** Slack, as a fraction of a line segment's length, for a snapped intersection to count as on that bounded line. */
  snapLineSpanSlack: 1e-9,
  /** Angular slack for a snapped intersection to count as on an arc's sweep. */
  snapArcSweepSlackRad: 1e-9,
  /** Two lines have no intersection snap when the cross product of their directions is at or below this fraction of the product of their lengths. */
  snapParallelRelative: 1e-12,
  /** A line that misses a circle by at most this fraction of the squared radius, in squared distance, touches it: the snap is the foot of the perpendicular. */
  snapTangentRelative: 1e-12,
  /** Unit direction components at or below this count as zero when a dimension picks its text reading direction and the side its line sits on. */
  annotationReadingTie: 1e-12,
  /** Two dimension lines share a direction, and must step clear of each other, when their cross product is at or below this fraction of the length. */
  annotationParallelRelative: 1e-12,
  /** Slack below a full turn, in radians, for an angle dimension's text to sit beyond its sweep. */
  annotationFullTurnSlackRad: 1e-9,
  /** Smallest radius an angle dimension's arc is placed at. */
  annotationMinimumRadiusMm: 1e-6,

  // Kernel, model limits and feature inputs.
  /** Kernel confusion: native placement, sewing, thick-solid, section and topology-selector precision. */
  kernelConfusionMm: KERNEL_CONFUSION_MM,
  /** Smallest positive length, radius, thickness, spacing or edge a model accepts. Equal to kernel confusion, below which the kernel merges geometry. */
  minimumLengthMm: KERNEL_CONFUSION_MM,
  /** Smallest nonzero angle a revolve or circular pattern accepts, in degrees. */
  minimumAngleDeg: 1e-7,
  /** Largest length a model slot accepts: radius, distance, thickness, span or placement offset. */
  modelExtentMm: 1e6,
  /** Sweep clearance band around native topology, above kernel confusion. */
  sweepTopologyMm: 2e-7,
  /** Smallest volume, in cubic millimetres, that counts as solid material. */
  kernelMinimumVolumeMm3: 1e-9,
  /** Slack when a shell result's bounds are compared with the original solid's bounds. */
  kernelBoundsSlackMm: 1e-6,
  /** Smallest cap margin a pocket extent adds beyond its target. */
  pocketCapMarginFloorMm: 1e-6,
  /** Dimensionless tolerance on unit topology directions: normalization, parallel test and plane-normal match. */
  kernelDirection: 1e-10,
  /** Dimensionless orthonormality residual a datum or placement frame may carry. */
  frameOrthonormalResidual: 64 * Number.EPSILON,
  /** Display mesh chord deviation. */
  tessellationMm: 0.05,
  /** Display mesh angular deviation. */
  tessellationAngleRad: 0.15,
  /**
   * Angular tolerance, in radians, within which fuse, cut and intersect merge tangent faces and edges of their result when they
   * call `SimplifyResult` (OpenCascade's `theAngularTol`). Replicad 1.1's value, kept so boolean results stay the same.
   */
  kernelBooleanSimplifyRad: 0.001,
  /**
   * Two profile points within this distance on each axis are the same when a profile's lines and arcs are oriented and its
   * outline is closed. Replicad 1.1's samePoint, kept so profile curves stay the same.
   */
  kernelProfilePointMm: 1e-6,

  // Gear generation.
  /** Margin that keeps gear tooth half-angles away from pointed tips and overlap. */
  gearAngleMarginRad: 1e-6,
  /** Slack below zero allowed for the generated flank's starting roll parameter. */
  gearParameterSlackRad: 1e-10,
  /** Largest gap, as a fraction of the module, between the rack envelope and the involute at their join. */
  gearJoinPerModule: 1e-8,
  /** Slack below the standard rack undercut limit, in profile shift coefficient (a multiple of the module), that a gear still accepts. */
  gearUndercutShiftSlack: 1e-12,
  /** Relative reserve added to the certified flank and root envelope error bounds, so floating-point arithmetic never makes a bound optimistic. */
  gearBoundReserveRelative: 1e-12,

  // CAM.
  /** Endpoint join tolerance for the analytic CAD to CAM handoff. */
  camHandoffEndpointMm: 1e-7,
  /** Coincidence for the analytic CAD to CAM handoff. */
  camHandoffCoincidenceMm: 1e-9,
  /** Default endpoint join tolerance for imported path planning documents. */
  camDefaultEndpointMm: 0.001,
  /** Default coincidence for imported path planning documents. */
  camDefaultCoincidenceMm: 1e-5,
  /** Default coincidence when a DXF drawing becomes a UPID document. Its endpoint tolerance is zero. */
  dxfCamCoincidenceMm: 0.000002,
  /** Twice a contour's signed area, in square millimetres, at or below which its centroid falls back to the point average. */
  camDegenerateAreaMm2: 1e-9,
  /** Distance at which a contour's last point duplicates its first. */
  camClosingDuplicateMm: 1e-9,
  /** Distances closer than this rank as equal when CAM orders candidates. */
  camTieMm: 1e-12,
  /** Relative margin for rounding between box and exact distances when ranking rapids. */
  camRankRelative: 1e-9,
  /** Absolute margin, per millimetre of coordinate magnitude, when ranking rapids. */
  camRankAbsoluteMm: 1e-12,
  /** A vector or chord at or below this length has no direction: start equals end. */
  zeroLengthMm: 1e-12,
  /** Slack for a path editor source point lying on or inside an arc's radius. */
  pathInsideSlackMm: 1e-9,
  /** Floor for comparing UPID recorded lengths and bounds with recomputed values. */
  upidRecordedValueFloorMm: 1e-9,

  // Output. The audit compares emitted coordinates, parsed back from the post's decimal text, with the
  // planned doubles. Each arithmetic step may round by half an ulp of the values it handles, so the
  // audit allows a count of ulps of the magnitudes a comparison reads (`cadOutputPointRoundoff`,
  // `cadOutputDerivedRoundoff`), per axis wherever the comparison separates the axes. A fixed guard
  // cannot replace it: half an ulp of a coordinate exceeds `Number.EPSILON` from 8 mm upwards.
  /**
   * Ulps the output audit allows on each axis when it compares an emitted endpoint or arc centre with the plan, of the largest
   * coordinate it reads on that axis. Parsing the emitted decimal, the quantum's own double and the difference cost 1/2 ulp each;
   * an incremental centre adds the post's centre minus start, its parse and the runtime's start plus offset, at most 3/2 ulps.
   * At most 3; 4 keeps a margin.
   */
  outputPointRoundoffUlps: 4,
  /**
   * Ulps per summed term the output audit allows for a distance from a planned line, a radial distance from a planned arc, a path
   * length or an arc sweep. Parsing, subtraction, direction normalisation (a hypot and a division), products and sums give at most
   * 13 for a line distance and 17 for a radial distance, each per axis and weighted by that axis's share of the distance, 12 per
   * length term and 35 per sweep term, whose magnitude includes a full turn's arc length. 32 covers each with a margin.
   */
  outputDerivedRoundoffUlps: 32,

  // Imports and approximation.
  /** Default largest chord deviation when DXF splines and ellipses are approximated. */
  approximationChordMm: 0.001,
  /** Dimensionless tolerance for a DXF extrusion direction to count as the world Z axis. */
  dxfPlanarNormal: 1e-12,
  /** Largest Z difference for DXF geometry to count as planar. */
  dxfPlanarZMm: 1e-9,

  // External G-code inspection and editing.
  /** Position equality when parsing, measuring and previewing G-code. */
  gcodePositionMm: 1e-9,
  /** Position equality when G-code line operations match motion endpoints. */
  gcodeLineMatchMm: 1e-6,
  /** Coordinate equality when G-code structure analysis matches positions. */
  gcodeStructureMatchMm: 1e-4,
  /** An R-word arc whose start and end are this close or closer has no defined centre, and block interpretation refuses it. */
  gcodeArcChordMm: 1e-12,

  // Simulation.
  /** Contact tolerance between simulated material, stock and polygon boundaries. Per millimetre of edge length in material topology. */
  simulationContactMm: 1e-8,
  /** Cross product or polygon area, in square millimetres, at or below which simulation geometry is degenerate. */
  simulationDegenerateAreaMm2: 1e-12,
  /** Clearance tolerance between the wire, its guides and released or remaining material. */
  simulationObstructionMm: 1e-7,
  /** Machine model triangle intersection tolerance. */
  simulationMachineGeometryMm: 1e-7
};

/** Every role, typed as plain numbers so callers can pass any value of the same unit. */
export const CAD_PRECISION: Readonly<typeof roles> = Object.freeze(roles);

export type CadPrecisionRole = keyof typeof CAD_PRECISION;

/** Floating-point uncertainty: `ulps` units in the last place of `magnitude`. Callers derive `ulps` from their arithmetic. */
export function cadRoundoff(ulps: number, magnitude = 1): number {
  return ulps * Number.EPSILON * magnitude;
}

/** Analytic closure at a coordinate magnitude: arithmetic roundoff only, never a physical gap repair. */
export function cadClosureTolerance(scale: number): number {
  return Math.max(CAD_PRECISION.closureFloorMm, cadRoundoff(CAD_PRECISION.closureUlps, scale));
}

/** A positive length above the minimum length and within the model extent. NaN fails. */
export function cadSupportedLength(value: number): boolean {
  return value > CAD_PRECISION.minimumLengthMm && value <= CAD_PRECISION.modelExtentMm;
}

/**
 * Output audit roundoff of one axis of an emitted endpoint or arc centre compared with the plan: `outputPointRoundoffUlps` ulps
 * of `magnitudeMm`, the largest coordinate the comparison reads on that axis. Magnitudes below 1 mm count as 1 mm, so the
 * allowance never falls below the fixed guard of one ulp of 1 mm that the audit used before.
 */
export function cadOutputPointRoundoff(magnitudeMm: number): number {
  return cadRoundoff(CAD_PRECISION.outputPointRoundoffUlps, Math.max(1, magnitudeMm));
}

/**
 * Output audit roundoff of a distance, length or sweep derived from emitted coordinates: `outputDerivedRoundoffUlps` ulps of
 * `magnitudeMm` for each of `terms` summed values (a path length or sweep sums the planned value and each emitted motion). A line
 * or radial distance asks once per axis, with that axis's largest coordinate, and weights the result by that axis's share.
 * Magnitudes below 1 mm count as 1 mm.
 */
export function cadOutputDerivedRoundoff(magnitudeMm: number, terms = 1): number {
  return cadRoundoff(CAD_PRECISION.outputDerivedRoundoffUlps * terms, Math.max(1, magnitudeMm));
}

/** Output fitting for motion without per-axis rounding: how far audited controller motion may differ from planned motion. */
export interface CadOutputFitting {
  /** Rounded endpoints and centres, and the distance from a planned line. */
  readonly pointMm: number;
  /** Lengths and arc endpoint radii, whose two rounded ends both contribute. */
  readonly lengthMm: number;
  /** Arc sweep, compared from rounded start, end and centre at both ends. */
  readonly arcSweepMm: number;
}

/**
 * The plan's endpoint tolerance, or the post's coordinate rounding plus `roundoffMm`, whichever is larger. The caller passes the
 * roundoff of the comparison it makes, from `cadOutputPointRoundoff` or `cadOutputDerivedRoundoff`.
 */
export function cadOutputFitting(sourceToleranceMm: number, coordinateQuantumMm: number, roundoffMm: number): CadOutputFitting {
  return {
    pointMm: Math.max(sourceToleranceMm, coordinateQuantumMm / Math.SQRT2 + roundoffMm),
    lengthMm: Math.max(sourceToleranceMm, coordinateQuantumMm * Math.SQRT2 + roundoffMm),
    arcSweepMm: Math.max(sourceToleranceMm, coordinateQuantumMm * 4 + roundoffMm)
  };
}
