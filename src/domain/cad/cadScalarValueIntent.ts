import type { CadScalar } from './cadDocument';
import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';

export type CadScalarValueBinding =
  | { readonly kind: 'literal'; readonly quantity: number }
  | { readonly kind: 'parameter'; readonly name: string; readonly quantity: number }
  | { readonly kind: 'formula'; readonly quantity: number }
  | { readonly kind: 'invalid'; readonly reason: string };
export type CadScalarValueIntent =
  | { readonly kind: 'unchanged'; readonly source: CadScalar }
  | { readonly kind: 'scalar'; readonly source: CadScalar }
  | { readonly kind: 'parameter'; readonly name: string; readonly value: number }
  | { readonly kind: 'locked'; readonly reason: string };

/** Numeric editing uses the same grammar and range as stored CAD scalars. */
export function parseCadNumericQuantity(text: string): number {
  const value = Number(text);
  if (!text.trim() || !Number.isFinite(value)) throw new CadError('invalid-scalar', 'Enter a finite number. Edit formulas with fx.');
  evaluateCadScalar(text, {});
  return value;
}

export function inspectCadScalarValue(source: CadScalar, parameters: Readonly<Record<string, number>>): CadScalarValueBinding {
  try {
    const quantity = evaluateCadScalar(source, parameters);
    if (typeof source === 'number' || source.trim() !== '' && Number.isFinite(Number(source))) return { kind: 'literal', quantity };
    const name = source.trim();
    return Object.hasOwn(parameters, name) ? { kind: 'parameter', name, quantity } : { kind: 'formula', quantity };
  } catch (error) {
    return { kind: 'invalid', reason: error instanceof Error ? error.message : 'Invalid expression.' };
  }
}

/** A numeric quantity never changes a relation implicitly. Callers own drafts. */
export function cadScalarValueIntent(input: {
  source: CadScalar;
  parameters: Readonly<Record<string, number>>;
  quantity: number;
  acceptedSource?: CadScalar;
  relationEdited?: boolean;
}): CadScalarValueIntent {
  evaluateCadScalar(input.quantity, {});
  const binding = inspectCadScalarValue(input.source, input.parameters);
  if (binding.kind === 'invalid') return { kind: 'locked', reason: binding.reason };
  if (binding.kind === 'formula') return { kind: 'locked', reason: 'This value follows a formula. Edit the relation with fx.' };
  if (input.quantity === binding.quantity) return { kind: 'unchanged', source: input.source };
  if (binding.kind === 'parameter') return { kind: 'parameter', name: binding.name, value: input.quantity };
  const accepted = input.acceptedSource === undefined ? null : inspectCadScalarValue(input.acceptedSource, input.parameters);
  const source = input.acceptedSource !== undefined && !input.relationEdited && accepted?.kind === 'literal' && accepted.quantity === input.quantity
    ? input.acceptedSource : input.quantity;
  return { kind: 'scalar', source };
}
