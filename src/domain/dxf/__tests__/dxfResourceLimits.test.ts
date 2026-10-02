import { describe, expect, it } from 'vitest';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { approximateSpline, type DxfSplineDefinition } from '../approximateSpline';
import { assertDxfFileSize, DXF_RESOURCE_LIMITS, DxfResourceBudget, DxfResourceLimitError } from '../dxfResourceLimits';
import { importDxfProject } from '../importDxfProject';
import { parseDxf } from '../parseDxf';
import { prepareDxfProjectImport } from '../prepareDxfProjectImport';

describe('bounded DXF parsing', () => {
  it.each(['32767', '9007199254740992', '1e999'])('rejects a compact huge INSERT count %s without partial geometry', (count) => {
    expectResourceLimit(() => parseDxf(drawing(line + insert('B', count), block('B', line))), 'insertInstances');
  });

  it('checks the product of both array dimensions before expanding an empty block', () => {
    expectResourceLimit(() => parseDxf(drawing(insert('B', '1000', '1000'), block('B', ''))), 'insertInstances');
  });

  it('checks aggregate geometry for nested arrays before allocating the outer copies', () => {
    const blocks = block('BASE', line) + block('ARRAY', insert('BASE', '100', '100'));
    expectResourceLimit(() => parseDxf(drawing(insert('ARRAY', '2'), blocks)), 'entities');
  });

  it('bounds multiplied polyline vertices as well as entity count', () => {
    const vertices = Array.from({ length: 1000 }, (_, index) => `10\n${index}\n20\n${index % 2}\n`).join('');
    const polyline = `0\nLWPOLYLINE\n90\n1000\n70\n0\n${vertices}`;
    expectResourceLimit(() => parseDxf(drawing(insert('B', '101'), block('B', polyline))), 'geometryPoints');
  });

  it.each([false, true])('bounds nesting even when inner blocks have already been cached (%s)', (cached) => {
    const count = DXF_RESOURCE_LIMITS.insertDepth + 1;
    const blocks = block('B0', line) + Array.from({ length: count }, (_, index) =>
      block(`B${index + 1}`, insert(`B${index}`))).join('');
    const entities = cached
      ? Array.from({ length: count + 1 }, (_, index) => insert(`B${index}`)).join('')
      : insert(`B${count}`);
    expectResourceLimit(() => parseDxf(drawing(entities, blocks)), 'insertDepth');
  });

  it('bounds repeated direct entities and diagnostic-only source content', () => {
    expectResourceLimit(() => parseDxf(drawing(line.repeat(DXF_RESOURCE_LIMITS.entities + 1))), 'entities');
    const unsupported = Array.from({ length: DXF_RESOURCE_LIMITS.warnings + 1 }, (_, index) => `0\nUNKNOWN_${index}\n`).join('');
    expectResourceLimit(() => parseDxf(drawing(unsupported)), 'warnings');
  });

  it('bounds repeated delimiter searches in malformed block and polyline sections', () => {
    const blocks = Array.from({ length: 6000 }, (_, index) => `0\nBLOCK\n2\nB${index}\n`).join('');
    expectResourceLimit(() => parseDxf(drawing(line, blocks)), 'sourceWork');
    expectResourceLimit(() => parseDxf(drawing('0\nPOLYLINE\n70\n0\n'.repeat(6000))), 'sourceWork');
  });

  it('rejects oversized files, direct text, and excessive pairs before parsing', () => {
    expectResourceLimit(() => assertDxfFileSize(DXF_RESOURCE_LIMITS.inputBytes + 1), 'inputBytes');
    expectResourceLimit(() => parseDxf(' '.repeat(DXF_RESOURCE_LIMITS.inputBytes + 1)), 'inputBytes');
    expectResourceLimit(() => parseDxf('0\n'.repeat(DXF_RESOURCE_LIMITS.pairs * 2 + 2)), 'pairs');
    // Direct browser-agent text must use the same UTF-8 byte budget as a local file.
    expectResourceLimit(() => parseDxf('日'.repeat(Math.floor(DXF_RESOURCE_LIMITS.inputBytes / 3) + 1)), 'inputBytes');
  });

  it('retains valid array geometry and provenance below the budgets', () => {
    const result = parseDxf(drawing(insert('B', '100', '100'), block('B', line)));
    expect(result.entities).toHaveLength(10_000);
    expect(result.warnings).toEqual([]);
    expect(result.entities.at(-1)).toMatchObject({
      type: 'line', start: { x: 198, y: 198 }, end: { x: 199, y: 198 },
      source: { insertChain: [{ blockName: 'B', row: 99, column: 99 }] }
    });
  });

  it('rejects a compact array with a one-MiB layer before expanding or serializing it', () => {
    const largeLayerLine = line + `8\n${'L'.repeat(1024 * 1024)}\n`;
    expectResourceLimit(() => parseDxf(drawing(insert('B', '1000'), block('B', largeLayerLine))), 'metadataCharacters');
  });

  it('bounds repeated allowed-length layers and handles across expanded entities', () => {
    const annotatedLine = line + `8\n${'L'.repeat(2048)}\n5\n${'A'.repeat(2048)}\n`;
    expectResourceLimit(() => parseDxf(drawing(insert('B', '3000'), block('B', annotatedLine))), 'expandedDataBytes');
  });

  it('counts repeated long block names at every level of INSERT provenance', () => {
    const names = Array.from({ length: 7 }, (_, index) => `${'B'.repeat(4000)}${index}`);
    const blocks = block(names[0], line) + names.slice(1).map((name, index) => block(name, insert(names[index]))).join('');
    expectResourceLimit(() => parseDxf(drawing(insert(names.at(-1)!, '512'), blocks)), 'expandedDataBytes');
  });

  it('counts shared objects and strings every time they occur in serialized warnings', () => {
    const warning = { message: 'W'.repeat(4096) };
    expectResourceLimit(() => new DxfResourceBudget().reserveExpandedData({
      warnings: Array(3000).fill(warning)
    }), 'expandedDataBytes');
  });

  it.each(['geometry', 'metadata'] as const)('returns a typed preparation failure and performs no storage writes for rejected %s', async (kind) => {
    const files = new Map<string, string>();
    const adapter: WorkbenchStorageAdapter = {
      name: 'DXF budgets', kind: 'memory', ensureDirectory: async () => undefined,
      readText: async (path) => files.get(path) ?? null,
      writeText: async (path, contents) => { files.set(path, contents); },
      deleteText: async (path) => { files.delete(path); }
    };
    const initialized = await initializeWorkbenchCatalog(adapter);
    if (!initialized.ok) throw new Error(initialized.error.message);
    const before = new Map(files);
    const text = kind === 'geometry'
      ? drawing(line + insert('B', '1000', '1000'), block('B', line))
      : drawing(line + insert('B', '1000'), block('B', line + `8\n${'L'.repeat(1024 * 1024)}\n`));
    expect(prepareDxfProjectImport(initialized.workbench, { fileName: 'large.dxf', text })).toMatchObject({
      ok: false, error: { code: 'DXF_IMPORT_RESOURCE_LIMIT', message: expect.stringContaining('No geometry was imported') }
    });
    expect(await importDxfProject(initialized.workbench, {
      fileName: 'large.dxf', text, unitCandidateId: 'millimeters', declaredUnitOverrideAcknowledged: false
    })).toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_RESOURCE_LIMIT' } });
    expect(files).toEqual(before);
  });
});

