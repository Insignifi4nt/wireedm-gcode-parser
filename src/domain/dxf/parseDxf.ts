import type {
  DxfArcEntity,
  DxfCircleEntity,
  DxfDrawingMetadata,
  DxfDrawingUnits,
  DxfEntity,
  DxfEntitySource,
  DxfInsertSource,
  DxfLineEntity,
  DxfLwPolylineEntity,
  DxfLwPolylineVertex,
  DxfParseOptions,
  DxfParseResult,
  DxfPoint,
  DxfPolylineEntity,
  DxfPolylineVertex
} from './types';
import { approximateSpline } from './approximateSpline';
import { signedDxfArcSweepRadians } from './arcSweep';

interface DxfPair {
  code: number;
  value: string;
}

interface DxfPoint3 extends DxfPoint {
  z: number;
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
  basePoint: DxfPoint;
  basePointValid: boolean;
  name: string;
  pairs: DxfPair[];
}

interface ResolvedBlockDefinition extends EntityParseResult {
  basePoint: DxfPoint;
}

interface BlockDefinitionsResult {
  resolveBlock: (blockName: string) => ResolvedBlockDefinition | null;
}

interface EntityParseContext {
  blockName: string | null;
  insertChain: DxfInsertSource[];
  curveChordError: number;
  resolveBlock?: (blockName: string) => ResolvedBlockDefinition | null;
  contextLabel: string;
}

interface InsertTransform {
  insertion: DxfPoint;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
  determinant: number;
  uniformScale: number | null;
  insertLayer: string | null;
  localOffset: DxfPoint;
  blockBasePoint: DxfPoint;
  source: DxfInsertSource;
}

type TransformEntityResult =
  | { entity: DxfEntity; warning?: never }
  | { entity: null; warning: string };

const IGNORED_LAYOUT_ENTITY_TYPES = new Set(['VIEWPORT']);
const SUPPORTED_ENTITY_TYPES = new Set(['LINE', 'ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE']);
const OCS_COORDINATE_ENTITY_TYPES = new Set(['ARC', 'CIRCLE', 'LWPOLYLINE', 'POLYLINE']);
const DEFAULT_CURVE_CHORD_ERROR = 0.001;
const PLANAR_NORMAL_EPSILON = 1e-12;
// WCS entities may lie at any elevation, but all points must share one XY-parallel plane.
const WCS_PLANAR_Z_EPSILON = 1e-9;
const SPLINE_APPROXIMATION_WARNING = 'Flattened DXF SPLINE geometry into line segments.';

export function parseDxf(text: string, options: DxfParseOptions = {}): DxfParseResult {
  const curveChordError = validCurveChordError(options.curveChordError);
  const pairs = toPairs(text);
  const units = parseDrawingUnits(pairs);
  const drawing = parseDrawingMetadata(pairs);
  const blockResult = parseBlockDefinitions(pairs, curveChordError);
  const entityPairs = getSectionPairs(pairs, 'ENTITIES');
  const entityResult = parseEntitiesFromPairs(entityPairs, {
    blockName: null,
    contextLabel: 'ENTITIES',
    insertChain: [],
    curveChordError,
    resolveBlock: blockResult.resolveBlock
  });
  const unsupported = [...entityResult.unsupportedEntities].sort();

  return {
    entities: entityResult.entities,
    ...(drawing ? { drawing } : {}),
    ...(units ? { units } : {}),
    unsupportedEntities: unsupported,
    warnings: preserveWarningMultiplicity([
      ...unsupported.map((entity) => `Unsupported DXF entity: ${entity}`),
      ...entityResult.warnings
    ])
  };
}

function parseDrawingMetadata(pairs: DxfPair[]): DxfDrawingMetadata | undefined {
  const headerPairs = getSectionPairs(pairs, 'HEADER');
  const basePoint = parseHeaderPoint(headerPairs, '$INSBASE');
  const extentsMin = parseHeaderPoint(headerPairs, '$EXTMIN');
  const extentsMax = parseHeaderPoint(headerPairs, '$EXTMAX');
  const drawing: DxfDrawingMetadata = {};

  if (basePoint) drawing.basePoint = basePoint;
  if (extentsMin && extentsMax) {
    drawing.extents = {
      min: extentsMin,
      max: extentsMax
    };
  }

  return drawing.basePoint || drawing.extents ? drawing : undefined;
}

function parseHeaderPoint(headerPairs: DxfPair[], variableName: string): DxfPoint | null {
  for (let index = 0; index < headerPairs.length; index++) {
    const pair = headerPairs[index];
    if (pair.code === 0 && normalizedPairValue(pair) === 'ENDSEC') break;
    if (pair.code !== 9 || normalizedPairValue(pair) !== variableName) continue;

    const variablePairs = pairsUntilNextHeaderVariable(headerPairs, index + 1);
    return pointFromCodes(variablePairs, 10, 20);
  }

  return null;
}

function pairsUntilNextHeaderVariable(pairs: DxfPair[], startIndex: number) {
  const variablePairs: DxfPair[] = [];

  for (let index = startIndex; index < pairs.length; index++) {
    const pair = pairs[index];
    if (pair.code === 9 || (pair.code === 0 && normalizedPairValue(pair) === 'ENDSEC')) break;
    variablePairs.push(pair);
  }

  return variablePairs;
}

