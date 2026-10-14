export interface WorkbenchStorageAdapter {
  readonly name: string;
  readonly kind: 'browser-cache' | 'directory' | 'memory';
  /** Stable persistence identity shared by adapters that access the same files. */
  readonly mutationScope?: string;
  readonly persistenceWarning?: string;
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  /** Complete exact UTF-8 text; reject malformed encoding and cancel reads without truncating originals. */
  readExactText?(path: string, signal?: AbortSignal): Promise<string | null>;
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
