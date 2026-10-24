import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { assertReadLimit, exceedsUtf8Limit, isWellFormedText } from './boundedExactText';
import { createBrowserCacheAdapter } from './browserCacheAdapter';
import { isPortableStoragePath } from './workbenchFileTransaction';
import { withStorageFullGuidance } from './storageFull';
import { MAX_STORAGE_INVENTORY_ENTRIES, type WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const INDEXED_DB_WORKBENCH_DATABASE = 'wire-edm-workbench-files';
const namespace = 'wire-edm-workbench';
const filePrefix = `${namespace}:file:`;
const migrationKey = 'migration';
const stores = ['files', 'sizes', 'legacy', 'metadata'];
const migrationSchema = Type.Object({
  format: Type.Literal('wire-edm-browser-storage'), schemaVersion: Type.Literal(1),
  status: Type.Union([Type.Literal('staged'), Type.Literal('active')]),
  legacyFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  stagedFingerprint: Type.String({ pattern: '^[0-9a-f]{64}$' })
}, { additionalProperties: false });

export interface IndexedDbWorkbenchAdapter extends WorkbenchStorageAdapter {
  close(): void;
  /** Exact physical localStorage envelopes preserved independently of the logical files. */
  readLegacyOriginals(): Promise<ReadonlyMap<string, string>>;
}

export function readLegacyCacheSnapshot(storage: Storage | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!storage) return result;
  const count = storage.length;
  if (count > MAX_STORAGE_INVENTORY_ENTRIES) throw new Error('Browser cache inventory is incomplete. Preserve the existing cache and export readable recovery files before migration.');
  const keys: string[] = [];
  for (let index = 0; index < count; index++) {
    const key = storage.key(index);
    if (key === null) throw new Error('Browser cache changed during inventory. Retry without editing another tab.');
    if (key.startsWith(`${namespace}:`)) keys.push(key);
  }
  for (const key of keys.sort()) {
    const value = storage.getItem(key);
    if (value === null) throw new Error('Browser cache changed during inventory. Retry without editing another tab.');
    result.set(key, value);
  }
  if (storage.length !== count) throw new Error('Browser cache changed during inventory. Retry without editing another tab.');
  return result;
}

async function fingerprint(snapshot: ReadonlyMap<string, string>) {
  const bytes = new TextEncoder().encode(JSON.stringify([...snapshot].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function snapshotStorage(snapshot: ReadonlyMap<string, string>): Storage {
  return { get length() { return snapshot.size; }, key: index => [...snapshot.keys()][index] ?? null,
    getItem: key => snapshot.get(key) ?? null, clear: () => { throw new Error('Legacy source is read-only.'); },
    setItem: () => { throw new Error('Legacy source is read-only.'); }, removeItem: () => { throw new Error('Legacy source is read-only.'); } };
}

function transaction<Result>(db: IDBDatabase, names: string[], mode: IDBTransactionMode,
  start: (tx: IDBTransaction, result: (value: Result) => void, fail: (error: unknown) => void) => void): Promise<Result> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try { tx = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
    catch (error) { reject(error); return; }
    let value: Result, ready = false, failure: unknown;
    tx.oncomplete = () => { if (ready) resolve(value); else reject(new Error('Database transaction completed without a result.')); };
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Database transaction aborted.'));
    const fail = (error: unknown) => { failure = error; try { tx.abort(); } catch { reject(error); } };
    try { start(tx, result => { value = result; ready = true; }, fail); }
    catch (error) { fail(error); }
  });
}

function readValue(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return transaction(db, [store], 'readonly', (tx, result) => {
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => result(request.result);
  });
}

function countRecords(db: IDBDatabase, store: string) {
  return transaction<number>(db, [store], 'readonly', (tx, result) => {
    const request = tx.objectStore(store).count();
    request.onsuccess = () => result(request.result);
  });
}

function readEntries(db: IDBDatabase, store: string): Promise<Map<string, string>> {
  return transaction(db, [store], 'readonly', (tx, result, fail) => {
    const entries = new Map<string, string>();
    const request = tx.objectStore(store).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { result(entries); return; }
      if (typeof cursor.key !== 'string' || typeof cursor.value !== 'string') { fail(new Error(`Invalid browser storage record in ${store}. Preserve this database for recovery.`)); return; }
      entries.set(cursor.key, cursor.value); cursor.continue();
    };
  });
}

