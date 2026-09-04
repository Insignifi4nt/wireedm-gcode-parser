import { describe, expect, it } from 'vitest';

import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';

import {
  activateMachinePostBinding,
  createMachinePostBinding,
  parseMachineDefinition,
  removeMachinePostBinding,
  resolveMachinePostBinding,
  serializeMachineDefinition,
  type MachineDefinitionValue
} from '../machineDefinition';
import {
  compatibilityFixture,
  machineDefinitionFixture,
  machineDefinitionValue,
  postInstallationFixture
} from './machineDefinitionFixture';

describe('physical machine definitions and exact post bindings', () => {
  it('parses explicit physical facts without inventing unknown limits', () => {
    expect(parseMachineDefinition(JSON.stringify(machineDefinitionValue()))).toEqual({
      ok: true,
      machine: machineDefinitionValue()
    });
  });

  it('rejects the obsolete mixed machine-profile schema', () => {
    const obsolete = {
      id: 'legacy',
      name: 'Legacy profile',
      controller: { family: 'generic-iso' },
      templates: { header: 'G90', footer: 'M30' }
    };

    expect(parseMachineDefinition(JSON.stringify(obsolete))).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'MACHINE_DEFINITION_SCHEMA_INVALID' })
      ])
    });
  });

  it('retains multiple exact bindings and never materializes suggested properties', async () => {
    const firstInstallation = await postInstallationFixture('1.0.0');
    const first = createMachinePostBinding(machineDefinitionFixture(), firstInstallation, {
      id: 'production-v1',
      name: 'Production v1',
      properties: { coordinatePrecision: 4 },
      compatibility: compatibilityFixture()
    });
    if (!first.ok) throw new Error(first.error.message);

    const secondInstallation = await postInstallationFixture('2.0.0');
    const second = createMachinePostBinding(first.machine, secondInstallation, {
      id: 'candidate-v2',
      name: 'Candidate v2',
      properties: { coordinatePrecision: 5 },
      compatibility: compatibilityFixture()
    });
    if (!second.ok) throw new Error(second.error.message);

    expect(second.machine.bindings.map(({ post, properties }) => ({
      version: post.version,
      properties
    }))).toEqual([
      { version: '1.0.0', properties: { coordinatePrecision: 4 } },
      { version: '2.0.0', properties: { coordinatePrecision: 5 } }
    ]);

    expect(activateMachinePostBinding(second.machine, 'candidate-v2')).toMatchObject({
      ok: true,
      machine: { activeBindingId: 'candidate-v2' }
    });
  });

  it('returns property diagnostics instead of filling required values', async () => {
    const result = createMachinePostBinding(
      machineDefinitionFixture(),
      await postInstallationFixture(),
      {
        id: 'incomplete',
        name: 'Incomplete',
        properties: {},
        compatibility: compatibilityFixture()
      }
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_POST_BINDING_PROPERTIES_INVALID',
        diagnostics: [{ code: 'POST_PROPERTY_REQUIRED', path: '/coordinatePrecision' }]
      }
    });
  });

  it('rejects duplicate IDs, resolves only exact installed content, and removes explicitly', async () => {
    const installation = await postInstallationFixture();
    const created = createMachinePostBinding(machineDefinitionFixture(), installation, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    });
    if (!created.ok) throw new Error(created.error.message);

    expect(createMachinePostBinding(created.machine, installation, {
      id: 'production',
      name: 'Duplicate',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    })).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_ID_CONFLICT' }
    });

    const library = (await installPostPackage(createEmptyPostLibrary(), installation.package));
    if (!library.ok) throw new Error(library.error.message);
    expect(await resolveMachinePostBinding(created.machine, library.library, 'production')).toMatchObject({
      ok: true,
      binding: { id: 'production' },
      installation: { ref: installation.ref }
    });
    expect(await resolveMachinePostBinding(created.machine, createEmptyPostLibrary(), 'production')).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_INSTALLATION_NOT_FOUND' }
    });

    expect(removeMachinePostBinding(created.machine, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_NOT_FOUND' }
    });
    expect(removeMachinePostBinding(created.machine, 'production')).toEqual({
      ok: true,
      machine: machineDefinitionFixture(),
      removed: created.machine.bindings[0]
    });
  });

  it('serializes a portable machine without embedding post source', async () => {
    const installation = await postInstallationFixture();
    const created = createMachinePostBinding(machineDefinitionFixture(), installation, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    });
    if (!created.ok) throw new Error(created.error.message);

    const serialized = serializeMachineDefinition(created.machine);

    expect(serialized).not.toContain('createPost');
    expect(parseMachineDefinition(serialized)).toEqual({
      ok: true,
      machine: created.machine
    });
  });

  it('rejects a setup whose exact post does not target the machine controller firmware', async () => {
    const installation = await postInstallationFixture();
    const created = createMachinePostBinding(machineDefinitionFixture(), installation, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    });
    if (!created.ok) throw new Error(created.error.message);
    const changedFirmware = structuredClone(created.machine) as MachineDefinitionValue;
    changedFirmware.identity.controller.firmware = 'Different firmware';
    const parsed = parseMachineDefinition(JSON.stringify(changedFirmware));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const library = await installPostPackage(createEmptyPostLibrary(), installation.package);
    if (!library.ok) throw new Error(library.error.message);

    expect(await resolveMachinePostBinding(parsed.machine, library.library, 'production')).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_TARGET_MISMATCH', bindingId: 'production' }
    });
  });

  it('keeps imported verification as a claim until exact hashes resolve', async () => {
    const installation = await postInstallationFixture();
    const created = createMachinePostBinding(machineDefinitionFixture(), installation, {
      id: 'production',
      name: 'Production',
      properties: { coordinatePrecision: 3 },
      compatibility: compatibilityFixture()
    });
    if (!created.ok) throw new Error(created.error.message);
    const claimed = structuredClone(created.machine) as MachineDefinitionValue;
    claimed.evidence.push({
      id: 'local-test',
      name: 'Local test record',
      uri: 'local://robofil-100/production-test',
      contentSha256: '1'.repeat(64)
    });
    claimed.bindings[0].verification = {
      status: 'claimed',
      verifiedAt: '2026-08-28T12:00:00.000Z',
      verifiedBy: 'Cristian',
      machineDefinitionHash: '0'.repeat(64),
      postContentHash: installation.ref.contentHash,
      propertiesHash: '0'.repeat(64),
      evidenceRefs: ['local-test'],
      notes: 'Deliberately forged hashes for the boundary regression.'
    };

    const parsed = parseMachineDefinition(JSON.stringify(claimed));
    expect(parsed).toMatchObject({
      ok: true,
      machine: { bindings: [{ verification: { status: 'claimed' } }] }
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const library = await installPostPackage(createEmptyPostLibrary(), installation.package);
    if (!library.ok) throw new Error(library.error.message);
    expect(await resolveMachinePostBinding(parsed.machine, library.library, 'production')).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_POST_BINDING_VERIFICATION_INVALID' }
    });
  });
});