function parseDrawingUnits(pairs: DxfPair[]): DxfDrawingUnits | undefined {
  const headerPairs = getSectionPairs(pairs, 'HEADER');

  for (let index = 0; index < headerPairs.length; index++) {
    const pair = headerPairs[index];
    if (pair.code === 0 && normalizedPairValue(pair) === 'ENDSEC') break;
    if (pair.code !== 9 || normalizedPairValue(pair) !== '$INSUNITS') continue;

    const valuePair = pairsUntilNextHeaderVariable(headerPairs, index + 1).find(
      (candidate) => candidate.code === 70
    );
    if (!valuePair) return undefined;

    const code = finitePairValue(valuePair);
    if (code == null || !Number.isInteger(code)) return undefined;
    return dxfUnitsFromInsunitsCode(code);
  }

  return undefined;
}

function dxfUnitsFromInsunitsCode(code: number): DxfDrawingUnits {
  const known = DXF_INSUNITS[code] ?? {
    label: `unknown-${code}`,
    scaleToMillimeters: null
  };

  return {
    source: 'dxf-insunits',
    code,
    label: known.label,
    scaleToMillimeters: known.scaleToMillimeters
  };
}

const DXF_INSUNITS: Record<number, { label: string; scaleToMillimeters: number | null }> = {
  0: { label: 'unitless', scaleToMillimeters: null },
  1: { label: 'inches', scaleToMillimeters: 25.4 },
  2: { label: 'feet', scaleToMillimeters: 304.8 },
  3: { label: 'miles', scaleToMillimeters: 1609344 },
  4: { label: 'millimeters', scaleToMillimeters: 1 },
  5: { label: 'centimeters', scaleToMillimeters: 10 },
  6: { label: 'meters', scaleToMillimeters: 1000 },
  7: { label: 'kilometers', scaleToMillimeters: 1000000 },
  8: { label: 'microinches', scaleToMillimeters: 0.0000254 },
  9: { label: 'mils', scaleToMillimeters: 0.0254 },
  10: { label: 'yards', scaleToMillimeters: 914.4 },
  11: { label: 'angstroms', scaleToMillimeters: 1e-7 },
  12: { label: 'nanometers', scaleToMillimeters: 0.000001 },
  13: { label: 'microns', scaleToMillimeters: 0.001 },
  14: { label: 'decimeters', scaleToMillimeters: 100 },
  15: { label: 'decameters', scaleToMillimeters: 10000 },
  16: { label: 'hectometers', scaleToMillimeters: 100000 },
  17: { label: 'gigameters', scaleToMillimeters: 1000000000000 },
  18: { label: 'astronomical-units', scaleToMillimeters: 149597870700000 },
  19: { label: 'light-years', scaleToMillimeters: 9.4607304725808e18 },
  20: { label: 'parsecs', scaleToMillimeters: 3.085677581491367e19 }
};

function toPairs(text: string): DxfPair[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const pairs: DxfPair[] = [];
  const firstCodeLine = lines.findIndex((line) => isGroupCodeLine(line.trim()));
  if (firstCodeLine < 0) return pairs;

  for (let index = firstCodeLine; index < lines.length - 1; index += 2) {
    const codeLine = lines[index].trim();
    if (!isGroupCodeLine(codeLine)) continue;
    const code = Number(codeLine);
    pairs.push({ code, value: lines[index + 1] });
  }

  return pairs;
}

function isGroupCodeLine(value: string) {
  return /^\d+$/.test(value);
}

function getSectionPairs(pairs: DxfPair[], sectionName: string) {
  for (let index = 0; index < pairs.length - 1; index++) {
    if (
      pairs[index].code === 0 &&
      normalizedPairValue(pairs[index]) === 'SECTION' &&
      pairs[index + 1]?.code === 2 &&
      normalizedPairValue(pairs[index + 1]) === sectionName
    ) {
      return pairs.slice(index + 2);
    }
  }

  return [];
}

function parseBlockDefinitions(
  pairs: DxfPair[],
  curveChordError: number
): BlockDefinitionsResult {
  const blockPairs = getSectionPairs(pairs, 'BLOCKS');
  const rawBlocks = extractRawBlockDefinitions(blockPairs);
  const resolvedBlocks = new Map<string, ResolvedBlockDefinition>();
  const resolving = new Set<string>();

  const resolveBlock = (blockName: string): ResolvedBlockDefinition | null => {
    const normalizedName = normalizeBlockName(blockName);
    const cached = resolvedBlocks.get(normalizedName);
    if (cached) return cached;

    const rawBlock = rawBlocks.get(normalizedName);
    if (!rawBlock) return null;

    if (!rawBlock.basePointValid) {
      return {
        basePoint: rawBlock.basePoint,
        entities: [],
        unsupportedEntities: new Set(),
        warnings: [`Rejected BLOCK "${rawBlock.name}" because its base point is malformed.`]
      };
    }

    if (resolving.has(normalizedName)) {
      return {
        basePoint: rawBlock.basePoint,
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
      curveChordError,
      resolveBlock
    });
    resolving.delete(normalizedName);
    const resolved = { ...result, basePoint: rawBlock.basePoint };
    resolvedBlocks.set(normalizedName, resolved);
    return resolved;
  };

  return { resolveBlock };
}

