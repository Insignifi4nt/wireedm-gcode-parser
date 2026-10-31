import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readableMessage } from '@/lib/userMessage';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadSketchGraphSelection } from '@/domain/cad/cadSketchGraphSelection';
import { cadSketchRelationOffers, type CadSketchRelationOffer } from '@/domain/cad/sketch-relations/cadSketchRelationOffers';
import type { CadSketchRelationIntent, CadSketchRelationKind } from '@/domain/cad/sketch-relations/cadSketchRelationTypes';
import { cadSketchConstraintChoices, type CadSketchConstraintChoice, type CadSketchConstraintTool } from '../../cadSketchConstraintTool';
import { decodeCorpusJson } from '../../sketch-solver/__tests__/planeGcsCorpus';

// Offers and the Constrain tool share one planning, so for every kind the tool creates, an offer must say exactly what the tool's
// selection-first choices say on the same picks: available with the same relations, applied with the same relations named, or blocked
// with the same reason. A selection longer than the tool takes expands into parts, and each part must match the tool run on that part
// with the relations the parts before it add, as if the tool were used once for each. The selections come from the recorded sketches of
// the relation baseline, whose coordinates are 0, and the solver corpus, at their solved coordinates: every stored relation's own operands
// in both orders and one at a time, each edge with its own points, and runs of neighbouring points, lines, arcs and circles.

type Selected = CadSketchGraphSelection;
type Type = 'point' | 'line' | 'arc' | 'circle';
const here = `${process.cwd()}/src/features/cad`;
const baseline = (JSON.parse(gunzipSync(readFileSync(`${here}/sketch-relations/__tests__/fixtures/relation-baseline.json.gz`)).toString('utf8')) as { records: { graph: unknown }[] }).records.map(record => record.graph);
const corpus = Object.values(decodeCorpusJson(gunzipSync(readFileSync(`${here}/sketch-solver/__tests__/fixtures/planegcs-corpus/graphs.json.gz`)).toString('utf8')) as Record<string, unknown>);

const P = (id: string): Selected => ({ kind: 'point', id }), E = (id: string): Selected => ({ kind: 'entity', id });
const round = (type: Type) => type === 'arc' || type === 'circle';
/** The parts of each kind the tool creates, as the offers document them: one for each pick, the first with each later one, or the whole. */
const chain = (count: number) => count === 2 ? [[0, 1]] : Array.from({ length: count - 1 }, (_, index) => [0, index + 1]);
const each = (count: number) => Array.from({ length: count }, (_, index) => [index]);
const whole = (count: number) => [Array.from({ length: count }, (_, index) => index)];
function rule(kind: CadSketchRelationKind, types: readonly Type[]): { readonly tool: CadSketchConstraintTool; readonly parts: readonly (readonly number[])[] } | null {
  const n = types.length, all = (test: (type: Type) => boolean) => types.every(test), count = (test: (type: Type) => boolean) => types.filter(test).length;
  const pointAnd = (test: (type: Type) => boolean) => n === 2 && count(type => type === 'point') === 1 && count(test) === 1;
  switch (kind) {
    case 'coincident': return n >= 2 && all(type => type === 'point') ? { tool: 'coincident', parts: chain(n) } : n >= 2 && all(round) ? { tool: 'concentric', parts: chain(n) } : null;
    case 'point-on-line': return pointAnd(type => type === 'line') ? { tool: 'coincident', parts: whole(n) } : null;
    case 'point-on-curve': return pointAnd(round) ? { tool: 'coincident', parts: whole(n) } : null;
    case 'midpoint': return pointAnd(type => type === 'line') ? { tool: 'midpoint', parts: whole(n) } : null;
    case 'horizontal': case 'vertical': return n >= 1 && all(type => type === 'line') ? { tool: kind, parts: each(n) } : n === 2 && all(type => type === 'point') ? { tool: kind, parts: whole(n) } : null;
    case 'parallel': case 'perpendicular': return n >= 2 && all(type => type === 'line') ? { tool: kind, parts: chain(n) } : null;
    case 'equal-length': return n >= 2 && all(type => type === 'line') ? { tool: 'equal', parts: chain(n) } : null;
    case 'equal-radius': return n >= 2 && all(round) ? { tool: 'equal', parts: chain(n) } : null;
    case 'tangent-joint': return n === 2 && count(type => type === 'line') === 1 && count(type => type === 'arc') === 1 ? { tool: 'tangent', parts: whole(n) } : null;
    case 'symmetric': return n === 3 && count(type => type === 'line') === 1 && count(type => type === 'point' || type === 'circle') === 2 ? { tool: 'symmetric', parts: whole(n) } : null;
    case 'fixed-point': return n >= 1 && all(type => type === 'point') ? { tool: 'fix', parts: each(n) } : null;
    default: return null;
  }
}
// Selections drawn from each graph: 10 keeps the run near 20 seconds, and OFFER_PARITY_CAP=40 replays about three times as many.
const CAP = Number(process.env.OFFER_PARITY_CAP ?? 10);
const TOOL_KINDS: readonly CadSketchRelationKind[] = ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'midpoint', 'point-on-line', 'point-on-curve',
  'tangent-joint', 'symmetric', 'equal-length', 'equal-radius', 'fixed-point'];