describe('bounded spline approximation', () => {
  it('bounds degree before expensive Bézier subdivision', () => {
    const definition = splineDefinition(18, 17);
    expectResourceLimit(() => approximateSpline(definition, { maxChordError: 0.001 }), 'splineDegree');
    expectResourceLimit(() => parseDxf(drawing(line + splineEntity(definition))), 'splineDegree');
  });

  it('bounds control point count and aggregate knot insertion work', () => {
    expectResourceLimit(() => approximateSpline(splineDefinition(4097, 3), { maxChordError: 0.001 }), 'splineControlPoints');
    expectResourceLimit(() => parseDxf(drawing(splineEntity(splineDefinition(1200, 3)))), 'splineWork');
  });

  it('aborts adaptive subdivision rather than returning a truncated or unsupported spline', () => {
    const definition = splineDefinition(3, 2);
    expectResourceLimit(() => parseDxf(drawing(line + splineEntity(definition)), { curveChordError: 1e-12 }), 'splinePoints');
  });

  it('rejects the entire drawing when spline subdivision reaches its depth limit', () => {
    const definition = splineDefinition(3, 2);
    expectResourceLimit(() => parseDxf(drawing(line + splineEntity(definition)), { curveChordError: 1e-30 }), 'splineDepth');
  });

  it('shares the spline work budget across individually acceptable curves', () => {
    const definition = splineDefinition(100, 3);
    definition.controlPoints = definition.controlPoints.map(({ x }) => ({ x, y: 0 }));
    const entity = splineEntity(definition);
    expect(parseDxf(drawing(entity)).entities.length).toBeGreaterThan(1);
    expectResourceLimit(() => parseDxf(drawing(entity.repeat(100))), 'splineWork');
  });
});

function expectResourceLimit(action: () => unknown, resource: DxfResourceLimitError['resource']) {
  expect(action).toThrow(expect.objectContaining({ name: 'DxfResourceLimitError', resource, code: 'DXF_IMPORT_RESOURCE_LIMIT' }));
}

const line = '0\nLINE\n10\n0\n20\n0\n11\n1\n21\n0\n';
function block(name: string, entities: string) { return `0\nBLOCK\n2\n${name}\n10\n0\n20\n0\n${entities}0\nENDBLK\n`; }
function insert(name: string, columns = '1', rows = '1') {
  return `0\nINSERT\n2\n${name}\n70\n${columns}\n71\n${rows}\n44\n2\n45\n2\n`;
}
function drawing(entities: string, blocks = '') {
  return `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}
function splineDefinition(count: number, degree: number): DxfSplineDefinition {
  return {
    flags: 8, degree,
    controlPoints: Array.from({ length: count }, (_, index) => ({ x: index, y: index % 2 })),
    knots: [
      ...Array<number>(degree + 1).fill(0),
      ...Array.from({ length: count - degree - 1 }, (_, index) => index + 1),
      ...Array<number>(degree + 1).fill(count - degree)
    ]
  };
}
function splineEntity(definition: DxfSplineDefinition) {
  return `0\nSPLINE\n70\n8\n71\n${definition.degree}\n72\n${definition.knots.length}\n73\n${definition.controlPoints.length}\n` +
    definition.knots.map((knot) => `40\n${knot}\n`).join('') +
    definition.controlPoints.map(({ x, y }) => `10\n${x}\n20\n${y}\n`).join('');
}
