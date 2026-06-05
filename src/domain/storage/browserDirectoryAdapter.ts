import type { WorkbenchStorageAdapter } from './workbenchStorage';

export function createBrowserDirectoryAdapter(
  root: FileSystemDirectoryHandle
): WorkbenchStorageAdapter {
  return {
    name: root.name,
    kind: 'directory',
    ensureDirectory: async (path: string) => {
      await getDirectory(root, splitPath(path), true);
    },
    readText: async (path: string) => {
      try {
        const handle = await getFile(root, splitPath(path), false);
        const file = await handle.getFile();
        return file.text();
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    },
    deleteText: async (path: string) => {
      try {
        const parts = splitPath(path);
        const fileName = parts.at(-1);
        if (!fileName) return;

        const directory = await getDirectory(root, parts.slice(0, -1), false);
        await directory.removeEntry(fileName);
      } catch (error) {
        if (isNotFoundError(error)) return;
        throw error;
      }
    },
    writeText: async (path: string, contents: string) => {
      const handle = await getFile(root, splitPath(path), true);
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
    }
  };
}

function splitPath(path: string) {
  return path.split('/').filter(Boolean);
}

async function getDirectory(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean
) {
  let current = root;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create });
  }

  return current;
}

async function getFile(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean
) {
  const fileName = parts.at(-1);
  if (!fileName) throw new Error('File path is empty.');

  const directory = await getDirectory(root, parts.slice(0, -1), create);
  return directory.getFileHandle(fileName, { create });
}

function isNotFoundError(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError';
}
