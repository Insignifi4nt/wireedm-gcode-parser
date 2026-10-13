import { describe, expect, it } from 'vitest';
import { cadBytesToBase64, cadSolidImportBytes, isCadSolidImportResult, MAX_CAD_IMPORT_BYTES, parseCadSolidImportSource } from '../cadImports';
import { cadFeatureDependencies, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';

describe('portable CAD import sources', () => {
  it('preserves exact STEP text and binary STL originals with explicit units', () => {
    const data = '\uFEFFISO-10303-21;\r\n/* 名称 */\r\nEND-ISO-10303-21;\r\n';
    const step = parseCadSolidImportSource({ format: 'step', fileName: 'Part.STP', encoding: 'utf8', data });
    expect(step.data).toBe(data);
    expect(cadSolidImportBytes(step)).toEqual(new TextEncoder().encode(data));
    const bytes = Uint8Array.from([0, 255, 254, 1, 31, 128, 3]);
    const stl = parseCadSolidImportSource({ format: 'stl', fileName: 'Part.stl', encoding: 'base64', data: cadBytesToBase64(bytes), units: 'inch' });
    expect(cadSolidImportBytes(stl)).toEqual(bytes);
    expect(Object.isFrozen(stl)).toBe(true);
    expect(() => parseCadSolidImportSource({ ...stl, units: undefined })).toThrow();
  });
  it('rejects malformed encoding, mismatched filenames and oversized UTF-8 before native code', () => {
    const source = { format: 'stl', fileName: 'part.stl', encoding: 'base64', data: 'AAAA', units: 'mm' };
    for (const data of ['A===', 'AAAA\n', 'AA', 'data:model/stl;base64,AAAA', 'AB==']) {
      expect(() => parseCadSolidImportSource({ ...source, data })).toThrow();
    }
    for (const fileName of ['part.step', '../part.stl', 'C:\\part.stl', 'part\u0000.stl']) expect(() => parseCadSolidImportSource({ ...source, fileName })).toThrow();
    expect(() => parseCadSolidImportSource({ format: 'step', fileName: 'part.step', encoding: 'utf8', data: '孔'.repeat(Math.floor(MAX_CAD_IMPORT_BYTES / 3) + 1) })).toThrow(/2 MiB/);
  });
  it('rejects inherited and changing source fields and malformed worker result bounds', () => {
    const source = { format: 'step', fileName: 'part.step', encoding: 'utf8', data: 'original' };
    expect(() => parseCadSolidImportSource(Object.create(source))).toThrow();
    expect(() => parseCadSolidImportSource({ ...source, get data() { return 'changed'; } })).toThrow();
    let reads = 0;
    expect(() => parseCadSolidImportSource({ ...source, get data() { reads++; return 'original'; } })).toThrow();
    expect(reads).toBe(0);
    const imported = { ...createCadDocument(), features: [{ id: 'source', name: 'Source', kind: 'imported', suppressed: false, source: { ...source, get data() { reads++; return 'original'; } } }] };
    expect(() => parseCadDocument(imported)).toThrow(); expect(reads).toBe(0);
    const result = { format: 'step', fileName: 'part.step', representation: 'exact-brep', volume: 12, solidCount: 1, sourceBytes: 8, bounds: { min: [0, 0, 0], max: [2, 2, 3] } };
    expect(isCadSolidImportResult(result)).toBe(true);
    expect(isCadSolidImportResult(Object.create(result))).toBe(false);
    expect(isCadSolidImportResult({ ...result, get volume() { throw new Error('Guard evaluated accessor'); } })).toBe(false);
    expect(isCadSolidImportResult({ ...result, bounds: { ...result.bounds, get min() { throw new Error('Guard evaluated coordinate accessor'); } } })).toBe(false);
    expect(isCadSolidImportResult({ ...result, representation: 'faceted-brep' })).toBe(false);
    expect(isCadSolidImportResult({ ...result, volume: Infinity })).toBe(false);
    expect(isCadSolidImportResult({ ...result, bounds: { min: [0, 0, 4], max: [2, 2, 3] } })).toBe(false);
    expect(isCadSolidImportResult({ ...result, bounds: { min: Array(3), max: [2, 2, 3] } })).toBe(false);
    const inheritedIterator = [0, 0, 0];
    Object.defineProperty(inheritedIterator, Symbol.iterator, { value: () => { throw new Error('Iterator was executed'); } });
    expect(isCadSolidImportResult({ ...result, bounds: { min: inheritedIterator, max: [2, 2, 3] } })).toBe(false);
  });
  it('treats imported bodies as independent history features and bounds aggregate originals', () => {
    const source = { format: 'step' as const, fileName: 'part.step', encoding: 'utf8' as const, data: 'original' };
    const feature = { id: 'imported', name: 'Part', suppressed: false, kind: 'imported' as const, source };
    const document = parseCadDocument({ ...createCadDocument(), features: [feature] });
    expect(cadFeatureDependencies(document.features[0])).toEqual([]);
    expect(cadVisibleBodyIds(document.features)).toEqual(['imported']);
    expect(document.features[0]).toEqual(feature);
    const large = { ...source, data: 'x'.repeat(MAX_CAD_IMPORT_BYTES) };
    expect(() => parseCadDocument({ ...document, features: [{ ...feature, source: large }, { ...feature, id: 'other', source: large }] })).toThrow(/4 MiB/);
    expect(() => parseCadDocument({ ...document, features: Array.from({ length: 256 }, (_, index) => ({ ...feature, id: `body_${index}`, source: large })) })).toThrow(/4 MiB/);
  });
});
