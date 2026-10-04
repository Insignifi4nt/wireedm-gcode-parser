import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import {
  recoverCatalogPairTransaction,
  type CatalogPairTransactionError
} from '@/domain/storage/catalogPairTransaction';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { commitWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH, WorkbenchFileWriteError } from '@/domain/storage/workbenchFileTransaction';
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
  machineLibrarySizeError,
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

export type ActivateStoredMachinePostBindingResult =
  | { ok: true; library: MachineLibrary; machine: MachineDefinition }
  | {
      ok: false;
      error:
        | PostLibraryStorageError
        | MachineLibraryStorageError
        | CatalogPairTransactionError
        | ActivateBindingError
        | ReplaceMachineError;
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
  | MachineIsRecentError;

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
    const written = await persistMachineLibrary(adapter, replaced.library);
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
    })
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
  library: MachineLibrary
) {
  const expectedRawText = serializeMachineLibraryStorage(library);
  const sizeError = machineLibrarySizeError(expectedRawText);
  if (sizeError) return { ok: false as const, error: sizeError };
  try {
    await commitWorkbenchFileTransaction(adapter, [{ path: MACHINE_LIBRARY_PATH, contents: expectedRawText }]);
    return { ok: true as const };
  } catch (error) {
    return machineLibraryAccessFailure('write', error,
      error instanceof WorkbenchFileWriteError ? error.path : WORKBENCH_FILE_TRANSACTION_PATH);
  }
}

function machineLibraryAccessFailure(operation: 'read' | 'write', error: unknown, path = MACHINE_LIBRARY_PATH) {
  const cause = error instanceof Error ? error.message : String(error);
  return {
    ok: false as const,
    error: {
      code: 'MACHINE_LIBRARY_STORAGE_ACCESS_FAILED' as const,
      message: `Machine library ${operation} failed at ${path}: ${cause}`,
      operation,
      path
    }
  };
}
