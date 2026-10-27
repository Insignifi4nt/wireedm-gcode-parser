import { expect, test } from './fixtures/native-sketch-solver';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, relationControl } from './cad-tool-helpers';

test('edits a persistent circle row on a consumed sketch, restores exclusions and saves identical human/agent parts', async ({ page }) => {
  await prepareCadTools(page); await call(page, 'cad_open_workspace');
  const sketch = { id:'plate', kind:'sketch', name:'Pattern plate', suppressed:false, plane:'XY', offset:0, profiles:[], graph:{
    points:[{id:'a',position:[' 0.00 ','0']},{id:'b',position:['70','0']},{id:'c',position:['70','20']},{id:'d',position:['0','20']},{id:'center',position:['10','10']}],
    entities:[{id:'ab',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'bc',kind:'line',startPointId:'b',endPointId:'c',construction:false},
      {id:'cd',kind:'line',startPointId:'c',endPointId:'d',construction:false},{id:'da',kind:'line',startPointId:'d',endPointId:'a',construction:false},
      {id:'seed',kind:'circle',centerPointId:'center',radius:' boreRadius ',construction:false}],relations:[] } };
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'pitch',value:15},{kind:'set-parameter',name:'boreRadius',value:3},
    {kind:'add-feature',feature:sketch},{kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'plate',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page), read=(version:string)=>call(page,'cad_get_feature',{expectedVersion:version,featureId:'plate'}).then(r=>r.feature);
  const edit=async()=>{await (await historyRow(page, 'Pattern plate')).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();};
  const select=async(id:string)=>page.locator(`[data-cad-sketch-entity="${id}"]`).press('Enter');
  const apply=async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);};
  const finish=async()=>{await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);};
  const create=async()=>{await select('seed');await page.getByRole('button',{name:'Pattern',exact:true}).click();await page.getByRole('menuitem',{name:'Linear pattern',exact:true}).click();};
  const marker=(n:number)=>page.locator(`[data-cad-pattern-instance="${n}"]`);
  await edit();await create();await marker(2).press('Space');await expect(marker(2)).toHaveAttribute('aria-checked','false');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await read(base.version)).toEqual(sketch);
  await create();await page.getByRole('button',{name:'Edit Pitch relation',exact:true}).click();await page.getByRole('textbox',{name:'Pitch expression',exact:true}).fill(' pitch ');
  await page.getByRole('button',{name:'Keep relation',exact:true}).click();await page.getByRole('button',{name:'Close Pitch relation help',exact:true}).click();await apply();
  await (await relationControl(page, 'button', 'Edit pattern')).click();await marker(2).press('Space');await page.getByRole('spinbutton',{name:'Count',exact:true}).fill('2');await apply();
  await (await relationControl(page, 'button', 'Edit pattern')).click();await page.getByRole('spinbutton',{name:'Count',exact:true}).fill('4');await expect(marker(2)).toHaveAttribute('aria-checked','false');
  await marker(2).press('Space');await page.getByRole('textbox',{name:'Pitch mm',exact:true}).fill('16');await apply();
  await (await relationControl(page, 'textbox', 'Radius mm')).fill('4');await apply();
  expect(await read(base.version)).toEqual(sketch);await finish();let current=await context(page);const human=await read(current.version);
  const owner=human.graph.relations.find((r:{kind:string})=>r.kind==='linear-pattern');expect(owner).toMatchObject({count:4,spacing:' pitch ',direction:'+x',omittedInstances:[]});
  expect(human.graph.entities).toEqual([...sketch.graph.entities,...[1,2,3].map(index=>({id:`${owner.idPrefix}_i${index}_e0`,kind:'circle',centerPointId:`${owner.idPrefix}_i${index}_p0`,radius:4,construction:false}))]);
  expect(human.graph.points.slice(5).map((p:{position:number[]})=>p.position)).toEqual([[26,10],[42,10],[58,10]]);
  let built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0]).toMatchObject({solidCount:1,boundsMm:{min:[0,0,0],max:[70,20,5]}});expect(built.bodies[0].volumeMm3).toBeCloseTo((1400-64*Math.PI)*5,6);
  await edit();await select(`${owner.idPrefix}_i1_e0`);await expect(page.getByRole('button',{name:'Move selection',exact:true})).toBeDisabled();
  await page.locator(`[data-cad-sketch-entity="${owner.idPrefix}_i1_e0"]`).press('Shift+F10');await page.getByRole('menuitem',{name:'Edit pattern',exact:true}).click();await page.getByRole('textbox',{name:'Pitch mm',exact:true}).fill('17');await apply();
  await page.getByRole('button',{name:'Cancel sketch edits',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toHaveCount(0);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);expect(await read(current.version)).toEqual(sketch);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'redo'});current=await context(page);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);expect(await read(current.version)).toEqual(sketch);
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-parameter',name:'pitch',value:16},{kind:'set-parameter',name:'boreRadius',value:4},{kind:'set-sketch-relation',sketchId:'plate',relation:owner}]});
  current=await context(page);expect(await read(current.version)).toEqual(human);built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo((1400-64*Math.PI)*5,6);
  const rows=await call(page,'cad_inspect_sketch_constraints',{expectedVersion:current.version,sketchId:'plate',section:'entities'});expect(rows).toMatchObject({analysis:{degreesOfFreedom:0}});
  await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);expect(current.dirty).toBe(false);expect(await read(current.version)).toEqual(human);
});
