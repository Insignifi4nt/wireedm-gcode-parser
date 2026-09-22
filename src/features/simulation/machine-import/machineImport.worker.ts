/// <reference lib="webworker" />
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';
import { parseStepMachineModel } from '@/domain/simulation/machine-import/parseStepMachineModel';
import { machineImportFailure, type MachineModelImportResult } from '@/domain/simulation/machine-import/model';
import { validateMachineFile } from '@/domain/simulation/machine-import/stepInput';
import type { MachineImportWorkerRequest, MachineImportWorkerResponse } from './protocol';

const worker = self as DedicatedWorkerGlobalScope;
function reply(message: MachineImportWorkerResponse, transfer: Transferable[] = []) { worker.postMessage(message, transfer); }

worker.onmessage = async (event: MessageEvent<MachineImportWorkerRequest>) => {
  const file = event.data.file;
  const check = validateMachineFile(file);
  if (!check.ok) { reply({ type: 'result', result: check }); return; }
  reply({ type: 'progress', progress: { stage: 'reading' } });
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch { reply({ type: 'result', result: machineImportFailure('MACHINE_IMPORT_READ_FAILED', 'The browser could not read the selected STEP file.') }); return; }
  let result: MachineModelImportResult;
  try {
    result = await parseStepMachineModel(bytes, file.name, async () => {
      const { default: initializeOcct } = await import('occt-import-js');
      return initializeOcct({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
    }, (progress) => reply({ type: 'progress', progress }));
  } catch {
    result = machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'The local STEP parser could not complete this model.');
  }
  const transfer: Transferable[] = result.ok ? result.model.meshes.flatMap((mesh) => [
    mesh.positions.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer,
    ...(mesh.normals ? [mesh.normals.buffer as ArrayBuffer] : [])
  ]) : [];
  reply({ type: 'result', result }, transfer);
};
