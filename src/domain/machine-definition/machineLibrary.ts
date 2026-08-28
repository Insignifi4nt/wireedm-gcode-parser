import { canonicalJson } from '@/domain/post-processor/canonicalJson';
import type { MachineBindingPostReference } from '@/domain/post-processor/postLibrary';

import type { MachineDefinition } from './machineDefinition';

export interface MachineLibrary {
  readonly schemaVersion: 1;
  readonly machines: readonly MachineDefinition[];
}

export type InstallMachineDefinitionResult =
  | {
      ok: true;
      kind: 'installed' | 'already-installed';
      library: MachineLibrary;
      machine: MachineDefinition;
    }
  | {
      ok: false;
      error: {
        code: 'MACHINE_LIBRARY_ID_CONFLICT';
        message: string;
        machineId: string;
      };
    };

export type ReplaceMachineDefinitionResult =
  | { ok: true; library: MachineLibrary; machine: MachineDefinition }
  | {
      ok: false;
      error: { code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND'; message: string; machineId: string };
    };

export type RemoveMachineDefinitionResult =
  | { ok: true; library: MachineLibrary; removed: MachineDefinition }
  | {
      ok: false;
      error: { code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND'; message: string; machineId: string };
    };

export function createEmptyMachineLibrary(): MachineLibrary {
  return Object.freeze({ schemaVersion: 1, machines: Object.freeze([]) });
}

export function installMachineDefinition(
  library: MachineLibrary,
  machine: MachineDefinition
): InstallMachineDefinitionResult {
  const existing = library.machines.find(({ id }) => id === machine.id);
  if (existing) {
    return canonicalJson(existing) === canonicalJson(machine)
      ? { ok: true, kind: 'already-installed', library, machine: existing }
      : {
          ok: false,
          error: {
            code: 'MACHINE_LIBRARY_ID_CONFLICT',
            message: `Machine definition ${machine.id} already exists with different content. Rename the imported machine explicitly or edit the existing definition.`,
            machineId: machine.id
          }
        };
  }

  return {
    ok: true,
    kind: 'installed',
    library: Object.freeze({
      schemaVersion: 1,
      machines: Object.freeze([...library.machines, machine])
    }),
    machine
  };
}

export function machineBindingReferences(
  library: MachineLibrary
): readonly MachineBindingPostReference[] {
  return Object.freeze(library.machines.flatMap((machine) => (
    machine.bindings.map((binding) => Object.freeze({
      machineId: machine.id,
      bindingId: binding.id,
      post: binding.post
    }))
  )));
}

export function replaceMachineDefinition(
  library: MachineLibrary,
  machine: MachineDefinition
): ReplaceMachineDefinitionResult {
  const index = library.machines.findIndex(({ id }) => id === machine.id);
  if (index === -1) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND',
        message: `Machine definition not found: ${machine.id}.`,
        machineId: machine.id
      }
    };
  }
  return {
    ok: true,
    library: Object.freeze({
      schemaVersion: 1,
      machines: Object.freeze(library.machines.map((current, currentIndex) => (
        currentIndex === index ? machine : current
      )))
    }),
    machine
  };
}

export function removeMachineDefinition(
  library: MachineLibrary,
  machineId: string
): RemoveMachineDefinitionResult {
  const removed = library.machines.find(({ id }) => id === machineId);
  if (!removed) {
    return {
      ok: false,
      error: {
        code: 'MACHINE_LIBRARY_MACHINE_NOT_FOUND',
        message: `Machine definition not found: ${machineId}.`,
        machineId
      }
    };
  }
  return {
    ok: true,
    library: Object.freeze({
      schemaVersion: 1,
      machines: Object.freeze(library.machines.filter(({ id }) => id !== machineId))
    }),
    removed
  };
}
