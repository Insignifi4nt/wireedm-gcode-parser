import type { Point2 } from '@/domain/path-intel/types';
import { CAD_PRECISION } from '@/domain/precision/cadPrecision';
import type { CadSketchGraphEntity } from '../cadSketchGraph';
import { cadSketchLineDirection } from '../cadSketchLineRelations';
import { cadSketchDriverTolerance } from '../cadSketchPrecision';
import { cadSketchMirrorImage, cadSketchMirrorPairings, cadSketchPointsReflect, type CadSketchMirroredCurve, type CadSketchMirrorPair } from '../cadSketchSymmetryRelations';
import { isCadSketchVirtualAxisId } from '../sketch-relations/cadSketchVirtualElements';
import type { CadSketchLoweringContext, CadSketchPointHold } from './cadSketchLoweringContext';

// Where a Symmetric of two curves starts its solve, and which way it pairs their points: a few candidate starts, tried least moved first.

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;
type Axis = NonNullable<ReturnType<typeof cadSketchLineDirection>>;
/** One start: a pairing, the mirror line it sets out on, how far it turns the mirror, and where it starts points, by identity. */
interface Candidate {
  readonly pairs: readonly CadSketchMirrorPair[];
  readonly pairing: number;
  readonly turn: number;
  readonly cost: number;
  readonly seeds: ReadonlyMap<string, readonly [string, Point2]>;
}
/** A pairing that the relations already lowered leave open, with its place among the pairings the curves can take. */
interface Pairing { readonly pairs: readonly CadSketchMirrorPair[]; readonly index: number }

/** An angle wrapped into a quarter turn either way, as directions are modulo a half turn. */
const wrap = (angle: number) => ((angle + Math.PI / 2) % Math.PI + Math.PI) % Math.PI - Math.PI / 2;
const angleOf = (axis: Axis) => Math.atan2(axis.y, axis.x);
const through = (point: Point2, angle: number): Axis => {
  const x = Math.cos(angle), y = Math.sin(angle);
  return { x, y, length: 1, start: point, end: { x: point.x + x, y: point.y + y } };
};
const full = (hold: CadSketchPointHold) => hold.x !== undefined && hold.y !== undefined;
const holding = (point: Point2, hold: CadSketchPointHold): Point2 => ({ x: hold.x ?? point.x, y: hold.y ?? point.y });
const apart = (first: Point2, second: Point2) => Math.hypot(second.x - first.x, second.y - first.y) > cadSketchDriverTolerance([first, second]);
/** Whether a point lies on the axis's infinite line, as a point the mirror maps onto itself does. */
const onAxis = (point: Point2, axis: Axis) => cadSketchPointsReflect(point, point, axis);
/** Whether a place keeps what holds a point, within the driver tolerance. */
const fits = (place: Point2, hold: CadSketchPointHold) => !apart(place, holding(place, hold));

/**
 * The point pairs a Symmetric of two curves lowers, after starting the solve where it sets out. Pairs that relations lowered before it
 * keep about the same line, point Symmetrics or another curve Symmetric, are kept: only a pairing that keeps them is taken, and only
 * where none does are all considered. Where the pairing nearest the mirror images already holds, nothing starts anywhere else, so a
 * drag or a re-solve of a kept mirror does no more. Otherwise the candidates are each pairing on each mirror line it can take:
 * - a mirror line that is an axis, or whose ends are both held, stays where it is;
 * - a free one lies on the perpendicular bisector of a pair held at two places, in a direction the lines' relations allow it where
 *   they force one (see `directions`);
 * - else in each direction they force, through a point held on the mirror, a point the curves share, or else its own middle;
 * - else through two points held on the mirror, or where it is.
 * Each candidate puts the second point of each pair at the first's image, or the first at the second's where what holds the second
 * refuses that, or both where the holds of each leave them only together; a point both curves share goes onto the mirror. A free mirror
 * line keeps its length and the sense of its ends. A candidate that would move a held coordinate, or leave a held point off the mirror,
 * is dropped. The rest are ordered by the summed squared movement of every point they start, least first; within
 * `CAD_PRECISION.mirrorPairingTieRelative` of each other, the one that turns the mirror counter-clockwise more, then start with start.
 * The relation solves from the first (see `CadSketchLoweringContext.choose`), and a failed solve tries the others in turn. Where
 * none survives, the nearest pairing starts about the mirror where it is, as the solve would refuse every candidate anyway; and where
 * the candidates were every line the mirror could take, no solve can meet it, so the relations that keep what refused them are
 * recorded (see `CadSketchLoweringContext.unmet`) for a solve that names nothing, as one that collapses the curves does not.
 */
