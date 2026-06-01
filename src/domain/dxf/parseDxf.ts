import { parseString as parseDxfString, toPolylines } from 'dxf';

import type {
  DxfArcEntity,
  DxfCircleEntity,
  DxfEntity,
  DxfEntitySource,
  DxfInsertSource,
  DxfLineEntity,
  DxfLwPolylineEntity,
  DxfLwPolylineVertex,
  DxfParseResult,
  DxfPoint,
  DxfPolylineEntity,
  DxfPolylineVertex
} from './types';

interface DxfPair {
  code: number;
  value: string;
}

interface EntityParseResult {
  entities: DxfEntity[];
  unsupportedEntities: Set<string>;
  warnings: string[];
}

interface DxfInsertEntity {
  type: 'insert';
  layer: string | null;
  blockName: string;
  insertion: DxfPoint;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
  columnCount: number;
  rowCount: number;
  columnSpacing: number;
  rowSpacing: number;
}

interface RawBlockDefinition {
  name: string;
  pairs: DxfPair[];
}

interface BlockDefinitionsResult {
  resolveBlock: (blockName: string) => EntityParseResult | null;
}

interface EntityParseContext {
  blockName: string | null;
  insertChain: DxfInsertSource[];
  resolveBlock?: (blockName: string) => EntityParseResult | null;
  contextLabel: string;
}

interface InsertTransform {
  insertion: DxfPoint;
  scaleX: number;
  scaleY: number;
  rotationRadians: number;
  rotationDegrees: number;
  determinant: number;
  uniformScale: number | null;
  insertLayer: string | null;
  localOffset: DxfPoint;
  source: DxfInsertSource;
}

type TransformEntityResult =
  | { entity: DxfEntity; warning?: never }
  | { entity: null; warning: string };

export function parseDxf(text: string): DxfParseResult {
  const pairs = toPairs(text);
  const blockResult = parseBlockDefinitions(pairs);
  const entityPairs = getSectionPairs(pairs, 'ENTITIES');
  const entityResult = parseEntitiesFromPairs(entityPairs, {
    blockName: null,
    contextLabel: 'ENTITIES',
    insertChain: [],
    resolveBlock: blockResult.resolveBlock
  });
  const unsupportedEntities = new Set(entityResult.unsupportedEntities);

  const unsupported = [...unsupportedEntities].sort();
  if (unsupported.length > 0) {
    const fallbackResult = flattenUnsupportedCurves(text, unsupported);
    if (fallbackResult.entities.length > 0) {
      return {
        entities: [...entityResult.entities, ...fallbackResult.entities],
        unsupportedEntities: unsupported,
        warnings: [
          ...unsupported.map((entity) => `Unsupported DXF entity: ${entity}`),
          ...entityResult.warnings,
          ...fallbackResult.warnings
        ]
      };
    }
  }

  return {
    entities: entityResult.entities,
    unsupportedEntities: unsupported,
    warnings: [
      ...unsupported.map((entity) => `Unsupported DXF entity: ${entity}`),
      ...entityResult.warnings
    ]
  };
}

function toPairs(text: string): DxfPair[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const pairs: DxfPair[] = [];

  for (let index = 0; index < lines.length - 1; index += 2) {
    const code = Number.parseInt(lines[index], 10);
    if (Number.isNaN(code)) continue;
    pairs.push({ code, value: lines[index + 1] });
  }

  return pairs;
}

function getSectionPairs(pairs: DxfPair[], sectionName: string) {
  for (let index = 0; index < pairs.length - 1; index++) {
    if (
      pairs[index].code === 0 &&
      pairs[index].value.toUpperCase() === 'SECTION' &&
      pairs[index + 1]?.code === 2 &&
      pairs[index + 1]?.value.toUpperCase() === sectionName
    ) {
      return pairs.slice(index + 2);
    }
  }

  return [];
}

