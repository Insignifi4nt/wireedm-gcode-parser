import type { DxfEntity, DxfLwPolylineVertex, DxfPoint, DxfPolylineVertex } from '@/domain/dxf/types';

import { buildChains } from './chains';
import { analyzeContours } from './contours';
import { clusterSegmentEndpoints } from './endpointClusters';
import { buildPathElements } from './pathElements';
import { planOperations } from './planOperations';
import {
  createArcSegment,
  createCircleSegment,
  createLineSegment,
  distance,
  normalizeVector,
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
  const sourceDiagnostics = diagnosticsForSourceMetadata(sourceMetadata);
  const clusterResult = clusterSegmentEndpoints(segmentBuild.segments, resolved);
  const chainResult = buildChains(segmentBuild.segments, clusterResult, resolved);
  const contourResult = analyzeContours(chainResult.chains, segmentBuild.segments, resolved);
  const plan = planOperations({
    chains: chainResult.chains,
    contours: contourResult.contours,
    segments: segmentBuild.segments,
    options: resolved
  });
  const pathElementTree = buildPathElements(
    contourResult.contours,
    chainResult.chains,
    plan,
    segmentBuild.segments
  );

  return {
    schemaVersion: 1,
    source: {
      kind: 'dxf-entities',
      entityCount: entities.length,
      ...sourceMetadata
    },
    options: resolved,
    segments: segmentBuild.segments,
    endpointClusters: clusterResult.clusters,
    chains: chainResult.chains,
    contours: contourResult.contours,
    pathElements: pathElementTree.pathElements,
    rootPathElementIds: pathElementTree.rootPathElementIds,
    plan,
    diagnostics: [
      ...sourceDiagnostics,
      ...segmentBuild.diagnostics,
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

      segments.push(
        createLineSegment({
          id: nextId(),
          source: baseSource,
          start: entity.start,
          end: entity.end
        })
      );
      return;
    }

    if (entity.type === 'arc') {
      if (entity.radius <= resolved.coincidenceEpsilon || pointsEqual(entity.start, entity.end, resolved.coincidenceEpsilon)) {
        diagnostics.push({
          id: nextDiagnosticId(),
          severity: 'warning',
          code: 'invalid-arc',
          message: `Skipped invalid ARC at DXF entity index ${sourceEntityIndex}.`,
          details: { sourceEntityIndex, radius: entity.radius }
        });
        return;
      }

      segments.push(
        createArcSegment({
          id: nextId(),
          source: baseSource,
          start: entity.start,
          end: entity.end,
          center: entity.center,
          radius: entity.radius,
          clockwise: Boolean(entity.clockwise)
        })
      );
      return;
    }

    if (entity.type === 'circle') {
      if (entity.radius <= resolved.coincidenceEpsilon) {
        diagnostics.push({
          id: nextDiagnosticId(),
          severity: 'warning',
          code: 'invalid-arc',
          message: `Skipped invalid CIRCLE at DXF entity index ${sourceEntityIndex}.`,
          details: { sourceEntityIndex, radius: entity.radius }
        });
        return;
      }

      segments.push(
        createCircleSegment({
          id: nextId(),
          source: baseSource,
          center: entity.center,
          radius: entity.radius
        })
      );
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
  if (
    sourceMetadata.coordinateScaleToMillimeters == null ||
    sourceMetadata.units?.scaleToMillimeters != null
  ) {
    return [];
  }

  return [
    {
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
    }
  ];
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

    if (Math.abs(start.bulge) <= options.epsilon) {
      segments.push(
        createLineSegment({
          id: options.nextId(),
          source,
          start,
          end
        })
      );
      continue;
    }

    const arc = arcFromBulge(start, end, start.bulge);
    if (!arc || arc.radius <= options.epsilon) {
      diagnostics.push({
        id: nextDiagnosticId(),
        severity: 'warning',
        code: 'invalid-arc',
        message: `Skipped invalid ${options.sourceLabel} bulge arc ${index} at DXF entity index ${options.sourceEntityIndex}.`,
        details: { sourceEntityIndex: options.sourceEntityIndex, sourceSubIndex: index, bulge: start.bulge }
      });
      continue;
    }

    segments.push(
      createArcSegment({
        id: options.nextId(),
        source,
        start,
        end,
        center: arc.center,
        radius: arc.radius,
        clockwise: start.bulge < 0
      })
    );
  }

  return { segments, diagnostics };
}

function arcFromBulge(start: DxfPoint, end: DxfPoint, bulge: number) {
  const chord = distance(start, end);
  if (chord <= 0) return null;

  const includedAngle = 4 * Math.atan(Math.abs(bulge));
  const tanHalf = Math.tan(includedAngle / 2);
  if (Math.abs(tanHalf) <= Number.EPSILON) return null;

  const apothem = chord / (2 * tanHalf);
  const unit = normalizeVector({ x: end.x - start.x, y: end.y - start.y });
  const leftNormal = { x: -unit.y, y: unit.x };
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const sign = Math.sign(bulge);
  const center = {
    x: midpoint.x + sign * leftNormal.x * apothem,
    y: midpoint.y + sign * leftNormal.y * apothem
  };
  const radius = chord / (2 * Math.sin(includedAngle / 2));

  return { center, radius };
}
