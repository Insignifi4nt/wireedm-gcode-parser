import { parseString as parseDxfString, toPolylines } from 'dxf';

import type {
  DxfArcEntity,
  DxfCircleEntity,
  DxfEntity,
  DxfLineEntity,
  DxfLwPolylineEntity,
  DxfLwPolylineVertex,
  DxfParseResult,
  DxfPoint
} from './types';

interface DxfPair {
  code: number;
  value: string;
}

export function parseDxf(text: string): DxfParseResult {
  const pairs = toPairs(text);
  const entityPairs = getEntitiesSectionPairs(pairs);
  const entities: DxfEntity[] = [];
  const unsupportedEntities = new Set<string>();

  for (let index = 0; index < entityPairs.length; index++) {
    const pair = entityPairs[index];
    if (pair.code !== 0) continue;

    const entityType = pair.value.toUpperCase();
    if (entityType === 'ENDSEC') break;

    const nextIndex =
      entityType === 'POLYLINE'
        ? findClassicPolylineEnd(entityPairs, index + 1)
        : findNextEntityStart(entityPairs, index + 1);
    const pairsForEntity = entityPairs.slice(index + 1, nextIndex);
    const entity = parseEntity(entityType, pairsForEntity);

    if (entity) {
      entities.push(entity);
    } else if (!['EOF', 'ENDSEC'].includes(entityType)) {
      unsupportedEntities.add(entityType);
    }

    index = nextIndex - 1;
  }

  const unsupported = [...unsupportedEntities].sort();
  if (unsupported.length > 0) {
    const fallbackResult = flattenUnsupportedCurves(text, unsupported);
    if (fallbackResult.entities.length > 0) {
      return {
        entities: [...entities, ...fallbackResult.entities],
        unsupportedEntities: unsupported,
        warnings: [
          ...unsupported.map((entity) => `Unsupported DXF entity: ${entity}`),
          ...fallbackResult.warnings
        ]
      };
    }
  }

  return {
    entities,
    unsupportedEntities: unsupported,
    warnings: unsupported.map((entity) => `Unsupported DXF entity: ${entity}`)
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

function getEntitiesSectionPairs(pairs: DxfPair[]) {
  for (let index = 0; index < pairs.length - 1; index++) {
    if (
      pairs[index].code === 0 &&
      pairs[index].value.toUpperCase() === 'SECTION' &&
      pairs[index + 1]?.code === 2 &&
      pairs[index + 1]?.value.toUpperCase() === 'ENTITIES'
    ) {
      return pairs.slice(index + 2);
    }
  }

  return [];
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

function stringValue(pairs: DxfPair[], code: number) {
  return pairs.find((candidate) => candidate.code === code)?.value ?? null;
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
