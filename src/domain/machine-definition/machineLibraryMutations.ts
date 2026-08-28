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
  parseWorkbenchCatalogManifest,
  WORKBENCH_CATALOG_PATH,
  type ConnectedWorkbenchCatalog,
  type WorkbenchCatalogError
} from '@/domain/workbench-catalog/workbenchCatalog';
import { validateWorkbenchProjectPathOwnership } from '@/domain/workbench-catalog/workbenchProjectStorage';

import {
  createMachinePostBinding,
  parseMachineDefinition,
  removeMachinePostBinding,
  validateMachinePostBindings,
  type CreateMachinePostBindingInput,
  type CreateMachinePostBindingResult,
  type MachineDefinition,
  type MachinePostBinding,
  type RemoveMachinePostBindingResult,
} from './machineDefinition';
import {
  installMachineDefinition,
  removeMachineDefinition,
  replaceMachineDefinition,
  type InstallMachineDefinitionResult,
  type MachineLibrary,
  type RemoveMachineDefinitionResult,
  type ReplaceMachineDefinitionResult
} from './machineLibrary';
import {
  MACHINE_LIBRARY_PATH,
  readMachineLibraryStorage,
  serializeMachineLibraryStorage,
  writeMachineLibraryStorage,
  type MachineLibraryStorageError
} from './machineLibraryStorage';

type CreateBindingError = Extract<CreateMachinePostBindingResult, { ok: false }>['error'];
type RemoveBindingError = Extract<RemoveMachinePostBindingResult, { ok: false }>['error'];
type InstallMachineError = Extract<InstallMachineDefinitionResult, { ok: false }>['error'];
type ReplaceMachineError = Extract<ReplaceMachineDefinitionResult, { ok: false }>['error'];
type RemoveMachineError = Extract<RemoveMachineDefinitionResult, { ok: false }>['error'];

type MachineMutationCatalogMissingError = {
  code: 'MACHINE_LIBRARY_MUTATION_CATALOG_MISSING';
  message: string;
  path: typeof WORKBENCH_CATALOG_PATH;
};

type MachineDefinitionInputError = {
  code: 'MACHINE_LIBRARY_MUTATION_MACHINE_INVALID';
  message: string;
  diagnostics: Extract<ReturnType<typeof parseMachineDefinition>, { ok: false }>['diagnostics'];
};

type MachineLibraryMutationReadbackError = {
  code: 'MACHINE_LIBRARY_MUTATION_READBACK_MISMATCH';
  message: string;
  path: typeof MACHINE_LIBRARY_PATH;
};

type MachineLibraryMutationRollbackError = {
  code: 'MACHINE_LIBRARY_MUTATION_ROLLBACK_FAILED';
  message: string;
  originalError: MachineLibraryStorageError | MachineLibraryMutationReadbackError;
  rollbackError: MachineLibraryStorageError;
};

type MachineLibraryMutationPersistenceError =
  | MachineLibraryMutationReadbackError
  | MachineLibraryMutationRollbackError;

type MachineImportError =
  | PostLibraryStorageError
  | MachineLibraryStorageError
  | InstallMachineError
  | MachineDefinitionInputError
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

export type ReplaceStoredMachineDefinitionError =
  | WorkbenchCatalogError
  | MachineMutationCatalogMissingError
  | MachineDefinitionInputError
  | Extract<MachineImportError, {
      code:
        | 'MACHINE_LIBRARY_MUTATION_DANGLING_POST_BINDING'
        | 'MACHINE_LIBRARY_MUTATION_BINDING_INVALID';
    }>
  | ReplaceMachineError
  | MachineLibraryMutationPersistenceError;

export type ReplaceStoredMachineDefinitionResult =
  | {
      ok: true;
      workbench: ConnectedWorkbenchCatalog;
      library: MachineLibrary;
      machine: MachineDefinition;
    }
  | { ok: false; error: ReplaceStoredMachineDefinitionError };

type MachineIsRecentError = {
  code: 'MACHINE_LIBRARY_MUTATION_MACHINE_IS_RECENT';
  message: string;
  machineId: string;
};

