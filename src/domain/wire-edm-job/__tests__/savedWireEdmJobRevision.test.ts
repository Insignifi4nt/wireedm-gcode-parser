import { describe, expect, it } from 'vitest';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  type MachineDefinitionValue
} from '@/domain/machine-definition/machineDefinition';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import type { WireEdmPostPackageValue } from '@/domain/post-processor/postPackageSchema';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { createUpidFromDxfEntities as createUnresolvedUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';

import {
  createSavedWireEdmJobRevisionId,
  createSavedWireEdmJobRevision,
  loadSavedWireEdmJobRevision,
  parseSavedWireEdmJobRevision,
  persistSavedWireEdmJobRevision,
  serializeSavedWireEdmJobRevision
} from '../savedWireEdmJobRevision';
import { generateControllerArtifact } from '../controllerArtifact';
import type { SavedWireEdmJobRevision } from '../savedWireEdmJobRevision';

describe('saved Wire EDM job revision', () => {
  it('creates schema-valid revision IDs even when the UUID begins with a digit', () => {
    expect(createSavedWireEdmJobRevisionId('01234567-89ab-4cde-8f01-23456789abcd'))
      .toBe('revision.01234567-89ab-4cde-8f01-23456789abcd');
    expect(() => createSavedWireEdmJobRevisionId('not-a-random-uuid'))
      .toThrow('canonical lowercase UUID v4');
  });

  it('snapshots one strict version-2 UPID project and exact resolved machine binding', async () => {
    const fixture = await revisionFixture();

    expect(fixture.revision).toMatchObject({
      format: 'wire-edm-job-revision',
      schemaVersion: 1,
      engineVersion: '2',
      revisionId: 'revision.0001',
      project: {
        format: 'wire-edm-project',
        schemaVersion: 2,
        id: 'fixture.part'
      },
      machine: {
        format: 'wire-edm-machine',
        schemaVersion: 1,
        id: 'fixture.machine'
      },
      post: {
        binding: {
          id: 'production',
          post: fixture.installation.ref
        },
        installation: fixture.installation,
        properties: { coordinatePrecision: 3 }
      }
    });
    expect('bindings' in fixture.revision.machine).toBe(false);
    expect(Object.values(fixture.revision.hashes)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)])
    );
    expect(Object.values(fixture.revision.hashes)).toHaveLength(6);

    const serialized = serializeSavedWireEdmJobRevision(fixture.revision);
    const parsed = await parseSavedWireEdmJobRevision(serialized);
    expect(parsed).toEqual({ ok: true, candidate: fixture.revision });
    expect(await loadSavedWireEdmJobRevision(
      fixture.adapter,
      fixture.revision.project.id,
      fixture.revision.revisionId
    )).toEqual({
      ok: true,
      path: fixture.path,
      revision: fixture.revision
    });
  });

  it('reads a hashed engine-1 snapshot with missing intent but blocks new output until review', async () => {
    const fixture = await revisionFixture();
    const old = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    old.engineVersion = '1';
    delete old.project.content.document.plan.operations[0].compensationIntent;
    for (const element of old.project.content.document.pathElements) delete element.compensationIntent;
    const digest = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(canonicalJson(old.project.content.document)));
    old.hashes.upid = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const parsed = await parseSavedWireEdmJobRevision(JSON.stringify(old));
    expect(parsed).toMatchObject({ ok: true, candidate: { engineVersion: '1' } });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const persisted = await persistSavedWireEdmJobRevision(createMemoryAdapter(), parsed.candidate);
    if (!persisted.ok) throw new Error(persisted.error.message);
    expect(await generateControllerArtifact(persisted.revision)).toMatchObject({
      ok: false, error: { code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID' }
    });
  });

  it('preserves an engine-1 continuous material-crossing revision without authorizing new output', async () => {
    const fixture = await revisionFixture();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
    ]);
    document.geometryBasis = 'finished-contour';
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    document.plan.operations[1].threadingTransition = {
      mode: 'continuous', wireSeparation: 'already-separated', source: 'operation-override'
    };
    expect(compileWireEdmExecutionPlan(document).ok).toBe(false);
    const legacy = compileWireEdmExecutionPlan(document, { legacySavedRevision: true });
    if (!legacy.ok) throw new Error(JSON.stringify(legacy.diagnostics));
    const old = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    old.engineVersion = '1';
    old.project.content.document = document;
    old.executionPlan = legacy.plan;
    old.hashes.upid = await hashJson(old.project.content.document);
    old.hashes.executionPlan = await hashJson(old.executionPlan);

    const parsed = await parseSavedWireEdmJobRevision(JSON.stringify(old));
    expect(parsed).toMatchObject({ ok: true, candidate: { engineVersion: '1' } });
    if (!parsed.ok) throw new Error(parsed.error.message);
    const persisted = await persistSavedWireEdmJobRevision(createMemoryAdapter(), parsed.candidate);
    if (!persisted.ok) throw new Error(persisted.error.message);
    expect(await generateControllerArtifact(persisted.revision)).toMatchObject({
      ok: false, error: { code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID' }
    });
  });

  it('rejects obsolete or non-UPID project state instead of defaulting it', async () => {
    expect(await parseSavedWireEdmJobRevision(JSON.stringify({
      format: 'wire-edm-job-revision', schemaVersion: 1, engineVersion: '3'
    }))).toMatchObject({ ok: false, error: { code: 'SAVED_REVISION_ENGINE_UNSUPPORTED' } });
    expect(await parseSavedWireEdmJobRevision(JSON.stringify({
      format: 'wire-edm-job-revision',
      schemaVersion: 0
    }))).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_VERSION_UNSUPPORTED',
        foundVersion: 0,
        supportedVersion: 1
      }
    });

    const fixture = await machineAndPostFixture();
    const external = createWorkbenchProjectDocument({
      id: 'external.part',
      name: 'External program',
      source: {
        kind: 'external-gcode',
        files: [{
          name: 'source.iso',
          path: 'imports/source.iso',
          kind: 'external-gcode',
          createdAt: '2026-08-28T12:00:00.000Z'
        }]
      },
      content: { kind: 'external-gcode', activeFilePath: 'imports/source.iso' },
      now: new Date('2026-08-28T12:00:00.000Z')
    });
    if (!external.ok) throw new Error(external.error.message);

    expect(await createSavedWireEdmJobRevision({
      revisionId: 'revision.external',
      savedAt: '2026-08-28T12:30:00.000Z',
      project: external.project,
      machine: fixture.machine,
      bindingId: 'production',
      postLibrary: fixture.library
    })).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_UPID_PROJECT_REQUIRED' }
    });
  });

  it('keeps revision paths immutable and rolls back a failed new-file verification', async () => {
    const fixture = await revisionFixture();
    expect(await persistSavedWireEdmJobRevision(
      fixture.adapter,
      fixture.candidate
    )).toMatchObject({
      ok: true,
      path: fixture.path,
      revision: { revisionId: fixture.revision.revisionId }
    });
    const conflicting = await createSavedWireEdmJobRevision({
      revisionId: fixture.revision.revisionId,
      savedAt: '2026-08-28T12:31:00.000Z',
      project: fixture.revision.project,
      machine: fixture.machine,
      bindingId: 'production',
      postLibrary: fixture.library
    });
    if (!conflicting.ok) throw new Error(conflicting.error.message);

    expect(await persistSavedWireEdmJobRevision(
      fixture.adapter,
      conflicting.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_STORAGE_CONFLICT' }
    });
    const unchanged = await loadSavedWireEdmJobRevision(
      fixture.adapter,
      fixture.revision.project.id,
      fixture.revision.revisionId
    );
    expect(unchanged).toMatchObject({
      ok: true,
      revision: { savedAt: fixture.revision.savedAt }
    });

    let stored: string | null = null;
    let readCount = 0;
    const corruptingAdapter: WorkbenchStorageAdapter = {
      name: 'Corrupting adapter',
      kind: 'memory',
      ensureDirectory: async () => undefined,
      readText: async () => {
        readCount += 1;
        if (readCount === 1) return null;
        return stored === null ? null : `${stored}corrupt`;
      },
      deleteText: async () => {
        stored = null;
      },
      writeText: async (_path, contents) => {
        stored = contents;
      }
    };
    expect(await persistSavedWireEdmJobRevision(
      corruptingAdapter,
      fixture.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_STORAGE_READBACK_MISMATCH' }
    });
    expect(stored).toBeNull();

    let failedRollbackReads = 0;
    const failedRollbackAdapter: WorkbenchStorageAdapter = {
      ...corruptingAdapter,
      readText: async () => {
        failedRollbackReads += 1;
        return failedRollbackReads === 1 ? null : 'corrupt';
      },
      deleteText: async () => {
        throw new Error('cleanup unavailable');
      }
    };
    expect(await persistSavedWireEdmJobRevision(
      failedRollbackAdapter,
      fixture.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_STORAGE_ROLLBACK_FAILED' }
    });

    let deleteAttempts = 0;
    const failedWriteAdapter: WorkbenchStorageAdapter = {
      name: 'Failed write adapter',
      kind: 'memory',
      ensureDirectory: async () => undefined,
      readText: async () => null,
      writeText: async () => { throw new Error('write unavailable'); },
      deleteText: async () => { deleteAttempts += 1; }
    };
    expect(await persistSavedWireEdmJobRevision(
      failedWriteAdapter,
      fixture.candidate
    )).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_STORAGE_WRITE_FAILED' }
    });
    expect(deleteAttempts).toBe(1);
  });

  it('recompiles and verifies both the plan and hashes when parsing', async () => {
    const fixture = await revisionFixture();
    const tamperedPlan = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    tamperedPlan.executionPlan.requirements.operationCount = 99;

    expect(await parseSavedWireEdmJobRevision(JSON.stringify(tamperedPlan))).toMatchObject({
      ok: false,
      error: { code: 'SAVED_REVISION_EXECUTION_PLAN_MISMATCH' }
    });

    const tamperedHash = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    tamperedHash.hashes.postProperties = '0'.repeat(64);
    expect(await parseSavedWireEdmJobRevision(JSON.stringify(tamperedHash))).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_HASH_MISMATCH',
        field: 'postProperties'
      }
    });

    const tamperedBinding = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    tamperedBinding.post.binding.compatibility.notes = 'Changed after the save boundary.';
    expect(await parseSavedWireEdmJobRevision(JSON.stringify(tamperedBinding))).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_HASH_MISMATCH',
        field: 'binding'
      }
    });
  });

  it('blocks machine-ready revisions when travel is exceeded or unknown', async () => {
    const fixture = await revisionFixture();
    const exceeded = JSON.parse(serializeSavedWireEdmJobRevision(fixture.revision));
    exceeded.machine.limits.xTravel = { status: 'known', millimeters: 5 };
    expect(await parseSavedWireEdmJobRevision(JSON.stringify(exceeded))).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID',
        physicalError: { code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_EXCEEDED' }
      }
    });

    const selected = await machineAndPostFixture();
    const unknownMachine = structuredClone(selected.machine) as MachineDefinitionValue;
    unknownMachine.limits.yTravel = { status: 'unknown' };
    const unknown = parseMachineDefinition(JSON.stringify(unknownMachine));
    if (!unknown.ok) throw new Error(JSON.stringify(unknown.diagnostics));
    const unknownDocument = createUpidFromDxfEntities(rectangle());
    unknownDocument.setup = {
      initialWirePosition: { kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed' }
    };
    const project = upidProject('unknown-travel.part', unknownDocument);
    expect(await createSavedWireEdmJobRevision({
      revisionId: 'revision.unknown',
      savedAt: '2026-08-28T12:30:00.000Z',
      project,
      machine: unknown.machine,
      bindingId: 'production',
      postLibrary: selected.library
    })).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID',
        physicalError: {
          code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_UNKNOWN',
          unknownAxes: ['y']
        }
      }
    });
  });

  it('blocks a revision when the machine lacks required threading hardware', async () => {
    const selected = await machineAndPostFixture();
    const noManual = structuredClone(selected.machine) as MachineDefinitionValue;
    noManual.hardware.manualThreading = false;
    const machine = parseMachineDefinition(JSON.stringify(noManual));
    if (!machine.ok) throw new Error(JSON.stringify(machine.diagnostics));
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 2 },
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 0 }, radius: 2 }
    ]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: 2, y: 0 }, review: 'reviewed' }
    };
    document.plan.operations[1].threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };

    expect(await createSavedWireEdmJobRevision({
      revisionId: 'revision.threading',
      savedAt: '2026-08-28T12:30:00.000Z',
      project: upidProject('threading.part', document),
      machine: machine.machine,
      bindingId: 'production',
      postLibrary: selected.library
    })).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID',
        physicalError: {
          code: 'MACHINE_PHYSICAL_PREFLIGHT_THREADING_UNSUPPORTED',
          methods: ['manual']
        }
      }
    });
  });

  it('blocks automatic threading when the selected machine lacks automatic hardware', async () => {
    const selected = await machineAndPostFixture();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 2 },
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 0 }, radius: 2 }
    ]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: 2, y: 0 }, review: 'reviewed' }
    };
    document.plan.operations[1].threadingTransition = {
      mode: 'automatic',
      wireSeparation: 'automatic-before-positioning',
      source: 'operation-override'
    };

    expect(await createSavedWireEdmJobRevision({
      revisionId: 'revision.automatic',
      savedAt: '2026-08-28T12:30:00.000Z',
      project: upidProject('automatic.part', document),
      machine: selected.machine,
      bindingId: 'production',
      postLibrary: selected.library
    })).toMatchObject({
      ok: false,
      error: {
        code: 'SAVED_REVISION_MACHINE_PHYSICAL_INVALID',
        physicalError: {
          code: 'MACHINE_PHYSICAL_PREFLIGHT_THREADING_UNSUPPORTED',
          methods: ['automatic']
        }
      }
    });
  });

  it('generates an artifact only from the validated revision and its exact post-owned file rules', async () => {
    const fixture = await revisionFixture();
    expect(await generateControllerArtifact(
      fixture.candidate as unknown as SavedWireEdmJobRevision
    )).toMatchObject({
      ok: false,
      error: { code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED' }
    });

    const generated = await generateControllerArtifact(fixture.revision);
    if (!generated.ok) throw new Error(generated.error.message);

    expect(generated.artifact).toMatchObject({
      format: 'wire-edm-controller-artifact',
      schemaVersion: 1,
      engineVersion: '2',
      revisionId: 'revision.0001',
      revisionHashes: fixture.revision.hashes,
      fileName: 'fixture.part.iso',
      output: {
        fileExtension: 'iso',
        lineEnding: 'crlf',
        encoding: 'ascii',
        finalNewline: true
      },
      post: fixture.installation.ref
    });
    expect(generated.artifact.text).toContain('\r\n');
    expect(generated.artifact.text.replaceAll('\r\n', '\n')).toBe(
      `${generated.artifact.program.text}\n`
    );
    expect(generated.artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('generates an audited artifact through an installed custom package', async () => {
    const fixture = await revisionFixture(customPostPackage(false));
    const generated = await generateControllerArtifact(fixture.revision);

    expect(generated).toMatchObject({
      ok: true,
      artifact: {
        program: {
          lines: ['G90', 'G1 X0 Y0', 'G1 X10 Y0', 'G1 X10 Y10', 'G1 X0 Y10', 'G1 X0 Y0', 'M02']
        }
      }
    });
  });

  it('applies post-owned envelope and sequence-number rules to the artifact only', async () => {
    const packageValue = minimalPostPackage();
    packageValue.manifest.output = {
      ...packageValue.manifest.output,
      lineEnding: 'lf',
      finalNewline: false,
      blockNumbering: {
        mode: 'sequential',
        prefix: 'N',
        start: 10,
        increment: 10,
        minimumWidth: 4
      },
      programEnvelope: { prefix: ['%'], suffix: ['%'] }
    };
    for (const fixture of packageValue.fixtures) {
      fixture.expectedArtifact = [
        '%',
        ...fixture.expectedProgram
          .split('\n')
          .map((line, index) => `N${String((index + 1) * 10).padStart(4, '0')} ${line}`),
        '%'
      ].join('\n');
    }
    const fixture = await revisionFixture(packageValue);
    const generated = await generateControllerArtifact(fixture.revision);
    if (!generated.ok) throw new Error(generated.error.message);

    expect(generated.artifact.program.text).not.toContain('N0010');
    expect(generated.artifact.text.split('\n')).toEqual([
      '%',
      ...generated.artifact.program.lines.map((line, index) => `N${String((index + 1) * 10).padStart(4, '0')} ${line}`),
      '%'
    ]);
    expect(generated.artifact.text.endsWith('\n')).toBe(false);
  });

  it('returns custom runtime diagnostics without a partial artifact', async () => {
    const fixture = await revisionFixture(customPostPackage(true));
    const generated = await generateControllerArtifact(fixture.revision);

    expect(generated).toMatchObject({
      ok: false,
      error: {
        code: 'CONTROLLER_ARTIFACT_POST_FAILED',
        diagnostics: [expect.objectContaining({ code: 'POST_CUSTOM_RUNTIME_FAILED' })]
      }
    });
    expect(generated).not.toHaveProperty('artifact');
  });
});

function customPostPackage(failOnPosition: boolean): WireEdmPostPackageValue {
  const packageValue = minimalPostPackage();
  packageValue.manifest.id = failOnPosition
    ? 'fixture.custom-post.position-failure'
    : 'fixture.custom-post';
  packageValue.source.code = `
    export function createPost(api) {
      return { onEvent(event) {
        if (event.kind === 'program-start') return api.emitCommand('distance.absolute', {});
        if (event.kind === 'position') {
          ${failOnPosition ? "throw new Error('Position rejected after conformance.');" : "return api.emitMotion('motion.linear', { x: event.to.x, y: event.to.y });"}
        }
        if (event.kind === 'motion' && event.motion === 'linear') {
          return api.emitMotion('motion.linear', { x: event.end.x, y: event.end.y });
        }
        if (event.kind === 'program-end') return api.emitCommand('program.end', {});
        api.consume('No controller block is required for this event.');
      } };
    }
  `;
  return packageValue;
}

async function revisionFixture(packageValue?: WireEdmPostPackageValue) {
  const selected = await machineAndPostFixture(packageValue);
  const document = createUpidFromDxfEntities(rectangle());
  document.setup = {
    initialWirePosition: {
      kind: 'manual',
      point: { x: -2, y: 0 },
      review: 'reviewed'
    }
  };
  const project = createWorkbenchProjectDocument({
    id: 'fixture.part',
    name: 'Fixture part',
    source: { kind: 'dxf', files: [] },
    content: { kind: 'upid-document', document },
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!project.ok) throw new Error(project.error.message);
  const saved = await createSavedWireEdmJobRevision({
    revisionId: 'revision.0001',
    savedAt: '2026-08-28T12:30:00.000Z',
    project: project.project,
    machine: selected.machine,
    bindingId: 'production',
    postLibrary: selected.library
  });
  if (!saved.ok) throw new Error(saved.error.message);
  const adapter = createMemoryAdapter();
  const persisted = await persistSavedWireEdmJobRevision(adapter, saved.candidate);
  if (!persisted.ok) throw new Error(persisted.error.message);
  return {
    ...selected,
    adapter,
    candidate: saved.candidate,
    path: persisted.path,
    revision: persisted.revision
  };
}

function createUpidFromDxfEntities(...args: Parameters<typeof createUnresolvedUpidFromDxfEntities>) {
  let document = createUnresolvedUpidFromDxfEntities(...args);
  for (const operation of document.plan.operations) {
    document = setManualCompensationIntent(document, operation.id, 'centerline') ?? document;
  }
  return document;
}

async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(canonicalJson(JSON.parse(JSON.stringify(value)))));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function machineAndPostFixture(packageValue?: WireEdmPostPackageValue) {
  const installed = await installPostPackage(
    createEmptyPostLibrary(),
    packageValue ?? minimalPostPackage()
  );
  if (!installed.ok) throw new Error(installed.error.message);
  const parsedMachine = parseMachineDefinition(JSON.stringify(machineValue()));
  if (!parsedMachine.ok) throw new Error(JSON.stringify(parsedMachine.diagnostics));
  const bound = createMachinePostBinding(parsedMachine.machine, installed.installation, {
    id: 'production',
    name: 'Production',
    properties: { coordinatePrecision: 3 },
    compatibility: {
      status: 'acknowledged',
      acknowledgedAt: '2026-08-28T12:00:00.000Z',
      acknowledgedBy: 'Test operator',
      notes: 'Exact target checked for the test fixture.'
    }
  });
  if (!bound.ok) throw new Error(bound.error.message);
  return {
    installation: installed.installation,
    library: installed.library,
    machine: bound.machine
  };
}

function machineValue(): MachineDefinitionValue {
  return {
    format: 'wire-edm-machine',
    schemaVersion: 1,
    id: 'fixture.machine',
    name: 'Fixture machine',
    identity: {
      manufacturer: 'Charmilles',
      model: 'Robofil 100',
      controller: {
        manufacturer: 'Charmilles',
        model: 'Robofil Classic',
        firmware: 'Local verified configuration'
      }
    },
    limits: {
      xTravel: { status: 'known', millimeters: 200 },
      yTravel: { status: 'known', millimeters: 150 }
    },
    hardware: { manualThreading: true, automaticThreading: false },
    evidence: [],
    bindings: [],
    activeBindingId: null,
    notes: 'Physical facts only.'
  };
}

function rectangle() {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line' as const, layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ];
}

function createMemoryAdapter(): WorkbenchStorageAdapter {
  const files = new Map<string, string>();
  return {
    name: 'Saved revision test',
    kind: 'memory',
    ensureDirectory: async () => undefined,
    readText: async (path) => files.get(path) ?? null,
    deleteText: async (path) => {
      files.delete(path);
    },
    writeText: async (path, contents) => {
      files.set(path, contents);
    }
  };
}

function upidProject(
  id: string,
  document: ReturnType<typeof createUpidFromDxfEntities>
) {
  const project = createWorkbenchProjectDocument({
    id,
    name: id,
    source: { kind: 'upid', files: [] },
    content: { kind: 'upid-document', document },
    now: new Date('2026-08-28T12:00:00.000Z')
  });
  if (!project.ok) throw new Error(project.error.message);
  return project.project;
}