function equalMaps(first: ReadonlyMap<string, string>, second: ReadonlyMap<string, string>) {
  return first.size === second.size && [...first].every(([key, value]) => second.get(key) === value);
}

function listPaths(db: IDBDatabase, signal?: AbortSignal): Promise<{ paths: string[]; truncated: boolean }> {
  return transaction(db, ['files'], 'readonly', (tx, result, fail) => {
    const paths: string[] = [];
    const request = tx.objectStore('files').openKeyCursor();
    request.onsuccess = () => {
      try {
        signal?.throwIfAborted();
        const cursor = request.result;
        if (!cursor || paths.length === MAX_STORAGE_INVENTORY_ENTRIES) { result({ paths, truncated: Boolean(cursor) }); return; }
        if (typeof cursor.key !== 'string') throw new Error('Invalid browser storage file key.');
        paths.push(cursor.key); cursor.continue();
      } catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
    };
  });
}

async function boundedRead(db: IDBDatabase, path: string, maxBytes: number, read: () => Promise<string | null>, signal?: AbortSignal) {
  assertReadLimit(maxBytes); signal?.throwIfAborted();
  const size = await readValue(db, 'sizes', path);
  signal?.throwIfAborted();
  if (size !== undefined && (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0)) throw new Error('Invalid browser storage file size. Preserve this file for recovery.');
  if (typeof size === 'number' && size > maxBytes) return { status: 'too-large' as const };
  const text = await read(); signal?.throwIfAborted();
  return text === null ? { status: 'missing' as const } : exceedsUtf8Limit(text, maxBytes) ? { status: 'too-large' as const } : { status: 'read' as const, text };
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open(name, 1); } catch (error) { reject(error); return; }
    let rejected = false;
    request.onblocked = () => { rejected = true; reject(new Error('Browser storage upgrade is blocked by another open app tab. Close the older tab and retry. Existing data is preserved.')); };
    request.onerror = () => reject(request.error ?? new Error('Browser database could not be opened. Existing data is preserved.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of stores) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      resolve(request.result);
    };
  });
}