export function startCadSketchMirror(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], line: Line, context: CadSketchLoweringContext): readonly CadSketchMirrorPair[] {
  const identity = (pointId: string) => context.identity(pointId), position = (pointId: string) => {
    const place = context.starts.get(pointId);
    if (!place) throw new Error(`Sketch point "${pointId}" has no position to mirror from.`);
    return place;
  };
  const now = cadSketchLineDirection(line, context.starts)!, pairings = kept(cadSketchMirrorPairings(curves, identity), context.partners(line.id), identity);
  const nearest = pairings.reduce((best, item) => gap(item.pairs, now, position) < gap(best.pairs, now, position) * (1 - CAD_PRECISION.mirrorPairingTieRelative) ? item : best);
  if (nearest.pairs.every(({ pointIds: [p, q] }) => cadSketchPointsReflect(position(p), position(q), now))) return nearest.pairs;

  const axis = isCadSketchVirtualAxisId(line.id), ends = axis ? [] : [line.startPointId, line.endPointId];
  const free = !axis && !ends.every(end => full(context.held(end))), endIds = new Set(ends.map(identity));
  const allowed = free ? directions(curves, line, context) : undefined;
  const candidates: Candidate[] = [];
  let every = true;
  for (const pairing of pairings) {
    const { axes, exhaustive } = free ? lines(pairing.pairs, line, allowed, endIds, context, now) : { axes: [now], exhaustive: true };
    every &&= exhaustive;
    for (const mirror of axes) {
      const found = candidate(curves, pairing, mirror, mirror === now ? undefined : line, exhaustive, endIds, context, now);
      if (found) candidates.push(found);
    }
  }
  if (!candidates.length) {
    if (every) context.unmet(blockers(curves, line, allowed !== undefined, context));
    for (const { pointIds: [p, q], self } of nearest.pairs) {
      const from = position(p), to = position(q);
      if (!self && !cadSketchPointsReflect(from, to, now) && !context.start(q, cadSketchMirrorImage(from, now))) context.start(p, cadSketchMirrorImage(to, now));
    }
    return nearest.pairs;
  }
  candidates.sort((first, second) => Math.abs(first.cost - second.cost) > CAD_PRECISION.mirrorPairingTieRelative * Math.max(first.cost, second.cost) ? first.cost - second.cost
    : Math.abs(first.turn - second.turn) > CAD_PRECISION.angularAccuracyRad ? second.turn - first.turn : first.pairing - second.pairing);
  const chosen = candidates[context.choose(candidates.length)];
  for (const [pointId, place] of chosen.seeds.values()) context.start(pointId, place);
  return chosen.pairs;
}

/** The pairings that keep every pair the partners hold, by identity; all of them where none does, which the solve then refuses. */
function kept(pairings: readonly (readonly CadSketchMirrorPair[])[], partners: ReadonlyMap<string, string>, identity: (pointId: string) => string): readonly Pairing[] {
  const all = pairings.map((pairs, index) => ({ pairs, index }));
  if (!partners.size) return all;
  const keeps = (pairs: readonly CadSketchMirrorPair[]) => pairs.every(({ pointIds: [p, q] }) => {
    const [first, second] = [identity(p), identity(q)], [one, other] = [partners.get(first), partners.get(second)];
    return (one === undefined || one === second) && (other === undefined || other === first);
  });
  const keeping = all.filter(item => keeps(item.pairs));
  return keeping.length ? keeping : all;
}

/** The summed squared distances of each pair's second point from the first's image about the axis: how far the pairing is from holding. */
function gap(pairs: readonly CadSketchMirrorPair[], axis: Axis, position: (pointId: string) => Point2): number {
  return pairs.reduce((sum, { pointIds: [p, q] }) => {
    const image = cadSketchMirrorImage(position(p), axis), to = position(q);
    return sum + (image.x - to.x) ** 2 + (image.y - to.y) ** 2;
  }, 0);
}

/**
 * The directions, modulo a half turn, a free mirror line can take: its own where relations or fixed ends keep it, or for two lines the
 * two a quarter turn apart that map one line's kept direction onto the other's (the planner's `mirrorTurn`). Undefined where nothing
 * keeps it.
 */
