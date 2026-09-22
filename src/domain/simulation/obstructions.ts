import type { Point2 } from '@/domain/path-intel/types';

import {
  distanceToMotion, distanceToPolygon, interpolateLine, interpolateMotion, pointInPolygon, polygonCrossings
} from './geometry';
import { releasedPieceSnapshots } from './releasedPieces';
import type { SimulationDiagnostic, SimulationPieceSnapshot, SimulationPlan, SimulationStep, SimulationWarning } from './types';

const MAX_SCAN_SAMPLES = 100_000;
const EPSILON = 1e-7;
interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
interface BoundedPolygon { polygon: readonly Point2[]; bounds: Bounds }

/** Advisory geometric screening; it never changes the execution plan or machining decisions. */
export function compileObstructions(plan: SimulationPlan): { warnings: SimulationWarning[]; diagnostics: SimulationDiagnostic[] } {
  const warnings: SimulationWarning[] = [];
  const keys = new Set<string>();
  const stock = plan.settings.stock;
  const stockPolygon = [
    { x: stock.originX, y: stock.originY }, { x: stock.originX + stock.width, y: stock.originY },
    { x: stock.originX + stock.width, y: stock.originY + stock.depth }, { x: stock.originX, y: stock.originY + stock.depth }
  ];
  const wireBottom = stock.bottomZ - plan.settings.guideClearanceMm;
  const wireTop = stock.bottomZ + stock.thickness + plan.settings.guideClearanceMm;
  const radius = plan.settings.wireDiameter / 2;
  const guideReach = Math.max(0, plan.settings.guideRadiusMm - radius);
  // Match the rendered guide bodies beyond each wire end, using their maximum radius.
  const guideHeight = plan.settings.guideRadiusMm * 2;
  const overlapsGuide = (bottomZ: number, topZ: number) =>
    bottomZ <= wireBottom + EPSILON && topZ >= wireBottom - guideHeight - EPSILON
    || bottomZ <= wireTop + guideHeight + EPSILON && topZ >= wireTop - EPSILON;
  const guideStockOverlap = overlapsGuide(stock.bottomZ, stock.bottomZ + stock.thickness);
  const polygons: BoundedPolygon[] = [stockPolygon, ...plan.pieces.map(({ polygon }) => polygon)]
    .map((polygon) => ({ polygon, bounds: polygonBounds(polygon) }));
  const boundsByPolygon = new Map(polygons.map(({ polygon, bounds }) => [polygon, bounds]));
  const steps = [...plan.steps];
  const last = steps.at(-1);
  if (last && plan.durationSeconds > last.endSeconds) steps.push({ ...last,
    startSeconds: last.endSeconds, endSeconds: plan.durationSeconds });
  let samples = 0;
  for (const step of steps) {
    if (step.endSeconds <= step.startSeconds) continue;
    const fractions = sampleFractions(step, plan, polygons);
    for (const fraction of fractions) {
      if (++samples > MAX_SCAN_SAMPLES) return { warnings: sorted(warnings), diagnostics: [{
        code: 'SIMULATION_OBSTRUCTION_SCAN_LIMIT', severity: 'warning', operationId: null,
        message: 'The bounded obstruction scan reached its sample limit. Later travel has not been checked.'
      }] };
      const time = step.startSeconds + (step.endSeconds - step.startSeconds) * fraction;
      const point = stepPoint(step, fraction);
      const released = releasedPieceSnapshots(plan.pieces, plan.settings, time);
      const add = (piece: SimulationPieceSnapshot | null, envelope: 'wire' | 'guide') => {
        const key = `${step.event.id}:${piece?.id ?? 'stock'}:${envelope}`;
        if (keys.has(key)) return;
        keys.add(key);
        warnings.push({ id: `obstruction:${key}`, code: piece ? 'SIMULATION_RELEASED_PIECE_OBSTRUCTION' : 'SIMULATION_UNCUT_STOCK_OBSTRUCTION',
          message: piece ? `The ${envelope} envelope intersects released material (${piece.operationId}) in this scenario.`
            : `The ${envelope} envelope crosses rough stock outside the simulated cut openings.`,
          elapsedSeconds: time, eventId: step.event.id, operationId: step.event.operationId,
          pieceId: piece?.id ?? null, point, envelope });
      };
      if (step.event.kind === 'position' && step.wireThreaded && fraction > 0
        && (pointInPolygon(point, stockPolygon) || distanceToPolygon(point, stockPolygon) < radius)
        && !released.stockHoles.some((hole) => pointInPolygon(point, hole))
        && !plan.steps.some((cut) => cut.endSeconds <= time && cut.event.kind === 'motion'
          && distanceToMotion(point, cut.event) <= radius + EPSILON)) add(null, 'wire');
      if (plan.settings.guideRadiusMm > 0 && guideStockOverlap
        && intersectsMaterial(point, stockPolygon, released.stockHoles, plan.settings.guideRadiusMm)) add(null, 'guide');
      for (const piece of released.pieces) {
        // Preserve the full wire/guide reach, including edge tolerances, before skipping detailed polygon work.
        if (!pointWithinBounds(point, boundsByPolygon.get(piece.polygon)!, guideReach + EPSILON)) continue;
        // The nominal boundary represents a centerline cut. Half the wire diameter is
        // removed on either side, so normal contact along that same cut is not an obstruction.
        const insideMaterial = intersectsMaterial(point, piece.polygon, piece.holes, 0)
          && distanceToPolygon(point, piece.polygon) > EPSILON
          && piece.holes.every((hole) => distanceToPolygon(point, hole) > EPSILON);
        if (step.wireThreaded && piece.topZ > wireBottom + EPSILON && piece.bottomZ < wireTop - EPSILON && insideMaterial) add(piece, 'wire');
        if (plan.settings.guideRadiusMm > 0 && overlapsGuide(piece.bottomZ, piece.topZ) && intersectsMaterial(point, piece.polygon, piece.holes,
          guideReach)) add(piece, 'guide');
      }
    }
  }
  return { warnings: sorted(warnings), diagnostics: [] };
}