/** Called under the existing browser-cache Web Lock. Legacy keys are never written or removed. */
export async function openIndexedDbWorkbench(options: {
  readonly factory: IDBFactory;
  readonly legacyStorage: Storage | null;
  readonly databaseName?: string;
  readonly now?: Date;
}): Promise<IndexedDbWorkbenchAdapter> {
  const db = await openDatabase(options.factory, options.databaseName ?? INDEXED_DB_WORKBENCH_DATABASE);
  let closed = false;
  db.onversionchange = () => { closed = true; db.close(); };
  const ensureOpen = () => { if (closed) throw new Error('Browser storage changed in another tab. Reopen the workbench before editing.'); };
  try {
    const source = readLegacyCacheSnapshot(options.legacyStorage);
    const sourceFingerprint = await fingerprint(source);
    const migration: unknown = await readValue(db, 'metadata', migrationKey);
    if (migration !== undefined && !Value.Check(migrationSchema, migration)) throw new Error('Browser storage migration receipt is invalid. Preserve the database and legacy cache for recovery.');
    if (migration !== undefined && migration.legacyFingerprint !== sourceFingerprint) throw new Error('The preserved legacy browser cache changed in another or older app tab. No files were overwritten. Close the older app and export recovery files from both locations.');
    if (migration !== undefined && !equalMaps(await readEntries(db, 'legacy'), source)) throw new Error('Preserved legacy cache originals conflict with the migration receipt. No files were overwritten.');

    if (migration === undefined || migration.status === 'staged') {
      const legacyAdapter = createBrowserCacheAdapter(snapshotStorage(source));
      const logical = new Map<string, string>();
      for (const key of source.keys()) {
        if (!key.startsWith(filePrefix)) continue;
        const path = key.slice(filePrefix.length);
        if (!isPortableStoragePath(path)) throw new Error(`Unsafe legacy browser storage path: ${path}. Preserve the original cache for recovery.`);
        const text = await legacyAdapter.readExactText?.(path);
        if (text === null || text === undefined) throw new Error(`Legacy browser cache file disappeared: ${path}.`);
        logical.set(path, text);
      }
      const existingFiles = await readEntries(db, 'files');
      if (migration === undefined && (existingFiles.size || (await countRecords(db, 'legacy')) ||
          (await countRecords(db, 'metadata')) || (await countRecords(db, 'sizes')))) throw new Error('Browser storage contains files without a migration receipt. Preserve the database; existing files cannot be replaced.');
      if (migration !== undefined && (await fingerprint(existingFiles) !== migration.stagedFingerprint ||
          source.size > 0 && !equalMaps(existingFiles, logical))) throw new Error('Staged browser storage differs from its exact legacy source. Preserve both copies for recovery.');
      if (migration !== undefined && !source.size) for (const [path, text] of existingFiles) logical.set(path, text);
      // Validate a disposable proposed copy, including normal interrupted-transaction recovery.
      // Only the destination is allowed to perform durable recovery after publication.
      const proposed = new Map(logical);
      const validation: WorkbenchStorageAdapter = { kind: 'memory', name: 'Browser storage', ensureDirectory: async () => {},
        readText: async path => proposed.get(path)?.replace(/^\uFEFF/, '') ?? null,
        readExactText: async path => proposed.get(path) ?? null,
        writeText: async (path, text) => { proposed.set(path, text); }, deleteText: async path => { proposed.delete(path); },
        listFiles: async () => ({ paths: [...proposed.keys()].sort(), truncated: false }) };
      const validated = await initializeWorkbenchCatalog(validation, { now: options.now });
      if (!validated.ok) throw new Error(`Browser storage migration validation failed: ${validated.error.message}`);
      if (!source.size) { for (const [path, text] of proposed) logical.set(path, text); }
      const stagedFingerprint = await fingerprint(logical);
      if (migration === undefined) {
        await withStorageFullGuidance('browser-cache', 'browser storage migration', () => transaction<void>(db, stores, 'readwrite', (tx, result) => {
          for (const [path, text] of logical) { tx.objectStore('files').add(text, path); tx.objectStore('sizes').add(new TextEncoder().encode(text).byteLength, path); }
          for (const [key, raw] of source) tx.objectStore('legacy').add(raw, key);
          tx.objectStore('metadata').add({ format: 'wire-edm-browser-storage', schemaVersion: 1, status: 'staged', legacyFingerprint: sourceFingerprint, stagedFingerprint }, migrationKey);
          result();
        }));
      }
      if (!equalMaps(await readEntries(db, 'files'), logical) || !equalMaps(await readEntries(db, 'legacy'), source)) throw new Error('Browser storage migration did not read back exactly. Original cache remains unchanged.');
      if (await fingerprint(readLegacyCacheSnapshot(options.legacyStorage)) !== sourceFingerprint) throw new Error('Legacy browser cache changed during migration. Preserve both copies and retry without older app tabs.');
      await transaction<void>(db, ['metadata'], 'readwrite', (tx, result) => {
        tx.objectStore('metadata').put({ format: 'wire-edm-browser-storage', schemaVersion: 1, status: 'active', legacyFingerprint: sourceFingerprint, stagedFingerprint }, migrationKey); result();
      });
    }

    const checkSource = async () => {
      ensureOpen();
      if (await fingerprint(readLegacyCacheSnapshot(options.legacyStorage)) !== sourceFingerprint) throw new Error('The preserved legacy browser cache changed in another or older app tab. Saving is blocked to preserve both copies. Close the older app and export recovery files.');
    };
    const read = async (path: string) => {
      ensureOpen(); const value = await readValue(db, 'files', path);
      if (value !== undefined && typeof value !== 'string') throw new Error(`Invalid browser storage text at ${path}. Preserve the database for recovery.`);
      return value ?? null;
    };
    const commitTextChanges: NonNullable<WorkbenchStorageAdapter['commitTextChanges']> = async (changes, options = {}) => {
      await checkSource();
      const unique = new Set<string>();
      for (const change of changes) {
        if (!isPortableStoragePath(change.path) || unique.has(change.path)) throw new Error('Invalid or duplicate atomic browser storage path.');
        unique.add(change.path);
      }
      const sizes = new Map(changes.filter(change => change.next !== null && change.previous !== change.next)
        .map(change => [change.path, new TextEncoder().encode(change.next ?? '').byteLength]));
      await withStorageFullGuidance('browser-cache', changes[0]?.path ?? 'atomic commit', () => transaction<void>(db, ['files', 'sizes'], 'readwrite', (tx, result, fail) => {
        const store = tx.objectStore('files');
        let remaining = changes.length;
        if (!remaining) { result(); return; }
        for (const change of changes) {
          const request = store.get(change.path);
          request.onsuccess = () => {
            try {
            const current: unknown = request.result;
            if (current !== undefined && typeof current !== 'string') { fail(new Error(`Invalid browser storage text at ${change.path}. No files were committed.`)); return; }
            if ((current === undefined ? null : current) !== change.previous) { fail(new Error(`Browser storage changed at ${change.path}. No files were committed.`)); return; }
            if (--remaining) return;
            if (changes.some(next => next.previous !== next.next)) options.beforeWrite?.();
            for (const next of changes) {
              if (next.previous === next.next) continue;
              if (next.next === null) { store.delete(next.path); tx.objectStore('sizes').delete(next.path); }
              else { store.put(next.next, next.path); tx.objectStore('sizes').put(sizes.get(next.path), next.path); }
            }
            result();
            } catch (error) { fail(error); }
          };
        }
      }));
    };
    return { kind: 'browser-cache', name: 'Browser storage', mutationScope: `browser-storage:${namespace}`,
      ensureDirectory: async path => { if (!isPortableStoragePath(path)) throw new Error('Invalid browser storage directory.'); await checkSource(); },
      readText: async path => (await read(path))?.replace(/^\uFEFF/, '') ?? null,
      readExactText: async (path, signal) => { signal?.throwIfAborted(); const text = await read(path); signal?.throwIfAborted(); if (text !== null && !isWellFormedText(text)) throw new Error('Cached text cannot round-trip as exact UTF-8: malformed Unicode. Preserve the original for recovery.'); return text; },
      readBoundedExactText: (path, maxBytes, signal) => boundedRead(db, path, maxBytes, () => read(path), signal),
      writeText: async (path, text) => { await commitTextChanges([{path, previous: await read(path), next: text}]); },
      deleteText: async path => { await commitTextChanges([{path, previous: await read(path), next: null}]); }, commitTextChanges,
      listFiles: signal => { ensureOpen(); signal?.throwIfAborted(); return listPaths(db, signal); },
      close: () => { closed = true; db.close(); }, readLegacyOriginals: () => readEntries(db, 'legacy') };
  } catch (error) { db.close(); throw error; }
}

