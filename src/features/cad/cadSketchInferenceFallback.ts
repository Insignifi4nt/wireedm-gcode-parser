import type { CadDocument } from '@/domain/cad/cadDocument';
import { checkCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';

export type CadSketchInferenceDropReason = CadSketchPreparationError['feedback']['reason'];

const thenable = <T>(value: T | PromiseLike<T>): value is PromiseLike<T> =>
  typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
// A synchronous submission stays synchronous, so the caller's acceptance timing is unchanged.
function settle<T>(run: () => T | PromiseLike<T>, recover: (error: unknown) => T | PromiseLike<T>): T | Promise<T> {
  let result: T | PromiseLike<T>;
  try { result = run(); } catch (error) { return recover(error) as T | Promise<T>; }
  return thenable(result) ? Promise.resolve(result).then(undefined, recover) : result;
}
function then<T, U>(value: T | PromiseLike<T>, next: (value: T) => U): U | Promise<U> {
  return thenable(value) ? Promise.resolve(value).then(next) : next(value);
}

/** Relations a preparation failure names. */
function blamedIds(error: CadSketchPreparationError): ReadonlySet<string> {
  const { conflictingIds, redundantIds, partiallyRedundantIds, issues } = error.diagnostics;
  return new Set([...conflictingIds, ...redundantIds, ...partiallyRedundantIds, ...issues.flatMap(issue => issue.source.kind === 'relation' ? [issue.source.id] : [])]);
}

/**
 * Append a drawing whose inferred horizontal and vertical relations are optional. The full graph goes first, so a
 * drawing the sketch accepts costs one preparation. When preparation rejects it, the blamed inferences are dropped
 * and the drawing is tried once more, then once without any inference, whose failure is the one reported. Attachments
 * are never dropped. An abort, any other error, a failure that blames only other relations, or a changed base
 * (`current` false) stops at once. Every attempt keeps the same identities, and at most one is accepted.
 */
export function appendCadSketchGraphWithInferences<T>({ graph, inferredIds, submit, signal, current, onDropped }: {
  readonly graph: CadSketchGraph;
  readonly inferredIds: readonly string[];
  readonly submit: (graph: CadSketchGraph) => T | PromiseLike<T>;
  readonly signal?: AbortSignal;
  readonly current: () => boolean;
  readonly onDropped: (dropped: readonly CadSketchGraphRelation[], reason: CadSketchInferenceDropReason) => void;
}): T | Promise<T> {
  const inferred = new Set(inferredIds.filter(id => graph.relations.some(relation => relation.id === id)));
  const retryable = (error: unknown): error is CadSketchPreparationError => error instanceof CadSketchPreparationError && !signal?.aborted && current();
  const commitWithout = (ids: ReadonlySet<string>, reason: CadSketchInferenceDropReason) =>
    then(submit(Object.freeze({ ...graph, relations: Object.freeze(graph.relations.filter(relation => !ids.has(relation.id))) })), result => {
      onDropped(graph.relations.filter(relation => ids.has(relation.id)), reason); return result;
    });
  return settle(() => submit(graph), error => {
    if (!inferred.size || !retryable(error)) throw error;
    const blamed = blamedIds(error), named = new Set([...inferred].filter(id => blamed.has(id)));
    // Without those inferences the same relations would still fail.
    if (blamed.size && !named.size) throw error;
    const reason = error.feedback.reason;
    if (!named.size || named.size === inferred.size) return commitWithout(inferred, reason);
    return settle(() => commitWithout(named, reason), retry => {
      if (!retryable(retry)) throw retry;
      return commitWithout(inferred, reason);
    });
  });
}

/** A neutral note naming the inferred relations a drawing was accepted without. */
export function cadSketchInferenceNote(dropped: readonly CadSketchGraphRelation[], reason: CadSketchInferenceDropReason): string {
  const names = [...new Set(dropped.map(relation => relation.kind))].join(' and '), plural = dropped.length > 1;
  const why = reason === 'redundant' ? plural ? 'they repeat existing relations' : 'it repeats existing relations'
    : reason === 'conflicting' ? plural ? 'they conflict with existing relations' : 'it conflicts with existing relations'
    : plural ? 'the sketch could not keep them' : 'the sketch could not keep it';
  return `${names[0].toUpperCase()}${names.slice(1)}${plural ? ' relations' : ''} not added: ${why}.`;
}

/**
 * Submit relations of which `optionalIds` may already follow from the sketch through relations the caller does not trace,
 * such as a line held level by a chain of parallels. The full set goes first, so a constraint the sketch accepts costs one
 * preparation. When preparation rejects it as redundant and names some optional relations, those are dropped and the rest
 * is submitted once more. At least one relation always remains, so a constraint already fully in place still reports the
 * repeat. A relation the solver finds dependent at one solution is not implied by the rest, which can settle at another
 * (a point on a circle through the origin, held only at Y = 0, stays where it is), so `holds` first checks the reduced
 * result against the dropped relations and the first failure stands when it misses one. An abort, any other failure or a
 * changed base (`current` false) stops at once.
 */
export function submitCadSketchRelationsWithoutRepeats<T>({ relations, optionalIds, submit, holds, signal, current }: {
  readonly relations: readonly CadSketchGraphRelation[];
  readonly optionalIds: readonly string[];
  readonly submit: (relations: readonly CadSketchGraphRelation[]) => T | PromiseLike<T>;
  /** Whether the dropped relations hold once the kept ones are solved, decided without applying anything. */
  readonly holds: (kept: readonly CadSketchGraphRelation[], dropped: readonly CadSketchGraphRelation[]) => boolean | PromiseLike<boolean>;
  readonly signal?: AbortSignal;
  readonly current: () => boolean;
}): T | Promise<T> {
  const optional = new Set(optionalIds);
  return settle(() => submit(relations), error => {
    if (!optional.size || !(error instanceof CadSketchPreparationError) || error.feedback.reason !== 'redundant' || signal?.aborted || !current()) throw error;
    const repeated = new Set(error.diagnostics.redundantIds.filter(id => optional.has(id)));
    const kept = relations.filter(relation => !repeated.has(relation.id)), dropped = relations.filter(relation => repeated.has(relation.id));
    if (!repeated.size || !kept.length) throw error;
    return then(settle(() => holds(kept, dropped), () => false), held => {
      if (!held || signal?.aborted || !current()) throw error;
      return submit(kept);
    }) as T | Promise<T>;
  });
}

/** Whether `relations` hold in the sketch `sketchId` of a prepared document, within the tolerance saved geometry is checked to. */
export function cadSketchRelationsHold(document: CadDocument, sketchId: string, relations: readonly CadSketchGraphRelation[]): boolean {
  const sketch = document.features.find(feature => feature.id === sketchId);
  if (sketch?.kind !== 'sketch' || !sketch.graph) return false;
  const ids = new Set(relations.map(relation => relation.id));
  try {
    return !checkCadSketchGraph({ ...sketch.graph, relations: [...sketch.graph.relations, ...relations] }, document.parameters)
      .some(issue => issue.source.kind === 'relation' && ids.has(issue.source.id));
  } catch { return false; }
}
