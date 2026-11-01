import { Value } from '@sinclair/typebox/value';
import type { CadSketchAngleRelation, CadSketchGraph, CadSketchGraphIssue } from './cadSketchGraph';
import { CadIdentifierSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import { cadSketchLineDirection, resolveCadSketchLinePair } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { resolveCadSketchGraphJoints } from './cadSketchGraphJoints';
import type { Point2 } from '@/domain/path-intel/types';
import { deepFreezeCadData } from './cadDeepFreeze';
import { cross, dot } from '@/domain/path-intel/segments';
import { CAD_PRECISION, cadRoundoff } from '@/domain/precision/cadPrecision';
import { CadSketchPositions } from './sketch-relations/cadSketchVirtualElements';

type Rays = CadSketchAngleRelation['rays'];
type Direction = NonNullable<ReturnType<typeof cadSketchLineDirection>>;
export interface CadSketchLineAngleGeometry {
  readonly vertex: Readonly<Point2>;
  readonly first: { readonly direction: Readonly<Point2>; readonly length: number };
  readonly second: { readonly direction: Readonly<Point2>; readonly length: number };
  readonly signedSweepRadians: number;
}
export interface CadSketchLineAngleSector { readonly relation: CadSketchAngleRelation; readonly geometry: CadSketchLineAngleGeometry }
type Sectors = readonly [CadSketchLineAngleSector, CadSketchLineAngleSector, CadSketchLineAngleSector, CadSketchLineAngleSector];
const angle = (a: Point2, b: Point2) => Math.atan2(cross(a, b), dot(a, b));
const ambiguous = () => new CadError('ambiguous-sketch-angle-sector', 'Choose the visible angle sector between the two lines.');

/** Source ownership only. Changed angle values may still have unsolved coordinates. */
export function resolveCadSketchAngleRays(graph: CadSketchGraph, rays: Rays) {
  return cadSketchAngleRaysOnLines(resolveCadSketchLinePair(graph, [rays[0].lineId, rays[1].lineId]), rays);
}
/** The rays on their resolved lines, each pointing toward an end of its own line. */
export function cadSketchAngleRaysOnLines(lines: ReturnType<typeof resolveCadSketchLinePair>, rays: Rays) {
  const resolve = (line: typeof lines[number], towardPointId: string) => {
    if (towardPointId !== line.startPointId && towardPointId !== line.endPointId)
      throw new CadError('invalid-sketch-angle-ray', 'Each angle ray must point toward an endpoint of its own line.');
    return { line, fromPointId: towardPointId === line.startPointId ? line.endPointId : line.startPointId, towardPointId };
  };
  return [resolve(lines[0], rays[0].towardPointId), resolve(lines[1], rays[1].towardPointId)] as const;
}

/** Public source values are degrees; native compilation uses a numeric radians copy only. */
export function cadSketchAngleTarget(relation: CadSketchAngleRelation, parameters: Readonly<Record<string, number>>) {
  return cadSketchDrivingAngle(evaluateCadScalar(relation.value, parameters), relation.sense);
}
/** An evaluated driving angle in degrees, between zero and 180, with its radians signed by the sector's sense. */
export function cadSketchDrivingAngle(degrees: number, sense: CadSketchAngleRelation['sense']) {
  const radians = degrees * Math.PI / 180;
  if (!(degrees > 0 && degrees < 180 && radians > 0 && radians < Math.PI))
    throw new CadError('invalid-sketch-angle', 'Driving angles must remain representably between zero and 180 degrees.');
  return { degrees, signedRadians: (sense === 'ccw' ? 1 : -1) * radians };
}

function rayDirections(graph: CadSketchGraph, rays: Rays, points: ReadonlyMap<string, Point2>) {
  const resolved = resolveCadSketchAngleRays(graph, rays);
  const direction = (ray: typeof resolved[number]) => {
    const numeric = cadSketchLineDirection(ray.line, points); if (!numeric) return null;
    const sign = ray.towardPointId === ray.line.endPointId ? 1 : -1;
    return { ...numeric, x: numeric.x * sign, y: numeric.y * sign };
  };
  const a = direction(resolved[0]), b = direction(resolved[1]);
  return a && b ? [a, b] as const : null;
}

/** No support intersection is needed for constraint acceptance. */
export function checkCadSketchAngleRelation(graph: CadSketchGraph, relation: CadSketchAngleRelation,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const rays = rayDirections(graph, relation.rays, points), target = cadSketchAngleTarget(relation, parameters);
    if (!rays) return [];
    const [a, b] = rays, actual = angle(a, b), difference = actual - target.signedRadians;
    const q = Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference)));
    const residualMm = 2 * Math.sin(q / 2) * Math.max(a.length, b.length);
    const sector = actual * (relation.sense === 'ccw' ? 1 : -1);
    return !(sector > 0 && sector < Math.PI) || !Number.isFinite(q) || q > CAD_PRECISION.angularAccuracyRad || residualMm > cadSketchDriverTolerance([a.start, a.end, b.start, b.end])
      ? [{ source, code: 'relation-residual', message: 'Sketch rays do not satisfy their driving angle.', ...(Number.isFinite(residualMm) ? { residualMm } : {}) }] : [];
  } catch (error) {
    return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid sketch angle.' }];
  }
}