/** Discovery for no-Web-Locks recovery never creates or upgrades a database. */
export async function openReadOnlyIndexedDbWorkbench(factory: IDBFactory): Promise<IndexedDbWorkbenchAdapter | null> {
  const db = await new Promise<IDBDatabase | null>((resolve, reject) => {
    const request = factory.open(INDEXED_DB_WORKBENCH_DATABASE);
    let rejected = false, missing = false;
    // An unversioned open can only request an upgrade when the database does
    // not exist. Abort that creation instead of depending on databases(), which
    // is unavailable in some otherwise functional IndexedDB implementations.
    request.onupgradeneeded = () => { missing = true; request.transaction?.abort(); };
    request.onblocked = () => { rejected = true; reject(new Error('Browser storage is blocked by another tab.')); };
    request.onerror = () => { if (missing) resolve(null); else reject(request.error ?? new Error('Browser storage could not be read.')); };
    request.onsuccess = () => { if (rejected) request.result.close(); else resolve(request.result); };
  });
  if (!db) return null;
  db.onversionchange = () => db.close();
  const read = async (path: string) => {
    const value = await readValue(db, 'files', path);
    if (value !== undefined && typeof value !== 'string') throw new Error(`Invalid browser storage text at ${path}.`);
    return value ?? null;
  };
  const deny = async () => { throw new Error('Browser storage is read-only without cross-tab coordination.'); };
  return {kind:'browser-cache',name:'Browser storage',mutationScope:`browser-storage:${namespace}`,
    ensureDirectory:deny,writeText:deny,deleteText:deny,
    readText:async path => (await read(path))?.replace(/^\uFEFF/,'') ?? null,
    readExactText:async (path,signal) => { signal?.throwIfAborted(); const text=await read(path); signal?.throwIfAborted(); if(text!==null&&!isWellFormedText(text))throw new Error('Cached text cannot round-trip as exact UTF-8.'); return text; },
    readBoundedExactText:(path,maxBytes,signal)=>boundedRead(db,path,maxBytes,()=>read(path),signal),
    listFiles:signal=>listPaths(db,signal), close:()=>db.close(), readLegacyOriginals:()=>readEntries(db,'legacy')};
}