function extractRawBlockDefinitions(blockPairs: DxfPair[]) {
  const blocks = new Map<string, RawBlockDefinition>();

  for (let index = 0; index < blockPairs.length; index++) {
    const pair = blockPairs[index];
    if (pair.code !== 0) continue;

    const entityType = normalizedPairValue(pair);
    if (entityType === 'ENDSEC') break;
    if (entityType !== 'BLOCK') continue;

    const endIndex = findBlockEnd(blockPairs, index + 1);
    const pairsForBlock = blockPairs.slice(index + 1, endIndex);
    const firstEntityIndex = pairsForBlock.findIndex((candidate) => candidate.code === 0);
    const headerPairs =
      firstEntityIndex >= 0 ? pairsForBlock.slice(0, firstEntityIndex) : pairsForBlock;
    const blockName = stringValue(headerPairs, 2);
    const basePointResult = blockBasePoint(headerPairs);

    if (blockName) {
      blocks.set(normalizeBlockName(blockName), {
        basePoint: basePointResult.point,
        basePointValid: basePointResult.valid,
        name: blockName,
        pairs: pairsForBlock
      });
    }

    index = endIndex;
  }

  return blocks;
}

function blockBasePoint(headerPairs: DxfPair[]) {
  const hasX = headerPairs.some((pair) => pair.code === 10);
  const hasY = headerPairs.some((pair) => pair.code === 20);
  if (!hasX && !hasY) return { point: { x: 0, y: 0 }, valid: true };

  const point = pointFromCodes(headerPairs, 10, 20);
  return point
    ? { point, valid: true }
    : { point: { x: 0, y: 0 }, valid: false };
}

