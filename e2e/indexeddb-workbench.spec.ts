import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createUpidFromDxfEntities } from '../src/domain/upid/upidDocument';
import { setManualCompensationIntent } from '../src/domain/compensation/intent';
import { buildMachinePackageArchive } from '../src/domain/machine-package';
import { machinePackageFixture } from '../src/domain/machine-package/__tests__/machinePackageFixture';
import { prepareCadTools, rawCadToolCall } from './cad-tool-helpers';
import { readWorkbenchCacheFile, readWorkbenchCache } from './fixtures/workbench-cache';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function exportThroughPublicTools(page: Page, machineId: string, bindingId: string) {
  const context=await rawCadToolCall(page,'edm_get_context');
  const workflow=await rawCadToolCall(page,'edm_workflow_context');
  expect(context.ok).toBe(true);expect(workflow.ok).toBe(true);
  const result=await rawCadToolCall(page,'edm_generate_controller',{
    expectedVersion:workflow.data.version,draftVersion:context.data.draft.version,machineId,bindingId
  });
  expect(result,JSON.stringify(result)).toMatchObject({ok:true,data:{generated:true,artifactId:expect.any(String),sha256:expect.any(String)}});
  const pending=page.waitForEvent('download');
  expect(await rawCadToolCall(page,'edm_download_artifact',{artifactId:result.data.artifactId})).toMatchObject({ok:true});
  const download=await pending;const bytes=await readFile((await download.path())!);
  expect(sha(bytes)).toBe(result.data.sha256);
  return {result:result.data,bytes};
}

test('imports, atomically exports, reopens and backs up a large job through the public UI and tools',async({page})=>{
  test.setTimeout(120_000);
  await page.addInitScript(()=>{Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:undefined});});
  await prepareCadTools(page);
  const source=await machinePackageFixture({machineId:'native.large.machine'});
  const built=await buildMachinePackageArchive({...source,document:{...source.document,machine:{...source.document.machine,limits:{...source.document.machine.limits,yTravel:{status:'known',millimeters:200}}}}});
  if(!built.ok)throw new Error(JSON.stringify(built.diagnostics));
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await page.getByRole('button',{name:'Machines & setups',exact:true}).click();
  await page.getByLabel('Machine package file',{exact:true}).setInputFiles({name:'large-job.wireedm-package',mimeType:'application/zip',buffer:Buffer.from(built.archive)});
  await page.locator('[data-machine-package-preview]').getByRole('button',{name:'Install machine package',exact:true}).click();
  await expect(page.getByText('Saved and verified from storage.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close settings',exact:true}).click();
  const count=6_000;
  const geometry=createUpidFromDxfEntities(Array.from({length:count},(_,index)=>({type:'line',layer:'CUT',
    start:{x:45+40*Math.cos(index/count*2*Math.PI),y:45+40*Math.sin(index/count*2*Math.PI)},
    end:{x:45+40*Math.cos((index+1)%count/count*2*Math.PI),y:45+40*Math.sin((index+1)%count/count*2*Math.PI)}
  })));
  const document=setManualCompensationIntent(geometry,geometry.plan.operations[0].id,'centerline');
  if(!document)throw new Error('Fixture compensation must be explicit');
  document.geometryBasis='wire-centre';document.setup={initialWirePosition:{kind:'manual',point:document.plan.operations[0].startPoint,review:'reviewed'}};
  const portable=Buffer.from(JSON.stringify({format:'upid',schemaVersion:document.schemaVersion,document}));
  expect(portable.length).toBeGreaterThan(5*1024*1024);
  await page.getByLabel('UPID path project file',{exact:true}).setInputFiles({name:'large-varied.upid.json',mimeType:'application/json',buffer:portable});
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const current=await rawCadToolCall(page,'edm_get_context');
  const projectId=current.data.draft.projectId;
  const posts=await readWorkbenchCacheFile(page,'posts/library.json');
  // Abort a real engine transaction after its revision request was queued but
  // before the project/index replacements can complete. The public operation
  // must report failure with no partial revision, then permit an ordinary retry.
  const projectBefore=await readWorkbenchCacheFile(page,`projects/${projectId}.json`);
  await page.evaluate(projectId=>{
    const put=IDBObjectStore.prototype.put;
    Reflect.set(window,'restoreAtomicStorageTest',()=>{IDBObjectStore.prototype.put=put;});
    IDBObjectStore.prototype.put=function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==='files'&&key===`projects/${projectId}.json`)throw new DOMException('Injected interrupted native save','QuotaExceededError');
      return put.call(this,value,key);
    };
  },projectId);
  try {
    const draft=await rawCadToolCall(page,'edm_get_context'),workflow=await rawCadToolCall(page,'edm_workflow_context');
    const failed=await rawCadToolCall(page,'edm_generate_controller',{expectedVersion:workflow.data.version,draftVersion:draft.data.draft.version,machineId:'native.large.machine',bindingId:'production'});
    expect(failed).toMatchObject({ok:true,data:{generated:false,error:{code:'CONTROLLER_ARTIFACT_REVISION_SAVE_FAILED'}}});
    expect(await readWorkbenchCacheFile(page,`projects/${projectId}.json`)).toBe(projectBefore);
    expect((await readWorkbenchCache(page)).some(([path])=>path.endsWith('.wireedm-job.json'))).toBe(false);
    expect(await readWorkbenchCacheFile(page,'posts/library.json')).toBe(posts);
  } finally {await page.evaluate(()=>Reflect.get(window,'restoreAtomicStorageTest')());}
  const first=await exportThroughPublicTools(page,'native.large.machine','production');
  const second=await exportThroughPublicTools(page,'native.large.machine','production');
  expect(second.result.artifactId).toBe(first.result.artifactId);expect(second.bytes).toEqual(first.bytes);
  const saved=JSON.parse(await readWorkbenchCacheFile(page,`projects/${projectId}.json`));
  expect(saved.savedRevisionIds).toEqual([first.result.artifactId]);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('wire-edm-workbench:file:')))).toEqual([]);
  await page.reload();await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const reopened=await exportThroughPublicTools(page,'native.large.machine','production');
  expect(reopened.result.artifactId).toBe(first.result.artifactId);expect(reopened.bytes).toEqual(first.bytes);
  expect(await readWorkbenchCacheFile(page,'posts/library.json')).toBe(posts);
  await page.getByRole('button',{name:'Open settings',exact:true}).click();
  await expect(page.getByRole('button',{name:'Create and download backup',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Choose backup to restore',exact:true})).toBeDisabled();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Create and download backup',exact:true}).click();
  const download=await pending;const archive=JSON.parse(await readFile((await download.path())!,'utf8'));
  expect(archive.files).toContainEqual(expect.objectContaining({path:'posts/library.json',text:posts}));
  expect(archive.files).toContainEqual(expect.objectContaining({path:`projects/${projectId}/revisions/${first.result.artifactId}.wireedm-job.json`}));
});

