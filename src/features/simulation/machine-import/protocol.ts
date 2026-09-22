import type { MachineImportProgress, MachineModelImportResult } from '@/domain/simulation/machine-import/model';

export interface MachineImportWorkerRequest { readonly file: File }
export type MachineImportWorkerResponse = { readonly type: 'progress'; readonly progress: MachineImportProgress }
  | { readonly type: 'result'; readonly result: MachineModelImportResult };