function findBlockEnd(pairs: DxfPair[], startIndex: number) {
  for (let index = startIndex; index < pairs.length; index++) {
    if (pairs[index].code === 0 && normalizedPairValue(pairs[index]) === 'ENDBLK') {
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

    const entityType = normalizedPairValue(pair);
    if (['ENDSEC', 'ENDBLK'].includes(entityType)) break;

    const nextIndex =
      entityType === 'POLYLINE'
        ? findClassicPolylineEnd(entityPairs, index + 1)
        : findNextEntityStart(entityPairs, index + 1);
    const pairsForEntity = entityPairs.slice(index + 1, nextIndex);

    if (['EOF', 'ENDSEC'].includes(entityType) || IGNORED_LAYOUT_ENTITY_TYPES.has(entityType)) {
      index = nextIndex - 1;
      continue;
    }

    if (entityType === 'INSERT') {
      const ocs = planarOcsOrientation(pairsForEntity, entityType);
      if (!ocs.ok) {
        warnings.push(ocs.warning);
        index = nextIndex - 1;
        continue;
      }

      const parsedInsert = parseInsert(pairsForEntity);
      const insert = parsedInsert && ocs.negativeZ ? reflectInsertAcrossYAxis(parsedInsert) : parsedInsert;
      if (!insert) {
        warnings.push('Rejected malformed DXF INSERT geometry.');
        index = nextIndex - 1;
        continue;
      }

      if (!context.resolveBlock) {
        unsupportedEntities.add('INSERT');
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

    if (!SUPPORTED_ENTITY_TYPES.has(entityType)) {
      unsupportedEntities.add(entityType);
      index = nextIndex - 1;
      continue;
    }

    if (entityType === 'POLYLINE') {
      const non2dFlags = non2dClassicPolylineFlags(pairsForEntity);
      if (non2dFlags !== 0) {
        warnings.push(
          `Skipped non-2D DXF POLYLINE geometry with flags ${non2dFlags}; 3D, mesh, and polyface paths are not supported.`
        );
        index = nextIndex - 1;
        continue;
      }
    }

    const ocs = planarOcsOrientation(pairsForEntity, entityType);
    if (!ocs.ok) {
      warnings.push(ocs.warning);
      index = nextIndex - 1;
      continue;
    }

    const parsedEntities = parseEntity(
      entityType,
      pairsForEntity,
      context.curveChordError,
      ocs.negativeZ
    );

    if (parsedEntities) {
      entities.push(...parsedEntities.map((entity) => withEntitySource(entity, context)));
      if (entityType === 'SPLINE') {
        warnings.push(SPLINE_APPROXIMATION_WARNING);
      }
    } else if (entityType === 'SPLINE') {
      unsupportedEntities.add('SPLINE');
    } else {
      warnings.push(`Rejected malformed DXF ${entityType} geometry.`);
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
    if (pairs[index].code === 0 && normalizedPairValue(pairs[index]) === 'SEQEND') {
      return findNextEntityStart(pairs, index + 1);
    }
  }

  return findNextEntityStart(pairs, startIndex);
}

function parseEntity(
  entityType: string,
  pairs: DxfPair[],
  curveChordError: number,
  negativeZ: boolean
): DxfEntity[] | null {
  let entities: DxfEntity[] | null = null;

  if (entityType === 'LINE') entities = entityArray(parseLine(pairs));
  if (entityType === 'ARC') entities = entityArray(parseArc(pairs));
  if (entityType === 'CIRCLE') entities = entityArray(parseCircle(pairs));
  if (entityType === 'LWPOLYLINE') entities = entityArray(parseLwPolyline(pairs));
  if (entityType === 'POLYLINE') entities = entityArray(parseClassicPolyline(pairs));
  if (entityType === 'SPLINE') entities = parseSpline(pairs, curveChordError);

  if (!entities) return null;
  const normalizedEntities = negativeZ && OCS_COORDINATE_ENTITY_TYPES.has(entityType)
    ? entities.map(reflectEntityAcrossYAxis)
    : entities;
  return normalizedEntities.every(isFiniteDxfEntity) ? normalizedEntities : null;
}

function entityArray(entity: DxfEntity | null): DxfEntity[] | null {
  if (entity) return [entity];
  return null;
}

function parseLine(pairs: DxfPair[]): DxfLineEntity | null {
  const handle = stringValue(pairs, 5);
  const layer = stringValue(pairs, 8);
  const start = wcsPointFromCodes(pairs, 10, 20, 30);
  const end = wcsPointFromCodes(pairs, 11, 21, 31);

  if (!start || !end || Math.abs(start.z - end.z) > WCS_PLANAR_Z_EPSILON) return null;

  return {
    type: 'line',
    handle,
    layer,
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y }
  };
}

function parseArc(pairs: DxfPair[]): DxfArcEntity | null {
  const handle = stringValue(pairs, 5);
  const layer = stringValue(pairs, 8);
  const center = pointFromCodes(pairs, 10, 20);
  const radius = numberValue(pairs, 40);
  const startAngle = numberValue(pairs, 50);
  const endAngle = numberValue(pairs, 51);

  if (!center || radius == null || startAngle == null || endAngle == null) return null;
  const sweepRadians = signedDxfArcSweepRadians(startAngle, endAngle, false);
  if (sweepRadians == null) return null;
  const start = pointOnCircle(center, radius, startAngle);
  const end = pointOnCircle(center, radius, endAngle);
  if (!start || !end) return null;

  return {
    type: 'arc',
    handle,
    layer,
    center,
    radius,
    startAngle,
    endAngle,
    sweepRadians,
    clockwise: false,
    start,
    end
  };
}

function parseCircle(pairs: DxfPair[]): DxfCircleEntity | null {
  const handle = stringValue(pairs, 5);
  const layer = stringValue(pairs, 8);
  const center = pointFromCodes(pairs, 10, 20);
  const radius = numberValue(pairs, 40);

  if (!center || radius == null) return null;

  return {
    type: 'circle',
    handle,
    layer,
    center,
    radius
  };
}

function parseLwPolyline(pairs: DxfPair[]): DxfLwPolylineEntity | null {
  const handle = stringValue(pairs, 5);
  const layer = stringValue(pairs, 8);
  const flags = optionalIntegerValue(pairs, 70, 0);
  if (flags == null) return null;

  const vertices: DxfLwPolylineVertex[] = [];
  let current: Partial<DxfLwPolylineVertex> | null = null;

  for (const pair of pairs) {
    if (pair.code === 10) {
      if (current) {
        const vertex = completePolylineVertex(current);
        if (!vertex) return null;
        vertices.push(vertex);
      }
      const x = finitePairValue(pair);
      if (x == null) return null;
      current = { x };
    } else if (pair.code === 20) {
      if (!current) return null;
      const y = finitePairValue(pair);
      if (y == null || current.y != null) return null;
      current.y = y;
    } else if (pair.code === 42) {
      if (!current || current.bulge != null) return null;
      const bulge = finitePairValue(pair);
      if (bulge == null) return null;
      current.bulge = bulge;
    }
  }

  if (current) {
    const vertex = completePolylineVertex(current);
    if (!vertex) return null;
    vertices.push(vertex);
  }

  if (vertices.length === 0) return null;

  return {
    type: 'lwpolyline',
    handle,
    layer,
    closed: (flags & 1) === 1,
    vertices
  };
}

function parseClassicPolyline(pairs: DxfPair[]): DxfPolylineEntity | null {
  const firstVertexIndex = pairs.findIndex(
    (pair) => pair.code === 0 && normalizedPairValue(pair) === 'VERTEX'
  );
  const headerPairs = firstVertexIndex >= 0 ? pairs.slice(0, firstVertexIndex) : pairs;
  const handle = stringValue(headerPairs, 5);
  const layer = stringValue(headerPairs, 8);
  const flags = optionalIntegerValue(headerPairs, 70, 0);
  if (flags == null || (flags & (8 | 16 | 64)) !== 0) return null;
  const vertices: DxfPolylineVertex[] = [];

  for (let index = 0; index < pairs.length; index++) {
    const pair = pairs[index];
    if (pair.code !== 0) continue;

    const entityType = normalizedPairValue(pair);
    if (entityType === 'SEQEND') break;
    if (entityType !== 'VERTEX') continue;

    const nextIndex = findNextEntityStart(pairs, index + 1);
    const vertexPairs = pairs.slice(index + 1, nextIndex);
    const vertex = classicPolylineVertex(vertexPairs);
    if (!vertex) return null;
    vertices.push(vertex);
    index = nextIndex - 1;
  }

  if (vertices.length === 0) return null;

  return {
    type: 'polyline',
    handle,
    layer,
    closed: (flags & 1) === 1,
    vertices
  };
}

function classicPolylineVertex(pairs: DxfPair[]): DxfPolylineVertex | null {
  const point = pointFromCodes(pairs, 10, 20);
  if (!point) return null;
  const bulge = optionalNumberValue(pairs, 42, 0);
  if (bulge == null) return null;

  return {
    ...point,
    bulge
  };
}

function completePolylineVertex(
  vertex: Partial<DxfLwPolylineVertex>
): DxfLwPolylineVertex | null {
  if (
    vertex.x == null ||
    vertex.y == null ||
    !Number.isFinite(vertex.x) ||
    !Number.isFinite(vertex.y) ||
    !Number.isFinite(vertex.bulge ?? 0)
  ) {
    return null;
  }

  return { x: vertex.x, y: vertex.y, bulge: vertex.bulge ?? 0 };
}

function parseSpline(pairs: DxfPair[], curveChordError: number): DxfLineEntity[] | null {
  const handle = stringValue(pairs, 5);
  const layer = stringValue(pairs, 8);
  const flags = optionalIntegerValue(pairs, 70, 0);
  const degree = integerValue(pairs, 71);
  const declaredKnotCount = integerValue(pairs, 72);
  const declaredControlPointCount = integerValue(pairs, 73);
  const knots = repeatedNumberValues(pairs, 40);
  const controlPoints = repeatedWcsControlPoints(pairs);
  const parsedWeights = repeatedNumberValues(pairs, 41);

  if (
    flags == null ||
    (flags & 8) !== 8 ||
    degree == null ||
    declaredKnotCount == null ||
    declaredControlPointCount == null ||
    !knots ||
    !controlPoints ||
    !parsedWeights ||
    knots.length !== declaredKnotCount ||
    controlPoints.length !== declaredControlPointCount
  ) {
    return null;
  }

  const weights = parsedWeights.length > 0 ? parsedWeights : undefined;
  const approximation = approximateSpline(
    {
      controlPoints,
      degree,
      flags,
      knots,
      ...(weights ? { weights } : {})
    },
    { maxChordError: curveChordError }
  );
  if (!approximation.ok) return null;

  const entities: DxfLineEntity[] = [];
  for (let index = 0; index < approximation.points.length - 1; index++) {
    const start = approximation.points[index];
    const end = approximation.points[index + 1];
    entities.push({
      type: 'line',
      handle,
      layer,
      approximation: {
        sourceEntityType: 'SPLINE',
        maxChordError: curveChordError
      },
      start,
      end
    });
  }

  return entities.length > 0 ? entities : null;
}

function parseInsert(pairs: DxfPair[]): DxfInsertEntity | null {
  const blockName = stringValue(pairs, 2);
  if (!blockName) return null;

  const insertionX = optionalNumberValue(pairs, 10, 0);
  const insertionY = optionalNumberValue(pairs, 20, 0);
  const scaleX = optionalNumberValue(pairs, 41, 1);
  const scaleY = optionalNumberValue(pairs, 42, 1);
  const rotationDegrees = optionalNumberValue(pairs, 50, 0);
  const columnCount = optionalPositiveIntegerValue(pairs, 70, 1);
  const rowCount = optionalPositiveIntegerValue(pairs, 71, 1);
  const columnSpacing = optionalNumberValue(pairs, 44, 0);
  const rowSpacing = optionalNumberValue(pairs, 45, 0);
  if (
    insertionX == null ||
    insertionY == null ||
    scaleX == null ||
    scaleY == null ||
    rotationDegrees == null ||
    columnCount == null ||
    rowCount == null ||
    columnSpacing == null ||
    rowSpacing == null
  ) {
    return null;
  }

  return {
    type: 'insert',
    layer: stringValue(pairs, 8),
    blockName,
    insertion: {
      x: insertionX,
      y: insertionY
    },
    scaleX,
    scaleY,
    rotationDegrees,
    columnCount,
    rowCount,
    columnSpacing,
    rowSpacing
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
        resolvedBlock.basePoint,
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
  blockBasePoint: DxfPoint,
  localOffset: DxfPoint,
  row: number,
  column: number
): InsertTransform {
  const determinant =
    insert.scaleX === 0 || insert.scaleY === 0
      ? 0
      : Math.sign(insert.scaleX) * Math.sign(insert.scaleY);
  const absoluteScaleX = Math.abs(insert.scaleX);
  const absoluteScaleY = Math.abs(insert.scaleY);
  const uniformScale = absoluteScaleX === absoluteScaleY ? absoluteScaleX : null;
  const source: DxfInsertSource = {
    blockName: insert.blockName,
    column,
    row,
    layer: insert.layer,
    transform: {
      insertion: insert.insertion,
      localOffset,
      blockBasePoint,
      rotationDegrees: insert.rotationDegrees,
      scaleX: insert.scaleX,
      scaleY: insert.scaleY
    }
  };

  return {
    insertion: insert.insertion,
    scaleX: insert.scaleX,
    scaleY: insert.scaleY,
    rotationDegrees: insert.rotationDegrees,
    determinant,
    uniformScale,
    insertLayer: insert.layer,
    localOffset,
    blockBasePoint,
    source
  };
}

function transformEntity(entity: DxfEntity, transform: InsertTransform): TransformEntityResult {
  if (entity.type === 'line') {
    const approximation = transformedApproximation(entity, transform);
    if (entity.approximation && !approximation) {
      return skippedTransformedEntity(
        entity.type,
        'the transformed approximation bound is non-finite'
      );
    }

    const start = transformPoint(entity.start, transform);
    const end = transformPoint(entity.end, transform);
    if (!start || !end) {
      return skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
    }

    return transformedEntityResult(
      {
        ...entity,
        ...(approximation ? { approximation } : {}),
        layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
        start,
        end
      },
      transform.source
    );
  }

  if (entity.type === 'circle') {
    if (transform.uniformScale == null) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn it into an ellipse');
    }

    const center = transformPoint(entity.center, transform);
    const radius = entity.radius * transform.uniformScale;
    if (!center || !Number.isFinite(radius)) {
      return skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
    }

    return transformedEntityResult(
      {
        ...entity,
        layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
        center,
        radius
      },
      transform.source
    );
  }

  if (entity.type === 'arc') {
    if (transform.uniformScale == null) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn it into an elliptical arc');
    }

    const center = transformPoint(entity.center, transform);
    const start = transformPoint(entity.start, transform);
    const end = transformPoint(entity.end, transform);
    const radius = entity.radius * transform.uniformScale;
    if (!center || !start || !end || !Number.isFinite(radius)) {
      return skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
    }
    const startAngle = angleDegrees(center, start);
    const endAngle = angleDegrees(center, end);
    const orientationSign = transform.determinant < 0 ? -1 : 1;

    return transformedEntityResult(
      {
        ...entity,
        layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
        center,
        radius,
        start,
        end,
        startAngle,
        endAngle,
        ...(entity.sweepRadians == null
          ? {}
          : { sweepRadians: entity.sweepRadians * orientationSign }),
        clockwise: transform.determinant < 0 ? !entity.clockwise : entity.clockwise
      },
      transform.source
    );
  }

  if (entity.type === 'lwpolyline') {
    if (
      transform.uniformScale == null &&
      entity.vertices.some((vertex) => vertex.bulge !== 0)
    ) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn a bulge arc into an ellipse');
    }

    const bulgeSign = transform.determinant < 0 ? -1 : 1;
    const vertices = transformPolylineVertices(entity.vertices, transform, bulgeSign);
    if (!vertices) {
      return skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
    }
    return transformedEntityResult(
      {
        ...entity,
        layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
        vertices
      },
      transform.source
    );
  }

  if (entity.type === 'polyline') {
    if (
      transform.uniformScale == null &&
      entity.vertices.some((vertex) => vertex.bulge !== 0)
    ) {
      return skippedTransformedEntity(entity.type, 'non-uniform INSERT scale would turn a bulge arc into an ellipse');
    }

    const bulgeSign = transform.determinant < 0 ? -1 : 1;
    const vertices = transformPolylineVertices(entity.vertices, transform, bulgeSign);
    if (!vertices) {
      return skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
    }
    return transformedEntityResult(
      {
        ...entity,
        layer: inheritedBlockLayer(entity.layer, transform.insertLayer),
        vertices
      },
      transform.source
    );
  }

  const exhaustiveEntity: never = entity;
  return skippedTransformedEntity(String(exhaustiveEntity), 'unsupported block geometry');
}

function transformedApproximation(
  entity: DxfLineEntity,
  transform: InsertTransform
) {
  if (!entity.approximation) return null;
  const maximumScale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY));
  const maxChordError = entity.approximation.maxChordError * maximumScale;
  if (!Number.isFinite(maxChordError)) return null;
  return {
    ...entity.approximation,
    maxChordError
  };
}

