// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import initializeOcct from 'occt-import-js';
import { parseStepMachineModel } from '../parseStepMachineModel';

const fixture = readFileSync(new URL('./fixtures/tetrahedron-mm.step', import.meta.url));
const loadParser = () => initializeOcct({ print: () => {}, printErr: () => {} });

describe('real STEP machine import', () => {
  it('triangulates a real solid with declared millimetres and preserves placement and names', async () => {
    const stages: string[] = [];
    const result = await parseStepMachineModel(fixture, 'tetrahedron.step', loadParser, ({ stage }) => stages.push(stage));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.model.units).toBe('mm');
    expect(result.model.triangleCount).toBe(4);
    expect(result.model.meshes).toHaveLength(1);
    expect(result.model.meshes[0].positions).toBeInstanceOf(Float64Array);
    expect(result.model.meshes[0].indices).toBeInstanceOf(Uint32Array);
    expect(result.model.bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 30] });
    expect(result.model.meshes[0].name).toContain('tetrahedron');
    expect(result.model.source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(stages).toEqual(['loading-parser', 'triangulating', 'validating']);
  }, 30_000);

  it('converts a metre source to millimetres in OCCT rather than relabelling its coordinates', async () => {
    const metres = new TextEncoder().encode(fixture.toString().replace('SI_UNIT(.MILLI.,.METRE.)', 'SI_UNIT($,.METRE.)'));
    const result = await parseStepMachineModel(metres, 'metres.stp', loadParser);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.model.bounds).toEqual({ min: [0, 0, 0], max: [10_000, 20_000, 30_000] });
  }, 30_000);

  it('rejects malformed STEP without presenting fake geometry', async () => {
    const malformed = new TextEncoder().encode(fixture.toString().replace(/#16=MANIFOLD_SOLID_BREP[^;]+;/, '#16=INVALID_ENTITY();'));
    const result = await parseStepMachineModel(malformed, 'malformed.step', loadParser);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Malformed STEP unexpectedly produced geometry.');
    expect(['MACHINE_IMPORT_PARSE_FAILED', 'MACHINE_IMPORT_NO_GEOMETRY', 'MACHINE_IMPORT_INVALID_GEOMETRY']).toContain(result.error.code);
  }, 30_000);

  it('resolves a conversion-based inch unit through its referenced millimetre measure', async () => {
    const inches = fixture.toString().replace('#11=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));',
      "#11=(CONVERSION_BASED_UNIT('INCH',#61) LENGTH_UNIT() NAMED_UNIT(#62));\n"
      + '#60=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));\n'
      + '#61=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#60);\n'
      + '#62=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);');
    const result = await parseStepMachineModel(new TextEncoder().encode(inches), 'inches.step', loadParser);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.model.bounds.max[0]).toBeCloseTo(254);
    expect(result.model.bounds.max[1]).toBeCloseTo(508);
    expect(result.model.bounds.max[2]).toBeCloseTo(762);
  }, 30_000);
});
