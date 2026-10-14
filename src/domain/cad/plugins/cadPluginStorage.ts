import { Value } from '@sinclair/typebox/value';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { commitWorkbenchFileTransaction } from '@/domain/storage/workbenchFileTransaction';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { BUNDLED_CAD_PLUGINS, createCadPluginProfile, parseCadPluginPackage, type CadPluginPackage } from './cadPlugins';
import { CadError } from '../cadError';

const prefix = 'cad/plugins/';
const maxBytes = 65536;
function packagePath(plugin: CadPluginPackage) { return `${prefix}${plugin.id}/${plugin.version}.cad-plugin.json`; }
function assertBundledIdentity(plugin: CadPluginPackage) {
  const bundled = BUNDLED_CAD_PLUGINS.find(item => item.id === plugin.id && item.version === plugin.version);
  if (bundled && !Value.Equal(bundled, plugin)) throw new CadError('plugin-version-conflict', 'A different bundled package already occupies this plugin ID/version. Use a new ID or version. Stored originals remain preserved.');
}
async function read(adapter: WorkbenchStorageAdapter, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (adapter.readBoundedExactText) {
    const value = await adapter.readBoundedExactText(path, maxBytes, signal);
    if (value.status === 'too-large') throw new CadError('plugin-size', 'Plugin package exceeds 64 KiB. Preserve the original.');
    return value.status === 'read' ? value.text : null;
  }
  const text = await (adapter.readExactText?.(path) ?? adapter.readText(path));
  if (text !== null && new TextEncoder().encode(text).length > maxBytes) throw new CadError('plugin-size', 'Plugin package exceeds 64 KiB.');
  return text;
}
export function reviewCadPluginSource(text: string): CadPluginPackage {
  if (new TextEncoder().encode(text).length > maxBytes) throw new CadError('plugin-size', 'Plugin package exceeds 64 KiB.');
  const plugin = parseCadPluginPackage(JSON.parse(text));
  // Package defaults must form valid CAD geometry before any installation write.
  parseCadDocument({ ...createCadDocument('Plugin validation', 'plugin_validation'), features: [
    { kind: 'sketch', id: 'plugin_sketch', name: plugin.name, suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'plugin_profile', name: plugin.name, construction: false, geometry: createCadPluginProfile(plugin) }] }
  ] });
  return plugin;
}
export async function installCadPlugin(adapter: WorkbenchStorageAdapter, text: string, options: { signal?: AbortSignal; beforeWrite?: () => void } = {}) {
  const plugin = reviewCadPluginSource(text);
  assertBundledIdentity(plugin);
  const path = packagePath(plugin);
  return withWorkbenchMutationLock(adapter, async () => {
    options.signal?.throwIfAborted();
    const original = await read(adapter, path, options.signal);
    if (original !== null) {
      if (!Value.Equal(parseCadPluginPackage(JSON.parse(original)), plugin)) throw new CadError('plugin-version-conflict', 'A different package already occupies this plugin ID/version. Publish a new version; installed originals are never overwritten.');
      options.beforeWrite?.();
      return { plugin, installed: false, path };
    }
    await commitWorkbenchFileTransaction(adapter, [{ path, contents: text, expectedPrevious: null }], () => {
      options.signal?.throwIfAborted(); options.beforeWrite?.();
    });
    return { plugin, installed: true, path };
  });
}
export async function listCadPlugins(adapter: WorkbenchStorageAdapter, signal?: AbortSignal) {
  return withWorkbenchMutationLock(adapter, async () => {
    if (!adapter.listFiles) throw new CadError('plugin-inventory', 'This workbench cannot list installed plugins.');
    const inventory = await adapter.listFiles(signal);
    const paths = inventory.paths.filter(path => path.startsWith(prefix) && path.endsWith('.cad-plugin.json'));
    const packages: CadPluginPackage[] = [...BUNDLED_CAD_PLUGINS];
    const diagnostics: { path: string; message: string }[] = [];
    for (const path of paths.slice(0, 100)) {
      try {
        const text = await read(adapter, path, signal);
        if (text === null) throw new Error('Plugin disappeared while reading.');
        const plugin = reviewCadPluginSource(text);
        if (packagePath(plugin) !== path) throw new Error('Plugin identity differs from its stored path.');
        assertBundledIdentity(plugin);
        if (!packages.some(item => item.id === plugin.id && item.version === plugin.version)) packages.push(plugin);
      } catch (error) {
        signal?.throwIfAborted();
        diagnostics.push({ path, message: error instanceof Error ? error.message : 'Cannot read plugin.' });
      }
    }
    return { packages, diagnostics, truncated: inventory.truncated || paths.length > 100 };
  });
}
