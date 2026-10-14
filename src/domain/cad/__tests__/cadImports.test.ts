// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cadBytesToBase64, cadSolidImportBytes, isCadSolidImportResult, parseCadSolidImportSource } from '../cadImports';
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
  it('preserves exact sources above the former decoded byte cap while still rejecting malformed encoding and filenames', () => {
    const source = { format: 'stl', fileName: 'part.stl', encoding: 'base64', data: 'AAAA', units: 'mm' };
    for (const data of ['A===', 'AAAA\n', 'AA', 'data:model/stl;base64,AAAA', 'AB==', 'AAB=']) {
      expect(() => parseCadSolidImportSource({ ...source, data })).toThrow();
    }
    for (const fileName of ['part.step', '../part.stl', 'C:\\part.stl', 'part\u0000.stl']) expect(() => parseCadSolidImportSource({ ...source, fileName })).toThrow();
    const text = '\uFEFFISO-10303-21;\r\n/* ' + '孔😀'.repeat(320_000) + ' */\r\nEND-ISO-10303-21;\r\n';
    const step = parseCadSolidImportSource({ format: 'step', fileName: 'part.step', encoding: 'utf8', data: text });
    expect(step.data).toBe(text); expect(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(cadSolidImportBytes(step))).toBe(text);
    for (const data of ['\ud800', 'ok\udfff', '\ud800x']) expect(() => parseCadSolidImportSource({ ...step, data })).toThrow(/unpaired/);
    const bytes = new Uint8Array(2 * 1024 * 1024 + 17); bytes[0] = 255; bytes[bytes.length - 1] = 254;
    const stl = parseCadSolidImportSource({ ...source, data: cadBytesToBase64(bytes) });
    const decoded = cadSolidImportBytes(stl); expect(decoded.length).toBe(bytes.length); expect(decoded.every((value, index) => value === bytes[index])).toBe(true);
    for (const data of [stl.data + 'x', stl.data.slice(0, -1) + '!', stl.data.slice(0, 120_000) + '\n' + stl.data.slice(120_000)]) {
      expect(() => parseCadSolidImportSource({ ...stl, data })).toThrow(/base64/);
    }
  });
  it.each([24575, 24576, 24577])('keeps canonical base64 across the encoder chunk boundary for %i bytes', length => {
    const bytes = Uint8Array.from({ length }, (_, index) => index * 37 & 255), data = cadBytesToBase64(bytes);
    expect(data).toBe(Buffer.from(bytes).toString('base64'));
    const source = parseCadSolidImportSource({ format: 'stl', fileName: 'chunk.stl', encoding: 'base64', data, units: 'mm' });
    expect(cadSolidImportBytes(source).every((value, index) => value === bytes[index])).toBe(true);
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
    expect(isCadSolidImportResult({ ...result, solidCount: 257, sourceBytes: 2 * 1024 * 1024 + 1 })).toBe(true);
    for (const solidCount of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(isCadSolidImportResult({ ...result, solidCount })).toBe(false);
    for (const sourceBytes of [0, -1, 1.5, Infinity]) expect(isCadSolidImportResult({ ...result, sourceBytes })).toBe(false);
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
  it('treats imported bodies as independent history features and preserves aggregate originals above the former document byte cap', () => {
    const source = { format: 'step' as const, fileName: 'part.step', encoding: 'utf8' as const, data: 'original' };
    const feature = { id: 'imported', name: 'Part', suppressed: false, kind: 'imported' as const, source };
    const document = parseCadDocument({ ...createCadDocument(), features: [feature] });
    expect(cadFeatureDependencies(document.features[0])).toEqual([]);
    expect(cadVisibleBodyIds(document.features)).toEqual(['imported']);
    expect(document.features[0]).toEqual(feature);
    const large = { ...source, data: 'x'.repeat(2 * 1024 * 1024 + 1) };
    const accepted = parseCadDocument({ ...document, features: [{ ...feature, source: large }, { ...feature, id: 'other', source: large }] });
    expect(accepted.features).toEqual([{ ...feature, source: large }, { ...feature, id: 'other', source: large }]);
  });
});
