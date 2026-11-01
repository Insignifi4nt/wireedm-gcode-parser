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
  /** Each copy a pattern made of the body, by logical key in the order the patterns made them; absent until a pattern modifies it. */
  readonly occurrences?: readonly CadBodyKey[];
  /** The key of each of the body's solids, by the solid numbers `CadMesh.faceSolids` uses, once a feature split it; absent while whole. */
  readonly pieces?: readonly CadBodyKey[];
  /** Pieces the kernel might list in another order for the same input, so references to them are ambiguous. */
  readonly ambiguous?: readonly CadBodyKey[];
}

/** The most entries a body list holds across the worker boundary: modifiers, pattern copies or pieces. */
const MAX_CAD_BODY_LIST = 4096;

function isFeatureId(value: unknown): value is string { return typeof value === 'string' && FEATURE_ID.test(value); }

/** Keys of parts of the body `key`: pattern copies or pieces, each starting with the body's key. */
function isPartKeys(value: unknown, key: string): value is CadBodyKey[] {
  if (!Array.isArray(value) || value.length > MAX_CAD_BODY_LIST) return false;
  const prefix = `${key}/`;
  for (const part of value) if (!isCadBodyKey(part) || !part.startsWith(prefix)) return false;
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
  if (!Array.isArray(modifiedBy) || modifiedBy.length > MAX_CAD_BODY_LIST) return false;
  for (const id of modifiedBy) if (!isFeatureId(id)) return false;
  return (body.consumedBy === undefined || isFeatureId(body.consumedBy))
    && (body.occurrences === undefined || isPartKeys(body.occurrences, key))
    && (body.pieces === undefined || isPartKeys(body.pieces, key))
    && (body.ambiguous === undefined || isPartKeys(body.ambiguous, key));
}

/** Checks a body issue received across the worker boundary. */
export function isCadBodyIssue(value: unknown): value is CadBodyIssue {
  if (typeof value !== 'object' || value === null) return false;
  const issue = value as Readonly<Record<string, unknown>>;
  return issue.code === 'ambiguous-split-order' && isFeatureId(issue.featureId) && isCadBodyKey(issue.body) && isPartKeys(issue.pieces, issue.body)
    && typeof issue.message === 'string' && issue.message.length <= 8192;
}

/** The feature whose result the body now is: its last modifier, or its creator. */
export function cadBodyFeatureId(state: Pick<CadBodyState, 'createdBy' | 'modifiedBy'>): string {
  return state.modifiedBy.length ? state.modifiedBy[state.modifiedBy.length - 1] : state.createdBy;
}

/**
 * A body fact a rebuild could not settle, for D1 to adopt as an issue: after `featureId`, the kernel might list `pieces` of `body` in
 * another order for the same input, because none of them keeps a face of the body before it, so a key may name a different piece.
 */
export interface CadBodyIssue {
  readonly code: 'ambiguous-split-order';
  readonly featureId: string;
  readonly body: CadBodyKey;
  readonly pieces: readonly CadBodyKey[];
  readonly message: string;
}

/** Where a solid of a result came from: the solid of the body before it that holds the first of its faces it keeps unchanged, and that face's rank. */
export interface CadBodySolidOrigin {
  /** The solid's number in the previous result. */
  readonly solid: number;
  /** The kept face's place in the previous result's face order, from 1. */
  readonly rank: number;
}

