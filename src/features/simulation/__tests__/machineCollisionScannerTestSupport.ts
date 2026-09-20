import { vi } from 'vitest';
import { triangleModel } from '@/domain/simulation/machine-import/__tests__/machineTestModel';
import type { MachineCollisionScanResponse } from '../machineCollisionScanTask';
import { compiledInput } from './simulationCompilerTestSupport';

export class CollisionWorker {
  static instances: CollisionWorker[] = [];
  static failPost = false;
  onmessage: ((event: MessageEvent<MachineCollisionScanResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn(() => { if (CollisionWorker.failPost) throw new DOMException('Cannot clone', 'DataCloneError'); });
  constructor(readonly url: URL, readonly options: WorkerOptions) { CollisionWorker.instances.push(this); }
  reply(data: MachineCollisionScanResponse) { this.onmessage?.({ data } as MessageEvent<MachineCollisionScanResponse>); }
}

export function scanInput() {
  return { plan: compiledInput().plan, model: triangleModel(), placement: { x: 0, y: 0, z: 0, rotation: 0 } };
}

export function installCollisionWorker() {
  CollisionWorker.instances = []; CollisionWorker.failPost = false;
  vi.stubGlobal('Worker', CollisionWorker);
}
