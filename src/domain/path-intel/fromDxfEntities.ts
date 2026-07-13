import type { DxfEntity, DxfLwPolylineVertex, DxfPoint, DxfPolylineVertex } from '@/domain/dxf/types';
import { signedDxfArcSweepRadians } from '@/domain/dxf/arcSweep';

import { buildChains } from './chains';
import { analyzeContours } from './contours';
import { clusterSegmentEndpoints } from './endpointClusters';
import { buildPathElements } from './pathElements';
import { planOperations } from './planOperations';
import { sanitizePathSegments } from './sanitizeSegments';
import {
  createArcSegment,
  createCircleSegment,
  createLineSegment,
  distance,
  pointsEqual,
  resolvePathPlanningOptions
} from './segments';
import type {
  PathDiagnostic,
  PathPlanningDocument,
  PathPlanningOptions,
  PathPlanningSourceMetadata,
  PathSegment,
  SegmentBuildResult,
  SegmentSourceRef
} from './types';

export function createPathPlanningDocumentFromDxfEntities(
  entities: DxfEntity[],
  options: PathPlanningOptions = {},
  sourceMetadata: PathPlanningSourceMetadata = {}
): PathPlanningDocument {
  const resolved = resolvePathPlanningOptions(options);
  const segmentBuild = pathSegmentsFromDxfEntities(entities, resolved);
  const sanitized = sanitizePathSegments(segmentBuild.segments, resolved);
  const sourceDiagnostics = diagnosticsForSourceMetadata(sourceMetadata);
  const clusterResult = clusterSegmentEndpoints(sanitized.segments, resolved);
  const chainResult = buildChains(sanitized.segments, clusterResult, resolved);
  const contourResult = analyzeContours(chainResult.chains, sanitized.segments, resolved);
  const plan = planOperations({
    chains: chainResult.chains,
    contours: contourResult.contours,
    segments: sanitized.segments,
    options: resolved
  });
  const pathElementTree = buildPathElements(
    contourResult.contours,
    chainResult.chains,
    plan,
    sanitized.segments
  );

  return {
    schemaVersion: 1,
    geometryBasis: 'wire-centre',
    source: {
      kind: 'dxf-entities',
      entityCount: entities.length,
      ...sourceMetadata
    },
    options: resolved,
    segments: sanitized.segments,
    endpointClusters: clusterResult.clusters,
    chains: chainResult.chains,
    contours: contourResult.contours,
    pathElements: pathElementTree.pathElements,
    rootPathElementIds: pathElementTree.rootPathElementIds,
    plan,
    diagnostics: [
      ...sourceDiagnostics,
      ...segmentBuild.diagnostics,
      ...sanitized.diagnostics,
      ...clusterResult.diagnostics,
      ...chainResult.diagnostics,
      ...contourResult.diagnostics,
      ...plan.diagnostics
    ]
  };
}