function parseBlockDefinitions(pairs: DxfPair[]): BlockDefinitionsResult {
  const blockPairs = getSectionPairs(pairs, 'BLOCKS');
  const rawBlocks = extractRawBlockDefinitions(blockPairs);
  const resolvedBlocks = new Map<string, EntityParseResult>();
  const resolving = new Set<string>();

  const resolveBlock = (blockName: string): EntityParseResult | null => {
    const normalizedName = normalizeBlockName(blockName);
    const cached = resolvedBlocks.get(normalizedName);
    if (cached) return cached;

    const rawBlock = rawBlocks.get(normalizedName);
    if (!rawBlock) return null;

    if (resolving.has(normalizedName)) {
      return {
        entities: [],
        unsupportedEntities: new Set(['INSERT']),
        warnings: [`Skipped circular INSERT reference for BLOCK "${rawBlock.name}".`]
      };
    }

    resolving.add(normalizedName);
    const result = parseEntitiesFromPairs(rawBlock.pairs, {
      blockName: rawBlock.name,
      contextLabel: `BLOCK "${rawBlock.name}"`,
      insertChain: [],
      resolveBlock
    });
    resolving.delete(normalizedName);
    resolvedBlocks.set(normalizedName, result);
    return result;
  };

  return { resolveBlock };
}

function extractRawBlockDefinitions(blockPairs: DxfPair[]) {
  const blocks = new Map<string, RawBlockDefinition>();

  for (let index = 0; index < blockPairs.length; index++) {
    const pair = blockPairs[index];
    if (pair.code !== 0) continue;

    const entityType = pair.value.toUpperCase();
    if (entityType === 'ENDSEC') break;
    if (entityType !== 'BLOCK') continue;

    const endIndex = findBlockEnd(blockPairs, index + 1);
    const pairsForBlock = blockPairs.slice(index + 1, endIndex);
    const blockName = stringValue(pairsForBlock, 2);

    if (blockName) {
      blocks.set(normalizeBlockName(blockName), {
        name: blockName,
        pairs: pairsForBlock
      });
    }

    index = endIndex;
  }

  return blocks;
}

function findBlockEnd(pairs: DxfPair[], startIndex: number) {
  for (let index = startIndex; index < pairs.length; index++) {
    if (pairs[index].code === 0 && pairs[index].value.toUpperCase() === 'ENDBLK') {
      return index;
    }
  }

  return findNextEntityStart(pairs, startIndex);
}

function parseEntitiesFromPairs(entityPairs: DxfPair[], context: EntityParseContext): EntityParseResult {
  const entities: DxfEntity[] = [];
  const unsupportedEntities = new Set<string>();
  const warnings: string[] = [];

  for (let index = 0; index < entityPairs.length; index++) {
    const pair = entityPairs[index];
    if (pair.code !== 0) continue;

    const entityType = pair.value.toUpperCase();
    if (['ENDSEC', 'ENDBLK'].includes(entityType)) break;

    const nextIndex =
      entityType === 'POLYLINE'
        ? findClassicPolylineEnd(entityPairs, index + 1)
        : findNextEntityStart(entityPairs, index + 1);
    const pairsForEntity = entityPairs.slice(index + 1, nextIndex);

    if (entityType === 'INSERT') {
      const insert = parseInsert(pairsForEntity);
      if (!insert || !context.resolveBlock) {
        unsupportedEntities.add(entityType);
        index = nextIndex - 1;
        continue;
      }

      const expanded = expandInsert(insert, context);
      entities.push(...expanded.entities);
      expanded.unsupportedEntities.forEach((entity) => unsupportedEntities.add(entity));
      warnings.push(...expanded.warnings);
      index = nextIndex - 1;
      continue;
    }

    const entity = parseEntity(entityType, pairsForEntity);

    if (entity) {
      entities.push(withEntitySource(entity, context));
    } else if (!['EOF', 'ENDSEC'].includes(entityType)) {
      unsupportedEntities.add(entityType);
    }

    index = nextIndex - 1;
  }

  return { entities, unsupportedEntities, warnings };
}

