import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import type { PostLibrary } from '@/domain/post-processor/postLibrary';

import {
  MachineDefinitionSchema,
  validateMachinePostBindings,
  validateMachineDefinitionSemantics,
  type MachineDefinitionValue,
  type MachineDefinitionDiagnostic
} from './machineDefinition';
import {
  createEmptyMachineLibrary,
  installMachineDefinition,
  type MachineLibrary
} from './machineLibrary';

export const MACHINE_LIBRARY_DIRECTORY = 'machines';
export const MACHINE_LIBRARY_PATH = `${MACHINE_LIBRARY_DIRECTORY}/library.json`;
export const MAX_MACHINE_LIBRARY_BYTES = 8 * 1024 * 1024;
export const MAX_MACHINE_DEFINITIONS = 256;

export const MachineLibraryDocumentSchema = Type.Object({
  format: Type.Literal('wire-edm-machine-library'),
  schemaVersion: Type.Literal(1),
  machines: Type.Array(MachineDefinitionSchema, { maxItems: MAX_MACHINE_DEFINITIONS })
}, {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://wire-edm.local/schemas/wire-edm-machine-library-v1.json',
  additionalProperties: false
});

type MachineLibraryDocument = Static<typeof MachineLibraryDocumentSchema>;

export type MachineLibraryStorageError =
  | { code: 'MACHINE_LIBRARY_STORAGE_NOT_FOUND'; message: string }
  | { code: 'MACHINE_LIBRARY_STORAGE_TOO_LARGE'; message: string; actualBytes: number; maximumBytes: number }
  | { code: 'MACHINE_LIBRARY_STORAGE_JSON_INVALID'; message: string }
  | { code: 'MACHINE_LIBRARY_STORAGE_SCHEMA_INVALID'; message: string; path: string }
  | {
      code: 'MACHINE_LIBRARY_STORAGE_MACHINE_INVALID';
      message: string;
      path: string;
      diagnostics: readonly MachineDefinitionDiagnostic[];
    }
  | { code: 'MACHINE_LIBRARY_STORAGE_DUPLICATE_MACHINE'; message: string; path: string }
  | {
      code: 'MACHINE_LIBRARY_STORAGE_DANGLING_POST_BINDING';
      message: string;
      path: string;
      machineId: string;
      bindingId: string;
    }
  | {
      code: 'MACHINE_LIBRARY_STORAGE_BINDING_INVALID';
      message: string;
      path: string;
      machineId: string;
      bindingId: string;
    }
  | {
      code: 'MACHINE_LIBRARY_STORAGE_ACCESS_FAILED';
      message: string;
      operation: 'ensure-directory' | 'read' | 'write';
      path: string;
    };

export type ReadMachineLibraryStorageResult =
  | { ok: true; library: MachineLibrary }
  | { ok: false; error: MachineLibraryStorageError };

export type WriteMachineLibraryStorageResult =
  | { ok: true }
  | { ok: false; error: MachineLibraryStorageError };

export type InitializeMachineLibraryStorageResult =
  | { ok: true; kind: 'created' | 'opened'; library: MachineLibrary }
  | { ok: false; error: MachineLibraryStorageError };

export async function initializeMachineLibraryStorage(
  adapter: WorkbenchStorageAdapter,
  posts: PostLibrary
): Promise<InitializeMachineLibraryStorageResult> {
  const ensured = await accessStorage(
    'ensure-directory',
    MACHINE_LIBRARY_DIRECTORY,
    () => adapter.ensureDirectory(MACHINE_LIBRARY_DIRECTORY)
  );
  if (!ensured.ok) return ensured;
  const read = await readStorageText(adapter);
  if (!read.ok) return read;
  if (read.rawText === null) {
    const library = createEmptyMachineLibrary();
    const written = await writeMachineLibraryStorage(adapter, library);
    return written.ok ? { ok: true, kind: 'created', library } : written;
  }
  const opened = await parseStoredMachineLibrary(read.rawText, posts);
  return opened.ok ? { ok: true, kind: 'opened', library: opened.library } : opened;
}

export async function readMachineLibraryStorage(
  adapter: WorkbenchStorageAdapter,
  posts: PostLibrary
): Promise<ReadMachineLibraryStorageResult> {
  const read = await readStorageText(adapter);
  if (!read.ok) return read;
  if (read.rawText === null) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_NOT_FOUND',
        message: `Machine library file does not exist: ${MACHINE_LIBRARY_PATH}.`
      }
    };
  }
  return parseStoredMachineLibrary(read.rawText, posts);
}

export async function writeMachineLibraryStorage(
  adapter: WorkbenchStorageAdapter,
  library: MachineLibrary
): Promise<WriteMachineLibraryStorageResult> {
  const rawText = serializeMachineLibraryStorage(library);
  const sizeError = machineLibrarySizeError(rawText);
  if (sizeError) return { ok: false, error: sizeError };
  return accessStorage('write', MACHINE_LIBRARY_PATH, () => (
    adapter.writeText(MACHINE_LIBRARY_PATH, rawText)
  ));
}

export function serializeMachineLibraryStorage(library: MachineLibrary) {
  const document = {
    format: 'wire-edm-machine-library',
    schemaVersion: 1,
    machines: [...library.machines]
  } as const;
  return JSON.stringify(document, null, 2);
}