export function pathSegmentsFromDxfEntities(
  entities: DxfEntity[],
  options: PathPlanningOptions = {}
): SegmentBuildResult {
  const resolved = resolvePathPlanningOptions(options);
  const segments: PathSegment[] = [];
  const diagnostics: PathDiagnostic[] = [];
  let nextSegmentNumber = 1;

  const nextId = () => `seg_${String(nextSegmentNumber++).padStart(4, '0')}`;
  const nextDiagnosticId = () => `diag_segment_${String(diagnostics.length + 1).padStart(4, '0')}`;

  entities.forEach((entity, sourceEntityIndex) => {
    if (!layerPassesFilter(entity.layer, resolved)) {
      diagnostics.push({
        id: nextDiagnosticId(),
        severity: 'info',
        code: 'layer-filtered',
        message: `Filtered DXF ${entity.type.toUpperCase()} at entity index ${sourceEntityIndex} from layer ${formatLayer(entity.layer)}.`,
        details: {
          sourceEntityIndex,
          layer: entity.layer,
          includeLayers: [...resolved.includeLayers],
          excludeLayers: [...resolved.excludeLayers]
        }
      });
      return;
    }

    const approximation = entity.type === 'line' ? entity.approximation : undefined;
    const baseSource: Omit<SegmentSourceRef, 'sourceSubIndex'> = {
      sourceEntityIndex,
      sourceEntityType: approximation?.sourceEntityType ?? entity.type,
      layer: entity.layer,
      exact: !approximation,
      ...(approximation ? { approximation } : {}),
      ...(entity.handle ? { sourceEntityHandle: entity.handle } : {}),
      ...(entity.source ? { dxf: entity.source } : {})
    };

    if (entity.type === 'line') {
      if (!pointsHaveFiniteCoordinates(entity.start, entity.end)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(
            nextDiagnosticId,
            sourceEntityIndex,
            baseSource.sourceEntityType
          )
        );
        return;
      }

      if (distance(entity.start, entity.end) <= resolved.coincidenceEpsilon) {
        diagnostics.push({
          id: nextDiagnosticId(),
          severity: 'warning',
          code: 'zero-length-segment',
          message: `Skipped zero-length LINE at DXF entity index ${sourceEntityIndex}.`,
          details: { sourceEntityIndex }
        });
        return;
      }

      const segment = createLineSegment({
        id: nextId(),
        source: baseSource,
        start: entity.start,
        end: entity.end
      });
      if (!pathSegmentHasFiniteGeometry(segment)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(
            nextDiagnosticId,
            sourceEntityIndex,
            baseSource.sourceEntityType
          )
        );
        return;
      }

      segments.push(segment);
      return;
    }

    if (entity.type === 'arc') {
      if (
        !pointsHaveFiniteCoordinates(entity.start, entity.end, entity.center) ||
        !numbersAreFinite(
          entity.radius,
          entity.startAngle,
          entity.endAngle,
          ...(entity.sweepRadians == null ? [] : [entity.sweepRadians])
        )
      ) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type)
        );
        return;
      }

      if (entity.radius <= resolved.coincidenceEpsilon) {
        diagnostics.push(
          invalidNativeArcDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type, entity.radius)
        );
        return;
      }

      const clockwise = Boolean(entity.clockwise);
      const sweepRadians =
        entity.sweepRadians ??
        signedDxfArcSweepRadians(entity.startAngle, entity.endAngle, clockwise);
      const hasValidSweep =
        sweepRadians != null &&
        sweepRadians !== 0 &&
        Math.abs(sweepRadians) <= 2 * Math.PI &&
        (clockwise ? sweepRadians < 0 : sweepRadians > 0);
      const hasValidEndpoints =
        !pointsEqual(entity.start, entity.end, resolved.coincidenceEpsilon) ||
        (sweepRadians != null && Math.abs(sweepRadians) === 2 * Math.PI);
      if (!hasValidSweep || !hasValidEndpoints) {
        diagnostics.push(
          invalidNativeArcDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type, entity.radius)
        );
        return;
      }

      const segment = createArcSegment({
        id: nextId(),
        source: baseSource,
        start: entity.start,
        end: entity.end,
        center: entity.center,
        radius: entity.radius,
        clockwise,
        sweepRadians
      });
      if (!pathSegmentHasFiniteGeometry(segment)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type)
        );
        return;
      }

      segments.push(segment);
      return;
    }

    if (entity.type === 'circle') {
      if (!pointsHaveFiniteCoordinates(entity.center) || !numbersAreFinite(entity.radius)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type)
        );
        return;
      }

      if (entity.radius <= resolved.coincidenceEpsilon) {
        diagnostics.push(
          invalidNativeArcDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type, entity.radius)
        );
        return;
      }

      const segment = createCircleSegment({
        id: nextId(),
        source: baseSource,
        center: entity.center,
        radius: entity.radius
      });
      if (!pathSegmentHasFiniteGeometry(segment)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(nextDiagnosticId, sourceEntityIndex, entity.type)
        );
        return;
      }

      segments.push(segment);
      return;
    }

    if (entity.type === 'lwpolyline') {
      const polylineSegments = segmentsFromPolyline(entity.vertices, entity.closed, {
        nextId,
        sourceEntityIndex,
        sourceEntityType: entity.type,
        sourceLabel: 'LWPOLYLINE',
        layer: entity.layer,
        sourceEntityHandle: entity.handle,
        source: entity.source,
        epsilon: resolved.coincidenceEpsilon,
        diagnosticBase: diagnostics.length
      });

      diagnostics.push(...polylineSegments.diagnostics);
      segments.push(...polylineSegments.segments);
    }

    if (entity.type === 'polyline') {
      const polylineSegments = segmentsFromPolyline(entity.vertices, entity.closed, {
        nextId,
        sourceEntityIndex,
        sourceEntityType: entity.type,
        sourceLabel: 'POLYLINE',
        layer: entity.layer,
        sourceEntityHandle: entity.handle,
        source: entity.source,
        epsilon: resolved.coincidenceEpsilon,
        diagnosticBase: diagnostics.length
      });

      diagnostics.push(...polylineSegments.diagnostics);
      segments.push(...polylineSegments.segments);
    }
  });

  return { segments, diagnostics };
}