function transformedEntityResult<T extends DxfEntity>(
  entity: T,
  source: DxfInsertSource
): TransformEntityResult {
  const transformed = withInsertedSource(entity, source);
  return isFiniteDxfEntity(transformed)
    ? { entity: transformed }
    : skippedTransformedEntity(entity.type, 'the transform produced non-finite geometry');
}

function transformPolylineVertices(
  vertices: Array<DxfLwPolylineVertex | DxfPolylineVertex>,
  transform: InsertTransform,
  bulgeSign: number
) {
  const transformed: DxfLwPolylineVertex[] = [];
  for (const vertex of vertices) {
    const point = transformPoint(vertex, transform);
    const bulge = vertex.bulge * bulgeSign;
    if (!point || !Number.isFinite(bulge)) return null;
    transformed.push({ ...point, bulge: Object.is(bulge, -0) ? 0 : bulge });
  }
  return transformed;
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
  const localX = point.x - transform.blockBasePoint.x;
  const localY = point.y - transform.blockBasePoint.y;
  const scaledX = localX * transform.scaleX;
  const scaledY = localY * transform.scaleY;
  const { cos, sin } = insertRotationComponents(transform);
  const geometryOffset = {
    x: scaledX * cos - scaledY * sin,
    y: scaledX * sin + scaledY * cos
  };
  const arrayOffset = {
    x: transform.localOffset.x * cos - transform.localOffset.y * sin,
    y: transform.localOffset.x * sin + transform.localOffset.y * cos
  };

  const x = transform.insertion.x + geometryOffset.x + arrayOffset.x;
  const y = transform.insertion.y + geometryOffset.y + arrayOffset.y;
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: normalizeSignedZero(x), y: normalizeSignedZero(y) }
    : null;
}