function findNextEntityStart(pairs: DxfPair[], startIndex: number) {
  for (let index = startIndex; index < pairs.length; index++) {
    if (pairs[index].code === 0) return index;
  }

  return pairs.length;
}

function findClassicPolylineEnd(pairs: DxfPair[], startIndex: number) {
  for (let index = startIndex; index < pairs.length; index++) {
    if (pairs[index].code === 0 && pairs[index].value.toUpperCase() === 'SEQEND') {
      return findNextEntityStart(pairs, index + 1);
    }
  }

  return findNextEntityStart(pairs, startIndex);
}

function parseEntity(entityType: string, pairs: DxfPair[]): DxfEntity | null {
  if (entityType === 'LINE') return parseLine(pairs);
  if (entityType === 'ARC') return parseArc(pairs);
  if (entityType === 'CIRCLE') return parseCircle(pairs);
  if (entityType === 'LWPOLYLINE') return parseLwPolyline(pairs);
  if (entityType === 'POLYLINE') return parseClassicPolyline(pairs);
  return null;
}

function parseLine(pairs: DxfPair[]): DxfLineEntity | null {
  const layer = stringValue(pairs, 8);
  const start = pointFromCodes(pairs, 10, 20);
  const end = pointFromCodes(pairs, 11, 21);

  if (!start || !end) return null;

  return {
    type: 'line',
    layer,
    start,
    end
  };
}

function parseArc(pairs: DxfPair[]): DxfArcEntity | null {
  const layer = stringValue(pairs, 8);
  const center = pointFromCodes(pairs, 10, 20);
  const radius = numberValue(pairs, 40);
  const startAngle = numberValue(pairs, 50);
  const endAngle = numberValue(pairs, 51);

  if (!center || radius == null || startAngle == null || endAngle == null) return null;

  return {
    type: 'arc',
    layer,
    center,
    radius,
    startAngle,
    endAngle,
    clockwise: false,
    start: pointOnCircle(center, radius, startAngle),
    end: pointOnCircle(center, radius, endAngle)
  };
}

function parseCircle(pairs: DxfPair[]): DxfCircleEntity | null {
  const layer = stringValue(pairs, 8);
  const center = pointFromCodes(pairs, 10, 20);
  const radius = numberValue(pairs, 40);

  if (!center || radius == null) return null;

  return {
    type: 'circle',
    layer,
    center,
    radius
  };
}

function parseLwPolyline(pairs: DxfPair[]): DxfLwPolylineEntity | null {
  const layer = stringValue(pairs, 8);
  const flags = numberValue(pairs, 70) ?? 0;
  const vertices: DxfLwPolylineVertex[] = [];
  let current: Partial<DxfLwPolylineVertex> | null = null;

  for (const pair of pairs) {
    if (pair.code === 10) {
      if (current?.x != null && current?.y != null) {
        vertices.push({ x: current.x, y: current.y, bulge: current.bulge ?? 0 });
      }
      current = { x: Number.parseFloat(pair.value), bulge: 0 };
    } else if (pair.code === 20 && current) {
      current.y = Number.parseFloat(pair.value);
    } else if (pair.code === 42 && current) {
      current.bulge = Number.parseFloat(pair.value);
    }
  }

  if (current?.x != null && current?.y != null) {
    vertices.push({ x: current.x, y: current.y, bulge: current.bulge ?? 0 });
  }

  if (vertices.length === 0) return null;

  return {
    type: 'lwpolyline',
    layer,
    closed: (flags & 1) === 1,
    vertices
  };
}

