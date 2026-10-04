export interface WorkbenchStorageAdapter {
  readonly name: string;
  readonly kind: 'browser-cache' | 'directory' | 'memory';
  /** Stable persistence identity shared by adapters that access the same files. */
  readonly mutationScope?: string;
  readonly persistenceWarning?: string;
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  /** Exact UTF-8 round trip for portable backups; reject binary files instead of losing bytes. */
  readExactText?(path: string): Promise<string | null>;
  /** Read-only recovery capture: bound reads/expansion and omit a file that exceeds the byte limit; never return truncated text. */
  readBoundedExactText?(path: string, maxBytes: number, signal?: AbortSignal): Promise<BoundedExactTextResult>;
  deleteText(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
  /** Read-only inventory; truncated results must never be used to justify deleting files. */
  listFiles?(signal?: AbortSignal): Promise<{ paths: string[]; truncated: boolean }>;
}

export const MAX_STORAGE_INVENTORY_ENTRIES = 10_000;

export type BoundedExactTextResult =
  | { status: 'read'; text: string }
  | { status: 'missing' | 'too-large' };
