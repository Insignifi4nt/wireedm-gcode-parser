import type { CadFeature } from './cadDocument';
import { cadFeatureActive, type CadFeatureScope } from './features/cadFeatureActivity';
import { cadFeatureDefinition, cadFeatureLayout } from './features/cadFeatureRegistry';

/**
 * Body identity. A body is keyed by the feature that created it, plus an occurrence where that feature makes a body that is a copy of
 * another or a piece of one. Features that modify a body keep its key, so later features, the tree, selection, CAM and agents can
 * name it however often it is filleted, cut, moved or patterned. Every rebuild derives the states again from the history with
 * `createCadBodyLineage`, the kernel with the facts only its geometry knows. Nothing here is stored before S8's format cut, which
 * stores `CadBodyRef` targets and `CadBodyMetadata` keyed by these keys.
 */

/** What a body is: closed solids, an open sheet or wires. Every kernel body is a validated solid until surface and wire features arrive. */
export type CadBodyKind = 'solid' | 'sheet' | 'wire';

/**
 * A step from a creating feature to one of the bodies it makes, or from a body to a part of it:
 * - `inst(i,j)`: a pattern's copy, i along its first direction and j along its second, both 0 for the original in place. Patterns have
 *   one direction until a second count arrives, so j is 0;
 * - `split(k)`: the kth piece of a body a feature split, numbered by kernel topology;
 * - `mirror`: a mirror image of the feature's source.
 */
export type CadBodyOccurrence =
  | { readonly kind: 'inst'; readonly i: number; readonly j: number }
  | { readonly kind: 'split'; readonly k: number }
  | { readonly kind: 'mirror' };

declare const bodyKeyBrand: unique symbol;
/** A body key's canonical text: the creating feature's id, then each occurrence after a slash, as `pad`, `flip/mirror`, `pad/split(1)` or `pad/inst(2,0)`. */
export type CadBodyKey = string & { readonly [bodyKeyBrand]: true };

/** The longest key text accepted: a feature id and occurrence segments, which nest once per pattern and per split of a piece. */
export const MAX_CAD_BODY_KEY_LENGTH = 4096;
const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const SEGMENT = /^(?:inst\((0|[1-9]\d{0,5}),(0|[1-9]\d{0,5})\)|split\((0|[1-9]\d{0,5})\)|mirror)$/;
/** A whole key in one test, for checks that need no parts: each segment starts with a slash and a fixed word, so it runs in linear time. */
const BODY_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}(?:\/(?:inst\((?:0|[1-9]\d{0,5}),(?:0|[1-9]\d{0,5})\)|split\((?:0|[1-9]\d{0,5})\)|mirror))*$/;

function segment(occurrence: CadBodyOccurrence): string {
  return occurrence.kind === 'inst' ? `inst(${occurrence.i},${occurrence.j})` : occurrence.kind === 'split' ? `split(${occurrence.k})` : 'mirror';
}

/** The key of a body `featureId` creates, with the occurrences that lead from that feature to it. */
export function cadBodyKey(featureId: string, occurrences: readonly CadBodyOccurrence[] = []): CadBodyKey {
  return [featureId, ...occurrences.map(segment)].join('/') as CadBodyKey;
}

/** The key of an occurrence within the body or occurrence `key`. */
export function cadBodyKeyWith(key: CadBodyKey, occurrence: CadBodyOccurrence): CadBodyKey {
  return `${key}/${segment(occurrence)}` as CadBodyKey;
}

/** The creating feature and occurrences of a key's canonical text, or `undefined` for text that is not one. */
export function parseCadBodyKey(text: unknown): { readonly featureId: string; readonly occurrences: readonly CadBodyOccurrence[] } | undefined {
  if (typeof text !== 'string' || text.length > MAX_CAD_BODY_KEY_LENGTH) return undefined;
  const [featureId, ...segments] = text.split('/');
  if (!FEATURE_ID.test(featureId)) return undefined;
  const occurrences: CadBodyOccurrence[] = [];
  for (const part of segments) {
    const match = SEGMENT.exec(part);
    if (!match) return undefined;
    occurrences.push(match[1] !== undefined ? { kind: 'inst', i: Number(match[1]), j: Number(match[2]) } : match[3] !== undefined ? { kind: 'split', k: Number(match[3]) } : { kind: 'mirror' });
  }
  return { featureId, occurrences };
}

/** Whether `text` is a key's canonical text, as `parseCadBodyKey` reads it, without building its parts. */
export function isCadBodyKey(text: unknown): text is CadBodyKey {
  return typeof text === 'string' && text.length <= MAX_CAD_BODY_KEY_LENGTH && BODY_KEY.test(text);
}