type Expected = Pick<CadSketchRelationOffer, 'state' | 'reason' | 'relations' | 'relationIds'>;
// Relations a part adds for the parts after it, under identities no stored relation has.
const PENDING = '\u0000tool ';
let pending = 0;
// The tool's choices for each part, worked out once for each graph and picks.
const choices = new WeakMap<CadSketchGraph, Map<string, readonly CadSketchConstraintChoice[]>>();
function choicesFor(graph: CadSketchGraph, picks: readonly Selected[]) {
  const kept = choices.get(graph) ?? new Map<string, readonly CadSketchConstraintChoice[]>(), key = picks.map(pick => `${pick.kind} ${pick.id}`).join(', ');
  choices.set(graph, kept);
  if (!kept.has(key)) kept.set(key, cadSketchConstraintChoices(graph, picks, () => `${PENDING}${pending++}`));
  return kept.get(key)!;
}
/** What the tool gives the selection for this kind, part by part, or null where the tool takes none of it. */
function expected(graph: CadSketchGraph, selection: readonly Selected[], types: readonly Type[], kind: CadSketchRelationKind): Expected | null {
  const found = rule(kind, types);
  if (!found) return null;
  const relations: CadSketchRelationIntent[] = [], held = new Set<string>();
  let current = graph, reason: string | undefined;
  for (const part of found.parts) {
    const choice = choicesFor(current, part.map(index => selection[index])).find(item => item.tool === found.tool);
    if (!choice) return null;
    if (choice.state === 'blocked') { reason ??= choice.reason; continue; }
    if (choice.state === 'applied') { for (const id of choice.relationIds) if (!id.startsWith(PENDING)) held.add(id); continue; }
    relations.push(...choice.relations.map(relation => Object.fromEntries(Object.entries(relation).filter(([key]) => key !== 'id')) as CadSketchRelationIntent));
    current = { ...current, relations: [...current.relations, ...choice.relations] };
  }
  const relationIds = graph.relations.filter(relation => held.has(relation.id)).map(relation => relation.id);
  if (reason !== undefined) return { state: 'blocked', reason, relations: [], relationIds };
  return { state: relations.length ? 'available' : 'applied', reason: undefined, relations, relationIds };
}

