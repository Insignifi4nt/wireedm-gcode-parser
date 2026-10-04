import { expect, it } from 'vitest';
import { readGCodeInspectionFile, validateGCodeInspectionSource, GCODE_INSPECTION_MAX_BYTES } from '../gcodeInspectionSource';

it('preserves a UTF-8 BOM, original block numbering and line endings, and rejects lossy decoding', async () => {
  const original = '\uFEFF%\r\nN10 G21\r\nN20 M02\r\n';
  const bytes = new TextEncoder().encode(original);
  expect(await readGCodeInspectionFile({ size: bytes.length, arrayBuffer: async () => bytes.buffer })).toBe(original);
  const malformed = Uint8Array.of(71, 49, 32, 88, 49, 255);
  await expect(readGCodeInspectionFile({ size: malformed.length, arrayBuffer: async () => malformed.buffer })).rejects.toThrow('not valid UTF-8');
});

it('bounds inspection before file reading and rejects binary, empty and excessive line input', async () => {
  await expect(readGCodeInspectionFile({ size: GCODE_INSPECTION_MAX_BYTES + 1, arrayBuffer: async () => { throw new Error('Must not read'); } })).rejects.toThrow('2 MiB');
  expect(validateGCodeInspectionSource('G1\0 X2')).toContain('binary');
  expect(validateGCodeInspectionSource('  ')).toContain('Choose a program');
  expect(validateGCodeInspectionSource('G1\r'.repeat(50_001))).toContain('50,000');
});
