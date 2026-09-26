import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { applicableEmittedPauseEvidence, emittedPauseEvidence } from '@/domain/editor/emittedPauseEvidence';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { reversePathOperation } from '@/domain/path-editor/pathDocumentOperations';
import {
  createMachinePostBinding,
  parseMachineDefinition
} from '@/domain/machine-definition/machineDefinition';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { generateControllerArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import { parseMachinePackageArchive } from '@/domain/machine-package';
import {
  createSavedWireEdmJobRevision,
  persistSavedWireEdmJobRevision
} from '@/domain/wire-edm-job/savedWireEdmJobRevision';

import packageJson from '../../../../tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';
import machineJson from '../../../../tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100.wireedm-machine.json';
import { runPost } from '../postEngine';
import { serializeControllerOutput } from '../controllerOutput';
import { createEmptyPostLibrary, installPostPackage, hashPostPackage } from '../postLibrary';
import { parseWireEdmPostPackage } from '../postPackage';

describe('standalone Robofil 100 V2 package', () => {
  it('retains the exact 2.5 controller contract and installs legacy and provenance releases side by side', async () => {
    const legacy = structuredClone(packageJson);
    delete (legacy.manifest as Partial<typeof legacy.manifest>).authoredFor;
    legacy.manifest.version = '2.5.0';
    const parsed = parseWireEdmPostPackage(JSON.stringify(legacy));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    // Published 2.5 hash: this detects any source, dialect, output, evidence or fixture change.
    expect(await hashPostPackage(parsed.package)).toBe('525dda778a52a9f54a424fd4313d9c998613caaf8502573cfd519dd46a8a1d38');
    const oldInstall = await installPostPackage(createEmptyPostLibrary(), parsed.package);
    if (!oldInstall.ok) throw new Error(oldInstall.error.message);
    const current = parseWireEdmPostPackage(JSON.stringify(packageJson));
    if (!current.ok) throw new Error(JSON.stringify(current.diagnostics));
    const upgraded = await installPostPackage(oldInstall.library, current.package);
    expect(upgraded).toMatchObject({ ok: true, library: { installations: [
      { ref: { version: '2.5.0' } }, { ref: { version: '2.6.0' } }
    ] } });
  });
  it('ships one complete human-installable machine package', async () => {
    const archive = new Uint8Array(await readFile(resolve(
      process.cwd(),
      'tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-package'
    )));
    const parsed = await parseMachinePackageArchive(archive);

    expect(parsed).toMatchObject({
      ok: true,
      package: {
        document: {
          manifest: { id: 'cristian.robofil-100.v2-candidate-package', version: '2.6.0' },
          machine: { id: 'cristian.robofil-100', activeBindingId: 'robofil-v2-candidate-2-6-0' },
          posts: [{
            manifest: {
              id: 'cristian.robofil-100.v2-candidate',
              version: '2.6.0',
              output: {
                fileExtension: 'iso',
                blockNumbering: { mode: 'sequential', prefix: 'N', start: 10 },
                programEnvelope: { prefix: ['%'] }
              }
            }
          }]
        }
      }
    });
  });

  it('ships a complete machine with its exact candidate setup selected', () => {
    expect(parseMachineDefinition(JSON.stringify(machineJson))).toMatchObject({
      ok: true,
      machine: {
        id: 'cristian.robofil-100',
        activeBindingId: 'robofil-v2-candidate-2-6-0',
        bindings: [{
          id: 'robofil-v2-candidate-2-6-0',
          post: {
            packageId: 'cristian.robofil-100.v2-candidate',
            version: '2.6.0'
          }
        }]
      }
    });
  });

  it('installs through ordinary conformance and posts absent or reviewed-none leads identically', async () => {
    const installation = await installRobofilV2();
    const absent = await post(installation, compensatedRectangle());
    const reviewedNoneDocument = compensatedRectangle();
    reviewedNoneDocument.plan.operations[0].transitions = {
      entry: { strategy: 'none', review: 'reviewed' },
      exit: { strategy: 'none', review: 'reviewed' }
    };
    const reviewedNone = await post(installation, reviewedNoneDocument);

    expect(reviewedNone.text).toBe(absent.text);
    expect(absent.lines).toEqual([
      'G92 X0.000 Y0.000',
      'G41',
      'G38 D0',
      'G1 X10.000 Y0.000',
      'G1 X10.000 Y10.000',
      'G1 X0.000 Y10.000',
      'G1 X0.000 Y0.000',
      'G40',
      'G39',
      'M02'
    ]);
    expect(absent.text).not.toMatch(/(?:^|\n)G0\b/);
    expect(absent.blocks.some(({ motion }) => motion?.role === 'entry' || motion?.role === 'exit')).toBe(false);
  });

  it('keeps explicitly authored entry and exit geometry as package-rendered motion', async () => {
    const installation = await installRobofilV2();
    const document = compensatedRectangle({ x: -2, y: 0 });
    document.plan.operations[0].transitions = {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: -2, y: 0 },
        to: { x: 0, y: 0 },
        review: 'reviewed'
      },
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 0, y: 0 },
        to: { x: -2, y: 0 },
        review: 'reviewed'
      }
    };

    const program = await post(installation, document);

    expect(program.blocks.filter(({ motion }) => motion?.role === 'entry' || motion?.role === 'exit'))
      .toEqual([
        expect.objectContaining({ text: 'G1 X0.000 Y0.000' }),
        expect.objectContaining({ text: 'G1 X-2.000 Y0.000' })
      ]);
  });

  it('audits decimal DXF coordinates at the post’s three-decimal output resolution', async () => {
    const installation = await installRobofilV2();
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0.123456, y: -0.567891 }, radius: 11.186444 }
    ]);
    source.options.endpointTolerance = 0;
    source.geometryBasis = 'finished-contour';
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const configured = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside');
    if (!configured) throw new Error('Expected a closed contour.');
    const program = await post(installation, configured);
    expect(program.lines).toEqual(expect.arrayContaining([
      'G92 X0.000 Y0.000', 'G0 X11.310 Y-0.568'
    ]));
  });

  it('keeps one compensation lifecycle across same-side continuous contours', async () => {
    const installation = await installRobofilV2();
    const program = await post(installation, compensatedTwoRectangles());

    expect(program.lines).toEqual([
      'G92 X0.000 Y0.000',
      'G41',
      'G38 D0',
      'G1 X10.000 Y0.000',
      'G1 X10.000 Y10.000',
      'G1 X0.000 Y10.000',
      'G1 X0.000 Y0.000',
      'G0 X20.000 Y0.000',
      'G1 X30.000 Y0.000',
      'G1 X30.000 Y10.000',
      'G1 X20.000 Y10.000',
      'G1 X20.000 Y0.000',
      'G40',
      'G39',
      'M02'
    ]);
  });

  it('switches the modal side directly across a clear continuous rapid', async () => {
    const installation = await installRobofilV2();
    const source = compensatedTwoRectangles();
    const reversed = reversePathOperation(source, source.plan.operations[1].id);
    if (!reversed) throw new Error('Expected the second contour to be reversible.');
    const program = await post(installation, reversed);
    const rapidIndex = program.lines.findIndex((line) => line === 'G0 X20.000 Y0.000');
    expect(rapidIndex).toBeGreaterThan(0);
    expect(program.lines.slice(rapidIndex, rapidIndex + 3)).toEqual([
      'G0 X20.000 Y0.000', 'G42', 'G38 D0'
    ]);
    expect(program.lines.filter((line) => line === 'G40' || line === 'G39')).toEqual(['G40', 'G39']);
  });

  it('emits an exact travel-distance stop through the unchanged installed post', async () => {
    const installation = await installRobofilV2();
    const source = compensatedTwoRectangles();
    source.schemaVersion = 3;
    source.plan.operations[0].programStops = [{ id: 'travel-inspection', enabled: true, reason: 'operator-check',
      placement: { kind: 'after-contour-distance', travelLengthMm: 5 } }];
    const before = await hashPostPackage(installation.package);
    const program = await post(installation, source);
    const index = program.lines.indexOf('G0 X5.000 Y0.000');
    expect(index).toBeGreaterThan(0);
    expect(program.lines.slice(index, index + 3)).toEqual(['G0 X5.000 Y0.000', 'M00', 'G0 X20.000 Y0.000']);
    expect(await hashPostPackage(installation.package)).toBe(before);
    expect(program.lines.filter((line) => line === 'G40' || line === 'G39')).toEqual(['G40', 'G39']);
  });

  it('blocks unverified wire separation and rethread transitions', async () => {
    const installation = await installRobofilV2();
    const document = compensatedTwoRectangles();
    document.plan.operations[1].threadingTransition = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning',
      source: 'operation-override'
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    const result = await runPost(compiled.plan, {
      installation,
      properties: { coordinatePrecision: 3, offsetIndex: 0 }
    });

    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'POST_CUSTOM_CAPABILITY_UNSUPPORTED',
          message: expect.stringContaining('manual-before-positioning') })
      ])
    });
  });

  it('separates on a solid-crossing rapid and pauses at the destination for manual rethreading', async () => {
    const installation = await installRobofilV2();
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
    ]);
    source.geometryBasis = 'finished-contour';
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    let document = source;
    for (const operation of source.plan.operations) {
      const configured = setManualCompensationIntent(document, operation.id,
        operation.id === source.plan.operations[0].id ? 'outside' : 'inside');
      if (!configured) throw new Error('Expected closed contours.');
      document = configured;
    }
    document.plan.operations[1].threadingTransition = {
      mode: 'manual', wireSeparation: 'automatic-during-positioning', source: 'operation-override'
    };
    document.schemaVersion = 2;
    document.plan.operations[1].programStops = [{ id: 'inspect-before-thread', enabled: true,
      reason: 'operator-check', placement: { kind: 'after-positioning' } }];
    document.plan.operations[1].transitions = { entry: {
      strategy: 'manual-straight', move: 'cut',
      from: { x: 72.5, y: 0 }, to: document.plan.operations[1].startPoint,
      review: 'reviewed'
    } };
    const program = await post(installation, document);
    const rapidIndex = program.lines.findIndex((line) => line === 'G0 X72.500 Y0.000');
    expect(rapidIndex).toBeGreaterThan(0);
    expect(program.lines.slice(rapidIndex, rapidIndex + 6)).toEqual([
      'G0 X72.500 Y0.000', 'M00', 'M00', 'G42', 'G38 D0', 'G1 X70.500 Y0.000'
    ]);
    expect(program.blocks.find((block) => block.text === 'G0 X72.500 Y0.000'))
      .toMatchObject({ commandIds: ['motion.rapid-separating'] });
    expect(program.blocks.filter((block) => block.text === 'M00').map((block) => block.commandIds))
      .toEqual([['operator.program-stop'], ['operator.manual-thread']]);
    const output = serializeControllerOutput(program, installation.package.manifest.output);
    if (!output.ok) throw new Error(output.error.message);
    expect(output.text).toBe([
      '%',
      'N10 G92 X0.000 Y0.000',
      'N20 G0 X5.000 Y0.000',
      'N30 G41',
      'N40 G38 D0',
      'N50 G3 X-5.000 Y0.000 I0.000 J0.000',
      'N60 G3 X5.000 Y0.000 I0.000 J0.000',
      'N70 G0 X72.500 Y0.000',
      'N80 M00',
      'N90 M00',
      'N100 G42',
      'N110 G38 D0',
      'N120 G1 X70.500 Y0.000',
      'N130 G3 X-70.500 Y0.000 I0.000 J0.000',
      'N140 G3 X70.500 Y0.000 I0.000 J0.000',
      'N150 G40',
      'N160 G39',
      'N170 M02',
      ''
    ].join('\r\n'));
  });

  it('keeps the existing compensation side through a manual rethread', async () => {
    const installation = await installRobofilV2();
    const source = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
    ]);
    source.geometryBasis = 'finished-contour';
    source.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    let document = source;
    for (const operation of source.plan.operations) {
      const configured = setManualCompensationIntent(document, operation.id, 'outside');
      if (!configured) throw new Error('Expected closed contours.');
      document = configured;
    }
    document.plan.operations[1].threadingTransition = {
      mode: 'manual', wireSeparation: 'automatic-during-positioning', source: 'operation-override'
    };
    document.schemaVersion = 2;

    const program = await post(installation, document);
    const rapidIndex = program.lines.findIndex((line) => line === 'G0 X70.500 Y0.000');
    expect(rapidIndex).toBeGreaterThan(0);
    expect(program.lines.slice(rapidIndex, rapidIndex + 3)).toEqual([
      'G0 X70.500 Y0.000', 'M00', 'G3 X-70.500 Y0.000 I0.000 J0.000'
    ]);
    expect(program.lines.filter((line) => line === 'G41' || line === 'G42')).toHaveLength(1);
    expect(program.lines.filter((line) => line === 'G38 D0')).toHaveLength(1);
    expect(program.lines.filter((line) => line === 'G40' || line === 'G39')).toEqual(['G40', 'G39']);
  });

  it('exports an exact persisted no-lead revision through an explicit machine binding', async () => {
    const installed = await installRobofilV2Package();
    const parsedMachine = parseMachineDefinition(JSON.stringify(machineJson));
    if (!parsedMachine.ok) throw new Error(JSON.stringify(parsedMachine.diagnostics));
    const bound = createMachinePostBinding(parsedMachine.machine, installed.installation, {
      id: 'cristian-testing-v2',
      name: 'Cristian testing V2',
      properties: { coordinatePrecision: 3, offsetIndex: 0 },
      compatibility: {
        status: 'acknowledged',
        acknowledgedAt: '2026-08-29T09:00:00.000Z',
        acknowledgedBy: 'Cristian',
        notes: 'Explicit test binding for the standalone Robofil 100 V2 candidate.'
      }
    });
    if (!bound.ok) throw new Error(bound.error.message);

    const sourceDocument = compensatedRectangle();
    const project = createWorkbenchProjectDocument({
      id: 'robofil.no-lead-test',
      name: 'Robofil no-lead test',
      source: { kind: 'dxf', files: [] },
      content: { kind: 'upid-document', document: sourceDocument },
      now: new Date('2026-08-29T09:00:00.000Z')
    });
    if (!project.ok) throw new Error(project.error.message);
    const saved = await createSavedWireEdmJobRevision({
      revisionId: 'robofil.no-lead-test.0001',
      savedAt: '2026-08-29T09:01:00.000Z',
      project: project.project,
      machine: bound.machine,
      bindingId: bound.binding.id,
      postLibrary: installed.library
    });
    if (!saved.ok) throw new Error(saved.error.message);
    const persisted = await persistSavedWireEdmJobRevision(
      memoryAdapter(),
      saved.candidate
    );
    if (!persisted.ok) throw new Error(persisted.error.message);

    const generated = await generateControllerArtifact(persisted.revision);
    if (!generated.ok) throw new Error(generated.error.message);

    expect(generated.artifact.fileName).toBe('robofil.no-lead-test.iso');
    expect(generated.artifact.text).toBe([
      '%',
      'N10 G92 X0.000 Y0.000',
      'N20 G41',
      'N30 G38 D0',
      'N40 G1 X10.000 Y0.000',
      'N50 G1 X10.000 Y10.000',
      'N60 G1 X0.000 Y10.000',
      'N70 G1 X0.000 Y0.000',
      'N80 G40',
      'N90 G39',
      'N100 M02',
      ''
    ].join('\r\n'));
    expect(new TextEncoder().encode(generated.artifact.text).byteLength).toBeGreaterThan(0);
    const activeMachine = { ...bound.machine, activeBindingId: bound.binding.id };
    const evidence = await emittedPauseEvidence(generated.artifact, installed.installation,
      sourceDocument, activeMachine, 'saved-source', 'project-1');
    expect(evidence).not.toBeNull();
    expect(applicableEmittedPauseEvidence(evidence, {
      sourceSignature: 'saved-source', projectIdentity: 'project-1', hasUnsavedChanges: false,
      machines: [activeMachine], posts: installed.library
    })).toEqual(new Map());
    expect(applicableEmittedPauseEvidence(evidence, {
      sourceSignature: 'changed-source', projectIdentity: 'project-1', hasUnsavedChanges: false,
      machines: [activeMachine], posts: installed.library
    })).toBeNull();
    expect(applicableEmittedPauseEvidence(evidence, {
      sourceSignature: 'saved-source', projectIdentity: 'project-1', hasUnsavedChanges: false,
      machines: [{ ...activeMachine, bindings: activeMachine.bindings.map((binding) =>
        binding.id === bound.binding.id ? { ...binding, properties: { ...binding.properties, offsetIndex: 1 } } : binding) }],
      posts: installed.library
    })).toBeNull();
    expect(applicableEmittedPauseEvidence(evidence, {
      sourceSignature: 'saved-source', projectIdentity: 'project-1', hasUnsavedChanges: false,
      machines: [activeMachine], posts: { ...installed.library, installations:
        installed.library.installations.map((candidate) => ({ ...candidate,
          package: { ...candidate.package, manifest: { ...candidate.package.manifest,
            description: 'Changed package with stale reference' } } })) }
    })).toBeNull();
  });
});