/** Selections drawn from the graph, at most `cap`, the stored relations' operands first. */
function selections(graph: CadSketchGraph, cap: number): readonly (readonly Selected[])[] {
  const out: Selected[][] = [], seen = new Set<string>(), name = (pick: Selected) => `${pick.kind[0]}${pick.id}`;
  const add = (picks: readonly Selected[]) => {
    if (out.length >= cap || !picks.length || picks.length > 3 || new Set(picks.map(name)).size !== picks.length) return;
    const key = picks.map(name).join(' ');
    if (!seen.has(key)) { seen.add(key); out.push([...picks]); }
  };
  const byId = new Map(graph.entities.map(entity => [entity.id, entity]));
  const operands = (relation: CadSketchGraphRelation): Selected[] => {
    const points = 'pointIds' in relation ? relation.pointIds : 'pointId' in relation ? [relation.pointId] : [];
    let entities: readonly string[] = [];
    try { entities = cadSketchRelationEntityIds(relation); } catch { /* A relation with a missing entity names none. */ }
    return [...points.map(P), ...entities.filter(id => byId.has(id)).map(E)];
  };
  for (const relation of graph.relations) {
    const picks = operands(relation);
    add(picks); add([...picks].reverse());
    for (const pick of picks) add([pick]);
  }
  const lines = graph.entities.filter(entity => entity.kind === 'line'), rounds = graph.entities.filter(entity => entity.kind === 'arc' || entity.kind === 'circle');
  const arcs = graph.entities.filter(entity => entity.kind === 'arc'), circles = graph.entities.filter(entity => entity.kind === 'circle'), points = graph.points;
  for (const [index, line] of lines.entries()) {
    add([E(line.id)]); add([P(line.startPointId), P(line.endPointId)]); add([P(line.startPointId), E(line.id)]); add([E(line.id), P(line.endPointId)]);
    const next = lines[index + 1], after = lines[index + 2];
    if (next) { add([E(line.id), E(next.id)]); add([P(line.endPointId), E(next.id)]); add([P(line.startPointId), P(line.endPointId), E(next.id)]); }
    if (next && after) add([E(line.id), E(next.id), E(after.id)]);
  }
  for (const [index, curve] of rounds.entries()) {
    add([P(curve.centerPointId), E(curve.id)]);
    const next = rounds[index + 1], after = rounds[index + 2];
    if (next) { add([E(curve.id), E(next.id)]); add([P(curve.centerPointId), E(next.id)]); }
    if (next && after) add([E(curve.id), E(next.id), E(after.id)]);
  }
  for (const arc of arcs) for (const line of lines.filter(item => [item.startPointId, item.endPointId].some(id => id === arc.startPointId || id === arc.endPointId)).slice(0, 2)) {
    add([E(line.id), E(arc.id)]); add([E(arc.id), E(line.id)]);
  }
  for (const [index, point] of points.entries()) {
    add([P(point.id)]);
    const next = points[index + 1], after = points[index + 2];
    if (next) add([P(point.id), P(next.id)]);
    if (next && after) add([P(point.id), P(next.id), P(after.id)]);
    if (next && lines[0]) { add([P(point.id), P(next.id), E(lines[index % lines.length].id)]); add([E(lines[0].id), P(point.id), P(next.id)]); }
  }
  for (const [index, circle] of circles.entries()) if (lines[0]) add([E(circle.id), P(points[index % points.length].id), E(lines[index % lines.length].id)]);
  return out;
}