function parseClassicPolyline(pairs: DxfPair[]): DxfPolylineEntity | null {
  const firstVertexIndex = pairs.findIndex(
    (pair) => pair.code === 0 && pair.value.toUpperCase() === 'VERTEX'
  );
  const headerPairs = firstVertexIndex >= 0 ? pairs.slice(0, firstVertexIndex) : pairs;
  const layer = stringValue(headerPairs, 8);
  const flags = numberValue(headerPairs, 70) ?? 0;
  const vertices: DxfPolylineVertex[] = [];

  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index];
    if (pair.code !== 0) continue;

    const entityType = pair.value.toUpperCase();
    if (entityType === 'SEQEND') break;
    if (entityType !== 'VERTEX') continue;

    const nextIndex = findNextEntityStart(pairs, index + 1);
    const vertexPairs = pairs.slice(index + 1, nextIndex);
    const vertex = classicPolylineVertex(vertexPairs);
    if (vertex) vertices.push(vertex);
    index = nextIndex - 1;
  }

  if (vertices.length === 0) return null;

  return {
    type: 'polyline',
    layer,
    closed: (flags & 1) === 1,
    vertices
  };
}

function classicPolylineVertex(pairs: DxfPair[]): DxfPolylineVertex | null {
  const point = pointFromCodes(pairs, 10, 20);
  if (!point) return null;

  return {
    ...point,
    bulge: numberValue(pairs, 42) ?? 0
  };
}

function parseInsert(pairs: DxfPair[]): DxfInsertEntity | null {
  const blockName = stringValue(pairs, 2);
  if (!blockName) return null;

  return {
    type: 'insert',
    layer: stringValue(pairs, 8),
    blockName,
    insertion: {
      x: numberValue(pairs, 10) ?? 0,
      y: numberValue(pairs, 20) ?? 0
    },
    scaleX: numberValue(pairs, 41) ?? 1,
    scaleY: numberValue(pairs, 42) ?? 1,
    rotationDegrees: numberValue(pairs, 50) ?? 0,
    columnCount: positiveIntegerValue(pairs, 70) ?? 1,
    rowCount: positiveIntegerValue(pairs, 71) ?? 1,
    columnSpacing: numberValue(pairs, 44) ?? 0,
    rowSpacing: numberValue(pairs, 45) ?? 0
  };
}

function expandInsert(insert: DxfInsertEntity, context: EntityParseContext): EntityParseResult {
  const resolvedBlock = context.resolveBlock?.(insert.blockName);
  if (!resolvedBlock) {
    return {
      entities: [],
      unsupportedEntities: new Set(['INSERT']),
      warnings: [`Skipped INSERT in ${context.contextLabel}; BLOCK "${insert.blockName}" was not found.`]
    };
  }

  const entities: DxfEntity[] = [];
  const unsupportedEntities = new Set(resolvedBlock.unsupportedEntities);
  const warnings = [...resolvedBlock.warnings];

  for (let row = 0; row < insert.rowCount; row++) {
    for (let column = 0; column < insert.columnCount; column++) {
      const transform = createInsertTransform(
        insert,
        {
          x: column * insert.columnSpacing,
          y: row * insert.rowSpacing
        },
        row,
        column
      );

      for (const entity of resolvedBlock.entities) {
        const transformed = transformEntity(entity, transform);
        if (transformed.entity) {
          entities.push(transformed.entity);
        } else {
          warnings.push(transformed.warning);
        }
      }
    }
  }

  return { entities, unsupportedEntities, warnings };
}

function createInsertTransform(
  insert: DxfInsertEntity,
  localOffset: DxfPoint,
  row: number,
  column: number
): InsertTransform {
  const rotationRadians = (insert.rotationDegrees * Math.PI) / 180;
  const determinant = insert.scaleX * insert.scaleY;
  const uniformScale =
    Math.abs(Math.abs(insert.scaleX) - Math.abs(insert.scaleY)) <= 1e-9
      ? Math.abs(insert.scaleX)
      : null;
  const source: DxfInsertSource = {
    blockName: insert.blockName,
    column,
    row,
    layer: insert.layer,
    transform: {
      insertion: insert.insertion,
      localOffset,
      rotationDegrees: insert.rotationDegrees,
      scaleX: insert.scaleX,
      scaleY: insert.scaleY
    }
  };

  return {
    insertion: insert.insertion,
    scaleX: insert.scaleX,
    scaleY: insert.scaleY,
    rotationRadians,
    rotationDegrees: insert.rotationDegrees,
    determinant,
    uniformScale,
    insertLayer: insert.layer,
    localOffset,
    source
  };
}

