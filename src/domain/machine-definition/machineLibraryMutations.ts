import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  recoverCatalogPairTransaction,
  type CatalogPairTransactionError
} from '@/domain/storage/catalogPairTransaction';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
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

import { activateMachinePostBinding, type MachineDefinition } from './machineDefinition';
import {
  removeMachineDefinition,
  replaceMachineDefinition,
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

type ActivateBindingError = Extract<ReturnType<typeof activateMachinePostBinding>, { ok: false }>['error'];
type ReplaceMachineError = Extract<ReplaceMachineDefinitionResult, { ok: false }>['error'];
type RemoveMachineError = Extract<RemoveMachineDefinitionResult, { ok: false }>['error'];

type MachineMutationCatalogMissingError = {
  code: 'MACHINE_LIBRARY_MUTATION_CATALOG_MISSING';
  message: string;
  path: typeof WORKBENCH_CATALOG_PATH;
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

export type ActivateStoredMachinePostBindingResult =
  | { ok: true; library: MachineLibrary; machine: MachineDefinition }
  | {
      ok: false;
      error:
        | PostLibraryStorageError
        | MachineLibraryStorageError
        | CatalogPairTransactionError
        | ActivateBindingError
        | ReplaceMachineError
        | MachineLibraryMutationPersistenceError;
    };

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

export async function activateStoredMachinePostBinding(
  adapter: WorkbenchStorageAdapter,
  machineId: string,
  bindingId: string
): Promise<ActivateStoredMachinePostBindingResult> {
  return withWorkbenchMutationLock(adapter, async () => {
    const state = await readMutationState(adapter, machineId);
    if (!state.ok) return state;
    const activated = activateMachinePostBinding(state.machine, bindingId);
    if (!activated.ok) return activated;
    const replaced = replaceMachineDefinition(state.machines, activated.machine);
    if (!replaced.ok) return replaced;
    const previousRaw = await readMachineLibraryRaw(adapter);
    if (!previousRaw.ok) return previousRaw;
    const written = await persistMachineLibrary(adapter, previousRaw.rawText, replaced.library);
    return written.ok
      ? { ok: true, machine: activated.machine, library: replaced.library }
      : written;
  });
}

async function readMutationState(adapter: WorkbenchStorageAdapter, machineId: string) {
  const recovered = await recoverCatalogPairTransaction(adapter);
  if (!recovered.ok) return recovered;
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
  return { ok: true as const, machines: machines.library, machine };
}

async function readAuthoritativeCatalog(adapter: WorkbenchStorageAdapter) {
  const recovered = await recoverCatalogPairTransaction(adapter);
  if (!recovered.ok) return recovered;
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
  if (rawManifest === null) return catalogMissing();
  const posts = await readPostLibraryStorage(adapter);
  if (!posts.ok) return posts;
  const machines = await readMachineLibraryStorage(adapter, posts.library);
  if (!machines.ok) return machines;
  const machineLibraryRaw = await readMachineLibraryRaw(adapter);
  if (!machineLibraryRaw.ok) return machineLibraryRaw;
  const manifest = parseWorkbenchCatalogManifest(rawManifest, machines.library);
  if (!manifest.ok) return manifest;
  const ownership = await validateWorkbenchProjectPathOwnership(adapter, manifest.manifest.projects);
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

function machineLibraryAccessFailure(operation: 'read' | 'write', error: unknown) {
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
