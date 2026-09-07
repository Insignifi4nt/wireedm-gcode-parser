import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';

import { commitDxfProjectImport, importDxfProject } from '../importDxfProject';
import { prepareDxfProjectImport, previewDxfProjectImport } from '../prepareDxfProjectImport';

describe('DXF project import', () => {
  it('reviews duplicate cleanup and retains layer provenance and original source bytes', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const entity = ['0', 'LINE', '8', 'Matriță 日本', '10', '0', '20', '0', '11', '10', '21', '0'];
    const text = ['0', 'SECTION', '2', 'ENTITIES', ...entity, ...entity,
      '0', 'LINE', '67', '1', '8', 'BORDER', '10', '0', '20', '0', '11', '500', '21', '500',
      '0', 'TEXT', '8', 'NOTES', '1', 'Operator note', '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
    const prepared = prepareDxfProjectImport(initialized.workbench, { fileName: 'layers.dxf', text });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const preview = previewDxfProjectImport(prepared.preparation, { unitCandidateId: 'millimeters' });
    if (!preview.ok) throw new Error(preview.error.message);
    expect(preview.preview.segmentCount).toBe(1);
    expect(preview.preview.geometryWarnings).toHaveLength(1);
    expect(prepared.preparation.parseResult.unsupportedEntities).toEqual(['TEXT']);
    expect(prepared.preparation.parseResult.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Skipped paper-space DXF LINE')
    ]));
    const imported = await commitDxfProjectImport(initialized.workbench, prepared.preparation, {
      unitCandidateId: 'millimeters', confirmed: true, declaredUnitOverrideAcknowledged: false
    });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.pathDocument.segments).toHaveLength(preview.preview.segmentCount);
    expect(imported.pathDocument.segments[0]).toMatchObject({
      layer: 'Matriță 日本', source: { layer: 'Matriță 日本' }, length: 10
    });
    expect(imported.pathDocument.segments[0].bounds).toEqual(preview.preview.boundsMm);
    expect(imported.pathDocument.diagnostics.map(({ message }) => message)).toEqual(expect.arrayContaining([...preview.preview.geometryWarnings]));
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(text);
  });

  it('commits the reviewed DXF and a strict machine-neutral V2 project atomically', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter, {
      now: new Date('2026-08-28T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    const prepared = prepareDxfProjectImport(initialized.workbench, {
      fileName: 'fixture.dxf',
      text: lineDxf(4),
      now: new Date('2026-08-28T09:00:00.000Z')
    });
    if (!prepared.ok) throw new Error(prepared.error.message);

    const imported = await commitDxfProjectImport(initialized.workbench, prepared.preparation, {
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    });
    if (!imported.ok) throw new Error(imported.error.message);

    expect(imported.project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      source: { kind: 'dxf', files: [{ kind: 'dxf' }] },
      content: { kind: 'upid-document' }
    });
    expect('machine' in imported.project).toBe(false);
    expect('post' in imported.project).toBe(false);
    expect(imported.pathDocument.source.appliedUnits).toMatchObject({
      label: 'millimeters',
      scaleToMillimeters: 1,
      basis: 'dxf-declared',
      confirmed: true
    });
    expect(await readStoredWorkbenchProject(
      imported.workbench,
      imported.project.id
    )).toEqual({ ok: true, project: imported.project });
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(lineDxf(4));
  });

  it('rejects an unacknowledged declared-unit override without mutating the catalog', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const prepared = prepareDxfProjectImport(initialized.workbench, {
      fileName: 'inch-part.dxf',
      text: lineDxf(1)
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    const manifestBefore = adapter.files.get('workbench.json');

    expect(await commitDxfProjectImport(initialized.workbench, prepared.preparation, {
      unitCandidateId: 'millimeters',
      confirmed: true,
      declaredUnitOverrideAcknowledged: false
    })).toMatchObject({
      ok: false,
      error: { code: 'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED' }
    });
    expect(adapter.files.get('workbench.json')).toBe(manifestBefore);
    expect([...adapter.files.keys()].filter((path) => path.startsWith('projects/'))).toEqual([]);
  });

  it('requires an explicit unit selection in the one-step import', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);

    expect(await importDxfProject(initialized.workbench, {
      fileName: 'unitless.dxf',
      text: lineDxf(0),
      unitCandidateId: 'inches',
      declaredUnitOverrideAcknowledged: false,
      now: new Date('2026-08-28T09:00:00.000Z')
    })).toMatchObject({
      ok: true,
      project: {
        content: {
          document: {
            source: {
              appliedUnits: {
                scaleToMillimeters: 25.4,
                basis: 'user-confirmed'
              }
            }
          }
        }
      }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'DXF import';
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
