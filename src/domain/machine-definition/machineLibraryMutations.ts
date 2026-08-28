import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import {
  resolvePostInstallation,
  type PostInstallationRef,
  type PostLibrary
} from '@/domain/post-processor/postLibrary';
import {
  readPostLibraryStorage,
  type PostLibraryStorageError
} from '@/domain/post-processor/postLibraryStorage';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  removeMachinePostBinding,
  validateMachinePostBindings,
  type CreateMachinePostBindingInput,
  type CreateMachinePostBindingResult,
  type MachineDefinition,
  type MachinePostBinding,
  type RemoveMachinePostBindingResult
} from './machineDefinition';
import {
  installMachineDefinition,
  replaceMachineDefinition,
  type InstallMachineDefinitionResult,
  type MachineLibrary,
  type ReplaceMachineDefinitionResult
} from './machineLibrary';
import {
  readMachineLibraryStorage,
  writeMachineLibraryStorage,
  type MachineLibraryStorageError
} from './machineLibraryStorage';

type CreateBindingError = Extract<CreateMachinePostBindingResult, { ok: false }>['error'];
type RemoveBindingError = Extract<RemoveMachinePostBindingResult, { ok: false }>['error'];
type InstallMachineError = Extract<InstallMachineDefinitionResult, { ok: false }>['error'];
type ReplaceMachineError = Extract<ReplaceMachineDefinitionResult, { ok: false }>['error'];

type MachineImportError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | InstallMachineError
  | {
      code: 'MACHINE_LIBRARY_MUTATION_MACHINE_INVALID';
      message: string;
      diagnostics: Extract<ReturnType<typeof parseMachineDefinition>, { ok: false }>['diagnostics'];
    }
  | {
      code: 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING';
      message: string;
      machineId: string;
      bindingId: string;
    }
  | {
      code: 'MACHINE_LIBRARY_MUTATION_BINDING_INVALID';
      message: string;
      machineId: string;
      bindingId: string;
    };

type CreateStoredMachinePostBindingError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | CreateBindingError
  | ReplaceMachineError
  | { code: 'MACHINE_LIBRARY_MUTATION_POST_NOT_FOUND'; message: string };

type RemoveStoredMachinePostBindingError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | RemoveBindingError
  | ReplaceMachineError;

export type InstallStoredMachineDefinitionResult =
  | {
      ok: true;
      kind: 'installed' | 'already-installed';
      library: MachineLibrary;
      machine: MachineDefinition;
    }
  | { ok: false; error: MachineImportError };

export type CreateStoredMachinePostBindingResult =
  | {
      ok: true;
      library: MachineLibrary;
      machine: MachineDefinition;
      binding: MachinePostBinding;
    }
  | { ok: false; error: CreateStoredMachinePostBindingError };

export type RemoveStoredMachinePostBindingResult =
  | {
      ok: true;
      library: MachineLibrary;
      machine: MachineDefinition;
      removed: MachinePostBinding;
    }
  | { ok: false; error: RemoveStoredMachinePostBindingError };

export async function installStoredMachineDefinition(
  adapter: WorkbenchStorageAdapter,
  rawMachineText: string
): Promise<InstallStoredMachineDefinitionResult> {
  return withWorkbenchMutationLock(adapter, () => installStoredMachineDefinitionUnlocked(
    adapter,
    rawMachineText
  ));
}

async function installStoredMachineDefinitionUnlocked(
  adapter: WorkbenchStorageAdapter,
  rawMachineText: string
): Promise<InstallStoredMachineDefinitionResult> {
  const parsed = parseMachineDefinition(rawMachineText);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MUTATION_MACHINE_INVALID',
        message: 'Uploaded machine definition is invalid.',
        diagnostics: parsed.diagnostics
      }
    };
  }
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const bindingsValid = await validateImportedBindings(parsed.machine, posts.library);
  if (!bindingsValid.ok) return bindingsValid;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const installed = installMachineDefinition(machines.library, parsed.machine);
  if (!installed.ok || installed.kind === 'already-installed') return installed;
  const written = await writeMachineLibraryStorage(adapter, installed.library);
  return written.ok ? installed : written;
}

export async function createStoredMachinePostBinding(
  adapter: WorkbenchStorageAdapter,
  machineId: string,
  postRef: PostInstallationRef,
  input: CreateMachinePostBindingInput
): Promise<CreateStoredMachinePostBindingResult> {
  return withWorkbenchMutationLock(adapter, () => createStoredMachinePostBindingUnlocked(
    adapter,
    machineId,
    postRef,
    input
  ));
}

async function createStoredMachinePostBindingUnlocked(
  adapter: WorkbenchStorageAdapter,
  machineId: string,
  postRef: PostInstallationRef,
  input: CreateMachinePostBindingInput
): Promise<CreateStoredMachinePostBindingResult> {
  const state = await readMutationState(adapter, machineId);
  if (!state.ok) return state;
  const installation = resolvePostInstallation(state.posts, postRef);
  if (!installation.ok) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MUTATION_POST_NOT_FOUND',
        message: installation.error.message
      }
    };
  }
  const created = createMachinePostBinding(state.machine, installation.installation, input);
  if (!created.ok) return created;
  const replaced = replaceMachineDefinition(state.machines, created.machine);
  if (!replaced.ok) return replaced;
  const written = await writeMachineLibraryStorage(adapter, replaced.library);
  return written.ok
    ? { ...replaced, binding: created.binding }
    : written;
}

export async function removeStoredMachinePostBinding(
  adapter: WorkbenchStorageAdapter,
  machineId: string,
  bindingId: string
): Promise<RemoveStoredMachinePostBindingResult> {
  return withWorkbenchMutationLock(adapter, () => removeStoredMachinePostBindingUnlocked(
    adapter,
    machineId,
    bindingId
  ));
}

async function removeStoredMachinePostBindingUnlocked(
  adapter: WorkbenchStorageAdapter,
  machineId: string,
  bindingId: string
): Promise<RemoveStoredMachinePostBindingResult> {
  const state = await readMutationState(adapter, machineId);
  if (!state.ok) return state;
  const removed = removeMachinePostBinding(state.machine, bindingId);
  if (!removed.ok) return removed;
  const replaced = replaceMachineDefinition(state.machines, removed.machine);
  if (!replaced.ok) return replaced;
  const written = await writeMachineLibraryStorage(adapter, replaced.library);
  return written.ok
    ? { ...replaced, removed: removed.removed }
    : written;
}

async function readMutationState(adapter: WorkbenchStorageAdapter, machineId: string) {
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const machine = machines.library.machines.find(({ id }) => id === machineId);
  if (!machine) {
    return {
      ok: false as const,
      error: {
        code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND' as const,
        message: `Machine definition not found: ${machineId}.`,
        machineId
      }
    };
  }
  return {
    ok: true as const,
    posts: posts.library,
    machines: machines.library,
    machine
  };
}

async function validateImportedBindings(
  machine: MachineDefinition,
  posts: PostLibrary
) {
  const validated = await validateMachinePostBindings(machine, posts);
  if (validated.ok) return validated;
  const dangling = validated.error.code === 'MACHINE_POST_BINDING_INSTALLATION_NOT_FOUND';
  return {
    ok: false as const,
    error: {
      code: dangling
        ? 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING' as const
        : 'MACHINE_LIBRARY_MUTATION_BINDING_INVALID' as const,
      message: `Imported machine binding ${machine.id}/${validated.binding.id} is invalid: ${validated.error.message}`,
      machineId: machine.id,
      bindingId: validated.binding.id
    }
  };
}