function diagnosticsForSourceMetadata(
  sourceMetadata: PathPlanningSourceMetadata
): PathDiagnostic[] {
  const diagnostics: PathDiagnostic[] = (sourceMetadata.importWarnings ?? []).map(
    (message, index) => ({
      id: `diag_source_import_${String(index + 1).padStart(4, '0')}`,
      severity: 'warning',
      code: 'dxf-import-warning',
      message,
      details: { sourceWarningIndex: index }
    })
  );

  if (
    sourceMetadata.coordinateScaleToMillimeters != null &&
    sourceMetadata.units?.scaleToMillimeters == null
  ) {
    diagnostics.push({
      id: 'diag_source_units_0001',
      severity: 'warning',
      code: 'units-assumed-millimeters',
      message: sourceMetadata.units
        ? `DXF units "${sourceMetadata.units.label}" have no known millimeter scale; coordinates were retained and assumed to be millimeters.`
        : 'DXF units were not declared; coordinates were retained and assumed to be millimeters.',
      details: {
        coordinateScaleToMillimeters: sourceMetadata.coordinateScaleToMillimeters,
        sourceUnitsCode: sourceMetadata.units?.code ?? null,
        sourceUnitsLabel: sourceMetadata.units?.label ?? null
      }
    });
  }

  return diagnostics;
}

function layerPassesFilter(
  layer: string | null,
  options: ReturnType<typeof resolvePathPlanningOptions>
) {
  const included =
    options.includeLayers.length === 0 ||
    (layer != null && options.includeLayers.includes(layer));
  const excluded = layer != null && options.excludeLayers.includes(layer);
  return included && !excluded;
}

function formatLayer(layer: string | null) {
  return layer == null ? '(missing)' : `"${layer}"`;
}

interface LwPolylineBuildOptions {
  nextId: () => string;
  sourceEntityIndex: number;
  sourceEntityType: 'lwpolyline' | 'polyline';
  sourceLabel: 'LWPOLYLINE' | 'POLYLINE';
  sourceEntityHandle?: string | null;
  layer: string | null;
  source?: DxfEntity['source'];
  epsilon: number;
  diagnosticBase: number;
}

function segmentsFromPolyline(
  vertices: Array<DxfLwPolylineVertex | DxfPolylineVertex>,
  closed: boolean,
  options: LwPolylineBuildOptions
): SegmentBuildResult {
  const segments: PathSegment[] = [];
  const diagnostics: PathDiagnostic[] = [];

  const nextDiagnosticId = () =>
    `diag_segment_${String(options.diagnosticBase + diagnostics.length + 1).padStart(4, '0')}`;

  if (vertices.length < 2) {
    diagnostics.push({
      id: nextDiagnosticId(),
      severity: 'warning',
      code: 'invalid-polyline',
      message: `Skipped ${options.sourceLabel} at DXF entity index ${options.sourceEntityIndex}; it has fewer than 2 vertices.`,
      details: { sourceEntityIndex: options.sourceEntityIndex, vertexCount: vertices.length }
    });
    return { segments, diagnostics };
  }

  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let index = 0; index < segmentCount; index++) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const source: SegmentSourceRef = {
      sourceEntityIndex: options.sourceEntityIndex,
      ...(options.sourceEntityHandle ? { sourceEntityHandle: options.sourceEntityHandle } : {}),
      sourceEntityType: options.sourceEntityType,
      sourceSubIndex: index,
      layer: options.layer,
      exact: true,
      ...(options.source ? { dxf: options.source } : {})
    };

    if (
      !pointsHaveFiniteCoordinates(start, end) ||
      !numbersAreFinite(start.bulge)
    ) {
      diagnostics.push(
        nonFiniteGeometryDiagnostic(
          nextDiagnosticId,
          options.sourceEntityIndex,
          options.sourceEntityType,
          index
        )
      );
      continue;
    }

    if (distance(start, end) <= options.epsilon) {
      diagnostics.push({
        id: nextDiagnosticId(),
        severity: 'warning',
        code: 'zero-length-segment',
        message: `Skipped zero-length ${options.sourceLabel} segment ${index} at DXF entity index ${options.sourceEntityIndex}.`,
        details: { sourceEntityIndex: options.sourceEntityIndex, sourceSubIndex: index }
      });
      continue;
    }

    if (start.bulge === 0) {
      const segment = createLineSegment({
        id: options.nextId(),
        source,
        start,
        end
      });
      if (!pathSegmentHasFiniteGeometry(segment)) {
        diagnostics.push(
          nonFiniteGeometryDiagnostic(
            nextDiagnosticId,
            options.sourceEntityIndex,
            options.sourceEntityType,
            index
          )
        );
        continue;
      }

      segments.push(segment);
      continue;
    }

    const arc = arcFromBulge(start, end, start.bulge);
    if (!arc) {
      diagnostics.push(
        nonFiniteGeometryDiagnostic(
          nextDiagnosticId,
          options.sourceEntityIndex,
          options.sourceEntityType,
          index
        )
      );
      continue;
    }
    if (arc.radius <= options.epsilon) {
      diagnostics.push(invalidBulgeArcDiagnostic(options, index, start.bulge, nextDiagnosticId));
      continue;
    }

    const segment = createArcSegment({
      id: options.nextId(),
      source,
      start,
      end,
      center: arc.center,
      radius: arc.radius,
      clockwise: start.bulge < 0,
      sweepRadians: arc.sweepRadians
    });
    if (!pathSegmentHasFiniteGeometry(segment)) {
      diagnostics.push(
        nonFiniteGeometryDiagnostic(
          nextDiagnosticId,
          options.sourceEntityIndex,
          options.sourceEntityType,
          index
        )
      );
      continue;
    }

    segments.push(segment);
  }

  return { segments, diagnostics };
}

