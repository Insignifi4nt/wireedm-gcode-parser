import type { PathPlanningOptions, PathPlanningSourceMetadata } from '@/domain/path-intel/types';

import type {
  DxfDrawingMetadata,
  DxfEntity,
  DxfEntitySource,
  DxfPoint
} from './types';

export interface NormalizeDxfGeometryInput {
  entities: DxfEntity[];
  options: PathPlanningOptions;
  sourceMetadata: PathPlanningSourceMetadata;
}

export interface NormalizeDxfGeometryResult {
  coordinateScaleToMillimeters: number;
  entities: DxfEntity[];
  options: PathPlanningOptions;
  sourceMetadata: PathPlanningSourceMetadata;
}

export function normalizeDxfGeometry(
  input: NormalizeDxfGeometryInput
): NormalizeDxfGeometryResult {
  const coordinateScaleToMillimeters = knownUnitScale(input.sourceMetadata) ?? 1;
  const drawing = input.sourceMetadata.drawing
    ? scaleDrawing(input.sourceMetadata.drawing, coordinateScaleToMillimeters)
    : undefined;

  return {
    coordinateScaleToMillimeters,
    entities: input.entities.map((entity) =>
      scaleEntity(entity, coordinateScaleToMillimeters)
    ),
    options: scaleOptions(input.options, coordinateScaleToMillimeters),
    sourceMetadata: {
      ...input.sourceMetadata,
      coordinateScaleToMillimeters,
      ...(drawing ? { drawing } : {})
    }
  };
}

function knownUnitScale(sourceMetadata: PathPlanningSourceMetadata) {
  const scale = sourceMetadata.units?.scaleToMillimeters;
  return scale != null && Number.isFinite(scale) && scale > 0 ? scale : null;
}

function scaleEntity(entity: DxfEntity, scale: number): DxfEntity {
  const source = entity.source ? scaleEntitySource(entity.source, scale) : undefined;

  if (entity.type === 'line') {
    return {
      ...entity,
      ...(source ? { source } : {}),
      ...(entity.approximation
        ? {
            approximation: {
              ...entity.approximation,
              maxChordError: scaleNumber(entity.approximation.maxChordError, scale)
            }
          }
        : {}),
      start: scalePoint(entity.start, scale),
      end: scalePoint(entity.end, scale)
    };
  }

  if (entity.type === 'arc') {
    return {
      ...entity,
      ...(source ? { source } : {}),
      center: scalePoint(entity.center, scale),
      radius: scaleNumber(entity.radius, scale),
      start: scalePoint(entity.start, scale),
      end: scalePoint(entity.end, scale)
    };
  }

  if (entity.type === 'circle') {
    return {
      ...entity,
      ...(source ? { source } : {}),
      center: scalePoint(entity.center, scale),
      radius: scaleNumber(entity.radius, scale)
    };
  }

  return {
    ...entity,
    ...(source ? { source } : {}),
    vertices: entity.vertices.map((vertex) => ({
      ...vertex,
      ...scalePoint(vertex, scale)
    }))
  };
}

function scaleEntitySource(source: DxfEntitySource, scale: number): DxfEntitySource {
  return {
    ...source,
    insertChain: source.insertChain.map((insert) => ({
      ...insert,
      transform: {
        ...insert.transform,
        insertion: scalePoint(insert.transform.insertion, scale),
        ...(insert.transform.localOffset
          ? { localOffset: scalePoint(insert.transform.localOffset, scale) }
          : {}),
        ...(insert.transform.blockBasePoint
          ? { blockBasePoint: scalePoint(insert.transform.blockBasePoint, scale) }
          : {})
      }
    }))
  };
}

function scaleDrawing(drawing: DxfDrawingMetadata, scale: number): DxfDrawingMetadata {
  return {
    ...(drawing.basePoint ? { basePoint: scalePoint(drawing.basePoint, scale) } : {}),
    ...(drawing.extents
      ? {
          extents: {
            min: scalePoint(drawing.extents.min, scale),
            max: scalePoint(drawing.extents.max, scale)
          }
        }
      : {})
  };
}

function scaleOptions(options: PathPlanningOptions, scale: number): PathPlanningOptions {
  return {
    ...options,
    ...(options.endpointTolerance != null
      ? { endpointTolerance: scaleNumber(options.endpointTolerance, scale) }
      : {}),
    ...(options.coincidenceEpsilon != null
      ? { coincidenceEpsilon: scaleNumber(options.coincidenceEpsilon, scale) }
      : {}),
    ...(options.startPoint ? { startPoint: scalePoint(options.startPoint, scale) } : {}),
    ...(options.includeLayers ? { includeLayers: [...options.includeLayers] } : {}),
    ...(options.excludeLayers ? { excludeLayers: [...options.excludeLayers] } : {})
  };
}

function scalePoint(point: DxfPoint, scale: number): DxfPoint {
  return {
    x: scaleNumber(point.x, scale),
    y: scaleNumber(point.y, scale)
  };
}

function scaleNumber(value: number, scale: number) {
  if (!Number.isFinite(value)) {
    throw new Error('DXF unit normalization received a non-finite coordinate.');
  }
  if (scale === 1) return Object.is(value, -0) ? 0 : value;

  const scaled = value * scale;
  if (!Number.isFinite(scaled)) {
    throw new Error('DXF unit normalization produced a non-finite coordinate.');
  }
  if (Object.is(scaled, -0)) return 0;
  return scaled;
}