// Optional acceptance against a user's private cache capture. No private fixture
// is committed, and the test browser has its own disposable origin/profile.
test('preserves a private legacy cache and reproduces its exact reviewed controller artifact',async({page})=>{
  const snapshotPath=process.env.WIRE_EDM_PRIVATE_CACHE_SNAPSHOT,projectId=process.env.WIRE_EDM_PRIVATE_PROJECT;
  test.skip(!snapshotPath||!projectId,'Supply a private cache snapshot and project only for local acceptance.');test.setTimeout(120_000);
  const entries: Record<string,string>=JSON.parse(await readFile(snapshotPath!,'utf8'));
  await page.addInitScript(entries=>{for(const[key,value]of Object.entries(entries))localStorage.setItem(key,value);},entries);
  await prepareCadTools(page);
  const before=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('wire-edm-workbench:'))));
  const migrated=new Map(await readWorkbenchCache(page));
  const gzipPrefix='\u0000wire-edm-cache-gzip-v1:';
  for(const [key,text] of Object.entries(entries).filter(([key])=>key.startsWith('wire-edm-workbench:file:'))){
    const exact=text.startsWith(gzipPrefix)?gunzipSync(Buffer.from(text.slice(gzipPrefix.length),'base64')).toString('utf8'):text;
    expect(migrated.get(key),`Exact migrated original: ${key}`).toBe(exact);
  }
  const workflow=await rawCadToolCall(page,'edm_workflow_context');
  expect(await rawCadToolCall(page,'edm_open_project',{expectedVersion:workflow.data.version,projectId})).toMatchObject({ok:true});
  await expect(page.locator('[data-editor-context="path-project"]')).toBeVisible();
  const machineLibrary=JSON.parse(await readWorkbenchCacheFile(page,'machines/library.json'));
  const machine=machineLibrary.machines.find((machine:{id:string})=>machine.id===process.env.WIRE_EDM_PRIVATE_MACHINE);
  if(!machine)throw new Error('Select the exact installed private machine with WIRE_EDM_PRIVATE_MACHINE');
  const output=await exportThroughPublicTools(page,machine.id,machine.activeBindingId);
  if(process.env.WIRE_EDM_PRIVATE_EXPECTED_SHA256)expect(output.result.sha256).toBe(process.env.WIRE_EDM_PRIVATE_EXPECTED_SHA256);
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('wire-edm-workbench:'))))).toEqual(before);
});