describe('sketch relation offers against the Constrain tool', () => {
  it('give the tool\'s answer for every kind it creates, on every selection drawn from the recorded sketches and the solver corpus', () => {
    const tally = new Map<string, number>(), count = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);
    let compared = 0, graphs = 0, picked = 0, precise = 0;
    for (const source of [...baseline, ...corpus]) {
      const graph = parseCadSketchGraph(source);
      graphs++;
      const types = new Map<string, Type>([...graph.points.map(point => [`point ${point.id}`, 'point'] as const), ...graph.entities.map(entity => [`entity ${entity.id}`, entity.kind] as const)]);
      for (const selection of selections(graph, CAP)) {
        picked++;
        const kinds = selection.map(pick => types.get(`${pick.kind} ${pick.id}`)!), offers = cadSketchRelationOffers(graph, selection);
        for (const kind of TOOL_KINDS) {
          const want = expected(graph, selection, kinds, kind), offer = offers.find(item => item.kind === kind);
          const where = `${selection.map(pick => `${pick.kind} ${pick.id}`).join(', ')} (${kind}) in graph ${graphs - 1}`;
          if (!want) { expect(offer, where).toBeUndefined(); continue; }
          expect(offer, where).toBeDefined();
          expect({ state: offer!.state, reason: offer!.reason === undefined ? undefined : readableMessage(offer!.reason), relations: offer!.relations, relationIds: offer!.relationIds }, where).toEqual(want);
          if (offer!.reason !== undefined && offer!.reason !== readableMessage(offer!.reason)) precise++;
          count(`${kind} ${want.state}`); count(`parts ${rule(kind, kinds)!.parts.length > 1 ? 'several' : 'one'}`);
          compared++;
        }
      }
    }
    if (process.env.OFFER_PARITY_TALLY) console.log(JSON.stringify({ graphs, selections: picked, compared, precise, tally: Object.fromEntries([...tally].sort()) }, null, 1));
    expect(graphs).toBe(baseline.length + corpus.length);
    expect(compared).toBeGreaterThan(50_000);
    // Each kind the tool creates is met available, applied and blocked, and expanded selections are compared part by part. The tool
    // refuses Equal only for picks it never takes, a line with an arc or circle, so Equal is never blocked.
    for (const kind of TOOL_KINDS) for (const state of ['available', 'applied', 'blocked']) {
      if (state !== 'blocked' || kind !== 'equal-length' && kind !== 'equal-radius') expect(tally.get(`${kind} ${state}`) ?? 0, `${kind} ${state}`).toBeGreaterThan(0);
    }
    expect(tally.get('parts several')).toBeGreaterThan(5_000);
  }, 600_000);

  // The one intended change from the tool as it was before the shared planning. It matched a stored pair to the picks by membership
  // alone, so one centre picked twice, as two arcs or circles on it or a point with its own circle, matched any Coincident joining that
  // centre to another point, or any Symmetric mirroring it about the same line. It reported Concentric or Symmetric applied, naming that
  // relation, and Remove deleted it. Neither relation holds what was asked, so both the tool and the offers now refuse with the reason.
  it('never name a relation of a centre two picks share, the one answer that changed: every such case in the recorded sketches and the corpus', () => {
    const center = 'These already share a center.', mirror = 'Symmetric points and axis endpoints need four distinct declared identities.';
    const concentric: number[] = [], symmetric: number[] = [];
    for (const [at, source] of [...baseline, ...corpus].entries()) {
      const graph = parseCadSketchGraph(source), rounds = graph.entities.filter(entity => entity.kind === 'arc' || entity.kind === 'circle');
      const named = (choices: readonly CadSketchConstraintChoice[]) => choices.flatMap(choice => choice.state === 'applied' ? choice.relationIds : []);
      for (const [index, first] of rounds.entries()) for (const second of rounds.slice(index + 1).filter(item => item.centerPointId === first.centerPointId)) {
        // What the tool named before: any Coincident on the shared centre. No choice names one now; Equal still names an equal radius.
        const before = graph.relations.filter(relation => relation.kind === 'coincident' && relation.pointIds.includes(first.centerPointId)).map(relation => relation.id);
        if (!before.length) continue;
        const picks = [E(first.id), E(second.id)], where = `${first.id}, ${second.id} in graph ${at}`;
        expect(cadSketchConstraintChoices(graph, picks, () => 'new').find(choice => choice.tool === 'concentric'), where).toEqual({ tool: 'concentric', state: 'blocked', reason: center });
        expect(cadSketchRelationOffers(graph, picks).find(offer => offer.kind === 'coincident'), where).toMatchObject({ state: 'blocked', reason: center, relationIds: [] });
        expect(named(cadSketchConstraintChoices(graph, picks, () => 'new')).filter(id => before.includes(id)), where).toEqual([]);
        if (!concentric.includes(at)) concentric.push(at);
      }
      for (const relation of graph.relations) if (relation.kind === 'symmetric') for (const centre of relation.pointIds) {
        // What the tool named before: this Symmetric, for its point with a circle centred on it, or two such circles, about its line.
        const circles = graph.entities.filter(entity => entity.kind === 'circle' && entity.centerPointId === centre).map(entity => E(entity.id));
        for (const picks of [...circles.map(circle => [P(centre), circle, E(relation.lineId)]), ...circles.length > 1 ? [[circles[0], circles[1], E(relation.lineId)]] : []]) {
          const where = `${picks.map(pick => pick.id).join(', ')} in graph ${at}`;
          expect(cadSketchConstraintChoices(graph, picks, () => 'new'), where).toEqual([{ tool: 'symmetric', state: 'blocked', reason: mirror }]);
          expect(cadSketchRelationOffers(graph, picks).find(offer => offer.kind === 'symmetric'), where).toMatchObject({ state: 'blocked', reason: mirror, relationIds: [] });
          if (!symmetric.includes(at)) symmetric.push(at);
        }
      }
    }
    // Baseline graph 1350, two circles on p4 with Coincident r10 joining p4 to p9, is the case the review found.
    expect(concentric).toEqual([1350, 1392, 1638, 2101, 2442, 2456, 2506, 3241, 3336, 3623]);
    expect(symmetric).toContain(10);
    expect(symmetric).toHaveLength(61);
  }, 300_000);
});
