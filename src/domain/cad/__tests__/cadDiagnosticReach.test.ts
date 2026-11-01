import { describe, expect, it } from 'vitest';
import { CadSourceIndex, cadDiagnosticReach, type CadDiagnosticReachOptions } from './cadDiagnosticReach';

const FILE = 'src/check.ts';
/** What the walk finds from `check`, the export of one source file. */
const walk = (source: string, options?: CadDiagnosticReachOptions) => {
  const index = new CadSourceIndex({ [FILE]: source });
  return cadDiagnosticReach(index, index.exported(FILE, 'check', new Set()), options);
};
/** The codes and unread sites it finds. */
const reach = (source: string, options?: CadDiagnosticReachOptions) => {
  const found = walk(source, options);
  return { codes: [...found.codes].sort(), unexpanded: found.unexpanded };
};

describe('CAD diagnostic reach', () => {
  it('reads a code held by a constant, or by a constant object', () => {
    expect(reach(`export function check() { const code = 'new-code'; throw new CadError(code, 'failure'); }`))
      .toEqual({ codes: ['new-code'], unexpanded: [] });
    expect(reach(`const CODE = 'shared-code';
      export function check(kind: string) { const issue = { code: \`new-\${kind}\`, message: 'failure' }; if (kind) throw new CadError(issue.code, issue.message); throw new CadError(CODE, ''); }`,
    { templates: { [`${FILE}: kind`]: ['cut', 'pocket'] } })).toEqual({ codes: ['new-cut', 'new-pocket', 'shared-code'], unexpanded: [] });
  });

  it('reports a template code nothing expands, and a code whose origin it cannot read', () => {
    expect(reach(`export function check(kind: string) { const issue = { code: \`new-\${kind}\`, message: 'failure' }; throw new CadError(issue.code, issue.message); }`))
      .toEqual({ codes: [], unexpanded: [`${FILE}: kind`] });
    expect(reach(`export function check(kind: string) {
      let code = 'first'; code = kind;
      if (kind === 'a') throw new CadError(code, '');
      if (kind === 'b') throw new CadError(codeFor(kind), '');
      const refusal = { code: 'hidden', ...extra(kind) };
      throw new CadError(refusal.code, '');
    }`).unexpanded).toEqual([`${FILE}: code`, `${FILE}: codeFor(kind)`, `${FILE}: refusal.code, from ${FILE}: { code: 'hidden', ...extra(kind) }.code`]);
  });

  it('reads a parameter at each call the walk reaches, and reports a function passed on', () => {
    const source = `const refuse = (refusal: { code: string }) => new CadError(refusal.code, '');
      const TABLE = { pair: { code: 'pair-refusal' }, slots: [{ refusal: { code: 'slot-refusal' } }, { role: 'end' }] } as const;
      export function check(kind: string) {
        if (kind === 'a') throw refuse({ code: 'literal-refusal' });
        if (kind === 'b') throw refuse(TABLE.pair);
        for (const slot of TABLE.slots) if (slot.refusal) throw refuse(slot.refusal);
        TABLE.slots.forEach(slot => { if (slot.refusal) throw refuse(slot.refusal); });
      }
      export function unused() { throw refuse({ code: 'unreached-refusal' }); }`;
    expect(reach(source)).toEqual({ codes: ['literal-refusal', 'pair-refusal', 'slot-refusal'], unexpanded: [] });
    expect(reach(`${source}\nexport const later = () => [1].map(refuse);`).unexpanded).toEqual([]);
    expect(reach(source.replace('TABLE.slots.forEach(', 'later(refuse); TABLE.slots.forEach(')).unexpanded).toEqual([`${FILE}: refuse passed on`]);
  });

  it('takes a caught error\'s code and an inspection\'s from where they are written, and lists both', () => {
    const found = walk(`function inspect(kind: string) { return kind ? { eligible: false, code: 'inspected-refusal' } : { eligible: true }; }
      function parse() { throw new CadError('parse-refusal', ''); }
      export function check(kind: string) {
        try { parse(); } catch (error) { if (error instanceof CadError) return { code: error.code }; }
        const inspection = inspect(kind);
        if (!inspection.eligible) throw new CadError(inspection.code, '');
      }`);
    expect({ codes: [...found.codes].sort(), unexpanded: found.unexpanded }).toEqual({ codes: ['inspected-refusal', 'parse-refusal'], unexpanded: [] });
    expect(found.taken).toEqual([`${FILE}: error.code`, `${FILE}: inspection.code, from ${FILE}: inspect(…).code`]);
  });
});
