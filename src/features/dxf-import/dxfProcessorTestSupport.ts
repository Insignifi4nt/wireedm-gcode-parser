import type { DxfProcessor } from '@/domain/dxf/dxfProcessing';
import { runDxfProcessorTask } from './dxfProcessorTask';

/** Explicit pure processor injection for UI tests; worker lifetime has its own coverage. */
export const directDxfProcessor: DxfProcessor = {
  async prepare(preference, input, signal) {
    signal?.throwIfAborted();
    const response = runDxfProcessorTask({ kind: 'prepare', preference, input });
    if (!response.ok || response.kind !== 'prepare') throw new Error('DXF preparation failed.');
    return response.result;
  },
  async plan(entities, metadata, signal) {
    signal?.throwIfAborted();
    const response = runDxfProcessorTask({ kind: 'plan', entities, metadata });
    if (!response.ok || response.kind !== 'plan') throw new Error('DXF planning failed.');
    return response.result;
  }
};