/** What only the kernel knows about a feature's result, which the body's pieces depend on. */
export interface CadBodyKernelFacts {
  /** The result's solid count. */
  readonly solids: number;
  /** Whether the feature removes material from its target, and so may split it. */
  readonly removesMaterial: boolean;
  /** The result lists its solids exactly as its target did, as a moved copy does. */
  readonly sameSolidOrder?: boolean;
  /** For each solid of the result, its origin, or `null` where it keeps no face; called only while pieces are tracked. */
  origins(previous: CadBodyState): readonly (CadBodySolidOrigin | null)[];
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
 * A kind's repeating counts (`repeats`) make `inst(i,j)` occurrences. An inactive feature changes no body. Its suppression decides what
 * its own id stands for meanwhile: `pass-through` passes on the body it would have changed (`of`); `no-output` stands for nothing.
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

/** The next free piece number directly under `key` among `keys`. */
function nextSplit(key: CadBodyKey, keys: readonly (CadBodyKey | undefined)[]): number {
  let next = 0; const prefix = `${key}/split(`;
  for (const piece of keys) {
    if (!piece?.startsWith(prefix) || piece.indexOf('/', prefix.length) >= 0) continue;
    next = Math.max(next, Number(piece.slice(prefix.length, -1)) + 1);
  }
  return next;
}

/**
 * The pieces of a body after a feature that kept its key, from where each solid of the result came from. A body is split when a feature
 * that removes material leaves more solids than the body had; from then on its solids are pieces until it is whole again.
 * - On the first split, each piece is `key/split(k)`, k counting pieces by the rank of the first face they keep of the body before.
 * - Later, a solid keeping a face of piece P is P again, or `P/split(q)` when P left several, q by rank. A solid keeping no face takes
 *   the one previous piece no solid kept a face of, or else a new number under the body.
 * Two or more solids keeping no face, or one with several candidates, cannot be told apart: the kernel might list them in another order
 * for the same input. They are numbered in the kernel's order and reported, never ordered by where they lie.
 */
export function cadBodyPieces(input: {
  readonly key: CadBodyKey;
  readonly before: readonly CadBodyKey[] | undefined;
  readonly beforeSolids: number | undefined;
  readonly facts: CadBodyKernelFacts;
  readonly previous: CadBodyState;
}): { readonly pieces?: readonly CadBodyKey[]; readonly ambiguous: readonly CadBodyKey[] } {
  const { key, before, facts } = input, count = facts.solids;
  if (count <= 1) return { ambiguous: [] };
  if (!before && !(facts.removesMaterial && count > (input.beforeSolids ?? 1))) return { ambiguous: [] };
  if (before && facts.sameSolidOrder && before.length === count) return { pieces: before, ambiguous: input.previous.ambiguous ?? [] };
  const origins = facts.origins(input.previous);
  if (origins.length !== count) throw new Error('Each solid of the result needs an origin.');
  const pieces = new Array<CadBodyKey>(count), ambiguous: CadBodyKey[] = [];
  const groups = new Map<CadBodyKey, { solid: number; rank: number }[]>(), unmatched: number[] = [];
  origins.forEach((origin, solid) => {
    if (!origin) { unmatched.push(solid); return; }
    const parent = before ? before[origin.solid] ?? key : key;
    const group = groups.get(parent);
    if (group) group.push({ solid, rank: origin.rank }); else groups.set(parent, [{ solid, rank: origin.rank }]);
  });
  const byRank = (a: { rank: number }, b: { rank: number }) => a.rank - b.rank;
  if (!before) {
    const ranked = (groups.get(key) ?? []).sort(byRank);
    ranked.forEach((entry, k) => { pieces[entry.solid] = withSplit(key, k); });
    unmatched.forEach((solid, index) => { pieces[solid] = withSplit(key, ranked.length + index); });
    if (unmatched.length > 1) ambiguous.push(...unmatched.map(solid => pieces[solid]));
  } else {
    const kept = new Set<CadBodyKey>();
    for (const [parent, children] of groups) {
      kept.add(parent);
      children.sort(byRank);
      if (children.length === 1) pieces[children[0].solid] = parent;
      else children.forEach((child, q) => { pieces[child.solid] = withSplit(parent, q); });
    }
    const orphans = before.filter(piece => !kept.has(piece));
    let fresh = nextSplit(key, [...before, ...pieces]);
    unmatched.forEach((solid, index) => { pieces[solid] = index < orphans.length ? orphans[index] : withSplit(key, fresh++); });
    if (unmatched.length > 1 || unmatched.length === 1 && orphans.length > 1) ambiguous.push(...unmatched.map(solid => pieces[solid]));
  }
  return { pieces, ambiguous };
}

function freeze<T extends object>(value: T): T { return Object.freeze(value); }

function state(fields: { key: CadBodyKey; createdBy: string; modifiedBy: readonly string[]; consumedBy?: string; occurrences?: readonly CadBodyKey[];
  pieces?: readonly CadBodyKey[]; ambiguous?: readonly CadBodyKey[] }): CadBodyState {
  return freeze({
    key: fields.key, kind: 'solid' as const, createdBy: fields.createdBy, modifiedBy: freeze([...fields.modifiedBy]),
    ...(fields.consumedBy !== undefined ? { consumedBy: fields.consumedBy } : {}),
    ...(fields.occurrences ? { occurrences: freeze([...fields.occurrences]) } : {}),
    ...(fields.pieces ? { pieces: freeze([...fields.pieces]) } : {}),
    ...(fields.ambiguous?.length ? { ambiguous: freeze([...fields.ambiguous]) } : {})
  });
}

/** The pattern copies of a body with `key` and `occurrences` after `feature`, from its repeating counts. */
function patterned(feature: CadFeature, key: CadBodyKey, occurrences: readonly CadBodyKey[] | undefined): readonly CadBodyKey[] | undefined {
  const counts = cadFeatureLayout(feature).repeats.map(name => (feature as unknown as Readonly<Record<string, number>>)[name]);
  if (!counts.length) return occurrences;
  const [first, second = 1] = counts, bases = occurrences ?? [key], copies: CadBodyKey[] = [];
  for (let i = 0; i < first; i++) for (let j = 0; j < second; j++) for (const base of bases) copies.push(cadBodyKeyWith(base, { kind: 'inst', i, j }));
  return copies;
}

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
      const split = previous && facts ? cadBodyPieces({ key, before: previous.pieces, beforeSolids: target!.solids, facts, previous }) : undefined;
      const next = state({
        key, createdBy: previous?.createdBy ?? feature.id, modifiedBy: previous ? [...previous.modifiedBy, feature.id] : [],
        occurrences: patterned(feature, key, previous?.occurrences),
        pieces: split ? split.pieces : previous?.pieces, ambiguous: split ? split.ambiguous : previous?.ambiguous
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
      if (split?.ambiguous.length) issues.push(freeze({ code: 'ambiguous-split-order' as const, featureId: feature.id, body: key, pieces: freeze([...split.ambiguous]),
        message: `The kernel might list pieces ${split.ambiguous.join(', ')} in another order, because none keeps a face of the body before. References to them are ambiguous.` }));
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
    issues() { return [...issues]; }
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

/** Resolves `ref` against `lineage` as it stands before the referring feature. */
export function resolveCadBodyRef(ref: CadBodyRef, lineage: CadBodyLineage): CadBodyRefResolution {
  const whole = lineage.get(ref.key);
  if (whole) return { status: 'resolved', body: whole };
  for (const body of lineage.bodies()) {
    if (!ref.key.startsWith(`${body.key}/`)) continue;
    if (body.ambiguous?.includes(ref.key)) return { status: 'ambiguous', body, candidates: body.ambiguous };
    if (body.pieces?.includes(ref.key) || body.occurrences?.includes(ref.key)) return { status: 'resolved', body, part: ref.key };
  }
  const gone = lineage.consumed().find(body => body.key === ref.key);
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
