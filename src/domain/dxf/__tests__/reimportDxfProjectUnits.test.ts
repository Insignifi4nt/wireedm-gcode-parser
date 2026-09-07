import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { saveEditorProgram } from '@/domain/editor/saveEditorProgram';
import { setManualInitialWirePosition, setPathOperationProgramStops, setProjectThreadingDefault } from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';

import { importDxfProject } from '../importDxfProject';
import {
  commitDxfProjectReimport,
  prepareDxfProjectReimport
} from '../reimportDxfProjectUnits';

describe('DXF project unit re-import', () => {
  it('preserves saved machining intent for unchanged units and requires acknowledgement before replacing it', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const raw = `${lineDxf(4).replaceAll('\n', '\r\n')}\r\n`;
    const imported = await importDxfProject(initialized.workbench, {
      fileName: 'Matriță.dxf', text: raw, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
    });
    if (!imported.ok) throw new Error(imported.error.message);
    let draft = setManualInitialWirePosition(imported.pathDocument, { x: -2, y: -3 });
    if (!draft) throw new Error('Could not set initial wire position');
    draft = setProjectThreadingDefault(draft, { mode: 'manual', wireSeparation: 'manual-before-positioning' });
    if (!draft) throw new Error('Could not set threading');
    draft = setPathOperationProgramStops(draft, draft.plan.operations[0].id, [{
      id: 'inspect', enabled: true, placement: { kind: 'before-entry' }, reason: 'operator-check'
    }]);
    if (!draft) throw new Error('Could not set program stop');
    draft = setMachiningSpanParticipation(draft, {
      sourceSegmentId: draft.segments[0].id, range: { start: 0.5, end: 1 }, participation: 'inactive-reference'
    });
    if (!draft) throw new Error('Could not mark reference geometry');
    const saved = await saveEditorProgram(imported.workbench, {
      projectId: imported.project.id, draft: { model: 'upid-document', pathDocument: draft }
    });
    if (!saved.ok) throw new Error(saved.error.message);
    const prepared = await prepareDxfProjectReimport(saved.workbench, imported.project.id);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const before = new Map(adapter.files);
    const unchanged = await commitDxfProjectReimport(saved.workbench, prepared.preparation, {
      unitCandidateId: 'millimeters', confirmed: true, rebuildAcknowledged: false, declaredUnitOverrideAcknowledged: false
    });
    expect(unchanged).toMatchObject({ ok: true, mode: 'unchanged', pathDocument: draft });
    expect(adapter.files).toEqual(before);
    expect(await commitDxfProjectReimport(saved.workbench, prepared.preparation, {
      unitCandidateId: 'inches', confirmed: true, rebuildAcknowledged: false, declaredUnitOverrideAcknowledged: true
    })).toMatchObject({ ok: false, error: { code: 'DXF_REIMPORT_REBUILD_ACKNOWLEDGEMENT_REQUIRED' } });
    expect(adapter.files).toEqual(before);
    const rebuilt = await commitDxfProjectReimport(saved.workbench, prepared.preparation, {
      unitCandidateId: 'inches', confirmed: true, rebuildAcknowledged: true, declaredUnitOverrideAcknowledged: true
    });
    if (!rebuilt.ok) throw new Error(rebuilt.error.message);
    expect(rebuilt.pathDocument.segments[0].length).toBeCloseTo(25.4, 12);
    expect(rebuilt.pathDocument.setup).toBeUndefined();
    expect(rebuilt.pathDocument.machiningParticipation).toBeUndefined();
    expect(rebuilt.pathDocument.plan.operations[0].programStops).toBeUndefined();
    expect(rebuilt.project.savedRevisionIds).toEqual(saved.project.savedRevisionIds);
    expect(rebuilt.project.name).toBe('Matriță');
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(raw);
  });

  it('reads by project ID and atomically replaces the strict V2 UPID document', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importDxfProject(initialized.workbench, {
      fileName: 'fixture.dxf',
      text: lineDxf(4),
      unitCandidateId: 'millimeters',
      declaredUnitOverrideAcknowledged: false,
      now: new Date('2026-08-28T09:00:00.000Z')
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const prepared = await prepareDxfProjectReimport(imported.workbench, imported.project.id, {
      now: new Date('2026-08-28T10:00:00.000Z')
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    const rebuilt = await commitDxfProjectReimport(imported.workbench, prepared.preparation, {
      unitCandidateId: 'inches',
      confirmed: true,
      declaredUnitOverrideAcknowledged: true,
      rebuildAcknowledged: true
    });
    if (!rebuilt.ok) throw new Error(rebuilt.error.message);

    expect(rebuilt.mode).toBe('rebuilt');
    expect(rebuilt.pathDocument.segments[0]).toMatchObject({
      start: { x: 0, y: 0 },
      end: { x: 25.4, y: 0 }
    });
    expect(rebuilt.project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      updatedAt: '2026-08-28T10:00:00.000Z',
      source: imported.project.source
    });
    expect('machine' in rebuilt.project).toBe(false);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(lineDxf(4));
  });

  it('rejects changed raw source after review and does not replace the project', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const imported = await importDxfProject(initialized.workbench, {
      fileName: 'fixture.dxf',
      text: lineDxf(4),
      unitCandidateId: 'millimeters',
      declaredUnitOverrideAcknowledged: false
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const prepared = await prepareDxfProjectReimport(imported.workbench, imported.project.id);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const projectTextBefore = adapter.files.get(`projects/${imported.project.id}.json`);
    adapter.files.set(imported.project.source.files[0].path, `${lineDxf(4)}\n999`);

    expect(await commitDxfProjectReimport(imported.workbench, prepared.preparation, {
      unitCandidateId: 'inches',
      confirmed: true,
      declaredUnitOverrideAcknowledged: true,
      rebuildAcknowledged: true
    })).toMatchObject({
      ok: false,
      error: { code: 'DXF_REIMPORT_SOURCE_CHANGED' }
    });
    expect(adapter.files.get(`projects/${imported.project.id}.json`)).toBe(projectTextBefore);
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'DXF re-import';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}

function lineDxf(unitsCode: number) {
  return [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', String(unitsCode),
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
