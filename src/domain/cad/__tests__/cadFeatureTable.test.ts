import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CadFeatureScalar, CadFeatureSlot } from '../features/cadFeatureDefinitionTypes';
import { cadFeatureDefinition, cadFeatureKinds } from '../features/cadFeatureRegistry';

const page = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../docs/maintainers/cad-features.md');
const start = '<!-- cad-feature-table:start -->', end = '<!-- cad-feature-table:end -->';

const plural = { plane: 'planes', sketch: 'sketches', curve: 'curves', body: 'bodies' } as const;
const slot = (name: string, { role, accepts, count, ordered }: CadFeatureSlot) =>
  `\`${name}\` ${role} ${count === 'many' ? `${plural[accepts[0]]}${ordered ? ', ordered' : ''}` : accepts[0]}${count === 'optional' ? ', optional' : ''}`;
const range = ({ min, max, exclusiveMin }: CadFeatureScalar) =>
  [min === undefined ? '' : ` ${exclusiveMin ? '>' : '≥'} ${min}`, max === undefined ? '' : ` ≤ ${max}`].filter(Boolean).join(',');
const scalar = (name: string, value: CadFeatureScalar) =>
  `\`${name}\` ${value.quantity}${value.components ? ' ×3' : ''}${range(value)}${value.literal ? ', literal' : ''}`;
const cell = (items: readonly string[]) => items.length ? items.join('; ') : '–';

/** The kinds table, generated from the definitions. */
function cadFeatureTable(): string {
  const rows = cadFeatureKinds().map(kind => {
    const { family, fields, outputs, body, suppression, evaluator, form, agent } = cadFeatureDefinition(kind);
    const entries = Object.entries(fields);
    const slots = entries.flatMap(([name, field]) => field.slot ? [slot(name, field.slot)] : []);
    const scalars = entries.flatMap(([name, field]) => field.scalar ? [scalar(name, field.scalar)] : []);
    return `| \`${kind}\` | ${family} | ${cell(slots)} | ${cell(scalars)} | ${cell(outputs)} | ${body} | ${suppression} | ${evaluator.owner} ${evaluator.version} | ${form.editor} | ${agent.exposed ? 'yes' : 'no'} |`;
  });
  return ['| Kind | Family | Inputs | Dimensions | Gives | Bodies | When inactive | Evaluator | Form | Agents |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

describe('CAD feature maintainer page', () => {
  it('lists every kind as its definition declares it', () => {
    const text = readFileSync(page, 'utf8').replace(/\r\n/g, '\n');
    const from = text.indexOf(start), to = text.indexOf(end);
    expect(from, 'table start marker').toBeGreaterThan(-1);
    expect(to, 'table end marker').toBeGreaterThan(from);
    const expected = `${start}\n${cadFeatureTable()}\n${end}`;
    if (process.env.UPDATE_CAD_FEATURE_TABLE) writeFileSync(page, text.slice(0, from) + expected + text.slice(to + end.length));
    else expect(text.slice(from, to + end.length)).toBe(expected);
  });
});
