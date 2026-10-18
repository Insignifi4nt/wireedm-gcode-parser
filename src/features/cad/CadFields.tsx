import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { CadDocument, CadScalar } from '@/domain/cad/cadDocument';
import { createContext, useContext, useLayoutEffect, useState } from 'react';
import { SelectIcon } from '@wire-edm/icons-react';
import { CadFeatureReferencePickingContext } from './cadFeatureReferencePicking';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadScalarValueIntent, inspectCadScalarValue, parseCadNumericQuantity as numericValue } from '@/domain/cad/cadScalarValueIntent';
import { CadContextHelp } from './CadContextHelp';
import { cadScalarHelp } from './cadFieldHelp';
import { CadExpressionBinding } from './CadExpressionBinding';
import { formatCadQuantity } from './cadDisplayQuantity';

export interface CadScalarValueDraft { readonly source: CadScalar; readonly text: string }
export interface CadScalarEditContextValue {
  readonly parameters: CadDocument['parameters'];
  readonly acceptedScalars: Readonly<Record<string, CadScalar>>;
  readonly relationEdits: Readonly<Record<string, boolean>>;
  readonly valueDrafts: Readonly<Record<string, CadScalarValueDraft>>;
  setValueDraft(key: string, draft: CadScalarValueDraft | null): void;
  setIssue(key: string, issue: string | null): void;
  setRelationPending(key: string, pending: boolean): void;
  markRelationEdited(key: string): void;
  changeParameter(name: string, value: number): void;
}
export const CadScalarEditContext = createContext<CadScalarEditContextValue | null>(null);
type ScalarFieldProps = { label: string; inputLabel?: string; fieldKey?: string; value: CadScalar; parameters: CadDocument['parameters']; onChange(value: CadScalar): void; unit?: string };

function ScalarValueField({ label, inputLabel = label, fieldKey: key, value, onChange, unit = 'mm', context }: ScalarFieldProps & { fieldKey: string; context: CadScalarEditContextValue }) {
  const [focused, setFocused] = useState(false);
  const binding = inspectCadScalarValue(value, context.parameters);
  const resolved = binding.kind === 'invalid' ? undefined : binding.quantity;
  let issue = binding.kind === 'invalid' ? binding.reason : '';
  const alias = binding.kind === 'parameter' ? binding.name : null;
  const literal = binding.kind === 'literal';
  const locked = binding.kind === 'formula' || binding.kind === 'invalid';
  const raw = context.valueDrafts[key], draft = raw?.source === value ? raw.text : undefined;
  let draftText: string | undefined;
  if (draft !== undefined && !locked) {
    try { if (numericValue(draft) === resolved) draftText = draft; }
    catch (error) { draftText = draft; issue = error instanceof Error ? error.message : 'Invalid numeric value.'; }
  }
  const exactText = draftText ?? (resolved === undefined ? '—' : String(resolved));
  const text = draftText !== undefined || focused || resolved === undefined ? exactText : formatCadQuantity(resolved);
  useLayoutEffect(() => { context.setIssue(key, issue || null); }, [key, issue, context.setIssue]);
  useLayoutEffect(() => () => { context.setIssue(key, null); }, [key, context.setIssue]);
  const changeRelation = (next: CadScalar) => { context.setValueDraft(key, null); context.markRelationEdited(key); onChange(next); };
  return <label className={`cad-field${issue ? ' is-invalid' : ''}`}><span>{label}<small>{unit}</small>
    <CadContextHelp label={label}><div>{cadScalarHelp(label)}</div><dl><dt>Current value</dt><dd>{resolved === undefined ? issue : `${resolved} ${unit}`}</dd>{!literal && <><dt>Linked expression</dt><dd><code>{value}</code></dd></>}</dl>
      <div>{alias ? `Edits update ${alias} and every linked input together when you Apply.` : locked ? 'This value follows a formula. Edit the relation with fx.' : 'Enter a number. Add or change a relation with fx.'}</div></CadContextHelp>
    <CadContextHelp label={`${label} relation`} buttonLabel={`Edit ${label} relation`} activation="click" triggerContent="fx" className="cad-scalar-relation">
      <CadExpressionBinding label={label} expression={value} parameters={context.parameters} resolved={resolved} onChange={changeRelation}
        description="A document parameter keeps this value linked. Relation and parameter edits stay in this draft until you Apply."
        onPendingChange={pending => context.setRelationPending(key, pending)} /></CadContextHelp></span>
    <Input data-cad-field-key={key} value={text} inputMode="decimal" spellCheck={false} readOnly={locked} aria-label={`${inputLabel}${unit ? ` ${unit}` : ''}`} aria-invalid={Boolean(issue) || undefined}
      onFocus={event => {
        const control = event.currentTarget;
        if (control.value !== exactText) {
          // Expanding a readout changes native selection; select the complete exact value.
          control.value = exactText; control.setSelectionRange(0, exactText.length);
        }
        setFocused(true);
      }} onBlur={() => setFocused(false)}
      title={`${inputLabel}: ${issue || (locked ? `${value} = ${resolved} ${unit}. Edit this relation with fx.` : alias ? `${value} = ${resolved} ${unit}. Edits update the shared parameter.` : `${resolved} ${unit}`)}`}
      onChange={event => {
        if (locked) return;
        const next = event.target.value; context.setValueDraft(key, { source: value, text: next });
        try {
          const number = numericValue(next); context.setIssue(key, null);
          const intent = cadScalarValueIntent({ source: value, parameters: context.parameters, quantity: number,
            acceptedSource: context.acceptedScalars[key], relationEdited: context.relationEdits[key] });
          if (intent.kind === 'parameter') context.changeParameter(intent.name, intent.value);
          else if (intent.kind === 'scalar') { context.setValueDraft(key, { source: intent.source, text: next }); onChange(intent.source); }
          else if (intent.kind === 'locked') context.setIssue(key, intent.reason);
        } catch (error) { context.setIssue(key, error instanceof Error ? error.message : 'Invalid numeric value.'); }
      }} />{issue && <small className="cad-field-hint">{issue}</small>}</label>;
}

