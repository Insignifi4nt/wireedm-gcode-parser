import {
  distance,
  orientedSegmentEnd,
  orientedSegmentStart
} from '@/domain/path-intel/segments';
import type {
  Bounds2,
  EndpointCluster,
  OrientedSegmentRef,
  PathChain,
  PathContour,
  PathDiagnostic,
  PathElement,
  PathElementProvenance,
  PathOperation,
  PathOperationOverrides,
  PathPlanningDocument,
  PathSegment,
  Point2
} from '@/domain/path-intel/types';
import {
  pathSegmentHasConsistentArcAngularGeometry,
  pathSegmentHasExecutableCircularGeometry
} from '@/domain/path-intel/sanitizeSegments';

export interface UpidValidationReport {
  valid: boolean;
  structurallyValid: boolean;
  diagnostics: PathDiagnostic[];
  blockingDiagnostics: PathDiagnostic[];
  structuralDiagnostics: PathDiagnostic[];
}

interface ValidationContext {
  add: (
    code: Extract<
      PathDiagnostic['code'],
      | 'upid-duplicate-id'
      | 'upid-invalid-value'
      | 'upid-missing-reference'
      | 'upid-identity-mismatch'
      | 'upid-discontinuity'
      | 'upid-broken-closure'
    >,
    message: string,
    refs?: Pick<
      PathDiagnostic,
      'relatedSegmentIds' | 'relatedClusterIds' | 'relatedChainIds' | 'relatedContourIds'
    >
  ) => void;
  structuralDiagnostics: PathDiagnostic[];
}

const OPERATION_ORDER_STRATEGIES = new Set([
  'inside-out-nearest',
  'nearest',
  'source-order'
]);
const CONTOUR_CLASSIFICATIONS = new Set([
  'exterior',
  'hole',
  'island',
  'ambiguous',
  'open-chain'
]);
const CONTOUR_ORIENTATIONS = new Set(['ccw', 'cw', 'degenerate']);

export function validateUpidDocument(document: unknown): UpidValidationReport {
  const root = record(document);
  const rawDiagnostics = root ? array(root.diagnostics) : [];
  const reservedDiagnosticIds = new Set(
    rawDiagnostics
      .map((diagnostic) => record(diagnostic)?.id)
      .filter((id): id is string => typeof id === 'string')
  );
  const structuralDiagnostics: PathDiagnostic[] = [];
  let nextDiagnosticNumber = 1;
  const context: ValidationContext = {
    structuralDiagnostics,
    add(code, message, refs = {}) {
      let id = `diag_upid_validation_${String(nextDiagnosticNumber++).padStart(4, '0')}`;
      while (reservedDiagnosticIds.has(id)) {
        id = `diag_upid_validation_${String(nextDiagnosticNumber++).padStart(4, '0')}`;
      }
      reservedDiagnosticIds.add(id);
      structuralDiagnostics.push({
        id,
        severity: 'error',
        code,
        message,
        ...refs
      });
    }
  };

  if (!root) {
    context.add('upid-invalid-value', 'UPID document must be an object.');
    return report([], structuralDiagnostics);
  }

  if (!Array.isArray(root.diagnostics)) {
    context.add('upid-invalid-value', 'UPID diagnostics must be an array.');
  }

  if (root.schemaVersion !== 1) {
    context.add(
      'upid-invalid-value',
      `UPID schema version ${String(root.schemaVersion)} is unsupported.`
    );
  }
  validateSource(root.source, context);
  validateOptions(root.options, context);

  const segments = collection<PathSegment>(root, 'segments', context);
  const endpointClusters = collection<EndpointCluster>(root, 'endpointClusters', context);
  const chains = collection<PathChain>(root, 'chains', context);
  const contours = collection<PathContour>(root, 'contours', context);
  const pathElements = collection<PathElement>(root, 'pathElements', context);
  const rootPathElementIds = stringArray(root.rootPathElementIds, 'rootPathElementIds', context);
  const planRecord = record(root.plan);
  if (!planRecord) context.add('upid-invalid-value', 'UPID plan must be an object.');
  const operations = planRecord
    ? collection<PathOperation>(planRecord, 'operations', context, 'plan.operations')
    : [];

  const segmentMap = idMap(segments, 'segments', context);
  const clusterMap = idMap(endpointClusters, 'endpoint clusters', context);
  const chainMap = idMap(chains, 'chains', context);
  const contourMap = idMap(contours, 'contours', context);
  const pathElementMap = idMap(pathElements, 'path elements', context);
  const operationMap = idMap(operations, 'operations', context);
  const acceptedDiagnostics = validateDiagnostics(rawDiagnostics, context);
  const diagnosticMap = idMap(acceptedDiagnostics, 'diagnostics', context);

  const effectiveTolerance = validationTolerance(root.options, endpointClusters);
  const coincidenceEpsilon = finiteNonNegative(record(root.options)?.coincidenceEpsilon) ?? 0;
  const maximumRecordedTolerance = maximumLegitimateRecordedTolerance(root.options);
  const validSegmentIds = new Set<string>();
  for (const segment of segments) {
    if (validateSegment(segment, operationMap, coincidenceEpsilon, context)) {
      validSegmentIds.add(segment.id);
    }
  }

  validateEndpointClusters(
    endpointClusters,
    segmentMap,
    validSegmentIds,
    effectiveTolerance,
    maximumRecordedTolerance,
    context
  );
  validateChains(
    chains,
    segmentMap,
    validSegmentIds,
    clusterMap,
    diagnosticMap,
    effectiveTolerance,
    context
  );
  validateContours(contours, chainMap, contourMap, diagnosticMap, context);
  validateOperations(
    operations,
    segmentMap,
    validSegmentIds,
    chainMap,
    contourMap,
    effectiveTolerance,
    context
  );
  validatePathElements(
    pathElements,
    pathElementMap,
    rootPathElementIds,
    segmentMap,
    chainMap,
    contourMap,
    operationMap,
    diagnosticMap,
    effectiveTolerance,
    context
  );
  validateContourTree(contours, contourMap, context);
  validatePathElementTree(pathElements, pathElementMap, rootPathElementIds, context);
  validateIdentityAgreement(
    chains,
    contours,
    pathElements,
    operations,
    chainMap,
    contourMap,
    operationMap,
    context
  );
  validatePlan(planRecord, operations, acceptedDiagnostics, context);

  return report(acceptedDiagnostics, structuralDiagnostics);
}

function report(
  documentDiagnostics: PathDiagnostic[],
  structuralDiagnostics: PathDiagnostic[]
): UpidValidationReport {
  const diagnostics = uniqueDiagnostics([...documentDiagnostics, ...structuralDiagnostics]);
  const blockingDiagnostics = uniqueDiagnostics([
    ...structuralDiagnostics,
    ...documentDiagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  ]);
  return {
    valid: blockingDiagnostics.length === 0,
    structurallyValid: structuralDiagnostics.length === 0,
    diagnostics,
    blockingDiagnostics,
    structuralDiagnostics: [...structuralDiagnostics]
  };
}

function validateSource(value: unknown, context: ValidationContext) {
  const source = record(value);
  if (!source) {
    context.add('upid-invalid-value', 'UPID source must be an object.');
    return;
  }
  if (source.kind !== 'dxf-entities') {
    context.add('upid-invalid-value', `UPID source kind ${String(source.kind)} is unsupported.`);
  }
  finiteInteger(source.entityCount, 'source.entityCount', context, 0);
  optionalString(source.fileName, 'source.fileName', context);
  optionalString(source.projectId, 'source.projectId', context, true);
  if (source.importedAt != null) {
    if (typeof source.importedAt !== 'string' || Number.isNaN(Date.parse(source.importedAt))) {
      context.add('upid-invalid-value', 'source.importedAt must be a valid date string.');
    }
  }
  if (source.coordinateScaleToMillimeters != null) {
    finiteNumber(source.coordinateScaleToMillimeters, 'source.coordinateScaleToMillimeters', context, {
      positive: true
    });
  }
  const drawing = source.drawing == null ? null : record(source.drawing);
  if (source.drawing != null && !drawing) {
    context.add('upid-invalid-value', 'source.drawing must be an object when present.');
  }
  if (drawing) {
    if (drawing.basePoint != null) finitePoint(drawing.basePoint, 'source.drawing.basePoint', context);
    const extents = drawing.extents == null ? null : record(drawing.extents);
    if (drawing.extents != null && !extents) {
      context.add('upid-invalid-value', 'source.drawing.extents must be an object when present.');
    }
    if (extents) {
      finitePoint(extents.min, 'source.drawing.extents.min', context);
      finitePoint(extents.max, 'source.drawing.extents.max', context);
    }
  }
  const units = source.units == null ? null : record(source.units);
  if (source.units != null && !units) {
    context.add('upid-invalid-value', 'source.units must be an object when present.');
  }
  if (units) {
    if (units.source !== 'dxf-insunits') {
      context.add('upid-invalid-value', 'source.units.source is unsupported.');
    }
    finiteInteger(units.code, 'source.units.code', context, 0);
    if (typeof units.label !== 'string') {
      context.add('upid-invalid-value', 'source.units.label must be a string.');
    }
    if (units.scaleToMillimeters != null) {
      finiteNumber(units.scaleToMillimeters, 'source.units.scaleToMillimeters', context, {
        positive: true
      });
    }
  }
}

