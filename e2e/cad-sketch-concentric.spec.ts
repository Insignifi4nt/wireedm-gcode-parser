import { expect, test } from '@playwright/test';
import { prepareCadTools, callCadTool as call, cadContext as context, historyRow, relationControl } from './cad-tool-helpers';

test('aligns curve centers privately and keeps the annular part associative through agent parity, Undo and reopen',async({page})=>{
  await prepareCadTools(page);await call(page,'cad_open_workspace');
  const sketch={id:'ring',kind:'sketch',name:'Ring',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{
    points:[{id:'outer-center',position:[' originX ',' 0.00 ']},{id:'bore-center',position:[2,1]}],
    entities:[{id:'rim',kind:'circle',centerPointId:'outer-center',radius:' outerRadius ',construction:false},
      {id:'bore',kind:'circle',centerPointId:'bore-center',radius:' boreRadius ',construction:false}],relations:[]}};
  await call(page,'cad_edit_document',{expectedVersion:(await context(page)).version,edits:[{kind:'set-parameter',name:'originX',value:0},
    {kind:'set-parameter',name:'outerRadius',value:10},{kind:'set-parameter',name:'boreRadius',value:4},{kind:'add-feature',feature:sketch},
    {kind:'add-feature',feature:{id:'pad',kind:'extrude',name:'Thickness',suppressed:false,sketchId:'ring',distance:' 5e0 ',symmetric:false,operation:'new',targetId:null}}]});
  const base=await context(page);await call(page,'cad_build',{expectedVersion:base.version});
  await (await historyRow(page, 'Ring')).dblclick();await expect(page.getByRole('button',{name:'Cancel sketch edits',exact:true})).toBeVisible();
  await page.locator('[data-cad-sketch-entity="rim"]').press('Enter');await page.locator('[data-cad-sketch-entity="bore"]').press('Shift+Enter');
  await (await relationControl(page, 'checkbox', 'Concentric')).check();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  expect((await call(page,'cad_get_feature',{expectedVersion:base.version,featureId:'ring'})).feature).toEqual(sketch);
  await (await relationControl(page, 'checkbox', 'Concentric')).check();await page.getByRole('button',{name:'Apply',exact:true}).click();
  await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);
  expect((await call(page,'cad_get_feature',{expectedVersion:base.version,featureId:'ring'})).feature).toEqual(sketch);
  await page.getByRole('button',{name:'Finish sketch',exact:true}).click();await expect(page.getByRole('button',{name:'Finish sketch',exact:true})).toHaveCount(0);
  let current=await context(page);const human=(await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature;
  expect(human).toMatchObject({graph:{points:[sketch.graph.points[0],{id:'bore-center',position:[0,0]}],entities:sketch.graph.entities,
    relations:[{id:expect.any(String),kind:'coincident',pointIds:['outer-center','bore-center']}]}});
  let built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo(420*Math.PI,6);
  const changes=[{kind:'set-parameter',name:'originX',value:5},{kind:'set-parameter',name:'outerRadius',value:12}];
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:changes});current=await context(page);
  const grown=(await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature;
  expect(grown).toMatchObject({graph:{points:[sketch.graph.points[0],{id:'bore-center',position:[5,0]}],entities:sketch.graph.entities,relations:human.graph.relations}});
  built=await call(page,'cad_build',{expectedVersion:current.version});expect(built.diagnostics).toEqual([]);expect(built.bodies[0].volumeMm3).toBeCloseTo(640*Math.PI,6);
  expect(built.bodies[0].boundsMm).toEqual({min:[-7,-12,0],max:[17,12,5]});
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature).toEqual(human);
  await call(page,'cad_history',{expectedVersion:current.version,direction:'undo'});current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature).toEqual(sketch);
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:[{kind:'set-sketch-relation',sketchId:'ring',relation:human.graph.relations[0]}]});current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature).toEqual(human);
  await call(page,'cad_edit_document',{expectedVersion:current.version,edits:changes});current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature).toEqual(grown);
  await call(page,'cad_save_document',{expectedVersion:current.version});await page.reload();await expect(page.getByRole('main',{name:'Parametric CAD workbench'})).toBeVisible();current=await context(page);
  expect((await call(page,'cad_get_feature',{expectedVersion:current.version,featureId:'ring'})).feature).toEqual(grown);expect(current.dirty).toBe(false);
});
