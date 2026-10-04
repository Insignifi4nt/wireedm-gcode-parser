import { describe, expect, it, vi } from 'vitest';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { commitDxfProjectImport } from '../importDxfProject';
import { prepareDxfProjectImport } from '../prepareDxfProjectImport';
import { prepareDxfProjectReimport, commitDxfProjectReimport } from '../reimportDxfProjectUnits';
import { directDxfProcessor } from '@/features/dxf-import/dxfProcessorTestSupport';

const text = '\ufeff0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n10\r\n0\r\n20\r\n0\r\n11\r\n10\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
const decision = { unitCandidateId: 'millimeters', confirmed: true, declaredUnitOverrideAcknowledged: false };
const rebuildDecision = { ...decision, unitCandidateId: 'inches', rebuildAcknowledged: true };
class Adapter implements WorkbenchStorageAdapter {
  readonly name = 'DXF async integrity'; readonly kind = 'memory';
  readonly files = new Map<string, string>();
  beforeWrite: ((path: string) => Promise<void>) | undefined;
  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async deleteText(path: string) { this.files.delete(path); }
  async writeText(path: string, contents: string) { await this.beforeWrite?.(path); this.files.set(path, contents); }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const adapter = new Adapter();
  const connected = await initializeWorkbenchCatalog(adapter);
  if (!connected.ok) throw new Error(connected.error.message);
  const prepared = prepareDxfProjectImport(connected.workbench, { fileName: 'original.dxf', text, now: new Date('2026-10-04T00:00:00Z') });
  if (!prepared.ok) throw new Error(prepared.error.message);
  return { adapter, workbench: connected.workbench, preparation: prepared.preparation };
}

describe('asynchronous DXF persistence boundaries', () => {
  it('writes nothing if cancelled while planning waits for a processor', async () => {
    const { adapter, workbench, preparation } = await fixture();
    const before = new Map(adapter.files);
    const controller = new AbortController(); const waiting = gate(); const started = gate();
    const processor = { ...directDxfProcessor, plan: async (...args: Parameters<typeof directDxfProcessor.plan>) => {
      started.resolve(); await waiting.promise; return directDxfProcessor.plan(...args);
    } };
    const pending = commitDxfProjectImport(workbench, preparation, decision, { processor, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise; controller.abort(); waiting.resolve(); await rejected;
    expect(adapter.files).toEqual(before);
  });

  it('writes no journal if cancelled while waiting for the storage mutation lock', async () => {
    const { adapter, workbench, preparation } = await fixture();
    const before = new Map(adapter.files); const controller = new AbortController(); const waiting = gate(); const locked = gate();
    const holding = withWorkbenchMutationLock(adapter, async () => { locked.resolve(); await waiting.promise; });
    await locked.promise;
    const planned = gate();
    const processor = { ...directDxfProcessor, plan: async (...args: Parameters<typeof directDxfProcessor.plan>) => {
      const result = await directDxfProcessor.plan(...args); planned.resolve(); return result;
    } };
    const pending = commitDxfProjectImport(workbench, preparation, decision, { processor, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await planned.promise; controller.abort(); waiting.resolve(); await holding; await rejected;
    expect(adapter.files).toEqual(before);
  });

  it('returns the committed project when cancellation arrives after the journal starts', async () => {
    const { adapter, workbench, preparation } = await fixture();
    const controller = new AbortController();
    adapter.beforeWrite = async path => { if (path === WORKBENCH_FILE_TRANSACTION_PATH) controller.abort(); };
    const result = await commitDxfProjectImport(workbench, preparation, decision, { processor: directDxfProcessor, signal: controller.signal });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(adapter.files.get(result.project.source.files[0].path)).toBe(text);
    expect(result.workbench.manifest.projects).toHaveLength(1);
    expect(adapter.files.has(WORKBENCH_FILE_TRANSACTION_PATH)).toBe(false);
  });

  it.each(['source', 'project'] as const)('preserves %s changes made while a reviewed reimport is planning', async changed => {
    const { adapter, workbench, preparation } = await fixture();
    const imported = await commitDxfProjectImport(workbench, preparation, decision);
    if (!imported.ok) throw new Error(imported.error.message);
    const prepared = await prepareDxfProjectReimport(imported.workbench, imported.project.id);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const processor = { ...directDxfProcessor, plan: vi.fn(async (...args: Parameters<typeof directDxfProcessor.plan>) => {
      const path = changed === 'source' ? imported.project.source.files[0].path : `projects/${imported.project.id}.json`;
      if (changed === 'source') adapter.files.set(path, text.replace('10\r\n21', '11\r\n21'));
      else {
        const entry = imported.workbench.manifest.projects.find(({ id }) => id === imported.project.id)!;
        adapter.files.set(entry.path, JSON.stringify({ ...imported.project,
          source: { ...imported.project.source, files: imported.project.source.files.map(file => ({ ...file, name: 'Externally renamed.dxf' })) }
        }));
      }
      return directDxfProcessor.plan(...args);
    }) };
    const beforeOther = adapter.files.get('workbench.json');
    const result = await commitDxfProjectReimport(imported.workbench, prepared.preparation, rebuildDecision, { processor });
    expect(result).toMatchObject({ ok: false, error: { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED' } });
    expect(adapter.files.get('workbench.json')).toBe(beforeOther);
    expect(adapter.files.has(WORKBENCH_FILE_TRANSACTION_PATH)).toBe(false);
    expect(processor.plan).toHaveBeenCalledOnce();
  });

  it('rejects a cancelled unchanged reimport after its asynchronous source read', async () => {
    const { adapter, workbench, preparation } = await fixture();
    const imported = await commitDxfProjectImport(workbench, preparation, decision);
    if (!imported.ok) throw new Error(imported.error.message);
    const prepared = await prepareDxfProjectReimport(imported.workbench, imported.project.id);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const before = new Map(adapter.files); const waiting = gate(); const reading = gate();
    const sourcePath = imported.project.source.files[0].path;
    const readText = adapter.readText.bind(adapter);
    adapter.readText = async path => {
      if (path === sourcePath) { reading.resolve(); await waiting.promise; }
      return readText(path);
    };
    const controller = new AbortController();
    const pending = commitDxfProjectReimport(imported.workbench, prepared.preparation, { ...decision, rebuildAcknowledged: false }, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await reading.promise; controller.abort(); waiting.resolve(); await rejected;
    expect(adapter.files).toEqual(before);
  });
});
