import type { CadSketchGraph, CadSketchGraphIssue } from '@/domain/cad/cadSketchGraph';
import type { CadSketchEditWarning } from './cadEditPreparation';
import { cadSketchDiagnosticSubjects, describeCadSketchConstraintSource, type CadSketchConstraintFeedback, type CadSketchConstraintFeedbackSubject } from './cadSketchConstraintFeedback';
import type { CadSketchSolveDiagnostics, CadSketchSolveResult } from './sketch-solver/cadSketchSolverTypes';

/**
 * What is wrong with the sketch being edited, gathered in one place for its header and its feature tree rows.
 *
 * This is a stand-in for D1, which will own sketch diagnostics. Until it lands, this adapter is the only place that turns the accepted
 * analysis, a rejected edit's feedback and the shrink warnings of the last accepted edit into issues. The header and the tree read
 * nothing else, so D1 replaces this module without touching them.
 */
export type CadSketchIssueCategory = 'conflicting' | 'redundant' | 'partially-redundant' | 'not-met' | 'geometry' | 'shrink';
export interface CadSketchIssue {
  /** Stable within one list, so a row keeps its key while the list is shown. */
  readonly key: string;
  readonly category: CadSketchIssueCategory;
  /** What the issue is about, as the relation, edge or point is named in this graph. */
  readonly label: string;
  /** The issue's state in a few words, as a row badge shows it. */
  readonly state: string;
  /** A sentence that explains it. */
  readonly detail: string;
  /** The source inspecting the issue highlights; a warning names its relation. */
  readonly source: CadSketchGraphIssue['source'];
  /** The relation this issue belongs to, so its tree row shows it. */
  readonly relationId: string | null;
  readonly pointIds: readonly string[];
  readonly entityIds: readonly string[];
  /** The analysis of the accepted sketch, the edit that was just refused, or the last accepted edit's warnings. */
  readonly origin: 'analysis' | 'edit' | 'warning';
  /** The subject a constraint diagnostic came from, for the canvas inspection. */
  readonly subject: CadSketchConstraintFeedbackSubject | null;
}
export interface CadSketchIssues {
  readonly sketchId: string;
  /** The refused edit's message, or the accepted analysis's, when either has one. */
  readonly message: string | null;
  readonly list: readonly CadSketchIssue[];
  /** Items a refused edit named beyond the subjects it kept. */
  readonly omitted: number;
  readonly byRelation: ReadonlyMap<string, readonly CadSketchIssue[]>;
}
/** The accepted analysis of the sketch, kept only while it names something. */
export interface CadSketchAnalysisIssues {
  readonly kind: CadSketchSolveResult['kind'] | 'unavailable' | 'legacy';
  readonly reason: Extract<CadSketchSolveResult, { kind: 'rejected' }>['reason'] | null;
  readonly diagnostics: Pick<CadSketchSolveDiagnostics, 'conflictingIds' | 'redundantIds' | 'partiallyRedundantIds' | 'issues'>;
}

const STATES: Record<CadSketchIssueCategory, string> = {
  conflicting: 'Conflict', redundant: 'Redundant', 'partially-redundant': 'Partly redundant', 'not-met': 'Not met', geometry: 'Geometry issue', shrink: 'Shrinks'
};
const DETAILS: Record<Exclude<CadSketchIssueCategory, 'not-met' | 'geometry' | 'shrink'>, string> = {
  conflicting: 'This conflicts with other relations.', redundant: 'Other relations already hold this.', 'partially-redundant': 'Other relations already hold part of this.'
};
const ANALYSIS_MESSAGES: Record<NonNullable<CadSketchAnalysisIssues['reason']>, string> = {
  conflicting: 'Sketch constraints conflict.', redundant: 'Sketch constraints are redundant.', failed: 'The sketch solver could not solve this sketch.',
  'invalid-input': 'Sketch input is invalid.', 'too-large': 'A connected group of sketch relations is too large to solve.', 'invalid-solution': 'The sketch does not satisfy its geometry and relations.'
};
export const NO_CAD_SKETCH_ISSUES_BY_RELATION: ReadonlyMap<string, readonly CadSketchIssue[]> = new Map();

