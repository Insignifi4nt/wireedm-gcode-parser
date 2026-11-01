import type { CadSketchGraph } from '../cadSketchGraph';
import type { CadSketchGraphSelection } from '../cadSketchGraphSelection';
import { cadSketchCapabilityReason, cadSketchMissingCapability, cadSketchOperandType, cadSketchSlotAccepts } from './cadSketchOperandSignatures';
import { cadSketchPickOrders, cadSketchRelationPlanner } from './cadSketchRelationPlanning';
import { CAD_SKETCH_RELATION_DEFINITIONS, CAD_SKETCH_RELATION_KINDS } from './cadSketchRelationRegistry';
import { isCadSketchVirtualId } from './cadSketchVirtualElements';
import type { CadSketchElement, CadSketchOperandSignature, CadSketchRelationIntent, CadSketchRelationKind, CadSketchRelationOffering, CadSketchRelationPlan, CadSketchRelationPlanner } from './cadSketchRelationTypes';

export type CadSketchRelationOfferState = 'available' | 'applied' | 'blocked';
/** One relation kind a selection can take, as one relation or as one for each pair or pick the selection expands to. */
export interface CadSketchRelationOffer {
  readonly kind: CadSketchRelationKind;
  /** Available to add, applied already on every part, or blocked: these picks cannot take it now. */
  readonly state: CadSketchRelationOfferState;
  /** Why a blocked offer cannot be added, as precise as the domain gives it; the workbench shows it through `readableMessage`. */
  readonly reason?: string;
  /** The picks of each part, in slot order: those that add relations, or for an applied or blocked offer every part's. */
  readonly operands: readonly (readonly CadSketchGraphSelection[])[];
  /** The relations an available offer adds, without identities. A Fix may hold single coordinates, as fixed axes. */
  readonly relations: readonly CadSketchRelationIntent[];
  /** The stored relations that already hold some part, in graph order. */
  readonly relationIds: readonly string[];
}

/** The picks of each part, by index: one for each pick, the first with each later one, or the whole selection. */
function groups(signature: CadSketchOperandSignature, count: number): readonly (readonly number[])[] {
  if (signature.expand === 'each' && signature.slots.length === 1) return Array.from({ length: count }, (_, index) => [index]);
  if (signature.expand === 'chain-from-first' && signature.slots.length === 2 && count > 2) return Array.from({ length: count - 1 }, (_, index) => [0, index + 1]);
  return [Array.from({ length: count }, (_, index) => index)];
}

interface Part { readonly picks: readonly CadSketchGraphSelection[]; readonly plan: CadSketchRelationPlan }
/**
 * One part planned as the Constrain tool's choices plan it: each order of the picks that the slots take as they stand, the picks' own
 * first, until one is available or applied, or else the first refusal. A pick of a type a slot takes that lacks what the slot needs, such
 * as the length of an infinite axis, is refused with that reason. Null when no order makes the relation.
 */
function planPart(offering: CadSketchRelationOffering, planner: CadSketchRelationPlanner, picks: readonly CadSketchGraphSelection[], elements: readonly CadSketchElement[]): Part | null {
  const { slots } = offering.signature;
  if (picks.length !== slots.length) return null;
  let refused: Part | null = null;
  for (const order of cadSketchPickOrders(picks.map((_, index) => index))) {
    if (!order.every((index, slot) => cadSketchSlotAccepts(slots[slot], cadSketchOperandType(elements[index])))) continue;
    const lacking = order.map((index, slot) => ({ element: elements[index], missing: cadSketchMissingCapability(slots[slot], elements[index]) })).find(item => item.missing);
    const arranged = order.map(index => picks[index]);
    const plan: CadSketchRelationPlan | null = lacking?.missing ? { state: 'blocked', reason: cadSketchCapabilityReason(lacking.element, lacking.missing) } : offering.plan(planner, arranged);
    if (!plan) continue;
    if (plan.state !== 'blocked') return { picks: arranged, plan };
    refused ??= { picks: arranged, plan };
  }
  return refused;
}