function insertRotationComponents(transform: InsertTransform) {
  const reducedDegrees = transform.rotationDegrees % 360;
  if (reducedDegrees === 0) return { cos: 1, sin: 0 };
  if (reducedDegrees === 90 || reducedDegrees === -270) return { cos: 0, sin: 1 };
  if (reducedDegrees === 180 || reducedDegrees === -180) return { cos: -1, sin: 0 };
  if (reducedDegrees === 270 || reducedDegrees === -90) return { cos: 0, sin: -1 };
  const reducedRadians = (reducedDegrees * Math.PI) / 180;
  return {
    cos: Math.cos(reducedRadians),
    sin: Math.sin(reducedRadians)
  };
}

function normalizeSignedZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}

function inheritedBlockLayer(entityLayer: string | null, insertLayer: string | null) {
  return entityLayer === '0' && insertLayer ? insertLayer : entityLayer;
}

function planarOcsOrientation(
  pairs: DxfPair[],
  entityType: string
): { ok: true; negativeZ: boolean } | { ok: false; warning: string } {
  const hasExtrusion = pairs.some((pair) => [210, 220, 230].includes(pair.code));
  if (!hasExtrusion) return { ok: true, negativeZ: false };

  const x = optionalNumberValue(pairs, 210, 0);
  const y = optionalNumberValue(pairs, 220, 0);
  const z = optionalNumberValue(pairs, 230, 1);
  if (x == null || y == null || z == null) {
    return {
      ok: false,
      warning: `Rejected malformed DXF ${entityType} extrusion normal.`
    };
  }

  const directionScale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (!Number.isFinite(directionScale) || directionScale === 0) {
    return {
      ok: false,
      warning: `Rejected malformed DXF ${entityType} extrusion normal.`
    };
  }

  const scaledX = x / directionScale;
  const scaledY = y / directionScale;
  const scaledZ = z / directionScale;
  const directionLength = Math.hypot(scaledX, scaledY, scaledZ);
  const normalizedX = scaledX / directionLength;
  const normalizedY = scaledY / directionLength;
  const normalizedZ = scaledZ / directionLength;

  if (
    !Number.isFinite(normalizedX) ||
    !Number.isFinite(normalizedY) ||
    !Number.isFinite(normalizedZ) ||
    Math.abs(normalizedX) > PLANAR_NORMAL_EPSILON ||
    Math.abs(normalizedY) > PLANAR_NORMAL_EPSILON ||
    Math.abs(normalizedZ) <= PLANAR_NORMAL_EPSILON
  ) {
    return {
      ok: false,
      warning: `Skipped DXF ${entityType} with tilted extrusion normal; only XY-planar geometry is supported.`
    };
  }

  return { ok: true, negativeZ: normalizedZ < 0 };
}

