import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import { Value } from '@sinclair/typebox/value';
import {
  installPostPackage,
  type PostLibrary
} from '@/domain/post-processor/postLibrary';
import {
  POST_LIBRARY_PATH,
  PostLibraryDocumentSchema,
  writePostLibraryStorage
} from '@/domain/post-processor/postLibraryStorage';
import {
  installMachineDefinition,
  type MachineLibrary
} from '@/domain/machine-definition/machineLibrary';
import {
  MACHINE_LIBRARY_PATH,
  MachineLibraryDocumentSchema,
  writeMachineLibraryStorage
} from '@/domain/machine-definition/machineLibraryStorage';
import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import { validateMachinePostBindings } from '@/domain/machine-definition/machineDefinition';
import type { WireEdmPostPackage } from '@/domain/post-processor/postPackageSchema';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import {
  beginCatalogPairTransaction,
  finishCatalogPairTransaction
} from '@/domain/storage/catalogPairTransaction';
import {
  initializeWorkbenchCatalogUnderMutationLock,
  type ConnectedWorkbenchCatalog
} from '@/domain/workbench-catalog/workbenchCatalog';

import {
  parseMachinePackageArchive,
  type MachinePackage,
  type MachinePackageDiagnostic
} from './machinePackage';

export interface MachinePackagePostPreview {
  readonly kind: 'install' | 'already-installed';
  readonly name: string;
  readonly packageId: string;
  readonly version: string;
  readonly contentHash: string;
  readonly output: WireEdmPostPackage['manifest']['output'];
}

export interface MachineDefinitionChange {
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
}

export type MachinePackageMachinePreview =
  | { readonly kind: 'new'; readonly incoming: MachineDefinition }
  | {
      readonly kind: 'exact';
      readonly incoming: MachineDefinition;
      readonly existing: MachineDefinition;
    }
  | {
      readonly kind: 'changed';
      readonly incoming: MachineDefinition;
      readonly existing: MachineDefinition;
      readonly changes: readonly MachineDefinitionChange[];
    }
  | {
      readonly kind: 'possible';
      readonly incoming: MachineDefinition;
      readonly candidates: readonly MachineDefinition[];
    };

export interface MachinePackageInstallationPreview {
  readonly packageHash: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly machine: MachinePackageMachinePreview;
  readonly posts: readonly MachinePackagePostPreview[];
  readonly activeBindingId: string;
}

export interface PreparedMachinePackageInstallation {
  readonly workbench: ConnectedWorkbenchCatalog;
  readonly package: MachinePackage;
  readonly preparedCatalogFingerprint: string;
  readonly preview: MachinePackageInstallationPreview;
}

export type MachinePackageInstallationResolution =
  | { readonly kind: 'install-new' }
  | {
      readonly kind: 'reuse-existing';
      readonly machineId: string;
      readonly activate: 'package' | 'keep-current';
    }
  | {
      readonly kind: 'replace-existing';
      readonly machineId: string;
      readonly activate: 'package' | 'keep-current';
    };

export type PrepareStoredMachinePackageInstallationResult =
  | {
      readonly ok: true;
      readonly prepared: PreparedMachinePackageInstallation;
      readonly preview: MachinePackageInstallationPreview;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly diagnostics?: readonly MachinePackageDiagnostic[];
    };

export type CommitStoredMachinePackageInstallationResult =
  | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export async function prepareStoredMachinePackageInstallation(
  workbench: ConnectedWorkbenchCatalog,
  archive: Uint8Array
): Promise<PrepareStoredMachinePackageInstallationResult> {
  const parsed = await parseMachinePackageArchive(archive);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_PACKAGE_INVALID',
        message: parsed.diagnostics.map(formatMachinePackageDiagnostic).join('\n')
      },
      diagnostics: parsed.diagnostics
    };
  }
  const preview = await previewInstallation(workbench, parsed.package);
  if (!preview.ok) return preview;
  return {
    ok: true,
    preview: preview.preview,
    prepared: Object.freeze({
      workbench,
      package: parsed.package,
      preview: preview.preview,
      preparedCatalogFingerprint: catalogFingerprint(workbench)
    })
  };
}

