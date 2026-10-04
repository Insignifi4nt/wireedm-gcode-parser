/// <reference lib="webworker" />
import { runDxfProcessorTask, type DxfProcessorRequest } from './dxfProcessorTask';

self.onmessage = (event: MessageEvent<DxfProcessorRequest>) => {
  self.postMessage(runDxfProcessorTask(event.data));
};