async function installRobofilV2() {
  return (await installRobofilV2Package()).installation;
}

async function installRobofilV2Package() {
  const parsed = parseWireEdmPostPackage(JSON.stringify(packageJson));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  const installed = await installPostPackage(createEmptyPostLibrary(), parsed.package);
  if (!installed.ok) throw new Error(JSON.stringify(installed.error));
  return installed;
}

async function post(
  installation: Awaited<ReturnType<typeof installRobofilV2>>,
  document: ReturnType<typeof compensatedRectangle>
) {
  const compiled = compileWireEdmExecutionPlan(document);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = await runPost(compiled.plan, {
    installation,
    properties: { coordinatePrecision: 3, offsetIndex: 0 }
  });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

function compensatedRectangle(initialWirePosition = { x: 0, y: 0 }) {
  const source = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } }
  ]);
  source.geometryBasis = 'finished-contour';
  source.setup = {
    initialWirePosition: { kind: 'manual', point: initialWirePosition, review: 'reviewed' }
  };
  const document = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside');
  if (!document) throw new Error('Expected a closed compensated contour.');
  return document;
}

function compensatedTwoRectangles() {
  const source = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 10, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 10, y: 10 }, end: { x: 0, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 0, y: 10 }, end: { x: 0, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 30, y: 0 }, end: { x: 30, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 30, y: 10 }, end: { x: 20, y: 10 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 10 }, end: { x: 20, y: 0 } }
  ]);
  source.geometryBasis = 'finished-contour';
  source.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' }
  };
  let document = source;
  for (const operation of source.plan.operations) {
    const updated = setManualCompensationIntent(document, operation.id, 'outside');
    if (!updated) throw new Error('Expected two closed compensated contours.');
    document = updated;
  }
  document.plan.operations[1].threadingTransition = {
    mode: 'continuous',
    wireSeparation: 'already-separated',
    source: 'operation-override'
  };
  return document;
}

function memoryAdapter(): WorkbenchStorageAdapter {
  const files = new Map<string, string>();
  return {
    name: 'Robofil no-lead revision test',
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