function arcFromBulge(start: DxfPoint, end: DxfPoint, bulge: number) {
  const chord = distance(start, end);
  if (!Number.isFinite(chord) || chord <= 0) return null;

  const absoluteBulge = Math.abs(bulge);
  if (!Number.isFinite(absoluteBulge) || absoluteBulge === 0) return null;
  const chordQuarter = chord / 4;
  const radius = chordQuarter * (absoluteBulge + 1 / absoluteBulge);
  const signedCenterOffset = chordQuarter * (1 / bulge - bulge);
  const sweepRadians = 4 * Math.atan(bulge);
  if (
    !Number.isFinite(radius) ||
    !Number.isFinite(signedCenterOffset) ||
    !Number.isFinite(sweepRadians) ||
    sweepRadians === 0 ||
    Math.abs(sweepRadians) > 2 * Math.PI
  ) {
    return null;
  }

  const unit = {
    x: (end.x - start.x) / chord,
    y: (end.y - start.y) / chord
  };
  if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) return null;
  const leftNormal = { x: -unit.y, y: unit.x };
  const midpoint = {
    x: start.x / 2 + end.x / 2,
    y: start.y / 2 + end.y / 2
  };
  const center = {
    x: midpoint.x + leftNormal.x * signedCenterOffset,
    y: midpoint.y + leftNormal.y * signedCenterOffset
  };
  if (
    !Number.isFinite(center.x) ||
    !Number.isFinite(center.y) ||
    !Number.isFinite(radius)
  ) {
    return null;
  }

  return { center, radius, sweepRadians };
}

function pathSegmentHasFiniteGeometry(segment: PathSegment) {
  const values = [
    segment.start.x,
    segment.start.y,
    segment.end.x,
    segment.end.y,
    segment.length,
    segment.bounds.minX,
    segment.bounds.minY,
    segment.bounds.maxX,
    segment.bounds.maxY
  ];

  if (segment.kind === 'arc') {
    values.push(
      segment.center.x,
      segment.center.y,
      segment.radius,
      segment.startAngleRadians,
      segment.endAngleRadians,
      segment.sweepRadians
    );
  }

  if (segment.kind === 'circle') {
    values.push(
      segment.center.x,
      segment.center.y,
      segment.radius,
      segment.preferredStart.x,
      segment.preferredStart.y
    );
  }

  return values.every(Number.isFinite);
}

function pointsHaveFiniteCoordinates(...points: DxfPoint[]) {
  return points.every((point) => numbersAreFinite(point.x, point.y));
}

function numbersAreFinite(...values: number[]) {
  return values.every(Number.isFinite);
}

function invalidBulgeArcDiagnostic(
  options: LwPolylineBuildOptions,
  index: number,
  bulge: number,
  nextDiagnosticId: () => string
): PathDiagnostic {
  return {
    id: nextDiagnosticId(),
    severity: 'warning',
    code: 'invalid-arc',
    message: `Skipped invalid ${options.sourceLabel} bulge arc ${index} at DXF entity index ${options.sourceEntityIndex}.`,
    details: { sourceEntityIndex: options.sourceEntityIndex, sourceSubIndex: index, bulge }
  };
}

function invalidNativeArcDiagnostic(
  nextDiagnosticId: () => string,
  sourceEntityIndex: number,
  sourceEntityType: 'arc' | 'circle',
  radius: number
): PathDiagnostic {
  return {
    id: nextDiagnosticId(),
    severity: 'warning',
    code: 'invalid-arc',
    message: `Skipped invalid ${sourceEntityType.toUpperCase()} at DXF entity index ${sourceEntityIndex}.`,
    details: { sourceEntityIndex, sourceEntityType, radius }
  };
}

function nonFiniteGeometryDiagnostic(
  nextDiagnosticId: () => string,
  sourceEntityIndex: number,
  sourceEntityType: string,
  sourceSubIndex?: number
): PathDiagnostic {
  return {
    id: nextDiagnosticId(),
    severity: 'error',
    code: 'non-finite-geometry',
    message: `Skipped ${sourceEntityType.toUpperCase()} at DXF entity index ${sourceEntityIndex}; derived path geometry is non-finite.`,
    details: {
      sourceEntityIndex,
      sourceEntityType,
      ...(sourceSubIndex == null ? {} : { sourceSubIndex })
    }
  };
}
