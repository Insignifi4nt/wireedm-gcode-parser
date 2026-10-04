import { describe, expect, it } from 'vitest';
import { buildMachinePackageArchive, commitStoredMachinePackageInstallation, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createMachinePostBinding, parseMachineDefinition } from '@/domain/machine-definition/machineDefinition';
import { activateStoredMachinePostBinding } from '@/domain/machine-definition/machineLibraryMutations';
import { parseWireEdmPostPackage } from '@/domain/post-processor/postPackage';
import { createEmptyPostLibrary, installPostPackage } from '@/domain/post-processor/postLibrary';
import type { WireEdmPostPackageValue } from '@/domain/post-processor/postPackageSchema';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import { workbenchSiteTools, type WorkbenchToolState } from './workbenchSiteTools';

async function installed(kind: 'small' | 'many' | 'large' = 'small') {
  const input = await machinePackageFixture();
  let document = input.document;
  if (kind === 'many') {
    const base = document.machine.bindings[0];
    document = { ...document, machine: { ...document.machine,
      bindings: Array.from({ length: 100 }, (_, index) => ({ ...base,
        id: index ? `setup-${index}` : base.id, name: `Production setup ${index + 1}` })) } };
  } else if (kind === 'large') {
    const postValue = structuredClone(document.posts[0]) as unknown as WireEdmPostPackageValue;
    const properties: Record<string, number | string> = { coordinatePrecision: 3 };
    for (let index = 0; index < 8; index++) {
      postValue.manifest.properties[`controllerLabel${index}`] = {
        type: 'string', description: 'Controller configuration label.', required: false, maxLength: 4096
      };
      properties[`controllerLabel${index}`] = '\u0000'.repeat(4096);
    }
    const suffix = '日本 "\\\r\n💫\ud800';
    properties.controllerLabel1 = '\u0000'.repeat(4096 - suffix.length) + suffix;
    const parsed = parseWireEdmPostPackage(JSON.stringify(postValue));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const post = await installPostPackage(createEmptyPostLibrary(), parsed.package);
    if (!post.ok) throw new Error(post.error.message);
    const machine = parseMachineDefinition(JSON.stringify({ ...document.machine, bindings: [], activeBindingId: null }));
    if (!machine.ok) throw new Error(JSON.stringify(machine.diagnostics));
    const bound = createMachinePostBinding(machine.machine, post.installation, {
      id: 'production', name: 'Controller configuration labels', properties,
      compatibility: { ...document.machine.bindings[0].compatibility, notes: '\u0000'.repeat(8192) }
    });
    if (!bound.ok) throw new Error(JSON.stringify(bound.error));
    const source = parsed.package.sources[0];
    const physical = { ...bound.machine, evidence: [{ id: 'machine.verified-program',
      name: 'Controller verification program', uri: source.uri, contentSha256: source.contentSha256 }] };
    const { bindings: _bindings, activeBindingId: _activeBindingId, ...snapshot } = physical;
    const verification = { status: 'claimed' as const, verifiedAt: '2026-10-04T00:00:00.000Z',
      verifiedBy: 'Controller setup reviewer', machineDefinitionHash: await hashJson(snapshot),
      postContentHash: physical.bindings[0].post.contentHash, propertiesHash: await hashJson(properties),
      evidenceRefs: [physical.evidence[0].id], notes: '\u0000'.repeat(8192) };
    document = { ...document, machine: { ...physical,
      bindings: [{ ...physical.bindings[0], verification }] }, posts: [parsed.package] };
  }
  const built = await buildMachinePackageArchive({ ...input, document });
  if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
  const adapter = createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });
  const opened = await initializeWorkbenchCatalog(adapter);
  if (!opened.ok) throw new Error(opened.error.message);
  const prepared = await prepareStoredMachinePackageInstallation(opened.workbench, built.archive);
  if (!prepared.ok) throw new Error(prepared.error.message);
  const committed = await commitStoredMachinePackageInstallation(prepared.prepared, { kind: 'install-new' });
  if (!committed.ok) throw new Error(committed.error.message);
  return committed.workbench;
}

