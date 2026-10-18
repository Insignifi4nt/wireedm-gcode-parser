import type { Bounds2, Point2 } from './types';

export interface SpatialHashOptions {
  cellSize: number;
  maxCellsPerBounds?: number;
}

interface SpatialEntry<T> {
  id: number;
  bounds: Bounds2;
  value: T;
}

interface SpatialLevel {
  cellSize: number;
  cells: CellMap;
  entryIds: number[];
  bounds: Bounds2;
}

export class SpatialHash<T> {
  private readonly baseCellSize: number;
  private readonly maxCellsPerBounds: number;
  private readonly entries: SpatialEntry<T>[] = [];
  /** Query stamp that last collected each entry, so a query visits every entry once without a set. */
  private readonly collectedBy: number[] = [];
  private queryStamp = 0;
  private readonly levels = new Map<number, SpatialLevel>();
  private readonly fallbackEntryIds: number[] = [];

  constructor(options: SpatialHashOptions) {
    if (!Number.isFinite(options.cellSize) || options.cellSize <= 0) {
      throw new RangeError('Spatial hash cell size must be finite and positive.');
    }
    if (
      options.maxCellsPerBounds != null &&
      (!Number.isSafeInteger(options.maxCellsPerBounds) || options.maxCellsPerBounds < 1)
    ) {
      throw new RangeError('Spatial hash cell limit must be a positive safe integer.');
    }

    this.baseCellSize = options.cellSize;
    this.maxCellsPerBounds = options.maxCellsPerBounds ?? 1_024;
  }

  insertPoint(point: Point2, value: T) {
    this.insertBounds(boundsForPoint(point), value);
  }

  insertBounds(bounds: Bounds2, value: T) {
    assertValidBounds(bounds);
    const entry: SpatialEntry<T> = {
      id: this.entries.length,
      bounds: { ...bounds },
      value
    };
    this.entries.push(entry);
    this.collectedBy.push(0);

    let levelNumber = 0;
    let cellSize = this.baseCellSize;
    while (levelNumber < 4_096) {
      const range = this.cellRange(bounds, cellSize);
      if (range && !cellCountExceeds(range, this.maxCellsPerBounds)) {
        const level = this.level(levelNumber, cellSize, bounds);
        level.entryIds.push(entry.id);
        forEachCell(range, (x, y) => level.cells.add(x, y, entry.id));
        return;
      }

      const nextCellSize = cellSize * 2;
      if (!Number.isFinite(nextCellSize) || nextCellSize <= cellSize) break;
      cellSize = nextCellSize;
      levelNumber += 1;
    }

    this.fallbackEntryIds.push(entry.id);
  }

  queryPoint(point: Point2): T[] {
    return this.queryBounds(boundsForPoint(point));
  }

  queryBounds(bounds: Bounds2): T[] {
    assertValidBounds(bounds);
    if (this.entries.length === 0) return [];

    const stamp = ++this.queryStamp;
    const candidateIds: number[] = [];
    const collect = (entryId: number) => {
      if (this.collectedBy[entryId] === stamp) return;
      this.collectedBy[entryId] = stamp;
      candidateIds.push(entryId);
    };

    for (const level of this.levels.values()) {
      if (!boundsIntersect(level.bounds, bounds)) continue;
      const range = this.cellRange(bounds, level.cellSize);
      // Insertion limits bound index storage, not query work. A tolerance-expanded
      // query can cover more cells than its stored geometry. Scan entries only
      // when that is cheaper than walking the query's cells.
      const queryCellLimit = Math.max(this.maxCellsPerBounds, level.entryIds.length);
      if (!range || cellCountExceeds(range, queryCellLimit)) {
        for (const entryId of level.entryIds) collect(entryId);
        continue;
      }

      forEachCell(range, (x, y) => {
        const entryIds = level.cells.get(x, y);
        if (entryIds) for (const entryId of entryIds) collect(entryId);
      });
    }
    for (const entryId of this.fallbackEntryIds) collect(entryId);

    const values: T[] = [];
    for (const entryId of candidateIds.sort((left, right) => left - right)) {
      const entry = this.entries[entryId];
      if (boundsIntersect(entry.bounds, bounds)) values.push(entry.value);
    }
    return values;
  }