function reflectEntityAcrossYAxis(entity: DxfEntity): DxfEntity {
  if (entity.type === 'line') {
    return {
      ...entity,
      start: reflectPointAcrossYAxis(entity.start),
      end: reflectPointAcrossYAxis(entity.end)
    };
  }

  if (entity.type === 'circle') {
    return {
      ...entity,
      center: reflectPointAcrossYAxis(entity.center)
    };
  }

  if (entity.type === 'arc') {
    const center = reflectPointAcrossYAxis(entity.center);
    const start = reflectPointAcrossYAxis(entity.start);
    const end = reflectPointAcrossYAxis(entity.end);
    return {
      ...entity,
      center,
      start,
      end,
      startAngle: angleDegrees(center, start),
      endAngle: angleDegrees(center, end),
      ...(entity.sweepRadians == null
        ? {}
        : { sweepRadians: -entity.sweepRadians }),
      clockwise: !entity.clockwise
    };
  }

  return {
    ...entity,
    vertices: entity.vertices.map((vertex) => ({
      ...reflectPointAcrossYAxis(vertex),
      bulge: vertex.bulge === 0 ? 0 : -vertex.bulge
    }))
  };
}

function reflectInsertAcrossYAxis(insert: DxfInsertEntity): DxfInsertEntity {
  return {
    ...insert,
    insertion: reflectPointAcrossYAxis(insert.insertion),
    scaleX: -insert.scaleX,
    rotationDegrees: -insert.rotationDegrees,
    columnSpacing: -insert.columnSpacing
  };
}

function reflectPointAcrossYAxis(point: DxfPoint): DxfPoint {
  return { x: -point.x, y: point.y };
}

function non2dClassicPolylineFlags(pairs: DxfPair[]) {
  const firstVertexIndex = pairs.findIndex(
    (pair) => pair.code === 0 && normalizedPairValue(pair) === 'VERTEX'
  );
  const headerPairs = firstVertexIndex >= 0 ? pairs.slice(0, firstVertexIndex) : pairs;
  const flags = optionalIntegerValue(headerPairs, 70, 0);
  return flags == null ? 0 : flags & (8 | 16 | 64);
}

function pointFromCodes(pairs: DxfPair[], xCode: number, yCode: number): DxfPoint | null {
  const x = numberValue(pairs, xCode);
  const y = numberValue(pairs, yCode);
  if (x == null || y == null) return null;
  return { x, y };
}

function wcsPointFromCodes(
  pairs: DxfPair[],
  xCode: number,
  yCode: number,
  zCode: number
): DxfPoint3 | null {
  const point = pointFromCodes(pairs, xCode, yCode);
  const z = optionalNumberValue(pairs, zCode, 0);
  return point && z != null ? { ...point, z } : null;
}

function numberValue(pairs: DxfPair[], code: number) {
  const pair = pairs.find((candidate) => candidate.code === code);
  if (!pair) return null;
  return finitePairValue(pair);
}

function optionalNumberValue(pairs: DxfPair[], code: number, fallback: number) {
  const pair = pairs.find((candidate) => candidate.code === code);
  return pair ? finitePairValue(pair) : fallback;
}

function integerValue(pairs: DxfPair[], code: number) {
  const value = numberValue(pairs, code);
  return value != null && Number.isInteger(value) ? value : null;
}

