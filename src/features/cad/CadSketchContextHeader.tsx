import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ConstraintIcon, MeasureIcon, WarningIcon } from '@wire-edm/icons-react';
import type { CadSketchHighlight, CadSketchHighlightStore } from './cadSketchDimensionSelection';
import type { CadSketchIssue, CadSketchIssues } from './cadSketchIssues';
import './cad-sketch-context-header.css';

export interface CadSketchContextHeaderProps {
  readonly name: string;
  /** The definition status, which runs the sketch analysis and reports it. */
  readonly status: ReactNode;
  readonly issues: CadSketchIssues;
  /** The key of the issue whose geometry the canvas shows, if any. */
  readonly inspectedIssue: string | null;
  /** Whether the issues can be opened on the canvas now; a pending edit of another sketch keeps them closed. */
  readonly issuesLocked: boolean;
  onInspectIssue(issue: CadSketchIssue | null): void;
  readonly highlight?: CadSketchHighlightStore;
  /** What hovering or focusing an issue lights up: its geometry, and the origin or axes its relation holds. */
  highlightOf(issue: CadSketchIssue): CadSketchHighlight & { readonly relationIds?: readonly string[] };
  readonly dimensionsShown: boolean;
  readonly relationsShown: boolean;
  onShowDimensions(shown: boolean): void;
  onShowRelations(shown: boolean): void;
  /** View modes added later sit here, between the view toggles and Finish. */
  readonly viewModes?: ReactNode;
  /** Finish, and Cancel while the sketch edit can be discarded. */
  readonly actions: ReactNode;
}

/**
 * The thin bar over a sketch being edited: its name, its definition status, its constraint issues, the view toggles and Finish. The issues
 * open as a list under the bar; hovering a row lights its geometry and choosing it keeps that geometry shown on the canvas.
 */
export function CadSketchContextHeader({ name, status, issues, inspectedIssue, issuesLocked, onInspectIssue, highlight, highlightOf, dimensionsShown, relationsShown,
  onShowDimensions, onShowRelations, viewModes, actions }: CadSketchContextHeaderProps) {
  const [open, setOpen] = useState(false), listId = useId(), owner = useId();
  const trigger = useRef<HTMLButtonElement>(null), shown = useRef<string | null>(null);
  const count = issues.list.length + issues.omitted;
  useLayoutEffect(() => { if (!count) setOpen(false); }, [count]);
  const hide = () => { if (shown.current) highlight?.hide(owner); shown.current = null; };
  const show = (issue: CadSketchIssue) => { shown.current = issue.key; highlight?.show(owner, { kind: 'geometry', ...highlightOf(issue) }); };
  // A row the list drops, because the issue is gone, gets no pointer leave; its highlight goes with it.
  useLayoutEffect(() => { if (shown.current && !issues.list.some(issue => issue.key === shown.current)) hide(); });
  useEffect(() => () => highlight?.hide(owner), [highlight, owner]);
  const close = () => { setOpen(false); hide(); trigger.current?.focus(); };
  const label = count ? `${count} constraint ${count === 1 ? 'issue' : 'issues'}` : 'No constraint issues';
  return <div className="cad-sketch-header" role="group" aria-label="Sketch editing" data-cad-sketch-header="">
    <span className="cad-sketch-header-name">{name}</span>
    {status}
    <div className="cad-sketch-header-issues">
      <Button ref={trigger} type="button" className={count ? 'has-issues' : undefined} aria-label={label} aria-expanded={open} aria-controls={open ? listId : undefined}
        title={issues.message ?? (count ? 'Show the constraint issues' : 'The sketch reports no constraint issues')} disabled={!count} data-cad-sketch-issues={count}
        onClick={() => setOpen(value => !value)}><WarningIcon size={13} /><span>{count}</span></Button>
      {open && count > 0 && <div id={listId} className="cad-sketch-header-issue-list" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); } }}>
        {issues.message && <p className="cad-sketch-header-issue-message">{issues.message}</p>}
        <ul aria-label="Constraint issues">{issues.list.map(issue => <li key={issue.key}>
          <Button type="button" data-cad-diagnostic-source={issue.source.id} data-cad-issue-category={issue.category} aria-pressed={inspectedIssue === issue.key} disabled={issuesLocked}
            title={issuesLocked ? 'Finish or cancel this edit before opening the affected sketch.' : issue.detail}
            onPointerEnter={() => show(issue)} onPointerLeave={hide} onFocus={() => show(issue)} onBlur={hide}
            onClick={() => onInspectIssue(inspectedIssue === issue.key ? null : issue)}><span>{issue.label}</span><small>{issue.state}</small></Button>
        </li>)}{issues.omitted > 0 && <li className="cad-sketch-header-issue-more">{issues.omitted} more affected items</li>}</ul>
      </div>}
    </div>
    <span className="cad-sketch-header-divider" aria-hidden="true" />
    <Button type="button" size="icon" aria-label="Show dimensions" aria-pressed={dimensionsShown} title="Draw the sketch dimensions on the geometry" onClick={() => onShowDimensions(!dimensionsShown)}><MeasureIcon size={13} /></Button>
    <Button type="button" size="icon" aria-label="Show relations" aria-pressed={relationsShown} title="Mark each relation on the geometry it holds" onClick={() => onShowRelations(!relationsShown)}><ConstraintIcon size={13} /></Button>
    <span className="cad-sketch-header-view-modes" data-cad-sketch-view-modes="">{viewModes}</span>
    <span className="cad-sketch-header-divider" aria-hidden="true" />
    {actions}
  </div>;
}
