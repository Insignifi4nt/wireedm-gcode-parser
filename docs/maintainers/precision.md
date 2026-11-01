# CAD and CAM precision policy

Every tolerance that decides whether two lengths, points, angles or areas are the same lives in `src/domain/precision/cadPrecision.ts`. The module names each tolerance by its role, states its unit and meaning, and exports `CAD_PRECISION_VERSION`. Other code reads a role (`CAD_PRECISION.kernelConfusionMm`) or calls a policy function. It does not write the number.

A role is not one shared epsilon. Two places that use the same value for different reasons get two roles, so one can change without moving the other. `kernelConfusionMm`, `minimumLengthMm`, `camHandoffEndpointMm`, `simulationObstructionMm` and `simulationMachineGeometryMm` are all `1e-7` today, and each means something different. Likewise a contact test reads `kernelConfusionMm` and a size refusal reads `minimumLengthMm`, even in one file.

[The survey](precision-survey.md) lists every literal that was considered, with the role that replaced it or the reason it stays.

## Roles

Units: `Mm` millimetres, `Mm2` square millimetres, `Mm3` cubic millimetres, `Rad` radians, `Deg` degrees. A role without a unit suffix is a ratio.

| Area | Role | Value | Meaning |
| --- | --- | --- | --- |
| Sketch solver | `solverResidualMm` | 1e-10 | Driver convergence. The Rust solver's `ACCEPT_MM`. |
| | `solverDragReachedMm` | 1e-8 | A dragged point counts as reached (or 32 ulps of the sketch size). Owned by Rust `newton/drag.rs`. |
| | `angularAccuracyRad` | 1e-12 | Largest angle or direction error a sketch relation accepts. The Rust solver's `ACCEPT_RADIANS`. |
| | `angularRoundoffCapRad` | 1e-9 | Upper bound on the roundoff that far-origin tangency may add. |
| | `closureFloorMm` | 1e-12 | Floor of analytic closure. |
| | `closureUlps` | 8 | Ulps of the coordinate magnitude that closure allows above the floor. |
| | `solverCollapsedStartRelative` | 1e-12 | A radial point this close to its centre, relative to its radius, has collapsed and gets fresh solver starts. |
| | `solverAlongSupportStartRelative` | 1e-12 | An arm held square to a support starts along it when the sine between them is below this, and gets quarter-turn solver starts. |
| | `mirrorPairingTieRelative` | 1e-9 | Two mirrored lines pair their ends crossed only when that is nearer to each other's mirror images, in summed squared gaps, by more than this fraction; nearer ties pair start with start. |
| | `parallelCrossFloorMm2` | 1e-14 | Cross product below which legacy profile checks treat lines as parallel. |
| | `pointerMinimumSizeMm` | 0.001 | Smallest pointer-drawn circle radius, rectangle side, slot width or arc centre separation. |
| Sketch snaps and dimensions | `snapLineSpanSlack` | 1e-9 | Slack, per segment length, for a snapped intersection on a bounded line. |
| | `snapArcSweepSlackRad` | 1e-9 | Slack for a snapped intersection on an arc's sweep. |
| | `snapParallelRelative`, `snapTangentRelative` | 1e-12, 1e-12 | Lines with no intersection snap, and a line that touches a circle. |
| | `annotationReadingTie` | 1e-12 | Direction components that count as zero for a dimension's text reading and side. |
| | `annotationParallelRelative` | 1e-12 | Dimension lines that share a direction and step clear of each other. |
| | `annotationFullTurnSlackRad` | 1e-9 | Slack below a full turn for angle dimension text beyond its sweep. |
| | `annotationMinimumRadiusMm` | 1e-6 | Smallest angle dimension arc radius a placement gets. |
| Kernel and model | `kernelConfusionMm` | 1e-7 | OpenCascade `Precision::Confusion()`: placement, sewing, thick solid, section and selector precision. |
| | `minimumLengthMm` | 1e-7 | Smallest positive length, radius, thickness, spacing or edge a model accepts. |
| | `minimumAngleDeg` | 1e-7 | Smallest revolve or circular pattern angle. |
| | `modelExtentMm` | 1e6 | Largest length, radius, distance, thickness, span or placement offset a model slot accepts. |
| | `sweepTopologyMm` | 2e-7 | Sweep clearance band around native topology. |
| | `kernelMinimumVolumeMm3` | 1e-9 | Smallest volume that counts as solid material. |
| | `kernelBoundsSlackMm` | 1e-6 | Slack when shell result bounds are compared with the original. |
| | `pocketCapMarginFloorMm` | 1e-6 | Smallest cap margin a pocket extent adds. |
| | `kernelDirection` | 1e-10 | Unit direction normalization, parallel test and plane normal match. |
| | `frameOrthonormalResidual` | 64 ε | Orthonormality residual of a datum or placement frame. |
| | `tessellationMm`, `tessellationAngleRad` | 0.05, 0.15 | Display mesh deviation. |
| Gears | `gearAngleMarginRad` | 1e-6 | Keeps tooth half-angles away from pointed tips and overlap. |
| | `gearParameterSlackRad` | 1e-10 | Allowed slack below zero for the flank's first roll parameter. |
| | `gearJoinPerModule` | 1e-8 | Largest rack envelope to involute gap, per module. |
| | `gearUndercutShiftSlack` | 1e-12 | Profile shift below the rack undercut limit that a gear still accepts. |
| | `gearBoundReserveRelative` | 1e-12 | Relative reserve on certified flank and root envelope error bounds. |
| CAM | `camHandoffEndpointMm`, `camHandoffCoincidenceMm` | 1e-7, 1e-9 | Planning options for analytic CAD geometry sent to CAM. |
| | `camDefaultEndpointMm`, `camDefaultCoincidenceMm` | 0.001, 1e-5 | Default planning options for imported path documents. |
| | `dxfCamCoincidenceMm` | 2e-6 | Coincidence when a DXF drawing becomes a UPID document. |
| | `camDegenerateAreaMm2` | 1e-9 | Twice-area below which a contour centroid falls back to the point average. |
| | `camClosingDuplicateMm` | 1e-9 | Distance at which a contour's last point repeats its first. |
| | `camTieMm` | 1e-12 | Candidate distances closer than this rank equal. |
| | `camRankRelative`, `camRankAbsoluteMm` | 1e-9, 1e-12 | Margins when rapid candidates are ranked. |
| | `zeroLengthMm` | 1e-12 | A vector or chord this short has no direction. |
| | `pathInsideSlackMm` | 1e-9 | Slack for a path editor point on or inside an arc radius. |
| | `upidRecordedValueFloorMm` | 1e-9 | Floor when recorded UPID lengths and bounds are compared with recomputed ones. |
| Output | `outputRoundingGuardMm` | ε | Guard added to the post's coordinate rounding in the output audit. |
| Imports | `approximationChordMm` | 0.001 | Default chord deviation when DXF splines and ellipses are approximated. |
| | `dxfPlanarNormal`, `dxfPlanarZMm` | 1e-12, 1e-9 | DXF extrusion direction and Z planarity. |
| External G-code | `gcodePositionMm` | 1e-9 | Position equality when G-code is parsed, measured and previewed. |
| | `gcodeLineMatchMm` | 1e-6 | Endpoint match in G-code line operations. |
| | `gcodeStructureMatchMm` | 1e-4 | Coordinate match in G-code structure analysis. |
| | `gcodeArcChordMm` | 1e-12 | An R-word arc whose ends are this close has no centre and is refused. |
| Simulation | `simulationContactMm` | 1e-8 | Contact between material, stock and polygon boundaries. |
| | `simulationDegenerateAreaMm2` | 1e-12 | Cross product or area at which simulation geometry is degenerate. |
| | `simulationObstructionMm` | 1e-7 | Wire, guide and material clearance. |
| | `simulationMachineGeometryMm` | 1e-7 | Machine model triangle intersection. |

