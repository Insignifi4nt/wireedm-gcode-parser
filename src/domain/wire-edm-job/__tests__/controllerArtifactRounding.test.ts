import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { commitDxfProjectImport } from '@/domain/dxf/importDxfProject';
import { prepareDxfProjectImport } from '@/domain/dxf/prepareDxfProjectImport';
import { saveEditorProgram } from '@/domain/editor/saveEditorProgram';
import {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { generateControllerArtifact } from '../controllerArtifact';
import {
  createSavedWireEdmJobRevision,
  saveStoredWireEdmJobRevision
} from '../savedWireEdmJobRevision';

const ROBOFIL_PACKAGE = 'tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-package';
// An 8.0015 x 5 mm rectangle: its right edge is exactly half-way between two
// emitted millimetre thousandths, where the old fixed audit guard failed.
const HALF_WAY_DXF = 'tests/fixtures/dxf/half-way-rounding-8.0015.dxf';

describe('controller artifact rounding', () => {
  it('generates a half-way DXF coordinate through the saved revision path and keeps the 8.0014 control', async () => {
    const dxf = await readFile(resolve(process.cwd(), HALF_WAY_DXF), 'utf8');
    expect(dxf).toContain('8.0015');

    const halfWay = await generateFromImportedDxf('half-way-rounding-8.0015.dxf', dxf);
    expect(halfWay.lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^N\d+ G1 X8\.002 Y0\.000$/),
      expect.stringMatching(/^N\d+ G1 X8\.002 Y5\.000$/)
    ]));
    expect(halfWay.lines.join('\n')).not.toContain('8.001');

    const control = await generateFromImportedDxf('rounding-8.0014.dxf', dxf.replaceAll('8.0015', '8.0014'));
    expect(control.lines).toEqual(expect.arrayContaining([
      expect.stringMatching(/^N\d+ G1 X8\.001 Y0\.000$/),
      expect.stringMatching(/^N\d+ G1 X8\.001 Y5\.000$/)
    ]));
    // Only the emitted width differs; the rounding allowance changes no other byte.
    expect(halfWay.text.replaceAll('X8.002', 'X8.001')).toBe(control.text);
  });
});

async function generateFromImportedDxf(fileName: string, text: string) {
  const adapter = memoryAdapter();
  const initialized = await initializeWorkbenchCatalog(adapter, { now: new Date('2026-11-01T08:00:00.000Z') });
  if (!initialized.ok) throw new Error(initialized.error.message);

  const archive = new Uint8Array(await readFile(resolve(process.cwd(), ROBOFIL_PACKAGE)));
  const preparedPackage = await prepareStoredMachinePackageInstallation(initialized.workbench, archive);
  if (!preparedPackage.ok) throw new Error(preparedPackage.error.message);
  const installed = await commitStoredMachinePackageInstallation(preparedPackage.prepared, { kind: 'install-new' });
  if (!installed.ok) throw new Error(installed.error.message);

  const preparedDxf = prepareDxfProjectImport(installed.workbench, {
    fileName, text, now: new Date('2026-11-01T08:01:00.000Z')
  });
  if (!preparedDxf.ok) throw new Error(preparedDxf.error.message);
  const imported = await commitDxfProjectImport(installed.workbench, preparedDxf.preparation, {
    unitCandidateId: 'millimeters', confirmed: true, declaredUnitOverrideAcknowledged: false
  });
  if (!imported.ok) throw new Error(imported.error.message);

  const source = imported.pathDocument;
  expect(source.geometryBasis).toBe('finished-contour');
  const compensated = setManualCompensationIntent(source, source.plan.operations[0].id, 'outside');
  if (!compensated) throw new Error('Expected one closed contour.');
  const edited = {
    ...compensated,
    setup: { initialWirePosition: { kind: 'manual' as const, point: { x: -5, y: 0 }, review: 'reviewed' as const } }
  };
  const saved = await saveEditorProgram(imported.workbench, {
    projectId: imported.project.id,
    draft: { model: 'upid-document', pathDocument: edited },
    now: new Date('2026-11-01T08:02:00.000Z')
  });
  if (!saved.ok) throw new Error(saved.error.message);

  const machine = saved.workbench.machines.machines[0];
  if (!machine.activeBindingId) throw new Error('Expected the installed package to activate a machine setup.');
  const candidate = await createSavedWireEdmJobRevision({
    revisionId: `${saved.project.id}.0001`,
    savedAt: '2026-11-01T08:03:00.000Z',
    project: saved.project,
    machine,
    bindingId: machine.activeBindingId,
    postLibrary: saved.workbench.posts
  });
  if (!candidate.ok) throw new Error(candidate.error.message);
  const revision = await saveStoredWireEdmJobRevision(saved.workbench, candidate.candidate, {
    requireCurrentActiveSetup: true,
    reuseMatchingRevision: true
  });
  if (!revision.ok) throw new Error(revision.error.message);

  const artifact = await generateControllerArtifact(revision.revision);
  if (!artifact.ok) throw new Error(`${artifact.error.code}: ${artifact.error.message}`);
  return { text: artifact.artifact.text, lines: artifact.artifact.text.split('\r\n') };
}

function memoryAdapter(): WorkbenchStorageAdapter {
  const files = new Map<string, string>();
  return {
    name: 'Controller artifact rounding',
    kind: 'memory',
    ensureDirectory: async () => undefined,
    readText: async (path) => files.get(path) ?? null,
    deleteText: async (path) => { files.delete(path); },
    writeText: async (path, contents) => { files.set(path, contents); }
  };
}
