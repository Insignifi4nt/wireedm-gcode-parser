import type { CadSketchGraph, CadSketchCornerRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { signedSweep } from '@/domain/path-intel/segments';
import type { Point2 } from '@/domain/path-intel/types';

export const cornerSub = (a: Point2, b: Point2): Point2 => ({ x: a.x - b.x, y: a.y - b.y });
export const cornerLength = (a: Point2): number => Math.hypot(a.x, a.y);
export const cornerDot = (a: Point2, b: Point2): number => a.x * b.x + a.y * b.y;
export const cornerCross = (a: Point2, b: Point2): number => a.x * b.y - a.y * b.x;
export function cadSketchCornerFrame(vertex: Point2, a: Point2, b: Point2) {
  const va = cornerSub(a, vertex), vb = cornerSub(b, vertex), lengthA = cornerLength(va), lengthB = cornerLength(vb);
  if (lengthA <= 1e-7 || lengthB <= 1e-7) throw new CadError('invalid-corner-geometry', 'Corner supports must have positive length.');
  const u = { x: va.x / lengthA, y: va.y / lengthA }, v = { x: vb.x / lengthB, y: vb.y / lengthB }, cross = cornerCross(u, v);
  const uncertainty = 16 * Number.EPSILON + 4 * cadPathClosureTolerance([vertex, a, b]) * (1 / lengthA + 1 / lengthB);
  if (Math.abs(cross) <= uncertainty) throw new CadError('invalid-corner-geometry', 'Collinear or numerically uncertain lines cannot define a corner.');
  return { u, v, lengthA, lengthB, cross, angle: Math.atan2(Math.abs(cross), cornerDot(u, v)) };
}

/** Topology only: changed drivers are unsolved intent until the shared solver runs. */
export function resolveCadSketchCornerTopology(graph: CadSketchGraph, relation: CadSketchCornerRelation) {
  const lines = relation.lineIds.map(id => graph.entities.find(entity => entity.id === id));
  const entity = graph.entities.find(entity => entity.id === (relation.kind === 'fillet-corner' ? relation.arcId : relation.chamferId));
  if (lines[0]?.kind !== 'line' || lines[1]?.kind !== 'line' || !entity || entity.kind !== (relation.kind === 'fillet-corner' ? 'arc' : 'line'))
    throw new CadError('invalid-corner-topology', 'Corner treatment needs its two lines and exact arc or chamfer entity.');
  if (relation.lineIds[0] >= relation.lineIds[1] || new Set([...relation.lineIds, entity.id]).size !== 3
      || entity.construction || lines.some(line => line?.construction))
    throw new CadError('invalid-corner-topology', 'Corner treatment needs distinct canonically ordered nonconstruction entities.');
  const trims: string[] = [], far: string[] = [];
  for (const line of [lines[0], lines[1]]) {
    const ends = [line.startPointId, line.endPointId], shared = ends.filter(id => id === entity.startPointId || id === entity.endPointId);
    if (shared.length !== 1) throw new CadError('invalid-corner-topology', 'Each corner line must share exactly one treatment endpoint.');
    trims.push(shared[0]); far.push(ends[0] === shared[0] ? ends[1] : ends[0]);
  }
  const centerPointId = entity.kind === 'arc' ? entity.centerPointId : null;
  if (new Set([relation.pointId, ...trims, ...far, ...(centerPointId ? [centerPointId] : [])]).size !== (centerPointId ? 6 : 5))
    throw new CadError('invalid-corner-topology', 'Corner support, trim, center and retained vertex identities must be distinct.');
  return { lines: [lines[0], lines[1]] as const, entity, vertexId: relation.pointId,
    trimPointIds: [trims[0], trims[1]] as const, farPointIds: [far[0], far[1]] as const, centerPointId };
}

/** Independent world-mm acceptance, including branches not expressed by native equalities. */
export function checkCadSketchCornerRelation(graph: CadSketchGraph, relation: CadSketchCornerRelation,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const issues: CadSketchGraphIssue[] = [], source = { kind: 'relation', id: relation.id } as const;
  const fail = (message: string, residualMm?: number) => issues.push({ source, code: 'relation-residual', message,
    ...(residualMm === undefined ? {} : { residualMm }) });
  const topology = resolveCadSketchCornerTopology(graph, relation);
  const vertex = points.get(topology.vertexId), a = points.get(topology.farPointIds[0]), b = points.get(topology.farPointIds[1]);
  const p = points.get(topology.trimPointIds[0]), q = points.get(topology.trimPointIds[1]);
  if (!vertex || !a || !b || !p || !q) return issues; // The owning point check already reports invalid coordinates.
  const residual = (name: string, value: number, operands: Point2[]) => {
    if (!Number.isFinite(value) || value > cadPathClosureTolerance(operands)) fail(`Corner ${name} does not satisfy its construction.`, Number.isFinite(value) ? value : undefined);
  };
  try {
    const frame = cadSketchCornerFrame(vertex, a, b);
    for (const [far, trim, axis, extent] of [[a, p, frame.u, frame.lengthA], [b, q, frame.v, frame.lengthB]] as const) {
      const line = cornerSub(trim, far), lineLength = cornerLength(line);
      residual('support', Math.abs(cornerCross(cornerSub(vertex, far), line)) / lineLength, [vertex, far, trim]);
      const projection = cornerDot(cornerSub(trim, vertex), axis);
      if (!(projection > 0 && extent - projection > 1e-7)) fail('Corner trim must remain strictly between its retained vertex and far endpoint.');
    }
    if (relation.kind === 'fillet-corner' && topology.entity.kind === 'arc') {
      const center = points.get(topology.entity.centerPointId); if (!center) return issues;
      const radius = evaluateCadScalar(relation.value, parameters);
      if (!(radius > 1e-7 && radius <= 1e6)) fail('Corner radius must be positive and within one million millimetres.');
      residual('radius', Math.abs(cornerLength(cornerSub(center, p)) - radius), [center, p]);
      for (const [far, trim] of [[a, p], [b, q]] as const) residual('tangency',
        Math.abs(cornerDot(cornerSub(center, trim), cornerSub(far, trim))) / cornerLength(cornerSub(far, trim)), [center, trim, far]);
      const start = topology.entity.startPointId === topology.trimPointIds[0] ? p : q;
      const end = topology.entity.endPointId === topology.trimPointIds[1] ? q : p;
      const s = cornerSub(start, center), e = cornerSub(end, center);
      const sweep = signedSweep(Math.atan2(s.y, s.x), Math.atan2(e.y, e.x), topology.entity.direction === 'cw');
      const expectedSign = -Math.sign(frame.cross) * (start === p ? 1 : -1);
      if (Math.sign(sweep) !== expectedSign || Math.abs(sweep) >= Math.PI) fail('Corner fillet must retain its intended minor arc branch.');
    } else if (relation.kind === 'chamfer-corner') {
      for (const [trim, value] of [[p, relation.values[0]], [q, relation.values[1]]] as const) {
        const distance = evaluateCadScalar(value, parameters);
        if (!(distance > 1e-7 && distance <= 1e6)) fail('Corner setbacks must be positive and within one million millimetres.');
        residual('setback', Math.abs(cornerLength(cornerSub(trim, vertex)) - distance), [trim, vertex]);
      }
    }
  } catch (error) { fail(error instanceof Error ? error.message : 'Invalid corner construction.'); }
  return issues;
}
