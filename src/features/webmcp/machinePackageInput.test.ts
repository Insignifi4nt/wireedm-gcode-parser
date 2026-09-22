import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { machinePackageInputFile, machinePackageSource, MAX_MACHINE_PACKAGE_BASE64_CHARACTERS } from './machinePackageInput';

const fileName = 'machine.wireedm-package';
beforeEach(() => vi.stubGlobal('File', NodeFile));
afterEach(() => vi.unstubAllGlobals());

describe('direct machine package bytes', () => {
  it('preserves every byte across base64 decoding batches', async () => {
    const bytes = Uint8Array.from({ length: 130_001 }, (_, index) => index % 256);
    const file = await machinePackageInputFile({ fileName, base64: Buffer.from(bytes).toString('base64') }, new AbortController().signal);
    expect(file.name).toBe(fileName);
    expect(file.size).toBe(bytes.byteLength);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it.each(['', 'AAA', 'AAAA\n', 'AAAA AAAA', 'AB==', 'AAB=', 'A===', 'AA=A', '====', 'AA-_',
    'data:application/zip;base64,AAAA', 'https://example.test/machine.wireedm-package'])('rejects noncanonical encoding %j', async base64 => {
    await expect(machinePackageInputFile({ fileName, base64 }, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_ENCODING' });
  });

  it('bounds decoded bytes before allocating and rejects oversized tool arguments', async () => {
    await expect(machinePackageInputFile({ fileName, base64: 'A'.repeat(MAX_MACHINE_PACKAGE_BASE64_CHARACTERS) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'INPUT_TOO_LARGE' });
    expect(Value.Check(machinePackageSource, { fileName, base64: 'A'.repeat(MAX_MACHINE_PACKAGE_BASE64_CHARACTERS + 4) })).toBe(false);
  });

  it.each(['../machine.wireedm-package', 'C:\\machine.wireedm-package', 'machine\u0000.wireedm-package'])('rejects a path or invalid filename %j', async name => {
    expect(Value.Check(machinePackageSource, { fileName: name, base64: 'AAAA' })).toBe(false);
    await expect(machinePackageInputFile({ fileName: name, base64: 'AAAA' }, new AbortController().signal)).rejects.toMatchObject({ code: 'WRONG_FILE' });
  });

  it('rejects standalone posts and observes cancellation between larger decoding batches', async () => {
    await expect(machinePackageInputFile({ fileName: 'post.json', base64: 'e30=' }, new AbortController().signal)).rejects.toMatchObject({ code: 'WRONG_FILE' });
    const abort = new AbortController();
    const decoding = machinePackageInputFile({ fileName, base64: 'AAAA'.repeat(400_000) }, abort.signal);
    abort.abort();
    await expect(decoding).rejects.toMatchObject({ name: 'AbortError' });
  });
});
