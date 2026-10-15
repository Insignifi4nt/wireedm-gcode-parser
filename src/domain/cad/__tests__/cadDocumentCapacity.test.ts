// @vitest-environment node
import { expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';

it('preserves a portable history beyond former feature and parameter-group counts with exact expressions and references', () => {
  const parameters = { radius: 1, ...Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`unused_${index}`, index])) };
  const input = { ...createCadDocument('Reference history', 'reference_history'), parameters,
    parameterGroups: Array.from({ length: 65 }, (_, index) => ({ id: `group_${index}`, name: `Group ${index}` })),
    parameterMetadata: Object.fromEntries(Object.keys(parameters).map(name => [name, { source: { kind: 'manual' as const }, groupId: 'group_64' }])),
    features: Array.from({ length: 257 }, (_, index) => ({ kind: 'sketch' as const, id: `sketch_${index}`, name: `Sketch ${index}`, suppressed: false,
      plane: 'XY' as const, offset: 0, profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle' as const, x: index * 4, y: 0, radius: 'radius' } }] })),
  }, original = JSON.stringify(input), accepted = parseCadDocument(input), reopened = parseCadDocument(JSON.parse(JSON.stringify(accepted)));
  expect(reopened).toEqual(input); expect(reopened.features).toHaveLength(257); expect(reopened.parameterGroups).toHaveLength(65);
  expect(JSON.stringify(input)).toBe(original);
  expect(() => parseCadDocument({ ...input, features: [...input.features, input.features[0]] })).toThrow('Duplicate feature ID');
  expect(() => parseCadDocument({ ...input, parameterGroups: [...input.parameterGroups, input.parameterGroups[0]] })).toThrow('must be unique');
  expect(() => parseCadDocument({ ...input, parameterMetadata: { radius: { source: { kind: 'manual' }, groupId: 'missing' } } })).toThrow('missing group');
});
