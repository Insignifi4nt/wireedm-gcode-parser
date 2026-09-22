import { describe, expect, it } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { importDxfProject } from '../importDxfProject';
import { parseDxf } from '../parseDxf';

function polyline(count: string | null, extraHeader: string[] = []) {
  return ['0', 'LWPOLYLINE', '8', 'CUT', '70', '1',
    ...(count === null ? [] : ['90', count]), ...extraHeader,
    '10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '10'];
}

function drawing(entities: string[]) {
  return ['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
}

describe('DXF lightweight-polyline vertex integrity', () => {
  it.each(['4', '2', '3.5', '0', '-1', 'invalid'])('rejects declared vertex count %s instead of inventing a closed three-vertex contour', (count) => {
    const parsed = parseDxf(drawing(polyline(count)));
    expect(parsed.entities).toEqual([]);
    expect(parsed.warnings).toContain('Rejected malformed DXF LWPOLYLINE geometry.');
  });

  it('rejects duplicate vertex-count declarations instead of choosing one silently', () => {
    const parsed = parseDxf(drawing(polyline('3', ['90', '4'])));
    expect(parsed.entities).toEqual([]);
    expect(parsed.warnings).toContain('Rejected malformed DXF LWPOLYLINE geometry.');
  });

  it.each(['3', null])('preserves complete geometry with vertex count %s', (count) => {
    const parsed = parseDxf(drawing(polyline(count)));
    expect(parsed.entities).toMatchObject([{ type: 'lwpolyline', closed: true, vertices: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }
    ] }]);
    expect(parsed.warnings).toEqual([]);
  });
});

describe.each(['cache', 'folder'] as const)('%s DXF polyline import', (kind) => {
  function storage() {
    return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('polyline-import') as unknown as FileSystemDirectoryHandle);
  }

  it('does not persist an incomplete closed contour as a valid project', async () => {
    const adapter = storage();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const files = await adapter.listFiles!();
    const before = await Promise.all(files.paths.map(path => adapter.readText(path)));
    const result = await importDxfProject(initialized.workbench, {
      fileName: 'incomplete-rectangle.dxf', text: drawing(polyline('4')),
      unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_GEOMETRY_REQUIRED' } });
    expect(await adapter.listFiles!()).toEqual(files);
    expect(await Promise.all(files.paths.map(path => adapter.readText(path)))).toEqual(before);
  });

  it('retains independent valid geometry, a visible rejection warning, and exact raw source bytes', async () => {
    const adapter = storage();
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const text = drawing([...polyline('4'),
      '0', 'LINE', '8', 'VALID', '10', '20', '20', '0', '11', '30', '21', '0']);
    const result = await importDxfProject(initialized.workbench, {
      fileName: 'mixed.dxf', text, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
    });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.pathDocument.segments).toHaveLength(1);
    expect(result.pathDocument.segments[0]).toMatchObject({
      kind: 'line', start: { x: 20, y: 0 }, end: { x: 30, y: 0 }
    });
    expect(result.parseResult.warnings).toContain('Rejected malformed DXF LWPOLYLINE geometry.');
    expect(result.pathDocument.source.importWarnings).toContain('Rejected malformed DXF LWPOLYLINE geometry.');
    expect(await adapter.readText(result.project.source.files[0].path)).toBe(text);
  });
});