function validateOptions(value: unknown, context: ValidationContext) {
  const options = record(value);
  if (!options) {
    context.add('upid-invalid-value', 'UPID options must be an object.');
    return;
  }
  finiteNumber(options.endpointTolerance, 'options.endpointTolerance', context, {
    nonNegative: true
  });
  finiteNumber(options.coincidenceEpsilon, 'options.coincidenceEpsilon', context, {
    nonNegative: true
  });
  finitePoint(options.startPoint, 'options.startPoint', context);
  finiteNumber(options.approximationMaxAngleRadians, 'options.approximationMaxAngleRadians', context, {
    positive: true
  });
  for (const key of ['allowReverseOpenChains', 'allowReverseClosedContours'] as const) {
    if (typeof options[key] !== 'boolean') {
      context.add('upid-invalid-value', `options.${key} must be boolean.`);
    }
  }
  if (!OPERATION_ORDER_STRATEGIES.has(String(options.operationOrderStrategy))) {
    context.add('upid-invalid-value', 'options.operationOrderStrategy is unsupported.');
  }
  for (const key of ['includeLayers', 'excludeLayers'] as const) {
    const values = array(options[key]);
    if (!Array.isArray(options[key]) || values.some((item) => typeof item !== 'string')) {
      context.add('upid-invalid-value', `options.${key} must be an array of strings.`);
    }
  }
}

function validateSegment(
  segment: PathSegment,
  operationMap: Map<string, PathOperation>,
  coincidenceEpsilon: number,
  context: ValidationContext
) {
  const value = record(segment);
  if (!value) {
    context.add('upid-invalid-value', 'Every UPID segment must be an object.');
    return false;
  }
  let valid = true;
  const invalidate = (message: string) => {
    valid = false;
    context.add('upid-invalid-value', message, relatedSegment(segment));
  };
  if (!['line', 'arc', 'circle'].includes(String(value.kind))) {
    invalidate(`Segment ${segment.id} has unsupported kind ${String(value.kind)}.`);
  }
  if (!finitePoint(value.start, `segment ${segment.id}.start`, context, relatedSegment(segment))) valid = false;
  if (!finitePoint(value.end, `segment ${segment.id}.end`, context, relatedSegment(segment))) valid = false;
  if (!finiteNumber(value.length, `segment ${segment.id}.length`, context, { nonNegative: true }, relatedSegment(segment))) valid = false;
  if (!finiteBounds(value.bounds, `segment ${segment.id}.bounds`, context, relatedSegment(segment))) valid = false;

  if (segment.kind === 'arc' || segment.kind === 'circle') {
    const centerValid = finitePoint(
      segment.center,
      `segment ${segment.id}.center`,
      context,
      relatedSegment(segment)
    );
    const radiusValid = finiteNumber(
      segment.radius,
      `segment ${segment.id}.radius`,
      context,
      { positive: true },
      relatedSegment(segment)
    );
    if (!centerValid || !radiusValid) valid = false;
    const circularPointsValid =
      finitePointOnly(segment.start) &&
      finitePointOnly(segment.end) &&
      (segment.kind === 'arc' || finitePointOnly(segment.preferredStart));
    if (
      centerValid &&
      radiusValid &&
      circularPointsValid &&
      !pathSegmentHasExecutableCircularGeometry(segment, coincidenceEpsilon)
    ) {
      invalidate(`Segment ${segment.id} circular geometry is not executable.`);
    }
  }
  if (segment.kind === 'arc') {
    for (const key of ['startAngleRadians', 'endAngleRadians', 'sweepRadians'] as const) {
      if (!finiteNumber(segment[key], `segment ${segment.id}.${key}`, context, {}, relatedSegment(segment))) valid = false;
    }
    if (Number.isFinite(segment.sweepRadians)) {
      if (
        segment.sweepRadians === 0 ||
        Math.abs(segment.sweepRadians) > Math.PI * 2 ||
        (segment.clockwise ? segment.sweepRadians > 0 : segment.sweepRadians < 0)
      ) {
        invalidate(`Segment ${segment.id}.sweepRadians is inconsistent with its arc direction.`);
      }
    }
    if (typeof segment.clockwise !== 'boolean') invalidate(`Segment ${segment.id}.clockwise must be boolean.`);
    if (
      finitePointOnly(segment.center) &&
      finitePointOnly(segment.start) &&
      finitePointOnly(segment.end) &&
      Number.isFinite(segment.radius) &&
      segment.radius > 0 &&
      !pathSegmentHasConsistentArcAngularGeometry(segment, coincidenceEpsilon)
    ) {
      valid = false;
      context.add(
        'upid-identity-mismatch',
        `Segment ${segment.id} stored arc angles or sweep disagree with its endpoints.`,
        relatedSegment(segment)
      );
    }
  }
  if (segment.kind === 'circle') {
    if (!finitePoint(segment.preferredStart, `segment ${segment.id}.preferredStart`, context, relatedSegment(segment))) valid = false;
  }
  validateSegmentSource(value.source, segment.id, operationMap, context);
  if (value.layer !== record(value.source)?.layer) {
    context.add(
      'upid-identity-mismatch',
      `Segment ${segment.id} layer disagrees with its source layer.`,
      relatedSegment(segment)
    );
    valid = false;
  }
  return valid;
}

function validateSegmentSource(
  value: unknown,
  segmentId: string,
  operationMap: Map<string, PathOperation>,
  context: ValidationContext
) {
  const source = record(value);
  if (!source) {
    context.add('upid-invalid-value', `Segment ${segmentId} source must be an object.`, {
      relatedSegmentIds: [segmentId]
    });
    return;
  }
  finiteInteger(source.sourceEntityIndex, `segment ${segmentId}.source.sourceEntityIndex`, context, 0);
  if (source.sourceSubIndex != null) {
    finiteInteger(source.sourceSubIndex, `segment ${segmentId}.source.sourceSubIndex`, context, 0);
  }
  if (typeof source.sourceEntityType !== 'string' || source.sourceEntityType.length === 0) {
    context.add('upid-invalid-value', `Segment ${segmentId} sourceEntityType must be a string.`);
  }
  if (source.layer !== null && typeof source.layer !== 'string') {
    context.add('upid-invalid-value', `Segment ${segmentId} source layer must be string or null.`);
  }
  if (typeof source.exact !== 'boolean') {
    context.add('upid-invalid-value', `Segment ${segmentId} source exact flag must be boolean.`);
  }
  const approximation = source.approximation == null ? null : record(source.approximation);
  if (source.approximation != null && !approximation) {
    context.add('upid-invalid-value', `Segment ${segmentId} approximation must be an object.`);
  }
  if (approximation) {
    if (typeof approximation.sourceEntityType !== 'string') {
      context.add('upid-invalid-value', `Segment ${segmentId} approximation source type is invalid.`);
    }
    finiteNumber(approximation.maxChordError, `segment ${segmentId}.source.approximation.maxChordError`, context, {
      nonNegative: true
    });
  }
  const edit = source.edit == null ? null : record(source.edit);
  if (source.edit != null && !edit) {
    context.add('upid-invalid-value', `Segment ${segmentId} edit provenance must be an object.`);
  }
  if (edit) {
    finitePoint(edit.point, `segment ${segmentId}.source.edit.point`, context);
    if (typeof edit.operationId !== 'string' || !operationMap.has(edit.operationId)) {
      context.add(
        'upid-missing-reference',
        `Segment ${segmentId} edit provenance references missing operation ${String(edit.operationId)}.`,
        { relatedSegmentIds: [segmentId] }
      );
    }
    if (typeof edit.parentSegmentId !== 'string' || edit.parentSegmentId.length === 0) {
      context.add('upid-invalid-value', `Segment ${segmentId} edit parent segment ID is invalid.`);
    }
  }
  validateDxfSource(source.dxf, `segment ${segmentId}.source.dxf`, context);
}

