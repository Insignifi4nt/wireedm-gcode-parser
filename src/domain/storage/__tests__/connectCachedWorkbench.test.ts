import { describe, expect, it, vi } from 'vitest';
import { IDBObjectStore } from 'fake-indexeddb';

import { connectCachedWorkbench } from '../connectCachedWorkbench';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import { createWorkbenchBackup } from '../workbenchBackup';
import { captureWorkbenchRecovery } from '../workbenchRecovery';
import { openIndexedDbWorkbench } from '../indexedDbWorkbenchAdapter';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('connectCachedWorkbench', () => {
  it('reopens and backs up existing projects when the browser rejects new writes', async () => {
    const storage = new MemoryStorage();
    const connected = await connectCachedWorkbench({ storage });
    if (!connected.ok) throw new Error(connected.error.message);
    const imported = await importExternalProgram(connected.workbench, {
      fileName: 'plate.nc', text: 'G21\nG1 X10 Y5'
    });
    if (!imported.ok) throw new Error(imported.error.message);
    const original = Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index)!;
      return [key, storage.getItem(key)];
    });
    const rejectWrites = vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', storage);
    try {
      const reopened = await connectCachedWorkbench();
      if (!reopened.ok) throw new Error(reopened.error.message);
      expect(reopened.workbench.adapter.kind).toBe('browser-cache');
      expect(reopened.workbench.adapter.name).toBe('Browser storage');
      expect(reopened.workbench.manifest.projects).toEqual(imported.workbench.manifest.projects);
      expect(await reopened.workbench.adapter.readText(imported.editorProgram.filePath)).toBe(imported.editorProgram.text);
      const backup = await createWorkbenchBackup(reopened.workbench);
      expect(backup.summary.projects).toBe(1);
      expect(JSON.parse(backup.text).files).toContainEqual(expect.objectContaining({
        path: imported.editorProgram.filePath, text: imported.editorProgram.text
      }));
      expect(original.every(([key, value]) => storage.getItem(key!) === value)).toBe(true);
      expect(storage.length).toBe(original.length);
    } finally {
      rejectWrites.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('reports an existing invalid cache when writes fail instead of creating a temporary replacement', async () => {
    const storage = new MemoryStorage();
    const original = '{damaged catalog';
    storage.setItem('wire-edm-workbench:file:workbench.json', original);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', storage);
    try {
      const result = await connectCachedWorkbench();
      expect(result).toMatchObject({ ok: false });
      expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(original);
      expect(storage.length).toBe(1);
    } finally { vi.unstubAllGlobals(); }
  });

  it.each(['missing', 'blocked'])('uses explicit temporary storage when cross-tab coordination is %s without touching the existing cache', async (mode) => {
    const original = '{existing cache bytes}';
    localStorage.setItem('wire-edm-workbench:file:workbench.json', original);
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('indexedDB', mode === 'missing' ? undefined : { open: () => { throw new DOMException('Blocked', 'SecurityError'); } });
    try {
      const connected = await connectCachedWorkbench();
      expect(connected).toMatchObject({ ok: true, workbench: { adapter: { kind: 'memory', name: 'Temporary storage' } } });
      expect(localStorage.getItem('wire-edm-workbench:file:workbench.json')).toBe(original);
      expect(localStorage.getItem('wire-edm-workbench:file:posts/library.json')).toBeNull();
    } finally { localStorage.clear(); vi.unstubAllGlobals(); }
  });

  it('reconnects a saved project after its directory index is damaged', async () => {
    const storage = new MemoryStorage();
    const first = await connectCachedWorkbench({ storage });
    if (!first.ok) throw new Error(first.error.message);
    const imported = await importExternalProgram(first.workbench, { fileName: 'plate.nc', text: 'G21\nG1 X10 Y5' });
    if (!imported.ok) throw new Error(imported.error.message);
    const manifest = storage.getItem('wire-edm-workbench:file:workbench.json');
    storage.setItem('wire-edm-workbench:directories', '{damaged');
    const reopened = await connectCachedWorkbench({ storage });
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.projects).toEqual(imported.workbench.manifest.projects);
    expect(await reopened.workbench.adapter.readText(imported.editorProgram.filePath)).toBe(imported.editorProgram.text);
    await reopened.workbench.adapter.ensureDirectory('projects');
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(manifest);
    expect(JSON.parse(storage.getItem('wire-edm-workbench:directories')!)).toContain('projects');
  });

  it('creates a strict V2 browser-cache catalog without directory access', async () => {
    const storage = new MemoryStorage();

    const result = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: {
        adapter: { kind: 'browser-cache' },
        manifest: {
          schemaVersion: 3,
          name: 'Local storage',
          preferences: {
            importUnits: { mode: 'ask' },
            recentPlanningMachineId: null
          },
          projects: []
        },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toContain(
      '"schemaVersion": 3'
    );
    expect(storage.getItem('wire-edm-workbench:file:posts/library.json')).not.toBeNull();
    expect(storage.getItem('wire-edm-workbench:file:machines/library.json')).not.toBeNull();
  });

  it('opens the same V2 catalog without mutating its manifest timestamps', async () => {
    const storage = new MemoryStorage();
    const first = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:00:00.000Z')
    });
    const storedBefore = storage.getItem('wire-edm-workbench:file:workbench.json');

    const second = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:05:00.000Z')
    });

    expect(first).toMatchObject({ ok: true, kind: 'created' });
    expect(second).toMatchObject({
      ok: true,
      kind: 'opened',
      workbench: {
        manifest: {
          createdAt: '2026-08-28T14:00:00.000Z',
          updatedAt: '2026-08-28T14:00:00.000Z'
        }
      }
    });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(storedBefore);
  });

  it('rejects an invalid V1 cache without rewriting it', async () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify({ schemaVersion: 1, machineProfiles: [] });
    storage.setItem('wire-edm-workbench:file:workbench.json', original);

    const { recoverySource, ...failure } = await connectCachedWorkbench({ storage });
    expect(failure).toEqual({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID',
        message: 'Legacy workbench manifest schema violation at /name: Expected required property.',
        path: '/name'
      }
    });
    expect(recoverySource?.adapter.kind).toBe('browser-cache');
    expect(await recoverySource?.adapter.readBoundedExactText?.('workbench.json', 4096)).toEqual({ status: 'read', text: original });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(original);
    expect(storage.getItem('wire-edm-workbench:file:posts/library.json')).toBeNull();
  });

  it('blocks an unreadable legacy source instead of silently creating an empty database', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      }
    });

    try {
      const result = await connectCachedWorkbench({
        now: new Date('2026-08-28T14:00:00.000Z')
      });

      expect(result).toMatchObject({ok:false,error:{code:'WORKBENCH_CONNECTION_FAILED'}});
      if(result.ok)throw new Error('Unexpected empty replacement');
      expect(result.error.message).toContain('new empty workbench was not created');
      expect(await indexedDB.databases()).toEqual([]);
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('does not replace an existing denied database with temporary or legacy storage',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:indexedDB,legacyStorage:localStorage});
    await adapter.writeText('imports/newer.nc','newer data');adapter.close();
    const fault=vi.spyOn(indexedDB,'open').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
    const result=await connectCachedWorkbench();expect(result).toMatchObject({ok:false});fault.mockRestore();
    const reopened=await openIndexedDbWorkbench({factory:indexedDB,legacyStorage:localStorage});
    expect(await reopened.readText('imports/newer.nc')).toBe('newer data');reopened.close();
  });

  it('makes newer database data and both exact legacy observations available when an older tab changed the source',async()=>{
    const storage=new MemoryStorage();const legacy=await connectCachedWorkbench({storage});if(!legacy.ok)throw new Error(legacy.error.message);
    vi.stubGlobal('localStorage',storage);
    try{
      const first=await connectCachedWorkbench();if(!first.ok)throw new Error(first.error.message);
      await first.workbench.adapter.writeText('imports/newer.nc','newer data');
      const sourceKey='wire-edm-workbench:file:workbench.json',original=storage.getItem(sourceKey);
      storage.setItem(sourceKey,'changed by older app');
      const result=await connectCachedWorkbench();expect(result.ok).toBe(false);
      const rescue=result.recoverySource?.adapter;if(!rescue)throw new Error('Expected database rescue');
      expect(await rescue.readBoundedExactText?.('indexeddb/files/imports/newer.nc',100)).toEqual({status:'read',text:'newer data'});
      const key=encodeURIComponent(JSON.stringify(sourceKey))+'.txt';
      expect(await rescue.readText('indexeddb/legacy-originals/'+key)).toBe(original);
      expect(await rescue.readText('legacy-localstorage/'+key)).toBe('changed by older app');
    }finally{vi.unstubAllGlobals();}
  });

  it.each(['length','key','getItem'] as const)('rescues newer database files when the legacy Storage object is readable but %s is denied',async method=>{
    const storage=new MemoryStorage();
    const legacy=await connectCachedWorkbench({storage});
    if(!legacy.ok)throw new Error(legacy.error.message);
    const originals=Object.fromEntries(Array.from({length:storage.length},(_,index)=>{
      const key=storage.key(index);
      if(key===null)throw new Error('Expected a complete legacy fixture');
      return[key,storage.getItem(key)];
    }));
    vi.stubGlobal('localStorage',storage);
    try{
      const first=await connectCachedWorkbench();
      if(!first.ok)throw new Error(first.error.message);
      const newer='\uFEFFnewer saved data\r\n';
      await first.workbench.adapter.writeText('imports/newer.nc',newer);
      const writes=vi.spyOn(storage,'setItem'),removals=vi.spyOn(storage,'removeItem');
      const databaseWrites=vi.spyOn(IDBObjectStore.prototype,'put'),databaseAdds=vi.spyOn(IDBObjectStore.prototype,'add'),databaseRemovals=vi.spyOn(IDBObjectStore.prototype,'delete');
      const deny=()=>{throw new DOMException('Legacy access denied','SecurityError');};
      const fault=method==='length'?vi.spyOn(storage,'length','get').mockImplementation(deny)
        :method==='key'?vi.spyOn(storage,'key').mockImplementation(deny)
        :vi.spyOn(storage,'getItem').mockImplementation(deny);
      const result=await connectCachedWorkbench();
      expect(result).toMatchObject({ok:false,error:{code:'WORKBENCH_CONNECTION_FAILED'}});
      const source=result.recoverySource;
      if(!source)throw new Error('Expected readable database recovery');
      const recovery=await captureWorkbenchRecovery(source);
      const archive=JSON.parse(recovery.text);
      expect(archive.files).toContainEqual(expect.objectContaining({path:'indexeddb/files/imports/newer.nc',status:'captured',text:newer}));
      const key='wire-edm-workbench:file:workbench.json';
      expect(archive.files).toContainEqual(expect.objectContaining({path:'indexeddb/legacy-originals/'+encodeURIComponent(JSON.stringify(key))+'.txt',status:'captured',text:originals[key]}));
      expect(recovery.receipt.contentComplete).toBe(false);
      if(method==='getItem')expect(archive.files).toContainEqual(expect.objectContaining({status:'unreadable',message:expect.stringContaining('Legacy access denied')}));
      else expect(archive.inventory).toMatchObject({complete:false,truncatedBefore:true,truncatedAfter:true});
      expect(writes).not.toHaveBeenCalled();expect(removals).not.toHaveBeenCalled();
      expect(databaseWrites).not.toHaveBeenCalled();expect(databaseAdds).not.toHaveBeenCalled();expect(databaseRemovals).not.toHaveBeenCalled();
      fault.mockRestore();
      expect(Object.fromEntries(Array.from({length:storage.length},(_,index)=>{
        const key=storage.key(index);
        if(key===null)throw new Error('Expected original cache key');
        return[key,storage.getItem(key)];
      }))).toEqual(originals);
    }finally{vi.restoreAllMocks();vi.unstubAllGlobals();}
  });
});