function formatMachinePackageDiagnostic(diagnostic: MachinePackageDiagnostic) {
  const location = diagnostic.path ? ` at ${diagnostic.path}` : '';
  const details = [
    ...(diagnostic.postDiagnostics ?? []).map((postDiagnostic) => (
      `${postDiagnostic.code} at ${postDiagnostic.path || '/'}: ${postDiagnostic.message}`
    )),
    ...(diagnostic.conformanceDiagnostics ?? []).map((conformanceDiagnostic) => {
      const fixture = conformanceDiagnostic.fixtureId
        ? ` [fixture ${conformanceDiagnostic.fixtureId}]`
        : '';
      return `${conformanceDiagnostic.code}${fixture}: ${conformanceDiagnostic.message}`;
    })
  ];
  return [
    `${diagnostic.code}${location}: ${diagnostic.message}`,
    ...details.map((detail) => `  ${detail}`)
  ].join('\n');
}

export async function commitStoredMachinePackageInstallation(
  prepared: PreparedMachinePackageInstallation,
  resolution: MachinePackageInstallationResolution
): Promise<CommitStoredMachinePackageInstallationResult> {
  return withWorkbenchMutationLock(prepared.workbench.adapter, async () => {
    const reopened = await initializeWorkbenchCatalogUnderMutationLock(prepared.workbench.adapter);
    if (!reopened.ok) return reopened;
    if (catalogFingerprint(reopened.workbench) !== prepared.preparedCatalogFingerprint) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_PACKAGE_INSTALLATION_STALE',
          message: 'Machine or post storage changed after the installation preview. Review the package again.'
        }
      };
    }
    const previewed = await previewInstallation(reopened.workbench, prepared.package);
    if (!previewed.ok) return previewed;
    const target = resolveTargetMachine(previewed.preview.machine, resolution);
    if (!target.ok) return target;

    let posts = reopened.workbench.posts;
    for (const packageValue of prepared.package.document.posts) {
      const installed = await installPostPackage(posts, packageValue);
      if (!installed.ok) return installed;
      posts = installed.library;
    }
    const mergedMachine = mergeMachine(
      target.machine,
      prepared.package.document.machine,
      target.preserveExistingPhysical,
      target.activatePackageBinding
        ? prepared.package.document.activeBindingId
        : target.machine
          ? target.machine.activeBindingId
          : prepared.package.document.activeBindingId
    );
    if (!mergedMachine.ok) return mergedMachine;
    const mergedBindings = await validateMachinePostBindings(mergedMachine.machine, posts);
    if (!mergedBindings.ok) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_PACKAGE_MERGED_MACHINE_INVALID',
          message: `Merged setup ${mergedBindings.binding.id} is invalid for the selected physical machine: ${mergedBindings.error.message}`
        }
      };
    }
    const machines = installOrReplaceMachine(reopened.workbench.machines, mergedMachine.machine);
    if (!machines.ok) return machines;
    const mergedCatalogs = validateMergedCatalogs(posts, machines.library);
    if (!mergedCatalogs.ok) return mergedCatalogs;

    if (
      canonicalJson(posts) === canonicalJson(reopened.workbench.posts) &&
      canonicalJson(machines.library) === canonicalJson(reopened.workbench.machines)
    ) {
      return {
        ok: true,
        workbench: Object.freeze({ ...reopened.workbench, posts, machines: machines.library })
      };
    }

    const persisted = await persistCatalogsAtomically(
      reopened.workbench.adapter,
      posts,
      machines.library
    );
    if (!persisted.ok) return persisted;
    return {
      ok: true,
      workbench: Object.freeze({ ...reopened.workbench, posts, machines: machines.library })
    };
  });
}

async function previewInstallation(
  workbench: ConnectedWorkbenchCatalog,
  machinePackage: MachinePackage
): Promise<
  | { readonly ok: true; readonly preview: MachinePackageInstallationPreview }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
