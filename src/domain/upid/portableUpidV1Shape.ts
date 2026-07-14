import type { PathPlanningDocument } from '@/domain/path-intel/types';

type JsonRecord = Record<string, unknown>;

export function assertPortableUpidV1Shape(document: PathPlanningDocument): void {
  assertKeys(document, [
    'schemaVersion', 'geometryBasis', 'source', 'options', 'segments', 'endpointClusters',
    'chains', 'contours', 'pathElements', 'rootPathElementIds', 'plan', 'diagnostics'
  ], 'document');

  source(document.source, 'document.source');
  options(document.options, 'document.options');
  each(document.segments, segment, 'document.segments');
  each(document.endpointClusters, endpointCluster, 'document.endpointClusters');
  each(document.chains, chain, 'document.chains');
  each(document.contours, contour, 'document.contours');
  each(document.pathElements, pathElement, 'document.pathElements');
  plan(document.plan, 'document.plan');
  each(document.diagnostics, diagnostic, 'document.diagnostics');
}

function source(value: unknown, path: string) {
  assertKeys(value, [
    'kind', 'entityCount', 'appliedUnits', 'coordinateScaleToMillimeters', 'drawing', 'fileName',
    'importedAt', 'importWarnings', 'projectId', 'unitDeclaration', 'units'
  ], path);
  const object = record(value);
  if (!object) return;
  appliedUnits(object.appliedUnits, `${path}.appliedUnits`);
  drawing(object.drawing, `${path}.drawing`);
  unitDeclaration(object.unitDeclaration, `${path}.unitDeclaration`);
  drawingUnits(object.units, `${path}.units`);
}

function appliedUnits(value: unknown, path: string) {
  assertKeys(value, [
    'label', 'scaleToMillimeters', 'basis', 'confirmed', 'confirmedAt', 'suggestion'
  ], path);
  const object = record(value);
  assertKeys(object?.suggestion, ['kind', 'profileId'], `${path}.suggestion`);
}

function drawing(value: unknown, path: string) {
  assertKeys(value, ['basePoint', 'extents'], path);
  const object = record(value);
  point(object?.basePoint, `${path}.basePoint`);
  assertKeys(object?.extents, ['min', 'max'], `${path}.extents`);
  const extents = record(object?.extents);
  point(extents?.min, `${path}.extents.min`);
  point(extents?.max, `${path}.extents.max`);
}

function unitDeclaration(value: unknown, path: string) {
  assertKeys(value, ['status', 'rawValue', 'units'], path);
  drawingUnits(record(value)?.units, `${path}.units`);
}

function drawingUnits(value: unknown, path: string) {
  assertKeys(value, ['source', 'code', 'label', 'scaleToMillimeters'], path);
}

function options(value: unknown, path: string) {
  assertKeys(value, [
    'endpointTolerance', 'coincidenceEpsilon', 'startPoint', 'allowReverseOpenChains',
    'allowReverseClosedContours', 'approximationMaxAngleRadians', 'operationOrderStrategy',
    'includeLayers', 'excludeLayers'
  ], path);
  point(record(value)?.startPoint, `${path}.startPoint`);
}

function segment(value: unknown, path: string) {
  const object = record(value);
  const curveKeys = object?.kind === 'arc'
    ? ['center', 'radius', 'startAngleRadians', 'endAngleRadians', 'sweepRadians', 'clockwise']
    : object?.kind === 'circle'
      ? ['center', 'radius', 'preferredStart']
      : [];
  assertKeys(value, [
    'id', 'kind', 'source', 'layer', 'start', 'end', 'length', 'bounds', ...curveKeys
  ], path);
  segmentSource(object?.source, `${path}.source`);
  point(object?.start, `${path}.start`);
  point(object?.end, `${path}.end`);
  point(object?.center, `${path}.center`);
  point(object?.preferredStart, `${path}.preferredStart`);
  bounds(object?.bounds, `${path}.bounds`);
}

function segmentSource(value: unknown, path: string) {
  assertKeys(value, [
    'sourceEntityIndex', 'sourceEntityHandle', 'sourceEntityType', 'sourceSubIndex', 'layer',
    'exact', 'approximation', 'dxf', 'edit', 'note'
  ], path);
  const object = record(value);
  assertKeys(object?.approximation, ['sourceEntityType', 'maxChordError'], `${path}.approximation`);
  dxfSource(object?.dxf, `${path}.dxf`);
  segmentEdit(object?.edit, `${path}.edit`);
}

function dxfSource(value: unknown, path: string) {
  assertKeys(value, ['blockName', 'insertChain'], path);
  each(record(value)?.insertChain, insertSource, `${path}.insertChain`);
}

