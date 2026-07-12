import { createBrowserDirectoryAdapter } from './browserDirectoryAdapter';
import {
  requestWorkbenchDirectory,
  supportsWorkbenchDirectoryAccess
} from './fileSystemAccess';
import {
  initializeWorkbenchDirectory,
  type WorkbenchStorageAdapter
} from './workbenchStorage';

const DIRECTORY_HANDLE_DB = 'wire-edm-workbench-directory';
const DIRECTORY_HANDLE_STORE = 'handles';
const DIRECTORY_HANDLE_KEY = 'workbench-directory';

type DirectoryPermission = 'granted' | 'denied' | 'prompt';

interface PermissionedDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryPermission>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryPermission>;
}

export interface WorkbenchDirectoryHandleStore {
  read(): Promise<FileSystemDirectoryHandle | null>;
  write(handle: FileSystemDirectoryHandle): Promise<void>;
}

interface ConnectWorkbenchDirectoryOptions {
  requestDirectory?: () => Promise<FileSystemDirectoryHandle>;
  createAdapter?: (handle: FileSystemDirectoryHandle) => WorkbenchStorageAdapter;
  handleStore?: WorkbenchDirectoryHandleStore;
  now?: Date;
}

export type RememberedWorkbenchDirectoryResult =
  | {
      status: 'connected';
      workbench: Awaited<ReturnType<typeof initializeWorkbenchDirectory>>;
    }
  | {
      status: 'missing' | 'permission-needed' | 'unsupported' | 'error';
      message?: string;
    };

export async function connectWorkbenchDirectory(
  options: ConnectWorkbenchDirectoryOptions = {}
) {
  const requestDirectory = options.requestDirectory ?? requestWorkbenchDirectory;
  const createAdapter = options.createAdapter ?? createBrowserDirectoryAdapter;
  const handleStore = options.handleStore ?? createIndexedDbDirectoryHandleStore();
  const rememberedHandle = await handleStore.read();
  const rememberedHandleAllowed =
    rememberedHandle && (await requestReadWritePermission(rememberedHandle));
  const directoryHandle = rememberedHandleAllowed ? rememberedHandle : await requestDirectory();
  if (!rememberedHandleAllowed) {
    await handleStore.write(directoryHandle);
  }
  const adapter = createAdapter(directoryHandle);

  return initializeWorkbenchDirectory(adapter, {
    now: options.now
  });
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
    const workbench = await initializeWorkbenchDirectory(adapter, {
      now: options.now
    });
    return { status: 'connected', workbench };
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

async function hasReadWritePermission(handle: FileSystemDirectoryHandle) {
  const permissionedHandle = handle as PermissionedDirectoryHandle;
  if (!permissionedHandle.queryPermission) return true;
  return (
    (await permissionedHandle.queryPermission({
      mode: 'readwrite'
    })) === 'granted'
  );
}

async function requestReadWritePermission(handle: FileSystemDirectoryHandle) {
  const permissionedHandle = handle as PermissionedDirectoryHandle;
  if (await hasReadWritePermission(handle)) return true;
  if (!permissionedHandle.requestPermission) return true;
  return (
    (await permissionedHandle.requestPermission({
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
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DIRECTORY_HANDLE_STORE, mode);
    const request = createRequest(transaction.objectStore(DIRECTORY_HANDLE_STORE));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