  private level(levelNumber: number, cellSize: number, bounds: Bounds2) {
    const existing = this.levels.get(levelNumber);
    if (existing) {
      existing.bounds.minX = Math.min(existing.bounds.minX, bounds.minX);
      existing.bounds.minY = Math.min(existing.bounds.minY, bounds.minY);
      existing.bounds.maxX = Math.max(existing.bounds.maxX, bounds.maxX);
      existing.bounds.maxY = Math.max(existing.bounds.maxY, bounds.maxY);
      return existing;
    }
    const level: SpatialLevel = { cellSize, cells: new CellMap(), entryIds: [], bounds: { ...bounds } };
    this.levels.set(levelNumber, level);
    return level;
  }

  private cellRange(bounds: Bounds2, cellSize: number): CellRange | null {
    const minX = Math.floor(bounds.minX / cellSize);
    const minY = Math.floor(bounds.minY / cellSize);
    const maxX = Math.floor(bounds.maxX / cellSize);
    const maxY = Math.floor(bounds.maxY / cellSize);

    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    if ([minX, minY, maxX, maxY].every(Number.isSafeInteger)) return { exact: true, minX, minY, maxX, maxY };
    return {
      exact: false,
      minX: BigInt(minX),
      minY: BigInt(minY),
      maxX: BigInt(maxX),
      maxY: BigInt(maxY)
    };
  }
}

/**
 * Inclusive cell coordinates. Ranges within the safe-integer range step with plain numbers;
 * farther ranges step with bigint so neighbouring cells stay distinct.
 */
type CellRange =
  | { exact: true; minX: number; minY: number; maxX: number; maxY: number }
  | { exact: false; minX: bigint; minY: bigint; maxX: bigint; maxY: bigint };

/**
 * Entry ids per cell. Safe-integer cells use nested numeric maps; any cell with a coordinate
 * beyond that range uses a string key. A cell always maps to the same store, however it is reached.
 */
class CellMap {
  private readonly near = new Map<number, Map<number, number[]>>();
  private readonly far = new Map<string, number[]>();

  add(x: number | bigint, y: number | bigint, entryId: number) {
    if (typeof x === 'number' && typeof y === 'number') {
      let column = this.near.get(x);
      if (!column) this.near.set(x, column = new Map());
      const entryIds = column.get(y);
      if (entryIds) entryIds.push(entryId);
      else column.set(y, [entryId]);
      return;
    }
    const key = `${x}:${y}`;
    const entryIds = this.far.get(key);
    if (entryIds) entryIds.push(entryId);
    else this.far.set(key, [entryId]);
  }

  get(x: number | bigint, y: number | bigint) {
    if (typeof x === 'number' && typeof y === 'number') return this.near.get(x)?.get(y);
    return this.far.get(`${x}:${y}`);
  }
}

const MIN_SAFE_CELL = BigInt(Number.MIN_SAFE_INTEGER);
const MAX_SAFE_CELL = BigInt(Number.MAX_SAFE_INTEGER);

function cellCoordinate(value: bigint) {
  return value >= MIN_SAFE_CELL && value <= MAX_SAFE_CELL ? Number(value) : value;
}

function forEachCell(range: CellRange, visit: (x: number | bigint, y: number | bigint) => void) {
  if (range.exact) {
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) visit(x, y);
    }
    return;
  }
  for (let x = range.minX; x <= range.maxX; x += 1n) {
    for (let y = range.minY; y <= range.maxY; y += 1n) visit(cellCoordinate(x), cellCoordinate(y));
  }
}

function boundsForPoint(point: Point2): Bounds2 {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Spatial hash points must be finite.');
  }
  return { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
}

function assertValidBounds(bounds: Bounds2) {
  if (
    ![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw new RangeError('Spatial hash bounds must be finite and ordered.');
  }
}

function cellCountExceeds(range: CellRange, limit: number) {
  if (range.exact) {
    // Spans of distant safe integers may round, but never down to a safe-integer limit.
    const width = range.maxX - range.minX + 1;
    const height = range.maxY - range.minY + 1;
    return width > limit || height > limit || width * height > limit;
  }
  const width = range.maxX - range.minX + 1n;
  const height = range.maxY - range.minY + 1n;
  const bigLimit = BigInt(limit);
  return width > bigLimit || height > bigLimit || width * height > bigLimit;
}

function boundsIntersect(left: Bounds2, right: Bounds2) {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}
