import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';

import {
  buildMachinePackageArchive,
  MAX_MACHINE_PACKAGE_EXPANDED_BYTES,
  parseMachinePackageArchive
} from '../machinePackage';
import { machinePackageFixture } from './machinePackageFixture';

describe('complete machine package boundary', () => {
  it('builds one deterministic archive and parses every required installation input from it', async () => {
    const fixture = await machinePackageFixture();

    const first = await buildMachinePackageArchive(fixture);
    const second = await buildMachinePackageArchive(fixture);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('Expected package build to succeed.');
    expect(first.archive).toEqual(second.archive);

    const parsed = await parseMachinePackageArchive(first.archive);

    expect(parsed).toMatchObject({
      ok: true,
      package: {
        document: {
          format: 'wire-edm-machine-package',
          schemaVersion: 1,
          manifest: { id: 'shop.robofil-100.package', version: '1.0.0' },
          machine: { id: 'shop.robofil-100', activeBindingId: 'production' },
          activeBindingId: 'production'
        }
      }
    });
  });

  it('normalizes explicit undefined optional fields to the same document JSON that is archived', async () => {
    const fixture = await machinePackageFixture();
    const result = await buildMachinePackageArchive({
      ...fixture,
      document: {
        ...fixture.document,
        machine: {
          ...fixture.document.machine,
          identity: {
            ...fixture.document.machine.identity,
            serialNumber: undefined
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(Object.hasOwn(result.package.document.machine.identity, 'serialNumber')).toBe(false);
    expect(await parseMachinePackageArchive(result.archive)).toMatchObject({ ok: true });
  });

  it('rejects an ambiguous package with two different selected setups', async () => {
    const fixture = await machinePackageFixture();
    const secondBinding = {
      ...fixture.document.machine.bindings[0],
      id: 'another-setup',
      name: 'Another setup'
    };
    const document = {
      ...fixture.document,
      machine: {
        ...fixture.document.machine,
        activeBindingId: fixture.document.activeBindingId,
        bindings: [...fixture.document.machine.bindings, secondBinding]
      },
      activeBindingId: secondBinding.id
    };
    const result = await parseMachinePackageArchive(zipSync({
      'wireedm-package.json': strToU8(JSON.stringify(document)),
      ...fixture.files
    }, {
      mtime: new Date(1980, 0, 1)
    }));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_ACTIVE_BINDING_CONFLICT' }]
    });
  });

  it('rejects a package manifest that is not valid UTF-8', async () => {
    const fixture = await machinePackageFixture();
    const documentBytes = strToU8(JSON.stringify({
      ...fixture.document,
      machine: {
        ...fixture.document.machine,
        activeBindingId: fixture.document.activeBindingId
      }
    }));
    const nameStart = new TextDecoder().decode(documentBytes).indexOf('Shop Robofil');
    if (nameStart < 0) throw new Error('Fixture package name is missing.');
    documentBytes[nameStart] = 0xff;

    const result = await parseMachinePackageArchive(zipSync({
      'wireedm-package.json': documentBytes,
      ...fixture.files
    }, {
      mtime: new Date(1980, 0, 1)
    }));

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_JSON_INVALID' }]
    });
  });

  it('rejects duplicate post requirements instead of silently normalizing them', async () => {
    const fixture = await machinePackageFixture();
    const result = await buildMachinePackageArchive({
      ...fixture,
      document: {
        ...fixture.document,
        posts: [fixture.document.posts[0], fixture.document.posts[0]]
      }
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_POST_DUPLICATE' }]
    });
  });

  it('does not build an archive whose expanded payload exceeds the installer limit', async () => {
    const fixture = await machinePackageFixture();
    const largeEvidence = new Uint8Array(MAX_MACHINE_PACKAGE_EXPANDED_BYTES + 1);

    const result = await buildMachinePackageArchive({
      document: fixture.document,
      files: { 'evidence/local-robofil-100-program.iso': largeEvidence }
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_EXPANDED_TOO_LARGE' }]
    });
  });

  it('rejects an oversized generated package document before semantic validation', async () => {
    const fixture = await machinePackageFixture();
    const result = await buildMachinePackageArchive({
      ...fixture,
      document: {
        ...fixture.document,
        manifest: {
          ...fixture.document.manifest,
          description: 'x'.repeat(MAX_MACHINE_PACKAGE_EXPANDED_BYTES + 1)
        }
      }
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_EXPANDED_TOO_LARGE' }]
    });
  });

  it('rejects a machine outside the post controller-manufacturer or firmware scope', async () => {
    const fixture = await machinePackageFixture();
    const result = await buildMachinePackageArchive({
      ...fixture,
      document: {
        ...fixture.document,
        machine: {
          ...fixture.document.machine,
          identity: {
            ...fixture.document.machine.identity,
            controller: {
              ...fixture.document.machine.identity.controller,
              firmware: 'Different firmware'
            }
          }
        }
      }
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'MACHINE_PACKAGE_TARGET_MISMATCH' }]
    });
  });
});
