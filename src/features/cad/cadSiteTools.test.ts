import { describe, expect, it, vi } from 'vitest';
import { CadFeatureSchema } from '@/domain/cad/cadSchema';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';

describe('CAD tool argument boundary and discovery', () => {
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
