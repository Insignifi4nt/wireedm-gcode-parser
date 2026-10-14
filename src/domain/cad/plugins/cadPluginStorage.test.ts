import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { installCadPlugin, listCadPlugins } from './cadPluginStorage';
import { CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, CAD_STAR_PLUGIN, CAD_LINKED_RECIPE_EXAMPLE, createCadPluginProfile, inspectCadPluginProfile } from './cadPlugins';

describe.each(['cache', 'folder'])('immutable CAD plugin installation in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  const plugin = { ...CAD_STAR_PLUGIN, id: 'user.star' };
  const original = JSON.stringify(plugin, null, 2) + '\r\n';
  const path = 'cad/plugins/user.star/1.0.0.cad-plugin.json';
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('plugin-test') as unknown as FileSystemDirectoryHandle);
  });
  it('offers the new configurable bundled gear without rewriting an installed V2 original', async () => {
    const v2Source = JSON.stringify(CAD_GEAR_V2_PLUGIN, null, 2) + '\r\n';
    const v2Path = 'cad/plugins/wireedm.spur-gear/2.0.0.cad-plugin.json';
    await installCadPlugin(adapter, v2Source);
    const listed = await listCadPlugins(adapter);
    expect(listed.packages.filter(item => item.id === CAD_GEAR_V3_PLUGIN.id).map(item => item.version)).toEqual(['3.0.0', '2.0.0']);
    expect(await adapter.readText(v2Path)).toBe(v2Source);
    expect(listed.diagnostics).toEqual([]);
    await installCadPlugin(adapter, JSON.stringify(CAD_GEAR_V3_PLUGIN));
    expect(await adapter.readText(v2Path)).toBe(v2Source);
    expect((await listCadPlugins(adapter)).packages.filter(item => item.id === CAD_GEAR_V3_PLUGIN.id)).toHaveLength(2);
  });
  it('preserves exact source, makes retries idempotent and rejects conflicting versions', async () => {
    expect((await installCadPlugin(adapter, original)).installed).toBe(true);
    expect(await adapter.readText(path)).toBe(original);
    expect((await installCadPlugin(adapter, JSON.stringify(plugin))).installed).toBe(false);
    await expect(installCadPlugin(adapter, JSON.stringify({ ...plugin, name: 'Changed package' }))).rejects.toThrow(/already occupies/);
    expect(await adapter.readText(path)).toBe(original);
    const v2 = { ...plugin, version: '2.0.0' };
    await installCadPlugin(adapter, JSON.stringify(v2));
    expect((await listCadPlugins(adapter)).packages.filter(item => item.id === plugin.id)).toHaveLength(2);
  });
  it('rejects an edited bundled recipe before installation instead of silently substituting bundled geometry', async () => {
    const changed = { ...CAD_STAR_PLUGIN, inputs: CAD_STAR_PLUGIN.inputs.map(input => input.name === 'outerRadius' ? { ...input, default: 40 } : input) };
    const target = 'cad/plugins/wireedm.star-profile/1.0.0.cad-plugin.json';
    const write = vi.spyOn(adapter, 'writeText');
    await expect(installCadPlugin(adapter, JSON.stringify(changed))).rejects.toMatchObject({ code: 'plugin-version-conflict' });
    expect(write).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(target)).toBeNull();
    const listed = await listCadPlugins(adapter);
    expect(listed.packages.find(item => item.id === CAD_STAR_PLUGIN.id)).toEqual(CAD_STAR_PLUGIN);
    expect(listed.diagnostics).toEqual([]);
    const next = { ...changed, version: '1.0.1' }, source = JSON.stringify(next, null, 2) + '\r\n';
    expect((await installCadPlugin(adapter, source)).installed).toBe(true);
    expect((await listCadPlugins(adapter)).packages.find(item => item.id === next.id && item.version === next.version)).toEqual(next);
    expect(await adapter.readExactText?.('cad/plugins/wireedm.star-profile/1.0.1.cad-plugin.json')).toBe(source);
  });
  it('accepts an exact bundled package and keeps its original source across retries and inventory reads', async () => {
    const source = JSON.stringify(CAD_STAR_PLUGIN, null, 2) + '\r\n';
    const target = 'cad/plugins/wireedm.star-profile/1.0.0.cad-plugin.json';
    expect((await installCadPlugin(adapter, source)).installed).toBe(true);
    expect((await installCadPlugin(adapter, JSON.stringify(CAD_STAR_PLUGIN))).installed).toBe(false);
    const listed = await listCadPlugins(adapter);
    expect(listed.packages.filter(item => item.id === CAD_STAR_PLUGIN.id && item.version === CAD_STAR_PLUGIN.version)).toEqual([CAD_STAR_PLUGIN]);
    expect(listed.diagnostics).toEqual([]);
    expect(await adapter.readExactText?.(target)).toBe(source);
  });
  it('reports and preserves a stored recipe that conflicts with a bundled identity', async () => {
    const changed = { ...CAD_STAR_PLUGIN, inputs: CAD_STAR_PLUGIN.inputs.map(input => input.name === 'outerRadius' ? { ...input, default: 40 } : input) };
    const source = JSON.stringify(changed, null, 2) + '\r\n';
    const target = 'cad/plugins/wireedm.star-profile/1.0.0.cad-plugin.json';
    await adapter.writeText(target, source);
    const listed = await listCadPlugins(adapter);
    expect(listed.diagnostics).toEqual([{ path: target, message: expect.stringContaining('bundled') }]);
    expect(listed.packages.filter(item => item.id === CAD_STAR_PLUGIN.id && item.version === CAD_STAR_PLUGIN.version)).toEqual([CAD_STAR_PLUGIN]);
    await expect(installCadPlugin(adapter, source)).rejects.toMatchObject({ code: 'plugin-version-conflict' });
    await expect(installCadPlugin(adapter, JSON.stringify(CAD_STAR_PLUGIN))).rejects.toMatchObject({ code: 'plugin-version-conflict' });
    expect(await adapter.readExactText?.(target)).toBe(source);
  });
  it('rejects invalid default geometry before any writes', async () => {
    const write = vi.spyOn(adapter, 'writeText');
    await expect(installCadPlugin(adapter, JSON.stringify({ ...plugin, generator: { kind: 'polygon-recipe', repeat: 3, points: [[0, 0]] } }))).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it('round-trips complete API 2 relations without changing API 1 originals', async () => {
    await installCadPlugin(adapter, original);
    const source = JSON.stringify(CAD_LINKED_RECIPE_EXAMPLE, null, 2) + '\n';
    await installCadPlugin(adapter, source);
    expect(await adapter.readText('cad/plugins/user.linked-star/1.0.0.cad-plugin.json')).toBe(source);
    const stored = (await listCadPlugins(adapter)).packages.find(item => item.id === CAD_LINKED_RECIPE_EXAMPLE.id);
    if (!stored) throw new Error('Missing stored relations');
    const inspected = inspectCadPluginProfile(createCadPluginProfile(stored), {});
    expect(inspected.values.diameter).toBe(60);
    expect(inspected.fields.find(field => field.name === 'innerRadius')?.maximum).toBe(29.999);
    expect(await adapter.readText(path)).toBe(original);
    const write = vi.spyOn(adapter, 'writeText');
    if (stored.apiVersion !== 2) throw new Error('Missing API 2 rules');
    const invalid = { ...stored, id: 'user.invalid-rules', rules: { ...stored.rules, constraints: [{ left: 1, operator: 'gt', right: 2, message: 'Invalid defaults' }] } };
    await expect(installCadPlugin(adapter, JSON.stringify(invalid))).rejects.toThrow('Invalid defaults');
    expect(write).not.toHaveBeenCalled();
  });
  it('preserves corrupt originals and reports them without replacement', async () => {
    await adapter.writeText(path, 'original invalid package bytes');
    expect((await listCadPlugins(adapter)).diagnostics).toHaveLength(1);
    await expect(installCadPlugin(adapter, original)).rejects.toThrow();
    expect(await adapter.readText(path)).toBe('original invalid package bytes');
  });
  it('checks cancellation and stale review before durable installation', async () => {
    await expect(installCadPlugin(adapter, original, { beforeWrite: () => { throw new Error('stale review'); } })).rejects.toThrow(/cancelled/);
    expect(await adapter.readText(path)).toBeNull();
    const controller = new AbortController(); controller.abort();
    await expect(installCadPlugin(adapter, original, { signal: controller.signal })).rejects.toThrow();
    expect(await adapter.readText(path)).toBeNull();
    await installCadPlugin(adapter, original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('recovers an interrupted transaction before retrying installation', async () => {
    const write = adapter.writeText.bind(adapter); let interrupt = true;
    const spy = vi.spyOn(adapter, 'writeText').mockImplementation(async (target, contents) => {
      if (target === path && interrupt) { interrupt = false; throw new Error('interrupted write'); }
      await write(target, contents);
    });
    await expect(installCadPlugin(adapter, original)).rejects.toThrow('interrupted write');
    spy.mockRestore();
    await installCadPlugin(adapter, original);
    expect(await adapter.readText(path)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
