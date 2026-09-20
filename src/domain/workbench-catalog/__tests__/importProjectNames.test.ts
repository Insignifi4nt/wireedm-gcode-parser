import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { importPortableUpidProject } from '@/domain/upid/portableUpidProject';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '../workbenchCatalog';
import { createWorkbenchProjectDocument, parseWorkbenchProjectDocument } from '../workbenchProject';

const imports = [
  { kind: 'DXF', run: (workbench: ConnectedWorkbenchCatalog, name: string) => importDxfProject(workbench, {
    fileName: `${name}.dxf`,
    text: ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', 'CUT',
      '10', '0', '20', '0', '11', '1', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n'),
    unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
  }) },
  { kind: 'UPID', run: (workbench: ConnectedWorkbenchCatalog, name: string) => importPortableUpidProject(workbench, {
    fileName: `${name}.upid.json`,
    text: JSON.stringify({ format: 'upid', schemaVersion: 1, document: createUpidFromDxfEntities([]) })
  }) },
  { kind: 'external G-code', run: (workbench: ConnectedWorkbenchCatalog, name: string) => importExternalProgram(workbench, {
    fileName: `${name}.iso`, text: 'G1 X1 Y1'
  }) }
];

describe.each(imports)('$kind import names', ({ run }) => {
  it.each(['cache', 'folder'] as const)('imports numeric and truncated filename identities into %s storage without changing the source name', async (kind) => {
    const adapter = kind === 'cache'
      ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('import-identities') as unknown as FileSystemDirectoryHandle);
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    let workbench = initialized.workbench;
    for (const name of ['12345', '日本 2026', `${'a'.repeat(59)}-tail`, '12345']) {
      const result = await run(workbench, name);
      if (!result.ok) throw new Error(`${name}: ${result.error.message}`);
      expect(result.project.id).toMatch(/^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/);
      expect(result.project.id.length).toBeLessThanOrEqual(80);
      expect(workbench.manifest.projects.some(({ id }) => id === result.project.id)).toBe(false);
      expect(result.project.name).toBe(name);
      expect(result.project.source.files[0].name).toContain(name);
      expect(await adapter.readText(result.project.source.files[0].path)).not.toBeNull();
      workbench = result.workbench;
    }
    expect((await initializeWorkbenchCatalog(adapter)).ok).toBe(true);
    expect(workbench.manifest.projects).toHaveLength(4);
  });

  it.each(['part\nsecond', 'part\u0000', 'part\u0085', 'part\u2028second', 'x'.repeat(161)])(
    'rejects invalid names without changing any persisted files: %j', async (name) => {
      const adapter = new MemoryAdapter();
      const initialized = await initializeWorkbenchCatalog(adapter);
      if (!initialized.ok) throw new Error(initialized.error.message);
      const before = new Map(adapter.files);
      expect(await run(initialized.workbench, name)).toMatchObject({
        ok: false, error: { code: 'WORKBENCH_PROJECT_SCHEMA_INVALID' }
      });
      expect(adapter.files).toEqual(before);
    }
  );

  it('trims filename-derived names while preserving Unicode and source filenames', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const result = await run(initialized.workbench, '  Matriță 日本 🔩  ');
    if (!result.ok) throw new Error(result.error.message);
    expect(result.project.name).toBe('Matriță 日本 🔩');
    expect(result.workbench.manifest.projects[0].name).toBe(result.project.name);
    expect(result.project.source.files[0].name).toContain('  Matriță 日本 🔩  ');
  });
});

describe('project document naming boundary', () => {
  const input = {
    id: 'part', name: 'Part', source: { kind: 'upid', files: [] },
    content: { kind: 'upid-document', document: createUpidFromDxfEntities([]) }
  } as const;

  it.each(['   ', '\tPart', 'Part\n', 'part\u007f'])('rejects invalid create and parsed names: %j', (name) => {
    expect(createWorkbenchProjectDocument({ ...input, name })).toMatchObject({ ok: false });
    const created = createWorkbenchProjectDocument(input);
    if (!created.ok) throw new Error(created.error.message);
    expect(parseWorkbenchProjectDocument(JSON.stringify({ ...created.project, name }))).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_PROJECT_SCHEMA_INVALID', path: '/name' }
    });
  });

  it('normalizes valid creation names and returns a typed invalid-date error', () => {
    expect(createWorkbenchProjectDocument({ ...input, name: '  Part  ' })).toMatchObject({
      ok: true, project: { name: 'Part' }
    });
    expect(createWorkbenchProjectDocument({ ...input, now: new Date(NaN) })).toMatchObject({
      ok: false, error: { code: 'WORKBENCH_PROJECT_TIMESTAMP_INVALID', path: '/createdAt' }
    });
  });
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly name = 'Import names';
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
