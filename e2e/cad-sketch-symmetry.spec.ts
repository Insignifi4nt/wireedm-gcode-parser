import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, relationControl } from './cad-tool-helpers';

test('keeps independent bores symmetric through private editing, parameter changes, Undo and exact agent/save parity',async({page})=>{
  await prepareCadTools(page);await call(page,'cad_open_workspace');
  const sketch={id:'plate',kind:'sketch',name:'Paired bore plate',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{
    points:[{id:'a',position:[' 0.00 ','0']},{id:'b',position:['70','0']},{id:'c',position:['70','20']},{id:'d',position:['0','20']},
      {id:'left',position:[' leftX ',' 10.00 ']},{id:'right',position:[49,11]},{id:'axis-a',position:['35.000','0']},{id:'axis-b',position:['35.000','20']}],
    entities:[{id:'ab',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'bc',kind:'line',startPointId:'b',endPointId:'c',construction:false},
      {id:'cd',kind:'line',startPointId:'c',endPointId:'d',construction:false},{id:'da',kind:'line',startPointId:'d',endPointId:'a',construction:false},
      {id:'left-bore',kind:'circle',centerPointId:'left',radius:' 3.00 ',construction:false},{id:'right-bore',kind:'circle',centerPointId:'right',radius:' 4.000 ',construction:false},
      {id:'axis',kind:'line',startPointId:'axis-a',endPointId:'axis-b',construction:true}],relations:[]}};
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'leftX',value:15},{kind:'add-feature',feature:sketch},
    {kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'plate',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page),read=(version:string)=>call(page,'cad_get_feature',{expectedVersion:version,featureId:'plate'}).then(r=>r.feature);
  const edit=async()=>{await (await historyRow(page, 'Paired bore plate')).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();};
  const apply=async()=>{await page.getByRole('button',{name:'Apply',exact:true}).click();await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);};
  const pick=async(kind:'point'|'entity',id:string,add=false)=>page.locator(`[data-cad-sketch-${kind}="${id}"]`).press(add?'Shift+Enter':'Enter');
  await edit();await pick('entity','left-bore');await pick('entity','right-bore',true);await pick('entity','axis',true);
  await (await relationControl(page, 'checkbox', 'Symmetric centers')).check();await page.getByRole('button',{name:'Cancel',exact:true}).click();expect(await read(base.version)).toEqual(sketch);
  await (await relationControl(page, 'checkbox', 'Symmetric centers')).check();await apply();
  await pick('point','left');await (await relationControl(page, 'textbox', 'X mm')).fill('20');await apply();expect(await read(base.version)).toEqual(sketch);
  await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);
  let current=await context(page);const human=await read(current.version),owner=human.graph.relations[0];
  expect(human).toEqual({...sketch,graph:{...sketch.graph,points:sketch.graph.points.map(point=>point.id==='right'?{...point,position:[50,10]}:point),relations:[{id:expect.any(String),kind:'symmetric',pointIds:['left','right'],lineId:'axis'}]}});
  expect(current.parameters).toEqual({leftX:20});let built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0]).toMatchObject({solidCount:1,boundsMm:{min:[0,0,0],max:[70,20,5]}});expect(built.bodies[0].volumeMm3).toBeCloseTo(7000-125*Math.PI,6);
  const constraints=await call(page,'cad_inspect_sketch_constraints',{expectedVersion:current.version,sketchId:'plate',section:'relations'});expect(constraints).toMatchObject({analysis:{degreesOfFreedom:0}});
  await edit();await pick('point','right');await pick('point','left',true);await pick('entity','axis',true);await expect((await relationControl(page, 'checkbox', 'Symmetric points'))).toBeChecked();
  await (await relationControl(page, 'checkbox', 'Symmetric points')).uncheck();await apply();await page.getByRole('button',{name:'Cancel sketch edits',exact:true}).click();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toHaveCount(0);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);expect(await read(current.version)).toEqual(sketch);expect(current.parameters).toEqual({leftX:15});
  await call(page,'cad_history',{expectedVersion:current.version,direction:'redo'});current=await context(page);expect(await read(current.version)).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-parameter',name:'leftX',value:20},{kind:'set-sketch-relation',sketchId:'plate',relation:owner}]});current=await context(page);expect(await read(current.version)).toEqual(human);
  built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo(7000-125*Math.PI,6);
  await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);expect(current.dirty).toBe(false);expect(await read(current.version)).toEqual(human);
});
