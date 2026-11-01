// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import { cadKernelParityModels } from './__tests__/cadKernelParity';
import { watchCadKernelNativeObjects } from './__tests__/cadKernelNativeObjects';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

// Every builder and coordinate system a rebuild makes for its booleans, patterns, transforms, sketches, planes, prisms and revolves.
// Points and directions are left out: Replicad's face and curve queries leave theirs to its garbage-collection scopes. The
// adapters' own points and directions are counted in cadKernelBuilders.test.ts.
const counted = ['BRepAlgoAPI_Fuse', 'BRepAlgoAPI_Cut', 'BRepAlgoAPI_Common', 'BRepBuilderAPI_Transform', 'BRepFilletAPI_MakeFillet', 'BRepFilletAPI_MakeChamfer',
  'BRepPrimAPI_MakePrism', 'BRepPrimAPI_MakeRevol', 'BRepBuilderAPI_MakeFace', 'gp_Trsf', 'gp_Ax1', 'gp_Ax2', 'gp_Ax3'] as const;
const parts = new Map(cadKernelParityModels().map(item => [item.id, item.document]));
function build(id: string) {
  const document = parts.get(id);
  if (!document) throw new Error(`Expected the ${id} part`);
  const model = buildCadKernelModel(document);
  try { expect(model.result.diagnostics).toEqual([]); } finally { model.dispose(); }
}

/** Forced collection when the runtime allows it; the counts do not depend on it. */
function collector(): (() => void) | undefined {
  try { setFlagsFromString('--expose-gc'); return runInNewContext('gc') as () => void; } catch { return undefined; }
}

it('rebuilds a plate cut by a hole pattern 20 times with no outstanding native builders and a flat heap', async () => {
  const gc = collector(), memory = (getOC() as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory;
  const settle = async () => { gc?.(); await new Promise(resolve => setTimeout(resolve, 0)); gc?.(); };
  const objects = watchCadKernelNativeObjects(counted);
  try {
    // Warm-up builds grow the heap to the part's working size.
    build('bench-plate-hole-pattern-0'); build('bench-plate-hole-pattern-0'); await settle();
    const heap = memory.buffer.byteLength;
    expect(objects.outstanding()).toEqual({});
    // Rebuild synchronously, as a queue of edits does, so nothing waits on garbage collection.
    for (let rebuild = 0; rebuild < 20; rebuild++) { build('bench-plate-hole-pattern-0'); expect(objects.outstanding(), `rebuild ${rebuild + 1}`).toEqual({}); }
    await settle();
    expect(objects.made()).toBeGreaterThan(22 * 10);
    expect(memory.buffer.byteLength).toBe(heap);
  } finally { objects.restore(); }
}, 60_000);

// Parts whose features reach every other owned path: revolve axes, mirror and transform, loft, sweep,
// Pocket, datum-plane sketches, shell, all-edge fillet and chamfer, and circular patterns.
it.each(['revolve-mirror-transform', 'datum-pad-revolve', 'loft-sweep-pocket', 'shell-fillet', 'box-chamfer-all', 'near-full-turn-pattern'])(
  'builds %s with no outstanding native builders or coordinate objects', id => {
    const objects = watchCadKernelNativeObjects(counted);
    try { build(id); expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({}); }
    finally { objects.restore(); }
  });
