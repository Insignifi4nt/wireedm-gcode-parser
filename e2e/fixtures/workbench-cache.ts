import type { Page } from '@playwright/test';
import { gunzipSync } from 'node:zlib';

/** Read the persisted database independently of the app's adapter. */
export async function readWorkbenchCache(page: Page): Promise<[string,string][]> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some(database => database.name === 'wire-edm-workbench-files')) return Object.entries(localStorage).filter(([key])=>key.startsWith('wire-edm-workbench:')).sort(([a],[b])=>a.localeCompare(b));
    const db = await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('wire-edm-workbench-files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try { return await new Promise<[string,string][]>((resolve,reject)=>{
      const result: [string,string][]=[];const tx=db.transaction('files','readonly');
      tx.oncomplete=()=>resolve(result.sort(([a],[b])=>a.localeCompare(b)));tx.onabort=()=>reject(tx.error);
      const request=tx.objectStore('files').openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;result.push([`wire-edm-workbench:file:${cursor.key}`,cursor.value]);cursor.continue();};
    }); } finally { db.close(); }
  });
}

/** Test-only corruption/setup changes to the current store, never the retained legacy copy. */
export async function writeWorkbenchCacheFiles(page: Page, files: Record<string,string>) {
  await page.evaluate(async files => {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('wire-edm-workbench-files');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try { await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['files','sizes'],'readwrite');tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
      for(const [path,text] of Object.entries(files)){tx.objectStore('files').put(text,path);tx.objectStore('sizes').put(new TextEncoder().encode(text).byteLength,path);}
    }); } finally {db.close();}
  }, files);
}

export async function readWorkbenchCacheFile(page: Page, path: string) {
  const stored = (await readWorkbenchCache(page)).find(([key])=>key === `wire-edm-workbench:file:${path}`)?.[1];
  if (stored === undefined) throw new Error(`Missing workbench file: ${path}`);
  const prefix = '\u0000wire-edm-cache-gzip-v1:';
  return stored.startsWith(prefix)
    ? gunzipSync(Buffer.from(stored.slice(prefix.length), 'base64')).toString('utf8')
    : stored;
}

interface SeedWorkbenchOptions {
  folder?: string;
  namespace?: string;
  project?: string;
}

export async function seedWorkbenchCacheFromFolder(
  page: Page,
  options: SeedWorkbenchOptions = {}
) {
  const { buildWorkbenchCacheSeed } = await import('../../scripts/playwright-workbench-cache.mjs');
  const seed = buildWorkbenchCacheSeed(options);

  await page.goto('/');
  await page.evaluate(
    async ({ entries, namespace }) => {
      await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('wire-edm-workbench-files');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Test cache reset blocked by an open connection'));});
      const prefix = `${namespace}:`;
      const keysToRemove: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(prefix)) keysToRemove.push(key);
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      entries.forEach(([key, value]) => localStorage.setItem(key, value));
    },
    {
      entries: seed.entries,
      namespace: seed.namespace
    }
  );

  return seed;
}

/**
 * Reset only this application's browser-cache namespace before a real upload
 * journey. The caller still reaches the editor through the visible dashboard.
 */
export async function clearWorkbenchCache(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('wire-edm-workbench-files');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Test cache reset blocked by an open connection'));});
    const prefix = 'wire-edm-workbench:';
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  });
  await page.reload();
}