/**
 * One body after a rebuild: its key and kind, the feature that created it and those that modified it since, in history order, and the
 * Boolean that consumed it as a tool, if one did. The last of `createdBy` and `modifiedBy` is the feature whose result the body now is:
 * what stored target and source fields and `CadMesh.featureId` name until S8 (`cadBodyFeatureId`).
 */
export interface CadBodyState {
  readonly key: CadBodyKey;
  readonly kind: CadBodyKind;
  readonly createdBy: string;
  readonly modifiedBy: readonly string[];
  readonly consumedBy?: string;
  /**
   * The key of each of the body's solids, by the solid numbers `CadMesh.faceSolids` uses, once a split or a pattern's separate copy gave
   * it parts; absent while the body is whole. A body with parts keeps them until K5, even when one solid is left.
   */
  readonly pieces?: readonly CadBodyKey[];
  /**
   * Keys no build ties to one solid with certainty: pieces the kernel might list in another order, their descendants, and earlier pieces
   * of the body that can't be found among its solids. A reference to one resolves as ambiguous.
   */
  readonly ambiguous?: readonly CadBodyKey[];
  /** The body has more parts than the lineage tracks, so it keeps none, and references to its parts resolve as missing. */
  readonly untracked?: true;
}

/** The most part keys a body tracks: pieces, or ambiguous keys. Past it the body's parts are untracked, never a rejected build. */
export const MAX_CAD_BODY_LIST = 4096;

function isFeatureId(value: unknown): value is string { return typeof value === 'string' && FEATURE_ID.test(value); }

/**
 * Part keys of the body `key`: keys other than its own, each made by the body's creator or one of its modifiers, as every piece, copy
 * and fresh key is. `makers` is built only for a body with parts.
 */
function isPartKeys(value: unknown, key: string, makers: () => ReadonlySet<string>): value is CadBodyKey[] {
  if (!Array.isArray(value) || value.length > MAX_CAD_BODY_LIST) return false;
  for (const part of value) {
    if (!isCadBodyKey(part)) return false;
    const slash = part.indexOf('/');
    if (slash < 0 || part === key || !makers().has(part.slice(0, slash))) return false;
  }
  return true;
}

/** Checks a body state received across the worker boundary. Every build reply runs it once per body, so it builds nothing it can avoid. */
export function isCadBodyState(value: unknown): value is CadBodyState {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Readonly<Record<string, unknown>>, key = body.key;
  if (!isCadBodyKey(key)) return false;
  const slash = key.indexOf('/'), modifiedBy = body.modifiedBy;
  if (body.createdBy !== (slash < 0 ? key : key.slice(0, slash))) return false;
  if (body.kind !== 'solid' && body.kind !== 'sheet' && body.kind !== 'wire') return false;
  // As long as the history: a body may be modified by any number of features.
  if (!Array.isArray(modifiedBy)) return false;
  for (const id of modifiedBy) if (!isFeatureId(id)) return false;
  if (body.consumedBy !== undefined && !isFeatureId(body.consumedBy)) return false;
  if (body.untracked !== undefined) return body.untracked === true && body.pieces === undefined && body.ambiguous === undefined;
  let makers: ReadonlySet<string> | undefined;
  const made = () => makers ??= new Set([body.createdBy as string, ...modifiedBy as string[]]);
  return (body.pieces === undefined || isPartKeys(body.pieces, key, made))
    && (body.ambiguous === undefined || isPartKeys(body.ambiguous, key, made));
}

const BODY_ISSUE_CODES: ReadonlySet<unknown> = new Set<CadBodyIssue['code']>(['ambiguous-body-parts', 'lost-body-parts', 'untracked-body-parts', 'more-body-issues']);

/** Checks a body issue received across the worker boundary. */
export function isCadBodyIssue(value: unknown): value is CadBodyIssue {
  if (typeof value !== 'object' || value === null) return false;
  const issue = value as Readonly<Record<string, unknown>>, pieces = issue.pieces;
  if (!BODY_ISSUE_CODES.has(issue.code) || !isFeatureId(issue.featureId) || !isCadBodyKey(issue.body)) return false;
  if (!Array.isArray(pieces) || pieces.length > MAX_CAD_BODY_LIST) return false;
  for (const piece of pieces) if (!isCadBodyKey(piece)) return false;
  return typeof issue.message === 'string' && issue.message.length <= MAX_CAD_BODY_ISSUE_MESSAGE;
}

