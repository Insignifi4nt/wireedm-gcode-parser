/// <reference lib="webworker" />
import { runMachineCollisionScan, type MachineCollisionScanRequest, type MachineCollisionScanResponse } from './machineCollisionScanTask';

self.onmessage = (event: MessageEvent<MachineCollisionScanRequest>) => {
  void runMachineCollisionScan(event.data).then(result => self.postMessage(result)).catch(() => {
    self.postMessage({ ok: false, message: 'Machine geometry could not be prepared or checked. No clearance was verified.' } satisfies MachineCollisionScanResponse);
  });
};