function optionalIntegerValue(pairs: DxfPair[], code: number, fallback: number) {
  const pair = pairs.find((candidate) => candidate.code === code);
  if (!pair) return fallback;
  const value = finitePairValue(pair);
  return value != null && Number.isInteger(value) ? value : null;
}

function optionalPositiveIntegerValue(pairs: DxfPair[], code: number, fallback: number) {
  const value = optionalIntegerValue(pairs, code, fallback);
  return value != null && value >= 1 ? value : null;
}

function repeatedNumberValues(pairs: DxfPair[], code: number): number[] | null {
  const values: number[] = [];
  for (const pair of pairs) {
    if (pair.code !== code) continue;
    const value = finitePairValue(pair);
    if (value == null) return null;
    values.push(value);
  }
  return values;
}

function repeatedWcsControlPoints(pairs: DxfPair[]): DxfPoint[] | null {
  const points: DxfPoint3[] = [];
  let current: Partial<DxfPoint3> | null = null;

  for (const pair of pairs) {
    if (pair.code === 10) {
      if (current) {
        if (current.x == null || current.y == null) return null;
        points.push({ x: current.x, y: current.y, z: current.z ?? 0 });
      }
      const x = finitePairValue(pair);
      if (x == null) return null;
      current = { x };
    } else if (pair.code === 20) {
      if (!current) return null;
      const y = finitePairValue(pair);
      if (y == null || current.y != null) return null;
      current.y = y;
    } else if (pair.code === 30) {
      if (!current) return null;
      const z = finitePairValue(pair);
      if (z == null || current.z != null) return null;
      current.z = z;
    }
  }

  if (current) {
    if (current.x == null || current.y == null) return null;
    points.push({ x: current.x, y: current.y, z: current.z ?? 0 });
  }

  const referenceZ = points[0]?.z;
  if (
    referenceZ == null ||
    points.some((point) => Math.abs(point.z - referenceZ) > WCS_PLANAR_Z_EPSILON)
  ) {
    return null;
  }

  return points.map(({ x, y }) => ({ x, y }));
}

function finitePairValue(pair: DxfPair) {
  const normalized = pair.value.trim();
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function stringValue(pairs: DxfPair[], code: number) {
  const pair = pairs.find((candidate) => candidate.code === code);
  return pair ? pair.value.trim() : null;
}

function normalizedPairValue(pair: DxfPair | undefined) {
  return pair?.value.trim().toUpperCase() ?? '';
}

function normalizeBlockName(blockName: string) {
  return blockName.toUpperCase();
}

function pointOnCircle(center: DxfPoint, radius: number, angleDegrees: number) {
  const angle = (angleDegrees * Math.PI) / 180;
  const x = center.x + radius * Math.cos(angle);
  const y = center.y + radius * Math.sin(angle);
  return Number.isFinite(x) && Number.isFinite(y)
    ? { x: round(x), y: round(y) }
    : null;
}

function round(value: number) {
  return Number(value.toFixed(12));
}

function angleDegrees(center: DxfPoint, point: DxfPoint) {
  return round((Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI);
}

function pointsEqual(a: DxfPoint, b: DxfPoint) {
  return Math.abs(a.x - b.x) <= 1e-9 && Math.abs(a.y - b.y) <= 1e-9;
}

function isFiniteDxfEntity(entity: DxfEntity) {
  if (!isFiniteEntitySource(entity.source)) return false;

  if (entity.type === 'line') {
    return (
      isFinitePoint(entity.start) &&
      isFinitePoint(entity.end) &&
      (!entity.approximation || Number.isFinite(entity.approximation.maxChordError))
    );
  }
  if (entity.type === 'circle') {
    return isFinitePoint(entity.center) && Number.isFinite(entity.radius);
  }
  if (entity.type === 'arc') {
    return (
      isFinitePoint(entity.center) &&
      isFinitePoint(entity.start) &&
      isFinitePoint(entity.end) &&
      Number.isFinite(entity.radius) &&
      Number.isFinite(entity.startAngle) &&
      Number.isFinite(entity.endAngle) &&
      (entity.sweepRadians == null || Number.isFinite(entity.sweepRadians))
    );
  }
  return entity.vertices.every(
    (vertex) => isFinitePoint(vertex) && Number.isFinite(vertex.bulge)
  );
}

function isFiniteEntitySource(source: DxfEntitySource | undefined) {
  return (
    !source ||
    source.insertChain.every((insert) => {
      const transform = insert.transform;
      return (
        Number.isFinite(transform.rotationDegrees) &&
        Number.isFinite(transform.scaleX) &&
        Number.isFinite(transform.scaleY) &&
        isFinitePoint(transform.insertion) &&
        (!transform.localOffset || isFinitePoint(transform.localOffset)) &&
        (!transform.blockBasePoint || isFinitePoint(transform.blockBasePoint))
      );
    })
  );
}

function isFinitePoint(point: DxfPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function validCurveChordError(value: number | undefined) {
  return value != null && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CURVE_CHORD_ERROR;
}

function preserveWarningMultiplicity(values: string[]) {
  let sawSplineApproximation = false;
  return values.filter((warning) => {
    if (warning !== SPLINE_APPROXIMATION_WARNING) return true;
    if (sawSplineApproximation) return false;
    sawSplineApproximation = true;
    return true;
  });
}