/** The feature whose result the body now is: its last modifier, or its creator. */
export function cadBodyFeatureId(state: Pick<CadBodyState, 'createdBy' | 'modifiedBy'>): string {
  return state.modifiedBy.length ? state.modifiedBy[state.modifiedBy.length - 1] : state.createdBy;
}

/**
 * A body fact a rebuild could not settle, for D1 to adopt as an issue. `pieces` lists every key it is about, in full; the message names
 * only their count, so its length is bounded by the body key's.
 * - `ambiguous-body-parts`: after `featureId`, no build ties `pieces` of `body` to one solid each with certainty. References to them
 *   resolve as ambiguous.
 * - `lost-body-parts`: `featureId` removed `pieces` of `body`, or merged them into another solid. References to them resolve as missing.
 * - `untracked-body-parts`: after `featureId`, `body` has more parts than the lineage tracks, so it keeps none from then on.
 * - `more-body-issues`: the issues from `featureId` on did not fit in the list; the message gives how many were left out.
 */
export interface CadBodyIssue {
  readonly code: 'ambiguous-body-parts' | 'lost-body-parts' | 'untracked-body-parts' | 'more-body-issues';
  readonly featureId: string;
  readonly body: CadBodyKey;
  readonly pieces: readonly CadBodyKey[];
  readonly message: string;
}

/** The most issues one build lists: the last place goes to a `more-body-issues` summary when there are more. */
export const MAX_CAD_BODY_ISSUES = 512;
/** The longest issue message: a body key and a sentence. */
const MAX_CAD_BODY_ISSUE_MESSAGE = 8192;

/**
 * A shape whose faces a feature's result may keep: the target before the feature, a pattern's copy of it, at `inst(i,j)`, or a tool the
 * feature fused into it. A pattern's copy at `inst(0,0)` is the target itself.
 */
export type CadBodySource = { readonly kind: 'target' } | { readonly kind: 'copy'; readonly i: number; readonly j: number } | { readonly kind: 'tool' };

/** A solid of a source that a solid of the result keeps a face of unchanged, with the first such face's place in the source's face order, from 1. */
export interface CadBodySolidSource {
  /** The source's place in `CadBodyKernelFacts.sources`. */
  readonly source: number;
  /** The solid's number in the source, as `CadMesh.faceSolids` numbers a result's solids; a copy numbers its solids as the target does. */
  readonly solid: number;
  readonly rank: number;
}

/** What only the kernel knows about a feature's result, which the body's parts depend on. */
export interface CadBodyKernelFacts {
  /** The result's solid count. */
  readonly solids: number;
  /** Whether the feature removes material from its target, and so may split it. */
  readonly removesMaterial: boolean;
  /** The result lists its solids exactly as its target did, as a moved copy does. */
  readonly sameSolidOrder?: boolean;
  /** The shapes the feature combined, its target first. */
  readonly sources: readonly CadBodySource[];
  /** For each solid of the result, every source solid it keeps a face of; called only when the body's parts depend on it. */
  provenance(): readonly (readonly CadBodySolidSource[])[];
}

/** How one feature changed the bodies: the body it made or kept, and the keys it consumed. */
export interface CadBodyChange {
  readonly state: CadBodyState;
  /** Whether the feature kept the key of a body that existed before it. */
  readonly kept: boolean;
  readonly consumed: readonly CadBodyKey[];
}

/**
 * The bodies of one history, applied feature by feature in history order. A feature's body behaviour decides its effect:
 * - `none`: no body;
 * - `new`: a body keyed by the feature, with the kind's `occurrence`, such as a mirror image's `mirror`;
 * - `modify-target`: its target or source keeps its key and records the feature as a modifier;
 * - `new-or-modify`: as `modify-target` when it names a target, otherwise as `new`;
 * - `consume-tools`: as `modify-target` for its target; each tool is consumed by it.
 * With the kernel's facts, the kept body's parts follow its solids (`cadBodyParts`): a pattern's separate copies are `inst(i,j)` parts and
 * split pieces `split(k)` parts. An inactive feature changes no body. Its suppression decides what its own id stands for meanwhile:
 * `pass-through` passes on the body it would have changed (`of`); `no-output` stands for nothing.
 */
