# Precision literal survey

The survey behind [the precision policy](precision.md). It lists every candidate tolerance literal in non-test source at 8c7c3b50 (release 0.0.788): negative exponents, `Number.EPSILON`, `1e6` and `1e9` bounds, and small decimals. Locations are lines at that commit. Each row says which role or policy function replaced the literal, or why it stays. [Literals added by the merge with 26089af0](#literals-added-by-the-merge-with-26089af0) lists the three that releases 0.0.789 and 0.0.790 added, at lines of 26089af0.

437 candidates: 247 moved behind roles and policy functions, 190 stay.

Release 0.0.792 (precision version 2) later replaced `outputRoundingGuardMm` with `outputPointRoundoffUlps` and `outputDerivedRoundoffUlps`, read through `cadOutputPointRoundoff` and `cadOutputDerivedRoundoff`; `cadOutputFitting` now takes the roundoff of each comparison. The rows below record the survey as it was.

A literal stays as view or pointer space only if its value never ends up in model coordinates, saved placements, CAM or output. Sketch snap intersections and dimension placement fail that test, so their tolerances are roles.

## Literals that stay

| Reason | Literals |
| --- | ---: |
| View or pointer space | 62 |
| Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent | 49 |
| Message or help text | 22 |
| Plugin input range, default or expression | 16 |
| Unit factor | 15 |
| Post conformance fixture input | 8 |
| Comment | 6 |
| Gear design limit or default, not a tolerance | 5 |
| Benchmark input or acceptance | 3 |
| Confidence weight, not a tolerance | 1 |
| Display formatting threshold | 1 |
| Series expansion switch, not a tolerance | 1 |
| View: viewport aspect match | 1 |

## Moved literals by role

Counted under the first role or function each row names.

| Role or function | Literals |
| --- | ---: |
| `cadRoundoff` | 52 |
| `minimumLengthMm` | 39 |
| `modelExtentMm` | 19 |
| `kernelConfusionMm` | 13 |
| `cadSupportedLength` | 11 |
| `angularAccuracyRad` | 9 |
| `kernelMinimumVolumeMm3` | 8 |
| `gcodePositionMm` | 6 |
| `outputRoundingGuardMm` | 6 |
| `simulationContactMm` | 6 |
| `annotationReadingTie` | 5 |
| `pointerMinimumSizeMm` | 5 |
| `cadOutputFitting` | 3 |
| `kernelDirection` | 3 |
| `upidRecordedValueFloorMm` | 3 |
| `annotationMinimumRadiusMm` | 2 |
| `annotationParallelRelative` | 2 |
| `cadClosureTolerance` | 2 |
| `camDegenerateAreaMm2` | 2 |
| `camRankAbsoluteMm` | 2 |
| `camRankRelative` | 2 |
| `camTieMm` | 2 |
| `gearAngleMarginRad` | 2 |
| `gearBoundReserveRelative` | 2 |
| `kernelBoundsSlackMm` | 2 |
| `minimumAngleDeg` | 2 |
| `simulationDegenerateAreaMm2` | 2 |
| `solverResidualMm` | 2 |
| `zeroLengthMm` | 2 |
| `angularRoundoffCapRad` | 1 |
| `annotationFullTurnSlackRad` | 1 |
| `approximationChordMm` | 1 |
| `camClosingDuplicateMm` | 1 |
| `camDefaultCoincidenceMm` | 1 |
| `camDefaultEndpointMm` | 1 |
| `camHandoffCoincidenceMm` | 1 |
| `camHandoffEndpointMm` | 1 |
| `dxfCamCoincidenceMm` | 1 |
| `dxfPlanarNormal` | 1 |
| `dxfPlanarZMm` | 1 |
| `frameOrthonormalResidual` | 1 |
| `gcodeArcChordMm` | 1 |
| `gcodeLineMatchMm` | 1 |
| `gcodeStructureMatchMm` | 1 |
| `gearJoinPerModule` | 1 |
| `gearParameterSlackRad` | 1 |
| `gearUndercutShiftSlack` | 1 |
| `parallelCrossFloorMm2` | 1 |
| `pathInsideSlackMm` | 1 |
| `pocketCapMarginFloorMm` | 1 |
| `simulationMachineGeometryMm` | 1 |
| `simulationObstructionMm` | 1 |
| `snapArcSweepSlackRad` | 1 |
| `snapLineSpanSlack` | 1 |
| `snapParallelRelative` | 1 |
| `snapTangentRelative` | 1 |
| `solverAlongSupportStartRelative` | 1 |
| `solverCollapsedStartRelative` | 1 |
| `sweepTopologyMm` | 1 |
| `tessellationMm` | 1 |

## Literals added by the merge with 26089af0

Releases 0.0.789 (section caps and plane selection) and 0.0.790 (sketch axis elements) added three candidates in non-test source. Their line numbers are at 26089af0, and they are counted in the totals above. Release 0.0.790 also rewrote the collapsed-start test in `cadSketchNativeAttempt.ts`, now at line 109, which still reads `solverCollapsedStartRelative`. `cadSameLine` in `cadReferenceSelection.ts` reads the datum aliases of `frameOrthonormalResidual` and `kernelConfusionMm`, so it adds no literal.

| Location | Value | Role | Moved |
| --- | --- | --- | --- |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:131` | `1e-12` | `solverAlongSupportStartRelative` | moved |
| `features/cad/view/cadSectionCaps.ts:359` | `1e-6` |  | left: View or pointer space (the section cap quad's margin past the cut outline, drawn only) |
| `features/cad/view/cadSectionView.ts:46` | `1e-12` |  | left: View or pointer space (a pick ray parallel to the section plane) |

## Every candidate

| Location | Value | Role | Moved |
| --- | --- | --- | --- |
| `domain/cad/cadAnalyticSegments.ts:26` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadAnalyticSegments.ts:26` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadAnalyticSegments.ts:39` | `1.8e-16` |  | left: Comment |
| `domain/cad/cadAnalyticSegments.ts:67` | `1e-12` | `cadClosureTolerance (closureFloorMm, closureUlps)` | moved |
| `domain/cad/cadAnalyticSegments.ts:67` | `Number.EPSILON` | `cadClosureTolerance (closureFloorMm, closureUlps)` | moved |
| `domain/cad/cadCam.ts:46` | `1e-7` | `camHandoffEndpointMm` | moved |
| `domain/cad/cadCam.ts:46` | `1e-9` | `camHandoffCoincidenceMm` | moved |
| `domain/cad/cadCurve.ts:49` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadCurve.ts:66` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadDatumPlanes.ts:12` | `Number.EPSILON` | `frameOrthonormalResidual` | moved |
| `domain/cad/cadDatumPlanes.ts:13` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadExpression.ts:16` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadFrameBounds.ts:30` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadFrameBounds.ts:52` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadFrameBounds.ts:65` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadGear.ts:7` | `0.005` |  | left: Gear design limit or default, not a tolerance |
| `domain/cad/cadGear.ts:21` | `0.05` |  | left: Gear design limit or default, not a tolerance |
| `domain/cad/cadGear.ts:21` | `0.05` |  | left: Message or help text |
| `domain/cad/cadGear.ts:26` | `0.00001` |  | left: Gear design limit or default, not a tolerance |
| `domain/cad/cadGear.ts:26` | `0.00001` |  | left: Message or help text |
| `domain/cad/cadGear.ts:29` | `1e-12` | `gearUndercutShiftSlack` | moved |
| `domain/cad/cadGear.ts:38` | `1e-6` | `gearAngleMarginRad` | moved |
| `domain/cad/cadGear.ts:38` | `1e-6` | `gearAngleMarginRad` | moved |
| `domain/cad/cadGear.ts:59` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadGearGenerated.ts:41` | `0.001` |  | left: Gear design limit or default, not a tolerance |
| `domain/cad/cadGearGenerated.ts:41` | `0.001` |  | left: Message or help text |
| `domain/cad/cadGearGenerated.ts:46` | `1e-10` | `gearParameterSlackRad` | moved |
| `domain/cad/cadGearGenerated.ts:49` | `0.05` |  | left: Gear design limit or default, not a tolerance |
| `domain/cad/cadGearGenerated.ts:82` | `1e-12` | `gearBoundReserveRelative` | moved |
| `domain/cad/cadGearGenerated.ts:112` | `1e-8` | `gearJoinPerModule` | moved |
| `domain/cad/cadGearGenerated.ts:146` | `1e-12` | `gearBoundReserveRelative` | moved |
| `domain/cad/cadImports.ts:98` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadLoftPlacement.ts:15` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadLoftPlacement.ts:20` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadLoftPlacement.ts:24` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/cad/cadLoftPlacement.ts:128` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/cad/cadLoftPlacement.ts:166` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/cad/cadOperations.ts:72` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadOperations.ts:72` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPathConstruction.ts:15` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPathConstruction.ts:15` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPathConstruction.ts:25` | `1e9` |  | left: Message or help text |
| `domain/cad/cadPathConstruction.ts:31` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadPathConstruction.ts:31` | `1e-7` |  | left: Message or help text |
| `domain/cad/cadPathConstruction.ts:48` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/cad/cadPathConstruction.ts:57` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadPathConstruction.ts:57` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPathConstruction.ts:57` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadPathConstruction.ts:64` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadPatterns.ts:17` | `1e-7` | `minimumAngleDeg` | moved |
| `domain/cad/cadPocketExtent.ts:10` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadPocketExtent.ts:11` | `1e-6` | `pocketCapMarginFloorMm` | moved |
| `domain/cad/cadPocketExtent.ts:12` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadPocketExtent.ts:42` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPocketExtent.ts:42` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPocketExtent.ts:71` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/cad/cadPrimitives.ts:3` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadPrimitives.ts:3` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSchema.ts:284` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSchema.ts:284` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSchema.ts:287` | `1e-7` | `minimumAngleDeg` | moved |
| `domain/cad/cadSchema.ts:304` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSchema.ts:304` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSchema.ts:309` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSchema.ts:309` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSchema.ts:317` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSection.ts:11` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSection.ts:11` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSection.ts:16` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchAngleRelations.ts:75` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchAngleRelations.ts:85` | `Number.EPSILON` | `cadRoundoff(32, …)` | moved |
| `domain/cad/cadSketchAngleRelations.ts:88` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchAngleRelations.ts:88` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchArrangement.ts:235` | `Number.EPSILON` | `cadRoundoff(32, …)` | moved |
| `domain/cad/cadSketchArrangement.ts:313` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:14` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:14` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:16` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:62` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:67` | `1e-7` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:67` | `1e6` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:80` | `1e-7` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerGeometry.ts:80` | `1e6` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerTreatment.ts:57` | `1e-7` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerTreatment.ts:57` | `1e6` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchCornerTreatment.ts:60` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchCornerTreatment.ts:60` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchEqualRelations.ts:41` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchEqualRelations.ts:41` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGeometry.ts:21` | `1e-7` | `kernelConfusionMm` for contacts; `minimumLengthMm` for sizes | moved |
| `domain/cad/cadSketchGeometry.ts:160` | `Number.EPSILON` | `cadRoundoff(16, …)` | moved |
| `domain/cad/cadSketchGeometry.ts:170` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/cad/cadSketchGeometry.ts:220` | `1e-14` | `parallelCrossFloorMm2` | moved |
| `domain/cad/cadSketchGeometry.ts:297` | `1e6` | `cadSupportedLength` (`modelExtentMm`) | moved |
| `domain/cad/cadSketchGraph.ts:27` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGraph.ts:27` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGraph.ts:30` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGraph.ts:31` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGraph.ts:254` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchGraph.ts:282` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchGraph.ts:282` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchGraph.ts:291` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchGraph.ts:291` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchGraph.ts:296` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchGraph.ts:302` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchGraph.ts:302` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchHandles.ts:133` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchHandles.ts:172` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchHandles.ts:178` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchHandles.ts:186` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchHandles.ts:186` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchLineRelations.ts:19` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchLineRelations.ts:39` | `1e-12` |  | left: Comment |
| `domain/cad/cadSketchLineRelations.ts:43` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchLinearPattern.ts:83` | `1e-7` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchLinearPattern.ts:83` | `1e6` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchLinearPattern.ts:87` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchMirror.ts:83` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchMirror.ts:83` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchMirror.ts:134` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchOffset.ts:66` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchOffset.ts:66` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchOffset.ts:71` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchOffset.ts:71` | `1e6` | `modelExtentMm` | moved |
| `domain/cad/cadSketchOffset.ts:79` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchOffset.ts:84` | `Number.EPSILON` | `cadRoundoff(32, …)` | moved |
| `domain/cad/cadSketchOffset.ts:93` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchOffset.ts:96` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchOffset.ts:110` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchPlacement.ts:72` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchPointLineDistanceRelations.ts:172` | `Number.EPSILON` | `cadRoundoff(32, …)` | moved |
| `domain/cad/cadSketchPrecision.ts:5` | `1e-10` | `solverResidualMm` | moved |
| `domain/cad/cadSketchProfileCopy.ts:48` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchProfileCopy.ts:55` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchRadialRelations.ts:13` | `1e-7` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchRadialRelations.ts:13` | `1e6` | `cadSupportedLength (minimumLengthMm, modelExtentMm)` | moved |
| `domain/cad/cadSketchRadialRelations.ts:22` | `0.0000001` |  | left: Message or help text |
| `domain/cad/cadSketchSplit.ts:51` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchTangentRelations.ts:58` | `1e-12` |  | left: Comment |
| `domain/cad/cadSketchTangentRelations.ts:61` | `1e-12` | `angularAccuracyRad` | moved |
| `domain/cad/cadSketchTangentRelations.ts:61` | `1e-9` | `angularRoundoffCapRad` | moved |
| `domain/cad/cadSketchTranslation.ts:53` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadSketchTranslation.ts:82` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/cad/cadSketchTrimExtend.ts:273` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchTrimExtend.ts:293` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchTrimExtend.ts:558` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchTrimExtend.ts:694` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSketchTrimExtend.ts:721` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/cadSweepClearance.ts:10` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadSweepClearance.ts:11` | `2e-7` | `sweepTopologyMm` | moved |
| `domain/cad/cadSweepClearance.ts:36` | `Number.EPSILON` | `cadRoundoff(32, …)` | moved |
| `domain/cad/cadSweepClearance.ts:148` | `Number.EPSILON` | `cadRoundoff(roundingFactor, …)` | moved |
| `domain/cad/cadSweepClearance.ts:152` | `Number.EPSILON` | `cadRoundoff(roundingFactor, …)` | moved |
| `domain/cad/cadSweepClearance.ts:158` | `Number.EPSILON` | `cadRoundoff(roundingFactor, …)` | moved |
| `domain/cad/cadSweepClearance.ts:174` | `Number.EPSILON` | `cadRoundoff(roundingFactor, …)` | moved |
| `domain/cad/cadSweepPlacement.ts:47` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadSweepPlacement.ts:47` | `1e-7` | `kernelConfusionMm` | moved |
| `domain/cad/cadTopology.ts:80` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadTopology.ts:80` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/cadTopology.ts:151` | `1e-10` | `kernelDirection` | moved |
| `domain/cad/cadTopology.ts:156` | `1e-7` | `minimumLengthMm` | moved |
| `domain/cad/plugins/cadPlugins.ts:39` | `0.05` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:41` | `0.005` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:41` | `0.00001` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:42` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:42` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:42` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:42` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:63` | `0.05` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:66` | `0.005` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:66` | `0.00001` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:67` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:67` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:67` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:67` | `1e6` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:75` | `0.00000001` |  | left: Message or help text |
| `domain/cad/plugins/cadPlugins.ts:77` | `0.005` |  | left: Message or help text |
| `domain/cad/plugins/cadPlugins.ts:91` | `0.00001` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:111` | `0.00000001` |  | left: Message or help text |
| `domain/cad/plugins/cadPlugins.ts:113` | `0.001` |  | left: Message or help text |
| `domain/cad/plugins/cadPlugins.ts:123` | `0.00001` |  | left: Plugin input range, default or expression |
| `domain/cad/plugins/cadPlugins.ts:135` | `0.001` |  | left: Message or help text |
| `domain/cad/plugins/cadPlugins.ts:213` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/plugins/cadPlugins.ts:214` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/cad/sketch-solver/compileCadSketchEquations.ts:46` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/dxf/approximateSpline.ts:35` | `1e-12` | `zeroLengthMm` | moved |
| `domain/dxf/dxfToUpid.ts:9` | `0.000002` | `dxfCamCoincidenceMm` | moved |
| `domain/dxf/parseDxf.ts:107` | `0.001` | `approximationChordMm` | moved |
| `domain/dxf/parseDxf.ts:108` | `1e-12` | `dxfPlanarNormal` | moved |
| `domain/dxf/parseDxf.ts:110` | `1e-9` | `dxfPlanarZMm` | moved |
| `domain/dxf/parseDxf.ts:241` | `0.0000254` |  | left: Unit factor |
| `domain/dxf/parseDxf.ts:242` | `0.0254` |  | left: Unit factor |
| `domain/dxf/parseDxf.ts:244` | `1e-7` |  | left: Unit factor |
| `domain/dxf/parseDxf.ts:245` | `0.000001` |  | left: Unit factor |
| `domain/dxf/parseDxf.ts:246` | `0.001` |  | left: Unit factor |
| `domain/editor/gcodeBlockInterpreter.ts:54` | `1e-12` | `gcodeArcChordMm` | moved |
| `domain/editor/gcodeBlockInterpreter.ts:55` | `Number.EPSILON` | `cadRoundoff(4, …)` | moved |
| `domain/editor/gcodeLineOperations.ts:387` | `1e-6` | `gcodeLineMatchMm` | moved |
| `domain/editor/gcodeParser.ts:19` | `1e-9` | `gcodePositionMm` | moved |
| `domain/editor/gcodeStructure.ts:71` | `1e-9` | `gcodePositionMm` | moved |
| `domain/editor/gcodeStructure.ts:354` | `1e-4` | `gcodeStructureMatchMm` | moved |
| `domain/editor/geometryMeasurement.ts:122` | `1e-9` | `gcodePositionMm` | moved |
| `domain/editor/previewGeometry.ts:376` | `1e-6` |  | left: View: viewport aspect match |
| `domain/editor/previewGeometry.ts:445` | `1e-9` | `gcodePositionMm` | moved |
| `domain/editor/previewGeometry.ts:652` | `1e-9` | `gcodePositionMm` | moved |
| `domain/editor/previewGeometry.ts:652` | `1e-9` | `gcodePositionMm` | moved |
| `domain/path-editor/inspectContourApproach.ts:10` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/path-editor/inspectContourApproach.ts:10` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/path-editor/pathDocumentOperations.ts:974` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/path-editor/pathPointInference.ts:427` | `1e-12` | `zeroLengthMm` | moved |
| `domain/path-editor/pathPointInference.ts:505` | `1e-9` | `pathInsideSlackMm` | moved |
| `domain/path-editor/pathScaling.ts:22` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `domain/path-intel/circularOperation.ts:28` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/path-intel/contours.ts:282` | `0.03` |  | left: Confidence weight, not a tolerance |
| `domain/path-intel/contours.ts:384` | `1e-9` | `camDegenerateAreaMm2` | moved |
| `domain/path-intel/contours.ts:425` | `1e-9` | `camDegenerateAreaMm2` | moved |
| `domain/path-intel/contours.ts:467` | `1e-9` | `camClosingDuplicateMm` | moved |
| `domain/path-intel/endpointClusters.ts:356` | `1e-12` | `camTieMm` | moved |
| `domain/path-intel/intersections.ts:143` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:377` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:503` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:569` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:745` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:1018` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:1087` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:1132` | `Number.EPSILON` | `cadRoundoff(ROUNDING_FACTOR, …)` | moved |
| `domain/path-intel/intersections.ts:1144` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/path-intel/intersections.ts:1149` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/path-intel/planOperations.ts:340` | `1e-9` | `camRankRelative` | moved |
| `domain/path-intel/planOperations.ts:340` | `1e-12` | `camRankAbsoluteMm` | moved |
| `domain/path-intel/planOperations.ts:412` | `1e-9` | `camRankRelative` | moved |
| `domain/path-intel/planOperations.ts:412` | `1e-12` | `camRankAbsoluteMm` | moved |
| `domain/path-intel/sanitizeSegments.ts:176` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/path-intel/sanitizeSegments.ts:205` | `Number.EPSILON` | `cadRoundoff(128, …)` | moved |
| `domain/path-intel/sanitizeSegments.ts:246` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/path-intel/segments.ts:18` | `1e-3` |  | left: Series expansion switch, not a tolerance |
| `domain/path-intel/segments.ts:626` | `Number.EPSILON` | `cadRoundoff(ANGULAR_ULP_FACTOR, …)` | moved |
| `domain/path-intel/types.ts:60` | `0.001` | `camDefaultEndpointMm` | moved |
| `domain/path-intel/types.ts:61` | `1e-5` | `camDefaultCoincidenceMm` | moved |
| `domain/post-processor/controllerProgram.ts:182` | `Number.EPSILON` | `cadOutputFitting (outputRoundingGuardMm)` | moved |
| `domain/post-processor/controllerProgram.ts:183` | `Number.EPSILON` | `cadOutputFitting (outputRoundingGuardMm)` | moved |
| `domain/post-processor/controllerProgram.ts:185` | `Number.EPSILON` | `cadOutputFitting (outputRoundingGuardMm)` | moved |
| `domain/post-processor/controllerProgram.ts:231` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/controllerProgram.ts:255` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/controllerProgram.ts:267` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `domain/post-processor/controllerProgram.ts:282` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/controllerProgram.ts:285` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/controllerProgram.ts:318` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/controllerProgram.ts:329` | `Number.EPSILON` | `outputRoundingGuardMm` | moved |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:75` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:76` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:97` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:97` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:132` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:132` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:191` | `0.001` |  | left: Post conformance fixture input |
| `domain/post-processor/custom-runtime/canonicalPostConformanceFixtures.ts:191` | `0.001` |  | left: Post conformance fixture input |
| `domain/simulation/geometry.ts:80` | `1e-8` | `simulationContactMm` | moved |
| `domain/simulation/geometry.ts:120` | `1e-12` | `simulationDegenerateAreaMm2` | moved |
| `domain/simulation/machine-import/machineCollision.ts:115` | `Number.EPSILON` | `cadRoundoff(1, …)` | moved |
| `domain/simulation/machine-import/triangleIntersection.ts:6` | `1e-7` | `simulationMachineGeometryMm` | moved |
| `domain/simulation/machine-import/triangleIntersection.ts:30` | `Number.EPSILON` | `cadRoundoff(1, …)` | moved |
| `domain/simulation/materialTopology.ts:8` | `1e-8` | `simulationContactMm` | moved |
| `domain/simulation/obstructions.ts:10` | `1e-7` | `simulationObstructionMm` | moved |
| `domain/simulation/releasedPieces.ts:29` | `1e-8` | `simulationContactMm` | moved |
| `domain/simulation/releasedPieces.ts:31` | `1e-12` | `simulationDegenerateAreaMm2` | moved |
| `domain/simulation/releasedPieces.ts:39` | `1e-8` | `simulationContactMm` | moved |
| `domain/simulation/releasedPieces.ts:44` | `1e-8` | `simulationContactMm` | moved |
| `domain/simulation/releasedPieces.ts:129` | `1e-8` | `simulationContactMm` | moved |
| `domain/upid/projectRail.ts:487` | `1e-12` | `camTieMm` | moved |
| `domain/upid/validateUpidDocument.ts:749` | `1e-9` | `upidRecordedValueFloorMm` | moved |
| `domain/upid/validateUpidDocument.ts:749` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/upid/validateUpidDocument.ts:756` | `1e-9` | `upidRecordedValueFloorMm` | moved |
| `domain/upid/validateUpidDocument.ts:2444` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `domain/upid/validateUpidDocument.ts:2651` | `1e-9` | `upidRecordedValueFloorMm` | moved |
| `features/cad/CadFeatureEditor.tsx:391` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/cad/CadGearHelp.tsx:16` | `0.005` |  | left: Message or help text |
| `features/cad/CadGearHelp.tsx:17` | `0.005` |  | left: Message or help text |
| `features/cad/CadGearHelp.tsx:83` | `0.001` |  | left: Message or help text |
| `features/cad/CadParametersPanel.tsx:81` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/cad/CadPluginFields.tsx:99` | `0.005` |  | left: Message or help text |
| `features/cad/CadSectionDialog.tsx:23` | `0.08` |  | left: View or pointer space |
| `features/cad/CadSketchCanvas.tsx:1164` | `0.001` | `pointerMinimumSizeMm` | moved |
| `features/cad/CadSketchCanvas.tsx:1216` | `0.01` |  | left: Message or help text |
| `features/cad/CadSketchPlacementEditor.tsx:32` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/cad/CadSketchRelationsPanel.tsx:250` | `1e-7` | `minimumLengthMm` | moved |
| `features/cad/CadViewport.tsx:151` | `0.01` |  | left: View or pointer space |
| `features/cad/CadViewport.tsx:158` | `0.01` |  | left: View or pointer space |
| `features/cad/CadViewport.tsx:340` | `0.01` |  | left: View or pointer space |
| `features/cad/CadViewport.tsx:605` | `1e-7` |  | left: View or pointer space |
| `features/cad/CadViewport.tsx:861` | `1e-12` |  | left: View or pointer space |
| `features/cad/benchmark/cadBenchmarkCases.ts:23` | `1e-6` |  | left: Benchmark input or acceptance |
| `features/cad/benchmark/cadSolverDragCases.ts:30` | `1e-5` |  | left: Benchmark input or acceptance |
| `features/cad/benchmark/cadSolverDragCases.ts:41` | `2.5e-6` |  | left: Benchmark input or acceptance |
| `features/cad/benchmark/cadSolverWorkloadCases.ts:173` | `0.00001` |  | left: Message or help text |
| `features/cad/cadCurveRendering.ts:27` | `1e-7` |  | left: View or pointer space |
| `features/cad/cadCurveRendering.ts:27` | `4e-7` |  | left: View or pointer space |
| `features/cad/cadExtrudeDepthHandle.ts:23` | `1e-10` |  | left: View or pointer space |
| `features/cad/cadExtrudeDepthInteraction.ts:122` | `1e-3` |  | left: View or pointer space |
| `features/cad/cadExtrudeDepthInteraction.ts:122` | `1e-9` |  | left: View or pointer space |
| `features/cad/cadRegionSelectionOverlay.ts:34` | `1e-8` |  | left: View or pointer space |
| `features/cad/cadSiteTools.ts:139` | `0.0000001` |  | left: Message or help text |
| `features/cad/cadSketchGeometrySnaps.ts:76` | `1e-9` | `snapLineSpanSlack` | moved |
| `features/cad/cadSketchGeometrySnaps.ts:78` | `1e-9` | `snapArcSweepSlackRad` | moved |
| `features/cad/cadSketchGeometrySnaps.ts:108` | `1e-12` | `snapParallelRelative` | moved |
| `features/cad/cadSketchGeometrySnaps.ts:118` | `1e-12` | `snapTangentRelative` | moved |
| `features/cad/cadSketchGeometrySnaps.ts:244` | `Number.EPSILON` |  | left: View or pointer space |
| `features/cad/cadSketchGraphDimensionLayout.ts:74` | `1e-12` | `annotationReadingTie` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:134` | `1e-12` | `annotationParallelRelative` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:134` | `1e-12` | `annotationParallelRelative` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:185` | `1e-12` | `annotationReadingTie` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:185` | `1e-12` | `annotationReadingTie` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:362` | `1e-9` | `annotationFullTurnSlackRad` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:364` | `1e-6` | `annotationMinimumRadiusMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:364` | `1e6` | `modelExtentMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:534` | `1e-12` | `annotationReadingTie` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:534` | `1e-12` | `annotationReadingTie` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:762` | `1e6` | `modelExtentMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:762` | `1e6` | `modelExtentMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:763` | `1e-6` | `annotationMinimumRadiusMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:763` | `1e6` | `modelExtentMm` | moved |
| `features/cad/cadSketchGraphDimensionLayout.ts:764` | `1e6` | `modelExtentMm` | moved |
| `features/cad/cadSketchInteraction.ts:35` | `0.001` | `pointerMinimumSizeMm` | moved |
| `features/cad/cadSketchInteraction.ts:40` | `0.001` | `pointerMinimumSizeMm` | moved |
| `features/cad/cadSketchInteraction.ts:40` | `0.001` | `pointerMinimumSizeMm` | moved |
| `features/cad/cadSketchInteraction.ts:45` | `0.001` | `pointerMinimumSizeMm` | moved |
| `features/cad/cadSketchPicking.ts:53` | `Number.EPSILON` |  | left: View or pointer space |
| `features/cad/cadSketchPicking.ts:53` | `Number.EPSILON` |  | left: View or pointer space |
| `features/cad/cadSketchPicking.ts:102` | `Number.EPSILON` |  | left: View or pointer space |
| `features/cad/cadSketchRelationGlyphLayout.ts:207` | `1e-9` |  | left: View or pointer space |
| `features/cad/cadSketchRelationGlyphLayout.ts:251` | `1e-6` |  | left: View or pointer space |
| `features/cad/cadSketchSvg.ts:11` | `1e-12` |  | left: View or pointer space |
| `features/cad/cadTopologyPicking.ts:88` | `1e-7` |  | left: View or pointer space |
| `features/cad/cadTopologyPicking.ts:88` | `2e-7` |  | left: View or pointer space |
| `features/cad/kernel/cadKernelCutEvidence.ts:54` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelCutEvidence.ts:74` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelImport.ts:69` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelImport.ts:130` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelImport.ts:137` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/cad/kernel/cadKernelLoft.ts:25` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelModel.ts:38` | `0.05` | `tessellationMm` | moved |
| `features/cad/kernel/cadKernelModel.ts:60` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelModel.ts:241` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelModel.ts:245` | `1e-6` | `kernelBoundsSlackMm` | moved |
| `features/cad/kernel/cadKernelModel.ts:245` | `1e-6` | `kernelBoundsSlackMm` | moved |
| `features/cad/kernel/cadKernelOperations.ts:38` | `1e-7` | `minimumLengthMm` | moved |
| `features/cad/kernel/cadKernelOperations.ts:38` | `0.0000001` |  | left: Message or help text |
| `features/cad/kernel/cadKernelOperations.ts:49` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelPocket.ts:60` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelSection.ts:10` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelSection.ts:12` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `features/cad/kernel/cadKernelSectionEndpoints.ts:13` | `Number.EPSILON` | `cadRoundoff(64, …)` | moved |
| `features/cad/kernel/cadKernelStepUnits.ts:4` | `1e9` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:4` | `1e6` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:5` | `1e-1` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:5` | `1e-2` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-3` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-6` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-9` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-12` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-15` |  | left: Unit factor |
| `features/cad/kernel/cadKernelStepUnits.ts:6` | `1e-18` |  | left: Unit factor |
| `features/cad/kernel/cadKernelSweep.ts:16` | `1e-9` | `kernelMinimumVolumeMm3` | moved |
| `features/cad/kernel/cadKernelTopology.ts:21` | `1e-10` | `kernelDirection` | moved |
| `features/cad/kernel/cadKernelTopology.ts:22` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelTopology.ts:22` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `features/cad/kernel/cadKernelTopology.ts:78` | `Number.EPSILON` | `cadRoundoff(1, …)` | moved |
| `features/cad/kernel/cadKernelTopology.ts:99` | `1e-7` | `minimumLengthMm` | moved |
| `features/cad/kernel/cadKernelTopology.ts:117` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelTopology.ts:117` | `1e-7` | `kernelConfusionMm` | moved |
| `features/cad/kernel/cadKernelTopology.ts:118` | `1e-10` | `kernelDirection` | moved |
| `features/cad/kernel/cadKernelTopology.ts:202` | `1e-7` | `minimumLengthMm` | moved |
| `features/cad/kernel/cadKernelTopology.ts:233` | `1e-7` | `minimumLengthMm` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:104` | `1e-12` | `solverCollapsedStartRelative` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:162` | `1e-10` | `solverResidualMm` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:167` | `1e-12` |  | left: Comment |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:169` | `Number.EPSILON` | `cadRoundoff(2, …)` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:227` | `1e-7` |  | left: Comment |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:238` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeAttempt.ts:239` | `Number.EPSILON` | `cadRoundoff(8, …)` | moved |
| `features/cad/sketch-solver/native/cadSketchNativeSolver.ts:15` | `1e-8` |  | left: Comment |
| `features/cad/view/cadSketchCamera.ts:43` | `0.05` |  | left: View or pointer space |
| `features/cad/view/cadSketchCamera.ts:79` | `1e-5` |  | left: View or pointer space |
| `features/editor/EditorEntryExitPanel.tsx:234` | `0.001` |  | left: View or pointer space |
| `features/editor/EditorEntryExitPanel.tsx:300` | `0.001` |  | left: View or pointer space |
| `features/editor/EditorInspectorPanel.tsx:220` | `1e-6` |  | left: View or pointer space |
| `features/editor/EditorPathNavigatorPanel.tsx:2542` | `1e-6` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:314` | `0.08` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:315` | `0.08` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:580` | `1e-6` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:598` | `1e-6` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:1942` | `0.003` |  | left: View or pointer space |
| `features/editor/EditorPreview.tsx:1942` | `0.02` |  | left: View or pointer space |
| `features/editor/editorPreviewEndpoints.ts:63` | `1e-9` |  | left: View or pointer space |
| `features/editor/editorPreviewEndpoints.ts:63` | `1e-9` |  | left: View or pointer space |
| `features/editor/editorPreviewHelpers.ts:20` | `1e-9` |  | left: View or pointer space |
| `features/editor/editorPreviewHelpers.ts:161` | `1e-9` |  | left: View or pointer space |
| `features/editor/editorPreviewHelpers.ts:193` | `1e-9` |  | left: View or pointer space |
| `features/editor/editorPreviewHelpers.ts:205` | `1e-4` |  | left: View or pointer space |
| `features/editor/editorPreviewHelpers.ts:389` | `1e-9` |  | left: View or pointer space |
| `features/simulation/SimulationPanel.tsx:118` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationPanel.tsx:118` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationPanel.tsx:181` | `1e-12` |  | left: View or pointer space |
| `features/simulation/SimulationPanel.tsx:197` | `0.001` |  | left: Message or help text |
| `features/simulation/SimulationPanel.tsx:200` | `0.001` |  | left: Message or help text |
| `features/simulation/SimulationScene.ts:98` | `0.01` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:102` | `0.05` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:115` | `0.01` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:116` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:208` | `0.006` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:223` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:223` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:251` | `0.006` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:288` | `1e-12` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:302` | `0.005` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:309` | `0.001` |  | left: View or pointer space |
| `features/simulation/SimulationScene.ts:309` | `0.05` |  | left: View or pointer space |
| `features/simulation/simulationPathBuffers.ts:62` | `0.02` |  | left: View or pointer space |
| `features/simulation/simulationSurfaceAppearance.ts:9` | `1e-6` |  | left: View or pointer space |
| `features/simulation/simulationSurfaceAppearance.ts:16` | `1e-12` |  | left: View or pointer space |
| `features/simulation/simulationSurfaceAppearance.ts:42` | `0.045` |  | left: View or pointer space |
| `features/simulation/simulationSurfaceAppearance.ts:42` | `0.08` |  | left: View or pointer space |
| `features/webmcp/projectEdits.ts:13` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/projectEdits.ts:13` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/projectEdits.ts:19` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/projectEdits.ts:20` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/projectEdits.ts:29` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/projectEdits.ts:30` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/workbenchSiteTools.ts:37` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/workbenchSiteTools.ts:37` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/workbenchSiteTools.ts:37` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `features/webmcp/workbenchSiteTools.ts:37` | `1e9` |  | left: Coordinate and scalar budget (1e9), a data range separate from the 1e6 model extent |
| `lib/userMessage.ts:12` | `0.0001` |  | left: Display formatting threshold |
| `lib/userMessage.ts:12` | `0.0001` |  | left: Message or help text |
