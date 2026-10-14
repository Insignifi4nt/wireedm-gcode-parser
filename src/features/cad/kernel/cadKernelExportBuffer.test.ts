// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, afterEach, expect, it, vi } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, makeBox, measureVolume, setOC } from 'replicad';
import { exportCadKernelStep } from './cadKernelExport';
import { cadKernelDisposeOwned, cadKernelIsValid } from './cadKernelShapes';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)),
    print: () => undefined, printErr: () => undefined }));
}, 60_000);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['owned', 'shared', 'native'] as const)('snapshots complete offset STEP bytes from %s storage and survives file/shape cleanup', async ownership => {
  const shape = makeBox([0, 0, 0], [10, 20, 5]), oc = getOC(), read = oc.FS.readFile.bind(oc.FS), memory = oc.wasmMemory;
  let expected: Uint8Array<ArrayBuffer> | undefined, view: Uint8Array | undefined;
  vi.spyOn(oc.FS, 'readFile').mockImplementation((path, options) => {
    const bytes = read(path, options);
    if (path !== '/export.step') return bytes;
    expected = new Uint8Array(bytes);
    const backing = ownership === 'owned' ? new ArrayBuffer(bytes.length + 128) : ownership === 'shared' ? new SharedArrayBuffer(bytes.length + 128)
      : (oc.wasmMemory = new WebAssembly.Memory({ initial: Math.ceil((bytes.length + 128) / 65536) })).buffer;
    view = new Uint8Array(backing, 64, bytes.length); view.set(bytes); return view;
  });
  const copy = vi.spyOn(Uint8Array, 'from');
  try {
    const blob = exportCadKernelStep([{ shape, name: 'Exported box' }]);
    oc.wasmMemory = memory;
    if (!expected || !view) throw new Error('The native export did not read its output.');
    expect(blob.type).toBe('application/step'); expect(blob.size).toBe(expected.length);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expected);
    expect(copy.mock.calls.filter(([input]) => input === view)).toHaveLength(ownership === 'owned' ? 0 : 1);
    view.fill(0); new Uint8Array(view.buffer, 0, 64).fill(0xff);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expected);
    expect(() => read('/export.step')).toThrow();
    expect(cadKernelIsValid(shape)).toBe(true); expect(measureVolume(shape)).toBeCloseTo(1000, 8);
    cadKernelDisposeOwned(shape);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(expected);
  } finally { oc.wasmMemory = memory; cadKernelDisposeOwned(shape); }
});

it('retains the Blob construction failure while releasing scratch output and preserving borrowed geometry', () => {
  const shape = makeBox([0, 0, 0], [10, 20, 5]), oc = getOC(), unlink = oc.FS.unlink.bind(oc.FS), failure = new Error('Blob snapshot failed');
  vi.stubGlobal('Blob', class { constructor() { throw failure; } });
  vi.spyOn(oc.FS, 'unlink').mockImplementation(path => { unlink(path); throw new Error('Cleanup receipt failed'); });
  try {
    expect(() => exportCadKernelStep([{ shape, name: 'Borrowed box' }])).toThrow(failure);
    expect(() => oc.FS.readFile('/export.step')).toThrow();
    expect(cadKernelIsValid(shape)).toBe(true); expect(measureVolume(shape)).toBeCloseTo(1000, 8);
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    expect(exportCadKernelStep([{ shape, name: 'Retry box' }]).size).toBeGreaterThan(0);
  } finally { cadKernelDisposeOwned(shape); }
});

it('preserves an export read failure through unlink failure and leaves the native source usable', () => {
  const shape = makeBox([0, 0, 0], [10, 20, 5]), oc = getOC(), failure = new Error('Native output read failed'), unlink = oc.FS.unlink.bind(oc.FS);
  vi.spyOn(oc.FS, 'readFile').mockImplementation(() => { throw failure; });
  vi.spyOn(oc.FS, 'unlink').mockImplementation(() => { throw new Error('Scratch cleanup failed'); });
  try {
    expect(() => exportCadKernelStep([{ shape, name: 'Borrowed box' }])).toThrow(failure);
    expect(cadKernelIsValid(shape)).toBe(true); expect(measureVolume(shape)).toBeCloseTo(1000, 8);
  } finally {
    vi.restoreAllMocks(); unlink('/export.step'); cadKernelDisposeOwned(shape);
  }
});