// Relations an earlier part adds, under identities no stored relation can have.
const PENDING = '\u0000offer ';
/**
 * The offer of one kind's offering, or null when the selection does not fit it. Parts are planned in order, each on the graph with the
 * relations of the parts before it added, as the tool would plan them one after another: a part those relations already hold adds
 * nothing, and a part they block blocks the offer.
 */
function offer(kind: CadSketchRelationKind, offering: CadSketchRelationOffering, selection: readonly CadSketchGraphSelection[], elements: readonly CadSketchElement[], start: CadSketchRelationPlanner): CadSketchRelationOffer | null {
  const split = groups(offering.signature, selection.length), every: (readonly CadSketchGraphSelection[])[] = [], added: (readonly CadSketchGraphSelection[])[] = [];
  const relations: CadSketchRelationIntent[] = [], held = new Set<string>();
  let planner = start, reason: string | undefined;
  for (const [index, group] of split.entries()) {
    const part = planPart(offering, planner, group.map(at => selection[at]), group.map(at => elements[at]));
    if (!part) return null;
    every.push(part.picks);
    const { plan } = part;
    if (plan.state === 'blocked') { reason ??= plan.reason; continue; }
    if (plan.state === 'applied') { for (const id of plan.relationIds) if (!id.startsWith(PENDING)) held.add(id); continue; }
    const from = relations.length;
    relations.push(...plan.relations); added.push(part.picks);
    if (index < split.length - 1) planner = cadSketchRelationPlanner({ ...planner.graph,
      relations: [...planner.graph.relations, ...plan.relations.map((relation, at) => ({ id: `${PENDING}${from + at}`, ...relation }))] as CadSketchGraph['relations'] });
  }
  const relationIds = Object.freeze(held.size ? start.graph.relations.filter(relation => held.has(relation.id)).map(relation => relation.id) : []);
  if (reason !== undefined) return Object.freeze({ kind, state: 'blocked', reason, operands: Object.freeze(every), relations: Object.freeze([]), relationIds });
  if (!relations.length) return Object.freeze({ kind, state: 'applied', operands: Object.freeze(every), relations: Object.freeze([]), relationIds });
  return Object.freeze({ kind, state: 'available', operands: Object.freeze(added), relations: Object.freeze(relations), relationIds });
}

/**
 * The relations a selection of points and edges can take, in schema order: for each kind, the first of its offerings that the selection
 * fits. Each part is planned by the Constrain tool's own planning, so an offer is available, applied with the relations that hold it,
 * or blocked with the tool's reason exactly when the tool would be on those picks. A selection that names a point or edge twice, or one
 * the graph lacks, takes none, and so does one of the origin and the axes alone, which are fixed already. Kinds that need a value, or
 * that a tool creates with its own geometry, are never offered.
 */
export function cadSketchRelationOffers(graph: CadSketchGraph, selection: readonly CadSketchGraphSelection[]): readonly CadSketchRelationOffer[] {
  if (!selection.length) return [];
  const planner = cadSketchRelationPlanner(graph), seen = new Set<string>(), elements: CadSketchElement[] = [];
  for (const pick of selection) {
    const element = pick.kind === 'point' ? planner.point(pick.id) : planner.entity(pick.id), name = `${pick.kind} ${pick.id}`;
    if (!element || seen.has(name)) return [];
    seen.add(name);
    elements.push(element);
  }
  if (elements.every(element => isCadSketchVirtualId(element.id))) return [];
  const offers: CadSketchRelationOffer[] = [];
  for (const kind of CAD_SKETCH_RELATION_KINDS) {
    for (const offering of CAD_SKETCH_RELATION_DEFINITIONS[kind].offers ?? []) {
      const made = offer(kind, offering, selection, elements, planner);
      if (!made) continue;
      offers.push(made);
      break;
    }
  }
  return Object.freeze(offers);
}
