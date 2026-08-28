import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import {
  createMachinePostBinding,
  parseMachineDefinition
} from '@/domain/machine-definition/machineDefinition';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createWorkbenchProjectDocument } from '@/domain/workbench-catalog/workbenchProject';
import { generateControllerArtifact } from '@/domain/wire-edm-job/controllerArtifact';
import {
  createSavedWireEdmJobRevision,
  persistSavedWireEdmJobRevision
} from '@/domain/wire-edm-job/savedWireEdmJobRevision';

import packageJson from '../../../../examples/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';
import machineJson from '../../../../examples/robofil-100-v2/cristian-robofil-100.wireedm-machine.json';
import { runPost } from '../postEngine';
import { createEmptyPostLibrary, installPostPackage } from '../postLibrary';
import { parseWireEdmPostPackage } from '../postPackage';

describe('standalone Robofil 100 V2 package', () => {
  it('ships an unbound physical machine candidate that requires explicit selection', () => {
    expect(parseMachineDefinition(JSON.stringify(machineJson))).toMatchObject({
      ok: true,
      machine: {
        id: 'cristian.robofil-100',
        bindings: []
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
      'G60',
      'G38',
      'G90',
      'G39',
      'G40',
      'G41 D0',
      'G1 X10.000 Y0.000',
      'G1 X10.000 Y10.000',
      'G1 X0.000 Y10.000',
      'G1 X0.000 Y0.000',
      'G39',
      'G40',
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

    const project = createWorkbenchProjectDocument({
      id: 'robofil.no-lead-test',
      name: 'Robofil no-lead test',
      source: { kind: 'dxf', files: [] },
      content: { kind: 'upid-document', document: compensatedRectangle() },
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

    const generated = await generateControllerArtifact(persisted.revision, {
      status: 'configured',
      fileExtension: { kind: 'standard', extension: 'iso' },
      lineEnding: 'crlf'
    });
    if (!generated.ok) throw new Error(generated.error.message);

    expect(generated.artifact.fileName).toBe('robofil.no-lead-test.iso');
    expect(generated.artifact.text).toBe([
      'G92 X0.000 Y0.000',
      'G60',
      'G38',
      'G90',
      'G39',
      'G40',
      'G41 D0',
      'G1 X10.000 Y0.000',
      'G1 X10.000 Y10.000',
      'G1 X0.000 Y10.000',
      'G1 X0.000 Y0.000',
      'G39',
      'G40',
      'M02'
    ].join('\r\n'));
    expect(new TextEncoder().encode(generated.artifact.text).byteLength).toBeGreaterThan(0);
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
