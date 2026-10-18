import { expect, it } from 'vitest';
import { cadScalarValueIntent, inspectCadScalarValue, parseCadNumericQuantity } from '../cadScalarValueIntent';

it.each([1.23456789012345, '1.23456789012345', ' 1e1 '])('preserves the exact independent source %j for unchanged displayed quantities', source => {
  expect(cadScalarValueIntent({ source, parameters: {}, quantity: Number(source) })).toEqual({ kind: 'unchanged', source });
});

it('edits the shared numeric driver without detaching or normalizing its exact alias', () => {
  const parameters = { depth: 10, other: 3 }, before = JSON.stringify(parameters);
  expect(inspectCadScalarValue(' depth ', parameters)).toEqual({ kind: 'parameter', name: 'depth', quantity: 10 });
  expect(cadScalarValueIntent({ source: ' depth ', parameters, quantity: 27 })).toEqual({ kind: 'parameter', name: 'depth', value: 27 });
  expect(JSON.stringify(parameters)).toBe(before);
});

it('keeps a compound formula locked even if it happens to equal a proposed quantity', () => {
  const source = ' depth / 2 ', parameters = { depth: 10 };
  expect(inspectCadScalarValue(source, parameters)).toEqual({ kind: 'formula', quantity: 5 });
  expect(cadScalarValueIntent({ source, parameters, quantity: 20 })).toMatchObject({ kind: 'locked' });
  expect(cadScalarValueIntent({ source, parameters, quantity: 5 })).toMatchObject({ kind: 'locked' });
});

it('restores the exact accepted independent representation only when no relation was deliberately changed', () => {
  expect(cadScalarValueIntent({ source: 20, parameters: {}, quantity: 10, acceptedSource: ' 1e1 ' })).toEqual({ kind: 'scalar', source: ' 1e1 ' });
  expect(cadScalarValueIntent({ source: 20, parameters: {}, quantity: 10, acceptedSource: ' 1e1 ', relationEdited: true })).toEqual({ kind: 'scalar', source: 10 });
  expect(cadScalarValueIntent({ source: 20, parameters: { depth: 10 }, quantity: 10, acceptedSource: 'depth' })).toEqual({ kind: 'scalar', source: 10 });
});

it('keeps numeric string drivers fixed through value edits and restores exact accepted text on revert while explicit unlink stays numeric', () => {
  const acceptedSource = ' 1.23456789012345e1 ';
  expect(cadScalarValueIntent({ source: acceptedSource, parameters: {}, quantity: 20.125, acceptedSource })).toEqual({ kind: 'scalar', source: '20.125' });
  expect(cadScalarValueIntent({ source: '20.125', parameters: {}, quantity: Number(acceptedSource), acceptedSource })).toEqual({ kind: 'scalar', source: acceptedSource });
  expect(cadScalarValueIntent({ source: 20.125, parameters: {}, quantity: 21, acceptedSource, relationEdited: true })).toEqual({ kind: 'scalar', source: 21 });
  expect(cadScalarValueIntent({ source: '20.125', parameters: {}, quantity: 21, acceptedSource: 20.125, relationEdited: true })).toEqual({ kind: 'scalar', source: '21' });
});

it('uses the existing scalar grammar for numeric text, preserving exponent precision and rejecting formulas or JavaScript numeric syntax', () => {
  expect(parseCadNumericQuantity(' 1.23456789012345e1 ')).toBe(12.3456789012345);
  for (const text of ['', '-', 'Infinity', '1e', '0x10', 'depth / 2', '1e10']) expect(() => parseCadNumericQuantity(text)).toThrow();
  for (const quantity of [NaN, Infinity, -Infinity, 1e10]) expect(() => cadScalarValueIntent({ source: 10, parameters: {}, quantity })).toThrow();
});

it('reports an unavailable existing formula without inventing a numeric driver or changing its source', () => {
  expect(inspectCadScalarValue('unknown / 2', {})).toMatchObject({ kind: 'invalid', reason: expect.stringContaining('unknown') });
  expect(cadScalarValueIntent({ source: 'unknown / 2', parameters: {}, quantity: 20 })).toMatchObject({ kind: 'locked' });
});
