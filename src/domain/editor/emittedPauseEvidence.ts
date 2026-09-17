import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import type { PostInstallation, PostLibrary } from '@/domain/post-processor/postLibrary';
import { validatePostPropertyValues } from '@/domain/post-processor/postProperties';
import type { ControllerProgramArtifact } from '@/domain/wire-edm-job/controllerArtifact';

export interface EmittedPauseEvidence {
  readonly sourceSignature: string;
  readonly projectIdentity: string;
  readonly machineId: string;
  readonly machineSignature: string;
  readonly bindingSignature: string;
  readonly packageSignature: string;
  readonly post: ControllerProgramArtifact['post'];
  readonly commandIdsByEvent: ReadonlyMap<string, readonly string[]>;
}

/** Prove the artifact came from this UPID, plan, machine, setup and exact package. */
export async function emittedPauseEvidence(
  artifact: ControllerProgramArtifact,
  installation: PostInstallation,
  document: PathPlanningDocument,
  machine: MachineDefinition,
  sourceSignature: string,
  projectIdentity: string
): Promise<EmittedPauseEvidence | null> {
  const binding = machine.bindings.find((candidate) => candidate.id === machine.activeBindingId);
  if (!binding || !samePostRef(artifact.post, installation.ref) ||
      !samePostRef(binding.post, artifact.post) ||
      artifact.revisionHashes.postPackage !== installation.ref.contentHash) return null;
  const compiled = compileWireEdmExecutionPlan(document);
  const properties = validatePostPropertyValues(installation.package, binding.properties);
  if (!compiled.ok || !properties.ok) return null;
  const { bindings: _bindings, activeBindingId: _activeBindingId, ...physical } = machine;
  const [upid, plan, machineHash, bindingHash, propertiesHash, packageHash] = await Promise.all([
    hash(document), hash(compiled.plan), hash(physical), hash(binding), hash(properties.values),
    hash(installation.package)
  ]);
  if (upid !== artifact.revisionHashes.upid || plan !== artifact.revisionHashes.executionPlan ||
      machineHash !== artifact.revisionHashes.machine || bindingHash !== artifact.revisionHashes.binding ||
      propertiesHash !== artifact.revisionHashes.postProperties ||
      packageHash !== artifact.revisionHashes.postPackage) return null;
  const byEvent = new Map<string, string[]>();
  const eventIds = new Set(compiled.plan.events.map((event) => event.id));
  for (const block of artifact.program.blocks) {
    if (!eventIds.has(block.eventId)) return null;
    for (const commandId of block.commandIds) {
      const command = installation.package.dialect.commands[commandId];
      if (!command?.effects.includes('program.paused')) continue;
      const ids = byEvent.get(block.eventId) ?? [];
      if (!ids.includes(commandId)) ids.push(commandId);
      byEvent.set(block.eventId, ids);
    }
  }
  return { sourceSignature, projectIdentity, machineId: machine.id,
    machineSignature: canonicalJson(jsonSnapshot(physical)), bindingSignature: canonicalJson(jsonSnapshot(binding)),
    packageSignature: canonicalJson(jsonSnapshot(installation.package)),
    post: artifact.post, commandIdsByEvent: byEvent };
}

export function applicableEmittedPauseEvidence(
  evidence: EmittedPauseEvidence | null,
  input: {
    readonly sourceSignature: string;
    readonly projectIdentity: string;
    readonly hasUnsavedChanges: boolean;
    readonly machines: readonly MachineDefinition[];
    readonly posts: PostLibrary;
  }
): ReadonlyMap<string, readonly string[]> | null {
  if (!evidence || evidence.sourceSignature !== input.sourceSignature ||
      evidence.projectIdentity !== input.projectIdentity || input.hasUnsavedChanges) return null;
  const machine = input.machines.find((candidate) => candidate.id === evidence.machineId);
  const active = machine?.bindings.find((binding) => binding.id === machine.activeBindingId);
  if (!machine || !active || !samePostRef(active.post, evidence.post)) return null;
  const { bindings: _bindings, activeBindingId: _activeBindingId, ...physical } = machine;
  if (canonicalJson(jsonSnapshot(physical)) !== evidence.machineSignature ||
      canonicalJson(jsonSnapshot(active)) !== evidence.bindingSignature) return null;
  const installed = input.posts.installations.find((candidate) => samePostRef(candidate.ref, evidence.post));
  return installed && canonicalJson(jsonSnapshot(installed.package)) === evidence.packageSignature
    ? evidence.commandIdsByEvent : null;
}

async function hash(value: unknown): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(canonicalJson(jsonSnapshot(value))));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function samePostRef(left: ControllerProgramArtifact['post'], right: ControllerProgramArtifact['post']) {
  return left.packageId === right.packageId && left.version === right.version &&
    left.contentHash === right.contentHash;
}
