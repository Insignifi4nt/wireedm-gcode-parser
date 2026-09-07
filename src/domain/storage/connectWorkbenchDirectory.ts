import {
  initializeWorkbenchCatalog,
  type InitializeWorkbenchCatalogResult
} from '@/domain/workbench-catalog/workbenchCatalog';

import { createBrowserDirectoryAdapter } from './browserDirectoryAdapter';
import {
  requestWorkbenchDirectory,
  supportsWorkbenchDirectoryAccess
} from './fileSystemAccess';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

const DIRECTORY_HANDLE_DB = 'wire-edm-workbench-directory';
const DIRECTORY_HANDLE_STORE = 'handles';
const DIRECTORY_HANDLE_KEY = 'workbench-directory';

type DirectoryPermission = 'granted' | 'denied' | 'prompt';

interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryPermission>;
}

export interface WorkbenchDirectoryHandleStore {
  read(): Promise<FileSystemDirectoryHandle | null>;
  write(handle: FileSystemDirectoryHandle | null): Promise<void>;
}

interface ConnectWorkbenchDirectoryOptions {
  requestDirectory?: () => Promise<FileSystemDirectoryHandle>;
  createAdapter?: (handle: FileSystemDirectoryHandle) => WorkbenchStorageAdapter;
  handleStore?: WorkbenchDirectoryHandleStore;
  now?: Date;
}

export type RememberedWorkbenchDirectoryResult =
  | InitializeWorkbenchCatalogResult
  | { status: 'missing' | 'permission-needed' | 'unsupported' }
  | { status: 'error'; message: string };

export async function connectWorkbenchDirectory(
  options: ConnectWorkbenchDirectoryOptions = {}
) {
  const requestDirectory = options.requestDirectory ?? requestWorkbenchDirectory;
  const createAdapter = options.createAdapter ?? createBrowserDirectoryAdapter;
  const handleStore = options.handleStore ?? createIndexedDbDirectoryHandleStore();
  // Start the picker in the user gesture, without waiting for remembered storage.
  const directoryHandle = await requestDirectory();
  const adapter = createAdapter(directoryHandle);

  const connected = await initializeWorkbenchCatalog(adapter, {
    now: options.now
  });
  if (connected.ok) await handleStore.write(directoryHandle);
  return connected;
}

export async function connectRememberedWorkbenchDirectory(
  options: Omit<ConnectWorkbenchDirectoryOptions, 'requestDirectory'> = {}
): Promise<RememberedWorkbenchDirectoryResult> {
  if (!supportsWorkbenchDirectoryAccess()) {
    return { status: 'unsupported' };
  }

  const createAdapter = options.createAdapter ?? createBrowserDirectoryAdapter;
  const handleStore = options.handleStore ?? createIndexedDbDirectoryHandleStore();

  try {
    const directoryHandle = await handleStore.read();
    if (!directoryHandle) {
      return { status: 'missing' };
    }

    const hasPermission = await hasReadWritePermission(directoryHandle);
    if (!hasPermission) {
      return { status: 'permission-needed' };
    }

    const adapter = createAdapter(directoryHandle);
    return initializeWorkbenchCatalog(adapter, {
      now: options.now
    });
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? error.message
          : 'Could not reconnect the remembered workbench folder.'
    };
  }
}

export async function forgetWorkbenchDirectory(store: WorkbenchDirectoryHandleStore = createIndexedDbDirectoryHandleStore()) {
  await store.write(null);
}

async function hasReadWritePermission(handle: FileSystemDirectoryHandle) {
  const permissionedHandle: PermissionedDirectoryHandle = handle;
  if (!permissionedHandle.queryPermission) return true;
  return (
    (await permissionedHandle.queryPermission({
      mode: 'readwrite'
    })) === 'granted'
  );
}

function createIndexedDbDirectoryHandleStore(): WorkbenchDirectoryHandleStore {
  return {
    read: async () => {
      const db = await openDirectoryHandleDatabase();
      if (!db) return null;
      return runStoreRequest(db, 'readonly', (store) => store.get(DIRECTORY_HANDLE_KEY));
    },
    write: async (handle) => {
      const db = await openDirectoryHandleDatabase();
      if (!db) return;
      await runStoreRequest(db, 'readwrite', (store) =>
        store.put(handle, DIRECTORY_HANDLE_KEY)
      );
    }
  };
}

async function openDirectoryHandleDatabase() {
  if (!globalThis.indexedDB) return null;

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = globalThis.indexedDB.open(DIRECTORY_HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DIRECTORY_HANDLE_STORE);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

async function runStoreRequest<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>
) {
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(DIRECTORY_HANDLE_STORE, mode);
      const request = createRequest(transaction.objectStore(DIRECTORY_HANDLE_STORE));
      // A successful request can still be rolled back before the transaction commits.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the workbench folder preference.'));
    });
  } finally {
    db.close();
  }
}