function validateDxfSource(value: unknown, path: string, context: ValidationContext) {
  if (value == null) return;
  const source = record(value);
  if (!source) {
    context.add('upid-invalid-value', `${path} must be an object.`);
    return;
  }
  if (source.blockName !== null && typeof source.blockName !== 'string') {
    context.add('upid-invalid-value', `${path}.blockName must be string or null.`);
  }
  if (!Array.isArray(source.insertChain)) {
    context.add('upid-invalid-value', `${path}.insertChain must be an array.`);
    return;
  }
  for (const [index, rawInsert] of source.insertChain.entries()) {
    const insert = record(rawInsert);
    if (!insert) {
      context.add('upid-invalid-value', `${path}.insertChain[${index}] must be an object.`);
      continue;
    }
    finiteInteger(insert.column, `${path}.insertChain[${index}].column`, context, 0);
    finiteInteger(insert.row, `${path}.insertChain[${index}].row`, context, 0);
    const transform = record(insert.transform);
    if (!transform) {
      context.add('upid-invalid-value', `${path}.insertChain[${index}].transform must be an object.`);
      continue;
    }
    finitePoint(transform.insertion, `${path}.insertChain[${index}].transform.insertion`, context);
    if (transform.localOffset != null) finitePoint(transform.localOffset, `${path}.insertChain[${index}].transform.localOffset`, context);
    if (transform.blockBasePoint != null) finitePoint(transform.blockBasePoint, `${path}.insertChain[${index}].transform.blockBasePoint`, context);
    for (const key of ['rotationDegrees', 'scaleX', 'scaleY'] as const) {
      finiteNumber(transform[key], `${path}.insertChain[${index}].transform.${key}`, context);
    }
  }
}

function validateEndpointClusters(
  clusters: EndpointCluster[],
  segmentMap: Map<string, PathSegment>,
  validSegmentIds: Set<string>,
  tolerance: number,
  maximumRecordedTolerance: number,
  context: ValidationContext
) {
  const endpointOwners = new Map<string, string>();
  for (const cluster of clusters) {
    finitePoint(cluster.point, `endpoint cluster ${cluster.id}.point`, context, {
      relatedClusterIds: [cluster.id]
    });
    for (const key of ['toleranceUsed', 'radius', 'maxPairDistance'] as const) {
      finiteNumber(cluster[key], `endpoint cluster ${cluster.id}.${key}`, context, {
        nonNegative: true
      });
    }
    if (cluster.method !== 'exact' && cluster.method !== 'within-tolerance') {
      context.add('upid-invalid-value', `Endpoint cluster ${cluster.id} method is unsupported.`);
    }
    if (!Array.isArray(cluster.members) || cluster.members.length === 0) {
      context.add('upid-invalid-value', `Endpoint cluster ${cluster.id} must have members.`);
      continue;
    }
    const members: Array<Record<string, any>> = [];
    for (const rawMember of cluster.members) {
      const member = record(rawMember);
      if (!member) {
        context.add('upid-invalid-value', `Endpoint cluster ${cluster.id} contains an invalid member.`);
        continue;
      }
      members.push(member);
    }
    const finiteMemberPoints = members.map((member) => member.point).filter(finitePointOnly);
    const actualRadius = finitePointOnly(cluster.point)
      ? finiteMemberPoints.reduce(
          (maximum, point) => Math.max(maximum, distance(cluster.point, point)),
          0
        )
      : Number.NaN;
    if (
      Number.isFinite(cluster.radius) &&
      Number.isFinite(actualRadius) &&
      !numbersNearlyEqual(cluster.radius, actualRadius)
    ) {
      context.add(
        'upid-identity-mismatch',
        `Endpoint cluster ${cluster.id} radius metric is stale.`,
        { relatedClusterIds: [cluster.id] }
      );
    }
    if (
      Number.isFinite(cluster.maxPairDistance) &&
      Number.isFinite(actualRadius) &&
      (
        cluster.maxPairDistance + numericComparisonTolerance(cluster.maxPairDistance, actualRadius) < actualRadius ||
        cluster.maxPairDistance > 2 * actualRadius + numericComparisonTolerance(cluster.maxPairDistance, 2 * actualRadius)
      )
    ) {
      context.add(
        'upid-identity-mismatch',
        `Endpoint cluster ${cluster.id} max-pair metric is inconsistent with its radius.`,
        { relatedClusterIds: [cluster.id] }
      );
    }
    if (
      cluster.method === 'within-tolerance' &&
      Number.isFinite(cluster.toleranceUsed) &&
      cluster.toleranceUsed > maximumRecordedTolerance + numericComparisonTolerance(cluster.toleranceUsed, maximumRecordedTolerance)
    ) {
      context.add(
        'upid-identity-mismatch',
        `Endpoint cluster ${cluster.id} records a healing tolerance larger than the planner options allow.`,
        { relatedClusterIds: [cluster.id] }
      );
    }
    if (
      Number.isFinite(cluster.toleranceUsed) &&
      cluster.maxPairDistance > cluster.toleranceUsed + numericComparisonTolerance(cluster.maxPairDistance, cluster.toleranceUsed)
    ) {
      context.add(
        'upid-identity-mismatch',
        `Endpoint cluster ${cluster.id} members exceed its recorded tolerance.`,
        { relatedClusterIds: [cluster.id] }
      );
    }
    for (const member of members) {
      const segment = segmentMap.get(member.segmentId);
      if (!segment) {
        context.add(
          'upid-missing-reference',
          `Endpoint cluster ${cluster.id} references missing segment ${member.segmentId}.`,
          { relatedClusterIds: [cluster.id], relatedSegmentIds: [member.segmentId] }
        );
        continue;
      }
      if (member.side !== 'start' && member.side !== 'end') {
        context.add('upid-invalid-value', `Endpoint cluster ${cluster.id} has an invalid endpoint side.`);
        continue;
      }
      finitePoint(member.point, `endpoint cluster ${cluster.id} member point`, context, {
        relatedClusterIds: [cluster.id],
        relatedSegmentIds: [member.segmentId]
      });
      if (segment.kind === 'circle') {
        context.add('upid-identity-mismatch', `Circle ${segment.id} cannot be an endpoint-cluster member.`);
        continue;
      }
      const key = `${member.segmentId}:${member.side}`;
      const owner = endpointOwners.get(key);
      if (owner) {
        context.add(
          'upid-identity-mismatch',
          `Endpoint ${key} belongs to both ${owner} and ${cluster.id}.`,
          { relatedClusterIds: [owner, cluster.id], relatedSegmentIds: [member.segmentId] }
        );
      } else {
        endpointOwners.set(key, cluster.id);
      }
      if (
        validSegmentIds.has(segment.id) &&
        finitePointOnly(member.point) &&
        distance(member.point, member.side === 'start' ? segment.start : segment.end) > tolerance
      ) {
        context.add(
          'upid-identity-mismatch',
          `Endpoint cluster ${cluster.id} member ${key} disagrees with the segment endpoint.`,
          { relatedClusterIds: [cluster.id], relatedSegmentIds: [segment.id] }
        );
      }
    }
  }
  for (const segment of segmentMap.values()) {
    if (segment.kind === 'circle') continue;
    for (const side of ['start', 'end'] as const) {
      const key = `${segment.id}:${side}`;
      if (!endpointOwners.has(key)) {
        context.add(
          'upid-missing-reference',
          `Segment endpoint ${key} is missing from endpoint clusters.`,
          { relatedSegmentIds: [segment.id] }
        );
      }
    }
  }
}

