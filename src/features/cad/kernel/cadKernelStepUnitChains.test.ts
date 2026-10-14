// @vitest-environment node
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { exportSTEP, makeBox, setOC } from 'replicad';
import { beforeAll, expect, it } from 'vitest';
import { prepareCadSolidImport } from './cadKernelImport';
import { assertCadStepLengthUnits } from './cadKernelStepUnits';

let original: string;
beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)), print: () => undefined, printErr: () => undefined }));
  const box = makeBox([0, 0, 0], [20, 10, 5]);
  try { original = await exportSTEP([{ shape: box }], { unit: 'MM', modelUnit: 'MM' }).text(); } finally { box.delete(); }
}, 60_000);

function chain(factors: readonly number[], cycle = false): string {
  const root = /#(\d+)\s*=\s*\(\s*LENGTH_UNIT\s*\(\s*\)\s*NAMED_UNIT\s*\(\s*\*\s*\)\s*SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)\s*\)\s*;/i.exec(original);
  if (!root) throw new Error('Expected exported millimetre unit');
  let next = 1; for (const id of original.matchAll(/#(\d+)/g)) next = Math.max(next, Number(id[1]) + 1);
  const nodes = [Number(root[1]), ...factors.slice(1).map(() => next++)], leaf = next++, dimensions = next++;
  const records = [`#${leaf}=(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.));`, `#${dimensions}=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);`];
  for (let index = 0; index < factors.length; index++) {
    const measure = next++, reference = nodes[index + 1] ?? (cycle ? nodes[0] : leaf);
    records.push(`#${nodes[index]}=(CONVERSION_BASED_UNIT('Unit ${index}',#${measure}) LENGTH_UNIT() NAMED_UNIT(#${dimensions}));`,
      `#${measure}=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(${factors[index]}),#${reference});`);
  }
  return original.replace(root[0], '').replace(/ENDSEC;\s*END-ISO-10303-21;/i, records.join('\n') + '\nENDSEC;\nEND-ISO-10303-21;');
}

it.each([2, 3])('validates seventeen conversion units with outer factor%s and rejects unsupported native transfer instead of importing wrongly scaled material', outer => {
  const factors: number[] = Array.from({ length: 17 }, (_, index) => index === 16 ? 1 : index % 2 ? .5 : 2); factors[0] = outer;
  const data = chain(factors), units = assertCadStepLengthUnits(data);
  const source = { format: 'step' as const, fileName: 'chain.step', encoding: 'utf8' as const, data }, scale = outer / 2;
  expect(units.contextScalesMm).toEqual([scale]); expect(units.nativeTransferSupported).toBe(false);
  // The second declaration requires 3375 mm³; the old native path returned 1000.
  expect(1000 * units.contextScalesMm[0] ** 3).toBe(outer === 2 ? 1000 : 3375);
  expect(() => prepareCadSolidImport(source)).toThrow(expect.objectContaining({ code: 'step-units-unsupported' }));
  expect(source.data).toBe(data);
});

it('keeps direct conversion material accurate and rejects the same native limitation in a shallow nested chain', () => {
  const direct = chain([1.5]), imported = prepareCadSolidImport({ format: 'step', fileName: 'direct.step', encoding: 'utf8', data: direct });
  expect(imported.volume).toBeCloseTo(3375, 6); expect(imported.bounds.max).toEqual([30, 15, 7.5]);
  const nested = chain([3, .5]);
  expect(assertCadStepLengthUnits(nested)).toEqual({ contextScalesMm: [1.5], nativeTransferSupported: false });
  expect(() => prepareCadSolidImport({ format: 'step', fileName: 'nested.step', encoding: 'utf8', data: nested })).toThrow(expect.objectContaining({ code: 'step-units-unsupported' }));
});

it('rejects unit cycles, invalid factors and right-associated intermediate overflow without native fallback', () => {
  for (const data of [chain(Array(17).fill(1), true), chain([1e309]), chain([0]), chain([-1]), chain([1e-308, 1e308, 1e308])]) {
    expect(() => assertCadStepLengthUnits(data)).toThrow(expect.objectContaining({ code: 'step-units' }));
  }
});