> {
  const postPreviews: MachinePackagePostPreview[] = [];
  let simulatedPosts = workbench.posts;
  for (const packageValue of machinePackage.document.posts) {
    const installed = await installPostPackage(simulatedPosts, packageValue);
    if (!installed.ok) return installed;
    postPreviews.push({
      kind: installed.kind === 'installed' ? 'install' : 'already-installed',
      name: installed.installation.package.manifest.name,
      packageId: installed.installation.ref.packageId,
      version: installed.installation.ref.version,
      contentHash: installed.installation.ref.contentHash,
      output: installed.installation.package.manifest.output
    });
    simulatedPosts = installed.library;
  }

  return {
    ok: true,
    preview: deepFreeze({
      packageHash: machinePackage.contentHash,
      packageName: machinePackage.document.manifest.name,
      packageVersion: machinePackage.document.manifest.version,
      machine: classifyMachine(machinePackage.document.machine, workbench.machines),
      posts: postPreviews,
      activeBindingId: machinePackage.document.activeBindingId
    })
  };
}

function classifyMachine(
  incoming: MachineDefinition,
  library: MachineLibrary
): MachinePackageMachinePreview {
  const sameId = library.machines.find(({ id }) => id === incoming.id);
  if (sameId) {
    return physicalMachineJson(sameId) === physicalMachineJson(incoming)
      ? { kind: 'exact', incoming, existing: sameId }
      : {
          kind: 'changed',
          incoming,
          existing: sameId,
          changes: physicalMachineChanges(sameId, incoming)
        };
  }
  const candidates = library.machines.filter((existing) => possibleMachineMatch(existing, incoming));
  return candidates.length > 0
    ? { kind: 'possible', incoming, candidates }
    : { kind: 'new', incoming };
}

function possibleMachineMatch(left: MachineDefinition, right: MachineDefinition) {
  const leftSerial = left.identity.serialNumber;
  const rightSerial = right.identity.serialNumber;
  if (leftSerial && rightSerial) return leftSerial === rightSerial;
  return (
    left.identity.manufacturer === right.identity.manufacturer &&
    left.identity.model === right.identity.model &&
    left.identity.controller.manufacturer === right.identity.controller.manufacturer &&
    left.identity.controller.model === right.identity.controller.model
  );
}

function resolveTargetMachine(
  preview: MachinePackageMachinePreview,
  resolution: MachinePackageInstallationResolution
):
  | {
      readonly ok: true;
      readonly machine: MachineDefinition | null;
      readonly activatePackageBinding: boolean;
      readonly preserveExistingPhysical: boolean;
    }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  if (preview.kind === 'new' && resolution.kind === 'install-new') {
    return { ok: true, machine: null, activatePackageBinding: true, preserveExistingPhysical: false };
  }
  if (preview.kind === 'possible' && resolution.kind === 'install-new') {
    return { ok: true, machine: null, activatePackageBinding: true, preserveExistingPhysical: false };
  }
  if (preview.kind === 'exact' && resolution.kind === 'reuse-existing' && resolution.machineId === preview.existing.id) {
    return {
      ok: true,
      machine: preview.existing,
      activatePackageBinding: resolution.activate === 'package',
      preserveExistingPhysical: true
    };
  }
  if (preview.kind === 'changed' && resolution.kind === 'replace-existing' && resolution.machineId === preview.existing.id) {
    return {
      ok: true,
      machine: preview.existing,
      activatePackageBinding: resolution.activate === 'package',
      preserveExistingPhysical: false
    };
  }
  if (preview.kind === 'possible' && resolution.kind === 'reuse-existing') {
    const candidate = preview.candidates.find(({ id }) => id === resolution.machineId);
    if (candidate) {
      return {
        ok: true,
        machine: candidate,
        activatePackageBinding: resolution.activate === 'package',
        preserveExistingPhysical: true
      };
    }
  }
  return {
    ok: false,
    error: {
      code: 'MACHINE_PACKAGE_RESOLUTION_INVALID',
      message: `Installation choice ${resolution.kind} does not resolve the detected ${preview.kind} machine state.`
    }
  };
}