function validateChains(
  chains: PathChain[],
  segmentMap: Map<string, PathSegment>,
  validSegmentIds: Set<string>,
  clusterMap: Map<string, EndpointCluster>,
  diagnosticMap: Map<string, PathDiagnostic>,
  tolerance: number,
  context: ValidationContext
) {
  const endpointToCluster = new Map<string, string>();
  for (const cluster of clusterMap.values()) {
    const members = Array.isArray(cluster.members) ? cluster.members : [];
    for (const rawMember of members) {
      const member = record(rawMember);
      if (
        member &&
        typeof member.segmentId === 'string' &&
        (member.side === 'start' || member.side === 'end')
      ) {
        endpointToCluster.set(`${member.segmentId}:${member.side}`, cluster.id);
      }
    }
  }
  for (const chain of chains) {
    if (!Array.isArray(chain.segmentRefs) || chain.segmentRefs.length === 0) {
      context.add('upid-invalid-value', `Chain ${chain.id} must contain segment refs.`, {
        relatedChainIds: [chain.id]
      });
      continue;
    }
    const resolved = validateSegmentRefs(
      chain.segmentRefs,
      `chain ${chain.id}`,
      segmentMap,
      validSegmentIds,
      context,
      { relatedChainIds: [chain.id] }
    );
    if (typeof chain.closed !== 'boolean') {
      context.add('upid-invalid-value', `Chain ${chain.id}.closed must be boolean.`);
    }
    if ((chain.closed ? 'closed-contour' : 'open-chain') !== chain.kind) {
      context.add('upid-identity-mismatch', `Chain ${chain.id} kind disagrees with its closed flag.`);
    }
    for (const [key, value] of [
      ['startClusterId', chain.startClusterId],
      ['endClusterId', chain.endClusterId]
    ] as const) {
      if (value !== null && !clusterMap.has(value)) {
        context.add(
          'upid-missing-reference',
          `Chain ${chain.id}.${key} references missing endpoint cluster ${value}.`,
          { relatedChainIds: [chain.id], relatedClusterIds: [value] }
        );
      }
    }
    finiteInteger(chain.metrics?.segmentCount, `chain ${chain.id}.metrics.segmentCount`, context, 0);
    finiteNumber(chain.metrics?.cutLength, `chain ${chain.id}.metrics.cutLength`, context, { nonNegative: true });
    finiteNumber(chain.metrics?.gapLength, `chain ${chain.id}.metrics.gapLength`, context, { nonNegative: true });
    if (chain.metrics?.segmentCount !== chain.segmentRefs.length) {
      context.add('upid-identity-mismatch', `Chain ${chain.id} segment-count metric is stale.`);
    }
    validateDiagnosticIds(chain.diagnosticIds, `chain ${chain.id}`, diagnosticMap, context);
    validateContinuity(resolved, chain.closed, `Chain ${chain.id}`, tolerance, context);
    if (resolved.length > 0) {
      const first = resolved[0];
      const last = resolved.at(-1)!;
      const expectedStartCluster = endpointClusterForOrientedEndpoint(
        first.segment,
        first.ref,
        'start',
        endpointToCluster
      );
      const expectedEndCluster = endpointClusterForOrientedEndpoint(
        last.segment,
        last.ref,
        'end',
        endpointToCluster
      );
      if (chain.startClusterId !== expectedStartCluster) {
        context.add(
          'upid-identity-mismatch',
          `Chain ${chain.id} start cluster disagrees with its first oriented endpoint.`,
          {
            relatedChainIds: [chain.id],
            relatedSegmentIds: [first.segment.id],
            ...(chain.startClusterId ? { relatedClusterIds: [chain.startClusterId] } : {})
          }
        );
      }
      if (chain.endClusterId !== expectedEndCluster) {
        context.add(
          'upid-identity-mismatch',
          `Chain ${chain.id} end cluster disagrees with its last oriented endpoint.`,
          {
            relatedChainIds: [chain.id],
            relatedSegmentIds: [last.segment.id],
            ...(chain.endClusterId ? { relatedClusterIds: [chain.endClusterId] } : {})
          }
        );
      }
    }
  }
}

function validateContours(
  contours: PathContour[],
  chainMap: Map<string, PathChain>,
  contourMap: Map<string, PathContour>,
  diagnosticMap: Map<string, PathDiagnostic>,
  context: ValidationContext
) {
  for (const contour of contours) {
    const chain = chainMap.get(contour.chainId);
    if (!chain) {
      context.add(
        'upid-missing-reference',
        `Contour ${contour.id} references missing chain ${contour.chainId}.`,
        { relatedContourIds: [contour.id], relatedChainIds: [contour.chainId] }
      );
    } else if (contour.closed !== chain.closed) {
      context.add('upid-identity-mismatch', `Contour ${contour.id} closed flag disagrees with its chain.`);
    }
    if (!CONTOUR_CLASSIFICATIONS.has(String(contour.classification))) {
      context.add('upid-invalid-value', `Contour ${contour.id} classification is unsupported.`);
    }
    if (contour.orientation !== null && !CONTOUR_ORIENTATIONS.has(String(contour.orientation))) {
      context.add('upid-invalid-value', `Contour ${contour.id} orientation is unsupported.`);
    }
    nullableFiniteNumber(contour.signedArea, `contour ${contour.id}.signedArea`, context);
    nullableFiniteNumber(contour.area, `contour ${contour.id}.area`, context, { nonNegative: true });
    finiteBounds(contour.bounds, `contour ${contour.id}.bounds`, context);
    finiteInteger(contour.containmentDepth, `contour ${contour.id}.containmentDepth`, context, 0);
    finiteNumber(contour.confidence, `contour ${contour.id}.confidence`, context, {
      nonNegative: true,
      maximum: 1
    });
    if (contour.representativePoint !== null) {
      finitePoint(contour.representativePoint, `contour ${contour.id}.representativePoint`, context);
    }
    if (!Array.isArray(contour.approximatePolygon)) {
      context.add('upid-invalid-value', `Contour ${contour.id}.approximatePolygon must be an array.`);
    } else {
      contour.approximatePolygon.forEach((point, index) =>
        finitePoint(point, `contour ${contour.id}.approximatePolygon[${index}]`, context)
      );
    }
    if (contour.parentId !== null && !contourMap.has(contour.parentId)) {
      context.add(
        'upid-missing-reference',
        `Contour ${contour.id} references missing parent ${contour.parentId}.`,
        { relatedContourIds: [contour.id, contour.parentId] }
      );
    }
    const childIds = stringArray(contour.childIds, `contour ${contour.id}.childIds`, context);
    for (const childId of childIds) {
      if (!contourMap.has(childId)) {
        context.add(
          'upid-missing-reference',
          `Contour ${contour.id} references missing child ${childId}.`,
          { relatedContourIds: [contour.id, childId] }
        );
      }
    }
    validateProvenance(contour.provenance, `contour ${contour.id}.provenance`, new Map(), context);
    validateDiagnosticIds(contour.diagnosticIds, `contour ${contour.id}`, diagnosticMap, context);
  }
}