export interface CadBodyLineage {
  /** Applies the next feature. The kernel passes facts about its result; without them the lineage tracks no pieces. */
  apply(feature: CadFeature, scope: CadFeatureScope, facts?: CadBodyKernelFacts): CadBodyChange | undefined;
  /** The key `feature` would make or keep if applied next, without applying it. */
  keyFor(feature: CadFeature, scope: CadFeatureScope): CadBodyKey | undefined;
  /** The current body whose state `featureId` is: how a stored target or source resolves to a body until S8 stores body refs. */
  at(featureId: string): CadBodyState | undefined;
  /** The current body that `featureId` created, modified or, suppressed with `pass-through`, passes on: where a selected feature leads. */
  of(featureId: string): CadBodyState | undefined;
  /** The current body with `key`. */
  get(key: CadBodyKey): CadBodyState | undefined;
  /** Current bodies, oldest current state first, as meshes list them. */
  bodies(): readonly CadBodyState[];
  /** Bodies consumed as Boolean tools, in the order they were consumed. */
  consumed(): readonly CadBodyState[];
  /** The body most recently created or modified. */
  latest(): CadBodyState | undefined;
  issues(): readonly CadBodyIssue[];
}

interface Entry { readonly state: CadBodyState; readonly solids: number | undefined; readonly order: number }

/** The body inputs of `feature`: the one it keeps, by its target or source slot, and the others, which it consumes as tools. */
function bodyInputs(feature: CadFeature): { readonly kept: string | undefined; readonly tools: readonly string[] } {
  let kept: string | undefined; const tools: string[] = [];
  for (const { name, meaning: slot } of cadFeatureLayout(feature).slots) {
    if (slot.accepts[0] !== 'body') continue;
    const value = (feature as unknown as Readonly<Record<string, unknown>>)[name];
    if (value === undefined || value === null) continue;
    for (const id of slot.ids(value)) {
      if (kept === undefined && (slot.role === 'target' || slot.role === 'source')) kept = id;
      else tools.push(id);
    }
  }
  return { kept, tools };
}

function withSplit(key: CadBodyKey, k: number): CadBodyKey { return cadBodyKeyWith(key, { kind: 'split', k }); }

function freeze<T extends object>(value: T): T { return Object.freeze(value); }

/** How a feature that kept a body's key changed its parts. */
export interface CadBodyParts {
  readonly pieces?: readonly CadBodyKey[];
  readonly ambiguous?: readonly CadBodyKey[];
  readonly untracked?: true;
  /** Keys the feature left ambiguous that were not before it, for an `ambiguous-body-parts` issue. */
  readonly ambiguousNow: readonly CadBodyKey[];
  /** Pieces of the body before the feature that it removed or merged into another solid, for a `lost-body-parts` issue. */
  readonly lost: readonly CadBodyKey[];
  /** The feature gave the body more parts than the lineage tracks, for an `untracked-body-parts` issue. */
  readonly overflowed?: true;
}

const NONE: readonly CadBodyKey[] = freeze([]);
const WHOLE: CadBodyParts = freeze({ ambiguousNow: NONE, lost: NONE });
const UNTRACKED: CadBodyParts = freeze({ untracked: true as const, ambiguousNow: NONE, lost: NONE });
const OVERFLOWED: CadBodyParts = freeze({ untracked: true as const, ambiguousNow: NONE, lost: NONE, overflowed: true as const });
/** What every tool solid passes on: never a key, since a key is never empty. Solids of a fused tool alone get fresh keys. */
const TOOL = '' as CadBodyKey;

/** A key a solid of the result continues, with where it came from: `rank` orders the solids continuing the same key. */
interface Continuation { readonly solid: number; readonly rank: number }

/**
 * The parts of a body after a feature that kept its key, from every source solid each solid of the result keeps a face of. A key is
 * inherited only when continuity is certain; anything else gets a fresh key, a reported ambiguity or a reported loss. Precise lineage
 * through Booleans and splits waits for the kernel's own history (K3).
 *
 * A whole body stays whole until one of its solids splits (one leaves several solids, or a feature without a tool or copies leaves more
 * solids than it had), or a pattern leaves a copy apart from the originals. A tool fused into a whole body keeps it whole.
 *
 * Each source solid passes on a key: a target solid its piece's key, or the body's while whole; a pattern's copy `inst(i,j)` of it, the
 * target itself being `inst(0,0)`; a tool solid no key. Then each solid of the result:
 * - continues the one target key it keeps faces of: a Boolean keeps its target's key;
 * - keeping no target face, continues the one copy key it keeps faces of, or the tool;
 * - keeping faces of several target keys, or of several copies and no target, merges them: it gets a fresh key, and the merged pieces
 *   are reported lost;
 * - keeping no face at all, descends from the target's one key when the target has one and the feature added no material; otherwise it
 *   gets a fresh key, and pieces of the body before that no solid continues can't be identified, so they are ambiguous, as is it.
 * A key continued by one solid stays; continued by several, each is `key/split(q)`, q by the rank of the first face it keeps, then the
 * solids keeping none in the kernel's order. Fresh keys are `feature/split(k)`: solids continuing the tool by rank, merges by rank, then
 * solids keeping no face in the kernel's order. Solids numbered in the kernel's order are ambiguous when there are two or more of them,
 * never ordered by where they lie. A solid descending from an ambiguous key is ambiguous too, until K5 can establish identity.
 * A piece no solid continues or merges is lost, unless pieces can't be identified.
 */