function intersectsMaterial(point: Point2, polygon: readonly Point2[], holes: readonly (readonly Point2[])[], radius: number): boolean {
  const intersectsOutline = pointInPolygon(point, polygon) || distanceToPolygon(point, polygon) <= radius;
  return intersectsOutline && !holes.some((hole) => pointInPolygon(point, hole) && distanceToPolygon(point, hole) > radius);
}

function stepPoint(step: SimulationStep, fraction: number): Point2 {
  return step.event.kind === 'motion' ? interpolateMotion(step.event, fraction)
    : step.event.kind === 'position' ? interpolateLine(step.event.from, step.event.to, fraction)
      : step.path[0];
}

function sampleFractions(step: SimulationStep, plan: SimulationPlan, polygons: readonly BoundedPolygon[]): number[] {
  const fractions = new Set<number>([0, 1]);
  const count = Math.min(4096, Math.max(8, Math.ceil(step.lengthMm / Math.max(0.25, plan.settings.wireDiameter))));
  for (let i = 1; i < count; i++) fractions.add(i / count);
  // Edge crossings partition linear travel into inside/outside intervals. This retains
  // thin obstacles that a regular fixed-distance grid alone could skip.
  for (let i = 1; i < step.path.length; i++) {
    const segmentBounds = polygonBounds([step.path[i - 1], step.path[i]]);
    for (const { polygon, bounds } of polygons) {
      if (!boundsOverlap(segmentBounds, bounds)) continue;
      for (const fraction of polygonCrossings(step.path[i - 1], step.path[i], polygon)) {
        fractions.add((i - 1 + fraction) / (step.path.length - 1));
      }
    }
  }
  const duration = step.endSeconds - step.startSeconds;
  const addTime = (time: number) => {
    const fraction = (time - step.startSeconds) / duration;
    if (fraction > 0 && fraction < 1) fractions.add(fraction);
  };
  for (const piece of plan.pieces) {
    addTime(piece.releaseSeconds);
    if (piece.removalSeconds !== null) addTime(piece.removalSeconds);
    if (plan.settings.retention !== 'fall') continue;
    let fallStart = piece.releaseSeconds;
    let ancestorId = piece.parentPieceId;
    while (ancestorId) {
      const ancestor = plan.pieces.find(({ id }) => id === ancestorId);
      if (!ancestor) break;
      fallStart = Math.min(fallStart, ancestor.releaseSeconds);
      ancestorId = ancestor.parentPieceId;
    }
    // Partition contacts at both guide-body ends as well as the wire-end plane.
    const guideHeight = plan.settings.guideRadiusMm * 2;
    for (const drop of [plan.settings.guideClearanceMm, plan.settings.guideClearanceMm + plan.settings.stock.thickness,
      plan.settings.guideClearanceMm + guideHeight, plan.settings.guideClearanceMm + guideHeight + plan.settings.stock.thickness]) {
      addTime(fallStart + Math.sqrt(2 * drop / 9810));
    }
  }
  const ordered = [...fractions].sort((a, b) => a - b);
  return [...new Set([...ordered, ...ordered.slice(1).map((value, i) => (ordered[i] + value) / 2)])].sort((a, b) => a - b);
}

function polygonBounds(polygon: readonly Point2[]): Bounds {
  const bounds: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const point of polygon) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  return bounds;
}

function pointWithinBounds(point: Point2, bounds: Bounds, radius: number): boolean {
  return point.x >= bounds.minX - radius && point.x <= bounds.maxX + radius
    && point.y >= bounds.minY - radius && point.y <= bounds.maxY + radius;
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.maxX + EPSILON >= b.minX && a.minX - EPSILON <= b.maxX
    && a.maxY + EPSILON >= b.minY && a.minY - EPSILON <= b.maxY;
}

function sorted(warnings: SimulationWarning[]): SimulationWarning[] {
  return warnings.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds || a.id.localeCompare(b.id));
}