function directions(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], line: Line, context: CadSketchLoweringContext): readonly number[] | undefined {
  const own = context.lineAngle(line.id);
  if (own !== undefined) return [own];
  const [a, b] = curves;
  if (a.kind !== 'line' || b.kind !== 'line') return undefined;
  const forced = context.mirrorTurn(a.id, b.id, line.id);
  if (!forced) return undefined;
  const first = forced.fromFirst ? cadSketchLineDirection(a, context.starts) : undefined;
  if (forced.fromFirst && !first) return undefined;
  const doubled = forced.doubled + (first ? 2 * Math.atan2(first.y, first.x) : 0);
  return [doubled / 2, doubled / 2 + Math.PI / 2];
}

/**
 * The mirror lines a free mirror can take for one pairing: through the middle of a pair held at two places, at its perpendicular
 * bisector or each allowed direction; else through a point held on the mirror, at each allowed direction or toward a second held
 * point; else, where directions are allowed, through a point the curves share or the mirror's middle; else the line where it is. Each
 * keeps every held pair reflected and every held point on it. They are `exhaustive`, every line the mirror could take for the pairing,
 * where held points fix it: a held pair, or a held point with an allowed direction or a second held point.
 */
function lines(pairs: readonly CadSketchMirrorPair[], line: Line, allowed: readonly number[] | undefined, endIds: ReadonlySet<string>, context: CadSketchLoweringContext,
  now: Axis): { readonly axes: readonly Axis[]; readonly exhaustive: boolean } {
  const at = (pointId: string) => context.starts.get(pointId)!, held = (pointId: string) => holding(at(pointId), context.held(pointId));
  const pins = [line.startPointId, line.endPointId].filter(end => full(context.held(end))).map(held), heldPairs: (readonly [Point2, Point2])[] = [];
  for (const { pointIds: [p, q], self } of pairs) {
    if (!full(context.held(p)) || !self && !full(context.held(q))) continue;
    if (self || !apart(held(p), held(q))) pins.push(held(p));
    else heldPairs.push([held(p), held(q)]);
  }
  const shared = pairs.find(pair => pair.self && !endIds.has(context.identity(pair.pointIds[0])))?.pointIds[0];
  const second = pins.find(pin => apart(pin, pins[0]));
  const middle = { x: (now.start.x + now.end.x) / 2, y: (now.start.y + now.end.y) / 2 };
  let from: Point2, angles: readonly number[];
  if (heldPairs.length) {
    const [p, q] = heldPairs[0];
    from = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    angles = allowed ?? [Math.atan2(q.y - p.y, q.x - p.x) + Math.PI / 2];
  } else if (pins.length) {
    from = pins[0];
    angles = allowed ?? [second ? Math.atan2(second.y - pins[0].y, second.x - pins[0].x) : angleOf(now)];
    if (!allowed && !second && onAxis(pins[0], now)) return { axes: [now], exhaustive: false };
  } else if (allowed) {
    from = shared === undefined ? middle : at(shared);
    angles = allowed;
  } else return { axes: [now], exhaustive: false };
  const axes = angles.map(angle => through(from, angle)).filter(axis => heldPairs.every(([p, q]) => cadSketchPointsReflect(p, q, axis)) && pins.every(pin => onAxis(pin, axis)));
  return { axes, exhaustive: heldPairs.length > 0 || pins.length > 0 && (allowed !== undefined || second !== undefined) };
}

/**
 * The relations that keep what refuses a mirror every line it could take, in graph order: those holding a point of the curves or of
 * the mirror line, Coincident joining one of them to what holds it, and, where they set the directions the mirror may take
 * (`directed`), those keeping the curves' and the mirror's directions.
 */
function blockers(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], line: Line, directed: boolean, context: CadSketchLoweringContext): string[] {
  const identity = (pointId: string) => context.identity(pointId), lineIds = new Set([curves[0].id, curves[1].id, line.id]);
  const own = (curve: CadSketchMirroredCurve) => curve.kind === 'line' ? [curve.startPointId, curve.endPointId] : curve.kind === 'arc' ? [curve.centerPointId, curve.startPointId, curve.endPointId] : [curve.centerPointId];
  const points = new Set([...own(curves[0]), ...own(curves[1]), ...isCadSketchVirtualAxisId(line.id) ? [] : [line.startPointId, line.endPointId]].map(identity));
  const ends = [...curves, line].flatMap(edge => edge.kind === 'line' ? [new Set([identity(edge.startPointId), identity(edge.endPointId)])] : []);
  const holding = (pointId: string) => { const hold = context.held(pointId); return hold.x !== undefined || hold.y !== undefined; };
  return context.graph.relations.filter(relation => {
    switch (relation.kind) {
      case 'fixed-point': case 'fixed-axis': return points.has(identity(relation.pointId));
      case 'point-on-line': return isCadSketchVirtualAxisId(relation.lineId) && points.has(identity(relation.pointId));
      case 'coincident': return points.has(identity(relation.pointIds[0])) && holding(relation.pointIds[0]);
      case 'horizontal': case 'vertical': return directed && ends.some(pair => relation.pointIds.every(pointId => pair.has(identity(pointId))) && pair.size === 2);
      case 'parallel': case 'perpendicular': case 'collinear': return directed && relation.lineIds.some(lineId => lineIds.has(lineId));
      default: return false;
    }
  }).map(relation => relation.id);
}

