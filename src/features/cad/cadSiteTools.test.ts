import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { CadDocumentSchema, CadFeatureSchema } from '@/domain/cad/cadSchema';
import { CadEditSchema } from '@/domain/cad/cadOperations';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';

describe('CAD tool argument boundary and discovery', () => {
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
      { ...complete, angle: { value: 360 } }, { ...complete, unexpected: true }]) {
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
      id: expect.anything(), construction: expect.anything(), geometry: expect.anything()
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
