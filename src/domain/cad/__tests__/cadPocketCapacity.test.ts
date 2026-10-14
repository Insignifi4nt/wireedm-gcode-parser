// @vitest-environment node
import { expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { resolveCadPocketInputs } from '../cadPocket';

it('keeps a complete accepted dense polygon usable as a Pocket section with unchanged precision scale', () => {
  const count = 131072, points = Array.from({ length: count }, (_, index): readonly [number, number] =>
    [10 * Math.cos(index * 2 * Math.PI / count), 10 * Math.sin(index * 2 * Math.PI / count)]);
  const before = parseCadDocument({ ...createCadDocument('Dense section', 'dense_section'), features: [
    { id: 'stock_outline', kind: 'sketch', name: 'Stock outline', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'stock', name: 'Stock', construction: false, geometry: { kind: 'rectangle', x: -50, y: -50, width: 100, height: 100, cornerRadius: 0 } }] },
    { id: 'stock', kind: 'extrude', name: 'Stock', sketchId: 'stock_outline', distance: 10, symmetric: false, operation: 'new', targetId: null, suppressed: false },
    { id: 'section', kind: 'sketch', name: 'Section', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'outline', name: 'Outline', construction: false, geometry: { kind: 'polygon', points } }] },
  ] }), original = JSON.stringify(before);
  const pocket = { id: 'pocket', kind: 'pocket' as const, name: 'Pocket', sketchId: 'section', targetId: 'stock', suppressed: false,
    extent: { kind: 'through-all' as const, direction: 'both' as const } };
  const after = applyCadEdits(before, [{ kind: 'add-feature', feature: pocket }]);
  const resolved = resolveCadPocketInputs(pocket, new Map(before.features.map(feature => [feature.id, feature])), before.parameters);
  expect(resolved.sectionEdgeCount).toBe(count); expect(resolved.sectionScaleMm).toBe(20); expect(resolved.regionCount).toBe(1);
  expect(after.features.slice(0, -1)).toEqual(before.features); expect(after.features.at(-1)).toEqual(pocket);
  expect(JSON.stringify(before)).toBe(original);
}, 15_000);
