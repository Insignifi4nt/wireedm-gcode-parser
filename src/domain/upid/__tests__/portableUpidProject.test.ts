import { describe, expect, it } from 'vitest';

import { importDxfProject } from '@/domain/dxf/importDxfProject';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { validateUpidDocument } from '../validateUpidDocument';
import { portableUpidIntentFixture } from './portableUpidIntentFixture';

import {
  exportPortableUpidProject,
  importPortableUpidProject,
  MAX_PORTABLE_UPID_BYTES,
  parsePortableUpid
} from '../portableUpidProject';

describe('portable UPID project', () => {
  it('keeps v1 vocabulary frozen and accepts extended stop intent only as v2', () => {
    const document = portableUpidIntentFixture();
    document.plan.operations[0].programStops = [{ id: 'thread-stop', enabled: true,
      reason: 'manual', placement: { kind: 'after-positioning' } }];
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 1, document })))
      .toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID' } });
    document.schemaVersion = 2;
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 2, document })))
      .toMatchObject({ ok: true, document: { schemaVersion: 2 } });
  });
  it('parses portable UPID without storage and returns independent document snapshots', () => {
    const document = portableUpidIntentFixture();
    const text = JSON.stringify({ format: 'upid', schemaVersion: 1, document });
    const first = parsePortableUpid(text);
    const second = parsePortableUpid(text);
    if (!first.ok || !second.ok) throw new Error('Valid portable document was rejected.');
    expect(first.document).toEqual(document);
    first.document.segments[0].source.note = 'edited by caller';
    expect(second.document).toEqual(document);
    expect(first.document.source.projectId).toBe('original-workbench-project');
  });

  it('returns a typed document error for a path element with missing required fields', () => {
    const document = portableUpidIntentFixture();
    Reflect.set(document.pathElements, '0', {});
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 1, document })))
      .toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID' } });
  });

  it.each([
    ['not JSON', 'PORTABLE_UPID_JSON_INVALID'],
    ['null', 'PORTABLE_UPID_SCHEMA_INVALID'],
    [JSON.stringify({ format: 'upid', schemaVersion: 3, document: {} }), 'PORTABLE_UPID_VERSION_UNSUPPORTED'],
    [JSON.stringify({ format: 'upid', schemaVersion: 1.5, document: {} }), 'PORTABLE_UPID_SCHEMA_INVALID'],
    [JSON.stringify({ format: 'upid', schemaVersion: 0, document: {} }), 'PORTABLE_UPID_SCHEMA_INVALID'],
    [JSON.stringify({ format: 'upid', schemaVersion: '1', document: {} }), 'PORTABLE_UPID_SCHEMA_INVALID'],
    [JSON.stringify({ format: 'upid', schemaVersion: 1, document: {} }), 'PORTABLE_UPID_DOCUMENT_INVALID']
  ])('returns a typed error for invalid portable input %#', (text, code) => {
    expect(parsePortableUpid(text)).toMatchObject({ ok: false, error: { code } });
  });

  it('rejects oversized UTF-8 input before parsing or writing any files', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const before = new Map(adapter.files);
    const text = 'é'.repeat(MAX_PORTABLE_UPID_BYTES / 2 + 1);
    expect(text.length).toBeLessThan(MAX_PORTABLE_UPID_BYTES);
    expect(await importPortableUpidProject(initialized.workbench, {
      fileName: 'oversized.upid.json', text
    })).toEqual({ ok: false, error: {
      code: 'PORTABLE_UPID_TOO_LARGE',
      message: `Portable UPID is ${MAX_PORTABLE_UPID_BYTES + 2} UTF-8 bytes; the maximum is ${MAX_PORTABLE_UPID_BYTES}.`,
      actualBytes: MAX_PORTABLE_UPID_BYTES + 2,
      maximumBytes: MAX_PORTABLE_UPID_BYTES
    } });
    expect(adapter.files).toEqual(before);
  });

  it.each([
    ['operation display name', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.plan.operations[0], 'displayName', { machine: 'hidden payload' })],
    ['contour label', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.contours[0], 'label', { machine: 'hidden payload' })],
    ['segment note', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.segments[0].source, 'note', { machine: 'hidden payload' })],
    ['null optional setup', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document, 'setup', null)],
    ['null optional program stops', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.plan.operations[0], 'programStops', null)],
    ['source handle', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.segments[0].source, 'sourceEntityHandle', ['invalid handle'])],
    ['provenance types', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.contours[0].provenance, 'sourceEntityTypes', [{ machine: 'hidden payload' }])],
    ['provenance layers', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.plan.operations[0].provenance, 'layers', [{ machine: 'hidden payload' }])],
    ['provenance handles', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.pathElements[0].provenance, 'sourceEntityHandles', [123])],
    ['provenance exact flag', (document: ReturnType<typeof portableUpidIntentFixture>) => Reflect.set(document.contours[0].provenance, 'exact', 'yes')]
  ])('rejects malformed %s metadata before writing files', async (_name, mutate) => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const document = portableUpidIntentFixture();
    mutate(document);
    const before = new Map(adapter.files);
    expect(await importPortableUpidProject(initialized.workbench, {
      fileName: 'metadata.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: 1, document })
    })).toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_SCHEMA_INVALID' } });
    expect(adapter.files).toEqual(before);
  });

  it('preserves original source bytes and round-trips complete reviewed machining intent', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const document = portableUpidIntentFixture();
    expect(validateUpidDocument(document).structuralDiagnostics).toEqual([]);
    const text = `${JSON.stringify({ format: 'upid', schemaVersion: 1, document }, null, 4).replaceAll('\n', '\r\n')}\r\n`;
    const imported = await importPortableUpidProject(initialized.workbench, { fileName: 'Matriță.upid.json', text });
    if (!imported.ok) throw new Error(imported.error.message);
    const detached = structuredClone(document);
    delete detached.source.projectId;
    expect(imported.pathDocument).toEqual(detached);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(text);
    const reopened = await initializeWorkbenchCatalog(adapter);
    if (!reopened.ok) throw new Error(reopened.error.message);
    const exported = await exportPortableUpidProject(reopened.workbench, imported.project.id);
    if (!exported.ok) throw new Error(exported.error.message);
    expect(JSON.parse(exported.file.text).document).toEqual(detached);
    expect(adapter.files.get(imported.project.source.files[0].path)).toBe(text);
    const reimported = await importPortableUpidProject(reopened.workbench, { fileName: exported.file.fileName, text: exported.file.text });
    if (!reimported.ok) throw new Error(reimported.error.message);
    expect(reimported.pathDocument).toEqual(detached);
    expect(reimported.project.id).not.toBe(imported.project.id);
  });

  it('accepts explicitly nullable layer provenance and contour fields', () => {
    const document = portableUpidIntentFixture();
    document.segments[0].layer = null;
    document.segments[0].source.layer = null;
    for (const item of [...document.contours, ...document.plan.operations, ...document.pathElements]) item.provenance.layers = [null];
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: 1, document }))).toMatchObject({ ok: true });
  });

  it('rejects broken machining references before writing any source or project files', async () => {
    const adapter = new MemoryAdapter();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const document = portableUpidIntentFixture();
    if (!document.machiningParticipation) throw new Error('Fixture has no partial machining intent.');
    document.machiningParticipation.spans[0].sourceSegmentId = 'missing-source-segment';
    const before = new Map(adapter.files);
    expect(await importPortableUpidProject(initialized.workbench, {
      fileName: 'broken.upid.json', text: JSON.stringify({ format: 'upid', schemaVersion: 1, document })
    })).toMatchObject({ ok: false, error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID' } });
    expect(adapter.files).toEqual(before);
  });

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