export function cadBodyParts(input: {
  readonly featureId: string;
  readonly previous: CadBodyState;
  readonly beforeSolids: number | undefined;
  readonly facts: CadBodyKernelFacts;
}): CadBodyParts {
  const { featureId, previous, facts } = input, key = previous.key, count = facts.solids, before = previous.pieces;
  if (previous.untracked) return UNTRACKED;
  if (before && facts.sameSolidOrder && before.length === count) return freeze({ pieces: before, ambiguous: previous.ambiguous, ambiguousNow: NONE, lost: NONE });
  const patterned = facts.sources.some(source => source.kind === 'copy'), fused = facts.sources.some(source => source.kind === 'tool');
  const beforeSolids = input.beforeSolids ?? 1;
  if (!before && (count <= 1 || fused && !patterned || !patterned && !facts.removesMaterial && count <= beforeSolids)) return WHOLE;
  if (count > MAX_CAD_BODY_LIST) return OVERFLOWED;
  const traced = facts.provenance();
  if (traced.length !== count) throw new Error('Each solid of the result needs its sources.');
  if (!before && (patterned ? traced.every(sources => sources.some(entry => entry.source === 0)) : !splits(traced, count, beforeSolids))) return WHOLE;

  // The key each source solid passes on, and for a target solid or a copy the piece before it came from.
  const previousKey = (solid: number) => {
    const found = before ? before[solid] : key;
    if (found === undefined) throw new Error('A source solid the body did not have.');
    return found;
  };
  const targetFrom = new Map<CadBodyKey, CadBodyKey>();
  const continued = new Map<CadBodyKey, Continuation[]>(), merged: Continuation[] = [], orphans: number[] = [];
  const continuedFrom = new Set<CadBodyKey>(), mergedFrom = new Set<CadBodyKey>(), descends: (readonly CadBodyKey[])[] = [];
  const add = (into: Map<CadBodyKey, number>, passed: CadBodyKey, rank: number) => { const known = into.get(passed); if (known === undefined || rank < known) into.set(passed, rank); };
  const push = (passed: CadBodyKey, entry: Continuation) => { const list = continued.get(passed); if (list) list.push(entry); else continued.set(passed, [entry]); };
  traced.forEach((sources, solid) => {
    const targets = new Map<CadBodyKey, number>(), added = new Map<CadBodyKey, number>(), from: CadBodyKey[] = [];
    for (const entry of sources) {
      const source = facts.sources[entry.source];
      if (!source) throw new Error('A source the feature did not combine.');
      // Ranks of different sources compare source first.
      const rank = entry.source * 2 ** 32 + entry.rank;
      if (source.kind === 'tool') { add(added, TOOL, rank); continue; }
      const origin = previousKey(entry.solid);
      from.push(origin);
      if (source.kind === 'copy') { add(added, cadBodyKeyWith(origin, { kind: 'inst', i: source.i, j: source.j }), rank); continue; }
      const passed = patterned ? cadBodyKeyWith(origin, { kind: 'inst', i: 0, j: 0 }) : origin;
      targetFrom.set(passed, origin);
      add(targets, passed, rank);
    }
    descends[solid] = from;
    if (targets.size === 1) {
      const [[passed, rank]] = targets;
      push(passed, { solid, rank }); continuedFrom.add(targetFrom.get(passed)!);
    } else if (targets.size === 0 && added.size === 1) {
      const [[passed, rank]] = added;
      push(passed, { solid, rank });
    } else if (targets.size || added.size) {
      merged.push({ solid, rank: Math.min(...targets.values(), ...added.values()) });
      for (const passed of targets.keys()) mergedFrom.add(targetFrom.get(passed)!);
    } else orphans.push(solid);
  });

  const pieces = new Array<CadBodyKey>(count), ordered = new Set<number>();
  // A solid keeping no face descends from the target's one key when nothing else could have made it.
  if (orphans.length && !patterned && !fused && (!before || before.length === 1)) {
    const origin = before ? before[0] : key;
    for (const solid of orphans) { push(origin, { solid, rank: Infinity }); descends[solid] = [origin]; if (orphans.length > 1) ordered.add(solid); }
    continuedFrom.add(origin);
    orphans.length = 0;
  }
  const byRank = (a: Continuation, b: Continuation) => a.rank - b.rank || a.solid - b.solid;
  const fresh: number[] = [];
  for (const [passed, list] of continued) {
    list.sort(byRank);
    if (passed === TOOL) { fresh.push(...list.map(entry => entry.solid)); continue; }
    if (list.length === 1 && passed !== key) pieces[list[0].solid] = passed;
    else list.forEach((entry, q) => { pieces[entry.solid] = withSplit(passed, q); });
  }
  fresh.push(...merged.sort(byRank).map(entry => entry.solid), ...orphans);
  fresh.forEach((solid, k) => { pieces[solid] = cadBodyKey(featureId, [{ kind: 'split', k }]); });

  // Pieces before that no solid continues: lost when merged, or when no solid keeping no face could be one of them; else unidentified.
  const gone = (before ?? []).filter(piece => !continuedFrom.has(piece));
  const unidentified = orphans.length ? gone.filter(piece => !mergedFrom.has(piece)) : [];
  const lost = orphans.length ? gone.filter(piece => mergedFrom.has(piece)) : gone;
  if (orphans.length > 1 || unidentified.length) for (const solid of orphans) ordered.add(solid);

  const was = new Set(previous.ambiguous ?? []), uncertain = new Set<CadBodyKey>();
  pieces.forEach((piece, solid) => { if (ordered.has(solid) || descends[solid].some(origin => was.has(origin))) uncertain.add(piece); });
  if (uncertain.size) {
    const pieceSet = new Set(before ?? []);
    // Earlier keys that were already unidentified stay so while a solid they could be remains ambiguous.
    for (const earlier of previous.ambiguous ?? []) if (!pieceSet.has(earlier)) uncertain.add(earlier);
  }
  for (const earlier of unidentified) uncertain.add(earlier);
  if (uncertain.size > MAX_CAD_BODY_LIST || pieces.some(piece => piece.length > MAX_CAD_BODY_KEY_LENGTH)) return OVERFLOWED;
  const ambiguous = [...uncertain];
  return freeze({ pieces: freeze(pieces), ...(ambiguous.length ? { ambiguous: freeze(ambiguous) } : {}),
    ambiguousNow: freeze(ambiguous.filter(piece => !was.has(piece))), lost: freeze(lost) });
}

