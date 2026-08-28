import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  exportPortableUpidProject,
  importPortableUpidProject
} from '../portableUpidProject';

describe('portable UPID project', () => {
  it('exports and imports a strict machine-neutral UPID through catalog transactions', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const dxf = await importDxfProject(initialized.workbench, {
      fileName: 'fixture.dxf',
      text: lineDxf(),
      unitCandidateId: 'millimeters',
      declaredUnitOverrideAcknowledged: false
    });
    if (!dxf.ok) throw new Error(dxf.error.message);

    const exported = await exportPortableUpidProject(dxf.workbench, dxf.project.id);
    if (!exported.ok) throw new Error(exported.error.message);
    const portable = JSON.parse(exported.file.text);
    expect(portable).toMatchObject({ format: 'upid', schemaVersion: 1 });
    expect(portable.document.source.projectId).toBeUndefined();
    expect(JSON.stringify(portable)).not.toMatch(/machine|postPackage|binding/);

    const imported = await importPortableUpidProject(dxf.workbench, {
      fileName: exported.file.fileName,
      text: exported.file.text,
      now: new Date('2026-08-28T10:00:00.000Z')
    });
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      source: { kind: 'upid', files: [{ kind: 'upid' }] },
      content: { kind: 'upid-document' }
    });
    expect('machine' in imported.project).toBe(false);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(exported.file.text);
  });

  it('rejects external projects and non-strict portable documents with typed errors', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const external = await importExternalProgram(initialized.workbench, {
      fileName: 'program.iso',
      text: 'G0 X0 Y0'
    });
    if (!external.ok) throw new Error(external.error.message);

    expect(await exportPortableUpidProject(external.workbench, external.project.id)).toMatchObject({
      ok: false,
      error: { code: 'PORTABLE_UPID_PROJECT_REQUIRED' }
    });
    expect(await importPortableUpidProject(external.workbench, {
      fileName: 'invalid.upid.json',
      text: JSON.stringify({ format: 'upid', schemaVersion: 1, document: {}, extra: true })
    })).toMatchObject({
      ok: false,
      error: { code: 'PORTABLE_UPID_SCHEMA_INVALID' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Portable UPID';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}

function lineDxf() {
  return [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4',
    '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'ENDSEC', '0', 'EOF'
  ].join('\n');
}