export function CadReferencePickButton({ label, options, onSelect, disabled = false }: { label: string; options: readonly { value: string; disabled?: boolean }[]; onSelect(value: string): void; disabled?: boolean }) {
  const picking = useContext(CadFeatureReferencePickingContext);
  const eligible = picking ? options.filter(option => !option.disabled && picking.precedingIds.has(option.value)) : [];
  return picking && eligible.length > 0 ? <Button type="button" disabled={disabled} className="cad-pick-reference" title={`Pick ${label.toLowerCase()} from model or history`} aria-label={`Pick ${label.toLowerCase()} from model`} onClick={() => picking.begin(label, eligible.map(option => option.value), id => { if (eligible.some(option => option.value === id)) onSelect(id); })}><SelectIcon size={13} /></Button> : null;
}

export function SelectField<T extends string>({ label, value, options, onChange, description, reference = false }: { label: string; description?: string; value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange(value: T): void; reference?: boolean }) {
  return <div className="cad-reference-field"><label className="cad-field"><span>{label}{description && <CadContextHelp label={label}>{description}</CadContextHelp>}</span><Select value={value} title={description} aria-label={label} aria-description={description} onChange={(event) => { const option = options.find((entry) => entry.value === event.target.value); if (option && !option.disabled) onChange(option.value); }}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</Select></label>{reference && <CadReferencePickButton label={label} options={options} onSelect={id => { const option = options.find(option => option.value === id); if (option && !option.disabled) onChange(option.value); }} />}</div>;
}

export function ScalarField(props: ScalarFieldProps) {
  const context = useContext(CadScalarEditContext);
  return context && props.fieldKey ? <ScalarValueField key={props.fieldKey} {...props} fieldKey={props.fieldKey} context={context} /> : <ScalarExpressionField {...props} />;
}

function ScalarExpressionField({ label, inputLabel = label, value, parameters, onChange, unit = 'mm' }: ScalarFieldProps) {
  let resolved: string;
  let invalid = false;
  try { resolved = `${formatCadQuantity(evaluateCadScalar(value, parameters))} ${unit}`; }
  catch (error) { invalid = true; resolved = error instanceof Error ? error.message : 'Invalid expression'; }
  const showResult = invalid || typeof value === 'string' && !Number.isFinite(Number(value));
  return <label className={`cad-field ${invalid ? 'is-invalid' : ''}`}><span>{label}<small>{unit}</small><CadContextHelp label={label}><div>{cadScalarHelp(label)}</div><dl><dt>Current value</dt><dd>{resolved}</dd>{showResult && !invalid && <><dt>Expression</dt><dd><code>{value}</code></dd></>}</dl><div>Enter a number or a named parameter expression.</div></CadContextHelp></span><Input value={value} spellCheck={false} title={resolved} aria-label={`${inputLabel}${unit ? ` ${unit}` : ''}`} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} />{showResult && <small className="cad-field-hint">{resolved}</small>}</label>;
}

