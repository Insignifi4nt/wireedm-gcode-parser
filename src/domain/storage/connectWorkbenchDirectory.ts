import { createBrowserDirectoryAdapter } from './browserDirectoryAdapter';
import { requestWorkbenchDirectory } from './fileSystemAccess';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from './workbenchStorage';

interface ConnectWorkbenchDirectoryOptions {
  requestDirectory?: () => Promise<FileSystemDirectoryHandle>;
  createAdapter?: (handle: FileSystemDirectoryHandle) => WorkbenchStorageAdapter;
  now?: Date;
}

export async function connectWorkbenchDirectory(
  options: ConnectWorkbenchDirectoryOptions = {}
) {
  const requestDirectory = options.requestDirectory ?? requestWorkbenchDirectory;
  const createAdapter = options.createAdapter ?? createBrowserDirectoryAdapter;
  const directoryHandle = await requestDirectory();
  const adapter = createAdapter(directoryHandle);

  return initializeWorkbenchDirectory(adapter, {
    now: options.now
  });
}