/**
 * One pairing started about one mirror line: the free mirror placed on it when it moves (`moved`), then each pair. Undefined where a
 * hold refuses it, or, on a line the holds fix (`fixed`), where a line both of whose ends a held point or its image settles would
 * collapse or leave the direction its relations keep.
 */
function candidate(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], pairing: Pairing, axis: Axis, moved: Line | undefined, fixed: boolean,
  endIds: ReadonlySet<string>, context: CadSketchLoweringContext, now: Axis): Candidate | undefined {
  const at = (pointId: string) => context.starts.get(pointId)!, seeds = new Map<string, readonly [string, Point2]>(), settled = new Map<string, Point2>();
  const put = (pointId: string, place: Point2) => {
    const from = at(pointId);
    if (place.x !== from.x || place.y !== from.y) seeds.set(context.identity(pointId), [pointId, place]);
  };
  if (moved) {
    const ends = placeMirror(moved, axis, context);
    if (!ends) return undefined;
    put(moved.startPointId, ends[0]); put(moved.endPointId, ends[1]);
  }
  for (const { pointIds: [p, q], self } of pairing.pairs) {
    if (self) {
      const hold = context.held(p);
      if (endIds.has(context.identity(p))) { if (full(hold)) settled.set(context.identity(p), holding(at(p), hold)); continue; }
      const place = onto(at(p), hold, axis);
      if (!place) return undefined;
      put(p, place);
      if (full(hold)) settled.set(context.identity(p), place);
      continue;
    }
    const places = mirrorPair(at(p), at(q), context.held(p), context.held(q), axis);
    if (!places) return undefined;
    put(p, places[0]); put(q, places[1]);
    if (full(context.held(p)) || full(context.held(q))) { settled.set(context.identity(p), places[0]); settled.set(context.identity(q), places[1]); }
  }
  if (fixed) for (const curve of curves) {
    const [from, to] = curve.kind === 'line' ? [settled.get(context.identity(curve.startPointId)), settled.get(context.identity(curve.endPointId))] : [];
    if (!from || !to) continue;
    const angle = context.lineAngle(curve.id);
    if (!apart(from, to) || angle !== undefined && !onAxis(to, through(from, angle))) return undefined;
  }
  let cost = 0;
  for (const [pointId, place] of seeds.values()) { const from = at(pointId); cost += (place.x - from.x) ** 2 + (place.y - from.y) ** 2; }
  return { pairs: pairing.pairs, pairing: pairing.index, turn: moved ? wrap(angleOf(axis) - angleOf(now)) : 0, cost, seeds };
}

/**
 * A free mirror line's ends on the axis's line: about the foot of its middle, at its length, its start still before its end along
 * the axis's sense where they ran that way; an end held in both coordinates where it is, one held in one coordinate where that meets
 * the line, and a free end at the line's length from a held one. Undefined where a hold misses the line or leaves no length.
 */
function placeMirror(line: Line, axis: Axis, context: CadSketchLoweringContext): readonly [Point2, Point2] | undefined {
  const start = context.starts.get(line.startPointId)!, end = context.starts.get(line.endPointId)!, length = Math.hypot(end.x - start.x, end.y - start.y);
  const sense = (end.x - start.x) * axis.x + (end.y - start.y) * axis.y >= 0 ? 1 : -1, [vx, vy] = [sense * axis.x, sense * axis.y];
  const middle = foot({ x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }, axis), [hs, he] = [context.held(line.startPointId), context.held(line.endPointId)];
  let from = onto({ x: middle.x - vx * length / 2, y: middle.y - vy * length / 2 }, hs, axis), to = onto({ x: middle.x + vx * length / 2, y: middle.y + vy * length / 2 }, he, axis);
  const [startHeld, endHeld] = [hs.x !== undefined || hs.y !== undefined, he.x !== undefined || he.y !== undefined];
  if (from && startHeld && !endHeld) to = { x: from.x + vx * length, y: from.y + vy * length };
  else if (to && endHeld && !startHeld) from = { x: to.x - vx * length, y: to.y - vy * length };
  return from && to && Math.hypot(to.x - from.x, to.y - from.y) > CAD_PRECISION.minimumLengthMm ? [from, to] : undefined;
}