/** The accepted analysis worth keeping: its named identities and issues, or null when it names nothing. Reuses `previous` when equal. */
export function cadSketchAnalysisIssues(analysis: CadSketchSolveResult | { readonly kind: CadSketchAnalysisIssues['kind']; readonly reason?: CadSketchAnalysisIssues['reason']; readonly diagnostics: CadSketchSolveDiagnostics },
  previous?: CadSketchAnalysisIssues | null): CadSketchAnalysisIssues | null {
  const { conflictingIds, redundantIds, partiallyRedundantIds, issues } = analysis.diagnostics;
  const reason = analysis.kind === 'rejected' && 'reason' in analysis ? analysis.reason ?? null : null;
  if (!conflictingIds.length && !redundantIds.length && !partiallyRedundantIds.length && !issues.length && !reason) return null;
  const next: CadSketchAnalysisIssues = Object.freeze({ kind: analysis.kind, reason, diagnostics: Object.freeze({ conflictingIds, redundantIds, partiallyRedundantIds, issues }) });
  return previous && JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

function fromSubject(subject: CadSketchConstraintFeedbackSubject, origin: 'analysis' | 'edit', index: number): CadSketchIssue {
  const category: CadSketchIssueCategory = subject.category === 'issue' ? subject.code === 'relation-residual' ? 'not-met' : 'geometry' : subject.category;
  const detail = subject.category === 'issue' ? subject.detail : DETAILS[subject.category];
  return Object.freeze({ key: `${origin}/${category}/${subject.source.kind}/${subject.source.id}/${index}`, category, label: subject.label, state: STATES[category], detail,
    source: subject.source, relationId: subject.source.kind === 'relation' ? subject.source.id : null, pointIds: subject.pointIds, entityIds: subject.entityIds, origin, subject });
}

/**
 * The issues of sketch `sketchId` with graph `graph`: a refused edit's subjects when `feedback` belongs to it, otherwise the accepted
 * analysis's; then the shrink warnings of the last accepted edit on this sketch. A source the graph no longer has is left out.
 */
export function cadSketchIssuesStandInForD1({ sketchId, graph, analysis, feedback, warnings }: {
  readonly sketchId: string; readonly graph: CadSketchGraph; readonly analysis?: CadSketchAnalysisIssues | null;
  readonly feedback?: CadSketchConstraintFeedback | null; readonly warnings?: readonly CadSketchEditWarning[] | null;
}): CadSketchIssues {
  const refused = feedback?.sketchId === sketchId ? feedback : null;
  const subjects = refused ? refused.subjects : analysis ? cadSketchDiagnosticSubjects(graph, { ...analysis.diagnostics, status: null, degreesOfFreedom: null }) : [];
  const list: CadSketchIssue[] = subjects.map((subject, index) => fromSubject(subject, refused ? 'edit' : 'analysis', index));
  for (const [index, warning] of (warnings ?? []).entries()) {
    if (warning.sketchId !== sketchId || !graph.relations.some(relation => relation.id === warning.relationId)) continue;
    const subject = describeCadSketchConstraintSource(graph, { kind: 'relation', id: warning.relationId });
    const shrunk = warning.curves.map(curve => curve.entityId).filter(id => graph.entities.some(entity => entity.id === id));
    list.push(Object.freeze({ key: `warning/shrink/${warning.relationId}/${index}`, category: 'shrink', label: subject.label, state: STATES.shrink, detail: warning.message,
      source: subject.source, relationId: warning.relationId, pointIds: subject.pointIds, entityIds: [...new Set([...subject.entityIds, ...shrunk])], origin: 'warning', subject: null }));
  }
  const byRelation = new Map<string, CadSketchIssue[]>();
  for (const issue of list) if (issue.relationId) byRelation.set(issue.relationId, [...byRelation.get(issue.relationId) ?? [], issue]);
  const message = refused ? refused.message : analysis?.reason ? ANALYSIS_MESSAGES[analysis.reason] : null;
  return Object.freeze({ sketchId, message, list: Object.freeze(list), omitted: refused?.omittedSubjectCount ?? 0, byRelation: list.length ? byRelation : NO_CAD_SKETCH_ISSUES_BY_RELATION });
}