/** Whether a whole body split: one of its solids leaves several solids, or there are more solids than it had. */
function splits(traced: readonly (readonly CadBodySolidSource[])[], count: number, beforeSolids: number): boolean {
  if (count > beforeSolids) return true;
  const reached = new Map<number, number>();
  for (const [solid, sources] of traced.entries()) {
    for (const entry of sources) {
      if (entry.source !== 0) continue;
      const last = reached.get(entry.solid);
      if (last !== undefined && last !== solid) return true;
      reached.set(entry.solid, solid);
    }
  }
  return false;
}

function state(fields: { key: CadBodyKey; createdBy: string; modifiedBy: readonly string[]; consumedBy?: string;
  pieces?: readonly CadBodyKey[]; ambiguous?: readonly CadBodyKey[]; untracked?: true }): CadBodyState {
  return freeze({
    key: fields.key, kind: 'solid' as const, createdBy: fields.createdBy, modifiedBy: freeze([...fields.modifiedBy]),
    ...(fields.consumedBy !== undefined ? { consumedBy: fields.consumedBy } : {}),
    ...(fields.untracked ? { untracked: true as const } : {}),
    ...(fields.pieces && !fields.untracked ? { pieces: freeze([...fields.pieces]) } : {}),
    ...(fields.ambiguous?.length && !fields.untracked ? { ambiguous: freeze([...fields.ambiguous]) } : {})
  });
}

/** `n` pieces, in words. */
function piecesOf(n: number): string { return n === 1 ? '1 piece' : `${n} pieces`; }

