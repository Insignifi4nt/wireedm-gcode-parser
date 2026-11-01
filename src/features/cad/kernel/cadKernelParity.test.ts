// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import { cadKernelBuildFingerprint, cadKernelParityModels } from './__tests__/cadKernelParity';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

// The snapshot was recorded with Replicad 1.1's own operations before the kernel owned its builders.
// It changes only with a deliberate geometry change, recorded with `vitest -u`.
it('builds the benchmark and builder-coverage parts with byte-identical previews', async () => {
  const fingerprints = Object.fromEntries(cadKernelParityModels().map(item => {
    const model = buildCadKernelModel(item.document);
    try { return [item.id, cadKernelBuildFingerprint(model.result)]; } finally { model.dispose(); }
  }));
  for (const [id, fingerprint] of Object.entries(fingerprints)) expect(fingerprint.diagnostics, id).toEqual([]);
  await expect(`${JSON.stringify(fingerprints, null, 2)}\n`).toMatchFileSnapshot('./__tests__/cadKernelParity.fingerprints.json');
}, 60_000);