function transformEntity(entity: DxfEntity, transform: InsertTransform): TransformEntityResult {
  if (entity.type === 'line') {
    return {
      entity: withInsertedSource(
        {
          ...entity,
          layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
          start: transformPoint(entity.start, transform),
          end: transformPoint(entity.end, transform)
        },
        transform.source
      )
    };
  }

  if (entity.type === 'circle') {
    if (transform.uniformScale == null) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn it into an ellipse');
    }

    return {
      entity: withInsertedSource(
        {
          ...entity,
          layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
          center: transformPoint(entity.center, transform),
          radius: entity.radius * transform.uniformScale
        },
        transform.source
      )
    };
  }

  if (entity.type === 'arc') {
    if (transform.uniformScale == null) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn it into an elliptical arc');
    }

    const center = transformPoint(entity.center, transform);
    const start = transformPoint(entity.start, transform);
    const end = transformPoint(entity.end, transform);
    const startAngle = angleDegrees(center, start);
    const endAngle = angleDegrees(center, end);

    return {
      entity: withInsertedSource(
        {
          ...entity,
          layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
          center,
          radius: entity.radius * transform.uniformScale,
          start,
          end,
          startAngle,
          endAngle,
          clockwise: transform.determinant < 0 ? !entity.clockwise : entity.clockwise
        },
        transform.source
      )
    };
  }

  if (entity.type === 'lwpolyline') {
    if (
      transform.uniformScale == null &&
      entity.vertices.some((vertex) => Math.abs(vertex.bulge) > 1e-12)
    ) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn a bulge arc into an ellipse');
    }

    const bulgeSign = transform.determinant < 0 ? -1 : 1;
    return {
      entity: withInsertedSource(
        {
          ...entity,
          layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
          vertices: entity.vertices.map((vertex) => ({
            ...transformPoint(vertex, transform),
            bulge: vertex.bulge * bulgeSign
          }))
        },
        transform.source
      )
    };
  }

  if (entity.type === 'polyline') {
    if (
      transform.uniformScale == null &&
      entity.vertices.some((vertex) => Math.abs(vertex.bulge) > 1e-12)
    ) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn a bulge arc into an ellipse');
    }

    const bulgeSign = transform.determinant < 0 ? -1 : 1;
    return {
      entity: withInsertedSource(
        {
          ...entity,
          layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
          vertices: entity.vertices.map((vertex) => ({
            ...transformPoint(vertex, transform),
            bulge: vertex.bulge * bulgeSign
          }))
        },
        transform.source
      )
    };
  }

  const exhaustiveEntity: never = entity;
  return skippedTransformedEntity(String(exhaustiveEntity), 'unsupported block geometry');
}

function skippedTransformedEntity(entityType: string, reason: string): TransformEntityResult {
  return {
    entity: null,
    warning: `Skipped ${entityType.toUpperCase()} from INSERT expansion because ${reason}.`
  };
}

function withEntitySource<T extends DxfEntity>(entity: T, context: EntityParseContext): T {
  if (!context.blockName && context.insertChain.length === 0) return entity;

  return {
    ...entity,
    source: {
      blockName: context.blockName,
      insertChain: [...context.insertChain]
    }
  };
}

function withInsertedSource<T extends DxfEntity>(entity: T, insertSource: DxfInsertSource): T {
  const source: DxfEntitySource = {
    blockName: entity.source?.blockName ?? null,
    insertChain: [insertSource, ...(entity.source?.insertChain ?? [])]
  };

  return {
    ...entity,
    source
  };
}

