import type { Point2 } from '@/domain/path-intel/types';

import {
  distanceToMotion, distanceToPolygon, interpolateLine, interpolateMotion, pointInPolygon, polygonCrossings
} from './geometry';
import { releasedPieceSnapshots } from './releasedPieces';
import type { SimulationDiagnostic, SimulationPieceSnapshot, SimulationPlan, SimulationStep, SimulationWarning } from './types';

const MAX_SCAN_SAMPLES = 100_000;
const EPSILON = 1e-7;

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
  const steps = [...plan.steps];
  const last = steps.at(-1);
  if (last && plan.durationSeconds > last.endSeconds) steps.push({ ...last,
    startSeconds: last.endSeconds, endSeconds: plan.durationSeconds });
  let samples = 0;
  for (const step of steps) {
    if (step.endSeconds <= step.startSeconds) continue;
    const fractions = sampleFractions(step, plan, stockPolygon);
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
      const guideStockOverlap = (wireBottom >= stock.bottomZ && wireBottom <= stock.bottomZ + stock.thickness)
        || (wireTop >= stock.bottomZ && wireTop <= stock.bottomZ + stock.thickness);
      if (plan.settings.guideRadiusMm > 0 && guideStockOverlap
        && intersectsMaterial(point, stockPolygon, released.stockHoles, plan.settings.guideRadiusMm)) add(null, 'guide');
      for (const piece of released.pieces) {
        // The nominal boundary represents a centerline cut. Half the wire diameter is
        // removed on either side, so normal contact along that same cut is not an obstruction.
        const insideMaterial = intersectsMaterial(point, piece.polygon, piece.holes, 0)
          && distanceToPolygon(point, piece.polygon) > EPSILON
          && piece.holes.every((hole) => distanceToPolygon(point, hole) > EPSILON);
        if (step.wireThreaded && piece.topZ > wireBottom + EPSILON && piece.bottomZ < wireTop - EPSILON && insideMaterial) add(piece, 'wire');
        const guideOverlap = (piece.bottomZ - EPSILON <= wireBottom && piece.topZ + EPSILON >= wireBottom)
          || (piece.bottomZ - EPSILON <= wireTop && piece.topZ + EPSILON >= wireTop);
        if (plan.settings.guideRadiusMm > 0 && guideOverlap && intersectsMaterial(point, piece.polygon, piece.holes,
          Math.max(0, plan.settings.guideRadiusMm - radius))) add(piece, 'guide');
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

function sampleFractions(step: SimulationStep, plan: SimulationPlan, stockPolygon: readonly Point2[]): number[] {
  const fractions = new Set<number>([0, 1]);
  const count = Math.min(4096, Math.max(8, Math.ceil(step.lengthMm / Math.max(0.25, plan.settings.wireDiameter))));
  for (let i = 1; i < count; i++) fractions.add(i / count);
  // Edge crossings partition linear travel into inside/outside intervals. This retains
  // thin obstacles that a regular fixed-distance grid alone could skip.
  for (let i = 1; i < step.path.length; i++) {
    for (const polygon of [stockPolygon, ...plan.pieces.map(({ polygon }) => polygon)]) {
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
    if (plan.settings.retention !== 'fall') continue;
    let fallStart = piece.releaseSeconds;
    let ancestorId = piece.parentPieceId;
    while (ancestorId) {
      const ancestor = plan.pieces.find(({ id }) => id === ancestorId);
      if (!ancestor) break;
      fallStart = Math.min(fallStart, ancestor.releaseSeconds);
      ancestorId = ancestor.parentPieceId;
    }
    // Times at which the falling extrusion first meets and then clears the lower guide/wire.
    for (const drop of [plan.settings.guideClearanceMm, plan.settings.guideClearanceMm + plan.settings.stock.thickness]) {
      addTime(fallStart + Math.sqrt(2 * drop / 9810));
    }
  }
  const ordered = [...fractions].sort((a, b) => a - b);
  return [...new Set([...ordered, ...ordered.slice(1).map((value, i) => (ordered[i] + value) / 2)])].sort((a, b) => a - b);
}

function sorted(warnings: SimulationWarning[]): SimulationWarning[] {
  return warnings.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds || a.id.localeCompare(b.id));
}
