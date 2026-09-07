import type { MagnetizedPathPoint } from '@/domain/path-editor/pathPointInference';
import { createGCodeInterpreterState, interpretGCodeBlock } from './gcodeBlockInterpreter';

export interface MeasurementPoint {
  id: string;
  pathSnap?: MeasurementPointPathSnap;
  x: number;
  y: number;
}

export type MeasurementPointSnapMode = 'perpendicular' | 'tangent';

export interface MeasurementPointPathSnap {
  kind: 'path-construction';
  mode: MeasurementPointSnapMode;
  operationId: string;
  pathElementId: string | null;
  relation: 'perpendicular' | 'tangent' | 'nearest-fallback';
  segmentId: string;
  sourcePoint: {
    x: number;
    y: number;
  };
  tangent: {
    x: number;
    y: number;
  };
}

export interface InsertMeasurementPointsOptions {
  insertAfterLine?: number;
}

export interface InsertMeasurementPointsResult {
  text: string;
  insertedLineNumbers: number[];
}

export interface CreateMeasurementPointPathSnapOptions {
  sourcePoint?: MeasurementPointPathSnap['sourcePoint'];
}

export function createMeasurementPointPathSnapFromMagnetized(
  magnetized: MagnetizedPathPoint,
  options: CreateMeasurementPointPathSnapOptions = {}
): MeasurementPointPathSnap {
  return {
    kind: 'path-construction',
    mode: magnetized.mode,
    operationId: magnetized.operationId,
    pathElementId: magnetized.pathElementId,
    relation: magnetized.relation,
    segmentId: magnetized.segmentId,
    sourcePoint: options.sourcePoint ?? magnetized.sourcePoint,
    tangent: magnetized.tangent
  };
}

export function insertMeasurementPointsIntoText(
  text: string,
  points: MeasurementPoint[],
  options: InsertMeasurementPointsOptions
): InsertMeasurementPointsResult {
  if (points.length === 0) {
    return {
      text,
      insertedLineNumbers: []
    };
  }

  const lines = text.split(/\r?\n/);
  const insertAfterLine = clampLine(options.insertAfterLine ?? 1, lines.length);
  const insertIndex = insertAfterLine;
  const state = createGCodeInterpreterState();
  lines.slice(0, insertIndex).forEach((line, index) => interpretGCodeBlock(state, line, index + 1));
  const scale = state.units === 'in' ? 25.4 : 1;
  const precision = state.units === 'in' ? 5 : 3;
  const insertedLines = points.flatMap((point, index) => {
    const x = (point.x - (state.xyMode === 'incremental' ? state.position.x : 0)) / scale;
    const y = (point.y - (state.xyMode === 'incremental' ? state.position.y : 0)) / scale;
    state.position = { x: point.x, y: point.y };
    return [`; inserted G0 P${index + 1}`, `G0 X${formatCoordinate(x, precision)} Y${formatCoordinate(y, precision)}`];
  });

  lines.splice(insertIndex, 0, ...insertedLines);

  return {
    text: lines.join('\n'),
    insertedLineNumbers: insertedLines.map((_, index) => insertAfterLine + index + 1)
  };
}

export function exportMeasurementPointsAsCsv(points: MeasurementPoint[]) {
  return [
    'Point,X,Y',
    ...points.map(
      (point, index) => `P${index + 1},${formatCoordinate(point.x)},${formatCoordinate(point.y)}`
    )
  ].join('\n');
}

function formatCoordinate(value: number, precision = 3) {
  return value.toFixed(precision);
}

function clampLine(line: number, totalLines: number) {
  if (!Number.isFinite(line)) return 1;
  return Math.max(1, Math.min(Math.trunc(line), Math.max(totalLines, 1)));
}
