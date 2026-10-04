import { APP_VERSION } from '@/domain/release/appRelease';
import { isWellFormedText } from './boundedExactText';
import { withWorkbenchMutationLock } from './workbenchMutationLock';
import { MAX_STORAGE_INVENTORY_ENTRIES, type WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const MAX_RECOVERY_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_RECOVERY_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PATH_CHARACTERS = 1024;
const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
async function hash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function message(text: string, limit = 2048) {
  return { message: text.slice(0, limit), ...(text.length > limit ? { messageTruncated: true as const } : {}) };
}

export interface RecoveryStorageSource {
  readonly id: string;
  readonly adapter: WorkbenchStorageAdapter;
  readonly diagnostic: { readonly code: string; readonly message: string };
}

export function recoveryStorageSource(adapter: WorkbenchStorageAdapter, diagnostic: RecoveryStorageSource['diagnostic']): RecoveryStorageSource {
  return { id: crypto.randomUUID(), adapter, diagnostic };
}

export function recoverySourceSummary(source: RecoveryStorageSource) {
  return { id: source.id, kind: source.adapter.kind, name: source.adapter.name.slice(0, 512),
    ...(source.adapter.name.length > 512 ? { nameTruncated: true } : {}),
    diagnostic: { code: source.diagnostic.code.slice(0, 160), ...(source.diagnostic.code.length > 160 ? { codeTruncated: true } : {}), ...message(source.diagnostic.message) } };
}

type RecoveryFile = { path: string; pathTruncated?: true } & (
  | { status: 'captured'; text: string; logicalTextSha256: string; utf8Sha256: string | null; textEncoding: 'utf8' | 'utf16-code-units' }
  | { status: 'missing' | 'too-large' | 'archive-limit' | 'unreadable' | 'path-too-long'; message?: string; messageTruncated?: true }
);

export interface RecoveryExportReceipt {
  readonly sourceId: string;
  readonly fileName: string;
  readonly archiveBytes: number;
  readonly archiveSha256: string;
  readonly capturedFiles: number;
  readonly omittedFiles: number;
  readonly inventoryComplete: boolean;
  readonly contentComplete: boolean;
  readonly inventoryChangedDuringCapture: boolean;
  readonly coordination: 'web-lock' | 'uncoordinated';
  readonly atomicSnapshot: false;
}
export interface PreparedRecoveryExport { readonly text: string; readonly receipt: RecoveryExportReceipt }

/** Evidence only. This routine neither validates/restores a backup nor invokes storage recovery. */
export async function captureWorkbenchRecovery(source: RecoveryStorageSource, options: {
  signal?: AbortSignal; maxArchiveBytes?: number; maxFileBytes?: number;
} = {}): Promise<PreparedRecoveryExport> {
  const signal = options.signal;
  const maxArchiveBytes = options.maxArchiveBytes ?? MAX_RECOVERY_ARCHIVE_BYTES;
  const maxFileBytes = options.maxFileBytes ?? MAX_RECOVERY_FILE_BYTES;
  if (!Number.isSafeInteger(maxArchiveBytes) || maxArchiveBytes < 4096 || maxArchiveBytes > MAX_RECOVERY_ARCHIVE_BYTES ||
      !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 0 || maxFileBytes > MAX_RECOVERY_FILE_BYTES) throw new Error('Invalid recovery export limits.');
  const adapter = source.adapter;
  const coordination: RecoveryExportReceipt['coordination'] = typeof navigator !== 'undefined' && navigator.locks ? 'web-lock' : 'uncoordinated';
  const capture = async () => {
    signal?.throwIfAborted();
    const { listFiles, readBoundedExactText } = adapter;
    if (!listFiles || !readBoundedExactText) throw new Error('Read-only bounded recovery capture is unavailable for this storage.');
    const startedAt = new Date().toISOString();
    const header = { format: 'wire-edm-recovery-export', schemaVersion: 1, appVersion: APP_VERSION,
      source: recoverySourceSummary(source), startedAt,
      observation: 'Exact logical text observed after connection failed or persistent storage became unavailable. Not a restore backup.',
      coordination, atomicSnapshot: false, externalEditsMayOccur: true,
      limits: { archiveUtf8Bytes: maxArchiveBytes, logicalFileUtf8Bytes: maxFileBytes, inventoryEntries: MAX_STORAGE_INVENTORY_ENTRIES, folderDepth: 16, pathCharacters: MAX_PATH_CHARACTERS },
      excluded: ['Unreadable or oversized files', 'Empty directories', 'Physical compressed cache envelopes', 'Unrelated browser keys and UI preferences', 'Remembered folder handles', 'Unsaved drafts'],
      hashEncoding: 'logicalTextSha256 hashes UTF-8 of JSON.stringify(text), preserving every UTF-16 code unit. utf8Sha256 hashes exact UTF-8 text only when Unicode is well formed.' };
    const before = await listFiles(signal);
    signal?.throwIfAborted();
    const paths = before.paths.slice(0, MAX_STORAGE_INVENTORY_ENTRIES);
    const files: RecoveryFile[] = paths.map(path => ({ path: path.slice(0, MAX_PATH_CHARACTERS),
      ...(path.length > MAX_PATH_CHARACTERS ? { pathTruncated: true as const } : {}),
      status: path.length > MAX_PATH_CHARACTERS ? 'path-too-long' : 'archive-limit' }));
    // Reserve metadata for every discovered path and the final header before reading any contents.
    let fileBytes = bytes(JSON.stringify(files)).byteLength;
    const headerReserve = bytes(JSON.stringify({ ...header, completedAt: startedAt,
      inventory: { complete: false, changedDuringCapture: false, truncatedBefore: false, truncatedAfter: false,
        discoveredFiles: MAX_STORAGE_INVENTORY_ENTRIES, error: { message: '\u0000'.repeat(256), messageTruncated: true } },
      contentComplete: false, files: [] })).byteLength;
    if (fileBytes + headerReserve > maxArchiveBytes) throw new Error('Recovery inventory metadata exceeds the archive limit. No files were changed.');
    for (let index = 0; index < files.length; index++) {
      signal?.throwIfAborted();
      if (files[index].pathTruncated) continue;
      const originalBytes = bytes(JSON.stringify(files[index])).byteLength;
      const available = maxArchiveBytes - headerReserve - fileBytes + originalBytes;
      // Allow for JSON escaping: the final complete record is measured before inclusion.
      if (available < 256) continue;
      let entry: RecoveryFile;
      try {
        const readLimit = Math.min(maxFileBytes, available);
        const read = await readBoundedExactText(paths[index], readLimit, signal);
        signal?.throwIfAborted();
        if (read.status !== 'read') entry = { path: paths[index], status: read.status === 'too-large' && readLimit < maxFileBytes ? 'archive-limit' : read.status };
        else {
          const wellFormed = isWellFormedText(read.text);
          entry = { path: paths[index], status: 'captured', text: read.text,
            textEncoding: wellFormed ? 'utf8' : 'utf16-code-units',
            logicalTextSha256: await hash(JSON.stringify(read.text)), utf8Sha256: wellFormed ? await hash(read.text) : null };
        }
      } catch (error) {
        signal?.throwIfAborted();
        entry = { path: paths[index], status: 'unreadable', ...message(error instanceof Error ? error.message : String(error), 256) };
      }
      let entryBytes = bytes(JSON.stringify(entry)).byteLength;
      if (entryBytes > available) { entry = { path: paths[index], status: 'archive-limit' }; entryBytes = bytes(JSON.stringify(entry)).byteLength; }
      files[index] = entry; fileBytes += entryBytes - originalBytes;
    }
    signal?.throwIfAborted();
    let after: { paths: string[]; truncated: boolean } | null = null;
    let inventoryError: ReturnType<typeof message> | undefined;
    try { after = await listFiles(signal); }
    catch (error) { signal?.throwIfAborted(); inventoryError = message(error instanceof Error ? error.message : String(error), 256); }
    const changed = !after || before.paths.length !== after.paths.length || before.paths.some((path, index) => path !== after.paths[index]);
    const inventoryComplete = !before.truncated && Boolean(after && !after.truncated) && before.paths.length <= paths.length && !changed;
    const capturedFiles = files.filter(file => file.status === 'captured').length;
    const omittedFiles = files.length - capturedFiles;
    const text = JSON.stringify({ ...header, completedAt: new Date().toISOString(),
      inventory: { complete: inventoryComplete, changedDuringCapture: changed, truncatedBefore: before.truncated,
        truncatedAfter: after?.truncated ?? null, discoveredFiles: paths.length, ...(inventoryError ? { error: inventoryError } : {}) },
      contentComplete: inventoryComplete && omittedFiles === 0, files });
    signal?.throwIfAborted();
    const archiveBytes = bytes(text).byteLength;
    if (archiveBytes > maxArchiveBytes) throw new Error('Recovery archive exceeds the byte limit. No files were changed.');
    const archiveSha256 = await hash(text);
    signal?.throwIfAborted();
    return { text, receipt: { sourceId: source.id, fileName: `wire-edm-${startedAt.slice(0, 10)}.wireedm-recovery.json`, archiveBytes,
      archiveSha256, capturedFiles, omittedFiles, inventoryComplete, contentComplete: inventoryComplete && omittedFiles === 0,
      inventoryChangedDuringCapture: changed, coordination, atomicSnapshot: false as const } };
  };
  // Absence of locks can disable edits but must not prevent a clearly labelled read-only rescue.
  return coordination === 'web-lock' ? withWorkbenchMutationLock(adapter, capture, { recoverFiles: false }) : capture();
}
