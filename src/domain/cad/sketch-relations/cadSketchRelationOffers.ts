import { isAcceptedCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphPoint, type CadSketchGraphRelation } from '../cadSketchGraph';
import { resolveCadSketchPointIdentities } from '../cadSketchGraphJoints';
import type { CadSketchGraphSelection } from '../cadSketchGraphSelection';
import { cadSketchSlotAccepts } from './cadSketchOperandSignatures';
import { CAD_SKETCH_RELATION_DEFINITIONS, CAD_SKETCH_RELATION_KINDS, cadSketchRelationKeyIndex, cadSketchRelationKey, checkCadSketchRelationOperands } from './cadSketchRelationRegistry';
import type { CadSketchOfferContext, CadSketchOperandSignature, CadSketchOperandType, CadSketchRelationIntent, CadSketchRelationKind, CadSketchRelationOffering } from './cadSketchRelationTypes';

export type CadSketchRelationOfferState = 'available' | 'applied' | 'blocked';
/** One relation kind a selection can take, as one relation or as one for each pair or pick the selection expands to. */
export interface CadSketchRelationOffer {
  readonly kind: CadSketchRelationKind;
  /** Available to add, applied already on every part, or blocked: these picks cannot take it now. */
  readonly state: CadSketchRelationOfferState;
  /** Why a blocked offer cannot be added. */
  readonly reason?: string;
  /** The picks of each relation, in slot order: those to add, or for an applied or blocked offer every part's. */
  readonly operands: readonly (readonly CadSketchGraphSelection[])[];
  /** The relations an available offer adds, without identities. */
  readonly relations: readonly CadSketchRelationIntent[];
  /** The relations that already hold some part, in graph order. */
  readonly relationIds: readonly string[];
}

// The lookups an offer reads, kept with each accepted graph, which cannot change.
const contexts = new WeakMap<CadSketchGraph, CadSketchOfferContext>();
function offerContext(graph: CadSketchGraph): CadSketchOfferContext {
  const kept = contexts.get(graph);
  if (kept) return kept;
  const points = new Map<string, CadSketchGraphPoint>(graph.points.map(point => [point.id, point]));
  const entities = new Map<string, CadSketchGraphEntity>(graph.entities.map(entity => [entity.id, entity]));
  let identityOf: ((id: string) => string) | undefined;
  const context: CadSketchOfferContext = Object.freeze({ graph, point: (id: string) => points.get(id), entity: (id: string) => entities.get(id),
    identity: (id: string) => (identityOf ??= resolveCadSketchPointIdentities(graph))(id) });
  if (isAcceptedCadSketchGraph(graph)) contexts.set(graph, context);
  return context;
}

/** The picks in an order that fits the slots, trying orders nearest the picks' own first; null when none fits. */
function arrange(signature: CadSketchOperandSignature, picks: readonly CadSketchGraphSelection[], types: readonly CadSketchOperandType[]): readonly CadSketchGraphSelection[] | null {
  if (picks.length !== signature.slots.length) return null;
  const order: number[] = [], used = new Set<number>();
  const place = (slot: number): boolean => {
    if (slot === picks.length) return true;
    for (let index = 0; index < picks.length; index++) {
      if (used.has(index) || !cadSketchSlotAccepts(signature.slots[slot], types[index])) continue;
      used.add(index); order.push(index);
      if (place(slot + 1)) return true;
      used.delete(index); order.pop();
    }
    return false;
  };
  return place(0) ? order.map(index => picks[index]) : null;
}
/** The selection split into the picks of each relation it makes, by the signature's expansion; null when it does not fit. */
function parts(signature: CadSketchOperandSignature, picks: readonly CadSketchGraphSelection[], types: readonly CadSketchOperandType[]): readonly (readonly CadSketchGraphSelection[])[] | null {
  const each = signature.expand === 'each' && signature.slots.length === 1, chained = signature.expand === 'chain-from-first' && signature.slots.length === 2 && picks.length > 2;
  const groups = each ? picks.map((_, index) => [index]) : chained ? picks.slice(1).map((_, index) => [0, index + 1]) : [picks.map((_, index) => index)];
  const arranged: (readonly CadSketchGraphSelection[])[] = [];
  for (const group of groups) {
    const part = arrange(signature, group.map(index => picks[index]), group.map(index => types[index]));
    if (!part) return null;
    arranged.push(part);
  }
  return arranged;
}

const refusalOf = (error: unknown) => error instanceof Error && error.message ? error.message : 'These picks cannot take this relation.';
function offer<K extends CadSketchRelationKind>(kind: K, offering: CadSketchRelationOffering<K>, split: readonly (readonly CadSketchGraphSelection[])[], context: CadSketchOfferContext): CadSketchRelationOffer {
  const keys = cadSketchRelationKeyIndex(context.graph), relationIds = new Set<string>(), relations: CadSketchRelationIntent[] = [], added: (readonly CadSketchGraphSelection[])[] = [];
  let reason: string | undefined;
  for (const picks of split) {
    const built = offering.build(context, picks);
    if ('code' in built) { reason ??= built.message; continue; }
    // Intents carry no identity, which keys never read.
    const relation = { ...built, id: 'offer' } as unknown as CadSketchGraphRelation, applied = keys.get(cadSketchRelationKey(relation));
    if (applied) { for (const id of applied) relationIds.add(id); continue; }
    const refused = offering.refuse?.(context, built);
    if (refused) { reason ??= refused.message; continue; }
    try { checkCadSketchRelationOperands(context.graph, relation); } catch (error) { reason ??= refusalOf(error); continue; }
    relations.push(built); added.push(picks);
  }
  const ids = Object.freeze([...relationIds]);
  if (reason !== undefined) return Object.freeze({ kind, state: 'blocked', reason, operands: split, relations: [], relationIds: ids });
  if (!relations.length) return Object.freeze({ kind, state: 'applied', operands: split, relations: [], relationIds: ids });
  return Object.freeze({ kind, state: 'available', operands: Object.freeze(added), relations: Object.freeze(relations), relationIds: ids });
}

/**
 * The relations a selection of points and edges can take, in schema order: for each kind, the first of its offerings that the selection
 * fits. Each comes available, applied when the graph already holds every relation it makes, or blocked with the reason its kind's checks
 * give. A selection that names a point or edge twice, or one the graph lacks, takes none. Kinds that need a value, or that a tool
 * creates with its own geometry, are never offered. The origin and the axes are not picks yet.
 */
export function cadSketchRelationOffers(graph: CadSketchGraph, selection: readonly CadSketchGraphSelection[]): readonly CadSketchRelationOffer[] {
  if (!selection.length) return [];
  const context = offerContext(graph), seen = new Set<string>(), types: CadSketchOperandType[] = [];
  for (const pick of selection) {
    const element = pick.kind === 'point' ? context.point(pick.id) : context.entity(pick.id), name = `${pick.kind} ${pick.id}`;
    if (!element || seen.has(name)) return [];
    seen.add(name);
    types.push('kind' in element ? element.kind : 'point');
  }
  const offers: CadSketchRelationOffer[] = [];
  for (const kind of CAD_SKETCH_RELATION_KINDS) {
    for (const offering of (CAD_SKETCH_RELATION_DEFINITIONS[kind].offers ?? []) as readonly CadSketchRelationOffering<typeof kind>[]) {
      const split = parts(offering.signature, selection, types);
      if (!split) continue;
      offers.push(offer(kind, offering, split, context));
      break;
    }
  }
  return Object.freeze(offers);
}