async function parseStoredMachineLibrary(
  rawText: string,
  posts: PostLibrary
): Promise<ReadMachineLibraryStorageResult> {
  const sizeError = machineLibrarySizeError(rawText);
  if (sizeError) return { ok: false, error: sizeError };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_JSON_INVALID',
        message: 'Machine library file is not valid JSON.'
      }
    };
  }
  parsed = addLegacyActiveMachineSetups(parsed);
  const schemaError = Value.Errors(MachineLibraryDocumentSchema, parsed).First();
  if (schemaError) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_STORAGE_SCHEMA_INVALID',
        message: `Machine library schema violation at ${schemaError.path || '/'}: ${schemaError.message}.`,
        path: schemaError.path
      }
    };
  }

  const document = parsed as MachineLibraryDocument;
  let library = createEmptyMachineLibrary();
  for (const [machineIndex, value] of document.machines.entries()) {
    const parsedMachine = validateMachineDefinitionSemantics(value as MachineDefinitionValue);
    if (!parsedMachine.ok) {
      return {
        ok: false,
        error: {
          code: 'MACHINE_LIBRARY_STORAGE_MACHINE_INVALID',
          message: `Stored machine at /machines/${machineIndex} is invalid.`,
          path: `/machines/${machineIndex}`,
          diagnostics: parsedMachine.diagnostics
        }
      };
    }

    const bindingsValid = await validateMachinePostBindings(parsedMachine.machine, posts);
    if (!bindingsValid.ok) {
      const bindingIndex = parsedMachine.machine.bindings.indexOf(bindingsValid.binding);
      const path = `/machines/${machineIndex}/bindings/${bindingIndex}`;
      if (bindingsValid.error.code === 'MACHINE_POST_BINDING_INSTALLATION_NOT_FOUND') {
        return {
          ok: false,
          error: {
            code: 'MACHINE_LIBRARY_STORAGE_DANGLING_POST_BINDING',
            message: bindingsValid.error.message,
            path: `${path}/post`,
            machineId: parsedMachine.machine.id,
            bindingId: bindingsValid.binding.id
          }
        };
      }
      return {
        ok: false,
        error: {
          code: 'MACHINE_LIBRARY_STORAGE_BINDING_INVALID',
          message: bindingsValid.error.message,
          path,
          machineId: parsedMachine.machine.id,
          bindingId: bindingsValid.binding.id
        }
      };
    }

    const installed = installMachineDefinition(library, parsedMachine.machine);
    if (!installed.ok || installed.kind === 'already-installed') {
      return {
        ok: false,
        error: {
          code: 'MACHINE_LIBRARY_STORAGE_DUPLICATE_MACHINE',
          message: `Machine definition ${parsedMachine.machine.id} is duplicated.`,
          path: `/machines/${machineIndex}`
        }
      };
    }
    library = installed.library;
  }
  return { ok: true, library };
}

function addLegacyActiveMachineSetups(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const document = value as Record<string, unknown>;
  if (!Array.isArray(document.machines)) return value;
  let changed = false;
  const machines = document.machines.map((machine) => {
    if (machine === null || typeof machine !== 'object' || Array.isArray(machine)) return machine;
    const record = machine as Record<string, unknown>;
    if (Object.hasOwn(record, 'activeBindingId') || !Array.isArray(record.bindings)) return machine;
    const first = record.bindings[0];
    const firstId = first !== null && typeof first === 'object' && !Array.isArray(first)
      ? (first as Record<string, unknown>).id
      : null;
    changed = true;
    return { ...record, activeBindingId: typeof firstId === 'string' ? firstId : null };
  });
  return changed ? { ...document, machines } : value;
}

async function readStorageText(adapter: WorkbenchStorageAdapter) {
  try {
    return { ok: true as const, rawText: await adapter.readText(MACHINE_LIBRARY_PATH) };
  } catch (error) {
    return storageAccessFailure('read', MACHINE_LIBRARY_PATH, error);
  }
}

async function accessStorage(
  operation: 'ensure-directory' | 'write',
  path: string,
  action: () => Promise<void>
): Promise<WriteMachineLibraryStorageResult> {
  try {
    await action();
    return { ok: true };
  } catch (error) {
    return storageAccessFailure(operation, path, error);
  }
}

function storageAccessFailure(
  operation: 'ensure-directory' | 'read' | 'write',
  path: string,
  error: unknown
) {
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

function machineLibrarySizeError(rawText: string): Extract<
  MachineLibraryStorageError,
  { code: 'MACHINE_LIBRARY_STORAGE_TOO_LARGE' }
> | null {
  const actualBytes = new TextEncoder().encode(rawText).byteLength;
  return actualBytes > MAX_MACHINE_LIBRARY_BYTES
    ? {
        code: 'MACHINE_LIBRARY_STORAGE_TOO_LARGE',
        message: `Machine library is ${actualBytes} UTF-8 bytes; the maximum is ${MAX_MACHINE_LIBRARY_BYTES}.`,
        actualBytes,
        maximumBytes: MAX_MACHINE_LIBRARY_BYTES
      }
    : null;
}
