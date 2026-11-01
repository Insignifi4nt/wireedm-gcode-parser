import { Value } from '@sinclair/typebox/value';
import type { CadFeature, CadPocketFeature, CadPlane, CadSketchFeature } from './cadDocument';
export type { CadPocketFeature } from './cadDocument';
import { CadError } from './cadError';
import { isCadImportData } from './cadImportData';
import type { CadPocketDirection } from './cadPocketExtent';
import { evaluateCadScalar } from './cadExpression';
import { resolveCadSketchRegions, cadProfileToEntities, type CadSketchMaterialRegion } from './cadSketchGeometry';
import { cadFeatureProducesBody, cadVisibleBodyIds } from './cadFeatureInputs';
import { cadPocketSectionScale } from './cadPocketSectionScale';
import { requireCadPrincipalPlane } from './cadDatumPlanes';
import { cadFeatureActive } from './features/cadFeatureActivity';
import { CadPocketFeatureSchema } from './features/kinds/solids';
export {
  resolveCadPocketExtent,
  CAD_POCKET_NATIVE_PRECISION,
  CAD_POCKET_CAP_MARGIN_FLOOR_MM,
  MAX_CAD_POCKET_REQUIRED_SPAN_MM,
  CAD_POCKET_CAP_RESERVE_FRACTION,
  type CadPocketExtent,
  type CadPocketExtentInput,
  type CadPocketDirection,
} from './cadPocketExtent';
export { CadPocketFeatureSchema };
export interface CadResolvedPocketInputs {
  readonly sketch: CadSketchFeature;
  readonly plane: CadPlane;
  readonly offset: number;
  readonly regions: readonly CadSketchMaterialRegion[];
  readonly direction: CadPocketDirection;
  readonly targetId: string;
  readonly sectionEdgeCount: number;
  readonly regionCount: number;
  /** Precision-support heuristic; native material evidence remains mandatory. */
  readonly sectionScaleMm: number;
}

/** Resolve every material region; native prefix bounds determine extent later. */
export function resolveCadPocketInputs(
  feature: CadPocketFeature,
  precedingFeatures: ReadonlyMap<string, CadFeature>,
  parameters: Readonly<Record<string, number>>,
): CadResolvedPocketInputs {
  if (!isCadImportData(feature) || !Value.Check(CadPocketFeatureSchema, feature) || !isCadImportData(parameters))
    throw new CadError('invalid-feature', 'Malformed declarative through-all Pocket feature.');
  const sketch = precedingFeatures.get(feature.sketchId);
  const target = precedingFeatures.get(feature.targetId);
  if (
    !sketch ||
    !target ||
    !isCadImportData(sketch) ||
    !isCadImportData(target) ||
    sketch.kind !== 'sketch' ||
    !cadFeatureProducesBody(target)
  ) {
    throw new CadError('invalid-reference', 'Pocket requires a preceding sketch and a preceding solid target.');
  }
  if (!cadFeatureActive(sketch, { parameters })) throw new CadError('suppressed-sketch', `Pocket sketch "${sketch.name}" is suppressed.`);
  const plane = requireCadPrincipalPlane(sketch.plane, 'Through-all Pocket');
  if (!cadVisibleBodyIds([...precedingFeatures.values()], { parameters }).includes(feature.targetId))
    throw new CadError('unavailable-body', 'Pocket target is suppressed or consumed. Choose its current successor.');
  const offset = evaluateCadScalar(sketch.offset, parameters);
  const regions = resolveCadSketchRegions(sketch, parameters, feature.regionSelection);
  if (!regions.length)
    throw new CadError('empty-sketch', 'Pocket requires active closed material contours; construction references do not remove material.');
  let sectionEdgeCount = 0;
  let sectionScaleMm = Infinity;
  for (const region of regions)
    for (const boundary of [region.boundary, ...region.voids]) {
      sectionEdgeCount += cadProfileToEntities(boundary.geometry).length;
      sectionScaleMm = Math.min(sectionScaleMm, cadPocketSectionScale(boundary.geometry));
    }
  return Object.freeze({
    sketch,
    plane,
    offset,
    regions: Object.freeze(regions),
    direction: feature.extent.direction,
    targetId: feature.targetId,
    sectionEdgeCount,
    sectionScaleMm,
    regionCount: regions.length,
  });
}
