import type { CadScalar } from '../cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphPoint, CadSketchGraphRelation } from '../cadSketchGraph';
import type { CadSketchGraphSelection } from '../cadSketchGraphSelection';

export type CadSketchRelationKind = CadSketchGraphRelation['kind'];
// The schema stores several kinds with one shape, whose `kind` is their union, so a kind is narrowed rather than extracted.
type Narrowed<R, K> = R extends { readonly kind: infer Stored } ? K extends Stored ? R & { readonly kind: K } : never : never;
export type CadSketchRelationOf<K extends CadSketchRelationKind> = Narrowed<CadSketchGraphRelation, K>;
/** A relation without its identity: what an offer adds once it is given one. */
export type CadSketchRelationIntent<K extends CadSketchRelationKind = CadSketchRelationKind> = K extends CadSketchRelationKind ? Omit<CadSketchRelationOf<K>, 'id'> : never;

export type CadSketchOperandType = 'point' | 'line' | 'arc' | 'circle';
/**
 * What a slot accepts: one type, or a group of them. A curve is any line, arc or circle, a round an arc or circle, and an axis a line
 * that gives a direction. The origin and the X and Y axes are not operands yet; they keep their own cases until they are.
 */
export type CadSketchOperandTrait = CadSketchOperandType | 'curve' | 'round' | 'axis';
/** The error a parse or an offer gives for operands that cannot take a relation. */
export interface CadSketchRefusal { readonly code: string; readonly message: string }

export interface CadSketchOperandSlot {
  /** What the operand is to the relation, in sentence case, as people and agents are told. */
  readonly role: string;
  readonly accepts: readonly CadSketchOperandTrait[];
  /** A point of the entity in the slot before it, such as the end it joins at. That entity already names it, so it adds no reference of its own. */
  readonly end?: true;
  /** Refuse an operand that is missing or has none of the accepted traits, with this error. Without it, the point references check covers the slot. */
  readonly refusal?: CadSketchRefusal;
}
export interface CadSketchOperandSignature {
  readonly slots: readonly CadSketchOperandSlot[];
  /**
   * Slot groups whose order does not change the relation: reordering one keeps the relation's canonical key. An `end` slot after a
   * grouped slot moves with it.
   */
  readonly unordered?: readonly (readonly number[])[];
  /** Refuse an id repeated among these slots with this error. It is checked before any slot. */
  readonly distinct?: { readonly slots: readonly number[]; readonly refusal: CadSketchRefusal };
  /** How a longer selection expands: one relation for each pick, or one between the first pick and each later one. */
  readonly expand?: 'each' | 'chain-from-first';
}
/** The element each slot names, or undefined where a slot without a refusal names nothing. */
export type CadSketchResolvedOperands = readonly (CadSketchGraphPoint | CadSketchGraphEntity | undefined)[];
/** How operand labels name points and edges, such as "Point 3" and "Line 5". */
export interface CadSketchOperandNames { point(id: string): string; entity(id: string): string }
/** Points and edges a relation made and keeps: removing it removes them. Their own points belong to it too. */
export interface CadSketchRelationOwnership { readonly pointIds: readonly string[]; readonly entityIds: readonly string[] }

/** What an offer reads its graph through, indexed once for each accepted graph. */
export interface CadSketchOfferContext {
  readonly graph: CadSketchGraph;
  point(id: string): CadSketchGraphPoint | undefined;
  entity(id: string): CadSketchGraphEntity | undefined;
  /** The point's Coincident identity: points that Coincident joins share one. */
  identity(id: string): string;
}
/** One way a selection makes a relation: picks in slot order, built into its data, or refused. */
export interface CadSketchRelationOffering<K extends CadSketchRelationKind> {
  readonly signature: CadSketchOperandSignature;
  /** The relation the picks make, or why they cannot make one. */
  readonly build: (context: CadSketchOfferContext, picks: readonly CadSketchGraphSelection[]) => CadSketchRelationIntent<K> | CadSketchRefusal;
  /** Why the relation cannot join those the graph holds, asked only once the graph is found not to hold it already. */
  readonly refuse?: (context: CadSketchOfferContext, relation: CadSketchRelationIntent<K>) => CadSketchRefusal | undefined;
}

export type CadSketchRelationFamily = 'incidence' | 'orientation' | 'equality' | 'fix' | 'dimension' | 'composite';

/**
 * Everything a relation kind declares once, so consumers read relations through it instead of switching on kinds. Equations stay with
 * the solver until they move here.
 */
export interface CadSketchRelationDefinition<K extends CadSketchRelationKind> {
  readonly kind: K;
  readonly family: CadSketchRelationFamily;
  /** Sentence-case name of the kind. */
  readonly name: string;
  /** The name of one relation, where it depends on its data. */
  readonly nameOf?: (relation: CadSketchRelationOf<K>) => string;
  /** The stored operands, in `operands` order; a relation whose data has variants gives the slots of its own variant. */
  readonly stored: CadSketchOperandSignature | ((relation: CadSketchRelationOf<K>) => CadSketchOperandSignature);
  readonly operands: (relation: CadSketchRelationOf<K>) => readonly string[];
  /** The relation with `ids` in place of its operands, one for each slot. */
  readonly withOperands: (relation: CadSketchRelationOf<K>, ids: readonly string[]) => CadSketchRelationOf<K>;
  /** Driving values, named by their path in the relation's data. */
  readonly scalars?: {
    readonly keys: readonly string[];
    readonly read: (relation: CadSketchRelationOf<K>) => readonly CadScalar[];
    readonly write: (relation: CadSketchRelationOf<K>, values: readonly CadScalar[]) => CadSketchRelationOf<K>;
  };
  readonly owns?: (relation: CadSketchRelationOf<K>) => CadSketchRelationOwnership;
  /** Equal for relations that hold the same thing on the same operands, whatever order an unordered group is stored in; never compares values. */
  readonly key: (relation: CadSketchRelationOf<K>) => string;
  /** The operand labels a description lists, where they are not one for each point and edge slot. */
  readonly mentions?: (relation: CadSketchRelationOf<K>, names: CadSketchOperandNames) => readonly string[];
  /** The operands run from the first to the second, so a description joins them with an arrow. */
  readonly directed?: true;
  /** Checks parsing makes beyond the slot refusals, after them, with the operands they resolved. */
  readonly validate?: (graph: CadSketchGraph, relation: CadSketchRelationOf<K>, operands: CadSketchResolvedOperands) => void;
  /** The points the relation references, where they are not its point slots and the points of its edges. */
  readonly pointIds?: (graph: CadSketchGraph, relation: CadSketchRelationOf<K>) => readonly string[];
  /** Selections that make this relation, tried in order. A relation that needs a value, or one that tools create, has none. */
  readonly offers?: readonly CadSketchRelationOffering<K>[];
  /** Whether agent tools may name the kind, and what they are told it does. */
  readonly agent: { readonly exposed: boolean; readonly summary: string };
}
export type CadSketchRelationDefinitions = { readonly [K in CadSketchRelationKind]: CadSketchRelationDefinition<K> };
