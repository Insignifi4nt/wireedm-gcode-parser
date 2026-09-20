// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MACHINE_IMPORT_LIMITS } from '../model';
import { validateMachineFile, validateStepBytes } from '../stepInput';

const fixture = readFileSync(new URL('./fixtures/tetrahedron-mm.step', import.meta.url), 'utf8');
const check = (text: string) => validateStepBytes(new TextEncoder().encode(text));

describe('STEP input constraints', () => {
  it('accepts the exchange envelope and referenced unit context of a real STEP solid', () => {
    expect(check(fixture)).toEqual({ ok: true });
    expect(validateMachineFile({ name: 'MACHINE.STP', size: 123 })).toEqual({ ok: true });
  });
  it('requires explicit unit provenance and does not infer BREP units', () => {
    expect(validateMachineFile({ name: 'machine.brep', size: 123 })).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_UNSUPPORTED_FORMAT' } });
    expect(check(fixture.replace('#11,#13,#14', '#13,#14'))).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_UNITS_MISSING' } });
    expect(check(fixture.replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT(.UNKNOWN.,.METRE.)'))).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_UNITS_MISSING' } });
  });
  it('ignores declaration-like content in strings and comments', () => {
    const missing = fixture.replace('GLOBAL_UNIT_ASSIGNED_CONTEXT((#11,#13,#14))', '');
    expect(check(missing.replace("'Test tetrahedron'", "'GLOBAL_UNIT_ASSIGNED_CONTEXT((#11)) /* text */'"))).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_UNITS_MISSING' } });
    expect(check(missing.replace('DATA;', 'DATA; /* GLOBAL_UNIT_ASSIGNED_CONTEXT((#11)) */'))).toMatchObject({ ok: false });
  });
  it('rejects truncated envelopes and excessive input before loading the parser', () => {
    expect(check(fixture.replace('END-ISO-10303-21;', ''))).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_INVALID_STEP' } });
    expect(validateMachineFile({ name: 'large.step', size: MACHINE_IMPORT_LIMITS.fileBytes + 1 })).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_TOO_LARGE' } });
    expect(validateMachineFile({ name: 'empty.step', size: 0 })).toMatchObject({ ok: false, error: { code: 'MACHINE_IMPORT_EMPTY' } });
  });
});