/** The corner where two line supports meet, or a `sketch-angle-precision` error when it cannot be placed reliably. */
export function cadSketchLineSupportIntersection(a: Direction, b: Direction): Readonly<Point2> {
  const determinant = cross(a, b);
  if (Math.abs(determinant) <= cadRoundoff(32)) throw new CadError('sketch-angle-precision', 'These lines are too close to parallel to measure an angle between them.');
  const delta = { x: b.start.x - a.start.x, y: b.start.y - a.start.y }, distance = cross(delta, b) / determinant;
  const vertex = { x: a.start.x + a.x * distance, y: a.start.y + a.y * distance };
  if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || Math.abs(vertex.x) > 1e9 || Math.abs(vertex.y) > 1e9
    || [a, b].some(line => Math.abs(cross({ x: vertex.x - line.start.x, y: vertex.y - line.start.y }, line))
      > cadPathClosureTolerance([vertex, line.start, line.end])))
    throw new CadError('sketch-angle-precision', 'The angle\'s corner cannot be placed reliably at these coordinates. Move the lines nearer the origin.');
  return Object.freeze(vertex);
}
function geometry(vertex: Readonly<Point2>, a: Direction, b: Direction, sense: CadSketchAngleRelation['sense']): CadSketchLineAngleGeometry {
  let sweep = angle(a, b);
  if (sense === 'ccw' && sweep <= 0) sweep += 2 * Math.PI;
  if (sense === 'cw' && sweep >= 0) sweep -= 2 * Math.PI;
  return Object.freeze({ vertex, first: Object.freeze({ direction: Object.freeze({ x: a.x, y: a.y }), length: a.length }),
    second: Object.freeze({ direction: Object.freeze({ x: b.x, y: b.y }), length: b.length }), signedSweepRadians: sweep });
}

/** Display actual source geometry in the saved sense, never a silently substituted sector. */
export function cadSketchLineAngleGeometry(graph: CadSketchGraph, relation: CadSketchAngleRelation,
  points: ReadonlyMap<string, Point2>): CadSketchLineAngleGeometry {
  const rays = rayDirections(graph, relation.rays, points);
  if (!rays) throw new CadError('missing-sketch-point', 'The angle needs numeric source endpoints.');
  return geometry(cadSketchLineSupportIntersection(rays[0], rays[1]), rays[0], rays[1], relation.sense);
}