function insertSource(value: unknown, path: string) {
  assertKeys(value, ['blockName', 'column', 'row', 'layer', 'transform'], path);
  const transformValue = record(value)?.transform;
  assertKeys(transformValue, [
    'insertion', 'localOffset', 'blockBasePoint', 'rotationDegrees', 'scaleX', 'scaleY'
  ], `${path}.transform`);
  const transform = record(transformValue);
  point(transform?.insertion, `${path}.transform.insertion`);
  point(transform?.localOffset, `${path}.transform.localOffset`);
  point(transform?.blockBasePoint, `${path}.transform.blockBasePoint`);
}

function segmentEdit(value: unknown, path: string) {
  assertKeys(value, ['kind', 'operationId', 'parentSegmentId', 'point'], path);
  point(record(value)?.point, `${path}.point`);
}

function endpointCluster(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'point', 'members', 'method', 'toleranceUsed', 'radius', 'maxPairDistance'
  ], path);
  const object = record(value);
  point(object?.point, `${path}.point`);
  each(object?.members, endpointMember, `${path}.members`);
}

function endpointMember(value: unknown, path: string) {
  assertKeys(value, ['segmentId', 'side', 'point'], path);
  point(record(value)?.point, `${path}.point`);
}

function chain(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'kind', 'segmentRefs', 'closed', 'startClusterId', 'endClusterId', 'metrics',
    'diagnosticIds'
  ], path);
  const object = record(value);
  each(object?.segmentRefs, segmentRef, `${path}.segmentRefs`);
  assertKeys(object?.metrics, ['segmentCount', 'cutLength', 'gapLength'], `${path}.metrics`);
}

function contour(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'label', 'provenance', 'chainId', 'closed', 'classification', 'signedArea', 'area',
    'orientation', 'bounds', 'containmentDepth', 'parentId', 'childIds', 'representativePoint',
    'approximatePolygon', 'confidence', 'diagnosticIds'
  ], path);
  const object = record(value);
  provenance(object?.provenance, `${path}.provenance`);
  bounds(object?.bounds, `${path}.bounds`);
  point(object?.representativePoint, `${path}.representativePoint`);
  each(object?.approximatePolygon, point, `${path}.approximatePolygon`);
}

function provenance(value: unknown, path: string) {
  assertKeys(value, [
    'sourceEntityIndices', 'sourceEntityHandles', 'sourceEntityTypes', 'layers', 'exact', 'dxf', 'edit'
  ], path);
  const object = record(value);
  assertKeys(object?.dxf, ['blockNames', 'insertBlockNames', 'insertedSegmentCount'], `${path}.dxf`);
  editProvenance(object?.edit, `${path}.edit`);
}

function editProvenance(value: unknown, path: string) {
  assertKeys(value, ['derivedSegmentIds', 'events', 'parentSegmentIds'], path);
  each(record(value)?.events, editEvent, `${path}.events`);
}

function editEvent(value: unknown, path: string) {
  assertKeys(value, [
    'derivedSegmentIds', 'kind', 'operationId', 'parentSegmentId', 'point'
  ], path);
  point(record(value)?.point, `${path}.point`);
}

function pathElement(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'kind', 'contourId', 'chainId', 'operationId', 'label', 'displayName',
    'classification', 'closed', 'parentId', 'childIds', 'containmentDepth', 'segmentRefs',
    'points', 'provenance', 'diagnosticIds', 'orderIndex', 'direction', 'metrics',
    'compensationIntent', 'overrides', 'bounds', 'confidence'
  ], path);
  const object = record(value);
  each(object?.segmentRefs, segmentRef, `${path}.segmentRefs`);
  each(object?.points, elementPoint, `${path}.points`);
  provenance(object?.provenance, `${path}.provenance`);
  operationMetrics(object?.metrics, `${path}.metrics`);
  compensation(object?.compensationIntent, `${path}.compensationIntent`);
  overrides(object?.overrides, `${path}.overrides`);
  bounds(object?.bounds, `${path}.bounds`);
}

function elementPoint(value: unknown, path: string) {
  assertKeys(value, ['role', 'point', 'source'], path);
  point(record(value)?.point, `${path}.point`);
}

function plan(value: unknown, path: string) {
  assertKeys(value, ['operations', 'metrics', 'diagnostics'], path);
  const object = record(value);
  each(object?.operations, operation, `${path}.operations`);
  assertKeys(object?.metrics, [
    'operationCount', 'totalCutLength', 'totalRapidLength'
  ], `${path}.metrics`);
  each(object?.diagnostics, diagnostic, `${path}.diagnostics`);
}

