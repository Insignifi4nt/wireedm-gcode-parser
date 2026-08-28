import { describe, expect, it } from 'vitest';

import {
  createEmptyPostLibrary,
  installPostPackage,
  removePostInstallation,
  resolvePostInstallation
} from '../postLibrary';
import { parseWireEdmPostPackage } from '../postPackage';
import { minimalPostPackage } from './postPackageFixture';

function parsedPackage(input = minimalPostPackage()) {
  const result = parseWireEdmPostPackage(JSON.stringify(input));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.package;
}

describe('versioned post library', () => {
  it('installs exact content idempotently and retains parallel versions', async () => {
    const empty = createEmptyPostLibrary();
    const versionOne = parsedPackage();
    const first = await installPostPackage(empty, versionOne);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);

    const repeated = await installPostPackage(first.library, versionOne);
    expect(repeated.ok).toBe(true);
    if (!repeated.ok) throw new Error(repeated.error.message);
    expect(repeated.kind).toBe('already-installed');
    expect(repeated.library.installations).toHaveLength(1);

    const versionTwoInput = minimalPostPackage();
    versionTwoInput.manifest.version = '2.0.0';
    const second = await installPostPackage(repeated.library, parsedPackage(versionTwoInput));
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.error.message);
    expect(second.library.installations.map(({ ref }) => ref.version)).toEqual(['1.0.0', '2.0.0']);
  });

  it('rejects different content claiming an installed package ID and version', async () => {
    const original = await installPostPackage(createEmptyPostLibrary(), parsedPackage());
    if (!original.ok) throw new Error(original.error.message);
    const conflictingInput = minimalPostPackage();
    conflictingInput.source.code += '\n// different content';

    const conflict = await installPostPackage(original.library, parsedPackage(conflictingInput));

    expect(conflict).toMatchObject({
      ok: false,
      error: {
        code: 'POST_LIBRARY_VERSION_CONFLICT',
        packageId: 'example.robofil-classic',
        version: '1.0.0'
      }
    });
  });

  it('resolves only an exact ID, version, and hash', async () => {
    const installed = await installPostPackage(createEmptyPostLibrary(), parsedPackage());
    if (!installed.ok) throw new Error(installed.error.message);
    const ref = installed.installation.ref;

    expect(resolvePostInstallation(installed.library, ref)).toEqual({
      ok: true,
      installation: installed.installation
    });
    expect(resolvePostInstallation(installed.library, { ...ref, contentHash: '0'.repeat(64) })).toEqual({
      ok: false,
      error: {
        code: 'POST_LIBRARY_INSTALLATION_NOT_FOUND',
        message: `Post installation not found: ${ref.packageId}@${ref.version} with hash ${'0'.repeat(64)}.`
      }
    });
  });

  it('rejects removal while a machine binding references the installation', async () => {
    const installed = await installPostPackage(createEmptyPostLibrary(), parsedPackage());
    if (!installed.ok) throw new Error(installed.error.message);
    const ref = installed.installation.ref;

    expect(removePostInstallation(installed.library, ref, [
      { machineId: 'shop-robofil', bindingId: 'verified-v1', post: ref }
    ])).toEqual({
      ok: false,
      error: {
        code: 'POST_LIBRARY_INSTALLATION_IN_USE',
        message: 'Post installation is used by 1 machine binding: shop-robofil/verified-v1.',
        bindings: [{ machineId: 'shop-robofil', bindingId: 'verified-v1' }]
      }
    });

    expect(removePostInstallation(installed.library, ref, [])).toEqual({
      ok: true,
      library: createEmptyPostLibrary(),
      removed: installed.installation
    });
  });
});
