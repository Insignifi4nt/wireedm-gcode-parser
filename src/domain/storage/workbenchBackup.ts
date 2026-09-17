import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { APP_VERSION } from '@/domain/release/appRelease';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { validateWorkbenchProjectPathOwnership, workbenchProjectOwnedPaths, workbenchProjectRevisionPath } from '@/domain/workbench-catalog/workbenchProjectStorage';
import { parseSavedWireEdmJobRevision } from '@/domain/wire-edm-job/savedWireEdmJobRevision';
import { commitWorkbenchFileTransaction, isPortableStoragePath } from './workbenchFileTransaction';
import { withWorkbenchMutationLock } from './workbenchMutationLock';
import type { WorkbenchStorageAdapter } from './workbenchStorageAdapter';

export const MAX_WORKBENCH_BACKUP_BYTES = 128 * 1024 * 1024;
const catalogPaths = ['workbench.json', 'posts/library.json', 'machines/library.json'];
const hashSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });
const schema = Type.Object({
  format: Type.Literal('wire-edm-workbench-backup'), schemaVersion: Type.Literal(1),
  appVersion: Type.String({ maxLength: 40 }), createdAt: Type.String({ maxLength: 40 }),
  files: Type.Array(Type.Object({ path: Type.String({ minLength: 1, maxLength: 1024 }), text: Type.String(), sha256: hashSchema }, { additionalProperties: false }), { minItems: 3, maxItems: 10_000 }),
  contentHash: hashSchema
}, { additionalProperties: false });
type Backup = Static<typeof schema>;
export interface PreparedWorkbenchBackup {
  readonly text: string;
  readonly contentHash: string;
  readonly summary: { readonly name: string; readonly files: number; readonly projects: number; readonly trashedProjects: number; readonly machines: number; readonly posts: number; readonly revisions: number };
  readonly unreferencedPaths: readonly string[];
}
const preparedFiles = new WeakMap<PreparedWorkbenchBackup, Backup['files']>();
const bytes = (text: string) => new TextEncoder().encode(text);
async function hash(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(text))), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const fileHash = (files: Backup['files']) => hash(JSON.stringify(files.map(({ path, sha256 }) => [path, sha256])));

function memoryStorage(files: Backup['files']): WorkbenchStorageAdapter {
  const data = new Map(files.map(({ path, text }) => [path, text]));
  return { kind: 'memory', name: 'Backup validation', ensureDirectory: async () => {},
    readText: async (path) => data.get(path) ?? null, writeText: async (path, text) => { data.set(path, text); },
    deleteText: async (path) => { data.delete(path); }, listFiles: async () => ({ paths: [...data.keys()].sort(), truncated: false }) };
}

