import type { MachineDefinition, MachinePostBinding } from '@/domain/machine-definition/machineDefinition';
import type { MachineLibrary } from '@/domain/machine-definition/machineLibrary';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { jsonByteLength } from './diagnosticSummaries';

const rowBudget = 24 * 1024 - 2;
const versions = new WeakMap<MachineLibrary, WeakMap<PostLibrary, Promise<string>>>();

/** Library records are immutable; project/preference changes need not invalidate capability pages. */
export function capabilityVersion(workbench: ConnectedWorkbenchCatalog): Promise<string> {
  let posts = versions.get(workbench.machines);
  if (!posts) { posts = new WeakMap(); versions.set(workbench.machines, posts); }
  let version = posts.get(workbench.posts);
  if (!version) {
    const text = JSON.stringify({ machines: workbench.machines.machines,
      posts: workbench.posts.installations.map(({ ref, package: post }) => ({ ref, capabilities: post.manifest.capabilities })) });
    version = crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(digest =>
      Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''));
    posts.set(workbench.posts, version);
  }
  return version;
}

function postCapabilities(workbench: ConnectedWorkbenchCatalog, binding: MachinePostBinding) {
  return workbench.posts.installations.find(({ ref }) => ref.packageId === binding.post.packageId &&
    ref.version === binding.post.version && ref.contentHash === binding.post.contentHash)?.package.manifest.capabilities ?? null;
}

function fullSetupRow(workbench: ConnectedWorkbenchCatalog, binding: MachinePostBinding) {
  return { id: binding.id, name: binding.name, post: binding.post, properties: binding.properties,
    verification: binding.verification, capabilities: postCapabilities(workbench, binding) };
}

function machineSummary(machine: MachineDefinition) {
  return { id: machine.id, name: machine.name, activeBindingId: machine.activeBindingId,
    hardware: machine.hardware, limits: machine.limits, setupCount: machine.bindings.length, setupsOmitted: true };
}

/** Preserve the legacy full row when it fits; large arrays have explicit, complete setup paging. */
export function machineCapabilityRow(workbench: ConnectedWorkbenchCatalog, machine: MachineDefinition, summary = false) {
  if (summary) return machineSummary(machine);
  const row = { id: machine.id, name: machine.name, activeBindingId: machine.activeBindingId,
    hardware: machine.hardware, limits: machine.limits, setups: machine.bindings.map(binding => fullSetupRow(workbench, binding)) };
  return jsonByteLength(row) <= rowBudget ? row : machineSummary(machine);
}

/** A valid setup can contain hundreds of KiB of properties. Its status/hashes remain visible. */
export function setupCapabilityRow(workbench: ConnectedWorkbenchCatalog, binding: MachinePostBinding) {
  const row = fullSetupRow(workbench, binding);
  if (jsonByteLength(row) <= rowBudget) return row;
  const verification = binding.verification.status === 'claimed' ? (() => {
    const { notes, ...claim } = binding.verification;
    return { ...claim, notesOmitted: true, noteCharacterCount: notes.length };
  })() : binding.verification;
  return { id: binding.id, name: binding.name, post: binding.post, verification, capabilities: row.capabilities,
    propertyCount: Object.keys(binding.properties).length,
    omittedDetails: ['properties', ...(binding.verification.status === 'claimed' ? ['verification.notes'] : [])],
    detailsAvailable: true };
}

// Retain only one complete setup serialization, rather than every potentially large catalog row.
let latestSetup: { binding: MachinePostBinding; capabilities: ReturnType<typeof postCapabilities>; text: string } | undefined;
export function machineSetupJson(workbench: ConnectedWorkbenchCatalog, binding: MachinePostBinding) {
  const capabilities = postCapabilities(workbench, binding);
  if (latestSetup?.binding !== binding || latestSetup.capabilities !== capabilities) {
    latestSetup = { binding, capabilities, text: JSON.stringify({ ...binding, capabilities }, null, 2) + '\n' };
  }
  return latestSetup.text;
}