async function hashJson(value: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(value)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function queries(workbench: Awaited<ReturnType<typeof installed>>) {
  const state: WorkbenchToolState = { workbench, busy: false, draft: null };
  const tools = workbenchSiteTools(() => state);
  async function call(name: string, input: unknown = {}) {
    const result = await tools.find(tool => tool.name === name)!.execute(input) as {
      ok: boolean; data: Record<string, any>; error?: { code: string };
    };
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(32 * 1024);
    return result;
  }
  return { state, call };
}

describe('complete versioned installed capability discovery', () => {
  it('preserves the existing small no-argument row and supplies an exact capability pin', async () => {
    const workbench = await installed(), { call } = queries(workbench);
    const machine = workbench.machines.machines[0], binding = machine.bindings[0];
    const result = await call('edm_get_capabilities');
    expect(result.ok).toBe(true);
    expect(result.data.capabilityVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.items).toEqual([{ id: machine.id, name: machine.name, activeBindingId: machine.activeBindingId,
      hardware: machine.hardware, limits: machine.limits, setups: [{ id: binding.id, name: binding.name,
        post: binding.post, properties: binding.properties, verification: binding.verification,
        capabilities: workbench.posts.installations[0].package.manifest.capabilities }] }]);
    expect(result.data.total).toBe(1); expect(result.data.nextOffset).toBeNull();
    expect(await call('edm_get_capabilities', { kind: 'setups', machineId: machine.id })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
    expect(await call('edm_read_machine_setup', { capabilityVersion: result.data.capabilityVersion, machineId: machine.id, bindingId: 'missing' }))
      .toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('discovers every one of 100 valid installed setups in exact order without duplicate or omitted IDs', async () => {
    const workbench = await installed('many'), { call } = queries(workbench), machine = workbench.machines.machines[0];
    const listed = await call('edm_get_capabilities', { limit: 1 });
    expect(listed).toMatchObject({ ok: true, data: { items: [{ id: machine.id, activeBindingId: machine.activeBindingId,
      setupsOmitted: true, setupCount: 100 }] } });
    const ids: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const result = await call('edm_get_capabilities', { kind: 'setups', machineId: machine.id,
        capabilityVersion: listed.data.capabilityVersion, offset, limit: 50 });
      expect(result).toMatchObject({ ok: true, data: { total: 100, capabilityVersion: listed.data.capabilityVersion } });
      expect(result.data.items.length).toBeGreaterThan(0);
      for (const item of result.data.items) {
        expect(item.post).toEqual(machine.bindings[0].post);
        expect(item.properties).toEqual(machine.bindings[0].properties);
        expect(item.capabilities).toEqual(workbench.posts.installations[0].package.manifest.capabilities);
      }
      ids.push(...result.data.items.map((item: { id: string }) => item.id));
      offset = result.data.nextOffset;
    }
    expect(ids).toEqual(machine.bindings.map(binding => binding.id));
    expect(new Set(ids).size).toBe(100);
  });

  it('reconstructs complete maximal escaped setup JSON while every discovery/read envelope remains bounded', async () => {
    const workbench = await installed('large'), { call } = queries(workbench), machine = workbench.machines.machines[0];
    const before = await workbench.adapter.readExactText!('machines/library.json');
    const listed = await call('edm_get_capabilities', { kind: 'machines' });
    expect(listed).toMatchObject({ ok: true, data: { kind: 'machines', items: [{ id: machine.id, setupCount: 1, setupsOmitted: true }] } });
    const input = { machineId: machine.id, capabilityVersion: listed.data.capabilityVersion };
    const { notes, ...claim } = machine.bindings[0].verification.status === 'claimed'
      ? machine.bindings[0].verification : (() => { throw new Error('Expected claimed fixture.'); })();
    expect(await call('edm_get_capabilities', { ...input, kind: 'setups' })).toMatchObject({ ok: true, data: { items: [{
      id: 'production', post: machine.bindings[0].post, propertyCount: 9,
      verification: { ...claim, notesOmitted: true, noteCharacterCount: notes.length },
      omittedDetails: ['properties', 'verification.notes'], detailsAvailable: true
    }] } });
    let offset: number | null = 0, text = '';
    while (offset !== null) {
      const result = await call('edm_read_machine_setup', { ...input, bindingId: 'production', offset, length: 4000 });
      expect(result).toMatchObject({ ok: true, data: { capabilityVersion: input.capabilityVersion, offsetUnit: 'utf16-code-units', offset, format: 'json' } });
      expect(result.data.text.length).toBeGreaterThan(0);
      expect(result.data.text.length).toBeLessThanOrEqual(4000);
      text += result.data.text;
      if (result.data.nextOffset !== null) expect(result.data.nextOffset).toBe(offset + result.data.text.length);
      else expect(text.length).toBe(result.data.totalCharacterCount);
      offset = result.data.nextOffset;
    }
    expect(JSON.parse(text)).toEqual({ ...machine.bindings[0], capabilities: workbench.posts.installations[0].package.manifest.capabilities });
    expect(text).toBe(JSON.stringify({ ...machine.bindings[0], capabilities: workbench.posts.installations[0].package.manifest.capabilities }, null, 2) + '\n');
    expect(await workbench.adapter.readExactText!('machines/library.json')).toBe(before);
  });

  it('rejects stale machine pages, setup pages and detail chunks after authoritative setup activation', async () => {
    const workbench = await installed('many'), { call, state } = queries(workbench), machine = workbench.machines.machines[0];
    const listed = await call('edm_get_capabilities');
    const activated = await activateStoredMachinePostBinding(workbench.adapter, machine.id, 'setup-1');
    if (!activated.ok) throw new Error(activated.error.message);
    state.workbench = { ...workbench, machines: activated.library };
    const pin = { capabilityVersion: listed.data.capabilityVersion };
    for (const [name, input] of [
      ['edm_get_capabilities', { ...pin, offset: 1 }],
      ['edm_get_capabilities', { ...pin, kind: 'setups', machineId: machine.id, offset: 50 }],
      ['edm_read_machine_setup', { ...pin, machineId: machine.id, bindingId: 'production', offset: 4000 }]
    ] as const) expect(await call(name, input)).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    const fresh = await call('edm_get_capabilities');
    expect(fresh.data.capabilityVersion).not.toBe(pin.capabilityVersion);
    expect(fresh.data.items[0].activeBindingId).toBe('setup-1');
  });

  it('pins post catalog identity even with the same machine objects, and retains pins across preference changes', async () => {
    const workbench = await installed(), { call, state } = queries(workbench);
    const listed = await call('edm_get_capabilities');
    state.workbench = { ...workbench, manifest: { ...workbench.manifest, updatedAt: '2026-10-04T00:00:00.000Z' } };
    expect(await call('edm_get_capabilities', { capabilityVersion: listed.data.capabilityVersion })).toMatchObject({ ok: true });
    const next = await machinePackageFixture({ postVersion: '2.0.0' });
    const installedPost = await installPostPackage(workbench.posts, next.document.posts[0]);
    if (!installedPost.ok) throw new Error(installedPost.error.message);
    state.workbench = { ...state.workbench!, posts: installedPost.library };
    expect(await call('edm_get_capabilities', { capabilityVersion: listed.data.capabilityVersion })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  });
});
