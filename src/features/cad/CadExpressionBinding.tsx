import { userFacingMessage } from '@/lib/userMessage';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import type { CadScalar } from '@/domain/cad/cadDocument';

/** Changes the pending profile relation only; document edits belong to Apply. */
export function CadExpressionBinding({ label, expression, parameters, resolved, onChange, onPendingChange, description }: {
  label: string; expression: CadScalar; parameters: Readonly<Record<string, number>>; resolved?: number; onChange(value: CadScalar): void;
  onPendingChange?(pending: boolean): void;
  description?: string;
}) {
  const [draft, setDraft] = useState(String(expression)), [receipt, setReceipt] = useState('');
  const pendingCallback = useRef(onPendingChange);
  useEffect(() => { pendingCallback.current = onPendingChange; }, [onPendingChange]);
  useEffect(() => { setDraft(String(expression)); }, [expression]);
  useLayoutEffect(() => { pendingCallback.current?.(draft !== String(expression)); }, [draft, expression]);
  useEffect(() => () => pendingCallback.current?.(false), []);
  let result: number | undefined, issue = '';
  try { result = evaluateCadScalar(draft, parameters); } catch (error) { issue = userFacingMessage(error, 'Invalid expression.'); }
  const aliases = Object.keys(parameters);
  return <div className="cad-expression-binding">
    <p>{description ?? 'A number is independent. A document parameter or expression keeps this value linked. The profile and any parameter drafts are saved together when you Apply.'}</p>
    <label><span>Expression</span><Input aria-label={`${label} expression`} value={draft} spellCheck={false} onChange={event => { setDraft(event.target.value); setReceipt(''); }} /></label>
    {aliases.length > 0 && <p className="cad-expression-available">Document parameters: <code>{aliases.slice(0, 16).join(', ')}</code>{aliases.length > 16 && ` and ${aliases.length - 16} more.`}</p>}
    {issue ? <p role="alert">{issue}</p> : <div className="cad-context-help-value"><span>Evaluates to</span><output>{result}</output></div>}
    <div className="cad-expression-actions"><Button type="button" disabled={Boolean(issue)} onClick={() => { const changed = draft !== String(expression); if (changed) onChange(draft); setReceipt(changed ? 'Relation updated in this draft.' : 'Relation unchanged.'); }}>Keep relation</Button>
      <Button type="button" disabled={resolved === undefined || !Number.isFinite(resolved)} onClick={() => { if (resolved !== undefined && Number.isFinite(resolved)) { const changed = expression !== resolved; if (changed) onChange(resolved); setReceipt(changed ? 'Independent value set in this draft.' : 'Independent value unchanged.'); } }}>Use current value</Button></div>
    {receipt && <p role="status">{receipt}</p>}
  </div>;
}