function validateOperations(
  operations: PathOperation[],
  segmentMap: Map<string, PathSegment>,
  validSegmentIds: Set<string>,
  chainMap: Map<string, PathChain>,
  contourMap: Map<string, PathContour>,
  tolerance: number,
  context: ValidationContext
) {
  const operationMap = new Map(operations.map((operation) => [operation.id, operation]));
  for (const operation of operations) {
    const chain = chainMap.get(operation.chainId);
    const contour = contourMap.get(operation.contourId);
    if (!chain) {
      context.add(
        'upid-missing-reference',
        `Operation ${operation.id} references missing chain ${operation.chainId}.`,
        { relatedChainIds: [operation.chainId] }
      );
    }
    if (!contour) {
      context.add(
        'upid-missing-reference',
        `Operation ${operation.id} references missing contour ${operation.contourId}.`,
        { relatedContourIds: [operation.contourId] }
      );
    }
    if (!Array.isArray(operation.segmentRefs) || operation.segmentRefs.length === 0) {
      context.add('upid-invalid-value', `Operation ${operation.id} must contain segment refs.`);
      continue;
    }
    const resolved = validateSegmentRefs(
      operation.segmentRefs,
      `operation ${operation.id}`,
      segmentMap,
      validSegmentIds,
      context
    );
    finitePoint(operation.startPoint, `operation ${operation.id}.startPoint`, context);
    finitePoint(operation.endPoint, `operation ${operation.id}.endPoint`, context);
    finiteInteger(operation.orderIndex, `operation ${operation.id}.orderIndex`, context, 0);
    finiteNumber(operation.metrics?.cutLength, `operation ${operation.id}.metrics.cutLength`, context, { nonNegative: true });
    finiteNumber(operation.metrics?.rapidInLength, `operation ${operation.id}.metrics.rapidInLength`, context, { nonNegative: true });
    finiteInteger(operation.metrics?.segmentCount, `operation ${operation.id}.metrics.segmentCount`, context, 0);
    if (operation.metrics?.segmentCount !== operation.segmentRefs.length) {
      context.add('upid-identity-mismatch', `Operation ${operation.id} segment-count metric is stale.`);
    }
    if (operation.direction !== 'forward' && operation.direction !== 'reverse') {
      context.add('upid-invalid-value', `Operation ${operation.id} direction is unsupported.`);
    }
    if (!CONTOUR_CLASSIFICATIONS.has(String(operation.classification))) {
      context.add('upid-invalid-value', `Operation ${operation.id} classification is unsupported.`);
    }
    validateProvenance(operation.provenance, `operation ${operation.id}.provenance`, segmentMap, context, operationMap);
    validateOverrides(operation.overrides, operation, segmentMap, tolerance, context);
    validateContinuity(resolved, operation.closed, `Operation ${operation.id}`, tolerance, context);
    if (resolved.length > 0 && finitePointOnly(operation.startPoint)) {
      const actualStart = orientedSegmentStart(resolved[0].segment, resolved[0].ref);
      const actualEnd = orientedSegmentEnd(resolved.at(-1)!.segment, resolved.at(-1)!.ref);
      if (distance(operation.startPoint, actualStart) > tolerance) {
        context.add(
          'upid-identity-mismatch',
          `Operation ${operation.id} start point disagrees with its first oriented segment.`,
          { relatedSegmentIds: [resolved[0].segment.id], relatedContourIds: [operation.contourId] }
        );
      }
      const expectedEnd = operation.closed ? operation.startPoint : actualEnd;
      if (!finitePointOnly(operation.endPoint) || distance(operation.endPoint, expectedEnd) > tolerance) {
        context.add(
          'upid-identity-mismatch',
          `Operation ${operation.id} end point disagrees with its oriented path.`,
          { relatedSegmentIds: [resolved.at(-1)!.segment.id], relatedContourIds: [operation.contourId] }
        );
      }
    }
  }
}

function validatePathElements(
  pathElements: PathElement[],
  pathElementMap: Map<string, PathElement>,
  rootIds: string[],
  segmentMap: Map<string, PathSegment>,
  chainMap: Map<string, PathChain>,
  contourMap: Map<string, PathContour>,
  operationMap: Map<string, PathOperation>,
  diagnosticMap: Map<string, PathDiagnostic>,
  tolerance: number,
  context: ValidationContext
) {
  void rootIds;
  for (const element of pathElements) {
    const contour = contourMap.get(element.contourId);
    const chain = chainMap.get(element.chainId);
    const operation = element.operationId === null ? null : operationMap.get(element.operationId);
    if (!contour) {
      context.add(
        'upid-missing-reference',
        `Path element ${element.id} references missing contour ${element.contourId}.`,
        { relatedContourIds: [element.contourId] }
      );
    }
    if (!chain) {
      context.add(
        'upid-missing-reference',
        `Path element ${element.id} references missing chain ${element.chainId}.`,
        { relatedChainIds: [element.chainId] }
      );
    }
    if (element.operationId !== null && !operation) {
      context.add(
        'upid-missing-reference',
        `Path element ${element.id} references missing operation ${element.operationId}.`
      );
    }
    validateSegmentRefs(element.segmentRefs, `path element ${element.id}`, segmentMap, new Set(segmentMap.keys()), context);
    if (element.parentId !== null && !pathElementMap.has(element.parentId)) {
      context.add('upid-missing-reference', `Path element ${element.id} references missing parent ${element.parentId}.`);
    }
    const childIds = stringArray(element.childIds, `path element ${element.id}.childIds`, context);
    for (const childId of childIds) {
      if (!pathElementMap.has(childId)) {
        context.add('upid-missing-reference', `Path element ${element.id} references missing child ${childId}.`);
      }
    }
    if (!CONTOUR_CLASSIFICATIONS.has(String(element.classification))) {
      context.add('upid-invalid-value', `Path element ${element.id} classification is unsupported.`);
    }
    const expectedKind = element.closed ? 'contour' : 'open-chain';
    if (element.kind !== expectedKind) {
      context.add(
        'upid-identity-mismatch',
        `Path element ${element.id} kind disagrees with its closed flag.`
      );
    }
    finiteInteger(element.containmentDepth, `path element ${element.id}.containmentDepth`, context, 0);
    finiteBounds(element.bounds, `path element ${element.id}.bounds`, context);
    finiteNumber(element.confidence, `path element ${element.id}.confidence`, context, { nonNegative: true, maximum: 1 });
    if (!Array.isArray(element.points)) {
      context.add('upid-invalid-value', `Path element ${element.id}.points must be an array.`);
    } else {
      const validPoints = element.points.filter((point) => record(point));
      element.points.forEach((rawPoint, index) => {
        const point = record(rawPoint);
        if (!point) {
          context.add('upid-invalid-value', `Path element ${element.id}.points[${index}] must be an object.`);
          return;
        }
        finitePoint(point.point, `path element ${element.id}.points[${index}].point`, context);
        if (!['start', 'end', 'representative'].includes(point.role)) {
          context.add('upid-invalid-value', `Path element ${element.id}.points[${index}] has an invalid role.`);
        }
        if (point.source !== 'operation' && point.source !== 'contour') {
          context.add('upid-invalid-value', `Path element ${element.id}.points[${index}] has an invalid source.`);
        }
        const expectedPoint =
          point.role === 'start'
            ? operation?.startPoint
            : point.role === 'end'
              ? operation?.endPoint
              : contour?.representativePoint;
        if (
          expectedPoint &&
          finitePointOnly(point.point) &&
          finitePointOnly(expectedPoint) &&
          distance(point.point, expectedPoint) > tolerance
        ) {
          context.add(
            'upid-identity-mismatch',
            `Path element ${element.id} ${point.role} point disagrees with its ${point.source}.`
          );
        }
      });
      if (operation) {
        for (const role of ['start', 'end'] as const) {
          const matches = validPoints.filter(
            (point) => point.role === role && point.source === 'operation'
          );
          if (matches.length !== 1) {
            context.add(
              'upid-identity-mismatch',
              `Path element ${element.id} must expose exactly one operation ${role} point.`
            );
          }
        }
      }
      const representativeMatches = validPoints.filter(
        (point) => point.role === 'representative' && point.source === 'contour'
      );
      if ((contour?.representativePoint ? 1 : 0) !== representativeMatches.length) {
        context.add(
          'upid-identity-mismatch',
          `Path element ${element.id} representative-point records disagree with its contour.`
        );
      }
    }
    if (element.metrics !== null) {
      finiteNumber(element.metrics.cutLength, `path element ${element.id}.metrics.cutLength`, context, { nonNegative: true });
      finiteNumber(element.metrics.rapidInLength, `path element ${element.id}.metrics.rapidInLength`, context, { nonNegative: true });
      finiteInteger(element.metrics.segmentCount, `path element ${element.id}.metrics.segmentCount`, context, 0);
    }
    validateProvenance(element.provenance, `path element ${element.id}.provenance`, segmentMap, context, operationMap);
    if (operation) validateOverrides(element.overrides, operation, segmentMap, tolerance, context);
    validateDiagnosticIds(element.diagnosticIds, `path element ${element.id}`, diagnosticMap, context);
  }
}