const foot = (point: Point2, axis: Axis): Point2 => {
  const along = (point.x - axis.start.x) * axis.x + (point.y - axis.start.y) * axis.y;
  return { x: axis.start.x + along * axis.x, y: axis.start.y + along * axis.y };
};
/**
 * The place on the axis's line nearest a point that its hold allows: the point itself when held in both coordinates and on the line,
 * where the held coordinate meets the line, or the foot of the point. Undefined where the hold misses the line.
 */
function onto(point: Point2, hold: CadSketchPointHold, axis: Axis): Point2 | undefined {
  const place = holding(point, hold);
  if (full(hold)) return onAxis(place, axis) ? place : undefined;
  // A line that keeps the held coordinate meets it everywhere or nowhere.
  const level = (rate: number) => Math.abs(rate) <= CAD_PRECISION.angularAccuracyRad;
  if (hold.x !== undefined) return level(axis.x) ? onAxis(place, axis) ? place : undefined : { x: hold.x, y: axis.start.y + (hold.x - axis.start.x) / axis.x * axis.y };
  if (hold.y !== undefined) return level(axis.y) ? onAxis(place, axis) ? place : undefined : { x: axis.start.x + (hold.y - axis.start.y) / axis.y * axis.x, y: hold.y };
  return foot(point, axis);
}

/**
 * A pair's places about the axis: as they are where they reflect, else the second at the first's image, else the first at the second's,
 * else the first nearest where it is on what both holds leave it, the second its image. Undefined where the holds leave no such place.
 */
function mirrorPair(first: Point2, second: Point2, firstHold: CadSketchPointHold, secondHold: CadSketchPointHold, axis: Axis): readonly [Point2, Point2] | undefined {
  const p = holding(first, firstHold), q = holding(second, secondHold), image = (point: Point2) => cadSketchMirrorImage(point, axis);
  if (cadSketchPointsReflect(p, q, axis)) return [p, q];
  if (fits(image(p), secondHold)) return [p, image(p)];
  if (fits(image(q), firstHold)) return [image(q), q];
  // The image is a linear map plus an offset: each held coordinate of the second point is one row on the first.
  const [ux, uy] = [axis.x, axis.y], rows: (readonly [number, number, number])[] = [], origin = image({ x: 0, y: 0 });
  const map = [[2 * ux * ux - 1, 2 * ux * uy], [2 * ux * uy, 2 * uy * uy - 1]] as const;
  if (firstHold.x !== undefined) rows.push([1, 0, firstHold.x]);
  if (firstHold.y !== undefined) rows.push([0, 1, firstHold.y]);
  if (secondHold.x !== undefined) rows.push([map[0][0], map[0][1], secondHold.x - origin.x]);
  if (secondHold.y !== undefined) rows.push([map[1][0], map[1][1], secondHold.y - origin.y]);
  const place = nearestOn(rows, p);
  return place && [place, image(place)];
}

/** The point nearest `from` on every row's line a·x + b·y = c, each row of unit normal; undefined where the lines share no point. */
function nearestOn(rows: readonly (readonly [number, number, number])[], from: Point2): Point2 | undefined {
  let place = from, along: Point2 | undefined, settled = false;
  for (const [a, b, c] of rows) {
    const miss = c - (a * place.x + b * place.y), tolerance = cadSketchDriverTolerance([place, from]);
    if (settled) { if (Math.abs(miss) > tolerance) return undefined; continue; }
    if (!along) { place = { x: place.x + miss * a, y: place.y + miss * b }; along = { x: -b, y: a }; continue; }
    const rate = a * along.x + b * along.y;
    if (Math.abs(rate) <= CAD_PRECISION.angularAccuracyRad) { if (Math.abs(miss) > tolerance) return undefined; continue; }
    place = { x: place.x + miss / rate * along.x, y: place.y + miss / rate * along.y }; settled = true;
  }
  return place;
}