The module's JSDoc is the source of truth. Update this table when a role changes.

## Policy functions

- `cadRoundoff(ulps, magnitude = 1)` is `ulps * Number.EPSILON * magnitude`, evaluated in that order. The caller derives `ulps` from its arithmetic. Replacing `N * Number.EPSILON * x` with `cadRoundoff(N, x)` gives the same bits.
- `cadClosureTolerance(scale)` is analytic closure: `max(closureFloorMm, cadRoundoff(closureUlps, scale))`, where `scale` is the largest coordinate magnitude. It allows arithmetic roundoff, never a physical gap repair. `cadPathClosureTolerance` and `cadSketchDriverTolerance` use it.
- `cadSupportedLength(value)` is `minimumLengthMm < value <= modelExtentMm`. NaN fails. It replaces checks that already had exactly this form. Checks written as `value <= min || value > max` let NaN through and keep that form.
- `cadOutputFitting(sourceToleranceMm, coordinateQuantumMm)` gives the output audit's point, length and arc sweep allowances. Each is the plan's endpoint tolerance or the post's rounding plus `outputRoundingGuardMm`, whichever is larger.

## Ordering

`src/domain/precision/__tests__/cadPrecision.test.ts` checks the relations between roles. These hold today:

- closure floor < solver residual < drag reached < kernel confusion;
- minimum length = kernel confusion < sweep topology band < pocket cap margin and shell bounds slack;
- CAD handoff coincidence < CAD handoff endpoint ≤ kernel confusion < approximation chord < tessellation;
- imported coincidences < imported endpoint, and the CAD handoff endpoint < the imported endpoint;
- angular accuracy ≤ kernel direction, and < the angular roundoff cap < tessellation angle;
- closure across the model extent ≤ the CAD handoff endpoint and kernel confusion;
- output fitting never narrows the plan tolerance, and point ≤ length ≤ arc sweep;
- pointer-drawn sizes are valid model lengths.

