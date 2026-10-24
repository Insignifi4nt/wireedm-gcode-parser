import { IDBDatabase, IDBFactory, IDBObjectStore, IDBVersionChangeEvent } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { connectCachedWorkbench } from '../connectCachedWorkbench';
import { initializeWorkbenchConnection } from '../initializeWorkbenchConnection';
import { INDEXED_DB_WORKBENCH_DATABASE, openIndexedDbWorkbench, openReadOnlyIndexedDbWorkbench, readLegacyCacheSnapshot } from '../indexedDbWorkbenchAdapter';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function legacyFixture() {
  const storage = new MemoryStorage();
  const connected = await connectCachedWorkbench({ storage, now: new Date('2026-10-24T10:00:00.000Z') });
  if (!connected.ok) throw new Error(connected.error.message);
  return storage;
}

async function mutateDatabase(factory: IDBFactory, mutate: (tx: IDBTransaction) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(INDEXED_DB_WORKBENCH_DATABASE);
    request.onerror = () => reject(request.error); request.onsuccess = () => resolve(request.result);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['files', 'sizes', 'legacy', 'metadata'], 'readwrite');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      mutate(tx);
    });
  } finally { db.close(); }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('IndexedDB browser workbench', () => {
  it('saves and reopens data larger than the entire localStorage allowance without a folder picker', async () => {
    const factory = new IDBFactory();
    const adapter = await openIndexedDbWorkbench({factory,legacyStorage:null});
    const source = '\uFEFF' + 'G1 X123.456 Y789.012\r\n'.repeat(350_000);
    expect(new TextEncoder().encode(source).byteLength).toBeGreaterThan(5 * 1024 * 1024);
    await adapter.writeText('imports/large-source.nc', source);
    adapter.close();
    const reopened = await openIndexedDbWorkbench({factory,legacyStorage:null});
    expect(await reopened.readExactText?.('imports/large-source.nc')).toBe(source);
    expect(await reopened.readText('imports/large-source.nc')).toBe(source.slice(1));
    expect((await reopened.listFiles?.())?.paths).toContain('imports/large-source.nc');
    reopened.close();
  });

  it('migrates all logical files and preserves exact compressed envelopes and BOM originals without writing legacy storage', async () => {
    const factory = new IDBFactory(), storage = await legacyFixture();
    const legacy = createBrowserCacheAdapter(storage);
    const source = '\uFEFF' + 'G1 X12 Y25 (Oțel ⚙)\r\n'.repeat(5000);
    await legacy.writeText('imports/original.nc',source);
    await legacy.writeText('legacy/retained.txt','\uFEFF{historical original}');
    const catalogKey='wire-edm-workbench:file:workbench.json';
    storage.setItem(catalogKey,'\uFEFF'+storage.getItem(catalogKey));
    const originals=new Map(storage.values);
    const writes=vi.spyOn(storage,'setItem').mockImplementation(()=>{throw new DOMException('Full','QuotaExceededError');});
    const removals=vi.spyOn(storage,'removeItem');
    const adapter=await openIndexedDbWorkbench({factory,legacyStorage:storage});
    expect(await adapter.readExactText?.('imports/original.nc')).toBe(source);
    expect(await adapter.readExactText?.('legacy/retained.txt')).toBe('\uFEFF{historical original}');
    expect(await adapter.readLegacyOriginals()).toEqual(originals);
    expect(storage.values).toEqual(originals);
    expect(writes).not.toHaveBeenCalled();expect(removals).not.toHaveBeenCalled();
    adapter.close();
  });

  it('recovers pending journals only in the validated destination and retains their exact legacy originals', async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture();
    storage.setItem('wire-edm-workbench:file:transactions/saved-revision.json','');
    const adapter=await openIndexedDbWorkbench({factory,legacyStorage:storage});
    expect(await adapter.readExactText?.('transactions/saved-revision.json')).toBe('');
    const opened=await initializeWorkbenchConnection(adapter);
    expect(opened.ok).toBe(true);
    expect(await adapter.readExactText?.('transactions/saved-revision.json')).toBeNull();
    expect(storage.getItem('wire-edm-workbench:file:transactions/saved-revision.json')).toBe('');
    expect((await adapter.readLegacyOriginals()).get('wire-edm-workbench:file:transactions/saved-revision.json')).toBe('');
    adapter.close();
  });

  it('validates the proposed library before publishing any destination files',async()=>{
    const factory=new IDBFactory(),storage=new MemoryStorage();
    storage.setItem('wire-edm-workbench:file:workbench.json','{broken');
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('migration validation failed');
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe('{broken');
    const recovery=await openReadOnlyIndexedDbWorkbench(factory);
    expect((await recovery?.listFiles?.())?.paths).toEqual([]);
  });

  it('retries an exact staged copy after publication is interrupted',async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture();
    const original=IDBObjectStore.prototype.put;
    const fault=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){
      if(this.name==='metadata')throw new Error('Interrupted before active publication');
      return original.call(this,value,key);
    });
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('Interrupted before active publication');
    fault.mockRestore();
    const reopened=await openIndexedDbWorkbench({factory,legacyStorage:storage});
    expect((await initializeWorkbenchConnection(reopened)).ok).toBe(true);
    expect(await reopened.readLegacyOriginals()).toEqual(storage.values);reopened.close();
  });

  it('retries a staged brand-new workbench without recreating its catalog',async()=>{
    const factory=new IDBFactory();const original=IDBObjectStore.prototype.put;
    const fault=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){if(this.name==='metadata')throw new Error('Publication interrupted');return original.call(this,value,key);});
    await expect(openIndexedDbWorkbench({factory,legacyStorage:null})).rejects.toThrow('Publication interrupted');fault.mockRestore();
    const reopened=await openIndexedDbWorkbench({factory,legacyStorage:null});
    expect((await initializeWorkbenchConnection(reopened)).ok).toBe(true);reopened.close();
  });

  it('retains the source when the initial staging transaction aborts and can retry',async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture(),originals=new Map(storage.values);
    const original=IDBObjectStore.prototype.add;
    const fault=vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){if(this.name==='metadata')throw new DOMException('Quota','QuotaExceededError');return original.call(this,value,key);});
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toMatchObject({name:'WorkbenchStorageFullError'});fault.mockRestore();
    const recovery=await openReadOnlyIndexedDbWorkbench(factory);expect((await recovery?.listFiles?.())?.paths).toEqual([]);
    const reopened=await openIndexedDbWorkbench({factory,legacyStorage:storage});expect(await reopened.readLegacyOriginals()).toEqual(originals);expect(storage.values).toEqual(originals);reopened.close();
  });

  it('rejects conflicting staged content instead of replacing it on retry',async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture(),original=IDBObjectStore.prototype.put;
    const fault=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){if(this.name==='metadata')throw new Error('Publication interrupted');return original.call(this,value,key);});
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('Publication interrupted');fault.mockRestore();
    await mutateDatabase(factory,tx=>{tx.objectStore('files').put('conflicting','workbench.json');});
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('Staged browser storage differs');
    expect(await(await openReadOnlyIndexedDbWorkbench(factory))?.readText('workbench.json')).toBe('conflicting');
  });

  it('blocks a changed legacy source at reconnect and before writes without overwriting either library',async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture();const adapter=await openIndexedDbWorkbench({factory,legacyStorage:storage});
    const previous=await adapter.readText('workbench.json');storage.setItem('wire-edm-workbench:file:imports/older-app.nc','new legacy data');
    await expect(adapter.writeText('workbench.json','overwrite')).rejects.toThrow('legacy browser cache changed');
    expect(await adapter.readText('workbench.json')).toBe(previous);adapter.close();
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('legacy browser cache changed');
    expect(storage.getItem('wire-edm-workbench:file:imports/older-app.nc')).toBe('new legacy data');
  });

  it('rejects incomplete legacy inventories and malformed exact originals without altering them',async()=>{
    const factory=new IDBFactory(),storage=await legacyFixture();
    const count=vi.spyOn(storage,'length','get').mockReturnValue(10_001);
    expect(()=>readLegacyCacheSnapshot(storage)).toThrow('inventory is incomplete');count.mockRestore();
    storage.setItem('wire-edm-workbench:file:imports/original.nc','\uD800');
    await expect(openIndexedDbWorkbench({factory,legacyStorage:storage})).rejects.toThrow('malformed Unicode');
    expect(storage.getItem('wire-edm-workbench:file:imports/original.nc')).toBe('\uD800');
  });

  it('atomically compares every guard before writing and skips equal-image guard writes',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:new IDBFactory(),legacyStorage:null});
    await adapter.writeText('projects/a.json','before');await adapter.writeText('machines/library.json','setup');
    const puts=vi.spyOn(IDBObjectStore.prototype,'put');
    await adapter.commitTextChanges?.([{path:'projects/a.json',previous:'before',next:'after'},{path:'machines/library.json',previous:'setup',next:'setup'}]);
    expect(await adapter.readText('projects/a.json')).toBe('after');
    expect(puts.mock.calls.some(([,key])=>key==='machines/library.json')).toBe(false);
    await expect(adapter.commitTextChanges?.([{path:'projects/a.json',previous:'after',next:'wrong'},{path:'machines/library.json',previous:'stale',next:'stale'}])).rejects.toThrow('No files were committed');
    expect(await adapter.readText('projects/a.json')).toBe('after');adapter.close();
  });

  it('does not return success when writes succeed but the transaction subsequently aborts',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:new IDBFactory(),legacyStorage:null});await adapter.writeText('projects/a.json','before');
    const original=IDBObjectStore.prototype.put;
    const fault=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){const request=original.call(this,value,key);if(this.name==='files')request.addEventListener('success',()=>this.transaction.abort(),{once:true});return request;});
    await expect(adapter.commitTextChanges?.([{path:'projects/a.json',previous:'before',next:'after'},{path:'projects/b.json',previous:null,next:'created'}])).rejects.toThrow();fault.mockRestore();
    expect(await adapter.readText('projects/a.json')).toBe('before');expect(await adapter.readText('projects/b.json')).toBeNull();adapter.close();
  });

  it('runs cancellation checks immediately before native writes and aborts without changing any file',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:new IDBFactory(),legacyStorage:null});await adapter.writeText('projects/a.json','before');
    const reason=new DOMException('Cancelled at native write boundary','AbortError');
    const beforeWrite=vi.fn(()=>{throw reason;});
    await expect(adapter.commitTextChanges?.([{path:'projects/a.json',previous:'before',next:'after'},{path:'projects/b.json',previous:null,next:'created'}],{beforeWrite})).rejects.toBe(reason);
    expect(beforeWrite).toHaveBeenCalledOnce();expect(await adapter.readText('projects/a.json')).toBe('before');expect(await adapter.readText('projects/b.json')).toBeNull();
    beforeWrite.mockClear();
    await adapter.commitTextChanges?.([{path:'projects/a.json',previous:'before',next:'before'}],{beforeWrite});expect(beforeWrite).not.toHaveBeenCalled();adapter.close();
  });

  it('does not treat a corrupted null record as an absent file during atomic comparison',async()=>{
    const factory=new IDBFactory(),adapter=await openIndexedDbWorkbench({factory,legacyStorage:null});
    await mutateDatabase(factory,tx=>{tx.objectStore('files').put(null,'projects/corrupted.json');});
    await expect(adapter.commitTextChanges?.([{path:'projects/corrupted.json',previous:null,next:'replacement'}])).rejects.toThrow('Invalid browser storage text');
    await expect(adapter.readText('projects/corrupted.json')).rejects.toThrow('Invalid browser storage text');adapter.close();
  });

  it('rolls back all files when a later write runs out of quota',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:new IDBFactory(),legacyStorage:null});await adapter.writeText('projects/a.json','before');
    const original=IDBObjectStore.prototype.put;
    const fault=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this: IDBObjectStore, value:unknown,key?:IDBValidKey){if(this.name==='files'&&key==='projects/b.json')throw new DOMException('Full','QuotaExceededError');return original.call(this,value,key);});
    await expect(adapter.commitTextChanges?.([{path:'projects/a.json',previous:'before',next:'after'},{path:'projects/b.json',previous:null,next:'created'}])).rejects.toMatchObject({name:'WorkbenchStorageFullError'});fault.mockRestore();
    expect(await adapter.readText('projects/a.json')).toBe('before');expect(await adapter.readText('projects/b.json')).toBeNull();adapter.close();
  });

  it('preflights bounded recovery reads and supports cancellation without returning partial text',async()=>{
    const adapter=await openIndexedDbWorkbench({factory:new IDBFactory(),legacyStorage:null});await adapter.writeText('imports/a.nc','\uFEFF⚙'.repeat(1000));
    const reads=vi.spyOn(IDBObjectStore.prototype,'get');
    expect(await adapter.readBoundedExactText?.('imports/a.nc',100)).toEqual({status:'too-large'});
    expect(reads.mock.contexts.every(store=>store instanceof IDBObjectStore && store.name!=='files')).toBe(true);
    const abort=new AbortController();abort.abort();
    await expect(adapter.readExactText?.('imports/a.nc',abort.signal)).rejects.toThrow();
    expect(await adapter.readBoundedExactText?.('imports/a.nc',10000)).toEqual({status:'read',text:'\uFEFF⚙'.repeat(1000)});adapter.close();
  });

  it('closes on version changes and refuses edits from the invalidated adapter',async()=>{
    const factory=new IDBFactory(),adapter=await openIndexedDbWorkbench({factory,legacyStorage:null});
    const upgraded=await new Promise<IDBDatabase>((resolve,reject)=>{const request=factory.open(INDEXED_DB_WORKBENCH_DATABASE,2);request.onerror=()=>reject(request.error);request.onsuccess=()=>resolve(request.result);});
    await expect(adapter.readText('workbench.json')).rejects.toThrow('changed in another tab');upgraded.close();
  });

  it('provides read-only recovery when coordination is missing without creating a missing database',async()=>{
    const factory=new IDBFactory();expect(await openReadOnlyIndexedDbWorkbench(factory)).toBeNull();expect(await factory.databases()).toEqual([]);
    const adapter=await openIndexedDbWorkbench({factory,legacyStorage:null});await adapter.writeText('imports/a.nc','source');adapter.close();
    const recovery=await openReadOnlyIndexedDbWorkbench(factory);expect(await recovery?.readText('imports/a.nc')).toBe('source');await expect(recovery?.writeText('imports/a.nc','changed')).rejects.toThrow('read-only');
    recovery?.close();
  });

  it.each(['normal','read-only'])('closes a late successful connection after a blocked %s open was rejected',async(mode)=>{
    const factory=new IDBFactory(),adapter=await openIndexedDbWorkbench({factory,legacyStorage:null});adapter.close();
    const close=vi.spyOn(IDBDatabase.prototype,'close'),original=factory.open.bind(factory);
    vi.spyOn(factory,'open').mockImplementation((name,version)=>{
      const request=original(name,version);
      queueMicrotask(()=>{request.dispatchEvent(new IDBVersionChangeEvent('blocked',{oldVersion:1,newVersion:2}));});
      return request;
    });
    await expect(mode==='normal'?openIndexedDbWorkbench({factory,legacyStorage:null}):openReadOnlyIndexedDbWorkbench(factory)).rejects.toThrow('blocked');
    await vi.waitFor(()=>expect(close).toHaveBeenCalledTimes(1));
  });
});