function operation(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'label', 'displayName', 'provenance', 'orderIndex', 'contourId', 'chainId',
    'classification', 'closed', 'segmentRefs', 'startPoint', 'endPoint', 'direction', 'metrics',
    'compensationIntent', 'overrides'
  ], path);
  const object = record(value);
  provenance(object?.provenance, `${path}.provenance`);
  each(object?.segmentRefs, segmentRef, `${path}.segmentRefs`);
  point(object?.startPoint, `${path}.startPoint`);
  point(object?.endPoint, `${path}.endPoint`);
  operationMetrics(object?.metrics, `${path}.metrics`);
  compensation(object?.compensationIntent, `${path}.compensationIntent`);
  overrides(object?.overrides, `${path}.overrides`);
}

function operationMetrics(value: unknown, path: string) {
  assertKeys(value, ['cutLength', 'rapidInLength', 'segmentCount'], path);
}

function compensation(value: unknown, path: string) {
  assertKeys(value, ['mode', 'keptMaterial', 'source'], path);
}

function overrides(value: unknown, path: string) {
  assertKeys(value, ['classification', 'order', 'direction', 'start', 'leadIn'], path);
  const object = record(value);
  assertKeys(object?.classification, ['kind', 'classification'], `${path}.classification`);
  assertKeys(object?.order, ['kind', 'orderIndex'], `${path}.order`);
  assertKeys(object?.direction, ['kind', 'direction'], `${path}.direction`);
  assertKeys(object?.start, [
    'kind', 'point', 'relation', 'sourceSegmentId', 'sourceSegmentIndex', 'pointRole',
    'createdSegmentIds'
  ], `${path}.start`);
  point(record(object?.start)?.point, `${path}.start.point`);
  assertKeys(object?.leadIn, [
    'kind', 'move', 'from', 'to', 'source', 'sourceSegmentId', 'sourceSegmentIndex'
  ], `${path}.leadIn`);
  const leadIn = record(object?.leadIn);
  point(leadIn?.from, `${path}.leadIn.from`);
  point(leadIn?.to, `${path}.leadIn.to`);
}

function diagnostic(value: unknown, path: string) {
  assertKeys(value, [
    'id', 'severity', 'code', 'message', 'relatedSegmentIds', 'relatedClusterIds',
    'relatedChainIds', 'relatedContourIds', 'details'
  ], path);
  diagnosticDetails(record(value)?.details, `${path}.details`);
}

function diagnosticDetails(value: unknown, path: string) {
  if (value === undefined) return;
  const object = requireRecord(value, path);
  assertKeys(value, [
    'bulge', 'candidateDistances', 'chosenSegmentId', 'coordinateScaleToMillimeters',
    'coordinateUnits', 'degree', 'endpointTolerance', 'excludeLayers', 'gap', 'gapLength',
    'includeLayers', 'layer', 'maxPairDistance', 'metric', 'point', 'points', 'radius',
    'reason', 'requestedUnits', 'result', 'retainedSegmentId', 'signedArea', 'sourceEntityHandle',
    'sourceEntityIndex', 'sourceEntityType', 'sourceSubIndex', 'sourceUnitsCode',
    'sourceUnitsLabel', 'sourceWarningIndex', 'sources', 'tolerance', 'vertexCount'
  ], path);
  if (object.point !== undefined) requirePoint(object.point, `${path}.point`);
  if (object.points !== undefined) {
    requireArray(object.points, `${path}.points`).forEach((item, index) =>
      requirePoint(item, `${path}.points[${index}]`)
    );
  }
  for (const [key, item] of Object.entries(object)) {
    if (key === 'point' || key === 'points' || key === 'sources') continue;
    if (key === 'candidateDistances') {
      requireArray(item, `${path}.${key}`).forEach((entry, index) =>
        requirePrimitive(entry, 'number', `${path}.${key}[${index}]`)
      );
    } else if (key === 'includeLayers' || key === 'excludeLayers') {
      requireArray(item, `${path}.${key}`).forEach((entry, index) =>
        requirePrimitive(entry, 'string', `${path}.${key}[${index}]`)
      );
    } else {
      requireScalar(item, `${path}.${key}`);
    }
  }
  if (object.sources !== undefined) {
    requireArray(object.sources, `${path}.sources`).forEach((item, index) => {
      if (typeof item === 'string') return;
      diagnosticSource(item, `${path}.sources[${index}]`);
    });
  }
}