Three relations that ought to hold do not. The test marks each `known` and asserts it is still violated, so a fix shows up as a failing test that asks for the marker to go.

Closure is `max(1e-12, 8ε·scale)`. It stays at its 1e-12 floor up to about 563 mm, reaches the solver's 1e-10 at about 56,295 mm, the CAD handoff coincidence of 1e-9 at about 562,950 mm, and kernel confusion of 1e-7 at about 5.6e7 mm. The test pins each crossover.

1. The solver accepts residuals of `solverResidualMm` (1e-10), but structural checks hold arc endpoints to closure, which is 1e-12 up to about 563 mm and stays below 1e-10 up to about 56,295 mm. An arc of radius 10 whose end radius is 5e-11 off counts as converged for the solver, but `checkCadSketchGraph` reports `arc-radius-mismatch`.
2. Sketch coordinates are accepted up to 1e9 mm, but above about 5.6e7 mm closure is larger than kernel confusion and the CAD handoff endpoint. At x = 1e8 mm, endpoints 1.5e-7 mm apart are joined for closure (1.8e-7) but not for the handoff (1e-7). A test reproduces it: CAD closes a square at x = 1e8 mm with a 1.5e-7 mm gap, and the handoff leaves it open.
3. Closure passes the CAD handoff coincidence (`camHandoffCoincidenceMm`, 1e-9) above about 562,950 mm, inside the 1e6 mm model extent, where it is 1.8e-9. A test reproduces it: a square near x = 999,000 mm whose closing end lies on its first edge 1.5134e-9 mm from its start is closed for CAD, but the handoff reports `intersecting-topology` and refuses it with `cam-geometry`. Near the origin the same gap is a physical gap for CAD too.

## Imported tolerances

A tolerance that arrives in a file is checked against the policy, not adopted as a role. Some places adopt one today. This refactor keeps that behaviour and does not change it:

- STEP: OpenCascade reads with its default precision mode, so the shape's tolerances come from the file's uncertainty. Import analysis does not compare them with the policy. Pocket and cut evidence then use the shape's own tolerance (`cadKernelShapeTolerance`) for precision and margins.
- UPID: `endpointTolerance` and `coincidenceEpsilon` come from the document's options, with no policy upper bound, and drive planning, the execution plan and the output audit's source tolerance.
- DXF has no file tolerance. Splines and ellipses use `approximationChordMm` from the app.

## Adding or changing a role

1. Find the role. If an existing role means the same thing in the same unit, use it. If only the value is the same, add a new role.
2. Add the role to `cadPrecision.ts` with JSDoc that gives its meaning and unit, and name its unit in the key (`Mm`, `Mm2`, `Mm3`, `Rad`, `Deg`, or none for a ratio).
3. Add it to `VERSION_1` in the test, or to a new version record, and add the ordering relations it takes part in. If a relation that should hold fails, record it as `known` and report it. Do not change values to make it pass.
4. To change a value or meaning, bump `CAD_PRECISION_VERSION`, update the pinned record and this page, and check what rebuild caches key on it.
5. If the role mirrors a Rust solver constant, extend the Rust agreement test. `solverResidualMm`, `angularAccuracyRad` and `closureUlps` mirror `ACCEPT_MM`, `ACCEPT_RADIANS` and `CLOSURE_ULPS` in `newton.rs`; the test also pins both expressions that read `CLOSURE_ULPS`. A Rust change rebuilds the committed module (`npm run solver:build`, then `npm run solver:check`).
6. Prefer a policy function to a formula at the call site when a tolerance scales with size.

## The literal check

`npm run lint` also runs `scripts/check-precision-literals.ts` over non-test source outside the policy module. It finds:

- negative-exponent literals (`1e-9`), and decimals below 0.001 (`0.00001`);
- a literal raised to a negative literal power (`10 ** -9`, `Math.pow(10, -9)`);
- such a number converted from a string (`Number('1e-9')`, `parseFloat('1e-9')`, `+'1e-9'`);
- `Number.EPSILON` in any spelling, including `Number['EPSILON']`, `(Number).EPSILON` and `const { EPSILON } = Number`.

It ignores comments and other strings, and does not trace aliases of `Number`. Literals that stay where they are, such as unit factors, input ranges, a series switch, benchmark inputs and view-space picking and layout, are listed per file with a reason. View space means the value never ends up in model coordinates, saved placements, CAM or output: snap intersections and dimension placement do, so they read roles. A file cannot gain literals beyond its entry, and an entry larger than needed has to shrink. Decimals of 0.001 and above are not checked, because UI sizes, ratios and product defaults use them everywhere. Review catches those. `src/domain/precision/__tests__/precisionLiteralScan.test.ts` covers each spelling.