/** One rescue download preserves the newer database and both legacy observations. */
export function combinedBrowserStorageRecovery(database: IndexedDbWorkbenchAdapter, legacy: Storage | null): WorkbenchStorageAdapter {
  const currentPrefix = 'indexeddb/files/', originalsPrefix = 'indexeddb/legacy-originals/', livePrefix = 'legacy-localstorage/';
  const rawName = (key: string) => `${encodeURIComponent(JSON.stringify(key))}.txt`;
  const rawKey = (path: string, prefix: string) => {
    const key: unknown = JSON.parse(decodeURIComponent(path.slice(prefix.length, -4)));
    if (typeof key !== 'string') throw new Error('Invalid browser recovery key.');
    return key;
  };
  const deny = async () => { throw new Error('Combined browser storage recovery is read-only.'); };
  const read = async (path: string) => {
    if (path.startsWith(currentPrefix)) return database.readText(path.slice(currentPrefix.length));
    if (path.startsWith(originalsPrefix)) return (await database.readLegacyOriginals()).get(rawKey(path, originalsPrefix)) ?? null;
    if (path.startsWith(livePrefix)) return legacy?.getItem(rawKey(path, livePrefix)) ?? null;
    throw new Error('Unknown browser recovery path.');
  };
  return {kind:'browser-cache',name:'Browser database and preserved legacy cache',mutationScope:`browser-storage:${namespace}`,
    ensureDirectory:deny,writeText:deny,deleteText:deny,readText:read,
    readExactText:async(path,signal)=>{signal?.throwIfAborted();if(path.startsWith(currentPrefix))return database.readExactText?.(path.slice(currentPrefix.length),signal)??null;return read(path);},
    readBoundedExactText:async(path,maxBytes,signal)=>{
      assertReadLimit(maxBytes);signal?.throwIfAborted();
      if(path.startsWith(currentPrefix))return database.readBoundedExactText?.(path.slice(currentPrefix.length),maxBytes,signal)??{status:'missing'};
      const text=await read(path);signal?.throwIfAborted();return text===null?{status:'missing'}:exceedsUtf8Limit(text,maxBytes)?{status:'too-large'}:{status:'read',text};
    },
    listFiles:async signal=>{
      const indexed=await database.listFiles?.(signal);const originals=await database.readLegacyOriginals();
      const paths=[...(indexed?.paths??[]).map(path=>currentPrefix+path),...[...originals.keys()].map(key=>originalsPrefix+rawName(key))];
      let truncated=indexed?.truncated??true;
      if(legacy){const count=Math.min(legacy.length,MAX_STORAGE_INVENTORY_ENTRIES);truncated||=legacy.length>count;
        for(let index=0;index<count;index++){signal?.throwIfAborted();const key=legacy.key(index);if(key?.startsWith(`${namespace}:`))paths.push(livePrefix+rawName(key));}}
      return{paths:paths.sort().slice(0,MAX_STORAGE_INVENTORY_ENTRIES),truncated:truncated||paths.length>MAX_STORAGE_INVENTORY_ENTRIES};
    }};
}