export function createCadBodyLineage(): CadBodyLineage {
  /** Current bodies by the feature whose result each now is, in the order meshes list them. */
  const current = new Map<string, Entry>();
  const byKey = new Map<CadBodyKey, string>();
  /** The key of the body each feature created, modified or passes on, for `of`. */
  const owners = new Map<string, CadBodyKey>();
  const consumed: CadBodyState[] = [], issues: CadBodyIssue[] = [];
  let applied = 0;

  function plan(feature: CadFeature, scope: CadFeatureScope) {
    const definition = cadFeatureDefinition(feature.kind);
    if (definition.body === 'none' || !cadFeatureActive(feature, scope)) return undefined;
    const { kept, tools } = definition.body === 'new' ? { kept: undefined, tools: [] } : bodyInputs(feature);
    const target = kept === undefined ? undefined : current.get(kept);
    // A target that is not a current body is refused before any rebuild; a prediction starts a body of its own for it.
    const key = target?.state.key ?? cadBodyKey(feature.id, definition.occurrence === 'mirror' ? [{ kind: 'mirror' }] : []);
    return { kept, tools, target, key };
  }

  return {
    apply(feature, scope, facts) {
      applied++;
      const step = plan(feature, scope);
      if (!step) {
        const definition = cadFeatureDefinition(feature.kind);
        if (definition.body !== 'none' && definition.suppression === 'pass-through' && definition.body !== 'new') {
          const kept = bodyInputs(feature).kept, passed = kept === undefined ? undefined : current.get(kept);
          if (passed) owners.set(feature.id, passed.state.key);
        }
        return undefined;
      }
      const { kept, tools, target, key } = step;
      const previous = target?.state;
      // Settle everything that can fail before changing the lineage.
      const parts = previous && facts ? cadBodyParts({ featureId: feature.id, previous, beforeSolids: target!.solids, facts }) : undefined;
      const next = state({
        key, createdBy: previous?.createdBy ?? feature.id, modifiedBy: previous ? [...previous.modifiedBy, feature.id] : [],
        pieces: (parts ?? previous)?.pieces, ambiguous: (parts ?? previous)?.ambiguous, untracked: (parts ?? previous)?.untracked
      });
      const gone: CadBodyKey[] = [];
      if (kept !== undefined && target) current.delete(kept);
      for (const id of tools) {
        const tool = current.get(id);
        if (!tool) continue;
        current.delete(id); byKey.delete(tool.state.key); gone.push(tool.state.key);
        consumed.push(state({ ...tool.state, consumedBy: feature.id }));
      }
      current.set(feature.id, { state: next, solids: facts?.solids, order: applied });
      byKey.set(key, feature.id); owners.set(feature.id, key);
      const report = (code: CadBodyIssue['code'], pieces: readonly CadBodyKey[], message: string) => {
        issues.push(freeze({ code, featureId: feature.id, body: key, pieces, message }));
      };
      if (parts?.overflowed) report('untracked-body-parts', NONE, `Body ${key} has more parts than are tracked after ${feature.id}, so references to its parts resolve as missing.`);
      if (parts?.ambiguousNow.length) report('ambiguous-body-parts', parts.ambiguousNow,
        `${piecesOf(parts.ambiguousNow.length)} of body ${key} can't be told apart after ${feature.id}, so references to them are ambiguous.`);
      if (parts?.lost.length) report('lost-body-parts', parts.lost,
        `${piecesOf(parts.lost.length)} of body ${key} no longer exist as separate solids after ${feature.id}, which removed them or merged them into another.`);
      return freeze({ state: next, kept: previous !== undefined, consumed: freeze(gone) });
    },
    keyFor(feature, scope) { return plan(feature, scope)?.key; },
    at(featureId) { return current.get(featureId)?.state; },
    of(featureId) {
      const key = owners.get(featureId), id = key === undefined ? undefined : byKey.get(key);
      return id === undefined ? undefined : current.get(id)?.state;
    },
    get(key) { const id = byKey.get(key); return id === undefined ? undefined : current.get(id)?.state; },
    bodies() { return [...current.values()].map(entry => entry.state); },
    consumed() { return [...consumed]; },
    latest() {
      let latest: Entry | undefined;
      for (const entry of current.values()) if (!latest || entry.order > latest.order) latest = entry;
      return latest?.state;
    },
    issues() {
      if (issues.length <= MAX_CAD_BODY_ISSUES) return [...issues];
      const listed = issues.slice(0, MAX_CAD_BODY_ISSUES - 1), first = issues[listed.length];
      return [...listed, freeze({ code: 'more-body-issues' as const, featureId: first.featureId, body: first.body, pieces: NONE,
        message: `${issues.length - listed.length} more body issues, from feature ${first.featureId} on, are not listed.` })];
    }
  };
}

/** The lineage of `features` read in `scope`, without kernel facts: keys, creators, modifiers and consumers, but no pieces. */
export function cadBodyLineage(features: readonly CadFeature[], scope: CadFeatureScope): CadBodyLineage {
  const lineage = createCadBodyLineage();
  for (const feature of features) lineage.apply(feature, scope);
  return lineage;
}

/**
 * The built body a selection leads to, by key: the body `selectedId` created, modified or passes on, when the build drew it; otherwise
 * the body most recently created or modified among those drawn. `builtIds` are the ids of the drawn bodies, as `CadMesh.featureId`
 * gives them. `except` leaves out one body, for a second operand.
 */