function validateIdentityAgreement(
  chains: PathChain[],
  contours: PathContour[],
  pathElements: PathElement[],
  operations: PathOperation[],
  chainMap: Map<string, PathChain>,
  contourMap: Map<string, PathContour>,
  operationMap: Map<string, PathOperation>,
  context: ValidationContext
) {
  void chains;
  const pathElementsByContourId = new Map<string, PathElement[]>();
  const pathElementsByOperationId = new Map<string, PathElement[]>();
  for (const element of pathElements) {
    const contourElements = pathElementsByContourId.get(element.contourId) ?? [];
    contourElements.push(element);
    pathElementsByContourId.set(element.contourId, contourElements);
    if (element.operationId) {
      const operationElements = pathElementsByOperationId.get(element.operationId) ?? [];
      operationElements.push(element);
      pathElementsByOperationId.set(element.operationId, operationElements);
    }
  }
  for (const contour of contours) {
    const chain = chainMap.get(contour.chainId);
    const contourElements = pathElementsByContourId.get(contour.id) ?? [];
    const element = contourElements[0];
    if (contourElements.length === 0) {
      context.add(
        'upid-missing-reference',
        `Contour ${contour.id} has no path element.`,
        { relatedContourIds: [contour.id] }
      );
      continue;
    }
    if (contourElements.length !== 1) {
      context.add(
        'upid-identity-mismatch',
        `Contour ${contour.id} must map to exactly one path element.`,
        { relatedContourIds: [contour.id] }
      );
    }
    if (element.id !== contour.id || element.chainId !== contour.chainId) {
      context.add('upid-identity-mismatch', `Contour ${contour.id} identity disagrees with path element ${element.id}.`);
    }
    if (chain && element.closed !== chain.closed) {
      context.add('upid-identity-mismatch', `Path element ${element.id} closed flag disagrees with its chain.`);
    }
  }
  for (const element of pathElements) {
    const contour = contourMap.get(element.contourId);
    const chain = chainMap.get(element.chainId);
    const operation = element.operationId ? operationMap.get(element.operationId) : null;
    if (contour && (element.id !== contour.id || element.chainId !== contour.chainId)) {
      context.add(
        'upid-identity-mismatch',
        `Path element ${element.id} identity disagrees with contour ${contour.id}.`,
        { relatedContourIds: [contour.id] }
      );
    }
    if (!operation && chain && !sameRefs(element.segmentRefs, chain.segmentRefs)) {
      context.add(
        'upid-identity-mismatch',
        `Unplanned path element ${element.id} segment refs disagree with chain ${chain.id}.`,
        {
          relatedChainIds: [chain.id],
          relatedSegmentIds: segmentIdsFromRefs(element.segmentRefs)
        }
      );
    }
  }
  for (const operation of operations) {
    const chain = chainMap.get(operation.chainId);
    const contour = contourMap.get(operation.contourId);
    const elements = pathElementsByOperationId.get(operation.id) ?? [];
    if (elements.length !== 1) {
      context.add(
        elements.length === 0 ? 'upid-missing-reference' : 'upid-identity-mismatch',
        `Operation ${operation.id} must map to exactly one path element.`
      );
    }
    if (chain && !sameSegmentIds(operation.segmentRefs, chain.segmentRefs)) {
      context.add(
        'upid-identity-mismatch',
        `Operation ${operation.id} segment refs disagree with chain ${chain.id}.`,
        { relatedChainIds: [chain.id], relatedSegmentIds: segmentIdsFromRefs(operation.segmentRefs) }
      );
    }
    if (contour && contour.chainId !== operation.chainId) {
      context.add('upid-identity-mismatch', `Operation ${operation.id} chain disagrees with contour ${contour.id}.`);
    }
    if (
      contour &&
      (contour.closed !== operation.closed || contour.classification !== operation.classification)
    ) {
      context.add(
        'upid-identity-mismatch',
        `Operation ${operation.id} role metadata disagrees with contour ${contour.id}.`,
        { relatedContourIds: [contour.id] }
      );
    }
    const element = elements[0];
    if (element) {
      if (
        element.contourId !== operation.contourId ||
        element.chainId !== operation.chainId ||
        element.closed !== operation.closed ||
        element.classification !== operation.classification ||
        element.orderIndex !== operation.orderIndex ||
        element.direction !== operation.direction ||
        !sameRefs(element.segmentRefs, operation.segmentRefs)
      ) {
        context.add('upid-identity-mismatch', `Operation ${operation.id} identity disagrees with path element ${element.id}.`);
      }
    }
    if (!operationMap.has(operation.id)) {
      context.add('upid-missing-reference', `Operation ${operation.id} is missing from its operation index.`);
    }
  }
}

function validateContourTree(
  contours: PathContour[],
  contourMap: Map<string, PathContour>,
  context: ValidationContext
) {
  const childIdsByContour = indexChildIds(contours);
  for (const contour of contours) {
    if (contour.parentId) {
      const parent = contourMap.get(contour.parentId);
      if (parent && !childIdsByContour.get(parent.id)?.has(contour.id)) {
        context.add('upid-identity-mismatch', `Contour ${contour.id} is missing from parent ${parent.id} children.`);
      }
    }
    for (const childId of childIdsByContour.get(contour.id) ?? []) {
      const child = contourMap.get(childId);
      if (child && child.parentId !== contour.id) {
        context.add('upid-identity-mismatch', `Contour ${contour.id} child ${childId} does not point back to its parent.`);
      }
    }
  }
  validateParentCycles(contours, contourMap, 'contour', context);
}

function validatePathElementTree(
  elements: PathElement[],
  elementMap: Map<string, PathElement>,
  rootIds: string[],
  context: ValidationContext
) {
  const childIdsByElement = indexChildIds(elements);
  const rootSet = new Set<string>();
  for (const rootId of rootIds) {
    if (rootSet.has(rootId)) {
      context.add('upid-duplicate-id', `Root path element ID ${rootId} is duplicated.`);
    }
    rootSet.add(rootId);
    const root = elementMap.get(rootId);
    if (!root) {
      context.add('upid-missing-reference', `Root path element ${rootId} is missing.`);
    } else if (root.parentId !== null) {
      context.add('upid-identity-mismatch', `Root path element ${rootId} has a parent.`);
    }
  }
  for (const element of elements) {
    if ((element.parentId === null) !== rootSet.has(element.id)) {
      context.add('upid-identity-mismatch', `Path element ${element.id} root membership disagrees with its parent.`);
    }
    if (element.parentId) {
      const parent = elementMap.get(element.parentId);
      if (parent && !childIdsByElement.get(parent.id)?.has(element.id)) {
        context.add('upid-identity-mismatch', `Path element ${element.id} is missing from parent ${parent.id} children.`);
      }
    }
    for (const childId of childIdsByElement.get(element.id) ?? []) {
      const child = elementMap.get(childId);
      if (child && child.parentId !== element.id) {
        context.add('upid-identity-mismatch', `Path element ${element.id} child ${childId} does not point back.`);
      }
    }
  }
  validateParentCycles(elements, elementMap, 'path element', context);
}

function validatePlan(
  plan: Record<string, unknown> | null,
  operations: PathOperation[],
  documentDiagnostics: PathDiagnostic[],
  context: ValidationContext
) {
  if (!plan) return;
  const metrics = record(plan.metrics);
  if (!metrics) {
    context.add('upid-invalid-value', 'plan.metrics must be an object.');
  } else {
    finiteInteger(metrics.operationCount, 'plan.metrics.operationCount', context, 0);
    finiteNumber(metrics.totalCutLength, 'plan.metrics.totalCutLength', context, { nonNegative: true });
    finiteNumber(metrics.totalRapidLength, 'plan.metrics.totalRapidLength', context, { nonNegative: true });
    if (metrics.operationCount !== operations.length) {
      context.add('upid-identity-mismatch', 'Plan operation-count metric is stale.');
    }
  }
  const diagnosticIds = new Set(documentDiagnostics.map((diagnostic) => diagnostic.id));
  if (!Array.isArray(plan.diagnostics)) {
    context.add('upid-invalid-value', 'plan.diagnostics must be an array.');
  } else {
    for (const diagnostic of plan.diagnostics) {
      const id = record(diagnostic)?.id;
      if (typeof id !== 'string' || !diagnosticIds.has(id)) {
        context.add('upid-missing-reference', `Plan diagnostic ${String(id)} is missing from document diagnostics.`);
      }
    }
  }
}

