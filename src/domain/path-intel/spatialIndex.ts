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
  cells: Map<string, number[]>;
  entryIds: number[];
}

export class SpatialHash<T> {
  private readonly baseCellSize: number;
  private readonly maxCellsPerBounds: number;
  private readonly entries = new Map<number, SpatialEntry<T>>();
  private readonly levels = new Map<number, SpatialLevel>();
  private readonly fallbackEntryIds: number[] = [];
  private nextEntryId = 0;

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
      id: this.nextEntryId++,
      bounds: { ...bounds },
      value
    };
    this.entries.set(entry.id, entry);

    let levelNumber = 0;
    let cellSize = this.baseCellSize;
    while (levelNumber < 4_096) {
      const range = this.cellRange(bounds, cellSize);
      if (range && !cellCountExceeds(range, this.maxCellsPerBounds)) {
        const level = this.level(levelNumber, cellSize);
        level.entryIds.push(entry.id);
        forEachCell(range, (x, y) => {
          const key = cellKey(x, y);
          const entryIds = level.cells.get(key) ?? [];
          entryIds.push(entry.id);
          level.cells.set(key, entryIds);
        });
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
    const candidateIds = new Set<number>();
    if (this.entries.size === 0) return [];

    for (const level of this.levels.values()) {
      const range = this.cellRange(bounds, level.cellSize);
      if (!range || cellCountExceeds(range, this.maxCellsPerBounds)) {
        for (const entryId of level.entryIds) candidateIds.add(entryId);
        continue;
      }

      forEachCell(range, (x, y) => {
        for (const entryId of level.cells.get(cellKey(x, y)) ?? []) {
          candidateIds.add(entryId);
        }
      });
    }
    for (const entryId of this.fallbackEntryIds) candidateIds.add(entryId);

    return [...candidateIds]
      .sort((left, right) => left - right)
      .map((entryId) => this.entries.get(entryId))
      .filter((entry): entry is SpatialEntry<T> => Boolean(entry))
      .filter((entry) => boundsIntersect(entry.bounds, bounds))
      .map((entry) => entry.value);
  }

  private level(levelNumber: number, cellSize: number) {
    const existing = this.levels.get(levelNumber);
    if (existing) return existing;
    const level: SpatialLevel = { cellSize, cells: new Map(), entryIds: [] };
    this.levels.set(levelNumber, level);
    return level;
  }

  private cellRange(bounds: Bounds2, cellSize: number): CellRange | null {
    const minX = Math.floor(bounds.minX / cellSize);
    const minY = Math.floor(bounds.minY / cellSize);
    const maxX = Math.floor(bounds.maxX / cellSize);
    const maxY = Math.floor(bounds.maxY / cellSize);

    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    return {
      minX: BigInt(minX),
      minY: BigInt(minY),
      maxX: BigInt(maxX),
      maxY: BigInt(maxY)
    };
  }
}

interface CellRange {
  minX: bigint;
  minY: bigint;
  maxX: bigint;
  maxY: bigint;
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
  const width = range.maxX - range.minX + 1n;
  const height = range.maxY - range.minY + 1n;
  const bigLimit = BigInt(limit);
  return width > bigLimit || height > bigLimit || width * height > bigLimit;
}

function forEachCell(range: CellRange, visit: (x: bigint, y: bigint) => void) {
  for (let x = range.minX; x <= range.maxX; x += 1n) {
    for (let y = range.minY; y <= range.maxY; y += 1n) visit(x, y);
  }
}

function cellKey(x: bigint, y: bigint) {
  return `${x}:${y}`;
}

function boundsIntersect(left: Bounds2, right: Bounds2) {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}