function diagnosticSource(value: unknown, path: string) {
  const object = requireRecord(value, path);
  assertKeys(value, [
    'segmentId', 'layer', 'source', 'sourceEntityIndex', 'sourceEntityHandle',
    'sourceEntityType', 'sourceSubIndex'
  ], path);
  for (const [key, item] of Object.entries(object)) {
    if (key === 'source') continue;
    requireScalar(item, `${path}.${key}`);
  }
  if (object.source !== undefined) diagnosticSegmentSource(object.source, `${path}.source`);
}

function diagnosticSegmentSource(value: unknown, path: string) {
  const object = requireRecord(value, path);
  assertKeys(value, [
    'sourceEntityIndex', 'sourceEntityHandle', 'sourceEntityType', 'sourceSubIndex', 'layer',
    'exact', 'approximation', 'dxf', 'edit', 'note'
  ], path);
  for (const [key, item] of Object.entries(object)) {
    if (key === 'approximation' || key === 'dxf' || key === 'edit') continue;
    requireScalar(item, `${path}.${key}`);
  }
  if (object.approximation !== undefined) {
    const approximation = requireRecord(object.approximation, `${path}.approximation`);
    assertKeys(approximation, ['sourceEntityType', 'maxChordError'], `${path}.approximation`);
    Object.entries(approximation).forEach(([key, item]) => requireScalar(item, `${path}.approximation.${key}`));
  }
  if (object.edit !== undefined) {
    const edit = requireRecord(object.edit, `${path}.edit`);
    assertKeys(edit, ['kind', 'operationId', 'parentSegmentId', 'point'], `${path}.edit`);
    Object.entries(edit).forEach(([key, item]) => {
      if (key === 'point') requirePoint(item, `${path}.edit.point`);
      else requireScalar(item, `${path}.edit.${key}`);
    });
  }
  if (object.dxf !== undefined) diagnosticDxfSource(object.dxf, `${path}.dxf`);
}

function diagnosticDxfSource(value: unknown, path: string) {
  const object = requireRecord(value, path);
  assertKeys(object, ['blockName', 'insertChain'], path);
  requireScalar(object.blockName, `${path}.blockName`);
  requireArray(object.insertChain, `${path}.insertChain`).forEach((item, index) => {
    const insertPath = `${path}.insertChain[${index}]`;
    const insert = requireRecord(item, insertPath);
    assertKeys(insert, ['blockName', 'column', 'row', 'layer', 'transform'], insertPath);
    for (const [key, nested] of Object.entries(insert)) {
      if (key === 'transform') continue;
      requireScalar(nested, `${insertPath}.${key}`);
    }
    const transform = requireRecord(insert.transform, `${insertPath}.transform`);
    assertKeys(transform, [
      'insertion', 'localOffset', 'blockBasePoint', 'rotationDegrees', 'scaleX', 'scaleY'
    ], `${insertPath}.transform`);
    for (const [key, nested] of Object.entries(transform)) {
      if (key === 'insertion' || key === 'localOffset' || key === 'blockBasePoint') {
        requirePoint(nested, `${insertPath}.transform.${key}`);
      } else {
        requireScalar(nested, `${insertPath}.transform.${key}`);
      }
    }
  });
}

function segmentRef(value: unknown, path: string) {
  assertKeys(value, ['segmentId', 'reversed'], path);
}

function point(value: unknown, path: string) {
  assertKeys(value, ['x', 'y'], path);
}

function bounds(value: unknown, path: string) {
  assertKeys(value, ['minX', 'minY', 'maxX', 'maxY'], path);
}

function each(
  value: unknown,
  visit: (item: unknown, path: string) => void,
  path: string
) {
  if (!Array.isArray(value)) return;
  value.forEach((item, index) => visit(item, `${path}[${index}]`));
}

function assertKeys(value: unknown, allowed: readonly string[], path: string) {
  const object = record(value);
  if (!object) return;
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unsupported UPID property: ${path}.${key}`);
    }
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function requireRecord(value: unknown, path: string): JsonRecord {
  const object = record(value);
  if (!object) throw new Error(`Unsupported UPID value: ${path} must be an object.`);
  return object;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Unsupported UPID value: ${path} must be an array.`);
  return value;
}

function requirePoint(value: unknown, path: string) {
  const object = requireRecord(value, path);
  assertKeys(object, ['x', 'y'], path);
  requirePrimitive(object.x, 'number', `${path}.x`);
  requirePrimitive(object.y, 'number', `${path}.y`);
}

function requireScalar(value: unknown, path: string) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  throw new Error(`Unsupported UPID value: ${path} must be scalar metadata.`);
}

function requirePrimitive(value: unknown, expected: 'number' | 'string', path: string) {
  if (typeof value !== expected) {
    throw new Error(`Unsupported UPID value: ${path} must be a ${expected}.`);
  }
}
