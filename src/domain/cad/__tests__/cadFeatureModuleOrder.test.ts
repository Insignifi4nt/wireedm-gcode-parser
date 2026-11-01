import { describe, expect, it, vi } from 'vitest';

// The definitions and the resolvers they call import each other. Whichever module an application loads first, every
// definition must build and a document must parse: nothing in the cycle may read another member while it initialises.
const firstLoaded = {
  registry: () => import('../features/cadFeatureRegistry'),
  references: () => import('../features/kinds/references'),
  solids: () => import('../features/kinds/solids'),
  dressUps: () => import('../features/kinds/dressUps'),
  bodies: () => import('../features/kinds/bodies'),
  solidFields: () => import('../features/kinds/solidFields'),
  fields: () => import('../features/cadFeatureFields'),
  scalarMaps: () => import('../features/cadFeatureScalarMaps'),
  activity: () => import('../features/cadFeatureActivity'),
  datumPlanes: () => import('../cadDatumPlanes'),
  curve: () => import('../cadCurve'),
  loft: () => import('../cadLoft'),
  sweep: () => import('../cadSweep'),
  pocket: () => import('../cadPocket'),
  externalReferences: () => import('../cadSketchExternalReferences'),
  topology: () => import('../cadTopology'),
  schema: () => import('../cadSchema'),
  inputs: () => import('../cadFeatureInputs'),
  parameters: () => import('../cadParameters')
};

const features = [
  { id: 'layout', kind: 'sketch', name: 'Layout', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'plate', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: ' width ', height: 10, cornerRadius: 0 } }] },
  { id: 'pad', kind: 'extrude', name: 'Pad', suppressed: false, sketchId: 'layout', distance: 5, symmetric: false, operation: 'new', targetId: null },
  { id: 'row', kind: 'linear-pattern', name: 'Row', suppressed: false, sourceId: 'pad', count: 3, spacing: [30, 0, 0] }
];

describe('feature definition modules', () => {
  it.each(Object.entries(firstLoaded))('build and parse when %s loads first', async (_name, load) => {
    vi.resetModules();
    await load();
    const { cadFeatureKinds, cadFeatureDefinition } = await import('../features/cadFeatureRegistry');
    const { createCadDocument, parseCadDocument, validateCadDocument } = await import('../cadSchema');
    expect(cadFeatureKinds().map(kind => cadFeatureDefinition(kind).kind)).toHaveLength(17);
    const document = parseCadDocument({ ...createCadDocument('Order', 'order'), parameters: { width: 20 }, features });
    expect(document.features.map(feature => feature.kind)).toEqual(['sketch', 'extrude', 'linear-pattern']);
    expect(validateCadDocument(document)).toEqual([]);
  });
});