function mergeMachine(
  existing: MachineDefinition | null,
  incoming: MachineDefinition,
  preserveExistingPhysical: boolean,
  activeBindingId: string | null
):
  | { readonly ok: true; readonly machine: MachineDefinition }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  if (!existing) {
    return {
      ok: true,
      machine: deepFreeze({ ...incoming, activeBindingId })
    };
  }
  const bindings = [...existing.bindings];
  for (const incomingBinding of incoming.bindings) {
    const sameId = bindings.find(({ id }) => id === incomingBinding.id);
    if (!sameId) {
      bindings.push(incomingBinding);
      continue;
    }
    if (canonicalJson(sameId) !== canonicalJson(incomingBinding)) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_PACKAGE_SETUP_CONFLICT',
          message: `Machine setup ${incomingBinding.id} already exists with different content.`
        }
      };
    }
  }
  return {
    ok: true,
    machine: deepFreeze({
      ...(preserveExistingPhysical ? existing : incoming),
      id: existing.id,
      bindings,
      activeBindingId
    })
  };
}

function installOrReplaceMachine(
  library: MachineLibrary,
  machine: MachineDefinition
) {
  const existing = library.machines.find(({ id }) => id === machine.id);
  if (!existing) return installMachineDefinition(library, machine);
  return {
    ok: true as const,
    library: deepFreeze({
      schemaVersion: 1 as const,
      machines: library.machines.map((candidate) => candidate.id === machine.id ? machine : candidate)
    }),
    machine
  };
}

function validateMergedCatalogs(
  posts: PostLibrary,
  machines: MachineLibrary
): { readonly ok: true } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } } {
  const catalogs = [
    {
      name: 'post',
      schema: PostLibraryDocumentSchema,
      value: {
        format: 'wire-edm-post-library',
        schemaVersion: 1,
        installations: posts.installations
      }
    },
    {
      name: 'machine',
      schema: MachineLibraryDocumentSchema,
      value: {
        format: 'wire-edm-machine-library',
        schemaVersion: 1,
        machines: machines.machines
      }
    }
  ] as const;
  for (const catalog of catalogs) {
    const error = Value.Errors(catalog.schema, catalog.value).First();
    if (error) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_PACKAGE_MERGED_CATALOG_INVALID',
          message: `Merged ${catalog.name} catalog schema violation at ${error.path || '/'}: ${error.message}.`
        }
      };
    }
  }
  return { ok: true };
}

async function persistCatalogsAtomically(
  adapter: WorkbenchStorageAdapter,
  posts: PostLibrary,
  machines: MachineLibrary
): Promise<
  | { readonly ok: true }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
> {
  const beforePosts = await readRequired(adapter, POST_LIBRARY_PATH);
  if (!beforePosts.ok) return beforePosts;
  const beforeMachines = await readRequired(adapter, MACHINE_LIBRARY_PATH);
  if (!beforeMachines.ok) return beforeMachines;

  const expectedPosts = JSON.stringify({
    format: 'wire-edm-post-library',
    schemaVersion: 1,
    installations: posts.installations
  }, null, 2);
  const expectedMachines = JSON.stringify({
    format: 'wire-edm-machine-library',
    schemaVersion: 1,
    machines: machines.machines
  }, null, 2);
  const transaction = await beginCatalogPairTransaction(adapter, {
    previousPosts: beforePosts.text,
    previousMachines: beforeMachines.text,
    nextPosts: expectedPosts,
    nextMachines: expectedMachines
  });
  if (!transaction.ok) return transaction;

  const postWrite = await writePostLibraryStorage(adapter, posts);
  if (!postWrite.ok) {
    return rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, postWrite);
  }
  const machineWrite = await writeMachineLibraryStorage(adapter, machines);
  if (!machineWrite.ok) {
    return rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, machineWrite);
  }
  const postReadback = await readRequired(adapter, POST_LIBRARY_PATH);
  if (!postReadback.ok) {
    return rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, postReadback);
  }
  const machineReadback = await readRequired(adapter, MACHINE_LIBRARY_PATH);
  if (!machineReadback.ok) {
    return rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, machineReadback);
  }
  if (postReadback.text !== expectedPosts || machineReadback.text !== expectedMachines) {
    return rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, {
      ok: false,
      error: {
        code: 'MACHINE_PACKAGE_INSTALLATION_READBACK_MISMATCH',
        message: 'Installed machine and post catalogs did not read back byte-for-byte.'
      }
    });
  }
  const finished = await finishCatalogPairTransaction(adapter);
  return finished.ok
    ? { ok: true }
    : rollbackCatalogs(adapter, beforePosts.text, beforeMachines.text, finished);
}

