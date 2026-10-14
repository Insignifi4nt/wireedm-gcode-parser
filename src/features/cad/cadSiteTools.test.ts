import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { CadDocumentSchema, CadFeatureSchema } from '@/domain/cad/cadSchema';
import { CadEditSchema } from '@/domain/cad/cadOperations';
import { CadToolEditEnvelope } from './cadToolSchemas';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';

describe('CAD tool argument boundary and discovery', () => {
  it('advertises plane selection with the shared strict view-only contract and rejects creation or face-derived arguments before operations', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid plane selection reached operations'); });
    const tool = cadSiteTools(controller).find(tool => tool.name === 'cad_set_viewport');
    if (!tool) throw new Error('Missing viewport tool');
    for (const plane of ['XY', 'XZ', 'YZ', { kind: 'datum-plane', featureId: 'mount' }, null]) {
      expect(Value.Check(tool.inputSchema, { expectedVersion: 'current', command: { kind: 'select-reference-plane', plane } })).toBe(true);
    }
    for (const command of [{ kind: 'select-reference-plane', plane: 'ZX' }, { kind: 'select-reference-plane', plane: { kind: 'face', bodyId: 'stock', key: 'face' } },
      { kind: 'select-reference-plane', plane: { kind: 'datum-plane', featureId: 'mount', offset: 4 } },
      { kind: 'select-reference-plane', plane: 'XY', createSketch: true }, { kind: 'select-reference-plane', plane: 'XY', featureId: 'new_sketch' }]) {
      expect(await tool.execute({ expectedVersion: 'current', command })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
  });
  it('advertises dimension intent and translation with the exact shared narrow edit contracts', () => {
    const edit = cadSiteTools(() => { throw new Error('Discovery must not run operations'); }).find(entry => entry.name === 'cad_edit_document');
    if (!edit) throw new Error('Missing CAD edit tool');
    const descriptions = {
      'add-sketch-dimension': 'Driving dimension intent',
      'set-sketch-dimension': 'displayed quantity',
      'remove-sketch-dimension': 'retains the geometry scalar',
      'translate-sketch-profiles': 'expression-driven position',
    };
    expect(edit.inputSchema.properties.edits.items).toBe(CadToolEditEnvelope);
    for (const [kind, meaning] of Object.entries(descriptions)) {
      const declared = CadToolEditEnvelope.anyOf.find(schema => schema.properties.kind.const === kind);
      const shared = CadEditSchema.anyOf.find(schema => schema.properties.kind.const === kind);
      expect(declared?.description).toContain(meaning);
      expect(declared?.properties).toEqual(shared?.properties);
      expect(declared?.required).toEqual(shared?.required);
      expect(declared?.additionalProperties).toBe(false);
    }
    const dimension = CadToolEditEnvelope.anyOf.find(schema => schema.properties.kind.const === 'set-sketch-dimension');
    expect(dimension?.description).toContain('Named bindings update parameters');
    expect(dimension?.description).toContain('compound drivers reject');
  });
  it('rejects widened dimension and move arguments before accessing the shared draft', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid sketch edit reached operations'); });
    const edit = cadSiteTools(controller).find(entry => entry.name === 'cad_edit_document');
    if (!edit) throw new Error('Missing edit tool');
    const add = { kind: 'add-sketch-dimension', sketchId: 'outline', profileId: 'plate', constraint: { id: 'width', kind: 'dimension', quantity: 'width' } };
    const set = { kind: 'set-sketch-dimension', sketchId: 'outline', profileId: 'plate', dimensionId: 'width', value: 'span' };
    const remove = { kind: 'remove-sketch-dimension', sketchId: 'outline', profileId: 'plate', dimensionId: 'width' };
    const move = { kind: 'translate-sketch-profiles', sketchId: 'outline', profileIds: ['plate'], translation: [1, -2] };
    for (const valid of [add, set, remove, move]) expect(Value.Check(edit.inputSchema, { expectedVersion: 'current', edits: [valid] })).toBe(true);
    for (const invalid of [{ ...add, constraint: { ...add.constraint, quantity: 'x' } },
      { ...add, constraint: { ...add.constraint, value: 20 } }, { ...add, constraint: { ...add.constraint, kind: 'fixed' } },
      { ...set, value: { parameter: 'span' } }, { ...set, value: Infinity }, { ...remove, freeze: true },
      { ...move, profileIds: [] }, { ...move, profileIds: ['plate', 'plate'] },
      { ...move, profileIds: Array.from({ length: 257 }, (_, index) => `contour_${index}`) },
      { ...move, translation: [1, 2, 3] }, { ...move, translation: [1, NaN] }, { ...move, force: true }]) {
      expect(await edit.execute({ expectedVersion: 'current', edits: [invalid] })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
  });
  it('bounds ordered Loft preflight and rejects repair or source payloads before reaching operations', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid Loft inspection reached the controller'); });
    const inspect = cadSiteTools(controller).find(entry => entry.name === 'cad_inspect_loft');
    if (!inspect) throw new Error('Missing Loft inspection');
    const input = { expectedVersion: 'current', sketchIds: ['lower', 'upper'] };
    expect(Value.Check(inspect.inputSchema, input)).toBe(true);
    for (const invalid of [{ ...input, sketchIds: ['lower'] }, { ...input, sketchIds: ['lower', 'lower'] },
      { ...input, sketchIds: Array.from({ length: 17 }, (_, i) => `section_${i}`) },
      { ...input, sketchIds: ['lower', 'not an id'] }, { ...input, autoSort: true }, { ...input, includeGeometry: true },
      { ...input, ruled: false }, { ...input, targetId: 'body' }]) {
      expect(await inspect.execute(invalid)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
  });
  it('discovers world datums and rejects inactive placement fields before shared operations', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid datum reached the controller'); });
    const tools = cadSiteTools(controller); const edit = tools.find(entry => entry.name === 'cad_edit_document');
    const inspect = tools.find(entry => entry.name === 'cad_inspect_plane');
    if (!edit || !inspect) throw new Error('Missing datum tools');
    const definition = { kind: 'world', basePlane: 'XZ', origin: [0, 0, 12], rotation: [0, 45, 0] };
    const datum = { kind: 'datum-plane', id: 'plane', name: 'Plane', suppressed: false, definition };
    for (const feature of [{ ...datum, definition: { ...definition, normal: [0, 0, 1] } },
      { ...datum, definition: { ...definition, attachment: { bodyId: 'stock' } } },
      { ...datum, definition: { ...definition, rotation: [0, 45] } },
      { ...datum, definition: { ...definition, basePlane: 'ZX' } },
      { ...datum, offset: 4 },
      { kind: 'sketch', id: 'profile', name: 'Profile', suppressed: false, offset: 0, profiles: [],
        plane: { kind: 'datum-plane', featureId: 'plane', normal: [0, 0, 1] } }]) {
      const input = { expectedVersion: 'current', edits: [{ kind: 'add-feature', feature }] };
      expect(Value.Check(edit.inputSchema, input)).toBe(true);
      expect(await edit.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(await inspect.execute({ expectedVersion: 'current', featureId: 'plane', includeSource: true }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(controller).not.toHaveBeenCalled();
    const discovery = cadSiteTools(() => ({} as CadController)).find(entry => entry.name === 'cad_describe_features');
    expect(await discovery?.execute({ kind: 'datum-plane' })).toMatchObject({ ok: true, data: {
      kind: 'datum-plane', description: expect.stringContaining('cad_inspect_plane'),
      schema: { additionalProperties: false, properties: { definition: { additionalProperties: false,
        required: expect.arrayContaining(['kind', 'basePlane', 'origin', 'rotation']) } } } } });
  });
  it('discovers strict Through-all Pocket and rejects inactive distance fields before shared operations', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid Pocket reached the controller'); });
    const edit = cadSiteTools(controller).find(entry => entry.name === 'cad_edit_document');
    if (!edit) throw new Error('Missing edit tool');
    const complete = { kind: 'pocket', id: 'cut', name: 'Through bore', suppressed: false, sketchId: 'bore', targetId: 'stock', extent: { kind: 'through-all', direction: 'both' } };
    for (const feature of [{ ...complete, distance: 100 }, { ...complete, symmetric: true }, { ...complete, operation: 'cut' },
      { ...complete, extent: { kind: 'through-all', direction: 'up' } }, { ...complete, targetId: null }]) {
      const input = { expectedVersion: 'current', edits: [{ kind: 'add-feature', feature }] };
      expect(Value.Check(edit.inputSchema, input)).toBe(true);
      expect(await edit.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(controller).not.toHaveBeenCalled();
    const discovery = cadSiteTools(() => ({} as CadController)).find(entry => entry.name === 'cad_describe_features');
    expect(await discovery?.execute({ kind: 'pocket' })).toMatchObject({ ok: true, data: {
      kind: 'pocket', description: expect.stringContaining('XZ -Y'), schema: { additionalProperties: false,
        required: expect.arrayContaining(['sketchId', 'targetId', 'extent']), properties: { extent: { additionalProperties: false } } },
    } });
  });
  it('discovers Sweep and rejects incomplete geometry edits behind compact registration', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid feature reached the controller'); });
    const tools = cadSiteTools(controller); const edit = tools.find(entry => entry.name === 'cad_edit_document');
    const inspect = tools.find(entry => entry.name === 'cad_inspect_sweep');
    if (!edit || !inspect) throw new Error('Missing Sweep tools');
    const envelope = { kind: 'sweep', id: 'bend', name: 'Bend', suppressed: false };
    const complete = { ...envelope, sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null };
    for (const feature of [envelope, { ...complete, curveId: null }, { ...complete, autoPlace: true }, { ...complete, twist: 90 }]) {
      const input = { expectedVersion: 'current', edits: [{ kind: 'add-feature', feature }] };
      expect(Value.Check(edit.inputSchema, input)).toBe(true);
      expect(await edit.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    expect(await inspect.execute({ expectedVersion: 'current', sketchId: 'section', curveId: 'rail', repair: true }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(controller).not.toHaveBeenCalled();
    const discovery = cadSiteTools(() => ({} as CadController)).find(entry => entry.name === 'cad_describe_features');
    expect(await discovery?.execute({ kind: 'sweep' })).toMatchObject({ ok: true, data: { kind: 'sweep',
      description: expect.stringContaining('cad_inspect_sweep'), schema: { additionalProperties: false,
        required: expect.arrayContaining(['sketchId', 'curveId', 'operation', 'targetId']) } } });
  });
  it('keeps registered feature envelopes compact while rejecting invalid complete edits before the controller', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid feature reached the controller'); });
    const edit = cadSiteTools(controller).find(item => item.name === 'cad_edit_document');
    if (!edit) throw new Error('Missing edit tool');
    const complete = { kind: 'circular-pattern', id: 'array', name: 'Array', suppressed: false,
      sourceId: 'body', count: 4, axis: 'z', center: [0, 0, 0], angle: 360 };
    const envelope = { kind: 'circular-pattern', id: 'array', name: 'Array', suppressed: false };
    for (const feature of [envelope, { ...complete, count: 101 }, { ...complete, center: [0, 0] },
      { ...complete, angle: { value: 360 } }, { ...complete, unexpected: true }, { ...complete, kind: 'unsupported-solid' }]) {
      const input = { expectedVersion: 'current', edits: [{ kind: 'add-feature', feature }] };
      expect(Value.Check(edit.inputSchema, input)).toBe(true);
      expect(await edit.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    }
    const update = { expectedVersion: 'current', edits: [{ kind: 'update-feature', feature: envelope }] };
    expect(Value.Check(edit.inputSchema, update)).toBe(true);
    expect(await edit.execute(update)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    let reads = 0;
    const accessor = { ...complete, get count() { reads++; return 4; } };
    expect(await edit.execute({ expectedVersion: 'current', edits: [{ kind: 'add-feature', feature: accessor }] }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    const abort = new AbortController(); abort.abort();
    expect(await edit.execute(update, { signal: abort.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(reads).toBe(0); expect(controller).not.toHaveBeenCalled();
    expect(JSON.stringify(edit.inputSchema).length).toBeLessThan(JSON.stringify(CadEditSchema).length / 3);
    expect(Value.Check(edit.inputSchema, { ...update, unknown: true })).toBe(false);
    expect(Value.Check(edit.inputSchema, { ...update, edits: Array(129).fill(update.edits[0]) })).toBe(false);
  });
  it('retains full import validation behind the compact document registration', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('Invalid document reached the controller'); });
    const tool = cadSiteTools(controller).find(item => item.name === 'cad_import_document');
    if (!tool) throw new Error('Missing import tool');
    const document = { format: 'wireedm-cad', schemaVersion: 1, id: 'part', name: 'Part', units: 'mm', parameters: {},
      features: [{ id: 'import', name: 'Imported', kind: 'imported', suppressed: false,
        source: { format: 'stl', fileName: 'mesh.stl', encoding: 'base64', data: 'AAAA' } }] };
    const input = { expectedVersion: 'current', document };
    expect(Value.Check(tool.inputSchema, input)).toBe(true);
    expect(await tool.execute(input)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(controller).not.toHaveBeenCalled();
    expect(JSON.stringify(tool.inputSchema).length).toBeLessThan(JSON.stringify(CadDocumentSchema).length / 3);
    expect(Value.Check(tool.inputSchema, { ...input, document: { ...document, unknown: true } })).toBe(false);
    expect(Value.Check(tool.inputSchema, { ...input, document: { ...document, features: Array(257).fill(document.features[0]) } })).toBe(false);
  });
  it('rejects inherited and accessor arguments before schema reads or any shared operation', async () => {
    const controller = vi.fn<() => CadController>(() => { throw new Error('A malformed request reached the controller'); });
    const tool = cadSiteTools(controller).find(item => item.name === 'cad_create_document');
    if (!tool) throw new Error('Missing create tool');
    expect(await tool.execute(Object.create({ expectedVersion: 'current', name: 'Part' }))).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    let reads = 0;
    const getter = { name: 'Part', get expectedVersion() { reads++; return 'current'; } };
    expect(await tool.execute(getter)).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(reads).toBe(0); expect(controller).not.toHaveBeenCalled();
    const cancellation = new AbortController(); cancellation.abort();
    expect(await tool.execute(getter, { signal: cancellation.signal })).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    expect(reads).toBe(0); expect(controller).not.toHaveBeenCalled();
  });
  it('offers automatically nested sketch authoring while retaining saved legacy schema compatibility', async () => {
    const tool = cadSiteTools(() => ({} as CadController)).find(item => item.name === 'cad_describe_features');
    if (!tool) throw new Error('Missing discovery tool');
    const result = await tool.execute({ kind: 'sketch' });
    expect(result).toMatchObject({ ok: true, data: { kind: 'sketch', schema: { properties: { profiles: { items: { properties: {
      id: expect.anything(), construction: expect.anything(), geometry: expect.anything(),
      constraints: { type: 'array', maxItems: 6, items: { additionalProperties: false, required: ['id', 'kind', 'quantity'], properties: { kind: { const: 'dimension' } } } },
    } } } } } } });
    const text = JSON.stringify(result);
    expect(text).not.toContain('"role"');
    const stored = CadFeatureSchema.anyOf.find(schema => schema.properties.kind.const === 'sketch');
    if (!stored || !('profiles' in stored.properties)) throw new Error('Missing stored sketch schema');
    expect(stored.properties.profiles.items.properties.role).toBeDefined();
  });
  it('discovers the circular pattern contract with explicit total-extent and body-consumption semantics', async () => {
    const tool = cadSiteTools(() => ({} as CadController)).find(item => item.name === 'cad_describe_features');
    if (!tool) throw new Error('Missing discovery tool');
    expect(await tool.execute({})).toMatchObject({ ok: true, data: { items: expect.arrayContaining([
      { kind: 'linear-pattern', description: expect.stringContaining('Fuse') },
      { kind: 'circular-pattern', description: expect.stringContaining('signed total angular extent') }
    ]) } });
    expect(await tool.execute({ kind: 'circular-pattern' })).toMatchObject({ ok: true, data: {
      kind: 'circular-pattern', description: expect.stringContaining('without a duplicate endpoint'),
      schema: { additionalProperties: false, required: expect.arrayContaining(['sourceId', 'count', 'axis', 'center', 'angle']),
        properties: { count: { type: 'integer', minimum: 2, maximum: 100 }, center: { minItems: 3, maxItems: 3 } } }
    } });
  });
});