export type RemoveStoredMachineDefinitionError =
  | WorkbenchCatalogError
  | MachineMutationCatalogMissingError
  | RemoveMachineError
  | MachineIsRecentError
  | MachineLibraryMutationPersistenceError;

export type RemoveStoredMachineDefinitionResult =
  | {
      ok: true;
      workbench: ConnectedWorkbenchCatalog;
      library: MachineLibrary;
      removed: MachineDefinition;
    }
  | { ok: false; error: RemoveStoredMachineDefinitionError };

export async function installStoredMachineDefinition(
  adapter: WorkbenchStorageAdapter,
  rawMachineText: string
): Promise<InstallStoredMachineDefinitionResult> {
  return withWorkbenchMutationLock(adapter, () => installStoredMachineDefinitionUnlocked(
    adapter,
    rawMachineText
  ));
}

export async function replaceStoredMachineDefinition(
  workbench: ConnectedWorkbenchCatalog,
  rawMachineText: string
): Promise<ReplaceStoredMachineDefinitionResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const parsed = parseMachineDefinition(rawMachineText);
    if (!parsed.ok) return invalidMachineDefinition(parsed.diagnostics);
    const state = await readAuthoritativeCatalog(workbench.adapter);
    if (!state.ok) return state;
    const bindingsValid = await validateImportedBindings(parsed.machine, state.workbench.posts);
    if (!bindingsValid.ok) return bindingsValid;
    const replaced = replaceMachineDefinition(state.workbench.machines, parsed.machine);
    if (!replaced.ok) return replaced;
    const written = await persistMachineLibrary(
      workbench.adapter,
      state.machineLibraryRaw,
      replaced.library
    );
    if (!written.ok) return written;
    return {
      ok: true,
      machine: replaced.machine,
      library: replaced.library,
      workbench: Object.freeze({ ...state.workbench, machines: replaced.library })
    };
  });
}

export async function removeStoredMachineDefinition(
  workbench: ConnectedWorkbenchCatalog,
  machineId: string
): Promise<RemoveStoredMachineDefinitionResult> {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const state = await readAuthoritativeCatalog(workbench.adapter);
    if (!state.ok) return state;
    if (state.workbench.manifest.preferences.recentPlanningMachineId === machineId) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_LIBRARY_MUTATION_MACHINE_IS_RECENT',
          message: `Machine ${machineId} is the explicit recent planning machine. Clear or change that preference before removal.`,
          machineId
        }
      };
    }
    const removed = removeMachineDefinition(state.workbench.machines, machineId);
    if (!removed.ok) return removed;
    const written = await persistMachineLibrary(
      workbench.adapter,
      state.machineLibraryRaw,
      removed.library
    );
    if (!written.ok) return written;
    return {
      ok: true,
      removed: removed.removed,
      library: removed.library,
      workbench: Object.freeze({ ...state.workbench, machines: removed.library })
    };
  });
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

function machineNotFound(machineId: string) {
  return {
    ok: false as const,
    error: {
      code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND' as const,
      message: `Machine definition not found: ${machineId}.`,
      machineId
    }
  };
}

async function readAuthoritativeCatalog(adapter: WorkbenchStorageAdapter) {
  let rawManifest: string | null;
  try {
    rawManifest = await adapter.readText(WORKBENCH_CATALOG_PATH);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      ok: false as const,
      error: {
        code: 'WORKBENCH_CATALOG_ACCESS_FAILED' as const,
        message: `Workbench catalog read failed at ${WORKBENCH_CATALOG_PATH}: ${cause}`,
        operation: 'read' as const,
        path: WORKBENCH_CATALOG_PATH
      }
    };
  }
  if (rawManifest === null) {
    return catalogMissing();
  }
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const machineLibraryRaw = await readMachineLibraryRaw(adapter);
  if (!machineLibraryRaw.ok) return machineLibraryRaw;
  const manifest = parseWorkbenchCatalogManifest(rawManifest, machines.library);
  if (!manifest.ok) return manifest;
  const ownership = await validateWorkbenchProjectPathOwnership(
    adapter,
    manifest.manifest.projects
  );
  if (!ownership.ok) return ownership;
  return {
    ok: true as const,
    workbench: Object.freeze({
      adapter,
      manifest: manifest.manifest,
      posts: posts.library,
      machines: machines.library
    }),
    machineLibraryRaw: machineLibraryRaw.rawText
  };
}