async function rollbackCatalogs(
  adapter: WorkbenchStorageAdapter,
  previousPosts: string,
  previousMachines: string,
  original: { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
) {
  const restoredPosts = await restore(adapter, POST_LIBRARY_PATH, previousPosts);
  const restoredMachines = await restore(adapter, MACHINE_LIBRARY_PATH, previousMachines);
  if (restoredPosts.ok && restoredMachines.ok) {
    const finished = await finishCatalogPairTransaction(adapter);
    if (finished.ok) return original;
  }
  return {
    ok: false,
    error: {
      code: 'MACHINE_PACKAGE_INSTALLATION_ROLLBACK_FAILED',
      message: 'Machine package installation failed and the previous catalog bytes could not be restored.'
    }
  };
}

async function readRequired(adapter: WorkbenchStorageAdapter, path: string) {
  try {
    const text = await readExact(adapter, path);
    return text === null
      ? {
          ok: false as const,
          error: {
            code: 'MACHINE_PACKAGE_INSTALLATION_STORAGE_MISSING',
            message: `Required workbench storage file is missing: ${path}.`
          }
        }
      : { ok: true as const, text };
  } catch (error) {
    return {
      ok: false as const,
      error: {
        code: 'MACHINE_PACKAGE_INSTALLATION_STORAGE_FAILED',
        message: `Could not read ${path}: ${errorMessage(error)}.`
      }
    };
  }
}

async function restore(adapter: WorkbenchStorageAdapter, path: string, text: string) {
  try {
    await adapter.writeText(path, text);
    return await readExact(adapter, path) === text
      ? { ok: true as const }
      : { ok: false as const };
  } catch {
    return { ok: false as const };
  }
}

function readExact(adapter: WorkbenchStorageAdapter, path: string) {
  return adapter.readExactText?.(path) ?? adapter.readText(path);
}

function physicalMachineJson(machine: MachineDefinition) {
  return canonicalJson(physicalMachineSnapshot(machine));
}

function physicalMachineSnapshot(machine: MachineDefinition) {
  return {
    format: machine.format,
    schemaVersion: machine.schemaVersion,
    id: machine.id,
    name: machine.name,
    identity: machine.identity,
    limits: machine.limits,
    hardware: machine.hardware,
    evidence: machine.evidence,
    notes: machine.notes
  };
}

function physicalMachineChanges(
  before: MachineDefinition,
  after: MachineDefinition
): readonly MachineDefinitionChange[] {
  const fields = [
    ['/name', before.name, after.name],
    ['/identity/manufacturer', before.identity.manufacturer, after.identity.manufacturer],
    ['/identity/model', before.identity.model, after.identity.model],
    ['/identity/serialNumber', before.identity.serialNumber, after.identity.serialNumber],
    ['/identity/controller/manufacturer', before.identity.controller.manufacturer, after.identity.controller.manufacturer],
    ['/identity/controller/model', before.identity.controller.model, after.identity.controller.model],
    ['/identity/controller/firmware', before.identity.controller.firmware, after.identity.controller.firmware],
    ['/limits/xTravel', before.limits.xTravel, after.limits.xTravel],
    ['/limits/yTravel', before.limits.yTravel, after.limits.yTravel],
    ['/hardware/manualThreading', before.hardware.manualThreading, after.hardware.manualThreading],
    ['/hardware/automaticThreading', before.hardware.automaticThreading, after.hardware.automaticThreading],
    ['/evidence', before.evidence, after.evidence],
    ['/notes', before.notes, after.notes]
  ] as const;
  return fields
    .filter(([, left, right]) => canonicalJson(left) !== canonicalJson(right))
    .map(([path, left, right]) => ({ path, before: left, after: right }));
}

function catalogFingerprint(workbench: ConnectedWorkbenchCatalog) {
  return canonicalJson({
    machines: workbench.machines,
    posts: workbench.posts
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
