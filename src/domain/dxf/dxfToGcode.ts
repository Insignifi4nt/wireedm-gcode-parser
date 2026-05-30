import type { DxfEntity, DxfLwPolylineVertex, DxfPoint } from './types';

const POSITION_EPSILON = 1e-6;

export function dxfEntitiesToGcodeBody(entities: DxfEntity[]) {
  const lines: string[] = [];
  let currentPosition: DxfPoint | null = null;

  for (const entity of entities) {
    if (entity.type === 'line') {
      currentPosition = addRapidIfNeeded(lines, currentPosition, entity.start);
      lines.push(`G1 ${xy(entity.end)}`);
      currentPosition = entity.end;
    } else if (entity.type === 'arc') {
      currentPosition = addRapidIfNeeded(lines, currentPosition, entity.start);
      lines.push(`G3 ${xy(entity.end)} ${ij(entity.center, entity.start)}`);
      currentPosition = entity.end;
    } else if (entity.type === 'circle') {
      const start = { x: entity.center.x + entity.radius, y: entity.center.y };
      const opposite = { x: entity.center.x - entity.radius, y: entity.center.y };
      currentPosition = addRapidIfNeeded(lines, currentPosition, start);
      lines.push(`G3 ${xy(opposite)} ${ij(entity.center, start)}`);
      lines.push(`G3 ${xy(start)} ${ij(entity.center, opposite)}`);
      currentPosition = start;
    } else if (entity.type === 'lwpolyline') {
      currentPosition = addPolyline(lines, currentPosition, entity.vertices, entity.closed);
    }
  }

  return lines.join('\n');
}

function addPolyline(
  lines: string[],
  currentPosition: DxfPoint | null,
  vertices: DxfLwPolylineVertex[],
  closed: boolean
) {
  if (vertices.length === 0) return currentPosition;

  let position = addRapidIfNeeded(lines, currentPosition, vertices[0]);
  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let index = 0; index < segmentCount; index++) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (Math.abs(start.bulge) <= POSITION_EPSILON) {
      lines.push(`G1 ${xy(end)}`);
    } else {
      const center = centerFromBulge(start, end, start.bulge);
      const command = start.bulge > 0 ? 'G3' : 'G2';
      lines.push(`${command} ${xy(end)} ${ij(center, start)}`);
    }
    position = end;
  }

  return position;
}

function addRapidIfNeeded(
  lines: string[],
  currentPosition: DxfPoint | null,
  target: DxfPoint
) {
  if (!pointsEqual(currentPosition, target)) {
    lines.push(`G0 ${xy(target)}`);
  }
  return target;
}

function centerFromBulge(start: DxfLwPolylineVertex, end: DxfPoint, bulge: number) {
  const chord = distance(start, end);
  const includedAngle = 4 * Math.atan(Math.abs(bulge));
  const apothem = chord / (2 * Math.tan(includedAngle / 2));
  const unit = {
    x: (end.x - start.x) / chord,
    y: (end.y - start.y) / chord
  };
  const leftNormal = { x: -unit.y, y: unit.x };
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const sign = Math.sign(bulge);

  return {
    x: midpoint.x + sign * leftNormal.x * apothem,
    y: midpoint.y + sign * leftNormal.y * apothem
  };
}

function pointsEqual(a: DxfPoint | null, b: DxfPoint) {
  if (!a) return false;
  return Math.abs(a.x - b.x) <= POSITION_EPSILON && Math.abs(a.y - b.y) <= POSITION_EPSILON;
}

function distance(a: DxfPoint, b: DxfPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function xy(point: DxfPoint) {
  return `X${formatNumber(point.x)} Y${formatNumber(point.y)}`;
}

function ij(center: DxfPoint, start: DxfPoint) {
  return `I${formatNumber(center.x - start.x)} J${formatNumber(center.y - start.y)}`;
}

function formatNumber(value: number) {
  return value.toFixed(3);
}
