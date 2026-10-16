import { expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadFeature } from '../cadDocument';
import { resolveCadSketchRegions } from '../cadSketchGeometry';
import { CadSession } from '../../../features/cad/cadSession';
import { graphCellSelectionAt, intersectingCircleSketch } from './cadIntersectingCellFixtures';

it('validates an explicit lens before Whole sketch and retains its exact selector through ordinary driver changes', () => {
  const sketch = intersectingCircleSketch(), parameters = { separation: 6 }, source = JSON.stringify(sketch);
  const selection = graphCellSelectionAt(sketch, parameters, [[3, 0]]);
  const pad: CadFeature = { id: 'pad', kind: 'extrude', name: 'Lens pad', suppressed: false, sketchId: sketch.id,
    distance: 5, symmetric: false, operation: 'new', targetId: null, regionSelection: selection };
  const document = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, parameters, features: [sketch, pad] });
  const { regionSelection: _selection, ...wholePad } = pad;
  expect(resolveCadSketchRegions(sketch, parameters)).toEqual([]);
  expect(document.features[1]).toMatchObject({ regionSelection: selection });
  expect(() => parseCadDocument({ ...document, features: [sketch, wholePad] })).toThrow(/nonempty/);
  expect(() => parseCadDocument({ ...document, features: [sketch, { id: 'revolve', kind: 'revolve', name: 'Revolve', suppressed: false,
    sketchId: sketch.id, angle: 180, axis: 'x', operation: 'new', targetId: null }] })).toThrow(/nonempty/);
  const session = new CadSession(document);
  session.edit([{ kind: 'set-parameter', name: 'separation', value: 7 }]);
  expect(session.getSnapshot().document.features[1]).toMatchObject({ regionSelection: selection });
  const before = session.getSnapshot();
  expect(() => session.edit([{ kind: 'set-parameter', name: 'separation', value: 11 }])).toThrow();
  expect(session.getSnapshot()).toBe(before); expect(JSON.stringify(sketch)).toBe(source);
});

it('keeps shape-valid dormant graph selectors in schema 2 and rejects schema 1 without rewriting their source', () => {
  const source = intersectingCircleSketch(), selection = graphCellSelectionAt(source, { separation: 6 }, [[3, 0]]);
  const { graph: _graph, ...legacySource } = source;
  const sketch = { ...legacySource, profiles: [{ id: 'circle', name: 'Circle', construction: false,
    geometry: { kind: 'circle', x: 0, y: 0, radius: 5 } }] };
  const document = { ...createCadDocument(), schemaVersion: 2, features: [sketch, { id: 'pad', kind: 'extrude', name: 'Dormant', suppressed: true,
    sketchId: source.id, distance: 5, symmetric: false, operation: 'new', targetId: null, regionSelection: selection }] };
  expect(parseCadDocument(document).features[1]).toMatchObject({ regionSelection: selection });
  expect(() => parseCadDocument({ ...document, schemaVersion: 1 })).toThrow(/schema 2/);
});