function transformPoint(point: DxfPoint, transform: InsertTransform) {
  const localX = point.x + transform.localOffset.x;
  const localY = point.y + transform.localOffset.y;
  const scaledX = localX * transform.scaleX;
  const scaledY = localY * transform.scaleY;
  const cos = Math.cos(transform.rotationRadians);
  const sin = Math.sin(transform.rotationRadians);

  return {
    x: round(transform.insertion.x + scaledX * cos - scaledY * sin),
    y: round(transform.insertion.y + scaledX * sin + scaledY * cos)
  };
}

function inheritedBlockLayer(entityLayer: string | null, insertLayer: string | null) {
  return entityLayer === '0' && insertLayer ? insertLayer : entityLayer;
}

function pointFromCodes(pairs: DxfPair[], xCode: number, yCode: number): DxfPoint | null {
  const x = numberValue(pairs, xCode);
  const y = numberValue(pairs, yCode);
  if (x == null || y == null) return null;
  return { x, y };
}

function numberValue(pairs: DxfPair[], code: number) {
  const pair = pairs.find((candidate) => candidate.code === code);
  if (!pair) return null;
  const value = Number.parseFloat(pair.value);
  return Number.isFinite(value) ? value : null;
}

function positiveIntegerValue(pairs: DxfPair[], code: number) {
  const value = numberValue(pairs, code);
  if (value == null || value < 1) return null;
  return Math.floor(value);
}

function stringValue(pairs: DxfPair[], code: number) {
  return pairs.find((candidate) => candidate.code === code)?.value ?? null;
}

function normalizeBlockName(blockName: string) {
  return blockName.toUpperCase();
}

function pointOnCircle(center: DxfPoint, radius: number, angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  return {
    x: round(center.x + radius * Math.cos(angle)),
    y: round(center.y + radius * Math.sin(angle))
  };
}

function round(value: number) {
  return Number(value.toFixed(12));
}

function angleDegrees(center: DxfPoint, point: DxfPoint) {
  return round((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);
}

interface LibraryDxfEntity {
  type?: string;
}

interface LibraryDxfDocument {
  entities?: LibraryDxfEntity[];
}

interface LibraryPolyline {
  vertices?: Array<[number, number] | { x: number; y: number }>;
}

function flattenUnsupportedCurves(text: string, unsupported: string[]) {
  try {
    const parsed = parseDxfString(text) as LibraryDxfDocument;
    const entities: DxfLineEntity[] = [];
    const flattenedTypes = new Set<string>();

    for (const entity of parsed.entities ?? []) {
      const entityType = entity.type?.toUpperCase();
      if (!entityType || !unsupported.includes(entityType)) continue;

      const flattened = toPolylines({ ...parsed, entities: [entity] }) as {
        polylines?: LibraryPolyline[];
      };
      let flattenedLineCount = 0;

      for (const polyline of flattened.polylines ?? []) {
        const points = (polyline.vertices ?? [])
          .map(pointFromLibraryVertex)
          .filter((point): point is DxfPoint => point !== null);

        for (let index = 0; index < points.length - 1; index++) {
          const start = points[index];
          const end = points[index + 1];
          if (pointsEqual(start, end)) continue;
          entities.push({
            type: 'line',
            layer: null,
            start,
            end
          });
          flattenedLineCount += 1;
        }
      }

      if (flattenedLineCount > 0) {
        flattenedTypes.add(entityType);
      }
    }

    return {
      entities,
      warnings: [...flattenedTypes]
        .sort()
        .map((entity) => `Flattened DXF ${entity} geometry into line segments.`)
    };
  } catch (error) {
    return {
      entities: [],
      warnings: [error instanceof Error ? error.message : 'Could not flatten unsupported DXF geometry.']
    };
  }
}

function pointFromLibraryVertex(vertex: [number, number] | { x: number; y: number }) {
  if (Array.isArray(vertex)) {
    const [x, y] = vertex;
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  return Number.isFinite(vertex.x) && Number.isFinite(vertex.y)
    ? { x: vertex.x, y: vertex.y }
    : null;
}

function pointsEqual(a: DxfPoint, b: DxfPoint) {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}