function validateOverrides(
  overrides: PathOperationOverrides | undefined,
  operation: PathOperation,
  segmentMap: Map<string, PathSegment>,
  tolerance: number,
  context: ValidationContext
) {
  if (!overrides) return;
  const start = overrides.start;
  if (start) {
    finitePoint(start.point, `operation ${operation.id} start override point`, context);
    finiteInteger(start.sourceSegmentIndex, `operation ${operation.id} start override segment index`, context, 0);
    const createdSegmentIds = stringArray(
      start.createdSegmentIds,
      `Operation ${operation.id} start override createdSegmentIds`,
      context
    );
    for (const id of createdSegmentIds) {
      if (!segmentMap.has(id)) {
        context.add(
          'upid-missing-reference',
          `Operation ${operation.id} start override references missing created segment ${id}.`,
          { relatedSegmentIds: [id] }
        );
      }
    }
    if (!manualStartSourceExists(start.sourceSegmentId, createdSegmentIds, segmentMap)) {
      context.add(
        'upid-missing-reference',
        `Operation ${operation.id} start override references missing source segment ${start.sourceSegmentId}.`,
        { relatedSegmentIds: [start.sourceSegmentId] }
      );
    }
    if (finitePointOnly(start.point) && finitePointOnly(operation.startPoint) && distance(start.point, operation.startPoint) > tolerance) {
      context.add('upid-identity-mismatch', `Operation ${operation.id} start override point disagrees with operation start.`);
    }
  }
  const leadIn = overrides.leadIn;
  if (leadIn) {
    finitePoint(leadIn.from, `operation ${operation.id} lead-in from`, context);
    finitePoint(leadIn.to, `operation ${operation.id} lead-in to`, context);
    finiteInteger(leadIn.sourceSegmentIndex, `operation ${operation.id} lead-in segment index`, context, 0);
    if (!segmentMap.has(leadIn.sourceSegmentId)) {
      context.add(
        'upid-missing-reference',
        `Operation ${operation.id} lead-in references missing segment ${leadIn.sourceSegmentId}.`,
        { relatedSegmentIds: [leadIn.sourceSegmentId] }
      );
    }
    if (finitePointOnly(leadIn.to) && finitePointOnly(operation.startPoint) && distance(leadIn.to, operation.startPoint) > tolerance) {
      context.add('upid-identity-mismatch', `Operation ${operation.id} lead-in does not end at operation start.`);
    }
  }
  if (overrides.order) finiteInteger(overrides.order.orderIndex, `operation ${operation.id} order override`, context, 0);
  if (overrides.direction && overrides.direction.direction !== operation.direction) {
    context.add('upid-identity-mismatch', `Operation ${operation.id} direction override disagrees with operation direction.`);
  }
  if (overrides.classification && overrides.classification.classification !== operation.classification) {
    context.add('upid-identity-mismatch', `Operation ${operation.id} classification override disagrees with operation classification.`);
  }
}

function manualStartSourceExists(
  sourceSegmentId: string,
  createdSegmentIds: string[],
  segmentMap: Map<string, PathSegment>
) {
  if (segmentMap.has(sourceSegmentId)) return true;
  return createdSegmentIds.length > 0 && createdSegmentIds.every((id) => {
    const segment = segmentMap.get(id);
    return segment?.source.edit?.parentSegmentId === sourceSegmentId;
  });
}

function validateProvenance(
  provenance: PathElementProvenance,
  path: string,
  segmentMap: Map<string, PathSegment>,
  context: ValidationContext,
  operationMap: Map<string, PathOperation> = new Map()
) {
  const value = record(provenance);
  if (!value) {
    context.add('upid-invalid-value', `${path} must be an object.`);
    return;
  }
  for (const [key, items] of [
    ['sourceEntityIndices', value.sourceEntityIndices],
    ['sourceEntityHandles', value.sourceEntityHandles]
  ] as const) {
    if (items == null && key === 'sourceEntityHandles') continue;
    if (!Array.isArray(items)) {
      context.add('upid-invalid-value', `${path}.${key} must be an array.`);
      continue;
    }
    if (key === 'sourceEntityIndices') {
      items.forEach((item, index) => finiteInteger(item, `${path}.${key}[${index}]`, context, 0));
    }
  }
  const dxf = value.dxf == null ? null : record(value.dxf);
  if (value.dxf != null && !dxf) context.add('upid-invalid-value', `${path}.dxf must be an object.`);
  if (dxf) finiteInteger(dxf.insertedSegmentCount, `${path}.dxf.insertedSegmentCount`, context, 0);
  const edit = value.edit == null ? null : record(value.edit);
  if (value.edit != null && !edit) context.add('upid-invalid-value', `${path}.edit must be an object.`);
  if (edit) {
    for (const id of stringArray(edit.derivedSegmentIds, `${path}.edit.derivedSegmentIds`, context)) {
      if (!segmentMap.has(id)) {
        context.add('upid-missing-reference', `${path} references missing derived segment ${id}.`, {
          relatedSegmentIds: [id]
        });
      }
    }
    if (!Array.isArray(edit.events)) {
      context.add('upid-invalid-value', `${path}.edit.events must be an array.`);
    } else {
      edit.events.forEach((rawEvent, index) => {
        const event = record(rawEvent);
        if (!event) {
          context.add('upid-invalid-value', `${path}.edit.events[${index}] must be an object.`);
          return;
        }
        finitePoint(event.point, `${path}.edit.events[${index}].point`, context);
        if (typeof event.operationId !== 'string' || !operationMap.has(event.operationId)) {
          context.add('upid-missing-reference', `${path}.edit event references missing operation ${String(event.operationId)}.`);
        }
        for (const id of stringArray(event.derivedSegmentIds, `${path}.edit.events[${index}].derivedSegmentIds`, context)) {
          if (!segmentMap.has(id)) {
            context.add('upid-missing-reference', `${path}.edit event references missing derived segment ${id}.`, {
              relatedSegmentIds: [id]
            });
          }
        }
      });
    }
  }
}

function validateSegmentRefs(
  refs: OrientedSegmentRef[],
  owner: string,
  segmentMap: Map<string, PathSegment>,
  validSegmentIds: Set<string>,
  context: ValidationContext,
  related: Pick<PathDiagnostic, 'relatedChainIds' | 'relatedContourIds'> = {}
) {
  const resolved: Array<{ ref: OrientedSegmentRef; segment: PathSegment }> = [];
  if (!Array.isArray(refs)) {
    context.add('upid-invalid-value', `${owner} segment refs must be an array.`);
    return resolved;
  }
  for (const ref of refs) {
    if (!ref || typeof ref.segmentId !== 'string' || typeof ref.reversed !== 'boolean') {
      context.add('upid-invalid-value', `${owner} contains an invalid oriented segment ref.`);
      continue;
    }
    const segment = segmentMap.get(ref.segmentId);
    if (!segment) {
      context.add(
        'upid-missing-reference',
        `${owner} references missing segment ${ref.segmentId}.`,
        { ...related, relatedSegmentIds: [ref.segmentId] }
      );
      continue;
    }
    if (validSegmentIds.has(segment.id)) resolved.push({ ref, segment });
  }
  return resolved;
}

function validateContinuity(
  resolved: Array<{ ref: OrientedSegmentRef; segment: PathSegment }>,
  closed: boolean,
  owner: string,
  tolerance: number,
  context: ValidationContext
) {
  for (let index = 0; index < resolved.length - 1; index++) {
    const current = resolved[index];
    const next = resolved[index + 1];
    if (
      distance(
        orientedSegmentEnd(current.segment, current.ref),
        orientedSegmentStart(next.segment, next.ref)
      ) > tolerance
    ) {
      context.add(
        'upid-discontinuity',
        `${owner} is discontinuous between segments ${current.segment.id} and ${next.segment.id}.`,
        { relatedSegmentIds: [current.segment.id, next.segment.id] }
      );
    }
  }
  if (closed && resolved.length > 0) {
    const first = resolved[0];
    const last = resolved.at(-1)!;
    if (
      distance(
        orientedSegmentEnd(last.segment, last.ref),
        orientedSegmentStart(first.segment, first.ref)
      ) > tolerance
    ) {
      context.add(
        'upid-broken-closure',
        `${owner} does not close from segment ${last.segment.id} to ${first.segment.id}.`,
        { relatedSegmentIds: [last.segment.id, first.segment.id] }
      );
    }
  }
}

function validateDiagnosticIds(
  ids: string[],
  owner: string,
  diagnosticMap: Map<string, PathDiagnostic>,
  context: ValidationContext
) {
  if (!Array.isArray(ids)) {
    context.add('upid-invalid-value', `${owner} diagnostic IDs must be an array.`);
    return;
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !diagnosticMap.has(id)) {
      context.add('upid-missing-reference', `${owner} references missing diagnostic ${String(id)}.`);
    }
  }
}

function validateDiagnostics(rawDiagnostics: unknown[], context: ValidationContext) {
  const accepted: PathDiagnostic[] = [];
  for (const [index, rawDiagnostic] of rawDiagnostics.entries()) {
    const diagnostic = record(rawDiagnostic);
    if (!diagnostic) {
      context.add('upid-invalid-value', `diagnostics[${index}] must be an object.`);
      continue;
    }
    if (
      typeof diagnostic.id !== 'string' ||
      typeof diagnostic.code !== 'string' ||
      typeof diagnostic.message !== 'string' ||
      !['info', 'warning', 'error'].includes(String(diagnostic.severity))
    ) {
      context.add('upid-invalid-value', `diagnostics[${index}] has invalid required fields.`);
      continue;
    }
    validateFiniteNestedNumbers(diagnostic.details, `diagnostic ${diagnostic.id}.details`, context);
    accepted.push(rawDiagnostic as PathDiagnostic);
  }
  return accepted;
}

