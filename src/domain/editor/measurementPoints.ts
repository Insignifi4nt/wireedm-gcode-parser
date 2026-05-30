import { buildISOFromPoints, type BuildISOFromPointsOptions } from './isoNormalizer';

export interface MeasurementPoint {
  id: string;
  x: number;
  y: number;
}

export interface InsertMeasurementPointsOptions {
  insertAfterLine?: number;
}

export interface InsertMeasurementPointsResult {
  text: string;
  insertedLineNumbers: number[];
}

export interface ExportMeasurementPointsGCodeOptions {
  includeHeader?: boolean;
  now?: Date;
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
  const insertedLines = points.flatMap((point, index) => [
    `; inserted G0 P${index + 1}`,
    `G0 X${formatCoordinate(point.x)} Y${formatCoordinate(point.y)}`
  ]);

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

export function exportMeasurementPointsAsGCode(
  points: MeasurementPoint[],
  options: ExportMeasurementPointsGCodeOptions = {}
) {
  const includeHeader = options.includeHeader !== false;
  const lines: string[] = [];

  if (includeHeader) {
    lines.push('; Wire EDM clicked points export');
    lines.push(`; Generated on ${(options.now ?? new Date()).toLocaleString()}`);
    lines.push(`; Total points: ${points.length}`);
    lines.push('');
  }

  points.forEach((point, index) => {
    lines.push(`; Point ${index + 1}`);
    lines.push(`G0 X${formatCoordinate(point.x)} Y${formatCoordinate(point.y)}`);
  });

  if (includeHeader) {
    lines.push('');
    lines.push('; End of exported points');
  }

  return `${lines.join('\n')}\n`;
}

export function exportMeasurementPointsAsISO(
  points: MeasurementPoint[],
  options: BuildISOFromPointsOptions = {}
) {
  return buildISOFromPoints(points, options);
}

function formatCoordinate(value: number) {
  return value.toFixed(3);
}

function clampLine(line: number, totalLines: number) {
  if (!Number.isFinite(line)) return 1;
  return Math.max(1, Math.min(Math.trunc(line), Math.max(totalLines, 1)));
}
