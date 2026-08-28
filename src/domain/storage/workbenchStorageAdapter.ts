export interface WorkbenchStorageAdapter {
  readonly name: string;
  readonly kind: 'browser-cache' | 'directory' | 'memory';
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  deleteText(path: string): Promise<void>;
  writeText(path: string, contents: string): Promise<void>;
}
