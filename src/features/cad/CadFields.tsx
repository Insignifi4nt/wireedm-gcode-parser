import type { CadDocument, CadScalar } from '@/domain/cad/cadDocument';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange(value: T): void }) {
  return <label className="cad-field"><span>{label}</span><select value={value} onChange={(event) => { const option = options.find((entry) => entry.value === event.target.value); if (option && !option.disabled) onChange(option.value); }}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>;
}

export function ScalarField({ label, value, parameters, onChange, unit = 'mm' }: { label: string; value: CadScalar; parameters: CadDocument['parameters']; onChange(value: CadScalar): void; unit?: string }) {
  let resolved: string;
  let invalid = false;
  try { resolved = `${Number(evaluateCadScalar(value, parameters).toFixed(6))} ${unit}`; }
  catch (error) { invalid = true; resolved = error instanceof Error ? error.message : 'Invalid expression'; }
  const showResult = invalid || typeof value === 'string' && !Number.isFinite(Number(value));
  return <label className={`cad-field ${invalid ? 'is-invalid' : ''}`}><span>{label}<small>{unit}</small></span><input value={value} spellCheck={false} title="Number or parameter expression, e.g. width / 2" aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} />{showResult && <small className="cad-field-hint">{resolved}</small>}</label>;
}

