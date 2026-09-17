/// <reference lib="webworker" />
import { runPackageAuthoringTool, type PackageAuthoringRequest } from '@/domain/machine-package/packageAuthoringTools';

self.onmessage = async (event: MessageEvent<PackageAuthoringRequest>) => {
  self.postMessage(await runPackageAuthoringTool(event.data));
};