/** Validate hashes, libraries, active/trash ownership and every indexed saved revision without executing posts. */
export async function prepareWorkbenchBackup(text: string): Promise<PreparedWorkbenchBackup> {
  if (bytes(text).byteLength > MAX_WORKBENCH_BACKUP_BYTES) throw new Error('Workbench backup exceeds the 128 MiB limit.');
  const value: unknown = JSON.parse(text);
  if (!Value.Check(schema, value)) throw new Error('Unsupported or malformed workbench backup.');
  const files = value.files;
  const paths = new Set<string>();
  for (const file of files) {
    if (!isPortableStoragePath(file.path) || file.path.toLowerCase().startsWith('transactions/') || paths.has(file.path.toLowerCase())) throw new Error(`Unsafe, duplicate or pending-recovery backup path: ${file.path}`);
    paths.add(file.path.toLowerCase());
    if (new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes(file.text)) !== file.text) throw new Error(`Backup text cannot round-trip as UTF-8: ${file.path}`);
    if (await hash(file.text) !== file.sha256) throw new Error(`Backup checksum mismatch: ${file.path}`);
  }
  for (const file of files) {
    const parts = file.path.toLowerCase().split('/');
    for (let index = 1; index < parts.length; index++) if (paths.has(parts.slice(0, index).join('/'))) throw new Error('Backup contains a file/directory path collision.');
  }
  if (await fileHash(files) !== value.contentHash) throw new Error('Backup inventory checksum mismatch.');
  if (!catalogPaths.every((path) => files.some((file) => file.path === path))) throw new Error('Backup is missing required catalogs.');
  const catalog = JSON.parse(files.find(({ path }) => path === 'workbench.json')!.text);
  if (catalog.schemaVersion !== 3) throw new Error('Open and migrate this workbench in a compatible app before backing it up.');
  const adapter = memoryStorage(files);
  const opened = await initializeWorkbenchCatalog(adapter);
  if (!opened.ok) throw new Error(opened.error.message);
  const { workbench } = opened;
  const entries = [...workbench.manifest.projects, ...(workbench.manifest.deletedProjects ?? []).map(({ project }) => project)];
  const ownership = await validateWorkbenchProjectPathOwnership(adapter, entries);
  if (!ownership.ok) throw new Error(ownership.error.message);
  const referenced = new Set(catalogPaths);
  let revisions = 0;
  for (const project of ownership.projects) {
    for (const path of workbenchProjectOwnedPaths(project)) referenced.add(path);
    for (const id of project.savedRevisionIds) {
      const revision = await parseSavedWireEdmJobRevision((await adapter.readText(workbenchProjectRevisionPath(project.id, id)))!);
      if (!revision.ok) throw new Error(`Revision ${id}: ${revision.error.message}`);
      if (revision.candidate.project.id !== project.id || revision.candidate.revisionId !== id) throw new Error(`Revision ownership mismatch: ${id}`);
      revisions++;
    }
  }
  const prepared = Object.freeze({ text, contentHash: value.contentHash,
    summary: Object.freeze({ name: workbench.manifest.name, files: files.length, projects: workbench.manifest.projects.length,
      trashedProjects: workbench.manifest.deletedProjects?.length ?? 0, machines: workbench.machines.machines.length,
      posts: workbench.posts.installations.length, revisions }),
    unreferencedPaths: Object.freeze(files.map(({ path }) => path).filter((path) => !referenced.has(path) && !/^(legacy|transactions|posts|machines)\//i.test(path) && !/\.wireedm-job\.json$/i.test(path)))
  });
  preparedFiles.set(prepared, files);
  return prepared;
}

async function captureFiles(adapter: WorkbenchStorageAdapter) {
  if (!adapter.listFiles) throw new Error('Complete file inventory is unavailable.');
  const listed = await adapter.listFiles();
  if (listed.truncated) throw new Error('Storage inventory is incomplete; a complete backup is required.');
  const files: Backup['files'] = [];
  let total = 0;
  for (const path of listed.paths.sort()) {
    if (/^transactions\//i.test(path)) throw new Error('Pending recovery files exist. Reopen the workbench before backup.');
    const text = await (adapter.readExactText ? adapter.readExactText(path) : adapter.readText(path));
    if (text === null) throw new Error(`File disappeared during backup: ${path}`);
    total += bytes(text).byteLength;
    if (total > MAX_WORKBENCH_BACKUP_BYTES) throw new Error('Workbench exceeds the 128 MiB backup limit.');
    files.push({ path, text, sha256: await hash(text) });
  }
  return files;
}

export async function createWorkbenchBackup(workbench: ConnectedWorkbenchCatalog) {
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    const files = await captureFiles(workbench.adapter);
    return prepareWorkbenchBackup(JSON.stringify({ format: 'wire-edm-workbench-backup', schemaVersion: 1,
      appVersion: APP_VERSION, createdAt: new Date().toISOString(), files, contentHash: await fileHash(files) }));
  }, { recoverFiles: false });
}

/** Empty destination only: restore never merges identities or overwrites an existing library. */
export async function restoreWorkbenchBackup(adapter: WorkbenchStorageAdapter, prepared: PreparedWorkbenchBackup) {
  const files = preparedFiles.get(prepared);
  if (!files) throw new Error('Review and validate the backup before restoring.');
  return withWorkbenchMutationLock(adapter, async () => {
    const currentFiles = await captureFiles(adapter);
    const current = await prepareWorkbenchBackup(JSON.stringify({ format: 'wire-edm-workbench-backup', schemaVersion: 1,
      appVersion: APP_VERSION, createdAt: new Date().toISOString(), files: currentFiles, contentHash: await fileHash(currentFiles) }));
    if (current.summary.projects || current.summary.trashedProjects || current.summary.machines || current.summary.posts
      || currentFiles.some(({ path }) => !catalogPaths.includes(path))) {
      throw new Error('Restore requires an empty workbench. Choose an empty folder or use a fresh browser workbench; existing files will not be replaced.');
    }
    await commitWorkbenchFileTransaction(adapter, files.map(({ path, text }) => ({ path, contents: text })));
  });
}

/** The caller presents explicit selections and obtains confirmation that the downloaded backup is saved. */
export async function removeUnreferencedWorkbenchFiles(workbench: ConnectedWorkbenchCatalog, backup: PreparedWorkbenchBackup, selected: readonly string[]) {
  if (!preparedFiles.has(backup)) throw new Error('Create a verified backup before cleanup.');
  if (!selected.length || new Set(selected).size !== selected.length || selected.some((path) => !backup.unreferencedPaths.includes(path))) throw new Error('Cleanup can only remove explicitly selected unreferenced files.');
  return withWorkbenchMutationLock(workbench.adapter, async () => {
    if (await fileHash(await captureFiles(workbench.adapter)) !== backup.contentHash) throw new Error('Storage changed after backup. Create and review a new backup before cleanup.');
    await commitWorkbenchFileTransaction(workbench.adapter, selected.map((path) => ({ path, contents: null })));
  });
}