export function cadSelectedBody(lineage: CadBodyLineage, selectedId: string | null | undefined, builtIds: readonly string[], except?: CadBodyKey): CadBodyState | undefined {
  const drawn = (body: CadBodyState) => body.key !== except && builtIds.includes(cadBodyFeatureId(body));
  const selected = selectedId == null ? undefined : lineage.of(selectedId);
  if (selected && drawn(selected)) return selected;
  return lineage.bodies().filter(drawn).at(-1);
}

/** The bodies left after `features` in `scope`, as the ids of the features whose results they are, oldest current state first. */
export function cadVisibleBodyIds(features: readonly CadFeature[], scope: CadFeatureScope): readonly string[] {
  return cadBodyLineage(features, scope).bodies().map(cadBodyFeatureId);
}

/**
 * S8's stored reference to a body, for a feature's target, source or tool: its key, resolved against the bodies just before the
 * referring feature. A key with a piece or pattern occurrence names that part of a body. Not stored before S8's format cut; until then
 * a stored target holds the id of the feature whose result the body is, resolved with `CadBodyLineage.at`.
 */
export interface CadBodyRef { readonly kind: 'body'; readonly key: CadBodyKey }

/** How a body reference resolves, with the outcomes every reference shares. */
export type CadBodyRefResolution =
  | { readonly status: 'resolved'; readonly body: CadBodyState; readonly part?: CadBodyKey }
  | { readonly status: 'missing'; readonly consumedBy?: string }
  | { readonly status: 'ambiguous'; readonly body: CadBodyState; readonly candidates: readonly CadBodyKey[] };

/**
 * Resolves `ref` against `lineage` as it stands before the referring feature. A whole body's key resolves to it, and a piece's to that
 * part. An ambiguous key resolves as ambiguous, with the body's ambiguous pieces as candidates, or as missing once none is left. Anything
 * else is missing: a lost piece, a split piece's old key, a part of an untracked body, or a consumed body or one of its parts.
 */
export function resolveCadBodyRef(ref: CadBodyRef, lineage: Pick<CadBodyLineage, 'get' | 'bodies' | 'consumed'>): CadBodyRefResolution {
  const whole = lineage.get(ref.key);
  if (whole) return { status: 'resolved', body: whole };
  for (const body of lineage.bodies()) {
    if (body.ambiguous?.includes(ref.key)) {
      const uncertain = new Set(body.ambiguous), candidates = (body.pieces ?? []).filter(piece => uncertain.has(piece));
      if (candidates.length) return { status: 'ambiguous', body, candidates };
    }
    if (body.pieces?.includes(ref.key)) return { status: 'resolved', body, part: ref.key };
  }
  const gone = lineage.consumed().find(body => body.key === ref.key || body.pieces?.includes(ref.key));
  return gone?.consumedBy !== undefined ? { status: 'missing', consumedBy: gone.consumedBy } : { status: 'missing' };
}

/** What a body is for in a setup: the part made, the stock it is cut from, a fixture holding it, or reference geometry. */
export type CadBodyRole = 'part' | 'stock' | 'fixture' | 'reference';
/** How a body is drawn: an sRGB colour as `#rrggbb`. */
export interface CadBodyAppearance { readonly color: string }
/**
 * What S8 stores for a body, keyed by its key: a name, a role, and optionally an appearance and a material name. Display only:
 * metadata never changes geometry, and an entry whose body is gone is a harmless orphan.
 */
export interface CadBodyMetadata {
  readonly name: string;
  readonly role: CadBodyRole;
  readonly appearance?: CadBodyAppearance;
  readonly material?: string;
}

/**
 * A body's metadata: what `stored` holds for its key, or the defaults until S8 stores any, its creating feature's name and the `part`
 * role. `stored` is S8's record; F0 passes none.
 */
export function resolveCadBodyMetadata(body: CadBodyState, featureName: (featureId: string) => string | undefined,
  stored?: ReadonlyMap<CadBodyKey, CadBodyMetadata>): CadBodyMetadata {
  return stored?.get(body.key) ?? { name: featureName(body.createdBy) ?? body.key, role: 'part' };
}

/** The keys in S8's stored metadata that name no current or consumed body, which display ignores. */
export function cadBodyMetadataOrphans(stored: ReadonlyMap<CadBodyKey, CadBodyMetadata>, lineage: CadBodyLineage): readonly CadBodyKey[] {
  const known = new Set<CadBodyKey>([...lineage.bodies(), ...lineage.consumed()].map(body => body.key));
  return [...stored.keys()].filter(key => !known.has(key));
}