interface CreationInput {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
  readonly lineIds: readonly [string, string]; readonly relationId: string;
}
function prepare(input: CreationInput) {
  if (!Value.Check(CadIdentifierSchema, input.relationId)) throw new CadError('invalid-sketch-angle', 'Choose a valid angle relation identity.');
  // An axis's ends are the origin and its sample, which the positions always hold.
  const points = new CadSketchPositions(input.graph.points.map(point => [point.id,
    { x: evaluateCadScalar(point.position[0], input.parameters), y: evaluateCadScalar(point.position[1], input.parameters) }]));
  const lines = resolveCadSketchLinePair(input.graph, input.lineIds);
  const a = cadSketchLineDirection(lines[0], points), b = cadSketchLineDirection(lines[1], points);
  if (!a || !b) throw new CadError('missing-sketch-point', 'The angle needs numeric source endpoints.');
  return { points, lines, a, b, vertex: cadSketchLineSupportIntersection(a, b) };
}
function sectors(input: CreationInput, prepared: ReturnType<typeof prepare>): Sectors {
  const { lines, vertex } = prepared;
  const candidate = (firstToward: string, secondToward: string): CadSketchLineAngleSector => {
    const rays = [{ lineId: lines[0].id, towardPointId: firstToward }, { lineId: lines[1].id, towardPointId: secondToward }] as const;
    const directions = rayDirections(input.graph, rays, prepared.points);
    if (!directions) throw new CadError('missing-sketch-point', 'The angle needs numeric source endpoints.');
    const actual = angle(directions[0], directions[1]), sense = actual > 0 ? 'ccw' : 'cw';
    const relation: CadSketchAngleRelation = { id: input.relationId, kind: 'line-angle', rays, sense, value: Math.abs(actual) * 180 / Math.PI };
    cadSketchAngleTarget(relation, input.parameters); deepFreezeCadData(relation);
    return Object.freeze({ relation, geometry: geometry(vertex, directions[0], directions[1], sense) });
  };
  const startAngle = (sector: CadSketchLineAngleSector) => {
    const direction = sector.relation.sense === 'ccw' ? sector.geometry.first.direction : sector.geometry.second.direction;
    const angle = Math.atan2(direction.y, direction.x); return angle < 0 ? angle + 2 * Math.PI : angle;
  };
  const ordered = [candidate(lines[0].startPointId, lines[1].startPointId), candidate(lines[0].startPointId, lines[1].endPointId),
    candidate(lines[0].endPointId, lines[1].startPointId), candidate(lines[0].endPointId, lines[1].endPointId)].sort((a, b) => startAngle(a) - startAngle(b));
  return Object.freeze([ordered[0], ordered[1], ordered[2], ordered[3]] as const);
}

/** Four transient alternatives share one supplied source ID; indices are never persisted identities. */
export function cadSketchLineAngleSectors(input: CreationInput): Sectors { return sectors(input, prepare(input)); }

/** A natural corner or explicit quadrant chooses rays once; subsequent solves retain those exact refs. */
export function createCadSketchLineAngleRelation(input: CreationInput & { readonly placementPoint?: Point2 }): CadSketchAngleRelation {
  const prepared = prepare(input), options = sectors(input, prepared), { lines, vertex } = prepared;
  if (input.placementPoint) {
    const p = input.placementPoint, radial = { x: p.x - vertex.x, y: p.y - vertex.y };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)
      || [prepared.a, prepared.b].some(line => Math.abs(cross(line, radial)) <= cadPathClosureTolerance([vertex, p]))) throw ambiguous();
    const chosen = options.find(option => {
      const raw = angle(option.geometry.first.direction, radial) * (option.relation.sense === 'ccw' ? 1 : -1);
      const sweep = raw < 0 ? raw + 2 * Math.PI : raw;
      return sweep > 0 && sweep < Math.abs(option.geometry.signedSweepRadians);
    });
    if (!chosen) throw ambiguous(); return chosen.relation;
  }
  const joint = resolveCadSketchGraphJoints(input.graph, prepared.points);
  const common = [lines[0].startPointId, lines[0].endPointId].map(joint)
    .filter(id => [lines[1].startPointId, lines[1].endPointId].some(point => joint(point) === id));
  const toward = (line: typeof lines[number], numeric: Direction) => {
    if (common.length === 1) return joint(line.startPointId) === common[0] ? line.endPointId : line.startPointId;
    const a = dot({ x: numeric.start.x - vertex.x, y: numeric.start.y - vertex.y }, numeric);
    const b = dot({ x: numeric.end.x - vertex.x, y: numeric.end.y - vertex.y }, numeric);
    if (a >= 0 && b > 0) return line.endPointId;
    if (a < 0 && b <= 0) return line.startPointId;
    throw ambiguous();
  };
  const a = toward(lines[0], prepared.a), b = toward(lines[1], prepared.b);
  const chosen = options.find(option => option.relation.rays[0].towardPointId === a && option.relation.rays[1].towardPointId === b);
  if (!chosen) throw ambiguous(); return chosen.relation;
}