function catalogMissing(): { ok: false; error: MachineMutationCatalogMissingError } {
  return {
    ok: false,
    error: {
      code: 'MACHINE_LIBRARY_MUTATION_CATALOG_MISSING',
      message: `Connected workbench manifest is missing: ${WORKBENCH_CATALOG_PATH}.`,
      path: WORKBENCH_CATALOG_PATH
    }
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

function invalidMachineDefinition(
  diagnostics: MachineDefinitionInputError['diagnostics']
): { ok: false; error: MachineDefinitionInputError } {
  return {
    ok: false,
    error: {
      code: 'MACHINE_LIBRARY_MUTATION_MACHINE_INVALID',
      message: 'Uploaded machine definition is invalid.',
      diagnostics
    }
  };
}

async function persistMachineLibrary(
  adapter: WorkbenchStorageAdapter,
  previousRawText: string,
  library: MachineLibrary
) {
  const expectedRawText = serializeMachineLibraryStorage(library);
  const written = await writeMachineLibraryStorage(adapter, library);
  if (!written.ok) return rollbackMachineLibrary(adapter, previousRawText, written.error);
  const readback = await readMachineLibraryRaw(adapter);
  if (!readback.ok) return rollbackMachineLibrary(adapter, previousRawText, readback.error);
  if (readback.rawText !== expectedRawText) {
    return rollbackMachineLibrary(adapter, previousRawText, {
      code: 'MACHINE_LIBRARY_MUTATION_READBACK_MISMATCH',
      message: `Machine library did not read back byte-for-byte at ${MACHINE_LIBRARY_PATH}.`,
      path: MACHINE_LIBRARY_PATH
    });
  }
  return { ok: true as const };
}

async function rollbackMachineLibrary(
  adapter: WorkbenchStorageAdapter,
  previousRawText: string,
  originalError: MachineLibraryStorageError | MachineLibraryMutationReadbackError
) {
  const restored = await writeMachineLibraryRaw(adapter, previousRawText);
  if (restored.ok) return { ok: false as const, error: originalError };
  return {
    ok: false as const,
    error: {
      code: 'MACHINE_LIBRARY_MUTATION_ROLLBACK_FAILED' as const,
      message: 'Machine library mutation failed and the exact previous bytes could not be restored.',
      originalError,
      rollbackError: restored.error
    }
  };
}

async function readMachineLibraryRaw(adapter: WorkbenchStorageAdapter) {
  try {
    const rawText = await adapter.readText(MACHINE_LIBRARY_PATH);
    if (rawText !== null) return { ok: true as const, rawText };
    return {
      ok: false as const,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_NOT_FOUND' as const,
        message: `Machine library file does not exist: ${MACHINE_LIBRARY_PATH}.`
      }
    };
  } catch (error) {
    return machineLibraryAccessFailure('read', error);
  }
}

async function writeMachineLibraryRaw(adapter: WorkbenchStorageAdapter, rawText: string) {
  try {
    await adapter.writeText(MACHINE_LIBRARY_PATH, rawText);
    return { ok: true as const };
  } catch (error) {
    return machineLibraryAccessFailure('write', error);
  }
}

function machineLibraryAccessFailure(
  operation: 'read' | 'write',
  error: unknown
) {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    ok: false as const,
    error: {
      code: 'MACHINE_LIBRARY_STORAGE_ACCESS_FAILED' as const,
      message: `Machine library ${operation} failed at ${MACHINE_LIBRARY_PATH}: ${cause}`,
      operation,
      path: MACHINE_LIBRARY_PATH
    }
  };
}
