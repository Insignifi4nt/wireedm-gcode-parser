// @vitest-environment node
import { expect, it } from 'vitest';
import { importCadDxfCurve, type CadDxfCurveImportInput } from '../cadCurveDxf';
import { resolveCadCurve } from '../cadCurve';

it.each(['lwpolyline', 'polyline'] as const)('imports every edge of a complete large %s as an exact Curve with original source and units', kind => {
  const count = 131072, units = kind === 'polyline' ? 'inch' : 'mm', scale = units === 'inch' ? 25.4 : 1;
  const vertices = Array.from({ length: count + 1 }, (_, index) => `${kind === 'polyline' ? '0\nVERTEX\n' : ''}10\n${index}\n20\n0\n`).join('');
  const entity = kind === 'polyline' ? `0\nPOLYLINE\n66\n1\n70\n0\n${vertices}0\nSEQEND\n`
    : `0\nLWPOLYLINE\n90\n${count + 1}\n70\n0\n${vertices}`;
  const text = `0\nSECTION\n2\nENTITIES\n${entity}0\nENDSEC\n0\nEOF\n`, input = { fileName: `${kind}.dxf`, text, units } satisfies CadDxfCurveImportInput;
  const result = importCadDxfCurve(input), resolved = resolveCadCurve(result.curve, {});
  expect(result.curve.segments).toHaveLength(count); expect(result.curve.source?.text).toBe(text); expect(result.scaleToMillimeters).toBe(scale);
  expect(result.curve.segments.every((segment, index) => segment.kind === 'line' && segment.start[0] === index * scale
    && segment.end[0] === (index + 1) * scale && segment.start[1] === 0 && segment.end[1] === 0)).toBe(true);
  expect(resolved.start).toEqual([0, 0]); expect(resolved.end).toEqual([count * scale, 0]); expect(resolved.length).toBe(count * scale);
  expect(input.text).toBe(text);
}, 30_000);