function validateFiniteNestedNumbers(value: unknown, path: string, context: ValidationContext) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) context.add('upid-invalid-value', `${path} contains a non-finite number.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateFiniteNestedNumbers(item, `${path}[${index}]`, context));
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const [key, item] of Object.entries(object)) {
    validateFiniteNestedNumbers(item, `${path}.${key}`, context);
  }
}

function idMap<T extends { id: string }>(
  items: T[],
  label: string,
  context: ValidationContext
) {
  const map = new Map<string, T>();
  for (const [index, item] of items.entries()) {
    const id = record(item)?.id;
    if (typeof id !== 'string' || id.length === 0) {
      context.add('upid-invalid-value', `${label}[${index}] must have a non-empty string ID.`);
      continue;
    }
    if (map.has(id)) {
      context.add('upid-duplicate-id', `${label} contains duplicate ID ${id}.`);
      continue;
    }
    map.set(id, item);
  }
  return map;
}

function collection<T>(
  owner: Record<string, unknown>,
  key: string,
  context: ValidationContext,
  path = key
) {
  if (!Array.isArray(owner[key])) {
    context.add('upid-invalid-value', `${path} must be an array.`);
    return [] as T[];
  }
  return (owner[key] as unknown[]).filter((item, index): item is T => {
    if (record(item)) return true;
    context.add('upid-invalid-value', `${path}[${index}] must be an object.`);
    return false;
  });
}

function validationTolerance(optionsValue: unknown, clusters: EndpointCluster[]) {
  const options = record(optionsValue);
  const endpointTolerance = finiteNonNegative(options?.endpointTolerance) ?? 0;
  const coincidenceEpsilon = finiteNonNegative(options?.coincidenceEpsilon) ?? 0;
  const recordedTolerance = clusters.reduce((maximum, cluster) => {
    if (cluster?.method !== 'within-tolerance') return maximum;
    return Math.max(maximum, finiteNonNegative(cluster.toleranceUsed) ?? 0);
  }, 0);
  return Math.max(endpointTolerance, coincidenceEpsilon, recordedTolerance);
}

function maximumLegitimateRecordedTolerance(optionsValue: unknown) {
  const options = record(optionsValue);
  const endpointTolerance = finiteNonNegative(options?.endpointTolerance) ?? 0;
  const coincidenceEpsilon = finiteNonNegative(options?.coincidenceEpsilon) ?? 0;
  return Math.max(endpointTolerance, Math.SQRT2 * coincidenceEpsilon);
}

function endpointClusterForOrientedEndpoint(
  segment: PathSegment,
  ref: OrientedSegmentRef,
  endpoint: 'start' | 'end',
  endpointToCluster: Map<string, string>
) {
  if (segment.kind === 'circle') return null;
  const side =
    endpoint === 'start'
      ? ref.reversed
        ? 'end'
        : 'start'
      : ref.reversed
        ? 'start'
        : 'end';
  return endpointToCluster.get(`${segment.id}:${side}`) ?? null;
}

function numbersNearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= numericComparisonTolerance(left, right);
}

function numericComparisonTolerance(left: number, right: number) {
  return 64 * Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function sameRefs(left: OrientedSegmentRef[], right: OrientedSegmentRef[]) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(
      (ref, index) =>
        !!ref &&
        ref.segmentId === right[index]?.segmentId &&
        ref.reversed === right[index]?.reversed
    )
  );
}

function sameSegmentIds(left: OrientedSegmentRef[], right: OrientedSegmentRef[]) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const ref of left) {
    if (!ref || typeof ref.segmentId !== 'string') return false;
    counts.set(ref.segmentId, (counts.get(ref.segmentId) ?? 0) + 1);
  }
  for (const ref of right) {
    if (!ref || typeof ref.segmentId !== 'string') return false;
    const remaining = counts.get(ref.segmentId) ?? 0;
    if (remaining === 0) return false;
    counts.set(ref.segmentId, remaining - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

function segmentIdsFromRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const rawRef of value) {
    const segmentId = record(rawRef)?.segmentId;
    if (typeof segmentId === 'string') ids.push(segmentId);
  }
  return ids;
}

function indexChildIds<T extends { id: string; childIds: string[] }>(items: T[]) {
  const indexed = new Map<string, Set<string>>();
  for (const item of items) {
    if (indexed.has(item.id)) continue;
    indexed.set(
      item.id,
      new Set(
        Array.isArray(item.childIds)
          ? item.childIds.filter((childId): childId is string => typeof childId === 'string')
          : []
      )
    );
  }
  return indexed;
}

function validateParentCycles<T extends { id: string; parentId: string | null }>(
  items: T[],
  map: Map<string, T>,
  label: string,
  context: ValidationContext
) {
  const resolved = new Set<string>();
  for (const item of items) {
    if (resolved.has(item.id)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: T | undefined = item;
    while (current && !resolved.has(current.id)) {
      const cycleIndex = pathIndex.get(current.id);
      if (cycleIndex != null) {
        context.add(
          'upid-identity-mismatch',
          `${label} ${item.id} has a parent cycle through ${path.slice(cycleIndex).join(', ')}.`
        );
        break;
      }
      pathIndex.set(current.id, path.length);
      path.push(current.id);
      current = current.parentId ? map.get(current.parentId) : undefined;
    }
    path.forEach((id) => resolved.add(id));
  }
}

function uniqueDiagnostics(diagnostics: PathDiagnostic[]) {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    if (seen.has(diagnostic.id)) return false;
    seen.add(diagnostic.id);
    return true;
  });
}

function finiteBounds(
  value: unknown,
  path: string,
  context: ValidationContext,
  refs: Parameters<ValidationContext['add']>[2] = {}
) {
  const bounds = record(value) as Bounds2 | null;
  if (!bounds) {
    context.add('upid-invalid-value', `${path} must be an object.`, refs);
    return false;
  }
  const values = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  if (!values.every(Number.isFinite) || bounds.minX > bounds.maxX || bounds.minY > bounds.maxY) {
    context.add('upid-invalid-value', `${path} must contain ordered finite values.`, refs);
    return false;
  }
  return true;
}

function finitePoint(
  value: unknown,
  path: string,
  context: ValidationContext,
  refs: Parameters<ValidationContext['add']>[2] = {}
) {
  if (!finitePointOnly(value)) {
    context.add('upid-invalid-value', `${path} must contain finite X/Y coordinates.`, refs);
    return false;
  }
  return true;
}

function finitePointOnly(value: unknown): value is Point2 {
  const point = record(value);
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function finiteNumber(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: { nonNegative?: boolean; positive?: boolean; maximum?: number } = {},
  refs: Parameters<ValidationContext['add']>[2] = {}
) {
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    (!options.nonNegative || value >= 0) &&
    (!options.positive || value > 0) &&
    (options.maximum == null || value <= options.maximum);
  if (!valid) context.add('upid-invalid-value', `${path} is invalid or non-finite.`, refs);
  return valid;
}

function nullableFiniteNumber(
  value: unknown,
  path: string,
  context: ValidationContext,
  options: { nonNegative?: boolean } = {}
) {
  if (value === null) return true;
  return finiteNumber(value, path, context, options);
}

function finiteInteger(
  value: unknown,
  path: string,
  context: ValidationContext,
  minimum: number
) {
  const valid = typeof value === 'number' && Number.isInteger(value) && value >= minimum;
  if (!valid) context.add('upid-invalid-value', `${path} must be an integer of at least ${minimum}.`);
  return valid;
}

function optionalString(
  value: unknown,
  path: string,
  context: ValidationContext,
  nonEmpty = false
) {
  if (value == null) return;
  if (typeof value !== 'string' || (nonEmpty && value.length === 0)) {
    context.add('upid-invalid-value', `${path} must be ${nonEmpty ? 'a non-empty ' : 'a '}string when present.`);
  }
}

function stringArray(value: unknown, path: string, context: ValidationContext) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    context.add('upid-invalid-value', `${path} must be an array of strings.`);
    return [];
  }
  return value as string[];
}

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function relatedSegment(segment: { id: string }) {
  return { relatedSegmentIds: [segment.id] };
}
